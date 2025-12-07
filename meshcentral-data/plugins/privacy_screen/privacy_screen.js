// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;        // <- це pluginHandler на сервері
    obj.exports = [];           // НІЧОГО не експортуємо в UI, працюємо тільки через action:"plugin"

    //
    // Викликається, коли сервер стартує (або плагін активується)
    //
    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    //
    // Викликається MeshCentral-ом при action: "plugin"
    // Реальна сигнатура з боку серверу виглядає приблизно так:
    //
    //   plugin.serveraction(command, ws, req, user, domain, rights, session)
    //
    // Нам реально потрібен тільки `command` і доступ до obj.parent.parent (meshServer)
    //
    obj.serveraction = function (command /*, ws, req, user, domain, rights, session */) {
        try {
            // Переконуємось, що це наш плагін
            if (!command || command.plugin !== 'privacy_screen') return;

            if (command.pluginaction === 'sendPrivacyCommand') {
                sendPrivacyCommand(command);
            } else {
                console.log('privacy_screen(serveraction): unknown pluginaction', command.pluginaction);
            }
        } catch (e) {
            console.log('privacy_screen(serveraction) error:', e);
        }
    };

    //
    // Власне логіка: знайти агента і послати йому msg:type='privacyscreen'
    //
    function sendPrivacyCommand(command) {
        var nodeid = command.nodeid || (command.args && command.args.nodeid);
        var on = command.on;
        if (!nodeid) {
            console.log('privacy_screen(server): no nodeid in command');
            return;
        }

        var state = on ? 1 : 0;
        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, state);

        // Піднімаємось вгору:
        // obj.parent -> pluginHandler
        // obj.parent.parent -> meshServer
        var meshServer = obj.parent && obj.parent.parent;
        if (!meshServer || !meshServer.webserver || !meshServer.webserver.wsagents) {
            console.log('privacy_screen(server): meshServer.webserver.wsagents not available');
            return;
        }

        var webserver = meshServer.webserver;
        var agent = webserver.wsagents[nodeid];

        if (!agent) {
            console.log('privacy_screen(server): agent not connected for nodeid', nodeid);
            return;
        }

        var msg = {
            action: 'msg',          // це ловить meshcore case 'msg'
            type: 'privacyscreen',  // наш тип, який перевіряє modules_meshcore/privacy_screen.js
            state: state,
            on: !!on
        };

        try {
            agent.send(JSON.stringify(msg));
            console.log('privacy_screen(server): command sent to agent', nodeid, msg);
        } catch (e) {
            console.log('privacy_screen(server): ws.send error', e);
        }
    }

    return obj;
};
