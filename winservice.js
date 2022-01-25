/**
* @description Windows Service Launcher
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
"use strict";

function start() {
    if (require('os').platform() != 'win32') { console.log('ERROR: Win32 only'); process.exit(255); return; }

    try {
        const fs = require('fs');
        const path = require('path');

        // Search for meshcentral.js
        var cwd = null;
        var runarg = null;
        if (fs.existsSync(path.join(__dirname, 'meshcentral.js'))) {
            runarg = path.join(__dirname, 'meshcentral.js');
            cwd = __dirname;
        } else if (fs.existsSync(path.join(__dirname, '../node_modules/meshcentral/meshcentral.js'))) {
            runarg = path.join(__dirname, '../node_modules/meshcentral/meshcentral.js');
            cwd = path.join(__dirname, '..');
        } else if (fs.existsSync(path.join(__dirname, '../meshcentral/meshcentral.js'))) {
            runarg = path.join(__dirname, '../meshcentral/meshcentral.js');
            cwd = path.join(__dirname, '../meshcentral');
        } else if (fs.existsSync(path.join(__dirname, '../meshcentral.js'))) {
            runarg = path.join(__dirname, '../meshcentral.js');
            cwd = path.join(__dirname, '..');
        }
        if (runarg == null) { console.log('ERROR: Unable to find MeshCentral.js'); process.exit(255); return; }

        // Setup libraries
        const args = require(path.join(cwd, 'node_modules/minimist'))(process.argv.slice(2));
        const nodewindows = require(path.join(cwd, 'node_modules/node-windows'));
        const service = nodewindows.Service;
        const eventlogger = nodewindows.EventLogger;
        const servicelog = new eventlogger('MeshCentral');

        // Check if we need to install, start, stop, remove ourself as a background service
        if (((args.install == true) || (args.uninstall == true) || (args.start == true) || (args.stop == true) || (args.restart == true))) {
            var env = [], xenv = ['user', 'port', 'aliasport', 'mpsport', 'mpsaliasport', 'redirport', 'exactport', 'debug'];
            for (var i in xenv) { if (args[xenv[i]] != null) { env.push({ name: 'mesh' + xenv[i], value: args[xenv[i]] }); } } // Set some args as service environement variables.
            var svc = new service({ name: 'MeshCentral', description: 'MeshCentral Remote Management Server', script: path.join(__dirname, 'winservice.js'), env: env, wait: 2, grow: 0.5 });
            svc.on('install', function () { console.log('MeshCentral service installed.'); svc.start(); });
            svc.on('uninstall', function () { console.log('MeshCentral service uninstalled.'); process.exit(); });
            svc.on('start', function () { console.log('MeshCentral service started.'); process.exit(); });
            svc.on('stop', function () { console.log('MeshCentral service stopped.'); if (args.stop) { process.exit(); } if (args.restart) { console.log('Holding 5 seconds...'); setTimeout(function () { svc.start(); }, 5000); } });
            svc.on('alreadyinstalled', function () { console.log('MeshCentral service already installed.'); process.exit(); });
            svc.on('invalidinstallation', function () { console.log('Invalid MeshCentral service installation.'); process.exit(); });

            if (args.install == true) { try { svc.install(); } catch (e) { logException(e); } }
            if (args.stop == true || args.restart == true) { try { svc.stop(); } catch (e) { logException(e); } }
            if (args.start == true || args.restart == true) { try { svc.start(); } catch (e) { logException(e); } }
            if (args.uninstall == true) { try { svc.uninstall(); } catch (e) { logException(e); } }
            return;
        }

        // This module is only called when MeshCentral is running as a Windows service.
        // In this case, we don't want to start a child process, so we launch directly without arguments.
        require(runarg).mainStart({ "launch": true });
    } catch (ex) { console.log(ex); }

    // Logging funtions
    function logException(e) { e += ''; logErrorEvent(e); }
    function logInfoEvent(msg) { if (servicelog != null) { servicelog.info(msg); } console.log(msg); }
    function logWarnEvent(msg) { if (servicelog != null) { servicelog.warn(msg); } console.log(msg); }
    function logErrorEvent(msg) { if (servicelog != null) { servicelog.error(msg); } console.error(msg); }
}

start();