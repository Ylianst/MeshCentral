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
var type = require('../../core').type;
var log = require('../../core').log;
var error = require('../../core').error;
var gcc = require('./gcc');
var per = require('./per');
var asn1 = require('../../asn1');
var cliprdr = require('../pdu/cliprdr');

var Message = {
	MCS_TYPE_CONNECT_INITIAL : 0x65,
	MCS_TYPE_CONNECT_RESPONSE : 0x66
};

var DomainMCSPDU = {
    ERECT_DOMAIN_REQUEST : 1,
    DISCONNECT_PROVIDER_ULTIMATUM : 8,
    ATTACH_USER_REQUEST : 10,
    ATTACH_USER_CONFIRM : 11,
    CHANNEL_JOIN_REQUEST : 14,
    CHANNEL_JOIN_CONFIRM : 15,
    SEND_DATA_REQUEST : 25,
    SEND_DATA_INDICATION : 26
};

var Channel = {
    MCS_GLOBAL_CHANNEL: 1003,
    MCS_USERCHANNEL_BASE: 1001,
    MCS_CLIPRDR_CHANNEL: 1005
};

/**
 * Channel Defined
 */
const RdpdrChannelDef = new type.Component({
    name: new type.BinaryString(Buffer.from('rdpdr' + '\x00\x00\x00', 'binary'), { readLength: new type.CallableValue(8) }),
    options: new type.UInt32Le(0x80800000)
});

const RdpsndChannelDef = new type.Component({
    name: new type.BinaryString(Buffer.from('rdpsnd' + '\x00\x00', 'binary'), { readLength: new type.CallableValue(8) }),
    options: new type.UInt32Le(0xc0000000)
});

const CliprdrChannelDef = new type.Component({
    name: new type.BinaryString(Buffer.from('cliprdr' + '\x00', 'binary'), { readLength: new type.CallableValue(8) }),
    // CHANNEL_OPTION_INITIALIZED |
    // CHANNEL_OPTION_ENCRYPT_RDP |
    // CHANNEL_OPTION_COMPRESS_RDP |
    // CHANNEL_OPTION_SHOW_PROTOCOL
    options: new type.UInt32Le(0xc0a00000)
});

/**
 * @see http://www.itu.int/rec/T-REC-T.125-199802-I/en page 25
 * @returns {asn1.univ.Sequence}
 */
function DomainParameters(maxChannelIds, maxUserIds, maxTokenIds, 
		numPriorities, minThoughput, maxHeight, maxMCSPDUsize, protocolVersion) {
	return new asn1.univ.Sequence({
		maxChannelIds : new asn1.univ.Integer(maxChannelIds),
		maxUserIds : new asn1.univ.Integer(maxUserIds),
		maxTokenIds : new asn1.univ.Integer(maxTokenIds),
		numPriorities : new asn1.univ.Integer(numPriorities),
		minThoughput : new asn1.univ.Integer(minThoughput),
		maxHeight : new asn1.univ.Integer(maxHeight),
		maxMCSPDUsize : new asn1.univ.Integer(maxMCSPDUsize),
		protocolVersion : new asn1.univ.Integer(protocolVersion)
	});
}

/**
 * @see http://www.itu.int/rec/T-REC-T.125-199802-I/en page 25
 * @param userData {Buffer}
 * @returns {asn1.univ.Sequence}
 */
function ConnectInitial (userData) {
	return new asn1.univ.Sequence({
		callingDomainSelector : new asn1.univ.OctetString(Buffer.from('\x01', 'binary')),
		calledDomainSelector : new asn1.univ.OctetString(Buffer.from('\x01', 'binary')),
		upwardFlag : new asn1.univ.Boolean(true),
		targetParameters : DomainParameters(34, 2, 0, 1, 0, 1, 0xffff, 2),
		minimumParameters : DomainParameters(1, 1, 1, 1, 0, 1, 0x420, 2),
		maximumParameters : DomainParameters(0xffff, 0xfc17, 0xffff, 1, 0, 1, 0xffff, 2),
		userData : new asn1.univ.OctetString(userData)
	}).implicitTag(new asn1.spec.Asn1Tag(asn1.spec.TagClass.Application, asn1.spec.TagFormat.Constructed, 101));
}

/**
 * @see http://www.itu.int/rec/T-REC-T.125-199802-I/en page 25
 * @returns {asn1.univ.Sequence}
 */
