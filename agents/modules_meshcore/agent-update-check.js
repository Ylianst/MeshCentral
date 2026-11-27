// Runs a downloaded agent file with -info before it replaces the running agent. Every agent build answers -info by
// printing its build details and "Agent ARCHID: N" and exiting, so a file built for another C library, a newer OS or
// another CPU fails here instead of after the update. The server bundles this module into the meshcore and the
// recovery cores, so every agent type and agent version runs the same check.

var timer = null;

// Calls func(error, archid). error is null when the file started and, if archids is given, reported one of them.
function check(filename, archids, func) {
    var run = null, attempt = 0, next = 0;
    if (timer != null) { func('another update check is running', null); return; }
    function done(error, archid) {
        clearInterval(timer);
        timer = null;
        func(error, (archid != null) ? archid : null);
    }
    // Agents built before September 2026 drop a timer that nothing refers to, so the one timer that drives the check
    // is kept in this module. A loader error can reach stderr after the exit, so the result is read a moment after it.
    timer = setInterval(function () {
        var now = Date.now();
        if (run == null) {
            if (now < next) return;
            var r = run = { output: '', code: null, started: now, exited: 0 };
            attempt++;
            try {
                if (process.platform != 'win32') { require('fs').chmodSync(filename, require('fs').statSync(process.execPath).mode); }
                r.child = require('child_process').execFile(filename, [filename.split(process.platform == 'win32' ? '\\' : '/').pop(), '-info']);
                r.child.stdout.on('data', function (c) { if (r.output.length < 8192) { r.output += c.toString(); } });
                r.child.stderr.on('data', function (c) { if (r.output.length < 8192) { r.output += c.toString(); } });
                r.child.on('exit', function (code) { r.code = code; r.exited = Date.now(); });
            } catch (ex) { done('the file could not be started: ' + ex); return; }
            return;
        }
        if ((run.code == null) && ((now - run.started) < 60000)) return;
        if ((run.code != null) && ((now - run.exited) < 500)) return;
        if (run.code == null) { try { run.child.kill(); } catch (ex) { } done('the file did not finish within 60 seconds'); return; }
        // Right after the download the file can still be busy, which fails without a word, so a silent failure is tried
        // again before it counts.
        if ((run.code !== 0) && (run.output.trim() == '') && (attempt < 3)) { run = null; next = now + 1000; return; }
        // Agents built before September 2026 also report a process ended by a signal as exit code 0, so the ARCHID line
        // is what shows that the file really started.
        var match = /Agent ARCHID: (\d+)/.exec(run.output), archid = (match != null) ? parseInt(match[1]) : null, detail = run.output.trim().split('\n')[0];
        if (run.code !== 0) { done('the file did not start (exit code ' + run.code + ')' + (detail ? (': ' + detail) : ''), archid); return; }
        if (archid == null) { done('the file did not report an agent type'); return; }
        if ((archids != null) && (archids.indexOf(archid) < 0)) { done('the file is agent type ' + archid + ', not ' + archids.join(' or '), archid); return; }
        done(null, archid);
    }, 250);
}

module.exports = { check: check };
