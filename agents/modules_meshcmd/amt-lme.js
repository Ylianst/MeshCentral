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
var lme_bindany = false;    // If true, bind to all network interfaces, not just loopback.
var xmlParser = null;
try { xmlParser = require('amt-xml'); } catch (ex) { }

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
    
    this.on('newListener', function (name, func)
    {
        if (name == 'connect' && this._LME._connected == true) { func.call(this); }
        if (name == 'error' && this._LME._error !=null) { func.call(this, this._LME._error); }
    });
    if (options != null) {
        if (options.debug == true) { lme_port_offset = -100; } // LMS debug mode
        if (options.bindany == true) { lme_bindany = true; } // Bind to all ports
    }

    var heci = require('heci');
    this.INITIAL_RXWINDOW_SIZE = 4096;
    
    this._ObjectID = "lme";
    this._LME = heci.create();
    this._LME._connected = false;
    this._LME._error = null;
    this._LME.descriptorMetadata = "amt-lme";
    this._LME._binded = {};
    this._LME.LMS = this;
    this._LME.on('error', function (e) { this._error = e; this.LMS.emit('error', e); });
    this._LME.on('connect', function ()
    {
        this._connected = true;
        this._emitConnected = false;
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
                                try
                                {
                                    // Bind a new server socket if not already present
                                    this[name][port] = require('net').createServer();
                                    this[name][port].descriptorMetadata = 'amt-lme (port: ' + port + ')';
                                    this[name][port].HECI = this;
                                    if (lme_port_offset == 0) {
                                        if (lme_bindany) {
                                            this[name][port].listen({ port: port }); // Bind all mode
                                        } else {
                                            this[name][port].listen({ port: port, host: '127.0.0.1' }); // Normal mode
                                        }
                                    } else {
                                        this[name][port].listen({ port: (port + lme_port_offset) }); // Debug mode
                                    }
                                    this[name][port].on('connection', function (socket) {
                                        //console.log('New [' + socket.remoteFamily + '] TCP Connection on: ' + socket.remoteAddress + ' :' + socket.localPort);
                                        this.HECI.LMS.bindDuplexStream(socket, socket.remoteFamily, socket.localPort - lme_port_offset);
                                    });
                                    this._binded[port] = true;
                                    if (!this._emitConnected)
                                    {
                                        this._emitConnected = true;
                                        this.LMS.emit('error', 'APF/BIND error');
                                    }
                                    this.LMS.emit('bind', this._binded);
                                } catch (ex)
                                {
                                    console.info1(ex, 'Port ' + port);
                                    if(!this._emitConnected)
                                    {
                                        this._emitConnected = true;
                                        this.LMS.emit('error', 'APF/BIND error');
                                    }
                                }
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
                            if (xmlParser != null) { try { notify = xmlParser.ParseWsman(httpData); } catch (e) { } }

                            // Event the http data
                            if (notify != null) { this.LMS.emit('notify', notify, channel.options, _lmsNotifyToCode(notify)); }

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
        //
        // Due to a change in behavior with AMT/11 (and possibly earlier), we are not going to emit 'connect' here, until
        // we can verify that the first APF/Channel can be bound. Older AMT, like AMT/7 only allowed a single LME connection, so we
        // used to emit connect here. However, newer AMT's will allow more than 1 LME connection, which will result in APF/Bind failure
        //
        //this.LMS.emit('connect');
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

module.exports = lme_heci;
