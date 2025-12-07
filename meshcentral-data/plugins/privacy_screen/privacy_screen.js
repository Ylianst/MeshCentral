// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;         // це pluginHandler
    obj.exports = ['sendPrivacyCommand'];

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    /**
     * Викликається на СЕРВЕРІ, коли в браузері:
     * pluginHandler.privacy_screen.sendPrivacyCommand({ nodeid, on })
     *
     * @param {object} args      - { nodeid: 'node//...', on: true/false }
     * @param {number} rights
     * @param {object} session
     * @param {object} user
     * @param {object} rootParent - головний об’єкт MeshCentral (з webserver, msgserver і т.д.)
     */
    obj.sendPrivacyCommand = function (args, rights, session, user, rootParent) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen (server.sendPrivacyCommand)', nodeid, state);

        // rootParent тобі вже приходив (ти друкував його keys у логах)
        var server = rootParent || (obj.parent && obj.parent.parent);
        if (!server || !server.webserver) {
            console.log('privacy_screen(server): server or webserver not available');
            return;
        }

        var web = server.webserver;
        var wsagents = web.wsagents;
        if (!wsagents) {
            console.log('privacy_screen(server): webserver.wsagents not available');
            return;
        }

        var agent = wsagents[nodeid];
        if (!agent) {
            console.log('privacy_screen(server): agent not connected for nodeid', nodeid);
            return;
        }

        var msg = {
            action: 'msg',          // важливо: так це попаде в handleServerCommand у meshcore
            type: 'privacyscreen',  // наш тип, на який дивиться privacyScreenCommandHandler
            state: state,
            on: !!args.on
        };

        try {
            agent.send(JSON.stringify(msg));
            console.log('privacy_screen(server): command sent', msg);
        } catch (e) {
            console.log('privacy_screen(server): ws.send error', e);
        }
    };

    return obj;
};
