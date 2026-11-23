// Install software packages on Linux from the Software tab.
// The package is downloaded from the MeshCentral server (see software-download.js, SHA384 checked) into a
// private temporary folder, then installed with the distribution package tool. Tools are started directly
// with an argument list, never through a shell, so no file name or user value is ever parsed by a shell.
//
// Supported kinds:
//   deb        apt-get install ./file.deb (resolves dependencies), or dpkg -i
//   rpm        dnf / yum / zypper install file.rpm, or rpm -U
//   flatpak    flatpak install --system --bundle file.flatpak
//   flatpakref flatpak install --system --from file.flatpakref
//   appimage   copied to /opt/AppImages with mode 0755
// installFlatpak(remote, appid) installs an application by id from a configured Flatpak remote (no upload).

var promise = require('promise');

var SYS_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
var TOOL_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];
var OUTPUT_MAX = 8192;
var RUN_TIMEOUT = 30 * 60 * 1000; // 30 minutes
var APPIMAGE_DIR = '/opt/AppImages';
var KIND_EXT = { deb: '.deb', rpm: '.rpm', flatpak: '.flatpak', flatpakref: '.flatpakref', appimage: '.AppImage' };

var _busy = false;

function findTool(names) {
    var fs = require('fs');
    for (var i = 0; i < names.length; i++) {
        for (var j = 0; j < TOOL_DIRS.length; j++) {
            var p = TOOL_DIRS[j] + '/' + names[i];
            try { if (fs.existsSync(p)) { return p; } } catch (e) { }
        }
    }
    return null;
}

// Run a program directly (no shell). Resolves with { code, output, timedOut }.
function run(path, args) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var output = '', timedOut = false, timer = null;
    var append = function (c) { output += c.toString(); if (output.length > (OUTPUT_MAX * 2)) { output = output.substring(output.length - OUTPUT_MAX); } };
    try {
        var env = { PATH: SYS_PATH, DEBIAN_FRONTEND: 'noninteractive', LANG: 'C', LC_ALL: 'C', HOME: '/root' };
        var child = require('child_process').execFile(path, [path.split('/').pop()].concat(args), { env: env });
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        timer = setTimeout(function () { timedOut = true; try { child.kill(); } catch (e) { } }, RUN_TIMEOUT);
        child.on('exit', function (code) {
            if (timer != null) { clearTimeout(timer); timer = null; }
            ret._res({ code: code, output: output.substring(Math.max(0, output.length - OUTPUT_MAX)), timedOut: timedOut });
        });
    } catch (ex) { if (timer != null) { clearTimeout(timer); } ret._rej(ex); }
    return ret;
}

// Pick the installer command for a package kind. Returns { tool, args } or null when no tool is available.
function installCommand(kind, file) {
    var t;
    switch (kind) {
        case 'deb':
            if ((t = findTool(['apt-get'])) != null) { return { tool: t, args: ['-y', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'install', file] }; }
            if ((t = findTool(['dpkg'])) != null) { return { tool: t, args: ['-i', file] }; }
            return null;
        case 'rpm':
            if ((t = findTool(['dnf', 'yum'])) != null) { return { tool: t, args: ['install', '-y', file] }; }
            if ((t = findTool(['zypper'])) != null) { return { tool: t, args: ['--non-interactive', 'install', file] }; }
            if ((t = findTool(['rpm'])) != null) { return { tool: t, args: ['-U', file] }; }
            return null;
        case 'flatpak':
            if ((t = findTool(['flatpak'])) != null) { return { tool: t, args: ['install', '--system', '-y', '--noninteractive', '--bundle', file] }; }
            return null;
        case 'flatpakref':
            if ((t = findTool(['flatpak'])) != null) { return { tool: t, args: ['install', '--system', '-y', '--noninteractive', '--from', file] }; }
            return null;
    }
    return null;
}

function toolMissing(kind) {
    switch (kind) {
        case 'deb': return 'No Debian package tool (apt-get or dpkg) found on this device';
        case 'rpm': return 'No RPM package tool (dnf, yum, zypper or rpm) found on this device';
        default: return 'Flatpak is not installed on this device';
    }
}

// Make a safe AppImage file name from the uploaded name
function appImageName(name) {
    var n = String(name || 'application').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[.-]+/, '');
    if (n.length == 0) { n = 'application'; }
    if (n.toLowerCase().endsWith('.appimage') == false) { n += '.AppImage'; }
    return n.substring(0, 200);
}

