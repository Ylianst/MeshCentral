/**
* @description Authenticated remote-access page handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createRemotePages = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
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

    return { handleXTermRequest: handleXTermRequest };
};
