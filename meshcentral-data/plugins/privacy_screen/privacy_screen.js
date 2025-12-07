// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Функція, доступна з Web-UI як pluginHandler.privacy_screen.sendPrivacyCommand(...)
    obj.exports = ['sendPrivacyCommand'];

    // Надійний спосіб визначити браузер
    var isBrowser = (typeof window !== 'undefined' && typeof window.document !== 'undefined');

    if (isBrowser) {
        // ********* WEB UI / BROWSER *********
        obj.sendPrivacyCommand = function (args) {
            try {
                if (typeof meshserver !== 'undefined') {
                    meshserver.send({
                        action: 'plugin',
                        plugin: 'privacy_screen',
                        pluginaction: 'sendPrivacyCommand',
                        args: args
                    });
                } else {
                    console.log('privacy_screen(UI): meshserver global not available', args);
                }
            } catch (e) {
                console.log('privacy_screen(UI): sendPrivacyCommand error', e);
            }
        };

    } else {
        // ********* BACKEND / SERVER-SIDE (Node.js) *********

        // Пошук об'єкта з sendAgentCommand, піднімаючись по parent-ланцюжку
        function findSendAgentCommand(start) {
            var p = start;
            var depth = 0;

            while (p && depth < 5) {
                try {
                    if (typeof p.sendAgentCommand === 'function') {
                        console.log('privacy_screen(server): using p.sendAgentCommand at depth', depth);
                        return p.sendAgentCommand.bind(p);
                    }
                    if (p.webserver && typeof p.webserver.sendAgentCommand === 'function') {
                        console.log('privacy_screen(server): using p.webserver.sendAgentCommand at depth', depth);
                        return p.webserver.sendAgentCommand.bind(p.webserver);
                    }
                } catch (e) {
                    console.log('privacy_screen(server): error scanning parent chain at depth', depth, e);
                }

                p = p.parent;
                depth++;
            }

            console.log('privacy_screen(server): sendAgentCommand NOT found in parent chain');
            return null;
        }

        var sendAgentCommand = null;

        obj.sendPrivacyCommand = function (args, rights, session, user) {
            if (!args || !args.nodeid) return;

            var nodeid = args.nodeid;
            var state = args.on ? 1 : 0;

            console.log('privacy_screen (server) sendPrivacyCommand', nodeid, state);

            // Ініціалізуємо один раз, при першому виклику
            if (!sendAgentCommand) {
                sendAgentCommand = findSendAgentCommand(obj.parent);
            }
            if (!sendAgentCommand) {
                console.log('privacy_screen(server): cannot send command, sendAgentCommand is null');
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

        obj.server_startup = function () {
            console.log('privacy_screen plugin: server_startup');
        };
    }

    return obj;
};
