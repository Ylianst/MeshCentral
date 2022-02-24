/**
* @description Certificate generator
* @author Joko Sastriawan / Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
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
    obj.fs = require('fs');
    obj.forge = require('node-forge');
    obj.crypto = require('crypto');
    obj.tls = require('tls');
    obj.pki = obj.forge.pki;
    obj.dirExists = function (filePath) { try { return obj.fs.statSync(filePath).isDirectory(); } catch (err) { return false; } };
    obj.getFilesizeInBytes = function (filename) { try { return obj.fs.statSync(filename).size; } catch (err) { return -1; } };

    const TopLevelDomainExtendedSupport = { 'net': 2, 'com': 2, 'arpa': 3, 'org': 2, 'gov': 2, 'edu': 2, 'de': 2, 'fr': 3, 'cn': 3, 'nl': 3, 'br': 3, 'mx': 3, 'uk': 3, 'pl': 3, 'tw': 3, 'ca': 3, 'fi': 3, 'be': 3, 'ru': 3, 'se': 3, 'ch': 2, 'dk': 2, 'ar': 3, 'es': 3, 'no': 3, 'at': 3, 'in': 3, 'tr': 3, 'cz': 2, 'ro': 3, 'hu': 3, 'nz': 3, 'pt': 3, 'il': 3, 'gr': 3, 'co': 3, 'ie': 3, 'za': 3, 'th': 3, 'sg': 3, 'hk': 3, 'cl': 2, 'lt': 3, 'id': 3, 'hr': 3, 'ee': 3, 'bg': 3, 'ua': 2 };

    // Return true if the trusted FQDN matched the certificate common name
    function checkAcmActivationCertName(commonName, trustedFqdn) {
        commonName = commonName.toLowerCase();
        trustedFqdn = trustedFqdn.toLowerCase();
        if (commonName.startsWith('*.') && (commonName.length > 2)) { commonName = commonName.substring(2); }
        return ((commonName == trustedFqdn) || (trustedFqdn.endsWith('.' + commonName)));
    }

    // Sign a Intel AMT TLS ACM activation request
    obj.getAcmCertChain = function (domain, fqdn, hash) {
        if ((domain == null) || (domain.amtacmactivation == null) || (domain.amtacmactivation.certs == null) || (fqdn == null) || (hash == null)) return { action: 'acmactivate', error: 1, errorText: 'Invalid arguments' };
        if (parent.common.validateString(fqdn, 4, 256) == false) return { action: 'acmactivate', error: 1, errorText: "Invalid FQDN argument." };
        if (parent.common.validateString(hash, 16, 256) == false) return { action: 'acmactivate', error: 1, errorText: "Invalid hash argument." };

        // Look for the signing certificate
        var signkey = null, certChain = null, hashAlgo = null, certIndex = null;
        for (var i in domain.amtacmactivation.certs) {
            const certEntry = domain.amtacmactivation.certs[i];
            if ((certEntry.sha256 == hash) && ((certEntry.cn == '*') || checkAcmActivationCertName(certEntry.cn, fqdn))) { hashAlgo = 'sha256'; signkey = certEntry.key; certChain = certEntry.certs; certIndex = i; break; }
            if ((certEntry.sha1 == hash) && ((certEntry.cn == '*') || checkAcmActivationCertName(certEntry.cn, fqdn))) { hashAlgo = 'sha1'; signkey = certEntry.key; certChain = certEntry.certs; certIndex = i; break; }
        }
        if (signkey == null) return { action: 'acmactivate', error: 2, errorText: "Can't create ACM cert chain, no signing certificate found." }; // Did not find a match.

        // If the matching certificate our wildcard root cert, we can use the root to match any FQDN
        if (domain.amtacmactivation.certs[certIndex].cn == '*') {
            // Create a leaf certificate that matches the FQDN we want
            // TODO: This is an expensive operation, work on ways to pre-generate or cache this leaf certificate.
            var rootcert = { cert: domain.amtacmactivation.certs[certIndex].rootcert, key: obj.pki.privateKeyFromPem(domain.amtacmactivation.certs[certIndex].key) };
            var leafcert = obj.IssueWebServerCertificate(rootcert, false, fqdn, 'mc', 'Intel(R) Client Setup Certificate', { serverAuth: true, '2.16.840.1.113741.1.2.3': true }, false);

            // Setup the certificate chain and key
            certChain = [ obj.pki.certificateToPem(leafcert.cert), obj.pki.certificateToPem(domain.amtacmactivation.certs[certIndex].rootcert) ];
            signkey = obj.pki.privateKeyToPem(leafcert.key);
        } else {
            // Make sure the cert chain is in PEM format
            var certChain2 = [];
            for (var i in certChain) { certChain2.push("-----BEGIN CERTIFICATE-----\r\n" + certChain[i] + "\r\n-----END CERTIFICATE-----\r\n"); }
            certChain = certChain2;
        }

        // Hash the leaf certificate and return the certificate chain and signing key
        return { action: 'acmactivate', certs: certChain, signkey: signkey, hash384: obj.getCertHash(certChain[0]), hash256: obj.getCertHashSha256(certChain[0]) };
    }

    // Sign a Intel AMT ACM activation request
    obj.signAcmRequest = function (domain, request, user, pass, ipport, nodeid, meshid, computerName, agentId) {
        if ((domain == null) || (domain.amtacmactivation == null) || (domain.amtacmactivation.certs == null) || (request == null) || (request.nonce == null) || (request.realm == null) || (request.fqdn == null) || (request.hash == null)) return { 'action': 'acmactivate', 'error': 1, 'errorText': 'Invalid arguments' };
        if (parent.common.validateString(request.nonce, 16, 256) == false) return { 'action': 'acmactivate', 'error': 1, 'errorText': "Invalid nonce argument." };
        if (parent.common.validateString(request.realm, 16, 256) == false) return { 'action': 'acmactivate', 'error': 1, 'errorText': "Invalid realm argument." };
        if (parent.common.validateString(request.fqdn, 4, 256) == false) return { 'action': 'acmactivate', 'error': 1, 'errorText': "Invalid FQDN argument." };
        if (parent.common.validateString(request.hash, 16, 256) == false) return { 'action': 'acmactivate', 'error': 1, 'errorText': "Invalid hash argument." };
        if (parent.common.validateString(request.uuid, 36, 36) == false) return { 'action': 'acmactivate', 'error': 1, 'errorText': "Invalid UUID argument." };

        // Look for the signing certificate
        var signkey = null, certChain = null, hashAlgo = null, certIndex = null;
        for (var i in domain.amtacmactivation.certs) {
            const certEntry = domain.amtacmactivation.certs[i];
            if ((certEntry.sha256 == request.hash) && ((certEntry.cn == '*') || checkAcmActivationCertName(certEntry.cn, request.fqdn))) { hashAlgo = 'sha256'; signkey = certEntry.key; certChain = certEntry.certs; certIndex = i; break; }
            if ((certEntry.sha1 == request.hash) && ((certEntry.cn == '*') || checkAcmActivationCertName(certEntry.cn, request.fqdn))) { hashAlgo = 'sha1'; signkey = certEntry.key; certChain = certEntry.certs; certIndex = i; break; }
        }
        if (signkey == null) return { 'action': 'acmactivate', 'error': 2, 'errorText': "Can't sign ACM request, no signing certificate found." }; // Did not find a match.

        // If the matching certificate our wildcard root cert, we can use the root to match any FQDN
        if (domain.amtacmactivation.certs[certIndex].cn == '*') {
            // Create a leaf certificate that matches the FQDN we want
            // TODO: This is an expensive operation, work on ways to pre-generate or cache this leaf certificate.
            var rootcert = { cert: domain.amtacmactivation.certs[certIndex].rootcert, key: obj.pki.privateKeyFromPem(domain.amtacmactivation.certs[certIndex].key) };
            var leafcert = obj.IssueWebServerCertificate(rootcert, false, request.fqdn, 'mc', 'Intel(R) Client Setup Certificate', { serverAuth: true, '2.16.840.1.113741.1.2.3': true }, false);

            // Setup the certificate chain and key
            certChain = [pemToBase64(obj.pki.certificateToPem(leafcert.cert)), pemToBase64(obj.pki.certificateToPem(domain.amtacmactivation.certs[certIndex].rootcert))];
            signkey = obj.pki.privateKeyToPem(leafcert.key);
        }

        // Setup both nonces, ready to be signed
        const mcNonce = Buffer.from(obj.crypto.randomBytes(20), 'binary');
        const fwNonce = Buffer.from(request.nonce, 'base64');

        // Sign the request
        var signature = null;
        try {
            var signer = obj.crypto.createSign(hashAlgo);
            signer.update(Buffer.concat([fwNonce, mcNonce]));
            signature = signer.sign(signkey, 'base64');
        } catch (ex) {
            return { 'action': 'acmactivate', 'error': 4, 'errorText': "Unable to perform signature." };
        }

        // Log the activation request, logging is a required step for activation.
        if (obj.logAmtActivation(domain, { time: new Date(), action: 'acmactivate', domain: domain.id, amtUuid: request.uuid, certHash: request.hash, hashType: hashAlgo, amtRealm: request.realm, amtFqdn: request.fqdn, user: user, password: pass, ipport: ipport, nodeid: nodeid, meshid: meshid, computerName: computerName, agentId: agentId, tag: request.tag, name: request.name }) == false) return { 'action': 'acmactivate', 'error': 5, 'errorText': "Unable to log operation." };

        // Return the signature with the computed account password hash
        return { 'action': 'acmactivate', 'signature': signature, 'password': obj.crypto.createHash('md5').update(user + ':' + request.realm + ':' + pass).digest('hex'), 'nonce': mcNonce.toString('base64'), 'certs': certChain };
    }

    // Remove the PEM header, footer and carriage returns so we only have the Base64 DER.
    function pemToBase64(pem) { return pem.split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('').split('\r\n').join(''); }

    // Return true if both arrays match
    function compareArrays(a1, a2) {
        if (Array.isArray(a1) == false) return false;
        if (Array.isArray(a2) == false) return false;
        if (a1.length !== a2.length) return false;
        for (var i = 0; i < a1.length; i++) { if (a1[i] !== a2[i]) return false; }
        return true;
    }

    // Log the Intel AMT activation operation in the domain log
    obj.logAmtActivation = function (domain, x) {
        if (x == null) return true;

        // Add the password to the Intel AMT list of UUID to passwords
        if ((typeof x.amtUuid == 'string') && (typeof x.password == 'string')) {
            if (parent.amtPasswords == null) { parent.amtPasswords = {}; }
            if (parent.amtPasswords[x.amtUuid] == null) {
                parent.amtPasswords[x.amtUuid] = [x.password]; // Add password to array
                parent.amtPasswords = parent.common.sortObj(parent.amtPasswords);
            } else {
                if (parent.amtPasswords[x.amtUuid].indexOf(x.password) == -1) {
                    parent.amtPasswords[x.amtUuid].unshift(x.password); // Add password at the start of the array
                    while (parent.amtPasswords[x.amtUuid].length > 3) { parent.amtPasswords[x.amtUuid].pop(); } // Only keep the 3 last passwords for any given device
                }
            }
        }

        // Append to the log file
        var logpath = null;
        if ((domain.amtacmactivation == null) || (domain.amtacmactivation.log == null) || (typeof domain.amtacmactivation.log != 'string')) {
            if (domain.id == '') { logpath = parent.path.join(obj.parent.datapath, 'amtactivation.log'); } else { logpath = parent.path.join(obj.parent.datapath, 'amtactivation-' + domain.id + '.log'); }
        } else {
            logpath = parent.common.joinPath(obj.parent.datapath, domain.amtacmactivation.log);
        }
        try { obj.fs.appendFileSync(logpath, JSON.stringify(x) + '\r\n'); } catch (ex) { console.log(ex); return false; }
        return true;
    }

    // Load Intel AMT ACM activation certificates
    obj.loadIntelAmtAcmCerts = function (amtacmactivation) {
        if (amtacmactivation == null) return;
        var acmCerts = [], acmmatch = [];
        amtacmactivation.acmCertErrors = [];
        if (amtacmactivation.certs != null) {
            for (var j in amtacmactivation.certs) {
                if (j.startsWith('_')) continue; // Skip any certificates that start with underscore as the name.
                var acmconfig = amtacmactivation.certs[j], r = null;

                if ((typeof acmconfig.certpfx == 'string') && (typeof acmconfig.certpfxpass == 'string')) {
                    // P12 format, certpfx and certpfxpass
                    const certFilePath = parent.common.joinPath(obj.parent.datapath, acmconfig.certpfx);
                    try { r = obj.loadPfxCertificate(certFilePath, acmconfig.certpfxpass); } catch (ex) { console.log(ex); }
                    if ((r == null) || (r.certs == null) || (r.keys == null)) { amtacmactivation.acmCertErrors.push("Unable to load certificate file: " + certFilePath + "."); continue; }
                    if (r.certs.length < 2) { amtacmactivation.acmCertErrors.push("Certificate file contains less then 2 certificates: " + certFilePath + "."); continue; }
                    if (r.keys.length != 1) { amtacmactivation.acmCertErrors.push("Certificate file must contain exactly one private key: " + certFilePath + "."); continue; }
                } else if ((typeof acmconfig.certfiles == 'object') && (typeof acmconfig.keyfile == 'string')) {
                    // PEM format, certfiles and keyfile
                    r = { certs: [], keys: [] };
                    for (var k in acmconfig.certfiles) {
                        const certFilePath = parent.common.joinPath(obj.parent.datapath, acmconfig.certfiles[k]);
                        try { r.certs.push(obj.pki.certificateFromPem(obj.fs.readFileSync(certFilePath))); } catch (ex) { amtacmactivation.acmCertErrors.push("Unable to load certificate file: " + certFilePath + "."); }
                    }
                    r.keys.push(obj.pki.privateKeyFromPem(obj.fs.readFileSync(parent.common.joinPath(obj.parent.datapath, acmconfig.keyfile))));
                    if (r.certs.length < 2) { amtacmactivation.acmCertErrors.push("Certificate file contains less then 2 certificates: " + certFilePath + "."); continue; }
                    if (r.keys.length != 1) { amtacmactivation.acmCertErrors.push("Certificate file must contain exactly one private key: " + certFilePath + "."); continue; }
                }

                // Reorder the certificates from leaf to root.
                var orderedCerts = [], or = [], currenthash = null, orderingError = false;;
                while ((orderingError == false) && (orderedCerts.length < r.certs.length)) {
                    orderingError = true;
                    for (var k in r.certs) {
                        if (((currenthash == null) && (r.certs[k].subject.hash == r.certs[k].issuer.hash)) || ((r.certs[k].issuer.hash == currenthash) && (r.certs[k].subject.hash != r.certs[k].issuer.hash))) {
                            currenthash = r.certs[k].subject.hash;
                            orderedCerts.unshift(Buffer.from(obj.forge.asn1.toDer(obj.pki.certificateToAsn1(r.certs[k])).data, 'binary').toString('base64'));
                            or.unshift(r.certs[k]);
                            orderingError = false;
                        }
                    }
                }
                if (orderingError == true) { amtacmactivation.acmCertErrors.push("Unable to order Intel AMT ACM activation certificates to create a full chain."); continue; }
                r.certs = or;

                // Check that the certificate and private key match
                if ((compareArrays(r.certs[0].publicKey.n.data, r.keys[0].n.data) == false) || (compareArrays(r.certs[0].publicKey.e.data, r.keys[0].e.data) == false)) {
                    amtacmactivation.acmCertErrors.push("Intel AMT activation certificate provided with a mismatching private key.");
                    continue;
                }

                /*
                // Debug: Display all certs & key as PEM
                for (var k in r.certs) {
                    var cn = r.certs[k].subject.getField('CN');
                    if (cn != null) { console.log(cn.value + '\r\n' + obj.pki.certificateToPem(r.certs[k])); } else { console.log(obj.pki.certificateToPem(r.certs[k])); }
                }
                console.log(obj.pki.privateKeyToPem(r.keys[0]));
                */

                // Check if the right OU or OID is present for Intel AMT activation
                var validActivationCert = false;
                for (var k in r.certs[0].extensions) { if (r.certs[0].extensions[k]['2.16.840.1.113741.1.2.3'] == true) { validActivationCert = true; } }
                var orgName = r.certs[0].subject.getField('OU');
                if ((orgName != null) && (orgName.value == 'Intel(R) Client Setup Certificate')) { validActivationCert = true; }
                if (validActivationCert == false) { amtacmactivation.acmCertErrors.push("Intel AMT activation certificate must have usage OID \"2.16.840.1.113741.1.2.3\" or organization name \"Intel(R) Client Setup Certificate\"."); continue; }

                // Compute the SHA256 and SHA1 hashes of the root certificate
                for (var k in r.certs) {
                    if (r.certs[k].subject.hash != r.certs[k].issuer.hash) continue;
                    const certdata = obj.forge.asn1.toDer(obj.pki.certificateToAsn1(r.certs[k])).data;
                    var md = obj.forge.md.sha256.create();
                    md.update(certdata);
                    acmconfig.sha256 = Buffer.from(md.digest().getBytes(), 'binary').toString('hex');
                    md = obj.forge.md.sha1.create();
                    md.update(certdata);
                    acmconfig.sha1 = Buffer.from(md.digest().getBytes(), 'binary').toString('hex');
                }
                if ((acmconfig.sha1 == null) || (acmconfig.sha256 == null)) { amtacmactivation.acmCertErrors.push("Unable to compute Intel AMT activation certificate SHA1 and SHA256 hashes."); continue; }

                // Get the certificate common name
                var certCommonName = r.certs[0].subject.getField('CN');
                if (certCommonName == null) { amtacmactivation.acmCertErrors.push("Unable to get Intel AMT activation certificate common name."); continue; }
                var certCommonNameSplit = certCommonName.value.split('.');
                var topLevel = certCommonNameSplit[certCommonNameSplit.length - 1].toLowerCase();
                var topLevelNum = TopLevelDomainExtendedSupport[topLevel];
                if (topLevelNum != null) {
                    while (certCommonNameSplit.length > topLevelNum) { certCommonNameSplit.shift(); }
                    acmconfig.cn = certCommonNameSplit.join('.');
                } else {
                    acmconfig.cn = certCommonName.value;
                }

                delete acmconfig.cert;
                delete acmconfig.certpass;
                acmconfig.certs = orderedCerts;
                acmconfig.key = obj.pki.privateKeyToPem(r.keys[0]);
                acmCerts.push(acmconfig);
                acmmatch.push({ sha256: acmconfig.sha256, sha1: acmconfig.sha1, cn: acmconfig.cn });
            }
        }
        amtacmactivation.acmmatch = acmmatch;
        amtacmactivation.certs = acmCerts;

        // Add the MeshCentral root cert as a possible activation cert
        if (obj.parent.certificates.root) {
            var x1 = obj.parent.certificates.root.cert.indexOf('-----BEGIN CERTIFICATE-----'), x2 = obj.parent.certificates.root.cert.indexOf('-----END CERTIFICATE-----');
            if ((x1 >= 0) && (x2 > x1)) {
                var sha256 = obj.crypto.createHash('sha256').update(Buffer.from(obj.parent.certificates.root.cert.substring(x1 + 27, x2), 'base64')).digest('hex');
                var sha1 = obj.crypto.createHash('sha1').update(Buffer.from(obj.parent.certificates.root.cert.substring(x1 + 27, x2), 'base64')).digest('hex');
                amtacmactivation.certs.push({ 'sha256': sha256, 'sha1': sha1, 'cn': '*', rootcert: obj.pki.certificateFromPem(obj.parent.certificates.root.cert), key: obj.parent.certificates.root.key });
                amtacmactivation.acmmatch.push({ 'sha256': sha256, 'sha1': sha1, 'cn': '*' });
            }
        }
    }

    // Load a generic certificate and key from PFX/P12 or PEM format. Load both keys and attributes.
    obj.loadGenericCertAndKey = function (config) {
        if ((typeof config.certpfx == 'string') || (typeof config.certpfxpass == 'string')) {
            // Load a PFX certificate
            var r = null;
            try { r = obj.loadPfxCertificate(parent.getConfigFilePath(config.certpfx), config.certpfxpass); } catch (ex) { console.log(ex); }
            if ((r != null) && (r.keys.length > 0) && (r.certs.length > 0)) {
                var attributes = {};
                for (var j in r.certs[0].subject.attributes) { attributes[r.certs[0].subject.attributes[j].shortName] = r.certs[0].subject.attributes[j].value; }
                return { cert: obj.pki.certificateToPem(r.certs[0]), key: obj.pki.privateKeyToPem(r.keys[0]), attributes: attributes };
            }
        }
        if ((typeof config.certfile == 'string') || (typeof config.keyfile == 'string')) {
            // Load a PEM certificate
            var r = {}
            r.cert = obj.fs.readFileSync(parent.getConfigFilePath(config.certfile), 'utf8');
            r.key = obj.fs.readFileSync(parent.getConfigFilePath(config.keyfile), 'utf8');
            var cert = obj.pki.certificateFromPem(r.cert);
            r.attributes = {};
            for (var j in cert.subject.attributes) { r.attributes[cert.subject.attributes[j].shortName] = cert.subject.attributes[j].value; }
            return r;
        }
        return null;
    }

    // Get the setup.bin file
    obj.GetSetupBinFile = function (amtacmactivation, oldmebxpass, newmebxpass, domain, user) {
        // Create a setup.bin file for our own root cert
        // Get the wiadcard certificate hash
        var wildcardCertSha256 = null;
        for (var i = 0; i < amtacmactivation.acmmatch.length; i++) { if (amtacmactivation.acmmatch[i].cn == '*') { wildcardCertSha256 = amtacmactivation.acmmatch[i].sha256; } }

        // Create the Setup.bin stack
        const AmtSetupBinStack = require('./amt/amt-setupbin')();
        var setupbin = AmtSetupBinStack.AmtSetupBinCreate(3, 1); // Version 3, 1 = Records will not be consumed.
        var certRootName = 'MeshCentral';

        // Figure out what trusted FQDN to use.
        var trustedFQDN = 'rootcert.meshcentral.com'; // Default DNS name. Any DNS name will do, we this is the fallback.
        if (typeof domain.dns == 'string') {
            // Use domain DNS name
            trustedFQDN = domain.dns;
        } else if (typeof parent.config.settings.cert == 'string') {
            // Use main DNS name
            trustedFQDN = parent.config.settings.cert;
        }

        // Create a new record
        var r = {};
        r.typeIdentifier = 1;
        r.flags = 1; // Valid, unscrambled record.
        r.chunkCount = 0;
        r.headerByteCount = 0;
        r.number = 0;
        r.variables = [];
        setupbin.records.push(r);

        // Create "Current MEBx Password" variable
        var v = {};
        v.moduleid = 1;
        v.varid = 1;
        v.length = -1;
        v.value = oldmebxpass;
        setupbin.records[0].variables.push(v);

        // Create "New MEBx Password" variable
        v = {};
        v.moduleid = 1;
        v.varid = 2;
        v.length = -1;
        v.value = newmebxpass;
        setupbin.records[0].variables.push(v);

        // Create "User Defined Certificate Addition" variable
        v = {};
        v.moduleid = 2;
        v.varid = 8;
        v.length = -1;
        v.value = String.fromCharCode(2) + Buffer.from(wildcardCertSha256, 'hex').toString('binary') + String.fromCharCode(certRootName.length) + certRootName; // 2 = SHA256 hash type
        setupbin.records[0].variables.push(v);

        // Create "PKI DNS Suffix" variable
        v = {};
        v.moduleid = 2;
        v.varid = 3;
        v.length = -1;
        v.value = trustedFQDN;
        setupbin.records[0].variables.push(v);

        // Create "ME Provision Halt Active" variable
        v = {};
        v.moduleid = 2;
        v.varid = 28;
        v.length = -1;
        v.value = 0; // Stop
        setupbin.records[0].variables.push(v);

        // Write to log file
        obj.logAmtActivation(domain, { time: new Date(), action: 'setupbin', domain: domain.id, userid: user._id, oldmebx: oldmebxpass, newmebx: newmebxpass, rootname: certRootName, hash: wildcardCertSha256, dns: trustedFQDN });

        // Encode the setup.bin file
        return AmtSetupBinStack.AmtSetupBinEncode(setupbin);
    }


    // Get a bare metal setup.bin file
    obj.GetBareMetalSetupBinFile = function (amtacmactivation, oldmebxpass, newmebxpass, domain, user) {
        // Create a setup.bin file for our own root cert
        // Get the wiadcard certificate hash
        var wildcardCertSha256 = null;
        for (var i = 0; i < amtacmactivation.acmmatch.length; i++) { if (amtacmactivation.acmmatch[i].cn == '*') { wildcardCertSha256 = amtacmactivation.acmmatch[i].sha256; } }

        // Create the Setup.bin stack
        const AmtSetupBinStack = require('./amt/amt-setupbin')();
        var setupbin = AmtSetupBinStack.AmtSetupBinCreate(3, 1); // Version 3, 1 = Records will not be consumed.
        var certRootName = 'MeshCentral';

        // Figure out what trusted FQDN to use.
        var trustedFQDN = parent.config.settings.amtprovisioningserver.trustedfqdn

        // Figure out the provisioning server port
        var port = 9971;
        if (typeof parent.config.settings.amtprovisioningserver.port == 'number') { port = parent.config.settings.amtprovisioningserver.port; }

        // Get the provisioning server IP address from the config file
        if (typeof parent.config.settings.amtprovisioningserver.ip != 'string') return null;
        var ipaddr = parent.config.settings.amtprovisioningserver.ip;
        var ipaddrSplit = ipaddr.split('.');
        var ipaddrStr = String.fromCharCode(parseInt(ipaddrSplit[3])) + String.fromCharCode(parseInt(ipaddrSplit[2])) + String.fromCharCode(parseInt(ipaddrSplit[1])) + String.fromCharCode(parseInt(ipaddrSplit[0]));

        // Create a new record
        var r = {};
        r.typeIdentifier = 1;
        r.flags = 1; // Valid, unscrambled record.
        r.chunkCount = 0;
        r.headerByteCount = 0;
        r.number = 0;
        r.variables = [];
        setupbin.records.push(r);

        // Create "Current MEBx Password" variable
        var v = {};
        v.moduleid = 1;
        v.varid = 1;
        v.length = -1;
        v.value = oldmebxpass;
        setupbin.records[0].variables.push(v);

        // Create "New MEBx Password" variable
        v = {};
        v.moduleid = 1;
        v.varid = 2;
        v.length = -1;
        v.value = newmebxpass;
        setupbin.records[0].variables.push(v);

        // Create "User Defined Certificate Addition" variable
        v = {};
        v.moduleid = 2;
        v.varid = 8;
        v.length = -1;
        v.value = String.fromCharCode(2) + Buffer.from(wildcardCertSha256, 'hex').toString('binary') + String.fromCharCode(certRootName.length) + certRootName; // 2 = SHA256 hash type
        setupbin.records[0].variables.push(v);

        // Create "PKI DNS Suffix" variable
        v = {};
        v.moduleid = 2;
        v.varid = 3;
        v.length = -1;
        v.value = trustedFQDN;
        setupbin.records[0].variables.push(v);

        // Create "Configuration Server FQDN" variable
        v = {};
        v.moduleid = 2;
        v.varid = 4;
        v.length = -1;
        v.value = trustedFQDN;
        setupbin.records[0].variables.push(v);

        // Create "Provisioning Server Address" variable
        v = {};
        v.moduleid = 2;
        v.varid = 17;
        v.length = -1;
        v.value = ipaddrStr;
        setupbin.records[0].variables.push(v);

        // Create "Provisioning Server Port Number" variable
        v = {};
        v.moduleid = 2;
        v.varid = 18;
        v.length = -1;
        v.value = port;
        setupbin.records[0].variables.push(v);

        // Create "ME Provision Halt Active" variable
        v = {};
        v.moduleid = 2;
        v.varid = 28;
        v.length = -1;
        v.value = 1; // Start
        setupbin.records[0].variables.push(v);

        // Write to log file
        obj.logAmtActivation(domain, { time: new Date(), action: 'setupbin-bare-metal', domain: domain.id, userid: user._id, oldmebx: oldmebxpass, newmebx: newmebxpass, rootname: certRootName, hash: wildcardCertSha256, dns: trustedFQDN, ip: ipaddr, port: port });

        // Encode the setup.bin file
        return AmtSetupBinStack.AmtSetupBinEncode(setupbin);
    }

    // Return the certificate of the remote HTTPS server
    obj.loadPfxCertificate = function (filename, password) {
        var r = { certs: [], keys: [] };
        var pfxb64 = Buffer.from(obj.fs.readFileSync(filename)).toString('base64');
        var pfx = obj.forge.pkcs12.pkcs12FromAsn1(obj.forge.asn1.fromDer(obj.forge.util.decode64(pfxb64)), true, password);

        // Get the certs from certbags
        var bags = pfx.getBags({ bagType: obj.forge.pki.oids.certBag });
        for (var i = 0; i < bags[obj.forge.pki.oids.certBag].length; i++) { r.certs.push(bags[obj.forge.pki.oids.certBag][i].cert); }

        // Get shrouded key from key bags
        bags = pfx.getBags({ bagType: obj.forge.pki.oids.pkcs8ShroudedKeyBag });
        for (var i = 0; i < bags[obj.forge.pki.oids.pkcs8ShroudedKeyBag].length; i++) { r.keys.push(bags[obj.forge.pki.oids.pkcs8ShroudedKeyBag][i].key); }
        return r;
    }

    // Return a text file from a remote HTTPS server
    obj.loadTextFile = function (url, tag, func) {
        const u = require('url').parse(url);
        if (u.protocol == 'https:') {
            // Read from HTTPS
            const https = require('https');
            https.get(url, function(resp) {
                var data = '';
                resp.on('data', function(chunk) { data += chunk; });
                resp.on('end', function () { func(url, data, tag); });
                resp.on('error', function (chunk) { func(url, null, tag); });
            }).on('error', function (err) { func(url, null, tag); });
        } else if (u.protocol == 'file:') {
            // Read a file
            obj.fs.readFile(url.substring(7), 'utf8', function (err, data) {
                func(url, err ? null : data, tag);
            });
        } else { func(url, null, tag); }
    };

    // Return the certificate of the remote HTTPS server
    obj.loadCertificate = function (url, hostname, tag, func) {
        const u = require('url').parse(url);
        if (u.protocol == 'https:') {
            // Read the certificate from HTTPS
            if (hostname == null) { hostname = u.hostname; }
            parent.debug('cert', "loadCertificate() - Loading certificate from " + u.hostname + ":" + (u.port ? u.port : 443) + ", Hostname: " + hostname + "...");
            const tlssocket = obj.tls.connect((u.port ? u.port : 443), u.hostname, { servername: hostname, rejectUnauthorized: false }, function () {
                this.xxcert = this.getPeerCertificate();
                parent.debug('cert', "loadCertificate() - TLS connected, " + ((this.xxcert != null) ? "got certificate." : "no certificate."));
                try { this.destroy(); } catch (ex) { }
                this.xxfunc(this.xxurl, (this.xxcert == null)?null:(this.xxcert.raw.toString('binary')), hostname, this.xxtag);
            });
            tlssocket.xxurl = url;
            tlssocket.xxfunc = func;
            tlssocket.xxtag = tag;
            tlssocket.on('error', function (error) { try { this.destroy(); } catch (ex) { } parent.debug('cert', "loadCertificate() - TLS error: " + error); this.xxfunc(this.xxurl, null, hostname, this.xxtag); });
        } else if (u.protocol == 'file:') {
            // Read the certificate from a file
            obj.fs.readFile(url.substring(7), 'utf8', function (err, data) {
                if (err) { func(url, null, hostname, tag); return; }
                var x1 = data.indexOf('-----BEGIN CERTIFICATE-----'), x2 = data.indexOf('-----END CERTIFICATE-----');
                if ((x1 >= 0) && (x2 > x1)) {
                    func(url, Buffer.from(data.substring(x1 + 27, x2), 'base64').toString('binary'), hostname, tag);
                } else {
                    func(url, data, hostname, tag);
                }
            });
        } else { func(url, null, hostname, tag); }
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
            if (typeof parent.configurationFiles[filename] == 'string') { return fixEndOfLines(parent.configurationFiles[filename]); }
            return fixEndOfLines(parent.configurationFiles[filename].toString());
        } else {
            return fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath(filename), encoding));
        }
    }

    // Return the SHA384 hash of the certificate public key
    obj.getPublicKeyHash = function (cert) {
        var publickey = obj.pki.certificateFromPem(cert).publicKey;
        return obj.pki.getPublicKeyFingerprint(publickey, { encoding: 'hex', md: obj.forge.md.sha384.create() });
    };

    // Return the SHA1 hash of the certificate, return hex
    obj.getCertHashSha1 = function (cert) {
        try {
            var md = obj.forge.md.sha1.create();
            md.update(obj.forge.asn1.toDer(obj.pki.certificateToAsn1(obj.pki.certificateFromPem(cert))).getBytes());
            return md.digest().toHex();
        } catch (ex) {
            // If this is not an RSA certificate, hash the raw PKCS7 out of the PEM file
            var x1 = cert.indexOf('-----BEGIN CERTIFICATE-----'), x2 = cert.indexOf('-----END CERTIFICATE-----');
            if ((x1 >= 0) && (x2 > x1)) {
                return obj.crypto.createHash('sha1').update(Buffer.from(cert.substring(x1 + 27, x2), 'base64')).digest('hex');
            } else { console.log("ERROR: Unable to decode certificate."); return null; }
        }
    };

    // Return the SHA256 hash of the certificate, return hex
    obj.getCertHashSha256 = function (cert) {
        try {
            var md = obj.forge.md.sha256.create();
            md.update(obj.forge.asn1.toDer(obj.pki.certificateToAsn1(obj.pki.certificateFromPem(cert))).getBytes());
            return md.digest().toHex();
        } catch (ex) {
            // If this is not an RSA certificate, hash the raw PKCS7 out of the PEM file
            var x1 = cert.indexOf('-----BEGIN CERTIFICATE-----'), x2 = cert.indexOf('-----END CERTIFICATE-----');
            if ((x1 >= 0) && (x2 > x1)) {
                return obj.crypto.createHash('sha256').update(Buffer.from(cert.substring(x1 + 27, x2), 'base64')).digest('hex');
            } else { console.log("ERROR: Unable to decode certificate."); return null; }
        }
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
            } else { console.log("ERROR: Unable to decode certificate."); return null; }
        }
    };

    // Return the SHA384 hash of the certificate public key
    obj.getPublicKeyHashBinary = function (cert) {
        var publickey = obj.pki.certificateFromPem(cert).publicKey;
        return obj.pki.getPublicKeyFingerprint(publickey, { encoding: 'binary', md: obj.forge.md.sha384.create() });
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
            } else { console.log("ERROR: Unable to decode certificate."); return null; }
        }
    };

    // Create a self-signed certificate
    obj.GenerateRootCertificate = function (addThumbPrintToName, commonName, country, organization, strong) {
        var keys = obj.pki.rsa.generateKeyPair({ bits: (strong == true) ? 3072 : 2048, e: 0x10001 });
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '' + require('crypto').randomBytes(4).readUInt32BE(0);
        cert.validity.notBefore = new Date(2018, 0, 1);
        cert.validity.notAfter = new Date(2049, 11, 31);
        if (addThumbPrintToName === true) { commonName += '-' + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: 'hex' }).substring(0, 6); }
        if (country == null) { country = "unknown"; }
        if (organization == null) { organization = "unknown"; }
        var attrs = [{ name: 'commonName', value: commonName }, { name: 'organizationName', value: organization }, { name: 'countryName', value: country }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        // Create a root certificate
        //cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'nsCertType', sslCA: true, emailCA: true, objCA: true }, { name: 'subjectKeyIdentifier' }]);
        cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectKeyIdentifier' }, { name: 'keyUsage', keyCertSign: true }]);
        cert.sign(keys.privateKey, obj.forge.md.sha384.create());

        return { cert: cert, key: keys.privateKey };
    };

    // Issue a certificate from a root
    obj.IssueWebServerCertificate = function (rootcert, addThumbPrintToName, commonName, country, organization, extKeyUsage, strong) {
        var keys = obj.pki.rsa.generateKeyPair({ bits: (strong == true) ? 3072 : 2048, e: 0x10001 });
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '' + require('crypto').randomBytes(4).readUInt32BE(0);
        cert.validity.notBefore = new Date(2018, 0, 1);
        cert.validity.notAfter = new Date(2049, 11, 31);
        if (addThumbPrintToName === true) { commonName += "-" + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: 'hex' }).substring(0, 6); }
        var attrs = [{ name: 'commonName', value: commonName }];
        if (country != null) { attrs.push({ name: 'countryName', value: country }); }
        if (organization != null) { attrs.push({ name: 'organizationName', value: organization }); }
        cert.setSubject(attrs);
        cert.setIssuer(rootcert.cert.subject.attributes);

        if (extKeyUsage == null) { extKeyUsage = { name: 'extKeyUsage', serverAuth: true }; } else { extKeyUsage.name = 'extKeyUsage'; }
        //var extensions = [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true }, extKeyUsage, { name: "nsCertType", client: false, server: true, email: false, objsign: false, sslCA: false, emailCA: false, objCA: false }, { name: "subjectKeyIdentifier" }];
        var extensions = [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', keyCertSign: false, digitalSignature: true, nonRepudiation: false, keyEncipherment: true, dataEncipherment: (extKeyUsage.serverAuth !== true) }, extKeyUsage, { name: "subjectKeyIdentifier" }];
        
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
            altNames.push({ type: 6, value: 'http://' + commonName + '/' })

            // Add localhost stuff for easy testing on localhost ;)
            altNames.push({ type: 2, value: 'localhost' });
            altNames.push({ type: 6, value: 'http://localhost/' });
            altNames.push({ type: 7, ip: '127.0.0.1' });

            extensions.push({ name: 'subjectAltName', altNames: altNames });
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

    // Return true if the certificate is valid
    obj.checkCertificate = function (pem, key) {
        var cert = null;
        try { cert = obj.pki.certificateFromPem(pem); } catch (ex) { return false; } // Unable to decode certificate
        if (cert.serialNumber == '') return false; // Empty serial number is not allowed.
        return true;
    }

    // Decrypt private key if needed
    obj.decryptPrivateKey = function (key) {
        if (typeof key != 'string') return key;
        var i = key.indexOf('-----BEGIN ENCRYPTED PRIVATE KEY-----');
        var j = key.indexOf('-----END ENCRYPTED PRIVATE KEY-----');
        if ((i >= 0) && (j > i)) {
            var passwords = parent.config.settings.certificateprivatekeypassword;
            if (parent.config.settings.certificateprivatekeypassword == null) { passwords = []; }
            else if (typeof parent.config.settings.certificateprivatekeypassword == 'string') { passwords = [parent.config.settings.certificateprivatekeypassword ]; }
            var privateKey = null;
            for (var k in passwords) { if (privateKey == null) { try { privateKey = obj.pki.decryptRsaPrivateKey(key, passwords[k]); } catch (ex) { } } }
            if (privateKey == null) {
                console.log("Private certificate key is encrypted, but no correct password was found.");
                console.log("Add the password to the \"certificatePrivateKeyPassword\" value in the Settings section of the config.json.");
                console.log("Example: \"certificatePrivateKeyPassword\": [ \"MyPassword\" ]");
                process.exit();
                return null;
            }
            return obj.pki.privateKeyToPem(privateKey);
        }
        return key;
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
        if (obj.fileExists('root-cert-public.crt') && obj.fileExists('root-cert-private.key')) {
            var rootCertificate = obj.fileLoad('root-cert-public.crt', 'utf8');
            var rootPrivateKey = obj.decryptPrivateKey(obj.fileLoad('root-cert-private.key', 'utf8'));
            r.root = { cert: rootCertificate, key: rootPrivateKey };
            rcount++;

            // Check if the root certificate has the "Certificate Signing (04)" Key usage.
            // This option is required for newer versions of Intel AMT for CIRA/WS-EVENTS.
            var xroot = obj.pki.certificateFromPem(rootCertificate);
            var xext = xroot.getExtension('keyUsage');
            if ((xext == null) || (xext.keyCertSign !== true) || (xroot.serialNumber == '')) {
                // We need to fix this certificate
                obj.fs.writeFileSync(parent.getConfigFilePath('root-cert-public-backup.crt'), rootCertificate);
                if (xroot.serialNumber == '') { console.log("Fixing root certificate to add serial number..."); xroot.serialNumber = '' + require('crypto').randomBytes(4).readUInt32BE(0); }
                if ((xext == null) || (xext.keyCertSign !== true)) { console.log("Fixing root certificate to add signing key usage..."); xroot.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectKeyIdentifier' }, { name: 'keyUsage', keyCertSign: true }]); }
                var xrootPrivateKey = obj.pki.privateKeyFromPem(rootPrivateKey);
                xroot.sign(xrootPrivateKey, obj.forge.md.sha384.create());
                r.root.cert = obj.pki.certificateToPem(xroot);
                try { obj.fs.writeFileSync(parent.getConfigFilePath('root-cert-public.crt'), r.root.cert); } catch (ex) { }
            }
        }

        // If web certificate exist, load it as default. This is useful for agent-only port. Load both certificate and private key
        if (obj.fileExists('webserver-cert-public.crt') && obj.fileExists('webserver-cert-private.key')) {
            r.webdefault = { cert: obj.fileLoad('webserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('webserver-cert-private.key', 'utf8')) };
            if (obj.checkCertificate(r.webdefault.cert, r.webdefault.key) == false) { delete r.webdefault; }
        }

        if (args.tlsoffload) {
            // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
            if (obj.fileExists('webserver-cert-public.crt')) {
                r.web = { cert: obj.fileLoad('webserver-cert-public.crt', 'utf8') };
                if (obj.checkCertificate(r.web.cert, null) == false) { delete r.web; } else { rcount++; }
            }
        } else {
            // If the web certificate already exist, load it. Load both certificate and private key
            if (obj.fileExists('webserver-cert-public.crt') && obj.decryptPrivateKey(obj.fileExists('webserver-cert-private.key'))) {
                r.web = { cert: obj.fileLoad('webserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('webserver-cert-private.key', 'utf8')) };
                if (obj.checkCertificate(r.web.cert, r.web.key) == false) { delete r.web; } else { rcount++; }
            }
        }

        // If the mps certificate already exist, load it
        if (obj.fileExists('mpsserver-cert-public.crt') && obj.fileExists('mpsserver-cert-private.key')) {
            r.mps = { cert: obj.fileLoad('mpsserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('mpsserver-cert-private.key', 'utf8')) };
            if (obj.checkCertificate(r.mps.cert, r.mps.key) == false) { delete r.mps; } else { rcount++; }
        }

        // If the agent certificate already exist, load it
        if (obj.fileExists("agentserver-cert-public.crt") && obj.fileExists("agentserver-cert-private.key")) {
            r.agent = { cert: obj.fileLoad("agentserver-cert-public.crt", 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad("agentserver-cert-private.key", 'utf8')) };
            if (obj.checkCertificate(r.agent.cert, r.agent.key) == false) { delete r.agent; } else { rcount++; }
        }

        // If the swarm server certificate exist, load it (This is an optional certificate)
        if (obj.fileExists('swarmserver-cert-public.crt') && obj.fileExists('swarmserver-cert-private.key')) {
            r.swarmserver = { cert: obj.fileLoad('swarmserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('swarmserver-cert-private.key', 'utf8')) };
            if (obj.checkCertificate(r.swarmserver.cert, r.swarmserver.key) == false) { delete r.swarmserver; }
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists('swarmserverroot-cert-public.crt')) {
            r.swarmserverroot = { cert: obj.fileLoad('swarmserverroot-cert-public.crt', 'utf8') };
            if (obj.checkCertificate(r.swarmserverroot.cert, null) == false) { delete r.swarmserverroot; }
        }

        // If CA certificates are present, load them
        do {
            caok = false;
            if (obj.fileExists('webserver-cert-chain' + caindex + '.crt')) {
                calist.push(obj.fileLoad('webserver-cert-chain' + caindex + '.crt', 'utf8'));
                caok = true;
            }
            caindex++;
        } while (caok === true);
        if (r.web != null) { r.web.ca = calist; }

        // Decode certificate arguments
        var commonName = 'un-configured';
        var country = null;
        var organization = null;
        var forceWebCertGen = 0;
        var forceMpsCertGen = 0;
        if (certargs != undefined) {
            var xargs = certargs.split(',');
            if (xargs.length > 0) { commonName = xargs[0]; }
            if (xargs.length > 1) { country = xargs[1]; }
            if (xargs.length > 2) { organization = xargs[2]; }
        }

        // Decode MPS certificate arguments, this is for the Intel AMT CIRA server
        var mpsCommonName = ((config.settings != null) && (typeof config.settings.mpsaliashost == 'string')) ? config.settings.mpsaliashost : commonName;
        var mpsCountry = country;
        var mpsOrganization = organization;
        if (mpscertargs !== undefined) {
            var xxargs = mpscertargs.split(',');
            if (xxargs.length > 0) { mpsCommonName = xxargs[0]; }
            if (xxargs.length > 1) { mpsCountry = xxargs[1]; }
            if (xxargs.length > 2) { mpsOrganization = xxargs[2]; }
        }

        if (rcount === rcountmax) {
            // Fetch the certificates names for the main certificate
            r.AmtMpsName = obj.pki.certificateFromPem(r.mps.cert).subject.getField('CN').value;
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            r.WebIssuer = webCertificate.issuer.getField('CN').value;
            if (commonName == 'un-configured') { // If the "cert" name is not set, try to use the certificate CN instead (ok if the certificate is not wildcard).
                commonName = webCertificate.subject.getField('CN').value;
                if (commonName.startsWith('*.')) { console.log("ERROR: Must specify a server full domain name in Config.json->Settings->Cert when using a wildcard certificate."); process.exit(0); return; }
            }
            r.CommonName = commonName;
            r.CommonNames = [commonName.toLowerCase()];
            var altNames = webCertificate.getExtension('subjectAltName');
            if (altNames) {
                for (i = 0; i < altNames.altNames.length; i++) {
                    if ((altNames.altNames[i] != null) && (altNames.altNames[i].type === 2) && (typeof altNames.altNames[i].value === 'string')) {
                        var acn = altNames.altNames[i].value.toLowerCase();
                        if (r.CommonNames.indexOf(acn) == -1) { r.CommonNames.push(acn); }
                    }
                }
            }
            var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
            r.RootName = rootCertificate.subject.getField('CN').value;
        }

        // Look for domains that have DNS names and load their certificates
        r.dns = {};
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                // Check if this domain matches a parent wildcard cert, if so, use the parent cert.
                if (obj.compareCertificateNames(r.CommonNames, dnsname) == true) {
                    r.dns[i] = { cert: obj.fileLoad('webserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('webserver-cert-private.key', 'utf8')) };
                } else {
                    if (args.tlsoffload) {
                        // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
                        if (obj.fileExists('webserver-' + i + '-cert-public.crt')) {
                            r.dns[i] = { cert: obj.fileLoad('webserver-' + i + '-cert-public.crt', 'utf8') };
                            config.domains[i].certs = r.dns[i];
                        } else {
                            console.log("WARNING: File \"webserver-" + i + "-cert-public.crt\" missing, domain \"" + i + "\" will not work correctly.");
                        }
                    } else {
                        // If the web certificate already exist, load it. Load both certificate and private key
                        if (obj.fileExists('webserver-' + i + '-cert-public.crt') && obj.fileExists('webserver-' + i + '-cert-private.key')) {
                            r.dns[i] = { cert: obj.fileLoad('webserver-' + i + '-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('webserver-' + i + '-cert-private.key', 'utf8')) };
                            config.domains[i].certs = r.dns[i];
                            // If CA certificates are present, load them
                            caindex = 1;
                            r.dns[i].ca = [];
                            do {
                                caok = false;
                                if (obj.fileExists('webserver-' + i + '-cert-chain' + caindex + '.crt')) {
                                    r.dns[i].ca.push(obj.fileLoad('webserver-' + i + '-cert-chain' + caindex + '.crt', 'utf8'));
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
            var xcountry, xcountryField = webCertificate.subject.getField('C');
            if (xcountryField != null) { xcountry = xcountryField.value; }
            var xorganization, xorganizationField = webCertificate.subject.getField('O');
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
        if (parent.configurationFiles != null) { console.log("Error: Vault/Database missing some certificates."); process.exit(0); return null; }

        console.log("Generating certificates, may take a few minutes...");
        parent.updateServerState('state', 'generatingcertificates');

        // If a certificate is missing, but web certificate is present and --cert is not used, set the names to be the same as the web certificate
        if ((certargs == null) && (r.web != null)) {
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            commonName = webCertificate.subject.getField('CN').value;
            var xcountryField = webCertificate.subject.getField('C');
            if (xcountryField != null) { country = xcountryField.value; }
            var xorganizationField = webCertificate.subject.getField('O');
            if (xorganizationField != null) { organization = xorganizationField.value; }
        }

        var rootCertAndKey, rootCertificate, rootPrivateKey, rootName;
        if (r.root == null) {
            // If the root certificate does not exist, create one
            console.log("Generating root certificate...");
            rootCertAndKey = obj.GenerateRootCertificate(true, 'MeshCentralRoot', null, null, strongCertificate);
            rootCertificate = obj.pki.certificateToPem(rootCertAndKey.cert);
            rootPrivateKey = obj.pki.privateKeyToPem(rootCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath('root-cert-public.crt'), rootCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath('root-cert-private.key'), rootPrivateKey);
        } else {
            // Keep the root certificate we have
            rootCertAndKey = { cert: obj.pki.certificateFromPem(r.root.cert), key: obj.pki.privateKeyFromPem(r.root.key) };
            rootCertificate = r.root.cert;
            rootPrivateKey = r.root.key;
        }
        var rootName = rootCertAndKey.cert.subject.getField('CN').value;

        // If the web certificate does not exist, create one
        var webCertAndKey, webCertificate, webPrivateKey;
        if ((r.web == null) || (forceWebCertGen == 1)) {
            console.log("Generating HTTPS certificate...");
            webCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization, null, strongCertificate);
            webCertificate = obj.pki.certificateToPem(webCertAndKey.cert);
            webPrivateKey = obj.pki.privateKeyToPem(webCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath('webserver-cert-public.crt'), webCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath('webserver-cert-private.key'), webPrivateKey);
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
        var webIssuer = webCertAndKey.cert.issuer.getField('CN').value;

        // If the mesh agent server certificate does not exist, create one
        var agentCertAndKey, agentCertificate, agentPrivateKey;
        if (r.agent == null) {
            console.log("Generating MeshAgent certificate...");
            agentCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, true, 'MeshCentralAgentServer', country, organization, { }, strongCertificate);
            agentCertificate = obj.pki.certificateToPem(agentCertAndKey.cert);
            agentPrivateKey = obj.pki.privateKeyToPem(agentCertAndKey.key);
            obj.fs.writeFileSync(parent.getConfigFilePath('agentserver-cert-public.crt'), agentCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath('agentserver-cert-private.key'), agentPrivateKey);
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
            obj.fs.writeFileSync(parent.getConfigFilePath('mpsserver-cert-public.crt'), mpsCertificate);
            obj.fs.writeFileSync(parent.getConfigFilePath('mpsserver-cert-private.key'), mpsPrivateKey);
        } else {
            // Keep the console certificate we have
            mpsCertAndKey = { cert: obj.pki.certificateFromPem(r.mps.cert), key: obj.pki.privateKeyFromPem(r.mps.key) };
            mpsCertificate = r.mps.cert;
            mpsPrivateKey = r.mps.key;
        }

        r = { root: { cert: rootCertificate, key: rootPrivateKey }, web: { cert: webCertificate, key: webPrivateKey, ca: [] }, webdefault: { cert: webCertificate, key: webPrivateKey, ca: [] }, mps: { cert: mpsCertificate, key: mpsPrivateKey }, agent: { cert: agentCertificate, key: agentPrivateKey }, ca: calist, CommonName: commonName, RootName: rootName, AmtMpsName: mpsCommonName, dns: {}, WebIssuer: webIssuer };

        // Fetch the certificates names for the main certificate
        var webCertificate = obj.pki.certificateFromPem(r.web.cert);
        r.WebIssuer = webCertificate.issuer.getField('CN').value;
        r.CommonName = webCertificate.subject.getField('CN').value;
        if (r.CommonName.startsWith('*.')) {
            if (commonName.indexOf('.') == -1) { console.log("ERROR: Must specify a server full domain name in Config.json->Settings->Cert when using a wildcard certificate."); process.exit(0); return; }
            if (commonName.startsWith('*.')) { console.log("ERROR: Server can't use a wildcard name: " + commonName); process.exit(0); return; }
            r.CommonName = commonName;
        }
        r.CommonNames = [r.CommonName.toLowerCase()];
        var altNames = webCertificate.getExtension('subjectAltName');
        if (altNames) {
            for (i = 0; i < altNames.altNames.length; i++) {
                if ((altNames.altNames[i] != null) && (altNames.altNames[i].type === 2) && (typeof altNames.altNames[i].value === 'string')) {
                    var acn = altNames.altNames[i].value.toLowerCase();
                    if (r.CommonNames.indexOf(acn) == -1) { r.CommonNames.push(acn); }
                }
            }
        }
        var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
        r.RootName = rootCertificate.subject.getField('CN').value;

        // Look for domains with DNS names that have no certificates and generated them.
        for (i in config.domains) {
            if ((i != "") && (config.domains[i] != null) && (config.domains[i].dns != null)) {
                dnsname = config.domains[i].dns;
                // Check if this domain matches a parent wildcard cert, if so, use the parent cert.
                if (obj.compareCertificateNames(r.CommonNames, dnsname) == true) {
                    r.dns[i] = { cert: obj.fileLoad('webserver-cert-public.crt', 'utf8'), key: obj.decryptPrivateKey(obj.fileLoad('webserver-cert-private.key', 'utf8')) };
                } else {
                    if (!args.tlsoffload) {
                        // If the web certificate does not exist, create it
                        if ((obj.fileExists('webserver-' + i + '-cert-public.crt') === false) || (obj.fileExists('webserver-' + i + '-cert-private.key') === false)) {
                            console.log('Generating HTTPS certificate for ' + i + '...');
                            var xwebCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, dnsname, country, organization, null, strongCertificate);
                            var xwebCertificate = obj.pki.certificateToPem(xwebCertAndKey.cert);
                            var xwebPrivateKey = obj.pki.privateKeyToPem(xwebCertAndKey.key);
                            obj.fs.writeFileSync(parent.getConfigFilePath('webserver-' + i + '-cert-public.crt'), xwebCertificate);
                            obj.fs.writeFileSync(parent.getConfigFilePath('webserver-' + i + '-cert-private.key'), xwebPrivateKey);
                            r.dns[i] = { cert: xwebCertificate, key: xwebPrivateKey };
                            config.domains[i].certs = r.dns[i];

                            // If CA certificates are present, load them
                            caindex = 1;
                            r.dns[i].ca = [];
                            do {
                                caok = false;
                                if (obj.fileExists('webserver-' + i + '-cert-chain' + caindex + '.crt')) {
                                    r.dns[i].ca.push(fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath('webserver-' + i + '-cert-chain' + caindex + '.crt'), 'utf8')));
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
        if (obj.fileExists('swarmserver-cert-public.crt') && obj.fileExists('swarmserver-cert-private.key')) {
            r.swarmserver = { cert: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath('swarmserver-cert-public.crt'), 'utf8')), key: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath("swarmserver-cert-private.key"), 'utf8')) };
        }

        // If the swarm server root certificate exist, load it (This is an optional certificate)
        if (obj.fileExists('swarmserverroot-cert-public.crt')) {
            r.swarmserverroot = { cert: fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath('swarmserverroot-cert-public.crt'), 'utf8')) };
        }

        // If CA certificates are present, load them
        if (r.web != null) {
            caindex = 1;
            r.web.ca = [];
            do {
                caok = false;
                if (obj.fileExists('webserver-cert-chain' + caindex + '.crt')) {
                    r.web.ca.push(fixEndOfLines(obj.fs.readFileSync(parent.getConfigFilePath('webserver-cert-chain' + caindex + '.crt'), 'utf8')));
                    caok = true;
                }
                caindex++;
            } while (caok === true);
        }

        if (func != undefined) { func(r); }
        return r;
    };

    // Accelerators, used to dispatch work to other processes
    const fork = require('child_process').fork;
    const program = require('path').join(__dirname, 'meshaccelerator.js');
    const acceleratorTotalCount = require('os').cpus().length; // TODO: Check if this accelerator can scale.
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
            var accelerator = fork(program, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
            accelerator.accid = acceleratorCreateCount;
            accelerator.on('message', function (message) {
                acceleratorMessage++;
                if (this.x.func) { this.x.func(this.x.tag, message); }
                delete this.x;
                if (pendingAccelerator.length > 0) { this.send(this.x = pendingAccelerator.shift()); } else { freeAccelerators.push(this); }
            });
            accelerator.on('exit', function (code) {
                if (this.x) { pendingAccelerator.push(this.x); delete this.x; }
                acceleratorCreateCount++;
                if (pendingAccelerator.length > 0) { var acc = obj.getAccelerator(); acc.send(acc.x = pendingAccelerator.shift()); }
            });
            accelerator.on('error', function (code) { }); // Not sure if somethign should be done here to help kill the process.
            accelerator.send({ action: 'setState', certs: obj.acceleratorCertStore });
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
            if (typeof privatekey == 'number') { privatekey = obj.acceleratorCertStore[privatekey].key; }
            const sign = obj.crypto.createSign('SHA384');
            sign.end(Buffer.from(data, 'binary'));
            try { func(tag, sign.sign(privatekey).toString('binary')); } catch (ex) { acceleratorMessageException++; acceleratorMessageLastException = ex; }
        } else {
            var acc = obj.getAccelerator();
            if (acc == null) {
                // Add to pending accelerator workload
                acceleratorPerformSignaturePushFuncCall++;
                pendingAccelerator.push({ action: 'sign', key: privatekey, data: data, tag: tag, func: func });
            } else {
                // Send to accelerator now
                acceleratorPerformSignatureRunFuncCall++;
                acc.send(acc.x = { action: 'sign', key: privatekey, data: data, tag: tag, func: func });
            }
        }
    };

    // Perform any general operation
    obj.acceleratorPerformOperation = function (operation, data, tag, func) {
        if (acceleratorTotalCount <= 1) {
            // No accelerators available
            require(program).processMessage({ action: operation, data: data, tag: tag, func: func });
        } else {
            var acc = obj.getAccelerator();
            if (acc == null) {
                // Add to pending accelerator workload
                acceleratorPerformSignaturePushFuncCall++;
                pendingAccelerator.push({ action: operation, data: data, tag: tag, func: func });
            } else {
                // Send to accelerator now
                acceleratorPerformSignatureRunFuncCall++;
                acc.send(acc.x = { action: operation, data: data, tag: tag, func: func });
            }
        }
    };

    return obj;
};