function ConnectResponse (userData) {
	return new asn1.univ.Sequence({
		result : new asn1.univ.Enumerate(0),
		calledConnectId : new asn1.univ.Integer(0),
		domainParameters : DomainParameters(22, 3, 0, 1, 0, 1,0xfff8, 2),
		userData : new asn1.univ.OctetString(userData)
	}).implicitTag(new asn1.spec.Asn1Tag(asn1.spec.TagClass.Application, asn1.spec.TagFormat.Constructed, 102));
}

/**
 * Format MCS PDU header packet
 * @param mcsPdu {integer}
 * @param options {integer}
 * @returns {type.UInt8} headers
 */
function writeMCSPDUHeader(mcsPdu, options) {
	options = options || 0;
    return new type.UInt8((mcsPdu << 2) | options);
}

/**
 * Read MCS PDU header
 * @param opcode
 * @param mcsPdu
 * @returns {Boolean}
 */
function readMCSPDUHeader(opcode, mcsPdu) {
	return (opcode >> 2) === mcsPdu;
}

/**
 * Multi-Channel Services
 * @param transport {events.EventEmitter} transport layer listen (connect, data) events
 * @param recvOpCode {DomainMCSPDU} opcode use in receive automata
 * @param sendOpCode {DomainMCSPDU} opcode use to send message
 */
function MCS(transport, recvOpCode, sendOpCode) {
	this.transport = transport;
	this.recvOpCode = recvOpCode;
	this.sendOpCode = sendOpCode;
    this.channels = [
        { id: Channel.MCS_GLOBAL_CHANNEL, name: 'global' },
        { id: Channel.MCS_CLIPRDR_CHANNEL, name: 'cliprdr' }
    ];
	this.channels.find = function(callback) {
		for(var i in this) {
			if(callback(this[i])) return this[i];
		};
	};
	
	// bind events
	var self = this;
	this.transport.on('close', function () {
		self.emit('close');
	}).on('error', function (err) {
		self.emit('error', err);
	});
}

//inherit from Layer
inherits(MCS, events.EventEmitter);

/**
 * Send message to a specific channel
 * @param channelName {string} name of channel
 * @param data {type.*} message to send
 */
MCS.prototype.send = function(channelName, data) {
	var channelId = this.channels.find(function(element) {
		if (element.name === channelName) return true;
	}).id;
	
	this.transport.send(new type.Component([
	    writeMCSPDUHeader(this.sendOpCode),
	    per.writeInteger16(this.userId, Channel.MCS_USERCHANNEL_BASE),
	    per.writeInteger16(channelId),
	    new type.UInt8(0x70),
	    per.writeLength(data.size()), 
	    data
	]));
};

/**
 * Main receive function
 * @param s {type.Stream}
 */
MCS.prototype.recv = function(s) {
	opcode = new type.UInt8().read(s).value;
	
	if (readMCSPDUHeader(opcode, DomainMCSPDU.DISCONNECT_PROVIDER_ULTIMATUM)) {
		log.info("MCS DISCONNECT_PROVIDER_ULTIMATUM");
		this.transport.close();
		return
	}
	else if(!readMCSPDUHeader(opcode, this.recvOpCode)) {
		throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_BAD_RECEIVE_OPCODE');
	}

	per.readInteger16(s, Channel.MCS_USERCHANNEL_BASE);
	
	var channelId = per.readInteger16(s);
	
	per.readEnumerates(s); 
	per.readLength(s);
	
	var channelName = this.channels.find(function(e) {
		if (e.id === channelId) return true;
	}).name;
	
	this.emit(channelName, s);
};

/**
 * Only main channels handle actually
 * @param transport {event.EventEmitter} bind connect and data events
 * @returns
 */
function Client(transport) {
	MCS.call(this, transport, DomainMCSPDU.SEND_DATA_INDICATION, DomainMCSPDU.SEND_DATA_REQUEST);
	
	// channel context automata
	this.channelsConnected = 0;
	
	// init gcc information
    this.clientCoreData = gcc.clientCoreData();
    // cliprdr channel
    this.clientNetworkData = gcc.clientNetworkData(new type.Component([RdpdrChannelDef, CliprdrChannelDef, RdpsndChannelDef]));
	this.clientSecurityData = gcc.clientSecurityData();
	
	// must be read from protocol
	this.serverCoreData = null;
	this.serverSecurityData = null;
	this.serverNetworkData = null;
	
	var self = this;
	this.transport.on('connect', function(s) {
		self.connect(s);
	});
}

