// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;          // pluginHandler
    obj.exports = [];             // нічого не експортуємо в UI через pluginHandler

    //
    // 1) Загальний handler для WebSocket-команд action: "plugin"
    //
    // webserver при отриманні { action: 'plugin', plugin: 'privacy_screen', ... }
    // робить приблизно:
    //   parent.parent.pluginHandler.plugins[command.plugin].serveraction(command, ...)
    //
    obj.serveraction = function (command, ws, req, user, domain, rights, session) {
        try {
            // Очікуємо, що з UI прийде:
            // { action:'plugin', plugin:'privacy_screen', pluginaction:'sendPrivacyCommand', args:{...} }
            if (command.pluginaction === 'sendPrivacyCommand') {
                obj.sendPrivacyCommand(command.args, rights, session, user);
            } else {
                console.log('privacy_screen(serveraction): unknown pluginaction =', command.pluginaction);
            }
        } catch (e) {
            console.log('privacy_screen(serveraction) error:', e);
        }
    };

    //
    // 2) Реальна логіка – надіслати команду агенту
    //
    obj.sendPrivacyCommand = function (args, rights, session, user) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, state);

        // Пошук функції sendAgentCommand вгору по parent-ланцюжку
        var p = obj.parent;
        var depth = 0;
        var sendAgentCommand = null;

        while (p && depth < 6 && !sendAgentCommand) {
            try {
                if (typeof p.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using parent.sendAgentCommand at depth', depth);
                    sendAgentCommand = p.sendAgentCommand.bind(p);
                    break;
                }
                if (p.webserver && typeof p.webserver.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using parent.webserver.sendAgentCommand at depth', depth);
                    sendAgentCommand = p.webserver.sendAgentCommand.bind(p.webserver);
                    break;
                }
            } catch (e) {
                console.log('privacy_screen(server): error scanning parent at depth', depth, e);
            }
            p = p.parent;
            depth++;
        }

        if (!sendAgentCommand) {
            console.log('privacy_screen(server): sendAgentCommand not found in parent chain');
            return;
        }

        try {
            // Відправляємо пакет агенту
            sendAgentCommand(nodeid, {
                type: 'privacyscreen',
                state: state
            });
        } catch (e) {
            console.log('privacy_screen(server): error calling sendAgentCommand', e);
        }
    };

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    return obj;
};
