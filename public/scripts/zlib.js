/* zlib.js -- JavaScript implementation for the zlib.
  Version: 0.2.0
  LastModified: Apr 12 2012
  Copyright (C) 2012 Masanao Izumo <iz@onicos.co.jp>

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

var ZLIB = ( ZLIB || {} ); // ZLIB namespace initialization

// common definitions
if(typeof ZLIB.common_initialized === 'undefined') {
    ZLIB.Z_NO_FLUSH      = 0;
    ZLIB.Z_PARTIAL_FLUSH = 1;
    ZLIB.Z_SYNC_FLUSH    = 2;
    ZLIB.Z_FULL_FLUSH    = 3;
    ZLIB.Z_FINISH        = 4;
    ZLIB.Z_BLOCK         = 5;
    ZLIB.Z_TREES         = 6;
    /* Allowed flush values; see deflate() and inflate() below for details */

    ZLIB.Z_OK           =  0;
    ZLIB.Z_STREAM_END   =  1;
    ZLIB.Z_NEED_DICT    =  2;
    ZLIB.Z_ERRNO        = (-1);
    ZLIB.Z_STREAM_ERROR = (-2);
    ZLIB.Z_DATA_ERROR   = (-3);
    ZLIB.Z_MEM_ERROR    = (-4);
    ZLIB.Z_BUF_ERROR    = (-5);
    ZLIB.Z_VERSION_ERROR = (-6);
    /* Return codes for the compression/decompression functions. Negative values
     * are errors, positive values are used for special but normal events.
     */

    ZLIB.Z_DEFLATED = 8; /* The deflate compression method (the only one supported in this version) */

    /**
	 * z_stream constructor
	 * @constructor
	 */
	ZLIB.z_stream = function() {
			this.next_in = 0;        /* next input byte */
			this.avail_in = 0;       /* number of bytes available in input_data */
			this.total_in = 0;       /* total number of input bytes read so far */

			this.next_out = 0;       /* next output byte */
			this.avail_out = 0;      /* remaining free space at next_out */
			this.total_out = 0;      /* total number of bytes output so far */

			this.msg = null;         /* last error message, null if no error */
			this.state = null;       /* not visible by applications */

			this.data_type = 0;      /* best guess about the data type: binary or text */
			this.adler = 0;          /* TODO: adler32 value of the uncompressed data */

			// zlib.js
			this.input_data = '';    /* input data */
			this.output_data = '';   /* output data */
			this.error = 0;          /* error code */
			this.checksum_function = null; /* crc32(for gzip) or adler32(for zlib) */
	};

    /**
	 * TODO
	 * @constructor
	 */
	ZLIB.gz_header = function() {
		this.text = 0;      /* true if compressed data believed to be text */
	    this.time = 0;      /* modification time */
		this.xflags = 0;    /* extra flags (not used when writing a gzip file) */
		this.os = 0xff;     /* operating system */
		this.extra = null;  /* extra field string or null if none */
		this.extra_len = 0; /* this.extra.length (only when reading header) */
		this.extra_max = 0; /* space at extra (only when reading header) */
		this.name = null;   /* file name string or null if none */
		this.name_max = 0;  /* space at name (only when reading header) */
		this.comment = null; /* comment string or null if none */
		this.comm_max = 0;  /* space at comment (only when reading header) */
		this.hcrc = 0;      /* true if there was or will be a header crc */
		this.done = 0;      /* true when done reading gzip header (not used
							   when writing a gzip file) */
	};

	ZLIB.common_initialized = true;
} // common definitions
