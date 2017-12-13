
var MemoryStream = require('MemoryStream');
var lme_id = 0;


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


function lme_object()
{
    this.ourId = ++lme_id;
    this.amtId = -1;
    this.LME_CHANNEL_STATUS = 'LME_CS_FREE';
    this.txWindow = 0;
    this.rxWindow = 0;
    this.localPort = 0;
    this.errorCount = 0;
}

function stream_bufferedWrite()
{
    var emitterUtils = require('events').inherits(this);
    this.buffer = [];
    this._readCheckImmediate = undefined;

    // Writable Events
    emitterUtils.createEvent('close');
    emitterUtils.createEvent('drain');
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('finish');
    emitterUtils.createEvent('pipe');
    emitterUtils.createEvent('unpipe');

    // Readable Events
    emitterUtils.createEvent('readable');
    this.isEmpty = function ()
    {
        return (this.buffer.length == 0);
    };
    this.isWaiting = function ()
    {
        return (this._readCheckImmediate == undefined);
    };
    this.write = function (chunk)
    {
        for (var args in arguments)
        {
            if (typeof (arguments[args]) == 'function') { this.once('drain', arguments[args]); break; }
        }
        var tmp = Buffer.alloc(chunk.length);
        chunk.copy(tmp);
        this.buffer.push({ offset: 0, data: tmp });
        this.emit('readable');
        return (this.buffer.length == 0 ? true : false);
    };
    this.read = function ()
    {
        var size = arguments.length == 0 ? undefined : arguments[0];
        var bytesRead = 0;
        var list = [];
        while((size == undefined || bytesRead < size) && this.buffer.length > 0)
        {
            var len = this.buffer[0].data.length - this.buffer[0].offset;
            var offset = this.buffer[0].offset;

            if(len > (size - bytesRead))
            {
                // Only reading a subset
                list.push(this.buffer[0].data.slice(offset, offset + size - bytesRead));
                this.buffer[0].offset += (size - bytesRead);
                bytesRead += (size - bytesRead);
            }
            else
            {
                // Reading the entire thing
                list.push(this.buffer[0].data.slice(offset));
                bytesRead += len;
                this.buffer.shift();
            }
        }
        this._readCheckImmediate = setImmediate(function (buffered)
        {
            buffered._readCheckImmediate = undefined;
            if(buffered.buffer.length == 0)
            {
                // drained
                buffered.emit('drain');
            }
            else
            {
                // not drained
                buffered.emit('readable');
            }
        }, this);
        return (Buffer.concat(list));
    };
}


