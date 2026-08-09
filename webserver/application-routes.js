/**
* @description Registration of optional IP-KVM, RDP, SSH and Firebase application routes
* @license Apache-2.0
*/

'use strict';

module.exports.createApplicationRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    const handlers = options.handlers;
    const getDomain = options.getDomain;
    const authorizeWebSocket = options.authorizeWebSocket;
    const urlencoded = options.urlencoded;
    const loadAppRelays = options.loadAppRelays || function () { return require('../apprelays.js'); };

    function setDefaultUser(req, domain) {
        if ((req.session.userid == null) && (typeof state.args.user == 'string') && (state.users['user/' + domain.id + '/' + state.args.user.toLowerCase()])) {
            req.session.userid = 'user/' + domain.id + '/' + state.args.user.toLowerCase();
        }
    }

    function register(domain) {
        const url = domain.url;
        if (domain.ipkvm) {
            state.app.ws(url + 'ipkvm.ashx/*', function (ws, req) {
                const requestDomain = getDomain(req);
                if (requestDomain == null) { parent.debug('web', 'ipkvm: failed domain checks.'); try { ws.close(); } catch (ex) { } return; }
                parent.ipKvmManager.handleIpKvmWebSocket(requestDomain, ws, req);
            });
            state.app.get(url + 'ipkvm.ashx/*', function (req, res, next) {
                const requestDomain = getDomain(req);
                if (requestDomain == null) return;
                parent.ipKvmManager.handleIpKvmGet(requestDomain, req, res, next);
            });
        }

        if (domain.mstsc !== false) {
            state.app.get(url + 'mstsc.html', function (req, res) { handlers.mstscRequest(req, res, 'mstsc'); });
            state.app.ws(url + 'mstscrelay.ashx', function (ws, req) {
                const requestDomain = getDomain(req);
                if (requestDomain == null) { parent.debug('web', 'mstsc: failed checks.'); try { ws.close(); } catch (ex) { } return; }
                setDefaultUser(req, requestDomain);
                try { loadAppRelays().CreateMstscRelay(state, state.db, ws, req, state.args, requestDomain); } catch (ex) { console.log(ex); }
            });
        }

        if (domain.ssh === true) {
            state.app.get(url + 'ssh.html', function (req, res) { handlers.mstscRequest(req, res, 'ssh'); });
            state.app.ws(url + 'sshrelay.ashx', function (ws, req) {
                const requestDomain = getDomain(req);
                if (requestDomain == null) { parent.debug('web', 'ssh: failed checks.'); try { ws.close(); } catch (ex) { } return; }
                setDefaultUser(req, requestDomain);
                try { loadAppRelays().CreateSshRelay(state, state.db, ws, req, state.args, requestDomain); } catch (ex) { console.log(ex); }
            });
            state.app.ws(url + 'sshterminalrelay.ashx', function (ws, req) {
                authorizeWebSocket(ws, req, true, function (ws1, req1, requestDomain, user, cookie) {
                    loadAppRelays().CreateSshTerminalRelay(state, state.db, ws1, req1, requestDomain, user, cookie, state.args);
                });
            });
            state.app.ws(url + 'sshfilesrelay.ashx', function (ws, req) {
                authorizeWebSocket(ws, req, true, function (ws1, req1, requestDomain, user, cookie) {
                    loadAppRelays().CreateSshFilesRelay(state, state.db, ws1, req1, requestDomain, user, cookie, state.args);
                });
            });
        }

        if ((parent.firebase != null) && (parent.config.firebase)) {
            if (parent.config.firebase.pushrelayserver) {
                parent.debug('email', 'Firebase-pushrelay-handler');
                state.app.post(url + 'firebaserelay.aspx', urlencoded({ extended: false }), handlers.firebasePushOnlyRelayRequest);
            }
            if (parent.config.firebase.relayserver) {
                parent.debug('email', 'Firebase-relay-handler');
                state.app.ws(url + 'firebaserelay.aspx', handlers.firebaseRelayRequest);
            }
        }
    }

    return { register: register };
};
