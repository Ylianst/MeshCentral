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

var net = require('net');
var inherits = require('util').inherits;
var events = require('events');
var layer = require('../core').layer;
var error = require('../core').error;
var rle = require('../core').rle;
var log = require('../core').log;
var TPKT = require('./tpkt');
var x224 = require('./x224');
var t125 = require('./t125');
var pdu = require('./pdu');

/**
 * decompress bitmap from RLE algorithm
 * @param	bitmap	{object} bitmap object of bitmap event of node-rdpjs
 */
function decompress(bitmap) {
    var fName = null;
    switch (bitmap.bitsPerPixel.value) {
        case 15:
            fName = 'bitmap_decompress_15';
            break;
        case 16:
            fName = 'bitmap_decompress_16';
            break;
        case 24:
            fName = 'bitmap_decompress_24';
            break;
        case 32:
            fName = 'bitmap_decompress_32';
            break;
        default:
            throw 'invalid bitmap data format';
    }

    var input = new Uint8Array(bitmap.bitmapDataStream.value);
    var inputPtr = rle._malloc(input.length);
    var inputHeap = new Uint8Array(rle.HEAPU8.buffer, inputPtr, input.length);
    inputHeap.set(input);

    var ouputSize = bitmap.width.value * bitmap.height.value * 4;
    var outputPtr = rle._malloc(ouputSize);

    var outputHeap = new Uint8Array(rle.HEAPU8.buffer, outputPtr, ouputSize);

    var res = rle.ccall(fName,
        'number',
        ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [outputHeap.byteOffset, bitmap.width.value, bitmap.height.value, bitmap.width.value, bitmap.height.value, inputHeap.byteOffset, input.length]
    );

    var output = new Uint8ClampedArray(outputHeap.buffer, outputHeap.byteOffset, ouputSize);

    rle._free(inputPtr);
    rle._free(outputPtr);

    return output;
}

/**
 * Main RDP module
 */
function RdpClient(config) {
    config = config || {};
    this.connected = false;
    this.bufferLayer = new layer.BufferLayer(new net.Socket());
    this.tpkt = new TPKT(this.bufferLayer);
    this.x224 = new x224.Client(this.tpkt, config);
    this.mcs = new t125.mcs.Client(this.x224);
    this.sec = new pdu.sec.Client(this.mcs, this.tpkt);
    this.cliprdr = new pdu.cliprdr.Client(this.mcs);
    this.global = new pdu.global.Client(this.sec, this.sec);

    // config log level
    log.level = log.Levels[config.logLevel || 'INFO'] || log.Levels.INFO;

    // credentials
    if (config.domain) {
        this.sec.infos.obj.domain.value = Buffer.from(config.domain + '\x00', 'ucs2');
    }
    if (config.userName) {
        this.sec.infos.obj.userName.value = Buffer.from(config.userName + '\x00', 'ucs2');
    }
    if (config.password) {
        this.sec.infos.obj.password.value = Buffer.from(config.password + '\x00', 'ucs2');
    }
    if (config.workingDir) {
        this.sec.infos.obj.workingDir.value = Buffer.from(config.workingDir + '\x00', 'ucs2');
    }
    if (config.alternateShell) {
        this.sec.infos.obj.alternateShell.value = Buffer.from(config.alternateShell + '\x00', 'ucs2');
    }

    if (config.perfFlags != null) {
        this.sec.infos.obj.extendedInfo.obj.performanceFlags.value = config.perfFlags;
    } else {
        if (config.enablePerf) {
            this.sec.infos.obj.extendedInfo.obj.performanceFlags.value =
                pdu.sec.PerfFlag.PERF_DISABLE_WALLPAPER
                | pdu.sec.PerfFlag.PERF_DISABLE_MENUANIMATIONS
                | pdu.sec.PerfFlag.PERF_DISABLE_CURSOR_SHADOW
                | pdu.sec.PerfFlag.PERF_DISABLE_THEMING
                | pdu.sec.PerfFlag.PERF_DISABLE_FULLWINDOWDRAG;
        }
    }

    if (config.autoLogin) {
        this.sec.infos.obj.flag.value |= pdu.sec.InfoFlag.INFO_AUTOLOGON;
    }

    if (config.screen && config.screen.width && config.screen.height) {
        this.mcs.clientCoreData.obj.desktopWidth.value = config.screen.width;
        this.mcs.clientCoreData.obj.desktopHeight.value = config.screen.height;
    }

    log.debug('screen ' + this.mcs.clientCoreData.obj.desktopWidth.value + 'x' + this.mcs.clientCoreData.obj.desktopHeight.value);

    // config keyboard layout
    switch (config.locale) {
        case 'fr':
            log.debug('french keyboard layout');
            this.mcs.clientCoreData.obj.kbdLayout.value = t125.gcc.KeyboardLayout.FRENCH;
            break;
        case 'en':
        default:
            log.debug('english keyboard layout');
            this.mcs.clientCoreData.obj.kbdLayout.value = t125.gcc.KeyboardLayout.US;
    }

    this.cliprdr.on('clipboard', (content) => {
        this.emit('clipboard', content)
    });

    //bind all events
    var self = this;
    this.global.on('connect', function () {
        self.connected = true;
        self.emit('connect');
    }).on('session', function () {
        self.emit('session');
    }).on('close', function () {
        self.connected = false;
        self.emit('close');
    }).on('pointer', function (cursorId, cursorStr) {
        self.emit('pointer', cursorId, cursorStr);
    }).on('bitmap', function (bitmaps) {
        for (var bitmap in bitmaps) {
            var bitmapData = bitmaps[bitmap].obj.bitmapDataStream.value;
            var isCompress = bitmaps[bitmap].obj.flags.value & pdu.data.BitmapFlag.BITMAP_COMPRESSION;

            if (isCompress && config.decompress) {
                bitmapData = decompress(bitmaps[bitmap].obj);
                isCompress = false;
            }

            self.emit('bitmap', {
                destTop: bitmaps[bitmap].obj.destTop.value,
                destLeft: bitmaps[bitmap].obj.destLeft.value,
                destBottom: bitmaps[bitmap].obj.destBottom.value,
                destRight: bitmaps[bitmap].obj.destRight.value,
                width: bitmaps[bitmap].obj.width.value,
                height: bitmaps[bitmap].obj.height.value,
                bitsPerPixel: bitmaps[bitmap].obj.bitsPerPixel.value,
                isCompress: isCompress,
                data: bitmapData
            });
        }
    }).on('error', function (err) {
        log.warn(err.code + '(' + err.message + ')\n' + err.stack);
        if (err instanceof error.FatalError) { throw err; } else { self.emit('error', err); }
    });
}

