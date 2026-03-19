/** 
* @description MeshCentral plugin module
* @author Ryan Blenis
* @copyright 
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

/*
Existing plugins:
https://raw.githubusercontent.com/ryanblenis/MeshCentral-Sample/master/config.json
https://raw.githubusercontent.com/ryanblenis/MeshCentral-DevTools/master/config.json
*/


module.exports.pluginHandler = function (parent) {
    var obj = {};

    obj.fs = require('fs');
    obj.path = require('path');
    obj.common = require('./common.js');
    obj.parent = parent;
    obj.pluginPath = obj.parent.path.join(obj.parent.datapath, 'plugins');
    obj.plugins = {};
    obj.exports = {};
    obj.loadList = obj.parent.config.settings.plugins.list; // For local development / manual install, not from DB

    if (typeof obj.loadList != 'object') {
        obj.loadList = {};
        parent.db.getPlugins(function (err, plugins) {
            plugins.forEach(function (plugin) {
                if (plugin.status != 1) return;
                if (obj.fs.existsSync(obj.pluginPath + '/' + plugin.shortName)) {
                    try {
                        obj.plugins[plugin.shortName] = require(obj.pluginPath + '/' + plugin.shortName + '/' + plugin.shortName + '.js')[plugin.shortName](obj);
                        obj.exports[plugin.shortName] = obj.plugins[plugin.shortName].exports;
                    } catch (e) {
                        console.log("Error loading plugin: " + plugin.shortName + " (" + e + "). It has been disabled.", e.stack);
                    }
                    try { // try loading local info about plugin to database (if it changed locally)
                        var plugin_config = obj.fs.readFileSync(obj.pluginPath + '/' + plugin.shortName + '/config.json');
                        plugin_config = JSON.parse(plugin_config);
                        parent.db.updatePlugin(plugin._id, plugin_config);
                    } catch (e) { console.log("Plugin config file for " + plugin.name + " could not be parsed."); }
                }
            });
            obj.parent.updateMeshCore(); // db calls are async, lets inject here once we're ready
        });
    } else {
        obj.loadList.forEach(function (plugin, index) {
            if (obj.fs.existsSync(obj.pluginPath + '/' + plugin)) {
                try {
                    obj.plugins[plugin] = require(obj.pluginPath + '/' + plugin + '/' + plugin + '.js')[plugin](obj);
                    obj.exports[plugin] = obj.plugins[plugin].exports;
                } catch (e) {
                    console.log("Error loading plugin: " + plugin + " (" + e + "). It has been disabled.", e.stack);
                }
            }
        });
    }

    obj.prepExports = function () {
        var str = 'function() {\r\n';
        str += '    var obj = {};\r\n';

        for (var p of Object.keys(obj.plugins)) {
            str += '    obj.' + p + ' = {};\r\n';
            if (Array.isArray(obj.exports[p])) {
                for (var l of Object.values(obj.exports[p])) {
                    str += '        obj.' + p + '.' + l + ' = ' + obj.plugins[p][l].toString() + '\r\n';
                }
            }
        }

        str += `
        obj.callHook = function(hookName, ...args) { 
            for (const p of Object.keys(obj)) {
                if (typeof obj[p][hookName] == 'function') {
                    obj[p][hookName].apply(this, args);
                }
            }
        };
        // accepts a function returning an object or an object with { tabId: "yourTabIdValue", tabTitle: "Your Tab Title" }
        obj.registerPluginTab = function(pluginRegInfo) {
            var d = null;
            if (typeof pluginRegInfo == 'function') d = pluginRegInfo();
            else d = pluginRegInfo;
            if (d.tabId == null || d.tabTitle == null) { return false; }
            if (!document.getElementById(d.tabId)) {
                var defaultOn = 'class="on"';
                if (document.getElementById('p19headers').querySelectorAll("span.on").length) defaultOn = '';
                document.getElementById('p19headers').innerHTML += '<span ' + defaultOn + ' id="p19ph-' + d.tabId + '" onclick="return pluginHandler.callPluginPage(\\''+d.tabId+'\\', this);">'+d.tabTitle+'</span>';
                document.getElementById('p19pages').innerHTML += '<div id="' + d.tabId + '"></div>';
            }
            document.getElementById('MainDevPlugins').style.display = '';
        };
        obj.callPluginPage = function(id, el) {
            var pages = document.getElementById('p19pages').querySelectorAll("#p19pages>div"); 
            for (const i of pages) { i.style.display = 'none'; }
            document.getElementById(id).style.display = '';
            var tabs = document.getElementById('p19headers').querySelectorAll("span"); 
            for (const i of tabs) { i.classList.remove('on'); }
            el.classList.add('on');
            putstore('_curPluginPage', id);
        };
        obj.addPluginEx = function() {
            meshserver.send({ action: 'addplugin', url: document.getElementById('pluginurlinput').value});
        };
        obj.addPluginDlg = function() {
            if (typeof showModal === 'function') {
                setDialogMode(2, "Plugin Download URL", 3, obj.addPluginEx, '<p><b>WARNING:</b> Downloading plugins may compromise server security. Only download from trusted sources.</p><input type=text id=pluginurlinput style=width:100% placeholder="https://" />');
                showModal('xxAddAgentModal', 'idx_dlgOkButton', obj.addPluginEx);
                focusTextBox('pluginurlinput');
            } else {
                // Fallback to setDialogMode for default.handlebars
                setDialogMode(2, "Plugin Download URL", 3, obj.addPluginEx, '<p><b>WARNING:</b> Downloading plugins may compromise server security. Only download from trusted sources.</p><input type=text id=pluginurlinput style=width:100% placeholder="https://" />'); 
                focusTextBox('pluginurlinput');
            }
        };
        obj.refreshPluginHandler = function() {
            let st = document.createElement('script');
            st.src = '/pluginHandler.js';
            document.body.appendChild(st);
        };
        return obj; }`;
        return str;
    }

    obj.refreshJS = function (req, res) {
        // to minimize server reboots when installing new plugins, we call the new data and overwrite the old pluginHandler on the front end
        res.set('Content-Type', 'text/javascript');
        res.send('pluginHandlerBuilder = ' + obj.prepExports() + '\r\n' + ' pluginHandler = new pluginHandlerBuilder(); pluginHandler.callHook("onWebUIStartupEnd");');
    }

    obj.callHook = function (hookName, ...args) {
        for (var p in obj.plugins) {
            if (typeof obj.plugins[p][hookName] == 'function') {
                try {
                    obj.plugins[p][hookName](...args);
                } catch (e) {
                    console.log("Error occurred while running plugin hook " + p + ':' + hookName, e);
                }
            }
        }
    };

    obj.addMeshCoreModules = function (modulesAdd) {
        for (var plugin in obj.plugins) {
            var moduleDirPath = null;
            var modulesDir = null;
            //if (obj.args.minifycore !== false) { try { moduleDirPath = obj.path.join(obj.pluginPath, 'modules_meshcore_min'); modulesDir = obj.fs.readdirSync(moduleDirPath); } catch (e) { } } // Favor minified modules if present.
            if (modulesDir == null) { try { moduleDirPath = obj.path.join(obj.pluginPath, plugin + '/modules_meshcore'); modulesDir = obj.fs.readdirSync(moduleDirPath); } catch (e) { } } // Use non-minified mofules.
            if (modulesDir != null) {
                for (var i in modulesDir) {
                    if (modulesDir[i].toLowerCase().endsWith('.js')) {
                        var moduleName = modulesDir[i].substring(0, modulesDir[i].length - 3);
                        if (moduleName.endsWith('.min')) { moduleName = moduleName.substring(0, moduleName.length - 4); } // Remove the ".min" for ".min.js" files.
                        var moduleData = ['try { addModule("', moduleName, '", "', obj.parent.escapeCodeString(obj.fs.readFileSync(obj.path.join(moduleDirPath, modulesDir[i])).toString('binary')), '"); addedModules.push("', moduleName, '"); } catch (e) { }\r\n'];

                        // Merge this module
                        // NOTE: "smbios" module makes some non-AI Linux segfault, only include for IA platforms.
                        if (moduleName.startsWith('amt-') || (moduleName == 'smbios')) {
                            // Add to IA / Intel AMT cores only
                            modulesAdd['windows-amt'].push(...moduleData);
                            modulesAdd['linux-amt'].push(...moduleData);
                        } else if (moduleName.startsWith('win-')) {
                            // Add to Windows cores only
                            modulesAdd['windows-amt'].push(...moduleData);
                        } else if (moduleName.startsWith('linux-')) {
                            // Add to Linux cores only
                            modulesAdd['linux-amt'].push(...moduleData);
                            modulesAdd['linux-noamt'].push(...moduleData);
                        } else {
                            // Add to all cores
                            modulesAdd['windows-amt'].push(...moduleData);
                            modulesAdd['linux-amt'].push(...moduleData);
                            modulesAdd['linux-noamt'].push(...moduleData);
                        }

                        // Merge this module to recovery modules if needed
                        if (modulesAdd['windows-recovery'] != null) {
                            if ((moduleName == 'win-console') || (moduleName == 'win-message-pump') || (moduleName == 'win-terminal')) {
                                modulesAdd['windows-recovery'].push(...moduleData);
                            }
                        }

                        // Merge this module to agent recovery modules if needed
                        if (modulesAdd['windows-agentrecovery'] != null) {
                            if ((moduleName == 'win-console') || (moduleName == 'win-message-pump') || (moduleName == 'win-terminal')) {
                                modulesAdd['windows-agentrecovery'].push(...moduleData);
                            }
                        }
                    }
                }
            }
        }
    };

    obj.deviceViewPanel = function () {
        var panel = {};
        for (var p in obj.plugins) {
            if (typeof obj.plugins[p].on_device_header === "function" && typeof obj.plugins[p].on_device_page === "function") {
                try {
                    panel[p] = {
                        header: obj.plugins[p].on_device_header(),
                        content: obj.plugins[p].on_device_page()
                    };
                } catch (e) {
                    console.log("Error occurred while getting plugin views " + p + ':' + ' (' + e + ')');
                }
            }
        }
        return panel;
    };

    obj.isValidConfig = function (conf, url) { // check for the required attributes
        var isValid = true;
        if (!(
            typeof conf.name == 'string'
            && typeof conf.shortName == 'string'
            && typeof conf.version == 'string'
            //  && typeof conf.author == 'string'
            && typeof conf.description == 'string'
            && typeof conf.hasAdminPanel == 'boolean'
            && typeof conf.homepage == 'string'
            && typeof conf.changelogUrl == 'string'
            && typeof conf.configUrl == 'string'
            && typeof conf.repository == 'object'
            && typeof conf.repository.type == 'string'
            && typeof conf.repository.url == 'string'
            && typeof conf.meshCentralCompat == 'string'
            //    && conf.configUrl == url  // make sure we're loading a plugin from its desired config
        )) isValid = false;
        // more checks here?
        if (conf.repository.type == 'git') {
            if (typeof conf.downloadUrl != 'string') isValid = false;
        }
        return isValid;
    };

    // https://raw.githubusercontent.com/ryanblenis/MeshCentral-Sample/master/config.json
    obj.getPluginConfig = function (configUrl) {
        return new Promise(function (resolve, reject) {
            var http = (configUrl.indexOf('https://') >= 0) ? require('https') : require('http');
            if (configUrl.indexOf('://') === -1) reject("Unable to fetch the config: Bad URL (" + configUrl + ")");
            var options = require('url').parse(configUrl);
            if (typeof parent.config.settings.plugins.proxy == 'string' || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']) { // Proxy support
                options.agent = new (require('https-proxy-agent').HttpsProxyAgent)(require('url').parse(parent.config.settings.plugins.proxy) || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']);
            }
            http.get(options, function (res) {
                var configStr = '';
                res.on('data', function (chunk) {
                    configStr += chunk;
                });
                res.on('end', function () {
                    if (configStr[0] == '{') { // Let's be sure we're JSON
                        try {
                            var pluginConfig = JSON.parse(configStr);
                            if (Array.isArray(pluginConfig) && pluginConfig.length == 1) pluginConfig = pluginConfig[0];
                            if (obj.isValidConfig(pluginConfig, configUrl)) {
                                resolve(pluginConfig);
                            } else {
                                reject("This does not appear to be a valid plugin configuration.");
                            }
                        } catch (e) { reject("Error getting plugin config. Check that you have valid JSON."); }
                    } else {
                        reject("Error getting plugin config. Check that you have valid JSON.");
                    }
                });
            }).on('error', function (e) {
                reject("Error getting plugin config: " + e.message);
            });
        })
    };

    // MeshCentral now adheres to semver, drop the -<alpha> off the version number for later versions for comparing plugins prior to this change
    obj.versionToNumber = function(ver) { var x = ver.split('-'); if (x.length != 2) return ver; return x[0]; }

    // Check if the current version of MeshCentral is at least the minimal required.
    obj.versionCompare = function(current, minimal) {
        if (minimal.startsWith('>=')) { minimal = minimal.substring(2); }
        var c = obj.versionToNumber(current).split('.'), m = obj.versionToNumber(minimal).split('.');
        if (c.length != m.length) return false;
        for (var i = 0; i < c.length; i++) { var cx = parseInt(c[i]), cm = parseInt(m[i]); if (cx > cm) { return true; } if (cx < cm) { return false; } }
        return true;
    }

    obj.versionGreater = function(a, b) {
        a = obj.versionToNumber(String(a).replace(/^v/, ''));
        b = obj.versionToNumber(String(b).replace(/^v/, ''));
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA > numB) return true;
            if (numA < numB) return false;
        }
        return false;
    };

    obj.versionLower = function(a, b) {
        a = obj.versionToNumber(String(a).replace(/^v/, ''));
        b = obj.versionToNumber(String(b).replace(/^v/, ''));
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA < numB) return true;
            if (numA > numB) return false;
        }
        return false;
    };

    obj.getPluginLatest = function () {
        return new Promise(function (resolve, reject) {
            parent.db.getPlugins(function (err, plugins) {
                var proms = [];
                plugins.forEach(function (curconf) {
                    proms.push(obj.getPluginConfig(curconf.configUrl).catch(e => { return null; }));
                });
                var latestRet = [];
                Promise.all(proms).then(function (newconfs) {
                    var nconfs = [];
                    // Filter out config download issues
                    newconfs.forEach(function (nc) { if (nc !== null) nconfs.push(nc); });
                    if (nconfs.length == 0) { resolve([]); } else {
                        nconfs.forEach(function (newconf) {
                            var curconf = null;
                            plugins.forEach(function (conf) {
                                if (conf.configUrl == newconf.configUrl) curconf = conf;
                            });
                            if (curconf == null) reject("Some plugin configs could not be parsed");
                            latestRet.push({
                                'id': curconf._id,
                                'installedVersion': curconf.version,
                                'version': newconf.version,
                                'hasUpdate': obj.versionGreater(newconf.version, curconf.version),
                                'meshCentralCompat': obj.versionCompare(parent.currentVer, newconf.meshCentralCompat),
                                'changelogUrl': curconf.changelogUrl,
                                'status': curconf.status
                            });
                            resolve(latestRet);
                        });
                    }
                }).catch((e) => { console.log("Error reaching plugins, update call aborted.", e) });
            });
        });
    };

    obj.addPlugin = function (pluginConfig) {
        return new Promise(function (resolve, reject) {
            parent.db.addPlugin({
                'name': pluginConfig.name,
                'shortName': pluginConfig.shortName,
                'version': pluginConfig.version,
                'description': pluginConfig.description,
                'hasAdminPanel': pluginConfig.hasAdminPanel,
                'homepage': pluginConfig.homepage,
                'changelogUrl': pluginConfig.changelogUrl,
                'configUrl': pluginConfig.configUrl,
                'downloadUrl': pluginConfig.downloadUrl,
                'repository': {
                    'type': pluginConfig.repository.type,
                    'url': pluginConfig.repository.url
                },
                'meshCentralCompat': pluginConfig.meshCentralCompat,
                'versionHistoryUrl': pluginConfig.versionHistoryUrl,
                'status': 0  // 0: disabled, 1: enabled
            }, function () {
                parent.db.getPlugins(function (err, docs) {
                    if (err) reject(err);
                    else resolve(docs);
                });
            });
        });
    };

    obj.installPlugin = function (id, version_only, force_url, func) {
        parent.db.getPlugin(id, function (err, docs) {
            // the "id" would probably suffice, but is probably an sanitary issue, generate a random instead
            var randId = Math.random().toString(32).replace('0.', '');
            var tmpDir = require('os').tmpdir();
            var fileName = obj.parent.path.join(tmpDir, 'Plugin_' + randId + '.zip');
            try {
                obj.fs.accessSync(tmpDir, obj.fs.constants.W_OK);
            } catch (e) {
                var pluginTmpPath = obj.parent.path.join(obj.pluginPath, '_tmp');
                if (!obj.fs.existsSync(pluginTmpPath)) {
                    obj.fs.mkdirSync(pluginTmpPath, { recursive: true });
                }
                fileName = obj.parent.path.join(pluginTmpPath, 'Plugin_' + randId + '.zip');
            }
            var plugin = docs[0];
            if (plugin.repository.type == 'git') {
                var file;
                try {
                    file = obj.fs.createWriteStream(fileName);
                } catch (e) {
                    if (fileName.indexOf(tmpDir) >= 0) {
                        var pluginTmpPath = obj.parent.path.join(obj.pluginPath, '_tmp');
                        if (!obj.fs.existsSync(pluginTmpPath)) {
                            obj.fs.mkdirSync(pluginTmpPath, { recursive: true });
                        }
                        fileName = obj.parent.path.join(pluginTmpPath, 'Plugin_' + randId + '.zip');
                        file = obj.fs.createWriteStream(fileName);
                    } else {
                        throw e;
                    }
                }
                var dl_url = plugin.downloadUrl;
                if (version_only != null && version_only != false) dl_url = version_only.url;
                if (force_url != null) dl_url = force_url;
                var url = require('url');
                var q = url.parse(dl_url, true);
                var http = (q.protocol == "http:") ? require('http') : require('https');
                var opts = {
                    path: q.pathname,
                    host: q.hostname,
                    port: q.port,
                    headers: {
                        'User-Agent': 'MeshCentral'
                    },
                    followRedirects: true,
                    method: 'GET'
                };
                if (typeof parent.config.settings.plugins.proxy == 'string' || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']) { // Proxy support
                    opts.agent = new (require('https-proxy-agent').HttpsProxyAgent)(require('url').parse(parent.config.settings.plugins.proxy) || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']);
                }
                var done = false;
                var request = http.get(opts, function (response) {
                    // handle redirections with grace
                    if (response.headers.location) {
                        file.close(() => obj.fs.unlink(fileName, () => {}));
                        return obj.installPlugin(id, version_only, response.headers.location, func);
                    }
                    if ((response.statusCode != null) && (response.statusCode >= 400)) { return console.log('Error downloading plugin: HTTP ' + response.statusCode); }
                    response.pipe(file);
                    file.on('finish', function () {
                        file.close(function () {
                            var yauzl = require('yauzl');
                            if (!obj.fs.existsSync(obj.pluginPath)) {
                                obj.fs.mkdirSync(obj.pluginPath);
                            }
                            if (!obj.fs.existsSync(obj.parent.path.join(obj.pluginPath, plugin.shortName))) {
                                obj.fs.mkdirSync(obj.parent.path.join(obj.pluginPath, plugin.shortName));
                            }
                            yauzl.open(fileName, { lazyEntries: true }, function (err, zipfile) {
                                if (err) throw err;
                                zipfile.readEntry();
                                zipfile.on('entry', function (entry) {
                                    let pluginPath = obj.parent.path.join(obj.pluginPath, plugin.shortName);
                                    let pathReg = new RegExp(/(.*?\/)/);
                                    //if (process.platform == 'win32') { pathReg = new RegExp(/(.*?\\/); }
                                    let filePath = obj.parent.path.join(pluginPath, entry.fileName.replace(pathReg, '')); // remove top level dir

                                    if (/\/$/.test(entry.fileName)) { // dir
                                        if (!obj.fs.existsSync(filePath))
                                            obj.fs.mkdirSync(filePath);
                                        zipfile.readEntry();
                                    } else { // file
                                        zipfile.openReadStream(entry, function (err, readStream) {
                                            if (err) throw err;
                                            readStream.on('end', function () { zipfile.readEntry(); });
                                            if (process.platform == 'win32') {
                                                readStream.pipe(obj.fs.createWriteStream(filePath));
                                            } else {
                                                var fileMode = (entry.externalFileAttributes >> 16) & 0x0fff;
                                                if( fileMode <= 0 ) fileMode = 0o644;
                                                readStream.pipe(obj.fs.createWriteStream(filePath, { mode: fileMode }));
                                            }
                                        });
                                    }
                                });
                                zipfile.on('end', function () {
                                    setTimeout(function () {
                                        try { obj.fs.unlinkSync(fileName); } catch (ex) { }
                                        if (version_only == null || version_only === false) {
                                            parent.db.setPluginStatus(id, 1, function () { if (done) return; done = true; if (typeof func == 'function') { func(null); } });
                                        } else {
                                            parent.db.updatePlugin(id, { status: 1, version: version_only.name }, function () { if (done) return; done = true; if (typeof func == 'function') { func(null); } });
                                        }
                                        try {
                                            obj.plugins[plugin.shortName] = require(obj.pluginPath + '/' + plugin.shortName + '/' + plugin.shortName + '.js')[plugin.shortName](obj);
                                            obj.exports[plugin.shortName] = obj.plugins[plugin.shortName].exports;
                                            if (typeof obj.plugins[plugin.shortName].server_startup == 'function') obj.plugins[plugin.shortName].server_startup();
                                        } catch (e) { console.log('Error instantiating new plugin: ', e); }
                                        try {
                                            var plugin_config = obj.fs.readFileSync(obj.pluginPath + '/' + plugin.shortName + '/config.json');
                                            plugin_config = JSON.parse(plugin_config);
                                            parent.db.updatePlugin(plugin._id, plugin_config);
                                        } catch (e) { console.log('Error reading plugin config upon install'); }
                                        parent.updateMeshCore();
                                    });
                                });
                                zipfile.on('error', function (e) { console.log('Error extracting plugin ZIP: ' + e.message); });
                            });
                        });
                    });
                });
                request.on('error', function (e) { console.log('Error downloading plugin: ' + e.message); });
                request.setTimeout(30000, function () { request.destroy(new Error('Timed out while downloading plugin')); });
            } else if (plugin.repository.type == 'npm') {
                // @TODO npm support? (need a test plugin)
            }
        });
    };

    obj.getPluginVersions = function (id) {
        return new Promise(function (resolve, reject) {
            parent.db.getPlugin(id, function (err, docs) {
                var plugin = docs[0];
                if (plugin.versionHistoryUrl == null) reject("No version history available for this plugin.");
                var url = require('url');
                var q = url.parse(plugin.versionHistoryUrl, true);
                var http = (q.protocol == 'http:') ? require('http') : require('https');
                var opts = {
                    path: q.pathname,
                    host: q.hostname,
                    port: q.port,
                    headers: {
                        'User-Agent': 'MeshCentral',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                };
                if (typeof parent.config.settings.plugins.proxy == 'string' || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']) { // Proxy support
                    options.agent = new (require('https-proxy-agent').HttpsProxyAgent)(require('url').parse(parent.config.settings.plugins.proxy) || process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']);
                }
                http.get(opts, function (res) {
                    var versStr = '';
                    res.on('data', function (chunk) {
                        versStr += chunk;
                    });
                    res.on('end', function () {
                        if ((versStr[0] == '{') || (versStr[0] == '[')) { // let's be sure we're JSON
                            try {
                                var vers = JSON.parse(versStr);
                                var vList = [];
                                vers.forEach((v) => {
                                    if (obj.versionLower(v.name, plugin.version)) vList.push(v);
                                });
                                if (vers.length == 0) reject("No previous versions available.");
                                resolve({ 'id': plugin._id, 'name': plugin.name, versionList: vList });
                            } catch (e) { reject("Version history problem."); }
                        } else {
                            reject("Version history appears to be malformed." + versStr);
                        }
                    });
                }).on('error', function (e) {
                    reject("Error getting plugin versions: " + e.message);
                });
            });
        });
    };

    obj.disablePlugin = function (id, func) {
        parent.db.getPlugin(id, function (err, docs) {
            var plugin = docs[0];
            parent.db.setPluginStatus(id, 0, func);
            delete obj.plugins[plugin.shortName];
            delete obj.exports[plugin.shortName];
            parent.updateMeshCore();
        });
    };

    obj.removePlugin = function (id, func) {
        parent.db.getPlugin(id, function (err, docs) {
            var plugin = docs[0];
            let pluginPath = obj.parent.path.join(obj.pluginPath, plugin.shortName);
            if (obj.fs.existsSync(pluginPath)) {
                try {
                    obj.fs.rmSync(pluginPath, { recursive: true, force: true });
                } catch (e) {
                    console.log("Error removing plugin directory:", e);
                }
            }
            parent.db.deletePlugin(id, func);
            delete obj.plugins[plugin.shortName];
        });
    };

    // Reload a specific plugin without restarting the server
    // Useful for development and upgrading - call this after modifying plugin files
    obj.reloadPlugin = function (pluginName, func) {
        var pluginPath = obj.pluginPath + '/' + pluginName;
        var mainFile = pluginPath + '/' + pluginName + '.js';

        if (!obj.fs.existsSync(mainFile)) {
            var errMsg = "Plugin not found: " + pluginName;
            console.log(errMsg);
            if (func) func({ success: false, error: errMsg });
            return;
        }
        
        // Clear the require cache for this plugin
        var resolvedPath = require.resolve(mainFile);
        if (require.cache[resolvedPath]) {
            delete require.cache[resolvedPath];
        }

        // Also try to clear any nested requires (basic approach)
        Object.keys(require.cache).forEach(function (key) {
            if (key.startsWith(pluginPath + '/')) {
                delete require.cache[key];
            }
        });

        // Remove old plugin instance
        delete obj.plugins[pluginName];
        delete obj.exports[pluginName];

        // Reload the plugin
        try {
            obj.plugins[pluginName] = require(mainFile)[pluginName](obj);
            obj.exports[pluginName] = obj.plugins[pluginName].exports;

            // Call server_startup hook if it exists (re-initializes the plugin)
            if (typeof obj.plugins[pluginName].server_startup === 'function') {
                obj.plugins[pluginName].server_startup();
            }

            console.log("Plugin reloaded successfully: " + pluginName);
            if (func) func({ success: true, name: pluginName });
        } catch (e) {
            var errMsg = "Error reloading plugin " + pluginName + ": " + e;
            console.log(errMsg, e.stack);
            if (func) func({ success: false, error: errMsg });
        }
    };

    // Reload all enabled plugins
    obj.reloadAllPlugins = function (func) {
        var results = [];
        var pluginNames = Object.keys(obj.plugins);

        if (pluginNames.length === 0) {
            if (func) func({ success: true, reloaded: [] });
            return;
        }
        
        pluginNames.forEach(function (pluginName) {
            obj.reloadPlugin(pluginName, function (result) {
                results.push(result);
                if (results.length === pluginNames.length) {
                    if (func) func({ success: true, reloaded: results });
                }
            });
        });
    };
    
    // In-memory cache of registered permissions (loaded from plugins)
    obj.pluginPermissions = {};
    obj.pluginPermissionsCache = {}; // Loaded from database
    
    // Register a plugin's permissions (called by plugin during load)
    // permissions: { 'can_edit': { title: 'Edit', desc: 'Can edit', default: 'allowed' }, ... }
    // default value can be: 'allowed', 'denied', or 'inherited'
    obj.registerPermissions = function(pluginName, permissions) {
        var definitions = {};
        var defaults = {};
        
        for (var key in permissions) {
            definitions[key] = {
                title: permissions[key].title,
                desc: permissions[key].desc
            };
            defaults[key] = permissions[key].default || 'inherited';
        }
        
        obj.pluginPermissions[pluginName] = {
            definitions: definitions,
            defaults: defaults
        };
        //console.log("Registered permissions for plugin: " + pluginName);
    };
    
    // Helper to resolve meshId from nodeId (async)
    obj.resolveMeshFromNode = function(nodeId) {
        return new Promise(function(resolve, reject) {
            parent.db.Get(nodeId, function(err, node) {
                if (err || !node) {
                    resolve(null);
                } else {
                    resolve(node[0].meshid);
                }
            });
        });
    };
    
    // Helper: do the actual permission check (sync)
    function doCheckPluginPermission(user, pluginName, permission, nodeId, meshId) {
        return obj.checkPluginPermission(user, pluginName, permission, nodeId, meshId);
    }
    
    // New API: Get all permissions for a user/context
    // Always returns a Promise. Returns an array of permission keys the user has access to.
    // Usage: const perms = await parent.getAccessPermissions('pluginName', user, { nodeid: 'node/...' })
    // Returns: ['can_access', 'can_edit', ...]
    obj.getAccessPermissions = function(pluginName, user, context) {
        var nodeId = null;
        var meshId = null;
        
        if (typeof context === 'string') {
            nodeId = context;
        } else if (typeof context === 'object') {
            nodeId = context.nodeId || context.nodeid;
            meshId = context.meshId || context.meshid || context.mesh;
        }
        
        // If we have nodeId but no meshId, resolve meshId from node
        var meshPromise;
        if (nodeId && !meshId) {
            meshPromise = obj.resolveMeshFromNode(nodeId);
        } else {
            meshPromise = Promise.resolve(meshId);
        }
        
        return meshPromise.then(function(resolvedMeshId) {
            var pluginDef = obj.pluginPermissions[pluginName];
            var permKeys = pluginDef ? Object.keys(pluginDef.definitions) : [];
            
            var allowedPerms = [];
            for (var i = 0; i < permKeys.length; i++) {
                var permKey = permKeys[i];
                var allowed = doCheckPluginPermission(user, pluginName, permKey, nodeId, resolvedMeshId);
                if (allowed === true) {
                    allowedPerms.push(permKey);
                }
            }
            
            // Return a function that checks individual permissions
            return function(permission) {
                if (permission == '_ALL_') return allowedPerms;
                return allowedPerms.indexOf(permission) >= 0;
            };
        });
    };
    
    obj.loadPluginPermissions = function(pluginName, callback) {
        parent.db.getPluginPermissions(pluginName, function(err, docs) {
            if (err || docs.length === 0) {
                // No permissions saved yet, create default structure
                obj.pluginPermissionsCache[pluginName] = {
                    _id: 'pluginpermission//' + pluginName,
                    pluginName: pluginName,
                    permissions: {},
                    defaults: obj.pluginPermissions[pluginName] ? obj.pluginPermissions[pluginName].defaults : {}
                };
            } else {
                obj.pluginPermissionsCache[pluginName] = docs[0];
            }
            if (callback) callback();
        });
    };
    
    obj.getPluginPermissions = function(pluginName) {
        var cached = obj.pluginPermissionsCache[pluginName];
        if (!cached) {
            // Return in-memory registration if no DB entry
            return obj.pluginPermissions[pluginName] || null;
        }
        
        // Merge definitions from plugin registration with saved permissions
        var definitions = obj.pluginPermissions[pluginName] ? obj.pluginPermissions[pluginName].definitions : {};
        return {
            _id: cached._id,
            pluginName: pluginName,
            definitions: definitions,
            defaults: cached.defaults || {},
            permissions: cached.permissions || {}
        };
    };
    
    obj.setPluginPermissions = function(pluginName, data, callback) {
        var existing = obj.pluginPermissionsCache[pluginName] || {};
        
        var doc = {
            _id: 'pluginpermission//' + pluginName,
            pluginName: pluginName,
            permissions: data.permissions || {},
            defaults: data.defaults || existing.defaults || {}
        };
        
        obj.pluginPermissionsCache[pluginName] = doc;
        parent.db.setPluginPermissions(pluginName, doc, function(err) {
            if (callback) callback(err);
        });
    };
    
    function userIsInGroup(user, groupId) {
        if (!user || !user.links) return false;
        return user.links[groupId] != null;
    }
    
    // Evaluate if user has access at a specific level (global, mesh override, node override)
    // Returns: 'allowed', 'denied', or 'inherited' (not set)
    function evaluateAccessLevel(entry, user) {
        if (!entry) return 'inherited';
        
        var allowed = entry.allowed || {};
        var denied = entry.denied || {};
        
        // Check allowed lists first
        if (allowed.users && allowed.users.indexOf(user._id) >= 0) return 'allowed';
        if (allowed.userGroups) {
            for (var i = 0; i < allowed.userGroups.length; i++) {
                if (userIsInGroup(user, allowed.userGroups[i])) return 'allowed';
            }
        }
        
        // Check denied lists
        if (denied.users && denied.users.indexOf(user._id) >= 0) return 'denied';
        if (denied.userGroups) {
            for (var i = 0; i < denied.userGroups.length; i++) {
                if (userIsInGroup(user, denied.userGroups[i])) return 'denied';
            }
        }
        
        return 'inherited';
    }
    
    // Core permission check function
    // user: user object from MeshCentral
    // pluginName: string, e.g., 'regedit'
    // permission: string, e.g., 'can_edit'
    // nodeId: optional node ID to check node-specific permissions
    // meshId: optional mesh ID (if not provided, derived from node)
    obj.checkPluginPermission = function(user, pluginName, permission, nodeId, meshId) {
        // 1. Full admin always has access
        if (user.siteadmin === 0xFFFFFFFF) return true;
        
        // 2. Get plugin permissions config
        var config = obj.getPluginPermissions(pluginName);
        if (!config) {
            // No permissions defined, allow by default (backwards compatibility)
            return true;
        }
        
        // 3. Get permissions for this specific permission key
        var permConfig = config.permissions ? config.permissions[permission] : null;
        if (!permConfig) {
            permConfig = {
                allowed: { users: [], userGroups: [], meshes: [], nodes: [] },
                denied: { users: [], userGroups: [], meshes: [], nodes: [] },
                meshOverrides: {},
                nodeOverrides: {}
            };
        }
        
        // 4. Resolve mesh if we have a node but no mesh
        var targetMesh = meshId;
        var targetNode = nodeId;
        
        if (targetNode && !targetMesh) {
            // Try to get mesh from node cache
            // MeshCentral typically stores nodes at parent.nodes
            var node = null;
            
            // Try to get node from parent.nodes
            if (obj.parent.nodes && obj.parent.nodes[targetNode]) {
                node = obj.parent.nodes[targetNode];
            } else if (parent.meshes) {
                // Check each mesh's nodes
                for (var mid in parent.meshes) {
                    var mesh = parent.meshes[mid];
                    if (mesh.nodes && mesh.nodes[targetNode]) {
                        node = mesh.nodes[targetNode];
                        break;
                    }
                }
            }
            
            if (node && node.meshid) {
                targetMesh = node.meshid;
            }
        }
        
        // 5. Check cascade: Node → Mesh → Global → Default
        
        // A) Check node-specific (highest priority)
        if (targetNode && permConfig.nodeOverrides && permConfig.nodeOverrides[targetNode]) {
            var result = evaluateAccessLevel(permConfig.nodeOverrides[targetNode], user);
            if (result !== 'inherited') return result === 'allowed';
        }
        
        // B) Check mesh-specific
        if (targetMesh && permConfig.meshOverrides && permConfig.meshOverrides[targetMesh]) {
            // Verify user has access to this mesh before applying mesh override
            // User has mesh access if they have a link to the mesh
            var userHasMeshAccess = (user.links && user.links[targetMesh]) ? true : false;
            
            if (userHasMeshAccess) {
                var result = evaluateAccessLevel(permConfig.meshOverrides[targetMesh], user);
                if (result !== 'inherited') return result === 'allowed';
            }
        }
        
        // C) Check global level
        var globalResult = evaluateAccessLevel(permConfig, user);
        if (globalResult !== 'inherited') return globalResult === 'allowed';
        
        // D) Fall back to default
        var defaultValue = config.defaults ? config.defaults[permission] : 'inherited';
        if (defaultValue === 'inherited') {
            // If default is also inherited, use 'allowed' as safe fallback
            defaultValue = 'allowed';
        }
        return defaultValue === 'allowed';
    };
    
    obj.initPluginPermissions = function() {
        parent.db.getPlugins(function(err, plugins) {
            if (err || !plugins) return;
            plugins.forEach(function(plugin) {
                if (plugin.status === 1 && plugin.shortName) {
                    obj.loadPluginPermissions(plugin.shortName);
                }
            });
        });
    };
    
    // Call init on load
    obj.initPluginPermissions();

    obj.handleAdminReq = function (req, res, user, serv) {
        if ((req.query.pin == null) || (obj.common.isAlphaNumeric(req.query.pin) !== true)) { res.sendStatus(401); return; }
        var path = obj.path.join(obj.pluginPath, req.query.pin, 'views');
        serv.app.set('views', path);
        if ((obj.plugins[req.query.pin] != null) && (typeof obj.plugins[req.query.pin].handleAdminReq == 'function')) {
            obj.plugins[req.query.pin].handleAdminReq(req, res, user);
        } else {
            res.sendStatus(401);
        }
    }

    obj.handleAdminPostReq = function (req, res, user, serv) {
        if ((req.query.pin == null) || (obj.common.isAlphaNumeric(req.query.pin) !== true)) { res.sendStatus(401); return; }
        var path = obj.path.join(obj.pluginPath, req.query.pin, 'views');
        serv.app.set('views', path);
        if ((obj.plugins[req.query.pin] != null) && (typeof obj.plugins[req.query.pin].handleAdminPostReq == 'function')) {
            obj.plugins[req.query.pin].handleAdminPostReq(req, res, user);
        } else {
            res.sendStatus(401);
        }
    }
    return obj;
};
