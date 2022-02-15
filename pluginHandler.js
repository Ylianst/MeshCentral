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
            if (!Q(d.tabId)) {
                var defaultOn = 'class="on"';
                if (Q('p19headers').querySelectorAll("span.on").length) defaultOn = '';
                QA('p19headers', '<span ' + defaultOn + ' id="p19ph-' + d.tabId + '" onclick="return pluginHandler.callPluginPage(\\''+d.tabId+'\\', this);">'+d.tabTitle+'</span>');
                QA('p19pages', '<div id="' + d.tabId + '"></div>');
            }
            QV('MainDevPlugins', true);
        };
        obj.callPluginPage = function(id, el) {
            var pages = Q('p19pages').querySelectorAll("#p19pages>div"); 
            for (const i of pages) { i.style.display = 'none'; }
            QV(id, true);
            var tabs = Q('p19headers').querySelectorAll("span"); 
            for (const i of tabs) { i.classList.remove('on'); }
            el.classList.add('on');
            putstore('_curPluginPage', id);
        };
        obj.addPluginEx = function() {
            meshserver.send({ action: 'addplugin', url: Q('pluginurlinput').value});
        };
        obj.addPluginDlg = function() {
            setDialogMode(2, "Plugin Download URL", 3, obj.addPluginEx, '<p><b>WARNING:</b> Downloading plugins may compromise server security. Only download from trusted sources.</p><input type=text id=pluginurlinput style=width:100% placeholder="https://" />'); 
            focusTextBox('pluginurlinput');
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
                    console.log("Error ocurred while running plugin hook" + p + ':' + hookName + ' (' + e + ')');
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
            if (typeof obj.plugins[p][hookName] == 'function') {
                try {
                    panel[p].header = obj.plugins[p].on_device_header();
                    panel[p].content = obj.plugins[p].on_device_page();
                } catch (e) {
                    console.log("Error ocurred while getting plugin views " + p + ':' + ' (' + e + ')');
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
            if (typeof parent.config.settings.plugins.proxy == 'string') { // Proxy support
                const HttpsProxyAgent = require('https-proxy-agent');
                options.agent = new HttpsProxyAgent(require('url').parse(parent.config.settings.plugins.proxy));
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
                            var s = require('semver');
                            latestRet.push({
                                'id': curconf._id,
                                'installedVersion': curconf.version,
                                'version': newconf.version,
                                'hasUpdate': s.gt(newconf.version, curconf.version),
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
            var fileName = obj.parent.path.join(require('os').tmpdir(), 'Plugin_' + randId + '.zip');
            var plugin = docs[0];
            if (plugin.repository.type == 'git') {
                const file = obj.fs.createWriteStream(fileName);
                var dl_url = plugin.downloadUrl;
                if (version_only != null && version_only != false) dl_url = version_only.url;
                if (force_url != null) dl_url = force_url;
                var url = require('url');
                var q = url.parse(dl_url, true);
                var http = (q.protocol == "http") ? require('http') : require('https');
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
                if (typeof parent.config.settings.plugins.proxy == 'string') {  // Proxy support
                    const HttpsProxyAgent = require('https-proxy-agent');
                    opts.agent = new HttpsProxyAgent(require('url').parse(parent.config.settings.plugins.proxy));
                }
                var request = http.get(opts, function (response) {
                    // handle redirections with grace
                    if (response.headers.location) return obj.installPlugin(id, version_only, response.headers.location, func);
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
                                            readStream.pipe(obj.fs.createWriteStream(filePath));
                                        });
                                    }
                                });
                                zipfile.on('end', function () {
                                    setTimeout(function () {
                                        obj.fs.unlinkSync(fileName);
                                        if (version_only == null || version_only === false) {
                                            parent.db.setPluginStatus(id, 1, func);
                                        } else {
                                            parent.db.updatePlugin(id, { status: 1, version: version_only.name }, func);
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
                            });
                        });
                    });
                });
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
                var http = (q.protocol == 'http') ? require('http') : require('https');
                var opts = {
                    path: q.pathname,
                    host: q.hostname,
                    port: q.port,
                    headers: {
                        'User-Agent': 'MeshCentral',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                };
                if (typeof parent.config.settings.plugins.proxy == 'string') { // Proxy support
                    const HttpsProxyAgent = require('https-proxy-agent');
                    options.agent = new HttpsProxyAgent(require('url').parse(parent.config.settings.plugins.proxy));
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
                                var s = require('semver');
                                vers.forEach((v) => {
                                    if (s.lt(v.name, plugin.version)) vList.push(v);
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
            obj.fs.rmdirSync(pluginPath, { recursive: true });
            parent.db.deletePlugin(id, func);
            delete obj.plugins[plugin.shortName];
        });
    };

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