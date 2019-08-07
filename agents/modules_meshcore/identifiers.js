/*
Copyright 2019 Intel Corporation

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

function trimIdentifiers(val)
{
    for(var v in val)
    {
        if (!val[v] || val[v] == 'None' || val[v] == '') { delete val[v]; }
    }
}

function linux_identifiers()
{
    var identifiers = {};
    var ret = {};
    var values = {};
    if (!require('fs').existsSync('/sys/class/dmi/id')) { throw ('this platform does not have DMI statistics'); }
    var entries = require('fs').readdirSync('/sys/class/dmi/id');
    for(var i in entries)
    {
        if (require('fs').statSync('/sys/class/dmi/id/' + entries[i]).isFile())
        {
            ret[entries[i]] = require('fs').readFileSync('/sys/class/dmi/id/' + entries[i]).toString().trim();

            if (ret[entries[i]] == 'None') { delete ret[entries[i]];}
        }
    }
    identifiers['bios_date'] = ret['bios_date'];
    identifiers['bios_vendor'] = ret['bios_vendor'];
    identifiers['bios_version'] = ret['bios_version'];
    identifiers['board_name'] = ret['board_name'];
    identifiers['board_serial'] = ret['board_serial'];
    identifiers['board_vendor'] = ret['board_vendor'];
    identifiers['board_version'] = ret['board_version'];
    identifiers['product_uuid'] = ret['product_uuid'];

    values.identifiers = identifiers;
    values.linux = ret;
    trimIdentifiers(values.identifiers);
    return (values);
}

function windows_wmic_results(str)
{
    var lines = str.trim().split('\r\n');
    var keys = lines[0].split(',');
    var i, key, keyval;
    var tokens;
    var result = [];

    for (i = 1; i < lines.length; ++i)
    {
        var obj = {};
        tokens = lines[i].split(',');
        for (key = 0; key < keys.length; ++key)
        {
            if (tokens[key].trim())
            {
                obj[keys[key].trim()] = tokens[key].trim();
            }
        }
        result.push(obj);
    }
    return (result);
}


function windows_identifiers()
{
    var ret = { windows: {}}; values = {}; var items; var i; var item;
    var child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'bios', 'get', '/VALUE']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    var items = child.stdout.str.split('\r\r\n');
    for(i in items)
    {
        item = items[i].split('=');
        values[item[0]] = item[1];
    }

    ret['identifiers'] = {};
    ret['identifiers']['bios_date'] = values['ReleaseDate'];
    ret['identifiers']['bios_vendor'] = values['Manufacturer'];
    ret['identifiers']['bios_version'] = values['SMBIOSBIOSVersion'];

    child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'BASEBOARD', 'get', '/VALUE']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    var items = child.stdout.str.split('\r\r\n');
    for (i in items)
    {
        item = items[i].split('=');
        values[item[0]] = item[1];
    }
    ret['identifiers']['board_name'] = values['Product'];
    ret['identifiers']['board_serial'] = values['SerialNumber'];
    ret['identifiers']['board_vendor'] = values['Manufacturer'];
    ret['identifiers']['board_version'] = values['Version'];

    child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'CSProduct', 'get', '/VALUE']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();

    var items = child.stdout.str.split('\r\r\n');
    for (i in items)
    {
        item = items[i].split('=');
        values[item[0]] = item[1];
    }
    ret['identifiers']['product_uuid'] = values['UUID'];
    trimIdentifiers(ret.identifiers);

    child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'MEMORYCHIP', 'LIST', '/FORMAT:CSV']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();
    ret.windows.memory = windows_wmic_results(child.stdout.str);

    child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'OS', 'GET', '/FORMAT:CSV']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();
    ret.windows.osinfo = windows_wmic_results(child.stdout.str)[0];

    child = require('child_process').execFile(process.env['windir'] + '\\System32\\wbem\\wmic.exe', ['wmic', 'PARTITION', 'LIST', '/FORMAT:CSV']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();
    ret.windows.partitions = windows_wmic_results(child.stdout.str);

    return (ret);
}
function macos_identifiers()
{
    var ret = { identifiers: {} };
    var child;

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep board-id | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_name = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_serial = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep manufacturer | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_vendor = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep version | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.board_version = child.stdout.str.trim();

    child = require('child_process').execFile('/bin/sh', ['sh']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stdin.write('ioreg -d2 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk -F= \'{ split($2, res, "\\""); print res[2]; }\'\nexit\n');
    child.waitExit();
    ret.identifiers.product_uuid = child.stdout.str.trim();

    trimIdentifiers(ret.identifiers);
    return (ret);
}

switch(process.platform)
{
    case 'linux':
        module.exports = { _ObjectID: 'identifiers', get: linux_identifiers };
        break;
    case 'win32':
        module.exports = { _ObjectID: 'identifiers', get: windows_identifiers };
        break;
    case 'darwin':
        module.exports = { _ObjectID: 'identifiers', get: macos_identifiers };
        break;
    default:
        module.exports = { get: function () { throw ('Unsupported Platform'); } };
        break;
}


// bios_date = BIOS->ReleaseDate
// bios_vendor = BIOS->Manufacturer
// bios_version = BIOS->SMBIOSBIOSVersion
// board_name = BASEBOARD->Product = ioreg/board-id
// board_serial = BASEBOARD->SerialNumber = ioreg/serial-number | ioreg/IOPlatformSerialNumber
// board_vendor = BASEBOARD->Manufacturer = ioreg/manufacturer
// board_version = BASEBOARD->Version

