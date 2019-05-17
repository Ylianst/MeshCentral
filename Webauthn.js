/**
* @description MeshCentral WebAuthn module
* @version v0.0.1
*/

// This code is based on a portion of the webauthn module at: https://www.npmjs.com/package/webauthn

"use strict"

const crypto = require('crypto');
const cbor = require('cbor');
//const iso_3166_1 = require('iso-3166-1')
//const Certificate = null; //require('@fidm/x509')

module.exports.CreateWebAuthnModule = function () {
    var obj = {};

    obj.generateRegistrationChallenge = function (rpName, user) {
        return {
            rp: { name: rpName },
            user: user,
            challenge: crypto.randomBytes(64).toString('base64'),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 60000,
            attestation: 'none'
        };
    }

    obj.verifyAuthenticatorAttestationResponse = function (webauthnResponse) {
        const attestationBuffer = Buffer.from(webauthnResponse.attestationObject, 'base64');
        const ctapMakeCredResp = cbor.decodeAllSync(attestationBuffer)[0];
        const authrDataStruct = parseMakeCredAuthData(ctapMakeCredResp.authData);
        //console.log('***CTAP_RESPONSE', ctapMakeCredResp)
        //console.log('***AUTHR_DATA_STRUCT', authrDataStruct)

        const response = { 'verified': false };

        if (ctapMakeCredResp.fmt === 'none') {
            if (!(authrDataStruct.flags & 0x01)) { throw new Error('User was NOT presented during authentication!'); } // U2F_USER_PRESENTED

            const publicKey = COSEECDHAtoPKCS(authrDataStruct.COSEPublicKey);
            response.verified = true;

            if (response.verified) {
                response.authrInfo = {
                    fmt: 'none',
                    publicKey: ASN1toPEM(publicKey),
                    counter: authrDataStruct.counter,
                    keyId: authrDataStruct.credID.toString('base64')
                };
            }
        }
        /*
        else if (ctapMakeCredResp.fmt === 'fido-u2f') {
            if (!(authrDataStruct.flags & 0x01)) // U2F_USER_PRESENTED
                throw new Error('User was NOT presented during authentication!');

            const clientDataHash = hash(webauthnResponse.clientDataJSON)
            const reservedByte = Buffer.from([0x00]);
            const publicKey = COSEECDHAtoPKCS(authrDataStruct.COSEPublicKey)
            const signatureBase = Buffer.concat([reservedByte, authrDataStruct.rpIdHash, clientDataHash, authrDataStruct.credID, publicKey]);

            const PEMCertificate = ASN1toPEM(ctapMakeCredResp.attStmt.x5c[0]);
            const signature = ctapMakeCredResp.attStmt.sig;

            response.verified = verifySignature(signature, signatureBase, PEMCertificate)

            if (response.verified) {
                response.authrInfo = {
                    fmt: 'fido-u2f',
                    publicKey: ASN1toPEM(publicKey),
                    counter: authrDataStruct.counter,
                    keyId: authrDataStruct.credID.toString('base64')
                }
            }
        } else if (ctapMakeCredResp.fmt === 'packed' && ctapMakeCredResp.attStmt.hasOwnProperty('x5c')) {
            if (!(authrDataStruct.flags & 0x01)) // U2F_USER_PRESENTED
                throw new Error('User was NOT presented durring authentication!');

            const clientDataHash = hash(webauthnResponse.clientDataJSON)
            const publicKey = COSEECDHAtoPKCS(authrDataStruct.COSEPublicKey)
            const signatureBase = Buffer.concat([ctapMakeCredResp.authData, clientDataHash]);

            const PEMCertificate = ASN1toPEM(ctapMakeCredResp.attStmt.x5c[0]);
            const signature = ctapMakeCredResp.attStmt.sig;

            const pem = Certificate.fromPEM(PEMCertificate);

            // Getting requirements from https://www.w3.org/TR/webauthn/#packed-attestation
            const aaguid_ext = pem.getExtension('1.3.6.1.4.1.45724.1.1.4')

            response.verified = // Verify that sig is a valid signature over the concatenation of authenticatorData
                // and clientDataHash using the attestation public key in attestnCert with the algorithm specified in alg.
                verifySignature(signature, signatureBase, PEMCertificate) &&
                // version must be 3 (which is indicated by an ASN.1 INTEGER with value 2)
                pem.version == 3 &&
                // ISO 3166 valid country
                typeof iso_3166_1.whereAlpha2(pem.subject.countryName) !== 'undefined' &&
                // Legal name of the Authenticator vendor (UTF8String)
                pem.subject.organizationName &&
                // Literal string “Authenticator Attestation” (UTF8String)
                pem.subject.organizationalUnitName === 'Authenticator Attestation' &&
                // A UTF8String of the vendor’s choosing
                pem.subject.commonName &&
                // The Basic Constraints extension MUST have the CA component set to false
                !pem.extensions.isCA &&
                // If attestnCert contains an extension with OID 1.3.6.1.4.1.45724.1.1.4 (id-fido-gen-ce-aaguid)
                // verify that the value of this extension matches the aaguid in authenticatorData.
                // The extension MUST NOT be marked as critical.
                (aaguid_ext != null ?
                    (authrDataStruct.hasOwnProperty('aaguid') ?
                        !aaguid_ext.critical && aaguid_ext.value.slice(2).equals(authrDataStruct.aaguid) : false)
                    : true);

            if (response.verified) {
                response.authrInfo = {
                    fmt: 'fido-u2f',
                    publicKey: publicKey,
                    counter: authrDataStruct.counter,
                    keyId: authrDataStruct.credID.toString('base64')
                }
            }

        // Self signed
        } else if (ctapMakeCredResp.fmt === 'packed') {
            if (!(authrDataStruct.flags & 0x01)) // U2F_USER_PRESENTED
                throw new Error('User was NOT presented durring authentication!');

            const clientDataHash = hash(webauthnResponse.clientDataJSON)
            const publicKey = COSEECDHAtoPKCS(authrDataStruct.COSEPublicKey)
            const signatureBase = Buffer.concat([ctapMakeCredResp.authData, clientDataHash]);
            const PEMCertificate = ASN1toPEM(publicKey);

            const { attStmt: { sig: signature, alg } } = ctapMakeCredResp

            response.verified = // Verify that sig is a valid signature over the concatenation of authenticatorData
                // and clientDataHash using the attestation public key in attestnCert with the algorithm specified in alg.
                verifySignature(signature, signatureBase, PEMCertificate) && alg === -7

            if (response.verified) {
                response.authrInfo = {
                    fmt: 'fido-u2f',
                    publicKey: ASN1toPEM(publicKey),
                    counter: authrDataStruct.counter,
                    keyId: authrDataStruct.credID.toString('base64')
                }
            }

        } else if (ctapMakeCredResp.fmt === 'android-safetynet') {
            console.log("Android safetynet request\n")
            console.log(ctapMakeCredResp)

            const authrDataStruct = parseMakeCredAuthData(ctapMakeCredResp.authData);
            console.log('AUTH_DATA', authrDataStruct)
            //console.log('CLIENT_DATA_JSON ', webauthnResponse.clientDataJSON)

            const publicKey = COSEECDHAtoPKCS(authrDataStruct.COSEPublicKey)

            let [header, payload, signature] = ctapMakeCredResp.attStmt.response.toString('utf8').split('.')
            const signatureBase = Buffer.from([header, payload].join('.'))

            header = JSON.parse(header)
            payload = JSON.parse(payload)

            console.log('JWS HEADER', header)
            console.log('JWS PAYLOAD', payload)
            console.log('JWS SIGNATURE', signature)

            const PEMCertificate = ASN1toPEM(Buffer.from(header.x5c[0], 'base64'))

            const pem = Certificate.fromPEM(PEMCertificate)

            console.log('PEM', pem)

            response.verified = // Verify that sig is a valid signature over the concatenation of authenticatorData
                // and clientDataHash using the attestation public key in attestnCert with the algorithm specified in alg.
                verifySignature(signature, signatureBase, PEMCertificate) &&
                // version must be 3 (which is indicated by an ASN.1 INTEGER with value 2)
                pem.version == 3 &&
                pem.subject.commonName === 'attest.android.com'

            if (response.verified) {
                response.authrInfo = {
                    fmt: 'fido-u2f',
                    publicKey: ASN1toPEM(publicKey),
                    counter: authrDataStruct.counter,
                    keyId: authrDataStruct.credID.toString('base64')
                }
            }

            console.log('RESPONSE', response)
        } */
        else {
            throw new Error(`Unsupported attestation format: ${ctapMakeCredResp.fmt}`);
        }

        return response;
    }

    obj.verifyAuthenticatorAssertionResponse = function (webauthnResponse, authr) {
        const response = { 'verified': false }
        if (['fido-u2f'].includes(authr.fmt)) {
            const authrDataStruct = parseGetAssertAuthData(webauthnResponse.authenticatorData);
            if (!(authrDataStruct.flags & 0x01)) { throw new Error('User was not presented durring authentication!'); } // U2F_USER_PRESENTED
            response.counter = authrDataStruct.counter;
            response.verified = verifySignature(webauthnResponse.signature, Buffer.concat([authrDataStruct.rpIdHash, authrDataStruct.flagsBuf, authrDataStruct.counterBuf, hash(webauthnResponse.clientDataJSON)]), authr.publicKey);
        }
        return response;
    }

    function hash(data) { return crypto.createHash('sha256').update(data).digest() }
    function verifySignature(signature, data, publicKey) { return crypto.createVerify('SHA256').update(data).verify(publicKey, signature); }

    function parseGetAssertAuthData(buffer) {
        const rpIdHash = buffer.slice(0, 32);
        buffer = buffer.slice(32);
        const flagsBuf = buffer.slice(0, 1);
        buffer = buffer.slice(1);
        const flags = flagsBuf[0];
        const counterBuf = buffer.slice(0, 4);
        buffer = buffer.slice(4);
        const counter = counterBuf.readUInt32BE(0);
        return { rpIdHash, flagsBuf, flags, counter, counterBuf };
    }

    function parseMakeCredAuthData(buffer) {
        const rpIdHash = buffer.slice(0, 32);
        buffer = buffer.slice(32);
        const flagsBuf = buffer.slice(0, 1);
        buffer = buffer.slice(1);
        const flags = flagsBuf[0];
        const counterBuf = buffer.slice(0, 4);
        buffer = buffer.slice(4);
        const counter = counterBuf.readUInt32BE(0);
        const aaguid = buffer.slice(0, 16);
        buffer = buffer.slice(16);
        const credIDLenBuf = buffer.slice(0, 2);
        buffer = buffer.slice(2);
        const credIDLen = credIDLenBuf.readUInt16BE(0);
        const credID = buffer.slice(0, credIDLen);
        buffer = buffer.slice(credIDLen);
        const COSEPublicKey = buffer;
        return { rpIdHash, flagsBuf, flags, counter, counterBuf, aaguid, credID, COSEPublicKey };
    }

    function COSEECDHAtoPKCS(COSEPublicKey) {
        const coseStruct = cbor.decodeAllSync(COSEPublicKey)[0];
        return Buffer.concat([Buffer.from([0x04]), coseStruct.get(-2), coseStruct.get(-3)]);
    }

    function ASN1toPEM(pkBuffer) {
        if (!Buffer.isBuffer(pkBuffer)) { throw new Error("ASN1toPEM: pkBuffer must be Buffer."); }
        let type;
        if (pkBuffer.length == 65 && pkBuffer[0] == 0x04) { pkBuffer = Buffer.concat([new Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), pkBuffer]); type = 'PUBLIC KEY'; } else { type = 'CERTIFICATE'; }
        const b64cert = pkBuffer.toString('base64');
        let PEMKey = '';
        for (let i = 0; i < Math.ceil(b64cert.length / 64); i++) { const start = 64 * i; PEMKey += b64cert.substr(start, 64) + '\n'; }
        PEMKey = `-----BEGIN ${type}-----\n` + PEMKey + `-----END ${type}-----\n`;
        return PEMKey;
    }

    return obj;
}
