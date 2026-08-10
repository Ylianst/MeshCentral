/**
* @description Echo and push-authentication hold WebSocket handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createAuxiliaryWebSockets = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const log = options.log || console.log;

    function echo(ws, req) {
        const domain = checkUserIpAddress(ws, req);
        if (domain == null) return;
        ws._socket.setKeepAlive(true, 240000);
        ws.on('message', function (data) {
            if (data.toString('utf8') === 'close') {
                try { ws.close(); } catch (ex) { log(ex); }
            } else {
                try { ws.send(data); } catch (ex) { log(ex); }
            }
        });
        ws.on('error', function (err) { log('Echo server error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.'); });
        ws.on('close', function () { });
    }

    function twoFactorHold(ws, req) {
        const domain = checkUserIpAddress(ws, req);
        if (domain == null) return;
        if ((typeof domain.passwordrequirements === 'object') && (domain.passwordrequirements.push2factor === false)) { ws.close(); return; }
        if (typeof req.query.c !== 'string') { ws.close(); return; }
        const cookie = parent.decodeCookie(req.query.c, null, 1);
        if ((cookie == null) || (cookie.d !== domain.id)) { ws.close(); return; }
        const user = state.users[cookie.u];
        if ((user == null) || (typeof user.otpdev !== 'string')) { ws.close(); return; }
        ws._socket.setKeepAlive(true, 240000);

        parent.AddEventDispatch(['2fadev-' + cookie.s], ws);
        ws.cookie = cookie;
        ws.HandleEvent = function (source, event) {
            parent.RemoveAllEventDispatch(this);
            if ((event.approved === true) && (event.userid === this.cookie.u)) {
                const loginCookie = parent.encodeCookie({ a: 'pushAuth', u: event.userid, d: event.domain }, parent.loginCookieEncryptionKey);
                try { ws.send(JSON.stringify({ approved: true, token: loginCookie })); } catch (ex) { }
            } else {
                try { ws.send(JSON.stringify({ approved: false })); } catch (ex) { }
            }
        };
        ws.on('message', function () { this.close(); });
        ws.on('error', function () { });
        ws.on('close', function () { parent.RemoveAllEventDispatch(this); });

        try {
            const deviceCookie = parent.encodeCookie({ a: 'checkAuth', c: cookie.c, u: cookie.u, n: cookie.n, s: cookie.s });
            const code = Buffer.from(cookie.c, 'base64').toString();
            const payload = { notification: { title: domain.title || 'MeshCentral', body: 'Authentication - ' + code }, data: { url: '2fa://auth?code=' + cookie.c + '&c=' + deviceCookie } };
            parent.firebase.sendToDevice(user.otpdev, payload, { priority: 'High', timeToLive: 60 }, function (id, err) {
                try { ws.send(JSON.stringify((err == null) ? { sent: true, code: code } : { sent: false })); } catch (ex) { }
            });
        } catch (ex) { log(ex); }
    }

    return { echo: echo, twoFactorHold: twoFactorHold };
};
