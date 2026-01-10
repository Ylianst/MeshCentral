// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Якщо захочеш викликати ці функції з WebUI через exports-механізм — назви мають існувати. :contentReference[oaicite:1]{index=1}
    obj.exports = ['sendPrivacyCommand', 'getPrivacyState'];

    obj._state = Object.create(null);

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    obj.serveraction = function (command, ws, req, user, domain, rights, session) {
        try {
            if (!command || command.plugin !== 'privacy_screen') return;

            if (command.pluginaction === 'sendPrivacyCommand') {
                obj.sendPrivacyCommand(command.args, rights, session, ws);
                return;
            }

            if (command.pluginaction === 'getPrivacyState') {
                obj.getPrivacyState(command.args, ws);
                return;
            }

            console.log('privacy_screen(serveraction): unknown pluginaction', command.pluginaction);
        } catch (e) {
            console.log('privacy_screen(serveraction) error:', e);
        }
    };

    // args: { nodeid: "...", on: true|false }
    obj.sendPrivacyCommand = function (args, rights, session, ws) {
        var nodeid = args && args.nodeid;
        var on = !!(args && args.on);

        if (!nodeid) return safeUiAck(ws, { ok: 0, error: 'nodeid is missing' });

        // rights — це бітмаска. Мінімальна перевірка "є хоч щось" слабка, але залишаю як у тебе.
        if (!rights) return safeUiAck(ws, { ok: 0, error: 'insufficient rights' });

        var meshServer = obj.parent && obj.parent.parent;
        if (!meshServer || !meshServer.webserver || !meshServer.webserver.wsagents) {
            console.log('privacy_screen(server): wsagents not available');
            return safeUiAck(ws, { ok: 0, error: 'wsagents not available' });
        }

        var agent = meshServer.webserver.wsagents[nodeid];
        if (!agent) {
            console.log('privacy_screen(server): agent not connected for nodeid', nodeid);
            return safeUiAck(ws, { ok: 0, error: 'agent not connected', nodeid: nodeid });
        }

        // Команда в агент: виклик meshcore plugin module
        var cmd = 'plugin privacy_screen ' + (on ? 'on' : 'off');

        var msg = {
            action: 'msg',
            type: 'console',
            rights: 0xFFFFFFFF,
            sessionid: (session && session.sessionid) ? session.sessionid : 1,
            value: cmd
        };

        try {
            agent.send(JSON.stringify(msg));
            obj._state[nodeid] = { on: on, ts: Date.now() };
            safeUiAck(ws, { ok: 1, nodeid: nodeid, on: on });
            console.log('privacy_screen(server): sent to agent', nodeid, cmd);
        } catch (e) {
            console.log('privacy_screen(server): agent send failed', e);
            safeUiAck(ws, { ok: 0, error: 'agent send failed', details: String(e) });
        }
    };

    obj.getPrivacyState = function (args, ws) {
        var nodeid = args && args.nodeid;
        if (!nodeid) return safeUiAck(ws, { ok: 0, error: 'nodeid is missing' });

        var st = obj._state[nodeid] || { on: false, ts: 0 };
        safeUiAck(ws, { ok: 1, nodeid: nodeid, on: !!st.on, ts: st.ts });
    };

    function safeUiAck(ws, payload) {
        try {
            if (!ws || typeof ws.send !== 'function') return;
            ws.send(JSON.stringify({
                action: 'plugin',
                plugin: 'privacy_screen',
                pluginaction: 'ack',
                args: payload
            }));
        } catch (e) { }
    }

    return obj;
};
