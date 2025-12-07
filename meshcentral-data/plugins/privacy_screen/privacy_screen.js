// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};

    // Визначаємо, де ми: в браузері чи на сервері
    var isBrowser = (typeof window !== 'undefined' && typeof window.document !== 'undefined');

    if (isBrowser) {
        // ************ WEB UI / БРАУЗЕР ************
        // Тут parent – це browser-side pluginHandler
        obj.parent = parent;
        obj.exports = ['sendPrivacyCommand']; // можна, але не критично

        // Цю функцію будемо викликати з кнопки в UI:
        // pluginHandler.privacy_screen.sendPrivacyCommand({ nodeid, on })
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
                    console.log('privacy_screen(UI): meshserver is not defined', args);
                }
            } catch (e) {
                console.log('privacy_screen(UI): error in sendPrivacyCommand', e);
            }
        };

        return obj;
    }

    // ************ SERVER / NODE.JS ************
    obj.parent = parent;              // server-side pluginHandler
    obj.exports = ['sendPrivacyCommand']; // просто для сумісності

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    /**
     * Викликається MeshCentral, коли з браузера приходить:
     * { action:'plugin', plugin:'privacy_screen', pluginaction:'sendPrivacyCommand', args: {...} }
     *
     * Сигнатура з боку MeshCentral:
     *   plugin.serveraction(command, ws, webserver)
     */
    obj.serveraction = function (command, ws, webserver) {
        try {
            if (!command || command.plugin !== 'privacy_screen') return;

            if (command.pluginaction === 'sendPrivacyCommand') {
                obj.sendPrivacyCommand(command.args, webserver);
            } else {
                console.log('privacy_screen(server): unknown pluginaction', command.pluginaction);
            }
        } catch (e) {
            console.log('privacy_screen(server): error in serveraction', e);
        }
    };

    // Реальна логіка "сервер -> агент"
    obj.sendPrivacyCommand = function (args, webserver) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, state);

        if (!webserver || !webserver.wsagents) {
            console.log('privacy_screen(server): webserver or webserver.wsagents not available');
            return;
        }

        // wsagents: NodeId --> Agent (у твоєму webserver.js так і підписано)
        var agent = webserver.wsagents[nodeid];
        if (!agent) {
            console.log('privacy_screen(server): no agent in wsagents for nodeid', nodeid);
            return;
        }

        var msg = {
            action: 'msg',
            type: 'privacyscreen',
            state: state,
            on: !!args.on
        };

        try {
            agent.send(JSON.stringify(msg));
            console.log('privacy_screen(server): command sent to agent', nodeid, msg);
        } catch (e) {
            console.log('privacy_screen(server): ws send error', e);
        }
    };

    return obj;
};
