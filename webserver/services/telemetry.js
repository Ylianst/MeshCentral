/**
* @description Web server counters, traffic deltas and recent agent issues
* @license Apache-2.0
*/

'use strict';

module.exports.createTelemetry = function (options) {
    const state = options.state;
    const tlsConfiguration = options.tlsConfiguration;
    const calcDelta = options.calcDelta;
    const now = options.now || Date.now;

    const telemetry = {
        agentStats: {
            createMeshAgentCount: 0,
            agentClose: 0,
            agentBinaryUpdate: 0,
            agentMeshCoreBinaryUpdate: 0,
            coreIsStableCount: 0,
            verifiedAgentConnectionCount: 0,
            clearingCoreCount: 0,
            updatingCoreCount: 0,
            recoveryCoreIsStableCount: 0,
            meshDoesNotExistCount: 0,
            invalidPkcsSignatureCount: 0,
            invalidRsaSignatureCount: 0,
            invalidJsonCount: 0,
            unknownAgentActionCount: 0,
            agentBadWebCertHashCount: 0,
            agentBadSignature1Count: 0,
            agentBadSignature2Count: 0,
            agentMaxSessionHoldCount: 0,
            invalidDomainMeshCount: 0,
            invalidMeshTypeCount: 0,
            invalidDomainMesh2Count: 0,
            invalidMeshType2Count: 0,
            duplicateAgentCount: 0,
            maxDomainDevicesReached: 0,
            agentInTrouble: 0,
            agentInBigTrouble: 0
        },
        trafficStats: {
            httpRequestCount: 0,
            httpWebSocketCount: 0,
            httpIn: 0,
            httpOut: 0,
            relayCount: {},
            relayIn: {},
            relayOut: {},
            localRelayCount: {},
            localRelayIn: {},
            localRelayOut: {},
            AgentCtrlIn: 0,
            AgentCtrlOut: 0,
            LMSIn: 0,
            LMSOut: 0,
            CIRAIn: 0,
            CIRAOut: 0,
            time: now()
        },
        agentIssues: []
    };

    telemetry.getStats = function () {
        return {
            users: Object.keys(state.users).length,
            meshes: Object.keys(state.meshes).length,
            dnsDomains: Object.keys(state.dnsDomains).length,
            relaySessionCount: state.relaySessionCount,
            relaySessionErrorCount: state.relaySessionErrorCount,
            wsagents: Object.keys(state.wsagents).length,
            wsagentsDisconnections: Object.keys(state.wsagentsDisconnections).length,
            wsagentsDisconnectionsTimer: Object.keys(state.wsagentsDisconnectionsTimer).length,
            wssessions: Object.keys(state.wssessions).length,
            wssessions2: Object.keys(state.wssessions2).length,
            wsPeerSessions: Object.keys(state.wsPeerSessions).length,
            wsPeerSessions2: Object.keys(state.wsPeerSessions2).length,
            wsPeerSessions3: Object.keys(state.wsPeerSessions3).length,
            sessionsCount: Object.keys(state.sessionsCount).length,
            wsrelays: Object.keys(state.wsrelays).length,
            wsPeerRelays: Object.keys(state.wsPeerRelays).length,
            tlsSessionStore: tlsConfiguration.getSessionStoreSize(),
            blockedUsers: state.blockedUsers,
            blockedAgents: state.blockedAgents
        };
    };
    telemetry.getAgentStats = function () { return telemetry.agentStats; };
    telemetry.getTrafficStats = function () { return telemetry.trafficStats; };
    telemetry.getTrafficDelta = function (oldTraffic) {
        const data = state.common.Clone(telemetry.trafficStats);
        data.time = now();
        const delta = calcDelta(oldTraffic || {}, data);
        if (oldTraffic && oldTraffic.time) delta.delta = data.time - oldTraffic.time;
        delta.time = data.time;
        return { current: data, delta: delta };
    };
    telemetry.getAgentIssues = function () { return telemetry.agentIssues; };
    telemetry.setAgentIssue = function (agent, issue) {
        let addressAndPort = agent.remoteaddrport || '';
        if (!addressAndPort) {
            let address = agent.remoteaddr || '';
            if (!address && agent.ws && agent.ws._socket && agent.ws._socket.remoteAddress) address = agent.ws._socket.remoteAddress;
            if (address) {
                let port = '';
                if (agent.ws && agent.ws._socket && agent.ws._socket.remotePort) port = ':' + agent.ws._socket.remotePort;
                addressAndPort = address + port;
            }
        }
        telemetry.agentIssues.push([new Date(now()).toLocaleString(), addressAndPort, issue]);
        while (telemetry.agentIssues.length > 50) telemetry.agentIssues.shift();
    };

    return telemetry;
};
