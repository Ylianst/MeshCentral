/**
* @description SSO account lifecycle operations
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoAccounts = function (options) {
    const state = options.state;
    const parent = options.parent;
    const common = options.common;
    const setSessionRandom = options.setSessionRandom;
    const syncExternalUserGroups = options.syncExternalUserGroups;
    const isEmailVerified = options.isEmailVerified;
    const now = options.now || Date.now;

    function getNewAccountSettings(domain, strategy) {
        const settings = { allowed: false, realms: null, rights: domain.newaccountsrights, userGroups: null };
        if (domain.newaccounts === true) { settings.allowed = true; }
        if (common.validateStrArray(domain.newaccountrealms)) { settings.realms = domain.newaccountrealms; }
        if (typeof domain.newaccountsusergroups == 'object') { settings.userGroups = domain.newaccountsusergroups; }
        if (strategy != null) {
            if (strategy.newaccounts === true) { settings.allowed = true; }
            if (common.validateStrArray(strategy.newaccountrealms)) { settings.realms = strategy.newaccountrealms; }
            if (strategy.newaccountsrights) { settings.rights = common.meshServerRightsArrayToNumber(strategy.newaccountsrights); }
            if (typeof strategy.newaccountsusergroups == 'object') { settings.userGroups = strategy.newaccountsusergroups; }
        }
        return settings;
    }

    function createAccount(domain, strategy, requestUser, groups, settings) {
        const userid = 'user/' + domain.id + '/' + requestUser.sid;
        parent.authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: USER: "${requestUser.sid}" Creating new login user: "${userid}"`);
        const timestamp = Math.floor(now() / 1000);
        const user = { type: 'user', _id: userid, name: requestUser.name, email: requestUser.email, creation: timestamp, login: timestamp, access: timestamp, domain: domain.id };
        if (requestUser.email != null) { user.email = requestUser.email; user.emailVerified = isEmailVerified(requestUser); }
        if (settings.rights) { user.siteadmin = settings.rights; }
        if (settings.realms) { user.groups = settings.realms; }
        state.users[userid] = user;

        if (settings.userGroups) {
            for (var i in settings.userGroups) {
                var ugrpid = settings.userGroups[i];
                if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                var ugroup = state.userGroups[ugrpid];
                if (ugroup != null) {
                    if (user.links == null) { user.links = {}; }
                    user.links[ugroup._id] = { rights: 1 };
                    ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                    state.db.Set(ugroup);
                    var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                    if (state.db.changeStream) { event.noact = 1; }
                    parent.DispatchEvent(['*', ugroup._id, user._id], state, event);
                }
            }
        }

        if (groups.enabled === true) {
            if (groups.syncEnabled === true) {
                const groupType = strategy.custom?.preset ? strategy.custom.preset : requestUser.strategy;
                syncExternalUserGroups(domain, user, groups.syncMemberships, groupType);
            }
            if (groups.grantAdmin === true) {
                parent.authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" Granting site admin privilages`);
                user.siteadmin = 0xFFFFFFFF;
            }
        }

        state.db.SetUser(user);
        var targets = ['*', 'server-users'];
        var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, username is ' + user.name, domain: domain.id };
        if (state.db.changeStream) { event.noact = 1; }
        parent.DispatchEvent(targets, state, event);
        return user;
    }

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

    return { getNewAccountSettings: getNewAccountSettings, createAccount: createAccount, updateExistingAccount: updateExistingAccount, completeSsoLogin: completeSsoLogin };
};
