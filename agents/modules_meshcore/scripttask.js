/** 
* @description MeshCentral ScriptTask plugin
* @author Ryan Blenis
* @copyright 
* @license Apache-2.0
*/

'use strict';
var mesh = require('MeshAgent');
var db = require('SimpleDataStore').Shared();
var pendingDownload = [];
var debug_flag = false;
var runningJobs = [];
var runningJobPIDs = {};

var dbg = function (str, sessionid) {
    if (debug_flag || sessionid) { sendConsoleText(str, sessionid); } sendConsoleText
    if (debug_flag !== true) return;
    var logStream = require('fs').createWriteStream('scripttask.txt', { 'flags': 'a' });
    // use {'flags': 'a'} to append and {'flags': 'w'} to erase and write a new file
    logStream.write(new Date().toLocaleString() + ': ' + str + '\n');
    logStream.end('\n');
}

Array.prototype.remove = function (from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = (from < 0) ? this.length + from : from;
    return this.push.apply(this, rest);
};

function processCommand(args, rights, sessionid) {
    switch (args.cmd) {
        case 'trigger':
            var jObj = {
                jobId: args.jobId,
                scriptId: args.scriptId,
                replaceVars: args.replaceVars,
                scriptHash: args.scriptHash,
                dispatchTime: args.dispatchTime
            };
            //dbg('jObj args is ' + JSON.stringify(jObj), sessionid);
            var sObj = getScriptFromCache(jObj.scriptId);
            //dbg('sobj = ' + JSON.stringify(sObj) + ', shash = ' + jObj.scriptHash, sessionid);
            if ((sObj == null) ||( sObj.contentHash != jObj.scriptHash)) {
                // Get from the server, then run
                //dbg('Getting and caching script '+ jObj.scriptId, sessionid);
                mesh.SendCommand({ 'action': 'scripttask', 'task': 'get', 'scriptId': jObj.scriptId, 'sessionid': sessionid });
                pendingDownload.push(jObj);
            } else {
                // Ready to run
                runScript(sObj, jObj, sessionid);
            }
            break;
        case 'set':
            var sObj = args.script;
            cacheScript(sObj);
            var setRun = [];
            if (pendingDownload.length) {
                pendingDownload.forEach(function (pd, k) {
                    if ((pd.scriptId == sObj._id) && (pd.scriptHash == sObj.contentHash)) {
                        if (setRun.indexOf(pd) === -1) {
                            runScript(sObj, pd, sessionid);
                            setRun.push(pd);
                        }
                        pendingDownload.remove(k);
                    }
                });
            }
            break;
        case 'clear':
            clearScriptCache();
            mesh.SendCommand({ 'action': 'scripttask', 'task': 'clear', 'sessionid': sessionid });
            return 'Cache cleared. All pending tasks cleared.';
        case 'clearcache':
            clearScriptCache();
            return 'The script cache has been cleared';
        case 'debug':
            debug_flag = (debug_flag) ? false : true;
            var str = (debug_flag) ? 'on' : 'off';
            return 'Debugging is now ' + str;
        case 'pending':
            var ret = '';
            if (pendingDownload.length == 0) return "No jobs pending script download";
            pendingDownload.forEach(function (pd, k) {
                ret += 'Task ' + k + ': ' + 'TaskID: ' + pd.jobId + ' ScriptID: ' + pd.scriptId;
            });
            return ret;
        default:
            if (sessionid == null) return;
            if (args['_'][0] == null) { return 'Supported task commands: pending, trigger, clear, clearcache, debug'; }
            return 'Unknown action: ' + args['_'][0] + ' with data ' + JSON.stringify(args);
    }
}

