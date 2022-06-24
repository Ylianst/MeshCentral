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

var inherits = require('util').inherits;
var events = require('events');
var caps = require('./caps');
var data = require('./data');
var type = require('../../core').type;
var log = require('../../core').log;

/**
 * Global channel for all graphic updates
 * capabilities exchange and input handles
 */
function Global(transport, fastPathTransport) {
	this.transport = transport;
	this.fastPathTransport = fastPathTransport;
	// must be init via connect event
	this.userId = 0;
	this.serverCapabilities = [];
	this.clientCapabilities = [];
}

//inherit from Layer
inherits(Global, events.EventEmitter);

/**
 * Send formated PDU message
 * @param message {type.Component} PDU message
 */
Global.prototype.sendPDU = function(message) {
	this.transport.send(data.pdu(this.userId, message));
};

/**
 * Send formated Data PDU message
 * @param message {type.Component} PDU message
 */
Global.prototype.sendDataPDU = function(message) {
	this.sendPDU(data.dataPDU(message, this.shareId));
};

/**
 * Client side of Global channel automata
 * @param transport
 */
function Client(transport, fastPathTransport) {
	Global.call(this, transport, fastPathTransport);
	var self = this;
	this.transport.once('connect', function(core, userId, channelId) {
		self.connect(core, userId, channelId);
	}).on('close', function() {
		self.emit('close');
	}).on('error', function (err) {
		self.emit('error', err);
	});
	
	if (this.fastPathTransport) {
		this.fastPathTransport.on('fastPathData', function (secFlag, s) {
			self.recvFastPath(secFlag, s);
		});
	}
	
	// init client capabilities
	this.clientCapabilities[caps.CapsType.CAPSTYPE_GENERAL] = caps.generalCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_BITMAP] = caps.bitmapCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_ORDER] = caps.orderCapability(
			new type.Component([
			     new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0),
			     new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0),
			     new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0),
			     new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0), new type.UInt8(0)
			]));
	this.clientCapabilities[caps.CapsType.CAPSTYPE_BITMAPCACHE] = caps.bitmapCacheCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_POINTER] = caps.pointerCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_INPUT] = caps.inputCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_BRUSH] = caps.brushCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_GLYPHCACHE] = caps.glyphCapability(
			new type.Component([
			    caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry(),
			    caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry(), caps.cacheEntry()
			]));
	this.clientCapabilities[caps.CapsType.CAPSTYPE_OFFSCREENCACHE] = caps.offscreenBitmapCacheCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_VIRTUALCHANNEL] = caps.virtualChannelCapability();
	this.clientCapabilities[caps.CapsType.CAPSTYPE_SOUND] = caps.soundCapability();
	this.clientCapabilities[caps.CapsType.CAPSETTYPE_MULTIFRAGMENTUPDATE] = caps.multiFragmentUpdate();
}

// inherit from Layer
inherits(Client, Global);

/**
 * connect function
 * @param gccCore {type.Component(clientCoreData)}
 */
Client.prototype.connect = function(gccCore, userId, channelId) {
	this.gccCore = gccCore;
	this.userId = userId;
	this.channelId = channelId;
	var self = this;
	this.transport.once('data', function(s) {
		self.recvDemandActivePDU(s);
	});
};

/**
 * close stack
 */
Client.prototype.close = function() {
	this.transport.close();
};

/**
 * Receive capabilities from server
 * @param s {type.Stream}
 */
Client.prototype.recvDemandActivePDU = function(s) {
	var pdu = data.pdu().read(s);
	if (pdu.obj.shareControlHeader.obj.pduType.value !== data.PDUType.PDUTYPE_DEMANDACTIVEPDU) {
		log.debug('ignore message type ' + pdu.obj.shareControlHeader.obj.pduType.value + ' during connection sequence');
		
		// loop on state
		var self = this;
		this.transport.once('data', function(s) {
			self.recvDemandActivePDU(s);
		});
		return;
	}
	
	// store share id
	this.shareId = pdu.obj.pduMessage.obj.shareId.value;
	
	// store server capabilities
	for(var i in pdu.obj.pduMessage.obj.capabilitySets.obj) {
		var cap = pdu.obj.pduMessage.obj.capabilitySets.obj[i].obj.capability;
		if(!cap.obj) {
			continue;
		}
		this.serverCapabilities[cap.obj.__TYPE__] = cap;
	}
	
	this.transport.enableSecureCheckSum = !!(this.serverCapabilities[caps.CapsType.CAPSTYPE_GENERAL].obj.extraFlags.value & caps.GeneralExtraFlag.ENC_SALTED_CHECKSUM);
	
	this.sendConfirmActivePDU();
	this.sendClientFinalizeSynchronizePDU();
	
	var self = this;
	this.transport.once('data', function(s) {
		self.recvServerSynchronizePDU(s);
	});
};

/**
 * global channel automata state
 * @param s {type.Stream}
 */
