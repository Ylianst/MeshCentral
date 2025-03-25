/**
* @description MeshCentral monitoring module
* @author Simon Smith
* @license Apache-2.0
* @version v0.0.1
*/

"use strict";

module.exports.CreateMonitoring = function (parent, args) {
    var obj = {};
    obj.args = args;
    obj.parent = parent;
    obj.express = require('express');
    obj.app = obj.express();
    obj.prometheus = null;
    if (args.compression !== false) { obj.app.use(require('compression')()); }
    obj.app.disable('x-powered-by');
    obj.counterMetrics = { // Counter Metrics always start at 0 and increase but never decrease
        RelayErrors: { description: "Relay Errors" }, // parent.webserver.relaySessionErrorCount
        UnknownGroup: { description: "Unknown Group" }, // meshDoesNotExistCount
        InvalidPKCSsignature: { description: "Invalid PKCS signature" },  // invalidPkcsSignatureCount
        InvalidRSAsignature: { description: "Invalid RSA signature" }, // invalidRsaSignatureCount
        InvalidJSON: { description: "Invalid JSON" }, // invalidJsonCount
        UnknownAction: { description: "Unknown Action" }, // unknownAgentActionCount
        BadWebCertificate: { description: "Bad Web Certificate" }, // agentBadWebCertHashCount
        BadSignature: { description: "Bad Signature" }, // (agentBadSignature1Count + agentBadSignature2Count)
        MaxSessionsReached: { description: "Max Sessions Reached" }, // agentMaxSessionHoldCount
        UnknownDeviceGroup: { description: "Unknown Device Group" }, // (invalidDomainMeshCount + invalidDomainMesh2Count)
        InvalidDeviceGroupType: { description: "Invalid Device Group Type" }, //  invalidMeshTypeCount
        DuplicateAgent: { description: "Duplicate Agent" }, // duplicateAgentCount
        blockedUsers: { description: "Blocked Users" }, // blockedUsers
        blockedAgents: { description: "Blocked Agents" }, // blockedAgents
    };
    obj.gaugeMetrics = { // Gauge Metrics always start at 0 and can increase and decrease
        ConnectedIntelAMT: { description: "Connected Intel AMT" }, // parent.parent.connectivityByNode[i].connectivity == 4
        ConnectedIntelAMTCira: { description: "Connected Intel AMT CIRA" }, // parent.mpsserver.ciraConnections[i].length
        UserAccounts: { description: "User Accounts" }, // Object.keys(parent.webserver.users).length
        DeviceGroups: { description: "Device Groups" }, // parent.webserver.meshes (ONLY WHERE deleted=null)
        AgentSessions: { description: "Agent Sessions" }, // Object.keys(parent.webserver.wsagents).length
        ConnectedUsers: { description: "Connected Users" }, // Object.keys(parent.webserver.wssessions).length
        UsersSessions: { description: "Users Sessions" }, // Object.keys(parent.webserver.wssessions2).length
        RelaySessions: { description: "Relay Sessions" }, // parent.webserver.relaySessionCount
        RelayCount: { description: "Relay Count" } // Object.keys(parent.webserver.wsrelays).length30bb4fb74dfb758d36be52a7
    }
    obj.collectors = [];
    if (parent.config.settings.prometheus != null) { // Create Prometheus Monitoring Endpoint
        if ((typeof parent.config.settings.prometheus == 'number') && ((parent.config.settings.prometheus < 1) || (parent.config.settings.prometheus > 65535))) {
           console.log('Promethus port number is invalid, Prometheus metrics endpoint has be disabled');
           delete parent.config.settings.prometheus;
        } else {
            const port = ((typeof parent.config.settings.prometheus == 'number') ? parent.config.settings.prometheus : 9464);
            obj.prometheus = require('prom-client');
            const collectDefaultMetrics = obj.prometheus.collectDefaultMetrics;
            collectDefaultMetrics();
            for (const key in obj.gaugeMetrics) {
                obj.gaugeMetrics[key].prometheus = new obj.prometheus.Gauge({ name: 'meshcentral_' + String(key).toLowerCase(), help: obj.gaugeMetrics[key].description });
            }
            for (const key in obj.counterMetrics) {
                obj.counterMetrics[key].prometheus = new obj.prometheus.Counter({ name: 'meshcentral_' + String(key).toLowerCase(), help: obj.counterMetrics[key].description });
            }
            obj.app.get('/', function (req, res) { res.send('MeshCentral Prometheus server.'); });
            obj.app.listen(port, function () {
                console.log('MeshCentral Prometheus server running on port ' + port + '.');
                obj.parent.updateServerState('prometheus-port', port);
            });
            obj.app.get('/metrics', async (req, res) => {
                try {
                    // Count the number of device groups that are not deleted
                    var activeDeviceGroups = 0;
                    for (var i in parent.webserver.meshes) { if (parent.webserver.meshes[i].deleted == null) { activeDeviceGroups++; } } // This is not ideal for performance, we want to dome something better.
                    var gauges = {
                        UserAccounts: Object.keys(parent.webserver.users).length,
                        DeviceGroups: activeDeviceGroups,
                        AgentSessions: Object.keys(parent.webserver.wsagents).length,
                        ConnectedUsers: Object.keys(parent.webserver.wssessions).length,
                        UsersSessions: Object.keys(parent.webserver.wssessions2).length,
                        RelaySessions: parent.webserver.relaySessionCount,
                        RelayCount: Object.keys(parent.webserver.wsrelays).length,
                        ConnectedIntelAMT: 0
                    };
                    if (parent.mpsserver != null) {
                        gauges.ConnectedIntelAMTCira = 0;
                        for (var i in parent.mpsserver.ciraConnections) { 
                            gauges.ConnectedIntelAMTCira += parent.mpsserver.ciraConnections[i].length;
                        }
                    }
                    for (var i in parent.connectivityByNode) {
                        if (parent.connectivityByNode[i].connectivity == 4) { gauges.ConnectedIntelAMT++; }
                    }
                    for (const key in gauges) { obj.gaugeMetrics[key].prometheus.set(gauges[key]); }
                    // Take a look at agent errors
                    var agentstats = parent.webserver.getAgentStats();
                    const counters = {
                        RelayErrors: parent.webserver.relaySessionErrorCount,
                        UnknownGroup: agentstats.meshDoesNotExistCount,
                        InvalidPKCSsignature: agentstats.invalidPkcsSignatureCount,
                        InvalidRSAsignature: agentstats.invalidRsaSignatureCount,
                        InvalidJSON: agentstats.invalidJsonCount,
                        UnknownAction: agentstats.unknownAgentActionCount,
                        BadWebCertificate: agentstats.agentBadWebCertHashCount,
                        BadSignature: (agentstats.agentBadSignature1Count + agentstats.agentBadSignature2Count),
                        MaxSessionsReached: agentstats.agentMaxSessionHoldCount,
                        UnknownDeviceGroup: (agentstats.invalidDomainMeshCount + agentstats.invalidDomainMesh2Count),
                        InvalidDeviceGroupType: (agentstats.invalidMeshTypeCount + agentstats.invalidMeshType2Count),
                        DuplicateAgent: agentstats.duplicateAgentCount,
                        blockedUsers: parent.webserver.blockedUsers,
                        blockedAgents: parent.webserver.blockedAgents
                    };
                    for (const key in counters) { obj.counterMetrics[key].prometheus.reset(); obj.counterMetrics[key].prometheus.inc(counters[key]); }
                    res.set('Content-Type', obj.prometheus.register.contentType);
                    await Promise.all(obj.collectors.map((collector) => (collector(req, res))));
                    res.end(await obj.prometheus.register.metrics());
                } catch (ex) {
                    console.log(ex);
                    res.status(500).end();
                }
            });
        }
    }
    return obj;
}