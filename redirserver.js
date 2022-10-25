/**
* @description Meshcentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.2
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Construct a HTTP redirection web server object
module.exports.CreateRedirServer = function (parent, db, args, func) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = null;
    obj.express = require('express');
    obj.net = require('net');
    obj.app = obj.express();
    obj.tcpServer = null;
    obj.port = null;
    const leChallengePrefix = '/.well-known/acme-challenge/';

    // Perform an HTTP to HTTPS redirection
    function performRedirection(req, res) {
        var host = req.headers.host;
        if (typeof host == 'string') { host = host.split(':')[0]; }
        if ((host == null) && (obj.certificates != null)) { host = obj.certificates.CommonName; if (obj.certificates.CommonName.indexOf('.') == -1) { host = req.headers.host; } }
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        res.redirect('https://' + host + ':' + httpsPort + req.url);
    }

    // Setup CrowdSec bouncer middleware if needed
    if (parent.crowdsecMiddleware != null) { obj.app.use(parent.crowdsecMiddleware); }

    /*
    // Return the current domain of the request
    function getDomain(req) {
        var x = req.url.split("/");
        if (x.length < 2) { return parent.config.domains[""]; }
        if (parent.config.domains[x[1].toLowerCase()]) { return parent.config.domains[x[1].toLowerCase()]; }
        return parent.config.domains[""];
    }
    */

    // Renter the terms of service.
    obj.app.get('/MeshServerRootCert.cer', function (req, res) {
        // The redirection server starts before certificates are loaded, make sure to handle the case where no certificate is loaded now.
        if (obj.certificates != null) {
            res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename*="' + encodeURIComponent(obj.certificates.RootName) + '.cer"' });
            var rootcert = obj.certificates.root.cert;
            var i = rootcert.indexOf('-----BEGIN CERTIFICATE-----\r\n');
            if (i >= 0) { rootcert = rootcert.substring(i + 29); }
            i = rootcert.indexOf('-----END CERTIFICATE-----');
            if (i >= 0) { rootcert = rootcert.substring(i, 0); }
            res.send(Buffer.from(rootcert, 'base64'));
        } else {
            res.sendStatus(404);
        }
    });

    // Add HTTP security headers to all responses
    obj.app.use(function (req, res, next) {
        parent.debug('webrequest', req.url + ' (RedirServer)');
        res.removeHeader('X-Powered-By');

        if ((parent.letsencrypt != null) && (req.url.startsWith(leChallengePrefix))) {
            // Let's Encrypt Support
            parent.letsencrypt.challenge(req.url.slice(leChallengePrefix.length), getCleanHostname(req), function (response) { if (response == null) { res.sendStatus(404); } else { res.send(response); } });
        } else {
            // Everything else
            var selfurl = (' wss://' + req.headers.host);
            res.set({
                'strict-transport-security': 'max-age=60000; includeSubDomains',
                'Referrer-Policy': 'no-referrer',
                'x-frame-options': 'SAMEORIGIN',
                'X-XSS-Protection': '1; mode=block',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline';"
            });
            return next();
        }
    });

    // Once the main web server is started, call this to hookup additional handlers
    obj.hookMainWebServer = function (certs) {
        obj.certificates = certs;
        for (var i in parent.config.domains) {
            if (parent.config.domains[i].dns != null) { continue; }
            var url = parent.config.domains[i].url;
            obj.app.post(url + 'amtevents.ashx', obj.parent.webserver.handleAmtEventRequest);
            obj.app.get(url + 'meshsettings', obj.parent.webserver.handleMeshSettingsRequest);
            obj.app.get(url + 'meshagents', obj.parent.webserver.handleMeshAgentRequest);

            // Server redirects
            if (parent.config.domains[i].redirects) {
                for (var j in parent.config.domains[i].redirects) {
                    if (j[0] != '_') { obj.app.get(url + j, obj.parent.webserver.handleDomainRedirect); }
                }
            }
        }
    }

    // Setup all HTTP redirection handlers
    //obj.app.set("etag", false);
    for (var i in parent.config.domains) {
        if (parent.config.domains[i].dns != null) { continue; }
        var url = parent.config.domains[i].url;
        obj.app.get(url, performRedirection); // Root redirection

        // Setup any .well-known folders
        var p = obj.parent.path.join(obj.parent.datapath, '.well-known' + ((parent.config.domains[i].id == '') ? '' : ('-' + parent.config.domains[i].id)));
        if (obj.parent.fs.existsSync(p)) { obj.app.use(url + '.well-known', obj.express.static(p)); }

        // Setup all of the redirections to HTTPS
        const redirections = ['player.htm', 'terms', 'logout', 'MeshServerRootCert.cer', 'mescript.ashx', 'checkmail', 'agentinvite', 'messenger', 'meshosxagent', 'devicepowerevents.ashx', 'downloadfile.ashx', 'userfiles/*', 'webrelay.ashx', 'health.ashx', 'logo.png', 'welcome.jpg', 'invite'];
        for (i in redirections) { obj.app.get(url + redirections[i], performRedirection); }
    }

    // Find a free port starting with the specified one and going up.
    function CheckListenPort(port, addr, func) {
        var s = obj.net.createServer(function (socket) { });
        obj.tcpServer = s.listen(port, addr, function () { s.close(function () { if (func) { func(port, addr); } }); }).on("error", function (err) {
            if (args.exactports) { console.error("ERROR: MeshCentral HTTP server port " + port + " not available."); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, addr, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server, if the port is busy try the next one.
    function StartRedirServer(port, addr) {
        if (port == 0 || port == 65535) { return; }
        obj.tcpServer = obj.app.listen(port, addr, function () {
            obj.port = port;
            console.log("MeshCentral HTTP redirection server running on port " + port + ".");
            obj.parent.authLog('http', 'Server listening on ' + ((addr != null)?addr:'0.0.0.0') + ' port ' + port + '.');
            obj.parent.updateServerState('redirect-port', port);
            func(obj.port);
        }).on('error', function (err) {
            if ((err.code == 'EACCES') && (port < 65535)) { StartRedirServer(port + 1, addr); } else { console.log(err); func(obj.port); }
        });
    }

    // Get the remote hostname correctly
    const servernameRe = /^[a-z0-9\.\-]+$/i;
    function getHostname(req) { return req.hostname || req.headers['x-forwarded-host'] || (req.headers.host || ''); };
    function getCleanHostname(req) {
        var servername = getHostname(req).toLowerCase().replace(/:.*/, '');
        try { req.hostname = servername; } catch (e) { } // read-only express property
        if (req.headers['x-forwarded-host']) { req.headers['x-forwarded-host'] = servername; }
        try { req.headers.host = servername; } catch (e) { }
        return (servernameRe.test(servername) && -1 === servername.indexOf('..') && servername) || '';
    };

    CheckListenPort(args.redirport, args.redirportbind, StartRedirServer);

    return obj;
};
