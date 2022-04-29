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
var type = require('../core').type;
var error = require('../core').error;

/**
 * Tag Class
 */
var TagClass = {
	Universal : 0x00,
	Application : 0x40,
	Context : 0x80,
	Private : 0xC0
};

/**
 * Tag Format
 */
var TagFormat = {
	Primitive : 0x00,
	Constructed : 0x20
};

/**
 * ASN.1 tag
 * @param tagClass {TagClass}
 * @param tagFormat {TagFormat}
 * @param tagNumber {integer}
 */
function Asn1Tag(tagClass, tagFormat, tagNumber) {
	this.tagClass = tagClass;
	this.tagFormat = tagFormat;
	this.tagNumber = tagNumber;
}

/**
 * ASN.1 Specification
 * @param tag {Asn1Tag}
 */
function Asn1Spec(tag) {
	this.tag = tag;
	this.opt = false;
}

/**
 * Add an implicit tag
 * override tag
 * @param tag {Asn1Tag}
 * @returns {Asn1Spec}
 */
Asn1Spec.prototype.implicitTag = function(tag) {
	this.tag = tag;
	return this;
};

/**
 * Set optional to true
 * @returns {Asn1Spec}
 */
Asn1Spec.prototype.optional = function() {
	this.opt = true;
	return this;
};

/**
 * Add explicit tag
 * Append new tag header to existing tag
 * @param tag {Asn1Tag}
 * @returns {Asn1SpecExplicitTag}
 */
Asn1Spec.prototype.explicitTag = function(tag) {
	return new Asn1SpecExplicitTag(tag, this);
};

/**
 * Decode must be implemented by all sub type
 * @param s {type.Stream}
 * @param decoder
 */
Asn1Spec.prototype.decode = function(s, decoder) {
	throw new error.FatalError('NODE_RDP_AS1_SPEC_DECODE_NOT_IMPLEMENTED');
};

/**
 * Encode must be implemented by all sub type
 * @param decoder
 */
Asn1Spec.prototype.encode = function(encoder) {
	throw new error.FatalError('NODE_RDP_AS1_SPEC_ENCODE_NOT_IMPLEMENTED');
};

/**
 * Component Asn1Spec object
 */
function Asn1SpecExplicitTag(tag, spec) {
	Asn1Spec.call(this, tag);
	this.spec = spec;
}

inherits(Asn1SpecExplicitTag, Asn1Spec);

/**
 * Decode first header
 * @param s {type.Stream}
 * @param decoder
 */
Asn1Spec.prototype.decode = function(s, decoder) {
	var specStream = new type.Stream(decoder.decode(s, this.tag).value);
	this.spec.decode(specStream, decoder);
};

/**
 * Module exports
 */
module.exports = {
	TagClass : TagClass,
	TagFormat : TagFormat,
	Asn1Tag : Asn1Tag,
	Asn1Spec : Asn1Spec,
	Asn1SpecExplicitTag : Asn1SpecExplicitTag
};
