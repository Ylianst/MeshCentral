/**
* @description Failed login auditing and delayed responses
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginFailureHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const schedule = options.schedule || setTimeout;

    return function handleLoginFailure(req, res, domain, username, error, passhint, direct) {
        state.parent.authLog('https', 'Failed password for ' + username + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'] });
        schedule(function () {
            if (typeof username == 'string') {
                const userid = 'user/' + domain.id + '/' + username.toLowerCase();
                const ua = state.getUserAgentInfo(req);
                if (error == 'locked') {
                    parent.debug('web', 'handleLoginRequest: login failed, locked account');
                    req.session.messageid = 110;
                    state.parent.DispatchEvent(['*', 'server-users', userid], state, { action: 'authfail', userid: userid, username: username, domain: domain.id, msg: 'User login attempt on locked account from ' + req.clientIp, msgid: 109, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                } else if (error == 'denied') {
                    parent.debug('web', 'handleLoginRequest: login failed, access denied');
                    req.session.messageid = 111;
                    state.parent.DispatchEvent(['*', 'server-users', userid], state, { action: 'authfail', userid: userid, username: username, domain: domain.id, msg: 'Denied user login from ' + req.clientIp, msgid: 155, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                } else {
                    parent.debug('web', 'handleLoginRequest: login failed, bad username and password');
                    req.session.messageid = 112;
                    state.parent.DispatchEvent(['*', 'server-users', userid], state, { action: 'authfail', userid: userid, username: username, domain: domain.id, msg: 'Invalid user login attempt from ' + req.clientIp, msgid: 110, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                }
                state.setbadLogin(req);
            }
            delete req.session.loginmode;
            if ((passhint != null) && (passhint.length > 0)) { req.session.passhint = passhint; } else { delete req.session.passhint; }
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        }, 2000 + (state.crypto.randomBytes(2).readUInt16BE(0) % 4095));
    };
};
