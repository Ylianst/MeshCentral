// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent; // це pluginHandler

    // ЦЮ функцію буде викликати СЕРВЕР,
    // коли з браузера прийде action: 'plugin', plugin: 'privacy_screen', pluginaction: 'sendPrivacyCommand'
    obj.sendPrivacyCommand = function (args, rights, session, user) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen (server) sendPrivacyCommand', nodeid, state);

        // шукаємо sendAgentCommand вгору по parent-ланцюжку
        var p = obj.parent;
        var depth = 0;
        var fn = null;

        while (p && depth < 5 && !fn) {
            try {
                if (typeof p.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using parent.sendAgentCommand at depth', depth);
                    fn = p.sendAgentCommand.bind(p);
                    break;
                }
                if (p.webserver && typeof p.webserver.sendAgentCommand === 'function') {
                    console.log('privacy_screen(server): using parent.webserver.sendAgentCommand at depth', depth);
                    fn = p.webserver.sendAgentCommand.bind(p.webserver);
                    break;
                }
            } catch (e) {
                console.log('privacy_screen(server): error while scanning parent at depth', depth, e);
            }
            p = p.parent;
            depth++;
        }

        if (!fn) {
            console.log('privacy_screen(server): sendAgentCommand not found in parent chain');
            return;
        }

        try {
            fn(nodeid, { type: 'privacyscreen', state: state });
        } catch (e) {
            console.log('privacy_screen(server): error calling sendAgentCommand', e);
        }
    };

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    return obj;
};
