/**
* @description Event subscription targets for connected web users
* @license Apache-2.0
*/

'use strict';

module.exports.createSubscriptions = function (options) {
    const users = options.users;
    const removeAllEventDispatch = options.removeAllEventDispatch;
    const addEventDispatch = options.addEventDispatch;

    function subscribe(userId, target) {
        const user = users[userId];
        if (user == null) return;
        const subscriptions = [userId, 'server-allusers'];
        if (user.siteadmin != null) {
            if ((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 2048) != 0)) {
                subscriptions.push('*');
            } else if ((user.siteadmin & 2) != 0) {
                if ((user.groups == null) || (user.groups.length == 0)) {
                    subscriptions.push('server-users');
                } else {
                    for (var groupId in user.groups) subscriptions.push('server-users:' + user.groups[groupId]);
                }
            }
        }
        if (user.links != null) { for (var linkId in user.links) subscriptions.push(linkId); }
        removeAllEventDispatch(target);
        addEventDispatch(subscriptions, target);
        return subscriptions;
    }

    return { subscribe: subscribe };
};
