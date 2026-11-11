/**
* @description MeshCentral mass deployment engine. Pushes files to, and runs Windows Command Prompt,
*              Windows PowerShell and Linux/BSD/macOS shell scripts on, many devices at once and tracks
*              the result of every device.
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
'use strict';

// This engine only uses agent commands that every agent already supports:
//   - 'runcommands' with reply:true, the agent runs cmd.exe, powershell.exe or /bin/sh with hidden stdio pipes
//     (no console window, nothing written to disk), feeds the script on stdin and returns the output when it exits.
//   - 'wget', the agent fetches a file from the server over HTTPS and writes it to disk.
// No change to the agent or to the agent core is required.
//
// To stay friendly with anti-virus software, scripts are never written to a temporary file, never base64 encoded
// and never passed through -EncodedCommand. PowerShell scripts are rebuilt from plain single-quoted string literals
// so AMSI sees the script as-is, CMD scripts are typed into cmd.exe line by line and shell scripts are passed to
// the shell through a quoted here-document.

module.exports.CreateMeshDeploy = function (parent) {
    const obj = {};
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const common = require('./common.js');
    const server = parent.parent; // The main MeshCentral object

    // Device rights
    const MESHRIGHT_REMOTECONTROL = 0x00000008;
    const MESHRIGHT_NOFILES = 0x00000400;
    const MESHRIGHT_REMOTECOMMAND = 0x00020000;
    const MESHRIGHT_ADMIN = 0xFFFFFFFF;

    // Limits
    const MAX_NODES = 10000;            // Maximum devices in one job
    const MAX_FILES = 25;               // Maximum files in one job
    const MAX_SCRIPT = 256 * 1024;      // Maximum size of one script
    const MAX_OUTPUT = 128 * 1024;      // Output kept per device, the tail is kept
    const MAX_JOBS_PER_USER = 25;       // Jobs kept in the history of each user
    const JOB_KEEP_MS = 24 * 60 * 60 * 1000;     // Finished jobs are kept for 24 hours
    const STAGE_KEEP_MS = 2 * 60 * 60 * 1000;    // Uploaded files not used by a job are removed after 2 hours
    const HELPER_TIMEOUT_MS = 2 * 60 * 1000;     // Timeout of the folder preparation and file check steps
    const FETCH_START_MS = 4 * 60 * 1000;        // The agent must start the download within this time (cookie lasts 5 min)
    const FILES_IN_FLIGHT = 2;          // Files downloaded at the same time by one agent (the agent allows 4)
    const TICK_MS = 15 * 1000;

    // Windows agent types, same list as isWindowsNode() in the web UI
    const WINDOWS_AGENTS = [1, 2, 3, 4, 21, 22, 34, 42, 43];

    // Command types, same values as the existing 'runcommands' command
    const TYPE_CMD = 1, TYPE_POWERSHELL = 2, TYPE_SHELL = 3;

    // Terminal target states
    const DONE_STATES = ['success', 'warning', 'failed', 'offline', 'skipped', 'cancelled', 'timeout'];

    const jobs = {};                    // jobid -> job
    const staged = {};                  // fileid -> staged file
    const busyNodes = {};               // nodeid -> target currently using this node
    var notifyTimer = null;
    var tickTimer = null;

    obj.stagePath = path.resolve(path.join(server.filespath, 'tmp'));

    //
    // Helpers
    //

    function randomId(len) { return crypto.randomBytes(len).toString('hex'); }
    function isWindowsAgent(node) { return (node != null) && (node.agent != null) && (WINDOWS_AGENTS.indexOf(node.agent.id) >= 0); }
    function isDone(target) { return DONE_STATES.indexOf(target.state) >= 0; }
    function debug(msg) { try { server.debug('meshdeploy', msg); } catch (ex) { } }

    // Remove the old part of a long output and keep the end
    function trimOutput(s) {
        if (typeof s != 'string') return '';
        if (s.length > MAX_OUTPUT) { s = '[... ' + (s.length - MAX_OUTPUT) + ' characters removed ...]\n' + s.substring(s.length - MAX_OUTPUT); }
        return s;
    }

    // Check a destination folder. Windows: absolute drive path. Others: absolute path.
    function checkWinFolder(p) {
        if (typeof p != 'string') return null;
        p = p.trim().split('/').join('\\');
        if ((p.length < 3) || (p.length > 240) || !/^[a-zA-Z]:\\/.test(p)) return null;
        if (/["%*?<>|\x00-\x1f]/.test(p.substring(2))) return null; // Characters cmd.exe can't safely quote
        while ((p.length > 3) && p.endsWith('\\')) { p = p.substring(0, p.length - 1); }
        return p;
    }
    function checkPosixFolder(p) {
        if (typeof p != 'string') return null;
        p = p.trim();
        if ((p.length < 1) || (p.length > 1024) || (p[0] != '/') || /[\x00-\x1f]/.test(p)) return null;
        while ((p.length > 1) && p.endsWith('/')) { p = p.substring(0, p.length - 1); }
        return p;
    }
    function winJoin(dir, name) { return dir.endsWith('\\') ? (dir + name) : (dir + '\\' + name); }
    function posixJoin(dir, name) { return dir.endsWith('/') ? (dir + name) : (dir + '/' + name); }

    // Quote for POSIX shell: 'abc' with ' written as '\''
    function shQuote(s) { return "'" + String(s).split("'").join("'\\''") + "'"; }

    // Quote for a PowerShell single quoted string. PowerShell also treats the typographic single quotes as quotes.
    function psQuote(s) { return "'" + String(s).replace(/['‘’‚‛]/g, function (c) { return c + c; }) + "'"; }

    //
    // Script builders, these produce the text the agent writes to the stdin of the shell
    //

    // Markers are written so that the marker never appears in the text of the command itself, only in its output.
    // This matters when running as a user on Linux where a terminal echoes the input.
    const MARK_BEGIN = '__MDBEGIN__', MARK_EXIT = '__MDEXIT__', MARK_STAT = '__MDSTAT__', MARK_DIR = '__MDDIR__';

    // Windows Command Prompt. Lines are typed into an interactive cmd.exe, with echo off.
    function buildCmd(script, env) {
        var lines = ['@echo off'];
        for (var i in env) { lines.push('set "' + i + '=' + env[i] + '"'); }
        lines.push('echo __MD^BEGIN__');
        // In a .bat file %% is a single %, but cmd.exe reading from stdin works like a console where % is used.
        lines.push(script.replace(/\r\n|\r/g, '\n').split('%%').join('%').split('\n').join('\r\n'));
        lines.push('echo.');
        lines.push('echo __MD^EXIT__:%ERRORLEVEL%:0');
        return lines.join('\r\n');
    }

    // Windows PowerShell. The script is rebuilt from plain single-quoted lines into a script block. This avoids the
    // line by line limits of "powershell -command -" with multi-line statements, without base64 or temporary files.
    function buildPowerShell(script, env) {
        var pre = [];
        for (var i in env) { pre.push('$env:' + i + '=' + psQuote(env[i]) + ';'); }
        var lines = script.replace(/\r\n|\r/g, '\n').split('\n');
        var quoted = [];
        for (var i = 0; i < lines.length; i++) { quoted.push(psQuote(lines[i])); }
        return 'try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{};$ProgressPreference=\'SilentlyContinue\';' + pre.join('') +
            'Write-Output (\'__MD\'+\'BEGIN__\');$global:LASTEXITCODE=0;$Error.Clear();$__mdx=0;' +
            'try{& ([ScriptBlock]::Create(@(' + quoted.join(',') + ') -join "`n")) | Out-String -Stream -Width 4096}' +
            'catch{$__mdx=1;Write-Output (\'ERROR: \'+$_.Exception.Message)};' +
            'if(($LASTEXITCODE -ne $null) -and ($LASTEXITCODE -ne 0)){$__mdx=$LASTEXITCODE};' +
            'Write-Output (\'\'+\'__MD\'+\'EXIT__:\'+$__mdx+\':\'+$Error.Count)';
    }

    // Find the interpreter to use from a #! line, only simple interpreter paths are accepted.
    function getInterpreter(script) {
        var m = /^#!\s*([^\r\n]*)/.exec(script);
        if (m == null) return '/bin/sh -s';
        var parts = m[1].trim().split(/\s+/);
        if ((parts.length == 0) || (parts.length > 3)) return '/bin/sh -s';
        for (var i in parts) { if (!/^[A-Za-z0-9_.\/+=-]+$/.test(parts[i])) return '/bin/sh -s'; }
        var name = parts[parts.length - 1].split('/').pop();
        if (['sh', 'bash', 'dash', 'zsh', 'ksh', 'mksh', 'ash', 'busybox'].indexOf(name) >= 0) return parts.join(' ') + ' -s';
        return parts.join(' ') + ' -';
    }

    // Linux, BSD, macOS. The script is given to the shell using a quoted here-document, so nothing is expanded or written to disk.
    function buildShell(script, env) {
        script = script.replace(/\r\n|\r/g, '\n');
        if (!script.endsWith('\n')) { script += '\n'; }
        var eof = '__MD_EOF_' + randomId(8) + '__';
        var lines = [];
        for (var i in env) { lines.push(i + '=' + shQuote(env[i]) + '; export ' + i); }
        lines.push('echo "__MD""BEGIN__"');
        lines.push(getInterpreter(script) + " 2>&1 <<'" + eof + "'");
        return lines.join('\n') + '\n' + script + eof + '\necho "__MD""EXIT__:$?:0"';
    }

    // Build a command that optionally creates the destination folder and gets the size of each file (-1 if missing)
    function buildStat(target, job, createFolder) {
        var files = job.spec.files;
        if (target.os == 'win') {
            var dir = target.folder, lines = ['@echo off', 'echo __MD^BEGIN__'];
            var dirx = winJoin(dir, '');
            if (createFolder) { lines.push('if not exist "' + dirx + '" mkdir "' + dir + '" >nul 2>&1'); }
            lines.push('if exist "' + dirx + '" (echo __MD^DIR__:1) else (echo __MD^DIR__:0)');
            for (var i = 0; i < files.length; i++) {
                var f = winJoin(dir, files[i].name);
                lines.push('if exist "' + f + '" (for %F in ("' + f + '") do @echo __MD^STAT__:' + i + ':%~zF) else (echo __MD^STAT__:' + i + ':-1)');
            }
            lines.push('echo __MD^EXIT__:0:0');
            return { type: TYPE_CMD, cmds: lines.join('\r\n') };
        } else {
            var dir = target.folder, lines = ['echo "__MD""BEGIN__"'];
            if (createFolder) { lines.push('mkdir -p ' + shQuote(dir) + ' >/dev/null 2>&1'); }
            lines.push('if [ -d ' + shQuote(dir) + ' ]; then echo "__MD""DIR__:1"; else echo "__MD""DIR__:0"; fi');
            for (var i = 0; i < files.length; i++) {
                var f = shQuote(posixJoin(dir, files[i].name));
                lines.push('if [ -f ' + f + ' ]; then echo "__MD""STAT__:' + i + ':$(wc -c < ' + f + ' | tr -d \' \')"; else echo "__MD""STAT__:' + i + ':-1"; fi');
            }
            lines.push('echo "__MD""EXIT__:0:0"');
            return { type: TYPE_SHELL, cmds: lines.join('\n') };
        }
    }

    // Parse the output of a command: keep what is between the begin and exit markers.
    function parseResult(raw) {
        var s = (typeof raw == 'string') ? raw : '';
        s = s.split('\r\n').join('\n');
        var r = { output: '', exitCode: null, errors: 0, stats: {}, dir: null, complete: false };
        var b = s.indexOf(MARK_BEGIN + '\n');
        if (b >= 0) { s = s.substring(b + MARK_BEGIN.length + 1); }
        var re = new RegExp(MARK_EXIT + ':(-?\\d+):(\\d+)'), m = re.exec(s);
        if (m != null) {
            r.exitCode = parseInt(m[1]);
            r.errors = parseInt(m[2]);
            r.complete = true;
            s = s.substring(0, m.index);
        }
        // Read the stat and folder markers, and remove them from the output
        var out = [], lines = s.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var ms = new RegExp('^\\s*' + MARK_STAT + ':(\\d+):(-?\\d*)').exec(lines[i]);
            if (ms != null) { r.stats[parseInt(ms[1])] = (ms[2] === '') ? 0 : parseInt(ms[2]); continue; }
            var md = new RegExp('^\\s*' + MARK_DIR + ':(\\d)').exec(lines[i]);
            if (md != null) { r.dir = (md[1] == '1'); continue; }
            out.push(lines[i]);
        }
        r.output = out.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
        return r;
    }

    //
    // Staged files, uploaded by the browser to the server before the job is created
    //

    // Called by the web server with files received in a multipart post, each { name, size, tempPath }.
    // The files are moved into the server temporary folder. Calls func(err, [{ id, name, size }]).
    obj.stageFiles = function (user, domain, files, func) {
        try { fs.mkdirSync(server.filespath); } catch (ex) { }
        try { fs.mkdirSync(obj.stagePath); } catch (ex) { }
        var r = [], pending = files.length, failed = false;
        if (pending == 0) { func(null, r); return; }
        for (var i in files) {
            const f = files[i], id = randomId(16), tmpname = 'md-' + id, dest = path.join(obj.stagePath, tmpname);
            const done = function (err) {
                if (err) { failed = true; fs.unlink(f.tempPath, function () { }); }
                else { staged[id] = { id: id, userid: user._id, domainid: domain.id, name: f.name, size: f.size, tmpname: tmpname, time: Date.now(), refs: 0 }; r.push({ id: id, name: f.name, size: f.size }); }
                if (--pending > 0) return;
                startTick();
                if (failed) { for (var j in r) { staged[r[j].id].refs = 1; releaseFile(r[j].id); } func('Unable to store the uploaded file'); return; }
                func(null, r);
            }
            fs.rename(f.tempPath, dest, function (err) {
                if (err && (err.code === 'EXDEV')) {
                    // Different file system, copy and remove the original
                    common.copyFile(f.tempPath, dest, function (err2) { fs.unlink(f.tempPath, function () { }); done(err2); });
                } else { done(err); }
            });
        }
    }

    function releaseFile(id) {
        const f = staged[id];
        if (f == null) return;
        if (--f.refs > 0) return;
        delete staged[id];
        fs.unlink(path.join(obj.stagePath, f.tmpname), function () { });
    }

    //
    // Job creation
    //

    // Create a job. args: user, domain, sessionid, req (for the audit), command (from the browser), func(err, job)
    obj.createJob = function (user, domain, req, command, func) {
        if ((command == null) || (typeof command != 'object')) { func('Invalid request'); return; }
        if (common.validateStrArray(command.nodeids, 1, 256) == false) { func('Invalid device list'); return; }
        if (command.nodeids.length > MAX_NODES) { func('Too many devices'); return; }

        // Files
        var files = [];
        if (command.files != null) {
            if (common.validateStrArray(command.files, 1, 64) == false) { func('Invalid file list'); return; }
            if (command.files.length > MAX_FILES) { func('Too many files'); return; }
            for (var i in command.files) {
                const f = staged[command.files[i]];
                if ((f == null) || (f.userid != user._id) || (f.domainid != domain.id)) { func('Uploaded file expired, upload it again'); return; }
                for (var j in files) { if (files[j].name.toLowerCase() == f.name.toLowerCase()) { func('Two files have the same name: ' + f.name); return; } }
                files.push(f);
            }
        }

        // Destination folders
        var winPath = null, linuxPath = null;
        if (files.length > 0) {
            if ((command.winPath != null) && (command.winPath !== '')) { winPath = checkWinFolder(command.winPath); if (winPath == null) { func('Invalid Windows folder'); return; } }
            if ((command.linuxPath != null) && (command.linuxPath !== '')) { linuxPath = checkPosixFolder(command.linuxPath); if (linuxPath == null) { func('Invalid Linux/macOS folder'); return; } }
            for (var i in files) {
                if ((winPath != null) && /[%"]/.test(files[i].name)) { func('File name not supported on Windows: ' + files[i].name); return; }
            }
        }

        // Scripts
        var winScript = null, linuxScript = null, winType = TYPE_POWERSHELL;
        if (typeof command.winScript == 'string' && command.winScript.trim() != '') { winScript = command.winScript; }
        if (typeof command.linuxScript == 'string' && command.linuxScript.trim() != '') { linuxScript = command.linuxScript; }
        if ((winScript != null) && (winScript.length > MAX_SCRIPT)) { func('Windows script is too large'); return; }
        if ((linuxScript != null) && (linuxScript.length > MAX_SCRIPT)) { func('Linux/macOS script is too large'); return; }
        if (command.winType === TYPE_CMD) { winType = TYPE_CMD; }
        if ((files.length == 0) && (winScript == null) && (linuxScript == null)) { func('Nothing to deploy, add files or a command'); return; }

        // Options
        var runAsUser = ([0, 1, 2].indexOf(command.runAsUser) >= 0) ? command.runAsUser : 0;
        var timeout = (typeof command.timeout == 'number') ? Math.min(Math.max(Math.floor(command.timeout), 1), 240) : 15; // Minutes
        var concurrency = (typeof command.concurrency == 'number') ? Math.min(Math.max(Math.floor(command.concurrency), 1), 500) : 50;
        var waitOffline = (typeof command.waitOffline == 'number') ? Math.min(Math.max(command.waitOffline, 0), 24) : 0; // Hours
        var name = (typeof command.name == 'string') ? command.name.substring(0, 128).trim() : '';

        const job = {
            id: randomId(8),
            userid: user._id,
            username: user.name,
            domainid: domain.id,
            created: Date.now(),
            finished: null,
            state: 'running',
            name: name,
            clientip: (req != null) ? req.clientIp : null,
            tokenName: ((req != null) && (req.session != null) && (user._id === req.session.userid)) ? req.session.tokenName : null,
            tokenUser: ((req != null) && (req.session != null) && (user._id === req.session.userid)) ? req.session.tokenUser : null,
            spec: {
                files: files.map(function (f) { return { id: f.id, name: f.name, size: f.size, tmpname: f.tmpname }; }),
                winPath: winPath, linuxPath: linuxPath,
                overwrite: (command.overwrite === true), createFolder: (command.createFolder !== false),
                winScript: winScript, winType: winType, linuxScript: linuxScript,
                runAsUser: runAsUser, timeout: timeout, concurrency: concurrency, waitOffline: waitOffline,
                waitUntil: (waitOffline > 0) ? (Date.now() + (waitOffline * 3600000)) : 0
            },
            targets: [],
            seq: 0
        };
        for (var i in files) { files[i].refs++; }
        if (job.name == '') { job.name = defaultJobName(job); }

        // Resolve all devices and rights
        var pending = command.nodeids.length, seen = {};
        const onNode = function (nodeid, node, rights, visible) {
            if ((node != null) && (visible === true) && (seen[node._id] == null)) {
                seen[node._id] = 1;
                var t = { idx: job.targets.length, nodeid: node._id, meshid: node.meshid, name: node.name, os: isWindowsAgent(node) ? 'win' : 'posix', rights: rights, state: 'queued', detail: '', step: null, exitCode: null, errors: 0, output: null, started: null, ended: null, files: null };
                if (node.agent == null) { t.state = 'skipped'; t.detail = 'No agent on this device'; }
                else { checkTarget(job, t); }
                job.targets.push(t);
            }
            if (--pending > 0) return;
            if (job.targets.length == 0) { for (var i in files) { releaseFile(files[i].id); } func('No devices found'); return; }
            jobs[job.id] = job;
            trimUserJobs(job.userid);
            debug('Job ' + job.id + ' created by ' + user._id + ' for ' + job.targets.length + ' device(s)');
            func(null, job);
            pump(job);
            notify(job, null);
            startTick();
        }
        for (var i in command.nodeids) {
            var nodeid = command.nodeids[i];
            if (nodeid.indexOf('/') == -1) { nodeid = 'node/' + domain.id + '/' + nodeid; }
            (function (nodeid) { parent.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) { onNode(nodeid, node, rights, visible); }); })(nodeid);
        }
    }

    // Check that the user has the rights and that there is something to do on this device
    function checkTarget(job, t) {
        const spec = job.spec;
        var script = (t.os == 'win') ? spec.winScript : spec.linuxScript;
        var folder = (t.os == 'win') ? spec.winPath : spec.linuxPath;
        var doFiles = (spec.files.length > 0) && (folder != null);
        if ((doFiles == false) && (script == null)) { t.state = 'skipped'; t.detail = (t.os == 'win') ? 'Nothing to do on Windows devices' : 'Nothing to do on Linux/macOS devices'; return; }
        if ((script != null) && ((t.rights & MESHRIGHT_REMOTECOMMAND) == 0)) { t.state = 'skipped'; t.detail = 'No rights to run commands'; return; }
        if (doFiles && (((t.rights & MESHRIGHT_REMOTECONTROL) == 0) || ((t.rights != MESHRIGHT_ADMIN) && ((t.rights & MESHRIGHT_NOFILES) != 0)))) { t.state = 'skipped'; t.detail = 'No rights to push files'; return; }
        // Checking files on the device and creating the folder runs a command, this needs the run commands right.
        if (doFiles && ((t.rights & MESHRIGHT_REMOTECOMMAND) == 0)) { t.state = 'skipped'; t.detail = 'Pushing files needs the run commands right'; return; }
        t.folder = doFiles ? folder : null;
        t.script = script;
    }

    function defaultJobName(job) {
        var s = job.spec, parts = [];
        if (s.files.length == 1) { parts.push(s.files[0].name); } else if (s.files.length > 1) { parts.push(s.files.length + ' files'); }
        if ((s.winScript != null) || (s.linuxScript != null)) {
            var first = ((s.winScript != null) ? s.winScript : s.linuxScript).split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return (x != '') && !x.startsWith('#') && !x.startsWith('::') && !x.toLowerCase().startsWith('rem ') && !x.startsWith('@echo'); })[0];
            parts.push((first != null) ? first.substring(0, 60) : 'Script');
        }
        return parts.join(' + ');
    }

    // Keep the history of each user under the limit
    function trimUserJobs(userid) {
        var list = [];
        for (var i in jobs) { if (jobs[i].userid == userid) { list.push(jobs[i]); } }
        if (list.length <= MAX_JOBS_PER_USER) return;
        list.sort(function (a, b) { return a.created - b.created; });
        for (var i = 0; (i < list.length) && (list.length - i > MAX_JOBS_PER_USER); i++) { if (list[i].state != 'running') { removeJob(list[i]); } }
    }

    function removeJob(job) {
        delete jobs[job.id];
        for (var i in job.spec.files) { releaseFile(job.spec.files[i].id); }
    }

    //
    // Job execution
    //

    // How is this device reachable: 'local', 'peer' or null if offline
    function getRoute(nodeid) {
        const agent = parent.wsagents[nodeid];
        if ((agent != null) && (agent.authenticated == 2)) return 'local';
        if ((server.multiServer != null) && (server.GetRoutingServerIdNotSelf(nodeid, 1) != null)) return 'peer';
        return null;
    }

    // Start as many targets as allowed by the job concurrency
    function pump(job) {
        if (job.state != 'running') return;
        var active = 0, now = Date.now();
        for (var i in job.targets) { var t = job.targets[i]; if ((t.state != 'queued') && (t.state != 'waiting') && !isDone(t)) { active++; } }
        for (var i in job.targets) {
            if (active >= job.spec.concurrency) break;
            var t = job.targets[i];
            if ((t.state != 'queued') && (t.state != 'waiting')) continue;
            if (busyNodes[t.nodeid] != null) continue; // Another job is using this device, try again later
            var route = getRoute(t.nodeid);
            if (route == null) {
                if (now < job.spec.waitUntil) {
                    if (t.state != 'waiting') { t.state = 'waiting'; t.detail = 'Waiting for the device to come online'; notify(job, t); }
                } else {
                    finish(job, t, 'offline', 'Device is offline');
                }
                continue;
            }
            if ((route == 'peer') && (t.folder != null)) { finish(job, t, 'failed', 'Device is connected to a peer server, files can only be pushed from that server'); continue; }
            active++;
            startTarget(job, t);
        }
        checkJobDone(job);
    }

    function startTarget(job, t) {
        busyNodes[t.nodeid] = t;
        t.started = Date.now();
        t.detail = '';
        if (t.folder != null) { prepareFiles(job, t); } else { runScript(job, t); }
    }

    // Send a command to the agent and wait for the reply
    function sendCommand(job, t, type, cmds, runAsUser, timeoutMs, func) {
        const rid = 'meshdeploy:' + job.id + ':' + t.idx + ':' + (++job.seq);
        const msg = { action: 'runcommands', type: type, cmds: cmds, runAsUser: runAsUser, reply: true, responseid: rid, sessionid: 'meshdeploy' };
        t.pending = { rid: rid, func: func, timer: setTimeout(function () { if ((t.pending != null) && (t.pending.rid == rid)) { t.pending = null; func(null); } }, timeoutMs) };
        var route = getRoute(t.nodeid);
        if (route == 'local') {
            try { parent.wsagents[t.nodeid].send(JSON.stringify(msg)); } catch (ex) { }
        } else if (route == 'peer') {
            server.multiServer.DispatchMessage({ action: 'agentCommand', nodeid: t.nodeid, command: msg });
        } else {
            clearTimeout(t.pending.timer); t.pending = null; func(null, 'offline');
        }
    }

    // Called by the web server when an agent replies to a 'runcommands' with a responseid from this engine. Returns true if this server owns the job.
    obj.handleAgentReply = function (nodeid, command) {
        if ((command == null) || (typeof command.responseid != 'string')) return false;
        const split = command.responseid.split(':');
        if ((split.length != 4) || (split[0] != 'meshdeploy')) return false;
        const job = jobs[split[1]];
        if (job == null) return false;
        const t = job.targets[parseInt(split[2])];
        if ((t == null) || (t.nodeid != nodeid)) return true; // Not the device this command was sent to, ignore it
        if ((t.pending == null) || (t.pending.rid != command.responseid)) return true; // Late or unknown reply
        const p = t.pending;
        t.pending = null;
        clearTimeout(p.timer);
        p.func((typeof command.result == 'string') ? command.result : '');
        return true;
    }

    // Is this a reply for the mass deploy engine
    obj.isDeployReply = function (command) { return (command != null) && (command.type == 'runcommands') && (typeof command.responseid == 'string') && command.responseid.startsWith('meshdeploy:'); }

    // Step 1: create the folder and look at what files are already on the device
    function prepareFiles(job, t) {
        t.state = 'preparing'; t.step = 'Preparing folder'; notify(job, t);
        var c = buildStat(t, job, job.spec.createFolder);
        sendCommand(job, t, c.type, c.cmds, 0, HELPER_TIMEOUT_MS, function (result, err) {
            if (job.state != 'running') return;
            if (result == null) { finish(job, t, (err == 'offline') ? 'offline' : 'timeout', (err == 'offline') ? 'Device went offline' : 'No reply from the device while preparing the folder'); return; }
            var r = parseResult(result);
            if (r.dir !== true) { finish(job, t, 'failed', job.spec.createFolder ? 'Unable to create the destination folder ' + t.folder : 'Destination folder ' + t.folder + ' does not exist', r.output); return; }
            t.files = [];
            for (var i = 0; i < job.spec.files.length; i++) {
                var size = r.stats[i];
                if ((typeof size == 'number') && (size >= 0) && (job.spec.overwrite == false)) { t.files.push({ state: 'exists', size: size }); }
                else { t.files.push({ state: 'pending' }); }
            }
            uploadFiles(job, t);
        });
    }

    // Step 2: ask the agent to download the files from the server
    function uploadFiles(job, t) {
        if ((job.state != 'running') || isDone(t)) return;
        var inflight = 0, next = [];
        for (var i in t.files) {
            var f = t.files[i];
            if ((f.state == 'sent') || (f.state == 'transferring')) { inflight++; }
            if (f.state == 'pending') { next.push(parseInt(i)); }
            if (f.state == 'error') { finish(job, t, 'failed', 'Upload of ' + job.spec.files[i].name + ' failed: ' + f.error); return; }
        }
        if ((inflight == 0) && (next.length == 0)) { verifyFiles(job, t); return; }
        t.state = 'uploading';
        var done = 0; for (var i in t.files) { if ((t.files[i].state == 'delivered') || (t.files[i].state == 'exists')) { done++; } }
        t.step = 'Pushing files (' + done + '/' + t.files.length + ')';
        notify(job, t);

        var tlsCertHash = null;
        if ((server.args.ignoreagenthashcheck == null) || (server.args.ignoreagenthashcheck === false)) {
            tlsCertHash = parent.webCertificateFullHashs[job.domainid];
            if (tlsCertHash != null) { tlsCertHash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
        }
        const user = parent.users[job.userid];
        const agent = parent.wsagents[t.nodeid];
        if ((agent == null) || (user == null)) { finish(job, t, 'failed', 'Device went offline'); return; }

        while ((inflight < FILES_IN_FLIGHT) && (next.length > 0)) {
            const i = next.shift(), file = job.spec.files[i], tf = t.files[i];
            const cookie = server.encodeCookie({ a: 'tmpdl', d: job.domainid, nid: t.nodeid, f: file.tmpname, mdj: job.id, mdt: t.idx, mdf: i }, server.loginCookieEncryptionKey);
            const dest = (t.os == 'win') ? winJoin(t.folder, file.name) : posixJoin(t.folder, file.name);
            // Overwrite is always set here, the policy was applied in the prepare step. createFolder is handled in the prepare step.
            const acmd = { action: 'wget', userid: user._id, username: user.name, realname: user.realname, remoteaddr: job.clientip, rights: t.rights, overwrite: true, createFolder: false, urlpath: '/agentdownload.ashx?c=' + cookie, path: dest, folder: t.folder, servertlshash: tlsCertHash };
            tf.state = 'sent';
            tf.timer = setTimeout(function () { if (tf.state == 'sent') { tf.state = 'error'; tf.error = 'the device did not download the file'; uploadFiles(job, t); } }, FETCH_START_MS);
            try { agent.send(JSON.stringify(acmd)); } catch (ex) { }
            inflight++;
        }
    }

    // Called by the web server when an agent requests a file of a job. Sends the file and tracks progress.
    obj.handleFileRequest = function (c, res) {
        const job = jobs[c.mdj], t = (job != null) ? job.targets[c.mdt] : null, tf = ((t != null) && (t.files != null)) ? t.files[c.mdf] : null;
        const file = (job != null) ? job.spec.files[c.mdf] : null;
        if ((tf == null) || (file == null) || (t.nodeid != c.nid) || (file.tmpname != c.f) || (tf.state != 'sent') || isDone(t)) { res.sendStatus(404); return; }
        tf.state = 'transferring';
        clearTimeout(tf.timer);
        res.sendFile(path.join(obj.stagePath, file.tmpname), function (err) {
            if (err && !res.headersSent) { try { res.sendStatus(404); } catch (ex) { } }
            if (tf.state != 'transferring') return;
            if (err) { tf.state = 'error'; tf.error = 'transfer interrupted'; } else { tf.state = 'delivered'; }
            uploadFiles(job, t);
        });
    }

    // Step 3: check the files are on the device with the right size
    function verifyFiles(job, t, attempt) {
        if (attempt == null) { attempt = 1; }
        t.state = 'verifying'; t.step = 'Checking files'; notify(job, t);
        var c = buildStat(t, job, false);
        sendCommand(job, t, c.type, c.cmds, 0, HELPER_TIMEOUT_MS, function (result, err) {
            if (job.state != 'running') return;
            if (result == null) { finish(job, t, (err == 'offline') ? 'offline' : 'timeout', 'No reply from the device while checking the files'); return; }
            var r = parseResult(result), bad = [];
            for (var i = 0; i < job.spec.files.length; i++) {
                var tf = t.files[i];
                if (tf.state == 'exists') continue;
                if (r.stats[i] !== job.spec.files[i].size) { bad.push(job.spec.files[i].name + ((r.stats[i] == -1) ? ' (not written)' : (' (size ' + r.stats[i] + ' instead of ' + job.spec.files[i].size + ')'))); }
            }
            if (bad.length > 0) {
                // The device may still be writing the end of a file, check again a few times
                if (attempt < 4) { setTimeout(function () { if ((job.state == 'running') && !isDone(t)) { verifyFiles(job, t, attempt + 1); } }, attempt * 3000); return; }
                finish(job, t, 'failed', 'File check failed: ' + bad.join(', '));
                return;
            }

            // Event that files where pushed to this device
            var sent = 0; for (var i in t.files) { if (t.files[i].state == 'delivered') { sent++; } }
            if (sent > 0) {
                auditEvent(job, t, { action: 'batchupload', msg: 'Performing batch upload of ' + sent + ' file(s) to ' + t.folder, msgid: 103, msgArgs: [sent, t.folder] });
            }
            if (t.script != null) { runScript(job, t); }
            else {
                var skipped = t.files.length - sent;
                finish(job, t, 'success', (skipped > 0) ? (sent + ' file(s) pushed, ' + skipped + ' already present') : (sent + ' file(s) pushed'));
            }
        });
    }

    // Step 4: run the script
    function runScript(job, t) {
        const spec = job.spec;
        var env = {};
        if (t.folder != null) {
            env.MD_PATH = t.folder;
            if (spec.files.length > 0) { env.MD_FILE = (t.os == 'win') ? winJoin(t.folder, spec.files[0].name) : posixJoin(t.folder, spec.files[0].name); }
        }
        var type, cmds;
        if (t.os == 'win') {
            type = spec.winType;
            cmds = (type == TYPE_CMD) ? buildCmd(t.script, env) : buildPowerShell(t.script, env);
        } else {
            type = TYPE_SHELL;
            cmds = buildShell(t.script, env);
        }
        t.state = 'running'; t.step = 'Running command'; notify(job, t);

        // Event that commands are run on this device, same as the run commands event
        var msgid = 24; // "Running commands"
        if (spec.runAsUser == 1) { msgid = 100; } // "Running commands as user if possible"
        if (spec.runAsUser == 2) { msgid = 99; } // "Running commands as user"
        auditEvent(job, t, { action: 'runcommands', msg: 'Running commands', msgid: msgid, cmds: t.script, cmdType: type, runAsUser: spec.runAsUser });

        sendCommand(job, t, type, cmds, spec.runAsUser, spec.timeout * 60000, function (result, err) {
            if (job.state != 'running') return;
            if (result == null) {
                if (err == 'offline') { finish(job, t, 'offline', 'Device went offline'); return; }
                var d = 'No result after ' + spec.timeout + ' minute(s)';
                if (spec.runAsUser == 2) { d += ', no user may be logged in'; }
                finish(job, t, 'timeout', d + '. The command may still be running on the device.');
                return;
            }
            var r = parseResult(result);
            t.exitCode = r.exitCode;
            t.errors = r.errors;
            if (r.complete == false) { finish(job, t, 'warning', 'Completed, the script ended the shell so the exit code is unknown', r.output); }
            else if (r.exitCode != 0) { finish(job, t, 'failed', 'Exit code ' + r.exitCode, r.output); }
            else if (r.errors > 0) { finish(job, t, 'warning', 'Completed with ' + r.errors + ' error(s)', r.output); }
            else { finish(job, t, 'success', 'Completed', r.output); }
        });
    }

    function auditEvent(job, t, e) {
        try {
            var event = Object.assign({ etype: 'node', userid: job.userid, username: job.username, nodeid: t.nodeid, domain: job.domainid }, e);
            if ((job.tokenName != null) && (job.tokenUser != null)) { event.tokenName = job.tokenName; event.tokenUser = job.tokenUser; }
            var targets = parent.CreateNodeDispatchTargets(t.meshid, t.nodeid, ['server-users', job.userid]);
            server.DispatchEvent(targets, obj, event);
        } catch (ex) { }
    }

    function finish(job, t, state, detail, output) {
        if (isDone(t)) return;
        if (t.pending != null) { clearTimeout(t.pending.timer); t.pending = null; }
        if (t.files != null) { for (var i in t.files) { if (t.files[i].timer) { clearTimeout(t.files[i].timer); delete t.files[i].timer; } } }
        t.state = state;
        t.step = null;
        if (detail != null) { t.detail = detail; }
        if (output != null) { t.output = trimOutput(output); }
        t.ended = Date.now();
        if (busyNodes[t.nodeid] === t) { delete busyNodes[t.nodeid]; schedulePump(null); } // Another job may be waiting for this device
        notify(job, t);
        schedulePump(job);
    }

    // Pump later, at most once per event loop turn for each job
    var pumpQueue = null;
    function schedulePump(job) {
        if (pumpQueue == null) {
            pumpQueue = {};
            setImmediate(function () {
                const q = pumpQueue; pumpQueue = null;
                if (q['*'] === true) { pumpAll(); return; }
                for (var i in q) { pump(q[i]); }
            });
        }
        if (job == null) { pumpQueue['*'] = true; } else { pumpQueue[job.id] = job; }
    }

    function checkJobDone(job) {
        if (job.state != 'running') return;
        for (var i in job.targets) { if (!isDone(job.targets[i])) return; }
        job.state = 'done';
        job.finished = Date.now();
        debug('Job ' + job.id + ' done');
        notify(job, null);
    }

    function pumpAll() { for (var i in jobs) { if (jobs[i].state == 'running') { pump(jobs[i]); } } }

    // Cancel a job, devices that already received the command will complete it.
    obj.cancelJob = function (job) {
        if (job.state != 'running') return;
        for (var i in job.targets) {
            var t = job.targets[i];
            if (isDone(t)) continue;
            finish(job, t, 'cancelled', (t.state == 'running') ? 'Cancelled, the command may still complete on the device' : 'Cancelled');
        }
        job.state = 'cancelled';
        job.finished = Date.now();
        notify(job, null);
    }

    //
    // Periodic work: devices waiting to come online, agents that disconnected, clean up.
    //

    function startTick() { if (tickTimer == null) { tickTimer = setInterval(tick, TICK_MS); } }

    function tick() {
        var now = Date.now(), any = false;
        for (var i in jobs) {
            var job = jobs[i];
            if (job.state == 'running') {
                any = true;
                for (var j in job.targets) {
                    var t = job.targets[j];
                    // Agent disconnected while working on this device
                    if ((['preparing', 'uploading', 'verifying'].indexOf(t.state) >= 0) && (getRoute(t.nodeid) == null)) { finish(job, t, 'failed', 'Device went offline'); }
                }
                pump(job);
            } else if ((job.finished != null) && ((now - job.finished) > JOB_KEEP_MS)) {
                removeJob(job);
            } else {
                any = true;
            }
        }
        for (var i in staged) {
            any = true;
            if ((staged[i].refs == 0) && ((now - staged[i].time) > STAGE_KEEP_MS)) { staged[i].refs = 1; releaseFile(i); }
        }
        if (!any) { clearInterval(tickTimer); tickTimer = null; }
    }

    //
    // Notifications to the browser
    //

    function notify(job, t) {
        if (job.dirty == null) { job.dirty = {}; }
        if (t != null) { job.dirty[t.idx] = 1; } else { job.dirtyJob = true; }
        if (notifyTimer == null) { notifyTimer = setTimeout(flush, 300); }
    }

    function flush() {
        notifyTimer = null;
        for (var i in jobs) {
            var job = jobs[i];
            if ((job.dirty == null) && (job.dirtyJob !== true)) continue;
            var targets = [];
            for (var j in job.dirty) { targets.push(targetSummary(job.targets[j])); }
            delete job.dirty; delete job.dirtyJob;
            server.DispatchEvent([job.userid], obj, { action: 'meshdeploy', op: 'update', job: jobSummary(job), targets: targets, domain: job.domainid, nolog: 1 });
        }
    }

    function targetSummary(t) {
        var r = { idx: t.idx, nodeid: t.nodeid, name: t.name, os: t.os, state: t.state, detail: t.detail, step: t.step, exitCode: t.exitCode, errors: t.errors, started: t.started, ended: t.ended, hasOutput: ((t.output != null) && (t.output.length > 0)) };
        if (t.files != null) { r.files = t.files.map(function (f) { return f.state; }); }
        return r;
    }

    function jobSummary(job) {
        var counts = {};
        for (var i in job.targets) { var st = job.targets[i].state; counts[st] = (counts[st] || 0) + 1; }
        const s = job.spec;
        return {
            id: job.id, name: job.name, state: job.state, created: job.created, finished: job.finished, total: job.targets.length, counts: counts,
            files: s.files.map(function (f) { return { name: f.name, size: f.size }; }), winPath: s.winPath, linuxPath: s.linuxPath, overwrite: s.overwrite,
            winScript: s.winScript, winType: s.winType, linuxScript: s.linuxScript, runAsUser: s.runAsUser, timeout: s.timeout, concurrency: s.concurrency, waitOffline: s.waitOffline
        };
    }

    //
    // Browser requests, called from meshuser.js for the 'meshdeploy' action
    //

    obj.handleUserCommand = function (user, domain, req, ws, command) {
        const reply = function (x) { x.action = 'meshdeploy'; x.op = command.op; if (command.responseid != null) { x.responseid = command.responseid; } try { ws.send(JSON.stringify(x)); } catch (ex) { } };
        const getJob = function () { const job = jobs[command.jobid]; if ((job == null) || (job.userid != user._id)) { reply({ result: 'Job not found' }); return null; } return job; };
        switch (command.op) {
            case 'create': {
                obj.createJob(user, domain, req, command, function (err, job) {
                    if (err) { reply({ result: err }); return; }
                    reply({ result: 'OK', job: jobSummary(job), targets: job.targets.map(targetSummary) });
                });
                break;
            }
            case 'list': {
                var list = [];
                for (var i in jobs) { if (jobs[i].userid == user._id) { list.push(jobSummary(jobs[i])); } }
                list.sort(function (a, b) { return b.created - a.created; });
                reply({ result: 'OK', jobs: list });
                break;
            }
            case 'get': {
                const job = getJob(); if (job == null) return;
                reply({ result: 'OK', job: jobSummary(job), targets: job.targets.map(targetSummary) });
                break;
            }
            case 'output': {
                const job = getJob(); if (job == null) return;
                const t = job.targets[command.idx];
                if (t == null) { reply({ result: 'Device not found' }); return; }
                reply({ result: 'OK', jobid: job.id, idx: t.idx, output: t.output || '' });
                break;
            }
            case 'cancel': {
                const job = getJob(); if (job == null) return;
                obj.cancelJob(job);
                reply({ result: 'OK', jobid: job.id });
                break;
            }
            case 'remove': {
                const job = getJob(); if (job == null) return;
                if (job.state == 'running') { reply({ result: 'Job is still running' }); return; }
                removeJob(job);
                reply({ result: 'OK', jobid: job.id });
                break;
            }
            case 'retry': {
                // Create a new job with the same settings for the devices that did not succeed
                const job = getJob(); if (job == null) return;
                const states = Array.isArray(command.states) ? command.states : ['failed', 'timeout', 'offline', 'cancelled', 'warning'];
                var nodeids = [];
                for (var i in job.targets) { if (states.indexOf(job.targets[i].state) >= 0) { nodeids.push(job.targets[i].nodeid); } }
                if (nodeids.length == 0) { reply({ result: 'No devices to retry' }); return; }
                for (var i in job.spec.files) { if (staged[job.spec.files[i].id] == null) { reply({ result: 'Uploaded files expired, start a new deployment' }); return; } }
                const s = job.spec;
                const c = { nodeids: nodeids, files: s.files.map(function (f) { return f.id; }), winPath: s.winPath, linuxPath: s.linuxPath, overwrite: s.overwrite, createFolder: s.createFolder, winScript: s.winScript, winType: s.winType, linuxScript: s.linuxScript, runAsUser: s.runAsUser, timeout: s.timeout, concurrency: s.concurrency, waitOffline: s.waitOffline, name: 'Retry: ' + job.name };
                obj.createJob(user, domain, req, c, function (err, newjob) {
                    if (err) { reply({ result: err }); return; }
                    reply({ result: 'OK', job: jobSummary(newjob), targets: newjob.targets.map(targetSummary) });
                });
                break;
            }
            default: { reply({ result: 'Unknown operation' }); break; }
        }
    }

    // Exposed for testing
    obj._test = { buildCmd: buildCmd, buildPowerShell: buildPowerShell, buildShell: buildShell, buildStat: buildStat, parseResult: parseResult, getInterpreter: getInterpreter, checkWinFolder: checkWinFolder, checkPosixFolder: checkPosixFolder, jobs: jobs, staged: staged };

    return obj;
};
