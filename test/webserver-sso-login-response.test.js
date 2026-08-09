/**
* @description Unit tests for the final SSO browser response
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createSsoLoginResponse = require('../webserver/sso-login-response.js').createSsoLoginResponse;

function createFixture() {
    const result = { headers: {}, body: null };
    const send = createSsoLoginResponse({
        getWebServerName: function () { return 'server.example.com'; },
        safeDecodeURIComponent: function (value) { try { return decodeURIComponent(value); } catch (ex) { return null; } }
    });
    const res = {
        set: function (name, value) { result.headers[name] = value; },
        end: function (body) { result.body = body; }
    };
    return { send: send, res: res, result: result };
}

test('SSO responses retain query parameters on the domain URL', function () {
    const fixture = createFixture();
    fixture.send({ query: { viewmode: '2', name: 'Alice Smith' } }, fixture.res, { url: '/tenant/' });
    assert.equal(fixture.result.headers['Content-Type'], 'text/html');
    assert.match(fixture.result.body, /url="\/tenant\/\?viewmode=2&name=Alice%20Smith"/);
});

test('valid same-server RelayState replaces the domain URL', function () {
    const fixture = createFixture();
    const relayState = 'https://server.example.com/?gotonode=' + 'a'.repeat(64);
    fixture.send({ query: {}, body: { RelayState: encodeURIComponent(relayState) } }, fixture.res, { url: '/tenant/' });
    assert.ok(fixture.result.body.includes(relayState));
});

test('foreign and malformed RelayState values keep the safe domain URL', function () {
    const fixture = createFixture();
    fixture.send({ query: {}, body: { RelayState: encodeURIComponent('https://attacker.example/?gotonode=' + 'a'.repeat(64)) } }, fixture.res, { url: '/tenant/' });
    assert.match(fixture.result.body, /url="\/tenant\/"/);
    fixture.send({ query: {}, body: { RelayState: '%E0%A4%A' } }, fixture.res, { url: '/tenant/' });
    assert.match(fixture.result.body, /url="\/tenant\/"/);
});