inherits(RdpClient, events.EventEmitter);

/**
 * Connect RDP client
 * @param host {string} destination host
 * @param port {integer} destination port
 */
RdpClient.prototype.connect = function (host, port) {
    log.debug('connect to ' + host + ':' + port);
    var self = this;
    this.bufferLayer.socket.connect(port, host, function () {
        // in client mode connection start from x224 layer
        self.x224.connect();
    });
    return this;
};

/**
 * Close RDP client
 */
RdpClient.prototype.close = function () {
    if (this.connected) {
        this.global.close();
    }
    this.connected = false;
    return this;
};

/**
 * Send pointer event to server
 * @param x {integer} mouse x position
 * @param y {integer} mouse y position
 * @param button {integer} button number of mouse
 * @param isPressed {boolean} state of button
 */
RdpClient.prototype.sendPointerEvent = function (x, y, button, isPressed) {
    if (!this.connected)
        return;

    var event = pdu.data.pointerEvent();
    if (isPressed) {
        event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_DOWN;
    }

    switch (button) {
        case 1:
            event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_BUTTON1;
            break;
        case 2:
            event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_BUTTON2;
            break;
        case 3:
            event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_BUTTON3
            break;
        default:
            event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_MOVE;
    }

    event.obj.xPos.value = x;
    event.obj.yPos.value = y;

    this.global.sendInputEvents([event]);
};

/**
 * send scancode event
 * @param code {integer}
 * @param isPressed {boolean}
 * @param extended {boolenan} extended keys
 */
RdpClient.prototype.sendKeyEventScancode = function (code, isPressed, extended) {
    if (!this.connected)
        return;
    extended = extended || false;
    var event = pdu.data.scancodeKeyEvent();
    event.obj.keyCode.value = code;

    if (!isPressed) {
        event.obj.keyboardFlags.value |= pdu.data.KeyboardFlag.KBDFLAGS_RELEASE;
    }

    if (extended) {
        event.obj.keyboardFlags.value |= pdu.data.KeyboardFlag.KBDFLAGS_EXTENDED;
    }

    this.global.sendInputEvents([event]);
};

/**
 * Send key event as unicode
 * @param code {integer}
 * @param isPressed {boolean}
 */
RdpClient.prototype.sendKeyEventUnicode = function (code, isPressed) {
    if (!this.connected)
        return;

    var event = pdu.data.unicodeKeyEvent();
    event.obj.unicode.value = code;

    if (!isPressed) {
        event.obj.keyboardFlags.value |= pdu.data.KeyboardFlag.KBDFLAGS_RELEASE;
    }
    this.global.sendInputEvents([event]);
}

/**
 * Wheel mouse event
 * @param x {integer} mouse x position
 * @param y {integer} mouse y position
 * @param step {integer} wheel step
 * @param isNegative {boolean}
 * @param isHorizontal {boolean}
 */
RdpClient.prototype.sendWheelEvent = function (x, y, step, isNegative, isHorizontal) {
    if (!this.connected)
        return;

    var event = pdu.data.pointerEvent();
    if (isHorizontal) {
        event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_HWHEEL;
    }
    else {
        event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_WHEEL;
    }


    if (isNegative) {
        event.obj.pointerFlags.value |= pdu.data.PointerFlag.PTRFLAGS_WHEEL_NEGATIVE;
    }

    event.obj.pointerFlags.value |= (step & pdu.data.PointerFlag.WheelRotationMask)

    event.obj.xPos.value = x;
    event.obj.yPos.value = y;

    this.global.sendInputEvents([event]);
}

/**
 * Clipboard event
 * @param data {String} content for clipboard
 */
RdpClient.prototype.setClipboardData = function (content) {
    this.cliprdr.setClipboardData(content);
}

function createClient(config) {
    return new RdpClient(config);
};

/**
 * RDP server side protocol
 * @param config {object} configuration
 * @param socket {net.Socket}
 */
function RdpServer(config, socket) {
    if (!(config.key && config.cert)) {
        throw new error.FatalError('NODE_RDP_PROTOCOL_RDP_SERVER_CONFIG_MISSING', 'missing cryptographic tools')
    }
    this.connected = false;
    this.bufferLayer = new layer.BufferLayer(socket);
    this.tpkt = new TPKT(this.bufferLayer);
    this.x224 = new x224.Server(this.tpkt, config.key, config.cert);
    this.mcs = new t125.mcs.Server(this.x224);
};

inherits(RdpServer, events.EventEmitter);

function createServer(config, next) {
    return net.createServer(function (socket) {
        next(new RdpServer(config, socket));
    });
};

/**
 * Module exports
 */
module.exports = {
    createClient: createClient,
    createServer: createServer
};