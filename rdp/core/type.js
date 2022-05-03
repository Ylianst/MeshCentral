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
var log = require('./log');
var error = require('./error');

/**
 * Stream wrapper around buffer type
 * @param i {Buffer | integer} size of init buffer
 * @returns
 */
function Stream(i) {
	this.offset = 0;
	if (i instanceof Buffer) {
		this.buffer = i;
	}
	else {
		this.buffer = Buffer.alloc(i || 8192);
	}
}

/**
 * Return length of available data in stream
 * @returns {Number} length of available data in stream
 */
Stream.prototype.availableLength = function() {
	return this.buffer.length - this.offset;
};

/**
 * increment offset
 * @param length {integer} length of padding
 */
Stream.prototype.readPadding = function(length) {
	this.offset += length;
};

/**
 * Format string buffer
 * @returns {string} buffer stringified
 */
Stream.prototype.getValue = function() {
	return this.buffer;
};

/**
 * @param value {object | function} inner value
 * @returns
 */
function CallableValue(value) {
	if(value) {
		this.value = value;
	}
}

/**
 * For syntaxic purpose
 */
Object.defineProperty(CallableValue.prototype, "value", {
	get: function() { return this._value(); },
	set: function(e) {
		if(typeof e !== 'function') {
			this._value = function () { return e; };
		}
		else {
			this._value = e;
		}
	}
});

/**
 * Type readable or writable by binary stream
 * @param {object} opt 
 * 			.conditional {boolean} read or write type depend on conditional call
 * @returns
 */
function Type(opt) {
	CallableValue.call(this);
	this.opt = opt || {};
	this.isReaded = false;
	this.isWritten = false;
}

inherits(Type, CallableValue);

/**
 * Write type into binary stream s
 * @param {type.Stream} s binary stream
 */
Type.prototype.write = function(s) {
	//do not write false conditional type
	if(this.opt.conditional && !this.opt.conditional())
		return this;
	
	this.isWritten = true;
	
	this.writeValue(s);
	return this;
};

/**
 * Read type from binary stream 
 * @param {type.Stream} s binary stream
 * @returns this to chain call
 */
Type.prototype.read = function(s) {
	//do not read false conditional type
	if(this.opt.conditional && !this.opt.conditional())
		return this;
	
	if(this.opt.optional && s.availableLength() < this.size())
		return this;
	
	this.isReaded = true;
	
	//constant case
	if(this.opt.constant) {
		var oldValue = this.value;
		try {
			this.readValue(s);
		}
		catch(e) {
			if (e instanceof RangeError) {
				throw new error.ProtocolError("NODE_RDP_CORE_TYPE_STREAM_TOO_SMALL");
			}
			throw e;
		}
		
		if(oldValue !== this.value) {
			log.error('constant value mismatch ' + oldValue + ' != ' + this.value);
            throw new error.ProtocolError("NODE_RDP_CORE_TYPE_CONSTANT_VALUE_MISMATCH, OLD:" + oldValue + ", NEW:" + this.value);
		}
	}
	else {
		try {
			this.readValue(s);
		}
		catch(e) {
			if (e instanceof RangeError) {
				throw new error.ProtocolError("NODE_RDP_CORE_TYPE_STREAM_TOO_SMALL");
			}
			throw e;
		}
	}
	
	return this;
};

/**
 * Size of type
 * @returns {int} Size of type
 */
Type.prototype.size = function() {
	if(this.opt.conditional && !this.opt.conditional())
		return 0;
	return this._size_();
};

/**
 * Convert type to stream
 * Usefull when you want to buffer
 * @returns {Stream}
 */
Type.prototype.toStream = function() {
	var result = new Stream(this.size());
	this.write(result);
	return result;
};

/**
 * Node of Raw types
 * @param {object} obj composite object
 * @param {object} opt Type parameters
 */
function Component(obj, opt) {
	Type.call(this, opt);
	this.obj = obj;
}

//inherit from type
inherits(Component, Type);

/**
 * ignore criterion
 * @param i {string} index name in obj
 * @returns {Boolean} true if can be ignore
 */
Component.prototype.ignore = function(i) {
	// ignore meta information
	if(i.lastIndexOf("__", 0) === 0) {
		return true;
	}
	// ignore function
	if(typeof(this.obj[i]) === 'function') {
		return true;
	}
	return false;
};

/**
 * Write each sub type into stream
 * @param {Stream} s
 */
Component.prototype.writeValue = function(s) {
	for(var i in this.obj) {
		if(this.ignore(i)) {
			continue;
		}
		try {
			this.obj[i].write(s);
		}
		catch(e) {
			log.info('during write of field ' + i);
			throw e;
		}
	}
};

/**
 * Read each sub type into stream
 * @param {Stream} s from read stream
 */
Component.prototype.readValue = function(s) {
	var readStream = s;
	if(this.opt.readLength) {
		readStream = new Stream(s.buffer.slice(s.offset, s.offset + this.opt.readLength.value));
	}
	
	for(var i in this.obj) {
		// ignore meta information
		if(this.ignore(i)) {
			continue;
		}
		try {
			this.obj[i].read(readStream);
		}
		catch(e) {
			log.info('during read of field ' + i);
			throw e;
		}
	}
	
	// padding
	if (this.opt.readLength) {
		s.offset += this.opt.readLength.value;
		if (readStream.offset < this.opt.readLength.value) {
			log.debug('still have available data : read it as padding');
		}
	}
};

/**
 * Sum size of sub types
 */
