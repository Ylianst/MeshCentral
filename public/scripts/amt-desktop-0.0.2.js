/** 
* @description Remote Desktop
* @author Ylian Saint-Hilaire
* @version v0.0.2g
*/

// Construct a MeshServer object
var CreateAmtRemoteDesktop = function (divid, scrolldiv) {
    var obj = {};
    obj.canvasid = divid;
    obj.CanvasId = Q(divid);
    obj.scrolldiv = scrolldiv;
    obj.canvas = Q(divid).getContext('2d');
    obj.protocol = 2; // KVM
    obj.state = 0;
    obj.acc = null;
    obj.ScreenWidth = 960;
    obj.ScreenHeight = 700;
    obj.width = 0;
    obj.height = 0;
    obj.rwidth = 0;
    obj.rheight = 0;
    obj.bpp = 2; // Bytes per pixel (1 or 2 supported)
    obj.useRLE = true;
    obj.showmouse = true;
    obj.buttonmask = 0;
    obj.localKeyMap = true;
    obj.spare = null;
    obj.sparew = 0;
    obj.spareh = 0;
    obj.sparew2 = 0;
    obj.spareh2 = 0;
    obj.sparecache = {};
    obj.onScreenSizeChange = null;
    obj.frameRateDelay = 0;
    // ###BEGIN###{DesktopRotation}
    obj.noMouseRotate = false;
    obj.rotation = 0;
    // ###END###{DesktopRotation}
    // ###BEGIN###{DesktopInband}
    obj.kvmDataSupported = false;
    obj.onKvmData = null;
    obj.onKvmDataPending = [];
    obj.onKvmDataAck = -1;
    obj.holding = false;
    obj.lastKeepAlive = Date.now();
    obj.kvmExt = {};
    obj.kvmExtChanged = null;
    obj.useZLib = false;
    obj.decimationMode = 0; // 0 = Don't set, 1 = Disable, 2 = Automatic, 3 = Enabled
    obj.graymode = false;
    obj.lowcolor = false;
    // ###END###{DesktopInband}

    obj.mNagleTimer = null; // Mouse motion slowdown timer
    obj.mx = 0; // Last mouse x position
    obj.my = 0; // Last mouse y position
    // ###BEGIN###{DesktopFocus}
    obj.ox = -1; // Old mouse x position
    obj.oy = -1; // Old mouse y position
    obj.focusmode = 0;
    // ###END###{DesktopFocus}
    // ###BEGIN###{Inflate}
    obj.inflate = ZLIB.inflateInit(-15);
    // ###END###{Inflate}

    obj.xxStateChange = function (newstate) {
        if (newstate == 0) {
            obj.canvas.fillStyle = '#000000';
            obj.canvas.fillRect(0, 0, obj.width, obj.height);
            obj.canvas.canvas.width = obj.rwidth = obj.width = 640;
            obj.canvas.canvas.height = obj.rheight = obj.height = 400;
            QS(obj.canvasid).cursor = 'default';
        } else {
            QS(obj.canvasid).cursor = obj.showmouse ? 'default' : 'none';
        }
    }

    function arrToStr(arr) { return String.fromCharCode.apply(null, arr); }
    function strToArr(str) { var arr = new Uint8Array(str.length); for (var i = 0, j = str.length; i < j; ++i) { arr[i] = str.charCodeAt(i); } return arr }

    obj.ProcessBinaryData = function (data) {
        // ###BEGIN###{DesktopRecorder}
        // Record the data if needed
        if ((obj.recordedData != null) && (obj.recordedHolding !== true)) { obj.recordedData.push(recordingEntry(2, 1, String.fromCharCode.apply(null, new Uint8Array(data)))); }
        // ###END###{DesktopRecorder}

        // Append to accumulator
        if (obj.acc == null) {
            obj.acc = new Uint8Array(data);
        } else {
            var tmp = new Uint8Array(obj.acc.byteLength + data.byteLength);
            tmp.set(obj.acc, 0);
            tmp.set(new Uint8Array(data), obj.acc.byteLength);
            obj.acc = tmp;
        }

        while ((obj.acc != null) && (obj.acc.byteLength > 0)) {
            //console.log('KAcc', obj.state, obj.acc);
            var cmdsize = 0, accview = new DataView(obj.acc.buffer);
            if ((obj.state == 0) && (obj.acc.byteLength >= 12)) {
                // Getting handshake & version
                cmdsize = 12;
                //if (obj.acc.substring(0, 4) != 'RFB ') { return obj.Stop(); }
                //var version = parseFloat(obj.acc.substring(4, 11));
                //console.log('KVersion: ' + version);
                obj.state = 1;
                if (obj.parent) { delete obj.parent.connectTime; }
                obj.send('RFB 003.008\n');
            }
            else if ((obj.state == 1) && (obj.acc.byteLength >= 1)) {
                // Getting security options
                cmdsize = obj.acc[0] + 1;
                obj.send(String.fromCharCode(1)); // Send the 'None' security type. Since we already authenticated using redirection digest auth, we don't need to do this again.
                obj.state = 2;
            }
            else if ((obj.state == 2) && (obj.acc.byteLength >= 4)) {
                // Getting security response
                cmdsize = 4;
                if (accview.getUint32(0) != 0) { return obj.Stop(); }
                obj.send(String.fromCharCode(1)); // Send share desktop flag
                obj.state = 3;
                if (obj.parent) { obj.parent.disconnectCode = 50000; } // If Intel AMT disconnects at exactly this moment, indicates we need RLE8 or unsupported GPU.
            }
            else if ((obj.state == 3) && (obj.acc.byteLength >= 24)) {
                // Getting server init
                // ###BEGIN###{DesktopRotation}
                obj.rotation = 0; // We don't currently support screen init while rotated.
                // ###END###{DesktopRotation}
                var namelen = accview.getUint32(20);
                if (obj.acc.byteLength < 24 + namelen) return;
                cmdsize = 24 + namelen;
                obj.canvas.canvas.width = obj.rwidth = obj.width = obj.ScreenWidth = accview.getUint16(0);
                obj.canvas.canvas.height = obj.rheight = obj.height = obj.ScreenHeight = accview.getUint16(2);
                //console.log('Initial Desktop width: ' + obj.width + ', height: ' + obj.height);

                // ###BEGIN###{DesktopRecorder}
                obj.DeskRecordServerInit = String.fromCharCode.apply(null, new Uint8Array(obj.acc.buffer.slice(0, 24 + namelen)));
                // ###END###{DesktopRecorder}

                // These are all values we don't really need, we are going to only run in RGB565 or RGB332 and not use the flexibility provided by these settings.
                // Makes the javascript code smaller and maybe a bit faster.
                /*
                obj.xbpp = obj.acc[4];
                obj.depth = obj.acc[5];
                obj.bigend = obj.acc[6];
                obj.truecolor = obj.acc[7];
                obj.rmax = ReadShort(obj.acc, 8);
                obj.gmax = ReadShort(obj.acc, 10);
                obj.bmax = ReadShort(obj.acc, 12);
                obj.rsh = obj.acc[14];
                obj.gsh = obj.acc[15];
                obj.bsh = obj.acc[16];
                var name = obj.acc.substring(24, 24 + namelen);
                console.log('name: ' + name);
                console.log('width: ' + obj.width + ', height: ' + obj.height);
                console.log('bits-per-pixel: ' + obj.xbpp);
                console.log('depth: ' + obj.depth);
                console.log('big-endian-flag: ' + obj.bigend);
                console.log('true-colour-flag: ' + obj.truecolor);
                console.log('rgb max: ' + obj.rmax + ',' + obj.gmax + ',' + obj.bmax);
                console.log('rgb shift: ' + obj.rsh + ',' + obj.gsh + ',' + obj.bsh);
                */

                // SetEncodings, with AMT we can't omit RAW, must be specified.
                // Intel AMT supports encodings: RAW (0), RLE (16), Desktop Size (0xFFFFFF21, -223)

                var supportedEncodings = '';
                if (obj.useRLE) supportedEncodings += IntToStr(16);
                supportedEncodings += IntToStr(0);
                // ###BEGIN###{DesktopInband}
                supportedEncodings += IntToStr(1092);
                // ###END###{DesktopInband}

                obj.send(String.fromCharCode(2, 0) + ShortToStr((supportedEncodings.length / 4) + 1) + supportedEncodings + IntToStr(-223));          // Supported Encodings + Desktop Size

                if (obj.graymode == false) {
                    // Set the pixel encoding to something much smaller
                    // obj.send(String.fromCharCode(0, 0, 0, 0, 16, 16, 0, 1) + ShortToStr(31) + ShortToStr(63) + ShortToStr(31) + String.fromCharCode(11, 5, 0, 0, 0, 0));                     // Setup 16 bit color RGB565 (This is the default, so we don't need to set it)
                    if (obj.bpp == 1) obj.send(String.fromCharCode(0, 0, 0, 0, 8, 8, 0, 1) + ShortToStr(7) + ShortToStr(7) + ShortToStr(3) + String.fromCharCode(5, 2, 0, 0, 0, 0));            // Setup 8 bit color RGB332
                } else {
                    // Gray scale modes
                    if (obj.bpp == 2) { obj.bpp = 1; }
                    if (obj.lowcolor == false) {
                        obj.send(String.fromCharCode(0, 0, 0, 0, 8, 8, 0, 1) + ShortToStr(255) + ShortToStr(0) + ShortToStr(0) + String.fromCharCode(0, 0, 0, 0, 0, 0));          // Setup 8 bit black and white RGB800
                    } else {
                        obj.send(String.fromCharCode(0, 0, 0, 0, 8, 4, 0, 1) + ShortToStr(15) + ShortToStr(0) + ShortToStr(0) + String.fromCharCode(0, 0, 0, 0, 0, 0));           // Setup 4 bit black and white RGB400
                    }
                }

                obj.state = 4;
                if (obj.parent) {
                    obj.parent.connectTime = Date.now();
                    obj.parent.disconnectCode = 0;
                    obj.parent.xxStateChange(3);
                }
                //obj.timer = setInterval(obj.xxOnTimer, 50);

                // ###BEGIN###{DesktopFocus}
                obj.ox = -1; // Old mouse x position
                // ###END###{DesktopFocus}
                // ###BEGIN###{DesktopInband}
                if (obj.kvmExtChanged != null) {
                    if (obj.decimationMode > 0) { obj.sendKvmExtCmd(2, obj.decimationMode); } // Set Decimation Mode (0 = Do not set, 1 = Disable, 2 = Auto, 3 = Enable)
                    obj.sendKvmExtCmd(4, (obj.useZLib === true) ? 1 : 0); // Set ZLib state (0 = Disabled, 1 = Enabled)
                }
                // ###END###{DesktopInband}
                _SendRefresh();

                if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight); }
                if (obj.parent) {
                    obj.parent.disconnectCode = 50001; // Everything looks good, a disconnection here would be Intel AMT initiated.

                    // Check if the screen size is larger than Intel AMT should be able to handle
                    //console.log('KVM Buffer Size: ' + (obj.bpp * obj.width * obj.height));
                    if ((obj.bpp * obj.width * obj.height) > 9216000) { obj.parent.disconnectCode = 50002; } // Display buffer too large.
                }
            }
            else if (obj.state == 4) {
                switch (obj.acc[0]) {
                    case 0: // FramebufferUpdate
                        if (obj.acc.byteLength < 4) return;
                        obj.state = 100 + accview.getUint16(2); // Read the number of tiles that are going to be sent, add 100 and use that as our protocol state.
                        cmdsize = 4;

                        // ###BEGIN###{DesktopRecorder}
                        // This is the start of a new frame, start recording now if needed.
                        if (obj.recordedHolding === true) { delete obj.recordedHolding; obj.recordedData.push(recordingEntry(2, 1, String.fromCharCode.apply(null, obj.acc))); }
                        // ###END###{DesktopRecorder}

                        break;
                    case 2: // This is the bell, do nothing.
                        cmdsize = 1;
                        break;
                    case 3: // This is ServerCutText
                        if (obj.acc.byteLength < 8) return;
                        var len = accview.getUint32(4) + 8;
                        if (obj.acc.byteLength < len) return;
                        cmdsize = handleServerCutText(obj.acc, accview);
                        break;
                }
            }
            else if ((obj.state > 100) && (obj.acc.byteLength >= 12)) {
                var x = accview.getUint16(0),
                    y = accview.getUint16(2),
                    width = accview.getUint16(4),
                    height = accview.getUint16(6),
                    s = width * height,
                    encoding = accview.getUint32(8);

                if (encoding < 17) {
                    if ((width < 1) || (width > 64) || (height < 1) || (height > 64)) { console.log('Invalid tile size (' + width + ',' + height + '), disconnecting.'); return obj.Stop(); }

                    // Set the spare bitmap to the right size if it's not already. This allows us to recycle the spare most if not all the time.
                    if ((obj.sparew != width) || (obj.spareh != height)) {
                        obj.sparew = obj.sparew2 = width;
                        obj.spareh = obj.spareh2 = height;
                        // ###BEGIN###{DesktopRotation}
                        if (obj.rotation == 1 || obj.rotation == 3) { obj.sparew2 = height, obj.spareh2 = width; }
                        // ###END###{DesktopRotation}
                        var xspacecachename = obj.sparew2 + 'x' + obj.spareh2;
                        obj.spare = obj.sparecache[xspacecachename];
                        if (!obj.spare) {
                            obj.sparecache[xspacecachename] = obj.spare = obj.canvas.createImageData(obj.sparew2, obj.spareh2);
                            var j = (obj.sparew2 * obj.spareh2) << 2;
                            for (var i = 3; i < j; i += 4) { obj.spare.data[i] = 0xFF; } // Set alpha channel to opaque.
                        }
                    }
                }

                if (encoding == 0xFFFFFF21) {
                    // Desktop Size (0xFFFFFF21, -223)
                    obj.canvas.canvas.width = obj.rwidth = obj.width = width;
                    obj.canvas.canvas.height = obj.rheight = obj.height = height;
                    obj.send(String.fromCharCode(3, 0, 0, 0, 0, 0) + ShortToStr(obj.width) + ShortToStr(obj.height)); // FramebufferUpdateRequest
                    cmdsize = 12;
                    if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight); }
                    //console.log('Desktop width: ' + obj.width + ', height: ' + obj.height);

                    // Check if the screen size is larger than Intel AMT should be able to handle
                    //console.log('KVM Buffer Size: ' + (obj.bpp * obj.width * obj.height));
                    if ((obj.parent) && ((obj.bpp * obj.width * obj.height) > 9216000)) { obj.parent.disconnectCode = 50002; } // Display buffer too large.
                } else if (encoding == 0) {
                    // RAW encoding
                    var ptr = 12, cs = 12 + (s * obj.bpp);
                    if (obj.acc.byteLength < cs) return; // Check we have all the data needed and we can only draw 64x64 tiles.
                    cmdsize = cs;

                    // CRITICAL LOOP, optimize this as much as possible
                    if (obj.bpp == 2) {
                        for (var i = 0; i < s; i++) { _setPixel16(accview.getUint16(ptr, true), i); ptr += 2; }
                    } else {
                        for (var i = 0; i < s; i++) { _setPixel8(obj.acc[ptr++], i); }
                    }
                    _putImage(obj.spare, x, y);
                } else if (encoding == 16) {
                    // RLE encoding
                    if (obj.acc.byteLength < 16) return;
                    var datalen = accview.getUint32(12);
                    if (obj.acc.byteLength < (16 + datalen)) return;

                    // Process the ZLib header if this is the first block
                    var ptr = 16, delta = 5, dx = 0;

                    if ((datalen > 5) && (obj.acc[ptr] == 0) && (accview.getUint16(ptr + 1, true) == (datalen - delta))) {
                        // This is an uncompressed ZLib data block
                        _decodeLRE(obj.acc, ptr + 5, x, y, width, height, s, datalen);
                    }
                    // ###BEGIN###{Inflate}
                    else {
                        // This is compressed ZLib data, decompress and process it. (TODO: This need to be optimized, remove str/arr conversions)
                        var str = obj.inflate.inflate(arrToStr(new Uint8Array(obj.acc.buffer.slice(ptr, ptr + datalen - dx))));
                        if (str.length > 0) { _decodeLRE(strToArr(str), 0, x, y, width, height, s, str.length); } else { console.log('Invalid deflate data'); }
                    }
                    // ###END###{Inflate}

                    cmdsize = 16 + datalen;
                } else { return obj.Stop(); }
                if (--obj.state == 100) {
                    obj.state = 4;
                    if (obj.frameRateDelay == 0) {
                        _SendRefresh(); // Ask for new frame
                    } else {
                        setTimeout(_SendRefresh, obj.frameRateDelay); // Hold x miliseconds before asking for a new frame
                    }
                }
            }

            //console.log('cmdsize', cmdsize);
            if (cmdsize == 0) return;
            if (cmdsize != obj.acc.byteLength) { obj.acc = new Uint8Array(obj.acc.buffer.slice(cmdsize)); } else { obj.acc = null; }
        }
    }

    function _decodeLRE(data, ptr, x, y, width, height, s, datalen) {
        var subencoding = data[ptr++], index, v, runlengthdecode, palette = {}, rlecount = 0, runlength = 0, i;
        if (subencoding == 0) {
            // RAW encoding
            if (obj.bpp == 2) {
                for (i = 0; i < s; i++) { _setPixel16(data[ptr++] + (data[ptr++] << 8), i); }
            } else {
                for (i = 0; i < s; i++) { _setPixel8(data[ptr++], i); }
            }
            _putImage(obj.spare, x, y);
        }
        else if (subencoding == 1) {
            // Solid color tile
            if (obj.graymode) {
                v = data[ptr++];
                if (obj.lowcolor) { v = v << 4; }
                obj.canvas.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
            } else {
                v = data[ptr++] + ((obj.bpp == 2) ? (data[ptr++] << 8) : 0);
                obj.canvas.fillStyle = 'rgb(' + ((obj.bpp == 1) ? ((v & 224) + ',' + ((v & 28) << 3) + ',' + _fixColor((v & 3) << 6)) : (((v >> 8) & 248) + ',' + ((v >> 3) & 252) + ',' + ((v & 31) << 3))) + ')';
            }

            // ###BEGIN###{DesktopRotation}
            var xx = _rotX(x, y);
            y = _rotY(x, y);
            x = xx;
            // ###END###{DesktopRotation}

            obj.canvas.fillRect(x, y, width, height);
        }
        else if (subencoding > 1 && subencoding < 17) { // Packed palette encoded tile
            // Read the palette
            var br = 4, bm = 15; // br is BitRead and bm is BitMask. By adjusting these two we can support all the variations in this encoding.
            if (obj.bpp == 2) {
                for (i = 0; i < subencoding; i++) { palette[i] = data[ptr++] + (data[ptr++] << 8); }
                if (subencoding == 2) { br = 1; bm = 1; } else if (subencoding <= 4) { br = 2; bm = 3; } // Compute bits to read & bit mark
                while (rlecount < s && ptr < data.byteLength) { v = data[ptr++]; for (i = (8 - br); i >= 0; i -= br) { _setPixel16(palette[(v >> i) & bm], rlecount++); } } // Display all the bits
            } else {
                for (i = 0; i < subencoding; i++) { palette[i] = data[ptr++]; }
                if (subencoding == 2) { br = 1; bm = 1; } else if (subencoding <= 4) { br = 2; bm = 3; } // Compute bits to read & bit mark
                while (rlecount < s && ptr < data.byteLength) { v = data[ptr++]; for (i = (8 - br); i >= 0; i -= br) { _setPixel8(palette[(v >> i) & bm], rlecount++); } } // Display all the bits
            }
            _putImage(obj.spare, x, y);
        }
        else if (subencoding == 128) { // RLE encoded tile
            if (obj.bpp == 2) {
                while (rlecount < s && ptr < data.byteLength) {
                    // Get the run color
                    v = data[ptr++] + (data[ptr++] << 8);

                    // Decode the run length. This is the fastest and most compact way I found to do this.
                    runlength = 1; do { runlength += (runlengthdecode = data[ptr++]); } while (runlengthdecode == 255);

                    // Draw a run
                    if (obj.rotation == 0) {
                        _setPixel16run(v, rlecount, runlength); rlecount += runlength;
                    } else {
                        while (--runlength >= 0) { _setPixel16(v, rlecount++); }
                    }
                }
            } else {
                while (rlecount < s && ptr < data.byteLength) {
                    // Get the run color
                    v = data[ptr++];

                    // Decode the run length. This is the fastest and most compact way I found to do this.
                    runlength = 1; do { runlength += (runlengthdecode = data[ptr++]); } while (runlengthdecode == 255);

                    // Draw a run
                    if (obj.rotation == 0) {
                        _setPixel8run(v, rlecount, runlength); rlecount += runlength;
                    } else {
                        while (--runlength >= 0) { _setPixel8(v, rlecount++); }
                    }
                }
            }
            _putImage(obj.spare, x, y);
        }
        else if (subencoding > 129) { // Palette RLE encoded tile
            // Read the palette
            if (obj.bpp == 2) {
                for (i = 0; i < (subencoding - 128); i++) { palette[i] = data[ptr++] + (data[ptr++] << 8); }
            } else {
                for (i = 0; i < (subencoding - 128); i++) { palette[i] = data[ptr++]; }
            }

            // Decode RLE  on palette
            while (rlecount < s && ptr < data.byteLength) {
                // Setup the run, get the color index and get the color from the palette.
                runlength = 1; index = data[ptr++]; v = palette[index % 128];

                // If the index starts with high order bit 1, this is a run and decode the run length.
                if (index > 127) { do { runlength += (runlengthdecode = data[ptr++]); } while (runlengthdecode == 255); }

                // Draw a run
                if (obj.rotation == 0) {
                    if (obj.bpp == 2) {
                        _setPixel16run(v, rlecount, runlength); rlecount += runlength;
                    } else {
                        _setPixel8run(v, rlecount, runlength); rlecount += runlength;
                    }
                } else {
                    if (obj.bpp == 2) {
                        while (--runlength >= 0) { _setPixel16(v, rlecount++); }
                    } else {
                        while (--runlength >= 0) { _setPixel8(v, rlecount++); }
                    }
                }
            }
            _putImage(obj.spare, x, y);
        }
    }

    // ###BEGIN###{DesktopInband}
    obj.hold = function (holding) {
        if (obj.holding == holding) return;
        obj.holding = holding;
        obj.canvas.fillStyle = '#000000';
        obj.canvas.fillRect(0, 0, obj.width, obj.height); // Paint black
        if (obj.holding == false) {
            // Go back to normal operations
            // Set canvas size and ask for full screen refresh
            if ((obj.canvas.canvas.width != obj.width) || (obj.canvas.canvas.height != obj.height)) {
                obj.canvas.canvas.width = obj.width; obj.canvas.canvas.height = obj.height;
                if (obj.onScreenSizeChange != null) { obj.onScreenSizeChange(obj, obj.ScreenWidth, obj.ScreenHeight); } // ???
            }
            obj.send(String.fromCharCode(3, 0, 0, 0, 0, 0) + ShortToStr(obj.width) + ShortToStr(obj.height)); // FramebufferUpdateRequest
        } else {
            obj.UnGrabMouseInput();
            obj.UnGrabKeyInput();
        }
    }
    // ###END###{DesktopInband}

    function _putImage(i, x, y) {
        // ###BEGIN###{DesktopInband}
        if (obj.holding == true) return;
        // ###END###{DesktopInband}
        // ###BEGIN###{DesktopRotation}
        var xx = _arotX(x, y);
        y = _arotY(x, y);
        x = xx;
        // ###END###{DesktopRotation}
        obj.canvas.putImageData(i, x, y);
    }

    // Set 8bit color RGB332
    function _setPixel8(v, p) {
        var pp = p << 2;

        // ###BEGIN###{DesktopRotation}
        if (obj.rotation > 0) {
            if (obj.rotation == 1) { var x = p % obj.sparew, y = Math.floor(p / obj.sparew); p = (x * obj.sparew2) + (obj.sparew2 - 1 - y); pp = p << 2; }
            else if (obj.rotation == 2) { pp = (obj.sparew * obj.spareh * 4) - 4 - pp; }
            else if (obj.rotation == 3) { var x = p % obj.sparew, y = Math.floor(p / obj.sparew); p = ((obj.sparew2 - 1 - x) * obj.sparew2) + (y); pp = p << 2; }
        }
        // ###END###{DesktopRotation}

        if (obj.graymode) {
            if (obj.lowcolor) { v = v << 4; }
            obj.spare.data[pp] = obj.spare.data[pp + 1] = obj.spare.data[pp + 2] = v;
        } else {
            obj.spare.data[pp] = v & 224;
            obj.spare.data[pp + 1] = (v & 28) << 3;
            obj.spare.data[pp + 2] = _fixColor((v & 3) << 6);
        }
    }

    // Set 16bit color RGB565
    function _setPixel16(v, p) {
        var pp = p << 2;

        // ###BEGIN###{DesktopRotation}
        if (obj.rotation > 0) {
            if (obj.rotation == 1) { var x = p % obj.sparew, y = Math.floor(p / obj.sparew); p = (x * obj.sparew2) + (obj.sparew2 - 1 - y); pp = p << 2; }
            else if (obj.rotation == 2) { pp = (obj.sparew * obj.spareh * 4) - 4 - pp; }
            else if (obj.rotation == 3) { var x = p % obj.sparew, y = Math.floor(p / obj.sparew); p = ((obj.sparew2 - 1 - x) * obj.sparew2) + (y); pp = p << 2; }
        }
        // ###END###{DesktopRotation}

        obj.spare.data[pp] = (v >> 8) & 248;
        obj.spare.data[pp + 1] = (v >> 3) & 252;
        obj.spare.data[pp + 2] = (v & 31) << 3;
    }

    // Set a run of 8bit color RGB332
    function _setPixel8run(v, p, run) {
        if (obj.graymode) {
            var pp = (p << 2);
            if (obj.lowcolor) { v = v << 4; }
            while (--run >= 0) { obj.spare.data[pp] = obj.spare.data[pp + 1] = obj.spare.data[pp + 2] = v; pp += 4; }
        } else {
            var pp = (p << 2), r = (v & 224), g = ((v & 28) << 3), b = (_fixColor((v & 3) << 6));
            while (--run >= 0) { obj.spare.data[pp] = r; obj.spare.data[pp + 1] = g; obj.spare.data[pp + 2] = b; pp += 4; }
        }
    }

    // Set a run of 16bit color RGB565
    function _setPixel16run(v, p, run) {
        var pp = (p << 2), r = ((v >> 8) & 248), g = ((v >> 3) & 252), b = ((v & 31) << 3);
        while (--run >= 0) { obj.spare.data[pp] = r; obj.spare.data[pp + 1] = g; obj.spare.data[pp + 2] = b; pp += 4; }
    }

    // ###BEGIN###{DesktopRotation}
    function _arotX(x, y) {
        if (obj.rotation == 0) return x;
        if (obj.rotation == 1) return obj.canvas.canvas.width - obj.sparew2 - y;
        if (obj.rotation == 2) return obj.canvas.canvas.width - obj.sparew2 - x;
        if (obj.rotation == 3) return y;
        return 0;
    }

    function _arotY(x, y) {
        if (obj.rotation == 0) return y;
        if (obj.rotation == 1) return x;
        if (obj.rotation == 2) return obj.canvas.canvas.height - obj.spareh2 - y;
        if (obj.rotation == 3) return obj.canvas.canvas.height - obj.spareh - x;
        return 0;
    }

    function _crotX(x, y) {
        if (obj.rotation == 0) return x;
        if (obj.rotation == 1) return y;
        if (obj.rotation == 2) return obj.canvas.canvas.width - x;
        if (obj.rotation == 3) return obj.canvas.canvas.height - y;
        return 0;
    }

    function _crotY(x, y) {
        if (obj.rotation == 0) return y;
        if (obj.rotation == 1) return obj.canvas.canvas.width - x;
        if (obj.rotation == 2) return obj.canvas.canvas.height - y;
        if (obj.rotation == 3) return x;
        return 0;
    }

    function _rotX(x, y) {
        if (obj.rotation == 0) return x;
        if (obj.rotation == 1) return x;
        if (obj.rotation == 2) return x - obj.canvas.canvas.width;
        if (obj.rotation == 3) return x - obj.canvas.canvas.height;
        return 0;
    }

    function _rotY(x, y) {
        if (obj.rotation == 0) return y;
        if (obj.rotation == 1) return y - obj.canvas.canvas.width;
        if (obj.rotation == 2) return y - obj.canvas.canvas.height;
        if (obj.rotation == 3) return y;
        return 0;
    }

    obj.tcanvas = null;
    obj.setRotation = function (x) {
        while (x < 0) { x += 4; }
        var newrotation = x % 4;
        //console.log('hard-rot: ' + newrotation);
        // ###BEGIN###{DesktopInband}
        if (obj.holding == true) { obj.rotation = newrotation; return; }
        // ###END###{DesktopInband}

        if (newrotation == obj.rotation) return true;
        var rw = obj.canvas.canvas.width;
        var rh = obj.canvas.canvas.height;
        if (obj.rotation == 1 || obj.rotation == 3) { rw = obj.canvas.canvas.height; rh = obj.canvas.canvas.width; }

        // Copy the canvas, put it back in the correct direction
        if (obj.tcanvas == null) obj.tcanvas = document.createElement('canvas');
        var tcanvasctx = obj.tcanvas.getContext('2d');
        tcanvasctx.setTransform(1, 0, 0, 1, 0, 0);
        tcanvasctx.canvas.width = rw;
        tcanvasctx.canvas.height = rh;
        tcanvasctx.rotate((obj.rotation * -90) * Math.PI / 180);
        if (obj.rotation == 0) tcanvasctx.drawImage(obj.canvas.canvas, 0, 0);
        if (obj.rotation == 1) tcanvasctx.drawImage(obj.canvas.canvas, -obj.canvas.canvas.width, 0);
        if (obj.rotation == 2) tcanvasctx.drawImage(obj.canvas.canvas, -obj.canvas.canvas.width, -obj.canvas.canvas.height);
        if (obj.rotation == 3) tcanvasctx.drawImage(obj.canvas.canvas, 0, -obj.canvas.canvas.height);

        // Change the size and orientation and copy the canvas back into the rotation
        if (obj.rotation == 0 || obj.rotation == 2) { obj.canvas.canvas.height = rw; obj.canvas.canvas.width = rh; }
        if (obj.rotation == 1 || obj.rotation == 3) { obj.canvas.canvas.height = rh; obj.canvas.canvas.width = rw; }
        obj.canvas.setTransform(1, 0, 0, 1, 0, 0);
        obj.canvas.rotate((newrotation * 90) * Math.PI / 180);
        obj.rotation = newrotation;
        obj.canvas.drawImage(obj.tcanvas, _rotX(0, 0), _rotY(0, 0));

        obj.width = obj.canvas.canvas.width;
        obj.height = obj.canvas.canvas.height;
        if (obj.onScreenResize != null) obj.onScreenResize(obj, obj.width, obj.height, obj.CanvasId);
        return true;
    }
    // ###END###{DesktopRotation}

    function _fixColor(c) { return (c > 127) ? (c + 32) : c; }

    function _SendRefresh() {
        // ###BEGIN###{DesktopInband}
        if (obj.holding == true) return;
        // ###END###{DesktopInband}
        // ###BEGIN###{DesktopFocus}
        if (obj.focusmode > 0) {
            // Request only pixels around the last mouse position
            var df = obj.focusmode * 2;
            obj.send(String.fromCharCode(3, 1) + ShortToStr(Math.max(Math.min(obj.ox, obj.mx) - obj.focusmode, 0)) + ShortToStr(Math.max(Math.min(obj.oy, obj.my) - obj.focusmode, 0)) + ShortToStr(df + Math.abs(obj.ox - obj.mx)) + ShortToStr(df + Math.abs(obj.oy - obj.my))); // FramebufferUpdateRequest
            obj.ox = obj.mx;
            obj.oy = obj.my;
        } else {
            // ###END###{DesktopFocus}
            // Request the entire screen
            obj.send(String.fromCharCode(3, 1, 0, 0, 0, 0) + ShortToStr(obj.rwidth) + ShortToStr(obj.rheight)); // FramebufferUpdateRequest
            // ###BEGIN###{DesktopFocus}
        }
        // ###END###{DesktopFocus}
    }

    obj.Start = function () {
        obj.state = 0;
        obj.acc = null;
        // ###BEGIN###{Inflate}
        obj.inflate.inflateReset();
        // ###END###{Inflate}
        // ###BEGIN###{DesktopInband}
        obj.onKvmDataPending = [];
        obj.onKvmDataAck = -1;
        obj.kvmDataSupported = false;
        obj.kvmExt = {};
        // ###END###{DesktopInband}
        for (var i in obj.sparecache) { delete obj.sparecache[i]; }
    }

    obj.Stop = function () { obj.UnGrabMouseInput(); obj.UnGrabKeyInput(); if (obj.parent) { obj.parent.Stop(); } }
    obj.send = function (x) { if (obj.parent) { obj.parent.send(x); } }

    var convertAmtKeyCodeTable = {
        'Pause': 19,
        'CapsLock': 20,
        'Space': 32,
        'Quote': 39,
        'Minus': 45,
        'NumpadMultiply': 42,
        'NumpadAdd': 43,
        'PrintScreen': 44,
        'Comma': 44,
        'NumpadSubtract': 45,
        'NumpadDecimal': 46,
        'Period': 46,
        'Slash': 47,
        'NumpadDivide': 47,
        'Semicolon': 59,
        'Equal': 61,
        'OSLeft': 91,
        'BracketLeft': 91,
        'OSRight': 91,
        'Backslash': 92,
        'BracketRight': 93,
        'ContextMenu': 93,
        'Backquote': 96,
        'NumLock': 144,
        'ScrollLock': 145,
        'Backspace': 0xff08,
        'Tab': 0xff09,
        'Enter': 0xff0d,
        'NumpadEnter': 0xff0d,
        'Escape': 0xff1b,
        'Delete': 0xffff,
        'Home': 0xff50,
        'PageUp': 0xff55,
        'PageDown': 0xff56,
        'ArrowLeft': 0xff51,
        'ArrowUp': 0xff52,
        'ArrowRight': 0xff53,
        'ArrowDown': 0xff54,
        'End': 0xff57,
        'Insert': 0xff63,
        'F1': 0xffbe,
        'F2': 0xffbf,
        'F3': 0xffc0,
        'F4': 0xffc1,
        'F5': 0xffc2,
        'F6': 0xffc3,
        'F7': 0xffc4,
        'F8': 0xffc5,
        'F9': 0xffc6,
        'F10': 0xffc7,
        'F11': 0xffc8,
        'F12': 0xffc9,
        'ShiftLeft': 0xffe1,
        'ShiftRight': 0xffe2,
        'ControlLeft': 0xffe3,
        'ControlRight': 0xffe4,
        'AltLeft': 0xffe9,
        'AltRight': 0xffea,
        'MetaLeft': 0xffe7,
        'MetaRight': 0xffe8
    }
    function convertAmtKeyCode(e) {
        if (e.code.startsWith('Key') && e.code.length == 4) { return e.code.charCodeAt(3) + ((e.shiftKey == false) ? 32 : 0); }
        if (e.code.startsWith('Digit') && e.code.length == 6) { return e.code.charCodeAt(5); }
        if (e.code.startsWith('Numpad') && e.code.length == 7) { return e.code.charCodeAt(6); }
        return convertAmtKeyCodeTable[e.code];
    }

    /*
    Intel AMT only recognizes a small subset of keysym characters defined in the keysymdef.h so you don’t need to
    implement all the languages (this is taken care by the USB Scancode Extension in RFB4.0 protocol).
    The only subset recognized by the FW is the defined by the following sets : XK_LATIN1 , XK_MISCELLANY, XK_3270, XK_XKB_KEYS, XK_KATAKANA.
    In addition to keysymdef.h symbols there are 6 japanese extra keys that we do support:
    
    #define XK_Intel_EU_102kbd_backslash_pipe_45  0x17170056 // European 102-key: 45 (backslash/pipe),     usb Usage: 0x64
    #define XK_Intel_JP_106kbd_yen_pipe           0x1717007d // Japanese 106-key: 14 (Yen/pipe),           usb Usage: 0x89
    #define XK_Intel_JP_106kbd_backslash_underbar 0x17170073 // Japanese 106-key: 56 (backslash/underbar), usb Usage: 0x87
    #define XK_Intel_JP_106kbd_NoConvert          0x1717007b // Japanese 106-key: 131 (NoConvert),         usb Usage: 0x8b
    #define XK_Intel_JP_106kbd_Convert            0x17170079 // Japanese 106-key: 132 (Convert),           usb Usage: 0x8a
    #define XK_Intel_JP_106kbd_Hirigana_Katakana  0x17170070 // Japanese 106-key: 133 (Hirigana/Katakana), usb Usage: 0x88
    */

    function _keyevent(d, e) {
        if (!e) { e = window.event; }

        if (e.code && (obj.localKeyMap == false)) {
            // For new browsers, this mapping is keyboard language independent
            var k = convertAmtKeyCode(e);
            if (k != null) { obj.sendkey(k, d); }
        } else {
            // For older browsers, this mapping works best for EN-US keyboard
            var k = e.keyCode, kk = k;
            if (e.shiftKey == false && k >= 65 && k <= 90) kk = k + 32;
            if (k >= 112 && k <= 124) kk = k + 0xFF4E;
            if (k == 8) kk = 0xff08; // Backspace
            if (k == 9) kk = 0xff09; // Tab
            if (k == 13) kk = 0xff0d; // Return
            if (k == 16) kk = 0xffe1; // Shift (Left)
            if (k == 17) kk = 0xffe3; // Ctrl (Left)
            if (k == 18) kk = 0xffe9; // Alt (Left)
            if (k == 27) kk = 0xff1b; // ESC
            if (k == 33) kk = 0xff55; // PageUp
            if (k == 34) kk = 0xff56; // PageDown
            if (k == 35) kk = 0xff57; // End
            if (k == 36) kk = 0xff50; // Home
            if (k == 37) kk = 0xff51; // Left
            if (k == 38) kk = 0xff52; // Up
            if (k == 39) kk = 0xff53; // Right
            if (k == 40) kk = 0xff54; // Down
            if (k == 45) kk = 0xff63; // Insert
            if (k == 46) kk = 0xffff; // Delete
            if (k >= 96 && k <= 105) kk = k - 48; // Key pad numbers
            if (k == 106) kk = 42; // Pad *
            if (k == 107) kk = 43; // Pad +
            if (k == 109) kk = 45; // Pad -
            if (k == 110) kk = 46; // Pad .
            if (k == 111) kk = 47; // Pad /
            if (k == 186) kk = 59; // ;
            if (k == 187) kk = 61; // =
            if (k == 188) kk = 44; // ,
            if (k == 189) kk = 45; // -
            if (k == 190) kk = 46; // .
            if (k == 191) kk = 47; // /
            if (k == 192) kk = 96; // `
            if (k == 219) kk = 91; // [
            if (k == 220) kk = 92; // \
            if (k == 221) kk = 93; // ]
            if (k == 222) kk = 39; // '
            //console.log('Key' + d + ': ' + k + ' = ' + kk);
            obj.sendkey(kk, d);
        }
        return obj.haltEvent(e);
    }

    obj.sendkey = function (k, d) {
        if (typeof k == 'object') {
            var buf = ''; for (var i in k) { buf += (String.fromCharCode(4, k[i][1], 0, 0) + IntToStr(k[i][0])); } obj.send(buf);
        } else {
            obj.send(String.fromCharCode(4, d, 0, 0) + IntToStr(k));
        }
    }

    function handleServerCutText(acc, accview) {
        if (acc.byteLength < 8) return 0;
        var len = accview.getUint32(4) + 8;
        if (acc.byteLength < len) return 0;
        // ###BEGIN###{DesktopInband}
        if (obj.onKvmData != null) {
            var d = arrToStr(new Uint8Array(acc.buffer.slice(8, len)));
            if ((d.length >= 16) && (d.substring(0, 15) == '\0KvmDataChannel')) {
                if (obj.kvmDataSupported == false) { obj.kvmDataSupported = true; /*console.log('KVM Data Channel Supported.');*/ }
                if (((obj.onKvmDataAck == -1) && (d.length == 16)) || (d.charCodeAt(15) != 0)) { obj.onKvmDataAck = true; }
                try { if (urlvars && urlvars['kvmdatatrace']) { console.log('KVM-DataChannel-Recv(' + (d.length - 16) + '): ' + d.substring(16)); } } catch (ex) { }
                if (d.length >= 16) { obj.onKvmData(d.substring(16)); } // Event the data and ack
                if ((obj.onKvmDataAck == true) && (obj.onKvmDataPending.length > 0)) { obj.sendKvmData(obj.onKvmDataPending.shift()); } // Send pending data
            } else if ((d.length >= 13) && (d.substring(0, 11) == '\0KvmExtCmd\0')) {
                var cmd = d.charCodeAt(11), val = d.charCodeAt(12);
                //console.log('Received KvmExtCmd', cmd, val, d.length);
                if (cmd == 1) {
                    obj.kvmExt.decimationMode = val;
                    if (d.length > 13) { obj.kvmExt.decimationState = d.charCodeAt(13); }
                    if (obj.kvmExtChanged != null) { obj.kvmExtChanged(1, obj.kvmExt, obj.kvmExt); }
                }
                if (cmd == 2) { obj.sendKvmExtCmd(1); }
                if (cmd == 3) { obj.kvmExt.compression = val; if (obj.kvmExtChanged != null) { obj.kvmExtChanged(3, obj.kvmExt); } }
                if (cmd == 4) { obj.sendKvmExtCmd(3); }
            } else {
                console.log('Got KVM clipboard data:', d);
                try { if (urlvars && urlvars['kvmdatatrace']) { console.log('KVM-ClipBoard-Recv(' + d.length + '): ' + rstr2hex(d) + ', ' + d); } } catch (ex) { }
            }
        }
        // ###END###{DesktopInband}
        return len;
    }

    // ###BEGIN###{DesktopInband}
    obj.sendKvmExtCmd = function (cmd, val) {
        //console.log('Sending KvmExtCmd', cmd, val);
        var x = '\0KvmExtCmd\0' + String.fromCharCode(cmd) + (val != null ? String.fromCharCode(val) : '');
        obj.send(String.fromCharCode(6, 0, 0, 0) + IntToStr(x.length) + x);
    }

    obj.sendKvmData = function (x) {
        if (obj.onKvmDataAck !== true) {
            obj.onKvmDataPending.push(x);
        } else {
            try { if (urlvars && urlvars['kvmdatatrace']) { console.log('KVM-DataChannel-Send(' + x.length + '): ' + x); } } catch (ex) { }
            x = '\0KvmDataChannel\0' + x;
            obj.send(String.fromCharCode(6, 0, 0, 0) + IntToStr(x.length) + x);
            obj.onKvmDataAck = false;
        }
    }

    // Send a HWKVM keep alive if it's not been sent in the last 5 seconds.
    obj.sendKeepAlive = function () {
        if (obj.lastKeepAlive < Date.now() - 5000) { obj.lastKeepAlive = Date.now(); obj.send(String.fromCharCode(6, 0, 0, 0) + IntToStr(16) + '\0KvmDataChannel\0'); }
    }
    // ###END###{DesktopInband}

    // ###BEGIN###{DesktopClipboard}
    obj.sendClipboardData = function (x) {
        try { if (urlvars && urlvars['kvmdatatrace']) { console.log('KVM-ClipBoard-Send(' + x.length + '): ' + rstr2hex(x) + ', ' + x); } } catch (ex) { }
        obj.send(String.fromCharCode(6, 0, 0, 0) + IntToStr(x.length) + x);
    }
    // ###END###{DesktopClipboard}

    obj.SendCtrlAltDelMsg = function () { obj.sendcad(); }
    obj.sendcad = function () { obj.sendkey([[0xFFE3, 1], [0xFFE9, 1], [0xFFFF, 1], [0xFFFF, 0], [0xFFE9, 0], [0xFFE3, 0]]); } // Control down, Alt down, Delete down, Delete up , Alt up , Control up

    var _MouseInputGrab = false;
    var _KeyInputGrab = false;

    obj.GrabMouseInput = function () {
        if (_MouseInputGrab == true) return;
        var c = obj.canvas.canvas;
        c.onmouseup = obj.mouseup;
        c.onmousedown = obj.mousedown;
        c.onmousemove = obj.mousemove;
        //c.onmousewheel = obj.mousewheel;
        c.onwheel = obj.mousewheel;
        //if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = obj.xxDOMMouseScroll; else c.onmousewheel = obj.xxMouseWheel;
        _MouseInputGrab = true;
    }

    obj.UnGrabMouseInput = function () {
        if (_MouseInputGrab == false) return;
        var c = obj.canvas.canvas;
        c.onmousemove = null;
        c.onmouseup = null;
        c.onmousedown = null;
        //c.onmousewheel = null;
        c.onwheel = null;
        //if (navigator.userAgent.match(/mozilla/i)) c.DOMMouseScroll = null; else c.onmousewheel = null;
        _MouseInputGrab = false;
    }

    obj.GrabKeyInput = function () {
        if (_KeyInputGrab == true) return;
        document.onkeyup = obj.handleKeyUp;
        document.onkeydown = obj.handleKeyDown;
        document.onkeypress = obj.handleKeys;
        _KeyInputGrab = true;
    }

    obj.UnGrabKeyInput = function () {
        if (_KeyInputGrab == false) return;
        document.onkeyup = null;
        document.onkeydown = null;
        document.onkeypress = null;
        _KeyInputGrab = false;
    }

    obj.handleKeys = function (e) { return obj.haltEvent(e); }
    obj.handleKeyUp = function (e) { return _keyevent(0, e); }
    obj.handleKeyDown = function (e) { return _keyevent(1, e); }
    obj.haltEvent = function (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); return false; }

    // RFB 'PointerEvent' and mouse handlers
    obj.mousedblclick = function (e) { }
    obj.mousewheel = function (e) {
        var v = 0;
        if (typeof e.deltaY == 'number') { v = -1 * e.deltaY; }
        else if (typeof e.detail == 'number') { v = -1 * e.detail; }
        else if (typeof e.wheelDelta == 'number') { v = e.wheelDelta; }
        if (v == 0) return;
        var tmpmask = obj.buttonmask;
        obj.buttonmask |= (1 << ((v > 0) ? 3 : 4));
        obj.mousemove(e, 1);
        obj.buttonmask = tmpmask;
        return obj.mousemove(e, 1);
    }
    obj.mousedown = function (e) { obj.buttonmask |= (1 << e.button); return obj.mousemove(e, 1); }
    obj.mouseup = function (e) { obj.buttonmask &= (0xFFFF - (1 << e.button)); return obj.mousemove(e, 1); }
    obj.mousemove = function (e, force) {
        if (obj.state < 4) return true;
        var ScaleFactorHeight = (obj.canvas.canvas.height / Q(obj.canvasid).offsetHeight);
        var ScaleFactorWidth = (obj.canvas.canvas.width / Q(obj.canvasid).offsetWidth);
        var Offsets = obj.getPositionOfControl(Q(obj.canvasid));
        obj.mx = ((event.pageX - Offsets[0]) * ScaleFactorWidth);
        obj.my = ((event.pageY - Offsets[1]) * ScaleFactorHeight);
        if (event.addx) { obj.mx += event.addx; }
        if (event.addy) { obj.my += event.addy; }

        // ###BEGIN###{DesktopRotation}
        if ((obj.rotation == 1) || (obj.rotation == 3)) {
            obj.mx = ((obj.mx * obj.rwidth) / obj.width);
            obj.my = ((obj.my * obj.rheight) / obj.height);
        }
        if (obj.noMouseRotate != true) {
            var mx2 = _crotX(obj.mx, obj.my);
            obj.my = _crotY(obj.mx, obj.my);
            obj.mx = mx2;
        }
        // ###END###{DesktopRotation}

        // This is the mouse motion nagle timer. Slow down the mouse motion event rate.
        if (force == 1) {
            obj.send(String.fromCharCode(5, obj.buttonmask) + ShortToStr(obj.mx) + ShortToStr(obj.my));
            if (obj.mNagleTimer != null) { clearTimeout(obj.mNagleTimer); obj.mNagleTimer = null; }
        } else {
            if (obj.mNagleTimer == null) {
                obj.mNagleTimer = setTimeout(function () {
                    obj.send(String.fromCharCode(5, obj.buttonmask) + ShortToStr(obj.mx) + ShortToStr(obj.my));
                    obj.mNagleTimer = null;
                }, 50);
            }
        }

        // ###BEGIN###{DesktopFocus}
        // Update focus area if we are in focus mode
        QV('DeskFocus', obj.focusmode);
        if (obj.focusmode != 0) {
            var x = Math.min(obj.mx, obj.canvas.canvas.width - obj.focusmode),
                y = Math.min(obj.my, obj.canvas.canvas.height - obj.focusmode),
                df = obj.focusmode * 2,
                c = Q(obj.canvasid),
                qx = c.offsetHeight / obj.canvas.canvas.height,
                qy = c.offsetWidth / obj.canvas.canvas.width,
                q = QS('DeskFocus'),
                ppos = obj.getPositionOfControl(Q(obj.canvasid).parentElement);
            q.left = (Math.max(((x - obj.focusmode) * qx), 0) + (pos[0] - ppos[0])) + 'px';
            q.top = (Math.max(((y - obj.focusmode) * qy), 0) + (pos[1] - ppos[1])) + 'px';
            q.width = ((df * qx) - 6) + 'px';
            q.height = ((df * qx) - 6) + 'px';
        }
        // ###END###{DesktopFocus}

        return obj.haltEvent(e);
    }

    obj.getPositionOfControl = function (Control) {
        var Position = Array(2);
        Position[0] = Position[1] = 0;
        while (Control) {
            Position[0] += Control.offsetLeft;
            Position[1] += Control.offsetTop;
            Control = Control.offsetParent;
        }
        return Position;
    }

    // ###BEGIN###{DesktopRecorder}
    obj.StartRecording = function () {
        if ((obj.recordedData != null) && (obj.DeskRecordServerInit != null)) return false;
        obj.recordedHolding = true;
        obj.recordedData = [];
        obj.recordedStart = Date.now();
        obj.recordedSize = 0;
        obj.recordedData.push(recordingEntry(1, 0, JSON.stringify({ magic: 'MeshCentralRelaySession', ver: 1, time: new Date().toLocaleString(), protocol: 200, bpp: obj.bpp, graymode: obj.graymode, lowcolor: obj.lowcolor, screenSize: [obj.width, obj.height] }))); // Metadata, 200 = Midstream Intel AMT KVM
        obj.DeskRecordServerInit = String.fromCharCode((obj.width >> 8), (obj.width & 0xFF), (obj.height >> 8), (obj.height & 0xFF)) + obj.DeskRecordServerInit.substring(4);
        obj.recordedData.push(recordingEntry(2, 1, obj.DeskRecordServerInit)); // This is the server init command
        obj.recordedData.push(recordingEntry(3, 0, atob(obj.CanvasId.toDataURL('image/png').split(',')[1]))); // Take a screen shot
        return true;
    }

    obj.StopRecording = function () {
        if (obj.recordedData == null) return;
        var r = obj.recordedData;
        r.push(recordingEntry(3, 0, 'MeshCentralMCREC'));
        delete obj.recordedData;
        delete obj.recordedStart;
        delete obj.recordedSize;
        return r;
    }

    function recordingEntry(type, flags, data) {
        //console.log('recordingEntry', type, flags, (typeof data == 'number')?data:data.length);
        // Header: Type (2) + Flags (2) + Size(4) + Time(8)
        // Type (1 = Header, 2 = Network Data), Flags (1 = Binary, 2 = User), Size (4 bytes), Time (8 bytes)
        var now = Date.now();
        if (typeof data == 'number') {
            obj.recordedSize += data;
            return ShortToStr(type) + ShortToStr(flags) + IntToStr(data) + IntToStr(now >> 32) + IntToStr(now & 32);
        } else {
            obj.recordedSize += data.length;
            return ShortToStr(type) + ShortToStr(flags) + IntToStr(data.length) + IntToStr(now >> 32) + IntToStr(now & 32) + data;
        }
    }
    // ###END###{DesktopRecorder}

    return obj;
}
