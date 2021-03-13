/*
Copyright 2020-2021 Intel Corporation

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

/**
* @description Intel(R) AMT Setup.bin Parser
* @author Ylian Saint-Hilaire
* @version v0.1.0
*/

var CreateAmtSetupBinStack = function () {
    var o = {};

    // Intel(R) AMT Setup.bin GUID's
    var AmtSetupBinSetupGuids = [
        '\xb5\x16\xfb\x71\x87\xcb\xf9\x4a\xb4\x41\xca\x7b\x38\x35\x78\xf9', // Version 1
        '\x96\xb2\x81\x58\xcf\x6b\x72\x4c\x8b\x91\xa1\x5e\x51\x2e\x99\xc4', // Version 2
        '\xa7\xf7\xf6\xc6\x89\xc4\xf6\x47\x93\xed\xe2\xe5\x02\x0d\xa5\x1d', // Version 3
        '\xaa\xa9\x34\x52\xe1\x29\xa9\x44\x8d\x4d\x08\x1c\x07\xb9\x63\x53'  // Version 4
    ];

    // Notes about version 2 of setup.bin:
    //   - Default "admin" must be followed by a new MEBx password
    //   - ME_VARIABLE_IDENTIFIER_MANAGEABILITY_FEATURE_SELECTION may not appear after any CM settings
    //   - CM_VARIABLE_IDENTIFIER_USER_DEFINED_CERT_ADD must be preceded by setting CM_VARIABLE_IDENTIFIER_USER_DEFINED_CERTS_CONFIG to (TODO!)

    // General notes:
    //   - Setup.bin should always start with "CurrentMEBx Pwd", "newMebx Pwd", "manageability selection" (if present).

    // Intel(R) AMT variable identifiers
    // Type: 0 = Binar String, 1 = Char, 2 = Short, 3 = Int
    var AmtSetupBinVarIds =
        {
            1: {
                1: [0, "Current MEBx Password"],
                2: [0, "New MEBx Password"],
                3: [1, "Manageability Feature Selection",
                    { 0: "None", 1: "Intel AMT" }],
                4: [1, "Firmware Local Update",                   // 0 = Disabled, 1 = Enabled, 2 = Password Protected
                    { 0: "Disabled", 1: "Enabled", 2: "Password Protected" }],
                5: [1, "Firmware Update Qualifier",               // 0 = Always, 1 = Never, 2 = Restricted
                    { 0: "Always", 1: "Never", 2: "Restricted" }],
                6: [4, "Power Package"]                           // GUID Length (16 bytes), Intel AMT version 2.1, 3 and 4
            },
            2: {
                1: [0, "Provisioning Preshared Key ID (PID)"],
                2: [0, "Provisioning Preshared Key (PPS)"],
                3: [0, "PKI DNS Suffix"],                         // 255 bytes max length
                4: [0, "Configuration Server FQDN"],              // 255 bytes max length
                5: [1, "Remote Configuration Enabled (RCFG)",     // 0 = Off, 1 = On
                    { 0: "Off", 1: "On" }],
                6: [1, "Pre-Installed Certificates Enabled",      // 0 = Off, 1 = On
                    { 0: "Off", 1: "On" }],
                7: [1, "User Defined Certificate Configuration",  // 0 = Disabled, 1 = Enabled, 2 = Delete
                    { 0: "Disabled", 1: "Enabled", 2: "Delete" }],
                8: [0, "User Defined Certificate Addition"],      // 1 byte hash algo, 20 to 48 bytes hash, 1 byte name length, up to 32 bytes friendly name, 1 = SHA1 (20 bytes), 2 = SHA256 (32 bytes), 3 = SHA384 (48 bytes). Algo 2 & 3 are for version 3 and up.
                10: [1, "SOL/IDER Redirection Configuration", {
                    0: "None", 1: "SOL only - User/Pass Disabled", 2: "IDER only - User/Pass Disabled", 3: "SOL+IDER - User/Pass Disabled",
                    4: "None - User/Pass Enabled", 5: "SOL only - User/Pass Enabled", 6: "IDER only - User/Pass Enabled", 7: "SOL+IDER - User/Pass Enabled"
                }],
                11: [0, "Hostname"],                               // 63 bytes max length
                12: [0, "Domain Name"],                            // 255 bytes max length
                13: [1, "DHCP", { 1: "Disabled", 2: "Enabled" }],
                14: [1, "Secure Firmware Update (SFWU)",           // 0 = Disabled, 1 = Enabled
                    { 0: "Disabled", 1: "Enabled" }],
                15: [0, "ITO"],
                16: [1, "Provisioning Mode (PM)",                  // 1 = Enterprise, 2 = Small Buisness (SMB)
                    { 0: "Enterprise", 1: "Small Buisness" }],
                17: [0, "Provisioning Server Address"],
                18: [2, "Provision Server Port Number (PSPO)"],
                19: [0, "Static IPv4 Parameters"],
                20: [0, "VLAN"],
                21: [0, "PASS Policy Flag"],
                22: [0, "IPv6"],                                   // Length is 204 bytes old format, 84 bytes new format, Version 3+ only
                23: [1, "Shared/Dedicated FQDN",                   // 0 = Dedicated, 1 = Shared. This option is valid only if configuring the hostname as well
                    { 0: "Dedicated", 1: "Shared" }],
                24: [1, "Dynamic DNS Update",                      // 0 = Disabled, 1 = Enabled
                    { 0: "Disabled", 1: "Enabled" }],
                25: [1, "Remote Desktop (KVM) State",              // 0 = Disabled, 1 = Enabled
                    { 0: "Disabled", 1: "Enabled" }],
                26: [1, "Opt-in User Consent Option",              // 0 = Disabled, 1 = KVM, 0xFF = ALL
                    { 0: "Disabled", 1: "KVM", 255: "All" }],
                27: [1, "Opt-in Remote IT Consent Policy",         // 0 = Disabled, 1 = Enabled. Allows user consent to be configured remotely.
                    { 0: "Disabled", 1: "Enabled" }],
                28: [1, "ME Provision Halt/Active",                // 0 = Stop, 1 = Start. The "ME provisioning Halt/Activate" command must appear in the file only after "PKIDNSSuffix", "ConfigServerFQDN" and "Provisioning Server Address"
                    { 0: "Stop", 1: "Start" }],
                29: [1, "Manual Setup and Configuration",          // 0 = Automated, 1 = Manual
                    { 0: "Automated", 1: "Manual" }],
                30: [3, "Support Channel Identifier"],             // 4 bytes length. Support channel identifier (valid values: 1-65535)
                31: [0, "Support Channel Description"],            // 60 bytes max. Friendly name used to describe the party representedby the support channel identifier.
                32: [0, "Service Account Number"],                 // 32 bytes max. Unique string identifier given to the end user by the service provider.
                33: [0, "Enrollement Passcode"],                   // 32 bytes max
                34: [3, "Service Type"],                           // 4 bytes length. 1 = Reactive, 2 = Proactive, 4 = One Time Session
                35: [0, "Service Provider Identifier"]             // GUID Length (16 bytes)
            }
        }


    // Parse the Setup.bin file
    o.AmtSetupBinCreate = function (version, flags) {
        var obj = {};
        obj.fileType = version;
        obj.recordChunkCount = 1; // TODO
        obj.recordHeaderByteCount = 46;
        obj.recordNumber = 0;
        obj.majorVersion = version;
        obj.minorVersion = 0;
        obj.flags = flags;
        obj.dataRecordsConsumed = 0;
        obj.dataRecordChunkCount = 1; // TODO
        obj.records = [];
        return obj;
    }


    // Parse the Setup.bin file
    o.AmtSetupBinDecode = function (file) {
        // Format of the setup file header:
        // FileTypeUUID(16)         - uniquely identifies the file type. This identifier will remain valid and constant across all versions of the file type.
        // RecordChunkCount(2)      - indicates the number of 512-byte chunks occupied by this record, including all header, body, and reserved fields.
        // RecordHeaderBytes(2)     - indicates the length of the record header in bytes.
        // RecordNumber(4)          - uniquely identifies the record among all records in the file. The field contains a non-negative ordinal value. The value of this field is always zero in the Local Provisioning File Header Record.
        // MajorVersion(1)          - identifies the major version of the file format specification. This is a positive integer that is greater than or equal to 1. The Major Version number is incremented to indicate that changes have been introduced that will cause code written against a lower Major Version number to fail.
        // MinorVersion(1)          - identifies the minor version of the file format specification. This is an integer that is greater than or equal to 0. The Minor Version number is incremented to indicate that changes have been introduced that will not cause code written against the same Major Version and a lower Minor Version number to fail. The purpose of this behavior is to allow a single local provisioning file to be used for multiple generations of Intel® AMT platform.
        // Flags (2)                - file Flags,  1 = Do not consume records
        // DataRecordCount(4)       - indicates the total number of data records written in the file when it was created.
        // DataRecordsConsumed(4)   - is a counter value that begins at 0 and is incremented by 1 by each platform BIOS when it consumes a data record from the file. This value is used to determine the offset of the next data record in the file.
        // DataRecordChunkCount(2)  - contains the number of 512-byte chunks in each data record. All data records are the same length.
        // Reserved (2)             - reserved
        // ModuleList               - contains a list of module identifiers. A module’s identifier appears in the list if and only if the data records contain entries for that module. Each module identifier is two bytes in length. The list is terminated by an identifier value of 0. 

        var obj = {}, UUID = file.substring(0, 16);
        obj.fileType = 0;
        for (var i in AmtSetupBinSetupGuids) { if (UUID == AmtSetupBinSetupGuids[i]) obj.fileType = (+i + 1); }
        if (obj.fileType == 0) return; // Bad header
        obj.recordChunkCount = ReadShortX(file, 16);
        obj.recordHeaderByteCount = ReadShortX(file, 18);
        obj.recordNumber = ReadIntX(file, 20);
        obj.majorVersion = file.charCodeAt(24);
        obj.minorVersion = file.charCodeAt(25);
        obj.flags = ReadShortX(file, 26);                   // Flags: 1 = Do not consume records
        var dataRecordCount = ReadIntX(file, 28);
        obj.dataRecordsConsumed = ReadIntX(file, 32);
        obj.dataRecordChunkCount = ReadShortX(file, 36);
        obj.records = [];

        var ptr = 512;
        while (ptr + 512 <= file.length) {

            // Format of a data record header:
            // RecordTypeIdentifier(4)           - identifies the type of record (in this case a data record). Record Identifiers: Invalid - 0, Data Record - 1
            // RecordFlags(4)                    - contains a set of bit flags that characterize the record.
            // RecordChunkCount(2)               - contains the number of 512-byte chunks occupied by the record including all header, body, and reserved fields.
            // RecordHeaderByteCount(2)          - indicates the length of the record header in bytes.
            // RecordNumber(4)                   - uniquely identifies the record among all records in the file, including invalid as well as valid records. The identifier is a non-negative integer.

            var r = {};
            r.typeIdentifier = ReadIntX(file, ptr);
            r.flags = ReadIntX(file, ptr + 4);              // Flags: 1 = Valid, 2 = Scrambled
            r.chunkCount = ReadShortX(file, ptr + 8);
            r.headerByteCount = ReadShortX(file, ptr + 10);
            r.number = ReadIntX(file, ptr + 12);
            r.variables = [];

            var ptr2 = 0, recbin = file.substring(ptr + 24, ptr + 512);
            if ((r.flags & 2) != 0) { recbin = AmtSetupBinDescrambleRecordData(recbin); } // De-Scramble the record
            while (1) {

                // Format of a data record entry:
                // ModuleIdentifier(2)           - identifies the target ME module for the entry.
                // VariableIdentifier(2)         - an enumeration value that identifies the variable. Variable identifiers are unique to each ModuleIdentifier.
                // VariableLength(2)             - is the length of the variable value in bytes.
                // VariableValue                 - is the value to be assigned to the variable.

                var v = {};
                v.moduleid = ReadShortX(recbin, ptr2);
                v.varid = ReadShortX(recbin, ptr2 + 2);
                if (v.moduleid == 0 || v.varid == 0) break;
                if (AmtSetupBinVarIds[v.moduleid][v.varid]) {
                    v.length = ReadShortX(recbin, ptr2 + 4);
                    v.type = AmtSetupBinVarIds[v.moduleid][v.varid][0];
                    v.desc = AmtSetupBinVarIds[v.moduleid][v.varid][1];
                    v.value = recbin.substring(ptr2 + 8, ptr2 + 8 + v.length);
                    if (v.type == 1 && v.length == 1) v.value = v.value.charCodeAt(0); // 1 byte number
                    else if (v.type == 2 && v.length == 2) v.value = ReadShortX(v.value, 0); // 2 byte number
                    else if (v.type == 3 && v.length == 4) v.value = ReadIntX(v.value, 0); // 4 byte number
                    else if (v.type == 4) v.value = guidToStr(rstr2hex(v.value)); // GUID
                    r.variables.push(v);
                }
                ptr2 += (8 + (Math.floor((v.length + 3) / 4) * 4));
            }

            // Sort the variables
            r.variables.sort(AmtSetupBinVariableCompare);

            obj.records.push(r);
            ptr += 512;
        }

        if (dataRecordCount != obj.records.length) return; // Mismatch record count
        return obj;
    }

    // Construct a Setup.bin file
    o.AmtSetupBinEncode = function (obj) {
        if (obj.fileType < 1 && obj.fileType > AmtSetupBinSetupGuids.length) return null;
        var out = [], r = AmtSetupBinSetupGuids[obj.fileType - 1], reccount = 0;

        // Get the list of modules used
        var modulesInUse = [];
        for (var i in obj.records) { var rec = obj.records[i]; for (var j in rec.variables) { var v = rec.variables[j]; if (modulesInUse.indexOf(v.moduleid) == -1) { modulesInUse.push(v.moduleid); } } }

        r += ShortToStrX(obj.recordChunkCount);
        r += ShortToStrX(42 + (modulesInUse.length * 2)); // Header is 42 bytes long + 2 bytes for each additional modules in use.
        r += IntToStrX(obj.recordNumber);
        r += String.fromCharCode(obj.majorVersion, obj.minorVersion);
        r += ShortToStrX(obj.flags); // Flags: 1 = Do not consume records
        r += IntToStrX(obj.records.length);
        r += IntToStrX(obj.dataRecordsConsumed);
        r += ShortToStrX(obj.dataRecordChunkCount);
        r += ShortToStrX(0); // Reserved
        for (var i in modulesInUse) { r += ShortToStrX(modulesInUse[i]); } // Write each module in use. Needs to be null terminated, but the padding that follows will do that.
        while (r.length < 512) { r += '\0'; } // Pad the header
        out.push(r);

        // Write each record
        for (var i in obj.records) {
            var r2 = '', rec = obj.records[i];
            r2 += IntToStrX(rec.typeIdentifier);
            r2 += IntToStrX(rec.flags);
            r2 += IntToStrX(0);                                                 // Reserved
            r2 += IntToStrX(0);                                                 // Reserved
            r2 += ShortToStrX(1);                                               // rec.chunkCount
            r2 += ShortToStrX(24);                                              // rec.headerByteCount
            r2 += IntToStrX(++reccount);

            // Sort the variables
            rec.variables.sort(AmtSetupBinVariableCompare);

            /*
            // Change variable priority
            AmtSetupBinMoveToTop(r.variables, 1, 3);                            // Manageability Feature Selection
            AmtSetupBinMoveToTop(r.variables, 1, 2);                            // New MEBx password
            AmtSetupBinMoveToTop(r.variables, 1, 1);                            // Current MEBx password
            */

            // Write each variable
            for (var j in rec.variables) {
                var r3 = '', v = rec.variables[j], data = v.value;
                v.type = AmtSetupBinVarIds[v.moduleid][v.varid][0];             // Set the correct type if not alreay connect
                if ((v.type > 0) && (v.type < 4)) {                             // If this is a numeric value, encode it correctly
                    data = parseInt(data);
                    if (v.type == 1) data = String.fromCharCode(data);
                    if (v.type == 2) data = ShortToStrX(data);
                    if (v.type == 3) data = IntToStrX(data);
                }
                if (v.type == 4) { data = hex2rstr(guidToStr(data.split('-').join('')).split('-').join('')); }
                r3 += ShortToStrX(v.moduleid);                                  // Module Identifier
                r3 += ShortToStrX(v.varid);                                     // Variable Identifier
                r3 += ShortToStrX(data.length);                                 // Variable Length
                r3 += ShortToStrX(0);                                           // Reserved
                r3 += data;                                                     // Variable Data
                while (r3.length % 4 != 0) { r3 += '\0'; }                      // Pad the variable
                r2 += r3;
            }

            while (r2.length < 512) { r2 += '\0'; }                             // Pad the record
            if ((rec.flags & 2) != 0) { r2 = r2.substring(0, 24) + AmtSetupBinScrambleRecordData(r2.substring(24)); } // Scramble the record starting at byte 24, after the header
            out.push(r2);
        }
        return out.join('');
    }

    // Used to sort variables
    function AmtSetupBinVariableCompare(a, b) {
        if (a.moduleid > b.moduleid) return 1;
        if (a.moduleid < b.moduleid) return -1;
        if (a.varid > b.varid) return 1;
        if (a.varid < b.varid) return -1;
        return 0;
    }

    // Scramble and un-scramble records
    function AmtSetupBinScrambleRecordData(data) { var out = ''; for (var i = 0; i < data.length; i++) { out += String.fromCharCode((data.charCodeAt(i) + 17) & 0xFF); } return out; }
    function AmtSetupBinDescrambleRecordData(data) { var out = ''; for (var i = 0; i < data.length; i++) { out += String.fromCharCode((data.charCodeAt(i) + 0xEF) & 0xFF); } return out; }

    // Find a moduleid/varid in the variable list, if found, move it to the top
    //function AmtSetupBinMoveToTop(variables, moduleid, varid) { var i = -1; for (var j in variables) { if ((variables[j].moduleid == moduleid) && (variables[j].varid == varid)) { i = j; } } if (i > 1) { ArrayElementMove(variables, i, 0); } }

    function ShortToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); };
    function IntToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); };
    function ReadShortX(v, p) { return (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };
    function ReadIntX(v, p) { return (v.charCodeAt(p + 3) * 0x1000000) + (v.charCodeAt(p + 2) << 16) + (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };

    return o;
};

module.exports = CreateAmtSetupBinStack;