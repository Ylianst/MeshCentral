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

var spec = require('./spec');
var type = require('../core').type;
var error = require('../core').error;
var inherits = require('util').inherits;

/**
 * ASN.1 Universal tags
 * @see http://www.obj-sys.com/asn1tutorial/node124.html
 */
var UniversalTag = {
	Boolean : 1,
	Integer : 2,
	BitString : 3,
	OctetString : 4,
	Null : 5,
	ObjectIdentifier : 6,
	ObjectDescriptor : 7,
	Enumerate : 10,
	UTF8String : 12,
	Sequence : 16,
	Set : 17,
	PrintableString : 19,
	T61String : 20,
	IA5String : 22,
 	UTCTime : 23,
 	GeneralizedTime : 24,
	UniversalString : 28,
	BMPString : 30
};

/**
 * Boolean type
 * @param value {boolean} inner value
 */
function Boolean(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.Boolean));
	this.value = value || false;
}

inherits(Boolean, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Boolean}
 */
Boolean.prototype.decode = function(s, decoder) {
	this.value = new type.UInt8().read(new type.Stream(decoder.decode(s, this.tag).value)).value !== 0;
	return this;
};

/**
 * @param decoder {ber.decoder}
 * @returns {type.*}
 */
Boolean.prototype.encode = function(encoder) {
	if(this.value) {
		return encoder.encode(this.tag, new type.UInt8(0xff));
	}
	else {
		return encoder.encode(this.tag, new type.UInt8(0));
	}
};

/**
 * Integer type
 * @param value {integer | Buffer}
 */
function Integer(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.Integer));
	this.value = value || 0;
}

inherits(Integer, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Integer}
 */
Integer.prototype.decode = function(s, decoder) {
	var integerBuffer = decoder.decode(s, this.tag).value;
	if(integerBuffer.length < 5) {
		var integerStream = new type.Stream(integerBuffer);
		while (integerStream.availableLength() > 0) {
			this.value = this.value << 8;
			this.value |= new type.UInt8().read(integerStream).value;
		}
	}
	// bignum case
	else {
		this.value = integerBuffer;
	}
	return this;
};

/**
 * @param encoder {ber.decoder}
 * @returns {type.*}
 */
Integer.prototype.encode = function(encoder) {
	if(this.value <= 0xff) {
        return encoder.encode(this.tag, new type.UInt8(this.value));
    }
    else if(this.value <= 0xffff) {
        return encoder.encode(this.tag, new type.UInt16Be(this.value));
    }
    else {
        return encoder.encode(this.tag, new type.UInt32Be(this.value));
    }
};

/**
 * Sequence type
 * @param value {object}
 */
function Sequence(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Constructed, UniversalTag.Sequence));
	this.value = value || [];
}

inherits(Sequence, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Sequence}
 */
Sequence.prototype.decode = function(s, decoder) {
	var sequenceStream = new type.Stream(decoder.decode(s, this.tag).value);
	for (var i in this.value) {
		var rec = sequenceStream.offset;
		try {
			this.value[i].decode(sequenceStream, decoder);
		} catch(e) {
			if ((e.message === 'NODE_RDP_ASN1_BER_INVALID_TAG') && !this.value[i].opt) {
				throw new error.ProtocolError('NODE_RDP_ASN1_UNIV_SEQUENCE_FIELD_NOT_PRESENT');
			}
			sequenceStream.offset = rec;
		}
	}
	return this;
};

/**
 * Encode sequence
 * @param encoder
 * @returns {type.Component}
 */
Sequence.prototype.encode = function(encoder) {
	var sequence = new type.Component([]);
	for (var i in this.value) {
		sequence.obj.push(this.value[i].encode(encoder))
	}
	return encoder.encode(this.tag, sequence);
};


/**
 * Enumerate type
 * @param value {integer}
 */
function Enumerate(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.Enumerate));
	this.value = value || 0;
}

inherits(Enumerate, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Enumerate}
 */
Enumerate.prototype.decode = function(s, decoder) {
	this.value = new type.UInt8().read(new type.Stream(decoder.decode(s, this.tag).value)).value;
	return this;
};

/**
 * Encode enumerate type
 * @param encoder
 * @returns {type.Component}
 */
Enumerate.prototype.encode = function(encoder) {
	return encoder.encode(this.tag, new type.UInt8(this.value));
};

/**
 * OctetString type
 * @param value {Buffer}
 */
function OctetString(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.OctetString));
	this.value = value || Buffer.alloc(0);
}

inherits(OctetString, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {OctetString}
 */
OctetString.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * Encode Octet String
 * @param encoder
 * @returns {type.Component}
 */
OctetString.prototype.encode = function(encoder) {
	return encoder.encode(this.tag, new type.BinaryString(this.value));
};

/**
 * ObjectIdentifier type
 * @param value {Buffer}
 */
function ObjectIdentifier(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.ObjectIdentifier));
	this.value = value || Buffer.alloc(5);
}

inherits(ObjectIdentifier, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {ObjectIdentifier}
 */
ObjectIdentifier.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * Null type
 */
function Null() {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.Null));
}

inherits(Null, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Null}
 */
Null.prototype.decode = function(s, decoder) {
	decoder.decode(s, this.tag);
	return this;
};

/**
 * Choice type
 * @param value {object} list of available type
 */
function Choice(value) {
	// not tagged type
	spec.Asn1Spec.call(this, new spec.Asn1Tag());
	this.value = value;
}

