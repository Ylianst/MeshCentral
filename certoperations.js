/**
* @description Certificate generator
* @author Joko Sastriawan / Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
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

module.exports.CertificateOperations = function (parent) {
    var obj = {};

    obj.parent = parent;
    obj.fs = require("fs");
    obj.forge = require("node-forge");
    obj.crypto = require("crypto");
    obj.tls = require('tls');
    obj.pki = obj.forge.pki;
    obj.dirExists = function (filePath) { try { return obj.fs.statSync(filePath).isDirectory(); } catch (err) { return false; } };
    obj.getFilesizeInBytes = function (filename) { try { return obj.fs.statSync(filename).size; } catch (err) { return -1; } };

    // Return the certificate of the remote HTTPS server
    obj.loadPfxCertificate = function (filename, password) {
        var r = { certs: [], keys: [] };
        var pfxbuf = obj.fs.readFileSync(filename);
        var pfxb64 = Buffer.from(pfxbuf).toString('base64');
        var pfxder = obj.forge.util.decode64(pfxb64);
        var asn = obj.forge.asn1.fromDer(pfxder);
        var pfx = obj.forge.pkcs12.pkcs12FromAsn1(asn, true, password);
        // Get the certs from certbags
        var bags = pfx.getBags({ bagType: obj.forge.pki.oids.certBag });
        for (var i = 0; i < bags[obj.forge.pki.oids.certBag].length; i++) { r.certs.push(bags[obj.forge.pki.oids.certBag][i].cert); }
        // Get shrouded key from key bags
        bags = pfx.getBags({ bagType: obj.forge.pki.oids.pkcs8ShroudedKeyBag });
        for (var i = 0; i < bags[obj.forge.pki.oids.pkcs8ShroudedKeyBag].length; i++) { r.keys.push(bags[obj.forge.pki.oids.pkcs8ShroudedKeyBag][i].key); }
        return r;
    }

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
                    func(url, Buffer.from(data.substring(x1 + 27, x2), 'base64').toString('binary'), tag);
                } else {
                    func(url, data, tag);
                }
            });
        } else { func(url, null, tag); }
    };

    // Check if a configuration file exists
    obj.fileExists = function (filename) {
        if ((parent.configurationFiles != null) && (parent.configurationFiles[filename] != null)) { return true; }
        var filePath = parent.getConfigFilePath(filename);
        try { return obj.fs.statSync(filePath).isFile(); } catch (err) { return false; }
    };

    // Load a configuration file
    obj.fileLoad = function (filename, encoding) {
        if ((parent.configurationFiles != null) && (parent.configurationFiles[filename] != null)) {
            return fixEndOfLines(parent.configurationFiles[filename].toString());
        } else {
            return fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath(filename), encoding));
        }
    }

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
                return obj.crypto.createHash('sha384').update(Buffer.from(cert.substring(x1 + 27, x2), 'base64')).digest('hex');
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
                return obj.crypto.createHash('sha384').update(Buffer.from(cert.substring(x1 + 27, x2), 'base64')).digest('binary');
            } else { console.log('ERROR: Unable to decode certificate.'); return null; }
        }
    };

    // Create a self-signed certificate
    obj.GenerateRootCertificate = function (addThumbPrintToName, commonName, country, organization, strong) {
        var keys = obj.pki.rsa.generateKeyPair({ bits: (strong == true) ? 3072 : 2048, e: 0x10001 });
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
        //cert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "nsCertType", sslCA: true, emailCA: true, objCA: true }, { name: "subjectKeyIdentifier" }]);
        cert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "subjectKeyIdentifier" }]);
        cert.sign(keys.privateKey, obj.forge.md.sha384.create());

        return { cert: cert, key: keys.privateKey };
    };

    // Issue a certificate from a root
    obj.IssueWebServerCertificate = function (rootcert, addThumbPrintToName, commonName, country, organization, extKeyUsage, strong) {
        var keys = obj.pki.rsa.generateKeyPair({ bits: (strong == true) ? 3072 : 2048, e: 0x10001 });
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
        //var extensions = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true }, extKeyUsage, { name: "nsCertType", client: false, server: true, email: false, objsign: false, sslCA: false, emailCA: false, objCA: false }, { name: "subjectKeyIdentifier" }];
        var extensions = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", keyCertSign: false, digitalSignature: true, nonRepudiation: false, keyEncipherment: true, dataEncipherment: (extKeyUsage.serverAuth !== true) }, extKeyUsage, { name: "subjectKeyIdentifier" }];
        
        if (extKeyUsage.serverAuth === true) {
            // Set subjectAltName according to commonName parsing. 
            // Ideally, we should let opportunity in given interface to set any type of altNames according to node_forge library
            // such as type 2, 6 and 7. (2 -> DNS, 6 -> URI, 7 -> IP)
            var altNames = [];

            // According to commonName parsing (IP or DNS), add URI and DNS and/or IP altNames
            if (require('net').isIP(commonName)) {
                // set both IP and DNS when commonName is an IP@
                altNames.push({ type: 7, ip: commonName });
                altNames.push({ type: 2, value: commonName });
            } else {
                // set only DNS when commonName is a FQDN
                altNames.push({ type: 2, value: commonName });
            }
            altNames.push({ type: 6, value: "http://" + commonName + "/" })

            // Add localhost stuff for easy testing on localhost ;)
            altNames.push({ type: 2, value: "localhost" });
            altNames.push({ type: 6, value: "http://localhost/" });
            altNames.push({ type: 7, ip: "127.0.0.1" });

            extensions.push({ name: "subjectAltName", altNames: altNames });
        }

        cert.setExtensions(extensions);
        cert.sign(rootcert.key, obj.forge.md.sha384.create());

        return { cert: cert, key: keys.privateKey };
    };

    // Make sure a string with Mac style CR endo of line is changed to Linux LF style.
    function fixEndOfLines(str) {
        if (typeof (str) != 'string') return str; // If this is not a string, do nothing.
        var i = str.indexOf('-----'); // Remove everything before "-----".
        if (i > 0) { str = str.substring(i); } // this solves problems with editors that save text file type indicators ahead of the text.
        if ((typeof(str) != 'string') || (str.indexOf('\n') > 0)) return str; // If there is a \n in the file, keep the file as-is.
        return str.split('\r').join('\n'); // If there is no \n, replace all \r with \n.
    }

    // Return true if the name is found in the certificates names, we support wildcard certificates
    obj.compareCertificateNames = function(certNames, name) {
        if (certNames == null) return false;
        if (certNames.indexOf(name.toLowerCase()) >= 0) return true;
        for (var i in certNames) {
            if ((certNames[i].startsWith('*.') == true) && (name.endsWith(certNames[i].substring(1)) == true)) { return true; }
            if (certNames[i].startsWith('http://*.') == true) {
                if (name.endsWith(certNames[i].substring(8)) == true) { return true; }
                if ((certNames[i].endsWith('/') == true) && (name.endsWith(certNames[i].substring(8, certNames[i].length - 1)) == true)) { return true; }
            }
        }
        return false;
    }

    // Returns the web server TLS certificate and private key, if not present, create demonstration ones.
    obj.GetMeshServerCertificate = function (args, config, func) {
        var i = 0;
        var certargs = args.cert;
        var mpscertargs = args.mpscert;
        var strongCertificate = (args.fastcert ? false : true);
        var rcountmax = 4;
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
        if (obj.fileExists("root-cert-public.crt") && obj.fileExists("root-cert-private.key")) {
            var rootCertificate = obj.fileLoad("root-cert-public.crt", "utf8");
            var rootPrivateKey = obj.fileLoad("root-cert-private.key", "utf8");
            r.root = { cert: rootCertificate, key: rootPrivateKey };
            rcount++;
        }

        if (args.tlsoffload) {
            // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
            if (obj.fileExists("webserver-cert-public.crt")) {
                r.web = { cert: obj.fileLoad("webserver-cert-public.crt", "utf8") };
                rcount++;
            }
        } else {
            // If the web certificate already exist, load it. Load both certificate and private key
            if (obj.fileExists("webserver-cert-public.crt") && obj.fileExists("webserver-cert-private.key")) {
                r.web = { cert: obj.fileLoad("webserver-cert-public.crt", "utf8"), key: obj.fileLoad("webserver-cert-private.key", "utf8") };
                rcount++;
            }
        }

        // If the mps certificate already exist, load it
        if (obj.fileExists("mpsserver-cert-public.crt") && obj.fileExists("mpsserver-cert-private.key")) {
            r.mps = { cert: obj.fileLoad("mpsserver-cert-public.crt", "utf8"), key: obj.fileLoad("mpsserver-cert-private.key", "utf8") };
            rcount++;
        }

        // If the agent certificate already exist, load it
        if (obj.fileExists("agentserver-cert-public.crt") && obj.fileExists("agentserver-cert-private.key")) {
            r.agent = { cert: obj.fileLoad("agentserver-cert-public.crt", "utf8"), key: obj.fileLoad("agentserver-cert-private.key", "utf8") };
            rcount++;
        }

        // If the swarm server certificate exist, load it (This is an optional certificate)
        if (obj.fileExists("swarmserver-cert-public.crt") && obj.fileExists("swarmserver-cert-private.key")) {
            r.swarmserver = { cert: obj.fileLoad("swarmserver-cert-public.crt", "utf8"), key: obj.fileLoad("swarmserver-cert-private.key", "utf8") };
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists("swarmserverroot-cert-public.crt")) {
            r.swarmserverroot = { cert: obj.fileLoad("swarmserverroot-cert-public.crt", "utf8") };
        }

        // If CA certificates are present, load them
        do {
            caok = false;
            if (obj.fileExists("webserver-cert-chain" + caindex + ".crt")) {
                calist.push(obj.fileLoad("webserver-cert-chain" + caindex + ".crt", "utf8"));
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

        if (rcount === rcountmax) {
            // Fetch the certificates names for the main certificate
            r.AmtMpsName = obj.pki.certificateFromPem(r.mps.cert).subject.getField("CN").value;
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            r.WebIssuer = webCertificate.issuer.getField("CN").value;
            r.CommonName = webCertificate.subject.getField("CN").value;
            if (r.CommonName.startsWith('*.')) {
                if (commonName.indexOf('.') == -1) { console.log("ERROR: Must specify a server full domain name in Config.json->Settings->Cert when using a wildcard certificate."); process.exit(0); return; }
                if (commonName.startsWith('*.')) { console.log("ERROR: Server can't use a wildcard name: " + commonName); process.exit(0); return; }
                r.CommonName = commonName;
            }
            r.CommonNames = [ r.CommonName.toLowerCase() ];
            var altNames = webCertificate.getExtension("subjectAltName");
            if (altNames) {
                for (i = 0; i < altNames.altNames.length; i++) {
                    var acn = altNames.altNames[i].value.toLowerCase();
                    if (r.CommonNames.indexOf(acn) == -1) { r.CommonNames.push(acn); }
                }
            }
            var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
            r.RootName = rootCertificate.subject.getField("CN").value;
        }

        // Look for domains that have DNS names and load their certificates
        r.dns = {};
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                // Check if this domain matches a parent wildcard cert, if so, use the parent cert.
                if (obj.compareCertificateNames(r.CommonNames, dnsname) == true) {
                    r.dns[i] = { cert: obj.fileLoad("webserver-cert-public.crt", "utf8"), key: obj.fileLoad("webserver-cert-private.key", "utf8") };
                } else {
                    if (args.tlsoffload) {
                        // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
                        if (obj.fileExists("webserver-" + i + "-cert-public.crt")) {
                            r.dns[i] = { cert: obj.fileLoad("webserver-" + i + "-cert-public.crt", "utf8") };
                            config.domains[i].certs = r.dns[i];
                        } else {
                            console.log("WARNING: File \"webserver-" + i + "-cert-public.crt\" missing, domain \"" + i + "\" will not work correctly.");
                        }
                    } else {
                        // If the web certificate already exist, load it. Load both certificate and private key
                        if (obj.fileExists("webserver-" + i + "-cert-public.crt") && obj.fileExists("webserver-" + i + "-cert-private.key")) {
                            r.dns[i] = { cert: obj.fileLoad("webserver-" + i + "-cert-public.crt", "utf8"), key: obj.fileLoad("webserver-" + i + "-cert-private.key", "utf8") };
                            config.domains[i].certs = r.dns[i];
                            // If CA certificates are present, load them
                            caindex = 1;
                            r.dns[i].ca = [];
                            do {
                                caok = false;
                                if (obj.fileExists("webserver-" + i + "-cert-chain" + caindex + ".crt")) {
                                    r.dns[i].ca.push(obj.fileLoad("webserver-" + i + "-cert-chain" + caindex + ".crt", "utf8"));
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
        }

        if (rcount === rcountmax) {
            if ((certargs == null) && (mpscertargs == null)) { if (func != undefined) { func(r); } return r; } // If no certificate arguments are given, keep the certificate
            var xcountry, xcountryField = webCertificate.subject.getField("C");
            if (xcountryField != null) { xcountry = xcountryField.value; }
            var xorganization, xorganizationField = webCertificate.subject.getField("O");
            if (xorganizationField != null) { xorganization = xorganizationField.value; }
            if (certargs == null) { commonName = r.CommonName; country = xcountry; organization = xorganization; }

            // Check if we have correct certificates
            if (obj.compareCertificateNames(r.CommonNames, commonName) == false) { forceWebCertGen = 1; }
            if (r.AmtMpsName != mpsCommonName) { forceMpsCertGen = 1; }

            // If the certificates matches what we want, use them.
            if ((forceWebCertGen == 0) && (forceMpsCertGen == 0)) {
                if (func !== undefined) { func(r); }
                return r;
            }
        }
        if (parent.configurationFiles != null) { console.log("Error: Database missing some certificates."); process.exit(0); return null; }

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
            if (args.tlsoffload) {
                webCertAndKey = { cert: obj.pki.certificateFromPem(r.web.cert) };
                webCertificate = r.web.cert;
            } else {
                webCertAndKey = { cert: obj.pki.certificateFromPem(r.web.cert), key: obj.pki.privateKeyFromPem(r.web.key) };
                webCertificate = r.web.cert;
                webPrivateKey = r.web.key;
            }
        }
        var webIssuer = webCertAndKey.cert.issuer.getField("CN").value;

        // If the mesh agent server certificate does not exist, create one
        var agentCertAndKey, agentCertificate, agentPrivateKey;
        if (r.agent == null) {
            console.log("Generating MeshAgent certificate...");
            agentCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, true, "MeshCentralAgentServer", country, organization, { }, strongCertificate);
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

        r = { root: { cert: rootCertificate, key: rootPrivateKey }, web: { cert: webCertificate, key: webPrivateKey, ca: [] }, mps: { cert: mpsCertificate, key: mpsPrivateKey }, agent: { cert: agentCertificate, key: agentPrivateKey }, ca: calist, CommonName: commonName, RootName: rootName, AmtMpsName: mpsCommonName, dns: {}, WebIssuer: webIssuer };

        // Fetch the certificates names for the main certificate
        var webCertificate = obj.pki.certificateFromPem(r.web.cert);
        r.WebIssuer = webCertificate.issuer.getField("CN").value;
        r.CommonName = webCertificate.subject.getField("CN").value;
        if (r.CommonName.startsWith('*.')) {
            if (commonName.indexOf('.') == -1) { console.log("ERROR: Must specify a server full domain name in Config.json->Settings->Cert when using a wildcard certificate."); process.exit(0); return; }
            if (commonName.startsWith('*.')) { console.log("ERROR: Server can't use a wildcard name: " + commonName); process.exit(0); return; }
            r.CommonName = commonName;
        }
        r.CommonNames = [r.CommonName.toLowerCase()];
        var altNames = webCertificate.getExtension("subjectAltName");
        if (altNames) { for (i = 0; i < altNames.altNames.length; i++) { r.CommonNames.push(altNames.altNames[i].value.toLowerCase()); } }
        var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
        r.RootName = rootCertificate.subject.getField("CN").value;

        // Look for domains with DNS names that have no certificates and generated them.
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                // Check if this domain matches a parent wildcard cert, if so, use the parent cert.
                if (obj.compareCertificateNames(r.CommonNames, dnsname) == true) {
                    r.dns[i] = { cert: obj.fileLoad("webserver-cert-public.crt", "utf8"), key: obj.fileLoad("webserver-cert-private.key", "utf8") };
                } else {
                    if (!args.tlsoffload) {
                        // If the web certificate does not exist, create it
                        if ((obj.fileExists("webserver-" + i + "-cert-public.crt") === false) || (obj.fileExists("webserver-" + i + "-cert-private.key") === false)) {
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
                                if (obj.fileExists("webserver-" + i + "-cert-chain" + caindex + ".crt")) {
                                    r.dns[i].ca.push(fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("webserver-" + i + "-cert-chain" + caindex + ".crt"), "utf8")));
                                    caok = true;
                                }
                                caindex++;
                            } while (caok === true);
                        }
                    }
                }
            }
        }

        // If the swarm server certificate exist, load it (This is an optional certificate)
        if (obj.fileExists("swarmserver-cert-public.crt") && obj.fileExists("swarmserver-cert-private.key")) {
            r.swarmserver = { cert: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-public.crt"), "utf8")), key: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-private.key"), "utf8")) };
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists("swarmserverroot-cert-public.crt")) {
            r.swarmserverroot = { cert: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("swarmserverroot-cert-public.crt"), "utf8")) };
        }

        // If CA certificates are present, load them
        if (r.web != null) {
            caindex = 1;
            r.web.ca = [];
            do {
                caok = false;
                if (obj.fileExists("webserver-cert-chain" + caindex + ".crt")) {
                    r.web.ca.push(fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("webserver-cert-chain" + caindex + ".crt"), "utf8")));
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
    const acceleratorTotalCount = require("os").cpus().length; // TODO: Check if this accelerator can scale.
    var acceleratorCreateCount = acceleratorTotalCount;
    var freeAccelerators = [];
    var pendingAccelerator = [];
    obj.acceleratorCertStore = null;

    // Accelerator Stats
    var getAcceleratorFuncCalls = 0;
    var acceleratorStartFuncCall = 0;
    var acceleratorPerformSignatureFuncCall = 0;
    var acceleratorPerformSignaturePushFuncCall = 0;
    var acceleratorPerformSignatureRunFuncCall = 0;
    var acceleratorMessage = 0;
    var acceleratorMessageException = 0;
    var acceleratorMessageLastException = null;
    var acceleratorException = 0;
    var acceleratorLastException = null;

    // Get stats about the accelerators
    obj.getAcceleratorStats = function () {
        return {
            acceleratorTotalCount: acceleratorTotalCount,
            acceleratorCreateCount: acceleratorCreateCount,
            freeAccelerators: freeAccelerators.length,
            pendingAccelerator: pendingAccelerator.length,
            getAcceleratorFuncCalls: getAcceleratorFuncCalls,
            startFuncCall: acceleratorStartFuncCall,
            performSignatureFuncCall: acceleratorPerformSignatureFuncCall,
            performSignaturePushFuncCall: acceleratorPerformSignaturePushFuncCall,
            performSignatureRunFuncCall: acceleratorPerformSignatureRunFuncCall,
            message: acceleratorMessage,
            messageException: acceleratorMessageException,
            messageLastException: acceleratorMessageLastException,
            exception: acceleratorException,
            lastException: acceleratorLastException
        };
    }

    // Create a new accelerator module
    obj.getAccelerator = function () {
        getAcceleratorFuncCalls++;
        if (obj.acceleratorCertStore == null) { return null; }
        if (freeAccelerators.length > 0) { return freeAccelerators.pop(); }
        if (acceleratorCreateCount > 0) {
            acceleratorCreateCount--;
            var accelerator = fork(program, [], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
            accelerator.accid = acceleratorCreateCount;
            accelerator.on("message", function (message) {
                acceleratorMessage++;
                this.x.func(this.x.tag, message);
                delete this.x;
                if (pendingAccelerator.length > 0) { this.send(this.x = pendingAccelerator.shift()); } else { freeAccelerators.push(this); }
            });
            accelerator.on("exit", function (code) {
                if (this.x) { pendingAccelerator.push(this.x); delete this.x; }
                acceleratorCreateCount++;
                if (pendingAccelerator.length > 0) { var acc = obj.getAccelerator(); acc.send(acc.x = pendingAccelerator.shift()); }
            });
            accelerator.on("error", function (code) { }); // Not sure if somethign should be done here to help kill the process.
            accelerator.send({ action: "setState", certs: obj.acceleratorCertStore });
            return accelerator;
        }
        return null;
    };

    // Set the state of the accelerators. This way, we don"t have to send certificate & keys to them each time.
    obj.acceleratorStart = function (certificates) {
        acceleratorStartFuncCall++;
        if (obj.acceleratorCertStore != null) { console.error("ERROR: Accelerators can only be started once."); return; }
        obj.acceleratorCertStore = [{ cert: certificates.agent.cert, key: certificates.agent.key }];
        if (certificates.swarmserver != null) { obj.acceleratorCertStore.push({ cert: certificates.swarmserver.cert, key: certificates.swarmserver.key }); }
    };

    // Perform any RSA signature, just pass in the private key and data.
    obj.acceleratorPerformSignature = function (privatekey, data, tag, func) {
        acceleratorPerformSignatureFuncCall++;
        if (acceleratorTotalCount <= 1) {
            // No accelerators available
            if (typeof privatekey == "number") { privatekey = obj.acceleratorCertStore[privatekey].key; }
            const sign = obj.crypto.createSign("SHA384");
            sign.end(Buffer.from(data, "binary"));
            try { func(tag, sign.sign(privatekey).toString("binary")); } catch (ex) { acceleratorMessageException++; acceleratorMessageLastException = ex; }
        } else {
            var acc = obj.getAccelerator();
            if (acc == null) {
                // Add to pending accelerator workload
                acceleratorPerformSignaturePushFuncCall++;
                pendingAccelerator.push({ action: "sign", key: privatekey, data: data, tag: tag, func: func });
            } else {
                // Send to accelerator now
                acceleratorPerformSignatureRunFuncCall++;
                acc.send(acc.x = { action: "sign", key: privatekey, data: data, tag: tag, func: func });
            }
        }
    };

    return obj;
};
