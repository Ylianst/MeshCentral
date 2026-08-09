/**
* @description Guest device-sharing link and page handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createGuestSharing = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const getDomain = options.getDomain;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;

    function renderMessage(req, res, domain, messageId) {
        res.status(404);
        render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: messageId, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
    }

    function advanceRecurringShare(doc, now) {
        if ((typeof doc.recurring !== 'number') || (now < doc.startTime)) return doc;
        const period = (doc.recurring === 1) ? (24 * 60 * 60 * 1000) : ((doc.recurring === 2) ? (7 * 24 * 60 * 60 * 1000) : null);
        if (period == null) return doc;
        const delta = now - doc.startTime;
        var addition = Math.floor(delta / period);
        if ((delta - (addition * period)) > (doc.duration * 60000)) addition++;
        doc.startTime += addition * period;
        return doc;
    }

    function createShareContext(doc) {
        const cookie = { a: 5, p: doc.p, gn: doc.guestName, nid: doc.nodeid, cf: doc.consent, pid: doc.publicid, k: doc.extrakey || null, port: doc.port };
        if (doc.userid) cookie.userid = doc.userid;
        if ((cookie.userid == null) && cookie.pid.startsWith('AS:node/')) cookie.nouser = 1;
        if (doc.startTime != null) {
            cookie.start = doc.startTime;
            if (doc.expireTime != null) cookie.expire = doc.expireTime;
            else if (doc.duration != null) cookie.expire = doc.startTime + (doc.duration * 60000);
        }
        if (doc.viewOnly === true) cookie.vo = 1;
        return cookie;
    }

    function handleRequest(req, res) {
        const domain = getDomain(req, res);
        if (domain == null) return;
        if ((req.query.c == null) || (domain.guestdevicesharing === false)) { res.sendStatus(404); return; }
        const cookie = parent.decodeCookie(req.query.c, parent.invitationLinkEncryptionKey, 9999999999);
        if (cookie == null) { res.sendStatus(404); return; }
        if (cookie.a !== 6) { res.sendStatus(404); return; }
        if (typeof cookie.pid !== 'string') { res.sendStatus(404); return; }
        if ((cookie.e != null) && (cookie.e <= Date.now())) { renderMessage(req, res, domain, 12); return; }
        state.db.Get('deviceshare-' + cookie.pid, function (err, docs) {
            if ((err != null) || (docs == null) || (docs.length !== 1)) { res.sendStatus(404); return; }
            handleShareRequest(req, res, domain, createShareContext(advanceRecurringShare(docs[0], Date.now())));
        });
    }

    function handleShareRequest(req, res, domain, cookie) {
        if ((cookie.expire != null) && (cookie.expire <= Date.now())) { renderMessage(req, res, domain, 12); return; }
        state.db.GetAllTypeNodeFiltered([cookie.nid], domain.id, 'deviceshare', null, function (err, docs) {
            if ((err != null) || (docs.length === 0)) { renderMessage(req, res, domain, 12); return; }
            var found = false;
            for (var i = 0; i < docs.length; i++) {
                if ((docs[i].publicid === cookie.pid) && ((docs[i].extrakey == null) || (docs[i].extrakey === cookie.k))) found = true;
            }
            if (!found) { renderMessage(req, res, domain, 12); return; }
            state.db.Get(cookie.nid, function (nodeError, nodes) {
                if ((nodeError != null) || (nodes == null) || (nodes.length !== 1)) { res.sendStatus(404); return; }
                const node = nodes[0];
                if ((cookie.start != null) && (cookie.expire != null) && ((cookie.start > Date.now()) || (cookie.start > cookie.expire))) { renderMessage(req, res, domain, 11); return; }
                if ((cookie.p === 8) || (cookie.p === 16)) { redirectToWebRelay(req, res, domain, cookie); return; }

                const authCookieData = { userid: cookie.userid, domainid: domain.id, nid: cookie.nid, ip: req.clientIp, p: cookie.p, gn: cookie.gn, cf: cookie.cf, r: 8, expire: cookie.expire, pid: cookie.pid, vo: cookie.vo };
                if ((authCookieData.userid == null) && authCookieData.pid.startsWith('AS:node/')) authCookieData.nouser = 1;
                if (cookie.k != null) authCookieData.k = cookie.k;
                const authCookie = parent.encodeCookie(authCookieData, parent.loginCookieEncryptionKey);
                const features2 = (state.args.allowhighqualitydesktop !== false) ? 1 : 0;
                const httpsPort = (state.args.aliasport == null) ? state.args.port : state.args.aliasport;
                parent.debug('web', 'handleSharingRequest: Sending guest sharing page for "' + cookie.userid + '", guest "' + cookie.gn + '".');
                res.set({ 'Cache-Control': 'no-store' });
                render(req, res, getRenderPage('sharing', req, domain), getRenderArgs({ authCookie: authCookie, authRelayCookie: '', domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), nodeid: cookie.nid, serverDnsName: state.getWebServerName(domain, req), serverRedirPort: args.redirport, serverPublicPort: httpsPort, expire: cookie.expire, viewOnly: (cookie.vo === 1) ? 1 : 0, nodeName: encodeURIComponent(node.name).replace(/'/g, '%27'), features: cookie.p, features2: features2 }, req, domain));
            });
        });
    }

    function redirectToWebRelay(req, res, domain, cookie) {
        const webRelayPort = (args.relaydns != null) ? ((typeof args.aliasport === 'number') ? args.aliasport : args.port) : ((parent.webrelayserver != null) ? ((typeof args.relayaliasport === 'number') ? args.relayaliasport : parent.webrelayserver.port) : 0);
        if (webRelayPort === 0) { res.sendStatus(404); return; }
        const authCookieData = { userid: cookie.userid, domainid: domain.id, nid: cookie.nid, ip: req.clientIp, p: cookie.p, gn: cookie.gn, r: 8, expire: cookie.expire, pid: cookie.pid, port: cookie.port };
        if ((authCookieData.userid == null) && authCookieData.pid.startsWith('AS:node/')) authCookieData.nouser = 1;
        const authCookie = parent.encodeCookie(authCookieData, parent.loginCookieEncryptionKey);
        const relayDns = (args.relaydns != null) ? args.relaydns[0] : state.getWebServerName(domain, req);
        var url = 'https://' + relayDns + ':' + webRelayPort + '/control-redirect.ashx?n=' + cookie.nid + '&p=' + cookie.port + '&appid=' + cookie.p + '&c=' + authCookie;
        if (cookie.addr != null) url += '&addr=' + cookie.addr;
        if (cookie.pid != null) url += '&relayid=' + cookie.pid;
        parent.debug('web', 'handleSharingRequest: Redirecting guest to HTTP relay page for "' + cookie.userid + '", guest "' + cookie.gn + '".');
        res.redirect(url);
    }

    return { advanceRecurringShare: advanceRecurringShare, createShareContext: createShareContext, handleRequest: handleRequest, handleShareRequest: handleShareRequest };
};
