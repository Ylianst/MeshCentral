/**
* @description Connected user-session counting across local and peer servers
* @license Apache-2.0
*/

'use strict';

module.exports.createSessionCounts = function (options) {
    const state = options.state;
    const dispatchEvent = options.dispatchEvent;

    function dispatchCount(userId, count, allTargets) {
        const parts = userId.split('/');
        const user = state.users[userId];
        if (!user) return;
        const targets = ['*', 'server-users'];
        if (user.groups) { for (var groupId in user.groups) targets.push('server-users:' + groupId); }
        dispatchEvent(allTargets === true ? ['*'] : targets, state, { action: 'wssessioncount', userid: userId, username: parts[2], count: count, domain: parts[1], nolog: 1, nopeers: 1 });
    }

    function recountSessions(changedSessionId) {
        var userId, oldCount, newCount, serverId;
        if (changedSessionId == null) {
            const newSessionsCount = {};
            for (userId in state.wssessions) newSessionsCount[userId] = state.wssessions[userId].length;
            for (serverId in state.wsPeerSessions3) {
                for (userId in state.wsPeerSessions3[serverId]) {
                    const peerCount = state.wsPeerSessions3[serverId][userId].length;
                    if (newSessionsCount[userId] == null) { newSessionsCount[userId] = peerCount; } else { newSessionsCount[userId] += peerCount; }
                }
            }

            for (userId in newSessionsCount) {
                newCount = newSessionsCount[userId];
                oldCount = state.sessionsCount[userId];
                if (oldCount == null) { oldCount = 0; } else { delete state.sessionsCount[userId]; }
                if (newCount != oldCount) dispatchCount(userId, newCount, false);
            }

            for (userId in state.sessionsCount) {
                oldCount = state.sessionsCount[userId];
                if ((oldCount != null) && (oldCount != 0)) dispatchCount(userId, 0, true);
            }
            state.sessionsCount = newSessionsCount;
            return;
        }

        userId = changedSessionId.split('/').slice(0, 3).join('/');
        newCount = 0;
        if (state.wssessions[userId] != null) newCount = state.wssessions[userId].length;
        for (serverId in state.wsPeerSessions3) { if (state.wsPeerSessions3[serverId][userId] != null) newCount += state.wsPeerSessions3[serverId][userId].length; }
        oldCount = state.sessionsCount[userId];
        if (oldCount == null) oldCount = 0;
        if (newCount != oldCount) {
            if (state.users[userId]) {
                dispatchCount(userId, newCount, false);
                state.sessionsCount[userId] = newCount;
            }
        }
    }

    return { recountSessions: recountSessions };
};
