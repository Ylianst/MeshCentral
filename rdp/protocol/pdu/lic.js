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

var MessageType = {
    LICENSE_REQUEST : 0x01,
    PLATFORM_CHALLENGE : 0x02,
    NEW_LICENSE : 0x03,
    UPGRADE_LICENSE : 0x04,
    LICENSE_INFO : 0x12,
    NEW_LICENSE_REQUEST : 0x13,
    PLATFORM_CHALLENGE_RESPONSE : 0x15,
    ERROR_ALERT : 0xFF
};
    
/**
 * @see http://msdn.microsoft.com/en-us/library/cc240482.aspx
 */
var ErrorCode = {
    ERR_INVALID_SERVER_CERTIFICATE : 0x00000001,
    ERR_NO_LICENSE : 0x00000002,
    ERR_INVALID_SCOPE : 0x00000004,
    ERR_NO_LICENSE_SERVER : 0x00000006,
    STATUS_VALID_CLIENT : 0x00000007,
    ERR_INVALID_CLIENT : 0x00000008,
    ERR_INVALID_PRODUCTID : 0x0000000B,
    ERR_INVALID_MESSAGE_LEN : 0x0000000C,
    ERR_INVALID_MAC : 0x00000003
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240482.aspx
 */
var StateTransition = {
    ST_TOTAL_ABORT : 0x00000001,
    ST_NO_TRANSITION : 0x00000002,
    ST_RESET_PHASE_TO_START : 0x00000003,
    ST_RESEND_LAST_MESSAGE : 0x00000004
};

/**
 * @see http://msdn.microsoft.com/en-us/library/cc240481.aspx
 */
var BinaryBlobType = {
    BB_ANY_BLOB : 0x0000,
    BB_DATA_BLOB : 0x0001,
    BB_RANDOM_BLOB : 0x0002,
    BB_CERTIFICATE_BLOB : 0x0003,
    BB_ERROR_BLOB : 0x0004,
    BB_ENCRYPTED_DATA_BLOB : 0x0009,
    BB_KEY_EXCHG_ALG_BLOB : 0x000D,
    BB_SCOPE_BLOB : 0x000E,
    BB_CLIENT_USER_NAME_BLOB : 0x000F,
    BB_CLIENT_MACHINE_NAME_BLOB : 0x0010
};

var Preambule = {
    PREAMBLE_VERSION_2_0 : 0x2,
    PREAMBLE_VERSION_3_0 : 0x3,
    EXTENDED_ERROR_MSG_SUPPORTED : 0x80
};

/**
 * Binary blob to emcompass license information
 * @see http://msdn.microsoft.com/en-us/library/cc240481.aspx
 * @param blobType {BinaryBlobType.*}
 * @returns {type.Component}
 */
function licenseBinaryBlob(blobType) {
	blobType = blobType || BinaryBlobType.BB_ANY_BLOB;
	var self = {
		wBlobType : new type.UInt16Le(blobType, { constant : (blobType === BinaryBlobType.BB_ANY_BLOB)?false:true }),
        wBlobLen : new type.UInt16Le(function() {
        	return self.blobData.size();
        }),
        blobData : new type.BinaryString(null, { readLength : new type.CallableValue(function() {
        	return self.wBlobLen.value;
        })})
	};
	
	return new type.Component(self);
}

/**
 * Error message in license PDU automata
 * @see http://msdn.microsoft.com/en-us/library/cc240482.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function licensingErrorMessage(opt) {
	var self = {
		__TYPE__ : MessageType.ERROR_ALERT,
		dwErrorCode : new type.UInt32Le(),
        dwStateTransition : new type.UInt32Le(),
        blob : licenseBinaryBlob(BinaryBlobType.BB_ANY_BLOB)
	};
	
	return new type.Component(self, opt);
}

/**
 * License product informations
 * @see http://msdn.microsoft.com/en-us/library/cc241915.aspx
 * @returns {type.Component}
 */
function productInformation() {
	var self = {
		dwVersion : new type.UInt32Le(),
        cbCompanyName : new type.UInt32Le(function() {
        	return self.pbCompanyName.size();
        }),
        // may contain "Microsoft Corporation" from server microsoft
        pbCompanyName : new type.BinaryString(Buffer.from('Microsoft Corporation', 'ucs2'), { readLength : new type.CallableValue(function() {
        	return self.cbCompanyName.value;
        })}),
        cbProductId : new type.UInt32Le(function() {
        	return self.pbProductId.size();
        }),
        // may contain "A02" from microsoft license server
        pbProductId : new type.BinaryString(Buffer.from('A02', 'ucs2'), { readLength : new type.CallableValue(function() {
        	return self.cbProductId.value;
        })})
	};
	
	return new type.Component(self);
}

/**
 * Use in license negotiation
 * @see http://msdn.microsoft.com/en-us/library/cc241917.aspx
 * @returns {type.Component}
 */
function scope() {
	var self = {
		scope : licenseBinaryBlob(BinaryBlobType.BB_SCOPE_BLOB)
	};
	
	return new type.Component(self);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241916.aspx
 * @returns {type.Component}
 */
function scopeList() {
	var self = {
		scopeCount : new type.UInt32Le(function() {
			return self.scopeArray.length;
		}),
		scopeArray : new type.Factory(function(s) {
			self.scopeArray = new type.Component([]);
			for(var i = 0; i < self.scopeCount.value; i++) {
				self.scopeArray.obj.push(scope().read(s));
			}
		})
	};
	
	return new type.Component(self);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241914.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function serverLicenseRequest(opt) {
	var self = {
		__TYPE__ : MessageType.LICENSE_REQUEST,
		serverRandom : new type.BinaryString(Buffer.from(Array(32 + 1).join('\x00')), { readLength : new type.CallableValue(32) } ),
        productInfo : productInformation(),
        keyExchangeList : licenseBinaryBlob(BinaryBlobType.BB_KEY_EXCHG_ALG_BLOB),
        serverCertificate : licenseBinaryBlob(BinaryBlobType.BB_CERTIFICATE_BLOB),
        scopeList : scopeList()
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241918.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function clientNewLicenseRequest(opt) {
	var self = {
		__TYPE__ : MessageType.NEW_LICENSE_REQUEST,
		preferredKeyExchangeAlg : new type.UInt32Le(0x00000001, { constant : true }),
        // pure microsoft client ;-)
        // http://msdn.microsoft.com/en-us/library/1040af38-c733-4fb3-acd1-8db8cc979eda#id10
        platformId : new type.UInt32Le(0x04000000 | 0x00010000),
        clientRandom : new type.BinaryString(Buffer.from(Array(32 + 1).join('\x00')), { readLength : new type.CallableValue(32) }),
        encryptedPreMasterSecret : licenseBinaryBlob(BinaryBlobType.BB_RANDOM_BLOB),
        ClientUserName : licenseBinaryBlob(BinaryBlobType.BB_CLIENT_USER_NAME_BLOB),
        ClientMachineName : licenseBinaryBlob(BinaryBlobType.BB_CLIENT_MACHINE_NAME_BLOB)
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241921.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function serverPlatformChallenge(opt) {
	var self = {
		__TYPE__ : MessageType.PLATFORM_CHALLENGE,
		connectFlags : new type.UInt32Le(),
        encryptedPlatformChallenge : licenseBinaryBlob(BinaryBlobType.BB_ANY_BLOB),
        MACData : new type.BinaryString(Buffer.from(Array(16 + 1).join('\x00')), { readLength : new type.CallableValue(16) })
	};
	
	return new type.Component(self, opt);
}

/**
 * @see http://msdn.microsoft.com/en-us/library/cc241922.aspx
 * @param opt {object} type options
 * @returns {type.Component}
 */
function clientPLatformChallengeResponse(opt) {
	var self = {
		__TYPE__ : MessageType.PLATFORM_CHALLENGE_RESPONSE,
		encryptedPlatformChallengeResponse : licenseBinaryBlob(BinaryBlobType.BB_DATA_BLOB),
        encryptedHWID : licenseBinaryBlob(BinaryBlobType.BB_DATA_BLOB),
        MACData : new type.BinaryString(Buffer.from(Array(16 + 1).join('\x00'), 'binary'), { readLength : new type.CallableValue(16) })
	};
	
	return new type.Component(self, opt);
};

/**
 * Global license packet
 * @param packet {type.* | null} send packet
 * @returns {type.Component}
 */
function licensePacket(message) {
	var self = {
		bMsgtype : new type.UInt8(function() {
			return self.licensingMessage.obj.__TYPE__;
		}),
        flag : new type.UInt8(Preambule.PREAMBLE_VERSION_3_0),
        wMsgSize : new type.UInt16Le(function() {
        	return new type.Component(self).size();
        }),
        licensingMessage : message || new type.Factory(function(s) {
        	switch(self.bMsgtype.value) {
        	case MessageType.ERROR_ALERT:
        		self.licensingMessage = licensingErrorMessage({ readLength : new type.CallableValue(function() {
        			return self.wMsgSize.value - 4;
        		})}).read(s);
        		break;
        	case MessageType.LICENSE_REQUEST:
        		self.licensingMessage = serverLicenseRequest({ readLength : new type.CallableValue(function() {
        			return self.wMsgSize.value - 4;
        		})}).read(s);
        		break;
        	case MessageType.NEW_LICENSE_REQUEST:
        		self.licensingMessage = clientNewLicenseRequest({ readLength : new type.CallableValue(function() {
        			return self.wMsgSize.value - 4;
        		})}).read(s);
        		break;
        	case MessageType.PLATFORM_CHALLENGE:
        		self.licensingMessage = serverPlatformChallenge({ readLength : new type.CallableValue(function() {
        			return self.wMsgSize.value - 4;
        		})}).read(s);
        		break;
        	case MessageType.PLATFORM_CHALLENGE_RESPONSE:
        		self.licensingMessage = clientPLatformChallengeResponse({ readLength : new type.CallableValue(function() {
        			return self.wMsgSize.value - 4;
        		})}).read(s);
        		break;
        	default:
        		log.error('unknown license message type ' + self.bMsgtype.value);
        	}
        })
	};
	
	return new type.Component(self);
}

/**
 * Module exports
 */
module.exports = {
		MessageType : MessageType,
		ErrorCode : ErrorCode,
		StateTransition : StateTransition,
		licensePacket : licensePacket,
		clientNewLicenseRequest : clientNewLicenseRequest,
		clientPLatformChallengeResponse : clientPLatformChallengeResponse
};