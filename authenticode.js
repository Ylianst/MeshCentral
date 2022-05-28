/**
* @description Authenticode parsing
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

const fs = require('fs');
const crypto = require('crypto');
const forge = require('node-forge');
const pki = forge.pki;
const p7 = require('./pkcs7-modified');

// Generate a test self-signed certificate with code signing extension
function createSelfSignedCert(args) {
    var keys = pki.rsa.generateKeyPair(2048);
    var cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = (typeof args.serial == 'string')?args.serial:'012345'; // Serial number must always have a single leading '0', otherwise toPEM/fromPEM will not work right.
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
    var attrs = [];
    if (typeof args.cn == 'string') { attrs.push({ name: 'commonName', value: args.cn }); }
    if (typeof args.country == 'string') { attrs.push({ name: 'countryName', value: args.country }); }
    if (typeof args.state == 'string') { attrs.push({ name: 'ST', value: args.state }); }
    if (typeof args.locality == 'string') { attrs.push({ name: 'localityName', value: args.locality }); }
    if (typeof args.org == 'string') { attrs.push({ name: 'organizationName', value: args.org }); }
    if (typeof args.orgunit == 'string') { attrs.push({ name: 'OU', value: args.orgunit }); }
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', keyCertSign: false, digitalSignature: true, nonRepudiation: false, keyEncipherment: false, dataEncipherment: false }, { name: 'extKeyUsage', codeSigning: true }, { name: "subjectKeyIdentifier" }]);
    cert.sign(keys.privateKey, forge.md.sha384.create());
    return { cert: cert, key: keys.privateKey, extraCerts: [] };
}

// Create the output filename if not already specified
function createOutFile(args, filename) {
    if (typeof args.out == 'string') return;
    var outputFileName = filename.split('.');
    outputFileName[outputFileName.length - 2] += '-out';
    args.out = outputFileName.join('.');
}

// Load certificates and private key from PEM files
function loadCertificates(args) {
    var certs = [], keys = [], pemFileNames = args.pem;
    if (pemFileNames == null) return;
    if (typeof pemFileNames == 'string') { pemFileNames = [pemFileNames]; }
    for (var i in pemFileNames) {
        try {
            // Read certificate
            var pem = fs.readFileSync(pemFileNames[i]).toString();
            var pemCerts = pem.split('-----BEGIN CERTIFICATE-----');
            for (var j in pemCerts) {
                var k = pemCerts[j].indexOf('-----END CERTIFICATE-----');
                if (k >= 0) { certs.push(pki.certificateFromPem('-----BEGIN CERTIFICATE-----' + pemCerts[j].substring(0, k) + '-----END CERTIFICATE-----')); }
            }
            var PemKeys = pem.split('-----BEGIN RSA PRIVATE KEY-----');
            for (var j in PemKeys) {
                var k = PemKeys[j].indexOf('-----END RSA PRIVATE KEY-----');
                if (k >= 0) { keys.push(pki.privateKeyFromPem('-----BEGIN RSA PRIVATE KEY-----' + PemKeys[j].substring(0, k) + '-----END RSA PRIVATE KEY-----')); }
            }
        } catch (ex) { }
    }
    if ((certs.length == 0) || (keys.length != 1)) return; // No certificates or private keys
    var r = { cert: certs[0], key: keys[0], extraCerts: [] }
    if (certs.length > 1) { for (var i = 1; i < certs.length; i++) { r.extraCerts.push(certs[i]); } }
    return r;
}

function createAuthenticodeHandler(path) {
    const obj = {};
    obj.header = { path: path }

    // Read a file slice
    function readFileSlice(start, length) {
        var buffer = Buffer.alloc(length);
        var len = fs.readSync(obj.fd, buffer, 0, buffer.length, start);
        if (len < buffer.length) { buffer = buffer.slice(0, len); }
        return buffer;
    }

    // Close the file
    obj.close = function () {
        if (obj.fd == null) return;
        fs.closeSync(obj.fd);
        delete obj.fd;
    }

    // Private OIDS
    obj.Oids = {
        SPC_INDIRECT_DATA_OBJID: '1.3.6.1.4.1.311.2.1.4',
        SPC_STATEMENT_TYPE_OBJID: '1.3.6.1.4.1.311.2.1.11',
        SPC_SP_OPUS_INFO_OBJID: '1.3.6.1.4.1.311.2.1.12',
        SPC_INDIVIDUAL_SP_KEY_PURPOSE_OBJID: '1.3.6.1.4.1.311.2.1.21',
        SPC_COMMERCIAL_SP_KEY_PURPOSE_OBJID: '1.3.6.1.4.1.311.2.1.22',
        SPC_MS_JAVA_SOMETHING: '1.3.6.1.4.1.311.15.1',
        SPC_PE_IMAGE_DATA_OBJID: '1.3.6.1.4.1.311.2.1.15',
        SPC_CAB_DATA_OBJID: '1.3.6.1.4.1.311.2.1.25',
        SPC_TIME_STAMP_REQUEST_OBJID: '1.3.6.1.4.1.311.3.2.1',
        SPC_SIPINFO_OBJID: '1.3.6.1.4.1.311.2.1.30',
        SPC_PE_IMAGE_PAGE_HASHES_V1: '1.3.6.1.4.1.311.2.3.1',
        SPC_PE_IMAGE_PAGE_HASHES_V2: '1.3.6.1.4.1.311.2.3.2',
        SPC_NESTED_SIGNATURE_OBJID: '1.3.6.1.4.1.311.2.4.1',
        SPC_RFC3161_OBJID: '1.3.6.1.4.1.311.3.3.1'
    }

    // Open the file and read header information
    function openFile() {
        if (obj.fd != null) return;

        // Open the file descriptor
        obj.path = path;
        obj.fd = fs.openSync(path);
        obj.stats = fs.fstatSync(obj.fd);
        obj.filesize = obj.stats.size;
        if (obj.filesize < 64) { throw ('File too short.'); }

        // Read the PE header size
        var buf = readFileSlice(60, 4);
        obj.header.header_size = buf.readUInt32LE(0);

        // Check file size and PE header
        if (obj.filesize < (160 + obj.header.header_size)) { throw ('Invalid SizeOfHeaders.'); }
        if (readFileSlice(obj.header.header_size, 4).toString('hex') != '50450000') { throw ('Invalid PE File.'); }

        // Check header magic data
        var magic = readFileSlice(obj.header.header_size + 24, 2).readUInt16LE(0);
        switch (magic) {
            case 0x20b: obj.header.pe32plus = 1; break;
            case 0x10b: obj.header.pe32plus = 0; break;
            default: throw ('Invalid Magic in PE');
        }

        // Read PE header information
        obj.header.pe_checksum = readFileSlice(obj.header.header_size + 88, 4).readUInt32LE(0);
        obj.header.numRVA = readFileSlice(obj.header.header_size + 116 + (obj.header.pe32plus * 16), 4).readUInt32LE(0);
        buf = readFileSlice(obj.header.header_size + 152 + (obj.header.pe32plus * 16), 8);
        obj.header.sigpos = buf.readUInt32LE(0);
        obj.header.siglen = buf.readUInt32LE(4);
        obj.header.signed = ((obj.header.sigpos != 0) && (obj.header.siglen != 0));

        if (obj.header.signed) {
            // Read signature block

            // Check if the file size allows for the signature block
            if (obj.filesize < (obj.header.sigpos + obj.header.siglen)) { throw ('Executable file too short to contain the signature block.'); }

            // Remove the padding if needed
            var i, pkcs7raw = readFileSlice(obj.header.sigpos + 8, obj.header.siglen - 8);
            var derlen = forge.asn1.getBerValueLength(forge.util.createBuffer(pkcs7raw.slice(1, 5))) + 4;
            if (derlen != pkcs7raw.length) { pkcs7raw = pkcs7raw.slice(0, derlen); }

            //console.log('pkcs7raw', Buffer.from(pkcs7raw, 'binary').toString('base64'));

            // Decode the signature block
            var pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(pkcs7raw));
            
            // To work around ForgeJS PKCS#7 limitation, this may break PKCS7 verify if ForjeJS adds support for it in the future
            // Switch content type from "1.3.6.1.4.1.311.2.1.4" to "1.2.840.113549.1.7.1"
            pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer(forge.pki.oids.data).data;

            // Decode the PKCS7 message
            var pkcs7 = p7.messageFromAsn1(pkcs7der);
            var pkcs7content = pkcs7.rawCapture.content.value[0];

            /*
            // Verify a PKCS#7 signature
            // Verify is not currently supported in node-forge, but if implemented in the future, this code could work.
            var caStore = forge.pki.createCaStore();
            for (var i in obj.certificates) { caStore.addCertificate(obj.certificates[i]); }
            // Return is true if all signatures are valid and chain up to a provided CA
            if (!pkcs7.verify(caStore)) { throw ('Executable file has an invalid signature.'); }
            */

            // Get the signing attributes
            obj.signingAttribs = [];
            for (var i in pkcs7.rawCapture.authenticatedAttributes) {
                if (forge.asn1.derToOid(pkcs7.rawCapture.authenticatedAttributes[i].value[0].value) == obj.Oids.SPC_SP_OPUS_INFO_OBJID) {
                    for (var j in pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value) {
                        var v = pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j].value[0].value;
                        if (v.startsWith('http://') || v.startsWith('https://') || ((v.length % 2) == 1)) { obj.signingAttribs.push(v); } else {
                            var r = ""; // This string value is in UCS2 format, convert it to a normal string.
                            for (var k = 0; k < v.length; k += 2) { r += String.fromCharCode((v.charCodeAt(k + 8) << 8) + v.charCodeAt(k + 1)); }
                            obj.signingAttribs.push(r);
                        }
                    }
                }
            }

            // Set the certificate chain
            obj.certificates = pkcs7.certificates;

            // Get the file hashing algorithm
            var hashAlgoOid = forge.asn1.derToOid(pkcs7content.value[1].value[0].value[0].value);
            switch (hashAlgoOid) {
                case forge.pki.oids.sha256: { obj.fileHashAlgo = 'sha256'; break; }
                case forge.pki.oids.sha384: { obj.fileHashAlgo = 'sha384'; break; }
                case forge.pki.oids.sha512: { obj.fileHashAlgo = 'sha512'; break; }
                case forge.pki.oids.sha224: { obj.fileHashAlgo = 'sha224'; break; }
                case forge.pki.oids.md5: { obj.fileHashAlgo = 'md5'; break; }
            }

            // Get the signed file hash
            obj.fileHashSigned = Buffer.from(pkcs7content.value[1].value[1].value, 'binary')

            // Compute the actual file hash
            if (obj.fileHashAlgo != null) { obj.fileHashActual = getHash(obj.fileHashAlgo); }
        }
    }

    // Hash the file using the selected hashing system
    function getHash(algo) {
        var hash = crypto.createHash(algo);
        runHash(hash, 0, obj.header.header_size + 88);
        runHash(hash, obj.header.header_size + 88 + 4, obj.header.header_size + 152 + (obj.header.pe32plus * 16));
        runHash(hash, obj.header.header_size + 152 + (obj.header.pe32plus * 16) + 8, obj.header.sigpos > 0 ? obj.header.sigpos : obj.filesize);
        return hash.digest();
    }

    // Hash the file from start to end loading 64k chunks
    function runHash(hash, start, end) {
        var ptr = start;
        while (ptr < end) { const buf = readFileSlice(ptr, Math.min(65536, end - ptr)); hash.update(buf); ptr += buf.length; }
    }

    // Sign the file using the certificate and key. If none is specified, generate a dummy one
    obj.sign = function (cert, args) {
        if (cert == null) { cert = createSelfSignedCert({ cn: 'Test' }); }
        var fileHash = getHash('sha384');

        // Create the signature block
        var p7 = forge.pkcs7.createSignedData();
        var content = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.15').data }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000', 'bitStringContents': '\u0000', 'original': { 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000' } }, { 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 2, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': '' }] }] }] }] }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer(forge.pki.oids.sha384).data }, { 'tagClass': 0, 'type': 5, 'constructed': false, 'composed': false, 'value': '' }] }, { 'tagClass': 0, 'type': 4, 'constructed': false, 'composed': false, 'value': fileHash.toString('binary') }] }] };
        p7.contentInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.4').getBytes())]);
        p7.contentInfo.value.push(forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [content]));
        p7.content = {}; // We set .contentInfo and have .content empty to bypass node-forge limitation on the type of content it can sign.
        p7.addCertificate(cert.cert);
        if (cert.extraCerts) { for (var i = 0; i < cert.extraCerts.length; i++) { p7.addCertificate(cert.extraCerts[0]); } } // Add any extra certificates that form the cert chain

        // Build authenticated attributes
        var authenticatedAttributes = [
            { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
            { type: forge.pki.oids.messageDigest } // This value will populated at signing time by node-forge
        ]
        if ((typeof args.desc == 'string') || (typeof args.url == 'string')) {
            var codeSigningAttributes = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [ ] };
            if (args.desc != null) { codeSigningAttributes.value.push({ 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': Buffer.from(args.desc, 'ucs2').toString() }] }); }
            if (args.url != null) { codeSigningAttributes.value.push({ 'tagClass': 128, 'type': 1, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': args.url }] }); }
            authenticatedAttributes.push({ type: obj.Oids.SPC_SP_OPUS_INFO_OBJID, value: codeSigningAttributes });
        }

        // Add the signer and sign
        p7.addSigner({
            key: cert.key,
            certificate: cert.cert,
            digestAlgorithm: forge.pki.oids.sha384,
            authenticatedAttributes: authenticatedAttributes
        });
        p7.sign();
        var p7signature = Buffer.from(forge.pkcs7.messageToPem(p7).split('-----BEGIN PKCS7-----')[1].split('-----END PKCS7-----')[0], 'base64');
        //console.log('Signature', Buffer.from(p7signature, 'binary').toString('base64'));

        // Open the outut file
        var output = fs.openSync(args.out, 'w');
        var tmp, written = 0;
        var executableSize = obj.header.sigpos ? obj.header.sigpos : this.filesize;

        // Compute pre-header length and copy that to the new file
        var preHeaderLen = (obj.header.header_size + 152 + (obj.header.pe32plus * 16));
        var tmp = readFileSlice(written, preHeaderLen);
        fs.writeSync(output, tmp);
        written += tmp.length;

        // Quad Align the results, adding padding if necessary
        var len = executableSize + p7signature.length;
        var padding = (8 - ((len) % 8)) % 8;

        // Write the signature header
        var addresstable = Buffer.alloc(8);
        addresstable.writeUInt32LE(executableSize);
        addresstable.writeUInt32LE(8 + p7signature.length + padding, 4);
        fs.writeSync(output, addresstable);
        written += addresstable.length;

        // Copy the rest of the file until the start of the signature block
        while ((executableSize - written) > 0) {
            tmp = readFileSlice(written, Math.min(executableSize - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }

        // Write the signature block header and signature
        var win = Buffer.alloc(8);                              // WIN CERTIFICATE Structure
        win.writeUInt32LE(p7signature.length + padding + 8);    // DWORD length
        win.writeUInt16LE(512, 4);                              // WORD revision
        win.writeUInt16LE(2, 6);                                // WORD type
        fs.writeSync(output, win);
        fs.writeSync(output, p7signature);
        if (padding > 0) { fs.writeSync(output, Buffer.alloc(padding, 0)); }

        // Close the file
        fs.closeSync(output);
    }

    // Save an executable without the signature
    obj.unsign = function (args) {
        // Open the file
        var output = fs.openSync(args.out, 'w');
        var written = 0, totalWrite = obj.header.sigpos;

        // Compute pre-header length and copy that to the new file
        var preHeaderLen = (obj.header.header_size + 152 + (obj.header.pe32plus * 16));
        var tmp = readFileSlice(written, preHeaderLen);
        fs.writeSync(output, tmp);
        written += tmp.length;

        // Write the new signature header
        fs.writeSync(output, Buffer.alloc(8));
        written += 8;

        // Copy the rest of the file until the start of the signature block
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }
        fs.closeSync(output);
    }

    openFile();
    return obj;
}

function start() {
    // Parse the arguments
    const args = require('minimist')(process.argv.slice(2));

    // Show tool help
    if (process.argv.length < 3) {
        console.log("MeshCentral Authenticode Tool.");
        console.log("Usage:");
        console.log("  node authenticode.js [command] [options]");
        console.log("Commands:");
        console.log("  info: Show information about an executable.");
        console.log("          --json                   Show information in JSON format.");
        console.log("  sign: Sign an executable.");
        console.log("          --exe [file]             Required executable to sign.");
        console.log("          --out [file]             Resulting signed executable.");
        console.log("          --pem [pemfile]          Certificate & private key to sign the executable with.");
        console.log("          --desc [description]     Description string to embbed into signature.");
        console.log("          --url [url]              URL to embbed into signature.");
        console.log("  unsign: Remove the signature from the executable.");
        console.log("          --exe [file]             Required executable to un-sign.");
        console.log("          --out [file]             Resulting executable with signature removed.");
        console.log("  createcert: Create a code signging self-signed certificate and key.");
        console.log("          --out [pemfile]          Required certificate file to create.");
        console.log("          --cn [value]             Required certificate common name.");
        console.log("          --country [value]        Certificate country name.");
        console.log("          --state [value]          Certificate state name.");
        console.log("          --locality [value]       Certificate locality name.");
        console.log("          --org [value]            Certificate organization name.");
        console.log("          --ou [value]             Certificate organization unit name.");
        console.log("          --serial [value]         Certificate serial number.");
        console.log("");
        console.log("Note that certificate PEM files must first have the signing certificate,");
        console.log("followed by all certificates that form the trust chain.");
        return;
    }

    // Check that a valid command is passed in
    if (['info', 'sign', 'unsign', 'createcert'].indexOf(process.argv[2].toLowerCase()) == -1) {
        console.log("Invalid command: " + process.argv[2]);
        console.log("Valid commands are: info, sign, unsign, createcert");
        return;
    }

    var exe = null;
    if (args.exe) {
        // Check the file exists and open the file
        var stats = null;
        try { stats = require('fs').statSync(args.exe); } catch (ex) { }
        if (stats == null) { console.log("Unable to executable open file: " + args.exe); return; }
        exe = createAuthenticodeHandler(args.exe);
    }

    // Execute the command
    var command = process.argv[2].toLowerCase();
    if (command == 'info') { // Get signature information about an executable
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (args.json) {
            var r = { header: exe.header, filesize: exe.filesize }
            if (exe.fileHashAlgo != null) { r.hashMethod = exe.fileHashAlgo; }
            if (exe.fileHashSigned != null) { r.hashSigned = exe.fileHashSigned.toString('hex'); }
            if (exe.fileHashActual != null) { r.hashActual = exe.fileHashActual.toString('hex'); }
            if (exe.signingAttribs && exe.signingAttribs.length > 0) { r.signAttributes = exe.signingAttribs; }
            console.log(JSON.stringify(r, null, 2));
        } else {
            console.log("Header", exe.header);
            if (exe.fileHashAlgo != null) { console.log("Hash Method:", exe.fileHashAlgo); }
            if (exe.fileHashSigned != null) { console.log("Signed Hash:", exe.fileHashSigned.toString('hex')); }
            if (exe.fileHashActual != null) { console.log("Actual Hash:", exe.fileHashActual.toString('hex')); }
            if (exe.signingAttribs && exe.signingAttribs.length > 0) { console.log("Signature Attributes:"); for (var i in exe.signingAttribs) { console.log('  ' + exe.signingAttribs[i]); } }
            console.log("File Length: " + exe.filesize);
        }
    }
    if (command == 'sign') { // Sign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        createOutFile(args, args.exe);
        const cert = loadCertificates(args);
        if (cert == null) { console.log("Unable to load certificate and/or private key, generating text certificate."); }
        console.log("Signing to " + args.out); exe.sign(cert, args); console.log("Done.");
    }
    if (command == 'unsign') { // Unsign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        createOutFile(args, args.exe);
        if (exe.header.signed) { console.log("Unsigning to " + args.out); exe.unsign(args); console.log("Done."); } else { console.log("Executable is not signed."); }
    }
    if (command == 'createcert') { // Create a code signing certificate and private key
        if (typeof args.out != 'string') { console.log("Missing --out [filename]"); return; }
        if (typeof args.cn != 'string') { console.log("Missing --cn [name]"); return; }
        if (typeof args.serial == 'string') { if (args.serial != parseInt(args.serial)) { console.log("Invalid serial number."); return; } else { args.serial = parseInt(args.serial); } }
        if (typeof args.serial == 'number') { args.serial = '0' + args.serial; } // Serial number must be a integer string with a single leading '0'
        const cert = createSelfSignedCert(args);
        console.log("Writing to " + args.out);
        fs.writeFileSync(args.out, pki.certificateToPem(cert.cert) + '\r\n' + pki.privateKeyToPem(cert.key));
        console.log("Done.");
    }

    // Close the file
    if (exe != null) { exe.close(); }
}

start();