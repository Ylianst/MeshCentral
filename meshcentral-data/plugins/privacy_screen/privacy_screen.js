// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent; // pluginHandler

    //
    // Викликається MeshCentral-ом при { action: 'plugin', plugin: 'privacy_screen', ... }
    //
    // createMeshUser робить:
    //   pluginHandler.plugins[command.plugin].serveraction(command, obj, parent);
    //
    // де:
    //   command – це те, що прилетіло з браузера (action, plugin, pluginaction, args)
    //   obj     – об'єкт юзерської сесії / ws-обгортка
    //   parent  – "верхній" об'єкт (webserver/meshserver)
    //
    obj.serveraction = function (command, wsObj, parentFromUser) {
        try {
            if (command.pluginaction === 'sendPrivacyCommand') {
                obj.sendPrivacyCommand(command.args, parentFromUser);
            } else {
                console.log('privacy_screen(serveraction): unknown pluginaction =', command.pluginaction);
            }
        } catch (e) {
            console.log('privacy_screen(serveraction) error:', e);
        }
    };

    //
    // Реальна логіка: надіслати команду на агент
    //
    obj.sendPrivacyCommand = function (args, rootParent) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, state);

        // Пошук sendAgentCommand, стартуючи з rootParent (третій аргумент serveraction)
        var sendAgentCommand = findSendAgentCommand(rootParent);
        if (!sendAgentCommand) {
            // fallback – спробувати з самого pluginHandler, про всяк випадок
            sendAgentCommand = findSendAgentCommand(obj.parent);
        }

        if (!sendAgentCommand) {
            console.log('privacy_screen(server): sendAgentCommand not found in parent chain (rootParent + pluginHandler)');
            return;
        }

        try {
            sendAgentCommand(nodeid, {
                type: 'privacyscreen',
                state: state
            });
        } catch (e) {
            console.log('privacy_screen(server): error calling sendAgentCommand', e);
        }
    };

    function findSendAgentCommand(start) {
        var p = start;
        var depth = 0;

        while (p && depth < 6) {
            try {
                // Для дебагу подивимось, що це за об'єкт
                try {
                    console.log('privacy_screen(server): depth', depth, 'keys:', Object.keys(p));
                } catch (e) { }

                if (typeof p.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using p.sendAgentCommand at depth', depth);
                    return p.sendAgentCommand.bind(p);
                }
                if (p.webserver && typeof p.webserver.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using p.webserver.sendAgentCommand at depth', depth);
                    return p.webserver.sendAgentCommand.bind(p.webserver);
                }
            } catch (e) {
                console.log('privacy_screen(server): error scanning at depth', depth, e);
            }

            p = p.parent;
            depth++;
        }

        return null;
    }

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    return obj;
};