Component.prototype._size_ = function() {
	var size = 0;
	for(var i in this.obj) {
		if(this.ignore(i)) {
			continue;
		}
		size += this.obj[i].size();
	}
	return size;
};

/**
 * Leaf of tree type
 * @param {number} value of type
 * @param {function} readBufferCallback Buffer prototype read function
 * @param {function} writeBufferCallback Buffer prototype write function
 * @param {object} opt Type parameter
 */
function SingleType(value, nbBytes, readBufferCallback, writeBufferCallback, opt){
	Type.call(this, opt);
	this.value = value || 0;
	this.nbBytes = nbBytes;
	this.readBufferCallback = readBufferCallback;
	this.writeBufferCallback = writeBufferCallback;
}

//inherit from type
inherits(SingleType, Type);

/**
 * Write SingleType value into stream
 * @param s
 */
SingleType.prototype.writeValue = function(s) {
	this.writeBufferCallback.call(s.buffer, this.value, s.offset);
	s.offset += this._size_();
};

/**
 * Read SingleType value into stream
 * @param {Stream} s from read stream
 */
SingleType.prototype.readValue = function(s) {
	this.value = this.readBufferCallback.call(s.buffer, s.offset);
	s.offset += this._size_();
};

/**
 * Size of single type
 * @returns Size of single type
 */
SingleType.prototype._size_ = function() {
	return this.nbBytes;
};

/**
 * Integer on 1 byte
 * @param {number | function} value of type
 * @param {object} opt	Type parameter
 * @returns
 */
function UInt8(value, opt) {
	SingleType.call(this, value, 1, Buffer.prototype.readUInt8, Buffer.prototype.writeUInt8, opt);
}

//inherit from type
inherits(UInt8, SingleType);

/**
 * Integer on 2 bytes in Little Endian
 * @param {number | function} value to write or compare if constant
 * @param {object} opt	Type parameter
 * @returns
 */
function UInt16Le(value, opt) {
	SingleType.call(this, value, 2, Buffer.prototype.readUInt16LE, Buffer.prototype.writeUInt16LE, opt);
}

//inherit from type
inherits(UInt16Le, SingleType);

/**
 * Integer on 2 bytes in Big Endian
 * @param {number | function} value to write or compare if constant
 * @param {object} opt	Type parameter
 * @returns
 */
function UInt16Be(value, opt) {
	SingleType.call(this, value, 2, Buffer.prototype.readUInt16BE, Buffer.prototype.writeUInt16BE, opt);
}

//inherit from type
inherits(UInt16Be, SingleType);

/**
 * Integer on 4 bytes in Little Endian
 * @param {number | function} value to write or compare if constant
 * @param {object} opt	Type parameter
 * @returns
 */
function UInt32Le(value, opt) {
	SingleType.call(this, value, 4, Buffer.prototype.readUInt32LE, Buffer.prototype.writeUInt32LE, opt);
}

//inherit from type
inherits(UInt32Le, SingleType);

/**
 * Integer on 4 bytes in Big Endian
 * @param {number | function} value to write or compare if constant
 * @param {object} opt	Type parameter
 * @returns
 */
function UInt32Be(value, opt) {
	SingleType.call(this, value, 4, Buffer.prototype.readUInt32BE, Buffer.prototype.writeUInt32BE, opt);
}

//inherit from type
inherits(UInt32Be, SingleType);

/**
 * @param value {Buffer} javascript source string
 * @param opt {object} type options
 * 	.readLength {type} length for reading operation
 * @returns {type.BinaryString}
 */
function BinaryString(value, opt) {
	Type.call(this, opt);
	this.value = value || Buffer.alloc(0);
}

//inherit from type
inherits(BinaryString, Type);

/**
 * Write value into string
 * @param s {type.Stream}
 */
BinaryString.prototype.writeValue = function(s) {
	this.value.copy(s.buffer, s.offset);
	s.offset += this._size_();
};

/**
 * Read string from offset to read length if specified or end of stream
 * @param s {type.Stream}
 */
BinaryString.prototype.readValue = function(s) {
	if(this.opt.readLength) {
		this.value = s.buffer.slice(s.offset, s.offset + this.opt.readLength.value);
	}
	else {
		this.value = s.buffer.slice(s.offset);
	}
	s.offset += this._size_();
};

/**
 * @returns {integer} length of string
 */
BinaryString.prototype._size_ = function() {
	return this.value.length;
};

/**
 * Dynamic built type depend on factory function
 * @param message {object} parent object
 * @param field {string} name of object field
 * @param factory {function} factory use to built new type
 * @param opt {object}	type options
 */
function Factory(factory, opt) {
	Type.call(this, opt);
	this.factory = factory;
}

//inherit from type
inherits(Factory, Type);

/**
 * build type and write into stream
 * @param s {Stream} input stream
 */
Factory.prototype.writeValue = function(s) {
	this.factory(s);
};

/**
 * build type and read from stream
 * @param s {Stream} input stream
 */
Factory.prototype.readValue = function(s) {
	this.factory(s);
};

/**
 * must be never called
 */
Factory.prototype._size_ = function() {
	throw new error.FatalError('NODE_RDP_CORE_TYPE_FACTORY_TYPE_HAVE_NO_SIZE');
};

/**
 * Module exports
 */
module.exports = {
	Stream : Stream,
	Component : Component,
	UInt8 : UInt8,
	UInt16Le : UInt16Le,
	UInt16Be : UInt16Be,
	UInt32Le : UInt32Le,
	UInt32Be : UInt32Be,
	BinaryString : BinaryString,
	CallableValue : CallableValue,
	Factory : Factory
};