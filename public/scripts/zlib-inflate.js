/* zlib-inflate.js -- JavaScript implementation for the zlib inflate.
  Version: 0.2.0
  LastModified: Apr 12 2012
  Copyright (C) 2012 Masanao Izumo <iz@onicos.co.jp>

  This library is one of the JavaScript zlib implementation.
  Some API's are modified from the original.
  Only inflate API is implemented.

  The original copyright notice (zlib 1.2.6):

  Copyright (C) 1995-2012 Jean-loup Gailly and Mark Adler

  This software is provided 'as-is', without any express or implied
  warranty.  In no event will the authors be held liable for any damages
  arising from the use of this software.

  Permission is granted to anyone to use this software for any purpose,
  including commercial applications, and to alter it and redistribute it
  freely, subject to the following restrictions:

  1. The origin of this software must not be misrepresented; you must not
     claim that you wrote the original software. If you use this software
     in a product, an acknowledgment in the product documentation would be
     appreciated but is not required.
  2. Altered source versions must be plainly marked as such, and must not be
     misrepresented as being the original software.
  3. This notice may not be removed or altered from any source distribution.

  Jean-loup Gailly        Mark Adler
  jloup@gzip.org          madler@alumni.caltech.edu


  The data format used by the zlib library is described by RFCs (Request for
  Comments) 1950 to 1952 in the files http://tools.ietf.org/html/rfc1950
  (zlib format), rfc1951 (deflate format) and rfc1952 (gzip format).
*/

/*
                       API documentation
==============================================================================
Usage: z_stream = ZLIB.inflateInit([windowBits]);

     Create the stream object for decompression.
     See zlib.h for windowBits information.

==============================================================================
Usage: decoded_string = z_stream.inflate(encoded_string [, {OPTIONS...}]);

OPTIONS:
    next_in: decode start offset for encoded_string.

    avail_in: // TODO document.  See zlib.h for the information.

    avail_out: // TODO document.  See zlib.h for the information.

    flush: // TODO document.  See zlib.h for the information.

Ex: decoded_string = z_stream.inflate(encoded_string);
    decoded_string = z_stream.inflate(encoded_string,
                         {next_in: 0,
                          avail_in: encoded_string.length,
                          avail_out: 1024,
                          flush: ZLIB.Z_NO_FLUSH});

     See zlib.h for more information.

==============================================================================
Usage: z_stream.inflateReset();
    TODO document

*/

if( typeof ZLIB === 'undefined' ) {
    alert('ZLIB is not defined.  SRC zlib.js before zlib-inflate.js')
}