inherits(Choice, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {Choice}
 */
Choice.prototype.decode = function(s, decoder) {
	for (var i in this.value) {
		var rec = s.offset;
		try {
			this.value[i].decode(s, decoder);
			break;
		}
		catch(e) {
			s.offset = rec;
		}
	}
	return this;
};

/**
 * SetOf type
 * @param factory	{function} type builder
 * @param value {object} list of available type
 */
function SetOf(factory, value) {
	// not tagged type
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Constructed, UniversalTag.Set));
	this.factory = factory;
	this.value = value || [];
}

inherits(SetOf, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {SetOf}
 */
SetOf.prototype.decode = function(s, decoder) {
	var setOfStream = new type.Stream(decoder.decode(s, this.tag).value);
	while (setOfStream.availableLength() > 0) {
		this.value.push(this.factory().decode(setOfStream, decoder));
	}
	return this;
};

/**
 * SequenceOf type
 * @param factory	{function} type builder
 * @param value {object} list of available type
 */
function SequenceOf(factory, value) {
	// not tagged type
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Constructed, UniversalTag.Sequence));
	this.factory = factory;
	this.value = value || [];
}

inherits(SequenceOf, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {SequenceOf}
 */
SequenceOf.prototype.decode = function(s, decoder) {
	var sequenceOfStream = new type.Stream(decoder.decode(s, this.tag).value);
	while (sequenceOfStream.availableLength() > 0) {
		this.value.push(this.factory().decode(sequenceOfStream, decoder));
	}
	return this;
};

/**
 * BitString type
 * @param value {Buffer}
 */
function BitString(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.BitString));
	this.value = [];
}

inherits(BitString, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {BitString}
 */
BitString.prototype.decode = function(s, decoder) {
	var bitStream = new type.Stream(decoder.decode(s, this.tag).value);
	var padding = new type.UInt8().read(bitStream).value;
	var value = [];
	for(var i = 0; i < padding; i++) {
		value.push(0);
	}
	
	while(bitStream.availableLength() > 0) {
		var octet = new type.UInt8().read(bitStream).value;
		var currentPadding = 0;
		if(bitStream.availableLength() === 0) {
			currentPadding = padding;
		}
		for(var i = 7; i >= currentPadding; i--) {
			value.push(((octet >> i) & 1)?1:0);
		}
	}
	this.value = value;
	return this;
};

/**
 * Convert bit string to buffer object
 * @returns {Buffer}
 */
BitString.prototype.toBuffer = function () {
	var length = this.value.length / 8;
	var resultStream = new type.Stream(length);
	for (var i = 0; i < length; i ++) {
		var currentOctet = 0;
		for (var j = 0; j < 8; j++) {
			currentOctet = currentOctet  | (this.value[i * 8 + j] << (7 - j));
		}
		new type.UInt8(currentOctet).write(resultStream);
	}
	return resultStream.buffer;
}

/**
 * T61String type
 * @param value {Buffer}
 */
function T61String(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.T61String));
	this.value = value;
}

inherits(T61String, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {T61String}
 */
T61String.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * PrintableString type
 * @param value {Buffer}
 */
function PrintableString(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.PrintableString));
	this.value = value;
}

inherits(PrintableString, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {PrintableString}
 */
PrintableString.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * UniversalString type
 * @param value {Buffer}
 */
function UniversalString(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.UniversalString));
	this.value = value;
}

inherits(UniversalString, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {UniversalString}
 */
UniversalString.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * UTF8String type
 * @param value {Buffer}
 */
function UTF8String(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.UTF8String));
	this.value = value;
}

inherits(UTF8String, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {UTF8String}
 */
UTF8String.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * BMPString type
 * @param value {Buffer}
 */
function BMPString(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.BMPString));
	this.value = value;
}

inherits(BMPString, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {BMPString}
 */
BMPString.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * IA5String type
 * @param value {Buffer}
 */
function IA5String(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.IA5String));
	this.value = value;
}

inherits(IA5String, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {IA5String}
 */
IA5String.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * UTCTime type
 * @param value {Buffer}
 */
function UTCTime(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.UTCTime));
	this.value = value;
}

inherits(UTCTime, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {UTCTime}
 */
UTCTime.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

/**
 * GeneralizedTime type
 * @param value {Buffer}
 */
function GeneralizedTime(value) {
	spec.Asn1Spec.call(this, new spec.Asn1Tag(spec.TagClass.Universal, spec.TagFormat.Primitive, UniversalTag.GeneralizedTime));
	this.value = value;
}

inherits(GeneralizedTime, spec.Asn1Spec);

/**
 * @param s {type.Stream}
 * @param decoder {ber.decoder}
 * @returns {GeneralizedTime}
 */
GeneralizedTime.prototype.decode = function(s, decoder) {
	this.value = decoder.decode(s, this.tag).value;
	return this;
};

module.exports = {
	Boolean : Boolean,
	Integer : Integer,
	Sequence : Sequence,
	Enumerate : Enumerate,
	OctetString : OctetString,
	ObjectIdentifier : ObjectIdentifier,
	Null : Null,
	Choice : Choice,
	SequenceOf : SequenceOf,
	SetOf : SetOf,
	BitString : BitString,
	T61String : T61String,
	PrintableString : PrintableString,
	UniversalString : UniversalString,
	UTF8String : UTF8String,
	BMPString : BMPString,
	IA5String : IA5String,
	UTCTime : UTCTime,
	GeneralizedTime : GeneralizedTime
};
