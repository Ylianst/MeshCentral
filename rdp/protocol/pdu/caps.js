/*
 * Copyright (c) 2014-2015 Sylvain Peyrefitte
 *
 * This file is part of node-rdpjs.
 *
 * node-rdpjs is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

var type = require('../../core').type;
var log = require('../../core').log;
var error = require('../../core').error;

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240486.aspx
 */
var CapsType = {
	CAPSTYPE_GENERAL : 0x0001,
	CAPSTYPE_BITMAP : 0x0002,
	CAPSTYPE_ORDER : 0x0003,
	CAPSTYPE_BITMAPCACHE : 0x0004,
	CAPSTYPE_CONTROL : 0x0005,
	CAPSTYPE_ACTIVATION : 0x0007,
	CAPSTYPE_POINTER : 0x0008,
	CAPSTYPE_SHARE : 0x0009,
	CAPSTYPE_COLORCACHE : 0x000A,
	CAPSTYPE_SOUND : 0x000C,
	CAPSTYPE_INPUT : 0x000D,
	CAPSTYPE_FONT : 0x000E,
	CAPSTYPE_BRUSH : 0x000F,
	CAPSTYPE_GLYPHCACHE : 0x0010,
	CAPSTYPE_OFFSCREENCACHE : 0x0011,
	CAPSTYPE_BITMAPCACHE_HOSTSUPPORT : 0x0012,
	CAPSTYPE_BITMAPCACHE_REV2 : 0x0013,
	CAPSTYPE_VIRTUALCHANNEL : 0x0014,
	CAPSTYPE_DRAWNINEGRIDCACHE : 0x0015,
	CAPSTYPE_DRAWGDIPLUS : 0x0016,
	CAPSTYPE_RAIL : 0x0017,
	CAPSTYPE_WINDOW : 0x0018,
	CAPSETTYPE_COMPDESK : 0x0019,
	CAPSETTYPE_MULTIFRAGMENTUPDATE : 0x001A,
	CAPSETTYPE_LARGE_POINTER : 0x001B,
	CAPSETTYPE_SURFACE_COMMANDS : 0x001C,
	CAPSETTYPE_BITMAP_CODECS : 0x001D,
	CAPSSETTYPE_FRAME_ACKNOWLEDGE : 0x001E
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240549.aspx
 */
var MajorType = {
	OSMAJORTYPE_UNSPECIFIED : 0x0000,
	OSMAJORTYPE_WINDOWS : 0x0001,
	OSMAJORTYPE_OS2 : 0x0002,
	OSMAJORTYPE_MACINTOSH : 0x0003,
	OSMAJORTYPE_UNIX : 0x0004,
	OSMAJORTYPE_IOS : 0x0005,
	OSMAJORTYPE_OSX : 0x0006,
	OSMAJORTYPE_ANDROID : 0x0007
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240549.aspx
 */
var MinorType = {
	OSMINORTYPE_UNSPECIFIED : 0x0000,
	OSMINORTYPE_WINDOWS_31X : 0x0001,
	OSMINORTYPE_WINDOWS_95 : 0x0002,
	OSMINORTYPE_WINDOWS_NT : 0x0003,
	OSMINORTYPE_OS2_V21 : 0x0004,
	OSMINORTYPE_POWER_PC : 0x0005,
	OSMINORTYPE_MACINTOSH : 0x0006,
	OSMINORTYPE_NATIVE_XSERVER : 0x0007,
	OSMINORTYPE_PSEUDO_XSERVER : 0x0008,
	OSMINORTYPE_WINDOWS_RT : 0x0009
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240549.aspx
 */
var GeneralExtraFlag = {
    FASTPATH_OUTPUT_SUPPORTED : 0x0001,
    NO_BITMAP_COMPRESSION_HDR : 0x0400,
    LONG_CREDENTIALS_SUPPORTED : 0x0004,
    AUTORECONNECT_SUPPORTED : 0x0008,
    ENC_SALTED_CHECKSUM : 0x0010
};

var Boolean = {
    FALSE : 0x00,
    TRUE : 0x01
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240556.aspx
 */
var OrderFlag = {
    NEGOTIATEORDERSUPPORT : 0x0002,
    ZEROBOUNDSDELTASSUPPORT : 0x0008,
    COLORINDEXSUPPORT : 0x0020,
    SOLIDPATTERNBRUSHONLY : 0x0040,
    ORDERFLAGS_EXTRA_FLAGS : 0x0080
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240556.aspx
 */
var Order = {
    TS_NEG_DSTBLT_INDEX : 0x00,
    TS_NEG_PATBLT_INDEX : 0x01,
    TS_NEG_SCRBLT_INDEX : 0x02,
    TS_NEG_MEMBLT_INDEX : 0x03,
    TS_NEG_MEM3BLT_INDEX : 0x04,
    TS_NEG_DRAWNINEGRID_INDEX : 0x07,
    TS_NEG_LINETO_INDEX : 0x08,
    TS_NEG_MULTI_DRAWNINEGRID_INDEX : 0x09,
    TS_NEG_SAVEBITMAP_INDEX : 0x0B,
    TS_NEG_MULTIDSTBLT_INDEX : 0x0F,
    TS_NEG_MULTIPATBLT_INDEX : 0x10,
    TS_NEG_MULTISCRBLT_INDEX : 0x11,
    TS_NEG_MULTIOPAQUERECT_INDEX : 0x12,
    TS_NEG_FAST_INDEX_INDEX : 0x13,
    TS_NEG_POLYGON_SC_INDEX : 0x14,
    TS_NEG_POLYGON_CB_INDEX : 0x15,
    TS_NEG_POLYLINE_INDEX : 0x16,
    TS_NEG_FAST_GLYPH_INDEX : 0x18,
    TS_NEG_ELLIPSE_SC_INDEX : 0x19,
    TS_NEG_ELLIPSE_CB_INDEX : 0x1A,
    TS_NEG_INDEX_INDEX : 0x1B
};

var OrderEx = {
    ORDERFLAGS_EX_CACHE_BITMAP_REV3_SUPPORT : 0x0002,
    ORDERFLAGS_EX_ALTSEC_FRAME_MARKER_SUPPORT : 0x0004
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240563.aspx
 */
var InputFlags = {
    INPUT_FLAG_SCANCODES : 0x0001,
    INPUT_FLAG_MOUSEX : 0x0004,
    INPUT_FLAG_FASTPATH_INPUT : 0x0008,
    INPUT_FLAG_UNICODE : 0x0010,
    INPUT_FLAG_FASTPATH_INPUT2 : 0x0020,
    INPUT_FLAG_UNUSED1 : 0x0040,
    INPUT_FLAG_UNUSED2 : 0x0080,
    TS_INPUT_FLAG_MOUSE_HWHEEL : 0x0100
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240564.aspx
 */
var BrushSupport = {
    BRUSH_DEFAULT : 0x00000000,
    BRUSH_COLOR_8x8 : 0x00000001,
    BRUSH_COLOR_FULL : 0x00000002
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240565.aspx
 */
var GlyphSupport = {
    GLYPH_SUPPORT_NONE : 0x0000,
    GLYPH_SUPPORT_PARTIAL : 0x0001,
    GLYPH_SUPPORT_FULL : 0x0002,
    GLYPH_SUPPORT_ENCODE : 0x0003
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240550.aspx
 */
var OffscreenSupportLevel = {
    FALSE : 0x00000000,
    TRUE : 0x00000001
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240551.aspx
 */
var VirtualChannelCompressionFlag = {
    VCCAPS_NO_COMPR : 0x00000000,
    VCCAPS_COMPR_SC : 0x00000001,
    VCCAPS_COMPR_CS_8K : 0x00000002
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240552.aspx
 */
var SoundFlag = {
    NONE : 0x0000,
    SOUND_BEEPS_FLAG : 0x0001
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240549.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function generalCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_GENERAL,
		osMajorType : new type.UInt16Le(),
        osMinorType : new type.UInt16Le(),
        protocolVersion : new type.UInt16Le(0x0200, {constant : true}),
        pad2octetsA : new type.UInt16Le(),
        generalCompressionTypes : new type.UInt16Le(0, {constant : true}),
        extraFlags : new type.UInt16Le(),
        updateCapabilityFlag : new type.UInt16Le(0, {constant : true}),
        remoteUnshareFlag : new type.UInt16Le(0, {constant : true}),
        generalCompressionLevel : new type.UInt16Le(0, {constant : true}),
        refreshRectSupport : new type.UInt8(),
        suppressOutputSupport : new type.UInt8()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240554.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function bitmapCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_BITMAP,
		preferredBitsPerPixel : new type.UInt16Le(),
        receive1BitPerPixel : new type.UInt16Le(0x0001),
        receive4BitsPerPixel : new type.UInt16Le(0x0001),
        receive8BitsPerPixel : new type.UInt16Le(0x0001),
        desktopWidth : new type.UInt16Le(),
        desktopHeight : new type.UInt16Le(),
        pad2octets : new type.UInt16Le(),
        desktopResizeFlag : new type.UInt16Le(),
        bitmapCompressionFlag : new type.UInt16Le(0x0001, {constant : true}),
        highColorFlags : new type.UInt8(0),
        drawingFlags : new type.UInt8(),
        multipleRectangleSupport : new type.UInt16Le(0x0001, {constant : true}),
        pad2octetsB : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240556.aspx
 * @param orders {type.BinaryString|null} list of available orders
 * @param opt {object} type options
 * @returns {type.Component}
 */
function orderCapability(orders, opt) {
	if(orders && orders.size() !== 32) {
		throw new error.FatalError('NODE_RDP_PROTOCOL_PDU_CAPS_BAD_ORDERS_SIZE');
	}
	
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_ORDER,
		terminalDescriptor : new type.BinaryString(Buffer.from(Array(16 + 1).join('\x00'), 'binary'), {readLength : new type.CallableValue(16)}),
        pad4octetsA : new type.UInt32Le(0),
        desktopSaveXGranularity : new type.UInt16Le(1),
        desktopSaveYGranularity : new type.UInt16Le(20),
        pad2octetsA : new type.UInt16Le(0),
        maximumOrderLevel : new type.UInt16Le(1),
        numberFonts : new type.UInt16Le(),
        orderFlags : new type.UInt16Le(OrderFlag.NEGOTIATEORDERSUPPORT),
        orderSupport : orders || new type.Factory(function(s) {
        	self.orderSupport = new type.BinaryString(null, {readLength : new type.CallableValue(32)}).read(s);
        }),
        textFlags : new type.UInt16Le(),
        orderSupportExFlags : new type.UInt16Le(),
        pad4octetsB : new type.UInt32Le(),
        desktopSaveSize : new type.UInt32Le(480 * 480),
        pad2octetsC : new type.UInt16Le(),
        pad2octetsD : new type.UInt16Le(),
        textANSICodePage : new type.UInt16Le(0),
        pad2octetsE : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240559.aspx
 * @param opt type options
 * @returns {type.Component}
 */
function bitmapCacheCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_BITMAPCACHE,
		pad1 : new type.UInt32Le(),
        pad2 : new type.UInt32Le(),
        pad3 : new type.UInt32Le(),
        pad4 : new type.UInt32Le(),
        pad5 : new type.UInt32Le(),
        pad6 : new type.UInt32Le(),
        cache0Entries : new type.UInt16Le(),
        cache0MaximumCellSize : new type.UInt16Le(),
        cache1Entries : new type.UInt16Le(),
        cache1MaximumCellSize : new type.UInt16Le(),
        cache2Entries : new type.UInt16Le(),
        cache2MaximumCellSize : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * 
 * @param isServer {boolean} true if in server mode
 * @param opt {object} type options
 * @returns {type.Component}
 */
function pointerCapability(isServer, opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_POINTER,
		colorPointerFlag : new type.UInt16Le(),
        colorPointerCacheSize : new type.UInt16Le(20),
        //old version of rdp doesn't support ...
        pointerCacheSize : new type.UInt16Le(null, {conditional : function() {
        	return isServer || false;
        }})
    };
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240563.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function inputCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_INPUT,
		inputFlags : new type.UInt16Le(),
        pad2octetsA : new type.UInt16Le(),
        // same value as gcc.ClientCoreSettings.kbdLayout
        keyboardLayout : new type.UInt32Le(),
        // same value as gcc.ClientCoreSettings.keyboardType
        keyboardType : new type.UInt32Le(),
        // same value as gcc.ClientCoreSettings.keyboardSubType
        keyboardSubType : new type.UInt32Le(),
        // same value as gcc.ClientCoreSettings.keyboardFnKeys
        keyboardFunctionKey : new type.UInt32Le(),
        // same value as gcc.ClientCoreSettingrrs.imeFileName
        imeFileName : new type.BinaryString(Buffer.from(Array(64 + 1).join('\x00'), 'binary'), {readLength : new type.CallableValue(64)})
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240564.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function brushCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_BRUSH,
		brushSupportLevel : new type.UInt32Le(BrushSupport.BRUSH_DEFAULT)
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240566.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function cacheEntry(opt) {
	var self = {
		cacheEntries : new type.UInt16Le(),
        cacheMaximumCellSize : new type.UInt16Le()	
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240565.aspx
 * @param entries {type.Component} cache entries
 * @param opt {object} type options
 * @returns {type.Component}
 */
function glyphCapability(entries, opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_GLYPHCACHE,
		glyphCache : entries || new type.Factory(function(s) {
			self.glyphCache = new type.Component([]);
			for(var i = 0; i < 10; i++) {
				self.glyphCache.obj.push(cacheEntry().read(s));
			}
		}),
        fragCache : new type.UInt32Le(),
        // all fonts are sent with bitmap format (very expensive)
        glyphSupportLevel : new type.UInt16Le(GlyphSupport.GLYPH_SUPPORT_NONE),
        pad2octets : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240550.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function offscreenBitmapCacheCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_OFFSCREENCACHE,
		offscreenSupportLevel : new type.UInt32Le(OffscreenSupportLevel.FALSE),
        offscreenCacheSize : new type.UInt16Le(),
        offscreenCacheEntries : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240551.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function virtualChannelCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_VIRTUALCHANNEL,
		flags : new type.UInt32Le(VirtualChannelCompressionFlag.VCCAPS_NO_COMPR),
        VCChunkSize : new type.UInt32Le(null, {optional : true})	
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240552.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function soundCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_SOUND,
		soundFlags : new type.UInt16Le(SoundFlag.NONE),
	    pad2octetsA : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240568.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function controlCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_CONTROL,
		controlFlags : new type.UInt16Le(),
		remoteDetachFlag : new type.UInt16Le(),
		controlInterest : new type.UInt16Le(0x0002),
		detachInterest : new type.UInt16Le(0x0002)
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240569.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function windowActivationCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_ACTIVATION,
		helpKeyFlag : new type.UInt16Le(),
        helpKeyIndexFlag : new type.UInt16Le(),
        helpExtendedKeyFlag : new type.UInt16Le(),
        windowManagerKeyFlag : new type.UInt16Le()	
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240571.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function fontCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_FONT,
		fontSupportFlags : new type.UInt16Le(0x0001),
		pad2octets : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241564.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function colorCacheCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_COLORCACHE,
		colorTableCacheSize : new type.UInt16Le(0x0006),
		pad2octets : new type.UInt16Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240570.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function shareCapability(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSTYPE_SHARE,
		nodeId : new type.UInt16Le(),
		pad2octets : new type.UInt16Le()	
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240649.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function multiFragmentUpdate(opt) {
	var self = {
		__TYPE__ : CapsType.CAPSETTYPE_MULTIFRAGMENTUPDATE,
		MaxRequestSize : new type.UInt32Le(0)
	};
	
	return new type.Component(self, opt);
}

/**
 * Capability wrapper packet
 * @see http://msdn.microsoft.com/en-us/library/cc240486.aspx
 * @param cap {type.Component}
 * @param opt {object} type options
 * @returns {type.Component}
 */
function capability(cap, opt) {
	var self = {
		capabilitySetType : new type.UInt16Le(function() {
			return self.capability.obj.__TYPE__;
		}),
		lengthCapability : new type.UInt16Le(function() {
			return new type.Component(self).size();
		}),
		capability : cap || new type.Factory(function(s) {
			switch(self.capabilitySetType.value) {
			case CapsType.CAPSTYPE_GENERAL:
				self.capability = generalCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_BITMAP:
				self.capability = bitmapCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_ORDER:
				self.capability = orderCapability(null, {readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_BITMAPCACHE:
				self.capability = bitmapCacheCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_POINTER:
				self.capability = pointerCapability(false, {readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_INPUT:
				self.capability = inputCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_BRUSH:
				self.capability = brushCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_GLYPHCACHE:
				self.capability = glyphCapability(null, {readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_OFFSCREENCACHE:
				self.capability = offscreenBitmapCacheCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_VIRTUALCHANNEL:
				self.capability = virtualChannelCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_SOUND:
				self.capability = soundCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_CONTROL:
				self.capability = controlCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_ACTIVATION:
				self.capability = windowActivationCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_FONT:
				self.capability = fontCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_COLORCACHE:
				self.capability = colorCacheCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSTYPE_SHARE:
				self.capability = shareCapability({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			case CapsType.CAPSETTYPE_MULTIFRAGMENTUPDATE:
				self.capability = multiFragmentUpdate({readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
				break;
			default:
				log.debug('unknown capability ' + self.capabilitySetType.value);
				self.capability = new type.BinaryString(null, {readLength : new type.CallableValue(function() {
					return self.lengthCapability.value - 4;
				})}).read(s);
			}
		})
	};
	
	return new type.Component(self, opt);
}

/**
 * Module exports
 */
module.exports = {
	CapsType : CapsType,
	MajorType : MajorType,
	MinorType : MinorType,
	GeneralExtraFlag : GeneralExtraFlag,
	Boolean : Boolean,
	OrderFlag : OrderFlag,
	Order : Order,
	OrderEx : OrderEx,
	InputFlags : InputFlags,
	BrushSupport : BrushSupport,
	GlyphSupport : GlyphSupport,
	OffscreenSupportLevel : OffscreenSupportLevel,
	VirtualChannelCompressionFlag : VirtualChannelCompressionFlag,
	SoundFlag : SoundFlag,
	generalCapability : generalCapability,
	bitmapCapability : bitmapCapability,
	orderCapability : orderCapability,
	bitmapCacheCapability : bitmapCacheCapability,
	pointerCapability : pointerCapability,
	inputCapability : inputCapability,
	brushCapability : brushCapability,
	cacheEntry : cacheEntry,
	glyphCapability : glyphCapability,
	offscreenBitmapCacheCapability : offscreenBitmapCacheCapability,
	virtualChannelCapability : virtualChannelCapability,
	soundCapability : soundCapability,
	controlCapability : controlCapability,
	windowActivationCapability : windowActivationCapability,
	fontCapability : fontCapability,
	colorCacheCapability : colorCacheCapability,
	shareCapability : shareCapability,
	multiFragmentUpdate : multiFragmentUpdate,
	capability : capability
};