function removeDir(dir, file) {
    var fs = require('fs');
    try { fs.unlinkSync(file); } catch (e) { }
    try { fs.rmdirSync(dir); } catch (e) { }
}

// Download a package from the server and install it.
// options: { url, hash, kind, name, servertlshash, status: function(state) }
// Resolves with { code, success, result, tool, output, path }.
function installFromServer(options) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if (process.platform != 'linux') { ret._rej(new Error('Package install is only supported on Linux devices')); return ret; }
    if ((options == null) || (KIND_EXT[options.kind] == null)) { ret._rej(new Error('Unsupported package type')); return ret; }
    if (_busy) { ret._rej(new Error('A package installation is already in progress')); return ret; }

    var kind = options.kind, cmd = null;
    if (kind != 'appimage') {
        cmd = installCommand(kind, '/dev/null');
        if (cmd == null) { ret._rej(new Error(toolMissing(kind))); return ret; }
    } else if (findTool(['install']) == null) { ret._rej(new Error('coreutils "install" not found on this device')); return ret; }
    _busy = true;

    var fs = require('fs');
    var dir = '/var/tmp/meshcentral-pkg-' + Date.now().toString(36) + Math.floor(Math.random() * 0x7FFFFFFF).toString(36);
    var file = dir + '/' + ((kind == 'appimage') ? appImageName(options.name) : ('package' + KIND_EXT[kind]));
    var status = function (state) { if (typeof options.status == 'function') { try { options.status(state); } catch (e) { } } };
    var finish = function (err, result) { _busy = false; removeDir(dir, file); if (err) { ret._rej(err); } else { ret._res(result); } };

    try { fs.mkdirSync(dir); } catch (ex) { _busy = false; ret._rej(new Error('Unable to create ' + dir)); return ret; }
    status('downloading');
    require('software-download').download({ url: options.url, hash: options.hash, path: file, servertlshash: options.servertlshash }).then(function () {
        status('installing');
        if (kind == 'appimage') {
            var dest = APPIMAGE_DIR + '/' + appImageName(options.name);
            try { fs.mkdirSync(APPIMAGE_DIR); } catch (e) { } // Already exists is fine
            run(findTool(['install']), ['-m', '0755', file, dest]).then(function (r) {
                finish(null, { code: r.code, success: (r.code === 0), result: (r.code === 0) ? 'Installed' : 'Failed', tool: 'install', output: r.output, path: dest });
            }, function (e) { finish(e); });
            return;
        }
        cmd = installCommand(kind, file);
        run(cmd.tool, cmd.args).then(function (r) {
            finish(null, { code: r.code, success: ((r.code === 0) && !r.timedOut), result: r.timedOut ? 'TimedOut' : ((r.code === 0) ? 'Installed' : 'Failed'), tool: cmd.tool, output: r.output });
        }, function (e) { finish(e); });
    }, function (e) { finish(e); });
    return ret;
}

// Install a Flatpak application by id from a configured remote, for example ('flathub', 'org.mozilla.firefox').
function installFlatpak(remote, appid, status) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if (process.platform != 'linux') { ret._rej(new Error('Flatpak is only supported on Linux devices')); return ret; }
    if ((typeof remote != 'string') || (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(remote) == false)) { ret._rej(new Error('Invalid Flatpak remote')); return ret; }
    if ((typeof appid != 'string') || (/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){2,}(\/\/[A-Za-z0-9_.-]+)?$/.test(appid) == false) || (appid.length > 255)) { ret._rej(new Error('Invalid Flatpak application id')); return ret; }
    var tool = findTool(['flatpak']);
    if (tool == null) { ret._rej(new Error(toolMissing('flatpak'))); return ret; }
    if (_busy) { ret._rej(new Error('A package installation is already in progress')); return ret; }
    _busy = true;
    if (typeof status == 'function') { try { status('installing'); } catch (e) { } }
    run(tool, ['install', '--system', '-y', '--noninteractive', remote, appid]).then(function (r) {
        _busy = false;
        ret._res({ code: r.code, success: ((r.code === 0) && !r.timedOut), result: r.timedOut ? 'TimedOut' : ((r.code === 0) ? 'Installed' : 'Failed'), tool: tool, output: r.output });
    }, function (e) { _busy = false; ret._rej(e); });
    return ret;
}

function isBusy() { return _busy; }

module.exports = { installFromServer: installFromServer, installFlatpak: installFlatpak, isBusy: isBusy, appImageName: appImageName };
