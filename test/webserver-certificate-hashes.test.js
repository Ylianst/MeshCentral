/**
* @description Unit tests for certificate hash initialization
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const initializeCertificateHashes = require('../webserver/certificate-hashes.js').initializeCertificateHashes;

function createOperations() {
    return {
        getPublicKeyHashBinary: function (certificate) { return 'key:' + certificate; },
        getCertHashBinary: function (certificate) { return 'cert:' + certificate; },
        getCertificateExpire: function () { return 100; },
        getPublicKeyHash: function () { return '00ff'; },
        forge: {
            asn1: { toDer: function () { return { getBytes: function () { return 'asn1'; } }; } },
            pki: {
                certificateFromPem: function (certificate) { return { validity: { notAfter: '2030-01-01T00:00:00Z' }, publicKey: certificate + ':public' }; },
                certificateToAsn1: function (certificate) { return certificate; },
                getPublicKeyFingerprint: function (key, options) { return key + ':' + options.md; }
            },
            md: { sha384: { create: function () { return 'sha384'; } }, sha256: { create: function () { return 'sha256'; } } }
        }
    };
}

test('default, explicit and inherited domain certificate hashes are initialized', function () {
    const state = { certificates: { web: { cert: 'web' }, webdefault: { cert: 'default' }, agent: { cert: 'agent' }, dns: {} } };
    const parent = { certificates: { web: { cert: 'web' }, agent: { cert: 'agent' } }, certificateOperations: createOperations(), config: { domains: { '': {}, explicit: { certhash: '4142', certkeyhash: '4344' }, inherited: {} } } };
    initializeCertificateHashes(state, parent);
    assert.equal(state.webCertificateHash, 'key:web');
    assert.equal(state.webCertificateFullHash, 'cert:web');
    assert.equal(state.defaultWebCertificateHash, 'key:default');
    assert.equal(state.webCertificateFullHashs.explicit, 'AB');
    assert.equal(state.webCertificateHashs.explicit, 'CD');
    assert.equal(state.webCertificateHashs.inherited, 'key:web');
    assert.equal(state.agentCertificateAsn1, 'asn1');
});

test('domain-specific and wildcard DNS certificates receive their own hashes and expiry', function () {
    const state = { certificates: { web: { cert: 'web' }, agent: { cert: 'agent' }, dns: { wildcard: { cert: 'wildcard-cert' } } } };
    const domains = { custom: { dns: 'custom.example.com', certs: { cert: 'custom-cert' } }, wildcard: { dns: 'node.example.com' } };
    const parent = { certificates: { web: { cert: 'web' }, agent: { cert: 'agent' } }, certificateOperations: createOperations(), config: { domains: domains } };
    initializeCertificateHashes(state, parent);
    assert.equal(state.webCertificateHashs.custom, 'key:custom-cert');
    assert.equal(state.webCertificateFullHashs.wildcard, 'cert:wildcard-cert');
    assert.equal(typeof state.webCertificateExpire.custom, 'number');
});

test('legacy swarm certificate hashes are initialized when configured', function () {
    const state = { certificates: { web: { cert: 'web' }, agent: { cert: 'agent' }, dns: {}, swarmserver: { cert: 'swarm' } } };
    const parent = { certificates: { web: { cert: 'web' }, agent: { cert: 'agent' }, swarmserver: { cert: 'swarm' } }, certificateOperations: createOperations(), config: { domains: {} } };
    initializeCertificateHashes(state, parent);
    assert.equal(state.swarmCertificateAsn1, 'asn1');
    assert.equal(state.swarmCertificateHash384, 'swarm:public:sha384');
    assert.equal(state.swarmCertificateHash256, 'swarm:public:sha256');
});
