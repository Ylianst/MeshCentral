/**
* @description Routing of agent commands to local and peer user sessions
* @license Apache-2.0
*/

'use strict';

module.exports.createAgentRouting = function (options) {
    const state = options.state;
    const getNodeRights = options.getNodeRights;
    const getMultiServer = options.getMultiServer;

    function routeAgentCommand(command, domainId, nodeId, meshId) {
        if (command.sessionid != null) {
            if (typeof command.sessionid != 'string') return;
            const sessionParts = command.sessionid.split('/');
            if ((sessionParts.length == 4) && (sessionParts[0] == 'user') && (sessionParts[1] == domainId)) {
                if (getNodeRights(sessionParts[0] + '/' + sessionParts[1] + '/' + sessionParts[2], meshId, nodeId) == 0) return;
                const ws = state.wssessions2[command.sessionid];
                if (ws != null) {
                    command.nodeid = nodeId;
                    delete command.sessionid;
                    try { ws.send(JSON.stringify(command)); } catch (ex) { }
                } else {
                    const multiServer = getMultiServer();
                    if (multiServer != null) {
                        const serverId = state.wsPeerSessions2[command.sessionid];
                        if (serverId != null) {
                            command.fromNodeid = nodeId;
                            multiServer.DispatchMessageSingleServer(command, serverId);
                        }
                    }
                }
            }
            return;
        }

        if (command.userid != null) {
            if (typeof command.userid != 'string') return;
            const userParts = command.userid.split('/');
            if ((userParts[0] == 'user') && (userParts[1] == domainId)) {
                if (getNodeRights(command.userid, meshId, nodeId) == 0) return;
                const sessions = state.wssessions[command.userid];
                if (sessions != null) {
                    command.nodeid = nodeId;
                    delete command.userid;
                    for (var i in sessions) sessions[i].send(JSON.stringify(command));
                }
            }
            return;
        }

        command.nodeid = nodeId;
        const commandString = JSON.stringify(command);
        for (var userId in state.wssessions) {
            const sessions = state.wssessions[userId];
            if (getNodeRights(userId, meshId, nodeId) != 0) {
                for (var j in sessions) { try { sessions[j].send(commandString); } catch (e) { } }
            }
        }

        const multiServer = getMultiServer();
        if (multiServer != null) {
            delete command.nodeid;
            command.fromNodeid = nodeId;
            command.meshid = meshId;
            multiServer.DispatchMessage(command);
        }
    }

    return { routeAgentCommand: routeAgentCommand };
};
