/**
* @description Web, agent and swarm certificate hash initialization
* @license Apache-2.0
*/

'use strict';

module.exports.initializeCertificateHashes = function (state, parent) {
    const operations = parent.certificateOperations;
    state.webCertificateHash = operations.getPublicKeyHashBinary(state.certificates.web.cert);
    state.webCertificateHashs = { '': state.webCertificateHash };
    state.webCertificateHashBase64 = Buffer.from(state.webCertificateHash, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    state.webCertificateFullHash = operations.getCertHashBinary(state.certificates.web.cert);
    state.webCertificateFullHashs = { '': state.webCertificateFullHash };
    state.webCertificateExpire = { '': operations.getCertificateExpire(parent.certificates.web.cert) };
    state.agentCertificateHashHex = operations.getPublicKeyHash(state.certificates.agent.cert);
    state.agentCertificateHashBase64 = Buffer.from(state.agentCertificateHashHex, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    state.agentCertificateAsn1 = operations.forge.asn1.toDer(operations.forge.pki.certificateToAsn1(operations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();
    state.defaultWebCertificateHash = state.certificates.webdefault ? operations.getPublicKeyHashBinary(state.certificates.webdefault.cert) : null;
    state.defaultWebCertificateFullHash = state.certificates.webdefault ? operations.getCertHashBinary(state.certificates.webdefault.cert) : null;

    for (var domainId in parent.config.domains) {
        const domain = parent.config.domains[domainId];
        if (domain.certhash != null) {
            state.webCertificateHashs[domainId] = state.webCertificateFullHashs[domainId] = Buffer.from(domain.certhash, 'hex').toString('binary');
            if (domain.certkeyhash != null) { state.webCertificateHashs[domainId] = Buffer.from(domain.certkeyhash, 'hex').toString('binary'); }
            delete state.webCertificateExpire[domainId];
        } else if ((domain.dns != null) && (domain.certs != null)) {
            state.webCertificateFullHashs[domainId] = operations.getCertHashBinary(domain.certs.cert);
            state.webCertificateExpire[domainId] = Date.parse(operations.forge.pki.certificateFromPem(domain.certs.cert).validity.notAfter);
            try { state.webCertificateHashs[domainId] = operations.getPublicKeyHashBinary(domain.certs.cert); }
            catch (ex) { state.webCertificateHashs[domainId] = state.webCertificateFullHashs[domainId]; }
        } else if ((domain.dns != null) && (state.certificates.dns[domainId] != null)) {
            state.webCertificateFullHashs[domainId] = operations.getCertHashBinary(state.certificates.dns[domainId].cert);
            state.webCertificateHashs[domainId] = operations.getPublicKeyHashBinary(state.certificates.dns[domainId].cert);
            state.webCertificateExpire[domainId] = Date.parse(operations.forge.pki.certificateFromPem(state.certificates.dns[domainId].cert).validity.notAfter);
        } else if (domainId != '') {
            state.webCertificateFullHashs[domainId] = state.webCertificateFullHashs[''];
            state.webCertificateHashs[domainId] = state.webCertificateHashs[''];
            state.webCertificateExpire[domainId] = state.webCertificateExpire[''];
        }
    }

    if (parent.certificates.swarmserver != null) {
        const swarmCertificate = operations.forge.pki.certificateFromPem(state.certificates.swarmserver.cert);
        state.swarmCertificateAsn1 = operations.forge.asn1.toDer(operations.forge.pki.certificateToAsn1(operations.forge.pki.certificateFromPem(parent.certificates.swarmserver.cert))).getBytes();
        state.swarmCertificateHash384 = operations.forge.pki.getPublicKeyFingerprint(swarmCertificate.publicKey, { md: operations.forge.md.sha384.create(), encoding: 'binary' });
        state.swarmCertificateHash256 = operations.forge.pki.getPublicKeyFingerprint(swarmCertificate.publicKey, { md: operations.forge.md.sha256.create(), encoding: 'binary' });
    }
};
