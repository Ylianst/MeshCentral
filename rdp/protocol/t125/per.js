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

var type = require('../../core').type;
var error = require('../../core').error;

/**
 * @param s {type.Stream} read value from stream
 * @returns read length from per format
 */
function readLength(s) {
	var byte = new type.UInt8().read(s).value;
	var size = 0;
	if(byte & 0x80) {
		byte &= ~0x80;
		size = byte << 8;
		size += new type.UInt8().read(s).value;
	}
	else {
		size = byte;
	}
	return size;
}

/**
 * @param value {raw} value to convert to per format
 * @returns type objects per encoding value
 */
function writeLength(value) {
	if(value > 0x7f) {
		return new type.UInt16Be(value | 0x8000);
	}
	else {
		return new type.UInt8(value);
	}
}

/**
 * @param s {type.Stream}
 * @returns {integer} choice decoding from per encoding
 */
function readChoice(s) {
	return new type.UInt8().read(s).value;
}

/**
 * @param choice {integer}
 * @returns {type.UInt8} choice per encoded
 */
function writeChoice(choice) {
	return new type.UInt8(choice);
}

/**
 * @param s {type.Stream}
 * @returns {integer} number represent selection
 */
function readSelection(s) {
	return new type.UInt8().read(s).value;
}

/**
 * @param selection {integer}
 * @returns {type.UInt8} per encoded selection
 */
function writeSelection(selection) {
	return new type.UInt8(selection);
}

/**
 * @param s {type.Stream}
 * @returns {integer} number of sets
 */
function readNumberOfSet(s) {
	return new type.UInt8().read(s).value;
}

/**
 * @param numberOfSet {integer}
 * @returns {type.UInt8} per encoded nuimber of sets
 */
function writeNumberOfSet(numberOfSet) {
	return new type.UInt8(numberOfSet);
}

/**
 * @param s {type.Stream}
 * @returns {integer} enumerates number
 */
function readEnumerates(s) {
	return new type.UInt8().read(s).value;
}

/**
 * @param enumerate {integer}
 * @returns {type.UInt8} per encoded enumerate
 */
function writeEnumerates(enumerate) {
	return new type.UInt8(enumerate);
}

/**
 * @param s {type.Stream}
 * @returns {integer} integer per decoded
 */
function readInteger(s) {
	var result;
	var size = readLength(s);
	switch(size) {
	case 1:
		result = new type.UInt8();
		break;
	case 2:
		result = new type.UInt16Be();
		break;
	case 4:
		result = new type.UInt32Be();
		break;
	default:
		throw new error.UnexpectedFatalError('NODE_RDP_PROTOCOL_T125_PER_BAD_INTEGER_LENGTH');
	}
	return result.read(s).value;
}

/**
 * @param value {integer}
 * @returns {type.Component} per encoded integer
 */
function writeInteger(value) {
	if(value <= 0xff) {
		return new type.Component([writeLength(1), new type.UInt8(value)]);
	}
	else if(value < 0xffff) {
		return new type.Component([writeLength(2), new type.UInt16Be(value)]);
	}
	else {
		return new type.Component([writeLength(4), new type.UInt32Be(value)]);
	}
}

/**
 * @param s {type.Stream}
 * @param minimum {integer} increment (default 0)
 * @returns {integer} per decoded integer 16 bits
 */
function readInteger16(s, minimum) {
	return new type.UInt16Be().read(s).value + (minimum || 0);
}

/**
 * @param value {integer}
 * @param minimum {integer} decrement (default 0)
 * @returns {type.UInt16Be} per encoded integer 16 bits
 */
function writeInteger16(value, minimum) {
	return new type.UInt16Be(value - (minimum || 0));
}

/**
 * Check object identifier
 * @param s {type.Stream}
 * @param oid {array} object identifier to check
 */
function readObjectIdentifier(s, oid) {
	var size = readLength(s);
	if(size !== 5) {
		return false;
	}

	var a_oid = [0, 0, 0, 0, 0, 0];
	var t12 = new type.UInt8().read(s).value;
	a_oid[0] = t12 >> 4;
	a_oid[1] = t12 & 0x0f;
	a_oid[2] = new type.UInt8().read(s).value;
	a_oid[3] = new type.UInt8().read(s).value;
	a_oid[4] = new type.UInt8().read(s).value;
	a_oid[5] = new type.UInt8().read(s).value;

	for(var i in oid) {
		if(oid[i] !== a_oid[i]) return false;
	}

	return true;
}

