/**
* @description Unit tests for initial web server data loading
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createStartupDataLoader = require('../webserver/startup-data.js').createStartupDataLoader;

test('startup data loads collections in order and reconciles links', function () {
    const calls = [], ready = [], users = [
        { _id: 'user/tenant/alice', domain: 'tenant', links: { 'mesh/tenant/live': { rights: 1 }, 'mesh/tenant/deleted': { rights: 1 }, 'ugrp/tenant/missing': { rights: 1 } } }
    ];
    const meshes = [
        { _id: 'mesh/tenant/live', links: { 'user/tenant/alice': { rights: 1 }, 'user/tenant/missing': { rights: 1 }, 'ugrp/tenant/operators': { rights: 1 } } },
        { _id: 'mesh/tenant/deleted', deleted: 1 }
    ];
    const groups = [{ _id: 'ugrp/tenant/operators', links: { 'user/tenant/alice': { rights: 4 }, 'user/tenant/missing': { rights: 1 }, 'mesh/tenant/deleted': { rights: 1 } } }];
    const collections = { user: users, mesh: meshes, ugrp: groups };
    const state = {
        users: {}, meshes: {}, userGroups: {}, common: { unEscapeAllLinksFieldName: function () { } },
        db: { GetAllType: function (type, callback) { calls.push(type); callback(null, collections[type]); } }
    };
    const loader = createStartupDataLoader({ state: state, parent: { config: { domains: { tenant: {} } }, debug: function () { } }, onReady: function () { ready.push(true); }, log: function () { } });
    loader.load();
    assert.deepEqual(calls, ['user', 'mesh', 'ugrp']);
    assert.equal(ready.length, 1);
    assert.deepEqual(state.users['user/tenant/alice'].links['ugrp/tenant/operators'], { rights: 4 });
    assert.equal(state.users['user/tenant/alice'].links['ugrp/tenant/missing'], undefined);
    assert.equal(state.users['user/tenant/alice'].links['mesh/tenant/deleted'], undefined);
    assert.equal(state.meshes['mesh/tenant/live'].links['user/tenant/missing'], undefined);
    assert.equal(state.userGroups['ugrp/tenant/operators'].links['user/tenant/missing'], undefined);
    assert.equal(state.userGroups['ugrp/tenant/operators'].links['mesh/tenant/deleted'], undefined);
});

test('startup loading stops before dependent collections after a database failure', function () {
    const calls = [], messages = [], ready = [];
    const state = { users: {}, meshes: {}, userGroups: {}, common: { unEscapeAllLinksFieldName: function () { } }, db: { GetAllType: function (type, callback) { calls.push(type); callback(new Error('offline')); } } };
    createStartupDataLoader({ state: state, parent: { config: { domains: {} }, debug: function (source, message) { messages.push(message); } }, onReady: function () { ready.push(true); }, log: function () { } }).load();
    assert.deepEqual(calls, ['user']);
    assert.equal(ready.length, 0);
    assert.match(messages[0], /users/);
});

test('domains without users retain the administrator notice', function () {
    const logs = [];
    const state = { users: {}, meshes: {}, userGroups: {}, common: { unEscapeAllLinksFieldName: function () { } }, db: { GetAllType: function (type, callback) { callback(null, []); } } };
    createStartupDataLoader({ state: state, parent: { config: { domains: { tenant: {} } }, debug: function () { } }, onReady: function () { }, log: function (message) { logs.push(message); } }).load();
    assert.match(logs[0], /tenant has no users/);
});
