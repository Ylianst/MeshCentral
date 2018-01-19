/* zlib-adler32.js -- JavaScript implementation for the zlib adler32.
  Version: 0.2.0
  LastModified: Apr 12 2012
  Copyright (C) 2012 Masanao Izumo <iz@onicos.co.jp>

                       API documentation
==============================================================================
Usage: adler = ZLIB.adler32(adler, buf, offset, len);

     Update a running Adler-32 checksum with the bytes buf[offset..offset+len-1] and
   return the updated checksum.  If buf is null, this function returns the
   required initial value for the checksum.

     An Adler-32 checksum is almost as reliable as a CRC32 but can be computed
   much faster.

   Usage example:

     var adler = ZLIB.adler32(0, null, 0, 0);

     while (read_buffer(buffer, length) != EOF) {
       adler = ZLIB.adler32(adler, buffer, 0, length);
     }
     if (adler != original_adler) error();

==============================================================================
Usage: adler = ZLIB.adler32_combine(adler1, adler2, len2);

     Combine two Adler-32 checksums into one.  For two sequences of bytes, seq1
   and seq2 with lengths len1 and len2, Adler-32 checksums were calculated for
   each, adler1 and adler2.  adler32_combine() returns the Adler-32 checksum of
   seq1 and seq2 concatenated, requiring only adler1, adler2, and len2.  Note
   that the z_off_t type (like off_t) is a signed integer.  If len2 is
   negative, the result has no meaning or utility.
*/

if( typeof ZLIB === 'undefined' ) {
    alert('ZLIB is not defined.  SRC zlib.js before zlib-adler32.js')
}

(function() {

/* adler32.c -- compute the Adler-32 checksum of a data stream
 * Copyright (C) 1995-2011 Mark Adler
 * For conditions of distribution and use, see copyright notice in zlib.h
 */

var BASE = 65521;      /* largest prime smaller than 65536 */
var NMAX =  5552;
/* NMAX is the largest n such that 255n(n+1)/2 + (n+1)(BASE-1) <= 2^32-1 */

/* ========================================================================= */
function adler32_string(adler, buf, offset, len)
{
    var sum2;
    var n;

    /* split Adler-32 into component sums */
    sum2 = (adler >>> 16) & 0xffff;
    adler &= 0xffff;

    /* in case user likes doing a byte at a time, keep it fast */
    if (len == 1) {
		adler += buf.charCodeAt(offset) & 0xff;
        if (adler >= BASE)
            adler -= BASE;
        sum2 += adler;
        if (sum2 >= BASE)
            sum2 -= BASE;
        return adler | (sum2 << 16);
    }

    /* initial Adler-32 value (deferred check for len == 1 speed) */
    if (buf === null)
        return 1;

    /* in case short lengths are provided, keep it somewhat fast */
    if (len < 16) {
        while (len--) {
            adler += buf.charCodeAt(offset++) & 0xff;
            sum2 += adler;
        }
        if (adler >= BASE)
            adler -= BASE;
		sum2 %= BASE;           /* only added so many BASE's */
        return adler | (sum2 << 16);
    }

    /* do length NMAX blocks -- requires just one modulo operation */
    while (len >= NMAX) {
        len -= NMAX;
        n = NMAX >> 4;          /* NMAX is divisible by 16 */
        do {
			/* 16 sums unrolled */
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
        } while (--n);
        adler %= BASE;
        sum2 %= BASE;
    }

    /* do remaining bytes (less than NMAX, still just one modulo) */
    if (len) {                  /* avoid modulos if none remaining */
        while (len >= 16) {
            len -= 16;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
        }
        while (len--) {
            adler += buf.charCodeAt(offset++) & 0xff; sum2 += adler;
        }
        adler %= BASE;
        sum2 %= BASE;
    }

    /* return recombined sums */
    return adler | (sum2 << 16);
}

/* ========================================================================= */
function adler32_array(adler, buf, offset, len)
{
    var sum2;
    var n;

    /* split Adler-32 into component sums */
    sum2 = (adler >>> 16) & 0xffff;
    adler &= 0xffff;

    /* in case user likes doing a byte at a time, keep it fast */
    if (len == 1) {
		adler += buf[offset];
        if (adler >= BASE)
            adler -= BASE;
        sum2 += adler;
        if (sum2 >= BASE)
            sum2 -= BASE;
        return adler | (sum2 << 16);
    }

    /* initial Adler-32 value (deferred check for len == 1 speed) */
    if (buf === null)
        return 1;

    /* in case short lengths are provided, keep it somewhat fast */
    if (len < 16) {
        while (len--) {
            adler += buf[offset++];
            sum2 += adler;
        }
        if (adler >= BASE)
            adler -= BASE;
		sum2 %= BASE;           /* only added so many BASE's */
        return adler | (sum2 << 16);
    }

    /* do length NMAX blocks -- requires just one modulo operation */
    while (len >= NMAX) {
        len -= NMAX;
        n = NMAX >> 4;          /* NMAX is divisible by 16 */
        do {
			/* 16 sums unrolled */
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
        } while (--n);
        adler %= BASE;
        sum2 %= BASE;
    }

    /* do remaining bytes (less than NMAX, still just one modulo) */
    if (len) {                  /* avoid modulos if none remaining */
        while (len >= 16) {
            len -= 16;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
            adler += buf[offset++]; sum2 += adler;
        }
        while (len--) {
            adler += buf[offset++]; sum2 += adler;
        }
        adler %= BASE;
        sum2 %= BASE;
    }

    /* return recombined sums */
    return adler | (sum2 << 16);
}

/* ========================================================================= */
ZLIB.adler32 = function(adler, buf, offset, len)
{
	if(typeof buf === 'string') {
		return adler32_string(adler, buf, offset, len);
	} else {
		return adler32_array(adler, buf, offset, len);
	}
};

ZLIB.adler32_combine = function(adler1, adler2, len2)
{
    var sum1;
    var sum2;
    var rem;

    /* for negative len, return invalid adler32 as a clue for debugging */
    if (len2 < 0)
        return 0xffffffff;

    /* the derivation of this formula is left as an exercise for the reader */
    len2 %= BASE;                /* assumes len2 >= 0 */
    rem = len2;
    sum1 = adler1 & 0xffff;
    sum2 = rem * sum1;
    sum2 %= BASE;
    sum1 += (adler2 & 0xffff) + BASE - 1;
    sum2 += ((adler1 >> 16) & 0xffff) + ((adler2 >> 16) & 0xffff) + BASE - rem;
    if (sum1 >= BASE) sum1 -= BASE;
    if (sum1 >= BASE) sum1 -= BASE;
    if (sum2 >= (BASE << 1)) sum2 -= (BASE << 1);
    if (sum2 >= BASE) sum2 -= BASE;
    return sum1 | (sum2 << 16);
}

}());
