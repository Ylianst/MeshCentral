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

function getRegistryRoots() {
    return ['HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER', 'HKEY_USERS', 'HKEY_CLASSES_ROOT', 'HKEY_CURRENT_CONFIG'];
}

function getRegistryHiveEnum(hiveName) {
    var registry = require('win-registry');
    switch (hiveName) {
        case 'HKEY_LOCAL_MACHINE': return registry.HKEY.LocalMachine;
        case 'HKEY_CURRENT_USER': return registry.HKEY.CurrentUser;
        case 'HKEY_USERS': return registry.HKEY.Users;
        case 'HKEY_CLASSES_ROOT': return registry.HKEY.ClassesRoot;
        case 'HKEY_CURRENT_CONFIG': return registry.HKEY.CurrentConfig;
        default: return null;
    }
}

function getRegistryValueName(valueName) {
    return (valueName == null) || (valueName === '') || (valueName === '(Default)') ? '' : valueName;
}

function getRegistryValueData(registry, hive, path, valueName) {
    var normalizedName = getRegistryValueName(valueName);
    var valueData = registry.QueryKey(hive, path, normalizedName);
    if (normalizedName === '' && (valueData != null) && (typeof valueData == 'object')) {
        if (Object.prototype.hasOwnProperty.call(valueData, 'default')) { return valueData.default; }
        if (Object.prototype.hasOwnProperty.call(valueData, 'subkeys') || Object.prototype.hasOwnProperty.call(valueData, 'values')) { return ''; }
    }
    return valueData;
}

function guessRegistryValueType(value) {
    if (value == null) { return 'REG_NONE'; }
    if (typeof value == 'number') { return ((Math.floor(value) === value) && (value >= 0) && (value <= 0xFFFFFFFF)) ? 'REG_DWORD' : 'REG_QWORD'; }
    if (typeof value == 'string') { return 'REG_SZ'; }
    if (Array.isArray(value)) { return 'REG_MULTI_SZ'; }
    if (Buffer.isBuffer(value) || ((typeof Uint8Array != 'undefined') && (value instanceof Uint8Array))) { return 'REG_BINARY'; }
    return 'REG_UNKNOWN';
}

function isRegistryByteArray(value) {
    return Buffer.isBuffer(value) || ((typeof Uint8Array != 'undefined') && (value instanceof Uint8Array));
}

function formatRegistryValue(value, valueType, commandValue) {
    if (valueType == 'REG_MULTI_SZ') {
        if (typeof commandValue == 'string' && commandValue != '') {
            return commandValue.replace(/\\0+$/, '').replace(/\\0/g, '\r\n');
        }
        if (Array.isArray(value)) { return value.join('\r\n'); }
        if (isRegistryByteArray(value)) {
            var text = '';
            for (var i = 0; i + 1 < value.length; i += 2) { text += String.fromCharCode(value[i] | (value[i + 1] << 8)); }
            return text.replace(/\u0000+$/, '').split('\u0000').join('\r\n');
        }
    }
    if (valueType == 'REG_QWORD') {
        var qwordHex = null;
        if (isRegistryByteArray(value) && (value.length >= 8)) {
            qwordHex = '';
            for (var i = 7; i >= 0; i--) {
                var byteHex = value[i].toString(16);
                qwordHex += (byteHex.length == 1) ? ('0' + byteHex) : byteHex;
            }
        } else if (typeof commandValue == 'string') {
            var qwordMatch = commandValue.match(/^(?:0x)?[0-9a-fA-F]+$/);
            if (qwordMatch != null) { qwordHex = commandValue.replace(/^0x/i, '').toLowerCase(); }
        } else if (typeof value == 'number' && isFinite(value) && Math.floor(value) == value) {
            qwordHex = value.toString(16);
        }
        if (qwordHex != null) {
            while (qwordHex.length < 16) { qwordHex = '0' + qwordHex; }
            var decimal = '0';
            for (var j = 0; j < qwordHex.length; j++) {
                var digit = parseInt(qwordHex.charAt(j), 16), carry = digit;
                for (var k = decimal.length - 1; k >= 0; k--) {
                    var product = (parseInt(decimal.charAt(k), 10) * 16) + carry;
                    decimal = decimal.substring(0, k) + (product % 10) + decimal.substring(k + 1);
                    carry = Math.floor(product / 10);
                }
                if (carry > 0) { decimal = carry + decimal; }
            }
            return decimal.replace(/^0+(?=\d)/, '');
        }
    }
    if (value == null) { return ''; }
    if (typeof value == 'object') {
        try { return JSON.stringify(value); } catch (ex) { return String(value); }
    }
    return String(value);
}

