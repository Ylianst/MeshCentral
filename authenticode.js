/**
* @description Authenticode parsing
* @author Bryan Roe & Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

function createAuthenticodeHandler(path) {
    const obj = {};
    const fs = require('fs');
    const crypto = require('crypto');
    const forge = require('node-forge');
    const pki = forge.pki;
    const p7 = forge.pkcs7;
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
        if (obj.filesize < 64) { throw ('File too short'); }

        // Read the PE header size
        var buf = readFileSlice(60, 4);
        obj.header.header_size = buf.readUInt32LE(0);

        // Check file size and PE header
        if (obj.filesize < (160 + obj.header.header_size)) { throw ('Invalid SizeOfHeaders'); }
        if (readFileSlice(obj.header.header_size, 4).toString('hex') != '50450000') { throw ('Invalid PE File'); }

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

            // Remove the padding if needed
            var i, pkcs7raw = readFileSlice(obj.header.sigpos + 8, obj.header.siglen - 8);
            var derlen = forge.asn1.getBerValueLength(forge.util.createBuffer(pkcs7raw.slice(1, 5))) + 4;
            if (derlen != pkcs7raw.length) { pkcs7raw = pkcs7raw.slice(0, derlen); }

            // Decode the signature block
            var pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(pkcs7raw));

            // To work around ForgeJS PKCS#7 limitation
            // Switch content type from 1.3.6.1.4.1.311.2.1.4 to forge.pki.oids.data (1.2.840.113549.1.7.1)
            // TODO: Find forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.4').data and switch it.
            pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer(forge.pki.oids.data).data;

            // Convert the ASN1 content data into binary and place back
            var pkcs7content = forge.asn1.toDer(pkcs7der.value[1].value[0].value[2].value[1].value[0]).data;
            pkcs7der.value[1].value[0].value[2].value[1].value[0] = { tagClass: 0, type: 4, constructed: false, composed: false, value: pkcs7content };

            // DEBUG: Print out the new DER
            //console.log(Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary').toString('hex'));

            // Decode the PKCS7 message
            var pkcs7 = p7.messageFromAsn1(pkcs7der);
            var pkcs7content = forge.asn1.fromDer(pkcs7.rawCapture.content.value[0].value);

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

    // Generate a test self-signed certificate with code signing extension
    obj.createSelfSignedCert = function () {
        var keys = pki.rsa.generateKeyPair(2048);
        var cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '00000001';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 3);
        var attrs = [
            { name: 'commonName', value: 'example.org' },
            { name: 'countryName', value: 'US' },
            { shortName: 'ST', value: 'California' },
            { name: 'localityName', value: 'Santa Clara' },
            { name: 'organizationName', value: 'Test' },
            { shortName: 'OU', value: 'Test' }
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', keyCertSign: false, digitalSignature: true, nonRepudiation: false, keyEncipherment: false, dataEncipherment: false }, { name: 'extKeyUsage', codeSigning: true }, { name: "subjectKeyIdentifier" }]);
        cert.sign(keys.privateKey, forge.md.sha384.create());
        return { cert: cert, key: keys.privateKey };
    }

    // Sign the file using the certificate and key. If none is specified, generate a dummy one
    obj.sign = function (cert, key) {
        if ((cert == null) || (key == null)) { var c = obj.createSelfSignedCert(); cert = c.cert; key = c.key; }
        var fileHash = getHash('sha384');
        var p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(fileHash, 'utf8');
        p7.addCertificate(cert);
        p7.addSigner({
            key: key,
            certificate: cert,
            digestAlgorithm: forge.pki.oids.sha384,
            authenticatedAttributes:
            [
                {
                    type: obj.Oids.SPC_INDIRECT_DATA_OBJID,
                },
                {
                    type: forge.pki.oids.contentType,
                    value: forge.pki.oids.data
                },
                {
                    type: forge.pki.oids.messageDigest
                    // value will be auto-populated at signing time
                },
                {
                    type: forge.pki.oids.signingTime,
                    // value can also be auto-populated at signing time
                    value: new Date()
                }
            ]
        });
        p7.sign();
        var p7signature = Buffer.from(forge.pkcs7.messageToPem(p7).split('-----BEGIN PKCS7-----')[1].split('-----END PKCS7-----')[0], 'base64');
        console.log('p7signature', p7signature.toString('base64'));

        // Quad Align the results, adding padding if necessary
        var len = this.filesize + p7signature.length;
        var padding = (8 - ((len) % 8)) % 8;

        var addresstable = Buffer.alloc(8);
        addresstable.writeUInt32LE(this.filesize);
        addresstable.writeUInt32LE(8 + p7signature.length + padding, 4);

        var b = this.path.split('.');
        b[b.length - 2] += '-jsigned';

        var output = fs.openSync(b.join('.'), 'w');
        var written = 0;
        var bytesLeft = this.filesize;
        var tmp;

        // TODO: This copies the entire file including the old signature block.
        // Need to be fixed to only copy the file without the signature block
        while ((this.filesize - written) > 0) {
            tmp = readFileSlice(written, (this.filesize - written) > 65535 ? 65535 : this.filesize - written);
            fs.writeSync(output, tmp);
            written += tmp.length;
        }

        // Write the signature block
        var win = Buffer.alloc(8);                              // WIN CERTIFICATE Structure
        win.writeUInt32LE(p7signature.length + padding + 8);    // DWORD length
        win.writeUInt16LE(512, 4);                              // WORD revision
        win.writeUInt16LE(2, 6);                                // WORD type

        fs.writeSync(output, win);
        fs.writeSync(output, p7signature);
        if (padding > 0) { fs.writeSync(output, Buffer.alloc(padding, 0)); }
        fs.writeSync(output, addresstable, 0, addresstable.length, this.header.header_size + 152 + (this.header.pe32plus * 16));
        fs.closeSync(output);
    }

    openFile();
    return obj;
}

function start() {
    // Show tool help
    if (process.argv.length < 4) {
        console.log("MeshCentral Authenticode Tool.");
        console.log("Usage:");
        console.log("  node authenticode.js [command] [exepath]");
        console.log("Commands:");
        console.log("  info - Show information about this executable.");
        console.log("  sign - Sign the executable using a dummy certificate.");
        return;
    }

    // Check that a valid command is passed in
    if (['info', 'sign'].indexOf(process.argv[2].toLowerCase()) == -1) {
        console.log("Invalid command: " + process.argv[2]);
        return;
    }

    // Check the file exists
    var stats = null;
    try { stats = require('fs').statSync(process.argv[3]); } catch (ex) { }
    if (stats == null) {
        console.log("Unable to open file: " + process.argv[3]);
        return;
    }

    // Open the file
    var exe = createAuthenticodeHandler(process.argv[3]);

    // Execute the command
    var command = process.argv[2].toLowerCase();
    if (command == 'info') {
        console.log('Header', exe.header);
        if (exe.fileHashAlgo != null) { console.log('fileHashMethod', exe.fileHashAlgo); }
        if (exe.fileHashSigned != null) { console.log('fileHashSigned', exe.fileHashSigned.toString('hex')); }
        if (exe.fileHashActual != null) { console.log('fileHashActual', exe.fileHashActual.toString('hex')); }
        if (exe.signatureBlock) { console.log('Signature', exe.signatureBlock.toString('hex')); }
        console.log('FileLen: ' + exe.filesize);
    }

    if (command == 'sign') {
        console.log('Signing...');
        exe.sign();
    }

    // Close the file
    exe.close();
}

start();