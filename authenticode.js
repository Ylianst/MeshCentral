/**
* @description Authenticode parsing
* @author Ylian Saint-Hilaire & Bryan Roe
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

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
function loadCertificates(pemFileNames) {
    var certs = [], keys = [];
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
        if (obj.fd != null) return true;

        // Open the file descriptor
        obj.path = path;
        try { obj.fd = fs.openSync(path); } catch (ex) { return false; } // Unable to open file
        obj.stats = fs.fstatSync(obj.fd);
        obj.filesize = obj.stats.size;
        if (obj.filesize < 64) { obj.close(); return false; } // File too short.

        // Read the PE header pointer
        var buf = readFileSlice(60, 4);
        obj.header.PeHeaderLocation = buf.readUInt32LE(0); // The DOS header is 64 bytes long, the last 4 bytes are a pointer to the PE header.
        obj.header.PeOptionalHeaderLocation = obj.header.PeHeaderLocation + 24; // The PE optional header is located just after the PE header which is 24 bytes long.

        // Check file size and PE header
        if (obj.filesize < (160 + obj.header.PeHeaderLocation)) { obj.close(); return false; } // Invalid SizeOfHeaders.
        if (readFileSlice(obj.header.PeHeaderLocation, 4).toString('hex') != '50450000') { obj.close(); return false; } // Invalid PE header, must start with "PE" (HEX: 50 45 00 00).

        // Read the size of the optional header
        obj.header.PeOptionalHeaderSize = readFileSlice(obj.header.PeHeaderLocation + 20, 2).readUInt16LE(0);

        // The section headers are located after the optional PE header
        obj.header.SectionHeadersPtr = obj.header.PeOptionalHeaderLocation + obj.header.PeOptionalHeaderSize;

        // Check header magic data
        var magic = readFileSlice(obj.header.PeOptionalHeaderLocation, 2).readUInt16LE(0);
        switch (magic) {
            case 0x020B: obj.header.pe32plus = 1; break;
            case 0x010B: obj.header.pe32plus = 0; break;
            default: { obj.close(); return false; } // Invalid Magic in PE
        }

        // Read optional PE header information
        obj.header.pe_checksum = readFileSlice(obj.header.PeOptionalHeaderLocation + 64, 4).readUInt32LE(0);
        obj.header.numRVA = readFileSlice(obj.header.PeOptionalHeaderLocation + 92 + (obj.header.pe32plus * 16), 4).readUInt32LE(0);
        buf = readFileSlice(obj.header.PeOptionalHeaderLocation + 128 + (obj.header.pe32plus * 16), 8);
        obj.header.sigpos = buf.readUInt32LE(0);
        obj.header.siglen = buf.readUInt32LE(4);
        obj.header.signed = ((obj.header.sigpos != 0) && (obj.header.siglen != 0));

        // Read the sections
        obj.header.sections = {};
        for (var i = 0; i < 16; i++) {
            var section = {};
            buf = readFileSlice(obj.header.SectionHeadersPtr + (i * 40), 40);
            if (buf[0] != 46) break; // Name of the section must start with a dot. If not, we are done reading sections.
            var sectionName = buf.slice(0, 8).toString().trim('\0');
            var j = sectionName.indexOf('\0');
            if (j >= 0) { sectionName = sectionName.substring(0, j); } // Trim any trailing zeroes
            section.virtualSize = buf.readUInt32LE(8);
            section.virtualAddr = buf.readUInt32LE(12);
            section.rawSize = buf.readUInt32LE(16);
            section.rawAddr = buf.readUInt32LE(20);
            section.relocAddr = buf.readUInt32LE(24);
            section.lineNumbers = buf.readUInt32LE(28);
            section.relocNumber = buf.readUInt16LE(32);
            section.lineNumbersNumber = buf.readUInt16LE(34);
            section.characteristics = buf.readUInt32LE(36);
            obj.header.sections[sectionName] = section;
        }

        // If there is a .rsrc section, read the resource information and locations
        if (obj.header.sections['.rsrc'] != null) {
            var ptr = obj.header.sections['.rsrc'].rawAddr;
            obj.resources = readResourceTable(ptr, 0); // Read all resources recursively
        }

        if (obj.header.signed) {
            // Read signature block

            // Check if the file size allows for the signature block
            if (obj.filesize < (obj.header.sigpos + obj.header.siglen)) { obj.close(); return false; } // Executable file too short to contain the signature block.

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

            // Verify a PKCS#7 signature
            // Verify is not currently supported in node-forge, but if implemented in the future, this code could work.
            //var caStore = forge.pki.createCaStore();
            //for (var i in obj.certificates) { caStore.addCertificate(obj.certificates[i]); }
            // Return is true if all signatures are valid and chain up to a provided CA
            //if (!pkcs7.verify(caStore)) { throw ('Executable file has an invalid signature.'); }

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
            if (obj.fileHashAlgo != null) { obj.fileHashActual = obj.getHash(obj.fileHashAlgo); }
        }
        return true;
    }

    // Read a resource table.
    // ptr: The pointer to the start of the resource section
    // offset: The offset start of the resource table to read
    function readResourceTable(ptr, offset) {
        var buf = readFileSlice(ptr + offset, 16);
        var r = {};
        r.characteristics = buf.readUInt32LE(0);
        r.timeDateStamp = buf.readUInt32LE(4);
        r.majorVersion = buf.readUInt16LE(8);
        r.minorVersion = buf.readUInt16LE(10);
        var numberOfNamedEntries = buf.readUInt16LE(12);
        var numberofIdEntries = buf.readUInt16LE(14);
        r.entries = [];
        var totalResources = numberOfNamedEntries + numberofIdEntries;
        for (var i = 0; i < totalResources; i++) {
            buf = readFileSlice(ptr + offset + 16 + (i * 8), 8);
            var resource = {};
            resource.name = buf.readUInt32LE(0);
            var offsetToData = buf.readUInt32LE(4);
            if ((resource.name & 0x80000000) != 0) { resource.name = readLenPrefixUnicodeString(ptr + (resource.name - 0x80000000)); }
            if ((offsetToData & 0x80000000) != 0) { resource.table = readResourceTable(ptr, offsetToData - 0x80000000); } else { resource.item = readResourceItem(ptr, offsetToData); }
            r.entries.push(resource);
        }
        return r;
    }

    // Read a resource item
    // ptr: The pointer to the start of the resource section
    // offset: The offset start of the resource item to read
    function readResourceItem(ptr, offset) {
        var buf = readFileSlice(ptr + offset, 16), r = {};
        r.offsetToData = buf.readUInt32LE(0);
        r.size = buf.readUInt32LE(4);
        r.codePage = buf.readUInt32LE(8);
        r.reserved = buf.readUInt32LE(12);
        return r;
    }

    // Read a unicode stting that starts with the string length as the first byte.
    function readLenPrefixUnicodeString(ptr) {
        var nameLen = readFileSlice(ptr, 1)[0];
        var buf = readFileSlice(ptr + 1, nameLen * 2), name = '';
        for (var i = 0; i < nameLen; i++) { name += String.fromCharCode(buf.readUInt16BE(i * 2)); }
        return name;
    }

    // Convert a unicode buffer to a string
    function unicodeToString(buf) {
        var r = '';
        for (var i = 0; i < (buf.length / 2) ; i++) { r += String.fromCharCode(buf.readUInt16LE(i * 2)); }
        return r;
    }

    // Trim a string at teh first null character
    function stringUntilNull(str) {
        if (str == null) return null;
        const i = str.indexOf('\0');
        if (i >= 0) return str.substring(0, i);
        return str;
    }

    // Decode the version information from the resource
    obj.getVersionInfo = function () {
        var r = {}, info = readVersionInfo(getVersionInfoData(), 0);
        if ((info == null) || (info.stringFiles == null)) return null;
        var StringFileInfo = null;
        for (var i in info.stringFiles) { if (info.stringFiles[i].szKey == 'StringFileInfo') { StringFileInfo = info.stringFiles[i]; } }
        if ((StringFileInfo == null) || (StringFileInfo.stringTable == null) || (StringFileInfo.stringTable.strings == null)) return null;
        const strings = StringFileInfo.stringTable.strings;
        for (var i in strings) { r[strings[i].key] = strings[i].value; }
        return r;
    }

    // Return the version info data block
    function getVersionInfoData() {
        if (obj.resources == null) return null;
        var ptr = obj.header.sections['.rsrc'].rawAddr;
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == 16) {
                const verInfo = obj.resources.entries[i].table.entries[0].table.entries[0].item;
                const actualPtr = (verInfo.offsetToData - obj.header.sections['.rsrc'].virtualAddr) + ptr;
                return readFileSlice(actualPtr, verInfo.size);
            }
        }
        return null;
    }

    // VS_VERSIONINFO structure: https://docs.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo
    function readVersionInfo(buf, ptr) {
        const r = {};
        if (buf.length < 2) return null;
        r.wLength = buf.readUInt16LE(ptr);
        if (buf.length < r.wLength) return null;
        r.wValueLength = buf.readUInt16LE(ptr + 2);
        r.wType = buf.readUInt16LE(ptr + 4);
        r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + 36));
        if (r.szKey != 'VS_VERSION_INFO') return null;
        //console.log('getVersionInfo', r.wLength, r.wValueLength, r.wType, r.szKey.toString());
        if (r.wValueLength == 52) { r.fixedFileInfo = readFixedFileInfoStruct(buf, ptr + 40); }
        r.stringFiles = readStringFilesStruct(buf, ptr + 40 + r.wValueLength, r.wLength - 40 - r.wValueLength);
        return r;
    }

    // VS_FIXEDFILEINFO structure: https://docs.microsoft.com/en-us/windows/win32/api/verrsrc/ns-verrsrc-vs_fixedfileinfo
    function readFixedFileInfoStruct(buf, ptr) {
        if (buf.length - ptr < 50) return null;
        var r = {};
        r.dwSignature = buf.readUInt32LE(ptr);
        if (r.dwSignature != 0xFEEF04BD) return null;
        r.dwStrucVersion = buf.readUInt32LE(ptr + 4);
        r.dwFileVersionMS = buf.readUInt32LE(ptr + 8);
        r.dwFileVersionLS = buf.readUInt32LE(ptr + 12);
        r.dwProductVersionMS = buf.readUInt32LE(ptr + 16);
        r.dwProductVersionLS = buf.readUInt32LE(ptr + 20);
        r.dwFileFlagsMask = buf.readUInt32LE(ptr + 24);
        r.dwFileFlags = buf.readUInt32LE(ptr + 28);
        r.dwFileOS = buf.readUInt32LE(ptr + 32);
        r.dwFileType = buf.readUInt32LE(ptr + 36);
        r.dwFileSubtype = buf.readUInt32LE(ptr + 40);
        r.dwFileDateMS = buf.readUInt32LE(ptr + 44);
        r.dwFileDateLS = buf.readUInt32LE(ptr + 48);
        return r;
    }

    // StringFileInfo structure: https://docs.microsoft.com/en-us/windows/win32/menurc/stringfileinfo
    function readStringFilesStruct(buf, ptr, len) {
        var t = [], startPtr = ptr;
        while (ptr < (startPtr + len)) {
            const r = {};
            r.wLength = buf.readUInt16LE(ptr);
            if (r.wLength == 0) return t;
            r.wValueLength = buf.readUInt16LE(ptr + 2);
            r.wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
            r.szKey = stringUntilNull(unicodeToString(buf.slice(ptr + 6, ptr + 6 + (r.wLength - 6)))); // String value
            //console.log('readStringFileStruct', r.wLength, r.wValueLength, r.wType, r.szKey.toString());
            if (r.szKey == 'StringFileInfo') { r.stringTable = readStringTableStruct(buf, ptr + 36 + r.wValueLength); }
            if (r.szKey == 'VarFileInfo$') { r.varFileInfo = {}; } // TODO
            t.push(r);
            ptr += r.wLength;
            ptr = padPointer(ptr);
        }
        return t;
    }

    // StringTable structure: https://docs.microsoft.com/en-us/windows/win32/menurc/stringtable
    function readStringTableStruct(buf, ptr) {
        const r = {};
        r.wLength = buf.readUInt16LE(ptr);
        r.wValueLength = buf.readUInt16LE(ptr + 2);
        r.wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
        r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + 6 + 16)); // An 8-digit hexadecimal number stored as a Unicode string.
        //console.log('readStringTableStruct', r.wLength, r.wValueLength, r.wType, r.szKey);
        r.strings = readStringStructs(buf, ptr + 24 + r.wValueLength, r.wLength - 22);
        return r;
    }

    // String structure: https://docs.microsoft.com/en-us/windows/win32/menurc/string-str
    function readStringStructs(buf, ptr, len) {
        var t = [], startPtr = ptr;
        while (ptr < (startPtr + len)) {
            const r = {};
            r.wLength = buf.readUInt16LE(ptr);
            if (r.wLength == 0) return t;
            r.wValueLength = buf.readUInt16LE(ptr + 2);
            r.wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
            var szKey = unicodeToString(buf.slice(ptr + 6, ptr + 6 + (r.wLength - 6))); // String value
            var splitStr = szKey.split('\0');
            r.key = splitStr[0];
            for (var i = 1; i < splitStr.length; i++) { if (splitStr[i] != '') { r.value = splitStr[i]; } }
            //console.log('readStringStruct', r.wLength, r.wValueLength, r.wType, r.key, r.value);
            t.push(r);
            ptr += r.wLength;
            ptr = padPointer(ptr);
        }
        return t;
    }

    // Return the next 4 byte aligned number
    function padPointer(ptr) { return ptr + (ptr % 4); }

    // Hash the file using the selected hashing system
    obj.getHash = function(algo) {
        var hash = crypto.createHash(algo);
        runHash(hash, 0, obj.header.PeHeaderLocation + 88);
        runHash(hash, obj.header.PeHeaderLocation + 88 + 4, obj.header.PeHeaderLocation + 152 + (obj.header.pe32plus * 16));
        runHash(hash, obj.header.PeHeaderLocation + 152 + (obj.header.pe32plus * 16) + 8, obj.header.sigpos > 0 ? obj.header.sigpos : obj.filesize);
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
        var fileHash = obj.getHash('sha384');

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
            var codeSigningAttributes = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [] };
            if (args.desc != null) { // Encode description as big-endian unicode.
                var desc = "", ucs = Buffer.from(args.desc, 'ucs2').toString()
                for (var k = 0; k < ucs.length; k += 2) { desc += String.fromCharCode(ucs.charCodeAt(k + 1), ucs.charCodeAt(k)); }
                codeSigningAttributes.value.push({ 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': desc }] });
            }
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

        // Open the output file
        var output = fs.openSync(args.out, 'w');
        var tmp, written = 0;
        var executableSize = obj.header.sigpos ? obj.header.sigpos : this.filesize;

        // Compute pre-header length and copy that to the new file
        var preHeaderLen = (obj.header.PeHeaderLocation + 152 + (obj.header.pe32plus * 16));
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
        var preHeaderLen = (obj.header.PeHeaderLocation + 152 + (obj.header.pe32plus * 16));
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

    // Return null if we could not open the file
    return (openFile() ? obj : null);
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
        console.log("          --exe [file]             Required executable to view information.");
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
            var r = { }, versionInfo = exe.getVersionInfo();
            if (versionInfo != null) { r.versionInfo = versionInfo; }
            if (exe.fileHashAlgo != null) {
                r.signture = {};
                if (exe.fileHashAlgo != null) { r.signture.hashMethod = exe.fileHashAlgo; }
                if (exe.fileHashSigned != null) { r.signture.hashSigned = exe.fileHashSigned.toString('hex'); }
                if (exe.fileHashActual != null) { r.signture.hashActual = exe.fileHashActual.toString('hex'); }
                if (exe.signingAttribs && exe.signingAttribs.length > 0) { r.signture.attributes = exe.signingAttribs; }
            }
            console.log(JSON.stringify(r, null, 2));
        } else {
            var versionInfo = exe.getVersionInfo();
            if (versionInfo != null) { console.log("Version Information:"); for (var i in versionInfo) { if (versionInfo[i] == null) { console.log('  ' + i + ': (Empty)'); } else { console.log('  ' + i + ': \"' + versionInfo[i] + '\"'); } } }
            console.log("Signature Information:");
            if (exe.fileHashAlgo != null) {
                console.log("  Hash Method:", exe.fileHashAlgo);
                if (exe.fileHashSigned != null) { console.log("  Signed Hash:", exe.fileHashSigned.toString('hex')); }
                if (exe.fileHashActual != null) { console.log("  Actual Hash:", exe.fileHashActual.toString('hex')); }
            } else {
                console.log("  This file is not signed.");
            }
            if (exe.signingAttribs && exe.signingAttribs.length > 0) { console.log("Signature Attributes:"); for (var i in exe.signingAttribs) { console.log('  ' + exe.signingAttribs[i]); } }
        }
    }
    if (command == 'sign') { // Sign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        createOutFile(args, args.exe);
        const cert = loadCertificates(args.pem);
        if (cert == null) { console.log("Unable to load certificate and/or private key, generating test certificate."); }
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

// If this is the main module, run the command line version
if (require.main === module) { start(); }

// Exports
module.exports.createAuthenticodeHandler = createAuthenticodeHandler;
module.exports.loadCertificates = loadCertificates;
