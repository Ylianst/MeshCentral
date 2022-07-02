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
var fs = require('fs');
var type = require('./type');
var log = require('./log');
var tls = require('tls');
//var crypto = require('crypto');
var events = require('events');

/**
 * Buffer data from socket to present
 * well formed packets
 */
function BufferLayer(socket) {
	//for ssl connection
	this.secureSocket = null;
	this.socket = socket;

	var self = this;
	// bind event
	this.socket.on('data', function(data) {
		try {
			self.recv(data);
		}
		catch(e) {
			self.socket.destroy();
			self.emit('error', e);
		}
	}).on('close', function() {
		self.emit('close');
	}).on('error', function (err) {
		self.emit('error', err);
	});

	//buffer data
	this.buffers = [];
	this.bufferLength = 0;
	//expected size
	this.expectedSize = 0;
}

inherits(BufferLayer, events.EventEmitter);

/**
 * Call from tcp layer
 * @param data tcp stream
 */
BufferLayer.prototype.recv = function (data) {
    if (this.buffers.length == 0) { this.bufferLength = 0; } // CORRECT
	this.buffers[this.buffers.length] = data;
	this.bufferLength += data.length;

	//console.log('TCP RECV', this.bufferLength, this.expectedSize, data.toString('hex'));
	//console.log('this.buffers', this.buffers);
	//console.log('this.expectedSize', this.expectedSize);
	//console.log('this.bufferLength', this.bufferLength);

	if (this.expectedSize == 0) { console.log('this.expectedSize == 0'); return; }

	while (this.bufferLength >= this.expectedSize) {
	    //console.log('this.expectedSize', this.expectedSize);
	    //console.log('this.bufferLength', this.bufferLength);

		//linear buffer
		var expectedData = new type.Stream(this.expectedSize);

		//create expected data
		while (expectedData.availableLength() > 0) {

			var rest = expectedData.availableLength();
			var buffer = this.buffers.shift();

			//console.log('xx', rest, buffer);

			if (buffer.length > expectedData.availableLength()) {
				this.buffers.unshift(buffer.slice(rest));
				new type.BinaryString(buffer, { readLength : new type.CallableValue(expectedData.availableLength()) }).write(expectedData);
			} else {
				new type.BinaryString(buffer).write(expectedData);
			}
		}

		this.bufferLength -= this.expectedSize;
        expectedData.offset = 0;

        //console.log('TCP EMIT', expectedData);
		this.emit('data', expectedData);
	}
};

/**
 * Call tcp socket to write stream
 * @param {type.Type} packet
 */
BufferLayer.prototype.send = function(data) {
	var s = new type.Stream(data.size());
	data.write(s);
	if(this.secureSocket) {
		this.secureSocket.write(s.buffer);
	}
	else {
		this.socket.write(s.buffer);
	}
};

/**
 * Call tcp socket to write a buffer
 */
BufferLayer.prototype.sendBuffer = function (buffer) {
    if (this.secureSocket) {
        //console.log('SSL sendBuffer', buffer.length, buffer.toString('hex'));
        this.secureSocket.write(buffer);
    }
    else {
        //console.log('TCP sendBuffer', buffer.length, buffer.toString('hex'));
        this.socket.write(buffer);
    }
};

/**
 * Wait expected size data before call callback function
 * @param {number} expectSize	size expected
 */
BufferLayer.prototype.expect = function(expectedSize) {
	this.expectedSize = expectedSize;
};

/**
 * Convert connection to TLS connection
 * @param callback {func} when connection is done
 */
BufferLayer.prototype.startTLS = function(callback) {
	var self = this;

	this.secureSocket = tls.connect({
		socket: this.socket,
		secureContext: tls.createSecureContext(),
		isServer: false,
		requestCert: false,
		rejectUnauthorized: false
	}, (err) => {
		log.warn(err);
		callback(err);
	});

    this.secureSocket.on('data', function (data) {

        //console.log('SSL RECV', data.length, data);

		try {
			self.recv(data);
		}
        catch (e) {
            //console.log('SSL RECV ERR', e);
			self.socket.destroy();
			self.emit('error', e);
		}
	}).on('error', function (err) {
		self.emit('error', err);
	});
};

/**
 * Convert connection to TLS server
 * @param keyFilePath	{string} key file path
 * @param crtFilePath	{string} certificat file path
 * @param callback	{function}
 */
BufferLayer.prototype.listenTLS = function(keyFilePath, crtFilePath, callback) {
	var self = this;

	this.secureSocket = tls.connect({
		socket: this.socket,
		secureContext: tls.createSecureContext({
			key: fs.readFileSync(keyFilePath),
			cert: fs.readFileSync(crtFilePath),
		}),
		isServer: true,
		requestCert: false,
		rejectUnauthorized: false
	}, (err) => {
		log.warn(err);
		callback(err);
	});

	this.secureSocket.on('data', function(data) {
		try {
			self.recv(data);
		}
		catch(e) {
			self.socket.destroy();
			self.emit('error', e);
		}
	}).on('error', function (err) {
		self.emit('error', err);
	});
};

/**
 * close stack
 */
BufferLayer.prototype.close = function() {
	this.socket.end();
};

/**
 * Module exports
 */
module.exports = {
	BufferLayer : BufferLayer
};
