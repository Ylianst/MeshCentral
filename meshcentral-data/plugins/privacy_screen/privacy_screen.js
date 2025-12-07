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
        // ********* BACKEND / SERVER-SIDE РЕАЛІЗАЦІЯ *********
        //
        obj.sendPrivacyCommand = function (args, rights, session, user) {
            if (!args || !args.nodeid) return;

            var nodeid = args.nodeid;
            var state = args.on ? 1 : 0;

            console.log('privacy_screen (server) sendPrivacyCommand', nodeid, state);

            // На бекенді parent = pluginHandler, а meshServer = parent.parent
            var meshServer = obj.parent && obj.parent.parent;

            if (meshServer && typeof meshServer.sendAgentCommand === 'function') {
                meshServer.sendAgentCommand(nodeid, {
                    type: 'privacyscreen',
                    state: state
                });
            } else {
                console.log('privacy_screen: meshServer.sendAgentCommand not available');
            }
        };

        obj.server_startup = function () {
            console.log('privacy_screen plugin: server_startup');
        };

    } else {
        //
        // ********* WEB UI / BROWSER РЕАЛІЗАЦІЯ *********
        //
        // Ця функція викликається в браузері, але сама нічого на агент не шле,
        // а просто пробиває RPC на сервер (action: 'plugin').
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
