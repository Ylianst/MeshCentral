/** 
* @description MeshCentral Script-Task
* @author Ryan Blenis
* @copyright 
* @license Apache-2.0
*/

'use strict';
function CreateScriptTask(parent) {
    var obj = {};
    var db = require('SimpleDataStore').Shared();
    var pendingDownload = [];
    var debugFlag = false;
    var runningJobs = [];
    var runningJobPIDs = {};
    
    function dbg(str) {
        if (debugFlag !== true) return;
        var fs = require('fs');
        var logStream = fs.createWriteStream('scripttask.txt', { 'flags': 'a' });
        // use {'flags': 'a'} to append and {'flags': 'w'} to erase and write a new file
        logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
        logStream.end('\n');
    }

    function removeFromArray(arr, from, to) {
        var rest = arr.slice((to || from) + 1 || arr.length);
        arr.length = from < 0 ? arr.length + from : from;
        return arr.push.apply(arr, rest);
    };

    obj.consoleAction = function(args, rights, sessionid, interactive) {
        //sendConsoleText('task: ' + JSON.stringify(args), sessionid); // Debug

        /*
        if (typeof args['_'] == 'undefined') {
          args['_'] = [];
          args['_'][1] = args.pluginaction; // TODO
          args['_'][2] = null;
          args['_'][3] = null;
          args['_'][4] = null;
        }
        */

        var fnname = args['_'][0];
        if (fnname == null) { return "Valid task commands are: trigger, cache, clear, clearCache, debug, list"; }

        switch (fnname.toLowerCase()) {
            case 'trigger': {
                var jObj = {
                    jobId: args.jobId,
                    scriptId: args.scriptId,
                    replaceVars: args.replaceVars,
                    scriptHash: args.scriptHash,
                    dispatchTime: args.dispatchTime
                };
                //dbg('jObj args is ' + JSON.stringify(jObj));
                var sObj = getScriptFromCache(jObj.scriptId);
                //dbg('sobj = ' + JSON.stringify(sObj) + ', shash = ' + jObj.scriptHash);
                if ((sObj == null) || (sObj.contentHash != jObj.scriptHash)) {
                    // get from the server, then run
                    //dbg('Getting and caching script '+ jObj.scriptId);
                    parent.SendCommand({ action: 'script-task', subaction: 'getScript', scriptId: jObj.scriptId, sessionid: sessionid, tag: 'console' });
                    pendingDownload.push(jObj);
                } else {
                    // ready to run
                    runScript(sObj, jObj, sessionid);
                }
                break;
            }
            case 'cache': {
                var sObj = args.script;
                cacheScript(sObj);
                var setRun = [];
                if (pendingDownload.length) {
                    pendingDownload.forEach(function (pd, k) {
                        if ((pd.scriptId == sObj._id) && (pd.scriptHash == sObj.contentHash)) {
                            if (setRun.indexOf(pd) === -1) { runScript(sObj, pd, sessionid); setRun.push(pd); }
                            removeFromArray(pendingDownload, k);
                        }
                    });
                }
                break;
            }
            case 'clear': {
                clearCache();
                parent.SendCommand({ action: 'script-task', subaction: 'clearAllPendingTasks', sessionid: sessionid, tag: 'console' });
                return "Cache cleared. All pending tasks cleared.";
            }
            case 'clearcache': {
                clearCache();
                return "The script cache has been cleared";
            }
            case 'debug': {
                debugFlag = (debugFlag) ? false : true;
                var str = (debugFlag) ? 'on' : 'off';
                return 'Debugging is now ' + str;
            }
            case 'list': {
                var ret = '';
                if (pendingDownload.length == 0) return "No tasks pending script download";
                pendingDownload.forEach(function (pd, k) { ret += 'Task ' + k + ': ' + 'TaskID: ' + pd.jobId + ' ScriptID: ' + pd.scriptId + '\r\n'; });
                return ret;
            }
            default: {
                dbg('Unknown action: ' + fnname + ' with data ' + JSON.stringify(args));
                break;
            }
        }
    }

    function finalizeJob(job, retVal, errVal, sessionid) {
        if (errVal != null && errVal.stack != null) errVal = errVal.stack;
        removeFromArray(runningJobs, runningJobs.indexOf(job.jobId));
        if (typeof runningJobPIDs[job.jobId] != 'undefined') delete runningJobPIDs[job.jobId];
        parent.SendCommand({
            action: 'script-task',
            subaction: 'taskComplete',
            jobId: job.jobId,
            scriptId: job.scriptId,
            retVal: retVal,
            errVal: errVal,
            dispatchTime: job.dispatchTime, // include original run time (long running tasks could have tried a re-send)
            sessionid: sessionid,
            tag: 'console'
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
            child.stderr.on('data', function (chunk) { errstr += chunk; });
            child.stdout.on('data', function (chunk) { });
            runningJobPIDs[jObj.jobId] = child.pid;
            child.stdin.write('.\\' + pName + ' | Out-File ' + oName + ' -Encoding UTF8\r\n');
            child.on('exit', function (procRetVal, procRetSignal) {
                dbg('Exiting with ' + procRetVal + ', Signal: ' + procRetSignal);
                if (errstr != '') {
                    finalizeJob(jObj, null, errstr, sessionid);
                    try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex); }
                    return;
                }
                if (procRetVal == 1) {
                    finalizeJob(jObj, null, 'Process terminated unexpectedly.', sessionid);
                    try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex); }
                    return;
                }
                try { outstr = fs.readFileSync(oName, 'utf8').toString(); } catch (ex) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
                if (outstr) {
                    //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                    try { outstr = outstr.trim(); } catch (ex) { }
                } else {
                    outstr = (procRetVal) ? 'Failure' : 'Success';
                }
                dbg('Output is: ' + outstr);
                finalizeJob(jObj, outstr, null, sessionid);
                try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { }
            });
            child.stdin.write('exit\r\n');
            //child.waitExit(); // this was causing the event loop to stall on long-running scripts, switched to '.on exit'

        } catch (ex) {
            dbg('Error block was (PowerShell): ' + ex);
            finalizeJob(jObj, null, ex, sessionid);
        }
    }

    function runPowerShellNonWin(sObj, jObj, sessionid) {
        const fs = require('fs');
        var rand = Math.random().toString(32).replace('0.', '');

        var path = '';
        var pathTests = ['/usr/local/mesh', '/tmp', '/usr/local/mesh_services/meshagent', '/var/tmp'];
        pathTests.forEach(function (p) { if (path == '' && fs.existsSync(p)) { path = p; } });
        dbg('Path chosen is: ' + path);
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
        } catch (ex) { finalizeJob(jObj, null, "Couldn't determine pwsh in env: " + ex, sessionid); }
        if (pwsherr != '') { finalizeJob(jObj, null, "PowerShell env determination error: " + pwsherr, sessionid); return; }
        if (pwshout.trim() != '') { cancontinue = true; }
        if (cancontinue === false) { finalizeJob(jObj, null, "PowerShell is not installed", sessionid); return; }
        try {
            fs.writeFileSync(path + pName, '#!' + pwshout + '\n' + sObj.content.split('\r\n').join('\n').split('\r').join('\n'));
            var outstr = '', errstr = '';
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stderr.on('data', function (chunk) { errstr += chunk; });
            child.stdout.on('data', function (chunk) { });
            runningJobPIDs[jObj.jobId] = child.pid;

            child.stdin.write('cd ' + path + '\n');
            child.stdin.write('chmod a+x ' + pName + '\n');
            child.stdin.write('./' + pName + ' > ' + oName + '\n');
            child.on('exit', function (procRetVal, procRetSignal) {
                if (errstr != '') {
                    finalizeJob(jObj, null, errstr, sessionid);
                    try {
                        fs.unlinkSync(path + oName);
                        fs.unlinkSync(path + pName);
                    } catch (ex) { dbg('Could not unlink files, error was: ' + ex + ' for path ' + path); }
                    return;
                }
                if (procRetVal == 1) {
                    finalizeJob(jObj, null, 'Process terminated unexpectedly.', sessionid);
                    try {
                        fs.unlinkSync(path + oName);
                        fs.unlinkSync(path + pName);
                    } catch (ex) { dbg('Could not unlink files1, error was: ' + ex + ' for path ' + path); }
                    return;
                }
                try { outstr = fs.readFileSync(path + oName, 'utf8').toString(); } catch (es) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
                if (outstr) {
                    //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                    try { outstr = outstr.trim(); } catch (ex) { }
                } else {
                    outstr = (procRetVal) ? 'Failure' : 'Success';
                }
                dbg('Output is: ' + outstr);
                finalizeJob(jObj, outstr, null, sessionid);
                try { fs.unlinkSync(path + oName); fs.unlinkSync(path + pName); } catch (ex) { dbg('Could not unlink files2, error was: ' + ex + ' for path ' + path); }
            });
            child.stdin.write('exit\n');
        } catch (ex) {
            dbg('Error block was (PowerShellNonWin): ' + ex);
            finalizeJob(jObj, null, ex, sessionid);
        }
    }

    function runBat(sObj, jObj, sessionid) {
        if (process.platform != 'win32') { finalizeJob(jObj, null, "Platform not supported.", sessionid); return; }
        const fs = require('fs');
        var rand = Math.random().toString(32).replace('0.', '');
        var oName = 'st' + rand + '.txt';
        var pName = 'st' + rand + '.bat';
        try {
            fs.writeFileSync(pName, sObj.content);
            var outstr = '', errstr = '';
            var child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe');
            child.stderr.on('data', function (chunk) { errstr += chunk; });
            child.stdout.on('data', function (chunk) { });
            runningJobPIDs[jObj.jobId] = child.pid;
            child.stdin.write(pName + ' > ' + oName + '\r\n');
            child.stdin.write('exit\r\n');

            child.on('exit', function (procRetVal, procRetSignal) {
                if (errstr != '') {
                    try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex); }
                    finalizeJob(jObj, null, errstr, sessionid);
                    return;
                }
                if (procRetVal == 1) {
                    try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex); }
                    finalizeJob(jObj, null, 'Process terminated unexpectedly.', sessionid);
                    return;
                }
                try { outstr = fs.readFileSync(oName, 'utf8').toString(); } catch (ex) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
                if (outstr) {
                    //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                    try { outstr = outstr.trim(); } catch (ex) { }
                } else {
                    outstr = (procRetVal) ? 'Failure' : 'Success';
                }
                dbg('Output is: ' + outstr);
                try { fs.unlinkSync(oName); fs.unlinkSync(pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex); }
                finalizeJob(jObj, outstr, null, sessionid);
            });
        } catch (ex) {
            dbg('Error block was (BAT): ' + ex);
            finalizeJob(jObj, null, ex, sessionid);
        }
    }

    function runBash(sObj, jObj, sessionid) {
        if (process.platform == 'win32') { finalizeJob(jObj, null, "Platform not supported.", sessionid); return; }
        //dbg('proc is ' + JSON.stringify(process));
        const fs = require('fs');
        var path = '';
        var pathTests = ['/usr/local/mesh', '/tmp', '/usr/local/mesh_services/meshagent', '/var/tmp'];
        pathTests.forEach(function (p) {
            if (path == '' && fs.existsSync(p)) { path = p; }
        });
        dbg('Path chosen is: ' + path);
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
            child.stderr.on('data', function (chunk) { errstr += chunk; });
            child.stdout.on('data', function (chunk) { });
            runningJobPIDs[jObj.jobId] = child.pid;
            child.stdin.write('cd ' + path + '\n');
            child.stdin.write('chmod a+x ' + pName + '\n');
            child.stdin.write('./' + pName + ' > ' + oName + '\n');
            child.stdin.write('exit\n');

            child.on('exit', function (procRetVal, procRetSignal) {
                if (errstr != '') {
                    try { fs.unlinkSync(path + oName); fs.unlinkSync(path + pName); } catch (ex) { dbg('Could not unlink files, error was: ' + ex + ' for path ' + path); }
                    finalizeJob(jObj, null, errstr, sessionid);
                    return;
                }
                if (procRetVal == 1) {
                    try { fs.unlinkSync(path + oName); fs.unlinkSync(path + pName); } catch (ex) { dbg('Could not unlink files1, error was: ' + ex + ' for path ' + path); }
                    finalizeJob(jObj, null, "Process terminated unexpectedly.", sessionid);
                    return;
                }
                try { outstr = fs.readFileSync(path + oName, 'utf8').toString(); } catch (ex) { outstr = (procRetVal) ? 'Failure' : 'Success'; }
                if (outstr) {
                    //outstr = outstr.replace(/[^\x20-\x7E]/g, ''); 
                    try { outstr = outstr.trim(); } catch (ex) { }
                } else {
                    outstr = (procRetVal) ? 'Failure' : 'Success';
                }
                dbg('Output is: ' + outstr);
                try { fs.unlinkSync(path + oName); fs.unlinkSync(path + pName); } catch (ex) { dbg('Could not unlink files2, error was: ' + ex + ' for path ' + path); }
                finalizeJob(jObj, outstr, null, sessionid);
            });
        } catch (ex) {
            dbg('Error block was (bash): ' + ex);
            finalizeJob(jObj, null, ex, sessionid);
        }
    }

    function jobIsRunning(jObj) {
        if (runningJobs.indexOf(jObj.jobId) === -1) return false;
        return true;
    }

    function runScript(sObj, jObj, sessionid) {
        // get current processes and clean running jobs if they are no longer running (computer fell asleep, user caused process to stop, etc.)
        if (process.platform != 'linux' && runningJobs.length) { // linux throws errors here in the meshagent for some reason
            require('process-manager').getProcesses(function (plist) {
                dbg('Got process list');
                dbg('There are currently ' + runningJobs.length + ' running jobs.');
                if (runningJobs.length) {
                    runningJobs.forEach(function (jobId, idx) {
                        dbg('Checking for running job: ' + jobId + ' with PID ' + runningJobPIDs[jobId]);
                        if (typeof plist[runningJobPIDs[jobId]] == 'undefined' || typeof plist[runningJobPIDs[jobId]].cmd != 'string') {
                            dbg('Found job with no process. Removing running status.');
                            delete runningJobPIDs[jobId];
                            removeFromArray(runningJobs, runningJobs.indexOf(idx));
                            //dbg('RunningJobs: ' + JSON.stringify(runningJobs));
                            //dbg('RunningJobsPIDs: ' + JSON.stringify(runningJobPIDs));
                        }
                    });
                }
            });
        }
        if (jobIsRunning(jObj)) { dbg('Job already running job id [' + jObj.jobId + ']. Skipping.'); return; }
        if (jObj.replaceVars != null) {
            Object.getOwnPropertyNames(jObj.replaceVars).forEach(function (key) {
                var val = jObj.replaceVars[key];
                sObj.content = sObj.content.replace(new RegExp('#' + key + '#', 'g'), val);
                dbg('replacing var ' + key + ' with ' + val);
            });
            sObj.content = sObj.content.replace(new RegExp('#(.*?)#', 'g'), 'VAR_NOT_FOUND');
        }
        runningJobs.push(jObj.jobId);
        dbg('Running Script ' + sObj._id);
        switch (sObj.filetype) {
            case 'ps1': runPowerShell(sObj, jObj, sessionid); break;
            case 'bat': runBat(sObj, jObj, sessionid); break;
            case 'bash': runBash(sObj, jObj, sessionid); break;
            default: dbg('Unknown filetype: ' + sObj.filetype); break;
        }
    }

    function getScriptFromCache(id) {
        var script = db.Get('scriptTask_script_' + id);
        if (script == '' || script == null) return null;
        try { script = JSON.parse(script); } catch (ex) { return null; }
        return script;
    }

    function cacheScript(sObj) {
        db.Put('scriptTask_script_' + sObj._id, sObj);
    }

    function clearCache() {
        db.Keys.forEach(function (k) { if (k.indexOf('scriptTask_script_') === 0) { db.Put(k, null); db.Delete(k); } });
    }

    function sendConsoleText(text, sessionid) {
        if (typeof text == 'object') { text = JSON.stringify(text); }
        parent.SendCommand({ action: 'msg', type: 'console', value: 'XXX: ' + text, sessionid: sessionid });
    }
    
    return obj;
}

module.exports = { CreateScriptTask: CreateScriptTask };