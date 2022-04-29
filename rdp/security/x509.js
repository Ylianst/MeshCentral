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

// https://tools.ietf.org/html/rfc5280

var asn1 = require('../asn1');

/**
 * @see https://tools.ietf.org/html/rfc5280 page 20
 * @returns {asn1.univ.Choice}
 */
function DirectoryString() {
	return new asn1.univ.Choice({
		teletexString : new asn1.univ.T61String(),
		printableString : new asn1.univ.PrintableString(),
		universalString : new asn1.univ.UniversalString(),
		utf8String : new asn1.univ.UTF8String(),
		bmpString : new asn1.univ.BMPString(),
		ia5String : new asn1.univ.IA5String()
	});
}

/**
 * https://tools.ietf.org/html/rfc5280 page 20
 * @returns {asn1.univ.Choice}
 */
function AttributeValue() {
	return DirectoryString();
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 20
 * @returns {asn1.univ.ObjectIdentifier}
 */
function AttributeType() {
	return new asn1.univ.ObjectIdentifier();
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 20
 * @returns {asn1.univ.Sequence}
 */
function AttributeTypeAndValue() {
	return new asn1.univ.Sequence({
		type : AttributeType(),
		value : AttributeValue()
	});
}

/**
 * https://tools.ietf.org/html/rfc5280 page 116
 * @returns {asn1.univ.SetOf}
 */
function RelativeDistinguishedName() {
	return new asn1.univ.SetOf(AttributeTypeAndValue);
}

/**
 * https://tools.ietf.org/html/rfc5280 page 116
 * @returns {asn1.univ.SequenceOf}
 */
function RDNSequence() {
	return new asn1.univ.SequenceOf(RelativeDistinguishedName);
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 116
 * @returns {asn1.univ.Choice}
 */
function Name() {
	return new asn1.univ.Choice({
		rdnSequence : RDNSequence()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 18
 * @returns {asn1.univ.Sequence}
 */
function AlgorithmIdentifier() {
	return new asn1.univ.Sequence({
		algorithm : new asn1.univ.ObjectIdentifier(),
		parameters : new asn1.univ.Null()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Sequence}
 */
function Extension() {
	return new asn1.univ.Sequence({
		extnID : new asn1.univ.ObjectIdentifier(),
		critical : new asn1.univ.Boolean(),
		extnValue : new asn1.univ.OctetString()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.SequenceOf}
 */
function Extensions() {
	return new asn1.univ.SequenceOf(Extension);
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Choice}
 */
function Time() {
	return new asn1.univ.Choice({
		utcTime : new asn1.univ.UTCTime(),
		generalTime : new asn1.univ.GeneralizedTime()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Sequence}
 */
function Validity() {
	return new asn1.univ.Sequence({
		notBefore : Time(),
		notAfter : Time()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Integer}
 */
function CertificateSerialNumber() {
	return new asn1.univ.Integer();
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Sequence}
 */
function SubjectPublicKeyInfo() {
	return new asn1.univ.Sequence({
		algorithm : AlgorithmIdentifier(),
		subjectPublicKey : new asn1.univ.BitString()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.BitString}
 */
function UniqueIdentifier() {
	return new asn1.univ.BitString();
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Sequence}
 */
function TbsCertificate() {
	return new asn1.univ.Sequence({
		version : CertificateSerialNumber().explicitTag(new asn1.spec.Asn1Tag(asn1.spec.TagClass.Context, asn1.spec.TagFormat.Constructed, 0)),
		serialNumber : new asn1.univ.Integer(),
		signature : AlgorithmIdentifier(),
		issuer : Name(),
		validity : Validity(),
		subject : Name(),
		subjectPublicKeyInfo : SubjectPublicKeyInfo(),
		issuerUniqueID : UniqueIdentifier().implicitTag(asn1.spec.TagClass.Context, asn1.spec.TagFormat.Primitive, 1).optional(),
		subjectUniqueID : UniqueIdentifier().implicitTag(asn1.spec.TagClass.Context, asn1.spec.TagFormat.Primitive, 2).optional(),
		extensions : Extensions().implicitTag(asn1.spec.TagClass.Context, asn1.spec.TagFormat.Primitive, 3).optional()
	});
}

/**
 * @see https://tools.ietf.org/html/rfc5280 page 117
 * @returns {asn1.univ.Sequence}
 */
function X509Certificate() {
	return new asn1.univ.Sequence({
		tbsCertificate : TbsCertificate(),
		signatureAlgorithm : AlgorithmIdentifier(),
		signatureValue : new asn1.univ.BitString()
	});
}

function RSAPublicKey() {
	return new asn1.univ.Sequence({
		modulus : new asn1.univ.Integer(),
		publicExponent : new asn1.univ.Integer()
	});
}

/**
 * Module Export
 */
module.exports = {
	X509Certificate : X509Certificate,
	RSAPublicKey : RSAPublicKey
};