Client.prototype.recvServerSynchronizePDU = function(s) {
	var pdu = data.pdu().read(s);
	if (	pdu.obj.shareControlHeader.obj.pduType.value !== data.PDUType.PDUTYPE_DATAPDU 
		|| 	pdu.obj.pduMessage.obj.shareDataHeader.obj.pduType2.value !== data.PDUType2.PDUTYPE2_SYNCHRONIZE) {
		log.debug('ignore message type ' + pdu.obj.shareControlHeader.obj.pduType.value + ' during connection sequence');
		// loop on state
		var self = this;
		this.transport.once('data', function(s) {
			self.recvServerSynchronizePDU(s);
		});
		return;
	}
	
	var self = this;
	this.transport.once('data', function(s) {
		self.recvServerControlCooperatePDU(s);
	});
};

/**
 * global channel automata state
 * @param s {type.Stream}
 */
Client.prototype.recvServerControlCooperatePDU = function(s) {
	var pdu = data.pdu().read(s);
	if (	pdu.obj.shareControlHeader.obj.pduType.value !== data.PDUType.PDUTYPE_DATAPDU 
		|| 	pdu.obj.pduMessage.obj.shareDataHeader.obj.pduType2.value !== data.PDUType2.PDUTYPE2_CONTROL 
		||	pdu.obj.pduMessage.obj.pduData.obj.action.value !== data.Action.CTRLACTION_COOPERATE) {
		log.debug('ignore message type ' + pdu.obj.shareControlHeader.obj.pduType.value + ' during connection sequence');
		
		// loop on state
		var self = this;
		this.transport.once('data', function(s) {
			self.recvServerControlCooperatePDU(s);
		});
	}
	
	var self = this;
	this.transport.once('data', function(s) {
		self.recvServerControlGrantedPDU(s);
	});
};

/**
 * global channel automata state
 * @param s {type.Stream}
 */
Client.prototype.recvServerControlGrantedPDU = function(s) {
	var pdu = data.pdu().read(s);
	if (	pdu.obj.shareControlHeader.obj.pduType.value !== data.PDUType.PDUTYPE_DATAPDU 
		||	pdu.obj.pduMessage.obj.shareDataHeader.obj.pduType2.value !== data.PDUType2.PDUTYPE2_CONTROL 
		||	pdu.obj.pduMessage.obj.pduData.obj.action.value !== data.Action.CTRLACTION_GRANTED_CONTROL) {
		log.debug('ignore message type ' + pdu.obj.shareControlHeader.obj.pduType.value + ' during connection sequence');
		
		// loop on state
		var self = this;
		this.transport.once('data', function(s) {
			self.recvServerControlGrantedPDU(s);
		});
	}
	
	var self = this;
	this.transport.once('data', function(s) {
		self.recvServerFontMapPDU(s);
	});
};

/**
 * global channel automata state
 * @param s {type.Stream}
 */
Client.prototype.recvServerFontMapPDU = function(s) {
	var pdu = data.pdu().read(s);
	if (	pdu.obj.shareControlHeader.obj.pduType.value !== data.PDUType.PDUTYPE_DATAPDU 
		||	pdu.obj.pduMessage.obj.shareDataHeader.obj.pduType2.value !== data.PDUType2.PDUTYPE2_FONTMAP) {
		log.debug('ignore message type ' + pdu.obj.shareControlHeader.obj.pduType.value + ' during connection sequence');
		
		// loop on state
		var self = this;
		this.transport.once('data', function(s) {
			self.recvServerFontMapPDU(s);
		});
	}
	
	this.emit('connect');
	var self = this;
	this.transport.on('data', function(s) {
		self.recvPDU(s);
	});
};

/**
 * Main reveive fast path
 * @param secFlag {integer} 
 * @param s {type.Stream}
 */
Client.prototype.recvFastPath = function (secFlag, s) {
	while (s.availableLength() > 0) {
        var pdu = data.fastPathUpdatePDU().read(s);
		switch (pdu.obj.updateHeader.value & 0xf) {
            case data.FastPathUpdateType.FASTPATH_UPDATETYPE_BITMAP: {
                this.emit('bitmap', pdu.obj.updateData.obj.rectangles.obj);
                break;
            }
            case data.FastPathUpdateType.FASTPATH_UPDATETYPE_COLOR: {
                this.emit('pointer', pdu.obj.updateData.obj.cursorId, pdu.obj.updateData.obj.cursorStr);
                break;
            }
		default:
		}
	}
};

/**
 * global channel automata state
 * @param s {type.Stream}
 */
Client.prototype.recvPDU = function(s) {
	while (s.availableLength() > 0) {
		var pdu = data.pdu().read(s);
		switch(pdu.obj.shareControlHeader.obj.pduType.value) {
		case data.PDUType.PDUTYPE_DEACTIVATEALLPDU:
			var self = this;
			this.transport.removeAllListeners('data');
			this.transport.once('data', function(s) {
				self.recvDemandActivePDU(s);
			});
			break;
		case data.PDUType.PDUTYPE_DATAPDU:
			this.readDataPDU(pdu.obj.pduMessage)
			break;
		default:
			log.debug('ignore pdu type ' + pdu.obj.shareControlHeader.obj.pduType.value);
		}
	}
};

