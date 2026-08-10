/**
* @description HTTP route registration finalization
* @license Apache-2.0
*/

'use strict';

const domainRouteRegistration = require('./domain-route-registration.js');

module.exports.finalizeHttpRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    if (parent.pluginHandler != null) { parent.pluginHandler.callHook('hook_setupHttpHandlers', state, parent); }
    if (parent.multiServer != null) {
        state.app.ws('/meshserver.ashx', function (websocket, request) { parent.multiServer.CreatePeerInServer(parent.multiServer, websocket, request, state.args.tlsoffload == null); });
    }
    state.webRelayRouter = options.webRelay.setupRouter();
    domainRouteRegistration.registerDomainRoutes(parent.config.domains, options.routeGroups);
    options.domainStatic.startDisconnectionCleanup();
};
