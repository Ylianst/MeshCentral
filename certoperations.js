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
        var attrs = [ { name: 'commonName', value: commonName } ];
        if (country != undefined) attrs.push({ name: 'countryName', value: country });
        if (organization != undefined) attrs.push({ name: 'organizationName', value: organization });
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: true },
            {
                name: 'nsCertType',
                client: false,
                server: false,
                email: false,
                objsign: false,
                sslCA: true,
                emailCA: false,
                objCA: true
            }
        ]);
        cert.sign(keys.privateKey, obj.forge.md.sha256.create());

        return { cert: cert, key: keys.privateKey };
    }
    
    // Issue a certificate from a root
    obj.IssueWebServerCertificate = function (rootcert, addThumbPrintToName, commonName, country, organization) {
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
        
        cert.setExtensions([{
                name: 'basicConstraints',
                cA: false
            }, {
                name: 'keyUsage',
                keyCertSign: true,
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            }, {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: false,
                codeSigning: false,
                emailProtection: false,
                timeStamping: false
            }, {
                name: 'nsCertType',
                client: false,
                server: true,
                email: false,
                objsign: false,
                sslCA: false,
                emailCA: false,
                objCA: false
            }, {
                name: 'subjectAltName',
                altNames: [{
                        type: 6, // URI
                        value: 'http://' + commonName + '/'
                    }, {
                        type: 6, // URL
                        value: 'http://localhost/'
                    }]
            }, {
                name: 'subjectKeyIdentifier'
            }]);
        
        cert.sign(rootcert.key, obj.forge.md.sha256.create());
        
        return { cert: cert, key: keys.privateKey };
    }

    // Returns the web server TLS certificate and private key, if not present, create demonstration ones.
    obj.GetMeshServerCertificate = function (directory, certargs, func) {
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
        
        // If the web certificate already exist, load it
        if (obj.fileExists(directory + '/webserver-cert-public.crt') && obj.fileExists(directory + '/webserver-cert-private.key')) {
            var webCertificate = obj.fs.readFileSync(directory + '/webserver-cert-public.crt', 'utf8');
            var webPrivateKey = obj.fs.readFileSync(directory + '/webserver-cert-private.key', 'utf8');
            r.web = { cert: webCertificate, key: webPrivateKey };
            rcount++;
        }
        
        // If the bin certificate already exist, load it
        if (obj.fileExists(directory + '/mpsserver-cert-public.crt') && obj.fileExists(directory + '/mpsserver-cert-private.key')) {
            var mpsCertificate = obj.fs.readFileSync(directory + '/mpsserver-cert-public.crt', 'utf8');
            var mpsPrivateKey = obj.fs.readFileSync(directory + '/mpsserver-cert-private.key', 'utf8');
            r.mps = { cert: mpsCertificate, key: mpsPrivateKey };
            rcount++;
        }
        
        // If the bin certificate already exist, load it
        if (obj.fileExists(directory + '/agentserver-cert-public.crt') && obj.fileExists(directory + '/agentserver-cert-private.key')) {
            var agentCertificate = obj.fs.readFileSync(directory + '/agentserver-cert-public.crt', 'utf8');
            var agentPrivateKey = obj.fs.readFileSync(directory + '/agentserver-cert-private.key', 'utf8');
            r.agent = { cert: agentCertificate, key: agentPrivateKey };
            rcount++;
        }
                
        // Decode certificate arguments
        var commonName = 'un-configured', country, organization;
        if (certargs != undefined) {
            var args = certargs.split(',');
            if (args.length > 0) commonName = args[0];
            if (args.length > 1) country = args[1];
            if (args.length > 2) organization = args[2];
        }
        
        if (rcount == 4) {
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
            if ((r.CommonName == commonName) && (xcountry == country) && (xorganization == organization)) { if (func != undefined) { func(r); } return r; } // If the certificate matches what we want, keep it.
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
        webCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization);
        webCertificate = obj.pki.certificateToPem(webCertAndKey.cert);
        webPrivateKey = obj.pki.privateKeyToPem(webCertAndKey.key);
        obj.fs.writeFileSync(directory + '/webserver-cert-public.crt', webCertificate);
        obj.fs.writeFileSync(directory + '/webserver-cert-private.key', webPrivateKey);
        
        // If the Intel AMT MPS certificate does not exist, create one
        var mpsCertAndKey, mpsCertificate, mpsPrivateKey;
        mpsCertAndKey = obj.IssueWebServerCertificate(rootCertAndKey, false, commonName, country, organization);
        mpsCertificate = obj.pki.certificateToPem(mpsCertAndKey.cert);
        mpsPrivateKey = obj.pki.privateKeyToPem(mpsCertAndKey.key);
        obj.fs.writeFileSync(directory + '/mpsserver-cert-public.crt', mpsCertificate);
        obj.fs.writeFileSync(directory + '/mpsserver-cert-private.key', mpsPrivateKey);
        
        // If the mesh agent server certificate does not exist, create one
        var agentCertAndKey, agentCertificate, agentPrivateKey;
        if (r.agent == undefined) {
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

        var r = { root: { cert: rootCertificate, key: rootPrivateKey }, web: { cert: webCertificate, key: webPrivateKey }, mps: { cert: mpsCertificate, key: mpsPrivateKey }, agent: { cert: agentCertificate, key: agentPrivateKey }, CommonName: commonName, RootName: rootName };
        if (func != undefined) { func(r); }
        return r;
    }

    return obj;
};
