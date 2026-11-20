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
// is one print job. The job is saved to disk and sent to the users with remote printing active, so their browser
// downloads it.
//
// meshcore.js passes the "remoteprint" messages from the server to handleMessage(), the "remoteprint" agent console
// command to consoleCommand(), and calls agentStarted() when the agent starts. The browsers refresh their session
// every 30 seconds while the remote desktop is open.
//
// Windows: "Microsoft Print To PDF" driver on a Standard TCP/IP port, the spooler sends the PDF to us. The printer is
//          installed with the Windows print spooler API, see win-remote-printer.js.
// Linux:   CUPS queue with a PPD that converts to PDF, using the "socket://" backend.
//

var fs = require('fs');

var PORT_PREFIX = 'MeshCentralPrint';               // Windows printer port names are MeshCentralPrint_<port>
var DEFAULT_PRINTER_NAME = 'MeshCentral Printer';
var DEFAULT_TCP_PORT = 35500;
var MAX_JOB_SIZE = 256 * 1024 * 1024;               // Larger jobs are dropped
var MAX_JOB_AGE = 5 * 60 * 1000;                    // Jobs older than this are deleted, they're downloaded right away
var DOWNLOAD_WINDOW = 2 * 60 * 1000;                // A job sent to the browsers is deleted this long after, they download it right away
var COMMAND_TIMEOUT = 2 * 60 * 1000;                // lpadmin commands are killed after this
var JOB_END_DELAY = 2000;                           // A PDF job is complete when no data arrives this long after its %%EOF marker
var JOB_IDLE_TIMEOUT = 10 * 60 * 1000;              // Any job is complete when no data arrives this long, a slow PC can take minutes to spool a large job
var SESSION_TIMEOUT = 90 * 1000;                    // A user session that isn't refreshed this long is removed
var STOP_DELAY = 30 * 1000;                         // The printer is removed this long after the last session stopped, so a remote desktop that reconnects keeps it
var LISTENER_KEEP = 10 * 60 * 1000;                 // The listener is closed this long after the printer is removed, so starting again soon doesn't bind the port again
var BIND_RETRY_TIME = 4 * 60 * 1000;                // Retry binding the port this long: closed job connections can hold it in TIME_WAIT, and the agent binds exclusively on Windows

var sep = (process.platform == 'win32') ? '\\' : '/';
var agentFolder = process.execPath.substring(0, process.execPath.lastIndexOf(sep));
var jobsFolder = agentFolder + sep + 'PrintJobs';    // Only readable by SYSTEM / root and administrators, see prepareJobsFolder()
var markerFile = agentFolder + sep + 'remoteprinter.json'; // Present while a printer is installed, so leftovers can be removed
var ppdFile = agentFolder + sep + 'remoteprinter.ppd';

var server = null;          // TCP listener receiving print jobs
var listenerPort = null;    // Port the listener is bound to
var listenerCloseTimer = null; // Set while the listener is kept after the printer was removed
var current = null;         // { name, port, description } of the installed printer
var jobCounter = 0;
var children = [];          // Keep a reference on running child processes
var queue = [];             // Install / uninstall operations run one at a time
var queueBusy = false;
var startRequested = false; // Set once start() is called, so cleanup() doesn't remove a printer installed by this run
var permanent = false;      // Installed with install(): kept when no session uses it, and installed again when the agent starts
var lastOptions = null;     // Printer options from the last start(), from the server configuration
var sessions = {};          // sessionid -> { time, userid, username, sessionid, remoteaddr } of the users with remote printing active
var sessionTimer = null;    // Removes sessions that are no longer refreshed
var stopTimer = null;       // Set while waiting to remove the printer after the last session stopped
var context = null;         // { send(command), log(message, state) } from meshcore.js
var history = [];           // Recent events, shown by the "remoteprint" agent console command

// Cancel a timer. MeshAgent's clearTimeout() throws on a timer that already fired, so timer callbacks also clear their
// reference first, and this ignores the error.
function cancelTimer(timer) { if (timer != null) { try { clearTimeout(timer); } catch (ex) { } } }

