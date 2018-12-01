/**
* @description Certificate generator
* @author Joko Sastriawan / Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

module.exports.CertificateOperations = function () {
    var obj = {};

    obj.fs = require("fs");
    obj.forge = require("node-forge");
    obj.crypto = require("crypto");
    obj.tls = require('tls');
    obj.pki = obj.forge.pki;
    obj.dirExists = function (filePath) { try { return obj.fs.statSync(filePath).isDirectory(); } catch (err) { return false; } };
    obj.getFilesizeInBytes = function (filename) { try { return obj.fs.statSync(filename).size; } catch (err) { return -1; } };
    obj.fileExists = function (filePath) { try { return obj.fs.statSync(filePath).isFile(); } catch (err) { return false; } };

    // Return the certificate of the remote HTTPS server
    obj.loadCertificate = function (url, tag, func) {
        const u = require('url').parse(url);
        if (u.protocol == 'https:') {
            // Read the certificate from HTTPS
            const tlssocket = obj.tls.connect((u.port ? u.port : 443), u.hostname, { servername: u.hostname, rejectUnauthorized: false }, function () { this.xxcert = this.getPeerCertificate(); this.end(); });
            tlssocket.xxurl = url;
            tlssocket.xxfunc = func;
            tlssocket.xxtag = tag;
            tlssocket.on('end', function () { this.xxfunc(this.xxurl, this.xxcert.raw.toString('binary'), this.xxtag); });
            tlssocket.on('error', function () { this.xxfunc(this.xxurl, null, this.xxtag); });
        } else if (u.protocol == 'file:') {
            // Read the certificate from a file
            obj.fs.readFile(url.substring(7), 'utf8', function (err, data) {
                if (err) { func(url, null, tag); return; }
                var x1 = data.indexOf('-----BEGIN CERTIFICATE-----'), x2 = data.indexOf('-----END CERTIFICATE-----');
                if ((x1 >= 0) && (x2 > x1)) {
                    func(url, new Buffer(data.substring(x1 + 27, x2), 'base64').toString('binary'), tag);
                } else {
                    func(url, data, tag);
                }
            });
        } else { func(url, null, tag); }
    };

    // Return the SHA384 hash of the certificate public key
    obj.getPublicKeyHash = function (cert) {
        var publickey = obj.pki.certificateFromPem(cert).publicKey;
        return obj.pki.getPublicKeyFingerprint(publickey, { encoding: "hex", md: obj.forge.md.sha384.create() });
    };

    // Return the SHA384 hash of the certificate, return hex
    obj.getCertHash = function (cert) {
        try {
            var md = obj.forge.md.sha384.create();
            md.update(obj.forge.asn1.toDer(obj.pki.certificateToAsn1(obj.pki.certificateFromPem(cert))).getBytes());
            return md.digest().toHex();
        } catch (ex) {
            // If this is not an RSA certificate, hash the raw PKCS7 out of the PEM file
            var x1 = cert.indexOf('-----BEGIN CERTIFICATE-----'), x2 = cert.indexOf('-----END CERTIFICATE-----');
            if ((x1 >= 0) && (x2 > x1)) {
                return obj.crypto.createHash('sha384').update(new Buffer(cert.substring(x1 + 27, x2), 'base64')).digest('hex');
            } else { console.log('ERROR: Unable to decode certificate.'); return null; }
        }
    };

    // Return the SHA384 hash of the certificate public key
    obj.getPublicKeyHashBinary = function (cert) {
        var publickey = obj.pki.certificateFromPem(cert).publicKey;
        return obj.pki.getPublicKeyFingerprint(publickey, { encoding: "binary", md: obj.forge.md.sha384.create() });
    };

    // Return the SHA384 hash of the certificate, return binary
    obj.getCertHashBinary = function (cert) {
        try {
            // If this is a RSA certificate, we can use Forge to hash the ASN1
            var md = obj.forge.md.sha384.create();
            md.update(obj.forge.asn1.toDer(obj.pki.certificateToAsn1(obj.pki.certificateFromPem(cert))).getBytes());
            return md.digest().getBytes();
        } catch (ex) {
            // If this is not an RSA certificate, hash the raw PKCS7 out of the PEM file
            var x1 = cert.indexOf('-----BEGIN CERTIFICATE-----'), x2 = cert.indexOf('-----END CERTIFICATE-----');
            if ((x1 >= 0) && (x2 > x1)) {
                return obj.crypto.createHash('sha384').update(new Buffer(cert.substring(x1 + 27, x2), 'base64')).digest('binary');
            } else { console.log('ERROR: Unable to decode certificate.'); return null; }
        }
    };

    // Create a self-signed certificate
    obj.GenerateRootCertificate = function (addThumbPrintToName, commonName, country, organization, strong) {
        var keys = obj.pki.rsa.generateKeyPair((strong == true) ? 3072 : 2048);
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = String(Math.floor((Math.random() * 100000) + 1));
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 1); // Create a certificate that is valid one year before, to make sure out-of-sync clocks don"t reject this cert.
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 30);
        if (addThumbPrintToName === true) { commonName += "-" + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: "hex" }).substring(0, 6); }
        if (country == null) { country = "unknown"; }
        if (organization == null) { organization = "unknown"; }
        var attrs = [{ name: "commonName", value: commonName }, { name: "organizationName", value: organization }, { name: "countryName", value: country }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        // Create a root certificate
        cert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "nsCertType", sslCA: true, emailCA: true, objCA: true }, { name: "subjectKeyIdentifier" }]);
        cert.sign(keys.privateKey, obj.forge.md.sha384.create());

        return { cert: cert, key: keys.privateKey };
    };

    // Issue a certificate from a root
    obj.IssueWebServerCertificate = function (rootcert, addThumbPrintToName, commonName, country, organization, extKeyUsage, strong) {
        var keys = obj.pki.rsa.generateKeyPair((strong == true) ? 3072 : 2048);
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = String(Math.floor((Math.random() * 100000) + 1));
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notAfter.getFullYear() - 1); // Create a certificate that is valid one year before, to make sure out-of-sync clocks don"t reject this cert.
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 30);
        if (addThumbPrintToName === true) { commonName += "-" + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: "hex" }).substring(0, 6); }
        var attrs = [{ name: "commonName", value: commonName }];
        if (country != null) { attrs.push({ name: "countryName", value: country }); }
        if (organization != null) { attrs.push({ name: "organizationName", value: organization }); }
        cert.setSubject(attrs);
        cert.setIssuer(rootcert.cert.subject.attributes);

        if (extKeyUsage == null) { extKeyUsage = { name: "extKeyUsage", serverAuth: true }; } else { extKeyUsage.name = "extKeyUsage"; }
        var subjectAltName = null;
        if (extKeyUsage.serverAuth === true) { subjectAltName = { name: "subjectAltName", altNames: [{ type: 6, value: "http://" + commonName + "/" }, { type: 6, value: "http://localhost/" }] }; }
        var extensions = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true }, extKeyUsage, { name: "nsCertType", client: false, server: true, email: false, objsign: false, sslCA: false, emailCA: false, objCA: false }, { name: "subjectKeyIdentifier" }];
        if (subjectAltName != null) { extensions.push(subjectAltName); }
        cert.setExtensions(extensions);
        cert.sign(rootcert.key, obj.forge.md.sha384.create());

        return { cert: cert, key: keys.privateKey };
    };

    // Returns the web server TLS certificate and private key, if not present, create demonstration ones.
    obj.GetMeshServerCertificate = function (parent, args, config, func) {
        var i = 0;
        var certargs = args.cert;
        var mpscertargs = args.mpscert;
        var strongCertificate = (args.fastcert ? false : true);
        var rcountmax = 5;
        var caindex = 1;
        var caok = false;
        var calist = [];
        var dnsname = null;
        // commonName, country, organization

        // If the certificates directory does not exist, create it.
        if (!obj.dirExists(parent.datapath)) { obj.fs.mkdirSync(parent.datapath); }
        var r = {};
        var rcount = 0;

        // If the root certificate already exist, load it
        if (obj.fileExists(parent.getConfigFilePath("root-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("root-cert-private.key"))) {
            var rootCertificate = obj.fs.readFileSync(parent.getConfigFilePath("root-cert-public.crt"), "utf8");
            var rootPrivateKey = obj.fs.readFileSync(parent.getConfigFilePath("root-cert-private.key"), "utf8");
            r.root = { cert: rootCertificate, key: rootPrivateKey };
            rcount++;
        }

        if (args.tlsoffload) {
            // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
            if (obj.fileExists(parent.getConfigFilePath("webserver-cert-public.crt"))) {
                r.web = { cert: obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-public.crt"), "utf8") };
                rcount++;
            }
        } else {
            // If the web certificate already exist, load it. Load both certificate and private key
            if (obj.fileExists(parent.getConfigFilePath("webserver-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("webserver-cert-private.key"))) {
                r.web = { cert: obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-private.key"), "utf8") };
                rcount++;
            }
        }

        // If the mps certificate already exist, load it
        if (obj.fileExists(parent.getConfigFilePath("mpsserver-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("mpsserver-cert-private.key"))) {
            r.mps = { cert: obj.fs.readFileSync(parent.getConfigFilePath("mpsserver-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("mpsserver-cert-private.key"), "utf8") };
            rcount++;
        }

        // If the agent certificate already exist, load it
        if (obj.fileExists(parent.getConfigFilePath("agentserver-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("agentserver-cert-private.key"))) {
            r.agent = { cert: obj.fs.readFileSync(parent.getConfigFilePath("agentserver-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("agentserver-cert-private.key"), "utf8") };
            rcount++;
        }

        // If the console certificate already exist, load it
        if (obj.fileExists(parent.getConfigFilePath("amtconsole-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("agentserver-cert-private.key"))) {
            r.console = { cert: obj.fs.readFileSync(parent.getConfigFilePath("amtconsole-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("amtconsole-cert-private.key"), "utf8") };
            rcount++;
        }

        // If the swarm server certificate exist, load it (This is an optional certificate)
        if (obj.fileExists(parent.getConfigFilePath("swarmserver-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("swarmserver-cert-private.key"))) {
            r.swarmserver = { cert: obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-private.key"), "utf8") };
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists(parent.getConfigFilePath("swarmserverroot-cert-public.crt"))) {
            r.swarmserverroot = { cert: obj.fs.readFileSync(parent.getConfigFilePath("swarmserverroot-cert-public.crt"), "utf8") };
        }

        // If CA certificates are present, load them
        do {
            caok = false;
            if (obj.fileExists(parent.getConfigFilePath("webserver-cert-chain" + caindex + ".crt"))) {
                calist.push(obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-chain" + caindex + ".crt"), "utf8"));
                caok = true;
            }
            caindex++;
        } while (caok === true);
        if (r.web != null) { r.web.ca = calist; }

        // Decode certificate arguments
        var commonName = "un-configured";
        var country = null;
        var organization = null;
        var forceWebCertGen = 0;
        var forceMpsCertGen = 0;
        if (certargs != undefined) {
            var xargs = certargs.split(",");
            if (xargs.length > 0) { commonName = xargs[0]; }
            if (xargs.length > 1) { country = xargs[1]; }
            if (xargs.length > 2) { organization = xargs[2]; }
        }

        // Decode MPS certificate arguments, this is for the Intel AMT CIRA server
        var mpsCommonName = commonName;
        var mpsCountry = country;
        var mpsOrganization = organization;
        if (mpscertargs !== undefined) {
            var xxargs = mpscertargs.split(",");
            if (xxargs.length > 0) { mpsCommonName = xxargs[0]; }
            if (xxargs.length > 1) { mpsCountry = xxargs[1]; }
            if (xxargs.length > 2) { mpsOrganization = xxargs[2]; }
        }

        // Look for domains that have DNS names and load their certificates
        r.dns = {};
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                if (args.tlsoffload) {
                    // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
                    if (obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt"))) {
                        r.dns[i] = { cert: obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt"), "utf8") };
                        config.domains[i].certs = r.dns[i];
                    } else {
                        console.log("WARNING: File \"webserver-" + i + "-cert-public.crt\" missing, domain \"" + i + "\" will not work correctly.");
                    }
                } else {
                    // If the web certificate already exist, load it. Load both certificate and private key
                    if (obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-private.key"))) {
                        r.dns[i] = { cert: obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-private.key"), "utf8") };
                        config.domains[i].certs = r.dns[i];
                        // If CA certificates are present, load them
                        caindex = 1;
                        r.dns[i].ca = [];
                        do {
                            caok = false;
                            if (obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-chain" + caindex + ".crt"))) {
                                r.dns[i].ca.push(obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-chain" + caindex + ".crt"), "utf8"));
                                caok = true;
                            }
                            caindex++;
                        } while (caok === true);
                    } else {
                        rcountmax++; // This certificate must be generated
                    }
                }
            }
        }

        if (rcount === rcountmax) {
            // Fetch the Intel AMT console name
            r.AmtConsoleName = obj.pki.certificateFromPem(r.console.cert).subject.getField("CN").value;
            // Fetch the Intel AMT MPS common name
            r.AmtMpsName = obj.pki.certificateFromPem(r.mps.cert).subject.getField("CN").value;
            // Fetch the name of the server
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            r.WebIssuer = webCertificate.issuer.getField("CN").value;
            r.CommonName = webCertificate.subject.getField("CN").value;
            r.CommonNames = [r.CommonName.toLowerCase()];
            var altNames = webCertificate.getExtension("subjectAltName");
            if (altNames) { for (i = 0; i < altNames.altNames.length; i++) { r.CommonNames.push(altNames.altNames[i].value.toLowerCase()); } }
            var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
            r.RootName = rootCertificate.subject.getField("CN").value;

            if ((certargs == null) && (mpscertargs == null)) { if (func != undefined) { func(r); } return r; } // If no certificate arguments are given, keep the certificate
            var xcountry, xcountryField = webCertificate.subject.getField("C");
            if (xcountryField != null) { xcountry = xcountryField.value; }
            var xorganization, xorganizationField = webCertificate.subject.getField("O");
            if (xorganizationField != null) { xorganization = xorganizationField.value; }
            if (certargs == null) { commonName = r.CommonName; country = xcountry; organization = xorganization; }

            // Check if we have correct certificates
            if ((r.CommonNames.indexOf(commonName.toLowerCase()) >= 0) && (r.AmtMpsName == mpsCommonName)) {
                // Certificate matches what we want, keep it.
                if (func !== undefined) { func(r); }
                return r;
            } else {
                // Check what certificates we really need to re-generate.
                if ((r.CommonNames.indexOf(commonName.toLowerCase()) < 0)) { forceWebCertGen = 1; }
                if (r.AmtMpsName != mpsCommonName) { forceMpsCertGen = 1; }
            }
        }
        console.log("Generating certificates, may take a few minutes...");
        parent.updateServerState("state", "generatingcertificates");

        // If a certificate is missing, but web certificate is present and --cert is not used, set the names to be the same as the web certificate
        if ((certargs == null) && (r.web != null)) {
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            commonName = webCertificate.subject.getField("CN").value;
            var xcountryField = webCertificate.subject.getField("C");
            if (xcountryField != null) { country = xcountryField.value; }
            var xorganizationField = webCertificate.subject.getField("O");
            if (xorganizationField != null) { organization = xorganizationField.value; }
        }

        var rootCertAndKey, rootCertificate, rootPrivateKey, rootName;
        if (r.root == null) {
            // If the root certificate does not exist, create one
            console.log("Generating root certificate...");
            rootCertAndKey = obj.GenerateRootCertificate(true, "MeshCentralRoot", null, null, strongCertificate);
            rootCertificate = obj.pki.certificateToPem(rootCertAndKey.cert);
            rootPrivateKey = obj.pki.privateKeyToPem(rootCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath("root-cert-public.crt"), rootCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath("root-cert-private.key"), rootPrivateKey);
        } else {
            // Keep the root certificate we have
            rootCertAndKey = { cert: obj.pki.certificateFromPem(r.root.cert), key: obj.pki.privateKeyFromPem(r.root.key) };
            rootCertificate = r.root.cert;
            rootPrivateKey = r.root.key;
        }
        var rootName = rootCertAndKey.cert.subject.getField("CN").value;

        // If the web certificate does not exist, create one
        var webCertAndKey, webCertificate, webPrivateKey;
        if ((r.web == null) || (forceWebCertGen == 1)) {
            console.log("Generating HTTPS certificate...");
            webCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization, null, strongCertificate);
            webCertificate = obj.pki.certificateToPem(webCertAndKey.cert);
            webPrivateKey = obj.pki.privateKeyToPem(webCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath("webserver-cert-public.crt"), webCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath("webserver-cert-private.key"), webPrivateKey);
        } else {
            // Keep the console certificate we have
            webCertAndKey = { cert: obj.pki.certificateFromPem(r.web.cert), key: obj.pki.privateKeyFromPem(r.web.key) };
            webCertificate = r.web.cert;
            webPrivateKey = r.web.key;
        }
        var webIssuer = webCertAndKey.cert.issuer.getField("CN").value;

        // If the mesh agent server certificate does not exist, create one
        var agentCertAndKey, agentCertificate, agentPrivateKey;
        if (r.agent == null) {
            console.log("Generating MeshAgent certificate...");
            agentCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, true, "MeshCentralAgentServer", null, strongCertificate);
            agentCertificate = obj.pki.certificateToPem(agentCertAndKey.cert);
            agentPrivateKey = obj.pki.privateKeyToPem(agentCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath("agentserver-cert-public.crt"), agentCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath("agentserver-cert-private.key"), agentPrivateKey);
        } else {
            // Keep the mesh agent server certificate we have
            agentCertAndKey = { cert: obj.pki.certificateFromPem(r.agent.cert), key: obj.pki.privateKeyFromPem(r.agent.key) };
            agentCertificate = r.agent.cert;
            agentPrivateKey = r.agent.key;
        }

        // If the Intel AMT MPS certificate does not exist, create one
        var mpsCertAndKey, mpsCertificate, mpsPrivateKey;
        if ((r.mps == null) || (forceMpsCertGen == 1)) {
            console.log("Generating Intel AMT MPS certificate...");
            mpsCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, mpsCommonName, mpsCountry, mpsOrganization, null, false);
            mpsCertificate = obj.pki.certificateToPem(mpsCertAndKey.cert);
            mpsPrivateKey = obj.pki.privateKeyToPem(mpsCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath("mpsserver-cert-public.crt"), mpsCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath("mpsserver-cert-private.key"), mpsPrivateKey);
        } else {
            // Keep the console certificate we have
            mpsCertAndKey = { cert: obj.pki.certificateFromPem(r.mps.cert), key: obj.pki.privateKeyFromPem(r.mps.key) };
            mpsCertificate = r.mps.cert;
            mpsPrivateKey = r.mps.key;
        }

        // If the Intel AMT console certificate does not exist, create one
        var consoleCertAndKey, consoleCertificate, consolePrivateKey, amtConsoleName = "MeshCentral";
        if (r.console == null) {
            console.log("Generating Intel AMT console certificate...");
            consoleCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, amtConsoleName, country, organization, { name: "extKeyUsage", clientAuth: true, "2.16.840.1.113741.1.2.1": true, "2.16.840.1.113741.1.2.2": true, "2.16.840.1.113741.1.2.3": true }, false); // Intel AMT Remote, Agent and Activation usages
            consoleCertificate = obj.pki.certificateToPem(consoleCertAndKey.cert);
            consolePrivateKey = obj.pki.privateKeyToPem(consoleCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath("amtconsole-cert-public.crt"), consoleCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath("amtconsole-cert-private.key"), consolePrivateKey);
        } else {
            // Keep the console certificate we have
            consoleCertAndKey = { cert: obj.pki.certificateFromPem(r.console.cert), key: obj.pki.privateKeyFromPem(r.console.key) };
            consoleCertificate = r.console.cert;
            consolePrivateKey = r.console.key;
            amtConsoleName = consoleCertAndKey.cert.subject.getField("CN").value;
        }

        r = { root: { cert: rootCertificate, key: rootPrivateKey }, web: { cert: webCertificate, key: webPrivateKey, ca: [] }, mps: { cert: mpsCertificate, key: mpsPrivateKey }, agent: { cert: agentCertificate, key: agentPrivateKey }, console: { cert: consoleCertificate, key: consolePrivateKey }, ca: calist, CommonName: commonName, RootName: rootName, AmtConsoleName: amtConsoleName, AmtMpsName: mpsCommonName, dns: {}, WebIssuer: webIssuer };

        // Look for domains with DNS names that have no certificates and generated them.
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                if (!args.tlsoffload) {
                    // If the web certificate does not exist, create it
                    if ((obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt")) === false) || (obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-private.key")) === false)) {
                        console.log("Generating HTTPS certificate for " + i + "...");
                        var xwebCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, dnsname, country, organization, null, strongCertificate);
                        var xwebCertificate = obj.pki.certificateToPem(xwebCertAndKey.cert);
                        var xwebPrivateKey = obj.pki.privateKeyToPem(xwebCertAndKey.key);
                        obj.fs.writeFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-public.crt"), xwebCertificate);
                        obj.fs.writeFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-private.key"), xwebPrivateKey);
                        r.dns[i] = { cert: xwebCertificate, key: xwebPrivateKey };
                        config.domains[i].certs = r.dns[i];

                        // If CA certificates are present, load them
                        caindex = 1;
                        r.dns[i].ca = [];
                        do {
                            caok = false;
                            if (obj.fileExists(parent.getConfigFilePath("webserver-" + i + "-cert-chain" + caindex + ".crt"))) {
                                r.dns[i].ca.push(obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-chain" + caindex + ".crt"), "utf8"));
                                caok = true;
                            }
                            caindex++;
                        } while (caok === true);
                    }
                }
            }
        }

        // If the swarm server certificate exist, load it (This is an optional certificate)
        if (obj.fileExists(parent.getConfigFilePath("swarmserver-cert-public.crt")) && obj.fileExists(parent.getConfigFilePath("swarmserver-cert-private.key"))) {
            r.swarmserver = { cert: obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-public.crt"), "utf8"), key: obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-private.key"), "utf8") };
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists(parent.getConfigFilePath("swarmserverroot-cert-public.crt"))) {
            r.swarmserverroot = { cert: obj.fs.readFileSync(parent.getConfigFilePath("swarmserverroot-cert-public.crt"), "utf8") };
        }

        // If CA certificates are present, load them
        if (r.web != null) {
            caindex = 1;
            r.web.ca = [];
            do {
                caok = false;
                if (obj.fileExists(parent.getConfigFilePath("webserver-cert-chain" + caindex + ".crt"))) {
                    r.web.ca.push(obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-chain" + caindex + ".crt"), "utf8"));
                    caok = true;
                }
                caindex++;
            } while (caok === true);
        }

        if (func != undefined) { func(r); }
        return r;
    };

    // Accelerators, used to dispatch work to other processes
    const fork = require("child_process").fork;
    const program = require("path").join(__dirname, "meshaccelerator.js");
    const acceleratorTotalCount = require("os").cpus().length;
    var acceleratorCreateCount = acceleratorTotalCount;
    var freeAccelerators = [];
    var pendingAccelerator = [];
    obj.acceleratorCertStore = null;

    // Create a new accelerator module
    obj.getAccelerator = function () {
        if (obj.acceleratorCertStore == null) { return null; }
        if (freeAccelerators.length > 0) { return freeAccelerators.pop(); }
        if (acceleratorCreateCount > 0) {
            acceleratorCreateCount--;
            var accelerator = fork(program, [], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
            accelerator.accid = acceleratorCreateCount;
            accelerator.on("message", function (message) {
                this.func(this.tag, message);
                delete this.tag;
                if (pendingAccelerator.length > 0) {
                    var x = pendingAccelerator.shift();
                    if (x.tag) { this.tag = x.tag; delete x.tag; }
                    accelerator.send(x);
                } else { freeAccelerators.push(this); }
            });
            accelerator.send({ action: "setState", certs: obj.acceleratorCertStore });
            return accelerator;

        }
        return null;
    };

    // Set the state of the accelerators. This way, we don"t have to send certificate & keys to them each time.
    obj.acceleratorStart = function (certificates) {
        if (obj.acceleratorCertStore != null) { console.error("ERROR: Accelerators can only be started once."); return; }
        obj.acceleratorCertStore = [{ cert: certificates.agent.cert, key: certificates.agent.key }];
        if (certificates.swarmserver != null) { obj.acceleratorCertStore.push({ cert: certificates.swarmserver.cert, key: certificates.swarmserver.key }); }
    };

    // Perform any RSA signature, just pass in the private key and data.
    obj.acceleratorPerformSignature = function (privatekey, data, tag, func) {
        if (acceleratorTotalCount <= 1) {
            // No accelerators available
            if (typeof privatekey == "number") { privatekey = obj.acceleratorCertStore[privatekey].key; }
            const sign = obj.crypto.createSign("SHA384");
            sign.end(new Buffer(data, "binary"));
            func(tag, sign.sign(privatekey).toString("binary"));
        } else {
            var acc = obj.getAccelerator();
            if (acc == null) {
                // Add to pending accelerator workload
                pendingAccelerator.push({ action: "sign", key: privatekey, data: data, tag: tag });
            } else {
                // Send to accelerator now
                acc.func = func;
                acc.tag = tag;
                acc.send({ action: "sign", key: privatekey, data: data });
            }
        }
    };

    return obj;
};