function finalizeJob(job, retVal, errVal, sessionid) {
    if (errVal != null && errVal.stack != null) errVal = errVal.stack;
    runningJobs.remove(runningJobs.indexOf(job.jobId));
    if (typeof runningJobPIDs[job.jobId] != 'undefined') delete runningJobPIDs[job.jobId];
    mesh.SendCommand({
        'action': 'scripttask',
        'task': 'complete',
        'jobId': job.jobId,
        'scriptId': job.scriptId,
        'retVal': retVal,
        'errVal': errVal,
        'dispatchTime': job.dispatchTime, // Include original run time (long running tasks could have tried a re-send)
        'sessionid': sessionid
    });
}

//@TODO Test powershell on *nix devices with and without powershell installed
function runPowerShell(sObj, jObj, sessionid) {
    if (process.platform != 'win32') return runPowerShellNonWin(sObj, jObj);
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');

    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.ps1';
    var pwshout = '', pwsherr = '', cancontinue = false;
    try {
        fs.writeFileSync(pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile(process.env['windir'] + '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo']);
        child.xxsessionid = sessionid;
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write('.\\' + pName + ' | Out-File ' + oName + ' -Encoding UTF8\r\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            dbg('Exiting with ' + procRetVal + ', Signal: ' + procRetSignal);
            if (errstr != '') {
                finalizeJob(jObj, null, errstr, this.xxsessionid);
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e, this.xxsessionid); }
                return;
            }
            if (procRetVal == 1) {
                finalizeJob(jObj, null, 'Process terminated unexpectedly.', this.xxsessionid);
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e, this.xxsessionid); }
                return;
            }
            try {
                outstr = fs.readFileSync(oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr, this.xxsessionid);
            finalizeJob(jObj, outstr, this.xxsessionid);
            try {
                fs.unlinkSync(oName);
                fs.unlinkSync(pName);
            } catch (e) { }
        });
        child.stdin.write('exit\r\n');
        //child.waitExit(); // this was causing the event loop to stall on long-running scripts, switched to '.on exit'
    } catch (e) {
        dbg('Error block was (PowerShell): ' + e, sessionid);
        finalizeJob(jObj, null, e, sessionid);
    }
}

function runPowerShellNonWin(sObj, jObj, sessionid) {
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');
    var path = '';
    var pathTests = [
        '/usr/local/mesh',
        '/tmp',
        '/usr/local/mesh_services/meshagent',
        '/var/tmp'
    ];
    pathTests.forEach(function (p) {
        if (path == '' && fs.existsSync(p)) { path = p; }
    });
    dbg('Path chosen is: ' + path, sessionid);
    path = path + '/';

    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.ps1';
    var pwshout = '', pwsherr = '', cancontinue = false;
    try {
        var childp = require('child_process').execFile('/bin/sh', ['sh']);
        childp.stderr.on('data', function (chunk) { pwsherr += chunk; });
        childp.stdout.on('data', function (chunk) { pwshout += chunk; });
        childp.stdin.write('which pwsh' + '\n');
        childp.stdin.write('exit\n');
        childp.waitExit();
    } catch (e) { finalizeJob(jObj, null, "Couldn't determine pwsh in env: " + e, sessionid); }
    if (pwsherr != '') {
        finalizeJob(jObj, null, "PowerShell env determination error: " + pwsherr, sessionid);
        return;
    }
    if (pwshout.trim() != '') {
        cancontinue = true;
    }
    if (cancontinue === false) { finalizeJob(jObj, null, "PowerShell is not installed"); return; }
    try {
        fs.writeFileSync(path + pName, '#!' + pwshout + '\n' + sObj.content.split('\r\n').join('\n').split('\r').join('\n'));
        var outstr = '', errstr = '';
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.xxsessionid = sessionid;
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write('cd ' + path + '\n');
        child.stdin.write('chmod a+x ' + pName + '\n');
        child.stdin.write('./' + pName + ' > ' + oName + '\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                finalizeJob(jObj, null, errstr);
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e + ' for path ' + path, this.xxsessionid); }
                return;
            }
            if (procRetVal == 1) {
                finalizeJob(jObj, null, 'Process terminated unexpectedly.');
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files1, error was: ' + e + ' for path ' + path, this.xxsessionid); }
                return;
            }
            try {
                outstr = fs.readFileSync(path + oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            finalizeJob(jObj, outstr);
            try {
                fs.unlinkSync(path + oName);
                fs.unlinkSync(path + pName);
            } catch (e) { dbg('Could not unlink files2, error was: ' + e + ' for path ' + path, this.xxsessionid); }
        });
        child.stdin.write('exit\n');
    } catch (e) {
        dbg('Error block was (PowerShellNonWin): ' + e, sessionid);
        finalizeJob(jObj, null, e, sessionid);
    }
}