/**
 * main receive for data PDU packet
 * @param dataPDU {data.dataPDU}
 */
Client.prototype.readDataPDU = function (dataPDU) {
	switch(dataPDU.obj.shareDataHeader.obj.pduType2.value) {
	case data.PDUType2.PDUTYPE2_SET_ERROR_INFO_PDU:
		break;
	case data.PDUType2.PDUTYPE2_SHUTDOWN_DENIED:
		this.transport.close();
		break;
	case data.PDUType2.PDUTYPE2_SAVE_SESSION_INFO:
		this.emit('session');
		break;
	case data.PDUType2.PDUTYPE2_UPDATE:
		this.readUpdateDataPDU(dataPDU.obj.pduData)
		break;
	}
};

/**
 * Main upadate pdu receive function
 * @param updateDataPDU
 */
Client.prototype.readUpdateDataPDU = function (updateDataPDU) {
	switch(updateDataPDU.obj.updateType.value) {
	case data.UpdateType.UPDATETYPE_BITMAP:
		this.emit('bitmap', updateDataPDU.obj.updateData.obj.rectangles.obj)
		break;
	}
};

/**
 * send all client capabilities
 */
Client.prototype.sendConfirmActivePDU = function () {
	var generalCapability = this.clientCapabilities[caps.CapsType.CAPSTYPE_GENERAL].obj;
	generalCapability.osMajorType.value = caps.MajorType.OSMAJORTYPE_WINDOWS;
	generalCapability.osMinorType.value = caps.MinorType.OSMINORTYPE_WINDOWS_NT;
	generalCapability.extraFlags.value = 	caps.GeneralExtraFlag.LONG_CREDENTIALS_SUPPORTED 
										| 	caps.GeneralExtraFlag.NO_BITMAP_COMPRESSION_HDR 
										| 	caps.GeneralExtraFlag.ENC_SALTED_CHECKSUM
										|	caps.GeneralExtraFlag.FASTPATH_OUTPUT_SUPPORTED;
	
	var bitmapCapability = this.clientCapabilities[caps.CapsType.CAPSTYPE_BITMAP].obj;
	bitmapCapability.preferredBitsPerPixel.value = this.gccCore.highColorDepth.value;
    bitmapCapability.desktopWidth.value = this.gccCore.desktopWidth.value;
    bitmapCapability.desktopHeight.value = this.gccCore.desktopHeight.value;
    
    var orderCapability = this.clientCapabilities[caps.CapsType.CAPSTYPE_ORDER].obj;
    orderCapability.orderFlags.value |= caps.OrderFlag.ZEROBOUNDSDELTASSUPPORT;
    
    var inputCapability = this.clientCapabilities[caps.CapsType.CAPSTYPE_INPUT].obj;
    inputCapability.inputFlags.value = caps.InputFlags.INPUT_FLAG_SCANCODES | caps.InputFlags.INPUT_FLAG_MOUSEX | caps.InputFlags.INPUT_FLAG_UNICODE;
    inputCapability.keyboardLayout = this.gccCore.kbdLayout;
    inputCapability.keyboardType = this.gccCore.keyboardType;
    inputCapability.keyboardSubType = this.gccCore.keyboardSubType;
    inputCapability.keyboardrFunctionKey = this.gccCore.keyboardFnKeys;
    inputCapability.imeFileName = this.gccCore.imeFileName;
    
    var capabilities = new type.Component([]);
    for(var i in this.clientCapabilities) {
    	capabilities.obj.push(caps.capability(this.clientCapabilities[i]));
    }
    
    var confirmActivePDU = data.confirmActivePDU(capabilities, this.shareId);
    
    this.sendPDU(confirmActivePDU);
};

/**
 * send synchronize PDU
 */
Client.prototype.sendClientFinalizeSynchronizePDU = function() {
	this.sendDataPDU(data.synchronizeDataPDU(this.channelId));
	this.sendDataPDU(data.controlDataPDU(data.Action.CTRLACTION_COOPERATE));
	this.sendDataPDU(data.controlDataPDU(data.Action.CTRLACTION_REQUEST_CONTROL));
	this.sendDataPDU(data.fontListDataPDU());
};

/**
 * Send input event as slow path input
 * @param inputEvents {array}
 */
Client.prototype.sendInputEvents = function (inputEvents) {
	var pdu = data.clientInputEventPDU(new type.Component(inputEvents.map(function (e) {
		return data.slowPathInputEvent(e);
	})));
	
	this.sendDataPDU(pdu);
};

/**
 * Module exports
 */
module.exports = {
	Client : Client
};