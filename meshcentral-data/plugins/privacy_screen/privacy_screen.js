// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Функція, доступна з браузера: pluginHandler.privacy_screen.sendPrivacyCommand(...)
    obj.exports = ['sendPrivacyCommand'];

    // Детектуємо, де ми запущені: на сервері (Node.js) чи в браузері
    var isNode = (typeof process !== 'undefined') &&
        process.versions && process.versions.node;

    if (isNode) {
        //
        // ********* BACKEND / SERVER-SIDE *********
        //
        obj.sendPrivacyCommand = function (args, rights, session, user) {
            if (!args || !args.nodeid) return;

            var nodeid = args.nodeid;
            var state = args.on ? 1 : 0;

            console.log('privacy_screen (server) sendPrivacyCommand', nodeid, state);

            // parent = pluginHandler, parent.parent = meshServer
            var meshServer = obj.parent && obj.parent.parent;
            var webserver = meshServer && meshServer.webserver;

            if (webserver && typeof webserver.sendAgentCommand === 'function') {
                webserver.sendAgentCommand(nodeid, {
                    type: 'privacyscreen',
                    state: state
                });
            } else if (meshServer && typeof meshServer.sendAgentCommand === 'function') {
                // запасний варіант, якщо твоя версія все ж має цей метод на meshServer
                meshServer.sendAgentCommand(nodeid, {
                    type: 'privacyscreen',
                    state: state
                });
            } else {
                // Лог для дебагу, якщо API відрізняється
                try {
                    console.log('privacy_screen: sendAgentCommand not available, meshServer keys:',
                        meshServer ? Object.keys(meshServer) : 'no meshServer');
                } catch (e) {
                    console.log('privacy_screen: sendAgentCommand not available, error inspecting meshServer:', e);
                }
            }
        };

        obj.server_startup = function () {
            console.log('privacy_screen plugin: server_startup');
        };

    } else {
        //
        // ********* WEB UI / BROWSER *********
        //
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
                    console.log('privacy_screen: meshserver global not available in UI', args);
                }
            } catch (e) {
                console.log('privacy_screen UI sendPrivacyCommand error', e);
            }
        };
    }

    return obj;
};