// setTimeout() that keeps a reference on the timer until it fires. Some MeshAgent builds drop timers nothing references.
var pendingTimers = [];
function later(func, delay) {
    var timer = setTimeout(function () { var i = pendingTimers.indexOf(timer); if (i >= 0) { pendingTimers.splice(i, 1); } func(); }, delay);
    pendingTimers.push(timer);
    return timer;
}

function log(msg) {
    history.push(new Date().toISOString() + ' ' + msg);
    if (history.length > 60) { history.shift(); }
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

function findCupsCommand(name) {
    var paths = ['/usr/sbin/' + name, '/usr/bin/' + name, '/sbin/' + name, '/bin/' + name];
    for (var i in paths) { if (fs.existsSync(paths[i])) return paths[i]; }
    return null;
}
function getLpadmin() { return findCupsCommand('lpadmin'); }

// lpstat runs in English, its output is read
var LPSTAT_OPTIONS = { env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } };

// Device URI of a CUPS queue, func(uri), null if there's no such queue, or CUPS isn't running
function getQueueUri(name, func) {
    var lpstat = findCupsCommand('lpstat');
    if (lpstat == null) { func(null); return; }
    runCommand(lpstat, ['lpstat', '-v', name], function (code, output) {
        var m = (code == 0) ? /^device for [^:]+:\s*(\S+)/m.exec(output) : null;
        func((m != null) ? m[1] : null);
    }, LPSTAT_OPTIONS);
}

// func(true) if the CUPS scheduler is running. lpstat says the same about a missing queue when it isn't.
function isCupsRunning(func) {
    var lpstat = findCupsCommand('lpstat');
    if (lpstat == null) { func(false); return; }
    runCommand(lpstat, ['lpstat', '-r'], function (code, output) { func((code == 0) && (output.trim() == 'scheduler is running')); }, LPSTAT_OPTIONS);
}

