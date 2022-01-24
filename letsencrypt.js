/**
* @description MeshCentral letsEncrypt module, uses ACME-Client to do all the work.
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
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

// ACME-Client Implementation
var globalLetsEncrypt = null;
module.exports.CreateLetsEncrypt = function (parent) {
    const acme = require('acme-client');
    
    var obj = {};
    obj.fs = require('fs');
    obj.path = require('path');
    obj.parent = parent;
    obj.forge = obj.parent.certificateOperations.forge;
    obj.leDomains = null;
    obj.challenges = {};
    obj.runAsProduction = false;
    obj.redirWebServerHooked = false;
    obj.configErr = null;
    obj.configOk = false;
    obj.pendingRequest = false;

    // Let's Encrypt debug logging
    obj.log = function (str) {
        parent.debug('cert', 'LE: ' + str);
        var d = new Date();
        obj.events.push(d.toLocaleDateString() + ' ' + d.toLocaleTimeString() + ' - ' + str);
        while (obj.events.length > 200) { obj.events.shift(); } // Keep only 200 last events.
    }
    obj.events = [];

    // Setup the certificate storage paths
    obj.certPath = obj.path.join(obj.parent.datapath, 'letsencrypt-certs');
    try { obj.parent.fs.mkdirSync(obj.certPath); } catch (e) { }

    // Hook up GreenLock to the redirection server
    if (obj.parent.config.settings.rediraliasport === 80) { obj.redirWebServerHooked = true; }
    else if ((obj.parent.config.settings.rediraliasport == null) && (obj.parent.redirserver.port == 80)) { obj.redirWebServerHooked = true; }

    // Deal with HTTP challenges
    function challengeCreateFn(authz, challenge, keyAuthorization) { if (challenge.type === 'http-01') { obj.challenges[challenge.token] = keyAuthorization; } }
    function challengeRemoveFn(authz, challenge, keyAuthorization) { if (challenge.type === 'http-01') { delete obj.challenges[challenge.token]; } }
    obj.challenge = function (token, hostname, func) { if (obj.challenges[token] != null) { obj.log("Succesful response to challenge."); } else { obj.log("Failed to respond to challenge, token: " + token + ", table: " + JSON.stringify(obj.challenges) + "."); } func(obj.challenges[token]); }

    // Get the current certificate
    obj.getCertificate = function(certs, func) {
        obj.runAsProduction = (obj.parent.config.letsencrypt.production === true);
        obj.log("Getting certs from local store (" + (obj.runAsProduction ? "Production" : "Staging") + ")");
        if (certs.CommonName.indexOf('.') == -1) { obj.configErr = "Add \"cert\" value to settings in config.json before using Let's Encrypt."; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if (obj.parent.config.letsencrypt == null) { obj.configErr = "No Let's Encrypt configuration"; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if (obj.parent.config.letsencrypt.email == null) { obj.configErr = "Let's Encrypt email address not specified."; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if ((obj.parent.redirserver == null) || ((typeof obj.parent.config.settings.rediraliasport === 'number') && (obj.parent.config.settings.rediraliasport !== 80)) || ((obj.parent.config.settings.rediraliasport == null) && (obj.parent.redirserver.port !== 80))) { obj.configErr = "Redirection web server must be active on port 80 for Let's Encrypt to work."; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if (obj.redirWebServerHooked !== true) { obj.configErr = "Redirection web server not setup for Let's Encrypt to work."; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if ((obj.parent.config.letsencrypt.rsakeysize != null) && (obj.parent.config.letsencrypt.rsakeysize !== 2048) && (obj.parent.config.letsencrypt.rsakeysize !== 3072)) { obj.configErr = "Invalid Let's Encrypt certificate key size, must be 2048 or 3072."; parent.addServerWarning(obj.configErr); obj.log("WARNING: " + obj.configErr); func(certs); return; }
        if (obj.checkInterval == null) { obj.checkInterval = setInterval(obj.checkRenewCertificate, 86400000); } // Call certificate check every 24 hours.
        obj.configOk = true;

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
            obj.log("Reading certificate files");

            // Read the certificate and private key
            var certPem = obj.fs.readFileSync(certFile).toString('utf8');
            var cert = obj.forge.pki.certificateFromPem(certPem);
            var keyPem = obj.fs.readFileSync(keyFile).toString('utf8');
            var key = obj.forge.pki.privateKeyFromPem(keyPem);

            // Decode the certificate common and alt names
            obj.certNames = [cert.subject.getField('CN').value];
            var altNames = cert.getExtension('subjectAltName');
            if (altNames) { for (var i = 0; i < altNames.altNames.length; i++) { var acn = altNames.altNames[i].value.toLowerCase(); if (obj.certNames.indexOf(acn) == -1) { obj.certNames.push(acn); } } }

            // Decode the certificate expire time
            obj.certExpire = cert.validity.notAfter;

            // Use this certificate when possible on any domain
            if (obj.certNames.indexOf(certs.CommonName) >= 0) {
                obj.log("Setting LE cert for default domain.");
                certs.web.cert = certPem;
                certs.web.key = keyPem;
                //certs.web.ca = [results.pems.chain];
            }
            for (var i in obj.parent.config.domains) {
                if ((obj.parent.config.domains[i].dns != null) && (obj.parent.certificateOperations.compareCertificateNames(obj.certNames, obj.parent.config.domains[i].dns))) {
                    obj.log("Setting LE cert for domain " + i + ".");
                    certs.dns[i].cert = certPem;
                    certs.dns[i].key = keyPem;
                    //certs.dns[i].ca = [results.pems.chain];
                }
            }
        } else {
            obj.log("No certificate files found");
        }
        func(certs);
        setTimeout(obj.checkRenewCertificate, 5000); // Hold 5 seconds and check if we need to request a certificate.
    }

    // Check if we need to get a new certificate
    // Return 0 = CertOK, 1 = Request:NoCert, 2 = Request:Expire, 3 = Request:MissingNames
    obj.checkRenewCertificate = function () {
        if (obj.pendingRequest == true) { obj.log("Request for certificate is in process."); return 4; }
        if (obj.certNames == null) {
            obj.log("Got no certificates, asking for one now.");
            obj.requestCertificate();
            return 1;
        } else {
            // Look at the existing certificate to see if we need to renew it
            var daysLeft = Math.floor((obj.certExpire - new Date()) / 86400000);
            obj.log("Certificate has " + daysLeft + " day(s) left.");
            if (daysLeft < 45) {
                obj.log("Asking for new certificate because of expire time.");
                obj.requestCertificate();
                return 2;
            } else {
                var missingDomain = false;
                for (var i in obj.leDomains) {
                    if (obj.parent.certificateOperations.compareCertificateNames(obj.certNames, obj.leDomains[i]) == false) {
                        obj.log("Missing name \"" + obj.leDomains[i] + "\".");
                        missingDomain = true;
                    }
                }
                if (missingDomain) {
                    obj.log("Asking for new certificate because of missing names.");
                    obj.requestCertificate();
                    return 3;
                } else {
                    obj.log("Certificate is ok.");
                }
            }
        }
        return 0;
    }

    obj.requestCertificate = function () {
        if (obj.pendingRequest == true) return;
        if (obj.configOk == false) { obj.log("Can't request cert, invalid configuration."); return; }
        if (acme.forge == null) { obj.log("Forge not setup in ACME, unable to continue."); return; }
        obj.pendingRequest = true;

        // Create a private key
        obj.log("Generating private key...");
        acme.forge.createPrivateKey().then(function (accountKey) {

            // TODO: ZeroSSL
            // https://acme.zerossl.com/v2/DV90

            // Create the ACME client
            obj.log("Setting up ACME client...");
            obj.client = new acme.Client({
                directoryUrl: obj.runAsProduction ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
                accountKey: accountKey
            });

            // Create Certificate Request (CSR)
            obj.log("Creating certificate request...");
            var certRequest = { commonName: obj.leDomains[0] };
            if (obj.leDomains.length > 1) { certRequest.altNames = obj.leDomains; }
            acme.forge.createCsr(certRequest).then(function (r) {
                var csr = r[1];
                obj.tempPrivateKey = r[0];
                obj.log("Requesting certificate from Let's Encrypt...");
                obj.client.auto({
                    csr,
                    email: obj.parent.config.letsencrypt.email,
                    termsOfServiceAgreed: true,
                    skipChallengeVerification: (obj.parent.config.letsencrypt.skipchallengeverification === true),
                    challengeCreateFn,
                    challengeRemoveFn
                }).then(function (cert) {
                    obj.log("Got certificate.");

                    // Save certificate and private key to PEM files
                    var certFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.crt' : 'staging.crt'));
                    var keyFile = obj.path.join(obj.certPath, (obj.runAsProduction ? 'production.key' : 'staging.key'));
                    obj.fs.writeFileSync(certFile, cert);
                    obj.fs.writeFileSync(keyFile, obj.tempPrivateKey);
                    delete obj.tempPrivateKey;

                    // Cause a server restart
                    obj.log("Performing server restart...");
                    obj.parent.performServerCertUpdate();
                }, function (err) {
                    obj.log("Failed to obtain certificate: " + err.message);
                    obj.pendingRequest = false;
                    delete obj.client;
                });
            }, function (err) {
                obj.log("Failed to generate certificate request: " + err.message);
                obj.pendingRequest = false;
                delete obj.client;
            });
        }, function (err) {
            obj.log("Failed to generate private key: " + err.message);
            obj.pendingRequest = false;
            delete obj.client;
        });
    }

    // Return the status of this module
    obj.getStats = function () {
        var r = {
            configOk: obj.configOk,
            leDomains: obj.leDomains,
            challenges: obj.challenges,
            production: obj.runAsProduction,
            webServer: obj.redirWebServerHooked,
            certPath: obj.certPath,
            skipChallengeVerification: (obj.parent.config.letsencrypt.skipchallengeverification == true)
        };
        if (obj.configErr) { r.error = "WARNING: " + obj.configErr; }
        if (obj.certExpire) { r.cert = 'Present'; r.daysLeft = Math.floor((obj.certExpire - new Date()) / 86400000); } else { r.cert = 'None'; }
        return r;
    }

    return obj;
}