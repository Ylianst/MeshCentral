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
        try { obj.fd = fs.openSync(path); } catch (ex) { console.log('E1'); return false; } // Unable to open file
        obj.stats = fs.fstatSync(obj.fd);
        obj.filesize = obj.stats.size;
        if (obj.filesize < 64) { obj.close(); console.log('E2'); return false; } // File too short.

        // Read the DOS header (64 bytes)
        var buf = readFileSlice(60, 4);
        obj.header.peHeaderLocation = buf.readUInt32LE(0); // The DOS header is 64 bytes long, the last 4 bytes are a pointer to the PE header.
        obj.header.peOptionalHeaderLocation = obj.header.peHeaderLocation + 24; // The PE optional header is located just after the PE header which is 24 bytes long.

        // Check file size and signature
        if (obj.filesize < (160 + obj.header.peHeaderLocation)) { obj.close(); console.log('E3'); return false; } // Invalid SizeOfHeaders.
        if (readFileSlice(obj.header.peHeaderLocation, 4).toString('hex') != '50450000') { obj.close(); console.log('E4'); return false; } // Invalid PE header, must start with "PE" (HEX: 50 45 00 00).

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
            default: { obj.close(); console.log('E5'); return false; } // Invalid Magic in PE
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
            obj.header.peWindows.imageBase = optinalHeader.readUInt32LE(28);
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
            obj.header.peWindows.sizeOfStackReserve = optinalHeader.readUInt32LE(72);
            obj.header.peWindows.sizeOfStackCommit = optinalHeader.readUInt32LE(76);
            obj.header.peWindows.sizeOfHeapReserve = optinalHeader.readUInt32LE(80);
            obj.header.peWindows.sizeOfHeapCommit = optinalHeader.readUInt32LE(84);
            obj.header.peWindows.loaderFlags = optinalHeader.readUInt32LE(88);
            obj.header.peWindows.numberOfRvaAndSizes = optinalHeader.readUInt32LE(92);
        } else {
            // 64bit header
            obj.header.peWindows.imageBase = optinalHeader.readBigUInt64LE(24);
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
            obj.header.peWindows.sizeOfStackReserve = optinalHeader.readBigUInt64LE(72);
            obj.header.peWindows.sizeOfStackCommit = optinalHeader.readBigUInt64LE(80);
            obj.header.peWindows.sizeOfHeapReserve = optinalHeader.readBigUInt64LE(88);
            obj.header.peWindows.sizeOfHeapCommit = optinalHeader.readBigUInt64LE(96);
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
            if (buf[0] != 46) { obj.close(); console.log('E6'); return false; }; // Name of the section must start with a dot. If not, something is wrong.
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

        // If there is a .rsrc section, read the resource information and locations
        if (obj.header.sections['.rsrc'] != null) {
            const ptr = obj.header.sections['.rsrc'].rawAddr;
            console.log('.rsrc section', ptr, obj.header.sections['.rsrc'].rawSize);
            obj.resources = readResourceTable(ptr, 0); // Read all resources recursively
        }

        if (obj.header.signed) {
            // Read signature block

            // Check if the file size allows for the signature block
            if (obj.filesize < (obj.header.sigpos + obj.header.siglen)) { obj.close(); console.log('E7'); return false; } // Executable file too short to contain the signature block.

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
                                    var r = ""; // This string value is in UCS2 format, convert it to a normal string.
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
        r.reserved = buf.readUInt32LE(12);
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
        if ((resSizeTotal % fileAlign) != 0) { resSizeTotal += (fileAlign - (resSizeTotal % fileAlign)); }
        const resSectionBuffer = Buffer.alloc(resSizeTotal);

        // Write the resource section, calling a recusrize method
        const resPointers = { tables: 0, items: resSizes.tables, names: resSizes.tables + resSizes.items, data: resSizes.tables + resSizes.items + resSizes.names };
        createResourceSection(resources, resSectionBuffer, resPointers);
        //console.log('generateResourceSection', resPointers);

        // Done, return the result
        return resSectionBuffer;
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
                var dataSize = resources.entries[i].item.size;
                if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                sizes.data += dataSize;
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

                // Write the item entry
                buf.writeUInt32LE(resPointers.data + obj.header.sections['.rsrc'].virtualAddr, resPointers.items); // Write the pointer relative to the virtual address
                buf.writeUInt32LE(resources.entries[i].item.size, resPointers.items + 4);
                buf.writeUInt32LE(resources.entries[i].item.codePage, resPointers.items + 8);
                buf.writeUInt32LE(resources.entries[i].item.reserved, resPointers.items + 12);

                // Write the data
                const actualPtr = (resources.entries[i].item.offsetToData - obj.header.sections['.rsrc'].virtualAddr) + obj.header.sections['.rsrc'].rawAddr;
                const tmp = readFileSlice(actualPtr, resources.entries[i].item.size);
                tmp.copy(buf, resPointers.data, 0, tmp.length);

                // Move items pointers forward
                resPointers.items += 16;
                var dataSize = resources.entries[i].item.size;
                if ((dataSize % 8) != 0) { dataSize += (8 - (dataSize % 8)); }
                resPointers.data += dataSize;
            }
            buf.writeUInt32LE(data, ptr + 20 + (i * 8));
        }
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

    var resourceDefaultNames = {
        'bitmaps': 2,
        'icon': 3,
        'dialogs': 5,
        'iconGroups': 14,
        'versionInfo': 16,
        'configurationFiles': 24
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
        const ptr = obj.header.sections['.rsrc'].rawAddr;
        for (var i = 0; i < obj.resources.entries.length; i++) {
            if (obj.resources.entries[i].name == resourceDefaultNames.versionInfo) {
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
            r.key = unicodeToString(buf.slice(ptr + 6, ptr + (r.wLength - (r.wValueLength * 2)))); // Key
            r.value = unicodeToString(buf.slice(ptr + r.wLength - (r.wValueLength * 2), ptr + r.wLength)); // Value
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
        runHash(hash, 0, obj.header.peHeaderLocation + 88);
        runHash(hash, obj.header.peHeaderLocation + 88 + 4, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16));
        runHash(hash, obj.header.peHeaderLocation + 152 + (obj.header.pe32plus * 16) + 8, obj.header.sigpos > 0 ? obj.header.sigpos : obj.filesize);
        return hash.digest();
    }

    // Hash the file from start to end loading 64k chunks
    function runHash(hash, start, end) {
        var ptr = start;
        while (ptr < end) { const buf = readFileSlice(ptr, Math.min(65536, end - ptr)); hash.update(buf); ptr += buf.length; }
    }

    // Compute the PE checksum of a file (this is not yet tested)
    function getChecksum(data, PECheckSumLocation) {
        var checksum = 0, top = Math.pow(2, 32);

        for (var i = 0; i < (data.length / 4); i++) {
            if (i == PECheckSumLocation / 4) continue;
            var dword = data.readUInt32LE(i * 4);
            checksum = (checksum & 0xffffffff) + dword + (checksum >> 32);
            if (checksum > top) { checksum = (checksum & 0xffffffff) + (checksum >> 32); }
        }

        checksum = (checksum & 0xffff) + (checksum >> 16);
        checksum = (checksum) + (checksum >> 16);
        checksum = checksum & 0xffff;

        checksum += data.length;
        return checksum;
    }

    // Sign the file using the certificate and key. If none is specified, generate a dummy one
    obj.sign = function (cert, args) {
        if (cert == null) { cert = createSelfSignedCert({ cn: 'Test' }); }

        // Set the hash algorithm hash OID
        var hashOid = null, fileHash = null;
        if (args.hash == null) { args.hash = 'sha384'; }
        if (args.hash == 'sha256') { hashOid = forge.pki.oids.sha256; fileHash = obj.getHash('sha256'); }
        if (args.hash == 'sha384') { hashOid = forge.pki.oids.sha384; fileHash = obj.getHash('sha384'); }
        if (args.hash == 'sha512') { hashOid = forge.pki.oids.sha512; fileHash = obj.getHash('sha512'); }
        if (args.hash == 'sha224') { hashOid = forge.pki.oids.sha224; fileHash = obj.getHash('sha224'); }
        if (args.hash == 'md5') { hashOid = forge.pki.oids.md5; fileHash = obj.getHash('md5'); }
        if (hashOid == null) return false;

        // Create the signature block
        var p7 = forge.pkcs7.createSignedData();
        var content = { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer('1.3.6.1.4.1.311.2.1.15').data }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000', 'bitStringContents': '\u0000', 'original': { 'tagClass': 0, 'type': 3, 'constructed': false, 'composed': false, 'value': '\u0000' } }, { 'tagClass': 128, 'type': 0, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 2, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 128, 'type': 0, 'constructed': false, 'composed': false, 'value': '' }] }] }] }] }, { 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 16, 'constructed': true, 'composed': true, 'value': [{ 'tagClass': 0, 'type': 6, 'constructed': false, 'composed': false, 'value': forge.asn1.oidToDer(hashOid).data }, { 'tagClass': 0, 'type': 5, 'constructed': false, 'composed': false, 'value': '' }] }, { 'tagClass': 0, 'type': 4, 'constructed': false, 'composed': false, 'value': fileHash.toString('binary') }] }] };
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
        var output = null;
        try { output = fs.openSync(args.out, 'w'); } catch (ex) { }
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

        // Close the file
        fs.closeSync(output);
        return true;
    }

    // Save an executable without the signature
    obj.unsign = function (args) {
        // Open the file
        var output = fs.openSync(args.out, 'w');
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
        fs.closeSync(output);
    }

    // Save the executable
    obj.writeExecutable = function (args) {
        // Open the file
        var output = fs.openSync(args.out, 'w');
        var tmp, written = 0;

        // Compute the size of the complete executable header up to after the sections header
        var fullHeaderLen = obj.header.SectionHeadersPtr + (obj.header.coff.numberOfSections * 40);
        var fullHeader = readFileSlice(written, fullHeaderLen);

        // Calculate the location and original and new size of the resource segment
        var fileAlign = obj.header.peWindows.fileAlignment
        var resPtr = obj.header.sections['.rsrc'].rawAddr;
        var oldResSize = obj.header.sections['.rsrc'].rawSize;
        var newResSize = obj.header.sections['.rsrc'].rawSize; // Testing 102400
        var resDeltaSize = newResSize - oldResSize;

        console.log('fileAlign', fileAlign);
        console.log('resPtr', resPtr);
        console.log('oldResSize', oldResSize);
        console.log('newResSize', newResSize);
        console.log('resDeltaSize', resDeltaSize);

        // Change PE optional header sizeOfInitializedData standard field
        fullHeader.writeUInt32LE(obj.header.peStandard.sizeOfInitializedData + resDeltaSize, obj.header.peOptionalHeaderLocation + 8);
        fullHeader.writeUInt32LE(obj.header.peWindows.sizeOfImage, obj.header.peOptionalHeaderLocation + 56); // TODO: resDeltaSize

        // Update the checksum, set to zero since it's not used
        // TODO: Take a look at computing this correctly in the future
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 64);

        // Make change to the data directories header to fix resource segment size and add/remove signature
        const pePlusOffset = (obj.header.pe32plus == 0) ? 0 : 16; // This header is the same for 32 and 64 bit, but 64bit is offset by 16 bytes.
        if (obj.header.dataDirectories.exportTable.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.exportTable.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 96 + pePlusOffset); }
        if (obj.header.dataDirectories.importTable.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.importTable.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 104 + pePlusOffset); }
        //fullHeader.writeUInt32LE(obj.header.dataDirectories.resourceTable.size + resDeltaSize, obj.header.peOptionalHeaderLocation + 116 + pePlusOffset); // Change the resource segment size
        if (obj.header.dataDirectories.exceptionTableAddr.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.exceptionTableAddr.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 120 + pePlusOffset); }
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 128 + pePlusOffset); // certificate table addr (TODO)
        fullHeader.writeUInt32LE(0, obj.header.peOptionalHeaderLocation + 132 + pePlusOffset); // certificate table size (TODO)
        if (obj.header.dataDirectories.baseRelocationTable.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.baseRelocationTable.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 136 + pePlusOffset); }
        if (obj.header.dataDirectories.debug.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.debug.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 144 + pePlusOffset); }
        if (obj.header.dataDirectories.globalPtr.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.globalPtr.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 160 + pePlusOffset); }
        if (obj.header.dataDirectories.tLSTable.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.tLSTable.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 168 + pePlusOffset); }
        if (obj.header.dataDirectories.loadConfigTable.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.loadConfigTable.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 176 + pePlusOffset); }
        if (obj.header.dataDirectories.boundImport.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.boundImport.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 184 + pePlusOffset); }
        if (obj.header.dataDirectories.iAT.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.iAT.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 192 + pePlusOffset); }
        if (obj.header.dataDirectories.delayImportDescriptor.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.delayImportDescriptor.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 200 + pePlusOffset); }
        if (obj.header.dataDirectories.clrRuntimeHeader.addr > resPtr) { fullHeader.writeUInt32LE(obj.header.dataDirectories.clrRuntimeHeader.addr + resDeltaSize, obj.header.peOptionalHeaderLocation + 208 + pePlusOffset); }

        // Make changes to the segments table
        for (var i in obj.header.sections) {
            const section = obj.header.sections[i];
            if (i == '.rsrc') {
                // Change the size of the resource section
                fullHeader.writeUInt32LE(section.rawSize + resDeltaSize, section.ptr + 8); // virtualSize (TODO)
                fullHeader.writeUInt32LE(section.rawSize + resDeltaSize, section.ptr + 16); // rawSize
            } else {
                // Change the location of any other section if located after the resource section
                if (section.virtualAddr > resPtr) { fullHeader.writeUInt32LE(section.virtualAddr + resDeltaSize, section.ptr + 12); }
                if (section.rawAddr > resPtr) { fullHeader.writeUInt32LE(section.rawAddr + resDeltaSize, section.ptr + 20); }
            }
        }

        // Write the entire header to the destination file
        console.log('Write header', fullHeader.length);
        fs.writeSync(output, fullHeader);
        written += fullHeader.length;

        // Write the entire executable until the start to the resource segment
        var totalWrite = resPtr;
        console.log('Write until res', totalWrite);
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }

        // Write the new resource section
        var rsrcSection = generateResourceSection(obj.resources);
        fs.writeSync(output, rsrcSection);
        written += rsrcSection.length;

        /*
        // Write the old resource segment (debug)
        totalWrite = resPtr + oldResSize;
        console.log('Write res', totalWrite);
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }
        */

        /*
        // Write a dummy 102400 bytes
        tmp = Buffer.alloc(resDeltaSize);
        console.log('Write dummy', resDeltaSize);
        fs.writeSync(output, tmp);
        written += tmp.length;
        */

        // Write until the signature block
        totalWrite = obj.header.sigpos + resDeltaSize;
        console.log('Write until signature', totalWrite);
        while ((totalWrite - written) > 0) {
            tmp = readFileSlice(written - resDeltaSize, Math.min(totalWrite - written, 65536));
            fs.writeSync(output, tmp);
            written += tmp.length;
        }

        // Write the signature if needed
        // TODO

        // Close the file
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
        console.log("          --hash [method]          Default is SHA384, possible value: MD5, SHA224, SHA256, SHA384 or SHA512.");
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
    if (['info', 'sign', 'unsign', 'createcert', 'icons', 'saveicon', 'header', 'test'].indexOf(process.argv[2].toLowerCase()) == -1) {
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
        if (exe == null) { console.log("Unable to parse executable file: " + args.exe); return; }
    }

    // Execute the command
    var command = process.argv[2].toLowerCase();
    if (command == 'info') { // Get signature information about an executable
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        if (args.json) {
            var r = {}, versionInfo = exe.getVersionInfo();
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
    if (command == 'header') { // Display the full executable header in JSON format
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        console.log(exe.header);
    }
    if (command == 'sign') { // Sign an executable
        if (typeof args.exe != 'string') { console.log("Missing --exe [filename]"); return; }
        if (typeof args.hash == 'string') { args.hash = args.hash.toLowerCase(); if (['md5', 'sha224', 'sha256', 'sha384', 'sha512'].indexOf(args.hash) == -1) { console.log("Invalid hash method, must be SHA256 or SHA384"); return; } }
        if (args.hash == null) { args.hash = 'sha384'; }
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
    if (command == 'test') { // Grow the resource segment by 100k
        if (exe == null) { console.log("Missing --exe [filename]"); return; }
        createOutFile(args, args.exe);
        console.log("Writting to " + args.out);
        exe.resourcesChanged = true; // Indicate the resources have changed
        exe.writeExecutable(args);

        // Parse the output file
        var exe2 = createAuthenticodeHandler(args.out);
        if (exe2 == null) { console.log("XX Unable to parse executable file: " + args.out); return; }
        console.log('XX Parse OK');
    }

    // Close the file
    if (exe != null) { exe.close(); }
}

// If this is the main module, run the command line version
if (require.main === module) { start(); }

// Exports
module.exports.createAuthenticodeHandler = createAuthenticodeHandler;
module.exports.loadCertificates = loadCertificates;
