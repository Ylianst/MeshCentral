/**
* @description View engine, proxy trust, cookie sessions and global WebSocket middleware
* @license Apache-2.0
*/

'use strict';

module.exports.createCoreMiddleware = function (options) {
    const state = options.state;
    const parent = options.parent;
    const keygrip = options.keygrip;
    const cookieSession = options.cookieSession;
    const dnsLookup = options.dnsLookup;
    const handleWebRelayWebSocket = options.handleWebRelayWebSocket;

    function configureTrustedProxy() {
        if (state.args.trustedproxy) {
            try {
                state.app.set('trust proxy', state.args.trustedproxy);
            } catch (ex) {
                if ((state.args.trustedproxy.length == 1) && (typeof state.args.trustedproxy[0] == 'string')) {
                    dnsLookup(state.args.trustedproxy[0], function (err, address) { if (err == null) { state.app.set('trust proxy', address); state.args.trustedproxy = [address]; } });
                }
            }
        } else if (typeof state.args.tlsoffload == 'object') {
            try {
                state.app.set('trust proxy', state.args.tlsoffload);
            } catch (ex) {
                if ((Array.isArray(state.args.tlsoffload)) && (state.args.tlsoffload.length == 1) && (typeof state.args.tlsoffload[0] == 'string')) {
                    dnsLookup(state.args.tlsoffload[0], function (err, address) { if (err == null) { state.app.set('trust proxy', address); state.args.tlsoffload = [address]; } });
                }
            }
        }
    }

    function setupCoreMiddleware() {
        state.app.engine('handlebars', state.exphbs.engine({ defaultLayout: false }));
        state.app.set('view engine', 'handlebars');
        configureTrustedProxy();

        const keys = keygrip((typeof state.args.sessionkey == 'string') ? [state.args.sessionkey] : state.args.sessionkey, 'sha384', 'base64');
        const sessionOptions = { name: 'xid', httpOnly: true, keys: keys, secure: (state.args.tlsoffload == null), sameSite: (state.args.sessionsamesite ? state.args.sessionsamesite : 'lax') };
        if (state.args.sessiontime != null) sessionOptions.maxAge = state.args.sessiontime * 60000;
        state.app.use(cookieSession(sessionOptions));
        state.app.use(function (request, response, next) {
            if (request.session && !request.session.regenerate) request.session.regenerate = function (callback) { callback(); };
            if (request.session && !request.session.save) request.session.save = function (callback) { callback(); };
            if ((state.webRelayRouter != null) && (state.args.relaydns.indexOf(request.hostname) == -1)) {
                const clientHints = ['Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Form-Factors', 'Sec-CH-UA-Full-Version', 'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Model', 'Sec-CH-UA-Platform', 'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-WoW64'];
                response.setHeader('Accept-CH', clientHints.join(', '));
                response.setHeader('Critical-CH', clientHints.join(', '));
            }
            next();
        });

        state.app.ws('/*', function (ws, req, next) {
            ws.on('error', function (err) { parent.debug('web', 'GENERAL WSERR: ' + err); console.log(err); });
            if ((state.webRelayRouter != null) && (state.args.relaydns.indexOf(req.hostname) >= 0)) { handleWebRelayWebSocket(ws, req); return; }
            return next();
        });
    }

    return { setupCoreMiddleware: setupCoreMiddleware, configureTrustedProxy: configureTrustedProxy };
};
