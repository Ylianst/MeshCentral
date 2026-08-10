/**
* @description Registration of agent, MQTT and alternate agent-port routes
* @license Apache-2.0
*/

'use strict';

module.exports.createAgentRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkAgentIpAddress = options.checkAgentIpAddress;
    const authorizeWebSocket = options.authorizeWebSocket;
    const createSerialTunnel = options.createSerialTunnel;
    const handlers = options.handlers;

    function handleAgent(ws, req) {
        const domain = checkAgentIpAddress(ws, req);
        if (domain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
        if (domain.agentkey && ((req.query.key == null) || (domain.agentkey.indexOf(req.query.key) == -1))) return;
        try { state.meshAgentHandler.CreateMeshAgent(state, state.db, ws, req, state.args, domain); } catch (ex) { console.log(ex); }
    }

    function handleMeshRelay(ws, req) {
        authorizeWebSocket(ws, req, true, function (ws1, req1, domain, user, cookie) {
            if (((parent.config.settings.desktopmultiplex === true) || (domain.desktopmultiplex === true)) && (req.query.p == 2)) {
                state.meshDesktopMultiplexHandler.CreateMeshRelay(state, ws1, req1, domain, user, cookie);
            } else {
                state.meshRelayHandler.CreateMeshRelay(state, ws1, req1, domain, user, cookie);
            }
        });
    }

    function register(domain) {
        const url = domain.url;
        state.app.ws(url + 'agent.ashx', handleAgent);
        if (parent.mqttbroker != null) {
            state.app.ws(url + 'mqtt.ashx', function (ws, req) {
                const requestDomain = checkAgentIpAddress(ws, req);
                if (requestDomain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
                const serialTunnel = createSerialTunnel();
                serialTunnel.xtransport = 'ws';
                serialTunnel.xdomain = requestDomain;
                serialTunnel.xip = req.clientIp;
                ws.on('message', function (data) { serialTunnel.updateBuffer(Buffer.from(data, 'binary')); });
                serialTunnel.forwardwrite = function (data) { ws.send(data, 'binary'); };
                ws.on('close', function () { serialTunnel.emit('end'); });
                parent.mqttbroker.handle(serialTunnel);
            });
        }

        if (state.agentapp == null) return;
        state.agentapp.ws(url + 'agent.ashx', handleAgent);
        state.agentapp.ws(url + 'meshrelay.ashx', handleMeshRelay);
        state.agentapp.ws(url + 'devicefile.ashx', function (ws, req) { state.meshDeviceFileHandler.CreateMeshDeviceFile(state, ws, null, req, domain); });
        state.agentapp.ws(url + 'agenttransfer.ashx', handlers.agentFileTransfer);
        state.agentapp.get(url + 'meshagents', handlers.meshAgentRequest);
        state.agentapp.get(url + 'agentdownload.ashx', handlers.agentDownloadFile);
        if (parent.mpsserver != null) state.agentapp.ws(url + 'apf.ashx', function (ws, req) { parent.mpsserver.onWebSocketConnection(ws, req); });
    }

    return { register: register };
};
