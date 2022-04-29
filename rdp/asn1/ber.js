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

var type = require('../core').type;
var log = require('../core').log;
var error = require('../core').error;

/**
 * Parse tag(T) field of BER TLV
 * And check with expected tag
 * @param s {type.Stream}
 * @param tag {spec.tag}
 * @returns {Boolean} True for valid tag matching
 */
function decodeTag(s, tag) {
	var nextTag = new type.UInt8().read(s).value;
	if (tag.tagNumber > 30) {
		nextTagNumber = new type.UInt8().read(s).value;
	}
	else {
		nextTagNumber = nextTag & 0x1F;
	}
	
	return ((nextTag & 0xE0) === (tag.tagClass | tag.tagFormat)) && (nextTagNumber === tag.tagNumber);
};

/**
 * Parse length(L) field of BER TLV
 * @param s {type.Stream}
 * @returns {integer}
 */
function decodeLength(s) {
	var size = new type.UInt8().read(s).value;
	if(size & 0x80) {
		size &= ~0x80;
		if(size === 1) {
			size = new type.UInt8().read(s).value;
		}
		else if(size === 2) {
			size = new type.UInt16Be().read(s).value;
		}
		else{
			throw new error.ProtocolError('NODE_RDP_ASN1_BER_INVALID_LENGTH');
		}
	}
	return size;
};

/**
 * Decode tuple TLV (Tag Length Value) of BER
 * @param s {type.Stream}
 * @param tag {spec.Asn1Tag} expected tag
 * @returns {type.BinaryString} Value of tuple
 */
function decode(s, tag) {
	if (!decodeTag(s, tag)) {
		throw new error.ProtocolError('NODE_RDP_ASN1_BER_INVALID_TAG');
	}
	var length = decodeLength(s);
	
	if (length === 0) {
		return new type.Stream(0);
	}
	return new type.BinaryString(null,{ readLength : new type.CallableValue(length) }).read(s);
};

function encodeTag(tag) {
	if(tag.tagNumber > 30) {
		return new type.Component([new type.UInt8(tag.tagClass | tag.tagFormat | 0x1F), new type.UInt8(tag.tagNumber)]);
	}
	else {
		return new type.UInt8((tag.tagClass | tag.tagFormat) | (tag.tagNumber & 0x1F));
	}
}

function encodeLength(length) {
	if(length > 0x7f) {
        return new type.Component([new type.UInt8(0x82), new type.UInt16Be(length)]);
    }
    else {
        return new type.UInt8(length);
    }
}

function encode(tag, buffer) {
	return new type.Component([encodeTag(tag), encodeLength(buffer.size()), buffer]);
}

/**
 * Module Export
 */
module.exports = {
	decode : decode,
	encode : encode
};
