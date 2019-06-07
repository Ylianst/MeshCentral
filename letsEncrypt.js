/**
* @description MeshCentral letsEncrypt module, uses GreenLock to do all the work.
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.2
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

module.exports.CreateLetsEncrypt = function (parent) {
    try {
        // Try to delete the "./ursa-optional" or "./node_modules/ursa-optional" folder if present.
        // This is an optional module that GreenLock uses that causes issues.
        try {
            const fs = require('fs');
            if (fs.existsSync(obj.path.join(__dirname, 'ursa-optional'))) { fs.unlinkSync(obj.path.join(__dirname, 'ursa-optional')); }
            if (fs.existsSync(obj.path.join(__dirname, 'node_modules', 'ursa-optional'))) { fs.unlinkSync(obj.path.join(__dirname, 'node_modules', 'ursa-optional')); }
        } catch (ex) { }

        // Get GreenLock setup and running.
        const greenlock = require('greenlock');
        var obj = {};
        obj.parent = parent;
        obj.redirWebServerHooked = false;
        obj.leDomains = null;
        obj.leResults = null;

        // Setup the certificate storage paths
        obj.configPath = obj.parent.path.join(obj.parent.datapath, 'letsencrypt');
        obj.webrootPath = obj.parent.path.join(obj.parent.datapath, 'letsencrypt', 'webroot');
        try { obj.parent.fs.mkdirSync(obj.configPath); } catch (e) { }
        try { obj.parent.fs.mkdirSync(obj.webrootPath); } catch (e) { }

        // Storage Backend, store data in the "meshcentral-data/letencrypt" folder.
        var leStore = require('le-store-certbot').create({ configDir: obj.configPath, webrootPath: obj.webrootPath, debug: obj.parent.args.debug > 0 });

        // ACME Challenge Handlers
        var leHttpChallenge = require('le-challenge-fs').create({ webrootPath: obj.webrootPath, debug: obj.parent.args.debug > 0 });

        // Function to agree to terms of service
        function leAgree(opts, agreeCb) { agreeCb(null, opts.tosUrl); }

        // Create the main GreenLock code module.
        var greenlockargs = {
            version: 'draft-12',
            server: (obj.parent.config.letsencrypt.production === true) ? 'https://acme-v02.api.letsencrypt.org/directory' : 'https://acme-staging-v02.api.letsencrypt.org/directory',
            store: leStore,
            challenges: { 'http-01': leHttpChallenge },
            challengeType: 'http-01',
            agreeToTerms: leAgree,
            debug: obj.parent.args.debug > 0
        };
        if (obj.parent.args.debug == null) { greenlockargs.log = function (debug) { }; } // If not in debug mode, ignore all console output from greenlock (makes things clean).
        obj.le = greenlock.create(greenlockargs);

        // Hook up GreenLock to the redirection server
        if (obj.parent.redirserver.port == 80) { obj.parent.redirserver.app.use('/', obj.le.middleware()); obj.redirWebServerHooked = true; }

        obj.getCertificate = function (certs, func) {
            if (certs.CommonName.indexOf('.') == -1) { console.log("ERROR: Use --cert to setup the default server name before using Let's Encrypt."); func(certs); return; }
            if (obj.parent.config.letsencrypt == null) { func(certs); return; }
            if (obj.parent.config.letsencrypt.email == null) { console.log("ERROR: Let's Encrypt email address not specified."); func(certs); return; }
            if ((obj.parent.redirserver == null) || (obj.parent.redirserver.port !== 80)) { console.log("ERROR: Redirection web server must be active on port 80 for Let's Encrypt to work."); func(certs); return; }
            if (obj.redirWebServerHooked !== true) { console.log("ERROR: Redirection web server not setup for Let's Encrypt to work."); func(certs); return; }
            if ((obj.parent.config.letsencrypt.rsakeysize != null) && (obj.parent.config.letsencrypt.rsakeysize !== 2048) && (obj.parent.config.letsencrypt.rsakeysize !== 3072)) { console.log("ERROR: Invalid Let's Encrypt certificate key size, must be 2048 or 3072."); func(certs); return; }

            // Get the list of domains
            obj.leDomains = [certs.CommonName];
            if (obj.parent.config.letsencrypt.names != null) {
                if (typeof obj.parent.config.letsencrypt.names == 'string') { obj.parent.config.letsencrypt.names = obj.parent.config.letsencrypt.names.split(','); }
                obj.parent.config.letsencrypt.names.map(function (s) { return s.trim(); }); // Trim each name
                if ((typeof obj.parent.config.letsencrypt.names != 'object') || (obj.parent.config.letsencrypt.names.length == null)) { console.log("ERROR: Let's Encrypt names must be an array in config.json."); func(certs); return; }
                obj.leDomains = obj.parent.config.letsencrypt.names;
                obj.leDomains.sort(); // Sort the array so it's always going to be in the same order.
            }

            obj.le.check({ domains: obj.leDomains }).then(function (results) {
                if (results) {
                    obj.leResults = results;

                    // If we already have real certificates, use them.
                    if (results.altnames.indexOf(certs.CommonName) >= 0) {
                        certs.web.cert = results.cert;
                        certs.web.key = results.privkey;
                        certs.web.ca = [results.chain];
                    }
                    for (var i in obj.parent.config.domains) {
                        if ((obj.parent.config.domains[i].dns != null) && (obj.parent.certificateOperations.compareCertificateNames(results.altnames, obj.parent.config.domains[i].dns))) {
                            certs.dns[i].cert = results.cert;
                            certs.dns[i].key = results.privkey;
                            certs.dns[i].ca = [results.chain];
                        }
                    }
                    func(certs);

                    // Check if the Let's Encrypt certificate needs to be renewed.
                    setTimeout(obj.checkRenewCertificate, 60000); // Check in 1 minute.
                    setInterval(obj.checkRenewCertificate, 86400000); // Check again in 24 hours and every 24 hours.
                    return;
                } else {
                    // Otherwise return default certificates and try to get a real one
                    func(certs);
                }
                console.log("Attempting to get Let's Encrypt certificate, may take a few minutes...");

                // Figure out the RSA key size
                var rsaKeySize = (obj.parent.config.letsencrypt.rsakeysize === 2048) ? 2048 : 3072;

                // TODO: Only register on one of the peers if multi-peers are active.
                // Register Certificate manually
                obj.le.register({
                    domains: obj.leDomains,
                    email: obj.parent.config.letsencrypt.email,
                    agreeTos: true,
                    rsaKeySize: rsaKeySize,
                    challengeType: 'http-01'
                    //renewWithin: 15 * 24 * 60 * 60 * 1000 // 15 days
                    //renewWithin: 81 * 24 * 60 * 60 * 1000, // 81 days
                    //renewBy: 80 * 24 * 60 * 60 * 1000 // 80 days
                }).then(function (xresults) {
                    obj.parent.performServerCertUpdate(); // Reset the server, TODO: Reset all peers
                }, function (err) {
                    console.error("ERROR: Let's encrypt error: ", err);
                });
            });
        };

        // Check if we need to renew the certificate, call this every day.
        obj.checkRenewCertificate = function () {
            if (obj.leResults == null) { return; }
            // TODO: Only renew on one of the peers if multi-peers are active.
            // Check if we need to renew the certificate
            obj.le.renew({ duplicate: false, domains: obj.leDomains, email: obj.parent.config.letsencrypt.email }, obj.leResults).then(function (xresults) {
                obj.parent.performServerCertUpdate(); // Reset the server, TODO: Reset all peers
            }, function (err) { }); // If we can't renew, ignore.
        };

        return obj;
    } catch (ex) { console.log(ex); } // Unable to start Let's Encrypt
    return null;
};