inherits(Client, MCS);

/**
 * Connect event layer
 */
Client.prototype.connect = function(selectedProtocol) {
	this.clientCoreData.obj.serverSelectedProtocol.value = selectedProtocol;
	this.sendConnectInitial();
};

/**
 * close stack
 */
Client.prototype.close = function() {
	this.transport.close();
};

/**
 * MCS connect response (server->client)
 * @param s {type.Stream}
 */
Client.prototype.recvConnectResponse = function(s) {
    var userData = new type.Stream(ConnectResponse().decode(s, asn1.ber).value.userData.value);
    var serverSettings = gcc.readConferenceCreateResponse(userData);
    // record server gcc block
    for(var i in serverSettings) {
    	if(!serverSettings[i].obj) {
    		continue;
    	}
    	switch(serverSettings[i].obj.__TYPE__) {
    	case gcc.MessageType.SC_CORE:
    		this.serverCoreData = serverSettings[i];
    		break;
    	case gcc.MessageType.SC_SECURITY:
    		this.serverSecurityData = serverSettings[i];
    		break;
    	case gcc.MessageType.SC_NET:
    		this.serverNetworkData = serverSettings[i];
    		break;
    	default:
    		log.warn('unhandle server gcc block : ' + serverSettings[i].obj.__TYPE__);
    	}
    }
    
    // send domain request
    this.sendErectDomainRequest();
    // send attach user request
    this.sendAttachUserRequest();
    // now wait user confirm from server
	var self = this;
	this.transport.once('data', function(s) {
		self.recvAttachUserConfirm(s);
	});
};

/**
 * MCS connection automata step
 * @param s {type.Stream}
 */
Client.prototype.recvAttachUserConfirm = function(s) {
    if (!readMCSPDUHeader(new type.UInt8().read(s).value, DomainMCSPDU.ATTACH_USER_CONFIRM)) {
    	throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_BAD_HEADER');
    }
    
    if (per.readEnumerates(s) !== 0) {
    	throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_SERVER_REJECT_USER');
    }
    
    this.userId = per.readInteger16(s, Channel.MCS_USERCHANNEL_BASE);
    //ask channel for specific user
    this.channels.push({ id : this.userId, name : 'user' });
    // channel connect automata
    this.connectChannels();
};

/**
 * Last state in channel connection automata
 * @param s {type.Stream}
 */
Client.prototype.recvChannelJoinConfirm = function(s) {
    var opcode = new type.UInt8().read(s).value;
    
    if (!readMCSPDUHeader(opcode, DomainMCSPDU.CHANNEL_JOIN_CONFIRM)) {
    	throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_WAIT_CHANNEL_JOIN_CONFIRM');
    }
    
    var confirm = per.readEnumerates(s);
    
    var userId = per.readInteger16(s, Channel.MCS_USERCHANNEL_BASE);
    if (this.userId !== userId) {
    	throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_INVALID_USER_ID');
    }
    
    var channelId = per.readInteger16(s);

    //if ((confirm !== 0) && (channelId === Channel.MCS_GLOBAL_CHANNEL || channelId === this.userId)) {
    if ((confirm !== 0) && (channelId === Channel.MCS_CLIPRDR_CHANNEL || channelId === Channel.MCS_GLOBAL_CHANNEL || channelId === this.userId)) {
    	throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_MCS_SERVER_MUST_CONFIRM_STATIC_CHANNEL');
    }
    
    this.connectChannels();
};

/**
 * First MCS message
 */
Client.prototype.sendConnectInitial = function() {
	
	var ccReq = gcc.writeConferenceCreateRequest(new type.Component([
	    gcc.block(this.clientCoreData), 
	    gcc.block(this.clientNetworkData), 
	    gcc.block(this.clientSecurityData)
	])).toStream().getValue();
	
	this.transport.send(ConnectInitial(ccReq).encode(asn1.ber));
	
	// next event is connect response
	var self = this;
	this.transport.once('data', function(s) {
		self.recvConnectResponse(s);
	});
};

/**
 * MCS connection automata step
 */
