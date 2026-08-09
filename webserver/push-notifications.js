/**
* @description Web push delivery and Android push-token ownership management
* @license Apache-2.0
*/

'use strict';

module.exports.isValidFirebaseRelayData = function (data) {
    if ((data == null) || (typeof data != 'object')) return false;
    if (typeof data.pmt != 'string') return false;
    if ((data.payload == null) || (typeof data.payload != 'object')) return false;
    if ((data.payload.notification == null) || (typeof data.payload.notification != 'object')) return false;
    if (typeof data.payload.notification.title != 'string') return false;
    if (typeof data.payload.notification.body != 'string') return false;
    if ((data.options == null) || (typeof data.options != 'object')) return false;
    if ((data.options.priority != 'Normal') && (data.options.priority != 'High')) return false;
    if ((typeof data.options.timeToLive != 'number') || (data.options.timeToLive < 1)) return false;
    return true;
};

module.exports.createPushNotifications = function (options) {
    const db = options.db;
    const getWebPush = options.getWebPush;
    const dispatchEvent = options.dispatchEvent;
    const cloneSafeUser = options.cloneSafeUser;
    const cloneSafeNode = options.cloneSafeNode;
    const eventSource = options.eventSource;
    const now = options.now || Date.now;

    function performWebPush(domain, user, payload, pushOptions) {
        const webpush = getWebPush();
        if ((webpush == null) || (Array.isArray(user.webpush) == false) || (user.webpush.length == 0)) return;

        const completion = function (subscription, failed) {
            completion.failCount += failed;
            if (--completion.pushCount == 0 && completion.failCount > 0) {
                const activeSubscriptions = [];
                for (var i in user.webpush) { if (user.webpush[i].fail == null) activeSubscriptions.push(user.webpush[i]); }
                user.webpush = activeSubscriptions;
                db.SetUser(user);
                const message = { etype: 'user', userid: user._id, username: user.name, account: cloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
                if (db.changeStream) message.noact = 1;
                const targets = ['*', 'server-users', user._id];
                if (user.groups) { for (var groupId in user.groups) targets.push('server-users:' + groupId); }
                dispatchEvent(targets, eventSource, message);
            }
        };
        completion.pushCount = user.webpush.length;
        completion.failCount = 0;

        for (var i in user.webpush) {
            const subscription = user.webpush[i];
            webpush.sendNotification(subscription, JSON.stringify(payload), pushOptions).then(function () {
                completion(subscription, 0);
            }, function () {
                subscription.fail = 1;
                completion(subscription, 1);
            });
        }
    }

    function removePmtFromAllOtherNodes(node) {
        if (typeof node.pmt != 'string') return;
        db.Get('pmt_' + node.pmt, function (err, docs) {
            if ((err == null) && (docs.length == 1)) {
                const oldNodeId = docs[0].nodeid;
                db.Get(oldNodeId, function (nodeError, nodes) {
                    if ((nodeError == null) && (nodes.length == 1)) {
                        const oldNode = nodes[0];
                        if (oldNode.pmt == node.pmt) {
                            delete oldNode.pmt;
                            db.Set(oldNode);
                            const event = { etype: 'node', action: 'changenode', nodeid: oldNode._id, domain: oldNode.domain, node: cloneSafeNode(oldNode) };
                            if (db.changeStream) event.noact = 1;
                            dispatchEvent(['*', oldNode.meshid, oldNode._id], eventSource, event);
                        }
                    }
                });
            }
            db.Set({ _id: 'pmt_' + node.pmt, type: 'pmt', domain: node.domain, time: now(), nodeid: node._id });
        });
    }

    return { performWebPush: performWebPush, removePmtFromAllOtherNodes: removePmtFromAllOtherNodes };
};
