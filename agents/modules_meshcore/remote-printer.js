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
// Remote printing. Installs a virtual printer on this device whose output is captured by the agent.
// The printer is pointed at a raw TCP socket on 127.0.0.1 that this module listens on, every connection
// is one print job. The job is saved to disk and handed to the caller so it can be downloaded by the user.
//
// Windows: "Microsoft Print To PDF" driver on a Standard TCP/IP port, the spooler sends the PDF to us.
// Linux:   CUPS queue with a PPD that converts to PDF, using the "socket://" backend.
//

var fs = require('fs');

var PORT_PREFIX = 'MeshCentralPrint';               // Windows printer port name prefix, used to find our printers
var DEFAULT_PRINTER_NAME = 'MeshCentral Printer';
var DEFAULT_TCP_PORT = 35500;
var MAX_JOB_SIZE = 256 * 1024 * 1024;               // Larger jobs are dropped
var MAX_JOB_AGE = 15 * 60 * 1000;                   // Jobs older than this are deleted
var COMMAND_TIMEOUT = 2 * 60 * 1000;                // PowerShell or lpadmin commands are killed after this
var JOB_END_DELAY = 2000;                           // A PDF job is complete when no data arrives this long after its %%EOF marker
var JOB_IDLE_TIMEOUT = 30 * 1000;                   // Any job is complete when no data arrives this long

var sep = (process.platform == 'win32') ? '\\' : '/';
var agentFolder = process.execPath.substring(0, process.execPath.lastIndexOf(sep));
var jobsFolder = agentFolder + sep + 'PrintJobs';
var markerFile = agentFolder + sep + 'remoteprinter.json'; // Present while a printer is installed, so leftovers can be removed
var ppdFile = agentFolder + sep + 'remoteprinter.ppd';
var psFile = agentFolder + sep + 'remoteprinter.ps1';     // PowerShell script being run, in the agent folder only administrators can write to
var MAX_COMMAND_LINE = 4000;                              // MeshAgent cuts Windows command lines longer than 4095 characters

var server = null;          // TCP listener receiving print jobs
var current = null;         // { name, port } of the installed printer
var jobCounter = 0;
var children = [];          // Keep a reference on running child processes
var queue = [];             // Install / uninstall operations run one at a time
var queueBusy = false;
var startRequested = false; // Set once start() is called, so cleanup() doesn't remove a printer installed by this run
var history = [];           // Recent events, shown by the "remoteprint" agent console command

function log(msg) {
    history.push(new Date().toISOString() + ' ' + msg);
    if (history.length > 30) { history.shift(); }
}

// Minimal PPD, CUPS converts the job to PDF and sends it as-is to the socket backend
var linuxPpd = [
    '*PPD-Adobe: "4.3"',
    '*FormatVersion: "4.3"',
    '*FileVersion: "1.0"',
    '*LanguageVersion: English',
    '*LanguageEncoding: ISOLatin1',
    '*PCFileName: "MESHPDF.PPD"',
    '*Manufacturer: "MeshCentral"',
    '*Product: "(MeshCentral Remote Printer)"',
    '*ModelName: "MeshCentral Remote Printer"',
    '*ShortNickName: "MeshCentral Remote Printer"',
    '*NickName: "MeshCentral Remote Printer, PDF"',
    '*PSVersion: "(3010.000) 0"',
    '*LanguageLevel: "3"',
    '*ColorDevice: True',
    '*DefaultColorSpace: RGB',
    '*FileSystem: False',
    '*Throughput: "1"',
    '*LandscapeOrientation: Plus90',
    '*TTRasterizer: Type42',
    '*cupsVersion: 2.2',
    '*cupsFilter2: "application/vnd.cups-pdf application/pdf 0 -"',
    '*OpenUI *PageSize/Media Size: PickOne',
    '*OrderDependency: 10 AnySetup *PageSize',
    '*DefaultPageSize: Letter',
    '*PageSize Letter/US Letter: "<</PageSize[612 792]>>setpagedevice"',
    '*PageSize Legal/US Legal: "<</PageSize[612 1008]>>setpagedevice"',
    '*PageSize A4/A4: "<</PageSize[595 842]>>setpagedevice"',
    '*CloseUI: *PageSize',
    '*OpenUI *PageRegion: PickOne',
    '*OrderDependency: 10 AnySetup *PageRegion',
    '*DefaultPageRegion: Letter',
    '*PageRegion Letter/US Letter: "<</PageSize[612 792]>>setpagedevice"',
    '*PageRegion Legal/US Legal: "<</PageSize[612 1008]>>setpagedevice"',
    '*PageRegion A4/A4: "<</PageSize[595 842]>>setpagedevice"',
    '*CloseUI: *PageRegion',
    '*DefaultImageableArea: Letter',
    '*ImageableArea Letter/US Letter: "0 0 612 792"',
    '*ImageableArea Legal/US Legal: "0 0 612 1008"',
    '*ImageableArea A4/A4: "0 0 595 842"',
    '*DefaultPaperDimension: Letter',
    '*PaperDimension Letter/US Letter: "612 792"',
    '*PaperDimension Legal/US Legal: "612 1008"',
    '*PaperDimension A4/A4: "595 842"',
    ''
].join('\n');

