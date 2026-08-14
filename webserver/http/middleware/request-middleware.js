/**
* @description Main HTTP request security and agent-port context middleware
* @license Apache-2.0
*/

'use strict';

module.exports.createRequestMiddleware = function (options) {
    const state = options.state;
    const parent = options.parent;
    const sessions = options.sessions;
    const requestContext = options.requestContext;
    const getDomain = options.getDomain;
    const securityHeaders = options.securityHeaders;

    function wrapResponse(res) {
        const render = res.render;
        const send = res.send;
        res.render = function renderWrapper() {
            Error.captureStackTrace(this);
            return render.apply(this, arguments);
        };
        res.send = function sendWrapper() {
            try {
                send.apply(this, arguments);
            } catch (err) {
                console.error('Error in res.send | ' + err.code + ' | ' + err.message + ' | ' + res.stack);
                try {
                    var errorLogPath = null;
                    if (typeof parent.args.mesherrorlogpath == 'string') { errorLogPath = parent.path.join(parent.args.mesherrorlogpath, 'mesherrors.txt'); } else { errorLogPath = parent.getConfigFilePath('mesherrors.txt'); }
                    parent.fs.appendFileSync(errorLogPath, new Date().toLocaleString() + ': Error in res.send | ' + err.code + ' | ' + err.message + ' | ' + res.stack + '\r\n');
                } catch (ex) { parent.debug('error', 'Unable to write to mesherrors.txt.'); }
            }
        };
    }

    function setupMainMiddleware() {
        state.app.use(async function (req, res, next) {
            sessions.prepareSession(req);
            parent.debug('httpheaders', req.method, req.url, req.headers);

            if (req.headers['x-forwarded-proto'] == 'http') {
                var host = req.headers.host;
                if (typeof host == 'string') host = host.split(':')[0];
                if ((host == null) && (state.certificates != null)) { host = state.certificates.CommonName; if (state.certificates.CommonName.indexOf('.') == -1) host = req.headers.host; }
                const httpsPort = (state.args.aliasport == null) ? state.args.port : state.args.aliasport;
                res.redirect('https://' + host + ':' + httpsPort + req.url);
                return;
            }

            requestContext.accountTraffic(req);
            const forwardedHost = requestContext.resolveClientAddress(req, true, true);
            if ((state.webRelayRouter != null) && (state.args.relaydns.indexOf(req.hostname) >= 0)) {
                if (['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'OPTIONS'].indexOf(req.method) >= 0) return state.webRelayRouter(req, res);
                res.sendStatus(404);
                return;
            }

            const domain = req.xdomain = getDomain(req);
            parent.debug('webrequest', '(' + req.clientIp + ') ' + req.url);
            if ((req.url.indexOf('/meshrelay.ashx/.websocket') >= 0) || (req.url.indexOf('/agent.ashx/.websocket') >= 0) || (req.url.indexOf('/localrelay.ashx/.websocket') >= 0)) { next(); return; }

            res.set(securityHeaders.build(domain, req, forwardedHost));
            sessions.refreshSession(req);
            if ((parent.crowdSecBounser != null) && (req.headers.upgrade != 'websocket') && (req.session.userid == null)) {
                if ((await parent.crowdSecBounser.process(domain, req, res, next)) == true) return;
            }
            wrapResponse(res);
            return next();
        });
    }

    function setupAgentMiddleware() {
        if (!state.agentapp) return;
        state.agentapp.use(function (req, res, next) {
            requestContext.resolveClientAddress(req, false, false);
            req.xdomain = getDomain(req);
            parent.debug('webrequest', '(' + req.clientIp + ') AgentPort: ' + req.url);
            res.removeHeader('X-Powered-By');
            return next();
        });
    }

    function setup() { setupMainMiddleware(); setupAgentMiddleware(); }
    return { setup: setup, setupMainMiddleware: setupMainMiddleware, setupAgentMiddleware: setupAgentMiddleware, wrapResponse: wrapResponse };
};