Client.prototype.sendErectDomainRequest = function() {
    this.transport.send(new type.Component([
	    writeMCSPDUHeader(DomainMCSPDU.ERECT_DOMAIN_REQUEST),
	    per.writeInteger(0),
	    per.writeInteger(0)
    ]));
};

/**
 * MCS connection automata step
 */
Client.prototype.sendAttachUserRequest = function() {
    this.transport.send(writeMCSPDUHeader(DomainMCSPDU.ATTACH_USER_REQUEST));
};

/**
 * Send a channel join request
 * @param channelId {integer} channel id
 */
Client.prototype.sendChannelJoinRequest = function(channelId) {
	this.transport.send(new type.Component([
	    writeMCSPDUHeader(DomainMCSPDU.CHANNEL_JOIN_REQUEST),
	    per.writeInteger16(this.userId, Channel.MCS_USERCHANNEL_BASE),
	    per.writeInteger16(channelId)
    ]));
};

/**
 * Connect channels automata
 * @param s {type.Stream}
 */
Client.prototype.connectChannels = function(s) {
	if(this.channelsConnected == this.channels.length) {
		var self = this;
		this.transport.on('data', function(s) {
			self.recv(s);
		});
		
		// send client and sever gcc information
		this.emit('connect', 
				{
					core : this.clientCoreData.obj, 
					security : this.clientSecurityData.obj, 
					net : this.clientNetworkData.obj
				},
				{
					core : this.serverCoreData.obj,
					security : this.serverSecurityData.obj
				}, this.userId, this.channels);
		return;
	}
	
	this.sendChannelJoinRequest(this.channels[this.channelsConnected++].id);
	
	var self = this;
	this.transport.once('data', function(s) {
		self.recvChannelJoinConfirm(s);
	});
};

/**
 * Server side of MCS layer
 * @param transport
 */
function Server (transport) {
	MCS.call(this, transport, DomainMCSPDU.SEND_DATA_REQUEST, DomainMCSPDU.SEND_DATA_INDICATION);
	
	// must be readed from protocol
	this.clientCoreData = null;
	this.clientNetworkData = null;
	this.clientSecurityData = null;
	
	// init gcc information
	this.serverCoreData = gcc.serverCoreData();
	this.serverSecurityData = gcc.serverSecurityData();
	this.serverNetworkData = gcc.serverNetworkData(new type.Component([]));
	
	var self = this;
	this.transport.on('connect', function (selectedProtocol) {
		self.serverCoreData.obj.clientRequestedProtocol.value = selectedProtocol;
	}).once('data', function (s) {
		self.recvConnectInitial(s);
	});
}

inherits(Server, MCS);

/**
 * First state of server automata
 * @param s {type.Stream}
 */
Server.prototype.recvConnectInitial = function (s) {
	var userData = new type.Stream(ConnectInitial().decode(s, asn1.ber).value.userData.value);
	var clientSettings = gcc.readConferenceCreateRequest(userData);
    // record server gcc block
    for(var i in clientSettings) {
    	if(!clientSettings[i].obj) {
    		continue;
    	}
    	switch(clientSettings[i].obj.__TYPE__) {
    	case gcc.MessageType.CS_CORE:
    		this.clientCoreData = clientSettings[i];
    		break;
    	case gcc.MessageType.CS_SECURITY:
    		this.clientSecurityData = clientSettings[i];
    		break;
    	case gcc.MessageType.CS_NET:
    		this.clientNetworkData = clientSettings[i];
    		for (var i = 0; i < this.clientNetworkData.obj.channelCount.value; i++) {
    			this.serverNetworkData.obj.channelIdArray.obj.push(new type.UInt16Le( i + 1 + Channel.MCS_GLOBAL_CHANNEL));
    		}
    		break;
    	default:
    		log.debug('unhandle client gcc block : ' + clientSettings[i].obj.__TYPE__);
    	}
    }
    
    this.sendConnectResponse();
};

/**
 * State 2 in mcs server connection automata
 */
Server.prototype.sendConnectResponse = function () {
	var ccReq = gcc.writeConferenceCreateResponse(new type.Component([
 	    gcc.block(this.serverCoreData), 
 	    gcc.block(this.serverSecurityData),
 	    gcc.block(this.serverNetworkData),
 	])).toStream().getValue();
 	
 	this.transport.send(ConnectResponse(ccReq).encode(asn1.ber));
 	
};

/**
 * Module exports
 */
module.exports = {
		Client : Client,
		Server : Server
};
