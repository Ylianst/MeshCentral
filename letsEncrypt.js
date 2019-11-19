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

module.exports.CreateLetsEncrypt = function (parent) {
    try {
        // Get the GreenLock version
        var greenLockVersion = null;
        try { greenLockVersion = require('greenlock/package.json').version; } catch (ex) { }
        if (greenLockVersion == null) {
            parent.debug('cert', "Initializing Let's Encrypt support");
        } else {
            parent.debug('cert', "Initializing Let's Encrypt support, using GreenLock v" + greenLockVersion);
        }

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
        obj.leResultsStaging = null;
        obj.performRestart = false; // Indicates we need to restart the server
        obj.performMoveToProduction = false; // Indicates we just got a staging certificate and need to move to production
        obj.runAsProduction = false; // This starts at false and moves to true if staging cert is ok.

        // Setup the certificate storage paths
        obj.configPath = obj.path.join(obj.parent.datapath, 'letsencrypt3');
        try { obj.parent.fs.mkdirSync(obj.configPath); } catch (e) { }
        obj.configPathStaging = obj.path.join(obj.parent.datapath, 'letsencrypt3-staging');
        try { obj.parent.fs.mkdirSync(obj.configPathStaging); } catch (e) { }

        // Setup Let's Encrypt default configuration
        obj.leDefaults = { agreeToTerms: true, store: { module: 'greenlock-store-fs', basePath: obj.configPath } };
        obj.leDefaultsStaging = { agreeToTerms: true, store: { module: 'greenlock-store-fs', basePath: obj.configPathStaging } };

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

        // Check if we need to be in debug mode
        var ledebug = false;
        try { ledebug = ((obj.parent.args.debug != null) || (obj.parent.args.debug.indexOf('cert'))); } catch (ex) { }

        // Create the main GreenLock code module for production.
        var greenlockargs = {
            parent: obj,
            packageRoot: __dirname,
            packageAgent: pkg.name + '/' + pkg.version,
            manager: obj.path.join(__dirname, 'letsencrypt.js'),
            maintainerEmail: maintainerEmail,
            notify: function (ev, args) { if (typeof args == 'string') { parent.debug('cert', ev + ': ' + args); } else { parent.debug('cert', ev + ': ' + JSON.stringify(args)); } },
            staging: false,
            debug: ledebug
        };
        if (obj.parent.args.debug == null) { greenlockargs.log = function (debug) { }; } // If not in debug mode, ignore all console output from greenlock (makes things clean).
        obj.le = greenlock.create(greenlockargs);

        // Create the main GreenLock code module for staging.
        var greenlockargsstaging = {
            parent: obj,
            packageRoot: __dirname,
            packageAgent: pkg.name + '/' + pkg.version,
            manager: obj.path.join(__dirname, 'letsencrypt.js'),
            maintainerEmail: maintainerEmail,
            notify: function (ev, args) { if (typeof args == 'string') { parent.debug('cert', 'Notify: ' + ev + ': ' + args); } else { parent.debug('cert', 'Notify: ' + ev + ': ' + JSON.stringify(args)); } },
            staging: true,
            debug: ledebug
        };
        if (obj.parent.args.debug == null) { greenlockargsstaging.log = function (debug) { }; } // If not in debug mode, ignore all console output from greenlock (makes things clean).
        obj.leStaging = greenlock.create(greenlockargsstaging);

        // Hook up GreenLock to the redirection server
        if (obj.parent.config.settings.rediraliasport === 80) { obj.redirWebServerHooked = true; }
        else if ((obj.parent.config.settings.rediraliasport == null) && (obj.parent.redirserver.port == 80)) { obj.redirWebServerHooked = true; }

        // Respond to a challenge
        obj.challenge = function (token, hostname, func) {
            if (obj.runAsProduction === true) {
                // Production
                parent.debug('cert', "Challenge " + hostname + "/" + token);
                obj.le.challenges.get({ type: 'http-01', servername: hostname, token: token })
                    .then(function (results) { func(results.keyAuthorization); })
                    .catch(function (e) { console.log('LE-ERROR', e); func(null); }); // unexpected error, not related to renewal
            } else {
                // Staging
                parent.debug('cert', "Challenge " + hostname + "/" + token);
                obj.leStaging.challenges.get({ type: 'http-01', servername: hostname, token: token })
                    .then(function (results) { func(results.keyAuthorization); })
                    .catch(function (e) { console.log('LE-ERROR', e); func(null); }); // unexpected error, not related to renewal
            }
        }

        obj.getCertificate = function(certs, func) {
            parent.debug('cert', "Getting certs from local store");
            if (certs.CommonName.indexOf('.') == -1) { console.log("ERROR: Use --cert to setup the default server name before using Let's Encrypt."); func(certs); return; }
            if (obj.parent.config.letsencrypt == null) { func(certs); return; }
            if (obj.parent.config.letsencrypt.email == null) { console.log("ERROR: Let's Encrypt email address not specified."); func(certs); return; }
            if ((obj.parent.redirserver == null) || ((typeof obj.parent.config.settings.rediraliasport === 'number') && (obj.parent.config.settings.rediraliasport !== 80)) || ((obj.parent.config.settings.rediraliasport == null) && (obj.parent.redirserver.port !== 80))) { console.log("ERROR: Redirection web server must be active on port 80 for Let's Encrypt to work."); func(certs); return; }
            if (obj.redirWebServerHooked !== true) { console.log("ERROR: Redirection web server not setup for Let's Encrypt to work."); func(certs); return; }
            if ((obj.parent.config.letsencrypt.rsakeysize != null) && (obj.parent.config.letsencrypt.rsakeysize !== 2048) && (obj.parent.config.letsencrypt.rsakeysize !== 3072)) { console.log("ERROR: Invalid Let's Encrypt certificate key size, must be 2048 or 3072."); func(certs); return; }

            // Get the list of domains
            obj.leDomains = [ certs.CommonName ];
            if (obj.parent.config.letsencrypt.names != null) {
                if (typeof obj.parent.config.letsencrypt.names == 'string') { obj.parent.config.letsencrypt.names = obj.parent.config.letsencrypt.names.split(','); }
                obj.parent.config.letsencrypt.names.map(function (s) { return s.trim(); }); // Trim each name
                if ((typeof obj.parent.config.letsencrypt.names != 'object') || (obj.parent.config.letsencrypt.names.length == null)) { console.log("ERROR: Let's Encrypt names must be an array in config.json."); func(certs); return; }
                obj.leDomains = obj.parent.config.letsencrypt.names;
            }

            if (obj.parent.config.letsencrypt.production !== true) {
                // We are in staging mode, just go ahead
                obj.getCertificateEx(certs, func);
            } else {
                // We are really in production mode
                if (obj.runAsProduction === true) {
                    // Staging cert check must have been done already, move to production
                    obj.getCertificateEx(certs, func);
                } else {
                    // Perform staging certificate check
                    parent.debug('cert', "Checking staging certificate " + obj.leDomains[0] + "...");
                    obj.leStaging.get({ servername: obj.leDomains[0] })
                        .then(function (results) {
                            if (results != null) {
                                // We have a staging certificate, move to production for real
                                parent.debug('cert', "Staging certificate is present, moving to production...");
                                obj.runAsProduction = true;
                                obj.getCertificateEx(certs, func);
                            } else {
                                // No staging certificate
                                parent.debug('cert', "No staging certificate present");
                                func(certs);
                                setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                            }
                        })
                        .catch(function (e) {
                            // No staging certificate
                            parent.debug('cert', "No staging certificate present");
                            func(certs);
                            setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                        });
                }
            }
        }

        obj.getCertificateEx = function (certs, func) {
            // Get the Let's Encrypt certificate from our own storage
            const xle = (obj.runAsProduction === true)? obj.le : obj.leStaging;
            xle.get({ servername: obj.leDomains[0] })
                .then(function (results) {
                    // If we already have real certificates, use them
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
                    parent.debug('cert', "Got certs from local store (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
                    func(certs);

                    // Check if the Let's Encrypt certificate needs to be renewed.
                    setTimeout(obj.checkRenewCertificate, 60000); // Check in 1 minute.
                    setInterval(obj.checkRenewCertificate, 86400000); // Check again in 24 hours and every 24 hours.
                    return;
                })
                .catch(function (e) {
                    parent.debug('cert', "Unable to get certs from local store (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
                    setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                    func(certs);
                });
        }

        // Check if we need to renew the certificate, call this every day.
        obj.checkRenewCertificate = function () {
            obj.certCheckStart = Date.now();

            // Check if there is anything in the let's encrypt folder
            var somethingIsinFolder = false;
            try {
                var filesinFolder = require('fs').readdirSync(obj.runAsProduction ? obj.configPath : obj.configPathStaging);
                somethingIsinFolder = (filesinFolder.indexOf(obj.runAsProduction ? 'live' : 'staging') != -1);
            } catch (ex) { console.log(ex); }

            // Setup renew options
            const xle = (obj.runAsProduction === true) ? obj.le : obj.leStaging;
            var renewOptions = { servername: obj.leDomains[0], altnames: obj.leDomains };

            // Add the domains
            if (somethingIsinFolder == false) {
                try {
                    var addOptions = { subject: obj.leDomains[0], altnames: obj.leDomains };
                    parent.debug('cert', "Adding domains: " + JSON.stringify(addOptions));
                    xle.add(addOptions);
                } catch (ex) {
                    parent.debug('cert', "add certificate exception: (" + JSON.stringify(ex) + ")");
                    console.log(ex);
                }
            }

            /*
            if (somethingIsinFolder == false) {
                parent.debug('cert', "Getting certificate for " + obj.leDomains[0] + " (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
                xle.get({ servername: obj.leDomains[0] })
                    .then(function (results) {
                        if ((results == null) || (typeof results != 'object') || (results.length == 0) || (results[0].error != null)) {
                            parent.debug('cert', "Unable to get a certificate (" + (obj.runAsProduction ? "Production" : "Staging") + ", " + (Date.now() - obj.certCheckStart) + "ms): " + JSON.stringify(results));
                        } else {
                            parent.debug('cert', "Get certificate completed (" + (obj.runAsProduction ? "Production" : "Staging") + ", " + (Date.now() - obj.certCheckStart) + "ms): " + JSON.stringify(results));
                            if (obj.performRestart === true) { parent.debug('cert', "Certs changed, restarting..."); obj.parent.performServerCertUpdate(); } // Reset the server, TODO: Reset all peers
                            else if (obj.performMoveToProduction == true) {
                                parent.debug('cert', "Staging certificate received, moving to production...");
                                obj.runAsProduction = true;
                                obj.performMoveToProduction = false;
                                obj.performRestart = true;
                                setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                            }
                        }
                    })
                    .catch(function (ex) {
                        parent.debug('cert', "getCertificate exception: (" + JSON.stringify(ex) + ")");
                        console.log(ex);
                    });
                return;
            }
            */

            parent.debug('cert', "Checking certificate for " + obj.leDomains[0] + " (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
            try {
                xle.renew(renewOptions)
                    .then(function (results) {
                        if ((results == null) || (typeof results != 'object') || (results.length == 0) || (results[0].error != null)) {
                            parent.debug('cert', "Unable to get a certificate (" + (obj.runAsProduction ? "Production" : "Staging") + ", " + (Date.now() - obj.certCheckStart) + "ms): " + JSON.stringify(results));
                        } else {
                            parent.debug('cert', "Checks completed (" + (obj.runAsProduction ? "Production" : "Staging") + ", " + (Date.now() - obj.certCheckStart) + "ms): " + JSON.stringify(results));
                            if (obj.performRestart === true) { parent.debug('cert', "Certs changed, restarting..."); obj.parent.performServerCertUpdate(); } // Reset the server, TODO: Reset all peers
                            else if (obj.performMoveToProduction == true) {
                                parent.debug('cert', "Staging certificate received, moving to production...");
                                obj.runAsProduction = true;
                                obj.performMoveToProduction = false;
                                obj.performRestart = true;
                                setTimeout(obj.checkRenewCertificate, 10000); // Check the certificate in 10 seconds.
                            }
                        }
                    })
                    .catch(function (ex) {
                        parent.debug('cert', "checkCertificate exception: (" + JSON.stringify(ex) + ")");
                        console.log(ex);
                    });
            } catch (ex) {
                parent.debug('cert', "checkCertificate main exception: (" + JSON.stringify(ex) + ")");
                console.log(ex);
            }
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
        return Promise.resolve([{ subject: options.servername, altnames: options.altnames }]);
    };

    manager.set = function (options) {
        manager.parent.parent.debug('cert', "Certificate has been set: " + JSON.stringify(options));
        if (manager.parent.parent.config.letsencrypt.production == manager.parent.runAsProduction) { manager.parent.performRestart = true; }
        else if ((manager.parent.parent.config.letsencrypt.production === true) && (manager.parent.runAsProduction === false)) { manager.parent.performMoveToProduction = true; }
        return null;
    };

    manager.remove = function (options) {
        manager.parent.parent.debug('cert', "Certificate has been removed: " + JSON.stringify(options));
        if (manager.parent.parent.config.letsencrypt.production == manager.parent.runAsProduction) { manager.parent.performRestart = true; }
        else if ((manager.parent.parent.config.letsencrypt.production === true) && (manager.parent.runAsProduction === false)) { manager.parent.performMoveToProduction = true; }
        return null;
    };

    // set the global config
    manager.defaults = async function (options) {
        var r;
        if (manager.parent.runAsProduction === true) {
            // Production
            //console.log('LE-DEFAULTS-Production', options);
            if (options != null) { for (var i in options) { if (manager.parent.leDefaults[i] == null) { manager.parent.leDefaults[i] = options[i]; } } }
            r = manager.parent.leDefaults;
            var mainsite = { subject: manager.parent.leDomains[0] };
            if (manager.parent.leDomains.length > 0) { mainsite.altnames = manager.parent.leDomains; }
            r.subscriberEmail = manager.parent.parent.config.letsencrypt.email;
            r.sites = { mainsite: mainsite };
        } else {
            // Staging
            //console.log('LE-DEFAULTS-Staging', options);
            if (options != null) { for (var i in options) { if (manager.parent.leDefaultsStaging[i] == null) { manager.parent.leDefaultsStaging[i] = options[i]; } } }
            r = manager.parent.leDefaultsStaging;
            var mainsite = { subject: manager.parent.leDefaultsStaging[0] };
            if (manager.parent.leDefaultsStaging.length > 0) { mainsite.altnames = manager.parent.leDefaultsStaging; }
            r.subscriberEmail = manager.parent.parent.config.letsencrypt.email;
            r.sites = { mainsite: mainsite };
        }
        return r;
    };

    return manager;
};