function getRegistryValueCommandInfo(hiveName, path, valueName) {
    valueName = getRegistryValueName(valueName);
    var fullPath = hiveName + (((path != null) && (path !== '')) ? ('\\' + path) : '');
    var args = ['query', fullPath];
    if ((valueName == null) || (valueName === '')) { args.push('/ve'); } else { args.push('/v', valueName); }
    var output = runRegistryCommand(args, true);
    if (typeof output != 'string') { return null; }
    var lines = output.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if ((line == '') || (line.indexOf('HKEY_') == 0)) { continue; }
        var match = line.match(/\b(REG_[A-Z0-9_]+)(?:\s+(.*))?$/);
        if (match != null) { return { type: match[1], value: match[2] || '' }; }
    }
    return null;
}

function getRegistryValueType(hiveName, path, valueName, fallbackValue) {
    try {
        var info = getRegistryValueCommandInfo(hiveName, path, valueName);
        if (info != null) { return info.type; }
    } catch (ex) { }
    return guessRegistryValueType(fallbackValue);
}

function listRegistryKey(hiveName, path) {
    var registry = require('win-registry');
    var hive = getRegistryHiveEnum(hiveName);
    if (hive == null) { throw ('Unknown registry hive: ' + hiveName); }

    var result = registry.QueryKey(hive, path);
    if (result == null) { return { hive: hiveName, path: path, subkeys: [], values: [] }; }

    var response = { hive: hiveName, path: path, subkeys: (result.subkeys || []), values: [] };
    var valueNames = [], valueNameSet = Object.create(null);
    for (var i = 0; i < (result.values || []).length; i++) {
        var listedValueName = getRegistryValueName(result.values[i]);
        if (valueNameSet[listedValueName] == null) {
            valueNameSet[listedValueName] = true;
            valueNames.push(listedValueName);
        }
    }
    if (valueNameSet[''] == null) {
        valueNameSet[''] = true;
        valueNames.push('');
    }
    for (var i = 0; i < valueNames.length; i++) {
        var valueName = getRegistryValueName(valueNames[i]), valueData = null, valueText = '', valueType = 'REG_UNKNOWN';
        try { valueData = getRegistryValueData(registry, hive, path, valueName); } catch (ex) { valueData = null; }
        valueType = getRegistryValueType(hiveName, path, valueName, valueData);
        var commandValue = '';
        if ((valueType == 'REG_MULTI_SZ') || (valueType == 'REG_QWORD')) {
            try {
                var commandInfo = getRegistryValueCommandInfo(hiveName, path, valueName);
                if (commandInfo != null) { commandValue = commandInfo.value; }
            } catch (ex) { }
        }
        valueText = formatRegistryValue(valueData, valueType, commandValue);
        response.values.push({ name: ((valueName === '') ? '(Default)' : valueName), rawname: valueName, type: valueType, value: valueText });
    }
    return response;
}

function getRegistryFullPath(hiveName, path) {
    return hiveName + (((path != null) && (path !== '')) ? ('\\' + path) : '');
}

function getRegistryExecutableCandidates() {
    return ['C:\\Windows\\Sysnative\\reg.exe', 'C:\\Windows\\System32\\reg.exe', 'C:\\WINNT\\System32\\reg.exe'];
}

