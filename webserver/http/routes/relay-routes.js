/**
* @description Registration and authentication flow for domain relay WebSocket routes
* @license Apache-2.0
*/

'use strict';

module.exports.createRelayRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const getWebSocketArgs = options.getWebSocketArgs;
    const authorizeWebSocket = options.authorizeWebSocket;
    const authorizeInnerWebSocket = options.authorizeInnerWebSocket;
    const relayWebSocket = options.relayWebSocket;

    function closeWithCause(ws, cause, message) {
        try { ws.send(JSON.stringify({ action: 'close', cause: cause, msg: message || cause })); } catch (ex) { }
        try { ws.close(); } catch (ex) { }
    }

    function register(domain) {
        const url = domain.url;
        state.app.ws(url + 'webrelay.ashx', function (ws, req) { authorizeWebSocket(ws, req, false, relayWebSocket); });
        state.app.ws(url + 'webider.ashx', function (ws, req) {
            authorizeWebSocket(ws, req, false, function (ws1, req1, requestDomain, user) {
                state.meshIderHandler.CreateAmtIderSession(state, state.db, ws1, req1, state.args, requestDomain, user);
            });
        });
        state.app.ws(url + 'control.ashx', function (ws, req) {
            getWebSocketArgs(ws, req, function (activeWs, activeReq) {
                const requestDomain = getDomain(activeReq);
                if (state.CheckWebServerOriginName(requestDomain, activeReq) == false) { closeWithCause(activeWs, 'invalidorigin'); return; }
                if ((requestDomain.loginkey != null) && (requestDomain.loginkey.indexOf(activeReq.query.key) == -1)) { closeWithCause(activeWs, 'noauth', 'nokey'); return; }
                authorizeWebSocket(activeWs, activeReq, true, function (ws1, req1, authenticatedDomain, user, cookie, authData) {
                    if (user == null) {
                        if (activeReq.headers['x-meshauth'] === '*') {
                            authorizeInnerWebSocket(activeWs, activeReq, authenticatedDomain, function (ws2, req2, innerDomain, innerUser) {
                                state.meshUserHandler.CreateMeshUser(state, state.db, ws2, req2, state.args, innerDomain, innerUser, authData);
                            });
                        } else {
                            closeWithCause(activeWs, 'noauth');
                        }
                    } else {
                        state.meshUserHandler.CreateMeshUser(state, state.db, ws1, req1, state.args, authenticatedDomain, user, authData);
                    }
                });
            });
        });
        state.app.ws(url + 'devicefile.ashx', function (ws, req) { state.meshDeviceFileHandler.CreateMeshDeviceFile(state, ws, null, req, domain); });
        state.app.ws(url + 'meshrelay.ashx', function (ws, req) {
            authorizeWebSocket(ws, req, true, function (ws1, req1, requestDomain, user, cookie) {
                if (((parent.config.settings.desktopmultiplex === true) || (requestDomain.desktopmultiplex === true)) && (req.query.p == 2)) {
                    state.meshDesktopMultiplexHandler.CreateMeshRelay(state, ws1, req1, requestDomain, user, cookie);
                } else {
                    state.meshRelayHandler.CreateMeshRelay(state, ws1, req1, requestDomain, user, cookie);
                }
            });
        });
        if (state.args.wanonly != true) {
            state.app.ws(url + 'localrelay.ashx', function (ws, req) {
                authorizeWebSocket(ws, req, true, function (ws1, req1, requestDomain, user, cookie) {
                    if ((user == null) || (cookie == null)) {
                        try { ws1.close(); } catch (ex) { }
                    } else {
                        state.meshRelayHandler.CreateLocalRelay(state, ws1, req1, requestDomain, user, cookie);
                    }
                });
            });
        }
    }

    return { register: register };
};
