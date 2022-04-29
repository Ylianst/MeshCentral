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
var per = require('./per');


var t124_02_98_oid = [ 0, 0, 20, 124, 0, 1 ];
var h221_cs_key = "Duca";
var h221_sc_key = "McDn";


/**
 * @see http://msdn.microsoft.com/en-us/library/cc240509.aspx
 */
var MessageType = {
    //server -> client
    SC_CORE : 0x0C01,
    SC_SECURITY : 0x0C02,
    SC_NET : 0x0C03,
    //client -> server
    CS_CORE : 0xC001,
    CS_SECURITY : 0xC002,
    CS_NET : 0xC003,
    CS_CLUSTER : 0xC004,
    CS_MONITOR : 0xC005
};
    
/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var ColorDepth = {
    RNS_UD_COLOR_8BPP : 0xCA01,
    RNS_UD_COLOR_16BPP_555 : 0xCA02,
    RNS_UD_COLOR_16BPP_565 : 0xCA03,
    RNS_UD_COLOR_24BPP : 0xCA04
};
   
/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var HighColor = {
    HIGH_COLOR_4BPP : 0x0004,
    HIGH_COLOR_8BPP : 0x0008,
    HIGH_COLOR_15BPP : 0x000f,
    HIGH_COLOR_16BPP : 0x0010,
    HIGH_COLOR_24BPP : 0x0018
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var Support = {
    RNS_UD_24BPP_SUPPORT : 0x0001,
    RNS_UD_16BPP_SUPPORT : 0x0002,
    RNS_UD_15BPP_SUPPORT : 0x0004,
    RNS_UD_32BPP_SUPPORT : 0x0008
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var CapabilityFlag = {
    RNS_UD_CS_SUPPORT_ERRINFO_PDU : 0x0001,
    RNS_UD_CS_WANT_32BPP_SESSION : 0x0002,
    RNS_UD_CS_SUPPORT_STATUSINFO_PDU : 0x0004,
    RNS_UD_CS_STRONG_ASYMMETRIC_KEYS : 0x0008,
    RNS_UD_CS_UNUSED : 0x0010,
    RNS_UD_CS_VALID_CONNECTION_TYPE : 0x0020,
    RNS_UD_CS_SUPPORT_MONITOR_LAYOUT_PDU : 0x0040,
    RNS_UD_CS_SUPPORT_NETCHAR_AUTODETECT : 0x0080,
    RNS_UD_CS_SUPPORT_DYNVC_GFX_PROTOCOL : 0x0100,
    RNS_UD_CS_SUPPORT_DYNAMIC_TIME_ZONE : 0x0200,
    RNS_UD_CS_SUPPORT_HEARTBEAT_PDU : 0x0400
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var ConnectionType = {
    CONNECTION_TYPE_MODEM : 0x01,
    CONNECTION_TYPE_BROADBAND_LOW : 0x02,
    CONNECTION_TYPE_SATELLITE : 0x03,
    CONNECTION_TYPE_BROADBAND_HIGH : 0x04,
    CONNECTION_TYPE_WAN : 0x05,
    CONNECTION_TYPE_LAN : 0x06,
    CONNECTION_TYPE_AUTODETECT : 0x07
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 */
var VERSION = {
    RDP_VERSION_4 : 0x00080001,
    RDP_VERSION_5_PLUS : 0x00080004
};

var Sequence = {
    RNS_UD_SAS_DEL : 0xAA03
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240511.aspx
 */
var EncryptionMethod = {
    ENCRYPTION_FLAG_40BIT : 0x00000001,
    ENCRYPTION_FLAG_128BIT : 0x00000002,
    ENCRYPTION_FLAG_56BIT : 0x00000008,
    FIPS_ENCRYPTION_FLAG : 0x00000010
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240518.aspx
 */
var EncryptionLevel = {
    ENCRYPTION_LEVEL_NONE : 0x00000000,
    ENCRYPTION_LEVEL_LOW : 0x00000001,
    ENCRYPTION_LEVEL_CLIENT_COMPATIBLE : 0x00000002,
    ENCRYPTION_LEVEL_HIGH : 0x00000003,
    ENCRYPTION_LEVEL_FIPS : 0x00000004
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240513.aspx
 */
var ChannelOptions = {
    CHANNEL_OPTION_INITIALIZED : 0x80000000,
    CHANNEL_OPTION_ENCRYPT_RDP : 0x40000000,
    CHANNEL_OPTION_ENCRYPT_SC : 0x20000000,
    CHANNEL_OPTION_ENCRYPT_CS : 0x10000000,
    CHANNEL_OPTION_PRI_HIGH : 0x08000000,
    CHANNEL_OPTION_PRI_MED : 0x04000000,
    CHANNEL_OPTION_PRI_LOW : 0x02000000,
    CHANNEL_OPTION_COMPRESS_RDP : 0x00800000,
    CHANNEL_OPTION_COMPRESS : 0x00400000,
    CHANNEL_OPTION_SHOW_PROTOCOL : 0x00200000,
    REMOTE_CONTROL_PERSISTENT : 0x00100000
};

/**
 * IBM_101_102_KEYS is the most common keyboard type
 */
var KeyboardType = {
    IBM_PC_XT_83_KEY : 0x00000001,
    OLIVETTI : 0x00000002,
    IBM_PC_AT_84_KEY : 0x00000003,
    IBM_101_102_KEYS : 0x00000004,
    NOKIA_1050 : 0x00000005,
    NOKIA_9140 : 0x00000006,
    JAPANESE : 0x00000007
};

/**
 * @see http://technet.microsoft.com/en-us/library/cc766503%28WS.10%29.aspx
 */
var KeyboardLayout = {
    ARABIC : 0x00000401,
    BULGARIAN : 0x00000402,
    CHINESE_US_KEYBOARD : 0x00000404,
    CZECH : 0x00000405,
    DANISH : 0x00000406,
    GERMAN : 0x00000407,
    GREEK : 0x00000408,
    US : 0x00000409,
    SPANISH : 0x0000040a,
    FINNISH : 0x0000040b,
    FRENCH : 0x0000040c,
    HEBREW : 0x0000040d,
    HUNGARIAN : 0x0000040e,
    ICELANDIC : 0x0000040f,
    ITALIAN : 0x00000410,
    JAPANESE : 0x00000411,
    KOREAN : 0x00000412,
    DUTCH : 0x00000413,
    NORWEGIAN : 0x00000414
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240521.aspx
 */
var CertificateType = {
    CERT_CHAIN_VERSION_1 : 0x00000001,
    CERT_CHAIN_VERSION_2 : 0x00000002
};

/**
 * @param {type.Type} data 
 * @returns {type.Component}
 */
function block(data) {
	var self = {
		// type of data block
		type : new type.UInt16Le(function() {
			return self.data.obj.__TYPE__;
		}),
		// length of entire packet
	    length : new type.UInt16Le(function() {
	    	return new type.Component(self).size();
	    }),
	    // data block
	    data : data || new type.Factory(function(s){
	    	var options = {
	    		readLength : new type.CallableValue( function () {
	    			return self.length.value - 4;
	    		})
	    	};
	    	switch(self.type.value) {
	    	case MessageType.SC_CORE:
	    		self.data = serverCoreData(options).read(s);
	    		break;
	    	case MessageType.SC_SECURITY:
	    		self.data = serverSecurityData(options).read(s);
	    		break;
	    	case MessageType.SC_NET:
	    		self.data = serverNetworkData(null, options).read(s);
	    		break;
	    	case MessageType.CS_CORE:
	    		self.data = clientCoreData(options).read(s);
	    		break;
	    	case MessageType.CS_SECURITY:
	    		self.data = clientSecurityData(options).read(s);
	    		break;
	    	case MessageType.CS_NET:
	    		self.data = clientNetworkData(null, options).read(s);
	    		break;
	    	default:
	    		log.debug("unknown gcc block type " + self.type.value);
	    		self.data = new type.BinaryString(null, options).read(s);
	    	}
	    })
	};
	
	return new type.Component(self);
}

/**
 * Main client informations
 * 	keyboard
 * 	screen definition
 * 	color depth
 * @see http://msdn.microsoft.com/en-us/library/cc240510.aspx
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function clientCoreData(opt) {
	var self = {
		__TYPE__ : MessageType.CS_CORE,
		rdpVersion : new type.UInt32Le(VERSION.RDP_VERSION_5_PLUS),
		desktopWidth : new type.UInt16Le(1280),
		desktopHeight : new type.UInt16Le(800),
		colorDepth : new type.UInt16Le(ColorDepth.RNS_UD_COLOR_8BPP),
		sasSequence : new type.UInt16Le(Sequence.RNS_UD_SAS_DEL),
		kbdLayout : new type.UInt32Le(KeyboardLayout.FRENCH),
		clientBuild : new type.UInt32Le(3790),
		clientName : new type.BinaryString(Buffer.from('node-rdpjs\x00\x00\x00\x00\x00\x00', 'ucs2'), { readLength : new type.CallableValue(32) }),
		keyboardType : new type.UInt32Le(KeyboardType.IBM_101_102_KEYS),
		keyboardSubType : new type.UInt32Le(0),
		keyboardFnKeys : new type.UInt32Le(12),
		imeFileName : new type.BinaryString(Buffer.from(Array(64 + 1).join('\x00')), { readLength : new type.CallableValue(64), optional : true }),
		postBeta2ColorDepth : new type.UInt16Le(ColorDepth.RNS_UD_COLOR_8BPP, { optional : true }),
		clientProductId : new type.UInt16Le(1, { optional : true }),
		serialNumber : new type.UInt32Le(0, { optional : true }),
		highColorDepth : new type.UInt16Le(HighColor.HIGH_COLOR_24BPP, { optional : true }),
		supportedColorDepths : new type.UInt16Le(Support.RNS_UD_15BPP_SUPPORT | Support.RNS_UD_16BPP_SUPPORT | Support.RNS_UD_24BPP_SUPPORT | Support.RNS_UD_32BPP_SUPPORT, { optional : true }),
		earlyCapabilityFlags : new type.UInt16Le(CapabilityFlag.RNS_UD_CS_SUPPORT_ERRINFO_PDU, { optional : true }),
		clientDigProductId : new type.BinaryString(Buffer.from(Array(64 + 1).join('\x00')), { optional : true, readLength : new type.CallableValue(64) }),
		connectionType : new type.UInt8(0, { optional : true }),
		pad1octet : new type.UInt8(0, { optional : true }),
		serverSelectedProtocol : new type.UInt32Le(0, { optional : true })
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240517.aspx
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function serverCoreData(opt) {
	var self = {
		__TYPE__ : MessageType.SC_CORE,
		rdpVersion : new type.UInt32Le(VERSION.RDP_VERSION_5_PLUS),
		clientRequestedProtocol : new type.UInt32Le(null, { optional : true }),
		earlyCapabilityFlags : new type.UInt32Le(null, { optional : true })	
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240511.aspx
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function clientSecurityData(opt) {
	var self = {
		__TYPE__ : MessageType.CS_SECURITY,
		encryptionMethods : new type.UInt32Le(EncryptionMethod.ENCRYPTION_FLAG_40BIT | EncryptionMethod.ENCRYPTION_FLAG_56BIT | EncryptionMethod.ENCRYPTION_FLAG_128BIT),
		extEncryptionMethods : new type.UInt32Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * Only use for SSL (RDP security layer TODO)
 * @see http://msdn.microsoft.com/en-us/library/cc240518.aspx
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function serverSecurityData(opt) {
	var self = {
		__TYPE__ : MessageType.SC_SECURITY,
		encryptionMethod : new type.UInt32Le(),
		encryptionLevel : new type.UInt32Le() 
	};
	
	return new type.Component(self, opt);
}

/**
 * Channel definition
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function channelDef (opt) {
	var self = {
		name : new type.BinaryString(null, { readLength : new type.CallableValue(8) }),
		options : new type.UInt32Le()
	};
	
	return new type.Component(self, opt);
}

/**
 * Optional channel requests (sound, clipboard ...)
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function clientNetworkData(channelDefArray, opt) {
	var self = {
		__TYPE__ : MessageType.CS_NET,
		channelCount : new type.UInt32Le( function () {
			return self.channelDefArray.obj.length;
		}),
		channelDefArray : channelDefArray || new type.Factory( function (s) {
			self.channelDefArray = new type.Component([]);
			
			for (var i = 0; i < self.channelCount.value; i++) {
				self.channelDefArray.obj.push(channelDef().read(s));
			}
		})
	};
	
	return new type.Component(self, opt);
}

/**
 * @param channelIds {type.Component} list of available channels
 * @param opt {object} Classic type options
 * @returns {type.Component}
 */
function serverNetworkData (channelIds, opt) {
	var self = {
		__TYPE__ : MessageType.SC_NET,
		MCSChannelId : new type.UInt16Le(1003, { constant : true }),
		channelCount : new type.UInt16Le(function () {
			return self.channelIdArray.obj.length;
		}),
		channelIdArray : channelIds || new type.Factory( function (s) {
			self.channelIdArray = new type.Component([]);
			for (var i = 0; i < self.channelCount.value; i++) {
				self.channelIdArray.obj.push(new type.UInt16Le().read(s));
			}
		}),
		pad : new type.UInt16Le(null, { conditional : function () {
			return (self.channelCount.value % 2) === 1;
		}})
	};
	
	return new type.Component(self, opt);
}

/**
 * Client or server GCC settings block
 * @param blocks {type.Component} array of gcc blocks
 * @param opt {object} options to component type
 * @returns {type.Component}
 */
function settings(blocks, opt) {
	var self = {
		blocks : blocks || new type.Factory(function(s) {
			self.blocks = new type.Component([]);
			// read until end of stream
			while(s.availableLength() > 0) {
				self.blocks.obj.push(block().read(s));
			}
		}),
	};
	
	return new type.Component(self, opt);
}

/**
 * Read GCC response from server
 * @param s {type.Stream} current stream
 * @returns {Array(type.Component)} list of server block
 */
function readConferenceCreateResponse(s) {
	per.readChoice(s);
	
	if(!per.readObjectIdentifier(s, t124_02_98_oid)) {
		throw new error.ProtocolError('NODE_RDP_PROTOCOL_T125_GCC_BAD_OBJECT_IDENTIFIER_T124');
	}
	
	per.readLength(s);
	per.readChoice(s);
	per.readInteger16(s, 1001);
	per.readInteger(s);
	per.readEnumerates(s);
	per.readNumberOfSet(s);
	per.readChoice(s);
	
	if (!per.readOctetStream(s, h221_sc_key, 4)) {
		throw new error.ProtocolError('NODE_RDP_PROTOCOL_T125_GCC_BAD_H221_SC_KEY');
	}
	
	length = per.readLength(s);
	serverSettings = settings(null, { readLength : new type.CallableValue(length) });
	
	// Object magic
	return serverSettings.read(s).obj.blocks.obj.map(function(e) {
		return e.obj.data;
	});
}

/**
 * Read GCC request
 * @param s {type.Stream}
 * @returns {Array(type.Component)} list of client block
 */
function readConferenceCreateRequest (s) {
	per.readChoice(s);
	if (!per.readObjectIdentifier(s, t124_02_98_oid)) {
		throw new error.ProtocolError('NODE_RDP_PROTOCOL_T125_GCC_BAD_H221_SC_KEY');
	}
	per.readLength(s);
	per.readChoice(s);
	per.readSelection(s);
	per.readNumericString(s, 1);
	per.readPadding(s, 1);

	if (per.readNumberOfSet(s) !== 1) {
		throw new error.ProtocolError('NODE_RDP_PROTOCOL_T125_GCC_BAD_SET');
	}

	if (per.readChoice(s) !== 0xc0) {
		throw new error.ProtocolError('NODE_RDP_PROTOCOL_T125_GCC_BAD_CHOICE');
	}

	per.readOctetStream(s, h221_cs_key, 4);
	
	length = per.readLength(s);
	var clientSettings = settings(null, { readLength : new type.CallableValue(length) });
	
	// Object magic
	return clientSettings.read(s).obj.blocks.obj.map(function(e) {
		return e.obj.data;
	});
}

/**
 * Built {type.Componen} from gcc user data
 * @param userData {type.Component} GCC data from client
 * @returns {type.Component} GCC encoded client user data
 */
function writeConferenceCreateRequest (userData) {
    var userDataStream = new type.Stream(userData.size());
    userData.write(userDataStream);
    
    return new type.Component([
	    per.writeChoice(0), per.writeObjectIdentifier(t124_02_98_oid),
	    per.writeLength(userData.size() + 14), per.writeChoice(0),
	    per.writeSelection(0x08), per.writeNumericString("1", 1), per.writePadding(1),
	    per.writeNumberOfSet(1), per.writeChoice(0xc0),
	    per.writeOctetStream(Buffer.from(h221_cs_key), 4), per.writeOctetStream(userDataStream.getValue())
    ]);
}

function writeConferenceCreateResponse (userData) {
	 var userDataStream = new type.Stream(userData.size());
	 userData.write(userDataStream);
	 
	 return new type.Component([
	    per.writeChoice(0), per.writeObjectIdentifier(t124_02_98_oid),
	    per.writeLength(userData.size() + 14), per.writeChoice(0x14),
	    per.writeInteger16(0x79F3, 1001), per.writeInteger(1), per.writeEnumerates(0),
	    per.writeNumberOfSet(1), per.writeChoice(0xc0),
	    per.writeOctetStream(Buffer.from(h221_sc_key), 4), per.writeOctetStream(userDataStream.getValue())
    ]);
}

/**
 * Module exports
 */
module.exports = {
	MessageType : MessageType,
	VERSION : VERSION,
	KeyboardLayout : KeyboardLayout,
	block : block,
	clientCoreData : clientCoreData,
	clientNetworkData : clientNetworkData,
	clientSecurityData : clientSecurityData,
	serverCoreData : serverCoreData,
	serverSecurityData : serverSecurityData,
	serverNetworkData : serverNetworkData,
	readConferenceCreateResponse : readConferenceCreateResponse,
	readConferenceCreateRequest : readConferenceCreateRequest,
	writeConferenceCreateRequest : writeConferenceCreateRequest,
	writeConferenceCreateResponse : writeConferenceCreateResponse
};