/**
* @description Meshcentral web relay server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// Construct a HTTP redirection web server object
module.exports.CreateWebRelayServer = function (parent, db, args, certificates, func) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.express = require('express');
    obj.expressWs = null;
    obj.tlsServer = null;
    obj.net = require('net');
    obj.app = obj.express();
    if (args.compression !== false) { obj.app.use(require('compression')()); }
    obj.app.disable('x-powered-by');
    obj.webRelayServer = null;
    obj.port = 0;
    obj.cleanupTimer = null;
    var relaySessions = {}            // RelayID --> Web Mutli-Tunnel
    const constants = (require('crypto').constants ? require('crypto').constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.
    var tlsSessionStore = {};         // Store TLS session information for quick resume.
    var tlsSessionStoreCount = 0;     // Number of cached TLS session information in store.

    function serverStart() {
        // Setup CrowdSec bouncer middleware if needed
        if (parent.crowdsecMiddleware != null) { obj.app.use(parent.crowdsecMiddleware); }

        if (args.trustedproxy) {
            // Reverse proxy should add the "X-Forwarded-*" headers
            try {
                obj.app.set('trust proxy', args.trustedproxy);
            } catch (ex) {
                // If there is an error, try to resolve the string
                if ((args.trustedproxy.length == 1) && (typeof args.trustedproxy[0] == 'string')) {
                    require('dns').lookup(args.trustedproxy[0], function (err, address, family) { if (err == null) { obj.app.set('trust proxy', address); args.trustedproxy = [address]; } });
                }
            }
        }
        else if (typeof args.tlsoffload == 'object') {
            // Reverse proxy should add the "X-Forwarded-*" headers
            try {
                obj.app.set('trust proxy', args.tlsoffload);
            } catch (ex) {
                // If there is an error, try to resolve the string
                if ((Array.isArray(args.tlsoffload)) && (args.tlsoffload.length == 1) && (typeof args.tlsoffload[0] == 'string')) {
                    require('dns').lookup(args.tlsoffload[0], function (err, address, family) { if (err == null) { obj.app.set('trust proxy', address); args.tlsoffload = [address]; } });
                }
            }
        }

        // Setup a keygrip instance with higher default security, default hash is SHA1, we want to bump that up with SHA384
        // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
        // If args.sessionkey is a string, use it as a single key, but args.sessionkey can also be used as an array of keys.
        const keygrip = require('keygrip')((typeof args.sessionkey == 'string') ? [args.sessionkey] : args.sessionkey, 'sha384', 'base64');

        // Watch for device share removal
        parent.AddEventDispatch(['server-shareremove'], obj);
        obj.HandleEvent = function (source, event, ids, id) {
            if (event.action == 'removedDeviceShare') {
                for (var relaySessionId in relaySessions) {
                    // A share was removed that matches an active session, close the session.
                    if (relaySessions[relaySessionId].xpublicid === event.publicid) { relaySessions[relaySessionId].close(); }
                }
            }
        }

        // Setup cookie session
        const sessionOptions = {
            name: 'xid', // Recommended security practice to not use the default cookie name
            httpOnly: true,
            keys: keygrip,
            secure: (args.tlsoffload == null), // Use this cookie only over TLS (Check this: https://expressjs.com/en/guide/behind-proxies.html)
            sameSite: (args.sessionsamesite ? args.sessionsamesite : 'lax')
        }
        if (args.sessiontime != null) { sessionOptions.maxAge = (args.sessiontime * 60000); } // sessiontime is minutes
        obj.app.use(require('cookie-session')(sessionOptions));

        // Add HTTP security headers to all responses
        obj.app.use(function (req, res, next) {
            parent.debug('webrelay', req.url);
            res.removeHeader('X-Powered-By');
            res.set({
                'strict-transport-security': 'max-age=60000; includeSubDomains',
                'Referrer-Policy': 'no-referrer',
                'x-frame-options': 'SAMEORIGIN',
                'X-XSS-Protection': '1; mode=block',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline';"
            });

            // Set the real IP address of the request
            // If a trusted reverse-proxy is sending us the remote IP address, use it.
            var ipex = '0.0.0.0', xforwardedhost = req.headers.host;
            if (typeof req.connection.remoteAddress == 'string') { ipex = (req.connection.remoteAddress.startsWith('::ffff:')) ? req.connection.remoteAddress.substring(7) : req.connection.remoteAddress; }
            if (
                (args.trustedproxy === true) || (args.tlsoffload === true) ||
                ((typeof args.trustedproxy == 'object') && (isIPMatch(ipex, args.trustedproxy))) ||
                ((typeof args.tlsoffload == 'object') && (isIPMatch(ipex, args.tlsoffload)))
            ) {
                // Get client IP
                if (req.headers['cf-connecting-ip']) { // Use CloudFlare IP address if present
                    req.clientIp = req.headers['cf-connecting-ip'].split(',')[0].trim();
                } else if (req.headers['x-forwarded-for']) {
                    req.clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
                } else if (req.headers['x-real-ip']) {
                    req.clientIp = req.headers['x-real-ip'].split(',')[0].trim();
                } else {
                    req.clientIp = ipex;
                }

                // If there is a port number, remove it. This will only work for IPv4, but nice for people that have a bad reverse proxy config.
                const clientIpSplit = req.clientIp.split(':');
                if (clientIpSplit.length == 2) { req.clientIp = clientIpSplit[0]; }

                // Get server host
                if (req.headers['x-forwarded-host']) { xforwardedhost = req.headers['x-forwarded-host'].split(',')[0]; } // If multiple hosts are specified with a comma, take the first one.
            } else {
                req.clientIp = ipex;
            }

            // If this is a session start or a websocket, have the application handle this
            if ((req.headers.upgrade == 'websocket') || (req.url.startsWith('/control-redirect.ashx?n='))) {
                return next();
            } else {
                // If this is a normal request (GET, POST, etc) handle it here
                var webSessionId = null;
                if ((req.session.userid != null) && (req.session.x != null)) { webSessionId = req.session.userid + '/' + req.session.x; }
                else if (req.session.z != null) { webSessionId = req.session.z; }
                if ((webSessionId != null) && (parent.webserver.destroyedSessions[webSessionId] == null)) {
                    var relaySession = relaySessions[webSessionId];
                    if (relaySession != null) {
                        // The web relay session is valid, use it
                        relaySession.handleRequest(req, res);
                    } else {
                        // No web relay ession with this relay identifier, close the HTTP request.
                        res.end();
                    }
                } else {
                    // The user is not logged in or does not have a relay identifier, close the HTTP request.
                    res.end();
                }
            }
        });

        // Start the server, only after users and meshes are loaded from the database.
        if (args.tlsoffload) {
            // Setup the HTTP server without TLS
            obj.expressWs = require('express-ws')(obj.app, null, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        } else {
            // Setup the HTTP server with TLS, use only TLS 1.2 and higher with perfect forward secrecy (PFS).
            const tlsOptions = { cert: certificates.web.cert, key: certificates.web.key, ca: certificates.web.ca, rejectUnauthorized: true, ciphers: "HIGH:TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_CCM_SHA256:TLS_CHACHA20_POLY1305_SHA256", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 };
            obj.tlsServer = require('https').createServer(tlsOptions, obj.app);
            obj.tlsServer.on('secureConnection', function () { /*console.log('tlsServer secureConnection');*/ });
            obj.tlsServer.on('error', function (err) { console.log('tlsServer error', err); });
            obj.tlsServer.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
            obj.tlsServer.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
            obj.expressWs = require('express-ws')(obj.app, obj.tlsServer, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        }

        // Handle incoming web socket calls
        obj.app.ws('/*', function (ws, req) {
            var webSessionId = null;
            if ((req.session.userid != null) && (req.session.x != null)) { webSessionId = req.session.userid + '/' + req.session.x; }
            else if (req.session.z != null) { webSessionId = req.session.z; }
            if ((webSessionId != null) && (parent.webserver.destroyedSessions[webSessionId] == null)) {
                var relaySession = relaySessions[webSessionId];
                if (relaySession != null) {
                    // The multi-tunnel session is valid, use it
                    relaySession.handleWebSocket(ws, req);
                } else {
                    // No multi-tunnel session with this relay identifier, close the websocket.
                    ws.close();
                }
            } else {
                // The user is not logged in or does not have a relay identifier, close the websocket.
                ws.close();
            }
        });

        // This is the magic URL that will setup the relay session
        obj.app.get('/control-redirect.ashx', function (req, res) {
            res.set({ 'Cache-Control': 'no-store' });
            parent.debug('webrelay', 'webRelaySetup');

            // Decode the relay cookie
            if (req.query.c == null) { res.sendStatus(404); return; }

            // Decode and check if this relay cookie is valid
            var userid, domainid, domain, nodeid, addr, port, appid, webSessionId, expire, publicid;
            const urlCookie = obj.parent.decodeCookie(req.query.c, parent.loginCookieEncryptionKey, 32); // Allow cookies up to 32 minutes old. The web page will renew this cookie every 30 minutes.
            if (urlCookie == null) { res.sendStatus(404); return; }

            // Decode the incoming cookie
            if ((urlCookie.ruserid != null) && (urlCookie.x != null)) {
                if (parent.webserver.destroyedSessions[urlCookie.ruserid + '/' + urlCookie.x] != null) { res.sendStatus(404); return; }

                // This is a standard user, figure out what our web relay will be.
                if (req.session.x != urlCookie.x) { req.session.x = urlCookie.x; } // Set the sessionid if missing
                if (req.session.userid != urlCookie.ruserid) { req.session.userid = urlCookie.ruserid; } // Set the session userid if missing
                if (req.session.z) { delete req.session.z; } // Clear the web relay guest session
                userid = req.session.userid;
                domainid = userid.split('/')[1];
                domain = parent.config.domains[domainid];
                nodeid = ((req.query.relayid != null) ? req.query.relayid : req.query.n);
                addr = (req.query.addr != null) ? req.query.addr : '127.0.0.1';
                port = parseInt(req.query.p);
                appid = parseInt(req.query.appid);
                webSessionId = req.session.userid + '/' + req.session.x;

                // Check that all the required arguments are present
                if ((req.session.userid == null) || (req.session.x == null) || (req.query.n == null) || (req.query.p == null) || (parent.webserver.destroyedSessions[webSessionId] != null) || ((req.query.appid != 1) && (req.query.appid != 2))) { res.redirect('/'); return; }
            } else if (urlCookie.r == 8) {
                // This is a guest user, figure out what our web relay will be.
                userid = urlCookie.userid;
                domainid = userid.split('/')[1];
                domain = parent.config.domains[domainid];
                nodeid = urlCookie.nid;
                addr = (urlCookie.addr != null) ? urlCookie.addr : '127.0.0.1';
                port = urlCookie.port;
                appid = (urlCookie.p == 16) ? 2 : 1; // appid: 1 = HTTP, 2 = HTTPS
                webSessionId = userid + '/' + urlCookie.pid;
                publicid = urlCookie.pid;
                if (req.session.x) { delete req.session.x; } // Clear the web relay sessionid
                if (req.session.userid) { delete req.session.userid; }  // Clear the web relay userid
                if (req.session.z != webSessionId) { req.session.z = webSessionId; } // Set the web relay guest session
                expire = urlCookie.expire;
                if ((expire != null) && (expire <= Date.now())) { parent.debug('webrelay', 'expired link'); res.sendStatus(404); return; }
            }

            // No session identifier was setup, exit now
            if (webSessionId == null) { res.sendStatus(404); return; }

            // Check to see if we already have a multi-relay session that matches exactly this device and port for this user
            const xrelaySession = relaySessions[webSessionId];
            if ((xrelaySession != null) && (xrelaySession.domain.id == domain.id) && (xrelaySession.userid == userid) && (xrelaySession.nodeid == nodeid) && (xrelaySession.addr == addr) && (xrelaySession.port == port) && (xrelaySession.appid == appid)) {
                // We found an exact match, we are all setup already, redirect to root
                res.redirect('/');
                return;
            }

            // Check that the user has rights to access this device
            parent.webserver.GetNodeWithRights(domain, userid, nodeid, function (node, rights, visible) {
                // If there is no remote control or relay rights, reject this web relay
                if ((rights & 0x00200008) == 0) { res.sendStatus(404); return; } // MESHRIGHT_REMOTECONTROL or MESHRIGHT_RELAY

                // There is a relay session, but it's not correct, close it.
                if (xrelaySession != null) { xrelaySession.close(); delete relaySessions[webSessionId]; }

                // Create a web relay session
                const relaySession = require('./apprelays.js').CreateWebRelaySession(obj, db, req, args, domain, userid, nodeid, addr, port, appid, webSessionId, expire, node.mtype);
                relaySession.xpublicid = publicid;
                relaySession.onclose = function (sessionId) {
                    // Remove the relay session
                    delete relaySessions[sessionId];
                    // If there are not more relay sessions, clear the cleanup timer
                    if ((Object.keys(relaySessions).length == 0) && (obj.cleanupTimer != null)) { clearInterval(obj.cleanupTimer); obj.cleanupTimer = null; }
                }

                // Set the multi-tunnel session
                relaySessions[webSessionId] = relaySession;

                // Setup the cleanup timer if needed
                if (obj.cleanupTimer == null) { obj.cleanupTimer = setInterval(checkTimeout, 10000); }

                // Redirect to root
                res.redirect('/');
            });
        });
    }

    // Check that everything is cleaned up
    function checkTimeout() {
        for (var i in relaySessions) { relaySessions[i].checkTimeout(); }
    }

    // Find a free port starting with the specified one and going up.
    function CheckListenPort(port, addr, func) {
        var s = obj.net.createServer(function (socket) { });
        obj.webRelayServer = s.listen(port, addr, function () { s.close(function () { if (func) { func(port, addr); } }); }).on("error", function (err) {
            if (args.exactports) { console.error("ERROR: MeshCentral HTTP relay server port " + port + " not available."); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, addr, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server, if the port is busy try the next one.
    function StartWebRelayServer(port, addr) {
        if (port == 0 || port == 65535) { return; }
        if (obj.tlsServer != null) {
            if (args.lanonly == true) {
                obj.tcpServer = obj.tlsServer.listen(port, addr, function () { console.log('MeshCentral HTTPS relay server running on port ' + port + ((typeof args.relayaliasport == 'number') ? (', alias port ' + args.relayaliasport) : '') + '.'); });
            } else {
                obj.tcpServer = obj.tlsServer.listen(port, addr, function () { console.log('MeshCentral HTTPS relay server running on ' + certificates.CommonName + ':' + port + ((typeof args.relayaliasport == 'number') ? (', alias port ' + args.relayaliasport) : '') + '.'); });
                obj.parent.updateServerState('servername', certificates.CommonName);
            }
            if (obj.parent.authlog) { obj.parent.authLog('https', 'Web relay server listening on ' + ((addr != null) ? addr : '0.0.0.0') + ' port ' + port + '.'); }
            obj.parent.updateServerState('https-relay-port', port);
            if (typeof args.relayaliasport == 'number') { obj.parent.updateServerState('https-relay-aliasport', args.relayaliasport); }
        } else {
            obj.tcpServer = obj.app.listen(port, addr, function () { console.log('MeshCentral HTTP relay server running on port ' + port + ((typeof args.relayaliasport == 'number') ? (', alias port ' + args.relayaliasport) : '') + '.'); });
            obj.parent.updateServerState('http-relay-port', port);
            if (typeof args.relayaliasport == 'number') { obj.parent.updateServerState('http-relay-aliasport', args.relayaliasport); }
        }
        obj.port = port;
    }

    function getRandomPassword() { return Buffer.from(require('crypto').randomBytes(9), 'binary').toString('base64').split('/').join('@'); }

    // Perform a IP match against a list
    function isIPMatch(ip, matchList) {
        const ipcheck = require('ipcheck');
        for (var i in matchList) { if (ipcheck.match(ip, matchList[i]) == true) return true; }
        return false;
    }

    // Start up the web relay server
    serverStart();
    CheckListenPort(args.relayport, args.relayportbind, StartWebRelayServer);

    return obj;
};
