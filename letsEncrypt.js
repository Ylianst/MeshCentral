/**
* @description MeshCentral letsEncrypt module, uses GreenLock to do all the work.
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2020
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

// GreenLock Implementation
var globalLetsEncrypt = null;
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

        // Check the current node version and support for generateKeyPair
        if (require('crypto').generateKeyPair == null) { return null; }
        if (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 10) { return null; }

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
        globalLetsEncrypt = obj;
        obj.parent = parent;
        obj.lib = 'greenlock';
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
            parent.debug('cert', "Checking certificate for " + obj.leDomains[0] + " (" + (obj.runAsProduction ? "Production" : "Staging") + ")");

            // Setup renew options
            obj.certCheckStart = Date.now();
            const xle = (obj.runAsProduction === true) ? obj.le : obj.leStaging;
            var renewOptions = { servername: obj.leDomains[0], altnames: obj.leDomains };
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
                return ex;
            }
            return null;
        }

        return obj;
    } catch (ex) { console.log(ex); } // Unable to start Let's Encrypt
    return null;
};

// GreenLock v3 Manager
module.exports.create = function (options) {
    //console.log('xxx-create', options);
    var manager = { parent: globalLetsEncrypt };
    manager.find = async function (options) {
        try {
            // GreenLock sometimes has the bad behavior of adding a wildcard cert request, remove it here if needed.
            if ((options.wildname != null) && (options.wildname != '')) { options.wildname = ''; }
            if (options.altnames) {
                var altnames2 = [];
                for (var i in options.altnames) { if (options.altnames[i].indexOf('*') == -1) { altnames2.push(options.altnames[i]); } }
                options.altnames = altnames2;
            }
            if (options.servernames) {
                var servernames2 = [];
                for (var i in options.servernames) { if (options.servernames[i].indexOf('*') == -1) { servernames2.push(options.servernames[i]); } }
                options.servernames = servernames2;
            }
        } catch (ex) { console.log(ex); }
        return Promise.resolve([{ subject: options.servername, altnames: options.altnames }]);
    };

    manager.set = function (options) {
        //console.log('xxx-set', options);
        manager.parent.parent.debug('cert', "Certificate has been set: " + JSON.stringify(options));
        if (manager.parent.parent.config.letsencrypt.production == manager.parent.runAsProduction) { manager.parent.performRestart = true; }
        else if ((manager.parent.parent.config.letsencrypt.production === true) && (manager.parent.runAsProduction === false)) { manager.parent.performMoveToProduction = true; }
        return null;
    };

    manager.remove = function (options) {
        //console.log('xxx-remove', options);
        manager.parent.parent.debug('cert', "Certificate has been removed: " + JSON.stringify(options));
        if (manager.parent.parent.config.letsencrypt.production == manager.parent.runAsProduction) { manager.parent.performRestart = true; }
        else if ((manager.parent.parent.config.letsencrypt.production === true) && (manager.parent.runAsProduction === false)) { manager.parent.performMoveToProduction = true; }
        return null;
    };

    // set the global config
    manager.defaults = async function (options) {
        //console.log('xxx-defaults', options);
        var r;
        if (manager.parent.runAsProduction === true) {
            // Production
            //console.log('LE-DEFAULTS-Production', options);
            if (options != null) { for (var i in options) { if (manager.parent.leDefaults[i] == null) { manager.parent.leDefaults[i] = options[i]; } } }
            r = manager.parent.leDefaults;
            r.subscriberEmail = manager.parent.parent.config.letsencrypt.email;
            r.sites = { mainsite: { subject: manager.parent.leDomains[0], altnames: manager.parent.leDomains } };
        } else {
            // Staging
            //console.log('LE-DEFAULTS-Staging', options);
            if (options != null) { for (var i in options) { if (manager.parent.leDefaultsStaging[i] == null) { manager.parent.leDefaultsStaging[i] = options[i]; } } }
            r = manager.parent.leDefaultsStaging;
            r.subscriberEmail = manager.parent.parent.config.letsencrypt.email;
            r.sites = { mainsite: { subject: manager.parent.leDomains[0], altnames: manager.parent.leDomains } };
        }
        return r;
    };

    return manager;
};


// ACME-Client Implementation
var globalLetsEncrypt = null;
module.exports.CreateLetsEncrypt2 = function (parent) {
    const acme = require('acme-client');
    
    var obj = {};
    obj.lib = 'acme-client';
    obj.fs = require('fs');
    obj.path = require('path');
    obj.parent = parent;
    obj.forge = obj.parent.certificateOperations.forge;
    obj.leDomains = null;
    obj.challenges = {};
    obj.runAsProduction = false;
    obj.redirWebServerHooked = false;

    // Setup the certificate storage paths
    obj.certPath = obj.path.join(obj.parent.datapath, 'letsencrypt-certs');
    try { obj.parent.fs.mkdirSync(obj.certPath); } catch (e) { }

    // Hook up GreenLock to the redirection server
    if (obj.parent.config.settings.rediraliasport === 80) { obj.redirWebServerHooked = true; }
    else if ((obj.parent.config.settings.rediraliasport == null) && (obj.parent.redirserver.port == 80)) { obj.redirWebServerHooked = true; }

    // Deal with HTTP challenges
    function challengeCreateFn(authz, challenge, keyAuthorization) { if (challenge.type === 'http-01') { obj.challenges[challenge.token] = keyAuthorization; } }
    function challengeRemoveFn(authz, challenge, keyAuthorization) { if (challenge.type === 'http-01') { delete obj.challenges[challenge.token]; } }
    obj.challenge = function (token, hostname, func) { func(obj.challenges[token]); }

    // Get the current certificate
    obj.getCertificate = function(certs, func) {
        obj.runAsProduction = (obj.parent.config.letsencrypt.production === true);
        parent.debug('cert', "LE: Getting certs from local store (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
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

        // Read TLS certificate from the configPath
        var certFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.crt' : 'staging.crt'));
        var keyFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.key' : 'staging.key'));
        if (obj.fs.existsSync(certFile) && obj.fs.existsSync(keyFile)) {
            parent.debug('cert', "LE: Reading certificate files");

            // Read the certificate and private key
            var certPem = obj.fs.readFileSync(certFile).toString('utf8');
            var cert = obj.forge.pki.certificateFromPem(certPem);
            var keyPem = obj.fs.readFileSync(keyFile).toString('utf8');
            var key = obj.forge.pki.privateKeyFromPem(keyPem);

            // Decode the certificate common and alt names
            obj.certNames = [cert.subject.getField('CN').value];
            var altNames = cert.getExtension('subjectAltName');
            if (altNames) { for (i = 0; i < altNames.altNames.length; i++) { var acn = altNames.altNames[i].value.toLowerCase(); if (obj.certNames.indexOf(acn) == -1) { obj.certNames.push(acn); } } }

            // Decode the certificate expire time
            obj.certExpire = cert.validity.notAfter;

            // Use this certificate when possible on any domain
            if (obj.certNames.indexOf(certs.CommonName) >= 0) {
                certs.web.cert = certPem;
                certs.web.key = keyPem;
                //certs.web.ca = [results.pems.chain];
            }
            for (var i in obj.parent.config.domains) {
                if ((obj.parent.config.domains[i].dns != null) && (obj.parent.certificateOperations.compareCertificateNames(obj.certNames, obj.parent.config.domains[i].dns))) {
                    certs.dns[i].cert = certPem;
                    certs.dns[i].key = keyPem;
                    //certs.dns[i].ca = [results.pems.chain];
                }
            }
        } else {
            parent.debug('cert', "LE: No certificate files found");
        }
        func(certs);
        obj.checkRenewCertificate();
    }

    // Check if we need to get a new certificate
    // Return 0 = CertOK, 1 = Request:NoCert, 2 = Request:Expire, 3 = Request:MissingNames
    obj.checkRenewCertificate = function () {
        parent.debug('cert', "LE: Checking certificate");
        if (obj.certNames == null) {
            parent.debug('cert', "LE: Got no certificates, asking for one now.");
            obj.requestCertificate();
            return 1;
        } else {
            // Look at the existing certificate to see if we need to renew it
            var daysLeft = Math.floor((obj.certExpire - new Date()) / 86400000);
            parent.debug('cert', "LE: Certificate has " + daysLeft + " day(s) left.");
            if (daysLeft < 45) {
                parent.debug('cert', "LE: Asking for new certificate because of expire time.");
                obj.requestCertificate();
                return 2;
            } else {
                var missingDomain = false;
                for (var i in obj.leDomains) {
                    if (obj.parent.certificateOperations.compareCertificateNames(obj.certNames, obj.leDomains[i]) == false) {
                        parent.debug('cert', "LE: Missing name " + obj.leDomains[i] + ".");
                        missingDomain = true;
                    }
                }
                if (missingDomain) {
                    parent.debug('cert', "LE: Asking for new certificate because of missing names.");
                    obj.requestCertificate();
                    return 3;
                } else {
                    parent.debug('cert', "LE: Certificate is ok.");
                }
            }
        }
        return 0;
    }

    obj.requestCertificate = function () {
        // Create a private key
        parent.debug('cert', "LE: Generating private key...");
        acme.forge.createPrivateKey().then(function (accountKey) {
            // Create the ACME client
            parent.debug('cert', "LE: Setting up ACME client...");
            obj.client = new acme.Client({
                directoryUrl: obj.runAsProduction ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
                accountKey: accountKey
            });

            // Create Certificate Request (CSR)
            parent.debug('cert', "LE: Creating certificate request...");
            acme.forge.createCsr({
                commonName: obj.leDomains[0],
                altNames: obj.leDomains
            }).then(function (r) {
                var csr = r[1];
                obj.tempPrivateKey = r[0];
                parent.debug('cert', "LE: Requesting certificate from Let's Encrypt...");
                obj.client.auto({
                    csr,
                    email: obj.parent.config.letsencrypt.email,
                    termsOfServiceAgreed: true,
                    challengeCreateFn,
                    challengeRemoveFn
                }).then(function (cert) {
                    parent.debug('cert', "LE: Got certificate.");

                    // Save certificate and private key to PEM files
                    var certFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.crt' : 'staging.crt'));
                    var keyFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.key' : 'staging.key'));
                    obj.fs.writeFileSync(certFile, cert);
                    obj.fs.writeFileSync(keyFile, obj.tempPrivateKey);
                    delete obj.tempPrivateKey;

                    // Cause a server restart
                    parent.debug('cert', "LE: Performing server restart...");
                    obj.parent.performServerCertUpdate();
                }, function (err) {
                    parent.debug('cert', "LE: Failed to obtain certificate: " + err.message);
                });
            }, function (err) {
                parent.debug('cert', "LE: Failed to generate certificate request: " + err.message);
            });
        }, function (err) {
            parent.debug('cert', "LE: Failed to generate private key: " + err.message);
        });
    }

    // Return the status of this module
    obj.getStats = function () {
        var r = {
            lib: 'acme-client',
            leDomains: obj.leDomains,
            challenges: obj.challenges,
            production: obj.runAsProduction,
            webServer: obj.redirWebServerHooked,
            certPath: obj.certPath,
        };
        if (obj.certExpire) { r.daysLeft = Math.floor((obj.certExpire - new Date()) / 86400000); }
        return r;
    }

    return obj;
}