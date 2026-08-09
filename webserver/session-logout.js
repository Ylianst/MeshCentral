/**
* @description Web session logout handling
* @license Apache-2.0
*/

'use strict';

module.exports.createSessionLogout = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const clearDestroyedSessions = options.clearDestroyedSessions;
    const now = options.now || Date.now;

    return function handleLogoutRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.auth == 'sspi') { parent.debug('web', 'handleLogoutRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }

        if (domain.userrequiredhttpheader && (typeof domain.userrequiredhttpheader == 'object')) { var ok = false; for (var i in req.headers) { if (domain.userrequiredhttpheader[i.toLowerCase()] == req.headers[i]) { ok = true; } } if (ok == false) { res.sendStatus(404); return; } }

        res.set({ 'Cache-Control': 'no-store' });
        var userid = req.session.userid;
        if (req.session.userid) {
            var user = state.users[req.session.userid];
            if (user != null) {
                parent.authLog('https', 'User ' + user.name + ' logout from ' + req.clientIp + ' port ' + req.connection.remotePort, { sessionid: req.session.x, useragent: req.headers['user-agent'] });
                parent.DispatchEvent(['*'], state, { etype: 'user', userid: user._id, username: user.name, action: 'logout', msgid: 2, msg: 'Account logout', domain: domain.id });
            }
            if (req.session.x) { clearDestroyedSessions(); state.destroyedSessions[req.session.userid + '/' + req.session.x] = now(); }
        }
        req.session = null;
        parent.debug('web', 'handleLogoutRequest: success.');

        if ((userid != null) && (domain.authstrategies?.authStrategyFlags != null)) {
            let logouturl = null;
            let userStrategy = ((userid.split('/')[2]).split(':')[0]).substring(1);
            if (userStrategy == 'oidc' && domain.authstrategies.oidc != null) {
                if (typeof domain.authstrategies.oidc.logouturl == 'string') {
                    logouturl = domain.authstrategies.oidc.logouturl;
                } else if (typeof domain.authstrategies.oidc.issuer.end_session_endpoint == 'string' && typeof domain.authstrategies.oidc.client.post_logout_redirect_uri == 'string') {
                    logouturl = domain.authstrategies.oidc.issuer.end_session_endpoint + (domain.authstrategies.oidc.issuer.end_session_endpoint.indexOf('?') == -1 ? '?' : '&') + 'post_logout_redirect_uri=' + domain.authstrategies.oidc.client.post_logout_redirect_uri;
                } else if (typeof domain.authstrategies.oidc.issuer.end_session_endpoint == 'string') {
                    logouturl = domain.authstrategies.oidc.issuer.end_session_endpoint;
                }
            } else if ((domain.authstrategies[userStrategy] != null) && (typeof domain.authstrategies[userStrategy].logouturl == 'string')) { logouturl = domain.authstrategies[userStrategy].logouturl; }
            if (logouturl != null) {
                parent.authLog('handleLogoutRequest', userStrategy.toUpperCase() + ': LOGOUT: ' + logouturl);
                res.redirect(logouturl);
                return;
            }
        }

        if (req.query.key != null) { res.redirect(domain.url + 'login?key=' + encodeURIComponent(req.query.key)); } else { res.redirect(domain.url + 'login'); }
    };
};