function isSupported() { return (process.platform == 'win32') || ((process.platform == 'linux') && (getLpadmin() != null)); }

function getLpadmin() {
    var paths = ['/usr/sbin/lpadmin', '/usr/bin/lpadmin', '/sbin/lpadmin'];
    for (var i in paths) { if (fs.existsSync(paths[i])) return paths[i]; }
    return null;
}

// Make the printer name safe for the platform
function cleanName(name) {
    if ((typeof name != 'string') || (name.length == 0)) { name = DEFAULT_PRINTER_NAME; }
    name = name.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 64);
    if (process.platform == 'win32') { name = name.replace(/[\\,!]/g, '_'); } else { name = name.replace(/[\s\/#\\'"]/g, '_'); }
    if (name.trim().length == 0) { name = (process.platform == 'win32') ? DEFAULT_PRINTER_NAME : DEFAULT_PRINTER_NAME.replace(/ /g, '_'); }
    return name.trim();
}

function psQuote(str) { return "'" + str.replace(/'/g, "''") + "'"; }

// Run a queued operation, operations are run one at a time
function runQueued(func) {
    queue.push(func);
    if (queueBusy == false) { runNext(); }
}
function runNext() {
    if (queue.length == 0) { queueBusy = false; return; }
    queueBusy = true;
    var func = queue.shift();
    try { func(runNext); } catch (ex) { runNext(); }
}

// Collect the output of a child process, callback(exitCode, output). The child is killed if it runs too long,
// so a stuck command can't block the operation queue.
function watchChild(child, func) {
    var done = false;
    var finish = function (code, output) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var i = children.indexOf(child); if (i >= 0) { children.splice(i, 1); }
        func(code, output);
    };
    var timer = setTimeout(function () { try { child.kill(); } catch (ex) { } finish(-1, 'Timed out installing the printer'); }, COMMAND_TIMEOUT);
    children.push(child);
    child.stdout.str = ''; child.stderr.str = '';
    child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.on('exit', function (code) { finish(code, getOutput(child.stdout.str, child.stderr.str)); });
}

// The command output used in messages: stdout, or stderr when there's none. PowerShell writes progress and
// errors to stderr as CLIXML, keep only the error messages from it.
function getOutput(stdout, stderr) {
    stdout = stdout.trim();
    if (stdout.length > 0) return stdout;
    stderr = stderr.trim();
    if (stderr.indexOf('#< CLIXML') != 0) return stderr;
    var errors = [], re = /<S S="Error">([^<]*)<\/S>/g, m;
    while ((m = re.exec(stderr)) != null) { errors.push(m[1]); }
    return errors.join('').replace(/_x000D_/g, '').replace(/_x000A_/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

// Path of the 64-bit PowerShell on 64-bit Windows, also from a 32-bit agent. A 32-bit PowerShell looks for
// 32-bit printer drivers and Add-Printer fails.
function getPowerShellPath() {
    var root = process.env['SystemRoot'] || 'C:\\Windows';
    var sysnative = root + '\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe'; // Only visible to 32-bit processes on 64-bit Windows
    try { if (fs.existsSync(sysnative)) return sysnative; } catch (ex) { }
    return root + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

// Run a PowerShell script, callback(exitCode, output). The script is saved to a file and a short command passed with
// -EncodedCommand runs it as a script block: written to stdin, PowerShell waits for a blank line after multi-line
// statements and never runs them, MeshAgent cuts command lines longer than 4095 characters so the script can't be
// on the command line, and an execution policy set by Group Policy can block -File but not a script block.
function runPowerShell(script, func) {
    try { fs.writeFileSync(psFile, script); } catch (ex) { func(-1, 'Unable to write ' + psFile); return; }
    var command = "& ([ScriptBlock]::Create([IO.File]::ReadAllText(" + psQuote(psFile) + ", [Text.Encoding]::UTF8)))";
    var encoded = Buffer.alloc(command.length * 2); // -EncodedCommand takes base64 of UTF-16LE
    for (var i = 0; i < command.length; i++) { encoded.writeUInt16LE(command.charCodeAt(i), i * 2); }
    var args = ['powershell', '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded.toString('base64')];
    var psPath = getPowerShellPath();
    if ((psPath.length + args.join(' ').length) > MAX_COMMAND_LINE) { func(-1, 'PowerShell command line too long'); return; }
    var child = require('child_process').execFile(psPath, args, {});
    watchChild(child, function (code, output) {
        try { fs.unlinkSync(psFile); } catch (ex) { }
        func(code, output);
    });
    try { child.stdin.end(); } catch (ex) { }
}

// Run a command without a shell, callback(exitCode, output)
function runCommand(path, args, func) {
    watchChild(require('child_process').execFile(path, args), func);
}

function readMarker() { try { return JSON.parse(fs.readFileSync(markerFile).toString()); } catch (ex) { return null; } }
function writeMarker(m) { try { fs.writeFileSync(markerFile, JSON.stringify(m)); } catch (ex) { } }
function deleteMarker() { try { fs.unlinkSync(markerFile); } catch (ex) { } }

// Install the printer, callback(err)
function installPrinter(name, port, func) {
    if (process.platform == 'win32') {
        var portName = PORT_PREFIX + '_' + port;
        var script = [
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            "$step = 'Checking the printer driver'",
            "try {",
            "  $name = " + psQuote(name) + "; $port = " + psQuote(portName) + "; $drv = 'Microsoft Print To PDF'",
            "  if (-not (Get-PrinterDriver -Name $drv -ErrorAction SilentlyContinue)) { throw ('Printer driver not found: ' + $drv + '. Turn on the \"Microsoft Print to PDF\" Windows feature, it is included in Windows 10 and later.') }",
            "  $step = 'Checking the printer name'",
            "  $existing = Get-Printer -Name $name -ErrorAction SilentlyContinue",
            "  if ($existing -and ($existing.PortName -notlike '" + PORT_PREFIX + "*')) { throw ('A printer with this name already exists: ' + $name) }",
            // Remove printers left by an earlier run with another name or port. Windows doesn't remove a printer with queued jobs, so cancel them first, and don't fail the install if it still can't be removed.
            "  $step = 'Removing the previous printer'",
            "  Get-Printer | Where-Object { ($_.PortName -like '" + PORT_PREFIX + "*') -and (($_.Name -ne $name) -or ($_.PortName -ne $port)) } | ForEach-Object { Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue; Remove-Printer -Name $_.Name -ErrorAction SilentlyContinue }",
            "  $step = 'Adding the printer port'",
            "  if (-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name $port -PrinterHostAddress '127.0.0.1' -PortNumber " + port + " }",
            "  $step = 'Adding the printer'",
            "  if (-not (Get-Printer -Name $name -ErrorAction SilentlyContinue)) { Add-Printer -Name $name -DriverName $drv -PortName $port }",
            "  Write-Output 'OK'",
            "} catch {",
            // The printer cmdlets give a generic message, the Windows error code is in the CIM error data
            "  $err = $_",
            "  $msg = $step + ': ' + $err.Exception.Message",
            "  try {",
            "    $data = $err.Exception.ErrorData",
            "    if ($data -ne $null) {",
            "      $code = $data.CimInstanceProperties['error_Code'].Value",
            "      $text = $data.CimInstanceProperties['error_WindowsErrorMessage'].Value",
            "      if (($code -ne $null) -and ($code -ne 0)) {",
            "        if ([string]::IsNullOrEmpty($text)) { $text = (New-Object ComponentModel.Win32Exception([int]$code)).Message }",
            "        $msg += ' Windows error ' + $code + ': ' + $text",
            "      }",
            "    }",
            "  } catch { }",
            "  Write-Output $msg",
            "}"
        ].join('\r\n');
        runPowerShell(script, function (code, output) { func(((code == 0) && (output == 'OK')) ? null : (output || 'PowerShell error')); });
    } else if (process.platform == 'linux') {
        var lpadmin = getLpadmin();
        if (lpadmin == null) { func('CUPS is not installed (lpadmin not found)'); return; }
        try { fs.writeFileSync(ppdFile, linuxPpd); } catch (ex) { func('Unable to write PPD file'); return; }
        // If the printer name changed, remove the old queue first
        var marker = readMarker();
        var removeOld = function (next) { if ((marker != null) && (marker.name != null) && (marker.name != name)) { runCommand(lpadmin, ['lpadmin', '-x', marker.name], function () { next(); }); } else { next(); } };
        removeOld(function () {
            runCommand(lpadmin, ['lpadmin', '-p', name, '-E', '-v', 'socket://127.0.0.1:' + port, '-P', ppdFile, '-D', 'MeshCentral Remote Printer', '-o', 'printer-is-shared=false'], function (code, output) {
                func((code == 0) ? null : (output || ('lpadmin error ' + code)));
            });
        });
    } else {
        func('Remote printing is not supported on this platform');
    }
}

// Remove all printers installed by this module, callback()
function uninstallPrinter(func) {
    var marker = readMarker();
    if (process.platform == 'win32') {
        var script = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            "$ProgressPreference = 'SilentlyContinue'",
            "Get-Printer | Where-Object { $_.PortName -like '" + PORT_PREFIX + "*' } | ForEach-Object { Get-PrintJob -PrinterName $_.Name | Remove-PrintJob; $_ } | Remove-Printer",
            "Start-Sleep -Milliseconds 500",
            "Get-PrinterPort | Where-Object { $_.Name -like '" + PORT_PREFIX + "*' } | Remove-PrinterPort",
            "Write-Output 'OK'"
        ].join('\r\n');
        runPowerShell(script, function () { deleteMarker(); func(); });
    } else if (process.platform == 'linux') {
        var lpadmin = getLpadmin();
        if ((lpadmin == null) || (marker == null) || (marker.name == null)) { deleteMarker(); func(); return; }
        runCommand(lpadmin, ['lpadmin', '-x', marker.name], function () { try { fs.unlinkSync(ppdFile); } catch (ex) { } deleteMarker(); func(); });
    } else {
        deleteMarker(); func();
    }
}

// Delete old jobs. If all is true, delete all of them.
function cleanJobs(all) {
    var files = null;
    try { files = fs.readdirSync(jobsFolder); } catch (ex) { return; }
    var now = Date.now();
    for (var i in files) {
        var m = /^print-(\d+)-/.exec(files[i]);
        if ((all === true) || (m == null) || ((now - parseInt(m[1])) > MAX_JOB_AGE)) { try { fs.unlinkSync(jobsFolder + sep + files[i]); } catch (ex) { } }
    }
}

// Position of an ASCII string in an array of bytes, or -1. Plain arrays are used for the job's first and
// last bytes since the agent's Buffer doesn't support Buffer.from(buffer) or toString('binary').
function indexOfBytes(bytes, str) {
    for (var i = 0; i + str.length <= bytes.length; i++) {
        var j = 0;
        while ((j < str.length) && (bytes[i + j] == str.charCodeAt(j))) { j++; }
        if (j == str.length) return i;
    }
    return -1;
}

// Figure out the file extension from the first bytes of the job
function getJobExtension(head) {
    if (indexOfBytes(head, '%PDF') >= 0) return 'pdf';
    if (indexOfBytes(head, '%!PS') >= 0) return 'ps';
    if ((head.length >= 2) && (head[0] == 0x50) && (head[1] == 0x4B)) return 'xps';
    return 'prn';
}

function startListener(port, onJob, func) {
    if (server != null) { func(null); return; }
    try { fs.mkdirSync(jobsFolder); } catch (ex) { }
    var s = require('net').createServer();
    s.on('connection', function (socket) {
        if (s.onCheckConnection != null) { var f = s.onCheckConnection; s.onCheckConnection = null; f(); }
        var job = { id: ++jobCounter, time: Date.now(), size: 0, head: [], tail: [], fd: null, done: false, timer: null };
        job.tmpPath = jobsFolder + sep + 'print-' + job.time + '-' + job.id + '.tmp';
        try { job.fd = fs.openSync(job.tmpPath, 'wbN'); } catch (ex) { socket.end(); return; }

        // The Windows spooler only completes the job, and starts the next one, once the printer closes the connection.
        // So close it when the job is complete: when the other side ends it, or when no more data arrives.
        var restartTimer = function () {
            if (job.timer != null) { clearTimeout(job.timer); }
            if (indexOfBytes(job.tail, '%%EOF') >= 0) {
                job.timer = setTimeout(function () { finish('end of PDF'); }, JOB_END_DELAY);
            } else {
                job.timer = setTimeout(function () { finish('no data for ' + (JOB_IDLE_TIMEOUT / 1000) + ' seconds'); }, JOB_IDLE_TIMEOUT);
            }
        };
        socket.on('data', function (chunk) {
            if ((job.done) || (job.fd == null)) return;
            try {
                var i;
                for (i = 0; (i < chunk.length) && (job.head.length < 1024); i++) { job.head.push(chunk[i]); } // First bytes, to find the format
                for (i = Math.max(0, chunk.length - 32); i < chunk.length; i++) { job.tail.push(chunk[i]); } // Last bytes, to find the end of a PDF
                if (job.tail.length > 32) { job.tail.splice(0, job.tail.length - 32); }
                job.size += chunk.length;
                restartTimer();
                if (job.size > MAX_JOB_SIZE) { try { fs.closeSync(job.fd); } catch (ex) { } job.fd = null; try { fs.unlinkSync(job.tmpPath); } catch (ex) { } finish('job too large, dropped'); return; }
                fs.writeSync(job.fd, chunk);
            } catch (ex) {
                if (job.dataError == null) { job.dataError = String(ex); log('Job ' + job.id + ': error receiving data: ' + ex); }
            }
        });
        var finish = function (reason) {
            if (job.timer != null) { clearTimeout(job.timer); job.timer = null; }
            if (job.closing !== true) {
                job.closing = true;
                try { socket.end(); } catch (ex) { }
                setTimeout(function () { try { if (typeof socket.destroy == 'function') { socket.destroy(); } } catch (ex) { } }, 5000); // If the other side keeps it half open
            }
            if (job.done) return;
            job.done = true;
            if (job.size > 0) { log('Job ' + job.id + ': ' + job.size + ' bytes, complete because: ' + reason); }
            if (job.fd == null) return; // Job was dropped
            try { fs.closeSync(job.fd); } catch (ex) { }
            if (job.size == 0) { try { fs.unlinkSync(job.tmpPath); } catch (ex) { } return; }
            var ext = getJobExtension(job.head);
            var name = 'print-' + job.time + '-' + job.id + '.' + ext;
            var path = jobsFolder + sep + name;
            try { fs.renameSync(job.tmpPath, path); } catch (ex) { path = job.tmpPath; name = 'print-' + job.time + '-' + job.id + '.tmp'; }
            log('Job ' + job.id + ': saved as ' + name);
            cleanJobs(false);
            try { onJob({ path: path, name: name, size: job.size, format: ext }); } catch (ex) { }
        };
        socket.on('end', function () { finish('connection closed by the spooler'); });
        socket.on('close', function () { finish('connection closed'); });
        socket.on('error', function (err) { finish('connection error: ' + err); });
        restartTimer(); // Also closes connections that never send anything
    });
    s.on('error', function (err) { log('Listener error: ' + err); });
    try {
        s.listen({ port: port, host: '127.0.0.1' });
    } catch (ex) {
        log('Unable to listen on port ' + port + ': ' + ex);
        func('Unable to listen on port ' + port);
        return;
    }
    server = s;

    // Check that the listener receives connections, if another program uses the port the connection goes to it instead
    var checked = false;
    var check = function (err) {
        if (checked) return;
        checked = true;
        clearTimeout(checkTimer);
        s.onCheckConnection = null;
        try { if (c != null) { c.end(); } } catch (ex) { }
        if (err != null) { log('Listener check failed on port ' + port + ': ' + err); stopListener(); func('Unable to receive print jobs on port ' + port + ' (' + err + ')'); return; }
        log('Listening on 127.0.0.1:' + port);
        func(null);
    };
    var checkTimer = setTimeout(function () { check('no connection received, is the port used by another program?'); }, 5000);
    s.onCheckConnection = function () { check(null); };
    var c = null;
    try {
        c = require('net').createConnection({ host: '127.0.0.1', port: port });
        c.on('error', function (err) { check(String(err)); });
    } catch (ex) { check(String(ex)); }
}

function stopListener() {
    if (server == null) return;
    try { server.close(); } catch (ex) { }
    server = null;
}

// Start remote printing. options: { printerName, port }, onJob({ path, name, size, format }), func(err, { name, port })
function start(options, onJob, func) {
    if (options == null) { options = {}; }
    var name = cleanName(options.printerName);
    var port = parseInt(options.port);
    if (isNaN(port) || (port < 1024) || (port > 65535)) { port = DEFAULT_TCP_PORT; }
    startRequested = true;
    runQueued(function (done) {
        if (isSupported() == false) { func('Remote printing is not supported on this device'); done(); return; }
        if ((current != null) && (current.name == name) && (current.port == port) && (server != null)) { func(null, current); done(); return; } // Already running
        if ((current != null) && (current.port != port)) { stopListener(); }
        startListener(port, onJob, function (err) {
            if (err != null) { func(err); done(); return; }
            installPrinter(name, port, function (err) {
                if (err != null) {
                    log('Printer install failed: ' + err);
                    stopListener();
                    current = null;
                    uninstallPrinter(function () { func(err); done(); });
                    return;
                }
                current = { name: name, port: port };
                writeMarker(current);
                log('Printer installed: ' + name);
                func(null, current);
                done();
            });
        });
    });
}

// Stop remote printing, remove the printer and pending jobs. func() is optional.
function stop(func) {
    runQueued(function (done) {
        stopListener();
        current = null;
        log('Stopping, removing the printer');
        uninstallPrinter(function () {
            cleanJobs(true);
            if (func) { try { func(); } catch (ex) { } }
            done();
        });
    });
}

// Remove a printer left behind by a previous run (agent crash or restart while printing was active)
function cleanup() {
    if (startRequested) return; // Remote printing was already started by this run, the printer is in use
    if (readMarker() != null) { log('Removing a printer left by a previous run'); stop(); } else { cleanJobs(true); }
}

function isRunning() { return (current != null); }

function getStatus() {
    return { supported: isSupported(), printer: current, listening: (server != null), busy: queueBusy, jobsFolder: jobsFolder, history: history.slice() };
}

module.exports = { start: start, stop: stop, cleanup: cleanup, isRunning: isRunning, isSupported: isSupported, getStatus: getStatus, jobsFolder: jobsFolder };