// MeshAgent builds a Windows command line from this array, so arguments containing
// whitespace or quotes must be escaped explicitly.
function quoteRegistryArgument(value) {
    var arg = String(value);
    if ((arg.length > 0) && (/[\s"]/.test(arg) == false)) { return arg; }
    return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

function getRegistryCommandText(executable, execArgs) {
    return quoteRegistryArgument(executable) + ' ' + execArgs.slice(1).join(' ');
}

function getRegistryCommandError(message, executable, execArgs) {
    return message + '\r\nCommand: ' + getRegistryCommandText(executable, execArgs);
}

function runRegistryCommand(args, returnOutput) {
    var fs = require('fs');
    var child = null, childProcess = require('child_process'), lastExecError = null, executable = null, candidates = getRegistryExecutableCandidates(), execArgs = ['reg.exe'];
    for (var i = 0; i < args.length; i++) { execArgs.push(quoteRegistryArgument(args[i])); }
    for (var i = 0; i < candidates.length; i++) {
        executable = candidates[i];
        if ((executable.indexOf('\\') >= 0) && (fs.existsSync(executable) == false)) { continue; }
        try {
            child = childProcess.execFile(executable, execArgs);
            break;
        } catch (ex) {
            lastExecError = ex;
            child = null;
        }
    }
    if (child == null) {
        if (lastExecError != null) { throw (getRegistryCommandError('child_process.execFile(): Could not exec [' + candidates.join(', ') + '] (' + lastExecError + ')', executable || candidates[0], execArgs)); }
        throw (getRegistryCommandError('child_process.execFile(): Could not exec [' + candidates.join(', ') + ']', executable || candidates[0], execArgs));
    }
    child.stdout.str = '';
    child.stderr.str = '';
    child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
    child.stderr.on('data', function (chunk) { this.str += chunk.toString(); });
    child.waitExit();
    if ((child.exitCode != null) && (child.exitCode !== 0)) {
        if ((child.stderr.str != null) && (child.stderr.str.trim() != '')) { throw (getRegistryCommandError(child.stderr.str.trim(), executable, execArgs)); }
        if ((child.stdout.str != null) && (child.stdout.str.trim() != '')) { throw (getRegistryCommandError(child.stdout.str.trim(), executable, execArgs)); }
        throw (getRegistryCommandError('Registry command failed with exit code ' + child.exitCode + '.', executable, execArgs));
    }
    if ((child.stderr.str != null) && (child.stderr.str.trim() != '')) { throw (getRegistryCommandError(child.stderr.str.trim(), executable, execArgs)); }
    if (returnOutput === true) { return child.stdout.str || ''; }
    return child.stdout.str || '';
}

function createRegistrySubKey(hiveName, path, keyName) {
    if ((keyName == null) || (keyName === '')) { throw ('Registry key name is required.'); }
    if (keyName.indexOf('\\') >= 0) { throw ('Registry key name cannot contain backslashes.'); }
    runRegistryCommand(['add', getRegistryFullPath(hiveName, ((path != null) && (path !== '')) ? (path + '\\' + keyName) : keyName), '/f']);
}

function deleteRegistryEntries(items) {
    if ((items == null) || (items.length == 0)) { throw ('Nothing selected for deletion.'); }
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if ((item == null) || (item.hive == null)) { continue; }
        if (item.kind == 'key') {
            runRegistryCommand(['delete', getRegistryFullPath(item.hive, ((item.path != null) && (item.path !== '')) ? (item.path + '\\' + item.name) : item.name), '/f']);
        } else if (item.kind == 'value') {
            var args = ['delete', getRegistryFullPath(item.hive, item.path || '')];
            var valueName = getRegistryValueName(item.name);
            if (valueName === '') { args.push('/ve'); } else { args.push('/v', valueName); }
            args.push('/f');
            runRegistryCommand(args);
        } else {
            throw ('Deleting registry hives is not allowed.');
        }
    }
}

function setRegistryValue(hiveName, path, valueName, valueType, valueData) {
    valueName = getRegistryValueName(valueName);
    if ((valueType == null) || (valueType === '')) { throw ('Registry value type is required.'); }
    valueType = valueType.toUpperCase();
    if ((valueType == 'REG_DWORD') || (valueType == 'REG_QWORD')) {
        if ((typeof valueData != 'string') || (/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(valueData.trim()) == false)) { throw ('Only decimal or 0x-prefixed numeric data is supported for ' + valueType + '.'); }
        valueData = valueData.trim();
    } else if (valueType == 'REG_MULTI_SZ') {
        var multiLines = String(valueData == null ? '' : valueData).split(/\r\n|\r|\n/), multiValue = [];
        for (var i = 0; i < multiLines.length; i++) {
            if (multiLines[i].trim() != '') { multiValue.push(multiLines[i]); }
        }
        valueData = multiValue.join('\\0');
        if (valueData.slice(-2) != '\\0') { valueData += '\\0'; }
    } else if (valueData == null) {
        valueData = '';
    } else {
        valueData = String(valueData);
    }
    var args = ['add', getRegistryFullPath(hiveName, path || '')];
    if ((valueName == null) || (valueName === '')) { args.push('/ve'); } else { args.push('/v', valueName); }
    args.push('/t', valueType, '/d', valueData, '/f');
    runRegistryCommand(args);
}

function renameRegistryEntry(item, newName) {
    if ((item == null) || (item.hive == null)) { throw ('Nothing selected for rename.'); }
    if ((newName == null) || (newName === '')) { throw ('A new registry name is required.'); }
    if (newName.indexOf('\\') >= 0) { throw ('Registry names cannot contain backslashes.'); }
    if (item.kind == 'key') {
        var oldKeyPath = ((item.path != null) && (item.path !== '')) ? (item.path + '\\' + item.name) : item.name;
        var newKeyPath = ((item.path != null) && (item.path !== '')) ? (item.path + '\\' + newName) : newName;
        runRegistryCommand(['copy', getRegistryFullPath(item.hive, oldKeyPath), getRegistryFullPath(item.hive, newKeyPath), '/s', '/f']);
        runRegistryCommand(['delete', getRegistryFullPath(item.hive, oldKeyPath), '/f']);
        return;
    }
    if (item.kind == 'value') {
        if ((item.name == null) || (item.name === '')) { throw ('The default registry value cannot be renamed in this increment.'); }
        var hive = getRegistryHiveEnum(item.hive), valueData = null, valueType = 'REG_UNKNOWN';
        if (hive == null) { throw ('Unknown registry hive: ' + item.hive); }
        try { valueData = getRegistryValueData(require('win-registry'), hive, item.path || '', item.name); } catch (ex) { valueData = null; }
        valueType = getRegistryValueType(item.hive, item.path || '', item.name, valueData);
        setRegistryValue(item.hive, item.path || '', newName, valueType, valueData);
        deleteRegistryEntries([{ kind: 'value', hive: item.hive, path: item.path || '', name: item.name }]);
        return;
    }
    throw ('Registry hives cannot be renamed.');
}

// reg.exe writes .reg files as UTF-16LE with a BOM, the agent has no utf16 decoder.
// Decode in chunks, a per-char string concat would be O(n^2) on a large export (HKLM\SOFTWARE is tens of MB).
function utf16leToString(buf) {
    var start = ((buf.length > 1) && (buf[0] == 0xFF) && (buf[1] == 0xFE)) ? 2 : 0;
    var parts = [], chunk = [];
    for (var i = start; (i + 1) < buf.length; i += 2) {
        chunk.push(buf[i] + (buf[i + 1] * 256));
        if (chunk.length == 8192) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
    }
    if (chunk.length > 0) { parts.push(String.fromCharCode.apply(null, chunk)); }
    return parts.join('');
}

function exportRegistryKey(hiveName, path) {
    if ((path == null) || (path === '')) { throw ('Select a registry key to export.'); }
    var fs = require('fs');
    // Write to the agent folder, not to a shared temp folder, the export can hold sensitive keys
    var tmpFolder = (process.cwd() != '//') ? process.cwd() : ((process.env['ProgramData'] || 'C:\\ProgramData') + '\\MeshAgent\\');
    if (tmpFolder.charAt(tmpFolder.length - 1) != '\\') { tmpFolder += '\\'; }
    var tmpFile = tmpFolder + 'mesh-registry-export-' + Date.now() + '.reg';
    try {
        runRegistryCommand(['export', getRegistryFullPath(hiveName, path), tmpFile, '/y']);
        return utf16leToString(fs.readFileSync(tmpFile));
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (ex) { }
    }
}

module.exports = {
    getRoots: getRegistryRoots,
    listKey: listRegistryKey,
    createSubKey: createRegistrySubKey,
    deleteEntries: deleteRegistryEntries,
    setValue: setRegistryValue,
    renameEntry: renameRegistryEntry,
    exportKey: exportRegistryKey
};
