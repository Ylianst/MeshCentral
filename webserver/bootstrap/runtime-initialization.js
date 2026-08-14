/**
* @description Web server runtime state initialization
* @license Apache-2.0
*/

'use strict';

module.exports.configureSspiDomains = function (state, parent, loadModule) {
    if ((parent.platform != 'win32') || (state.args.nousers == true) || (parent.config == null) || (parent.config.domains == null)) { return; }
    for (var domainId in parent.config.domains) {
        if (parent.config.domains[domainId].auth == 'sspi') {
            const NodeSspi = loadModule('node-sspi');
            parent.config.domains[domainId].sspi = new NodeSspi({ retrieveGroups: false, offerBasic: false });
        }
    }
};

module.exports.initializeRuntimeCollections = function (state) {
    state.wsagents = {};
    state.wsagentsWithBadWebCerts = {};
    state.wsagentsDisconnections = {};
    state.wsagentsDisconnectionsTimer = null;
    state.duplicateAgentsLog = {};
    state.wssessions = {};
    state.wssessions2 = {};
    state.wsPeerSessions = {};
    state.wsPeerSessions2 = {};
    state.wsPeerSessions3 = {};
    state.sessionsCount = {};
    state.wsrelays = {};
    state.desktoprelays = {};
    state.wsPeerRelays = {};
};

module.exports.initializeRuntimeRandoms = function (state) {
    state.crypto.randomBytes(48, function (error, buffer) { state.httpAuthRandom = buffer; });
    state.crypto.randomBytes(16, function (error, buffer) { state.httpAuthRealm = buffer.toString('hex'); });
    state.crypto.randomBytes(48, function (error, buffer) { state.relayRandom = buffer; });
};
