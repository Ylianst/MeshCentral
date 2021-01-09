/*
Copyright 2018-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

var MemoryStream = require('MemoryStream');
var lme_id = 0;             // Our next channel identifier
var lme_port_offset = 0;    // Debug: Set this to "-100" to bind to 16892 & 16893 and IN_ADDRANY. This is for LMS debugging.
var xmlParser = require('amt-xml');

// Documented in: https://software.intel.com/sites/manageability/AMT_Implementation_and_Reference_Guide/HTMLDocuments/MPSDocuments/Intel%20AMT%20Port%20Forwarding%20Protocol%20Reference%20Manual.pdf
var APF_DISCONNECT = 1;
var APF_SERVICE_REQUEST = 5;
var APF_SERVICE_ACCEPT = 6;
var APF_USERAUTH_REQUEST = 50;
var APF_USERAUTH_FAILURE = 51;
var APF_USERAUTH_SUCCESS = 52;
var APF_GLOBAL_REQUEST = 80;
var APF_REQUEST_SUCCESS = 81;
var APF_REQUEST_FAILURE = 82;
var APF_CHANNEL_OPEN = 90;
var APF_CHANNEL_OPEN_CONFIRMATION = 91;
var APF_CHANNEL_OPEN_FAILURE = 92;
var APF_CHANNEL_WINDOW_ADJUST = 93;
var APF_CHANNEL_DATA = 94;
var APF_CHANNEL_CLOSE = 97;
var APF_PROTOCOLVERSION = 192;


function lme_object() {
    this.ourId = ++lme_id;
    this.amtId = -1;
    this.LME_CHANNEL_STATUS = 'LME_CS_FREE';
    this.txWindow = 0;
    this.rxWindow = 0;
    this.localPort = 0;
    this.errorCount = 0;
}

function stream_bufferedWrite() {
    var emitterUtils = require('events').inherits(this);
    this.buffer = [];
    this._readCheckImmediate = undefined;
    this._ObjectID = "bufferedWriteStream";
    // Writable Events
    emitterUtils.createEvent('close');
    emitterUtils.createEvent('drain');
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('finish');
    emitterUtils.createEvent('pipe');
    emitterUtils.createEvent('unpipe');
    
    // Readable Events
    emitterUtils.createEvent('readable');
    this.isEmpty = function () {
        return (this.buffer.length == 0);
    };
    this.isWaiting = function () {
        return (this._readCheckImmediate == undefined);
    };
    this.write = function (chunk) {
        for (var args in arguments) { if (typeof (arguments[args]) == 'function') { this.once('drain', arguments[args]); break; } }
        var tmp = Buffer.alloc(chunk.length);
        chunk.copy(tmp);
        this.buffer.push({ offset: 0, data: tmp });
        this.emit('readable');
        return (this.buffer.length == 0 ? true : false);
    };
    this.read = function () {
        var size = arguments.length == 0 ? undefined : arguments[0];
        var bytesRead = 0;
        var list = [];
        while ((size == undefined || bytesRead < size) && this.buffer.length > 0) {
            var len = this.buffer[0].data.length - this.buffer[0].offset;
            var offset = this.buffer[0].offset;
            
            if (len > (size - bytesRead)) {
                // Only reading a subset
                list.push(this.buffer[0].data.slice(offset, offset + size - bytesRead));
                this.buffer[0].offset += (size - bytesRead);
                bytesRead += (size - bytesRead);
            } else {
                // Reading the entire thing
                list.push(this.buffer[0].data.slice(offset));
                bytesRead += len;
                this.buffer.shift();
            }
        }
        this._readCheckImmediate = setImmediate(function (buffered) {
            buffered._readCheckImmediate = undefined;
            if (buffered.buffer.length == 0) {
                buffered.emit('drain'); // Drained
            } else {
                buffered.emit('readable'); // Not drained
            }
        }, this);
        return (Buffer.concat(list));
    };
}


function lme_heci(options) {
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('connect');
    emitterUtils.createEvent('notify');
    emitterUtils.createEvent('bind');
    
    this.on('newListener', function (name, func) { if (name == 'connect' && this._LME._connected == true) { func.call(this);} });
    if ((options != null) && (options.debug == true)) { lme_port_offset = -100; } // LMS debug mode

    var heci = require('heci');
    this.INITIAL_RXWINDOW_SIZE = 4096;
    
    this._ObjectID = "lme";
    this._LME = heci.create();
    this._LME._connected = false;
    this._LME.descriptorMetadata = "amt-lme";
    this._LME._binded = {};
    this._LME.LMS = this;
    this._LME.on('error', function (e) { this.LMS.emit('error', e); });
    this._LME.on('connect', function ()
    {
        this._connected = true;
        this.on('data', function (chunk) {
            // this = HECI
            var cmd = chunk.readUInt8(0);
            //console.log('LME Command ' + cmd + ', ' + chunk.length + ' byte(s).');
            
            switch (cmd) {
                default:
                    console.log('Unhandled LME Command ' + cmd + ', ' + chunk.length + ' byte(s).');
                    break;
                case APF_SERVICE_REQUEST:
                    var nameLen = chunk.readUInt32BE(1);
                    var name = chunk.slice(5, nameLen + 5);
                    //console.log("Service Request for: " + name);
                    if (name == 'pfwd@amt.intel.com' || name == 'auth@amt.intel.com') {
                        var outBuffer = Buffer.alloc(5 + nameLen);
                        outBuffer.writeUInt8(6, 0);
                        outBuffer.writeUInt32BE(nameLen, 1);
                        outBuffer.write(name.toString(), 5);
                        this.write(outBuffer);
                        //console.log('Answering APF_SERVICE_REQUEST');
                    } else {
                        //console.log('UNKNOWN APF_SERVICE_REQUEST');
                    }
                    break;
                case APF_GLOBAL_REQUEST:
                    var nameLen = chunk.readUInt32BE(1);
                    var name = chunk.slice(5, nameLen + 5).toString();

                    switch (name) {
                        case 'tcpip-forward':
                            var len = chunk.readUInt32BE(nameLen + 6);
                            var port = chunk.readUInt32BE(nameLen + 10 + len);
                            //console.log("[" + chunk.length + "/" + len + "] APF_GLOBAL_REQUEST for: " + name + " on port " + port);
                            if (this[name] == undefined) { this[name] = {}; }
                            if (this[name][port] != null) { // Close the existing binding
                                for (var i in this.sockets) {
                                    var channel = this.sockets[i];
                                    if (channel.localPort == port) { this.sockets[i].end(); delete this.sockets[i]; } // Close this socket
                                }
                            }
                            if (this[name][port] == null)
                            {
                                try {
                                    // Bind a new server socket if not already present
                                    this[name][port] = require('net').createServer();
                                    this[name][port].descriptorMetadata = 'amt-lme (port: ' + port + ')';
                                    this[name][port].HECI = this;
                                    if (lme_port_offset == 0) {
                                        this[name][port].listen({ port: port, host: '127.0.0.1' }); // Normal mode
                                    } else {
                                        this[name][port].listen({ port: (port + lme_port_offset) }); // Debug mode
                                    }
                                    this[name][port].on('connection', function (socket) {
                                        //console.log('New [' + socket.remoteFamily + '] TCP Connection on: ' + socket.remoteAddress + ' :' + socket.localPort);
                                        this.HECI.LMS.bindDuplexStream(socket, socket.remoteFamily, socket.localPort - lme_port_offset);
                                    });
                                    this._binded[port] = true;
                                    this.LMS.emit('bind', this._binded);
                                } catch (ex) { console.log(ex, 'Port ' + port); }
                            }
                            var outBuffer = Buffer.alloc(5);
                            outBuffer.writeUInt8(81, 0);
                            outBuffer.writeUInt32BE(port, 1);
                            this.write(outBuffer);
                            break;
                        case 'cancel-tcpip-forward':
                            var outBuffer = Buffer.alloc(1);
                            outBuffer.writeUInt8(APF_REQUEST_SUCCESS, 0);
                            this.write(outBuffer);
                            break;
                        case 'udp-send-to@amt.intel.com':
                            var outBuffer = Buffer.alloc(1);
                            outBuffer.writeUInt8(APF_REQUEST_FAILURE, 0);
                            this.write(outBuffer);
                            break;
                        default:
                            //console.log("Unknown APF_GLOBAL_REQUEST for: " + name);
                            break;
                    }
                    break;
                case APF_CHANNEL_OPEN_CONFIRMATION:
                    var rChannel = chunk.readUInt32BE(1);
                    var sChannel = chunk.readUInt32BE(5);
                    var wSize = chunk.readUInt32BE(9);
                    //console.log('rChannel/' + rChannel + ', sChannel/' + sChannel + ', wSize/' + wSize);
                    if (this.sockets[rChannel] != undefined) {
                        this.sockets[rChannel].lme.amtId = sChannel;
                        this.sockets[rChannel].lme.rxWindow = wSize;
                        this.sockets[rChannel].lme.txWindow = wSize;
                        this.sockets[rChannel].lme.LME_CHANNEL_STATUS = 'LME_CS_CONNECTED';
                        //console.log('LME_CS_CONNECTED');
                        this.sockets[rChannel].bufferedStream = new stream_bufferedWrite();
                        this.sockets[rChannel].bufferedStream.socket = this.sockets[rChannel];
                        this.sockets[rChannel].bufferedStream.on('readable', function () {
                            if (this.socket.lme.txWindow > 0) {
                                var buffer = this.read(this.socket.lme.txWindow);
                                var packet = Buffer.alloc(9 + buffer.length);
                                packet.writeUInt8(APF_CHANNEL_DATA, 0);
                                packet.writeUInt32BE(this.socket.lme.amtId, 1);
                                packet.writeUInt32BE(buffer.length, 5);
                                buffer.copy(packet, 9);
                                this.socket.lme.txWindow -= buffer.length;
                                this.socket.HECI.write(packet);
                            }
                        });
                        this.sockets[rChannel].bufferedStream.on('drain', function () {
                            this.socket.resume();
                        });
                        this.sockets[rChannel].on('data', function (chunk) {
                            if (!this.bufferedStream.write(chunk)) { this.pause(); }
                        });
                        this.sockets[rChannel].on('end', function () {
                            var outBuffer = Buffer.alloc(5);
                            outBuffer.writeUInt8(APF_CHANNEL_CLOSE, 0);
                            outBuffer.writeUInt32BE(this.lme.amtId, 1);
                            this.HECI.write(outBuffer);
                        });
                        this.sockets[rChannel].resume();
                    }
                    
                    break;
                case APF_PROTOCOLVERSION:
                    var major = chunk.readUInt32BE(1);
                    var minor = chunk.readUInt32BE(5);
                    var reason = chunk.readUInt32BE(9);
                    var outBuffer = Buffer.alloc(93);
                    outBuffer.writeUInt8(192, 0);
                    outBuffer.writeUInt32BE(1, 1);
                    outBuffer.writeUInt32BE(0, 5);
                    outBuffer.writeUInt32BE(reason, 9);
                    //console.log('Answering PROTOCOL_VERSION');
                    this.write(outBuffer);
                    break;
                case APF_CHANNEL_WINDOW_ADJUST:
                    var rChannelId = chunk.readUInt32BE(1);
                    var bytesToAdd = chunk.readUInt32BE(5);
                    if (this.sockets[rChannelId] != undefined) {
                        this.sockets[rChannelId].lme.txWindow += bytesToAdd;
                        if (!this.sockets[rChannelId].bufferedStream.isEmpty() && this.sockets[rChannelId].bufferedStream.isWaiting()) {
                            this.sockets[rChannelId].bufferedStream.emit('readable');
                        }
                    } else {
                        console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_WINDOW_ADJUST');
                    }
                    break;
                case APF_CHANNEL_DATA:
                    var rChannelId = chunk.readUInt32BE(1);
                    var dataLen = chunk.readUInt32BE(5);
                    var data = chunk.slice(9, 9 + dataLen);
                    if ((this.sockets != null) && (this.sockets[rChannelId] != undefined)) {
                        this.sockets[rChannelId].pendingBytes.push(data.length);
                        this.sockets[rChannelId].write(data, function () {
                            var written = this.pendingBytes.shift();
                            //console.log('adjust', this.lme.amtId, written);
                            var outBuffer = Buffer.alloc(9);
                            outBuffer.writeUInt8(APF_CHANNEL_WINDOW_ADJUST, 0);
                            outBuffer.writeUInt32BE(this.lme.amtId, 1);
                            outBuffer.writeUInt32BE(written, 5);
                            this.HECI.write(outBuffer);
                        });
                    } else if ((this.insockets != null) && (this.insockets[rChannelId] != undefined)) {
                        var channel = this.insockets[rChannelId];
                        if (channel.data == null) { channel.data = data.toString(); } else { channel.data += data.toString(); }
                        channel.rxWindow += dataLen;
                        //console.log('IN DATA', channel.rxWindow, channel.data.length, dataLen, channel.amtId, data.toString());
                        var httpData = parseHttp(channel.data);
                        if ((httpData != null) || (channel.data.length >= 8000)) {
                            // Parse the WSMAN
                            var notify = null;
                            try { notify = xmlParser.ParseWsman(httpData); } catch (e) { }

                            // Event the http data
                            if (notify != null) { this.LMS.emit('notify', notify, channel.options, _lmsNotifyToString(notify), _lmsNotifyToCode(notify)); }

                            // Send channel close
                            var buffer = Buffer.alloc(5);
                            buffer.writeUInt8(APF_CHANNEL_CLOSE, 0);
                            buffer.writeUInt32BE(amtId, 1);
                            this.write(buffer);
                        } else {
                            if (channel.rxWindow > 6000) {
                                // Send window adjust
                                var buffer = Buffer.alloc(9);
                                buffer.writeUInt8(APF_CHANNEL_WINDOW_ADJUST, 0);
                                buffer.writeUInt32BE(channel.amtId, 1);
                                buffer.writeUInt32BE(channel.rxWindow, 5);
                                this.write(buffer);
                                channel.rxWindow = 0;
                            }
                        }
                    } else {
                        console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_DATA');
                    }
                    break;
                case APF_CHANNEL_OPEN_FAILURE:
                    var rChannelId = chunk.readUInt32BE(1);
                    var reasonCode = chunk.readUInt32BE(5);
                    if ((this.sockets != null) && (this.sockets[rChannelId] != undefined)) {
                        this.sockets[rChannelId].end();
                        delete this.sockets[rChannelId];
                    } else if ((this.insockets != null) && (this.insockets[rChannelId] != undefined)) {
                        delete this.insockets[rChannelId];
                    } else {
                        console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_OPEN_FAILURE');
                    }
                    break;
                case APF_CHANNEL_CLOSE:
                    var rChannelId = chunk.readUInt32BE(1);
                    if ((this.sockets != null) && (this.sockets[rChannelId] != undefined)) {
                        this.sockets[rChannelId].end();
                        var amtId = this.sockets[rChannelId].lme.amtId;
                        var buffer = Buffer.alloc(5);
                        delete this.sockets[rChannelId];
                        
                        buffer.writeUInt8(APF_CHANNEL_CLOSE, 0); // ????????????????????????????
                        buffer.writeUInt32BE(amtId, 1);
                        this.write(buffer);
                    } else if ((this.insockets != null) && (this.insockets[rChannelId] != undefined)) {
                        delete this.insockets[rChannelId];
                        // Should I send a close back????
                    } else {
                        console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_CLOSE');
                    }
                    break;
                case APF_CHANNEL_OPEN:
                    var nameLen = chunk.readUInt32BE(1);
                    var name = chunk.slice(5, nameLen + 5).toString();
                    var channelSender = chunk.readUInt32BE(nameLen + 5);
                    var initialWindowSize = chunk.readUInt32BE(nameLen + 9);
                    var hostToConnectLen = chunk.readUInt32BE(nameLen + 17);
                    var hostToConnect = chunk.slice(nameLen + 21, nameLen + 21 + hostToConnectLen).toString();
                    var portToConnect = chunk.readUInt32BE(nameLen + 21 + hostToConnectLen);
                    var originatorIpLen = chunk.readUInt32BE(nameLen + 25 + hostToConnectLen);
                    var originatorIp = chunk.slice(nameLen + 29 + hostToConnectLen, nameLen + 29 + hostToConnectLen + originatorIpLen).toString();
                    var originatorPort = chunk.readUInt32BE(nameLen + 29 + hostToConnectLen + originatorIpLen);
                    //console.log('APF_CHANNEL_OPEN', name, channelSender, initialWindowSize, 'From: ' + originatorIp + ':' + originatorPort, 'To: ' + hostToConnect + ':' + portToConnect);

                    if (this.insockets == null) { this.insockets = {}; }
                    var ourId = ++lme_id;
                    var insocket = new lme_object();
                    insocket.ourId = ourId;
                    insocket.amtId = channelSender;
                    insocket.txWindow = initialWindowSize;
                    insocket.rxWindow = 0;
                    insocket.options = { target: hostToConnect, targetPort: portToConnect, source: originatorIp, sourcePort: originatorPort };
                    this.insockets[ourId] = insocket;

                    var buffer = Buffer.alloc(17);
                    buffer.writeUInt8(APF_CHANNEL_OPEN_CONFIRMATION, 0);
                    buffer.writeUInt32BE(channelSender, 1);     // Intel AMT sender channel
                    buffer.writeUInt32BE(ourId, 5);             // Our receiver channel id
                    buffer.writeUInt32BE(4000, 9);              // Initial Window Size
                    buffer.writeUInt32BE(0xFFFFFFFF, 13);       // Reserved
                    this.write(buffer);

                    /*
                    var buffer = Buffer.alloc(17);
                    buffer.writeUInt8(APF_CHANNEL_OPEN_FAILURE, 0);
                    buffer.writeUInt32BE(channelSender, 1);     // Intel AMT sender channel
                    buffer.writeUInt32BE(2, 5);                 // Reason code
                    buffer.writeUInt32BE(0, 9);                 // Reserved
                    buffer.writeUInt32BE(0, 13);                // Reserved
                    this.write(buffer);
                    console.log('Sent APF_CHANNEL_OPEN_FAILURE', channelSender);
                    */

                    break;
            }
        });
        this.LMS.emit('connect');
        this.resume();

    });
    
    this.bindDuplexStream = function (duplexStream, remoteFamily, localPort) {
        var socket = duplexStream;
        //console.log('New [' + remoteFamily + '] Virtual Connection/' + socket.localPort);
        socket.pendingBytes = [];
        socket.HECI = this._LME;
        socket.LMS = this;
        socket.lme = new lme_object();
        socket.lme.Socket = socket;
        socket.localPort = localPort;
        var buffer = new MemoryStream();
        buffer.writeUInt8(0x5A);
        buffer.writeUInt32BE(15);
        buffer.write('forwarded-tcpip');
        buffer.writeUInt32BE(socket.lme.ourId);
        buffer.writeUInt32BE(this.INITIAL_RXWINDOW_SIZE);
        buffer.writeUInt32BE(0xFFFFFFFF);
        for (var i = 0; i < 2; ++i) {
            if (remoteFamily == 'IPv6') {
                buffer.writeUInt32BE(3);
                buffer.write('::1');
            } else {
                buffer.writeUInt32BE(9);
                buffer.write('127.0.0.1');
            }
            buffer.writeUInt32BE(localPort);
        }
        this._LME.write(buffer.buffer);
        if (this._LME.sockets == undefined) { this._LME.sockets = {}; }
        this._LME.sockets[socket.lme.ourId] = socket;
        socket.pause();
    };
    
    this._LME.connect(heci.GUIDS.LME, { noPipeline: 0 });
}

