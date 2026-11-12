// Install an MSI package in-process through the Windows Installer API (msi.dll).
// No msiexec.exe, cmd.exe or PowerShell process is launched by the agent, the Windows Installer
// service performs the installation. MsiInstallProductW blocks until the install is done, so it
// is called on a worker thread using _GenericMarshal async dispatch.

var promise = require('promise');

var INSTALLUILEVEL_NONE = 2;
// INSTALLLOGMODE_ FATALEXIT|ERROR|WARNING|USER|INFO|RESOLVESOURCE|OUTOFDISKSPACE|ACTIONSTART|ACTIONDATA|PROPERTYDUMP|COMMONDATA, same as "msiexec /l*"
var INSTALLLOGMODE_DEFAULT = 0x0FDF;

var MSI_RESULTS = {
    0: 'Success',
    1601: 'InstallServiceFailure',
    1602: 'UserExit',
    1603: 'InstallFailure',
    1605: 'UnknownProduct',
    1608: 'UnknownProperty',
    1618: 'InstallAlreadyRunning',
    1619: 'InstallPackageOpenFailed',
    1620: 'InstallPackageInvalid',
    1624: 'InstallTransformFailure',
    1625: 'InstallPackageRejected',
    1633: 'InstallPlatformUnsupported',
    1638: 'ProductVersion',
    1639: 'InvalidCommandLine',
    1641: 'SuccessRebootInitiated',
    1643: 'PatchPackageRejected',
    3010: 'SuccessRebootRequired'
};

var _msi = null;
var _busy = false;
var _request = null; // Keep a reference on the active download

function resultName(code) { return (MSI_RESULTS[code] != null) ? MSI_RESULTS[code] : ('Error' + code); }

function getMsi() {
    if (_msi == null) {
        _msi = require('_GenericMarshal').CreateNativeProxy('msi.dll');
        _msi.CreateMethod('MsiSetInternalUI');      // https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msisetinternalui
        _msi.CreateMethod('MsiEnableLogW');         // https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msienablelogw
        _msi.CreateMethod('MsiInstallProductW');    // https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msiinstallproductw
    }
    return _msi;
}

function removeFile(path) { try { require('fs').unlinkSync(path); } catch (e) { } }

// Install a local MSI file. Resolves with { code, result, success, rebootRequired }.
function installProduct(packagePath, commandLine, logPath) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    try {
        var GM = require('_GenericMarshal');
        var msi = getMsi();
        msi.MsiSetInternalUI(INSTALLUILEVEL_NONE, 0); // Fully silent, the service has no desktop to show UI on
        if (typeof logPath == 'string') { msi.MsiEnableLogW(INSTALLLOGMODE_DEFAULT, GM.CreateVariable(logPath, { wide: true }), 0); }
        var pathV = GM.CreateVariable(packagePath, { wide: true });
        var cmdV = GM.CreateVariable(commandLine || '', { wide: true });
        var p = msi.MsiInstallProductW.async(pathV, cmdV);
        p._args = [pathV, cmdV]; // Keep the strings alive while the worker thread uses them
        p.then(function (r) {
            var code = r.Val >>> 0;
            ret._res({ code: code, result: resultName(code), success: ((code == 0) || (code == 3010) || (code == 1641)), rebootRequired: ((code == 3010) || (code == 1641)) });
        }, function (e) { ret._rej(e); });
    } catch (ex) { ret._rej(ex); }
    return ret;
}

// Download an MSI from the MeshCentral server, check its SHA384 hash and install it.
// options: { url, hash (SHA384 hex), properties, status: function(state) }
// Resolves with { code, result, success, rebootRequired, log }.
function installFromServer(options) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if (_busy) { ret._rej(new Error('An MSI installation is already in progress')); return ret; }
    if ((options == null) || (typeof options.url != 'string') || (typeof options.hash != 'string')) { ret._rej(new Error('Invalid arguments')); return ret; }
    _busy = true;

    var fs = require('fs');
    var base = (process.env['windir'] || 'C:\\Windows') + '\\Temp\\meshcentral-msi-' + Date.now().toString(36) + Math.floor(Math.random() * 0x7FFFFFFF).toString(36);
    var msiPath = base + '.msi', logPath = base + '.log';
    var finished = false;

    function finish(err, result) {
        if (finished) return;
        finished = true;
        _busy = false;
        _request = null;
        removeFile(msiPath);
        if (err) { ret._rej(err); } else { ret._res(result); }
    }

    try {
        var opts = require('http').parseUri(options.url);
        opts.rejectUnauthorized = false;
        opts.checkServerIdentity = function checkServerIdentity(certs) {
            // Accept the server only if it presents the certificate used by the agent control channel
            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.digest == certs[0].digest) return; } catch (ex) { }
            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.fingerprint == certs[0].fingerprint) return; } catch (ex) { }
            if ((typeof options.servertlshash == 'string') && (certs[0].digest != null) && (options.servertlshash.toLowerCase() == certs[0].digest.split(':').join('').toLowerCase())) return;
            throw new Error('BadCert');
        }
        if (typeof options.status == 'function') { try { options.status('downloading'); } catch (e) { } }
        _request = require('https').get(opts);
        _request.on('error', function (e) { finish(new Error('Download failed: ' + e)); });
        _request.on('response', function (res) {
            if (res.statusCode != 200) { finish(new Error('Download failed, HTTP ' + res.statusCode)); return; }
            var hash = null, closed = false;
            var check = function () {
                if ((hash == null) || (closed == false) || finished) return;
                if (hash != options.hash.toLowerCase()) { finish(new Error('Downloaded package failed the hash check')); return; }
                if (typeof options.status == 'function') { try { options.status('installing'); } catch (e) { } }
                var cmdLine = ((typeof options.properties == 'string') ? (options.properties + ' ') : '') + 'REBOOT=ReallySuppress';
                installProduct(msiPath, cmdLine, logPath).then(function (r) { r.log = logPath; finish(null, r); }, function (e) { finish(e); });
            };
            try {
                var file = fs.createWriteStream(msiPath, { flags: 'wb' });
                var hasher = require('SHA384Stream').create();
                hasher.on('hash', function (h) { hash = h.toString('hex').toLowerCase(); check(); });
                file.on('close', function () { closed = true; check(); });
                res.pipe(file);
                res.pipe(hasher);
            } catch (ex) { finish(ex); }
        });
    } catch (ex) { finish(ex); }
    return ret;
}

function isBusy() { return _busy; }

module.exports = { installFromServer: installFromServer, installProduct: installProduct, isBusy: isBusy, resultName: resultName };