// Make the printer name safe for the platform
function cleanName(name) {
    if ((typeof name != 'string') || (name.length == 0)) { name = DEFAULT_PRINTER_NAME; }
    name = name.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 64);
    if (process.platform == 'win32') { name = name.replace(/[\\,!]/g, '_'); } else { name = name.replace(/[\s\/#\\'"]/g, '_'); }
    if (name.trim().length == 0) { name = (process.platform == 'win32') ? DEFAULT_PRINTER_NAME : DEFAULT_PRINTER_NAME.replace(/ /g, '_'); }
    return name.trim();
}

// The name people see: the Windows printer name, or the CUPS queue description, which keeps spaces
function displayName(name, printerName) {
    if (process.platform == 'win32') return name;
    var text = ((typeof printerName == 'string') ? printerName : '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 64).trim();
    return (text.length > 0) ? text : DEFAULT_PRINTER_NAME;
}

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
        cancelTimer(timer);
        var i = children.indexOf(child); if (i >= 0) { children.splice(i, 1); }
        func(code, output);
    };
    var timer = setTimeout(function () { timer = null; try { child.kill(); } catch (ex) { } finish(-1, 'Timed out installing the printer'); }, COMMAND_TIMEOUT);
    children.push(child);
    child.stdout.str = ''; child.stderr.str = '';
    child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.stderr.on('data', function (c) { this.str += c.toString(); });
    child.on('exit', function (code) { finish(code, getOutput(child.stdout.str, child.stderr.str)); });
}

// The command output used in messages: stdout, or stderr when there's none
function getOutput(stdout, stderr) {
    stdout = stdout.trim();
    return (stdout.length > 0) ? stdout : stderr.trim();
}

// Run a command without a shell, callback(exitCode, output)
function runCommand(path, args, func, options) {
    watchChild((options != null) ? require('child_process').execFile(path, args, options) : require('child_process').execFile(path, args), func);
}

function readMarker() { try { return JSON.parse(fs.readFileSync(markerFile).toString()); } catch (ex) { return null; } }
function writeMarker(m) { try { fs.writeFileSync(markerFile, JSON.stringify(m)); } catch (ex) { } }
function deleteMarker() { try { fs.unlinkSync(markerFile); } catch (ex) { } }

// Windows port names of this agent: the one for port, and the one it used before, from the marker, if the port changed
function getOurPortNames(port) {
    var names = [], marker = readMarker();
    if (port != null) { names.push(PORT_PREFIX + '_' + port); }
    if ((marker != null) && (marker.port != null) && (marker.port != port)) { names.push(PORT_PREFIX + '_' + marker.port); }
    return names;
}

// Install the printer, callback(err)
function installPrinter(name, description, port, func) {
    if (process.platform == 'win32') {
        try {
            require('win-remote-printer').install(name, PORT_PREFIX + '_' + port, port, 'Microsoft Print To PDF', getOurPortNames(port), function (step) { log('Install step: ' + step); }, function (err) { func(err); });
        } catch (ex) { func('Windows print spooler API: ' + ex); }
    } else if (process.platform == 'linux') {
        var lpadmin = getLpadmin();
        if (lpadmin == null) { func('CUPS is not installed (lpadmin not found)'); return; }
        var uri = 'socket://127.0.0.1:' + port;
        var marker = readMarker();
        // "lpadmin -p" changes an existing queue, so don't take over one that isn't ours
        getQueueUri(name, function (existingUri) {
            if ((existingUri != null) && (existingUri != uri) && ((marker == null) || (marker.name != name))) { func('A printer with this name already exists: ' + name); return; }
            try { fs.writeFileSync(ppdFile, linuxPpd); } catch (ex) { func('Unable to write PPD file'); return; }
            // If the printer name changed, remove the old queue first
            var removeOld = function (next) { if ((marker != null) && (marker.name != null) && (marker.name != name)) { runCommand(lpadmin, ['lpadmin', '-x', marker.name], function () { next(); }); } else { next(); } };
            removeOld(function () {
                runCommand(lpadmin, ['lpadmin', '-p', name, '-E', '-v', uri, '-P', ppdFile, '-D', description, '-o', 'printer-is-shared=false'], function (code, output) {
                    func((code == 0) ? null : (output || ('lpadmin error ' + code)));
                });
            });
        });
    } else {
        func('Remote printing is not supported on this platform');
    }
}

// Remove the printer installed by this module, on port or the port in the marker, func(err). The marker is only deleted
// once the printer is gone, so the next agent start tries again when the removal failed.
function uninstallPrinter(port, func) {
    var marker = readMarker();
    if (process.platform == 'win32') {
        try {
            require('win-remote-printer').uninstall(getOurPortNames(port), function (err) { if (err == null) { deleteMarker(); } func(err); });
        } catch (ex) { func('Windows print spooler API: ' + ex); }
    } else if (process.platform == 'linux') {
        var lpadmin = getLpadmin();
        if ((lpadmin == null) || (marker == null) || (marker.name == null)) { deleteMarker(); func(null); return; }
        runCommand(lpadmin, ['lpadmin', '-x', marker.name], function (code, output) {
            if (code == 0) { try { fs.unlinkSync(ppdFile); } catch (ex) { } deleteMarker(); func(null); return; }
            var failed = 'lpadmin -x ' + marker.name + ' failed: ' + (output || ('exit code ' + code));
            isCupsRunning(function (running) {
                if (running == false) { func(failed + ', CUPS is not running'); return; }
                getQueueUri(marker.name, function (uri) {
                    if (uri == null) { deleteMarker(); func(null); return; } // Already gone
                    func(failed);
                });
            });
        });
    } else {
        deleteMarker(); func(null);
    }
}

// Create the jobs folder, readable only by SYSTEM / root and administrators, func(err). On Windows the folder would
// otherwise inherit read access for all users from Program Files.
function prepareJobsFolder(func) {
    try { fs.mkdirSync(jobsFolder); } catch (ex) { }
    if (process.platform == 'win32') {
        try { require('win-remote-printer').restrictFolder(jobsFolder, func); } catch (ex) { func(String(ex)); }
    } else {
        try { fs.chmodSync(jobsFolder, 448); func(null); } catch (ex) { func('Unable to set the permissions of ' + jobsFolder + ': ' + ex); } // 0700
    }
}

// Random hexadecimal string for job file names, so a job can't be fetched by guessing its name
function randomHex() {
    var str = '';
    for (var i = 0; i < 4; i++) {
        var n = null;
        try { n = parseInt(require('tls').generateRandomInteger('0', '4294967295')); } catch (ex) { }
        if ((n == null) || isNaN(n)) { n = Math.floor(Math.random() * 4294967296); }
        str += ('00000000' + n.toString(16)).slice(-8);
    }
    return str;
}

// Delete a job file once its download window is over. A file being downloaded can't be deleted on Windows, so retry.
function deleteJobLater(path, delay, attempt) {
    if (attempt == null) { attempt = 1; }
    later(function () {
        try { fs.unlinkSync(path); } catch (ex) {
            if (fs.existsSync(path) && (attempt < 20)) { deleteJobLater(path, 30000, attempt + 1); }
        }
    }, delay);
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

// The file extension of the job, from its first bytes. Both the Windows driver and the CUPS queue produce PDF.
function getJobExtension(head) { return (indexOfBytes(head, '%PDF') >= 0) ? 'pdf' : 'prn'; }

function startListener(port, onJob, func, firstAttempt) {
    cancelTimer(listenerCloseTimer); listenerCloseTimer = null;
    if ((server != null) && (listenerPort == port)) { func(null); return; } // Still open from before
    if (server != null) { stopListener(); }
    if (firstAttempt == null) { firstAttempt = Date.now(); }
    var s = require('net').createServer();
    s.connections = [];
    s.on('connection', function (socket) {
        s.connections.push(socket);
        socket.on('close', function () { var i = s.connections.indexOf(socket); if (i >= 0) { s.connections.splice(i, 1); } });
        var job = { id: ++jobCounter, time: Date.now(), size: 0, head: [], tail: [], fd: null, done: false, timer: null };
        job.baseName = 'print-' + job.time + '-' + job.id + '-' + randomHex();
        job.tmpPath = jobsFolder + sep + job.baseName + '.tmp';
        try { job.fd = fs.openSync(job.tmpPath, 'wbN'); } catch (ex) { socket.end(); return; }
        if (process.platform != 'win32') { try { fs.chmodSync(job.tmpPath, 384); } catch (ex) { } } // 0600

        // The Windows spooler only completes the job, and starts the next one, once the printer closes the connection.
        // So close it when the job is complete: when the other side ends it, or when no more data arrives.
        var restartTimer = function () {
            cancelTimer(job.timer);
            if (indexOfBytes(job.tail, '%%EOF') >= 0) {
                job.timer = setTimeout(function () { job.timer = null; finish('end of PDF'); }, JOB_END_DELAY);
            } else {
                job.timer = setTimeout(function () { job.timer = null; finish('no data for ' + (JOB_IDLE_TIMEOUT / 1000) + ' seconds'); }, JOB_IDLE_TIMEOUT);
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
            cancelTimer(job.timer);
            job.timer = null;
            if (job.closing !== true) {
                job.closing = true;
                try { socket.end(); } catch (ex) { }
                later(function () { try { if (typeof socket.destroy == 'function') { socket.destroy(); } } catch (ex) { } }, 5000); // If the other side keeps it half open
            }
            if (job.done) return;
            job.done = true;
            if (job.size > 0) { log('Job ' + job.id + ': ' + job.size + ' bytes, complete because: ' + reason); }
            if (job.fd == null) return; // Job was dropped
            try { fs.closeSync(job.fd); } catch (ex) { }
            if (job.size == 0) { try { fs.unlinkSync(job.tmpPath); } catch (ex) { } return; }
            var ext = getJobExtension(job.head);
            var name = job.baseName + '.' + ext;
            var path = jobsFolder + sep + name;
            try { fs.renameSync(job.tmpPath, path); } catch (ex) { path = job.tmpPath; name = job.baseName + '.tmp'; }
            log('Job ' + job.id + ': saved as ' + name);
            cleanJobs(false);
            try { onJob({ path: path, name: name, size: job.size }); } catch (ex) { }
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
        // The agent binds exclusively on Windows: the port is refused while a connection of the previous listener is still open or in TIME_WAIT
        if ((Date.now() - firstAttempt) < 1000) { log('Port ' + port + ' is in use, retrying for up to ' + (BIND_RETRY_TIME / 60000) + ' minutes: ' + ex); }
        if ((Date.now() - firstAttempt) < BIND_RETRY_TIME) { later(function () { startListener(port, onJob, func, firstAttempt); }, 2000); return; }
        log('Unable to listen on port ' + port + ': ' + ex);
        func('Unable to listen on port ' + port + ', it is used by another program');
        return;
    }
    server = s;
    listenerPort = port;
    log('Listening on 127.0.0.1:' + port);
    func(null);
}

// Close the listener LISTENER_KEEP after the printer was removed, unless a printer is installed again meanwhile
function closeListenerLater() {
    cancelTimer(listenerCloseTimer);
    listenerCloseTimer = later(function () {
        listenerCloseTimer = null;
        if (queueBusy) { closeListenerLater(); return; } // Check again when the install or removal is done
        if (current == null) { stopListener(); }
    }, LISTENER_KEEP);
}

// Close the listener and its open connections, so nothing is left bound to the port
function stopListener() {
    cancelTimer(listenerCloseTimer); listenerCloseTimer = null;
    if (server == null) return;
    var connections = server.connections || [];
    for (var i in connections) { try { if (typeof connections[i].destroy == 'function') { connections[i].destroy(); } else { connections[i].end(); } } catch (ex) { } }
    try { server.close(); } catch (ex) { }
    server = null;
    listenerPort = null;
}

// Start remote printing. options: { printerName, port }, onJob({ path, name, size }), func(err, { name, port })
function start(options, onJob, func) {
    if (options == null) { options = {}; }
    var name = cleanName(options.printerName);
    var description = displayName(name, options.printerName);
    var port = parseInt(options.port);
    if (isNaN(port) || (port < 1024) || (port > 65535)) { port = DEFAULT_TCP_PORT; }
    lastOptions = { printerName: options.printerName, port: options.port };
    startRequested = true;
    runQueued(function (done) {
        if (isSupported() == false) { func('Remote printing is not supported on this device'); done(); return; }
        if ((current != null) && (current.name == name) && (current.description == description) && (current.port == port) && (server != null)) { writeMarker({ name: name, port: port, permanent: permanent }); func(null, current); done(); return; } // Already running
        if ((current != null) && (current.port != port)) { stopListener(); }
        prepareJobsFolder(function (err) {
            if (err != null) { log('Unable to restrict access to the jobs folder: ' + err); func('Unable to restrict access to the print jobs folder: ' + err); done(); return; }
            startListener(port, onJob, function (err) {
                if (err != null) { func(err); done(); return; }
                log('Installing the printer: ' + name);
                installPrinter(name, description, port, function (err) {
                    if (err != null) {
                        log('Printer install failed: ' + err);
                        stopListener();
                        current = null;
                        uninstallPrinter(port, function () { func(err); done(); });
                        return;
                    }
                    current = { name: name, port: port, description: description };
                    writeMarker({ name: name, port: port, permanent: permanent });
                    log('Printer installed: ' + name);
                    func(null, current);
                    done();
                });
            });
        });
    });
}

// Stop remote printing, remove the printer and pending jobs. func() is optional.
// A printer installed with install() is kept, uninstall() removes it.
function stop(func) {
    runQueued(function (done) {
        if (permanent) {
            if (current != null) { log('No user session left, keeping the printer installed with "remoteprint install"'); }
            if (func) { try { func(); } catch (ex) { } }
            done();
            return;
        }
        var port = (current != null) ? current.port : null;
        current = null;
        closeListenerLater(); // Starting again soon then doesn't need to bind the port again
        log('Stopping, removing the printer');
        uninstallPrinter(port, function (err) {
            if (err != null) { log('Unable to remove the printer, trying again when the agent starts: ' + err); } else { log('Printer removed'); }
            cleanJobs(true);
            if (func) { try { func(); } catch (ex) { } }
            done();
        });
    });
}

// Install the printer permanently: it's kept when no user session uses it, and installed again when the agent starts,
// until uninstall(). Uses the printer options the server sent, it's refused before the server sent any: the server only
// sends them when remote printing is enabled, so this doesn't install a printer the server doesn't allow, or with default
// options instead of the configured ones. func(err, { name, port })
function install(onJob, func) {
    var marker = readMarker();
    var options = lastOptions || ((marker != null) ? { printerName: marker.name, port: marker.port } : null);
    if (options == null) { func('Remote printing must be enabled on the server and used in a remote desktop session on this device first, the printer is then installed with the name and port the server sends.'); return; }
    permanent = true;
    log('Installing the printer permanently');
    start(options, onJob, function (err, printer) {
        if (err != null) { permanent = false; }
        func(err, printer);
    });
}

// Remove a printer installed with install(). func() is optional.
function uninstall(func) {
    permanent = false;
    log('Removing the permanently installed printer');
    stop(func);
}

// When the agent starts: install a printer installed with install() again, or remove one left behind by a previous run
// (agent crash or restart while printing was active). onJob receives the jobs of a printer installed again.
function cleanup(onJob) {
    if (startRequested) return; // Remote printing was already started by this run, the printer is in use
    var marker = readMarker();
    if ((marker != null) && (marker.permanent === true) && (onJob != null)) {
        permanent = true;
        log('Installing the printer again, it was installed with "remoteprint install"');
        start({ printerName: marker.name, port: marker.port }, onJob, function (err) { if (err != null) { log('Unable to install the printer again: ' + err); } });
    } else if (marker != null) {
        log('Removing a printer left by a previous run'); stop();
    } else {
        cleanJobs(true);
    }
}

function sessionCount() { var count = 0; for (var i in sessions) { count++; } return count; }

// A print job was received, send it to all users with remote printing active
function onJob(job) {
    if (sessionCount() == 0) {
        // Nobody to send it to, don't keep the document on the device
        try { fs.unlinkSync(job.path); } catch (ex) { }
        context.log('Remote printing job deleted, no user has remote printing active, ' + job.size + ' byte(s)');
        return;
    }
    var path = job.path.split('\\').join('/');
    for (var i in sessions) {
        context.log('Remote printing job, ' + job.size + ' byte(s)', sessions[i]);
        context.send({ action: 'msg', type: 'remoteprint', sub: 'job', sessionid: i, path: path, name: job.name });
    }
    deleteJobLater(job.path, DOWNLOAD_WINDOW); // Don't keep the document on the device once the browsers had time to download it
}

// Remove the sessions that are no longer refreshed. When none are left, remove the printer STOP_DELAY later:
// Windows can take a few seconds to delete a printer, and removing and adding it again quickly can leave no printer.
function checkSessions() {
    var now = Date.now();
    for (var i in sessions) { if ((now - sessions[i].time) > SESSION_TIMEOUT) { delete sessions[i]; } }
    if (sessionCount() > 0) return;
    if (sessionTimer != null) { clearInterval(sessionTimer); sessionTimer = null; }
    if ((stopTimer == null) && ((current != null) || queueBusy)) {
        stopTimer = setTimeout(function () {
            stopTimer = null;
            if (sessionCount() == 0) { stop(); } // Unless a session started again
        }, STOP_DELAY);
    }
}

// A "remoteprint" message from a user's browser, through the server. data.sub is "start", also sent to refresh the
// session, or "stop". ctx: { send(command), log(message, state) }
function handleMessage(data, ctx) {
    context = ctx;
    if (typeof data.sessionid != 'string') return;
    if (data.sub == 'start') {
        // The server checks this too: remote control and files rights, not view only. Jobs are downloaded with the files feature.
        var rights = data.rights;
        if ((rights !== 0xFFFFFFFF) && ((typeof rights != 'number') || ((rights & 8) == 0) || ((rights & 0x500) != 0))) {
            context.send({ action: 'msg', type: 'remoteprint', sub: 'error', sessionid: data.sessionid, msg: 'Remote printing needs remote control and files rights on this device, without view only.' });
            return;
        }
        var isNewSession = (sessions[data.sessionid] == null);
        sessions[data.sessionid] = { time: Date.now(), userid: data.userid, username: data.username, sessionid: data.sessionid, remoteaddr: data.remoteaddr };
        if (sessionTimer == null) { sessionTimer = setInterval(checkSessions, 30000); }
        cancelTimer(stopTimer); stopTimer = null; // Keep the printer
        start({ printerName: data.printerName, port: data.port }, onJob, function (err, printer) {
            if (err != null) {
                delete sessions[data.sessionid];
                context.send({ action: 'msg', type: 'remoteprint', sub: 'error', sessionid: data.sessionid, msg: String(err) });
                checkSessions();
            } else if (isNewSession) {
                context.log('Started remote printing, printer: ' + printer.name, data);
                context.send({ action: 'msg', type: 'remoteprint', sub: 'started', sessionid: data.sessionid, name: printer.description });
            }
        });
    } else if (data.sub == 'stop') {
        if (sessions[data.sessionid] != null) {
            delete sessions[data.sessionid];
            context.log('Stopped remote printing', data);
        }
        checkSessions();
    }
}

// The "remoteprint" agent console command: the state and recent events, or "install" to install the printer permanently,
// until "uninstall". Returns the response, reply(text) gets the result of install and uninstall when they're done.
function consoleCommand(args, ctx, reply) {
    context = ctx;
    if (args[0] == 'install') {
        install(onJob, function (err, printer) {
            if (err != null) { reply('Remote printing install failed: ' + err); return; }
            context.log('Remote printer installed permanently: ' + printer.name);
            reply('Printer "' + printer.name + '" installed, it stays installed until "remoteprint uninstall". Documents printed while no user has remote printing active are deleted.');
        });
        return 'Installing the printer...';
    }
    if (args[0] == 'uninstall') {
        uninstall(function () {
            context.log('Remote printer uninstalled');
            reply('Printer removed. It is installed again while a remote desktop session uses remote printing.');
        });
        return 'Removing the printer...';
    }
    var now = Date.now();
    var lines = ['Remote printing: ' + (isSupported() ? 'supported' : 'not supported on this device')];
    lines.push('Printer: ' + ((current != null) ? (current.name + ((current.description != current.name) ? (' (shown as "' + current.description + '")') : '') + ', port ' + current.port) : 'not installed') + (permanent ? ', installed permanently' : '') + ', listening: ' + (server != null) + (queueBusy ? ', installing or removing' : ''));
    for (var i in sessions) { lines.push('User session: ' + sessions[i].username + ', refreshed ' + Math.round((now - sessions[i].time) / 1000) + ' seconds ago'); }
    if (sessionCount() == 0) { lines.push('No user sessions'); }
    lines.push('Jobs folder: ' + jobsFolder);
    lines.push('Recent events:');
    if (history.length == 0) { lines.push('  none'); }
    for (var i in history) { lines.push('  ' + history[i]); }
    return lines.join('\r\n');
}

// When the agent starts: install a printer installed with "remoteprint install" again, or remove one left behind by a
// previous run of the agent. ctx: { send(command), log(message, state) }
function agentStarted(ctx) {
    context = ctx;
    cleanup(onJob);
}

function getStatus() {
    return { supported: isSupported(), printer: current, permanent: permanent, listening: (server != null), busy: queueBusy, jobsFolder: jobsFolder, history: history.slice() };
}

module.exports = { handleMessage: handleMessage, consoleCommand: consoleCommand, agentStarted: agentStarted, start: start, stop: stop, getStatus: getStatus };
