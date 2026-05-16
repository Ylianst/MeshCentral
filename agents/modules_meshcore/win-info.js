/*
Copyright 2019-2020 Intel Corporation

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

var promise = require('promise');

// We use the environment variable directly or the standard Windows path
var psPath = (process.env['SystemRoot'] ? process.env['SystemRoot'] : 'C:\\Windows') + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function qfe()
{
    try {
        var tokens = require('win-wmi').query('ROOT\\CIMV2', 'SELECT * FROM Win32_QuickFixEngineering');
        if (tokens[0]){
            for (var index = 0; index < tokens.length; index++) {
                for (var key in tokens[index]) {
                    if (key.startsWith('__')) delete tokens[index][key];
                }
            }
            return (tokens);
        } else {
            return ([]);
        }
    } catch (ex) {
        return ([]);
    }
}
function av()
{
    var result = [];
    try { 
        var tokens = require('win-wmi-fixed').query('ROOT\\SecurityCenter2', 'SELECT * FROM AntiVirusProduct');
        if (tokens.length == 0) { return ([]); }
        // Process each antivirus product
        for (var i = 0; i < tokens.length; ++i) {
            var product = tokens[i];
            var modifiedPath = product.pathToSignedProductExe || '';
            // Expand environment variables (e.g., %ProgramFiles%)
            var regex = /%([^%]+)%/g;
            var match;
            while ((match = regex.exec(product.pathToSignedProductExe)) !== null) {
                var envVar = match[1];
                var envValue = process.env[envVar] || '';
                if (envValue) {
                    modifiedPath = modifiedPath.replace(match[0], envValue);
                }
            }
            // Check if the executable exists (unless it's Windows Defender pseudo-path)
            var flag = true;
            if (modifiedPath !== 'windowsdefender://') {
                try {
                    if (!require('fs').existsSync(modifiedPath)) {
                        flag = false;
                    }
                } catch (ex) {
                    flag = false;
                }
            }
            // Only include products with valid executables
            if (flag) {
                var status = {};
                status.product = product.displayName || '';
                status.updated = (parseInt(product.productState) & 0x10) == 0;
                status.enabled = (parseInt(product.productState) & 0x1000) == 0x1000;
                result.push(status);
            }
        }
        return (result);
    } catch (ex) {
        return ([]);
    }
}
function defrag(options)
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    var path = '';

    switch(require('os').arch())
    {
        case 'x64':
            if (require('_GenericMarshal').PointerSize == 4)
            {
                // 32 Bit App on 64 Bit Windows
                ret._rej('Cannot defrag volume on 64 bit Windows from 32 bit application');
                return (ret);
            }
            else
            {
                // 64 Bit App
                path = process.env['windir'] + '\\System32\\defrag.exe';
            }
            break;
        case 'ia32':
            // 32 Bit App on 32 Bit Windows
            path = process.env['windir'] + '\\System32\\defrag.exe';
            break;
        default:
            ret._rej(require('os').arch() + ' not supported');
            return (ret);
            break;
    }

    ret.child = require('child_process').execFile(process.env['windir'] + '\\System32\\defrag.exe', ['defrag', options.volume + ' /A']);
    ret.child.promise = ret;
    ret.child.promise.options = options;
    ret.child.stdout.str = ''; ret.child.stdout.on('data', function (c) { this.str += c.toString(); });
    ret.child.stderr.str = ''; ret.child.stderr.on('data', function (c) { this.str += c.toString(); });
    ret.child.on('exit', function (code)
    {
        var lines = this.stdout.str.trim().split('\r\n');
        var obj = { volume: this.promise.options.volume };
        for (var i in lines)
        {
            var token = lines[i].split('=');
            if(token.length == 2)
            {
                switch(token[0].trim().toLowerCase())
                {
                    case 'volume size':
                        obj['size'] = token[1];
                        break;
                    case 'free space':
                        obj['free'] = token[1];
                        break;
                    case 'total fragmented space':
                        obj['fragmented'] = token[1];
                        break;
                    case 'largest free space size':
                        obj['largestFragment'] = token[1];
                        break;
                }               
            }
        }
        this.promise._res(obj);
    });
    return (ret);
}
function regQuery(H, Path, Key)
{
    try
    {
        return(require('win-registry').QueryKey(H, Path, Key));
    }
    catch(e)
    {
        return (null);
    }
}
function pendingReboot()
{
    var tmp = null;
    var ret = null;
    var HKEY = require('win-registry').HKEY;
    if(regQuery(HKEY.LocalMachine, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing', 'RebootPending') !=null)
    {
        ret = 'Component Based Servicing';
    }
    else if(regQuery(HKEY.LocalMachine, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate', 'RebootRequired'))
    {
        ret = 'Windows Update';
    }
    else if ((tmp=regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager', 'PendingFileRenameOperations'))!=null && tmp != 0 && tmp != '')
    {
        ret = 'File Rename';
    }
    else if (regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ActiveComputerName', 'ComputerName') != regQuery(HKEY.LocalMachine, 'SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ComputerName', 'ComputerName'))
    {
        ret = 'System Rename';
    }
    return (ret);
}

function installedApps() {
    var registry = require('win-registry');
    var HKEY = registry.HKEY;
    var results = [];
    
    var registryPaths = [
        'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ];

    try {
        for (var i in registryPaths) {
            var path = registryPaths[i];
            
            // Wir nutzen direkt die Registry-Komponente für die Unterschlüssel
            var keyInfo = registry.QueryKey(HKEY.LocalMachine, path);
            
            // Falls QueryKey fehlschlägt oder keine Subkeys hat, überspringen
            if (!keyInfo || !keyInfo.subkeys) continue;

            for (var j = 0; j < keyInfo.subkeys.length; j++) {
                var subPath = path + '\\' + keyInfo.subkeys[j];
                
                // Wir nutzen deine im Modul definierte regQuery Funktion!
                // Diese ist sicher, da sie try-catch bereits enthält.
                var name = regQuery(HKEY.LocalMachine, subPath, 'DisplayName');
                
                if (name && name != '') {
                    results.push({
                        name: name,
                        version: regQuery(HKEY.LocalMachine, subPath, 'DisplayVersion') || '',
                        publisher: regQuery(HKEY.LocalMachine, subPath, 'Publisher') || '',
                        uninstall: regQuery(HKEY.LocalMachine, subPath, 'QuietUninstallString') || 
                                   regQuery(HKEY.LocalMachine, subPath, 'UninstallString') || ''
                    });
                }
            }
        }
    } catch (e) {
        // Stille Fehlerbehandlung für maximale Stabilität im Agenten
    }

    // Das Promise-Mirror Objekt für MeshCentral Kompatibilität
    return {
        data: results,
        then: function(cb) { if (typeof cb === 'function') cb(this.data); return this; },
        catch: function(cb) { return this; },
        finally: function(cb) { if (typeof cb === 'function') cb(); return this; },
        on: function(ev, cb) { if (ev === 'exit' && typeof cb === 'function') cb(0); return this; }
    };
}

function installedStoreApps() {
    var ret = new promise(function (a, r) { this._resolve = a; this._reject = r; });

    // Basierend auf deiner funktionierenden Version + Scope-Erkennung
    var psCommand = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        "$allUsersApps = @(Get-AppxPackage -AllUsers)",
        "$allUsersPkgNames = @($allUsersApps | Select-Object -ExpandProperty PackageFullName)",
        "$userOnlyApps = @(Get-AppxPackage | Where-Object { $allUsersPkgNames -notcontains $_.PackageFullName })",
        "$provPkgs = @(Get-AppxProvisionedPackage -Online | Select-Object -ExpandProperty DisplayName)",
        "$results = @()",
        "foreach ($app in $allUsersApps) {",
        "  if ($app.Name -and $app.Name -notlike 'Microsoft.Windows.*' -and $app.Name -notlike 'windows.*' -and $app.Name -notlike '*_neutral_*') {",
        "    $scope = 'System'",
        "    if ($provPkgs -contains $app.Name) { $scope = 'System+Prov' }",
        "    $results += [PSCustomObject]@{ Name=$app.Name; Version=[string]$app.Version; PackageFullName=$app.PackageFullName; Publisher=$app.Publisher; Scope=$scope }",
        "  }",
        "}",
        "foreach ($app in $userOnlyApps) {",
        "  if ($app.Name -and $app.Name -notlike 'Microsoft.Windows.*' -and $app.Name -notlike 'windows.*' -and $app.Name -notlike '*_neutral_*') {",
        "    $scope = 'User'",
        "    if ($provPkgs -contains $app.Name) { $scope = 'User+Prov' }",
        "    $results += [PSCustomObject]@{ Name=$app.Name; Version=[string]$app.Version; PackageFullName=$app.PackageFullName; Publisher=$app.Publisher; Scope=$scope }",
        "  }",
        "}",
        "$results | Sort-Object Name -Unique | ConvertTo-Json -Compress"
    ].join("; ");

    try {
        var psPath = (process.env['SystemRoot'] || 'C:\\Windows') + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
        
        ret.child = require('child_process').execFile(
            psPath, 
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], 
            { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );
        
        ret.child.promise = ret;
        ret.child.stdout.str = '';
        ret.child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        
        ret.child.on('exit', function (code) {
            try {
                var output = this.stdout.str.trim();
                
                if (output === '' || output === 'null' || output === '[]') {
                    this.promise._resolve([]);
                    return;
                }
                
                var data = JSON.parse(output);
                if (!Array.isArray(data)) { data = [data]; }
                
                var apps = data.map(function(app) {
                    return {
                        name: app.Name || '',
                        version: app.Version || '',
                        publisher: app.Publisher || '',
                        packageFullName: app.PackageFullName || '',
                        scope: app.Scope || '',
                        uninstall: 'Remove-AppxPackage -Package "' + (app.PackageFullName || '') + '" -AllUsers'
                    };
                });
                
                this.promise._resolve(apps);
            } catch (e) {
                this.promise._resolve([]); 
            }
        });
        
        ret.child.on('error', function (err) {
            this.promise._resolve([]);
        });
    } catch (ex) {
        ret._resolve([]);
    }

    return (ret);
}

function defender(){
    try {
        var tokens = require('win-wmi').query('ROOT\\Microsoft\\Windows\\Defender', 'SELECT * FROM MSFT_MpComputerStatus', ['RealTimeProtectionEnabled','IsTamperProtected','AntivirusSignatureVersion','AntivirusSignatureLastUpdated']);
        if (tokens[0]){
            var info = { RealTimeProtection: tokens[0].RealTimeProtectionEnabled, TamperProtected: tokens[0].IsTamperProtected };
            if (tokens[0].AntivirusSignatureVersion) { info.AntivirusSignatureVersion = tokens[0].AntivirusSignatureVersion; }
            if (tokens[0].AntivirusSignatureLastUpdated) { info.AntivirusSignatureLastUpdated = tokens[0].AntivirusSignatureLastUpdated; }
            return (info);
        } else {
            return ({});
        }
    } catch (ex) {
        return ({});
    }
}

if (process.platform == 'win32')
{
    module.exports = { qfe: qfe, av: av, defrag: defrag, pendingReboot: pendingReboot, installedApps: installedApps, installedStoreApps: installedStoreApps, defender: defender };
}
else
{
    var not_supported = function () { throw (process.platform + ' not supported'); };
    module.exports = { qfe: not_supported, av: not_supported, defrag: not_supported, pendingReboot: not_supported, installedApps: not_supported, installedStoreApps: not_supported, defender: not_supported };
}