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
'use strict';

module.exports.CreateLetsEncrypt = function(parent) {
    try {
        parent.debug('cert', "Initializing Let's Encrypt support");

        // Check the current node version
        if (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 8) { return null; }

        // Try to delete the "./ursa-optional" or "./node_modules/ursa-optional" folder if present.
        // This is an optional module that GreenLock uses that causes issues.
        try {
            const fs = require('fs');
            if (fs.existsSync(parent.path.join(__dirname, 'ursa-optional'))) { fs.unlinkSync(obj.path.join(__dirname, 'ursa-optional')); }
            if (fs.existsSync(parent.path.join(__dirname, 'node_modules', 'ursa-optional'))) { fs.unlinkSync(obj.path.join(__dirname, 'node_modules', 'ursa-optional')); }
        } catch (ex) { }

        // Get GreenLock setup and running.
        const greenlock = require('greenlock');
        var obj = {};
        obj.parent = parent;
        obj.path = require('path');
        obj.redirWebServerHooked = false;
        obj.leDomains = null;
        obj.leResults = null;
        obj.performRestart = false;

        // Setup the certificate storage paths
        obj.configPath = obj.path.join(obj.parent.datapath, 'letsencrypt');
        try { obj.parent.fs.mkdirSync(obj.configPath); } catch (e) { }

        // Setup Let's Encrypt default configuration
        obj.leDefaults = {
            agreeToTerms: true,
            //serverKeyType: 'RSA-2048', // Seems like only "RSA-2048" or "P-256" is supported.
            store: {
                module: 'greenlock-store-fs',
                basePath: obj.configPath
            }
        };

        // Get package and maintainer email
        const pkg = require('./package.json');
        var maintainerEmail = null;
        if (typeof pkg.author == 'string') {
            // Older NodeJS
            maintainerEmail = pkg.author;
            var i = maintainerEmail.indexOf('<');
            if (i >= 0) { maintainerEmail = maintainerEmail.substring(i + 1); }
            var i = maintainerEmail.indexOf('>');
            if (i >= 0) { maintainerEmail = maintainerEmail.substring(0, i); }
        } else if (typeof pkg.author == 'object') {
            // Latest NodeJS
            maintainerEmail = pkg.author.email;
        }
                
        // Create the main GreenLock code module.
        var greenlockargs = {
            parent: obj,
            packageRoot: __dirname,
            packageAgent: pkg.name + '/' + pkg.version,
            manager: obj.path.join(__dirname, 'letsencrypt.js'),
            maintainerEmail: maintainerEmail,
            notify: function (ev, args) { if (typeof args == 'string') { parent.debug('cert', ev + ': ' + args); } else { parent.debug('cert', ev + ': ' + JSON.stringify(args)); } },
            staging: (obj.parent.config.letsencrypt.production !== true),
            debug: (obj.parent.args.debug > 0)
        };

        if (obj.parent.args.debug == null) { greenlockargs.log = function (debug) { }; } // If not in debug mode, ignore all console output from greenlock (makes things clean).
        obj.le = greenlock.create(greenlockargs);

        // Hook up GreenLock to the redirection server
        if (obj.parent.redirserver.port == 80) { obj.redirWebServerHooked = true; }

        // Respond to a challenge
        obj.challenge = function (token, hostname, func) {
            parent.debug('cert', "Challenge " + hostname + "/" + token);
            obj.le.challenges.get({ type: 'http-01', servername: hostname, token: token })
                .then(function (results) { func(results.keyAuthorization); })
                .catch(function (e) { console.log('LE-ERROR', e); func(null); }); // unexpected error, not related to renewal
        }

        obj.getCertificate = function (certs, func) {
            parent.debug('cert', "Getting certs from local store");
            if (certs.CommonName.indexOf('.') == -1) { console.log("ERROR: Use --cert to setup the default server name before using Let's Encrypt."); func(certs); return; }
            if (obj.parent.config.letsencrypt == null) { func(certs); return; }
            if (obj.parent.config.letsencrypt.email == null) { console.log("ERROR: Let's Encrypt email address not specified."); func(certs); return; }
            if ((obj.parent.redirserver == null) || (obj.parent.redirserver.port !== 80)) { console.log("ERROR: Redirection web server must be active on port 80 for Let's Encrypt to work."); func(certs); return; }
            if (obj.redirWebServerHooked !== true) { console.log("ERROR: Redirection web server not setup for Let's Encrypt to work."); func(certs); return; }
            if ((obj.parent.config.letsencrypt.rsakeysize != null) && (obj.parent.config.letsencrypt.rsakeysize !== 2048) && (obj.parent.config.letsencrypt.rsakeysize !== 3072)) { console.log("ERROR: Invalid Let's Encrypt certificate key size, must be 2048 or 3072."); func(certs); return; }

            // Get the list of domains
            obj.leDomains = [ certs.CommonName ];
            if (obj.parent.config.letsencrypt.names != null) {
                if (typeof obj.parent.config.letsencrypt.names == 'string') { obj.parent.config.letsencrypt.names = obj.parent.config.letsencrypt.names.split(','); }
                obj.parent.config.letsencrypt.names.map(function (s) { return s.trim(); }); // Trim each name
                if ((typeof obj.parent.config.letsencrypt.names != 'object') || (obj.parent.config.letsencrypt.names.length == null)) { console.log("ERROR: Let's Encrypt names must be an array in config.json."); func(certs); return; }
                obj.leDomains = obj.parent.config.letsencrypt.names;
                obj.leDomains.sort(); // Sort the array so it's always going to be in the same order.
            }

            // Get altnames
            obj.altnames = [];
            obj.servername = certs.CommonName;
            for (var i in obj.leDomains) { if (obj.leDomains[i] != certs.CommonName) { obj.altnames.push(obj.leDomains[i]); } }

            // Get the Let's Encrypt certificate from our own storage
            obj.le.get({ servername: certs.CommonName })
                .then(function (results) {
                    // If we already have real certificates, use them.
                    if (results) {
                        if (results.site.altnames.indexOf(certs.CommonName) >= 0) {
                            certs.web.cert = results.pems.cert;
                            certs.web.key = results.pems.privkey;
                            certs.web.ca = [results.pems.chain];
                        }
                        for (var i in obj.parent.config.domains) {
                            if ((obj.parent.config.domains[i].dns != null) && (obj.parent.certificateOperations.compareCertificateNames(results.site.altnames, obj.parent.config.domains[i].dns))) {
                                certs.dns[i].cert = results.pems.cert;
                                certs.dns[i].key = results.pems.privkey;
                                certs.dns[i].ca = [results.pems.chain];
                            }
                        }
                    }
                    parent.debug('cert', "Got certs from local store");
                    func(certs);

                    // Check if the Let's Encrypt certificate needs to be renewed.
                    setTimeout(obj.checkRenewCertificate, 60000); // Check in 1 minute.
                    setInterval(obj.checkRenewCertificate, 86400000); // Check again in 24 hours and every 24 hours.
                    return;
                })
                .catch(function (e) {
                    parent.debug('cert', "Unable to get certs from local store");
                    setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                    func(certs);
                });
        }

        // Check if we need to renew the certificate, call this every day.
        obj.checkRenewCertificate = function () {
            parent.debug('cert', "Checking certs");

            // Setup renew options
            var renewOptions = { servername: obj.servername };
            if (obj.altnames.length > 0) { renewOptions.altnames = obj.altnames; }
            obj.le.renew(renewOptions)
                .then(function (results) {
                    parent.debug('cert', "Checks completed");
                    if (obj.performRestart === true) { parent.debug('cert', "Certs changed, restarting..."); obj.parent.performServerCertUpdate(); } // Reset the server, TODO: Reset all peers
                })
                .catch(function (e) { console.log(e); func(certs); });
        }

        return obj;
    } catch (ex) { console.log(ex); } // Unable to start Let's Encrypt
    return null;
};

// GreenLock v3 Manager
module.exports.create = function (options) {
    var manager = { parent: options.parent };
    manager.find = async function (options) {
        //console.log('LE-FIND', options);
        return Promise.resolve([ { subject: options.servername, altnames: options.altnames } ]);
    };

    manager.set = function (options) {
        manager.parent.parent.debug('cert', "Certificate has been set");
        manager.parent.performRestart = true;
        return null;
    };

    manager.remove = function (options) {
        manager.parent.parent.debug('cert', "Certificate has been removed");
        manager.parent.performRestart = true;
        return null;
    };

    // set the global config
    manager.defaults = async function (options) {
        //console.log('LE-DEFAULTS', options);
        if (options != null) { for (var i in options) { if (manager.parent.leDefaults[i] == null) { manager.parent.leDefaults[i] = options[i]; } } }
        var r = manager.parent.leDefaults;
        var mainsite = { subject: manager.parent.servername };
        if (manager.parent.altnames.length > 0) { mainsite.altnames = manager.parent.altnames; }
        r.subscriberEmail = manager.parent.parent.config.letsencrypt.email;
        r.sites = { mainsite: mainsite };
        return r;
    };

    return manager;
};