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

// Hash an object
function hashObject(obj) {
    if (obj == null) { return null; }
    const hash = crypto.createHash('sha384');
    if (Buffer.isBuffer(obj)) { hash.update(obj); } else { hash.update(JSON.stringify(obj)); }
    return hash.digest().toString('hex');
}

// Load a .bmp file.
function loadBitmap(bitmapFile) {
    var bitmapData = null;
    try { bitmapData = fs.readFileSync(bitmapFile); } catch (ex) { }
    if ((bitmapData == null) || (bitmapData.length < 14) || (bitmapData[0] != 0x42) || (bitmapData[1] != 0x4D)) return null;
    return bitmapData.slice(14);
}

// Load a .ico file. This will load all icons in the file into a icon group object
function loadIcon(iconFile) {
    var iconData = null;
    try { iconData = fs.readFileSync(iconFile); } catch (ex) { }
    if ((iconData == null) || (iconData.length < 6) || (iconData[0] != 0) || (iconData[1] != 0)) return null;
    const r = { resType: iconData.readUInt16LE(2), resCount: iconData.readUInt16LE(4), icons: {} };
    if (r.resType != 1) return null;
    var ptr = 6;
    for (var i = 1; i <= r.resCount; i++) {
        var icon = {};
        icon.width = iconData[ptr + 0];
        icon.height = iconData[ptr + 1];
        icon.colorCount = iconData[ptr + 2];
        icon.planes = iconData.readUInt16LE(ptr + 4);
        icon.bitCount = iconData.readUInt16LE(ptr + 6);
        icon.bytesInRes = iconData.readUInt32LE(ptr + 8);
        icon.iconCursorId = i;
        const offset = iconData.readUInt32LE(ptr + 12);
        icon.icon = iconData.slice(offset, offset + icon.bytesInRes);
        r.icons[i] = icon;
        ptr += 16;
    }
    return r;
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
            PemKeys = pem.split('-----BEGIN PRIVATE KEY-----');
            for (var j in PemKeys) {
                var k = PemKeys[j].indexOf('-----END PRIVATE KEY-----');
                if (k >= 0) { keys.push(pki.privateKeyFromPem('-----BEGIN PRIVATE KEY-----' + PemKeys[j].substring(0, k) + '-----END PRIVATE KEY-----')); }
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
        try { obj.fd = fs.openSync(path, 'r'); } catch (ex) { return false; } // Unable to open file
        obj.stats = fs.fstatSync(obj.fd);
        obj.filesize = obj.stats.size;
        if (obj.filesize < 64) { obj.close(); return false; } // File too short.

        // Read the DOS header (64 bytes)
        var buf = readFileSlice(60, 4);
        obj.header.peHeaderLocation = buf.readUInt32LE(0); // The DOS header is 64 bytes long, the last 4 bytes are a pointer to the PE header.
        obj.header.peOptionalHeaderLocation = obj.header.peHeaderLocation + 24; // The PE optional header is located just after the PE header which is 24 bytes long.

        // Check file size and signature
        if (obj.filesize < (160 + obj.header.peHeaderLocation)) { obj.close(); return false; } // Invalid SizeOfHeaders.
        if (readFileSlice(obj.header.peHeaderLocation, 4).toString('hex') != '50450000') { obj.close(); return false; } // Invalid PE header, must start with "PE" (HEX: 50 45 00 00).

        // Read the COFF header
        // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#coff-file-header-object-and-image
        var coffHeader = readFileSlice(obj.header.peHeaderLocation + 4, 20)
        obj.header.coff = {};
        obj.header.coff.machine = coffHeader.readUInt16LE(0);
        obj.header.coff.numberOfSections = coffHeader.readUInt16LE(2);
        obj.header.coff.timeDateStamp = coffHeader.readUInt32LE(4);
        obj.header.coff.pointerToSymbolTable = coffHeader.readUInt32LE(8);
        obj.header.coff.numberOfSymbols = coffHeader.readUInt32LE(12);
        obj.header.coff.sizeOfOptionalHeader = coffHeader.readUInt16LE(16);
        obj.header.coff.characteristics = coffHeader.readUInt16LE(18);

        // Read the entire PE optional header
        var optinalHeader = readFileSlice(obj.header.peOptionalHeaderLocation, obj.header.coff.sizeOfOptionalHeader);

        // Decode the PE optional header standard fields
        // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#optional-header-standard-fields-image-only
        obj.header.peStandard = {};
        obj.header.peStandard.magic = optinalHeader.readUInt16LE(0);
        switch (obj.header.peStandard.magic) { // Check magic value
            case 0x020B: obj.header.pe32plus = 1; break;
            case 0x010B: obj.header.pe32plus = 0; break;
            default: { obj.close(); return false; } // Invalid Magic in PE
        }
        obj.header.peStandard.majorLinkerVersion = optinalHeader[2];
        obj.header.peStandard.minorLinkerVersion = optinalHeader[3];
        obj.header.peStandard.sizeOfCode = optinalHeader.readUInt32LE(4);
        obj.header.peStandard.sizeOfInitializedData = optinalHeader.readUInt32LE(8);
        obj.header.peStandard.sizeOfUninitializedData = optinalHeader.readUInt32LE(12);
        obj.header.peStandard.addressOfEntryPoint = optinalHeader.readUInt32LE(16);
        obj.header.peStandard.baseOfCode = optinalHeader.readUInt32LE(20);
        if (obj.header.pe32plus == 0) { obj.header.peStandard.baseOfData = optinalHeader.readUInt32LE(24); }

        // Decode the PE optional header windows fields
        // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#optional-header-windows-specific-fields-image-only
        obj.header.peWindows = {}
        if (obj.header.pe32plus == 0) {
            // 32bit header
            //obj.header.peWindows.imageBase = optinalHeader.readUInt32LE(28);
            obj.header.peWindows.sectionAlignment = optinalHeader.readUInt32LE(32);
            obj.header.peWindows.fileAlignment = optinalHeader.readUInt32LE(36);
            obj.header.peWindows.majorOperatingSystemVersion = optinalHeader.readUInt16LE(40);
            obj.header.peWindows.minorOperatingSystemVersion = optinalHeader.readUInt16LE(42);
            obj.header.peWindows.majorImageVersion = optinalHeader.readUInt16LE(44);
            obj.header.peWindows.minorImageVersion = optinalHeader.readUInt16LE(46);
            obj.header.peWindows.majorSubsystemVersion = optinalHeader.readUInt16LE(48);
            obj.header.peWindows.minorSubsystemVersion = optinalHeader.readUInt16LE(50);
            obj.header.peWindows.win32VersionValue = optinalHeader.readUInt32LE(52);
            obj.header.peWindows.sizeOfImage = optinalHeader.readUInt32LE(56);
            obj.header.peWindows.sizeOfHeaders = optinalHeader.readUInt32LE(60);
            obj.header.peWindows.checkSum = optinalHeader.readUInt32LE(64);
            obj.header.peWindows.subsystem = optinalHeader.readUInt16LE(68);
            obj.header.peWindows.dllCharacteristics = optinalHeader.readUInt16LE(70);
            //obj.header.peWindows.sizeOfStackReserve = optinalHeader.readUInt32LE(72);
            //obj.header.peWindows.sizeOfStackCommit = optinalHeader.readUInt32LE(76);
            //obj.header.peWindows.sizeOfHeapReserve = optinalHeader.readUInt32LE(80);
            //obj.header.peWindows.sizeOfHeapCommit = optinalHeader.readUInt32LE(84);
            obj.header.peWindows.loaderFlags = optinalHeader.readUInt32LE(88);
            obj.header.peWindows.numberOfRvaAndSizes = optinalHeader.readUInt32LE(92);
        } else {
            // 64bit header
            //obj.header.peWindows.imageBase = optinalHeader.readBigUInt64LE(24); // TODO: readBigUInt64LE is not supported in older NodeJS versions
            obj.header.peWindows.sectionAlignment = optinalHeader.readUInt32LE(32);
            obj.header.peWindows.fileAlignment = optinalHeader.readUInt32LE(36);
            obj.header.peWindows.majorOperatingSystemVersion = optinalHeader.readUInt16LE(40);
            obj.header.peWindows.minorOperatingSystemVersion = optinalHeader.readUInt16LE(42);
            obj.header.peWindows.majorImageVersion = optinalHeader.readUInt16LE(44);
            obj.header.peWindows.minorImageVersion = optinalHeader.readUInt16LE(46);
            obj.header.peWindows.majorSubsystemVersion = optinalHeader.readUInt16LE(48);
            obj.header.peWindows.minorSubsystemVersion = optinalHeader.readUInt16LE(50);
            obj.header.peWindows.win32VersionValue = optinalHeader.readUInt32LE(52);
            obj.header.peWindows.sizeOfImage = optinalHeader.readUInt32LE(56);
            obj.header.peWindows.sizeOfHeaders = optinalHeader.readUInt32LE(60);
            obj.header.peWindows.checkSum = optinalHeader.readUInt32LE(64);
            obj.header.peWindows.subsystem = optinalHeader.readUInt16LE(68);
            obj.header.peWindows.dllCharacteristics = optinalHeader.readUInt16LE(70);
            //obj.header.peWindows.sizeOfStackReserve = optinalHeader.readBigUInt64LE(72);
            //obj.header.peWindows.sizeOfStackCommit = optinalHeader.readBigUInt64LE(80);
            //obj.header.peWindows.sizeOfHeapReserve = optinalHeader.readBigUInt64LE(88);
            //obj.header.peWindows.sizeOfHeapCommit = optinalHeader.readBigUInt64LE(96);
            obj.header.peWindows.loaderFlags = optinalHeader.readUInt32LE(104);
            obj.header.peWindows.numberOfRvaAndSizes = optinalHeader.readUInt32LE(108);
        }

        // Decode the PE optional header data directories
        // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#optional-header-data-directories-image-only
        obj.header.dataDirectories = {}
        const pePlusOffset = (obj.header.pe32plus == 0) ? 0 : 16; // This header is the same for 32 and 64 bit, but 64bit is offset by 16 bytes.
        obj.header.dataDirectories.exportTable = { addr: optinalHeader.readUInt32LE(96 + pePlusOffset), size: optinalHeader.readUInt32LE(100 + pePlusOffset) };
        obj.header.dataDirectories.importTable = { addr: optinalHeader.readUInt32LE(104 + pePlusOffset), size: optinalHeader.readUInt32LE(108 + pePlusOffset) };
        obj.header.dataDirectories.resourceTable = { addr: optinalHeader.readUInt32LE(112 + pePlusOffset), size: optinalHeader.readUInt32LE(116 + pePlusOffset) }; // Same as .rsrc virtual address & size
        obj.header.dataDirectories.exceptionTableAddr = { addr: optinalHeader.readUInt32LE(120 + pePlusOffset), size: optinalHeader.readUInt32LE(124 + pePlusOffset) }; // Same as .pdata virtual address & size
        obj.header.dataDirectories.certificateTable = { addr: optinalHeader.readUInt32LE(128 + pePlusOffset), size: optinalHeader.readUInt32LE(132 + pePlusOffset) };
        obj.header.dataDirectories.baseRelocationTable = { addr: optinalHeader.readUInt32LE(136 + pePlusOffset), size: optinalHeader.readUInt32LE(140 + pePlusOffset) }; // Same as .reloc virtual address & size
        obj.header.dataDirectories.debug = { addr: optinalHeader.readUInt32LE(144 + pePlusOffset), size: optinalHeader.readUInt32LE(148 + pePlusOffset) };
        // obj.header.dataDirectories.architecture = optinalHeader.readBigUInt64LE(152 + pePlusOffset); // Must be zero
        obj.header.dataDirectories.globalPtr = { addr: optinalHeader.readUInt32LE(160 + pePlusOffset), size: optinalHeader.readUInt32LE(164 + pePlusOffset) };
        obj.header.dataDirectories.tLSTable = { addr: optinalHeader.readUInt32LE(168 + pePlusOffset), size: optinalHeader.readUInt32LE(172 + pePlusOffset) };
        obj.header.dataDirectories.loadConfigTable = { addr: optinalHeader.readUInt32LE(176 + pePlusOffset), size: optinalHeader.readUInt32LE(180 + pePlusOffset) };
        obj.header.dataDirectories.boundImport = { addr: optinalHeader.readUInt32LE(184 + pePlusOffset), size: optinalHeader.readUInt32LE(188 + pePlusOffset) };
        obj.header.dataDirectories.iAT = { addr: optinalHeader.readUInt32LE(192 + pePlusOffset), size: optinalHeader.readUInt32LE(196 + pePlusOffset) };
        obj.header.dataDirectories.delayImportDescriptor = { addr: optinalHeader.readUInt32LE(200 + pePlusOffset), size: optinalHeader.readUInt32LE(204 + pePlusOffset) };
        obj.header.dataDirectories.clrRuntimeHeader = { addr: optinalHeader.readUInt32LE(208 + pePlusOffset), size: optinalHeader.readUInt32LE(212 + pePlusOffset) };
        // obj.header.dataDirectories.reserved = optinalHeader.readBigUInt64LE(216 + pePlusOffset); // Must be zero

        // Get the certificate table location and size
        obj.header.sigpos = obj.header.dataDirectories.certificateTable.addr;
        obj.header.siglen = obj.header.dataDirectories.certificateTable.size
        obj.header.signed = ((obj.header.sigpos != 0) && (obj.header.siglen != 0));

        // The section headers are located after the optional PE header
        obj.header.SectionHeadersPtr = obj.header.peOptionalHeaderLocation + obj.header.coff.sizeOfOptionalHeader;

        // Read the sections
        obj.header.sections = {};
        for (var i = 0; i < obj.header.coff.numberOfSections; i++) {
            var section = {};
            buf = readFileSlice(obj.header.SectionHeadersPtr + (i * 40), 40);
            if (buf[0] != 46) { obj.close(); return false; }; // Name of the section must start with a dot. If not, something is wrong.
            var sectionName = buf.slice(0, 8).toString().trim('\0');
            var j = sectionName.indexOf('\0');
            if (j >= 0) { sectionName = sectionName.substring(0, j); } // Trim any trailing zeroes
            section.ptr = obj.header.SectionHeadersPtr + (i * 40);
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

        // Compute the checkSum value for this file
        obj.header.peWindows.checkSumActual = runChecksum();

        // If there is a .rsrc section, read the resource information and locations
        if (obj.header.sections['.rsrc'] != null) {
            obj.resources = readResourceTable(obj.header.sections['.rsrc'].rawAddr, 0); // Read all resources recursively
        }

        if (obj.header.signed) {
            // Read signature block

            // Check if the file size allows for the signature block
            if (obj.filesize < (obj.header.sigpos + obj.header.siglen)) { obj.close(); return false; } // Executable file too short to contain the signature block.

            // Remove the padding if needed
            var i, pkcs7raw = readFileSlice(obj.header.sigpos + 8, obj.header.siglen - 8);
            var derlen = forge.asn1.getBerValueLength(forge.util.createBuffer(pkcs7raw.slice(1, 5))) + 4;
            if (derlen != pkcs7raw.length) { pkcs7raw = pkcs7raw.slice(0, derlen); }

            // Decode the signature block and check that it's valid
            var pkcs7der = null, valid = false;
            try { pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(pkcs7raw)); } catch (ex) { }
            try { valid = ((pkcs7der != null) && (forge.asn1.derToOid(pkcs7der.value[1].value[0].value[2].value[0].value) == "1.3.6.1.4.1.311.2.1.4")); } catch (ex) { }
            if (pkcs7der == null) {
                // Can't decode the signature
                obj.header.sigpos = 0;
                obj.header.siglen = 0;
                obj.header.signed = false;
            } else {
                // To work around ForgeJS PKCS#7 limitation, this may break PKCS7 verify if ForgeJS adds support for it in the future
                // Switch content type from "1.3.6.1.4.1.311.2.1.4" to "1.2.840.113549.1.7.1"
                pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer(forge.pki.oids.data).data;

                // Decode the PKCS7 message
                var pkcs7 = null, pkcs7content = null;
                try {
                    pkcs7 = p7.messageFromAsn1(pkcs7der);
                    pkcs7content = pkcs7.rawCapture.content.value[0];
                } catch (ex) { }

                if ((pkcs7 == null) || (pkcs7content == null)) {
                    // Can't decode the signature
                    obj.header.sigpos = 0;
                    obj.header.siglen = 0;
                    obj.header.signed = false;
                } else {
                    // Verify a PKCS#7 signature
                    // Verify is not currently supported in node-forge, but if implemented in the future, this code could work.
                    //var caStore = forge.pki.createCaStore();
                    //for (var i in obj.certificates) { caStore.addCertificate(obj.certificates[i]); }
                    // Return is true if all signatures are valid and chain up to a provided CA
                    //if (!pkcs7.verify(caStore)) { throw ('Executable file has an invalid signature.'); }

                    // Get the signing attributes
                    obj.signingAttribs = [];
                    try {
                        for (var i in pkcs7.rawCapture.authenticatedAttributes) {
                            if (
                                (pkcs7.rawCapture.authenticatedAttributes[i].value != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[0] != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[0].value != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[1] != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0] != null) &&
                                (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value != null) &&
                                (forge.asn1.derToOid(pkcs7.rawCapture.authenticatedAttributes[i].value[0].value) == obj.Oids.SPC_SP_OPUS_INFO_OBJID)) {
                                for (var j in pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value) {
                                    if (
                                        (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j] != null) &&
                                        (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j].value != null) &&
                                        (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j].value[0] != null) &&
                                        (pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j].value[0].value != null)
                                    ) {
                                        var v = pkcs7.rawCapture.authenticatedAttributes[i].value[1].value[0].value[j].value[0].value;
                                        if (v.startsWith('http://') || v.startsWith('https://') || ((v.length % 2) == 1)) { obj.signingAttribs.push(v); } else {
                                            var r = ''; // This string value is in UCS2 format, convert it to a normal string.
                                            for (var k = 0; k < v.length; k += 2) { r += String.fromCharCode((v.charCodeAt(k + 8) << 8) + v.charCodeAt(k + 1)); }
                                            obj.signingAttribs.push(r);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (ex) { }

                    // Set the certificate chain
                    obj.certificates = pkcs7.certificates;

                    // Set the signature
                    obj.signature = Buffer.from(pkcs7.rawCapture.signature, 'binary');

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
            }
        }
        return true;
    }

    // Make a timestamp signature request
    obj.timeStampRequest = function (args, func) {
        // Create the timestamp request in DER format
        const asn1 = forge.asn1;
        const pkcs7dataOid = asn1.oidToDer('1.2.840.113549.1.7.1').data;
        const microsoftCodeSigningOid = asn1.oidToDer('1.3.6.1.4.1.311.3.2.1').data;
        const asn1obj =
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, microsoftCodeSigningOid),
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, pkcs7dataOid),
                    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, obj.signature.toString('binary')) // Signature here
                    ])
                ])
            ]);

        // Serialize an ASN.1 object to DER format in Base64
        const requestBody = Buffer.from(asn1.toDer(asn1obj).data, 'binary').toString('base64');

        // Make an HTTP request
        const options = { url: args.time, proxy: args.proxy };

        // Make a request to the time server
        httpRequest(options, requestBody, function (err, data) {
            if (err != null) { func(err); return; }

            // Decode the timestamp signature block
            var timepkcs7der = null;
            try { timepkcs7der = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(data, 'base64').toString('binary'))); } catch (ex) { func("Unable to parse time-stamp response: " + ex); return; }

            // Decode the executable signature block
            var pkcs7der = null;
            try {
                var pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(obj.getRawSignatureBlock(), 'base64').toString('binary')));

                // Get the ASN1 certificates used to sign the timestamp and add them to the certs in the PKCS7 of the executable
                // TODO: We could look to see if the certificate is already present in the executable
                const timeasn1Certs = timepkcs7der.value[1].value[0].value[3].value;
                for (var i in timeasn1Certs) { pkcs7der.value[1].value[0].value[3].value.push(timeasn1Certs[i]); }

                // Remove any existing time stamp signatures
                var newValues = [];
                for (var i in pkcs7der.value[1].value[0].value[4].value[0].value) {
                    const j = pkcs7der.value[1].value[0].value[4].value[0].value[i];
                    if ((j.tagClass != 128) || (j.type != 1)) { newValues.push(j); } // If this is not a time stamp, add it to out new list.
                }
                pkcs7der.value[1].value[0].value[4].value[0].value = newValues; // Set the new list

                // Get the time signature and add it to the executables PKCS7
                const timeasn1Signature = timepkcs7der.value[1].value[0].value[4];
                const countersignatureOid = asn1.oidToDer('1.2.840.113549.1.9.6').data;
                const asn1obj2 =
                    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
                        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, countersignatureOid),
                            timeasn1Signature
                        ])
                    ]);
                pkcs7der.value[1].value[0].value[4].value[0].value.push(asn1obj2);

                // Re-encode the executable signature block
                const p7signature = Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary');

                // Open the output file
                var output = null;
                try { output = fs.openSync(args.out, 'w+'); } catch (ex) { }
                if (output == null) return false;
                var tmp, written = 0;
                var executableSize = obj.header.sigpos ? obj.header.sigpos : this.filesize;

                // Compute pre-header length and copy that to the new file
                var preHeaderLen = (obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
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
                written += (p7signature.length + padding + 8);

                // Compute the checksum and write it in the PE header checksum location
                var tmp = Buffer.alloc(4);
                tmp.writeUInt32LE(runChecksumOnFile(output, written, ((obj.header.peOptionalHeaderLocation + 64) / 4)));
                fs.writeSync(output, tmp, 0, 4, obj.header.peOptionalHeaderLocation + 64);

                // Close the file
                fs.closeSync(output);

                // Indicate we are done
                func(null);
            } catch (ex) { func('' + ex); return; }
        });
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
        var numberOfIdEntries = buf.readUInt16LE(14);

        r.entries = [];
        var totalResources = numberOfNamedEntries + numberOfIdEntries;
        //console.log('readResourceTable', offset, 16 + (totalResources) * 8, offset + (16 + (totalResources) * 8));
        for (var i = 0; i < totalResources; i++) {
            buf = readFileSlice(ptr + offset + 16 + (i * 8), 8);
            var resource = {};
            resource.name = buf.readUInt32LE(0);
            var offsetToData = buf.readUInt32LE(4);
            if ((resource.name & 0x80000000) != 0) {
                var oname = resource.name;
                resource.name = readLenPrefixUnicodeString(ptr + (resource.name - 0x80000000));
                //console.log('readResourceName', offset + (oname - 0x80000000), 2 + (resource.name.length * 2), offset + (oname - 0x80000000) + (2 + resource.name.length * 2), resource.name);
            }
            if ((offsetToData & 0x80000000) != 0) { resource.table = readResourceTable(ptr, offsetToData - 0x80000000); } else { resource.item = readResourceItem(ptr, offsetToData); }
            r.entries.push(resource);
        }
        return r;
    }

    // Read a resource item
    // ptr: The pointer to the start of the resource section
    // offset: The offset start of the resource item to read
    function readResourceItem(ptr, offset) {
        //console.log('readResourceItem', offset, 16, offset + 16);
        var buf = readFileSlice(ptr + offset, 16), r = {};
        r.offsetToData = buf.readUInt32LE(0);
        r.size = buf.readUInt32LE(4);
        //console.log('readResourceData', r.offsetToData - obj.header.sections['.rsrc'].virtualAddr, r.size, r.offsetToData + r.size - obj.header.sections['.rsrc'].virtualAddr);
        r.codePage = buf.readUInt32LE(8);
        //r.reserved = buf.readUInt32LE(12);
        return r;
    }

    // Read a unicode stting that starts with the string length as the first byte.
    function readLenPrefixUnicodeString(ptr) {
        var nameLen = readFileSlice(ptr, 2).readUInt16LE(0);
        var buf = readFileSlice(ptr + 2, nameLen * 2), name = '';
        for (var i = 0; i < nameLen; i++) { name += String.fromCharCode(buf.readUInt16LE(i * 2)); }
        return name;
    }

    // Generate a complete resource section and pad the section
    function generateResourceSection(resources) {
        // Call a resursive method the compute the size needed for each element
        const resSizes = { tables: 0, items: 0, names: 0, data: 0 };
        getResourceSectionSize(resources, resSizes);

        // Pad the resource section & allocate the buffer
        const fileAlign = obj.header.peWindows.fileAlignment
        var resSizeTotal = resSizes.tables + resSizes.items + resSizes.names + resSizes.data;
        var resNoPadding = resSizeTotal + 4; // TODO: Not sure why this is off by 4
        if ((resSizeTotal % fileAlign) != 0) { resSizeTotal += (fileAlign - (resSizeTotal % fileAlign)); }
        const resSectionBuffer = Buffer.alloc(resSizeTotal);

        // Write the resource section, calling a recursive method
        const resPointers = { tables: 0, items: resSizes.tables, names: resSizes.tables + resSizes.items, data: resSizes.tables + resSizes.items + resSizes.names };
        createResourceSection(resources, resSectionBuffer, resPointers);
        //console.log('generateResourceSection', resPointers);

        // Done, return the result
        return { size: resNoPadding, data: resSectionBuffer };
    }

    // Return the total size of a resource header, this is a recursive method
    function getResourceSectionSize(resources, sizes) {
        sizes.tables += (16 + (resources.entries.length * 8));
        for (var i in resources.entries) {
            if (typeof resources.entries[i].name == 'string') {
                var dataSize = (2 + (resources.entries[i].name.length * 2));
                if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                sizes.names += dataSize;
            }
            if (resources.entries[i].table) { getResourceSectionSize(resources.entries[i].table, sizes); }
            else if (resources.entries[i].item) {
                sizes.items += 16;
                if (resources.entries[i].item.buffer) {
                    sizes.data += resources.entries[i].item.buffer.length;
                } else {
                    var dataSize = resources.entries[i].item.size;
                    if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                    sizes.data += dataSize;
                }
            }
        }
    }

    // Write the resource section in the buffer, this is a recursive method
    function createResourceSection(resources, buf, resPointers) {
        var numberOfNamedEntries = 0, numberOfIdEntries = 0, ptr = resPointers.tables;
        //console.log('createResourceSection', resPointers, ptr);

        // Figure out how many items we have to save
        for (var i in resources.entries) {
            if (typeof resources.entries[i].name == 'string') { numberOfNamedEntries++; } else { numberOfIdEntries++; }
        }

        // Move the table pointer forward
        resPointers.tables += (16 + (8 * numberOfNamedEntries) + (8 * numberOfIdEntries));

        // Write the table header
        buf.writeUInt32LE(resources.characteristics, ptr);
        buf.writeUInt32LE(resources.timeDateStamp, ptr + 4);
        buf.writeUInt16LE(resources.majorVersion, ptr + 8);
        buf.writeUInt16LE(resources.minorVersion, ptr + 10);
        buf.writeUInt16LE(numberOfNamedEntries, ptr + 12);
        buf.writeUInt16LE(numberOfIdEntries, ptr + 14);

        // For each table entry, write the entry for it
        for (var i in resources.entries) {
            // Write the name
            var name = resources.entries[i].name;
            if (typeof resources.entries[i].name == 'string') {
                // Set the pointer to the name
                name = resPointers.names + 0x80000000;

                // Write the name length, followed by the name string in unicode
                buf.writeUInt16LE(resources.entries[i].name.length, resPointers.names);
                for (var j = 0; j < resources.entries[i].name.length; j++) {
                    buf.writeUInt16LE(resources.entries[i].name.charCodeAt(j), 2 + resPointers.names + (j * 2));
                }

                // Move the names pointer forward, 8 byte align
                var dataSize = (2 + (resources.entries[i].name.length * 2));
                if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                resPointers.names += dataSize;
            }
            buf.writeUInt32LE(name, ptr + 16 + (i * 8));

            // Write the data
            var data;
            if (resources.entries[i].table) {
                // This is a pointer to a table entry
                data = resPointers.tables + 0x80000000;
                createResourceSection(resources.entries[i].table, buf, resPointers);
            } else if (resources.entries[i].item) {
                // This is a pointer to a data entry
                data = resPointers.items;

                // Write the data
                var entrySize = 0;
                if (resources.entries[i].item.buffer) {
                    // Write the data from given buffer
                    resources.entries[i].item.buffer.copy(buf, resPointers.data, 0, resources.entries[i].item.buffer.length);
                    entrySize = resources.entries[i].item.buffer.length;
                } else {
                    // Write the data from original file
                    const actualPtr = (resources.entries[i].item.offsetToData - obj.header.sections['.rsrc'].virtualAddr) + obj.header.sections['.rsrc'].rawAddr;
                    const tmp = readFileSlice(actualPtr, resources.entries[i].item.size);
                    tmp.copy(buf, resPointers.data, 0, tmp.length);
                    entrySize = resources.entries[i].item.size;;
                }

                // Write the item entry
                buf.writeUInt32LE(resPointers.data + obj.header.sections['.rsrc'].virtualAddr, resPointers.items); // Write the pointer relative to the virtual address
                buf.writeUInt32LE(entrySize, resPointers.items + 4);
                buf.writeUInt32LE(resources.entries[i].item.codePage, resPointers.items + 8);
                buf.writeUInt32LE(resources.entries[i].item.reserved, resPointers.items + 12);

                // Move items pointers forward
                resPointers.items += 16;
                var dataSize = entrySize;
                if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                resPointers.data += dataSize;
            }
            buf.writeUInt32LE(data, ptr + 20 + (i * 8));
        }
    }

    // Convert a unicode buffer to a string
    function unicodeToString(buf) {
        var r = '', c;
        for (var i = 0; i < (buf.length / 2) ; i++) {
            c = buf.readUInt16LE(i * 2);
            if (c != 0) { r += String.fromCharCode(c); } else { return r; }
        }
        return r;
    }

    // Convert a string to a unicode buffer
    // Input is a string, a buffer to write to and the offset in the buffer (0 is default).
    function stringToUnicode(str, buf, offset) {
        if (offset == null) { offset = 0; }
        for (var i = 0; i < str.length; i++) { buf.writeInt16LE(str.charCodeAt(i), offset + (i * 2)); }
    }

    var resourceDefaultNames = {
        'bitmaps': 2,
        'icon': 3,
        'dialogs': 5,
        'iconGroups': 14,
        'versionInfo': 16,
        'configurationFiles': 24
    }

    // Return the raw signature block buffer with padding removed
    obj.getRawSignatureBlock = function () {
        if ((obj.header.sigpos == 0) || (obj.header.siglen == 0)) return null;
        var pkcs7raw = readFileSlice(obj.header.sigpos + 8, obj.header.siglen - 8);
        var derlen = forge.asn1.getBerValueLength(forge.util.createBuffer(pkcs7raw.slice(1, 5))) + 4;
        if (derlen != pkcs7raw.length) { pkcs7raw = pkcs7raw.slice(0, derlen); }
        return pkcs7raw;
    }


    // Get bitmaps information from resource
    obj.getBitmapInfo = function () {
        const r = {}, ptr = obj.header.sections['.rsrc'].rawAddr;

        // Find and parse each icon
        const bitmaps = {}
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.bitmaps) {
                for (var j = 0; j < obj.resources.entries[i].table.entries.length; j++) {
                    const bitmapName = obj.resources.entries[i].table.entries[j].name;
                    const offsetToData = obj.resources.entries[i].table.entries[j].table.entries[0].item.offsetToData;
                    const size = obj.resources.entries[i].table.entries[j].table.entries[0].item.size;
                    const actualPtr = (offsetToData - obj.header.sections['.rsrc'].virtualAddr) + ptr;
                    bitmaps[bitmapName] = readFileSlice(actualPtr, size);
                }
            }
        }

        return bitmaps;
    }

    // Get icon information from resource
    obj.getIconInfo = function () {
        const r = {}, ptr = obj.header.sections['.rsrc'].rawAddr;

        // Find and parse each icon
        const icons = {}
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.icon) {
                for (var j = 0; j < obj.resources.entries[i].table.entries.length; j++) {
                    const iconName = obj.resources.entries[i].table.entries[j].name;
                    const offsetToData = obj.resources.entries[i].table.entries[j].table.entries[0].item.offsetToData;
                    const size = obj.resources.entries[i].table.entries[j].table.entries[0].item.size;
                    const actualPtr = (offsetToData - obj.header.sections['.rsrc'].virtualAddr) + ptr;
                    icons[iconName] = readFileSlice(actualPtr, size);
                }
            }
        }

        // Find and parse each icon group
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.iconGroups) {
                for (var j = 0; j < obj.resources.entries[i].table.entries.length; j++) {
                    const groupName = obj.resources.entries[i].table.entries[j].name;
                    const offsetToData = obj.resources.entries[i].table.entries[j].table.entries[0].item.offsetToData;
                    const size = obj.resources.entries[i].table.entries[j].table.entries[0].item.size;
                    const actualPtr = (offsetToData - obj.header.sections['.rsrc'].virtualAddr) + ptr;
                    const group = {};
                    const groupData = readFileSlice(actualPtr, size);

                    // Parse NEWHEADER structure: https://docs.microsoft.com/en-us/windows/win32/menurc/newheader
                    group.resType = groupData.readUInt16LE(2);
                    group.resCount = groupData.readUInt16LE(4);

                    // Parse many RESDIR structure: https://docs.microsoft.com/en-us/windows/win32/menurc/resdir
                    group.icons = {};
                    for (var p = 6; p < size; p += 14) {
                        var icon = {}
                        icon.width = groupData[p];
                        icon.height = groupData[p + 1];
                        icon.colorCount = groupData[p + 2];
                        icon.planes = groupData.readUInt16LE(p + 4);
                        icon.bitCount = groupData.readUInt16LE(p + 6);
                        icon.bytesInRes = groupData.readUInt32LE(p + 8);
                        icon.iconCursorId = groupData.readUInt16LE(p + 12);
                        icon.icon = icons[icon.iconCursorId];
                        group.icons[icon.iconCursorId] = icon;
                    }

                    // Add an icon group
                    r[groupName] = group;
                }
            }
        }

        return r;
    }

    // Set bitmap information
    obj.setBitmapInfo = function (bitmapInfo) {
        // Delete all bitmaps resources
        var resourcesEntries = [];
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name != resourceDefaultNames.bitmaps) {
                resourcesEntries.push(obj.resources.entries[i]);
            }
        }
        obj.resources.entries = resourcesEntries;

        // Add all bitmap entries
        const bitmapEntry = { name: resourceDefaultNames.bitmaps, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [] } };
        for (var i in bitmapInfo) {
            var name = i;
            if (parseInt(i) == name) { name = parseInt(i); }
            const bitmapItemEntry = { name: name, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [{ name: 1033, item: { buffer: bitmapInfo[i], codePage: 0 } }] } }
            bitmapEntry.table.entries.push(bitmapItemEntry);
        }
        obj.resources.entries.push(bitmapEntry);

        // Sort the resources by name. This is required.
        function resSort(a, b) {
            if ((typeof a == 'string') && (typeof b == 'string')) { if (a < b) return -1; if (a > b) return 1; return 0; }
            if ((typeof a == 'number') && (typeof b == 'number')) { return a - b; }
            if ((typeof a == 'string') && (typeof b == 'number')) { return -1; }
            return 1;
        }
        const names = [];
        for (var i = 0; i < obj.resources.entries.length; i++) { names.push(obj.resources.entries[i].name); }
        names.sort(resSort);
        var newEntryOrder = [];
        for (var i in names) {
            for (var j = 0; j < obj.resources.entries.length; j++) {
                if (obj.resources.entries[j].name == names[i]) { newEntryOrder.push(obj.resources.entries[j]); }
            }
        }
        obj.resources.entries = newEntryOrder;
    }

    // Set icon information
    obj.setIconInfo = function (iconInfo) {
        // Delete all icon and icon groups resources
        var resourcesEntries = [];
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if ((obj.resources.entries[i].name != resourceDefaultNames.icon) && (obj.resources.entries[i].name != resourceDefaultNames.iconGroups)) {
                resourcesEntries.push(obj.resources.entries[i]);
            }
        }
        obj.resources.entries = resourcesEntries;

        // Count the icon groups and re-number all icons
        var iconGroupCount = 0, nextIconNumber = 1;
        for (var i in iconInfo) {
            iconGroupCount++;
            var xicons = {};
            for (var j in iconInfo[i].icons) { xicons[nextIconNumber++] = iconInfo[i].icons[j]; }
            iconInfo[i].icons = xicons;
        }
        if (iconGroupCount == 0) return; // If there are no icon groups, we are done

        // Add the new icons entry
        const iconsEntry = { name: resourceDefaultNames.icon, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [] } };
        for (var i in iconInfo) {
            for (var j in iconInfo[i].icons) {
                var name = j;
                if (parseInt(j) == name) { name = parseInt(j); }
                const iconItemEntry = { name: name, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [{ name: 1033, item: { buffer: iconInfo[i].icons[j].icon, codePage: 0 } }] } }
                iconsEntry.table.entries.push(iconItemEntry);
            }
        }
        obj.resources.entries.push(iconsEntry);

        // Add the new icon group entry
        const groupEntry = { name: resourceDefaultNames.iconGroups, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [] } };
        for (var i in iconInfo) {
            // Build icon group struct
            var iconCount = 0, p = 6;
            for (var j in iconInfo[i].icons) { iconCount++; }
            const buf = Buffer.alloc(6 + (iconCount * 14));
            buf.writeUInt16LE(iconInfo[i].resType, 2);
            buf.writeUInt16LE(iconCount, 4);
            for (var j in iconInfo[i].icons) {
                buf[p] = iconInfo[i].icons[j].width;
                buf[p + 1] = iconInfo[i].icons[j].height;
                buf[p + 2] = iconInfo[i].icons[j].colorCount;
                buf.writeUInt16LE(iconInfo[i].icons[j].planes, p + 4);
                buf.writeUInt16LE(iconInfo[i].icons[j].bitCount, p + 6);
                buf.writeUInt32LE(iconInfo[i].icons[j].bytesInRes, p + 8);
                buf.writeUInt16LE(j, p + 12);
                p += 14;
            }
            var name = i;
            if (parseInt(i) == name) { name = parseInt(i); }
            const groupItemEntry = { name: name, table: { characteristics: 0, timeDateStamp: 0, majorVersion: 0, minorVersion: 0, entries: [{ name: 1033, item: { buffer: buf, codePage: 0 } }] } }
            groupEntry.table.entries.push(groupItemEntry);
        }
        obj.resources.entries.push(groupEntry);

        // Sort the resources by name. This is required.
        function resSort(a, b) {
            if ((typeof a == 'string') && (typeof b == 'string')) { if (a < b) return -1; if (a > b) return 1; return 0; }
            if ((typeof a == 'number') && (typeof b == 'number')) { return a - b; }
            if ((typeof a == 'string') && (typeof b == 'number')) { return -1; }
            return 1;
        }
        const names = [];
        for (var i = 0; i < obj.resources.entries.length; i++) { names.push(obj.resources.entries[i].name); }
        names.sort(resSort);
        var newEntryOrder = [];
        for (var i in names) {
            for (var j = 0; j < obj.resources.entries.length; j++) {
                if (obj.resources.entries[j].name == names[i]) { newEntryOrder.push(obj.resources.entries[j]); }
            }
        }
        obj.resources.entries = newEntryOrder;
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
        r['~FileVersion'] = (info.fixedFileInfo.dwFileVersionMS >> 16) + '.' + (info.fixedFileInfo.dwFileVersionMS & 0xFFFF) + '.' + (info.fixedFileInfo.dwFileVersionLS >> 16) + '.' + (info.fixedFileInfo.dwFileVersionLS & 0xFFFF);
        r['~ProductVersion'] = (info.fixedFileInfo.dwProductVersionMS >> 16) + '.' + (info.fixedFileInfo.dwProductVersionMS & 0xFFFF) + '.' + (info.fixedFileInfo.dwProductVersionLS >> 16) + '.' + (info.fixedFileInfo.dwProductVersionLS & 0xFFFF);
        return r;
    }

    // Encode the version information to the resource
    obj.setVersionInfo = function (versions) {
        // Convert the version information into a string array
        const stringArray = [];
        for (var i in versions) { if (!i.startsWith('~')) { stringArray.push({ key: i, value: versions[i] }); } }

        // Get the existing version data and switch the strings to the new strings
        var r = {}, info = readVersionInfo(getVersionInfoData(), 0);
        if ((info == null) || (info.stringFiles == null)) return;
        var StringFileInfo = null;
        for (var i in info.stringFiles) { if (info.stringFiles[i].szKey == 'StringFileInfo') { StringFileInfo = info.stringFiles[i]; } }
        if ((StringFileInfo == null) || (StringFileInfo.stringTable == null) || (StringFileInfo.stringTable.strings == null)) return;
        StringFileInfo.stringTable.strings = stringArray;

        // Set the file version
        if (versions['~FileVersion'] != null) {
            const FileVersionSplit = versions['~FileVersion'].split('.');
            info.fixedFileInfo.dwFileVersionMS = (parseInt(FileVersionSplit[0]) << 16) + parseInt(FileVersionSplit[1]);
            info.fixedFileInfo.dwFileVersionLS = (parseInt(FileVersionSplit[2]) << 16) + parseInt(FileVersionSplit[3]);
        }

        // Set the product version
        if (versions['~ProductVersion'] != null) {
            const ProductVersionSplit = versions['~ProductVersion'].split('.');
            info.fixedFileInfo.dwProductVersionMS = (parseInt(ProductVersionSplit[0]) << 16) + parseInt(ProductVersionSplit[1]);
            info.fixedFileInfo.dwProductVersionLS = (parseInt(ProductVersionSplit[2]) << 16) + parseInt(ProductVersionSplit[3]);
        }

        // Re-encode the version information into a buffer
        var verInfoResBufArray = [];
        writeVersionInfo(verInfoResBufArray, info);
        var verInfoRes = Buffer.concat(verInfoResBufArray);

        // Display all buffers
        //console.log('--WRITE BUF ARRAY START--');
        //for (var i in verInfoResBufArray) { console.log(verInfoResBufArray[i].toString('hex')); }
        //console.log('--WRITE BUF ARRAY END--');
        //console.log('OUT', Buffer.concat(verInfoResBufArray).toString('hex'));

        // Set the new buffer as part of the resources
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.versionInfo) {
                const verInfo = obj.resources.entries[i].table.entries[0].table.entries[0].item;
                delete verInfo.size;
                delete verInfo.offsetToData;
                verInfo.buffer = verInfoRes;
                obj.resources.entries[i].table.entries[0].table.entries[0].item = verInfo;
            }
        }
    }

    // Return the version info data block
    function getVersionInfoData() {
        if (obj.resources == null) return null;
        const ptr = obj.header.sections['.rsrc'].rawAddr;
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.versionInfo) {
                const verInfo = obj.resources.entries[i].table.entries[0].table.entries[0].item;
                if (verInfo.buffer != null) {
                    return verInfo.buffer;
                } else {
                    const actualPtr = (verInfo.offsetToData - obj.header.sections['.rsrc'].virtualAddr) + ptr;
                    return readFileSlice(actualPtr, verInfo.size);
                }
            }
        }
        return null;
    }

    // Create a VS_VERSIONINFO structure as a array of buffer that is ready to be placed in the resource section
    // VS_VERSIONINFO structure: https://docs.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo
    function writeVersionInfo(bufArray, info) {
        const buf = Buffer.alloc(40);
        buf.writeUInt16LE(0, 4); // wType
        stringToUnicode('VS_VERSION_INFO', buf, 6);
        bufArray.push(buf);

        var wLength = 40;
        var wValueLength = 0;
        if (info.fixedFileInfo != null) {
            const buf2 = Buffer.alloc(52);
            wLength += 52;
            wValueLength += 52;
            buf2.writeUInt32LE(info.fixedFileInfo.dwSignature, 0); // dwSignature
            buf2.writeUInt32LE(info.fixedFileInfo.dwStrucVersion, 4); // dwStrucVersion
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileVersionMS, 8); // dwFileVersionMS
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileVersionLS, 12); // dwFileVersionLS
            buf2.writeUInt32LE(info.fixedFileInfo.dwProductVersionMS, 16); // dwProductVersionMS
            buf2.writeUInt32LE(info.fixedFileInfo.dwProductVersionLS, 20); // dwProductVersionLS
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileFlagsMask, 24); // dwFileFlagsMask
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileFlags, 28); // dwFileFlags
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileOS, 32); // dwFileOS
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileType, 36); // dwFileType
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileSubtype, 40); // dwFileSubtype
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileDateMS, 44); // dwFileDateMS
            buf2.writeUInt32LE(info.fixedFileInfo.dwFileDateLS, 48); // dwFileDateLS
            bufArray.push(buf2);
        }

        if (info.stringFiles != null) { wLength += writeStringFileInfo(bufArray, info.stringFiles); }

        buf.writeUInt16LE(Buffer.concat(bufArray).length, 0); // wLength
        buf.writeUInt16LE(wValueLength, 2); // wValueLength
        return wLength;
    }

    // StringFileInfo structure: https://docs.microsoft.com/en-us/windows/win32/menurc/stringfileinfo
    function writeStringFileInfo(bufArray, stringFiles) {
        var totalLen = 0;
        for (var i in stringFiles) {
            var l = 6 + (stringFiles[i].szKey.length * 2);
            if (stringFiles[i].szKey == 'VarFileInfo') { l += 4; } // TODO: This is a hack, not sure what the correct code should be
            const buf2 = Buffer.alloc(padPointer(l));
            buf2.writeUInt16LE(1, 4); // wType
            stringToUnicode(stringFiles[i].szKey, buf2, 6);
            bufArray.push(buf2);

            var wLength = 0, wValueLength = 0;

            if (stringFiles[i].szKey == 'StringFileInfo') { wLength += writeStringTableStruct(bufArray, stringFiles[i].stringTable); }
            if (stringFiles[i].szKey == 'VarFileInfo') { wLength += writeVarFileInfoStruct(bufArray, stringFiles[i].varFileInfo); }

            buf2.writeUInt16LE(l + wLength, 0); // wLength
            buf2.writeUInt16LE(wValueLength, 2); // wValueLength
            totalLen += buf2.length + wLength;
        }
        return totalLen;
    }

    // VarFileInfo structure: https://docs.microsoft.com/en-us/windows/win32/menurc/var-str
    function writeVarFileInfoStruct(bufArray, varFileInfo) {
        var l = 8 + (varFileInfo.szKey.length * 2);
        const buf = Buffer.alloc(padPointer(l));
        buf.writeUInt16LE(0, 4); // wType
        stringToUnicode(varFileInfo.szKey, buf, 6);
        bufArray.push(buf);

        var wLength = 0;
        var wValueLength = 0;

        if (varFileInfo.value) {
            bufArray.push(varFileInfo.value);
            wLength += varFileInfo.value.length;
            wValueLength += varFileInfo.value.length;
        }
        buf.writeUInt16LE(buf.length + wLength, 0); // wLength
        buf.writeUInt16LE(wValueLength, 2); // wValueLength
        return buf.length + wLength;
    }

    // StringTable structure: https://docs.microsoft.com/en-us/windows/win32/menurc/stringtable
    function writeStringTableStruct(bufArray, stringTable) {
        //console.log('writeStringTableStruct', stringTable);
        var l = 6 + (stringTable.szKey.length * 2);
        const buf = Buffer.alloc(padPointer(l));
        buf.writeUInt16LE(1, 4); // wType
        stringToUnicode(stringTable.szKey, buf, 6);
        bufArray.push(buf);

        var wLength = 0;
        var wValueLength = 0;

        if (stringTable.strings) { wLength += writeStringStructs(bufArray, stringTable.strings); }
        buf.writeUInt16LE(l + wLength, 0); // wLength
        buf.writeUInt16LE(wValueLength, 2); // wValueLength
        return buf.length + wLength;
    }

    // String structure: https://docs.microsoft.com/en-us/windows/win32/menurc/string-str
    function writeStringStructs(bufArray, stringTable) {
        //console.log('writeStringStructs', stringTable);
        var totalLen = 0, bufadd = 0;
        for (var i in stringTable) {
            //console.log('writeStringStructs', stringTable[i]);
            const buf = Buffer.alloc(padPointer(6 + ((stringTable[i].key.length + 1) * 2)));
            var buf2, wLength = buf.length;
            var wValueLength = 0;
            stringToUnicode(stringTable[i].key, buf, 6);
            bufArray.push(buf);
            bufadd += buf.length;
            if (typeof stringTable[i].value == 'string') {
                // wType (string)
                buf.writeUInt16LE(1, 4);
                var l = (stringTable[i].value.length + 1) * 2;
                buf2 = Buffer.alloc(padPointer(l));
                stringToUnicode(stringTable[i].value, buf2, 0);
                bufArray.push(buf2);
                bufadd += buf2.length;
                wValueLength = stringTable[i].value.length + 1;
                wLength += l;
            }
            if (typeof stringTable[i].value == 'object') {
                // wType (binary)
                buf.writeUInt16LE(2, 4); // TODO: PADDING
                bufArray.push(stringTable[i].value);
                bufadd += stringTable[i].value.length;
                wValueLength = stringTable[i].value.length;
                wLength += wValueLength;
            }
            buf.writeUInt16LE(wLength, 0); // wLength
            buf.writeUInt16LE(wValueLength, 2); // wValueLength
            //console.log('WStringStruct', buf.toString('hex'), buf2.toString('hex'));
            totalLen += wLength;
        }
        //return totalLen;
        return bufadd;
    }

    // VS_VERSIONINFO structure: https://docs.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo
    function readVersionInfo(buf, ptr) {
        const r = {};
        if (buf.length < 2) return null;
        const wLength = buf.readUInt16LE(ptr);
        if (buf.length < wLength) return null;
        const wValueLength = buf.readUInt16LE(ptr + 2);
        const wType = buf.readUInt16LE(ptr + 4);
        r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + 36));
        if (r.szKey != 'VS_VERSION_INFO') return null;
        //console.log('getVersionInfo', wLength, wValueLength, wType, r.szKey.toString());
        if (wValueLength == 52) { r.fixedFileInfo = readFixedFileInfoStruct(buf, ptr + 40); }
        r.stringFiles = readStringFilesStruct(buf, ptr + 40 + wValueLength, wLength - 40 - wValueLength);
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
            const wLength = buf.readUInt16LE(ptr);
            if (wLength == 0) return t;
            const wValueLength = buf.readUInt16LE(ptr + 2);
            const wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
            r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + 6 + (wLength - 6))); // String value
            //console.log('readStringFileStruct', wLength, wValueLength, wType, r.szKey);
            if (r.szKey == 'StringFileInfo') { r.stringTable = readStringTableStruct(buf, ptr + 36); }
            if (r.szKey == 'VarFileInfo') { r.varFileInfo = readVarFileInfoStruct(buf, ptr + 32); }
            t.push(r);
            ptr += wLength;
            ptr = padPointer(ptr);
        }
        return t;
    }

    // VarFileInfo structure: https://docs.microsoft.com/en-us/windows/win32/menurc/var-str
    function readVarFileInfoStruct(buf, ptr) {
        const r = {};
        const wLength = buf.readUInt16LE(ptr);
        const wValueLength = buf.readUInt16LE(ptr + 2);
        const wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
        r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + wLength)); // "VarFileInfo"
        r.value = buf.slice(ptr + wLength - wValueLength, ptr + wLength)
        //console.log('readVarFileInfoStruct', wLength, wValueLength, wType, r.szKey, r.value.toString('hex'));
        return r;
    }

    // StringTable structure: https://docs.microsoft.com/en-us/windows/win32/menurc/stringtable
    function readStringTableStruct(buf, ptr) {
        const r = {};
        const wLength = buf.readUInt16LE(ptr);
        const wValueLength = buf.readUInt16LE(ptr + 2);
        const wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary
        //console.log('RStringTableStruct', buf.slice(ptr, ptr + wLength).toString('hex'));
        r.szKey = unicodeToString(buf.slice(ptr + 6, ptr + 6 + 16)); // An 8-digit hexadecimal number stored as a Unicode string.
        //console.log('readStringTableStruct', wLength, wValueLength, wType, r.szKey);
        r.strings = readStringStructs(buf, ptr + 24 + wValueLength, wLength - 22);
        return r;
    }

    // String structure: https://docs.microsoft.com/en-us/windows/win32/menurc/string-str
    function readStringStructs(buf, ptr, len) {
        var t = [], startPtr = ptr;
        while ((ptr + 6) < (startPtr + len)) {
            const r = {};
            const wLength = buf.readUInt16LE(ptr);
            if (wLength == 0) return t;

            //console.log('RStringStruct', buf.slice(ptr, ptr + wLength).toString('hex'));

            const wValueLength = buf.readUInt16LE(ptr + 2);
            const wType = buf.readUInt16LE(ptr + 4); // 1 = Text, 2 = Binary

            //console.log('R', buf.slice(ptr, ptr + wLength).toString('hex'));

            r.key = unicodeToString(buf.slice(ptr + 6, ptr + (wLength - (wValueLength * 2)) - 2)); // Key
            if (wType == 1) { r.value = unicodeToString(buf.slice(ptr + wLength - (wValueLength * 2), ptr + wLength - 2)); } // String value
            if (wType == 2) { r.value = buf.slice(ptr + wLength - (wValueLength * 2), ptr + wLength); } // Binary value
            //console.log('readStringStruct', wLength, wValueLength, wType, r.key, r.value);
            t.push(r);
            ptr += wLength;
            ptr = padPointer(ptr);
        }
        return t;
    }

    // Return the next 4 byte aligned number
    function padPointer(ptr) { return ptr + (((ptr % 4) == 0) ? 0 : (4 - (ptr % 4))); }
    //function padPointer(ptr) { return ptr + (ptr % 4); }

    // Hash the file using the selected hashing system
    // This hash skips the executables CRC and code signing data and signing block
    obj.getHash = function(algo) {
        const hash = crypto.createHash(algo);
        runHash(hash, 0, obj.header.peHeaderLocation + 88);
        runHash(hash, obj.header.peHeaderLocation + 88 + 4, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
        runHash(hash, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16) + 8, obj.header.sigpos > 0 ? obj.header.sigpos : obj.filesize);
        return hash.digest();
    }

    // Hash of an open file using the selected hashing system
    // This hash skips the executables CRC and code signing data and signing block
    obj.getHashOfFile = function(fd, algo, filesize) {
        const hash = crypto.createHash(algo);
        runHashOnFile(fd, hash, 0, obj.header.peHeaderLocation + 88);
        runHashOnFile(fd, hash, obj.header.peHeaderLocation + 88 + 4, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
        runHashOnFile(fd, hash, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16) + 8, obj.header.sigpos > 0 ? obj.header.sigpos : filesize);
        return hash.digest();
    }

    // Hash the file using the selected hashing system skipping resource section
    // This hash skips the executables CRC, sections table, resource section, code signing data and signing block
    obj.getHashNoResources = function (algo) {
        if (obj.header.sections['.rsrc'] == null) { return obj.getHash(algo); } // No resources in this executable, return a normal hash

        // Get the sections table start and size
        const sectionHeaderPtr = obj.header.SectionHeadersPtr;
        const sectionHeaderSize = obj.header.coff.numberOfSections * 40;

        // Get the resource section start and size
        const resPtr = obj.header.sections['.rsrc'].rawAddr;
        const resSize = obj.header.sections['.rsrc'].rawSize;

        // Get the end-of-file location
        const eof = obj.header.sigpos > 0 ? obj.header.sigpos : obj.filesize;

        // Hash the remaining data
        const hash = crypto.createHash(algo);
        runHash(hash, 0, obj.header.peHeaderLocation + 88);
        runHash(hash, obj.header.peHeaderLocation + 88 + 4, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
        runHash(hash, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16) + 8, sectionHeaderPtr);
        runHash(hash, sectionHeaderPtr + sectionHeaderSize, resPtr);
        runHash(hash, resPtr + resSize, eof);
        return hash.digest();
    }

    // Hash the file using the selected hashing system skipping resource section
    // This hash skips the executables CRC, sections table, resource section, code signing data and signing block
    obj.getHashOfSection = function (algo, sectionName) {
        if (obj.header.sections[sectionName] == null) return null;

        // Get the section start and size
        const sectionPtr = obj.header.sections[sectionName].rawAddr;
        const sectionSize = obj.header.sections[sectionName].rawSize;

        // Hash the remaining data
        const hash = crypto.createHash(algo);
        runHash(hash, sectionPtr, sectionPtr + sectionSize);
        return hash.digest();
    }

    // Hash the file from start to end loading 64k chunks
    function runHash(hash, start, end) {
        var ptr = start;
        while (ptr < end) { const buf = readFileSlice(ptr, Math.min(65536, end - ptr)); hash.update(buf); ptr += buf.length; }
    }

    // Hash the open file loading 64k chunks
    // TODO: Do chunks on this!!!
    function runHashOnFile(fd, hash, start, end) {
        const buf = Buffer.alloc(end - start);
        const len = fs.readSync(fd, buf, 0, buf.length, start);
        if (len != buf.length) { console.log('BAD runHashOnFile'); }
        hash.update(buf);
    }

    // Checksum the file loading 64k chunks
    function runChecksum() {
        var ptr = 0, c = createChecksum(((obj.header.peOptionalHeaderLocation + 64) / 4));
        while (ptr < obj.filesize) { const buf = readFileSlice(ptr, Math.min(65536, obj.filesize - ptr)); c.update(buf); ptr += buf.length; }
        return c.digest();
    }

    // Checksum the open file loading 64k chunks
    function runChecksumOnFile(fd, filesize, checksumLocation) {
        var ptr = 0, c = createChecksum(checksumLocation), buf = Buffer.alloc(65536);
        while (ptr < filesize) { var len = fs.readSync(fd, buf, 0, Math.min(65536, filesize - ptr), ptr); c.update(buf, len); ptr += len; }
        return c.digest();
    }

    // Steaming checksum methods
    // TODO: Works only with files padded to 4 byte.
    function createChecksum(checksumLocation) {
        const obj = { checksum: 0, length: 0 };
        obj.update = function (data, len) {
            if (!len) { len = data.length; }
            for (var i = 0; i < (len / 4) ; i++) {
                if (((obj.length / 4) + i) == checksumLocation) continue; // Skip PE checksum location
                const dword = data.readUInt32LE(i * 4);
                var checksumlo = (obj.checksum > 4294967296) ? (obj.checksum - 4294967296) : obj.checksum;
                var checksumhi = (obj.checksum > 4294967296) ? 1 : 0;
                obj.checksum = checksumlo + dword + checksumhi;
                if (obj.checksum > 4294967296) {
                    checksumlo = (obj.checksum > 4294967296) ? (obj.checksum - 4294967296) : obj.checksum;
                    checksumhi = (obj.checksum > 4294967296) ? 1 : 0;
                    obj.checksum = checksumlo + checksumhi;
                }
            }
            obj.length += len;
        }
        obj.digest = function () {
            obj.checksum = (obj.checksum & 0xffff) + (obj.checksum >>> 16);
            obj.checksum = (obj.checksum) + (obj.checksum >>> 16);
            obj.checksum = obj.checksum & 0xffff;
            obj.checksum += obj.length;
            return obj.checksum;
        }
        return obj;
    }

    // Compute the PE checksum of an entire file
    function getChecksum(data, checksumLocation) {
        var checksum = 0;
        for (var i = 0; i < (data.length / 4) ; i++) {
            if (i == (checksumLocation / 4)) continue; // Skip PE checksum location
            var dword = data.readUInt32LE(i * 4);
            var checksumlo = (checksum > 4294967296) ? (checksum - 4294967296) : checksum;
            var checksumhi = (checksum > 4294967296) ? 1 : 0;
            checksum = checksumlo + dword + checksumhi;
            if (checksum > 4294967296) {
                checksumlo = (checksum > 4294967296) ? (checksum - 4294967296) : checksum;
                checksumhi = (checksum > 4294967296) ? 1 : 0;
                checksum = checksumlo + checksumhi;
            }
        }
        checksum = (checksum & 0xffff) + (checksum >>> 16);
        checksum = (checksum) + (checksum >>> 16);
        checksum = checksum & 0xffff;
        checksum += data.length;
        return checksum;
    }

    // Sign the file using the certificate and key. If none is specified, generate a dummy one
    obj.sign = function (cert, args, func) {
        if (cert == null) { cert = createSelfSignedCert({ cn: 'Test' }); }

        // Set the hash algorithm hash OID
        var hashOid = null, fileHash = null;
        if (args.hash == null) { args.hash = 'sha384'; }
        if (args.hash == 'sha256') { hashOid = forge.pki.oids.sha256; fileHash = obj.getHash('sha256'); }
        if (args.hash == 'sha384') { hashOid = forge.pki.oids.sha384; fileHash = obj.getHash('sha384'); }
        if (args.hash == 'sha512') { hashOid = forge.pki.oids.sha512; fileHash = obj.getHash('sha512'); }
        if (args.hash == 'sha224') { hashOid = forge.pki.oids.sha224; fileHash = obj.getHash('sha224'); }
        if (args.hash == 'md5') { hashOid = forge.pki.oids.md5; fileHash = obj.getHash('md5'); }
        if (hashOid == null) { func('Invalid signing hash: ' + args.hash); return; };

        // Create the signature block
        var xp7 = forge.pkcs7.createSignedData();
        var content = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.15').data }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000', 'bitStringContents': '\u0000', 'original': { 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000' } }, { 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 2, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': '' }] }] }] }] }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer(hashOid).data }, { 'tagClass': 0, 'type': 5, 'constructed': false, 'composed': false, 'value': '' }] }, { 'tagClass': 0, 'type': 4, 'constructed': false, 'composed': false, 'value': fileHash.toString('binary') }] }] };
        xp7.contentInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.4').getBytes())]);
        xp7.contentInfo.value.push(forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [content]));
        xp7.content = {}; // We set .contentInfo and have .content empty to bypass node-forge limitation on the type of content it can sign.
        xp7.addCertificate(cert.cert);
        if (cert.extraCerts) { for (var i = 0; i < cert.extraCerts.length; i++) { xp7.addCertificate(cert.extraCerts[0]); } } // Add any extra certificates that form the cert chain

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
        xp7.addSigner({
            key: cert.key,
            certificate: cert.cert,
            digestAlgorithm: forge.pki.oids.sha384,
            authenticatedAttributes: authenticatedAttributes
        });
        xp7.sign();
        var p7signature = Buffer.from(forge.pkcs7.messageToPem(xp7).split('-----BEGIN PKCS7-----')[1].split('-----END PKCS7-----')[0], 'base64');

        if (args.time == null) {
            // Sign the executable without timestamp
            signEx(args, p7signature, obj.filesize, func);
        } else {
            // Decode the signature block
            var pkcs7der = null;
            try { pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(p7signature)); } catch (ex) { func('' + ex); return; }

            // To work around ForgeJS PKCS#7 limitation, this may break PKCS7 verify if ForgeJS adds support for it in the future
            // Switch content type from "1.3.6.1.4.1.311.2.1.4" to "1.2.840.113549.1.7.1"
            pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer(forge.pki.oids.data).data;

            // Decode the PKCS7 message
            var pkcs7 = p7.messageFromAsn1(pkcs7der);

            // Create the timestamp request in DER format
            const asn1 = forge.asn1;
            const pkcs7dataOid = asn1.oidToDer('1.2.840.113549.1.7.1').data;
            const microsoftCodeSigningOid = asn1.oidToDer('1.3.6.1.4.1.311.3.2.1').data;
            const asn1obj =
                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, microsoftCodeSigningOid),
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, pkcs7dataOid),
                        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, pkcs7.rawCapture.signature.toString('binary')) // Signature here
                        ])
                    ])
                ]);

            // Re-decode the PKCS7 from the executable, this time, no workaround needed
            try { pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(p7signature)); } catch (ex) { func('' + ex); return; }

            // Serialize an ASN.1 object to DER format in Base64
            const requestBody = Buffer.from(asn1.toDer(asn1obj).data, 'binary').toString('base64');

            // Make an HTTP request
            const options = { url: args.time, proxy: args.proxy };

            // Make a request to the time server
            httpRequest(options, requestBody, function (err, data) {
                if (err != null) { func(err); return; }

                // Decode the timestamp signature block
                var timepkcs7der = null;
                try { timepkcs7der = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(data, 'base64').toString('binary'))); } catch (ex) { func("Unable to parse time-stamp response: " + ex); return; }

                try {
                    // Get the ASN1 certificates used to sign the timestamp and add them to the certs in the PKCS7 of the executable
                    // TODO: We could look to see if the certificate is already present in the executable
                    const timeasn1Certs = timepkcs7der.value[1].value[0].value[3].value;
                    for (var i in timeasn1Certs) { pkcs7der.value[1].value[0].value[3].value.push(timeasn1Certs[i]); }

                    // Get the time signature and add it to the executables PKCS7
                    const timeasn1Signature = timepkcs7der.value[1].value[0].value[4];
                    const countersignatureOid = asn1.oidToDer('1.2.840.113549.1.9.6').data;
                    const asn1obj2 =
                        asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, countersignatureOid),
                                timeasn1Signature
                            ])
                        ]);
                    pkcs7der.value[1].value[0].value[4].value[0].value.push(asn1obj2);

                    // Re-encode the executable signature block
                    const p7signature = Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary');

                    // Write the file with the signature block
                    signEx(args, p7signature, obj.filesize, func);
                } catch (ex) { func('' + ex); }
            });
        }
    }

    // Make a HTTP request, use a proxy if needed
    function httpRequest(options, requestBody, func) {
        // Decode the URL
        const timeServerUrl = new URL(options.url);
        options.protocol = timeServerUrl.protocol;
        options.hostname = timeServerUrl.hostname;
        options.path = timeServerUrl.pathname;
        options.port = ((timeServerUrl.port == '') ? 80 : parseInt(timeServerUrl.port));

        if (options.proxy == null) {
            // No proxy needed

            // Setup the options
            delete options.url;
            options.method = 'POST';
            options.headers = {
                'accept': 'application/octet-stream',
                'cache-control': 'no-cache',
                'user-agent': 'Transport',
                'content-type': 'application/octet-stream',
                'content-length': Buffer.byteLength(requestBody)
            };

            // Set up the request
            var responseAccumulator = '';
            var req = require('http').request(options, function (res) {
                res.setEncoding('utf8');
                res.on('data', function (chunk) { responseAccumulator += chunk; });
                res.on('end', function () { func(null, responseAccumulator); });
            });

            // Post the data
            req.on('error', function (err) { func('' + err); });
            req.write(requestBody);
            req.end();
        } else {
            // We are using a proxy
            // This is a fairly basic proxy implementation, should work most of the time.

            // Setup the options and decode the proxy URL
            var proxyOptions = { method: 'CONNECT' };
            if (options.proxy) {
                const proxyUrl = new URL(options.proxy);
                proxyOptions.protocol = proxyUrl.protocol;
                proxyOptions.hostname = proxyUrl.hostname;
                proxyOptions.path = options.hostname + ':' + options.port;
                proxyOptions.port = ((proxyUrl.port == '') ? 80 : parseInt(proxyUrl.port));
            }

            // Set up the proxy request
            var responseAccumulator = '';
            var req = require('http').request(proxyOptions);
            req.on('error', function (err) { func('' + err); });
            req.on('connect', function (res, socket, head) {
                // Make a request over the HTTP tunnel
                socket.write('POST ' + options.path + ' HTTP/1.1\r\n' +
                    'host: ' + options.hostname + ':' + options.port + '\r\n' +
                    'accept: application/octet-stream\r\n' +
                    'cache-control: no-cache\r\n' +
                    'user-agent: Transport\r\n' +
                    'content-type: application/octet-stream\r\n' +
                    'content-length: ' + Buffer.byteLength(requestBody) + '\r\n' +
                    '\r\n' + requestBody);
                socket.on('data', function (chunk) {
                    responseAccumulator += chunk.toString();
                    var responseData = parseHttpResponse(responseAccumulator);
                    if (responseData != null) { try { socket.end(); } catch (ex) { console.log('ex', ex); } socket.xdone = true; func(null, responseData); }
                });
                socket.on('end', function () {
                    if (socket.xdone == true) return;
                    var responseData = parseHttpResponse(responseAccumulator);
                    if (responseData != null) { func(null, responseData); } else { func("Unable to parse response."); }
                });
            });
            req.end();
        }
    }

    // Parse the HTTP response and return data if available
    function parseHttpResponse(data) {
        var dataSplit = data.split('\r\n\r\n');
        if (dataSplit.length < 2) return null;

        // Parse the HTTP header
        var headerSplit = dataSplit[0].split('\r\n'), headers = {};
        for (var i in headerSplit) {
            if (i != 0) {
                var x = headerSplit[i].indexOf(':');
                headers[headerSplit[i].substring(0, x).toLowerCase()] = headerSplit[i].substring(x + 2);
            }
        }

        // If there is a content-length in the header, keep accumulating data until we have the right length
        if (headers['content-length'] != null) {
            const contentLength = parseInt(headers['content-length']);
            if (dataSplit[1].length < contentLength) return null; // Wait for more data
            return dataSplit[1];
        }
        return dataSplit[1];
    }

    // Complete the signature of an executable
    function signEx(args, p7signature, filesize, func) {
        // Open the output file
        var output = null;
        try { output = fs.openSync(args.out, 'w+'); } catch (ex) { }
        if (output == null) { func('Unable to open output file: ' + args.out); return; }
        var tmp, written = 0, executableSize = obj.header.sigpos ? obj.header.sigpos : filesize;

        // Compute pre-header length and copy that to the new file
        var preHeaderLen = (obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
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
        written += (p7signature.length + padding + 8);

        // Compute the checksum and write it in the PE header checksum location
        var tmp = Buffer.alloc(4);
        tmp.writeUInt32LE(runChecksumOnFile(output, written, ((obj.header.peOptionalHeaderLocation + 64) / 4)));
        fs.writeSync(output, tmp, 0, 4, obj.header.peOptionalHeaderLocation + 64);

        // Close the file
        fs.closeSync(output);
        func(null);
    }

    // Save an executable without the signature
    obj.unsign = function (args) {
        // Open the file
        var output = fs.openSync(args.out, 'w+');
        var written = 0, totalWrite = obj.header.sigpos;

        // Compute pre-header length and copy that to the new file
        var preHeaderLen = (obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
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

        // Compute the checksum and write it in the PE checksum header at position
        var tmp = Buffer.alloc(4);
        tmp.writeUInt32LE(runChecksumOnFile(output, written));
        fs.writeSync(output, tmp, 0, 4, obj.header.peOptionalHeaderLocation + 64);

        fs.closeSync(output);
    }

    // Find where a directory value is in the old sections and map it to the new sections
    function correctDirectoryValue(oldSections, newSections, value) {
        for (var i in oldSections) {
            if ((value >= oldSections[i].virtualAddr) && (value < (oldSections[i].virtualAddr + oldSections[i].virtualSize))) {
                return newSections[i].virtualAddr + (value - oldSections[i].virtualAddr);
            }
        }
        return 0;
    }

    // Save the executable
    obj.writeExecutable = function (args, cert, func) {
        // Open the file
        var output = fs.openSync(args.out, 'w+');
        var tmp, written = 0;

        // Compute the size of the complete executable header up to after the sections header
        var fullHeaderLen = obj.header.SectionHeadersPtr + (obj.header.coff.numberOfSections * 40);
        var fullHeader = readFileSlice(written, fullHeaderLen);

        // Create the resource section
        const rsrcSectionX = generateResourceSection(obj.resources); // This section is created with padding already included
        var rsrcSection = rsrcSectionX.data;
        var rsrcSectionVirtualSize = rsrcSectionX.size;
        var rsrcSectionRawSize = rsrcSection.length;

        // Calculate the location and original and new size of the resource segment
        var fileAlign = obj.header.peWindows.fileAlignment
        var resPtr = obj.header.sections['.rsrc'].rawAddr;
        var oldResSize = obj.header.sections['.rsrc'].rawSize;
        var newResSize = rsrcSection.length;
        var resDeltaSize = newResSize - oldResSize;

        // Compute the sizeOfInitializedData
        var sizeOfInitializedData = 0;
        for (var i in obj.header.sections) {
            if (i != '.text') {
                if (i == '.rsrc') {
                    sizeOfInitializedData += rsrcSectionRawSize;
                } else {
                    sizeOfInitializedData += obj.header.sections[i].rawSize;
                }
            }
        }

        // Change PE optional header sizeOfInitializedData standard field
        fullHeader.writeUInt32LE(sizeOfInitializedData, obj.header.peOptionalHeaderLocation + 8);

        // Update the checksum to zero
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 64);

        // We are going to setup the old a new sections here, we need this to correct directory values
        var oldSections = obj.header.sections;
        var newSections = {};

        // Make changes to the segments table
        var virtualAddress = 4096;
        for (var i in obj.header.sections) {
            const section = obj.header.sections[i];
            newSections[i] = { virtualSize: section.virtualSize };
            if (i == '.rsrc') {
                // Change the size of the resource section
                fullHeader.writeUInt32LE(rsrcSectionVirtualSize, section.ptr + 8); // virtualSize
                fullHeader.writeUInt32LE(rsrcSectionRawSize, section.ptr + 16); // rawSize

                // Set the virtual address of the section
                fullHeader.writeUInt32LE(virtualAddress, section.ptr + 12); // Virtual address
                newSections[i].virtualAddr = virtualAddress;
                var virtualAddressPadding = (rsrcSectionVirtualSize % 4096);
                virtualAddress += rsrcSectionVirtualSize;
                if (virtualAddressPadding != 0) { virtualAddress += (4096 - virtualAddressPadding); }
            } else {
                // Change the location of any other section if located after the resource section
                if (section.rawAddr > resPtr) { fullHeader.writeUInt32LE(section.rawAddr + resDeltaSize, section.ptr + 20); }

                // Set the virtual address of the section
                fullHeader.writeUInt32LE(virtualAddress, section.ptr + 12); // Virtual address
                newSections[i].virtualAddr = virtualAddress;
                var virtualAddressPadding = (section.virtualSize % 4096);
                virtualAddress += section.virtualSize;
                if (virtualAddressPadding != 0) { virtualAddress += (4096 - virtualAddressPadding); }
            }
        }

        // Make change to the data directories header to fix resource segment size and add/remove signature
        const pePlusOffset = (obj.header.pe32plus == 0) ? 0 : 16; // This header is the same for 32 and 64 bit, but 64bit is offset by 16 bytes.
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.exportTable.addr), obj.header.peOptionalHeaderLocation + 96 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.importTable.addr), obj.header.peOptionalHeaderLocation + 104 + pePlusOffset);
        fullHeader.writeUInt32LE(rsrcSectionVirtualSize, obj.header.peOptionalHeaderLocation + 116 + pePlusOffset); // Change the resource segment size
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.exceptionTableAddr.addr), obj.header.peOptionalHeaderLocation + 120 + pePlusOffset);
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 128 + pePlusOffset); // certificate table addr (TODO)
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 132 + pePlusOffset); // certificate table size (TODO)
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.baseRelocationTable.addr), obj.header.peOptionalHeaderLocation + 136 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.debug.addr), obj.header.peOptionalHeaderLocation + 144 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.globalPtr.addr), obj.header.peOptionalHeaderLocation + 160 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.tLSTable.addr), obj.header.peOptionalHeaderLocation + 168 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.loadConfigTable.addr), obj.header.peOptionalHeaderLocation + 176 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.boundImport.addr), obj.header.peOptionalHeaderLocation + 184 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.iAT.addr), obj.header.peOptionalHeaderLocation + 192 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.delayImportDescriptor.addr), obj.header.peOptionalHeaderLocation + 200 + pePlusOffset);
        fullHeader.writeUInt32LE(correctDirectoryValue(oldSections, newSections, obj.header.dataDirectories.clrRuntimeHeader.addr), obj.header.peOptionalHeaderLocation + 208 + pePlusOffset);

        // Write size of image. We put the next virtual address.
        fullHeader.writeUInt32LE(virtualAddress, obj.header.peOptionalHeaderLocation + 56); // sizeOfImage

        // Write the entire header to the destination file
        //console.log('Write header', fullHeader.length, written);
        fs.writeSync(output, fullHeader);
        written += fullHeader.length;

        // Write the entire executable until the start to the resource segment
        var totalWrite = resPtr;
        //console.log('Write until res', totalWrite, written);
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }

        // Write the new resource section
        fs.writeSync(output, rsrcSection);
        written += rsrcSection.length;
        //console.log('Write res', rsrcSection.length, written);

        // Write until the signature block
        if (obj.header.sigpos > 0) {
            // Since the original file was signed, write from the end of the resources to the start of the signature block.
            totalWrite = obj.header.sigpos + resDeltaSize;
        } else {
            // The original file was not signed, write from the end of the resources to the end of the file.
            totalWrite = obj.filesize + resDeltaSize;
        }

        //console.log('Write until signature', totalWrite, written);
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written - resDeltaSize, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }
        //console.log('Write to signature', written);

        // Write the signature if needed
        if (cert != null) {
            //if (cert == null) { cert = createSelfSignedCert({ cn: 'Test' }); }

            // Set the hash algorithm hash OID
            var hashOid = null, fileHash = null;
            if (args.hash == null) { args.hash = 'sha384'; }
            if (args.hash == 'sha256') { hashOid = forge.pki.oids.sha256; fileHash = obj.getHashOfFile(output, 'sha256', written); }
            if (args.hash == 'sha384') { hashOid = forge.pki.oids.sha384; fileHash = obj.getHashOfFile(output, 'sha384', written); }
            if (args.hash == 'sha512') { hashOid = forge.pki.oids.sha512; fileHash = obj.getHashOfFile(output, 'sha512', written); }
            if (args.hash == 'sha224') { hashOid = forge.pki.oids.sha224; fileHash = obj.getHashOfFile(output, 'sha224', written); }
            if (args.hash == 'md5') { hashOid = forge.pki.oids.md5; fileHash = obj.getHashOfFile(output, 'md5', written); }
            if (hashOid == null) { func('Bad hash method OID'); return; }

            // Create the signature block
            var xp7 = forge.pkcs7.createSignedData();
            var content = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.15').data }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000', 'bitStringContents': '\u0000', 'original': { 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000' } }, { 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 2, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': '' }] }] }] }] }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer(hashOid).data }, { 'tagClass': 0, 'type': 5, 'constructed': false, 'composed': false, 'value': '' }] }, { 'tagClass': 0, 'type': 4, 'constructed': false, 'composed': false, 'value': fileHash.toString('binary') }] }] };
            xp7.contentInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.4').getBytes())]);
            xp7.contentInfo.value.push(forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [content]));
            xp7.content = {}; // We set .contentInfo and have .content empty to bypass node-forge limitation on the type of content it can sign.
            xp7.addCertificate(cert.cert);
            if (cert.extraCerts) { for (var i = 0; i < cert.extraCerts.length; i++) { xp7.addCertificate(cert.extraCerts[0]); } } // Add any extra certificates that form the cert chain

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
            xp7.addSigner({
                key: cert.key,
                certificate: cert.cert,
                digestAlgorithm: forge.pki.oids.sha384,
                authenticatedAttributes: authenticatedAttributes
            });
            xp7.sign();
            var p7signature = Buffer.from(forge.pkcs7.messageToPem(xp7).split('-----BEGIN PKCS7-----')[1].split('-----END PKCS7-----')[0], 'base64');
            //console.log('Signature', Buffer.from(p7signature, 'binary').toString('base64'));

            if (args.time == null) {
                // Write the signature block to the output executable without time stamp
                writeExecutableEx(output, p7signature, written, func);
            } else {
                // Decode the signature block
                var pkcs7der = null;
                try { pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(p7signature)); } catch (ex) { func('' + ex); return; }

                // To work around ForgeJS PKCS#7 limitation, this may break PKCS7 verify if ForgeJS adds support for it in the future
                // Switch content type from "1.3.6.1.4.1.311.2.1.4" to "1.2.840.113549.1.7.1"
                pkcs7der.value[1].value[0].value[2].value[0].value = forge.asn1.oidToDer(forge.pki.oids.data).data;

                // Decode the PKCS7 message
                var pkcs7 = p7.messageFromAsn1(pkcs7der);

                // Create the timestamp request in DER format
                const asn1 = forge.asn1;
                const pkcs7dataOid = asn1.oidToDer('1.2.840.113549.1.7.1').data;
                const microsoftCodeSigningOid = asn1.oidToDer('1.3.6.1.4.1.311.3.2.1').data;
                const asn1obj =
                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, microsoftCodeSigningOid),
                        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, pkcs7dataOid),
                            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
                                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, pkcs7.rawCapture.signature.toString('binary')) // Signature here
                            ])
                        ])
                    ]);

                // Re-decode the PKCS7 from the executable, this time, no workaround needed
                try { pkcs7der = forge.asn1.fromDer(forge.util.createBuffer(p7signature)); } catch (ex) { func('' + ex); return; }

                // Serialize an ASN.1 object to DER format in Base64
                const requestBody = Buffer.from(asn1.toDer(asn1obj).data, 'binary').toString('base64');

                // Make an HTTP request
                const options = { url: args.time, proxy: args.proxy };

                // Make a request to the time server
                httpRequest(options, requestBody, function (err, data) {
                    if (err != null) { func(err); return; }

                    // Decode the timestamp signature block
                    var timepkcs7der = null;
                    try { timepkcs7der = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(data, 'base64').toString('binary'))); } catch (ex) { func("Unable to parse time-stamp response: " + ex); return; }

                    // Get the ASN1 certificates used to sign the timestamp and add them to the certs in the PKCS7 of the executable
                    // TODO: We could look to see if the certificate is already present in the executable
                    try {
                        var timeasn1Certs = timepkcs7der.value[1].value[0].value[3].value;
                        for (var i in timeasn1Certs) { pkcs7der.value[1].value[0].value[3].value.push(timeasn1Certs[i]); }

                        // Get the time signature and add it to the executables PKCS7
                        const timeasn1Signature = timepkcs7der.value[1].value[0].value[4];
                        const countersignatureOid = asn1.oidToDer('1.2.840.113549.1.9.6').data;
                        const asn1obj2 =
                            asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
                                asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
                                    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, countersignatureOid),
                                    timeasn1Signature
                                ])
                            ]);
                        pkcs7der.value[1].value[0].value[4].value[0].value.push(asn1obj2);

                        // Re-encode the executable signature block
                        const p7signature = Buffer.from(forge.asn1.toDer(pkcs7der).data, 'binary');

                        // Write the file with the signature block
                        writeExecutableEx(output, p7signature, written, func);
                    } catch (ex) { func('' + ex); return; } // Something failed
                });
            }
            return;
        }

        // Close the file
        fs.closeSync(output);

        // Indicate success
        func(null);
    }

    function writeExecutableEx(output, p7signature, written, func) {
        // Quad Align the results, adding padding if necessary
        var len = written + p7signature.length;
        var padding = (8 - ((len) % 8)) % 8;

        // Write the signature block header and signature
        var win = Buffer.alloc(8);                              // WIN CERTIFICATE Structure
        win.writeUInt32LE(p7signature.length + padding + 8);    // DWORD length
        win.writeUInt16LE(512, 4);                              // WORD revision
        win.writeUInt16LE(2, 6);                                // WORD type
        fs.writeSync(output, win);
        fs.writeSync(output, p7signature);
        if (padding > 0) { fs.writeSync(output, Buffer.alloc(padding, 0)); }

        // Write the signature header
        var addresstable = Buffer.alloc(8);
        addresstable.writeUInt32LE(written);
        addresstable.writeUInt32LE(8 + p7signature.length + padding, 4);
        var signatureHeaderLocation = (obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
        fs.writeSync(output, addresstable, 0, 8, signatureHeaderLocation);
        written += (p7signature.length + padding + 8);          // Add the signature block to written counter

        // Compute the checksum and write it in the PE header checksum location
        var tmp = Buffer.alloc(4);
        tmp.writeUInt32LE(runChecksumOnFile(output, written, ((obj.header.peOptionalHeaderLocation + 64) / 4)));
        fs.writeSync(output, tmp, 0, 4, obj.header.peOptionalHeaderLocation + 64);

        // Close the file
        fs.closeSync(output);

        // Indicate success
        func(null);
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
        console.log("          --exe [file]               Required executable to view information.");
        console.log("          --json                     Show information in JSON format.");
        console.log("  sign: Sign an executable.");
        console.log("          --exe [file]               Required executable to sign.");
        console.log("          --out [file]               Resulting signed executable.");
        console.log("          --pem [pemfile]            Certificate & private key to sign the executable with.");
        console.log("          --desc [description]       Description string to embbed into signature.");
        console.log("          --url [url]                URL to embbed into signature.");
        console.log("          --hash [method]            Default is SHA384, possible value: MD5, SHA224, SHA256, SHA384 or SHA512.");
        console.log("          --time [url]               The time signing server URL.");
        console.log("          --proxy [url]              The HTTP proxy to use to contact the time signing server, must start with http://");
        console.log("  unsign: Remove the signature from the executable.");
        console.log("          --exe [file]               Required executable to un-sign.");
        console.log("          --out [file]               Resulting executable with signature removed.");
        console.log("  createcert: Create a code signging self-signed certificate and key.");
        console.log("          --out [pemfile]            Required certificate file to create.");
        console.log("          --cn [value]               Required certificate common name.");
        console.log("          --country [value]          Certificate country name.");
        console.log("          --state [value]            Certificate state name.");
        console.log("          --locality [value]         Certificate locality name.");
        console.log("          --org [value]              Certificate organization name.");
        console.log("          --ou [value]               Certificate organization unit name.");
        console.log("          --serial [value]           Certificate serial number.");
        console.log("  timestamp: Add a signed timestamp to an already signed executable.");
        console.log("          --exe [file]               Required executable to timestamp.");
        console.log("          --out [file]               Resulting signed executable.");
        console.log("          --time [url]               The time signing server URL.");
        console.log("          --proxy [url]              The HTTP proxy to use to contact the time signing server, must start with http://");
        console.log("  bitmaps: Show bitmap resources in the executable.");
        console.log("          --exe [file]               Input executable.");
        console.log("  savebitmap: Save a single bitmap to a .bmp file.");
        console.log("          --exe [file]               Input executable.");
        console.log("          --out [file]               Resulting .ico file.");
        console.log("          --bitmap [number]          Bitmap number to save to file.");
        console.log("  icons: Show the icon resources in the executable.");
        console.log("          --exe [file]               Input executable.");
        console.log("  saveicon: Save a single icon bitmap to a .ico file.");
        console.log("          --exe [file]               Input executable.");
        console.log("          --out [file]               Resulting .ico file.");
        console.log("          --icon [number]            Icon number to save to file.");
        console.log("  saveicons: Save an icon group to a .ico file.");
        console.log("          --exe [file]               Input executable.");
        console.log("          --out [file]               Resulting .ico file.");
        console.log("          --icongroup [groupNumber]  Icon groupnumber to save to file.");
        console.log("");
        console.log("Note that certificate PEM files must first have the signing certificate,");
        console.log("followed by all certificates that form the trust chain.");
        console.log("");
        console.log("When doing sign/unsign, you can also change resource properties of the generated file.");
        console.log("");
        console.log("          --fileversionnumber n.n.n.n");
        console.log("          --productversionnumber n.n.n.n");
        console.log("          --filedescription [value]");
        console.log("          --fileversion [value]");
        console.log("          --internalname [value]");
        console.log("          --legalcopyright [value]");
        console.log("          --originalfilename [value]");
        console.log("          --productname [value]");
        console.log("          --productversion [value]");
        console.log("          --removeicongroup [number]");
        console.log("          --removebitmap [number]");
        console.log("          --icon [groupNumber],[filename.ico]");
        console.log("          --bitmap [number],[filename.bmp]");
        return;
    }

    // Check that a valid command is passed in
    if (['info', 'sign', 'unsign', 'createcert', 'icons', 'bitmaps', 'saveicon', 'saveicons', 'savebitmap', 'header', 'sections', 'timestamp', 'signblock'].indexOf(process.argv[2].toLowerCase()) == -1) {
        console.log("Invalid command: " + process.argv[2]);
        console.log("Valid commands are: info, sign, unsign, createcert, timestamp");
        return;
    }

    var exe = null;
    if (args.exe) {
        // Check the file exists and open the file
        var stats = null;
        try { stats = require('fs').statSync(args.exe); } catch (ex) { }
        if (stats == null) { console.log("Unable to executable open file: " + args.exe); return; }
        exe = createAuthenticodeHandler(args.exe);
        if (exe == null) { console.log("Unable to parse executable file: " + args.exe); return; }
    }

    // Parse the string resources and make any required changes
    var resChanges = false, versionStrings = null;
    if (exe != null) {
        versionStrings = exe.getVersionInfo();
        var versionProperties = ['FileDescription', 'FileVersion', 'InternalName', 'LegalCopyright', 'OriginalFilename', 'ProductName', 'ProductVersion'];
        for (var i in versionProperties) {
            const prop = versionProperties[i], propl = prop.toLowerCase();
            if (args[propl] && (args[propl] != versionStrings[prop])) { versionStrings[prop] = args[propl]; resChanges = true; }
        }
        if (args['fileversionnumber'] != null) {
            const fileVerSplit = args['fileversionnumber'].split('.');
            if (fileVerSplit.length != 4) { console.log("--fileversionnumber must be of format n.n.n.n, for example: 1.2.3.4"); return; }
            for (var i in fileVerSplit) { var n = parseInt(fileVerSplit[i]); if ((n < 0) || (n > 65535)) { console.log("--fileversionnumber numbers must be between 0 and 65535."); return; } }
            if (args['fileversionnumber'] != versionStrings['~FileVersion']) { versionStrings['~FileVersion'] = args['fileversionnumber']; resChanges = true; }
        }
        if (args['productversionnumber'] != null) {
            const productVerSplit = args['productversionnumber'].split('.');
            if (productVerSplit.length != 4) { console.log("--productversionnumber must be of format n.n.n.n, for example: 1.2.3.4"); return; }
            for (var i in productVerSplit) { var n = parseInt(productVerSplit[i]); if ((n < 0) || (n > 65535)) { console.log("--productversionnumber numbers must be between 0 and 65535."); return; } }
            if (args['productversionnumber'] != versionStrings['~ProductVersion']) { versionStrings['~ProductVersion'] = args['productversionnumber']; resChanges = true; }
        }
        if (resChanges == true) { exe.setVersionInfo(versionStrings); }
    }

    // Parse the icon changes
    resChanges = false;
    var icons = null, bitmaps = null;
    if (exe != null) {
        icons = exe.getIconInfo();
        bitmaps = exe.getBitmapInfo();
        if (typeof args['removeicongroup'] == 'string') { // If --removeicongroup is used, it's to remove an existing icon group
            const groupsToRemove = args['removeicongroup'].split(',');
            for (var i in groupsToRemove) { if (icons[groupsToRemove[i]] != null) { delete icons[groupsToRemove[i]]; resChanges = true; } }
        } else if (typeof args['removeicongroup'] == 'number') {
            if (icons[args['removeicongroup']] != null) { delete icons[args['removeicongroup']]; resChanges = true; }
        }
        if (typeof args['removebitmap'] == 'string') { // If --removebitmap is used
            const bitmapsToRemove = args['removebitmap'].split(',');
            for (var i in bitmapsToRemove) { if (bitmaps[bitmapsToRemove[i]] != null) { delete bitmaps[bitmapsToRemove[i]]; resChanges = true; } }
        } else if (typeof args['removebitmap'] == 'number') {
            if (bitmaps[args['removebitmap']] != null) { delete bitmaps[args['removebitmap']]; resChanges = true; }
        }
        if (typeof args['icon'] == 'string') { // If --icon is used, it's to add or replace an existing icon group
            const iconToAddSplit = args['icon'].split(',');
            if (iconToAddSplit.length != 2) { console.log("The --icon format is: --icon [number],[file]."); return; }
            const iconName = parseInt(iconToAddSplit[0]);
            const iconFile = iconToAddSplit[1];
            const icon = loadIcon(iconFile);
            if (icon == null) { console.log("Unable to load icon: " + iconFile); return; }
            if (icons[iconName] != null) {
                const iconHash = hashObject(icon); // Compute the new icon group hash
                const iconHash2 = hashObject(icons[iconName]); // Computer the old icon group hash
                if (iconHash != iconHash2) { icons[iconName] = icon; resChanges = true; } // If different, replace the icon group
            } else {
                icons[iconName] = icon; // We are adding an icon group
                resChanges = true;
            }
        }
        if (typeof args['bitmap'] == 'string') { // If --bitmap is used, it's to add or replace an existing bitmap
            const bitmapToAddSplit = args['bitmap'].split(',');
            if (bitmapToAddSplit.length != 2) { console.log("The --bitmap format is: --bitmap [number],[file]."); return; }
            const bitmapName = parseInt(bitmapToAddSplit[0]);
            const bitmapFile = bitmapToAddSplit[1];
            const bitmap = loadBitmap(bitmapFile);
            if (bitmap == null) { console.log("Unable to load bitmap: " + bitmapFile); return; }
            if (bitmaps[bitmapName] != null) {
                const bitmapHash = hashObject(bitmap); // Compute the new bitmap hash
                const bitmapHash2 = hashObject(bitmaps[bitmapName]); // Computer the old bitmap hash
                if (bitmapHash != bitmapHash2) { bitmaps[bitmapName] = bitmap; resChanges = true; } // If different, replace the new bitmap
            } else {
                bitmaps[bitmapName] = bitmap; // We are adding an new bitmap
                resChanges = true;
            }
        }
        if (resChanges == true) {
            exe.setIconInfo(icons);
            exe.setBitmapInfo(bitmaps);
        }
    }

    // Execute the command
    var command = process.argv[2].toLowerCase();
    if (command == 'info') { // Get signature information about an executable
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (args.json) {
            var r = {}, stringInfo = exe.getVersionInfo();
            if (stringInfo != null) {
                r.versionInfo = {};
                r.stringInfo = {};
                for (var i in stringInfo) { if (i.startsWith('~')) { r.versionInfo[i.substring(1)] = stringInfo[i]; } else { r.stringInfo[i] = stringInfo[i]; } }
            }
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
            if (versionInfo != null) {
                console.log("Version Information:");
                for (var i in versionInfo) { if (i.startsWith('~') == true) { console.log('  ' + i.substring(1) + ': ' + versionInfo[i] + ''); } }
                console.log("String Information:");
                for (var i in versionInfo) { if (i.startsWith('~') == false) { if (versionInfo[i] == null) { console.log('  ' + i + ': (Empty)'); } else { console.log('  ' + i + ': \"' + versionInfo[i] + '\"'); } } }
            }
            console.log("Checksum Information:");
            console.log("  Header CheckSum: 0x" + exe.header.peWindows.checkSum.toString(16));
            console.log("  Actual CheckSum: 0x" + exe.header.peWindows.checkSumActual.toString(16));
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
    if (command == 'header') { // Display the full executable header in JSON format
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        console.log(exe.header);
        // Check that the header is valid
        var ptr = 1024, sizeOfCode = 0, sizeOfInitializedData = 0;
        for (var i in exe.header.sections) {
            if (i == '.text') { sizeOfCode += exe.header.sections[i].rawSize; } else { sizeOfInitializedData += exe.header.sections[i].rawSize; }
            if (exe.header.sections[i].rawAddr != ptr) { console.log('WARNING: ' + i + ' section should have a rawAddr or ' + ptr + ', but has ' + exe.header.sections[i].rawAddr + ' instead.'); }
            ptr += exe.header.sections[i].rawSize;
        }
        if (exe.header.peStandard.sizeOfCode != sizeOfCode) { console.log('WARNING: Size of code is ' + exe.header.peStandard.sizeOfCode + ', should be ' + sizeOfCode + '.'); }
        if (exe.header.peStandard.sizeOfInitializedData != sizeOfInitializedData) { console.log('WARNING: Size of initialized data is ' + exe.header.peStandard.sizeOfInitializedData + ', should be ' + sizeOfInitializedData + '.'); }
    }
    if (command == 'sections') { // Display sections in CSV format
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        var csvHeader = 'section';
        for (var i in exe.header.sections['.text']) { csvHeader += ',' + i; }
        console.log(csvHeader);
        for (var i in exe.header.sections) {
            var csvData = i;
            for (var j in exe.header.sections[i]) { csvData += ',' + exe.header.sections[i][j]; }
            console.log(csvData);
        }
    }
    if (command == 'sign') { // Sign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        if (typeof args.hash == 'string') { args.hash = args.hash.toLowerCase(); if (['md5', 'sha224', 'sha256', 'sha384', 'sha512'].indexOf(args.hash) == -1) { console.log("Invalid hash method, must be SHA256 or SHA384"); return; } }
        if (args.hash == null) { args.hash = 'sha384'; }
        createOutFile(args, args.exe);
        var cert = loadCertificates(args.pem);
        if (cert == null) { console.log("Unable to load certificate and/or private key, generating test certificate."); cert = createSelfSignedCert({ cn: 'Test' }); }
        if (resChanges == false) {
            console.log("Signing to " + args.out);
            exe.sign(cert, args, function (err) { // Simple signing, copy most of the original file.
                if (err == null) { console.log("Done."); } else { console.log(err); }
                if (exe != null) { exe.close(); }
            });
            return;
        } else {
            console.log("Changing resources and signing to " + args.out);
            exe.writeExecutable(args, cert, function (err) { // Signing with resources decoded and re-encoded.
                if (err == null) { console.log("Done."); } else { console.log(err); }
                if (exe != null) { exe.close(); }
            });
            return;
        }
    }
    if (command == 'unsign') { // Unsign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        createOutFile(args, args.exe);
        if (resChanges == false) {
            if (exe.header.signed) {
                console.log("Unsigning to " + args.out);
                exe.unsign(args); // Simple unsign, copy most of the original file.
                console.log("Done.");
            } else {
                console.log("Executable is not signed.");
            }
        } else {
            console.log("Changing resources and unsigning to " + args.out);
            exe.writeExecutable(args, null, function (err) { // Unsigning with resources decoded and re-encoded.
                if (err == null) { console.log("Done."); } else { console.log(err); }
                if (exe != null) { exe.close(); }
            });
        }
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
    if (command == 'bitmaps') { // Show bitmaps in the executable
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (args.json) {
            var bitmapInfo = exe.getBitmapInfo();
            console.log(JSON.stringify(bitmapInfo, null, 2));
        } else {
            var bitmapInfo = exe.getBitmapInfo();
            if (bitmapInfo != null) {
                console.log("Bitmap Information:");
                for (var i in bitmapInfo) { console.log('  ' + i + ': ' + bitmapInfo[i].length + ' byte' + ((bitmapInfo[i].length > 1) ? 's' : '') + '.'); }
            }
        }
    }
    if (command == 'savebitmap') { // Save an bitmap to file
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (typeof args.out != 'string') { console.log("Missing --out [filename]"); return; }
        if (typeof args.bitmap != 'number') { console.log("Missing or incorrect --bitmap [number]"); return; }
        const bitmapInfo = exe.getBitmapInfo();
        if (bitmapInfo[args.bitmap] == null) { console.log("Unknown bitmap: " + args.bitmap); return; }

        console.log("Writing to " + args.out);
        var bitmapHeader = Buffer.from('424D000000000000000036000000', 'hex');
        bitmapHeader.writeUInt32LE(14 + bitmapInfo[args.bitmap].length, 2); // Write the full size of the bitmap file
        fs.writeFileSync(args.out, Buffer.concat([bitmapHeader, bitmapInfo[args.bitmap]]));
        console.log("Done.");
    }
    if (command == 'icons') { // Show icons in the executable
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (args.json) {
            var r = {}, iconInfo = exe.getIconInfo();
            if (iconInfo != null) { r.iconInfo = iconInfo; }
            console.log(JSON.stringify(r, null, 2));
        } else {
            var iconInfo = exe.getIconInfo();
            if (iconInfo != null) {
                console.log("Icon Information:");
                for (var i in iconInfo) { console.log('  Group ' + i + ':'); for (var j in iconInfo[i].icons) { console.log('    Icon ' + j + ': ' + ((iconInfo[i].icons[j].width == 0) ? 256 : iconInfo[i].icons[j].width) + 'x' + ((iconInfo[i].icons[j].height == 0) ? 256 : iconInfo[i].icons[j].height) + ', size: ' + iconInfo[i].icons[j].icon.length); } }
            }
        }
    }
    if (command == 'saveicon') { // Save an icon to file
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (typeof args.out != 'string') { console.log("Missing --out [filename]"); return; }
        if (typeof args.icon != 'number') { console.log("Missing or incorrect --icon [number]"); return; }
        const iconInfo = exe.getIconInfo();
        var icon = null;
        for (var i in iconInfo) { if (iconInfo[i].icons[args.icon]) { icon = iconInfo[i].icons[args.icon]; } }
        if (icon == null) { console.log("Unknown icon: " + args.icon); return; }

        // .ico header: https://en.wikipedia.org/wiki/ICO_(file_format)
        var buf = Buffer.alloc(22);
        buf.writeUInt16LE(1, 2); // 1 = Icon, 2 = Cursor
        buf.writeUInt16LE(1, 4); // Icon Count, always 1 in our case
        buf[6] = icon.width; // Width (0 = 256)
        buf[7] = icon.height; // Height (0 = 256)
        buf[8] = icon.colorCount; // Colors
        buf.writeUInt16LE(icon.planes, 10); // Color planes
        buf.writeUInt16LE(icon.bitCount, 12); // Bits per pixel
        buf.writeUInt32LE(icon.icon.length, 14); // Size
        buf.writeUInt32LE(22, 18); // Offset, always 22 in our case

        console.log("Writing to " + args.out);
        fs.writeFileSync(args.out, Buffer.concat([buf, icon.icon]));
        console.log("Done.");
    }
    if (command == 'saveicons') { // Save an icon group to file
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (typeof args.out != 'string') { console.log("Missing --out [filename]"); return; }
        if (typeof args.icongroup != 'number') { console.log("Missing or incorrect --icongroup [number]"); return; }
        const iconInfo = exe.getIconInfo();
        const iconGroup = iconInfo[args.icongroup];
        if (iconGroup == null) { console.log("Invalid or incorrect --icongroup [number]"); return; }

        // Count the number of icons in the group
        var iconCount = 0;
        for (var i in iconGroup.icons) { iconCount++; }

        // .ico header: https://en.wikipedia.org/wiki/ICO_(file_format)
        const iconFileData = [];
        const header = Buffer.alloc(6);
        header.writeUInt16LE(1, 2); // 1 = Icon, 2 = Cursor
        header.writeUInt16LE(iconCount, 4); // Icon Count, always 1 in our case
        iconFileData.push(header);

        // Store each icon header
        var offsetPtr = 6 + (16 * iconCount);
        for (var i in iconGroup.icons) {
            const buf = Buffer.alloc(16);
            buf[0] = iconGroup.icons[i].width; // Width (0 = 256)
            buf[1] = iconGroup.icons[i].height; // Height (0 = 256)
            buf[2] = iconGroup.icons[i].colorCount; // Colors
            buf.writeUInt16LE(iconGroup.icons[i].planes, 4); // Color planes
            buf.writeUInt16LE(iconGroup.icons[i].bitCount, 6); // Bits per pixel
            buf.writeUInt32LE(iconGroup.icons[i].icon.length, 8); // Size
            buf.writeUInt32LE(offsetPtr, 12); // Offset
            offsetPtr += iconGroup.icons[i].icon.length;
            iconFileData.push(buf);
        }

        // Store each icon
        for (var i in iconGroup.icons) { iconFileData.push(iconGroup.icons[i].icon); }

        // Write the .ico file
        console.log("Writing to " + args.out);
        fs.writeFileSync(args.out, Buffer.concat(iconFileData));
        console.log("Done.");
    }
    if (command == 'signblock') { // Display the raw signature block of the executable in hex
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        var buf = exe.getRawSignatureBlock();
        if (buf == null) { console.log("Executable is not signed."); return } else { console.log(buf.toString('hex')); return }
    }
    if (command == 'timestamp') {
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (exe.signature == null) { console.log("Executable is not signed."); return; }
        if (typeof args.time != 'string') { console.log("Missing --time [url]"); return; }
        createOutFile(args, args.exe);
        console.log("Requesting time signature...");
        exe.timeStampRequest(args, function (err) {
            if (err == null) { console.log("Done."); } else { console.log(err); }
            if (exe != null) { exe.close(); }
        })
        return;
    }

    // Close the file
    if (exe != null) { exe.close(); }
}

// If this is the main module, run the command line version
if (require.main === module) { start(); }

// Exports
module.exports.createAuthenticodeHandler = createAuthenticodeHandler;
module.exports.loadCertificates = loadCertificates;
module.exports.loadIcon = loadIcon;
module.exports.loadBitmap = loadBitmap;
module.exports.hashObject = hashObject;