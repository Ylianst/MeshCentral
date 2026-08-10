/**
* @description Unit tests for TLS certificate trust policy
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createCertificateTrust = require('../webserver/certificate-trust.js').createCertificateTrust;

test('certificate trust honors domain and global overrides', function () {
    const trusted = createCertificateTrust({ trustedcert: false }, {}, { CommonName: 'server.example.com' });
    assert.equal(trusted({ trustedcert: true }), true);
    assert.equal(trusted({}), false);
});

test('certificate trust recognizes TLS offload and production Lets Encrypt', function () {
    assert.equal(createCertificateTrust({ tlsoffload: true }, {}, { CommonName: 'localhost' })({}), true);
    assert.equal(createCertificateTrust({}, { letsencrypt: { production: true } }, { CommonName: 'localhost' })({}), true);
    assert.equal(createCertificateTrust({}, { letsencrypt: { production: false } }, { CommonName: 'server.example.com' })({}), false);
});

test('certificate trust rejects generated issuers and non-DNS names', function () {
    assert.equal(createCertificateTrust({}, {}, { WebIssuer: 'MeshCentralRoot-local', CommonName: 'server.example.com' })({}), false);
    assert.equal(createCertificateTrust({}, {}, { WebIssuer: 'Public CA', CommonName: 'localhost' })({}), false);
    assert.equal(createCertificateTrust({}, {}, { WebIssuer: 'Public CA', CommonName: 'server.example.com' })({}), true);
});
