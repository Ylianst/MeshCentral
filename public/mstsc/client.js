/*
 * Copyright (c) 2015 Sylvain Peyrefitte
 *
 * This file is part of mstsc.js.
 *
 * mstsc.js is free software: you can redistribute it and/or modify
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

(function() {
	/**
	 * Mouse button mapping
	 * @param button {integer} client button number
	 */
	function mouseButtonMap(button) {
		switch(button) {
		    case 0: return 1;
		    case 2: return 2;
		    default: return 0;
		}
	};
	
	/**
	 * Mstsc client
	 * Input client connection (mouse and keyboard)
	 * bitmap processing
	 * @param canvas {canvas} rendering element
	 */
	function Client(canvas) {
		this.canvas = canvas;
		// create renderer
		this.render = new Mstsc.Canvas.create(this.canvas); 
		this.socket = null;
        this.activeSession = false;
        this.mouseNagleTimer = null;
        this.mouseNagleData = null;
		this.install();
	}

    /*
    obj.mNagleTimer = setTimeout(function () {
        obj.send(String.fromCharCode(5, obj.buttonmask) + ShortToStr(obj.mx) + ShortToStr(obj.my));
        obj.mNagleTimer = null;
    }, 50);
    */

	Client.prototype = {
		install : function () {
            var self = this;

            // Bind mouse move event
			this.canvas.addEventListener('mousemove', function (e) {
                if (!self.socket || !self.activeSession) return;
                var rect = e.target.getBoundingClientRect();
                self.mouseNagleData = ['mouse', e.clientX - rect.left, e.clientY - rect.top, 0, false];
                if (self.mouseNagleTimer == null) {
                    //console.log('sending', self.mouseNagleData);
                    self.mouseNagleTimer = setTimeout(function () { self.socket.send(JSON.stringify(self.mouseNagleData)); self.mouseNagleTimer = null; }, 50);
                }
                //self.socket.send(JSON.stringify(this.mouseNagleData));
                e.preventDefault();
				return false;
			});
			this.canvas.addEventListener('mousedown', function (e) {
                if (!self.socket || !self.activeSession) return;
                if (self.mouseNagleTimer != null) { clearTimeout(self.mouseNagleTimer); self.mouseNagleTimer = null; }
                var rect = e.target.getBoundingClientRect();
                self.socket.send(JSON.stringify(['mouse', e.clientX - rect.left, e.clientY - rect.top, mouseButtonMap(e.button), true]));
				e.preventDefault();
				return false;
			});
			this.canvas.addEventListener('mouseup', function (e) {
				if (!self.socket || !self.activeSession) return;
                if (self.mouseNagleTimer != null) { clearTimeout(self.mouseNagleTimer); self.mouseNagleTimer = null; }
                var rect = e.target.getBoundingClientRect();
                self.socket.send(JSON.stringify(['mouse', e.clientX - rect.left, e.clientY - rect.top, mouseButtonMap(e.button), false]));
				e.preventDefault();
				return false;
			});
			this.canvas.addEventListener('contextmenu', function (e) {
				if (!self.socket || !self.activeSession) return;
                if (self.mouseNagleTimer != null) { clearTimeout(self.mouseNagleTimer); self.mouseNagleTimer = null; }
                var rect = e.target.getBoundingClientRect();
                self.socket.send(JSON.stringify(['mouse', e.clientX - rect.left, e.clientY - rect.top, mouseButtonMap(e.button), false]));
				e.preventDefault();
				return false;
			});
			this.canvas.addEventListener('DOMMouseScroll', function (e) {
				if (!self.socket || !self.activeSession) return;
                if (self.mouseNagleTimer != null) { clearTimeout(self.mouseNagleTimer); self.mouseNagleTimer = null; }
				var isHorizontal = false;
				var delta = e.detail;
                //var step = Math.round(Math.abs(delta) * 15 / 8);
                //var step = Math.abs(e.detail);
                var step = 128;
                //console.log('DOMMouseScroll', delta, step, e.detail);
                var rect = e.target.getBoundingClientRect();
                self.socket.send(JSON.stringify(['wheel', e.clientX - rect.left, e.clientY - rect.top, step, delta > 0, isHorizontal]));
				e.preventDefault();
				return false;
			});
			this.canvas.addEventListener('mousewheel', function (e) {
				if (!self.socket || !self.activeSession) return;
                if (self.mouseNagleTimer != null) { clearTimeout(self.mouseNagleTimer); self.mouseNagleTimer = null; }
				var isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
				var delta = isHorizontal?e.deltaX:e.deltaY;
				//var step = Math.round(Math.abs(delta) * 15 / 8);
                var step = 128;
                //console.log('mousewheel', delta, step, e);
                var rect = e.target.getBoundingClientRect();
                self.socket.send(JSON.stringify(['wheel', e.clientX - rect.left, e.clientY - rect.top, step, delta > 0, isHorizontal]));
				e.preventDefault();
				return false;
			});
			
			// Bind keyboard event
			window.addEventListener('keydown', function (e) {
				if (!self.socket || !self.activeSession) return;
                self.socket.send(JSON.stringify(['scancode', Mstsc.scancode(e), true]));
				e.preventDefault();
				return false;
			});
			window.addEventListener('keyup', function (e) {
				if (!self.socket || !self.activeSession) return;
                self.socket.send(JSON.stringify(['scancode', Mstsc.scancode(e), false]));
				e.preventDefault();
				return false;
			});
			
			return this;
        },
        /**
		 * disconnect
		 */
        disconnect: function () {
            if (this.socket) { this.socket.close(); }
        },
		/**
		 * connect
		 * @param ip {string} ip target for rdp
		 * @param domain {string} microsoft domain
		 * @param username {string} session username
		 * @param password {string} session password
		 * @param next {function} asynchrone end callback
		 */
		connect : function (ip, domain, username, password, options, next) {
			// Start connection
            var self = this;
            this.socket = new WebSocket('wss://' + window.location.host + '/mstscrelay.ashx');
            this.socket.binaryType = 'arraybuffer';
            this.socket.onopen = function () {
                //console.log("WS-OPEN");
                self.socket.send(JSON.stringify(['infos', {
                    ip: ip,
                    port: 3389,
                    screen: {
                        width: self.canvas.width,
                        height: self.canvas.height
                    },
                    domain: domain,
                    username: username,
                    password: password,
                    options: options,
                    locale: Mstsc.locale()
                }]));
            };
            this.socket.onmessage = function (evt) {
                if (typeof evt.data == 'string') {
                    // This is a JSON text string, parse it.
                    var msg = JSON.parse(evt.data);
                    switch (msg[0]) {
                        case 'rdp-connect': {
                            //console.log('[mstsc.js] connected');
                            self.activeSession = true;
                            break;
                        }
                        case 'rdp-bitmap': {
                            if (self.bitmapData == null) break;
                            var bitmap = msg[1];
                            bitmap.data = self.bitmapData; // Use the binary data that was sent earlier.
                            delete self.bitmapData;
                            //console.log('[mstsc.js] bitmap update bpp : ' + bitmap.bitsPerPixel);
                            self.render.update(bitmap);
                            break;
                        }
                        case 'rdp-close': {
                            //console.log('[mstsc.js] close');
                            self.activeSession = false;
                            next(null);
                            break;
                        }
                        case 'rdp-error': {
                            var err = msg[1];
                            console.log('[mstsc.js] error : ' + err.code + '(' + err.message + ')');
                            self.activeSession = false;
                            next(err);
                            break;
                        }
                    }
                } else {
                    // This is binary bitmap data, store it.
                    self.bitmapData = evt.data;
                }
            };
            this.socket.onclose = function () {
                //console.log("WS-CLOSE");
                self.activeSession = false;
                next(null);
            };
		}
	}
	
	MstscClient = { create : function (canvas) { return new Client(canvas); } }
})();
