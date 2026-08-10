/**
* @description Unit tests for HTTP route family setup
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createHttpRouteSetup = require('../../../../webserver/http/routes/http-route-setup.js').createHttpRouteSetup;

test('HTTP route setup constructs and finalizes every route family in order', function () {
    const created = [], finalized = [];
    function routeModule(name, method) { const result = { name: name }; return { [method]: function (options) { created.push([name, options]); return result; } }; }
    const modules = {
        basicRoutes: routeModule('basic', 'createBasicRoutes'), resourceRoutes: routeModule('resource', 'createResourceRoutes'),
        applicationRoutes: routeModule('application', 'createApplicationRoutes'), relayRoutes: routeModule('relay', 'createRelayRoutes'),
        passportRoutes: routeModule('passport', 'createPassportRoutes'), duoRoutes: routeModule('duo', 'createDuoRoutes'),
        agentRoutes: routeModule('agent', 'createAgentRoutes'), domainStatic: routeModule('static', 'createDomainStatic'),
        routeFinalization: { finalizeHttpRoutes: function (options) { finalized.push(options); } }
    };
    const refresh = function () { };
    const state = { bodyParser: { urlencoded: 'urlencoded' } }, parent = {};
    const setup = createHttpRouteSetup({ state: state, parent: parent, handlers: { refresh: refresh }, modules: modules, domainAssets: { name: 'assets' }, webRelay: 'relay-service' });
    setup();
    assert.deepEqual(created.map(function (entry) { return entry[0]; }), ['basic', 'resource', 'application', 'relay', 'passport', 'duo', 'agent', 'static']);
    assert.equal(created[0][1].handlers.refresh, refresh);
    assert.equal(created[0][1].urlencoded, 'urlencoded');
    assert.equal(finalized.length, 1);
    assert.deepEqual(finalized[0].routeGroups.map(function (route) { return route.name; }), ['basic', 'relay', 'resource', 'application', 'passport', 'duo', 'assets', 'agent', 'static']);
    assert.equal(finalized[0].webRelay, 'relay-service');
});
