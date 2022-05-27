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

            //console.log('pkcs7raw', pkcs7raw.toString('base64'));

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
            //console.log(Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary').toString('base64'));

            // Decode the PKCS7 message
            var pkcs7 = p7.messageFromAsn1(pkcs7der);
            var pkcs7content = forge.asn1.fromDer(pkcs7.rawCapture.content.value[0].value);
            obj.rawSignedContent = pkcs7.rawCapture.content.value[0].value;

            //console.log('p7content', JSON.stringify(pkcs7content));

            // DEBUG: Print out the content
            //console.log(Buffer.from(pkcs7.rawCapture.content.value[0].value, 'binary').toString('hex'));

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
        p7.content = forge.asn1.toDer({ "tagClass": 0, "type": 16, "constructed": true, "composed": true, "value": [{ "tagClass": 0, "type": 16, "constructed": true, "composed": true, "value": [{ "tagClass": 0, "type": 6, "constructed": false, "composed": false, "value": forge.asn1.oidToDer("1.3.6.1.4.1.311.2.1.15").data }, { "tagClass": 0, "type": 16, "constructed": true, "composed": true, "value": [{ "tagClass": 0, "type": 3, "constructed": false, "composed": false, "value": "\u0000", "bitStringContents": "\u0000", "original": { "tagClass": 0, "type": 3, "constructed": false, "composed": false, "value": "\u0000" } }, { "tagClass": 128, "type": 0, "constructed": true, "composed": true, "value": [{ "tagClass": 128, "type": 2, "constructed": true, "composed": true, "value": [{ "tagClass": 128, "type": 0, "constructed": false, "composed": false, "value": "" }] }] }] }] }, { "tagClass": 0, "type": 16, "constructed": true, "composed": true, "value": [{ "tagClass": 0, "type": 16, "constructed": true, "composed": true, "value": [{ "tagClass": 0, "type": 6, "constructed": false, "composed": false, "value": forge.asn1.oidToDer(forge.pki.oids.sha384).data }, { "tagClass": 0, "type": 5, "constructed": false, "composed": false, "value": "" }] }, { "tagClass": 0, "type": 4, "constructed": false, "composed": false, "value": fileHash.toString('binary') }] }] });
        p7.addCertificate(cert);
        p7.addSigner({
            key: key,
            certificate: cert,
            digestAlgorithm: forge.pki.oids.sha384,
            authenticatedAttributes:
            [
                { type: obj.Oids.SPC_INDIRECT_DATA_OBJID, },
                { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
                { type: forge.pki.oids.messageDigest }, // value will be auto-populated at signing time
                { type: forge.pki.oids.signingTime, value: new Date() } // value can also be auto-populated at signing time
            ]
        });
        p7.sign();
        var p7signature = Buffer.from(forge.pkcs7.messageToPem(p7).split('-----BEGIN PKCS7-----')[1].split('-----END PKCS7-----')[0], 'base64');

        // Correct the signed data type
        // Decode the signature block
        var pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(p7signature.toString('binary')));

        // To work around ForgeJS PKCS#7 limitation
        // Switch content type from 1.2.840.113549.1.7.1 to forge.pki.oids.data (1.3.6.1.4.1.311.2.1.4)
        pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.4').data;

        // Convert the ASN1 content data into binary and place back
        var pkcs7content = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(pkcs7der.value[1].value[0].value[2].value[1].value[0].value, 'binary').toString('binary')));
        pkcs7der.value[1].value[0].value[2].value[1].value = [ pkcs7content ];
        p7signature = Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary');

        // Create the output filename
        var outputFileName = this.path.split('.');
        outputFileName[outputFileName.length - 2] += '-jsigned';
        outputFileName = outputFileName.join('.');

        // Open the file
        var output = fs.openSync(outputFileName, 'w');
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
    obj.unsign = function (cert, key) {
        // Create the output filename
        var outputFileName = this.path.split('.');
        outputFileName[outputFileName.length - 2] += '-junsigned';
        outputFileName = outputFileName.join('.');

        // Open the file
        var output = fs.openSync(outputFileName, 'w');
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
    // Show tool help
    if (process.argv.length < 4) {
        console.log("MeshCentral Authenticode Tool.");
        console.log("Usage:");
        console.log("  node authenticode.js [command] [exepath]");
        console.log("Commands:");
        console.log("  info - Show information about an executable.");
        console.log("  sign - Sign an executable using a dummy certificate.");
        console.log("  unsign - Remove the signature from the executable.");
        return;
    }

    // Check that a valid command is passed in
    if (['info', 'sign', 'unsign'].indexOf(process.argv[2].toLowerCase()) == -1) {
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
        console.log('Signing...'); exe.sign(); console.log('Done.');
    }
    if (command == 'unsign') {
        if (exe.header.signed) { console.log('Unsigning...'); exe.unsign(); console.log('Done.'); } else { console.log('Executable is not signed.'); }
    }

    // Close the file
    exe.close();
}

start();