/**
* @description Certificate generator
* @author Joko Sastriawan / Ylian Saint-Hilaire
* @version v0.0.1
*/
module.exports.CertificateOperations = function () {
    var obj = {};

    obj.fs = require('fs');
    obj.forge = require('node-forge');
    obj.pki = obj.forge.pki;
    obj.dirExists = function (filePath) { try { return obj.fs.statSync(filePath).isDirectory(); } catch (err) { return false; } }
    obj.getFilesizeInBytes = function(filename) { try { return obj.fs.statSync(filename)["size"]; } catch (err) { return -1; } }
    obj.fileExists = function(filePath) { try { return obj.fs.statSync(filePath).isFile(); } catch (err) { return false; } }
    
    // Return the SHA256 hash of the certificate public key
    obj.getPublicKeyHash = function(cert) {
        var publickey = obj.pki.certificateFromPem(cert).publicKey;
        return obj.pki.getPublicKeyFingerprint(publickey, { encoding: 'hex', md: obj.forge.md.sha256.create() });
    }

    // Return a random nonce (TODO: weak crypto)
    obj.xxRandomNonceX = "abcdef0123456789";
    obj.xxRandomNonce = function (length) {
        var r = "";
        for (var i = 0; i < length; i++) { r += obj.xxRandomNonceX.charAt(Math.floor(Math.random() * obj.xxRandomNonceX.length)); }
        return r;
    }

    // Create a self-signed certificate
    obj.GenerateRootCertificate = function (addThumbPrintToName, commonName, country, organization) {
        var keys = obj.pki.rsa.generateKeyPair(2048);
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '' + Math.floor((Math.random() * 100000) + 1); ;
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 1); // Create a certificate that is valid one year before, to make sure out-of-sync clocks don't reject this cert.
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 30);
        if (addThumbPrintToName == true) { commonName += '-' + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: 'hex' }).substring(0, 6); }
        if (country == undefined) { country = 'unknown'; }
        if (organization == undefined) { organization = 'unknown'; }
        var attrs = [{ name: 'commonName', value: commonName }, { name: 'organizationName', value: organization }, { name: 'countryName', value: country }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        // Create a root certificate
        cert.setExtensions([{
            name: 'basicConstraints',
            cA: true
        }, {
                name: 'nsCertType',
                sslCA: true,
                emailCA: true,
                objCA: true
            }, {
                name: 'subjectKeyIdentifier'
            }]);
        cert.sign(keys.privateKey, obj.forge.md.sha256.create());

        return { cert: cert, key: keys.privateKey };
    }
    
    // Issue a certificate from a root
    obj.IssueWebServerCertificate = function (rootcert, addThumbPrintToName, commonName, country, organization, extKeyUsage) {
        var keys = obj.pki.rsa.generateKeyPair(2048);
        var cert = obj.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '' + Math.floor((Math.random() * 100000) + 1); ;
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notAfter.getFullYear() - 1); // Create a certificate that is valid one year before, to make sure out-of-sync clocks don't reject this cert.
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 30);
        if (addThumbPrintToName == true) { commonName += '-' + obj.pki.getPublicKeyFingerprint(cert.publicKey, { encoding: 'hex' }).substring(0, 6); }
        var attrs = [ { name: 'commonName', value: commonName }];
        if (country != undefined) attrs.push({ name: 'countryName', value: country });
        if (organization != undefined) attrs.push({ name: 'organizationName', value: organization });
        cert.setSubject(attrs);
        cert.setIssuer(rootcert.cert.subject.attributes);

        if (extKeyUsage == null) { extKeyUsage = { name: 'extKeyUsage', serverAuth: true, } } else { extKeyUsage.name = 'extKeyUsage'; }
        var subjectAltName = null;
        if (extKeyUsage.serverAuth == true) {
            subjectAltName = {
                name: 'subjectAltName',
                altNames: [{
                    type: 6, // URI
                    value: 'http://' + commonName + '/'
                }, {
                    type: 6, // URL
                    value: 'http://localhost/'
                }]
            }
        }

        /*
        {
            name: 'extKeyUsage',
            serverAuth: true,
            clientAuth: true,
            codeSigning: true,
            emailProtection: true,
            timeStamping: true,
            '2.16.840.1.113741.1.2.1': true
        }
        */

        var extensions = [{
            name: 'basicConstraints',
            cA: false
        }, {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            }, extKeyUsage, {
                name: 'nsCertType',
                client: false,
                server: true,
                email: false,
                objsign: false,
                sslCA: false,
                emailCA: false,
                objCA: false
            }, {
                name: 'subjectKeyIdentifier'
            }]
        if (subjectAltName != null) extensions.push(subjectAltName);
        cert.setExtensions(extensions);
        
        cert.sign(rootcert.key, obj.forge.md.sha256.create());
        
        return { cert: cert, key: keys.privateKey };
    }

    // Returns the web server TLS certificate and private key, if not present, create demonstration ones.
    obj.GetMeshServerCertificate = function (directory, args, func) {
        var certargs = args.cert;
        // commonName, country, organization
        
        // If the certificates directory does not exist, create it.
        if (!obj.dirExists(directory)) { obj.fs.mkdirSync(directory); }
        
        var r = {}, rcount = 0;
        
        // If the root certificate already exist, load it
        if (obj.fileExists(directory + '/root-cert-public.crt') && obj.fileExists(directory + '/root-cert-private.key')) {
            var rootCertificate = obj.fs.readFileSync(directory + '/root-cert-public.crt', 'utf8');
            var rootPrivateKey = obj.fs.readFileSync(directory + '/root-cert-private.key', 'utf8');
            r.root = { cert: rootCertificate, key: rootPrivateKey };
            rcount++;
        }

        if (args.tlsoffload == true) {
            // If the web certificate already exist, load it. Load just the certificate since we are in TLS offload situation
            if (obj.fileExists(directory + '/webserver-cert-public.crt')) {
                var webCertificate = obj.fs.readFileSync(directory + '/webserver-cert-public.crt', 'utf8');
                r.web = { cert: webCertificate };
                rcount++;
            }
        } else {
            // If the web certificate already exist, load it. Load both certificate and private key
            if (obj.fileExists(directory + '/webserver-cert-public.crt') && obj.fileExists(directory + '/webserver-cert-private.key')) {
                var webCertificate = obj.fs.readFileSync(directory + '/webserver-cert-public.crt', 'utf8');
                var webPrivateKey = obj.fs.readFileSync(directory + '/webserver-cert-private.key', 'utf8');
                r.web = { cert: webCertificate, key: webPrivateKey };
                rcount++;
            }
        }
        
        // If the mps certificate already exist, load it
        if (obj.fileExists(directory + '/mpsserver-cert-public.crt') && obj.fileExists(directory + '/mpsserver-cert-private.key')) {
            var mpsCertificate = obj.fs.readFileSync(directory + '/mpsserver-cert-public.crt', 'utf8');
            var mpsPrivateKey = obj.fs.readFileSync(directory + '/mpsserver-cert-private.key', 'utf8');
            r.mps = { cert: mpsCertificate, key: mpsPrivateKey };
            rcount++;
        }
        
        // If the agent certificate already exist, load it
        if (obj.fileExists(directory + '/agentserver-cert-public.crt') && obj.fileExists(directory + '/agentserver-cert-private.key')) {
            var agentCertificate = obj.fs.readFileSync(directory + '/agentserver-cert-public.crt', 'utf8');
            var agentPrivateKey = obj.fs.readFileSync(directory + '/agentserver-cert-private.key', 'utf8');
            r.agent = { cert: agentCertificate, key: agentPrivateKey };
            rcount++;
        }

        // If the console certificate already exist, load it
        if (obj.fileExists(directory + '/amtconsole-cert-public.crt') && obj.fileExists(directory + '/agentserver-cert-private.key')) {
            var amtConsoleCertificate = obj.fs.readFileSync(directory + '/amtconsole-cert-public.crt', 'utf8');
            var amtConsolePrivateKey = obj.fs.readFileSync(directory + '/amtconsole-cert-private.key', 'utf8');
            r.console = { cert: amtConsoleCertificate, key: amtConsolePrivateKey };
            rcount++;
        }

        // If CA certificates are present, load them
        var caok, caindex = 1, calist = [];
        do {
            caok = false;
            if (obj.fileExists(directory + '/webserver-cert-chain' + caindex + '.crt')) {
                var caCertificate = obj.fs.readFileSync(directory + '/webserver-cert-chain' + caindex + '.crt', 'utf8');
                calist.push(caCertificate);
                caok = true;
            }
            caindex++;
        } while (caok == true);
        r.calist = calist;
                
        // Decode certificate arguments
        var commonName = 'un-configured', country, organization, forceWebCertGen = 0;
        if (certargs != undefined) {
            var args = certargs.split(',');
            if (args.length > 0) commonName = args[0];
            if (args.length > 1) country = args[1];
            if (args.length > 2) organization = args[2];
        }

        if (rcount == 5) {
            // Fetch the Intel AMT console name
            var consoleCertificate = obj.pki.certificateFromPem(r.console.cert);
            r.AmtConsoleName = consoleCertificate.subject.getField('CN').value;
            // Fetch the Intel AMT MPS common name
            var mpsCertificate = obj.pki.certificateFromPem(r.mps.cert);
            r.AmtMpsName = mpsCertificate.subject.getField('CN').value;
            // Fetch the name of the server
            var webCertificate = obj.pki.certificateFromPem(r.web.cert);
            r.CommonName = webCertificate.subject.getField('CN').value;
            var rootCertificate = obj.pki.certificateFromPem(r.root.cert);
            r.RootName = rootCertificate.subject.getField('CN').value;
            if (certargs == undefined) { if (func != undefined) { func(r); } return r }; // If no certificate arguments are given, keep the certificate
            var xcountry, xcountryField = webCertificate.subject.getField('C');
            if (xcountryField != null) { xcountry = xcountryField.value; }
            var xorganization, xorganizationField = webCertificate.subject.getField('O');
            if (xorganizationField != null) { xorganization = xorganizationField.value; }
            if ((r.CommonName == commonName) && (xcountry == country) && (xorganization == organization) && (r.AmtMpsName == commonName)) { if (func != undefined) { func(r); } return r; } else { forceWebCertGen = 1; } // If the certificate matches what we want, keep it.
        }
        console.log('Generating certificates...');
        
        var rootCertAndKey, rootCertificate, rootPrivateKey, rootName;
        if (r.root == undefined) {
            // If the root certificate does not exist, create one
            rootCertAndKey = obj.GenerateRootCertificate(true, 'MeshCentralRoot');
            rootCertificate = obj.pki.certificateToPem(rootCertAndKey.cert);
            rootPrivateKey = obj.pki.privateKeyToPem(rootCertAndKey.key);
            obj.fs.writeFileSync(directory + '/root-cert-public.crt', rootCertificate);
            obj.fs.writeFileSync(directory + '/root-cert-private.key', rootPrivateKey);
        } else {
            // Keep the root certificate we have
            rootCertAndKey = { cert: obj.pki.certificateFromPem(r.root.cert), key: obj.pki.privateKeyFromPem(r.root.key) };
            rootCertificate = r.root.cert
            rootPrivateKey = r.root.key
        }
        var rootName = rootCertAndKey.cert.subject.getField('CN').value;

        // If the web certificate does not exist, create one
        var webCertAndKey, webCertificate, webPrivateKey;
        if ((r.web == null) || (forceWebCertGen == 1)) {
            webCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization);
            webCertificate = obj.pki.certificateToPem(webCertAndKey.cert);
            webPrivateKey = obj.pki.privateKeyToPem(webCertAndKey.key);
            obj.fs.writeFileSync(directory + '/webserver-cert-public.crt', webCertificate);
            obj.fs.writeFileSync(directory + '/webserver-cert-private.key', webPrivateKey);
        } else {
            // Keep the console certificate we have
            webCertAndKey = { cert: obj.pki.certificateFromPem(r.web.cert), key: obj.pki.privateKeyFromPem(r.web.key) };
            webCertificate = r.web.cert
            webPrivateKey = r.web.key
        }

        // If the Intel AMT MPS certificate does not exist, create one
        var mpsCertAndKey, mpsCertificate, mpsPrivateKey;
        if ((r.mps == null) || (forceWebCertGen == 1)) {
            mpsCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization);
            mpsCertificate = obj.pki.certificateToPem(mpsCertAndKey.cert);
            mpsPrivateKey = obj.pki.privateKeyToPem(mpsCertAndKey.key);
            obj.fs.writeFileSync(directory + '/mpsserver-cert-public.crt', mpsCertificate);
            obj.fs.writeFileSync(directory + '/mpsserver-cert-private.key', mpsPrivateKey);
        } else {
            // Keep the console certificate we have
            mpsCertAndKey = { cert: obj.pki.certificateFromPem(r.mps.cert), key: obj.pki.privateKeyFromPem(r.mps.key) };
            mpsCertificate = r.mps.cert
            mpsPrivateKey = r.mps.key
        }

        // If the Intel AMT console certificate does not exist, create one
        var consoleCertAndKey, consoleCertificate, consolePrivateKey, amtConsoleName = 'MeshCentral';
        if (r.console == null) {
            consoleCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, amtConsoleName, country, organization, { name: 'extKeyUsage', clientAuth: true, '2.16.840.1.113741.1.2.1': true, '2.16.840.1.113741.1.2.2': true, '2.16.840.1.113741.1.2.3': true }); // Intel AMT Remote, Agent and Activation usages
            consoleCertificate = obj.pki.certificateToPem(consoleCertAndKey.cert);
            consolePrivateKey = obj.pki.privateKeyToPem(consoleCertAndKey.key);
            obj.fs.writeFileSync(directory + '/amtconsole-cert-public.crt', consoleCertificate);
            obj.fs.writeFileSync(directory + '/amtconsole-cert-private.key', consolePrivateKey);
        } else {
            // Keep the console certificate we have
            consoleCertAndKey = { cert: obj.pki.certificateFromPem(r.console.cert), key: obj.pki.privateKeyFromPem(r.console.key) };
            consoleCertificate = r.console.cert
            consolePrivateKey = r.console.key
            amtConsoleName = consoleCertAndKey.cert.subject.getField('CN').value;
        }

        // If the mesh agent server certificate does not exist, create one
        var agentCertAndKey, agentCertificate, agentPrivateKey;
        if (r.agent == null) {
            agentCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, true, 'MeshCentralAgentServer');
            agentCertificate = obj.pki.certificateToPem(agentCertAndKey.cert);
            agentPrivateKey = obj.pki.privateKeyToPem(agentCertAndKey.key);
            obj.fs.writeFileSync(directory + '/agentserver-cert-public.crt', agentCertificate);
            obj.fs.writeFileSync(directory + '/agentserver-cert-private.key', agentPrivateKey);
        } else {
            // Keep the mesh agent server certificate we have
            agentCertAndKey = { cert: obj.pki.certificateFromPem(r.agent.cert), key: obj.pki.privateKeyFromPem(r.agent.key) };
            agentCertificate = r.agent.cert
            agentPrivateKey = r.agent.key
        }

        var r = { root: { cert: rootCertificate, key: rootPrivateKey }, web: { cert: webCertificate, key: webPrivateKey }, mps: { cert: mpsCertificate, key: mpsPrivateKey }, agent: { cert: agentCertificate, key: agentPrivateKey }, console: { cert: consoleCertificate, key: consolePrivateKey }, calist: calist, CommonName: commonName, RootName: rootName, AmtConsoleName: amtConsoleName };
        if (func != undefined) { func(r); }
        return r;
    }

    return obj;
};
