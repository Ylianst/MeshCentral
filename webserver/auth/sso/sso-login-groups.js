/**
* @description SSO group policy evaluation for authenticated users
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoLoginGroups = function (options) {
    const common = options.common;
    const authLog = options.authLog;
    const isGroupConfiguration = options.isGroupConfiguration;
    const shouldRevokeAdmin = options.shouldRevokeAdmin;

    return function prepareSsoLoginGroups(strategy, requestUser) {
        const groups = { enabled: isGroupConfiguration(strategy.groups) };
        if (!groups.enabled) { return groups; }

        groups.userMemberships = common.convertStrArray(requestUser.groups);
        groups.syncEnabled = (strategy.groups.sync === true || strategy.groups.sync?.filter) ? true : false;
        groups.syncMemberships = [];
        groups.siteAdminEnabled = strategy.groups.siteadmin ? true : false;
        groups.grantAdmin = false;
        groups.revokeAdmin = shouldRevokeAdmin(strategy.groups);
        groups.requiredGroups = common.convertStrArray(strategy.groups.required);
        groups.siteAdmin = common.convertStrArray(strategy.groups.siteadmin);
        groups.syncFilter = common.convertStrArray(strategy.groups.sync?.filter);

        let groupMessage = '';
        if (groups.userMemberships.length == 1) { groupMessage = ` Found membership: "${groups.userMemberships[0]}"`; }
        else { groupMessage = ` Found ${groups.userMemberships.length} memberships: ["${groups.userMemberships.join('", "')}"]`; }
        authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}"` + groupMessage);

        if (groups.requiredGroups.length > 0) {
            let match = false;
            for (var i in groups.requiredGroups) {
                if (groups.userMemberships.indexOf(groups.requiredGroups[i]) != -1) {
                    match = true;
                    authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" Membership to required group found: "${groups.requiredGroups[i]}"`);
                }
            }
            if (match === false) {
                authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" Login denied. No membership to required group.`);
                groups.loginDenied = true;
                return groups;
            }
        }

        if (groups.siteAdminEnabled === true) {
            for (var i in strategy.groups.siteadmin) {
                if (groups.userMemberships.indexOf(strategy.groups.siteadmin[i]) >= 0) {
                    authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" User membership found in site admin group: "${strategy.groups.siteadmin[i]}"`);
                    groups.siteAdmin = strategy.groups.siteadmin[i];
                    groups.grantAdmin = true;
                    break;
                }
            }
        }

        if (groups.syncEnabled === true) {
            if (groups.syncFilter.length > 0) {
                for (var i in groups.syncFilter) {
                    if (groups.userMemberships.indexOf(groups.syncFilter[i]) >= 0) { groups.syncMemberships.push(groups.syncFilter[i]); }
                }
            } else {
                for (var i in groups.userMemberships) { groups.syncMemberships.push(groups.userMemberships[i]); }
            }
            if (groups.syncMemberships.length > 0) {
                authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" User memberships to sync: ${groups.syncMemberships.join(', ')}`);
            } else {
                groups.syncMemberships = null;
                groups.syncEnabled = false;
                if (groups.syncFilter.length > 0) {
                    authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" No sync memberships found using filters: ${groups.syncFilter.join(', ')}`);
                } else {
                    authLog('handleStrategyLogin', `${requestUser.strategy.toUpperCase()}: GROUPS: USER: "${requestUser.sid}" No sync memberships found`);
                }
            }
        }

        return groups;
    };
};
