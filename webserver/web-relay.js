/**
* @description DNS-hosted web relay session routing and lifecycle
* @license Apache-2.0
*/

'use strict';

module.exports.createWebRelay = function (options) {
    const state = options.state;
    const parent = options.parent;
    const sessions = {};
    const createRouter = options.createRouter;
    const loadAppRelays = options.loadAppRelays || function () { return require('../apprelays.js'); };
    const startInterval = options.setInterval || setInterval;
    const stopInterval = options.clearInterval || clearInterval;
    let cleanupTimer = null;

    function getSessionId(req) {
        if ((req.session.userid != null) && (req.session.x != null)) return req.session.userid + '/' + req.session.x;
        if (req.session.z != null) return req.session.z;
        return null;
    }

    function handleRequest(req, res) {
        const sessionId = getSessionId(req);
        if ((sessionId == null) || (state.destroyedSessions[sessionId] != null)) { res.sendStatus(404); return; }
        const relaySession = sessions[sessionId + '/' + req.hostname];
        if (relaySession == null) { res.sendStatus(404); return; }
        relaySession.handleRequest(req, res);
    }

    function handleWebSocket(ws, req) {
        const sessionId = getSessionId(req);
        if ((sessionId == null) || (state.destroyedSessions[sessionId] != null)) { ws.close(); return; }
        const relaySession = sessions[sessionId + '/' + req.hostname];
        if (relaySession == null) { ws.close(); return; }
        relaySession.handleWebSocket(ws, req);
    }

    function handleEvent(source, event) {
        if (event.action != 'removedDeviceShare') return;
        for (const sessionId in sessions) if (sessions[sessionId].xpublicid === event.publicid) sessions[sessionId].close();
    }

    function checkTimeouts() { for (const sessionId in sessions) sessions[sessionId].checkTimeout(); }

    function stopCleanupWhenIdle() {
        if ((Object.keys(sessions).length == 0) && (cleanupTimer != null)) {
            stopInterval(cleanupTimer);
            cleanupTimer = null;
        }
    }

    function setupRouter() {
        if (state.args.relaydns == null) return null;
        const router = createRouter();
        router.get('/control-redirect.ashx', handleControlRedirect);
        for (const method of ['get', 'post', 'put', 'delete', 'options', 'head']) router[method]('/*', function (req, res) { try { handleRequest(req, res); } catch (ex) { console.log(ex); } });
        return router;
    }

    function handleControlRedirect(req, res) {
        if (state.args.relaydns.indexOf(req.hostname) == -1) { res.sendStatus(404); return; }
        if ((req.session.userid == null) && state.args.user && state.users['user//' + state.args.user.toLowerCase()]) req.session.userid = 'user//' + state.args.user.toLowerCase();
        res.set({ 'Cache-Control': 'no-store' });
        parent.debug('web', 'webRelaySetup');
        if (req.query.c == null) { res.sendStatus(404); return; }
        const urlCookie = parent.decodeCookie(req.query.c, parent.loginCookieEncryptionKey, 32);
        if (urlCookie == null) { res.sendStatus(404); return; }
        const relay = decodeRelayRequest(req, res, urlCookie);
        if (relay == null) return;
        let freeRelayHost, oldestRelayHost, oldestRelayTime;
        for (const host of state.args.relaydns) {
            const sessionId = relay.webSessionId + '/' + host;
            const relaySession = sessions[sessionId];
            if (relaySession == null) {
                if (freeRelayHost == null) freeRelayHost = host;
            } else {
                if ((relaySession.domain.id == relay.domain.id) && (relaySession.userid == relay.userid) && (relaySession.nodeid == relay.nodeid) && (relaySession.addr == relay.addr) && (relaySession.port == relay.port) && (relaySession.appid == relay.appid)) {
                    redirectToHost(req, res, host, '/');
                    return;
                }
                if ((oldestRelayHost == null) || (oldestRelayTime > relaySession.lastOperation)) { oldestRelayHost = host; oldestRelayTime = relaySession.lastOperation; }
            }
        }
        state.GetNodeWithRights(relay.domain, relay.userid, relay.nodeid, function (node, rights) {
            if ((rights & 0x00200008) == 0) { res.sendStatus(404); return; }
            const selectedHost = freeRelayHost != null ? freeRelayHost : oldestRelayHost;
            const sessionId = relay.webSessionId + '/' + selectedHost;
            if (selectedHost == req.hostname) {
                const previousSession = sessions[sessionId];
                if (previousSession != null) { previousSession.close(); delete sessions[sessionId]; }
                const relaySession = loadAppRelays().CreateWebRelaySession(state, state.db, req, state.args, relay.domain, relay.userid, relay.nodeid, relay.addr, relay.port, relay.appid, sessionId, relay.expire, node.mtype);
                relaySession.xpublicid = relay.publicid;
                relaySession.onclose = function (closedSessionId) { delete sessions[closedSessionId]; stopCleanupWhenIdle(); };
                sessions[sessionId] = relaySession;
                if (cleanupTimer == null) cleanupTimer = startInterval(checkTimeouts, 10000);
                res.redirect('/');
            } else if (req.query.noredirect != null) {
                res.sendStatus(404);
            } else {
                redirectToHost(req, res, selectedHost, req.url + '&noredirect=1');
            }
        });
    }

    function decodeRelayRequest(req, res, cookie) {
        let userid, domain, nodeid, addr, port, appid, webSessionId, expire, publicid;
        if ((cookie.ruserid != null) && (cookie.x != null)) {
            if (state.destroyedSessions[cookie.ruserid + '/' + cookie.x] != null) { res.sendStatus(404); return null; }
            req.session.x = cookie.x;
            req.session.userid = cookie.ruserid;
            if (req.session.z) delete req.session.z;
            userid = req.session.userid;
            domain = parent.config.domains[userid.split('/')[1]];
            nodeid = req.query.relayid != null ? req.query.relayid : req.query.n;
            addr = req.query.addr != null ? req.query.addr : '127.0.0.1';
            port = parseInt(req.query.p);
            appid = parseInt(req.query.appid);
            webSessionId = userid + '/' + req.session.x;
            if ((req.query.n == null) || (req.query.p == null) || ((req.query.appid != 1) && (req.query.appid != 2))) { res.redirect('/'); return null; }
        } else if (cookie.r == 8) {
            userid = cookie.userid;
            domain = parent.config.domains[userid.split('/')[1]];
            nodeid = cookie.nid;
            addr = cookie.addr != null ? cookie.addr : '127.0.0.1';
            port = cookie.port;
            appid = cookie.p == 16 ? 2 : 1;
            webSessionId = userid + '/' + cookie.pid;
            publicid = cookie.pid;
            delete req.session.x;
            delete req.session.userid;
            req.session.z = webSessionId;
            expire = cookie.expire;
            if ((expire != null) && (expire <= Date.now())) { parent.debug('webrelay', 'expired link'); res.sendStatus(404); return null; }
        }
        if (webSessionId == null) { res.sendStatus(404); return null; }
        return { userid: userid, domain: domain, nodeid: nodeid, addr: addr, port: port, appid: appid, webSessionId: webSessionId, expire: expire, publicid: publicid };
    }

    function redirectToHost(req, res, host, path) {
        if (host == req.hostname) { res.redirect(path); return; }
        const httpPort = state.args.aliasport != null ? state.args.aliasport : state.args.port;
        res.redirect('https://' + host + (httpPort != 443 ? ':' + httpPort : '') + path);
    }

    return { sessions: sessions, setupRouter: setupRouter, handleRequest: handleRequest, handleWebSocket: handleWebSocket, handleEvent: handleEvent, checkTimeouts: checkTimeouts };
};
