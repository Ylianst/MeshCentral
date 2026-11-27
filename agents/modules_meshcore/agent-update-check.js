// Runs a downloaded agent file with -info before it replaces the running agent. Agent builds since August 2021 answer
// -info by printing their build details and "Agent ARCHID: N" and exiting, so a file built for another C library, a
// newer OS or another CPU fails here instead of after the update. The server bundles this module into the meshcore
// and the recovery cores, so every agent type and agent version runs the same check.

var timer = null;

// Calls func(error, archid). error is null when the file started and, if archids is given, reported one of them.
// Returns false, without calling func, when a check is already running.
function check(filename, archids, func) {
    var run = null, attempt = 0, wait = 0;
    if (timer != null) return false;
    function done(error, archid) {
        clearInterval(timer);
        timer = null;
        func(error, (archid != null) ? archid : null);
    }
    var name = filename.split(process.platform == 'win32' ? '\\' : '/').pop();
    // The Windows agent joins the arguments into one command line as they are, so a name with a space needs its quotes
    if (process.platform == 'win32') { name = '"' + name + '"'; }
    // Agents built before September 2026 drop a timer that nothing refers to, so the one timer that drives the check
    // is kept in this module. Its ticks, about two a second in this runtime, time the short waits and bound the 60
    // seconds read from the clock: a device with no clock battery sets its time once the network is up, which is when
    // updates run. A loader error can reach stderr after the exit, so the result is read a moment after it.
    timer = setInterval(function () {
        if (run == null) {
            if (wait > 0) { wait--; return; }
            var r = run = { output: '', code: null, started: Date.now(), ticks: 0, exited: 0 };
            attempt++;
            try {
                if (process.platform != 'win32') { require('fs').chmodSync(filename, require('fs').statSync(process.execPath).mode); }
                r.child = require('child_process').execFile(filename, [name, '-info']);
                r.child.stdout.on('data', function (c) { if (r.output.length < 8192) { r.output += c.toString(); } });
                r.child.stderr.on('data', function (c) { if (r.output.length < 8192) { r.output += c.toString(); } });
                r.child.on('exit', function (code) { r.code = code; });
            } catch (ex) {
                // Right after the download the file can still be busy, so an exec that fails is tried again before it counts
                if (attempt < 3) { run = null; wait = 4; return; }
                done('the file could not be started: ' + ex);
            }
            return;
        }
        if (run.code == null) {
            run.ticks++;
            if ((((Date.now() - run.started) < 60000) || (run.ticks < 60)) && (run.ticks < 480)) return;
            try { run.child.kill(); } catch (ex) { }
            done('the file did not finish within 60 seconds');
            return;
        }
        if (++run.exited < 3) return;
        // A busy file can also fail without a word, so a silent failure is tried again as well
        if ((run.code !== 0) && (run.output.trim() == '') && (attempt < 3)) { run = null; wait = 4; return; }
        // Agents built until September 2026 also report a process ended by a signal as exit code 0, so the ARCHID line
        // is what shows that the file really started.
        var match = /Agent ARCHID: (\d+)/.exec(run.output), archid = (match != null) ? parseInt(match[1]) : null, detail = run.output.trim().split('\n')[0];
        if (run.code !== 0) { done('the file did not start (exit code ' + run.code + ')' + (detail ? (': ' + detail) : ''), archid); return; }
        if (archid == null) { done('the file did not report an agent type'); return; }
        if ((archids != null) && (archids.indexOf(archid) < 0)) { done('the file is agent type ' + archid + ', not ' + archids.join(' or '), archid); return; }
        done(null, archid);
    }, 250);
    return true;
}

module.exports = { check: check };