(function() {

/* inflate.c -- zlib decompression
 * Copyright (C) 1995-2011 Mark Adler
 * For conditions of distribution and use, see copyright notice in zlib.h
 */

var DEF_WBITS = 15;

// inflate_mode
var HEAD     =  0; /* i: waiting for magic header */
var FLAGS    =  1; /* i: waiting for method and flags (gzip) */
var TIME     =  2; /* i: waiting for modification time (gzip) */
var OS       =  3; /* i: waiting for extra flags and operating system (gzip) */
var EXLEN    =  4; /* i: waiting for extra length (gzip) */
var EXTRA    =  5; /* i: waiting for extra bytes (gzip) */
var NAME     =  6; /* i: waiting for end of file name (gzip) */
var COMMENT  =  7; /* i: waiting for end of comment (gzip) */
var HCRC     =  8; /* i: waiting for header crc (gzip) */
var DICTID   =  9; /* i: waiting for dictionary check value */
var DICT     = 10; /* waiting for inflateSetDictionary() call */
var TYPE     = 11; /* i: waiting for type bits, including last-flag bit */
var TYPEDO   = 12; /* i: same, but skip check to exit inflate on new block */
var STORED   = 13; /* i: waiting for stored size (length and complement) */
var COPY_    = 14; /* i/o: same as COPY below, but only first time in */
var COPY     = 15; /* i/o: waiting for input or output to copy stored block */
var TABLE    = 16; /* i: waiting for dynamic block table lengths */
var LENLENS  = 17; /* i: waiting for code length code lengths */
var CODELENS = 18; /* i: waiting for length/lit and distance code lengths */
var LEN_     = 19; /* i: same as LEN below, but only first time in */
var LEN      = 20; /* i: waiting for length/lit/eob code */
var LENEXT   = 21; /* i: waiting for length extra bits */
var DIST     = 22; /* i: waiting for distance code */
var DISTEXT  = 23; /* i: waiting for distance extra bits */
var MATCH    = 24; /* o: waiting for output space to copy string */
var LIT      = 25; /* o: waiting for output space to write literal */
var CHECK    = 26; /* i: waiting for 32-bit check value */
var LENGTH   = 27; /* i: waiting for 32-bit length (gzip) */
var DONE     = 28; /* finished check, done -- remain here until reset */
var BAD      = 29; /* got a data error -- remain here until reset */
var MEM      = 30; /* got an inflate() memory error -- remain here until reset */
var SYNC     = 31; /* looking for synchronization bytes to restart inflate() */

/* Maximum size of the dynamic table.  The maximum number of code structures is
   1444, which is the sum of 852 for literal/length codes and 592 for distance
   codes.  These values were found by exhaustive searches using the program
   examples/enough.c found in the zlib distribtution.  The arguments to that
   program are the number of symbols, the initial root table size, and the
   maximum bit length of a code.  "enough 286 9 15" for literal/length codes
   returns returns 852, and "enough 30 6 15" for distance codes returns 592.
   The initial root table size (9 or 6) is found in the fifth argument of the
   inflate_table() calls in inflate.c and infback.c.  If the root table size is
   changed, then these maximum sizes would be need to be recalculated and
   updated. */
var ENOUGH_LENS = 852;
var ENOUGH_DISTS = 592;
var ENOUGH = (ENOUGH_LENS + ENOUGH_DISTS);

/* Type of code to build for inflate_table() */
var CODES = 0;
var LENS = 1;
var DISTS = 2;



var inflate_table_lbase = [ /* Length codes 257..285 base */
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0];
var inflate_table_lext = [ /* Length codes 257..285 extra */
    16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,
    19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 203, 69];
var inflate_table_dbase = [ /* Distance codes 0..29 base */
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577, 0, 0];
var inflate_table_dext = [ /* Distance codes 0..29 extra */
    16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
    23, 23, 24, 24, 25, 25, 26, 26, 27, 27,
    28, 28, 29, 29, 64, 64];

/* inftrees.c -- generate Huffman trees for efficient decoding
 * Copyright (C) 1995-2012 Mark Adler
 * For conditions of distribution and use, see copyright notice in zlib.h
 */

ZLIB.inflate_copyright =
   ' inflate 1.2.6 Copyright 1995-2012 Mark Adler ';
/*
  If you use the zlib library in a product, an acknowledgment is welcome
  in the documentation of your product. If for some reason you cannot
  include such an acknowledgment, I would appreciate that you keep this
  copyright string in the executable of your product.
 */

/*
  Build a set of tables to decode the provided canonical Huffman code.
  The code lengths are lens[0..codes-1].  The result starts at *table,
  whose indices are 0..2^bits-1.  work is a writable array of at least
  lens shorts, which is used as a work area.  type is the type of code
  to be generated, CODES, LENS, or DISTS.  On return, zero is success,
  -1 is an invalid code, and +1 means that ENOUGH isn't enough.  table
  on return points to the next available entry's address.  bits is the
  requested root table index bits, and on return it is the actual root
  table index bits.  It will differ if the request is greater than the
  longest code or if it is less than the shortest code.
*/
function inflate_table(state, type)
{
    var MAXBITS = 15;
    var table = state.next;
    var bits = (type == DISTS ? state.distbits : state.lenbits);
    var work = state.work;
    var lens = state.lens;
    var lens_offset = (type == DISTS ? state.nlen : 0);
    var state_codes = state.codes;
    var codes;
    if(type == LENS)
        codes = state.nlen;
    else if(type == DISTS)
        codes = state.ndist;
    else // CODES
        codes = 19;

    var len;               /* a code's length in bits */
    var sym;               /* index of code symbols */
    var min, max;          /* minimum and maximum code lengths */
    var root;              /* number of index bits for root table */
    var curr;              /* number of index bits for current table */
    var drop;              /* code bits to drop for sub-table */
    var left;              /* number of prefix codes available */
    var used;              /* code entries in table used */
    var huff;              /* Huffman code */
    var incr;              /* for incrementing code, index */
    var fill;              /* index for replicating entries */
    var low;               /* low bits for current root entry */
    var mask;              /* mask for low root bits */
    var here;              /* table entry for duplication */
    var next;              /* next available space in table */
    var base;              /* base value table to use */
    var base_offset;
    var extra;             /* extra bits table to use */
    var extra_offset;
    var end;                    /* use base and extra for symbol > end */
    var count = new Array(MAXBITS+1);    /* number of codes of each length */
    var offs = new Array(MAXBITS+1);     /* offsets in table for each length */

    /*
      Process a set of code lengths to create a canonical Huffman code.  The
      code lengths are lens[0..codes-1].  Each length corresponds to the
      symbols 0..codes-1.  The Huffman code is generated by first sorting the
      symbols by length from short to long, and retaining the symbol order
      for codes with equal lengths.  Then the code starts with all zero bits
      for the first code of the shortest length, and the codes are integer
      increments for the same length, and zeros are appended as the length
      increases.  For the deflate format, these bits are stored backwards
      from their more natural integer increment ordering, and so when the
      decoding tables are built in the large loop below, the integer codes
      are incremented backwards.

      This routine assumes, but does not check, that all of the entries in
      lens[] are in the range 0..MAXBITS.  The caller must assure this.
      1..MAXBITS is interpreted as that code length.  zero means that that
      symbol does not occur in this code.

      The codes are sorted by computing a count of codes for each length,
      creating from that a table of starting indices for each length in the
      sorted table, and then entering the symbols in order in the sorted
      table.  The sorted table is work[], with that space being provided by
      the caller.

      The length counts are used for other purposes as well, i.e. finding
      the minimum and maximum length codes, determining if there are any
      codes at all, checking for a valid set of lengths, and looking ahead
      at length counts to determine sub-table sizes when building the
      decoding tables.
    */

    /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */
    for (len = 0; len <= MAXBITS; len++)
        count[len] = 0;
    for (sym = 0; sym < codes; sym++)
        count[lens[lens_offset + sym]]++;

    /* bound code lengths, force root to be within code lengths */
    root = bits;

    for (max = MAXBITS; max >= 1; max--)
        if (count[max] != 0) break;
    if (root > max) root = max;
    if (max == 0) {
        /* no symbols to code at all */
        /* invalid code marker */
        here = {op:64, bits:1, val:0};
        state_codes[table++] = here; /* make a table to force an error */
        state_codes[table++] = here;
        if(type == DISTS) state.distbits = 1; else state.lenbits = 1; // *bits = 1;
        state.next = table;
        return 0;     /* no symbols, but wait for decoding to report error */
    }
    for (min = 1; min < max; min++)
        if (count[min] != 0) break;
    if (root < min) root = min;

    /* check for an over-subscribed or incomplete set of lengths */
    left = 1;
    for (len = 1; len <= MAXBITS; len++) {
        left <<= 1;
        left -= count[len];
        if (left < 0) return -1;        /* over-subscribed */
    }
    if (left > 0 && (type == CODES || max != 1)) {
        state.next = table;
        return -1;                      /* incomplete set */
    }

    /* generate offsets into symbol table for each length for sorting */
    offs[1] = 0;
    for (len = 1; len < MAXBITS; len++)
        offs[len + 1] = offs[len] + count[len];

    /* sort symbols by length, by symbol order within each length */
    for (sym = 0; sym < codes; sym++)
        if (lens[lens_offset + sym] != 0) work[offs[lens[lens_offset + sym]]++] = sym;

    /*
      Create and fill in decoding tables.  In this loop, the table being
      filled is at next and has curr index bits.  The code being used is huff
      with length len.  That code is converted to an index by dropping drop
      bits off of the bottom.  For codes where len is less than drop + curr,
      those top drop + curr - len bits are incremented through all values to
      fill the table with replicated entries.

      root is the number of index bits for the root table.  When len exceeds
      root, sub-tables are created pointed to by the root entry with an index
      of the low root bits of huff.  This is saved in low to check for when a
      new sub-table should be started.  drop is zero when the root table is
      being filled, and drop is root when sub-tables are being filled.

      When a new sub-table is needed, it is necessary to look ahead in the
      code lengths to determine what size sub-table is needed.  The length
      counts are used for this, and so count[] is decremented as codes are
      entered in the tables.

      used keeps track of how many table entries have been allocated from the
      provided *table space.  It is checked for LENS and DIST tables against
      the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in
      the initial root table size constants.  See the comments in inftrees.h
      for more information.

      sym increments through all symbols, and the loop terminates when
      all codes of length max, i.e. all codes, have been processed.  This
      routine permits incomplete codes, so another loop after this one fills
      in the rest of the decoding tables with invalid code markers.
    */

    /* set up for code type */
    switch (type) {
    case CODES:
        base = extra = work;    /* dummy value--not used */
        base_offset = 0;
        extra_offset = 0;
        end = 19;
        break;
    case LENS:
        base = inflate_table_lbase;
        base_offset = -257; // base -= 257;
        extra = inflate_table_lext;
        extra_offset = -257; // extra -= 257;
        end = 256;
        break;
    default:            /* DISTS */
        base = inflate_table_dbase;
        extra = inflate_table_dext;
        base_offset = 0;
        extra_offset = 0;
        end = -1;
    }

    /* initialize state for loop */
    huff = 0;                   /* starting code */
    sym = 0;                    /* starting code symbol */
    len = min;                  /* starting code length */
    next = table;               /* current table to fill in */
    curr = root;                /* current table index bits */
    drop = 0;                   /* current bits to drop from code for index */
    low = -1;                   /* trigger new sub-table when len > root */
    used = 1 << root;           /* use root table entries */
    mask = used - 1;            /* mask for comparing low */

    /* check available table space */
    if ((type == LENS && used >= ENOUGH_LENS) ||
        (type == DISTS && used >= ENOUGH_DISTS)) {
        state.next = table;
        return 1;
    }

    /* process all codes and make table entries */
    for (;;) {
        /* create table entry */
        here = {op:0, bits:len - drop, val:0};
        if (work[sym] < end) {
            here.val = work[sym];
        }
        else if (work[sym] > end) {
            here.op = extra[extra_offset + work[sym]];
            here.val = base[base_offset + work[sym]];
        }
        else {
            here.op = 32 + 64;         /* end of block */
        }

        /* replicate for those indices with low len bits equal to huff */
        incr = 1 << (len - drop);
        fill = 1 << curr;
        min = fill;                 /* save offset to next table */
        do {
            fill -= incr;
            state_codes[next + (huff >>> drop) + fill] = here;
        } while (fill != 0);

        /* backwards increment the len-bit code huff */
        incr = 1 << (len - 1);
        while (huff & incr)
            incr >>>= 1;
        if (incr != 0) {
            huff &= incr - 1;
            huff += incr;
        }
        else
            huff = 0;

        /* go to next symbol, update count, len */
        sym++;
        if (--(count[len]) == 0) {
            if (len == max) break;
            len = lens[lens_offset + work[sym]];
        }

        /* create new sub-table if needed */
        if (len > root && (huff & mask) != low) {
            /* if first time, transition to sub-tables */
            if (drop == 0)
                drop = root;

            /* increment past last table */
            next += min;            /* here min is 1 << curr */

            /* determine length of next table */
            curr = len - drop;
            left = (1 << curr);
            while (curr + drop < max) {
                left -= count[curr + drop];
                if (left <= 0) break;
                curr++;
                left <<= 1;
            }

            /* check for enough space */
            used += 1 << curr;
            if ((type == LENS && used >= ENOUGH_LENS) ||
                (type == DISTS && used >= ENOUGH_DISTS)) {
                state.next = table;
                return 1;
            }

            /* point entry in root table to sub-table */
            low = huff & mask;
            state_codes[table + low] = {op:curr, bits:root, val:next - table};
        }
    }

    /* fill in remaining table entry if code is incomplete (guaranteed to have
       at most one remaining entry, since if the code is incomplete, the
       maximum code length that was allowed to get this far is one bit) */
    if (huff != 0) {
        state_codes[next + huff] = {op:64, bits:len - drop, val:0};
    }

    /* set return parameters */
    state.next = table + used;
    if(type == DISTS) state.distbits = root; else state.lenbits = root; //*bits = root;
    return 0;
}

/* inffast.c -- fast decoding
 * Copyright (C) 1995-2008, 2010 Mark Adler
 * For conditions of distribution and use, see copyright notice in zlib.h
 */

/*
   Decode literal, length, and distance codes and write out the resulting
   literal and match bytes until either not enough input or output is
   available, an end-of-block is encountered, or a data error is encountered.
   When large enough input and output buffers are supplied to inflate(), for
   example, a 16K input buffer and a 64K output buffer, more than 95% of the
   inflate execution time is spent in this routine.

   Entry assumptions:

        state->mode == LEN
        strm->avail_in >= 6
        strm->avail_out >= 258
        start >= strm->avail_out
        state->bits < 8

   On return, state->mode is one of:

        LEN -- ran out of enough output space or enough available input
        TYPE -- reached end of block code, inflate() to interpret next block
        BAD -- error in block data

   Notes:

    - The maximum input bits used by a length/distance pair is 15 bits for the
      length code, 5 bits for the length extra, 15 bits for the distance code,
      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.
      Therefore if strm->avail_in >= 6, then there is enough input to avoid
      checking for available input while decoding.

    - The maximum bytes that a single length/distance pair can output is 258
      bytes, which is the maximum length that can be coded.  inflate_fast()
      requires strm->avail_out >= 258 for each loop to avoid checking for
      output space.
 */
function inflate_fast(strm,
                      start) /* inflate()'s starting value for strm->avail_out */
{
    var state;
    var input_data;      /* local strm->input_data */
    var next_in;      /* zlib.js: index of input_data */
    var last;    /* while next_in < last, enough input available */
    var out;     /* local strm.next_out */
    var beg;     /* inflate()'s initial strm.next_out */
    var end;     /* while out < end, enough space available */
//NOSPRT #ifdef INFLATE_STRICT
//    unsigned dmax;              /* maximum distance from zlib header */
//#endif
    var wsize;             /* window size or zero if not using window */
    var whave;             /* valid bytes in the window */
    var wnext;             /* window write index */
    var window;  /* allocated sliding window, if wsize != 0 */
    var hold;         /* local strm->hold */
    var bits;              /* local strm->bits */
    var codes;             /* zlib.js: local state.codes */
    var lcode;      /* local strm->lencode */
    var dcode;      /* local strm->distcode */
    var lmask;             /* mask for first level of length codes */
    var dmask;             /* mask for first level of distance codes */
    var here;                  /* retrieved table entry */
    var op;                /* code bits, operation, extra bits, or */
    /*  window position, window bytes to copy */
    var len;               /* match length, unused bytes */
    var dist;              /* match distance */
    //    var from;    /* where to copy match from */
    var from_window_offset = -1; /* index of window[] */
    var from_out_offset = -1; /* index of next_out[] */

    /* copy state to local variables */
    state = strm.state;
    input_data = strm.input_data;
    next_in = strm.next_in;
    last = next_in + strm.avail_in - 5;
    out = strm.next_out;
    beg = out - (start - strm.avail_out);
    end = out + (strm.avail_out - 257);
//NOSPRT #ifdef INFLATE_STRICT
//    dmax = state->dmax;
//#endif
    wsize = state.wsize;
    whave = state.whave;
    wnext = state.wnext;
    window = state.window;
    hold = state.hold;
    bits = state.bits;
    codes = state.codes;
    lcode = state.lencode;
    dcode = state.distcode;
    lmask = (1 << state.lenbits) - 1;
    dmask = (1 << state.distbits) - 1;

    /* decode literals and length/distances until end-of-block or not enough
       input data or output space */
loop: do {
        if (bits < 15) {
            hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
            bits += 8;
            hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
            bits += 8;
        }
        here = codes[lcode + (hold & lmask)];
    dolen: while(true) {
            op = here.bits;
            hold >>>= op;
            bits -= op;
            op = here.op;
            if (op == 0) {                          /* literal */
//            Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
//                    "inflate:         literal '%c'\n" :
//                    "inflate:         literal 0x%02x\n", here.val));
                strm.output_data += String.fromCharCode(here.val);
                out++;
            }
            else if (op & 16) {                     /* length base */
                len = here.val;
                op &= 15;                           /* number of extra bits */
                if (op) {
                    if (bits < op) {
                        hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
                        bits += 8;
                    }
                    len += hold & ((1 << op) - 1);
                    hold >>>= op;
                    bits -= op;
                }
//            Tracevv((stderr, "inflate:         length %u\n", len));
                if (bits < 15) {
                    hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
                    bits += 8;
                    hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
                    bits += 8;
                }
                here = codes[dcode + (hold & dmask)];
            dodist: while(true) {
                    op = here.bits;
                    hold >>>= op;
                    bits -= op;
                    op = here.op;
                    if (op & 16) {                      /* distance base */
                        dist = here.val;
                        op &= 15;                       /* number of extra bits */
                        if (bits < op) {
                            hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
                            bits += 8;
                            if (bits < op) {
                                hold += (input_data.charCodeAt(next_in++) & 0xff) << bits;
                                bits += 8;
                            }
                        }
                        dist += hold & ((1 << op) - 1);
//NOSPRT #ifdef INFLATE_STRICT
//                if (dist > dmax) {
//                    strm->msg = (char *)"invalid distance too far back";
//                    state->mode = BAD;
//                    break loop;
//                }
//#endif
                        hold >>>= op;
                        bits -= op;
//                Tracevv((stderr, "inflate:         distance %u\n", dist));
                        op = out - beg;                 /* max distance in output */
                        if (dist > op) {                /* see if copy from window */
                            op = dist - op;             /* distance back in window */
                            if (op > whave) {
                                if (state.sane) {
                                    strm.msg = 'invalid distance too far back';
                                    state.mode = BAD;
                                    break loop;
                                }
//NOSPRT #ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//                        if (len <= op - whave) {
//                            do {
//                                PUP(out) = 0;
//                            } while (--len);
//                            continue;
//                        }
//                        len -= op - whave;
//                        do {
//                            PUP(out) = 0;
//                        } while (--op > whave);
//                        if (op == 0) {
//                            from = out - dist;
//                            do {
//                                PUP(out) = PUP(from);
//                            } while (--len);
//                            continue;
//                        }
//#endif
                            } // if (op > whave)

                            from_window_offset = 0;
                            from_out_offset = -1;
							if (wnext == 0) {           /* very common case */
								from_window_offset += wsize - op;
								if (op < len) {         /* some from window */
									len -= op;
									strm.output_data += window.substring(from_window_offset, from_window_offset + op);
									out += op;
									op = 0;
									from_window_offset = -1;
									from_out_offset = out - dist;  /* rest from output */
								}
							}
//NOTREACHED else if (wnext < op) {      /* wrap around window */
//NOTREACHED     from += wsize + wnext - op;
//NOTREACHED     op -= wnext;
//NOTREACHED     if (op < len) {         /* some from end of window */
//NOTREACHED         len -= op;
//NOTREACHED         do {
//NOTREACHED             PUP(out) = PUP(from);
//NOTREACHED         } while (--op);
//NOTREACHED         from = window - OFF;
//NOTREACHED         if (wnext < len) {  /* some from start of window */
//NOTREACHED             op = wnext;
//NOTREACHED             len -= op;
//NOTREACHED             do {
//NOTREACHED                 PUP(out) = PUP(from);
//NOTREACHED             } while (--op);
//NOTREACHED             from = out - dist;      /* rest from output */
//NOTREACHED         }
//NOTREACHED     }
//NOTREACHED }
							else {                      /* contiguous in window */
								from_window_offset += wnext - op;
								if (op < len) {         /* some from window */
									len -= op;
									strm.output_data += window.substring(from_window_offset, from_window_offset + op);
									out += op;
									from_window_offset = -1;
									from_out_offset = out - dist;  /* rest from output */
								}
							}
                        }
                        else {
                            from_window_offset = -1;
                            from_out_offset = out - dist;          /* copy direct from output */
                        }

                        if (from_window_offset >= 0) {
                            strm.output_data += window.substring(from_window_offset, from_window_offset + len);
                            out += len;
                            from_window_offset += len;
                        } else {
                            var len_inner = len;
                            if(len_inner > out - from_out_offset)
                              len_inner = out - from_out_offset;
                            strm.output_data += strm.output_data.substring(
                                from_out_offset, from_out_offset + len_inner);
                            out += len_inner;
                            len -= len_inner;
                            from_out_offset += len_inner;
                            out += len;
                            while (len > 2) {
                                strm.output_data += strm.output_data.charAt(from_out_offset++);
                                strm.output_data += strm.output_data.charAt(from_out_offset++);
                                strm.output_data += strm.output_data.charAt(from_out_offset++);
                                len -= 3;
                            }
                            if (len) {
                                strm.output_data += strm.output_data.charAt(from_out_offset++);
                                if (len > 1)
                                    strm.output_data += strm.output_data.charAt(from_out_offset++);
                            }
                        }
                    }
                    else if ((op & 64) == 0) {          /* 2nd level distance code */
                        here = codes[dcode + (here.val + (hold & ((1 << op) - 1)))];
                        continue dodist; // goto dodist
                    }
                    else {
                        strm.msg = 'invalid distance code';
                        state.mode = BAD;
                        break loop;
                    }
                    break dodist; }
            }
            else if ((op & 64) == 0) {              /* 2nd level length code */
                here = codes[lcode + (here.val + (hold & ((1 << op) - 1)))];
                continue dolen; // goto dolen;
            }
            else if (op & 32) {                     /* end-of-block */
                //            Tracevv((stderr, "inflate:         end of block\n"));
                state.mode = TYPE;
                break loop;
            }
            else {
                strm.msg = 'invalid literal/length code';
                state.mode = BAD;
                break loop;
            }
            break dolen; }
    } while (next_in < last && out < end);

    /* return unused bytes (on entry, bits < 8, so in won't go too far back) */
    len = bits >>> 3;
    next_in -= len;
    bits -= len << 3;
    hold &= (1 << bits) - 1;

    /* update state and return */
    strm.next_in = next_in;
    strm.next_out = out;
    strm.avail_in = (next_in < last ? 5 + (last - next_in) : 5 - (next_in - last));
    strm.avail_out = (out < end ?
                      257 + (end - out) : 257 - (out - end));
    state.hold = hold;
    state.bits = bits;
}

function new_array(size)
{
    var i;
    var ary = new Array(size);
    for(i = 0; i < size; i++)
        ary[i] = 0;
    return ary;
}

function getarg(opts, name, def_value)
{
    return (opts && (name in opts)) ? opts[name] : def_value;
}

function checksum_none()
{
	return 0;
}

/**
 * z_stream constructor
 * @constructor
 */
function inflate_state()
{
    var i;

    this.mode = 0;              /* current inflate mode */
    this.last = 0;              /* true if processing last block */
    this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
    this.havedict = 0;          /* true if dictionary provided */
    this.flags = 0;             /* gzip header method and flags (0 if zlib) */
    this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */
    this.check = 0;             /* protected copy of check value */
    this.total = 0;             /* protected copy of output count */
    this.head = null;           /* where to save gzip header information */
    /* sliding window */
    this.wbits = 0;             /* log base 2 of requested window size */
    this.wsize = 0;             /* window size or zero if not using window */
    this.whave = 0;             /* valid bytes in the window */
    this.wnext = 0;             /* window write index (TODO remove) */
    this.window = null;         /* allocated sliding window, if needed */
    /* bit accumulator */
    this.hold = 0;              /* input bit accumulator */
    this.bits = 0;              /* number of bits in "in" */
    /* for string and stored block copying */
    this.length = 0;            /* literal or length of data to copy */
    this.offset = 0;            /* distance back to copy string from */
    /* for table and code decoding */
    this.extra = 0;             /* extra bits needed */
    /* fixed and dynamic code tables */

    /* zlib.js: modified implementation: lencode, distcode, next are offset of codes[] */
    this.lencode = 0;           /* starting table for length/literal codes */
    this.distcode = 0;          /* starting table for distance codes */
    this.lenbits = 0;           /* index bits for lencode */
    this.distbits = 0;          /* index bits for distcode */
    /* dynamic table building */
    this.ncode = 0;             /* number of code length code lengths */
    this.nlen = 0;              /* number of length code lengths */
    this.ndist = 0;             /* number of distance code lengths */
    this.have = 0;              /* number of code lengths in lens[] */
    this.next = 0;              /* next available space in codes[] */
    this.lens = new_array(320); /* temporary storage for code lengths */
    this.work = new_array(288); /* work area for code table building */
    this.codes = new Array(ENOUGH);         /* space for code tables */
    var c = {op:0, bits:0, val:0};
    for(i = 0; i < ENOUGH; i++)
        this.codes[i] = c;
    this.sane = 0;              /* if false, allow invalid distance too far */
    this.back = 0;              /* bits back of last unprocessed length/lit */
    this.was = 0;               /* initial length of match */
}

ZLIB.inflateResetKeep = function(strm)
{
    var state;

    if (!strm || !strm.state) return ZLIB.Z_STREAM_ERROR;
    state = strm.state;
    strm.total_in = strm.total_out = state.total = 0;
    strm.msg = null;
    if (state.wrap) {        /* to support ill-conceived Java test suite */
        strm.adler = state.wrap & 1;
    }

    state.mode = HEAD;
    state.last = 0;
    state.havedict = 0;
    state.dmax = 32768;
    state.head = null;
    state.hold = 0;
    state.bits = 0;
    state.lencode = 0;
    state.distcode = 0;
    state.next = 0;
    state.sane = 1;
    state.back = -1;
    return ZLIB.Z_OK;
};

// Usage: strm = ZLIB.inflateReset(z_stream [, windowBits]);
ZLIB.inflateReset = function(strm, windowBits)
{
    var wrap;
    var state;

    /* get the state */
    if (!strm || !strm.state) return ZLIB.Z_STREAM_ERROR;
    state = strm.state;

	if(typeof windowBits === "undefined")
		windowBits = DEF_WBITS;

    /* extract wrap request from windowBits parameter */
    if (windowBits < 0) {
        wrap = 0;
        windowBits = -windowBits;
    }
    else {
        wrap = (windowBits >>> 4) + 1;
        if (windowBits < 48)
            windowBits &= 15;
    }

	if(wrap == 1 && (typeof ZLIB.adler32 === 'function')) {
		strm.checksum_function = ZLIB.adler32;
	} else if(wrap == 2 && (typeof ZLIB.crc32 === 'function')) {
		strm.checksum_function = ZLIB.crc32;
	} else {
		strm.checksum_function = checksum_none;
	}

    /* set number of window bits, free window if different */
    if (windowBits && (windowBits < 8 || windowBits > 15))
        return ZLIB.Z_STREAM_ERROR;
    if (state.window && state.wbits != windowBits) {
        state.window = null;
    }

    /* update state and reset the rest of it */
    state.wrap = wrap;
    state.wbits = windowBits;
    state.wsize = 0;
    state.whave = 0;
    state.wnext = 0;
    return ZLIB.inflateResetKeep(strm);
};

// Usage: strm = ZLIB.inflateInit([windowBits]);
ZLIB.inflateInit = function(windowBits)
{
    var strm = new ZLIB.z_stream();
    strm.state = new inflate_state();
    ZLIB.inflateReset(strm, windowBits);
    return strm;
};

ZLIB.inflatePrime = function(strm, bits, value)
{
    var state;

    if (!strm || !strm.state) return ZLIB.Z_STREAM_ERROR;
    state = strm.state;
    if (bits < 0) {
        state.hold = 0;
        state.bits = 0;
        return ZLIB.Z_OK;
    }
    if (bits > 16 || state.bits + bits > 32) return ZLIB.Z_STREAM_ERROR;
    value &= (1 << bits) - 1;
    state.hold += value << state.bits;
    state.bits += bits;
    return ZLIB.Z_OK;
};

var lenfix_ary = null;
var distfix_ary = null;
function fixedtables(state)
{
    var i;
    if (!lenfix_ary) lenfix_ary = [ { op: 96, bits: 7, val: 0 }, { op: 0, bits: 8, val: 80 }, { op: 0, bits: 8, val: 16 }, { op: 20, bits: 8, val: 115 }, { op: 18, bits: 7, val: 31 }, { op: 0, bits: 8, val: 112 }, { op: 0, bits: 8, val: 48 }, { op: 0, bits: 9, val: 192 }, { op: 16, bits: 7, val: 10 }, { op: 0, bits: 8, val: 96 }, { op: 0, bits: 8, val: 32 }, { op: 0, bits: 9, val: 160 }, { op: 0, bits: 8, val: 0 }, { op: 0, bits: 8, val: 128 }, { op: 0, bits: 8, val: 64 }, { op: 0, bits: 9, val: 224 }, { op: 16, bits: 7, val: 6 }, { op: 0, bits: 8, val: 88 }, { op: 0, bits: 8, val: 24 }, { op: 0, bits: 9, val: 144 }, { op: 19, bits: 7, val: 59 }, { op: 0, bits: 8, val: 120 }, { op: 0, bits: 8, val: 56 }, { op: 0, bits: 9, val: 208 }, { op: 17, bits: 7, val: 17 }, { op: 0, bits: 8, val: 104 }, { op: 0, bits: 8, val: 40 }, { op: 0, bits: 9, val: 176 }, { op: 0, bits: 8, val: 8 }, { op: 0, bits: 8, val: 136 }, { op: 0, bits: 8, val: 72 }, { op: 0, bits: 9, val: 240 }, { op: 16, bits: 7, val: 4 }, { op: 0, bits: 8, val: 84 }, { op: 0, bits: 8, val: 20 }, { op: 21, bits: 8, val: 227 }, { op: 19, bits: 7, val: 43 }, { op: 0, bits: 8, val: 116 }, { op: 0, bits: 8, val: 52 }, { op: 0, bits: 9, val: 200 }, { op: 17, bits: 7, val: 13 }, { op: 0, bits: 8, val: 100 }, { op: 0, bits: 8, val: 36 }, { op: 0, bits: 9, val: 168 }, { op: 0, bits: 8, val: 4 }, { op: 0, bits: 8, val: 132 }, { op: 0, bits: 8, val: 68 }, { op: 0, bits: 9, val: 232 }, { op: 16, bits: 7, val: 8 }, { op: 0, bits: 8, val: 92 }, { op: 0, bits: 8, val: 28 }, { op: 0, bits: 9, val: 152 }, { op: 20, bits: 7, val: 83 }, { op: 0, bits: 8, val: 124 }, { op: 0, bits: 8, val: 60 }, { op: 0, bits: 9, val: 216 }, { op: 18, bits: 7, val: 23 }, { op: 0, bits: 8, val: 108 }, { op: 0, bits: 8, val: 44 }, { op: 0, bits: 9, val: 184 }, { op: 0, bits: 8, val: 12 }, { op: 0, bits: 8, val: 140 }, { op: 0, bits: 8, val: 76 }, { op: 0, bits: 9, val: 248 }, { op: 16, bits: 7, val: 3 }, { op: 0, bits: 8, val: 82 }, { op: 0, bits: 8, val: 18 }, { op: 21, bits: 8, val: 163 }, { op: 19, bits: 7, val: 35 }, { op: 0, bits: 8, val: 114 }, { op: 0, bits: 8, val: 50 }, { op: 0, bits: 9, val: 196 }, { op: 17, bits: 7, val: 11 }, { op: 0, bits: 8, val: 98 }, { op: 0, bits: 8, val: 34 }, { op: 0, bits: 9, val: 164 }, { op: 0, bits: 8, val: 2 }, { op: 0, bits: 8, val: 130 }, { op: 0, bits: 8, val: 66 }, { op: 0, bits: 9, val: 228 }, { op: 16, bits: 7, val: 7 }, { op: 0, bits: 8, val: 90 }, { op: 0, bits: 8, val: 26 }, { op: 0, bits: 9, val: 148 }, { op: 20, bits: 7, val: 67 }, { op: 0, bits: 8, val: 122 }, { op: 0, bits: 8, val: 58 }, { op: 0, bits: 9, val: 212 }, { op: 18, bits: 7, val: 19 }, { op: 0, bits: 8, val: 106 }, { op: 0, bits: 8, val: 42 }, { op: 0, bits: 9, val: 180 }, { op: 0, bits: 8, val: 10 }, { op: 0, bits: 8, val: 138 }, { op: 0, bits: 8, val: 74 }, { op: 0, bits: 9, val: 244 }, { op: 16, bits: 7, val: 5 }, { op: 0, bits: 8, val: 86 }, { op: 0, bits: 8, val: 22 }, { op: 64, bits: 8, val: 0 }, { op: 19, bits: 7, val: 51 }, { op: 0, bits: 8, val: 118 }, { op: 0, bits: 8, val: 54 }, { op: 0, bits: 9, val: 204 }, { op: 17, bits: 7, val: 15 }, { op: 0, bits: 8, val: 102 }, { op: 0, bits: 8, val: 38 }, { op: 0, bits: 9, val: 172 }, { op: 0, bits: 8, val: 6 }, { op: 0, bits: 8, val: 134 }, { op: 0, bits: 8, val: 70 }, { op: 0, bits: 9, val: 236 }, { op: 16, bits: 7, val: 9 }, { op: 0, bits: 8, val: 94 }, { op: 0, bits: 8, val: 30 }, { op: 0, bits: 9, val: 156 }, { op: 20, bits: 7, val: 99 }, { op: 0, bits: 8, val: 126 }, { op: 0, bits: 8, val: 62 }, { op: 0, bits: 9, val: 220 }, { op: 18, bits: 7, val: 27 }, { op: 0, bits: 8, val: 110 }, { op: 0, bits: 8, val: 46 }, { op: 0, bits: 9, val: 188 }, { op: 0, bits: 8, val: 14 }, { op: 0, bits: 8, val: 142 }, { op: 0, bits: 8, val: 78 }, { op: 0, bits: 9, val: 252 }, { op: 96, bits: 7, val: 0 }, { op: 0, bits: 8, val: 81 }, { op: 0, bits: 8, val: 17 }, { op: 21, bits: 8, val: 131 }, { op: 18, bits: 7, val: 31 }, { op: 0, bits: 8, val: 113 }, { op: 0, bits: 8, val: 49 }, { op: 0, bits: 9, val: 194 }, { op: 16, bits: 7, val: 10 }, { op: 0, bits: 8, val: 97 }, { op: 0, bits: 8, val: 33 }, { op: 0, bits: 9, val: 162 }, { op: 0, bits: 8, val: 1 }, { op: 0, bits: 8, val: 129 }, { op: 0, bits: 8, val: 65 }, { op: 0, bits: 9, val: 226 }, { op: 16, bits: 7, val: 6 }, { op: 0, bits: 8, val: 89 }, { op: 0, bits: 8, val: 25 }, { op: 0, bits: 9, val: 146 }, { op: 19, bits: 7, val: 59 }, { op: 0, bits: 8, val: 121 }, { op: 0, bits: 8, val: 57 }, { op: 0, bits: 9, val: 210 }, { op: 17, bits: 7, val: 17 }, { op: 0, bits: 8, val: 105 }, { op: 0, bits: 8, val: 41 }, { op: 0, bits: 9, val: 178 }, { op: 0, bits: 8, val: 9 }, { op: 0, bits: 8, val: 137 }, { op: 0, bits: 8, val: 73 }, { op: 0, bits: 9, val: 242 }, { op: 16, bits: 7, val: 4 }, { op: 0, bits: 8, val: 85 }, { op: 0, bits: 8, val: 21 }, { op: 16, bits: 8, val: 258 }, { op: 19, bits: 7, val: 43 }, { op: 0, bits: 8, val: 117 }, { op: 0, bits: 8, val: 53 }, { op: 0, bits: 9, val: 202 }, { op: 17, bits: 7, val: 13 }, { op: 0, bits: 8, val: 101 }, { op: 0, bits: 8, val: 37 }, { op: 0, bits: 9, val: 170 }, { op: 0, bits: 8, val: 5 }, { op: 0, bits: 8, val: 133 }, { op: 0, bits: 8, val: 69 }, { op: 0, bits: 9, val: 234 }, { op: 16, bits: 7, val: 8 }, { op: 0, bits: 8, val: 93 }, { op: 0, bits: 8, val: 29 }, { op: 0, bits: 9, val: 154 }, { op: 20, bits: 7, val: 83 }, { op: 0, bits: 8, val: 125 }, { op: 0, bits: 8, val: 61 }, { op: 0, bits: 9, val: 218 }, { op: 18, bits: 7, val: 23 }, { op: 0, bits: 8, val: 109 }, { op: 0, bits: 8, val: 45 }, { op: 0, bits: 9, val: 186 }, { op: 0, bits: 8, val: 13 }, { op: 0, bits: 8, val: 141 }, { op: 0, bits: 8, val: 77 }, { op: 0, bits: 9, val: 250 }, { op: 16, bits: 7, val: 3 }, { op: 0, bits: 8, val: 83 }, { op: 0, bits: 8, val: 19 }, { op: 21, bits: 8, val: 195 }, { op: 19, bits: 7, val: 35 }, { op: 0, bits: 8, val: 115 }, { op: 0, bits: 8, val: 51 }, { op: 0, bits: 9, val: 198 }, { op: 17, bits: 7, val: 11 }, { op: 0, bits: 8, val: 99 }, { op: 0, bits: 8, val: 35 }, { op: 0, bits: 9, val: 166 }, { op: 0, bits: 8, val: 3 }, { op: 0, bits: 8, val: 131 }, { op: 0, bits: 8, val: 67 }, { op: 0, bits: 9, val: 230 }, { op: 16, bits: 7, val: 7 }, { op: 0, bits: 8, val: 91 }, { op: 0, bits: 8, val: 27 }, { op: 0, bits: 9, val: 150 }, { op: 20, bits: 7, val: 67 }, { op: 0, bits: 8, val: 123 }, { op: 0, bits: 8, val: 59 }, { op: 0, bits: 9, val: 214 }, { op: 18, bits: 7, val: 19 }, { op: 0, bits: 8, val: 107 }, { op: 0, bits: 8, val: 43 }, { op: 0, bits: 9, val: 182 }, { op: 0, bits: 8, val: 11 }, { op: 0, bits: 8, val: 139 }, { op: 0, bits: 8, val: 75 }, { op: 0, bits: 9, val: 246 }, { op: 16, bits: 7, val: 5 }, { op: 0, bits: 8, val: 87 }, { op: 0, bits: 8, val: 23 }, { op: 64, bits: 8, val: 0 }, { op: 19, bits: 7, val: 51 }, { op: 0, bits: 8, val: 119 }, { op: 0, bits: 8, val: 55 }, { op: 0, bits: 9, val: 206 }, { op: 17, bits: 7, val: 15 }, { op: 0, bits: 8, val: 103 }, { op: 0, bits: 8, val: 39 }, { op: 0, bits: 9, val: 174 }, { op: 0, bits: 8, val: 7 }, { op: 0, bits: 8, val: 135 }, { op: 0, bits: 8, val: 71 }, { op: 0, bits: 9, val: 238 }, { op: 16, bits: 7, val: 9 }, { op: 0, bits: 8, val: 95 }, { op: 0, bits: 8, val: 31 }, { op: 0, bits: 9, val: 158 }, { op: 20, bits: 7, val: 99 }, { op: 0, bits: 8, val: 127 }, { op: 0, bits: 8, val: 63 }, { op: 0, bits: 9, val: 222 }, { op: 18, bits: 7, val: 27 }, { op: 0, bits: 8, val: 111 }, { op: 0, bits: 8, val: 47 }, { op: 0, bits: 9, val: 190 }, { op: 0, bits: 8, val: 15 }, { op: 0, bits: 8, val: 143 }, { op: 0, bits: 8, val: 79 }, { op: 0, bits: 9, val: 254 }, { op: 96, bits: 7, val: 0 }, { op: 0, bits: 8, val: 80 }, { op: 0, bits: 8, val: 16 }, { op: 20, bits: 8, val: 115 }, { op: 18, bits: 7, val: 31 }, { op: 0, bits: 8, val: 112 }, { op: 0, bits: 8, val: 48 }, { op: 0, bits: 9, val: 193 }, { op: 16, bits: 7, val: 10 }, { op: 0, bits: 8, val: 96 }, { op: 0, bits: 8, val: 32 }, { op: 0, bits: 9, val: 161 }, { op: 0, bits: 8, val: 0 }, { op: 0, bits: 8, val: 128 }, { op: 0, bits: 8, val: 64 }, { op: 0, bits: 9, val: 225 }, { op: 16, bits: 7, val: 6 }, { op: 0, bits: 8, val: 88 }, { op: 0, bits: 8, val: 24 }, { op: 0, bits: 9, val: 145 }, { op: 19, bits: 7, val: 59 }, { op: 0, bits: 8, val: 120 }, { op: 0, bits: 8, val: 56 }, { op: 0, bits: 9, val: 209 }, { op: 17, bits: 7, val: 17 }, { op: 0, bits: 8, val: 104 }, { op: 0, bits: 8, val: 40 }, { op: 0, bits: 9, val: 177 }, { op: 0, bits: 8, val: 8 }, { op: 0, bits: 8, val: 136 }, { op: 0, bits: 8, val: 72 }, { op: 0, bits: 9, val: 241 }, { op: 16, bits: 7, val: 4 }, { op: 0, bits: 8, val: 84 }, { op: 0, bits: 8, val: 20 }, { op: 21, bits: 8, val: 227 }, { op: 19, bits: 7, val: 43 }, { op: 0, bits: 8, val: 116 }, { op: 0, bits: 8, val: 52 }, { op: 0, bits: 9, val: 201 }, { op: 17, bits: 7, val: 13 }, { op: 0, bits: 8, val: 100 }, { op: 0, bits: 8, val: 36 }, { op: 0, bits: 9, val: 169 }, { op: 0, bits: 8, val: 4 }, { op: 0, bits: 8, val: 132 }, { op: 0, bits: 8, val: 68 }, { op: 0, bits: 9, val: 233 }, { op: 16, bits: 7, val: 8 }, { op: 0, bits: 8, val: 92 }, { op: 0, bits: 8, val: 28 }, { op: 0, bits: 9, val: 153 }, { op: 20, bits: 7, val: 83 }, { op: 0, bits: 8, val: 124 }, { op: 0, bits: 8, val: 60 }, { op: 0, bits: 9, val: 217 }, { op: 18, bits: 7, val: 23 }, { op: 0, bits: 8, val: 108 }, { op: 0, bits: 8, val: 44 }, { op: 0, bits: 9, val: 185 }, { op: 0, bits: 8, val: 12 }, { op: 0, bits: 8, val: 140 }, { op: 0, bits: 8, val: 76 }, { op: 0, bits: 9, val: 249 }, { op: 16, bits: 7, val: 3 }, { op: 0, bits: 8, val: 82 }, { op: 0, bits: 8, val: 18 }, { op: 21, bits: 8, val: 163 }, { op: 19, bits: 7, val: 35 }, { op: 0, bits: 8, val: 114 }, { op: 0, bits: 8, val: 50 }, { op: 0, bits: 9, val: 197 }, { op: 17, bits: 7, val: 11 }, { op: 0, bits: 8, val: 98 }, { op: 0, bits: 8, val: 34 }, { op: 0, bits: 9, val: 165 }, { op: 0, bits: 8, val: 2 }, { op: 0, bits: 8, val: 130 }, { op: 0, bits: 8, val: 66 }, { op: 0, bits: 9, val: 229 }, { op: 16, bits: 7, val: 7 }, { op: 0, bits: 8, val: 90 }, { op: 0, bits: 8, val: 26 }, { op: 0, bits: 9, val: 149 }, { op: 20, bits: 7, val: 67 }, { op: 0, bits: 8, val: 122 }, { op: 0, bits: 8, val: 58 },{ op: 0, bits: 9, val: 213 }, { op: 18, bits: 7, val: 19 }, { op: 0, bits: 8, val: 106 }, { op: 0, bits: 8, val: 42 }, { op: 0, bits: 9, val: 181 }, { op: 0, bits: 8, val: 10 }, { op: 0, bits: 8, val: 138 },{ op: 0, bits: 8, val: 74 }, { op: 0, bits: 9, val: 245 }, { op: 16, bits: 7, val: 5 }, { op: 0, bits: 8, val: 86 }, { op: 0, bits: 8, val: 22 }, { op: 64, bits: 8, val: 0 }, { op: 19, bits: 7, val: 51 },{ op: 0, bits: 8, val: 118 }, { op: 0, bits: 8, val: 54 }, { op: 0, bits: 9, val: 205 }, { op: 17, bits: 7, val: 15 }, { op: 0, bits: 8, val: 102 }, { op: 0, bits: 8, val: 38 }, { op: 0, bits: 9, val: 173 },{ op: 0, bits: 8, val: 6 }, { op: 0, bits: 8, val: 134 }, { op: 0, bits: 8, val: 70 }, { op: 0, bits: 9, val: 237 }, { op: 16, bits: 7, val: 9 }, { op: 0, bits: 8, val: 94 }, { op: 0, bits: 8, val: 30 },{ op: 0, bits: 9, val: 157 }, { op: 20, bits: 7, val: 99 }, { op: 0, bits: 8, val: 126 }, { op: 0, bits: 8, val: 62 }, { op: 0, bits: 9, val: 221 }, { op: 18, bits: 7, val: 27 }, { op: 0, bits: 8, val: 110 }, { op: 0, bits: 8, val: 46 }, { op: 0, bits: 9, val: 189 }, { op: 0, bits: 8, val: 14 }, { op: 0, bits: 8, val: 142 }, { op: 0, bits: 8, val: 78 }, { op: 0, bits: 9, val: 253 }, { op: 96, bits: 7, val: 0 }, { op: 0, bits: 8, val: 81 }, { op: 0, bits: 8, val: 17 }, { op: 21, bits: 8, val: 131 }, { op: 18, bits: 7, val: 31 }, { op: 0, bits: 8, val: 113 }, { op: 0, bits: 8, val: 49 }, { op: 0, bits: 9, val: 195 }, { op: 16, bits: 7, val: 10 }, { op: 0, bits: 8, val: 97 }, { op: 0, bits: 8, val: 33 }, { op: 0, bits: 9, val: 163 }, { op: 0, bits: 8, val: 1 }, { op: 0, bits: 8, val: 129 }, { op: 0, bits: 8, val: 65 }, { op: 0, bits: 9, val: 227 }, { op: 16, bits: 7, val: 6 }, { op: 0, bits: 8, val: 89 }, { op: 0, bits: 8, val: 25 }, { op: 0, bits: 9, val: 147 }, { op: 19, bits: 7, val: 59 }, { op: 0, bits: 8, val: 121 }, { op: 0, bits: 8, val: 57 }, { op: 0, bits: 9, val: 211 }, { op: 17, bits: 7, val: 17 }, { op: 0, bits: 8, val: 105 }, { op: 0, bits: 8, val: 41 }, { op: 0, bits: 9, val: 179 }, { op: 0, bits: 8, val: 9 },{ op: 0, bits: 8, val: 137 }, { op: 0, bits: 8, val: 73 }, { op: 0, bits: 9, val: 243 }, { op: 16, bits: 7, val: 4 }, { op: 0, bits: 8, val: 85 }, { op: 0, bits: 8, val: 21 }, { op: 16, bits: 8, val: 258 },{ op: 19, bits: 7, val: 43 }, { op: 0, bits: 8, val: 117 }, { op: 0, bits: 8, val: 53 }, { op: 0, bits: 9, val: 203 }, { op: 17, bits: 7, val: 13 }, { op: 0, bits: 8, val: 101 }, { op: 0, bits: 8, val: 37 },{ op: 0, bits: 9, val: 171 }, { op: 0, bits: 8, val: 5 }, { op: 0, bits: 8, val: 133 }, { op: 0, bits: 8, val: 69 }, { op: 0, bits: 9, val: 235 }, { op: 16, bits: 7, val: 8 }, { op: 0, bits: 8, val: 93 },{ op: 0, bits: 8, val: 29 }, { op: 0, bits: 9, val: 155 }, { op: 20, bits: 7, val: 83 }, { op: 0, bits: 8, val: 125 }, { op: 0, bits: 8, val: 61 }, { op: 0, bits: 9, val: 219 }, { op: 18, bits: 7, val: 23 },{ op: 0, bits: 8, val: 109 }, { op: 0, bits: 8, val: 45 }, { op: 0, bits: 9, val: 187 }, { op: 0, bits: 8, val: 13 }, { op: 0, bits: 8, val: 141 }, { op: 0, bits: 8, val: 77 }, { op: 0, bits: 9, val: 251 }, { op: 16, bits: 7, val: 3 }, { op: 0, bits: 8, val: 83 }, { op: 0, bits: 8, val: 19 }, { op: 21, bits: 8, val: 195 }, { op: 19, bits: 7, val: 35 }, { op: 0, bits: 8, val: 115 }, { op: 0, bits: 8, val: 51 }, { op: 0, bits: 9, val: 199 }, { op: 17, bits: 7, val: 11 }, { op: 0, bits: 8, val: 99 }, { op: 0, bits: 8, val: 35 }, { op: 0, bits: 9, val: 167 }, { op: 0, bits: 8, val: 3 }, { op: 0, bits: 8, val: 131 }, { op: 0, bits: 8, val: 67 }, { op: 0, bits: 9, val: 231 }, { op: 16, bits: 7, val: 7 }, { op: 0, bits: 8, val: 91 }, { op: 0, bits: 8, val: 27 }, { op: 0, bits: 9, val: 151 }, { op: 20, bits: 7, val: 67 }, { op: 0, bits: 8, val: 123 }, { op: 0, bits: 8, val: 59 }, { op: 0, bits: 9, val: 215 }, { op: 18, bits: 7, val: 19 }, { op: 0, bits: 8, val: 107 }, { op: 0, bits: 8, val: 43 }, { op: 0, bits: 9, val: 183 }, { op: 0, bits: 8, val: 11 }, { op: 0, bits: 8, val: 139 }, { op: 0, bits: 8, val: 75 }, { op: 0, bits: 9, val: 247 }, { op: 16, bits: 7, val: 5 }, { op: 0, bits: 8, val: 87 }, { op: 0, bits: 8, val: 23 }, { op: 64, bits: 8, val: 0 }, { op: 19, bits: 7, val: 51 }, { op: 0, bits: 8, val: 119 }, { op: 0, bits: 8, val: 55 }, { op: 0, bits: 9, val: 207 }, { op: 17, bits: 7, val: 15 }, { op: 0, bits: 8, val: 103 }, { op: 0, bits: 8, val: 39 }, { op: 0, bits: 9, val: 175 }, { op: 0, bits: 8, val: 7 }, { op: 0, bits: 8, val: 135 }, { op: 0, bits: 8, val: 71 }, { op: 0, bits: 9, val: 239 }, { op: 16, bits: 7, val: 9 }, { op: 0, bits: 8, val: 95 }, { op: 0, bits: 8, val: 31 }, { op: 0, bits: 9, val: 159 }, { op: 20, bits: 7, val: 99 }, { op: 0, bits: 8, val: 127 }, { op: 0, bits: 8, val: 63 }, { op: 0, bits: 9, val: 223 }, { op: 18, bits: 7, val: 27 }, { op: 0, bits: 8, val: 111 }, { op: 0, bits: 8, val: 47 }, { op: 0, bits: 9, val: 191 }, { op: 0, bits: 8, val: 15 }, { op: 0, bits: 8, val: 143 }, { op: 0, bits: 8, val: 79 }, { op: 0, bits: 9, val: 255 } ];
    if (!distfix_ary) distfix_ary = [ { op: 16, bits: 5, val: 1 }, { op: 23, bits: 5, val: 257 }, { op: 19, bits: 5, val: 17 }, { op: 27, bits: 5, val: 4097 }, { op: 17, bits: 5, val: 5 }, { op: 25, bits: 5, val: 1025 }, { op: 21, bits: 5, val: 65 }, { op: 29, bits: 5, val: 16385 }, { op: 16, bits: 5, val: 3 }, { op: 24, bits: 5, val: 513 }, { op: 20, bits: 5, val: 33 }, { op: 28, bits: 5, val: 8193 }, { op: 18, bits: 5, val: 9 }, { op: 26, bits: 5, val: 2049 }, { op: 22, bits: 5, val: 129 }, { op: 64, bits: 5, val: 0 }, { op: 16, bits: 5, val: 2 }, { op: 23, bits: 5, val: 385 }, { op: 19, bits: 5, val: 25 }, { op: 27, bits: 5, val: 6145 }, { op: 17, bits: 5, val: 7 }, { op: 25, bits: 5, val: 1537 }, { op: 21, bits: 5, val: 97 }, { op: 29, bits: 5, val: 24577 }, { op: 16, bits: 5, val: 4 }, { op: 24, bits: 5, val: 769 }, { op: 20, bits: 5, val: 49 }, { op: 28, bits: 5, val: 12289 }, { op: 18, bits: 5, val: 13 }, { op: 26, bits: 5, val: 3073 }, { op: 22, bits: 5, val: 193 }, { op: 64, bits: 5, val: 0 } ];
    state.lencode = 0;
    state.distcode = 512;
    for (i = 0; i < 512; i++) { state.codes[i] = lenfix_ary[i]; }
    for (i = 0; i < 32; i++) { state.codes[i + 512] = distfix_ary[i]; }
    state.lenbits = 9;
    state.distbits = 5;
}

/*
  Update the window with the last wsize (normally 32K) bytes written before
  returning.  If window does not exist yet, create it.  This is only called
  when a window is already in use, or when output has been written during this
  inflate call, but the end of the deflate stream has not been reached yet.
  It is also called to create a window for dictionary data when a dictionary
  is loaded.

  Providing output buffers larger than 32K to inflate() should provide a speed
  advantage, since only the last 32K of output is copied to the sliding window
  upon return from inflate(), and since all distances after the first 32K of
  output will fall in the output data, making match copies simpler and faster.
  The advantage may be dependent on the size of the processor's data caches.
*/
function updatewindow(strm)
{
    var state = strm.state;
	var out = strm.output_data.length;

    /* if it hasn't been done already, allocate space for the window */
    if (state.window === null) {
        state.window = '';
	}

    /* if window not in use yet, initialize */
    if (state.wsize == 0) {
        state.wsize = 1 << state.wbits;
	}

    // zlib.js: Sliding window
    if (out >= state.wsize) {
        state.window = strm.output_data.substring(out - state.wsize);
	} else {
		if(state.whave + out < state.wsize) {
			state.window += strm.output_data;
		} else {
			state.window = state.window.substring(state.whave - (state.wsize - out)) + strm.output_data;
		}
	}
    state.whave = state.window.length;
	if(state.whave < state.wsize) {
		state.wnext = state.whave;
	} else {
		state.wnext = 0;
	}
    return 0;
}


// #ifdef GUNZIP
function CRC2(strm, word)
{
	var hbuf = [word & 0xff, (word >>> 8) & 0xff];
	strm.state.check = strm.checksum_function(strm.state.check, hbuf, 0, 2);
}

function CRC4(strm, word)
{
	var hbuf = [word & 0xff,
				(word >>> 8) & 0xff,
				(word >>> 16) & 0xff,
				(word >>> 24) & 0xff];
	strm.state.check = strm.checksum_function(strm.state.check, hbuf, 0, 4);
}

/* Load registers with state in inflate() for speed */
function LOAD(strm, s)
{
    s.strm = strm;            /* z_stream */
    s.left = strm.avail_out;  /* available output */
    s.next = strm.next_in; /* next input */
    s.have = strm.avail_in;   /* available input */
    s.hold = strm.state.hold; /* bit buffer */
    s.bits = strm.state.bits; /* bits in bit buffer */
    return s;
}

/* Restore state from registers in inflate() */
function RESTORE(s)
{
    var strm = s.strm;
    strm.next_in = s.next;
    strm.avail_out = s.left;
    strm.avail_in = s.have;
    strm.state.hold = s.hold;
    strm.state.bits = s.bits;
}

/* Clear the input bit accumulator */
function INITBITS(s)
{
    s.hold = 0;
    s.bits = 0;
}

/* Get a byte of input into the bit accumulator, or return from inflate()
   if there is no input available. */
function PULLBYTE(s)
{
    if (s.have == 0) return false;
    s.have--;
    s.hold += (s.strm.input_data.charCodeAt(s.next++) & 0xff) << s.bits;
    s.bits += 8;
    return true;
}

/* Assure that there are at least n bits in the bit accumulator.  If there is
   not enough available input to do that, then return from inflate(). */
function NEEDBITS(s, n)
{
    // if(typeof n != 'number') throw 'ERROR';
    while (s.bits < n) {
        if(!PULLBYTE(s))
            return false;
    }
    return true;
}

/* Return the low n bits of the bit accumulator (n < 16) */
function BITS(s, n)
{
    return s.hold & ((1 << n) - 1);
}

/* Remove n bits from the bit accumulator */
function DROPBITS(s, n)
{
    // if(typeof n != 'number') throw 'ERROR';
    s.hold >>>= n;
    s.bits -= n;
}

/* Remove zero to seven bits as needed to go to a byte boundary */
function BYTEBITS(s)
{
    s.hold >>>= s.bits & 7;
    s.bits -= s.bits & 7;
}

/* Reverse the bytes in a 32-bit value */
function REVERSE(q)
{
    return ((q >>> 24) & 0xff) +
		((q >>> 8) & 0xff00) +
		((q & 0xff00) << 8) +
		((q & 0xff) << 24);
}

/*
   inflate() uses a state machine to process as much input data and generate as
   much output data as possible before returning.  The state machine is
   structured roughly as follows:

    for (;;) switch (state) {
    ...
    case STATEn:
        if (not enough input data or output space to make progress)
            return;
        ... make progress ...
        state = STATEm;
        break;
    ...
    }

   so when inflate() is called again, the same case is attempted again, and
   if the appropriate resources are provided, the machine proceeds to the
   next state.  The NEEDBITS() macro is usually the way the state evaluates
   whether it can proceed or should return.  NEEDBITS() does the return if
   the requested bits are not available.  The typical use of the BITS macros
   is:

        NEEDBITS(n);
        ... do something with BITS(n) ...
        DROPBITS(n);

   where NEEDBITS(n) either returns from inflate() if there isn't enough
   input left to load n bits into the accumulator, or it continues.  BITS(n)
   gives the low n bits in the accumulator.  When done, DROPBITS(n) drops
   the low n bits off the accumulator.  INITBITS() clears the accumulator
   and sets the number of available bits to zero.  BYTEBITS() discards just
   enough bits to put the accumulator on a byte boundary.  After BYTEBITS()
   and a NEEDBITS(8), then BITS(8) would return the next byte in the stream.

   NEEDBITS(n) uses PULLBYTE() to get an available byte of input, or to return
   if there is no input available.  The decoding of variable length codes uses
   PULLBYTE() directly in order to pull just enough bytes to decode the next
   code, and no more.

   Some states loop until they get enough input, making sure that enough
   state information is maintained to continue the loop where it left off
   if NEEDBITS() returns in the loop.  For example, want, need, and keep
   would all have to actually be part of the saved state in case NEEDBITS()
   returns:

    case STATEw:
        while (want < need) {
            NEEDBITS(n);
            keep[want++] = BITS(n);
            DROPBITS(n);
        }
        state = STATEx;
    case STATEx:

   As shown above, if the next state is also the next case, then the break
   is omitted.

   A state may also return if there is not enough output space available to
   complete that state.  Those states are copying stored data, writing a
   literal byte, and copying a matching string.

   When returning, a "goto inf_leave" is used to update the total counters,
   update the check value, and determine whether any progress has been made
   during that inflate() call in order to return the proper return code.
   Progress is defined as a change in either strm->avail_in or strm->avail_out.
   When there is a window, goto inf_leave will update the window with the last
   output written.  If a goto inf_leave occurs in the middle of decompression
   and there is no window currently, goto inf_leave will create one and copy
   output to the window for the next call of inflate().

   In this implementation, the flush parameter of inflate() only affects the
   return code (per zlib.h).  inflate() always writes as much as possible to
   strm->next_out, given the space available and the provided input--the effect
   documented in zlib.h of Z_SYNC_FLUSH.  Furthermore, inflate() always defers
   the allocation of and copying into a sliding window until necessary, which
   provides the effect documented in zlib.h for Z_FINISH when the entire input
   stream available.  So the only thing the flush parameter actually does is:
   when flush is set to Z_FINISH, inflate() cannot return Z_OK.  Instead it
   will return Z_BUF_ERROR if it has not reached the end of the stream.
 */

/* permutation of code lengths */
var inflate_order = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
ZLIB.inflate = function(strm, flush)
{
    var state;
    var s;
    var _in, out;          /* save starting available input and output */
    var copy;              /* number of stored or match bytes to copy */
    var from_window_offset = -1; /* index of window[] */
    var from_out_offset = -1; /* index of next_out[] */
    var here;              /* current decoding table entry */
    var last;              /* parent table entry */
    var len;               /* length to copy for repeats, bits to drop */
    var ret;               /* return code */

    if (!strm || !strm.state ||
        (!strm.input_data && strm.avail_in != 0))
        return ZLIB.Z_STREAM_ERROR;

    state = strm.state;
    if (state.mode == TYPE) state.mode = TYPEDO;      /* skip check */

    // LOAD
    s = {};
    LOAD(strm, s);

    _in = s.have;
    out = s.left;
    ret = ZLIB.Z_OK;
inf_leave: for (;;) {
        switch (state.mode) {
        case HEAD:
            if (state.wrap == 0) {
                state.mode = TYPEDO;
                break;
            }
            if(!NEEDBITS(s, 16)) break inf_leave;
// #ifdef GUNZIP
            if ((state.wrap & 2) && s.hold == 0x8b1f) {  /* gzip header */
                state.check = strm.checksum_function(0, null, 0, 0);
                CRC2(strm, s.hold);
                INITBITS(s);
                state.mode = FLAGS;
                break;
            }
            state.flags = 0;           /* expect zlib header */
            if (state.head !== null)
                state.head.done = -1;
            if (!(state.wrap & 1) ||   /* check if zlib header allowed */
//#else
//          if (
//#endif
                ((BITS(s, 8) << 8) + (s.hold >>> 8)) % 31) {
                strm.msg = 'incorrect header check';
                state.mode = BAD;
                break;
            }
            if (BITS(s, 4) != ZLIB.Z_DEFLATED) {
                strm.msg = 'unknown compression method';
                state.mode = BAD;
                break;
            }

            DROPBITS(s, 4);
            len = BITS(s, 4) + 8;
            if (state.wbits == 0)
                state.wbits = len;
            else if (len > state.wbits) {
                strm.msg = 'invalid window size';
                state.mode = BAD;
                break;
            }
            state.dmax = 1 << len;
//            Tracev((stderr, "inflate:   zlib header ok\n"));
			strm.adler = state.check = strm.checksum_function(0, null, 0, 0);
            state.mode = s.hold & 0x200 ? DICTID : TYPE;
            INITBITS(s);
            break;
// #ifdef GUNZIP
        case FLAGS:
            if(!NEEDBITS(s, 16)) break inf_leave;
            state.flags = s.hold;
            if ((state.flags & 0xff) != ZLIB.Z_DEFLATED) {
                strm.msg = "unknown compression method";
                state.mode = BAD;
                break;
            }
            if (state.flags & 0xe000) {
                strm.msg = "unknown header flags set";
                state.mode = BAD;
                break;
            }
            if (state.head !== null)
                state.head.text = (s.hold >>> 8) & 1;
            if (state.flags & 0x0200) {
				CRC2(strm, s.hold);
			}
            INITBITS(s);
            state.mode = TIME;
        case TIME:
            if(!NEEDBITS(s, 32)) break inf_leave;
            if (state.head !== null)
                state.head.time = s.hold;
            if (state.flags & 0x0200) {
				CRC4(strm, s.hold);
			}
            INITBITS(s);
            state.mode = OS;
        case OS:
            if(!NEEDBITS(s, 16)) break inf_leave;
            if (state.head !== null) {
                state.head.xflags = s.hold & 0xff;
                state.head.os = s.hold >>> 8;
            }
            if (state.flags & 0x0200) {
				CRC2(strm, s.hold);
			}
            INITBITS(s);
            state.mode = EXLEN;
        case EXLEN:
            if (state.flags & 0x0400) {
                if(!NEEDBITS(s, 16)) break inf_leave;
                state.length = s.hold;
                if (state.head !== null) {
                    state.head.extra_len = s.hold;
				}
                if (state.flags & 0x0200) {
					CRC2(strm, s.hold);
				}
                INITBITS(s);
				state.head.extra = "";
            }
            else if (state.head !== null) {
                state.head.extra = null;
			}
            state.mode = EXTRA;
        case EXTRA:
            if (state.flags & 0x0400) {
                copy = state.length;
                if (copy > s.have) copy = s.have;
                if (copy) {
                    if (state.head !== null &&
                        state.head.extra !== null) {
                        len = state.head.extra_len - state.length;
/*
                        zmemcpy(state->head->extra + len, next,
                                len + copy > state->head->extra_max ?
                                state->head->extra_max - len : copy);
*/
						state.head.extra += strm.input_data.substring(
							s.next, s.next + (len + copy > state.head.extra_max ?
											  state.head.extra_max - len : copy));
						
                    }
                    if (state.flags & 0x0200)
                        state.check = strm.checksum_function(state.check, strm.input_data, s.next, copy);
                    s.have -= copy;
                    s.next += copy;
                    state.length -= copy;
                }
                if (state.length) break inf_leave;
            }
            state.length = 0;
            state.mode = NAME;
        case NAME:
            if (state.flags & 0x0800) {
                if (s.have == 0) break inf_leave;
				if (state.head !== null && state.head.name === null) {
					state.head.name = "";
				}
                copy = 0;
				// TODO end = strm.input_data.indexOf("\0", s.next);
				// TODO state.length => state.head.name.length
                do {
                    len = strm.input_data.charAt(s.next + copy); copy++;
					if(len === "\0")
						break;
                    if (state.head !== null &&
						state.length < state.head.name_max) {
                        state.head.name += len;
						state.length++;
					}
                } while (copy < s.have);
                if (state.flags & 0x0200) {
                    state.check = strm.checksum_function(state.check, strm.input_data, s.next, copy);
				}
                s.have -= copy;
                s.next += copy;
                if (len !== "\0") break inf_leave;
            }
            else if (state.head !== null)
                state.head.name = null;
            state.length = 0;
            state.mode = COMMENT;
        case COMMENT:
            if (state.flags & 0x1000) {
                if (s.have == 0) break inf_leave;
                copy = 0;
				if (state.head !== null && state.head.comment === null) {
					state.head.comment = "";
				}
				// TODO end = strm.input_data.indexOf("\0", s.next);
				// TODO state.length => state.head.comment.length
                do {
                    len = strm.input_data.charAt(s.next + copy); copy++;
					if(len === "\0")
						break;
                    if (state.head !== null &&
						state.length < state.head.comm_max) {
                        state.head.comment += len;
						state.length++;
					}
                } while (copy < s.have);
                if (state.flags & 0x0200)
                    state.check = strm.checksum_function(state.check, strm.input_data, s.next, copy);
                s.have -= copy;
                s.next += copy;
                if (len !== "\0") break inf_leave;
            }
            else if (state.head !== null)
                state.head.comment = null;
            state.mode = HCRC;
        case HCRC:
            if (state.flags & 0x0200) {
                if(!NEEDBITS(s, 16)) break inf_leave;
                if (s.hold != (state.check & 0xffff)) {
                    strm.msg = "header crc mismatch";
                    state.mode = BAD;
                    break;
                }
                INITBITS(s);
            }
            if (state.head !== null) {
                state.head.hcrc = (state.flags >>> 9) & 1;
                state.head.done = 1;
            }
            strm.adler = state.check = strm.checksum_function(0, null, 0, 0);
            state.mode = TYPE;
            break;
//#endif
        case DICTID:
            if(!NEEDBITS(s, 32)) break inf_leave;
            strm.adler = state.check = REVERSE(s.hold);
            INITBITS(s);
            state.mode = DICT;
        case DICT:
            if (state.havedict == 0) {
                RESTORE(s);
                return ZLIB.Z_NEED_DICT;
            }
			strm.adler = state.check = strm.checksum_function(0, null, 0, 0);
            state.mode = TYPE;
        case TYPE:
            if (flush == ZLIB.Z_BLOCK || flush == ZLIB.Z_TREES) break inf_leave;
        case TYPEDO:
            if (state.last) {
                BYTEBITS(s);
                state.mode = CHECK;
                break;
            }
            if(!NEEDBITS(s, 3)) break inf_leave;
            state.last = BITS(s, 1);
            DROPBITS(s, 1);
            switch (BITS(s, 2)) {
            case 0:                             /* stored block */
//                Tracev((stderr, "inflate:     stored block%s\n",
//                        state->last ? " (last)" : ""));
                state.mode = STORED;
                break;
            case 1:                             /* fixed block */
                fixedtables(state);
//                Tracev((stderr, "inflate:     fixed codes block%s\n",
//                        state->last ? " (last)" : ""));
                state.mode = LEN_;             /* decode codes */
                if (flush == ZLIB.Z_TREES) {
                    DROPBITS(s, 2);
                    break inf_leave;
                }
                break;
            case 2:                             /* dynamic block */
//                Tracev((stderr, "inflate:     dynamic codes block%s\n",
//                        state->last ? " (last)" : ""));
                state.mode = TABLE;
                break;
            case 3:
                strm.msg = 'invalid block type';
                state.mode = BAD;
            }
            DROPBITS(s, 2);
            break;
        case STORED:
            BYTEBITS(s);                         /* go to byte boundary */
            if(!NEEDBITS(s, 32)) break inf_leave;
            if ((s.hold & 0xffff) != (((s.hold >>> 16) & 0xffff) ^ 0xffff)) {
                strm.msg = 'invalid stored block lengths';
                state.mode = BAD;
                break;
            }
            state.length = s.hold & 0xffff;
//            Tracev((stderr, "inflate:       stored length %u\n",
//                    state->length));
            INITBITS(s);
            state.mode = COPY_;
            if (flush == ZLIB.Z_TREES) break inf_leave;
        case COPY_:
            state.mode = COPY;
        case COPY:
            copy = state.length;
            if (copy) {
                if (copy > s.have) copy = s.have;
                if (copy > s.left) copy = s.left;
                if (copy == 0) break inf_leave;
                strm.output_data += strm.input_data.substring(s.next, s.next + copy);
                strm.next_out += copy;
                s.have -= copy;
                s.next += copy;
                s.left -= copy;
                state.length -= copy;
                break;
            }
//            Tracev((stderr, "inflate:       stored end\n"));
            state.mode = TYPE;
            break;
        case TABLE:
            if(!NEEDBITS(s, 14)) break inf_leave;
            state.nlen = BITS(s, 5) + 257;
            DROPBITS(s, 5);
            state.ndist = BITS(s, 5) + 1;
            DROPBITS(s, 5);
            state.ncode = BITS(s, 4) + 4;
            DROPBITS(s, 4);
//#ifndef PKZIP_BUG_WORKAROUND
            if (state.nlen > 286 || state.ndist > 30) {
                strm.msg = 'too many length or distance symbols';
                state.mode = BAD;
                break;
            }
//#endif
//            Tracev((stderr, "inflate:       table sizes ok\n"));
            state.have = 0;
            state.mode = LENLENS;
        case LENLENS:
            while (state.have < state.ncode) {
                if(!NEEDBITS(s, 3)) break inf_leave;
                var tmp = BITS(s, 3);
                state.lens[inflate_order[state.have++]] = tmp;
                DROPBITS(s, 3);
            }
            while (state.have < 19)
                state.lens[inflate_order[state.have++]] = 0;
            state.next = 0;
            state.lencode = 0;
            state.lenbits = 7;

//            ret = inflate_table(CODES, state->lens, 19, &(state->next),
//                                &(state->lenbits), state->work);
            ret = inflate_table(state, CODES);

            if (ret) {
                strm.msg = 'invalid code lengths set';
                state.mode = BAD;
                break;
            }
//            Tracev((stderr, "inflate:       code lengths ok\n"));
            state.have = 0;
            state.mode = CODELENS;
        case CODELENS:
            while (state.have < state.nlen + state.ndist) {
                for (;;) {
                    here = state.codes[state.lencode + BITS(s, state.lenbits)];
                    if (here.bits <= s.bits) break;
                    if(!PULLBYTE(s)) break inf_leave;
                }
                if (here.val < 16) {
                    DROPBITS(s, here.bits);
                    state.lens[state.have++] = here.val;
                }
                else {
                    if (here.val == 16) {
                        if(!NEEDBITS(s, here.bits + 2)) break inf_leave;
                        DROPBITS(s, here.bits);
                        if (state.have == 0) {
                            strm.msg = 'invalid bit length repeat';
                            state.mode = BAD;
                            break;
                        }
                        len = state.lens[state.have - 1];
                        copy = 3 + BITS(s, 2);
                        DROPBITS(s, 2);
                    }
                    else if (here.val == 17) {
                        if(!NEEDBITS(s, here.bits + 3)) break inf_leave;
                        DROPBITS(s, here.bits);
                        len = 0;
                        copy = 3 + BITS(s, 3);
                        DROPBITS(s, 3);
                    }
                    else {
                        if(!NEEDBITS(s, here.bits + 7)) break inf_leave;
                        DROPBITS(s, here.bits);
                        len = 0;
                        copy = 11 + BITS(s, 7);
                        DROPBITS(s, 7);
                    }
                    if (state.have + copy > state.nlen + state.ndist) {
                        strm.msg = 'invalid bit length repeat';
                        state.mode = BAD;
                        break;
                    }
                    while (copy--)
                        state.lens[state.have++] = len;
                }
            }

            /* handle error breaks in while */
            if (state.mode == BAD) break;

            /* check for end-of-block code (better have one) */
            if (state.lens[256] == 0) {
                strm.msg = 'invalid code -- missing end-of-block';
                state.mode = BAD;
                break;
            }

            /* build code tables -- note: do not change the lenbits or distbits
               values here (9 and 6) without reading the comments in inftrees.h
               concerning the ENOUGH constants, which depend on those values */
            state.next = 0;
            state.lencode = state.next;
            state.lenbits = 9;
//            ret = inflate_table(LENS, state->lens, state->nlen, &(state->next),
//                                &(state->lenbits), state->work);
            ret = inflate_table(state, LENS);
            if (ret) {
                strm.msg = 'invalid literal/lengths set';
                state.mode = BAD;
                break;
            }
            state.distcode = state.next;
            state.distbits = 6;
//            ret = inflate_table(DISTS, state->lens + state->nlen, state->ndist, &(state->next),
//                                                                &(state->distbits), state->work);
            ret = inflate_table(state, DISTS);
            if (ret) {
                strm.msg = 'invalid distances set';
                state.mode = BAD;
                break;
            }
//            Tracev((stderr, "inflate:       codes ok\n"));
            state.mode = LEN_;
            if (flush == ZLIB.Z_TREES) break inf_leave;
        case LEN_:
            state.mode = LEN;
        case LEN:
            if (s.have >= 6 && s.left >= 258) {
                RESTORE(s);
                inflate_fast(strm, out);
                LOAD(strm, s);
                if (state.mode == TYPE)
                    state.back = -1;
                break;
            }
            state.back = 0;
            for (;;) {
                here = state.codes[state.lencode + BITS(s, state.lenbits)];
                if (here.bits <= s.bits) break;
                if(!PULLBYTE(s)) break inf_leave;
            }
            if (here.op && (here.op & 0xf0) == 0) {
                last = here;
                for (;;) {
                    here = state.codes[state.lencode + last.val +
                                       (BITS(s, last.bits + last.op) >>> last.bits)];
                    if (last.bits + here.bits <= s.bits) break;
                    if(!PULLBYTE(s)) break inf_leave;
                }
                DROPBITS(s, last.bits);
                state.back += last.bits;
            }
            DROPBITS(s, here.bits);
            state.back += here.bits;
            state.length = here.val;
            if (here.op == 0) {
//              Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
//                        "inflate:         literal '%c'\n" :
//                        "inflate:         literal 0x%02x\n", here.val));
                state.mode = LIT;
                break;
            }
            if (here.op & 32) {
//                Tracevv((stderr, "inflate:         end of block\n"));
                state.back = -1;
                state.mode = TYPE;
                break;
            }
            if (here.op & 64) {
                strm.msg = 'invalid literal/length code';
                state.mode = BAD;
                break;
            }
            state.extra = here.op & 15;
            state.mode = LENEXT;
        case LENEXT:
            if (state.extra) {
                if(!NEEDBITS(s, state.extra)) break inf_leave;
                state.length += BITS(s, state.extra);
                DROPBITS(s, state.extra);
                state.back += state.extra;
            }
            //Tracevv((stderr, "inflate:         length %u\n", state->length));
            state.was = state.length;
            state.mode = DIST;
        case DIST:
            for (;;) {
                here = state.codes[state.distcode + BITS(s, state.distbits)];
                if (here.bits <= s.bits) break;
                if(!PULLBYTE(s)) break inf_leave;
            }
            if ((here.op & 0xf0) == 0) {
                last = here;
                for (;;) {
                    here = state.codes[state.distcode + last.val +
                                       (BITS(s, last.bits + last.op) >>> last.bits)];
                    if ((last.bits + here.bits) <= s.bits) break;
                    if(!PULLBYTE(s)) break inf_leave;
                }
                DROPBITS(s, last.bits);
                state.back += last.bits;
            }
            DROPBITS(s, here.bits);
            state.back += here.bits;
            if (here.op & 64) {
                strm.msg = 'invalid distance code';
                state.mode = BAD;
                break;
            }
            state.offset = here.val;
            state.extra = here.op & 15;
            state.mode = DISTEXT;
        case DISTEXT:
            if (state.extra) {
                if(!NEEDBITS(s, state.extra)) break inf_leave;
                state.offset += BITS(s, state.extra);
                DROPBITS(s, state.extra);
                state.back += state.extra;
            }
//NOSPRT #ifdef INFLATE_STRICT
//            if (state->offset > state->dmax) {
//                strm->msg = (char *)"invalid distance too far back";
//                state->mode = BAD;
//                break;
//            }
//#endif
//            Tracevv((stderr, "inflate:         distance %u\n", state->offset));
            state.mode = MATCH;
        case MATCH:
            if (s.left == 0) break inf_leave;
            copy = out - s.left;
            if (state.offset > copy) {         /* copy from window */
                copy = state.offset - copy;
                if (copy > state.whave) {
                    if (state.sane) {
                        strm.msg = 'invalid distance too far back';
                        state.mode = BAD;
                        break;
                    }
//NOSPRT #ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//                    Trace((stderr, "inflate.c too far\n"));
//                    copy -= state->whave;
//                    if (copy > state->length) copy = state->length;
//                    if (copy > left) copy = left;
//                    left -= copy;
//                    state->length -= copy;
//                    do {
//                        *put++ = 0;
//                    } while (--copy);
//                    if (state->length == 0) state->mode = LEN;
//                    break;
//#endif
                }
                if (copy > state.wnext) {
                    copy -= state.wnext;
                    // from = state->window + (state->wsize - copy);
                    from_window_offset = state.wsize - copy;
                    from_out_offset = -1;
                }
                else {
                    // from = state->window + (state->wnext - copy);
                    from_window_offset = state.wnext - copy;
                    from_out_offset = -1;
                }
                if (copy > state.length) copy = state.length;
            }
            else {                              /* copy from output */
                // from = put - state->offset;
                from_window_offset = -1;
                from_out_offset = strm.next_out - state.offset;
                copy = state.length;
            }
            if (copy > s.left) copy = s.left;
            s.left -= copy;
            state.length -= copy;
            if( from_window_offset >= 0 ) {
                strm.output_data += state.window.substring(from_window_offset, from_window_offset + copy);
                strm.next_out += copy;
                copy = 0;
            } else {
                strm.next_out += copy;
                do {
                    strm.output_data += strm.output_data.charAt(from_out_offset++);
                } while (--copy);
            }
            if (state.length == 0) state.mode = LEN;
            break;
        case LIT:
            if (s.left == 0) break inf_leave;

            strm.output_data += String.fromCharCode(state.length);
            strm.next_out++;
            //*put++ = (unsigned char)(state->length);

            s.left--;
            state.mode = LEN;
            break;
        case CHECK:
            if (state.wrap) {
                if(!NEEDBITS(s, 32)) break inf_leave;
                out -= s.left;
                strm.total_out += out;
                state.total += out;
                if (out)
                    strm.adler = state.check =
                        strm.checksum_function(state.check, strm.output_data, strm.output_data.length - out, out);
                out = s.left;
                if ((
// #ifdef GUNZIP
                     state.flags ? s.hold :
//#endif
                     REVERSE(s.hold)) != state.check) {
                    strm.msg = "incorrect data check";
                    state.mode = BAD;
                    break;
                }
                INITBITS(s);
//debug("## inflate:   check matches trailer\n");
//                Tracev((stderr, "inflate:   check matches trailer\n"));
            }
//#ifdef GUNZIP
            state.mode = LENGTH;
        case LENGTH:
            if (state.wrap && state.flags) {
                if(!NEEDBITS(s, 32)) break inf_leave;
                if (s.hold != (state.total & 0xffffffff)) {
                    strm.msg = 'incorrect length check';
                    state.mode = BAD;
                    break;
                }
                INITBITS(s);
                //Tracev((stderr, "inflate:   length matches trailer\n"));
            }
//#endif
            state.mode = DONE;
        case DONE:
            ret = ZLIB.Z_STREAM_END;
            break inf_leave;
        case BAD:
            ret = ZLIB.Z_DATA_ERROR;
            break inf_leave;
        case MEM:
            return ZLIB.Z_MEM_ERROR;
        case SYNC:
        default:
            return ZLIB.Z_STREAM_ERROR;
        } }

    /*
      Return from inflate(), updating the total counts and the check value.
      If there was no progress during the inflate() call, return a buffer
      error.  Call updatewindow() to create and/or update the window state.
      Note: a memory error from inflate() is non-recoverable.
    */
inf_leave:
    RESTORE(s);
    if (state.wsize || (out != strm.avail_out && state.mode < BAD &&
                        (state.mode < CHECK || flush != ZLIB.Z_FINISH)))
        if (updatewindow(strm)) {
            state.mode = MEM;
            return ZLIB.Z_MEM_ERROR;
        }
    _in -= strm.avail_in;
    out -= strm.avail_out;
    strm.total_in += _in;
    strm.total_out += out;
    state.total += out;
    if (state.wrap && out)
	    strm.adler = state.check = strm.checksum_function(state.check, strm.output_data, 0, strm.output_data.length);
    strm.data_type = state.bits + (state.last ? 64 : 0) +
	    (state.mode == TYPE ? 128 : 0) +
	    (state.mode == LEN_ || state.mode == COPY_ ? 256 : 0);
    if (((_in == 0 && out == 0) || flush == ZLIB.Z_FINISH) && ret == ZLIB.Z_OK)
        ret = ZLIB.Z_BUF_ERROR;
    return ret;
};

ZLIB.inflateEnd = function(strm)
{
    var state;
    if (!strm || !strm.state )
        return ZLIB.Z_STREAM_ERROR;
    state = strm.state;
    state.window = null;
    strm.state = null;
    //    Tracev((stderr, "inflate: end\n"));
    return ZLIB.Z_OK;
};

ZLIB.z_stream.prototype.inflate = function(input_string, opts)
{
    var flush;
    var avail_out;
	var DEFAULT_BUFFER_SIZE = 16384;

    this.input_data = input_string;
    this.next_in = getarg(opts, 'next_in', 0);
    this.avail_in = getarg(opts, 'avail_in', input_string.length - this.next_in);

    flush = getarg(opts, 'flush', ZLIB.Z_SYNC_FLUSH);
    avail_out = getarg(opts, 'avail_out', -1);

    var result = '';
    do {
        this.avail_out = (avail_out >= 0 ? avail_out : DEFAULT_BUFFER_SIZE);
        this.output_data = '';
        this.next_out = 0;
        this.error = ZLIB.inflate(this, flush);
        if(avail_out >= 0) {
            return this.output_data;
        }
        result += this.output_data;
		if(this.avail_out > 0) {
			break;
		}
    } while(this.error == ZLIB.Z_OK);

    return result;
};

ZLIB.z_stream.prototype.inflateReset = function(windowBits)
{
    return ZLIB.inflateReset(this, windowBits);
};

}());
