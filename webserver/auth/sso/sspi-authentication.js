/**
* @description Windows SSPI web authentication and account provisioning
* @license Apache-2.0
*/

'use strict';

module.exports.createSspiAuthentication = function (options) {
    const state = options.state;
    const parent = options.parent;
    const database = options.database;
    const setSessionRandom = options.setSessionRandom;
    const now = options.now || Date.now;

    return function authenticateSspi(request, response, domain) {
        if ((request.connection.user == null) || (request.connection.userSid == null)) {
            parent.debug('web', 'handleRootRequestEx: SSPI no user auth.');
            response.sendStatus(404);
            return false;
        }

        request.session.userid = 'user/' + domain.id + '/' + request.connection.user.toLowerCase();
        request.session.usersid = request.connection.userSid;
        request.session.usersGroups = request.connection.userGroups;
        delete request.session.currentNode;
        request.session.ip = request.clientIp;
        setSessionRandom(request);
        parent.authLog('https', 'Accepted SSPI-auth for ' + request.connection.user + ' from ' + request.clientIp + ' port ' + request.connection.remotePort, { useragent: request.headers['user-agent'], sessionid: request.session.x });

        const existingUser = state.users[request.session.userid];
        if ((existingUser != null) && (existingUser.sid == request.session.usersid)) { return true; }

        var userCount = 0;
        const timestamp = Math.floor(now() / 1000);
        const user = { type: 'user', _id: request.session.userid, name: request.connection.user, domain: domain.id, sid: request.session.usersid, creation: timestamp, login: timestamp, access: timestamp };
        if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
        if (state.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
        for (var userId in state.users) { if (state.users[userId].domain == domain.id) { userCount++; } }
        if (userCount == 0) { user.siteadmin = 4294967295; }

        if (typeof domain.newaccountsusergroups == 'object') {
            for (var index in domain.newaccountsusergroups) {
                var userGroupId = domain.newaccountsusergroups[index];
                if (userGroupId.indexOf('/') < 0) { userGroupId = 'ugrp/' + domain.id + '/' + userGroupId; }
                const userGroup = state.userGroups[userGroupId];
                if (userGroup != null) {
                    if (user.links == null) { user.links = {}; }
                    user.links[userGroup._id] = { rights: 1 };
                    userGroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                    database.Set(userGroup);

                    const groupEvent = { etype: 'ugrp', ugrpid: userGroup._id, name: userGroup.name, desc: userGroup.desc, action: 'usergroupchange', links: userGroup.links, msg: 'Added user ' + user.name + ' to user group ' + userGroup.name, addUserDomain: domain.id };
                    if (database.changeStream) { groupEvent.noact = 1; }
                    parent.DispatchEvent(['*', userGroup._id, user._id], state, groupEvent);
                }
            }
        }

        state.users[request.session.userid] = user;
        database.SetUser(user);
        const event = { etype: 'user', userid: request.session.userid, username: request.connection.user, account: state.CloneSafeUser(user), action: 'accountcreate', msg: 'Domain account created, user ' + request.connection.user, domain: domain.id };
        if (database.changeStream) { event.noact = 1; }
        parent.DispatchEvent(['*', 'server-users'], state, event);
        parent.debug('web', 'handleRootRequestEx: SSPI new domain user.');
        return true;
    };
};