/**
 * @param oid {array} oid to write
 * @returns {type.Component} per encoded object identifier
 */
function writeObjectIdentifier(oid) {
	return new type.Component([new type.UInt8(5), new type.UInt8((oid[0] << 4) & (oid[1] & 0x0f)), new type.UInt8(oid[2]), new type.UInt8(oid[3]), new type.UInt8(oid[4]), new type.UInt8(oid[5])]);
}

/**
 * Read as padding...
 * @param s {type.Stream}
 * @param minValue
 */
function readNumericString(s, minValue) {
    var length = readLength(s);
    length = (length + minValue + 1) / 2;
    s.readPadding(length);
}

/**
 * @param nStr {String}
 * @param minValue {integer}
 * @returns {type.Component} per encoded numeric string
 */
function writeNumericString(nStr, minValue) {
    var length = nStr.length;
    var mlength = minValue;
    if(length - minValue >= 0) {
        mlength = length - minValue;
    }
    
    var result = [];
    
    for(var i = 0; i < length; i += 2) {
        var c1 = nStr.charCodeAt(i);
    	var c2 = 0;
        if(i + 1 < length) {
            c2 = nStr.charCodeAt(i + 1);
        }
        else {
            c2 = 0x30;
        }
        c1 = (c1 - 0x30) % 10;
        c2 = (c2 - 0x30) % 10;
        
        result[result.length] = new type.UInt8((c1 << 4) | c2);
    }
    
    return new type.Component([writeLength(mlength), new type.Component(result)]);
}

/**
 * @param s {type.Stream}
 * @param length {integer} length of padding
 */
function readPadding(s, length) {
    s.readPadding(length);
}

/**
 * @param length {integer} length of padding
 * @returns {type.BinaryString} per encoded padding
 */
function writePadding(length) {
    return new type.BinaryString(Buffer.from(Array(length + 1).join("\x00")));
}

/**
 * @param s {type.Stream}
 * @param octetStream {String}
 * @param minValue {integer} default 0
 * @returns {Boolean} true if read octectStream is equal to octetStream
 */
function readOctetStream(s, octetStream, minValue) {
    var size = readLength(s) + (minValue || 0);
    if(size !== octetStream.length) {
        return false;
    }
    for(var i = 0; i < size; i++) {
        var c = new type.UInt8().read(s);
        if(octetStream.charCodeAt(i) !== c.value) {
            return false;
        }
    }
        
    return true;
}

/**
 * @param oStr {String}
 * @param minValue {integer} default 0
 * @returns {type.Component} per encoded octet stream
 */
function writeOctetStream(oStr, minValue) {
	minValue = minValue || 0;
    var length = oStr.length;
    var mlength = minValue;
    
    if(length - minValue >= 0) {
        mlength = length - minValue;
    }
    
    result = [];
    for(var i = 0; i < length; i++) {
        result[result.length] = new type.UInt8(oStr[i]);
    }
    
    return new type.Component([writeLength(mlength), new type.Component(result)]);
}

/**
 * Module exports
 */
module.exports = {
	readLength : readLength,
	writeLength : writeLength,
	readChoice : readChoice,
	writeChoice : writeChoice,
	readSelection : readSelection,
	writeSelection : writeSelection,
	readNumberOfSet : readNumberOfSet,
	writeNumberOfSet : writeNumberOfSet,
	readEnumerates : readEnumerates,
	writeEnumerates : writeEnumerates,
	readInteger : readInteger,
	writeInteger : writeInteger,
	readInteger16 : readInteger16,
	writeInteger16 : writeInteger16,
	readObjectIdentifier : readObjectIdentifier,
	writeObjectIdentifier : writeObjectIdentifier,
	readNumericString : readNumericString,
	writeNumericString : writeNumericString,
	readPadding : readPadding,
	writePadding : writePadding,
	readOctetStream : readOctetStream,
	writeOctetStream : writeOctetStream
};