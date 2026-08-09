/**
* @description SSO account lifecycle operations
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoAccounts = function (options) {
    const state = options.state;
    const parent = options.parent;
    const setSessionRandom = options.setSessionRandom;

    function completeSsoLogin(req, domain, user) {
        req.session.userid = user._id;
        setSessionRandom(req);

        var targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
        const ua = state.getUserAgentInfo(req);
        const loginEvent = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login', domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'], twoFactorType: 'sso' };
        parent.DispatchEvent(targets, state, loginEvent);
    }

    return { completeSsoLogin: completeSsoLogin };
};
