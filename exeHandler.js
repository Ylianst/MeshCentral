/*
Copyright 2018-2022 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

const exeJavaScriptGuid = 'B996015880544A19B7F7E9BE44914C18';
const exeMeshPolicyGuid = 'B996015880544A19B7F7E9BE44914C19';
const exeNullPolicyGuid = 'B996015880544A19B7F7E9BE44914C20';


// Changes a Windows Executable to add JavaScript inside of it.
// This method will write to destination stream and close it.
//
// options = {
//   platform: 'win32' or 'linux',
//   sourceFileName: 'pathToBinary',
//   destinationStream: 'outputStream'
//   js: 'jsContent',
//   peinfo {} // Optional, if PE header already parsed place it here.
// }
//
module.exports.streamExeWithJavaScript = function (options) {
    // Check all inputs
    if (!options.platform) { throw ('platform not specified'); }
    if (!options.destinationStream) { throw ('destination stream was not specified'); }
    if (!options.sourceFileName) { throw ('source file not specified'); }
    if (!options.js) { throw ('js content not specified'); }

    // If a Windows binary, parse it if not already parsed
    if ((options.platform == 'win32') && (!options.peinfo)) { options.peinfo = module.exports.parseWindowsExecutable(options.sourceFileName); }

    // If unsigned Windows or Linux, we merge at the end with the GUID and no padding.
    if (((options.platform == 'win32') && (options.peinfo.CertificateTableAddress == 0)) || (options.platform != 'win32')) {
        // This is not a signed binary, so we can just send over the EXE then the MSH
        options.destinationStream.sourceStream = require('fs').createReadStream(options.sourceFileName, { flags: 'r' });
        options.destinationStream.sourceStream.options = options;
        options.destinationStream.sourceStream.on('end', function () {
            // Once the binary is streamed, write the msh + length + guid in that order.
            this.options.destinationStream.write(this.options.js); // JS content
            var sz = Buffer.alloc(4);
            sz.writeUInt32BE(this.options.js.length, 0);
            this.options.destinationStream.write(sz); // Length in small endian
            this.options.destinationStream.end(Buffer.from(exeJavaScriptGuid, 'hex')); // GUID
        });
        // Pipe the entire source binary without ending the stream.
        options.destinationStream.sourceStream.pipe(options.destinationStream, { end: false });
    } else {
        throw ('streamExeWithJavaScript(): Cannot stream JavaScript with signed executable.');
    }
};


// Changes a Windows Executable to add the MSH inside of it.
// This method will write to destination stream and close it.
//
// options = {
//   platform: 'win32' or 'linux',
//   sourceFileName: 'pathToBinary',
//   destinationStream: 'outputStream'
//   msh: 'mshContent',
//   randomPolicy: true, // Set is the MSH contains random data
//   peinfo {} // Optional, if PE header already parsed place it here.
// }
//
module.exports.streamExeWithMeshPolicy = function (options) {
    // Check all inputs
    if (!options.platform) { throw ('platform not specified'); }
    if (!options.destinationStream) { throw ('destination stream was not specified'); }
    if (!options.sourceFileName) { throw ('source file not specified'); }
    if (!options.msh) { throw ('msh content not specified'); }
    options.mshbuf = Buffer.from(options.msh, 'utf8');

    // If a Windows binary, parse it if not already parsed
    if ((options.platform == 'win32') && (!options.peinfo)) { options.peinfo = module.exports.parseWindowsExecutable(options.sourceFileName); }

    // If unsigned Windows or Linux, we merge at the end with the GUID and no padding.
    if ((options.platform == 'win32' && options.peinfo.CertificateTableAddress == 0) || options.platform != 'win32') {
        // This is not a signed binary, so we can just send over the EXE then the MSH
        options.destinationStream.sourceStream = require('fs').createReadStream(options.sourceFileName, { flags: 'r' });
        options.destinationStream.sourceStream.options = options;
        options.destinationStream.sourceStream.on('end', function () {
            // Once the binary is streamed, write the msh + length + guid in that order.
            this.options.destinationStream.write(this.options.mshbuf); // MSH
            var sz = Buffer.alloc(4);
            sz.writeUInt32BE(this.options.mshbuf.length, 0);
            this.options.destinationStream.write(sz); // Length in small endian
            this.options.destinationStream.end(Buffer.from((this.options.randomPolicy === true) ? exeNullPolicyGuid : exeMeshPolicyGuid, 'hex'));  // Guid
        });
        // Pipe the entire source binary without ending the stream.
        options.destinationStream.sourceStream.pipe(options.destinationStream, { end: false });
    } else if (options.platform == 'win32' && options.peinfo.CertificateTableAddress != 0) {
        // Read up to the certificate table size and stream that out
        options.destinationStream.sourceStream = require('fs').createReadStream(options.sourceFileName, { flags: 'r', start: 0, end: options.peinfo.CertificateTableSizePos - 1 });
        options.destinationStream.sourceStream.mshPadding = (8 - ((options.peinfo.certificateDwLength + options.mshbuf.length + 20) % 8)) % 8; // Compute the padding with quad-align
        options.destinationStream.sourceStream.CertificateTableSize = (options.peinfo.CertificateTableSize + options.mshbuf.length + 20 + options.destinationStream.sourceStream.mshPadding); // Add to the certificate table size
        options.destinationStream.sourceStream.certificateDwLength = (options.peinfo.certificateDwLength + options.mshbuf.length + 20 + options.destinationStream.sourceStream.mshPadding); // Add to the certificate size
        options.destinationStream.sourceStream.options = options;

        options.destinationStream.sourceStream.on('end', function () {
            // We sent up to the CertificateTableSize, now we need to send the updated certificate table size
            var sz = Buffer.alloc(4);
            sz.writeUInt32LE(this.CertificateTableSize, 0);
            this.options.destinationStream.write(sz); // New cert table size

            // Stream everything up to the start of the certificate table entry
            var source2 = require('fs').createReadStream(options.sourceFileName, { flags: 'r', start: this.options.peinfo.CertificateTableSizePos + 4, end: this.options.peinfo.CertificateTableAddress - 1 });
            source2.options = this.options;
            source2.mshPadding = this.mshPadding;
            source2.certificateDwLength = this.certificateDwLength;
            source2.on('end', function () {
                // We've sent up to the Certificate DWLength, which we need to update
                var sz = Buffer.alloc(4);
                sz.writeUInt32LE(this.certificateDwLength, 0);
                this.options.destinationStream.write(sz); // New certificate length

                // Stream the entire binary until the end
                var source3 = require('fs').createReadStream(options.sourceFileName, { flags: 'r', start: this.options.peinfo.CertificateTableAddress + 4 });
                source3.options = this.options;
                source3.mshPadding = this.mshPadding;
                source3.on('end', function () {
                    // We've sent the entire binary... Now send: Padding + MSH + MSHLength + GUID
                    if (this.mshPadding > 0) { this.options.destinationStream.write(Buffer.alloc(this.mshPadding)); } // Padding
                    this.options.destinationStream.write(this.options.mshbuf); // MSH content
                    var sz = Buffer.alloc(4);
                    sz.writeUInt32BE(this.options.mshbuf.length, 0);
                    this.options.destinationStream.write(sz); // MSH Length, small-endian
                    this.options.destinationStream.end(Buffer.from((this.options.randomPolicy === true) ? exeNullPolicyGuid : exeMeshPolicyGuid, 'hex')); // Guid
                });
                source3.pipe(this.options.destinationStream, { end: false });
                this.options.sourceStream = source3;
            });
            source2.pipe(this.options.destinationStream, { end: false });
            this.options.destinationStream.sourceStream = source2;
        });
        options.destinationStream.sourceStream.pipe(options.destinationStream, { end: false });
    }
};


// Return information about this executable
// This works only on Windows binaries
module.exports.parseWindowsExecutable = function (exePath) {
    var retVal = {};
    var fs = require('fs');
    var fd = fs.openSync(exePath, 'r');
    var bytesRead;
    var dosHeader = Buffer.alloc(64);
    var ntHeader = Buffer.alloc(24);
    var optHeader;
    var numRVA;

    // Read the DOS header
    bytesRead = fs.readSync(fd, dosHeader, 0, 64, 0);
    if (dosHeader.readUInt16LE(0).toString(16).toUpperCase() != '5A4D') { throw ('unrecognized binary format'); }

    // Read the NT header
    bytesRead = fs.readSync(fd, ntHeader, 0, ntHeader.length, dosHeader.readUInt32LE(60));
    if (ntHeader.slice(0, 4).toString('hex') != '50450000') {
        throw ('not a PE file');
    }
    switch (ntHeader.readUInt16LE(4).toString(16)) {
        case '14c': // 32 bit
            retVal.format = 'x86';
            break;
        case '8664': // 64 bit
            retVal.format = 'x64';
            break;
        default: // Unknown
            retVal.format = undefined;
            break;
    }

    retVal.optionalHeaderSize = ntHeader.readUInt16LE(20);
    retVal.optionalHeaderSizeAddress = dosHeader.readUInt32LE(60) + 20;

    // Read the optional header
    optHeader = Buffer.alloc(ntHeader.readUInt16LE(20));
    bytesRead = fs.readSync(fd, optHeader, 0, optHeader.length, dosHeader.readUInt32LE(60) + 24);

    retVal.CheckSumPos = dosHeader.readUInt32LE(60) + 24 + 64;
    retVal.SizeOfCode = optHeader.readUInt32LE(4);
    retVal.SizeOfInitializedData = optHeader.readUInt32LE(8);
    retVal.SizeOfUnInitializedData = optHeader.readUInt32LE(12);

    switch (optHeader.readUInt16LE(0).toString(16).toUpperCase()) {
        case '10B': // 32 bit binary
            numRVA = optHeader.readUInt32LE(92);
            retVal.CertificateTableAddress = optHeader.readUInt32LE(128);
            retVal.CertificateTableSize = optHeader.readUInt32LE(132);
            retVal.CertificateTableSizePos = dosHeader.readUInt32LE(60) + 24 + 132;
            retVal.rvaStartAddress = dosHeader.readUInt32LE(60) + 24 + 96;
            break;
        case '20B': // 64 bit binary
            numRVA = optHeader.readUInt32LE(108);
            retVal.CertificateTableAddress = optHeader.readUInt32LE(144);
            retVal.CertificateTableSize = optHeader.readUInt32LE(148);
            retVal.CertificateTableSizePos = dosHeader.readUInt32LE(60) + 24 + 148;
            retVal.rvaStartAddress = dosHeader.readUInt32LE(60) + 24 + 112;
            break;
        default:
            throw ('Unknown Value found for Optional Magic: ' + ntHeader.readUInt16LE(24).toString(16).toUpperCase());
    }
    retVal.rvaCount = numRVA;

    if (retVal.CertificateTableAddress) {
        // Read the authenticode certificate, only one cert (only the first entry)
        var hdr = Buffer.alloc(8);
        fs.readSync(fd, hdr, 0, hdr.length, retVal.CertificateTableAddress);
        retVal.certificate = Buffer.alloc(hdr.readUInt32LE(0));
        fs.readSync(fd, retVal.certificate, 0, retVal.certificate.length, retVal.CertificateTableAddress + hdr.length);
        retVal.certificate = retVal.certificate.toString('base64');
        retVal.certificateDwLength = hdr.readUInt32LE(0);
    }
    fs.closeSync(fd);
    return (retVal);
};


//
// Hash a executable file. Works on both Windows and Linux.
// On Windows, will hash so that signature or .msh addition will not change the hash. Adding a .js on un-signed executable will change the hash.
//
// options = {
//   sourcePath: <string> Executable Path
//   targetStream: <stream.writeable> Hashing Stream
//   platform: <string> Optional. Same value as process.platform ('win32' | 'linux' | 'darwin')
// }
//
module.exports.hashExecutableFile = function (options) {
    if (!options.sourcePath || !options.targetStream) { throw ('Please specify sourcePath and targetStream'); }
    var fs = require('fs');

    // If not specified, try to determine platform type
    if (!options.platform) {
        try {
            // If we can parse the executable, we know it's windows.
            options.peinfo = module.exports.parseWindowsExecutable(options.sourcePath);
            options.platform = 'win32';
        } catch (e) {
            options.platform = 'other';
        }
    }

    // Setup initial state
    options.state = { endIndex: 0, checkSumIndex: 0, tableIndex: 0, stats: fs.statSync(options.sourcePath) };

    if (options.platform == 'win32') {
        if (options.peinfo.CertificateTableAddress != 0) { options.state.endIndex = options.peinfo.CertificateTableAddress; }
        options.state.tableIndex = options.peinfo.CertificateTableSizePos - 4;
        options.state.checkSumIndex = options.peinfo.CheckSumPos;
    }

    if (options.state.endIndex == 0) {
        // We just need to check for Embedded MSH file
        var fd = fs.openSync(options.sourcePath, 'r');
        var guid = Buffer.alloc(16);
        var bytesRead;

        bytesRead = fs.readSync(fd, guid, 0, guid.length, options.state.stats.size - 16);
        if (guid.toString('hex') == exeMeshPolicyGuid) {
            bytesRead = fs.readSync(fd, guid, 0, 4, options.state.stats.size - 20);
            options.state.endIndex = options.state.stats.size - 20 - guid.readUInt32LE(0);
        } else {
            options.state.endIndex = options.state.stats.size;
        }
        fs.closeSync(fd);
    }

    // Linux does not have a checksum
    if (options.state.checkSumIndex != 0) {
        // Windows
        options.state.source = fs.createReadStream(options.sourcePath, { flags: 'r', start: 0, end: options.state.checkSumIndex - 1 });
        options.state.source.on('end', function () {
            options.targetStream.write(Buffer.alloc(4));
            var source = fs.createReadStream(options.sourcePath, { flags: 'r', start: options.state.checkSumIndex + 4, end: options.state.tableIndex - 1 });
            source.on('end', function () {
                options.targetStream.write(Buffer.alloc(8));
                var source = fs.createReadStream(options.sourcePath, { flags: 'r', start: options.state.tableIndex + 8, end: options.state.endIndex - 1 });
                options.state.source = source;
                options.state.source.pipe(options.targetStream);
            });
            options.state.source = source;
            options.state.source.pipe(options.targetStream, { end: false });
        });
        options.state.source.pipe(options.targetStream, { end: false });
    } else {
        // Linux
        options.state.source = fs.createReadStream(options.sourcePath, { flags: 'r', start: 0, end: options.state.endIndex - 1 });
        options.state.source.pipe(options.targetStream);
    }
};