function lme_heci()
{
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('error');
    emitterUtils.createEvent('connect');

    var heci = require('heci');
    this.INITIAL_RXWINDOW_SIZE = 4096;

    this._LME = heci.create();
    this._LME.LMS = this;
    this._LME.on('error', function (e) { this.Parent.emit('error', e); });
    this._LME.on('connect', function ()
    {
        this.LMS.emit('connect');
        this.on('data', function (chunk)
        {
            // this = HECI
            var cmd = chunk.readUInt8(0);
           
            switch(cmd)
            {
                default:
                    //console.log('Received ' + chunk.length + ' bytes of data for LMS');
                    //console.log('Command = ' + cmd);
                    break;
                case APF_SERVICE_REQUEST:     
                    var nameLen = chunk.readUInt32BE(1);
                    var name = chunk.slice(5, nameLen + 5);
                    //console.log("Service Request for: " + name);
                    if (name == 'pfwd@amt.intel.com' || name == 'auth@amt.intel.com')
                    {
                        var outBuffer = Buffer.alloc(5 + nameLen);
                        outBuffer.writeUInt8(6, 0);
                        outBuffer.writeUInt32BE(nameLen, 1);
                        outBuffer.write(name.toString(), 5);
                        this.write(outBuffer);
                        //console.log('Answering APF_SERVICE_REQUEST');
                    }
                    else
                    {
                        //console.log('UNKNOWN APF_SERVICE_REQUEST');
                    }
                    break;
                case APF_GLOBAL_REQUEST:    
                    var nameLen = chunk.readUInt32BE(1);
                    var name = chunk.slice(5, nameLen + 5).toString();
                    
                    switch(name)
                    {
                        case 'tcpip-forward':
                            var len = chunk.readUInt32BE(nameLen + 6);
                            var port = chunk.readUInt32BE(nameLen + 10 + len);
                            //console.log("[" + chunk.length + "/" + len + "] APF_GLOBAL_REQUEST for: " + name + " on port " + port);
                            if (this[name] == undefined)
                            {
                                this[name] = {};
                            }
                            this[name][port] = require('net').createServer();
                            this[name][port].HECI = this;
                            this[name][port].listen({ port: port });
                            this[name][port].on('connection', function (socket)
                            {
                                //console.log('New [' + socket.remoteFamily + '] TCP Connection on: ' + socket.remoteAddress + ' :' + socket.localPort);
                                this.HECI.LMS.bindDuplexStream(socket, socket.remoteFamily, socket.localPort);
                            });
                            var outBuffer = Buffer.alloc(5);
                            outBuffer.writeUInt8(81, 0);
                            outBuffer.writeUInt32BE(port, 1);
                            this.write(outBuffer);
                            break;
                        case 'cancel-tcpip-forward':
                            break;
                        case 'udp-send-to@amt.intel.com':
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
			        if (this.sockets[rChannel] != undefined)
			        {
			            this.sockets[rChannel].lme.amtId = sChannel;
			            this.sockets[rChannel].lme.rxWindow = wSize;
			            this.sockets[rChannel].lme.txWindow = wSize;
			            this.sockets[rChannel].lme.LME_CHANNEL_STATUS = 'LME_CS_CONNECTED';
			            //console.log('LME_CS_CONNECTED');
			            this.sockets[rChannel].bufferedStream = new stream_bufferedWrite();
			            this.sockets[rChannel].bufferedStream.socket = this.sockets[rChannel];
			            this.sockets[rChannel].bufferedStream.on('readable', function ()
			            {
			                if(this.socket.lme.txWindow > 0)
			                {
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
			            this.sockets[rChannel].bufferedStream.on('drain', function ()
			            {
			                this.socket.resume();
			            });
			            this.sockets[rChannel].on('data', function (chunk)
			            {
			                if (!this.bufferedStream.write(chunk)) { this.pause(); }
			            });
			            this.sockets[rChannel].on('end', function () 
			            {
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
                    if (this.sockets[rChannelId] != undefined)
                    {
                        this.sockets[rChannelId].lme.txWindow += bytesToAdd;
                        if (!this.sockets[rChannelId].bufferedStream.isEmpty() && this.sockets[rChannelId].bufferedStream.isWaiting())
                        {
                            this.sockets[rChannelId].bufferedStream.emit('readable');
                        }
                    }
                    else
                    {
                        //console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_WINDOW_ADJUST');
                    }
                    break;
                case APF_CHANNEL_DATA:
                    var rChannelId = chunk.readUInt32BE(1);
                    var dataLen = chunk.readUInt32BE(5);
                    var data = chunk.slice(9, 9 + dataLen);
                    if (this.sockets[rChannelId] != undefined)
                    {
                        this.sockets[rChannelId].pendingBytes.push(data.length);
                        this.sockets[rChannelId].write(data, function ()
                        {
                            var written = this.pendingBytes.shift();
                            var outBuffer = Buffer.alloc(9);
                            outBuffer.writeUInt8(APF_CHANNEL_WINDOW_ADJUST, 0);
                            outBuffer.writeUInt32BE(this.lme.amtId, 1);
                            outBuffer.writeUInt32BE(written, 5);
                            this.HECI.write(outBuffer);
                        });
                    }
                    else
                    {
                        //console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_DATA');
                    }
                    break;
                case APF_CHANNEL_CLOSE:
                    var rChannelId = chunk.readUInt32BE(1);
                    if (this.sockets[rChannelId] != undefined)
                    {
                        this.sockets[rChannelId].end();                    
                        var amtId = this.sockets[rChannelId].lme.amtId;
                        var buffer = Buffer.alloc(5);
                        delete this.sockets[rChannelId];

                        buffer.writeUInt8(APF_CHANNEL_CLOSE, 0);
                        buffer.writeUInt32BE(amtId, 1);
                        this.write(buffer);
                    }
                    else
                    {
                        //console.log('Unknown Recipient ID/' + rChannelId + ' for APF_CHANNEL_CLOSE');
                    }
                    break;
            }
        });
    });
   
    this.bindDuplexStream = function (duplexStream, remoteFamily, localPort)
    {
        var socket = duplexStream;
        //console.log('New [' + remoteFamily + '] Virtual Connection/' + socket.localPort);
        socket.pendingBytes = [];
        socket.HECI = this._LME;
        socket.LMS = this;
        socket.lme = new lme_object();
        socket.lme.Socket = socket;
        var buffer = new MemoryStream();
        buffer.writeUInt8(0x5A);
        buffer.writeUInt32BE(15);
        buffer.write('forwarded-tcpip');
        buffer.writeUInt32BE(socket.lme.ourId);
        buffer.writeUInt32BE(this.INITIAL_RXWINDOW_SIZE);
        buffer.writeUInt32BE(0xFFFFFFFF);
        for (var i = 0; i < 2; ++i)
        {
            if (remoteFamily == 'IPv6')
            {
                buffer.writeUInt32BE(3);
                buffer.write('::1');
            }
            else
            {
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

module.exports = lme_heci;
