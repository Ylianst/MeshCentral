/**
* @description Meshcentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Construct a HTTP redirection web server object
module.exports.CreateRedirServer = function (parent, db, args, certificates) {
    var obj = {};
    obj.parent = parent;
    obj.db = db;
    obj.args = args;
    obj.certificates = certificates;
    obj.express = require('express');
    obj.net = require('net');
    obj.app = obj.express();
    obj.tcpServer;
        
    // Perform an HTTP to HTTPS redirection
    function performRedirection(req, res) {
        var host = certificates.CommonName;
        if ((certificates.CommonName == 'sample.org') || (certificates.CommonName == 'un-configured')) { host = req.headers.host; }
        if (req.headers && req.headers.host && (req.headers.host.split(':')[0].toLowerCase() == 'localhost')) { res.redirect('https://localhost:' + args.port + req.url); } else { res.redirect('https://' + host + ':' + args.port + req.url); }
    }
    
    // Return the current domain of the request
    function getDomain(req) {
        var x = req.url.split('/');
        if (x.length < 2) return parent.config.domains[''];
        if (parent.config.domains[x[1].toLowerCase()]) return parent.config.domains[x[1].toLowerCase()];
        return parent.config.domains[''];
    }

    // Renter the terms of service.
    obj.app.get('/MeshServerRootCert.cer', function (req, res) {
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + certificates.RootName + '.cer' });
        var rootcert = obj.certificates.root.cert;
        var i = rootcert.indexOf("-----BEGIN CERTIFICATE-----\r\n");
        if (i >= 0) { rootcert = rootcert.substring(i + 29); }
        i = rootcert.indexOf("-----END CERTIFICATE-----");
        if (i >= 0) { rootcert = rootcert.substring(i, 0); }
        res.send(new Buffer(rootcert, 'base64'));
    });

    // Add HTTP security headers to all responses
    obj.app.use(function (req, res, next) {
        res.removeHeader("X-Powered-By");
        res.set({ 'strict-transport-security': 'max-age=60000; includeSubDomains', 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src http: ws: 'self' 'unsafe-inline'" });
        return next();
    });

    // Setup all HTTP redirection handlers
    //obj.app.set('etag', false);
    for (var i in parent.config.domains) {
        var url = parent.config.domains[i].url;
        obj.app.get(url, performRedirection);
        obj.app.post(url + 'amtevents.ashx', obj.parent.webserver.handleAmtEventRequest);
        obj.app.get(url + 'meshsettings', obj.parent.webserver.handleMeshSettingsRequest);
        obj.app.get(url + 'meshagents', obj.parent.webserver.handleMeshAgentRequest);

        // Indicates the clickonce folder is public
        obj.app.use(url + 'clickonce', obj.express.static(obj.parent.path.join(__dirname, 'public/clickonce')));
    }
    
    // Find a free port starting with the specified one and going up.
    function CheckListenPort(port, func) {
        var s = obj.net.createServer(function (socket) { });
        obj.tcpServer = s.listen(port, function () { s.close(function () { if (func) { func(port); } }); }).on('error', function (err) {
            if (args.exactports) { console.error('ERROR: MeshCentral HTTP web server port ' + port + ' not available.'); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server, if the port is busy try the next one.
    function StartRedirServer(port) {
        if (port == 0 || port == 65535) return;
        obj.args.redirport = port;
        obj.tcpServer = obj.app.listen(port, function () { console.log('MeshCentral HTTP redirection web server running on port ' + port + '.'); }).on('error', function (err) { if ((err.code == 'EACCES') && (port < 65535)) { StartRedirServer(port + 1); } else { console.log(err); } });
    }
    
    CheckListenPort(args.redirport, StartRedirServer);

    return obj;
}
