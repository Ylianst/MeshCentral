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
require('promise');

module.exports.pluginHandler = function (parent) {
    var obj = {};

    obj.fs = require('fs');
    obj.path = require('path');
    obj.parent = parent;
    obj.pluginPath = obj.parent.path.join(obj.parent.datapath, 'plugins');
    obj.plugins = {};
    obj.exports = {};
    obj.loadList = obj.parent.config.settings.plugins.list; // For local development / manual install, not from DB
    
    if (typeof obj.loadList != 'object') {
        obj.loadList = {};
        parent.db.getPlugins(function(err, plugins){
          plugins.forEach(function(plugin){
              if (plugin.status != 1) return;
              if (obj.fs.existsSync(obj.pluginPath + '/' + plugin.shortName)) {
                  try {
                      obj.plugins[plugin.shortName] = require(obj.pluginPath + '/' + plugin.shortName + '/' + plugin.shortName + '.js')[plugin.shortName](obj);
                      obj.exports[plugin.shortName] = obj.plugins[plugin.shortName].exports;
                  } catch (e) {
                      console.log("Error loading plugin: " + plugin.shortName + " (" + e + "). It has been disabled.", e.stack);
                  }
              }
              obj.parent.updateMeshCore(); // db calls are delayed, lets inject here once we're ready
          });
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

        for (const p of Object.keys(obj.plugins)) {
            str += '    obj.' + p + ' = {};\r\n';
            for (const l of Object.values(obj.exports[p])) {
                str += '        obj.' + p + '.' + l + ' = ' + obj.plugins[p][l].toString() + '\r\n';
            }
        }

        str += `obj.onDeviceRefeshEnd = function(nodeid, panel, refresh, event) {
        for (const p of Object.keys(obj)) { 
            if (typeof obj[p].onDeviceRefreshEnd == 'function') {
                obj[p].onDeviceRefreshEnd(nodeid, panel, refresh, event);
                }
            }
        };
        obj.registerPluginTab = function(pluginRegInfo) {
            var d = pluginRegInfo();
            if (!Q(d.tabId)) {
                QA('p19headers', '<span onclick="return pluginHandler.callPluginPage(\\''+d.tabId+'\\');">'+d.tabTitle+'</span>');
            }
        };
        obj.callPluginPage = function(id) {
            var pages = Q('p19pages').querySelectorAll("#p19pages>div"); 
            for (const i of pages) { i.style.display = 'none'; }
            QV(id, true);
        };
        obj.addPluginEx = function() {
            meshserver.send({ action: 'addplugin', url: Q('pluginurlinput').value});
        };
        obj.addPluginDlg = function() {
            setDialogMode(2, "Plugin Config URL", 3, obj.addPluginEx, '<input type=text id=pluginurlinput style=width:100% />'); 
            focusTextBox('pluginurlinput');
        };
        return obj; };`;
        return str;
    }

    obj.callHook = function (hookName, ...args) {
        for (var p in obj.plugins) {
            if (typeof obj.plugins[p][hookName] == 'function') {
                try {
                    obj.plugins[p][hookName](args);
                } catch (e) {
                    console.log('Error ocurred while running plugin hook' + p + ':' + hookName + ' (' + e + ')');
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
                    console.log('Error ocurred while getting plugin views ' + p + ':' + ' (' + e + ')');
                }
            }
        }
        return panel;
    };
    
    obj.isValidConfig = function(conf, url) { // check for the required attributes
        var isValid = true;
        if (!(
            typeof conf.name == 'string'
            && typeof conf.shortName == 'string'
            && typeof conf.version == 'string'
            && typeof conf.author == 'string'
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
    
    obj.getPlugins = function(func) {
        var plugins = parent.db.getPlugins();
        if (typeof plugins == 'undefined' || plugins.length == 0) {
            return null;
        }
        
        plugins.forEach(function(p, x){
            // check semantic version
            console.log('FOREACH PLUGIN', p, x);
            // callbacks to new versions
            
        });
        
        return plugins;
    }
    
    obj.getPluginConfig = function(configUrl) {
        return new Promise(function(resolve, reject) {
            var https = require('https');
            if (configUrl.indexOf('://') === -1) reject('Unable to fetch the config: Bad URL (' + configUrl + ')');
            https.get(configUrl, function(res) {
              var configStr = '';
              res.on('data', function(chunk){
                  configStr += chunk;
              });
              res.on('end', function(){
                  if (configStr[0] == '{') { // let's be sure we're JSON
                      try {
                          var pluginConfig = JSON.parse(configStr);
                          if (Array.isArray(pluginConfig) && pluginConfig.length == 1) pluginConfig = pluginConfig[0];
                          if (obj.isValidConfig(pluginConfig, configUrl)) {
                              resolve(pluginConfig);
                          } else {
                              reject("This does not appear to be a valid plugin configuration.");
                          }
                          
                      } catch (e) { reject('Error getting plugin config. Check that you have valid JSON.'); }
                  } else {
                    reject('Error getting plugin config. Check that you have valid JSON.');
                  }
              });
      
            }).on('error', function(e) {
                reject("Error getting plugin config: " + e.message);
            }); 
        })
    };
    
    obj.getPluginLatest = function() {
        return new Promise(function(resolve, reject) {
            parent.db.getPlugins(function(err, plugins) {
                var proms = [];
                plugins.forEach(function(curconf) {
                    proms.push(obj.getPluginConfig(curconf.configUrl));
                });
                var latestRet = [];
                Promise.all(proms).then(function(newconfs) {
                    newconfs.forEach(function(newconf) {
                        var curconf = null;
                        plugins.forEach(function(conf) {
                            if (conf.configUrl == newconf.configUrl) curconf = conf;
                        });
                        if (curconf == null) reject('Some plugin configs could not be parsed');
                        var s = require('semver');
                        // MeshCentral doesn't adhere to semantic versioning (due to the -<alpha_char> at the end of the version)
                        // Convert the letter to ASCII for a "true" version number comparison
                        var mcCurVer = parent.currentVer.replace(/-(.)$/, (m, p1) => { return p1.charCodeAt(0); });
                        var piCompatVer = newconf.meshCentralCompat.replace(/-(.)$/, (m, p1) => { return p1.charCodeAt(0); });
                        latestRet.push({
                            "id": curconf._id,
                            "installedVersion": curconf.version,
                            "version": newconf.version,
                            "hasUpdate": s.gt(newconf.version, curconf.version),
                            "meshCentralCompat": s.satisfies(mcCurVer, piCompatVer),
                            "changelogUrl": curconf.changelogUrl,
                            "status": curconf.status
                        });
                        resolve(latestRet);
                    });
                }).catch((e) => { console.log('Error reaching plugins, update call aborted. ', e)});
            });
        });
    };
    
    obj.addPlugin = function(pluginConfig) {
      return new Promise(function(resolve, reject) {
          parent.db.addPlugin({
              "name": pluginConfig.name,
              "shortName": pluginConfig.shortName,
              "version": pluginConfig.version,
              "description": pluginConfig.description,
              "hasAdminPanel": pluginConfig.hasAdminPanel,
              "homepage": pluginConfig.homepage,
              "changelogUrl": pluginConfig.changelogUrl,
              "configUrl": pluginConfig.configUrl,
              "downloadUrl": pluginConfig.downloadUrl,
              "repository": {
                  "type": pluginConfig.repository.type,
                  "url": pluginConfig.repository.url
              },
              "meshCentralCompat": pluginConfig.meshCentralCompat,
              "status": 0  // 0: disabled, 1: enabled
          }, function() {
                parent.db.getPlugins(function(err, docs){
                  if (err) reject(err);
                  else resolve(docs);
                });
            });
        });
    };
    
    obj.installPlugin = function(id, func) {
        parent.db.getPlugin(id, function(err, docs){
            var http = require('https');
            // the "id" would probably suffice, but is probably an sanitary issue, generate a random instead
            var randId = Math.random().toString(32).replace('0.', '');
            var fileName = obj.parent.path.join(require('os').tmpdir(), 'Plugin_'+randId+'.zip');
            var plugin = docs[0];
            if (plugin.repository.type ==  'git') {
                const file = obj.fs.createWriteStream(fileName);
                var request = http.get(plugin.downloadUrl, function(response) {
                    response.pipe(file);
                    file.on('finish', function() {
                        file.close(function(){
                            var yauzl = require("yauzl");
                            if (!obj.fs.existsSync(obj.pluginPath)) {
                                obj.fs.mkdirSync(obj.pluginPath);
                            }
                            if (!obj.fs.existsSync(obj.parent.path.join(obj.pluginPath, plugin.shortName))) {
                                obj.fs.mkdirSync(obj.parent.path.join(obj.pluginPath, plugin.shortName));
                            }
                            yauzl.open(fileName, { lazyEntries: true }, function (err, zipfile) {
                                if (err) throw err;
                                zipfile.readEntry();
                                zipfile.on("entry", function (entry) {
                                    let pluginPath = obj.parent.path.join(obj.pluginPath, plugin.shortName);
                                    let pathReg = new RegExp(/(.*?\/)/);
                                    if (process.platform == 'win32') pathReg = new RegExp(/(.*?\\/);
                                    let filePath = obj.parent.path.join(pluginPath, entry.fileName.replace(pathReg, '')); // remove top level dir
                                    
                                    if (/\/$/.test(entry.fileName)) { // dir
                                        if (!obj.fs.existsSync(filePath))
                                            obj.fs.mkdirSync(filePath);
                                        zipfile.readEntry();
                                    } else { // file
                                        zipfile.openReadStream(entry, function (err, readStream) {
                                            if (err) throw err;
                                            readStream.on("end", function () { zipfile.readEntry(); });
                                            readStream.pipe(obj.fs.createWriteStream(filePath));
                                        });
                                    }
                                });
                                zipfile.on("end", function () { setTimeout(function () { 
                                    obj.fs.unlinkSync(fileName); 
                                    parent.db.setPluginStatus(id, 1, func); 
                                    obj.plugins[plugin.shortName] = require(obj.pluginPath + '/' + plugin.shortName + '/' + plugin.shortName + '.js')[plugin.shortName](obj);
                                    obj.exports[plugin.shortName] = obj.plugins[plugin.shortName].exports;
                                }); });
                            });
                        });
                    });
                });
            } else if (plugin.repository.type ==  'npm') {
                // @TODO npm install and symlink dirs (need a test plugin)
            }
          
            
        });
        
        
    };
    
    obj.disablePlugin = function(id, func) {
        parent.db.setPluginStatus(id, 0, func);
    };
    
    obj.removePlugin = function(id, func) {
        parent.db.getPlugin(id, function(err, docs){
            var plugin = docs[0];
            var rimraf = require("rimraf");
            let pluginPath = obj.parent.path.join(obj.pluginPath, plugin.shortName);
            rimraf.sync(pluginPath);
            parent.db.deletePlugin(id, func);
            delete obj.plugins[plugin.shortName];
            obj.parent.updateMeshCore();
        });
    };
    
    obj.handleAdminReq = function (req, res, user, serv) {
        var path = obj.path.join(obj.pluginPath, req.query.pin, 'views');
        serv.app.set('views', path);
        if (obj.plugins[req.query.pin] != null && typeof obj.plugins[req.query.pin].handleAdminReq == 'function') {
            obj.plugins[req.query.pin].handleAdminReq(req, res, user);
        }
        else {
            res.sendStatus(401);
        }
    }
    
    obj.handleAdminPostReq = function(req, res, user, serv) {
        var path = obj.path.join(obj.pluginPath, req.query.pin, 'views');
        serv.app.set('views', path);
        if (obj.plugins[req.query.pin] != null && typeof obj.plugins[req.query.pin].handleAdminPostReq == 'function') {
            obj.plugins[req.query.pin].handleAdminPostReq(req, res, user);
        }
        else {
            res.sendStatus(401);
        }
    }
    return obj;
};