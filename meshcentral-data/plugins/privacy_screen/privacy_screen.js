// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;               // pluginHandler
    obj.exports = ['sendPrivacyCommand'];

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    // Викликається MeshCentral при action:"plugin"
    obj.serveraction = function (command, ws, req, user, domain, rights, session) {
        try {
            if (!command || command.plugin !== 'privacy_screen') return;

            if (command.pluginaction === 'sendPrivacyCommand') {
                obj.sendPrivacyCommand(command.args, rights, session);
            } else {
                console.log('privacy_screen(serveraction): unknown pluginaction', command.pluginaction);
            }
        } catch (e) {
            console.log('privacy_screen(serveraction) error:', e);
        }
    };

    obj.sendPrivacyCommand = function (args, rights, session) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var on = !!args.on;
        var cmd = 'plugin privacy_screen ' + (on ? 'on' : 'off');

        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, on ? 1 : 0);

        // obj.parent -> pluginHandler, obj.parent.parent -> meshServer
        var meshServer = obj.parent && obj.parent.parent;
        if (!meshServer || !meshServer.webserver || !meshServer.webserver.wsagents) {
            console.log('privacy_screen(server): meshServer.webserver.wsagents not available');
            return;
        }

        var agent = meshServer.webserver.wsagents[nodeid];
        if (!agent) {
            console.log('privacy_screen(server): agent not connected for nodeid', nodeid);
            return;
        }

        var msg = {
            action: 'msg',
            type: 'console',
            rights: 0xFFFFFFFF, // фулл права, сервер довіряє собі
            sessionid: (session && session.sessionid) ? session.sessionid : 1,
            value: cmd
        };

        try {
            agent.send(JSON.stringify(msg));
            console.log('privacy_screen(server): console command sent to agent', nodeid, msg);
        } catch (e) {
            console.log('privacy_screen(server): ws.send error', e);
        }
    };

    return obj;
};
