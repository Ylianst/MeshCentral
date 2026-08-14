/**
* @description Authenticated remote-access page handlers
* @license Apache-2.0
*/

'use strict';

module.exports.getRemoteCredentialType = function (node, userId, page) {
    const credentials = (page == 'ssh') ? node.ssh : node.rdp;
    if ((credentials == null) || (typeof credentials != 'object')) return 0;
    const userCredentials = credentials[userId];
    if (page == 'ssh') {
        if ((typeof credentials.u == 'string') && (typeof credentials.p == 'string')) return 1;
        if ((typeof credentials.k == 'string') && (typeof credentials.kp == 'string')) return 2;
        if (typeof credentials.k == 'string') return 3;
        if ((userCredentials != null) && (typeof userCredentials == 'object')) {
            if ((typeof userCredentials.u == 'string') && (typeof userCredentials.p == 'string')) return 1;
            if ((typeof userCredentials.k == 'string') && (typeof userCredentials.kp == 'string')) return 2;
            if (typeof userCredentials.k == 'string') return 3;
        }
    } else {
        if ((typeof credentials.d == 'string') && (typeof credentials.u == 'string') && (typeof credentials.p == 'string')) return 1;
        if ((userCredentials != null) && (typeof userCredentials == 'object') && (typeof userCredentials.d == 'string') && (typeof userCredentials.u == 'string') && (typeof userCredentials.p == 'string')) return 1;
    }
    return 0;
};

module.exports.createRemotePages = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const getDomain = options.getDomain;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const escapeHtml = options.escapeHtml;
    const remoteControlRight = options.remoteControlRight;
    const noTerminalRight = options.noTerminalRight;
    const random = options.random || Math.random;

    function redirectToRoot(req, res, domain) { res.redirect(domain.url + getQueryPortion(req)); }

    function handleXTermRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        parent.debug('web', 'handleXTermRequest: sending xterm');
        res.set({ 'Cache-Control': 'no-store' });
        if (!req.session || !req.session.userid) { redirectToRoot(req, res, domain); return; }
        if (req.session.userid.split('/')[1] != domain.id) { redirectToRoot(req, res, domain); return; }
        const user = state.users[req.session.userid];
        if ((user == null) || (req.query.nodeid == null)) { redirectToRoot(req, res, domain); return; }

        state.GetNodeWithRights(domain, user, req.query.nodeid, function (node, rights) {
            if ((node == null) || ((rights & remoteControlRight) == 0) || ((rights != 0xFFFFFFFF) && ((rights & noTerminalRight) != 0))) { redirectToRoot(req, res, domain); return; }
            const logoutControls = { name: user.name };
            const extras = (req.query.key != null) ? ('&key=' + encodeURIComponent(req.query.key)) : '';
            if ((domain.ldap == null) && (domain.sspi == null) && (state.args.user == null) && (state.args.nousers != true)) logoutControls.logoutUrl = domain.url + 'logout?' + random() + extras;
            const authCookie = parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: req.clientIp }, parent.loginCookieEncryptionKey);
            const authRelayCookie = parent.encodeCookie({ ruserid: user._id, domainid: domain.id }, parent.loginCookieEncryptionKey);
            const httpsPort = (state.args.aliasport == null) ? state.args.port : state.args.aliasport;
            render(req, res, getRenderPage('xterm', req, domain), getRenderArgs({ serverDnsName: state.getWebServerName(domain, req), serverRedirPort: args.redirport, serverPublicPort: httpsPort, authCookie: authCookie, authRelayCookie: authRelayCookie, logoutControls: encodeURIComponent(JSON.stringify(logoutControls)).replace(/'/g, '%27'), name: escapeHtml(node.name) }, req, domain));
        });
    }

    function handleMSTSCRequest(req, res, page) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMSTSCRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if ((parent.config.settings.maintenancemode != null) && (req.query.loginscreen !== '1')) {
            render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            return;
        }
        var features = 0;
        if (domain.allowsavingdevicecredentials === false) features |= 1;
        var user = null;
        if (req.query.login != null) {
            const userCookie = parent.decodeCookie(req.query.login, parent.loginCookieEncryptionKey, 60);
            if ((userCookie != null) && (userCookie.a === 3) && (typeof userCookie.u == 'string')) user = state.users[userCookie.u];
        }
        if ((user == null) && (req.session.userid != null)) user = state.users[req.session.userid];
        if ((user == null) && state.args.user) user = state.users['user/' + domain.id + '/' + state.args.user.toLowerCase()];
        if (user == null) { res.sendStatus(401); return; }

        if (req.query.ws != null) {
            const relayCookie = parent.decodeCookie(req.query.ws, parent.loginCookieEncryptionKey, 60);
            if ((relayCookie != null) && (relayCookie.domainid == domain.id) && (relayCookie.nodeid != null) && (relayCookie.tcpport != null)) {
                state.db.Get(relayCookie.nodeid, function (err, nodes) {
                    if ((err != null) || (nodes.length != 1)) { res.sendStatus(404); return; }
                    const node = nodes[0];
                    var serverCredentials = 0;
                    if (domain.allowsavingdevicecredentials !== false) serverCredentials = module.exports.getRemoteCredentialType(node, user._id, page);
                    render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: req.query.ws, name: encodeURIComponent(req.query.name).replace(/'/g, '%27'), serverCredentials: serverCredentials, features: features }, req, domain));
                });
                return;
            }
        }

        if (req.query.node != null) {
            const nodeIdSplit = req.query.node.split('/');
            if (nodeIdSplit.length == 1) {
                req.query.node = 'node/' + domain.id + '/' + nodeIdSplit[0];
            } else if (nodeIdSplit.length == 3) {
                if ((nodeIdSplit[0] != 'node') || (nodeIdSplit[1] != domain.id)) req.query.node = null;
            } else {
                req.query.node = null;
            }
        }
        if (req.query.node == null) { render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: '', name: '', features: features }, req, domain)); return; }

        state.db.Get(req.query.node, function (err, nodes) {
            if ((err != null) || (nodes.length != 1)) { res.sendStatus(404); return; }
            const node = nodes[0];
            if ((state.GetNodeRights(user, node.meshid, node._id) & remoteControlRight) == 0) { res.sendStatus(401); return; }
            var port = (page == 'ssh') ? 22 : 3389;
            if ((page == 'ssh') && (typeof node.sshport == 'number')) port = node.sshport;
            if ((page != 'ssh') && (typeof node.rdpport == 'number')) port = node.rdpport;
            var serverCredentials = false;
            if (domain.allowsavingdevicecredentials !== false) serverCredentials = module.exports.getRemoteCredentialType(node, user._id, page);
            if (req.query.port != null) {
                const queryPort = parseInt(req.query.port);
                if ((queryPort > 0) && (queryPort < 65536)) port = queryPort;
            }
            const cookie = parent.encodeCookie({ userid: user._id, domainid: user.domain, nodeid: node._id, tcpport: port }, parent.loginCookieEncryptionKey);
            render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: cookie, name: encodeURIComponent(node.name).replace(/'/g, '%27'), serverCredentials: serverCredentials, features: features }, req, domain));
        });
    }

    return { handleXTermRequest: handleXTermRequest, handleMSTSCRequest: handleMSTSCRequest };
};