function runBat(sObj, jObj, sessionid) {
    if (process.platform != 'win32') { finalizeJob(jObj, null, 'Platform not supported.', sessionid); return; }
    const fs = require('fs');
    var rand = Math.random().toString(32).replace('0.', '');
    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.bat';
    try {
        fs.writeFileSync(pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe');
        child.xxsessionid = sessionid;
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write(pName + ' > ' + oName + '\r\n');
        child.stdin.write('exit\r\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e, this.xxsessionid); }
                finalizeJob(jObj, null, errstr, this.xxsessionid);
                return;
            }
            if (procRetVal == 1) {
                try {
                    fs.unlinkSync(oName);
                    fs.unlinkSync(pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e, this.xxsessionid); }
                finalizeJob(jObj, null, 'Process terminated unexpectedly.', this.xxsessionid);
                return;
            }
            try {
                outstr = fs.readFileSync(oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            try {
                fs.unlinkSync(oName);
                fs.unlinkSync(pName);
            } catch (e) { dbg('Could not unlink files, error was: ' + e, this.xxsessionid); }
            finalizeJob(jObj, outstr, null, this.xxsessionid);
        });
    } catch (e) {
        dbg('Error block was (BAT): ' + e, sessionid);
        finalizeJob(jObj, null, e, sessionid);
    }
}

function runBash(sObj, jObj, sessionid) {
    if (process.platform == 'win32') {
        finalizeJob(jObj, null, 'Platform not supported.', sessionid);
        return;
    }
    //dbg('proc is ' + JSON.stringify(process));
    const fs = require('fs');
    var path = '';
    var pathTests = [
        '/usr/local/mesh',
        '/tmp',
        '/usr/local/mesh_services/meshagent',
        '/var/tmp'
    ];
    pathTests.forEach(function (p) {
        if (path == '' && fs.existsSync(p)) { path = p; }
    });
    dbg('Path chosen is: ' + path, sessionid);
    path = path + '/';
    //var child = require('child_process');
    //child.execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/c', 'RunDll32.exe user32.dll,LockWorkStation'], { type: 1 });

    var rand = Math.random().toString(32).replace('0.', '');
    var oName = 'st' + rand + '.txt';
    var pName = 'st' + rand + '.sh';
    try {
        fs.writeFileSync(path + pName, sObj.content);
        var outstr = '', errstr = '';
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.xxsessionid = sessionid;
        child.stderr.on('data', function (chunk) { errstr += chunk; });
        child.stdout.on('data', function (chunk) { });
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdin.write('cd ' + path + '\n');
        child.stdin.write('chmod a+x ' + pName + '\n');
        child.stdin.write('./' + pName + ' > ' + oName + '\n');
        child.stdin.write('exit\n');
        child.on('exit', function (procRetVal, procRetSignal) {
            if (errstr != '') {
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files, error was: ' + e + ' for path ' + path, this.xxsessionid); }
                finalizeJob(jObj, null, errstr, this.xxsessionid);
                return;
            }
            if (procRetVal == 1) {
                try {
                    fs.unlinkSync(path + oName);
                    fs.unlinkSync(path + pName);
                } catch (e) { dbg('Could not unlink files1, error was: ' + e + ' for path ' + path, this.xxsessionid); }
                finalizeJob(jObj, null, 'Process terminated unexpectedly.', this.xxsessionid);
                return;
            }
            try {
                outstr = fs.readFileSync(path + oName, 'utf8').toString();
            } catch (e) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
            if (outstr) {
                //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                try { outstr = outstr.trim(); } catch (e) { }
            } else {
                outstr = (procRetVal) ? 'Failure' : 'Success';
            }
            dbg('Output is: ' + outstr);
            try {
                fs.unlinkSync(path + oName);
                fs.unlinkSync(path + pName);
            } catch (e) { dbg('Could not unlink files2, error was: ' + e + ' for path ' + path, this.xxsessionid); }
            finalizeJob(jObj, outstr, null, this.xxsessionid);
        });
    } catch (e) {
        dbg('Error block was (bash): ' + e, sessionid);
        finalizeJob(jObj, null, e, sessionid);
    }
}

function jobIsRunning(jObj) {
    if (runningJobs.indexOf(jObj.jobId) === -1) return false;
    return true;
}

function runScript(sObj, jObj, sessionid) {
    // get current processes and clean running jobs if they are no longer running (computer fell asleep, user caused process to stop, etc.)
    if ((process.platform != 'linux') && runningJobs.length) { // linux throws errors here in the meshagent for some reason
        require('process-manager').getProcesses(function (plist) {
            dbg('Got process list', sessionid);
            dbg('There are currently ' + runningJobs.length + ' running jobs.', sessionid);
            if (runningJobs.length) {
                runningJobs.forEach(function (jobId, idx) {
                    dbg('Checking for running job: ' + jobId + ' with PID ' + runningJobPIDs[jobId], sessionid);
                    if (typeof plist[runningJobPIDs[jobId]] == 'undefined' || typeof plist[runningJobPIDs[jobId]].cmd != 'string') {
                        dbg('Found job with no process. Removing running status.', sessionid);
                        delete runningJobPIDs[jobId];
                        runningJobs.remove(runningJobs.indexOf(idx));
                        //dbg('RunningJobs: ' + JSON.stringify(runningJobs));
                        //dbg('RunningJobsPIDs: ' + JSON.stringify(runningJobPIDs));
                    }
                });
            }
        });
    }
    if (jobIsRunning(jObj)) { dbg('Job already running job id [' + jObj.jobId + ']. Skipping.', sessionid); return; }
    if (jObj.replaceVars != null) {
        Object.getOwnPropertyNames(jObj.replaceVars).forEach(function (key) {
            var val = jObj.replaceVars[key];
            sObj.content = sObj.content.replace(new RegExp('#' + key + '#', 'g'), val);
            dbg('replacing var ' + key + ' with ' + val, sessionid);
        });
        sObj.content = sObj.content.replace(new RegExp('#(.*?)#', 'g'), 'VAR_NOT_FOUND');
    }
    runningJobs.push(jObj.jobId);
    dbg('Running Script ' + sObj._id, sessionid);
    switch (sObj.filetype) {
        case 'ps1': runPowerShell(sObj, jObj, sessionid); break;
        case 'bat': runBat(sObj, jObj, sessionid); break;
        case 'bash': runBash(sObj, jObj, sessionid); break;
        default: dbg('Unknown filetype: ' + sObj.filetype, sessionid);
            break;
    }
}
function getScriptFromCache(id) {
    var script = db.Get('scriptTask_script_' + id);
    if (script == '' || script == null) return null;
    try { script = JSON.parse(script); } catch (e) { return null; }
    return script;
}
function cacheScript(sObj) {
    db.Put('scriptTask_script_' + sObj._id, sObj);
}
function clearScriptCache() {
    db.Keys.forEach(function (k) {
        if (k.indexOf('scriptTask_script_') === 0) {
            db.Put(k, null);
            db.Delete(k);
        }
    });
}

function sendConsoleText(text, sessionid) {
    require('MeshAgent').SendCommand({ 'action': 'msg', 'type': 'console', 'value': (typeof text == 'string') ? text : JSON.stringify(text), 'sessionid': sessionid });
}

module.exports = { processCommand: processCommand };