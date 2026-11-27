/*
Copyright 2026

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

//
// Installs and removes the remote printer with the Windows print spooler API (winspool.drv), without PowerShell.
// Used by remote-printer.js. Windows 10 1607 and later.
//
// Structure layouts, checked against the Windows SDK headers for 32 and 64 bit:
//   PRINTER_INFO_2W: 13 pointers (pServerName, pPrinterName, pShareName, pPortName, pDriverName, pComment, pLocation,
//     pDevMode, pSepFile, pPrintProcessor, pDatatype, pParameters, pSecurityDescriptor), then 8 DWORDs (Attributes,
//     Priority, DefaultPriority, StartTime, UntilTime, Status, cJobs, AveragePPM). 136 bytes on 64 bit, 84 on 32 bit.
//   PRINTER_DEFAULTSW: pDatatype, pDevMode, DesiredAccess.
//   PORT_INFO_1W: pName.
//   PORT_DATA_1 (tcpxcv.h): 964 bytes, no pointers. DELETE_PORT_DATA_1: 236 bytes, no pointers.
//

var fs = require('fs');

var PRINTER_ENUM_LOCAL = 2;
var PRINTER_ALL_ACCESS = 0xF000C;
var SERVER_ACCESS_ADMINISTER = 1;
var PRINTER_CONTROL_PURGE = 3;
var PRINTER_STATUS_PENDING_DELETION = 4;
var PRINTER_ATTRIBUTE_LOCAL = 0x40;
var ERROR_FILE_NOT_FOUND = 2;
var ERROR_UNKNOWN_PRINTER_DRIVER = 1797;
var TCP_MONITOR = 'Standard TCP/IP Port';
var PDF_FEATURE = 'Printing-PrintToPDFServices-Features';
var DISM_TIMEOUT = 3 * 60 * 1000;

var GM = null, P = 0, winspool = null, kernel32 = null;
var children = []; // Keep a reference on running child processes

function init() {
    if (GM != null) return;
    GM = require('_GenericMarshal');
    P = GM.PointerSize;
    winspool = GM.CreateNativeProxy('winspool.drv');
    winspool.CreateMethod('OpenPrinterW');
    winspool.CreateMethod('ClosePrinter');
    winspool.CreateMethod('AddPrinterW');
    winspool.CreateMethod('DeletePrinter');
    winspool.CreateMethod('SetPrinterW');
    winspool.CreateMethod('EnumPrintersW');
    winspool.CreateMethod('EnumPortsW');
    winspool.CreateMethod('XcvDataW');
    kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('FormatMessageW');
}

// Error with the Windows error code and its message
function winError(what, code) {
    var text = '';
    try {
        var buf = GM.CreateVariable(2048);
        if (kernel32.FormatMessageW(0x1200, 0, code, 0, buf, 1024, 0).Val != 0) { text = buf.Deref(0, 0).Wide2UTF8.trim(); } // FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, read up to the null
    } catch (ex) { }
    var err = new Error(what + ' failed, Windows error ' + code + (text ? (': ' + text) : ''));
    err.code = code;
    return err;
}

// True if the error is the Windows error code, also as an HRESULT (0x8007xxxx)
function isError(err, code) { return (err != null) && ((err.code == code) || (((err.code >>> 16) == 0x8007) && ((err.code & 0xFFFF) == code))); }

function wide(str) { return GM.CreateVariable(str, { wide: true }); }
function readUInt32(variable) { return variable.toBuffer().readUInt32LE(0); }

// True if a pointer value, such as a returned handle, is NULL. Val is cut to 32 bits, so check all the bytes.
function isNull(variable) {
    var b = variable.pointerBuffer();
    for (var i = 0; i < b.length; i++) { if (b[i] != 0) return false; }
    return true;
}

// String pointed to by the pointer at the given offset of a structure, or null
function readString(struct, offset) {
    var ptr = struct.Deref(offset, P);
    var b = ptr.toBuffer();
    var zero = true;
    for (var i = 0; i < b.length; i++) { if (b[i] != 0) { zero = false; break; } }
    return zero ? null : ptr.Deref().Wide2UTF8;
}

// Write a string into a fixed size WCHAR array of a structure, always null terminated
function writeWideArray(buffer, offset, str, maxChars) {
    for (var i = 0; (i < str.length) && (i < maxChars - 1); i++) { buffer.writeUInt16LE(str.charCodeAt(i), offset + (i * 2)); }
}

// Call an Enum function twice, first to get the needed size. Returns { buffer, count }.
function enumerate(what, call) {
    var needed = GM.CreateVariable(4), count = GM.CreateVariable(4);
    call(0, 0, needed, count); // Fails with ERROR_INSUFFICIENT_BUFFER and sets the needed size
    var size = readUInt32(needed);
    if (size == 0) return { buffer: null, count: 0 };
    var buffer = GM.CreateVariable(size);
    var r = call(buffer, size, needed, count);
    if (r.Val == 0) { throw winError(what, r._LastError); }
    return { buffer: buffer, count: readUInt32(count) };
}

// Local printers: [{ name, port, status }]
function getPrinters() {
    init();
    var size = (13 * P) + 32;
    var e = enumerate('EnumPrinters', function (buf, len, needed, count) { return winspool.EnumPrintersW(PRINTER_ENUM_LOCAL, 0, 2, buf, len, needed, count); });
    var printers = [];
    for (var i = 0; i < e.count; i++) {
        var item = e.buffer.Deref(i * size, size);
        var dwords = item.Deref(13 * P, 32).toBuffer(); // Status is the 6th DWORD
        printers.push({ name: readString(item, P), port: readString(item, 3 * P), status: dwords.readUInt32LE(20) });
    }
    return printers;
}

function getPorts() {
    init();
    var e = enumerate('EnumPorts', function (buf, len, needed, count) { return winspool.EnumPortsW(0, 1, buf, len, needed, count); });
    var ports = [];
    for (var i = 0; i < e.count; i++) { ports.push(readString(e.buffer.Deref(i * P, P), 0)); }
    return ports;
}

function findPrinter(name) {
    var printers = getPrinters();
    for (var i in printers) { if ((printers[i].name != null) && (printers[i].name.toLowerCase() == name.toLowerCase())) return printers[i]; }
    return null;
}

// Open a printer, or an XcvMonitor with ",XcvMonitor <name>"
function openPrinter(name, access) {
    var handle = GM.CreatePointer();
    var defaults = GM.CreateVariable((2 * P) + 4 + ((P == 8) ? 4 : 0));
    defaults.toBuffer().writeUInt32LE(access, 2 * P); // DesiredAccess
    var r = winspool.OpenPrinterW(wide(name), handle, defaults);
    if (r.Val == 0) { throw winError('OpenPrinter "' + name + '"', r._LastError); }
    return handle.Deref();
}

// Send a command to the Standard TCP/IP port monitor
function tcpMonitorCommand(command, data, size) {
    var h = openPrinter(',XcvMonitor ' + TCP_MONITOR, SERVER_ACCESS_ADMINISTER);
    try {
        var needed = GM.CreateVariable(4), status = GM.CreateVariable(4);
        var r = winspool.XcvDataW(h, wide(command), data, size, 0, 0, needed, status);
        if (r.Val == 0) { throw winError(command, r._LastError); }
        if (readUInt32(status) != 0) { throw winError(command, readUInt32(status)); }
    } finally {
        winspool.ClosePrinter(h);
    }
}

// Add a Standard TCP/IP port sending RAW data to 127.0.0.1:port, without SNMP
function addTcpPort(portName, port) {
    var data = GM.CreateVariable(964), b = data.toBuffer(); // PORT_DATA_1
    writeWideArray(b, 0, portName, 64);         // sztPortName
    b.writeUInt32LE(1, 128);                    // dwVersion
    b.writeUInt32LE(1, 132);                    // dwProtocol, PROTOCOL_RAWTCP_TYPE
    b.writeUInt32LE(964, 136);                  // cbSize
    writeWideArray(b, 144, '127.0.0.1', 49);    // sztHostAddress
    writeWideArray(b, 242, 'public', 33);       // sztSNMPCommunity
    b.writeUInt32LE(port, 952);                 // dwPortNumber
    b.writeUInt32LE(0, 956);                    // dwSNMPEnabled
    b.writeUInt32LE(1, 960);                    // dwSNMPDevIndex
    tcpMonitorCommand('AddPort', data, 964);
}

function deleteTcpPort(portName) {
    var data = GM.CreateVariable(236), b = data.toBuffer(); // DELETE_PORT_DATA_1
    writeWideArray(b, 0, portName, 64);         // psztPortName
    b.writeUInt32LE(1, 228);                    // dwVersion
    tcpMonitorCommand('DeletePort', data, 236);
}

function addPrinter(name, portName, driver) {
    var info = GM.CreateVariable((13 * P) + 32), b = info.toBuffer(); // PRINTER_INFO_2W
    var strings = [wide(name), wide(portName), wide(driver), wide('winprint')]; // Keep a reference while the call runs
    strings[0].pointerBuffer().copy(b, 1 * P);  // pPrinterName
    strings[1].pointerBuffer().copy(b, 3 * P);  // pPortName
    strings[2].pointerBuffer().copy(b, 4 * P);  // pDriverName
    strings[3].pointerBuffer().copy(b, 9 * P);  // pPrintProcessor, pDatatype is left NULL for the driver's default
    b.writeUInt32LE(PRINTER_ATTRIBUTE_LOCAL, 13 * P); // Attributes
    var h = winspool.AddPrinterW(0, 2, info);
    if (isNull(h)) { throw winError('AddPrinter', h._LastError); }
    winspool.ClosePrinter(h);
}

// Cancel the printer's jobs and delete it. Windows deletes it once it's no longer in use.
function deletePrinter(name) {
    var h = openPrinter(name, PRINTER_ALL_ACCESS);
    try {
        winspool.SetPrinterW(h, 0, 0, PRINTER_CONTROL_PURGE);
        var r = winspool.DeletePrinter(h);
        if (r.Val == 0) { throw winError('DeletePrinter "' + name + '"', r._LastError); }
    } finally {
        winspool.ClosePrinter(h);
    }
}

// setTimeout() that keeps a reference on the timer until it fires. Some MeshAgent builds drop timers nothing references.
var pendingTimers = [];
function later(func, delay) {
    var timer = setTimeout(function () { var i = pendingTimers.indexOf(timer); if (i >= 0) { pendingTimers.splice(i, 1); } func(); }, delay);
    pendingTimers.push(timer);
    return timer;
}

// Poll until test() returns true, or the time runs out. func(true if test passed)
function waitFor(test, intervalMs, maxMs, func) {
    var start = Date.now();
    var check = function () {
        var ok = false;
        try { ok = test(); } catch (ex) { }
        if (ok) { func(true); return; }
        if ((Date.now() - start) >= maxMs) { func(false); return; }
        later(check, intervalMs);
    };
    check();
}

function getSystemExe(name) {
    var root = process.env['SystemRoot'] || 'C:\\Windows';
    var sysnative = root + '\\Sysnative\\' + name; // 64-bit tools from a 32-bit agent
    try { if (fs.existsSync(sysnative)) return sysnative; } catch (ex) { }
    return root + '\\System32\\' + name;
}

// Let only SYSTEM and Administrators use the folder: remove the permissions it inherits, for example read access for
// all users from Program Files, func(err). Uses the well-known SIDs, so it works with any Windows language.
function restrictFolder(path, func) {
    // MeshAgent builds the command line from the arguments without quoting them, so quote the path
    var child = require('child_process').execFile(getSystemExe('icacls.exe'), ['icacls', '"' + path + '"', '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q']);
    children.push(child);
    var done = false, output = '';
    var finish = function (code) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (ex) { } }
        var i = children.indexOf(child); if (i >= 0) { children.splice(i, 1); }
        func((code == 0) ? null : ('icacls exit code ' + code + (output ? (': ' + output.trim()) : '')));
    };
    var timer = setTimeout(function () { timer = null; try { child.kill(); } catch (ex) { } finish(-1); }, 60000);
    child.stdout.on('data', function (c) { output += c.toString(); });
    child.stderr.on('data', function (c) { output += c.toString(); });
    child.on('exit', function (code) { finish(code); });
}

// Run dism.exe, func(exitCode). 3010 means a restart is needed.
function runDism(args, func) {
    var child = require('child_process').execFile(getSystemExe('dism.exe'), ['dism'].concat(args));
    children.push(child);
    var done = false;
    var finish = function (code) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (ex) { } } // MeshAgent's clearTimeout() throws on a timer that already fired
        var i = children.indexOf(child); if (i >= 0) { children.splice(i, 1); }
        func(code);
    };
    var timer = setTimeout(function () { timer = null; try { child.kill(); } catch (ex) { } finish(-1); }, DISM_TIMEOUT);
    child.stdout.on('data', function () { });
    child.stderr.on('data', function () { });
    child.on('exit', function (code) { finish(code); });
}

// On Windows 10 LTSC the "Microsoft Print To PDF" driver can stay registered from a driver package an update removed, so no new
// printer can be added with it (ERROR_FILE_NOT_FOUND). Turning the "Microsoft Print to PDF" feature off and on registers it again.
// Windows' own "Microsoft Print to PDF" printer is removed and added back. func(err)
function repairPdfDriver(func) {
    runDism(['/Online', '/Disable-Feature', '/FeatureName:' + PDF_FEATURE, '/NoRestart', '/Quiet'], function (code1) {
        runDism(['/Online', '/Enable-Feature', '/FeatureName:' + PDF_FEATURE, '/NoRestart', '/Quiet'], function (code2) {
            if ((code2 != 0) && (code2 != 3010)) { func('Turning the "Microsoft Print to PDF" Windows feature back on failed (dism exit code ' + code2 + '), turn it on again in Windows Features'); return; }
            func(null, (code1 == 3010) || (code2 == 3010));
        });
    });
}

// Install the printer on portName, the port is added if needed. ourPorts lists the ports of this agent: portName and the one
// it used before, if the port changed. Only printers on those ports are changed: another agent on the same device can have
// a printer on another MeshCentralPrint port. onStep(text) reports each step as it starts, func(err)
function install(name, portName, port, driver, ourPorts, onStep, func) {
    var step = '';
    var setStep = function (text) { step = text; try { onStep(text); } catch (ex) { } };
    var fail = function (err) { func(step + ': ' + ((err && err.message) ? err.message : String(err))); };
    try {
        init();
        setStep('Checking the printer name');
        var printers = getPrinters();
        for (var i in printers) {
            if ((printers[i].name != null) && (printers[i].name.toLowerCase() == name.toLowerCase()) && (ourPorts.indexOf(printers[i].port) < 0)) { fail('A printer with this name already exists: ' + name); return; }
        }

        // Remove printers left by an earlier run with another name or port, don't fail the install if one can't be removed
        for (var i in printers) {
            var p = printers[i];
            if ((p.name != null) && (ourPorts.indexOf(p.port) >= 0) && ((p.name.toLowerCase() != name.toLowerCase()) || (p.port != portName))) {
                setStep('Removing the previous printer: ' + p.name);
                try { deletePrinter(p.name); } catch (ex) { onStep('Unable to remove ' + p.name + ': ' + ex.message); }
            }
        }

        if (getPorts().indexOf(portName) < 0) {
            setStep('Adding the printer port');
            addTcpPort(portName, port);
        }
    } catch (ex) { fail(ex); return; }

    // Windows can take a few seconds to delete a printer, it's listed as pending deletion meanwhile and can't be added again
    var pending = null;
    try { pending = findPrinter(name); } catch (ex) { }
    if ((pending != null) && ((pending.status & PRINTER_STATUS_PENDING_DELETION) != 0)) { setStep('Waiting for Windows to remove the previous printer'); }
    waitFor(function () { var p = findPrinter(name); return (p == null) || ((p.status & PRINTER_STATUS_PENDING_DELETION) == 0); }, 500, 20000, function () {
        var add = function (repaired) {
            try {
                if (findPrinter(name) == null) {
                    setStep('Adding the printer');
                    addPrinter(name, portName, driver);
                } else {
                    setStep('The printer is already installed');
                }
            } catch (ex) {
                if (isError(ex, ERROR_FILE_NOT_FOUND) && (repaired !== true)) {
                    setStep('Repairing the Microsoft Print to PDF driver, its driver package is missing');
                    repairPdfDriver(function (err, restartNeeded) {
                        if (err != null) { fail(err); return; }
                        if (restartNeeded) { onStep('Windows says a restart is needed to finish repairing the driver'); }
                        setStep('Adding the printer after repairing the driver');
                        add(true);
                    });
                    return;
                }
                if (isError(ex, ERROR_UNKNOWN_PRINTER_DRIVER)) { fail('Printer driver not found: ' + driver + '. Turn on the "Microsoft Print to PDF" Windows feature, it is included in Windows 10 and later.'); return; }
                if (isError(ex, ERROR_FILE_NOT_FOUND)) { ex.message += '. The Microsoft Print to PDF driver is still damaged after turning the Windows feature off and on, restart the device and try again.'; }
                fail(ex);
                return;
            }

            // The printer can take a moment to be listed
            setStep('Checking the printer');
            waitFor(function () { return findPrinter(name) != null; }, 500, 5000, function (listed) {
                var p = null;
                try { p = findPrinter(name); } catch (ex) { }
                if (!listed || (p == null)) { fail('The printer is not listed after adding it'); return; }
                if ((p.status & PRINTER_STATUS_PENDING_DELETION) != 0) { fail('Windows is still removing the previous printer, try again in a few seconds'); return; }
                func(null);
            });
        };
        add(false);
    });
}

// Remove the printers on the given ports, then the ports. Only the exact port names: another agent on the same device can
// have a printer on another MeshCentralPrint port. func(err), err when a printer couldn't be removed.
function uninstall(portNames, func) {
    var error = null;
    try {
        init();
        var printers = getPrinters();
        for (var i in printers) { if ((printers[i].name != null) && (portNames.indexOf(printers[i].port) >= 0)) { try { deletePrinter(printers[i].name); } catch (ex) { error = ex.message; } } }
    } catch (ex) { error = ex.message; }
    // The port can only be deleted once no printer uses it
    later(function () {
        try {
            var ports = getPorts();
            for (var i in ports) { if (portNames.indexOf(ports[i]) >= 0) { try { deleteTcpPort(ports[i]); } catch (ex) { } } }
        } catch (ex) { }
        func(error);
    }, 1000);
}

module.exports = { install: install, uninstall: uninstall, restrictFolder: restrictFolder };