function parseHttp(httpData) {
    var i = httpData.indexOf('\r\n\r\n');
    if ((i == -1) || (httpData.length < (i + 2))) { return null; }
    var headers = require('http-headers')(httpData.substring(0, i), true);
    var contentLength = parseInt(headers['content-length']);
    if (httpData.length >= contentLength + i + 4) { return httpData.substring(i + 4, i + 4 + contentLength); }
    return null;
}

function _lmsNotifyToCode(notify) {
    if ((notify == null) || (notify.Body == null) || (notify.Body.MessageID == null)) return null;
    var msgid = notify.Body.MessageID;
    try { msgid += '-' + notify.Body.MessageArguments[0]; } catch (e) { }
    return msgid;
}

function _lmsNotifyToString(notify) {
    if ((notify == null) || (notify.Body == null) || (notify.Body.MessageID == null)) return null;
    var msgid = notify.Body.MessageID;
    try { msgid += '-' + notify.Body.MessageArguments[0]; } catch (e) { }
    if (lmsEvents[msgid]) { return lmsEvents[msgid]; }
    return null;
}

var lmsEvents = {
    "iAMT0001": "System Defense Policy %1s triggered.",
    "iAMT0002": "Agent Presence Agent %1s not started.",
    "iAMT0003": "Agent Presence Agent %1s stopped.",
    "iAMT0004": "Agent Presence Agent %1s running.",
    "iAMT0005": "Agent Presence Agent %1s expired.",
    "iAMT0006": "Agent Presence Agent %1s suspended.",
    "iAMT0007": "Host software attempt to disable AMT Network link detected.",
    "iAMT0008": "Host software attempt to disable AMT Network link detected -- Host Network link blocked.",
    "iAMT0009": "AMT clock or FLASH wear-out protection disabled.",
    "iAMT0010": "Intel(R) AMT Network Interface %1s heuristics defense slow threshold trespassed.",
    "iAMT0011": "Intel(R) AMT Network Interface %1s heuristics defense fast threshold trespassed.",
    "iAMT0012": "Intel(R) AMT Network Interface %1s heuristics defense factory defined threshold trespassed.",
    "iAMT0013": "Intel(R) AMT Network Interface %1s heuristics defense Encounter timeout expired.",
    "iAMT0014": "General certificate error.",
    "iAMT0015": "Certificate expired.",
    "iAMT0016": "No trusted root certificate.",
    "iAMT0017": "Not configured to work with server certificate.",
    "iAMT0018": "Certificate revoked.",
    "iAMT0019": "RSA exponent too large.",
    "iAMT0020": "RSA modulus too large.",
    "iAMT0021": "Unsupported digest.",
    "iAMT0022": "Distinguished name too long.",
    "iAMT0023": "Key usage missing.",
    "iAMT0024": "General SSL handshake error.",
    "iAMT0025": "General 802.1x error.",
    "iAMT0026": "AMT Diagnostic AlertEAC error - General NAC error.",
    "iAMT0027": "AMT Diagnostic AlertEAC error - attempt to get a NAC posture while AMT NAC is disabled.",
    "iAMT0028": "AMT Diagnostic AlertEAC error - attempt to get a posture of an unsupported type.",
    "iAMT0029": "Audit log storage is 50% full.",
    "iAMT0030": "Audit log storage is 75% full.",
    "iAMT0031": "Audit log storage is 85% full.",
    "iAMT0032": "Audit log storage is 95% full.",
    "iAMT0033": "Audit log storage is full.",
    "iAMT0034": "Firmware Update Event - Partial.",
    "iAMT0035": "Firmware Update Event - Failure.",
    "iAMT0036": "Remote connectivity initiated.",
    "iAMT0037": "ME Presence event.",
    "iAMT0038-0": "AMT is being unprovisioned using BIOS command.",
    "iAMT0038-1": "AMT is being unprovisioned using Local MEI command.",
    "iAMT0038-2": "AMT is being unprovisioned using Local WS-MAN/SOAP command.",
    "iAMT0038-3": "AMT is being unprovisioned using Remote WS-MAN/SOAP command.",
    "iAMT0039": "HW Asset Error.",
    "iAMT0050": "User Notification Alert - General Notification.",
    "iAMT0050-16": "User Notification Alert - Circuit Breaker notification (CB Drop TX filter hit.).",
    "iAMT0050-17": "User Notification Alert - Circuit Breaker notification (CB Rate Limit TX filter hit.).",
    "iAMT0050-18": "User Notification Alert - Circuit Breaker notification (CB Drop RX filter hit.).",
    "iAMT0050-19": "User Notification Alert - Circuit Breaker notification (CB Rate Limit RX filter hit.).",
    "iAMT0050-32": "User Notification Alert - EAC notification.",
    "iAMT0050-48": "User Notification Alert - Remote diagnostics - (Remote Redirection session started - SOL).",
    "iAMT0050-49": "User Notification Alert - Remote diagnostics - (Remote Redirection session stopped - SOL).",
    "iAMT0050-50": "User Notification Alert - Remote diagnostics. (Remote Redirection session started - IDE-R).",
    "iAMT0050-51": "User Notification Alert - Remote diagnostics. (Remote Redirection session stopped - IDE-R).",
    "iAMT0050-66": "User Notification Alert - WLAN notification (Host profile mismatch - Management Interface ignored).",
    "iAMT0050-67": "User Notification Alert - WLAN notification (Management device overrides host radio).",
    "iAMT0050-68": "User Notification Alert - WLAN notification (Host profile security mismatch).",
    "iAMT0050-69": "User Notification Alert - WLAN notification (Management device relinquishes control over host Radio).",
    "iAMT0051": "User Notification Alert - SecIo event.",
    "iAMT0051-0": "User Notification Alert - SecIo event semaphore at host.",
    "iAMT0051-1": "User Notification Alert - semaphore at ME.",
    "iAMT0051-2": "User Notification Alert - SecIo event - semaphore timeout.",
    "iAMT0052": "User Notification Alert - KVM session event.",
    "iAMT0052-0": "User Notification Alert - KVM session requested.",
    "iAMT0052-1": "User Notification Alert - KVM session started.",
    "iAMT0052-2": "User Notification Alert - KVM session stopped.",
    "iAMT0052-3": "User Notification Alert - KVM data channel.",
    "iAMT0053": "User Notification Alert - RCS notification.",
    "iAMT0053-50": "User Notification Alert - RCS notification (HW button pressed. Connection initiated automatically).",
    "iAMT0053-52": "User Notification Alert - RCS notification (HW button pressed. Connection wasn't initiated automatically).",
    "iAMT0053-53": "User Notification Alert - RCS notification (Contracts updated).",
    "iAMT0054": "User Notification Alert - WLAN notification. Wireless Profile sync enablement state changed.",
    "iAMT0055": "User Notification Alert - Provisioning state change notification.",
    "iAMT0055-0": "User Notification Alert - Provisioning state change notification - Pre-configuration.",
    "iAMT0055-1": "User Notification Alert - Provisioning state change notification - In configuration.",
    "iAMT0055-2": "User Notification Alert - Provisioning state change notification - Post-configuration.",
    "iAMT0055-3": "User Notification Alert - Provisioning state change notification - Unprovision process has started.",
    "iAMT0056": "User Notification Alert - System Defense change notification.",
    "iAMT0057": "User Notification Alert - Network State change notification.",
    "iAMT0058": "User Notification Alert - Remote Access change notification.",
    "iAMT0058-1": "User Notification Alert - Remote Access change notification - tunnel is closed.",
    //"iAMT0058-1": "User Notification Alert - Remote Access change notification - tunnel is open.", // TODO
    "iAMT0059": "User Notification Alert - KVM enabled event.",
    "iAMT0059-0": "User Notification Alert - KVM enabled event - KVM disabled.",
    "iAMT0059-1": "User Notification Alert - KVM enabled event - KVM enabled (both from MEBx and PTNI).",
    "iAMT0060": "User Notification Alert - SecIO configuration event.",
    "iAMT0061": "ME FW reset occurred.",
    "iAMT0062": "User Notification Alert - IpSyncEnabled event.",
    "iAMT0062-0": "User Notification Alert - IpSyncEnabled event - IpSync disabled.",
    "iAMT0062-1": "User Notification Alert - IpSyncEnabled event - IpSync enabled.",
    "iAMT0063": "User Notification Alert - HTTP Proxy sync enabled event.",
    "iAMT0063-0": "User Notification Alert - HTTP Proxy sync enabled event - HTTP Proxy Sync disabled.",
    "iAMT0063-1": "User Notification Alert - HTTP Proxy sync enabled event - HTTP Proxy Sync enabled.",
    "iAMT0064": "User Notification Alert - User Consent event.",
    "iAMT0064-1": "User Notification Alert - User Consent event - User Consent granted.",
    "iAMT0064-2": "User Notification Alert - User Consent event - User Consent ended.",
    "iAMT0067-0": "Graceful Remote Control Operation - Shutdown.",
    "iAMT0067-1": "Graceful Remote Control Operation - Reset.",
    "iAMT0067-2": "Graceful Remote Control Operation - Hibernate.",
    "iAMT0068-0": "Link Protection Notification - No link protection.",
    "iAMT0068-1": "Link Protection Notification - Passive link protection.",
    "iAMT0068-2": "Link Protection Notification - High link protection.",
    "iAMT0069-0": "Local Time Sync Enablement Notification - Local Time Sync Disabled.",
    "iAMT0069-1": "Local Time Sync Enablement Notification - Local Time Sync Enabled.",
    "iAMT0070": "Host Reset Triggered by WD Expiration Notification.",
    "PLAT0004": "The chassis %1s was opened.",
    "PLAT0005": "The chassis %1s was closed.",
    "PLAT0006": "The drive bay %1s was opened.",
    "PLAT0007": "The drive bay %1s was closed.",
    "PLAT0008": "The I/O card area %1s was opened.",
    "PLAT0009": "The I/O card area %1s was closed.",
    "PLAT0010": "The processor area %1s was opened.",
    "PLAT0011": "The processor area %1s was closed.",
    "PLAT0012": "The LAN %1s has been disconnected.",
    "PLAT0013": "The LAN %1s has been connected.",
    "PLAT0016": "The permission to insert package %1s has been granted.",
    "PLAT0017": "The permission to insert package %1s has been removed.",
    "PLAT0018": "The fan card area %1s is open.",
    "PLAT0019": "The fan card area %1s is closed.",
    "PLAT0022": "The computer system %1s has detected a secure mode violation.",
    "PLAT0024": "The computer system %1s has detected a pre-boot user password violation.",
    "PLAT0026": "The computer system %1s has detected a pre-boot setup password violation.",
    "PLAT0028": "The computer system %1s has detected a network boot password violation.",
    "PLAT0030": "The computer system %1s has detected a password violation.",
    "PLAT0032": "The management controller %1s has detected an out-of-band password violation.",
    "PLAT0034": "The processor %1s has been added.",
    "PLAT0035": "The processor %1s has been removed.",
    "PLAT0036": "An over-temperature condition has been detected on the processor %1s.",
    "PLAT0037": "An over-temperature condition has been removed on the processor %1s.",
    "PLAT0038": "The processor %1s is operating in a degraded State.",
    "PLAT0039": "The processor %1s is no longer operating in a degraded State.",
    "PLAT0040": "The processor %1s has failed.",
    "PLAT0042": "The processor %1s has failed.",
    "PLAT0044": "The processor %1s has failed.",
    "PLAT0046": "The processor %1s has failed.",
    "PLAT0048": "The processor %1s has failed.",
    "PLAT0060": "The processor %1s has been enabled.",
    "PLAT0061": "The processor %1s has been disabled.",
    "PLAT0062": "The processor %1s has a configuration mismatch.",
    "PLAT0064": "A terminator has been detected on the processor %1s.",
    "PLAT0084": "The Power Supply %1s has been added.",
    "PLAT0085": "The Power Supply %1s has been removed.",
    "PLAT0086": "The Power Supply %1s has failed.",
    "PLAT0088": "Failure predicted on power supply %1s.",
    "PLAT0096": "The input to power supply %1s has been lost or fallen out of range.",
    "PLAT0098": "The power supply %1s is operating in an input state that is out of range.",
    "PLAT0099": "The power supply %1s has returned to a normal input state.",
    "PLAT0100": "The power supply %1s has lost input.",
    "PLAT0104": "The power supply %1s has a configuration mismatch.",
    "PLAT0106": "Power supply %1s has been disabled.",
    "PLAT0107": "Power supply %1s has been enabled.",
    "PLAT0108": "Power supply %1s has been power cycled.",
    "PLAT0110": "Power supply %1s has encountered an error during power down.",
    "PLAT0112": "Power supply %1s has lost power.",
    "PLAT0114": "Soft power control has failed for power supply %1s.",
    "PLAT0116": "Power supply %1s has failed.",
    "PLAT0118": "Failure predicted on power supply %1s.",
    "PLAT0120": "Memory subsystem failure.",
    "PLAT0122": "DIMM missing.",
    "PLAT0124": "Memory error detected & corrected for DIMM %1s.",
    "PLAT0128": "Memory DIMM %1s added.",
    "PLAT0129": "Memory DIMM %1s removed.",
    "PLAT0130": "Memory DIMM %1s enabled.",
    "PLAT0131": "Memory DIMM %1s disabled.",
    "PLAT0134": "Memory parity error for DIMM %1s.",
    "PLAT0136": "Memory scrub failure for DIMM %1s.",
    "PLAT0138": "Memory uncorrectable error detected for DIMM %1s.",
    "PLAT0140": "Memory sparing initiated for DIMM %1s.",
    "PLAT0141": "Memory sparing concluded for DIMM %1s.",
    "PLAT0142": "Memory DIMM %1s Throttled.",
    "PLAT0144": "Memory logging limit reached for DIMM %1s.",
    "PLAT0145": "Memory logging limit removed for DIMM %1s.",
    "PLAT0146": "An over-temperature condition has been detected on the Memory DIMM %1s.",
    "PLAT0147": "An over-temperature condition has been removed on the Memory DIMM %1s.",
    "PLAT0162": "The drive %1s has been added.",
    "PLAT0163": "The drive %1s has been removed.",
    "PLAT0164": "The drive %1s has been disabled due to a detected fault.",
    "PLAT0167": "The drive %1s has been enabled.",
    "PLAT0168": "Failure predicted on drive %1s.",
    "PLAT0170": "Hot spare enabled for %1s.",
    "PLAT0171": "Hot spare disabled for %1s.",
    "PLAT0172": "Consistency check has begun for %1s.",
    "PLAT0173": "Consistency check completed for %1s.",
    "PLAT0174": "Array %1s is in critical condition.",
    "PLAT0176": "Array %1s has failed.",
    "PLAT0177": "Array %1s has been restored.",
    "PLAT0178": "Rebuild in progress for array %1s.",
    "PLAT0179": "Rebuild completed for array %1s.",
    "PLAT0180": "Rebuild Aborted for array %1s.",
    "PLAT0184": "The system %1s encountered a POST error.",
    "PLAT0186": "The system %1s encountered a firmware hang.",
    "PLAT0188": "The system %1s encountered firmware progress.",
    "PLAT0192": "The log %1s has been disabled.",
    "PLAT0193": "The log %1s has been enabled.",
    "PLAT0194": "The log %1s has been disabled.",
    "PLAT0195": "The log %1s has been enabled.",
    "PLAT0196": "The log %1s has been disabled.",
    "PLAT0198": "The log %1s has been enabled.",
    "PLAT0200": "The log %1s has been cleared.",
    "PLAT0202": "The log %1s is full.",
    "PLAT0203": "The log %1s is no longer full.",
    "PLAT0204": "The log %1s is almost full.",
    "PLAT0208": "The log %1s has a configuration error.",
    "PLAT0210": "The system %1s has been reconfigured.",
    "PLAT0212": "The system %1s has encountered an OEM system boot event.",
    "PLAT0214": "The system %1s has encountered an unknown system hardware fault.",
    "PLAT0216": "The system %1s has generated an auxiliary log entry.",
    "PLAT0218": "The system %1s has executed a PEF action.",
    "PLAT0220": "The system %1s has synchronized the system clock.",
    "PLAT0222": "A diagnostic interrupt has occurred on system %1s.",
    "PLAT0224": "A bus timeout has occurred on system %1s.",
    "PLAT0226": "An I/O channel check NMI has occurred on system %1s.",
    "PLAT0228": "A software NMI has occurred on system %1s.",
    "PLAT0230": "System %1s has recovered from an NMI.",
    "PLAT0232": "A PCI PERR has occurred on system %1s.",
    "PLAT0234": "A PCI SERR has occurred on system %1s.",
    "PLAT0236": "An EISA fail safe timeout occurred on system %1s.",
    "PLAT0238": "A correctable bus error has occurred on system %1s.",
    "PLAT0240": "An uncorrectable bus error has occurred on system %1s.",
    "PLAT0242": "A fatal NMI error has occurred on system %1s.",
    "PLAT0244": "A fatal bus error has occurred on system %1s.",
    "PLAT0246": "A bus on system %1s is operating in a degraded state.",
    "PLAT0247": "A bus on system %1s is no longer operating in a degraded state.",
    "PLAT0248": "The power button %1s has been pressed.",
    "PLAT0249": "The power button %1s has been released.",
    "PLAT0250": "The sleep button %1s has been pressed.",
    "PLAT0251": "The sleep button %1s has been released.",
    "PLAT0252": "The reset button %1s has been pressed.",
    "PLAT0253": "The reset button %1s has been released.",
    "PLAT0254": "The latch to %1s has been opened.",
    "PLAT0255": "The latch to %1s has been closed.",
    "PLAT0256": "The service request %1s has been enabled.",
    "PLAT0257": "The service request %1s has been completed.",
    "PLAT0258": "Power control of system %1s has failed.",
    "PLAT0262": "The network port %1s has been connected.",
    "PLAT0263": "The network port %1s has been disconnected.",
    "PLAT0266": "The connector %1s has encountered a configuration error.",
    "PLAT0267": "The connector %1s configuration error has been repaired.",
    "PLAT0272": "Power on for system %1s.",
    "PLAT0274": "Power cycle hard requested for system %1s.",
    "PLAT0276": "Power cycle soft requested for system %1s.",
    "PLAT0278": "PXE boot requested for system %1s.",
    "PLAT0280": "Diagnostics boot requested for system %1s.",
    "PLAT0282": "System restart requested for system %1s.",
    "PLAT0284": "System restart begun for system %1s.",
    "PLAT0286": "No bootable media available for system %1s.",
    "PLAT0288": "Non-bootable media selected for system %1s.",
    "PLAT0290": "PXE server not found for system %1s.",
    "PLAT0292": "User timeout on boot for system %1s.",
    "PLAT0296": "System %1s boot from floppy initiated.",
    "PLAT0298": "System %1s boot from local drive initiated.",
    "PLAT0300": "System %1s boot from PXE on network port initiated.",
    "PLAT0302": "System %1s boot diagnostics initiated.",
    "PLAT0304": "System %1s boot from CD initiated.",
    "PLAT0306": "System %1s boot from ROM initiated.",
    "PLAT0312": "System %1s boot initiated.",
    "PLAT0320": "Critical stop during OS load on system %1s.",
    "PLAT0322": "Run-time critical stop on system %1s.",
    "PLAT0324": "OS graceful stop on system %1s.",
    "PLAT0326": "OS graceful shutdown begun on system %1s.",
    "PLAT0327": "OS graceful shutdown completed on system %1s.",
    "PLAT0328": "Agent not responding on system %1s.",
    "PLAT0329": "Agent has begun responding on system %1s.",
    "PLAT0330": "Fault in slot on system %1s.",
    "PLAT0331": "Fault condition removed on system %1s.",
    "PLAT0332": "Identifying slot on system %1s.",
    "PLAT0333": "Identify stopped on slot for system %1s.",
    "PLAT0334": "Package installed in slot for system %1s.",
    "PLAT0336": "Slot empty system %1s.",
    "PLAT0338": "Slot in system %1s is ready for installation.",
    "PLAT0340": "Slot in system %1s is ready for removal.",
    "PLAT0342": "Power is off on slot of system %1s.",
    "PLAT0344": "Power is on for slot of system %1s.",
    "PLAT0346": "Removal requested for slot of system %1s.",
    "PLAT0348": "Interlock activated on slot of system %1s.",
    "PLAT0349": "Interlock de-asserted on slot of system %1s.",
    "PLAT0350": "Slot disabled on system %1s.",
    "PLAT0351": "Slot enabled on system %1s.",
    "PLAT0352": "Slot of system %1s holds spare.",
    "PLAT0353": "Slot of system %1s no longer holds spare.",
    "PLAT0354": "Computer system %1s enabled.",
    "PLAT0356": "Computer system %1s is in sleep - light mode.",
    "PLAT0358": "Computer system %1s is in hibernate.",
    "PLAT0360": "Computer system %1s is in standby.",
    "PLAT0362": "Computer system %1s is in soft off mode.",
    "PLAT0364": "Computer system %1s is in hard off mode.",
    "PLAT0366": "Computer system %1s is sleeping.",
    "PLAT0368": "Watchdog timer expired for %1s.",
    "PLAT0370": "Reboot of system initiated by watchdog %1s.",
    "PLAT0372": "Powering off system initiated by watchdog %1s.",
    "PLAT0374": "Power cycle of system initiated by watchdog %1s.",
    "PLAT0376": "Watchdog timer interrupt occurred for %1s.",
    "PLAT0378": "A page alert has been generated for system %1s.",
    "PLAT0380": "A LAN alert has been generated for system %1s.",
    "PLAT0382": "An event trap has been generated for system %1s.",
    "PLAT0384": "An SNMP trap has been generated for system %1s.",
    "PLAT0390": "%1s detected as present.",
    "PLAT0392": "%1s detected as absent.",
    "PLAT0394": "%1s has been disabled.",
    "PLAT0395": "%1s has been enabled.",
    "PLAT0396": "Heartbeat lost for LAN %1s.",
    "PLAT0397": "Heartbeat detected for LAN %1s.",
    "PLAT0398": "Sensor %1s is unavailable or degraded on management system.",
    "PLAT0399": "Sensor %1s has returned to normal on management system.",
    "PLAT0400": "Controller %1s is unavailable or degraded on management system.",
    "PLAT0401": "Controller %1s has returned to normal on management system.",
    "PLAT0402": "Management system %1s is off-line.",
    "PLAT0404": "Management system %1s is disabled.",
    "PLAT0405": "Management system %1s is enabled.",
    "PLAT0406": "Sensor %1s has failed on management system.",
    "PLAT0408": "FRU %1s has failed on management system.",
    "PLAT0424": "The battery %1s is critically low.",
    "PLAT0427": "The battery %1s is no longer critically low.",
    "PLAT0430": "The battery %1s has been removed from unit.",
    "PLAT0431": "The battery %1s has been added.",
    "PLAT0432": "The battery %1s has failed.",
    "PLAT0434": "Session audit is deactivated on system %1s.",
    "PLAT0435": "Session audit is activated on system %1s.",
    "PLAT0436": "A hardware change occurred on system %1s.",
    "PLAT0438": "A firmware or software change occurred on system %1s.",
    "PLAT0440": "A hardware incompatibility was detected on system %1s.",
    "PLAT0442": "A firmware or software incompatibility was detected on system %1s.",
    "PLAT0444": "Invalid or unsupported hardware was detected on system %1s.",
    "PLAT0446": "Invalid or unsupported firmware or software was detected on system %1s.",
    "PLAT0448": "A successful hardware change was detected on system %1s.",
    "PLAT0450": "A successful software or firmware change was detected on system %1s.",
    "PLAT0464": "FRU %1s not installed on system.",
    "PLAT0465": "FRU %1s installed on system.",
    "PLAT0466": "Activation requested for FRU %1s on system.",
    "PLAT0467": "FRU %1s on system is active.",
    "PLAT0468": "Activation in progress for FRU %1s on system.",
    "PLAT0470": "Deactivation request for FRU %1s on system.",
    "PLAT0471": "FRU %1s on system is in standby or \"hot spare\" state.",
    "PLAT0472": "Deactivation in progress for FRU %1s on system.",
    "PLAT0474": "Communication lost with FRU %1s on system.",
    "PLAT0476": "Numeric sensor %1s going low (lower non-critical).",
    "PLAT0478": "Numeric sensor %1s going high (lower non-critical).",
    "PLAT0480": "Numeric sensor %1s going low (lower critical).",
    "PLAT0482": "Numeric sensor %1s going high (lower critical).",
    "PLAT0484": "Numeric sensor %1s going low (lower non-recoverable).",
    "PLAT0486": "Numeric sensor %1s going high (lower non-critical).",
    "PLAT0488": "Numeric sensor %1s going low (upper non-critical).",
    "PLAT0490": "Numeric sensor %1s going high (upper non-critical).",
    "PLAT0492": "Numeric sensor %1s going low (upper critical).",
    "PLAT0494": "Numeric sensor %1s going high (upper critical).",
    "PLAT0496": "Numeric sensor %1s going low (upper non-recoverable).",
    "PLAT0498": "Numeric sensor %1s going high (upper non-recoverable).",
    "PLAT0500": "Sensor %1s has transitioned to idle.",
    "PLAT0502": "Sensor %1s has transitioned to active.",
    "PLAT0504": "Sensor %1s has transitioned to busy.",
    "PLAT0508": "Sensor %1s has asserted.",
    "PLAT0509": "Sensor %1s has de-asserted.",
    "PLAT0510": "Sensor %1s is asserting predictive failure.",
    "PLAT0511": "Sensor %1s is de-asserting predictive failure.",
    "PLAT0512": "Sensor %1s has indicated limit exceeded.",
    "PLAT0513": "Sensor %1s has indicated limit no longer exceeded.",
    "PLAT0514": "Sensor %1s has indicated performance met.",
    "PLAT0516": "Sensor %1s has indicated performance lags.",
    "PLAT0518": "Sensor %1s has transitioned to normal state.",
    "PLAT0520": "Sensor %1s has transitioned from normal to non-critical state.",
    "PLAT0522": "Sensor %1s has transitioned to critical from a less severe state.",
    "PLAT0524": "Sensor %1s has transitioned to non-recoverable from a less severe state.",
    "PLAT0526": "Sensor %1s has transitioned to non-critical from a more severe state.",
    "PLAT0528": "Sensor %1s has transitioned to critical from a non-recoverable state.",
    "PLAT0530": "Sensor %1s has transitioned to non-recoverable.",
    "PLAT0532": "Sensor %1s indicates a monitor state.",
    "PLAT0534": "Sensor %1s has an informational state.",
    "PLAT0536": "Device %1s has been added.",
    "PLAT0537": "Device %1s has been removed from unit.",
    "PLAT0538": "Device %1s has been enabled.",
    "PLAT0539": "Device %1s has been disabled.",
    "PLAT0540": "Sensor %1s has indicated a running state.",
    "PLAT0544": "Sensor %1s has indicated a power off state.",
    "PLAT0546": "Sensor %1s has indicated an on-line state.",
    "PLAT0548": "Sensor %1s has indicated an off-line state.",
    "PLAT0550": "Sensor %1s has indicated an off-duty state.",
    "PLAT0552": "Sensor %1s has indicated a degraded state.",
    "PLAT0554": "Sensor %1s has indicated a power save state.",
    "PLAT0556": "Sensor %1s has indicated an install error.",
    "PLAT0558": "Redundancy %1s has been lost.",
    "PLAT0560": "Redundancy %1s has been reduced.",
    "PLAT0561": "Redundancy %1s has been restored.",
    "PLAT0562": "%1s has transitioned to a D0 power state.",
    "PLAT0564": "%1s has transitioned to a D1 power state.",
    "PLAT0566": "%1s has transitioned to a D2 power state.",
    "PLAT0568": "%1s has transitioned to a D3 power state.",
    "PLAT0720": "The System %1s encountered firmware progress - memory initialization entry.",
    "PLAT0721": "The System %1s encountered firmware progress - memory initialization exit.",
    "PLAT0722": "The System %1s encountered firmware progress - hard drive initialization entry.",
    "PLAT0723": "The System %1s encountered firmware progress - hard drive initialization exit.",
    "PLAT0724": "The System %1s encountered firmware progress -  user authentication.",
    "PLAT0728": "The System %1s encountered firmware progress - USR resource configuration entry.",
    "PLAT0729": "The System %1s encountered firmware progress - USR resource configuration exit.",
    "PLAT0730": "The System %1s encountered firmware progress - PCI recource configuration entry.",
    "PLAT0731": "The System %1s encountered firmware progress - PCI recource configuration exit.",
    "PLAT0732": "The System %1s encountered firmware progress - Option ROM initialization entry.",
    "PLAT0733": "The System %1s encountered firmware progress - Option ROM initialization entry exit.",
    "PLAT0734": "The System %1s encountered firmware progress -video initialization entry entry.",
    "PLAT0735": "The System %1s encountered firmware progress - video initialization entry exit.",
    "PLAT0736": "The System %1s encountered firmware progress - cache initialization  entry.",
    "PLAT0737": "The System %1s encountered firmware progress - cache initialization exit.",
    "PLAT0738": "The System %1s encountered firmware progress - keyboard controller initialization  entry.",
    "PLAT0739": "The System %1s encountered firmware progress - keyboard controller initialization exit.",
    "PLAT0740": "The System %1s encountered firmware progress - motherboard initialization entry.",
    "PLAT0741": "The System %1s encountered firmware progress - motherboard initialization exit.",
    "PLAT0742": "The System %1s encountered firmware progress - floppy disk initialization entry.",
    "PLAT0743": "The System %1s encountered firmware progress - floppy disk initialization exit.",
    "PLAT0744": "The System %1s encountered firmware progress - keyboard test entry.",
    "PLAT0745": "The System %1s encountered firmware progress - keyboard test exit.",
    "PLAT0746": "The System %1s encountered firmware progress - pointing device test entry.",
    "PLAT0747": "The System %1s encountered firmware progress - pointing device test exit.",
    "PLAT0750": "The System %1s encountered firmware progress - dock enable entry.",
    "PLAT0751": "The System %1s encountered firmware progress - dock enable exit.",
    "PLAT0752": "The System %1s encountered firmware progress - dock disable entry.",
    "PLAT0753": "The System %1s encountered firmware progress - dock disable exit.",
    "PLAT0760": "The System %1s encountered firmware progress - start OS boot process.",
    "PLAT0762": "The System %1s encountered firmware progress - call OS wake vector.",
    "PLAT0764": "The System %1s encountered firmware progress - unrecoverable keyboard failure.",
    "PLAT0766": "The System %1s encountered firmware progress - no video device detected.",
    "PLAT0768": "The System %1s encountered firmware progress - SMART alert detected on drive.",
    "PLAT0770": "The System %1s encountered firmware progress - unrecoverable boot device failure.",
    "PLAT0789": "Corrupt BIOS detected.",
    "PLAT0790": "The System %1s encountered PCI configuration failure.",
    "PLAT0791": "The System %1s encountered a video subsystem failure.",
    "PLAT0792": "The System %1s encountered a storage subsystem failure.",
    "PLAT0793": "The System %1s encountered a USB subsystem failure.",
    "PLAT0794": "The System %1s has detected no memory in the system.",
    "PLAT0795": "The System %1s encountered a motherboard failure.",
    "PLAT0796": "The System %1s encountered a memory Regulator Voltage Bad.",
    "PLAT0797": "%1s PCI reset is not deasserting.",
    "PLAT0798": "%1s Non-Motherboard Regulator Failure.",
    "PLAT0799": "%1s Power Supply Cable failure.",
    "PLAT0800": "%1s Motherboard regulator failure.",
    "PLAT0801": "%1s System component compatibility mismatch."
}

module.exports = lme_heci;
