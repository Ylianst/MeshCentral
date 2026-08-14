/**
* @description Synchronization of LDAP and SSO memberships with MeshCentral user groups
* @license Apache-2.0
*/

'use strict';

module.exports.createExternalGroups = function (options) {
    const crypto = options.crypto;
    const userGroups = options.userGroups;
    const db = options.db;
    const dispatchEvent = options.dispatchEvent;
    const authLog = options.authLog;
    const cloneSafeUser = options.cloneSafeUser;
    const eventSource = options.eventSource;

    function syncExternalUserGroups(domain, user, userMemberships, userMembershipType) {
        var userChanged = false;
        if (user.links == null) user.links = {};

        var existingUserMemberships = {};
        for (var id in user.links) {
            if (id.startsWith('ugrp/') && (userGroups[id] != null) && (userGroups[id].membershipType == userMembershipType)) existingUserMemberships[id] = userGroups[id];
        }

        for (var i in userMemberships) {
            const membership = userMemberships[i];
            const userGroupId = 'ugrp/' + domain.id + '/' + crypto.createHash('sha384').update(membership).digest('base64').replace(/\+/g, '@').replace(/\//g, '$');
            var userGroup = userGroups[userGroupId];
            if (userGroup == null) {
                userGroup = { type: 'ugrp', _id: userGroupId, name: membership, domain: domain.id, membershipType: userMembershipType, links: {} };
                db.Set(userGroup);
                if (db.changeStream == false) userGroups[userGroupId] = userGroup;
                const createEvent = { etype: 'ugrp', ugrpid: userGroupId, name: userGroup.name, action: 'createusergroup', links: userGroup.links, msgid: 69, msgArgv: [userGroup.name], msg: 'User group created: ' + userGroup.name, ugrpdomain: domain.id };
                dispatchEvent(['*', userGroupId, user._id], eventSource, createEvent);
                authLog('https', userMembershipType.toUpperCase() + ': Created user group ' + userGroup.name);
            }

            if (existingUserMemberships[userGroupId] == null) {
                if (user.links == null) user.links = {};
                user.links[userGroup._id] = { rights: 1 };
                userChanged = true;
                db.SetUser(user);
                dispatchEvent([user._id], eventSource, 'resubscribe');

                const userTargets = ['*', 'server-users', user._id];
                const userEvent = { etype: 'user', userid: user._id, username: user.name, account: cloneSafeUser(user), action: 'accountchange', msgid: 67, msgArgs: [user.name], msg: 'User group membership changed: ' + user.name, domain: domain.id };
                if (db.changeStream) userEvent.noact = 1;
                dispatchEvent(userTargets, eventSource, userEvent);

                userGroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                db.Set(userGroup);
                const groupEvent = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: userGroup._id, name: userGroup.name, desc: userGroup.desc, action: 'usergroupchange', links: userGroup.links, msgid: 71, msgArgs: [user.name, userGroup.name], msg: 'Added user(s) ' + user.name + ' to user group ' + userGroup.name, addUserDomain: domain.id };
                if (db.changeStream) groupEvent.noact = 1;
                dispatchEvent(['*', userGroup._id, user._id], eventSource, groupEvent);
                authLog('https', userMembershipType.toUpperCase() + ': Adding ' + user.name + ' to user group ' + membership + '.');
            } else {
                delete existingUserMemberships[userGroupId];
            }
        }

        for (var existingId in existingUserMemberships) {
            const existingGroup = userGroups[existingId];
            authLog('https', userMembershipType.toUpperCase() + ': Removing ' + user.name + ' from user group ' + existingGroup.name + '.');
            if ((user.links != null) && (user.links[existingId] != null)) {
                delete user.links[existingId];
                const userTargets = ['*', 'server-users', user._id, user._id];
                const userEvent = { etype: 'user', userid: user._id, username: user.name, account: cloneSafeUser(user), action: 'accountchange', msgid: 67, msgArgs: [user.name], msg: 'User group membership changed: ' + user.name, domain: domain.id };
                if (db.changeStream) userEvent.noact = 1;
                dispatchEvent(userTargets, eventSource, userEvent);
                db.SetUser(user);
                dispatchEvent([user._id], eventSource, 'resubscribe');
            }

            if ((existingGroup != null) && (existingGroup.links != null) && (existingGroup.links[user._id] != null)) {
                delete existingGroup.links[user._id];
                db.Set(existingGroup);
                const groupEvent = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: existingGroup._id, name: existingGroup.name, desc: existingGroup.desc, action: 'usergroupchange', links: existingGroup.links, msgid: 72, msgArgs: [user.name, existingGroup.name], msg: 'Removed user ' + user.name + ' from user group ' + existingGroup.name, domain: domain.id };
                if (db.changeStream) groupEvent.noact = 1;
                dispatchEvent(['*', existingGroup._id, user._id], eventSource, groupEvent);
            }
        }

        return userChanged;
    }

    return { syncExternalUserGroups: syncExternalUserGroups };
};
