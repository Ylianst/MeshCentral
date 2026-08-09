/**
* @description SSO account lifecycle operations
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoAccounts = function (options) {
    const state = options.state;
    const parent = options.parent;
    const setSessionRandom = options.setSessionRandom;
    const syncExternalUserGroups = options.syncExternalUserGroups;
    const isEmailVerified = options.isEmailVerified;

    function updateExistingAccount(domain, user, requestUser, groups) {
        var userChanged = false;
        if ((requestUser.name != null) && (requestUser.name != user.name)) { user.name = requestUser.name; userChanged = true; }
        if ((requestUser.email != null) && (requestUser.email != user.email)) { user.email = requestUser.email; user.emailVerified = isEmailVerified(requestUser); userChanged = true; }

        if (groups.enabled === true) {
            if (groups.syncEnabled === true) { syncExternalUserGroups(domain, user, groups.syncMemberships, requestUser.strategy); }
            if (groups.siteAdminEnabled === true) {
                if (groups.grantAdmin === true) {
                    parent.authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" Granting site admin privilages`);
                    if (user.siteadmin !== 0xFFFFFFFF) { user.siteadmin = 0xFFFFFFFF; userChanged = true; }
                } else if ((groups.revokeAdmin === true) && (user.siteadmin === 0xFFFFFFFF)) {
                    parent.authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" Revoking site admin privilages.`);
                    delete user.siteadmin;
                    userChanged = true;
                }
            }
        }

        if (userChanged) {
            parent.authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: CHANGED: USER: "${requestUser.sid}" Updating user database entry`);
            state.db.SetUser(user);
            var targets = ['*', 'server-users'];
            var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', msg: 'Account changed', domain: domain.id };
            if (state.db.changeStream) { event.noact = 1; }
            parent.DispatchEvent(targets, state, event);
        }
        return userChanged;
    }

    function completeSsoLogin(req, domain, user) {
        req.session.userid = user._id;
        setSessionRandom(req);

        var targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
        const ua = state.getUserAgentInfo(req);
        const loginEvent = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login', domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'], twoFactorType: 'sso' };
        parent.DispatchEvent(targets, state, loginEvent);
    }

    return { updateExistingAccount: updateExistingAccount, completeSsoLogin: completeSsoLogin };
};
