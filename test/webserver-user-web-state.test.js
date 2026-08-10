/**
* @description Unit tests for user web-state resolution
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const resolveUserWebState = require('../webserver/user-web-state.js').resolveUserWebState;
const getUiViewMode = require('../webserver/user-web-state.js').getUiViewMode;

test('invalid stored web state falls back to domain defaults', function () {
    const result = resolveUserWebState(function () { return null; }, null, [{ state: '{invalid' }], { defaultuserwebstate: { uiViewMode: 3, groups: true } });
    assert.deepEqual(JSON.parse(result), { uiViewMode: 3, groups: true });
});

test('forced web state overrides filtered stored preferences', function () {
    const result = resolveUserWebState(function () { return JSON.stringify({ uiViewMode: 1, groups: true }); }, null, [{ state: {} }], { forceduserwebstate: { uiViewMode: 3 } });
    assert.deepEqual(JSON.parse(result), { uiViewMode: 3, groups: true });
});

test('interface style preference order is request, user state, then domain', function () {
    assert.equal(getUiViewMode({ query: { sitestyle: 3 } }, {}, '{}'), 'default3');
    assert.equal(getUiViewMode({ query: {} }, {}, '{"uiViewMode":3}'), 'default3');
    assert.equal(getUiViewMode({ query: {} }, { sitestyle: 3 }, '{}'), 'default3');
    assert.equal(getUiViewMode({ query: { sitestyle: 1 } }, { sitestyle: 3 }, '{"uiViewMode":3}'), 'default');
});
