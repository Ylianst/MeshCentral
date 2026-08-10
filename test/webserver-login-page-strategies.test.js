/**
* @description Unit tests for login-page authentication strategies
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getLoginStrategyOptions = require('../webserver/login-page-strategies.js').getLoginStrategyOptions;

const common = {
    validateObject: function (value) { return (value != null) && (typeof value == 'object') && !Array.isArray(value); },
    validateString: function (value, min, max) { return (typeof value == 'string') && ((min == null) || (value.length >= min)) && ((max == null) || (value.length <= max)); },
    validateUrl: function (value) { return (typeof value == 'string') && value.startsWith('https://'); }
};

test('configured authentication strategies retain their display order', function () {
    const domain = { authstrategies: { twitter: {}, google: {}, github: {}, azure: {}, oidc: {}, intel: {}, jumpcloud: {}, saml: {} } };
    assert.equal(getLoginStrategyOptions(domain, common).strategies, 'twitter,google,github,azure,oidc,intel,jumpcloud,saml');
});

test('custom OIDC presets identify the strategy and select preset icons', function () {
    const domain = { authstrategies: { oidc: { custom: { preset: 'azure', buttontext: 'Company login' } } } };
    const result = getLoginStrategyOptions(domain, common);
    assert.equal(result.strategies, 'oidc-azure');
    assert.equal(result.oidcButtonText, 'Company login');
    assert.equal(result.oidcButtonIcon, 'images/login/azure32.png');
    assert.equal(result.oidcButtonIcon2x, 'images/login/azure64.png 2x');
});

test('custom OIDC icon URLs support independent high-resolution images', function () {
    const domain = { authstrategies: { oidc: { custom: { buttoniconurl: 'https://example.com/icon.png', buttoniconurl2x: 'https://example.com/icon-2x.png' } } } };
    const result = getLoginStrategyOptions(domain, common);
    assert.equal(result.oidcButtonIcon, 'https://example.com/icon.png');
    assert.equal(result.oidcButtonIcon2x, 'https://example.com/icon-2x.png 2x');
});

test('unconfigured OIDC presentation uses default icons', function () {
    const result = getLoginStrategyOptions({}, common);
    assert.deepEqual(result, { strategies: '', oidcButtonText: '', oidcButtonIcon: 'images/login/oidc32.png', oidcButtonIcon2x: 'images/login/oidc64.png 2x' });
});
