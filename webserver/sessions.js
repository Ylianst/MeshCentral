/**
* @description HTTP and WebSocket session helpers for the MeshCentral web server
* @license Apache-2.0
*/

'use strict';

module.exports.createSessions = function (options) {
    const crypto = options.crypto;
    const destroyedSessions = options.destroyedSessions;
    const now = options.now || Date.now;

    function getWebsocketArgs(ws, req, callback) {
        if (req.query.moreargs != '1') { callback(ws, req); return; }
        delete req.query.moreargs;
        const onMessage = function (message) {
            var command = null;
            try { command = JSON.parse(message.toString('utf8')); } catch (e) { return; }
            if ((command != null) && (command.action === 'urlargs') && (typeof command.args == 'object')) {
                for (var i in command.args) onMessage.req.query[i] = command.args[i];
                ws.removeEventListener('message', onMessage);
                onMessage.callback(onMessage.ws, onMessage.req);
            }
        };
        onMessage.ws = ws;
        onMessage.req = req;
        onMessage.callback = callback;
        ws.on('message', onMessage);
    }

    function setSessionRandom(req) {
        if ((req.session == null) || (req.session.userid == null) || (req.session.x != null)) return;
        var value = crypto.randomBytes(6).toString('base64');
        while (destroyedSessions[req.session.userid + '/' + value] != null) value = crypto.randomBytes(6).toString('base64');
        req.session.x = value;
    }

    function clearDestroyedSessions() {
        var toRemove = [], cutoff = now() - (2 * 60 * 60 * 1000);
        for (var id in destroyedSessions) { if (destroyedSessions[id] < cutoff) toRemove.push(id); }
        for (var i in toRemove) delete destroyedSessions[toRemove[i]];
    }

    return {
        getWebsocketArgs: getWebsocketArgs,
        setSessionRandom: setSessionRandom,
        clearDestroyedSessions: clearDestroyedSessions
    };
};
