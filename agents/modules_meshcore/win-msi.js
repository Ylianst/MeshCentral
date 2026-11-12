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
// options: { url, hash (SHA384 hex), servertlshash, properties, status: function(state) }
// Resolves with { code, result, success, rebootRequired, log }.
function installFromServer(options) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if (_busy) { ret._rej(new Error('An MSI installation is already in progress')); return ret; }
    if ((options == null) || (typeof options.url != 'string') || (typeof options.hash != 'string')) { ret._rej(new Error('Invalid arguments')); return ret; }
    _busy = true;

    var base = (process.env['windir'] || 'C:\\Windows') + '\\Temp\\meshcentral-msi-' + Date.now().toString(36) + Math.floor(Math.random() * 0x7FFFFFFF).toString(36);
    var msiPath = base + '.msi', logPath = base + '.log';
    var status = function (state) { if (typeof options.status == 'function') { try { options.status(state); } catch (e) { } } };
    var finish = function (err, result) { _busy = false; removeFile(msiPath); if (err) { ret._rej(err); } else { ret._res(result); } };

    status('downloading');
    require('software-download').download({ url: options.url, hash: options.hash, path: msiPath, servertlshash: options.servertlshash }).then(function () {
        status('installing');
        var cmdLine = ((typeof options.properties == 'string') ? (options.properties + ' ') : '') + 'REBOOT=ReallySuppress';
        installProduct(msiPath, cmdLine, logPath).then(function (r) { r.log = logPath; finish(null, r); }, function (e) { finish(e); });
    }, function (e) { finish(e); });
    return ret;
}

function isBusy() { return _busy; }

module.exports = { installFromServer: installFromServer, installProduct: installProduct, isBusy: isBusy, resultName: resultName };
