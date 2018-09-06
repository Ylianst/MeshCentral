/**
* @description MeshCentral main module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
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

// If app metrics is available
if (process.argv[2] == '--launch') { try { require('appmetrics-dash').monitor({ url: '/', title: 'MeshCentral', port: 88, host: '127.0.0.1' }); } catch (e) { } }

function CreateMeshCentralServer(config, args) {
    var obj = {};
    obj.db = null;
    obj.webserver = null;
    obj.redirserver = null;
    obj.mpsserver = null;
    obj.swarmserver = null;
    obj.mailserver = null;
    obj.amtEventHandler = null;
    obj.amtScanner = null;
    obj.meshScanner = null;
    obj.letsencrypt = null;
    obj.eventsDispatch = {};
    obj.fs = require('fs');
    obj.path = require('path');
    obj.crypto = require('crypto');
    obj.exeHandler = require('./exeHandler.js');
    obj.platform = require('os').platform();
    obj.args = args;
    obj.common = require('./common.js');
    obj.certificates = null;
    obj.connectivityByNode = {};      // This object keeps a list of all connected CIRA and agents, by nodeid->value (value: 1 = Agent, 2 = CIRA, 4 = AmtDirect)
    obj.peerConnectivityByNode = {};  // This object keeps a list of all connected CIRA and agents of peers, by serverid->nodeid->value (value: 1 = Agent, 2 = CIRA, 4 = AmtDirect)
    obj.debugLevel = 0;
    obj.config = config;              // Configuration file
    obj.dbconfig = {};                // Persistance values, loaded from database
    obj.certificateOperations = null;
    obj.defaultMeshCmd = null;
    obj.defaultMeshCore = null;
    obj.defaultMeshCoreHash = null;
    obj.defaultMeshCoreNoMei = null;
    obj.defaultMeshCoreNoMeiHash = null;
    obj.meshAgentBinaries = {};       // Mesh Agent Binaries, Architecture type --> { hash:(sha384 hash), size:(binary size), path:(binary path) }
    obj.meshAgentInstallScripts = {}; // Mesh Install Scripts, Script ID -- { hash:(sha384 hash), size:(binary size), path:(binary path) }
    obj.multiServer = null;
    obj.maintenanceTimer = null;
    obj.serverId = null;
    obj.currentVer = null;
    obj.serverKey = new Buffer(obj.crypto.randomBytes(32), 'binary');
    obj.loginCookieEncryptionKey = null;
    try { obj.currentVer = JSON.parse(obj.fs.readFileSync(obj.path.join(__dirname, 'package.json'), 'utf8')).version; } catch (e) { } // Fetch server version

    // Setup the default configuration and files paths
    if ((__dirname.endsWith('/node_modules/meshcentral')) || (__dirname.endsWith('\\node_modules\\meshcentral')) || (__dirname.endsWith('/node_modules/meshcentral/')) || (__dirname.endsWith('\\node_modules\\meshcentral\\'))) {
        obj.datapath = obj.path.join(__dirname, '../../meshcentral-data');
        obj.filespath = obj.path.join(__dirname, '../../meshcentral-files');
    } else {
        obj.datapath = obj.path.join(__dirname, '../meshcentral-data');
        obj.filespath = obj.path.join(__dirname, '../meshcentral-files');
    }

    // Create data and files folders if needed
    try { obj.fs.mkdirSync(obj.datapath); } catch (e) { }
    try { obj.fs.mkdirSync(obj.filespath); } catch (e) { }

    // Windows Specific Code, setup service and event log
    obj.service = null;
    obj.servicelog = null;
    if (obj.platform == 'win32') {
        var nodewindows = require('node-windows');
        obj.service = nodewindows.Service;
        var eventlogger = nodewindows.EventLogger;
        obj.servicelog = new eventlogger('MeshCentral');
    }

    // Start the Meshcentral server
    obj.Start = function () {
        var i;
        try { require('./pass').hash('test', function () { }); } catch (e) { console.log('Old version of node, must upgrade.'); return; } // TODO: Not sure if this test works or not.

        // Check for invalid arguments
        var validArguments = ['_', 'notls', 'user', 'port', 'aliasport', 'mpsport', 'mpsaliasport', 'redirport', 'cert', 'mpscert', 'deletedomain', 'deletedefaultdomain', 'showall', 'showusers', 'shownodes', 'showmeshes', 'showevents', 'showpower', 'clearpower', 'showiplocations', 'help', 'exactports', 'install', 'uninstall', 'start', 'stop', 'restart', 'debug', 'filespath', 'datapath', 'noagentupdate', 'launch', 'noserverbackup', 'mongodb', 'mongodbcol', 'wanonly', 'lanonly', 'nousers', 'mpsdebug', 'mpspass', 'ciralocalfqdn', 'dbexport', 'dbimport', 'selfupdate', 'tlsoffload', 'userallowedip', 'fastcert', 'swarmport', 'swarmdebug', 'logintoken', 'logintokenkey', 'logintokengen', 'logintokengen', 'mailtokengen', 'admin', 'unadmin', 'sessionkey', 'sessiontime', 'minify'];
        for (var arg in obj.args) { obj.args[arg.toLocaleLowerCase()] = obj.args[arg]; if (validArguments.indexOf(arg.toLocaleLowerCase()) == -1) { console.log('Invalid argument "' + arg + '", use --help.'); return; } }
        if (obj.args.mongodb == true) { console.log('Must specify: --mongodb [connectionstring] \r\nSee https://docs.mongodb.com/manual/reference/connection-string/ for MongoDB connection string.'); return; }
        for (i in obj.config.settings) { obj.args[i] = obj.config.settings[i]; } // Place all settings into arguments, arguments have already been placed into settings so arguments take precedence.

        if ((obj.args.help == true) || (obj.args['?'] == true)) {
            console.log('MeshCentral2 Beta 2, a web-based remote computer management web portal.\r\n');
            if (obj.platform == 'win32') {
                console.log('Run as a Windows Service');
                console.log('   --install/uninstall               Install Meshcentral as a background service.');
                console.log('   --start/stop/restart              Control Meshcentral background service.');
                console.log('Run standalone, console application');
            }
            console.log('   --notls                           Use HTTP instead of HTTPS for the main web server.');
            console.log('   --user [username]                 Always login as [username] if account exists.');
            console.log('   --port [number]                   Web server port number.');
            console.log('   --mpsport [number]                Intel AMT server port number.');
            console.log('   --redirport [number]              Creates an additional HTTP server to redirect users to the HTTPS server.');
            console.log('   --exactports                      Server must run with correct ports or exit.');
            console.log('   --noagentupdate                   Server will not update mesh agent native binaries.');
            console.log('   --fastcert                        Generate weaker RSA2048 certificates.');
            console.log('   --cert [name], (country), (org)   Create a web server certificate with [name] server name.');
            console.log('                                     country and organization can optionaly be set.');
            return;
        }

        // Check if we need to install, start, stop, remove ourself as a background service
        if ((obj.service != null) && ((obj.args.install == true) || (obj.args.uninstall == true) || (obj.args.start == true) || (obj.args.stop == true) || (obj.args.restart == true))) {
            var env = [], xenv = ['user', 'port', 'aliasport', 'mpsport', 'mpsaliasport', 'redirport', 'exactport', 'debug'];
            for (i in xenv) { if (obj.args[xenv[i]] != null) { env.push({ name: 'mesh' + xenv[i], value: obj.args[xenv[i]] }); } } // Set some args as service environement variables.
            var svc = new obj.service({ name: 'MeshCentral', description: 'MeshCentral Remote Management Server', script: obj.path.join(__dirname, 'winservice.js'), env: env, wait: 2, grow: 0.5 });
            svc.on('install', function () { console.log('MeshCentral service installed.'); svc.start(); });
            svc.on('uninstall', function () { console.log('MeshCentral service uninstalled.'); process.exit(); });
            svc.on('start', function () { console.log('MeshCentral service started.'); process.exit(); });
            svc.on('stop', function () { console.log('MeshCentral service stopped.'); if (obj.args.stop) { process.exit(); } if (obj.args.restart) { console.log('Holding 5 seconds...'); setTimeout(function () { svc.start(); }, 5000); } });
            svc.on('alreadyinstalled', function () { console.log('MeshCentral service already installed.'); process.exit(); });
            svc.on('invalidinstallation', function () { console.log('Invalid MeshCentral service installation.'); process.exit(); });

            if (obj.args.install == true) { try { svc.install(); } catch (e) { logException(e); } }
            if (obj.args.stop == true || obj.args.restart == true) { try { svc.stop(); } catch (e) { logException(e); } }
            if (obj.args.start == true || obj.args.restart == true) { try { svc.start(); } catch (e) { logException(e); } }
            if (obj.args.uninstall == true) { try { svc.uninstall(); } catch (e) { logException(e); } }
            return;
        }

        // If "--launch" is in the arguments, launch now
        if (obj.args.launch == 1) {
            obj.StartEx();
        } else {
            // if "--launch" is not specified, launch the server as a child process.
            var startLine = '';
            for (i in process.argv) {
                var arg = process.argv[i];
                if (arg.length > 0) {
                    if (startLine.length > 0) startLine += ' ';
                    if (arg.indexOf(' ') >= 0) { startLine += '"' + arg + '"'; } else { startLine += arg; }
                }
            }
            obj.launchChildServer(startLine);
        }
    };

    // Launch MeshCentral as a child server and monitor it.
    obj.launchChildServer = function (startLine) {
        var child_process = require('child_process');
        var xprocess = child_process.exec(startLine + ' --launch', { maxBuffer: Infinity }, function (error, stdout, stderr) {
            if (xprocess.xrestart == 1) {
                setTimeout(function () { obj.launchChildServer(startLine); }, 500); // This is an expected restart.
            } else if (xprocess.xrestart == 2) {
                console.log('Expected exit...');
                process.exit(); // User CTRL-C exit.
            } else if (xprocess.xrestart == 3) {
                // Server self-update exit
                var child_process = require('child_process');
                var xxprocess = child_process.exec('npm install meshcentral', { maxBuffer: Infinity, cwd: obj.path.join(__dirname, '../..') }, function (error, stdout, stderr) { });
                xxprocess.data = '';
                xxprocess.stdout.on('data', function (data) { xxprocess.data += data; });
                xxprocess.stderr.on('data', function (data) { xxprocess.data += data; });
                xxprocess.on('close', function (code) { console.log('Update completed...'); setTimeout(function () { obj.launchChildServer(startLine); }, 1000); });
            } else {
                if (error != null) {
                    // This is an un-expected restart
                    console.log(error);
                    console.log('ERROR: MeshCentral failed with critical error, check MeshErrors.txt. Restarting in 5 seconds...');
                    setTimeout(function () { obj.launchChildServer(startLine); }, 5000);
                }
            }
        });
        xprocess.stdout.on('data', function (data) { if (data[data.length - 1] == '\n') { data = data.substring(0, data.length - 1); } if (data.indexOf('Updating settings folder...') >= 0) { xprocess.xrestart = 1; } else if (data.indexOf('Updating server certificates...') >= 0) { xprocess.xrestart = 1; } else if (data.indexOf('Server Ctrl-C exit...') >= 0) { xprocess.xrestart = 2; } else if (data.indexOf('Starting self upgrade...') >= 0) { xprocess.xrestart = 3; } console.log(data); });
        xprocess.stderr.on('data', function (data) {
            if (data.startsWith('le.challenges[tls-sni-01].loopback')) { return; } // Ignore this error output from GreenLock
            if (data[data.length - 1] == '\n') { data = data.substring(0, data.length - 1); } obj.fs.appendFileSync(obj.getConfigFilePath('mesherrors.txt'), '-------- ' + new Date().toLocaleString() + ' --------\r\n\r\n' + data + '\r\n\r\n\r\n');
        });
        xprocess.on('close', function (code) { if ((code != 0) && (code != 123)) { /* console.log("Exited with code " + code); */ } });
    };

    // Get current and latest MeshCentral server versions using NPM
    obj.getLatestServerVersion = function (callback) {
        if (callback == null) return;
        var child_process = require('child_process');
        var xprocess = child_process.exec('npm view meshcentral dist-tags.latest', { maxBuffer: 512000 }, function (error, stdout, stderr) { });
        xprocess.data = '';
        xprocess.stdout.on('data', function (data) { xprocess.data += data; });
        xprocess.stderr.on('data', function (data) { });
        xprocess.on('close', function (code) {
            var latestVer = null;
            if (code == 0) { try { latestVer = xprocess.data.split(' ').join('').split('\r').join('').split('\n').join(''); } catch (e) { } }
            callback(obj.currentVer, latestVer);
        });
    };

    // Initiate server self-update
    obj.performServerUpdate = function () { console.log('Starting self upgrade...'); process.exit(200); };

    // Initiate server self-update
    obj.performServerCertUpdate = function () { console.log('Updating server certificates...'); process.exit(200); };

    obj.StartEx = function () {
        var i;
        //var wincmd = require('node-windows');
        //wincmd.list(function (svc) { console.log(svc); }, true);

        // Write the server state
        obj.updateServerState('state', 'starting');

        // Look to see if data and/or file path is specified
        if (obj.args.datapath) { obj.datapath = obj.args.datapath; }
        if (obj.args.filespath) { obj.filespath = obj.args.filespath; }

        // Read environment variables. For a subset of arguments, we allow them to be read from environment variables.
        var xenv = ['user', 'port', 'mpsport', 'mpsaliasport', 'redirport', 'exactport', 'debug'];
        for (i in xenv) { if ((obj.args[xenv[i]] == null) && (process.env['mesh' + xenv[i]])) { obj.args[xenv[i]] = obj.common.toNumber(process.env['mesh' + xenv[i]]); } }

        // Validate the domains, this is used for multi-hosting
        if (obj.config.domains == null) { obj.config.domains = {}; }
        if (obj.config.domains[''] == null) { obj.config.domains[''] = {}; }
        if (obj.config.domains[''].dns != null) { console.log("ERROR: Default domain can't have a DNS name."); return; }
        var xdomains = {}; for (i in obj.config.domains) { if (!obj.config.domains[i].title) { obj.config.domains[i].title = 'MeshCentral'; } if (!obj.config.domains[i].title2) { obj.config.domains[i].title2 = '2.0 Beta 2'; } xdomains[i.toLowerCase()] = obj.config.domains[i]; } obj.config.domains = xdomains;
        var bannedDomains = ['public', 'private', 'images', 'scripts', 'styles', 'views']; // List of banned domains
        for (i in obj.config.domains) { for (var j in bannedDomains) { if (i == bannedDomains[j]) { console.log("ERROR: Domain '" + i + "' is not allowed domain name in ./data/config.json."); return; } } }
        for (i in obj.config.domains) {
            if (obj.config.domains[i].dns == null) { obj.config.domains[i].url = (i == '') ? '/' : ('/' + i + '/'); } else { obj.config.domains[i].url = '/'; }
            obj.config.domains[i].id = i;
            if (typeof obj.config.domains[i].userallowedip == 'string') { obj.config.domains[i].userallowedip = null; if (obj.config.domains[i].userallowedip != "") { obj.config.domains[i].userallowedip = obj.config.domains[i].userallowedip.split(','); } }
        }

        // Log passed arguments into Windows Service Log
        //if (obj.servicelog != null) { var s = ''; for (i in obj.args) { if (i != '_') { if (s.length > 0) { s += ', '; } s += i + "=" + obj.args[i]; } } logInfoEvent('MeshServer started with arguments: ' + s); }

        // Look at passed in arguments
        if ((obj.args.user != null) && (typeof obj.args.user != 'string')) { delete obj.args.user; }
        if ((obj.args.ciralocalfqdn != null) && ((obj.args.lanonly == true) || (obj.args.wanonly == true))) { console.log("WARNING: CIRA local FQDN's ignored when server in LAN-only or WAN-only mode."); }
        if ((obj.args.ciralocalfqdn != null) && (obj.args.ciralocalfqdn.split(',').length > 4)) { console.log("WARNING: Can't have more than 4 CIRA local FQDN's. Ignoring value."); obj.args.ciralocalfqdn = null; }
        if (obj.args.port == null || typeof obj.args.port != 'number') { if (obj.args.notls == null) { obj.args.port = 443; } else { obj.args.port = 80; } }
        if (obj.args.aliasport != null && (typeof obj.args.aliasport != 'number')) obj.args.aliasport = null;
        if (obj.args.mpsport == null || typeof obj.args.mpsport != 'number') obj.args.mpsport = 4433;
        if (obj.args.mpsaliasport != null && (typeof obj.args.mpsaliasport != 'number')) obj.args.mpsaliasport = null;
        if (obj.args.notls == null && obj.args.redirport == null) obj.args.redirport = 80;
        if (typeof obj.args.debug == 'number') obj.debugLevel = obj.args.debug;
        if (obj.args.debug == true) obj.debugLevel = 1;
        obj.db = require('./db.js').CreateDB(obj);
        obj.db.SetupDatabase(function (dbversion) {
            // See if any database operations needs to be completed
            if (obj.args.deletedomain) { obj.db.DeleteDomain(obj.args.deletedomain, function () { console.log('Deleted domain ' + obj.args.deletedomain + '.'); process.exit(); }); return; }
            if (obj.args.deletedefaultdomain) { obj.db.DeleteDomain('', function () { console.log('Deleted default domain.'); process.exit(); }); return; }
            if (obj.args.showall) { obj.db.GetAll(function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showusers) { obj.db.GetAllType('user', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.shownodes) { obj.db.GetAllType('node', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showmeshes) { obj.db.GetAllType('mesh', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showevents) { obj.db.GetAllType('event', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showpower) { obj.db.GetAllType('power', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.clearpower) { obj.db.RemoveAllOfType('power', function () { process.exit(); }); return; }
            if (obj.args.showiplocations) { obj.db.GetAllType('iploc', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.logintoken) { obj.getLoginToken(obj.args.logintoken, function (r) { console.log(r); process.exit(); }); return; }
            if (obj.args.logintokenkey) { obj.showLoginTokenKey(function (r) { console.log(r); process.exit(); }); return; }
            if (obj.args.dbexport) {
                // Export the entire database to a JSON file
                if (obj.args.dbexport == true) { obj.args.dbexport = obj.getConfigFilePath('meshcentral.db.json'); }
                obj.db.GetAll(function (err, docs) {
                    obj.fs.writeFileSync(obj.args.dbexport, JSON.stringify(docs));
                    console.log('Exported ' + docs.length + ' objects(s) to ' + obj.args.dbexport + '.'); process.exit();
                });
                return;
            }
            if (obj.args.dbimport) {
                // Import the entire database from a JSON file
                if (obj.args.dbimport == true) { obj.args.dbimport = obj.getConfigFilePath('meshcentral.db.json'); }
                var json = null, json2 = "", badCharCount = 0;
                try { json = obj.fs.readFileSync(obj.args.dbimport, { encoding: 'utf8' }); } catch (e) { console.log('Invalid JSON file: ' + obj.args.dbimport + '.'); process.exit(); }
                for (i = 0; i < json.length; i++) { if (json.charCodeAt(i) >= 32) { json2 += json[i]; } else { var tt = json.charCodeAt(i); if (tt != 10 && tt != 13) { badCharCount++; } } } // Remove all bad chars
                if (badCharCount > 0) { console.log(badCharCount + ' invalid character(s) where removed.'); }
                try { json = JSON.parse(json2); } catch (e) { console.log('Invalid JSON format: ' + obj.args.dbimport + ': ' + e); process.exit(); }
                if ((json == null) || (typeof json.length != 'number') || (json.length < 1)) { console.log('Invalid JSON format: ' + obj.args.dbimport + '.'); }
                for (i in json) { if ((json[i].type == "mesh") && (json[i].links != null)) { for (var j in json[i].links) { var esc = obj.common.escapeFieldName(j); if (esc !== j) { json[i].links[esc] = json[i].links[j]; delete json[i].links[j]; } } } } // Escape MongoDB invalid field chars
                //for (i in json) { if ((json[i].type == "node") && (json[i].host != null)) { json[i].rname = json[i].host; delete json[i].host; } } // DEBUG: Change host to rname
                obj.db.RemoveAll(function () { obj.db.InsertMany(json, function (err) { if (err != null) { console.log(err); } else { console.log('Imported ' + json.length + ' objects(s) from ' + obj.args.dbimport + '.'); } process.exit(); }); });
                return;
            }

            // Clear old event entries and power entires
            obj.db.clearOldEntries('event', 30); // Clear all event entires that are older than 30 days.
            obj.db.clearOldEntries('power', 10); // Clear all event entires that are older than 10 days. If a node is connected longer than 10 days, current power state will be used for everything.

            // Setup a site administrator
            if ((obj.args.admin) && (typeof obj.args.admin == 'string')) {
                var adminname = obj.args.admin.split('/');
                if (adminname.length == 1) { adminname = 'user//' + adminname[0]; }
                else if (adminname.length == 2) { adminname = 'user/' + adminname[0] + '/' + adminname[1]; }
                else { console.log('Invalid administrator name.'); process.exit(); return; }
                obj.db.Get(adminname, function (err, user) {
                    if (user.length != 1) { console.log('Invalid user name.'); process.exit(); return; }
                    user[0].siteadmin = 0xFFFFFFFF;
                    obj.db.Set(user[0], function () {
                        if (user[0].domain == '') { console.log('User ' + user[0].name + ' set to site administrator.'); } else { console.log('User ' + user[0].name + ' of domain ' + user[0].domain + ' set to site administrator.'); }
                        process.exit();
                        return;
                    });
                });
                return;
            }

            // Remove a site administrator
            if ((obj.args.unadmin) && (typeof obj.args.unadmin == 'string')) {
                var adminname = obj.args.unadmin.split('/');
                if (adminname.length == 1) { adminname = 'user//' + adminname[0]; }
                else if (adminname.length == 2) { adminname = 'user/' + adminname[0] + '/' + adminname[1]; }
                else { console.log('Invalid administrator name.'); process.exit(); return; }
                obj.db.Get(adminname, function (err, user) {
                    if (user.length != 1) { console.log('Invalid user name.'); process.exit(); return; }
                    if (user[0].siteadmin) { delete user[0].siteadmin; }
                    obj.db.Set(user[0], function () {
                        if (user[0].domain == '') { console.log('User ' + user[0].name + ' is not a site administrator.'); } else { console.log('User ' + user[0].name + ' of domain ' + user[0].domain + ' is not a site administrator.'); }
                        process.exit();
                        return;
                    });
                });
                return;
            }

            // Perform other database cleanup
            obj.db.cleanup();

            // Set all nodes to power state of unknown (0)
            if (obj.multiServer == null) {
                obj.db.file.insert({ type: 'power', time: Date.now(), node: '*', power: 0, s: 1 });
            } else {
                obj.db.file.insert({ type: 'power', time: Date.now(), node: '*', power: 0, s: 1, server: obj.multiServer.serverid });
            }

            // Read or setup database configuration values
            obj.db.Get('dbconfig', function (err, dbconfig) {
                if (dbconfig.length == 1) { obj.dbconfig = dbconfig[0]; } else { obj.dbconfig = { _id: 'dbconfig', version: 1 }; }
                if (obj.dbconfig.amtWsEventSecret == null) { require('crypto').randomBytes(32, function (err, buf) { obj.dbconfig.amtWsEventSecret = buf.toString('hex'); obj.db.Set(obj.dbconfig); }); }

                // This is used by the user to create a username/password for a Intel AMT WSMAN event subscription
                if (obj.args.getwspass) {
                    if (obj.args.getwspass.length == 64) {
                        require('crypto').randomBytes(6, function (err, buf) {
                            while (obj.dbconfig.amtWsEventSecret == null) { process.nextTick(); }
                            var username = buf.toString('hex');
                            var nodeid = obj.args.getwspass;
                            var pass = require('crypto').createHash('sha384').update(username.toLowerCase() + ":" + nodeid + ":" + obj.dbconfig.amtWsEventSecret).digest("base64").substring(0, 12).split("/").join("x").split("\\").join("x");
                            console.log('--- Intel(r) AMT WSMAN eventing credentials ---');
                            console.log('Username: ' + username);
                            console.log('Password: ' + pass);
                            console.log('Argument: ' + nodeid);
                            process.exit();
                        });
                    } else {
                        console.log('Invalid NodeID.');
                        process.exit();
                    }
                    return;
                }

                // Load the default meshcore and meshcmd
                obj.updateMeshCore();
                obj.updateMeshCmd();

                // Setup and start the redirection server if needed
                if ((obj.args.redirport != null) && (typeof obj.args.redirport == 'number') && (obj.args.redirport != 0)) {
                    obj.redirserver = require('./redirserver.js').CreateRedirServer(obj, obj.db, obj.args, obj.StartEx2);
                } else {
                    obj.StartEx2(); // If not needed, move on.
                }
            });
        });
    };

    // Done starting the redirection server, go on to load the server certificates
    obj.StartEx2 = function () {
        // Load server certificates
        obj.certificateOperations = require('./certoperations.js').CertificateOperations();
        obj.certificateOperations.GetMeshServerCertificate(obj, obj.args, obj.config, function (certs) {
            if (obj.config.letsencrypt == null) {
                obj.StartEx3(certs); // Just use the configured certificates
            } else {
                var le = require('./letsencrypt.js');
                obj.letsencrypt = le.CreateLetsEncrypt(obj);
                if (obj.letsencrypt != null) {
                    obj.letsencrypt.getCertificate(certs, obj.StartEx3); // Use Let's Encrypt certificate
                } else {
                    console.log('ERROR: Unable to setup GreenLock module.');
                    obj.StartEx3(certs); // Let's Encrypt did not load, just use the configured certificates
                }
            }
        });
    };

    // Start the server with the given certificates
    obj.StartEx3 = function (certs) {
        var i;
        obj.certificates = certs;
        obj.certificateOperations.acceleratorStart(certs); // Set the state of the accelerators

        // If the certificate is un-configured, force LAN-only mode
        if (obj.certificates.CommonName == 'un-configured') { console.log('Server name not configured, running in LAN-only mode.'); obj.args.lanonly = true; }

        // Check that no sub-domains have the same DNS as the parent
        for (i in obj.config.domains) {
            if ((obj.config.domains[i].dns != null) && (obj.certificates.CommonName.toLowerCase() === obj.config.domains[i].dns.toLowerCase())) {
                console.log("ERROR: Server sub-domain can't have same DNS name as the parent."); process.exit(0); return;
            }
        }

        // Load the list of mesh agents and install scripts
        if (obj.args.noagentupdate == 1) { for (i in obj.meshAgentsArchitectureNumbers) { obj.meshAgentsArchitectureNumbers[i].update = false; } }
        obj.updateMeshAgentsTable(function () {
            obj.updateMeshAgentInstallScripts();

            // Setup and start the web server
            require('crypto').randomBytes(48, function (err, buf) {
                // Setup Mesh Multi-Server if needed
                obj.multiServer = require('./multiserver.js').CreateMultiServer(obj, obj.args);
                if (obj.multiServer != null) {
                    obj.serverId = obj.multiServer.serverid;
                    for (var serverid in obj.config.peers.servers) { obj.peerConnectivityByNode[serverid] = {}; }
                }

                // If the server is set to "nousers", allow only loopback unless IP filter is set
                if ((obj.args.nousers == true) && (obj.args.userallowedip == null)) { obj.args.userallowedip = "::1,127.0.0.1"; }

                // Set the session length to 60 minutes if not set and set a random key if needed
                if ((obj.args.sessiontime != null) && ((typeof obj.args.sessiontime != 'number') || (obj.args.sessiontime < 1))) { delete obj.args.sessiontime; }
                if (!obj.args.sessionkey) { obj.args.sessionkey = buf.toString('hex').toUpperCase(); }

                // Start eh web server and if needed, the redirection web server.
                obj.webserver = require('./webserver.js').CreateWebServer(obj, obj.db, obj.args, obj.certificates);
                if (obj.redirserver != null) { obj.redirserver.hookMainWebServer(obj.certificates); }

                // Setup the Intel AMT event handler
                obj.amtEventHandler = require('./amtevents.js').CreateAmtEventsHandler(obj);

                // Setup the Intel AMT local network scanner
                if (obj.args.wanonly != true) {
                    obj.amtScanner = require('./amtscanner.js').CreateAmtScanner(obj).start();
                    obj.meshScanner = require('./meshscanner.js').CreateMeshScanner(obj).start();
                }

                // Setup and start the MPS server
                if ((obj.args.lanonly != true) && (obj.args.mpsport !== 0)) {
                    obj.mpsserver = require('./mpsserver.js').CreateMpsServer(obj, obj.db, obj.args, obj.certificates);
                }

                // Setup and start the legacy swarm server
                if ((obj.certificates.swarmserver != null) && (obj.args.swarmport !== 0)) {
                    if (obj.args.swarmport == null) { obj.args.swarmport = 8080; }
                    obj.swarmserver = require('./swarmserver.js').CreateSwarmServer(obj, obj.db, obj.args, obj.certificates);
                }

                // Setup email server
                if ((obj.config.smtp != null) && (obj.config.smtp.host != null) && (obj.config.smtp.from != null)) {
                    obj.mailserver = require('./meshmail.js').CreateMeshMail(obj);
                    obj.mailserver.verify();
                }

                // Start periodic maintenance
                obj.maintenanceTimer = setInterval(obj.maintenanceActions, 1000 * 60 * 60); // Run this every hour

                // Dispatch an event that the server is now running
                obj.DispatchEvent(['*'], obj, { etype: 'server', action: 'started', msg: 'Server started' });

                // Load the login cookie encryption key from the database if allowed
                if ((obj.config) && (obj.config.settings) && (obj.config.settings.allowlogintoken == true)) {
                    obj.db.Get('LoginCookieEncryptionKey', function (err, docs) {
                        if ((docs.length > 0) && (docs[0].key != null) && (obj.args.logintokengen == null)) {
                            obj.loginCookieEncryptionKey = Buffer.from(docs[0].key, 'hex');
                        } else {
                            obj.loginCookieEncryptionKey = obj.generateCookieKey(); obj.db.Set({ _id: 'LoginCookieEncryptionKey', key: obj.loginCookieEncryptionKey.toString('hex'), time: Date.now() });
                        }
                    });
                }

                //obj.debug(1, 'Server started');
                if (obj.args.nousers == true) { obj.updateServerState('nousers', '1'); }
                obj.updateServerState('state', 'running');
            });
        });
    };

    // Perform maintenance operations (called every hour)
    obj.maintenanceActions = function () {
        // Check if we need to perform server self-update
        if (obj.args.selfupdate == true) {
            obj.db.getValueOfTheDay('performSelfUpdate', 1, function (performSelfUpdate) {
                if (performSelfUpdate.value > 0) {
                    performSelfUpdate.value--;
                    obj.db.Set(performSelfUpdate);
                    obj.getLatestServerVersion(function (currentVer, latestVer) { if (currentVer != latestVer) { obj.performServerUpdate(); return; } });
                }
            });
        }

        // Clear old event entries and power entires
        obj.db.clearOldEntries('event', 30); // Clear all event entires that are older than 30 days.
        obj.db.clearOldEntries('power', 10); // Clear all event entires that are older than 10 days. If a node is connected longer than 10 days, current power state will be used for everything.

        // Perform other database cleanup
        obj.db.cleanup();
    };

    // Stop the Meshcentral server
    obj.Stop = function (restoreFile) {
        // If the database is not setup, exit now.
        if (!obj.db) return;

        // Dispatch an event saying the server is now stopping
        obj.DispatchEvent(['*'], obj, { etype: 'server', action: 'stopped', msg: 'Server stopped' });

        // Set all nodes to power state of unknown (0)
        var record = { type: 'power', time: Date.now(), node: '*', power: 0, s: 2 };
        if (obj.multiServer != null) { record.server = obj.multiServer.serverid; }
        obj.db.file.insert(record, function () {
            if (restoreFile) {
                obj.debug(1, 'Server stopped, updating settings: ' + restoreFile);
                console.log('Updating settings folder...');
                /*
                var unzip = require('unzip');
                var rs = obj.fs.createReadStream(restoreFile);
                rs.on('end', () => { setTimeout(function () { fs.unlinkSync(restoreFile); process.exit(123); }, 500); });
                rs.pipe(unzip.Extract({ path: obj.datapath }));
                */

                var yauzl = require("yauzl");
                yauzl.open(restoreFile, { lazyEntries: true }, function (err, zipfile) {
                    if (err) throw err;
                    zipfile.readEntry();
                    zipfile.on("entry", function (entry) {
                        if (/\/$/.test(entry.fileName)) {
                            // Directory file names end with '/'.
                            // Note that entires for directories themselves are optional.
                            // An entry's fileName implicitly requires its parent directories to exist.
                            zipfile.readEntry();
                        } else {
                            // file entry
                            zipfile.openReadStream(entry, function (err, readStream) {
                                if (err) throw err;
                                readStream.on("end", function () { zipfile.readEntry(); });
                                // console.log('Extracting:', obj.getConfigFilePath(entry.fileName));
                                readStream.pipe(obj.fs.createWriteStream(obj.getConfigFilePath(entry.fileName)));
                            });
                        }
                    });
                    zipfile.on("end", function () { setTimeout(function () { obj.fs.unlinkSync(restoreFile); process.exit(123); }); });
                });
            } else {
                obj.debug(1, 'Server stopped');
                process.exit(0);
            }
        });

        // Update the server state
        obj.updateServerState('state', 'stopped');
    };
    
    // Event Dispatch
    obj.AddEventDispatch = function (ids, target) {
        obj.debug(3, 'AddEventDispatch', ids);
        for (var i in ids) { var id = ids[i]; if (!obj.eventsDispatch[id]) { obj.eventsDispatch[id] = [target]; } else { obj.eventsDispatch[id].push(target); } }
    };
    obj.RemoveEventDispatch = function (ids, target) {
        obj.debug(3, 'RemoveEventDispatch', id);
        for (var i in ids) { var id = ids[i]; if (obj.eventsDispatch[id]) { var j = obj.eventsDispatch[id].indexOf(target); if (j >= 0) { obj.eventsDispatch[id].splice(j, 1); } } }
    };
    obj.RemoveEventDispatchId = function (id) {
        obj.debug(3, 'RemoveEventDispatchId', id);
        if (obj.eventsDispatch[id] != null) { delete obj.eventsDispatch[id]; }
    };
    obj.RemoveAllEventDispatch = function (target) {
        obj.debug(3, 'RemoveAllEventDispatch');
        for (var i in obj.eventsDispatch) { var j = obj.eventsDispatch[i].indexOf(target); if (j >= 0) { obj.eventsDispatch[i].splice(j, 1); } }
    };
    obj.DispatchEvent = function (ids, source, event, fromPeerServer) {
        // If the database is not setup, exit now.
        if (!obj.db) return;

        obj.debug(3, 'DispatchEvent', ids);
        if (typeof event == 'object') {
            event.type = 'event';
            event.time = Date.now();
            event.ids = ids;
            if (!event.nolog) { obj.db.StoreEvent(ids, source, event); }
        }
        var targets = []; // List of targets we dispatched the event to, we don't want to dispatch to the same target twice.
        for (var j in ids) {
            var id = ids[j];
            if (obj.eventsDispatch[id]) {
                for (var i in obj.eventsDispatch[id]) {
                    if (targets.indexOf(obj.eventsDispatch[id][i]) == -1) { // Check if we already displatched to this target
                        targets.push(obj.eventsDispatch[id][i]);
                        obj.eventsDispatch[id][i].HandleEvent(source, event);
                    }
                }
            }
        }
        if ((fromPeerServer == null) && (obj.multiServer != null) && ((typeof event != 'object') || (event.nopeers != 1))) { obj.multiServer.DispatchEvent(ids, source, event); }
    };

    // Get the connection state of a node
    obj.GetConnectivityState = function (nodeid) { return obj.connectivityByNode[nodeid]; };

    // Get the routing server id for a given node and connection type, can never be self.
    obj.GetRoutingServerId = function (nodeid, connectType) {
        if (obj.multiServer == null) return null;
        for (var serverid in obj.peerConnectivityByNode) {
            if (serverid == obj.serverId) continue;
            var state = obj.peerConnectivityByNode[serverid][nodeid];
            if ((state != null) && ((state.connectivity & connectType) != 0)) { return { serverid: serverid, meshid: state.meshid }; }
        }
        return null;
    };

    // Update the connection state of a node when in multi-server mode
    // Update obj.connectivityByNode using obj.peerConnectivityByNode for the list of nodes in argument
    obj.UpdateConnectivityState = function (nodeids) {
        for (var nodeid in nodeids) {
            var meshid = null, state = null, oldConnectivity = 0, oldPowerState = 0, newConnectivity = 0, newPowerState = 0;
            var oldState = obj.connectivityByNode[nodeid];
            if (oldState != null) { meshid = oldState.meshid; oldConnectivity = oldState.connectivity; oldPowerState = oldState.powerState; }
            for (var serverid in obj.peerConnectivityByNode) {
                var peerState = obj.peerConnectivityByNode[serverid][nodeid];
                if (peerState != null) {
                    if (state == null) {
                        // Copy the state
                        state = {};
                        newConnectivity = state.connectivity = peerState.connectivity;
                        newPowerState = state.powerState = peerState.powerState;
                        meshid = state.meshid = peerState.meshid;
                        //if (peerState.agentPower) { state.agentPower = peerState.agentPower; }
                        //if (peerState.ciraPower) { state.ciraPower = peerState.ciraPower; }
                        //if (peerState.amtPower) { state.amtPower = peerState.amtPower; }
                    } else {
                        // Merge the state
                        state.connectivity |= peerState.connectivity;
                        newConnectivity = state.connectivity;
                        if ((peerState.powerState != 0) && ((state.powerState == 0) || (peerState.powerState < state.powerState))) { newPowerState = state.powerState = peerState.powerState; }
                        meshid = state.meshid = peerState.meshid;
                        //if (peerState.agentPower) { state.agentPower = peerState.agentPower; }
                        //if (peerState.ciraPower) { state.ciraPower = peerState.ciraPower; }
                        //if (peerState.amtPower) { state.amtPower = peerState.amtPower; }
                    }
                }
            }
            obj.connectivityByNode[nodeid] = state;

            //console.log('xx', nodeid, meshid, newConnectivity, oldPowerState, newPowerState, oldPowerState);

            // Event any changes on this server only
            if ((newConnectivity != oldPowerState) || (newPowerState != oldPowerState)) {
                obj.DispatchEvent(['*', meshid], obj, { action: 'nodeconnect', meshid: meshid, nodeid: nodeid, conn: newConnectivity, pwr: newPowerState, nolog: 1, nopeers: 1 });
            }
        }
    };

    // Set the connectivity state of a node and setup the server so that messages can be routed correctly.
    // meshId: mesh identifier of format mesh/domain/meshidhex
    // nodeId: node identifier of format node/domain/nodeidhex
    // connectTime: time of connection, milliseconds elapsed since the UNIX epoch.
    // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 4 = Intel AMT local.
    // powerState: Value, 0 = Unknown, 1 = S0 power on, 2 = S1 Sleep, 3 = S2 Sleep, 4 = S3 Sleep, 5 = S4 Hibernate, 6 = S5 Soft-Off, 7 = Present
    //var connectTypeStrings = ['', 'MeshAgent', 'Intel AMT CIRA', '', 'Intel AMT local'];
    //var powerStateStrings = ['Unknown', 'Powered', 'Sleep', 'Sleep', 'Deep Sleep', 'Hibernating', 'Soft-Off', 'Present'];
    obj.SetConnectivityState = function (meshid, nodeid, connectTime, connectType, powerState, serverid) {
        //console.log('SetConnectivity for ' + nodeid.substring(0, 16) + ', Type: ' + connectTypeStrings[connectType] + ', Power: ' + powerStateStrings[powerState] + (serverid == null ? ('') : (', ServerId: ' + serverid)));
        if ((serverid == null) && (obj.multiServer != null)) { obj.multiServer.DispatchMessage({ action: 'SetConnectivityState', meshid: meshid, nodeid: nodeid, connectTime: connectTime, connectType: connectType, powerState: powerState }); }

        if (obj.multiServer == null) {
            // Single server mode

            // Change the node connection state
            var eventConnectChange = 0;
            var state = obj.connectivityByNode[nodeid];
            if (state) {
                // Change the connection in the node and mesh state lists
                if ((state.connectivity & connectType) == 0) { state.connectivity |= connectType; eventConnectChange = 1; }
                state.meshid = meshid;
            } else {
                // Add the connection to the node and mesh state list
                obj.connectivityByNode[nodeid] = state = { connectivity: connectType, meshid: meshid };
                eventConnectChange = 1;
            }

            // Set node power state
            if (connectType == 1) { state.agentPower = powerState; } else if (connectType == 2) { state.ciraPower = powerState; } else if (connectType == 4) { state.amtPower = powerState; }
            var powerState = 0, oldPowerState = state.powerState;
            if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
            if ((state.powerState == null) || (state.powerState != powerState)) {
                state.powerState = powerState;
                eventConnectChange = 1;

                // Set new power state in database
                var record = { type: 'power', time: connectTime, node: nodeid, power: powerState };
                if (oldPowerState != null) record.oldPower = oldPowerState;
                obj.db.file.insert(record);
            }

            // Event the node connection change
            if (eventConnectChange == 1) { obj.DispatchEvent(['*', meshid], obj, { action: 'nodeconnect', meshid: meshid, nodeid: nodeid, conn: state.connectivity, pwr: state.powerState, ct: connectTime, nolog: 1, nopeers: 1 }); }
        } else {
            // Multi server mode

            // Change the node connection state
            if (serverid == null) { serverid = obj.serverId; }
            if (obj.peerConnectivityByNode[serverid] == null) return; // Guard against unknown serverid's
            var state = obj.peerConnectivityByNode[serverid][nodeid];
            if (state) {
                // Change the connection in the node and mesh state lists
                if ((state.connectivity & connectType) == 0) { state.connectivity |= connectType; }
                state.meshid = meshid;
            } else {
                // Add the connection to the node and mesh state list
                obj.peerConnectivityByNode[serverid][nodeid] = state = { connectivity: connectType, meshid: meshid };
            }

            // Set node power state
            if (connectType == 1) { state.agentPower = powerState; } else if (connectType == 2) { state.ciraPower = powerState; } else if (connectType == 4) { state.amtPower = powerState; }
            var powerState = 0, oldPowerState = state.powerState;
            if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
            if ((state.powerState == null) || (state.powerState != powerState)) {
                state.powerState = powerState;

                // Set new power state in database
                var record = { type: 'power', time: connectTime, node: nodeid, power: powerState, server: obj.multiServer.serverid };
                if (oldPowerState != null) record.oldPower = oldPowerState;
                obj.db.file.insert(record);
            }

            // Update the combined node state
            var x = {}; x[nodeid] = 1;
            obj.UpdateConnectivityState(x);
        }
    };

    // Clear the connectivity state of a node and setup the server so that messages can be routed correctly.
    // meshId: mesh identifier of format mesh/domain/meshidhex
    // nodeId: node identifier of format node/domain/nodeidhex
    // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 3 = Intel AMT local.
    obj.ClearConnectivityState = function (meshid, nodeid, connectType, serverid) {
        //console.log('ClearConnectivity for ' + nodeid.substring(0, 16) + ', Type: ' + connectTypeStrings[connectType] + (serverid == null?(''):(', ServerId: ' + serverid)));
        if ((serverid == null) && (obj.multiServer != null)) { obj.multiServer.DispatchMessage({ action: 'ClearConnectivityState', meshid: meshid, nodeid: nodeid, connectType: connectType }); }

        if (obj.multiServer == null) {
            // Single server mode
            var eventConnectChange = 0;

            // Remove the agent connection from the nodes connection list
            var state = obj.connectivityByNode[nodeid];
            if (state == null) return;

            if ((state.connectivity & connectType) != 0) {
                state.connectivity -= connectType;

                // If the node is completely disconnected, clean it up completely
                if (state.connectivity == 0) { delete obj.connectivityByNode[nodeid]; state.powerState = 0; }
                eventConnectChange = 1;
            }

            // Clear node power state
            if (connectType == 1) { state.agentPower = 0; } else if (connectType == 2) { state.ciraPower = 0; } else if (connectType == 4) { state.amtPower = 0; }
            var powerState = 0, oldPowerState = state.powerState;
            if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
            if ((state.powerState == null) || (state.powerState != powerState)) {
                state.powerState = powerState;
                eventConnectChange = 1;

                // Set new power state in database
                obj.db.file.insert({ type: 'power', time: Date.now(), node: nodeid, power: powerState, oldPower: oldPowerState });
            }

            // Event the node connection change
            if (eventConnectChange == 1) { obj.DispatchEvent(['*', meshid], obj, { action: 'nodeconnect', meshid: meshid, nodeid: nodeid, conn: state.connectivity, pwr: state.powerState, nolog: 1, nopeers: 1 }); }
        } else {
            // Multi server mode

            // Remove the agent connection from the nodes connection list
            if (serverid == null) { serverid = obj.serverId; }
            if (obj.peerConnectivityByNode[serverid] == null) return; // Guard against unknown serverid's
            var state = obj.peerConnectivityByNode[serverid][nodeid];
            if (state == null) return;

            // If existing state exist, remove this connection
            if ((state.connectivity & connectType) != 0) {
                state.connectivity -= connectType; // Remove one connectivity mode

                // If the node is completely disconnected, clean it up completely
                if (state.connectivity == 0) { delete obj.peerConnectivityByNode[serverid][nodeid]; state.powerState = 0; }
            }

            // Clear node power state
            if (connectType == 1) { state.agentPower = 0; } else if (connectType == 2) { state.ciraPower = 0; } else if (connectType == 4) { state.amtPower = 0; }
            var powerState = 0;
            if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
            if ((state.powerState == null) || (state.powerState != powerState)) { state.powerState = powerState; }

            // Update the combined node state
            var x = {}; x[nodeid] = 1;
            obj.UpdateConnectivityState(x);
        }
    };

    // Update the default mesh core
    obj.updateMeshCoreTimer = 'notset';
    obj.updateMeshCore = function (func) {
        // Figure out where meshcore.js is
        var meshcorePath = obj.datapath;
        if (obj.fs.existsSync(obj.path.join(meshcorePath, 'meshcore.js')) == false) {
            meshcorePath = obj.path.join(__dirname, 'agents');
            if (obj.fs.existsSync(obj.path.join(meshcorePath, 'meshcore.js')) == false) {
                obj.defaultMeshCoreNoMei = obj.defaultMeshCoreNoMeiHash = obj.defaultMeshCore = obj.defaultMeshCoreHash = null; if (func != null) { func(false); } // meshcore.js not found
            }
        }

        // Read meshcore.js and all .js files in the modules folder.
        var moduleAdditions = 'var addedModules = [];', moduleAdditionsNoMei = 'var addedModules = [];', meshCore = null, modulesDir = null;
        try { meshCore = obj.fs.readFileSync(obj.path.join(meshcorePath, 'meshcore.js')).toString(); } catch (e) { }
        if (meshCore != null) {
            try { modulesDir = obj.fs.readdirSync(obj.path.join(meshcorePath, 'modules_meshcore')); } catch (e) { }
            if (modulesDir != null) {
                for (var i in modulesDir) {
                    if (modulesDir[i].toLowerCase().endsWith('.js')) {
                        // Merge this module
                        var moduleName = modulesDir[i].substring(0, modulesDir[i].length - 3);
                        var moduleDataB64 = obj.fs.readFileSync(obj.path.join(meshcorePath, 'modules_meshcore', modulesDir[i])).toString('base64');
                        moduleAdditions += 'try { addModule("' + moduleName + '", Buffer.from("' + moduleDataB64 + '", "base64")); addedModules.push("' + moduleName + '"); } catch (e) { }\r\n';
                        if ((moduleName != 'amt_heci') && (moduleName != 'lme_heci') && (moduleName != 'amt-0.2.0.js') && (moduleName != 'amt-script-0.2.0.js') && (moduleName != 'amt-wsman-0.2.0.js') && (moduleName != 'amt-wsman-duk-0.2.0.js')) {
                            moduleAdditionsNoMei += 'try { addModule("' + moduleName + '", Buffer.from("' + moduleDataB64 + '", "base64")); addedModules.push("' + moduleName + '"); } catch (e) { }\r\n';
                        }
                    }
                }
            }
        } else { meshCore = ''; } // No meshcore.js

        // Set the new default meshcore.js with and without MEI support
        obj.defaultMeshCore = obj.common.IntToStr(0) + moduleAdditions + meshCore;
        obj.defaultMeshCoreHash = obj.crypto.createHash('sha384').update(obj.defaultMeshCore).digest("binary");
        obj.defaultMeshCoreNoMei = obj.common.IntToStr(0) + moduleAdditionsNoMei + meshCore;
        obj.defaultMeshCoreNoMeiHash = obj.crypto.createHash('sha384').update(obj.defaultMeshCoreNoMei).digest("binary");
        if (func != null) { func(true); }

        // If meshcore.js is in the data folder, monitor the file for changes.
        if ((obj.updateMeshCoreTimer === 'notset') && (meshcorePath == obj.datapath)) {
            obj.updateMeshCoreTimer = null;
            obj.fs.watch(obj.path.join(meshcorePath, 'meshcore.js'), function (eventType, filename) {
                if (obj.updateMeshCoreTimer != null) { clearTimeout(obj.updateMeshCoreTimer); obj.updateMeshCoreTimer = null; }
                obj.updateMeshCoreTimer = setTimeout(function () { obj.updateMeshCore(); console.log('Updated meshcore.js.'); }, 5000);
            });
        }
    };

    // Update the default meshcmd
    obj.updateMeshCmdTimer = 'notset';
    obj.updateMeshCmd = function (func) {
        // Figure out where meshcmd.js is
        var meshcmdPath = obj.datapath;
        if (obj.fs.existsSync(obj.path.join(meshcmdPath, 'meshcmd.js')) == false) {
            meshcmdPath = obj.path.join(__dirname, 'agents');
            if (obj.fs.existsSync(obj.path.join(meshcmdPath, 'meshcmd.js')) == false) {
                obj.defaultMeshCmd = null; if (func != null) { func(false); } // meshcmd.js not found
            }
        }

        // Read meshcore.js and all .js files in the modules folder.
        var moduleAdditions = 'var addedModules = [];', modulesDir = null;
        var meshCmd = obj.fs.readFileSync(obj.path.join(meshcmdPath, 'meshcmd.js')).toString().replace("'***Mesh*Cmd*Version***'", '\'' + obj.currentVer + '\'');
        try { modulesDir = obj.fs.readdirSync(obj.path.join(meshcmdPath, 'modules_meshcmd')); } catch (e) { }
        if (modulesDir != null) {
            for (var i in modulesDir) {
                if (modulesDir[i].toLowerCase().endsWith('.js')) {
                    // Merge this module
                    var moduleName = modulesDir[i].substring(0, modulesDir[i].length - 3);
                    var moduleDataB64 = obj.fs.readFileSync(obj.path.join(meshcmdPath, 'modules_meshcmd', modulesDir[i])).toString('base64');
                    moduleAdditions += 'try { addModule("' + moduleName + '", Buffer.from("' + moduleDataB64 + '", "base64")); addedModules.push("' + moduleName + '"); } catch (e) { }\r\n';
                }
            }
        }

        // Set the new default meshcmd.js
        obj.defaultMeshCmd = moduleAdditions + meshCmd;
        if (func != null) { func(true); }

        // If meshcore.js is in the data folder, monitor the file for changes.
        if ((obj.updateMeshCmdTimer === 'notset') && (meshcmdPath == obj.datapath)) {
            obj.updateMeshCmdTimer = null;
            obj.fs.watch(obj.path.join(meshcmdPath, 'meshcmd.js'), function (eventType, filename) {
                if (obj.updateMeshCmdTimer != null) { clearTimeout(obj.updateMeshCmdTimer); obj.updateMeshCmdTimer = null; }
                obj.updateMeshCmdTimer = setTimeout(function () { obj.updateMeshCmd(); console.log('Updated meshcmd.js.'); }, 5000);
            });
        }
    };

    // List of possible mesh agent install scripts
    var meshAgentsInstallScriptList = {
        1: { id: 1, localname: 'meshinstall-linux.sh', rname: 'meshinstall.sh' },
        2: { id: 2, localname: 'meshinstall-initd.sh', rname: 'meshagent' }
    };

    // Update the list of available mesh agents
    obj.updateMeshAgentInstallScripts = function () {
        for (var scriptid in meshAgentsInstallScriptList) {
            var scriptpath = obj.path.join(__dirname, 'agents', meshAgentsInstallScriptList[scriptid].localname);
            var stream = null;
            try {
                stream = obj.fs.createReadStream(scriptpath);
                stream.on('data', function (data) { this.hash.update(data, 'binary'); });
                stream.on('error', function (data) {
                    // If there is an error reading this file, make sure this agent is not in the agent table
                    if (obj.meshAgentInstallScripts[this.info.id] != null) { delete obj.meshAgentInstallScripts[this.info.id]; }
                });
                stream.on('end', function () {
                    // Add the agent to the agent table with all information and the hash
                    obj.meshAgentInstallScripts[this.info.id] = obj.common.Clone(this.info);
                    obj.meshAgentInstallScripts[this.info.id].hash = this.hash.digest('hex');
                    obj.meshAgentInstallScripts[this.info.id].path = this.agentpath;
                    obj.meshAgentInstallScripts[this.info.id].url = ((obj.args.notls == true) ? 'http://' : 'https://') + obj.certificates.CommonName + ':' + obj.args.port + '/meshagents?script=' + this.info.id;
                    var stats = null;
                    try { stats = obj.fs.statSync(this.agentpath); } catch (e) { }
                    if (stats != null) { obj.meshAgentInstallScripts[this.info.id].size = stats.size; }
                });
                stream.info = meshAgentsInstallScriptList[scriptid];
                stream.agentpath = scriptpath;
                stream.hash = obj.crypto.createHash('sha384', stream);
            } catch (e) { }
        }
    };

    // List of possible mesh agents
    obj.meshAgentsArchitectureNumbers = {
        0: { id: 0, localname: 'Unknown', rname: 'meshconsole.exe', desc: 'Unknown agent', update: false, amt: true, platform: 'unknown' },
        1: { id: 1, localname: 'MeshConsole.exe', rname: 'meshconsole.exe', desc: 'Windows x86-32 console', update: true, amt: true, platform: 'win32' },
        2: { id: 2, localname: 'MeshConsole64.exe', rname: 'meshconsole.exe', desc: 'Windows x86-64 console', update: true, amt: true, platform: 'win32' },
        3: { id: 3, localname: 'MeshService-signed.exe', rname: 'meshagent.exe', desc: 'Windows x86-32 service', update: true, amt: true, platform: 'win32' },
        4: { id: 4, localname: 'MeshService64-signed.exe', rname: 'meshagent.exe', desc: 'Windows x86-64 service', update: true, amt: true, platform: 'win32' },
        5: { id: 5, localname: 'meshagent_x86', rname: 'meshagent', desc: 'Linux x86-32', update: true, amt: true, platform: 'linux' },
        6: { id: 6, localname: 'meshagent_x86-64', rname: 'meshagent', desc: 'Linux x86-64', update: true, amt: true, platform: 'linux' },
        7: { id: 7, localname: 'meshagent_mips', rname: 'meshagent', desc: 'Linux MIPS', update: true, amt: false, platform: 'linux' },
        8: { id: 8, localname: 'MeshAgent-Linux-XEN-x86-32', rname: 'meshagent', desc: 'XEN x86-64', update: true, amt: false, platform: 'linux' },
        9: { id: 9, localname: 'meshagent_arm', rname: 'meshagent', desc: 'Linux ARM5', update: true, amt: false, platform: 'linux' },
        10: { id: 10, localname: 'MeshAgent-Linux-ARM-PlugPC', rname: 'meshagent', desc: 'Linux ARM PlugPC', update: true, amt: false, platform: 'linux' },
        11: { id: 11, localname: 'MeshAgent-OSX-x86-32', rname: 'meshosx', desc: 'Apple OSX x86-32', update: true, amt: false, platform: 'linux' },
        12: { id: 12, localname: 'MeshAgent-Android-x86', rname: 'meshandroid', desc: 'Android x86-32', update: true, amt: false, platform: 'linux' },
        13: { id: 13, localname: 'meshagent_pogo', rname: 'meshagent', desc: 'Linux ARM PogoPlug', update: true, amt: false, platform: 'linux' },
        14: { id: 14, localname: 'MeshAgent-Android-APK', rname: 'meshandroid', desc: 'Android Market', update: false, amt: false, platform: 'android' }, // Get this one from Google Play
        15: { id: 15, localname: 'meshagent_poky', rname: 'meshagent', desc: 'Linux Poky x86-32', update: true, amt: false, platform: 'linux' },
        16: { id: 16, localname: 'MeshAgent-OSX-x86-64', rname: 'meshagent', desc: 'Apple OSX x86-64', update: true, amt: false, platform: 'osx' },
        17: { id: 17, localname: 'MeshAgent-ChromeOS', rname: 'meshagent', desc: 'Google ChromeOS', update: false, amt: false, platform: 'chromeos' }, // Get this one from Chrome store
        18: { id: 18, localname: 'meshagent_poky64', rname: 'meshagent', desc: 'Linux Poky x86-64', update: true, amt: false, platform: 'linux' },
        19: { id: 19, localname: 'meshagent_x86_nokvm', rname: 'meshagent', desc: 'Linux x86-32 NoKVM', update: true, amt: true, platform: 'linux' },
        20: { id: 20, localname: 'meshagent_x86-64_nokvm', rname: 'meshagent', desc: 'Linux x86-64 NoKVM', update: true, amt: true, platform: 'linux' },
        21: { id: 21, localname: 'MeshAgent-WinMinCore-Console-x86-32.exe', rname: 'meshagent.exe', desc: 'Windows MinCore Console x86-32', update: true, amt: false, platform: 'win32' },
        22: { id: 22, localname: 'MeshAgent-WinMinCore-Service-x86-64.exe', rname: 'meshagent.exe', desc: 'Windows MinCore Service x86-32', update: true, amt: false, platform: 'win32' },
        23: { id: 23, localname: 'MeshAgent-NodeJS', rname: 'meshagent', desc: 'NodeJS', update: false, amt: false, platform: 'node' }, // Get this one from NPM
        24: { id: 24, localname: 'meshagent_arm-linaro', rname: 'meshagent', desc: 'Linux ARM Linaro', update: true, amt: false, platform: 'linux' },
        25: { id: 25, localname: 'meshagent_pi', rname: 'meshagent', desc: 'Linux ARM - Raspberry Pi', update: true, amt: false, platform: 'linux' }, // "armv6l" and "armv7l"
        10003: { id: 3, localname: 'MeshService.exe', rname: 'meshagent.exe', desc: 'Windows x86-32 service', update: true, amt: true, platform: 'win32' }, // Unsigned version of the Windows MeshAgent x86
        10004: { id: 4, localname: 'MeshService64.exe', rname: 'meshagent.exe', desc: 'Windows x86-64 service', update: true, amt: true, platform: 'win32' } // Unsigned version of the Windows MeshAgent x64
    };

    // Update the list of available mesh agents
    obj.updateMeshAgentsTable = function (func) {
        var archcount = 0;
        for (var archid in obj.meshAgentsArchitectureNumbers) {
            var agentpath = obj.path.join(__dirname, 'agents', obj.meshAgentsArchitectureNumbers[archid].localname);

            // Fetch all the agent binary information
            var stats = null;
            try { stats = obj.fs.statSync(agentpath); } catch (e) { }
            if ((stats != null)) {
                // If file exists
                archcount++;
                obj.meshAgentBinaries[archid] = obj.common.Clone(obj.meshAgentsArchitectureNumbers[archid]);
                obj.meshAgentBinaries[archid].path = agentpath;
                obj.meshAgentBinaries[archid].url = ((obj.args.notls == true) ? 'http://' : 'https://') + obj.certificates.CommonName + ':' + obj.args.port + '/meshagents?id=' + archid;
                obj.meshAgentBinaries[archid].size = stats.size;
                // If this is a windows binary, pull binary information
                if (obj.meshAgentsArchitectureNumbers[archid].platform == 'win32') {
                    try { obj.meshAgentBinaries[archid].pe = obj.exeHandler.parseWindowsExecutable(agentpath); } catch (e) { }
                }
                // Hash the binary
                var hashStream = obj.crypto.createHash('sha384');
                hashStream.archid = archid;
                hashStream.on('data', function (data) {
                    obj.meshAgentBinaries[this.archid].hash = data.toString('hex');
                    if ((--archcount == 0) && (func != null)) { func(); }
                });
                var options = { sourcePath: agentpath, targetStream: hashStream, platform: obj.meshAgentsArchitectureNumbers[archid].platform };
                if (obj.meshAgentBinaries[archid].pe != null) { options.peinfo = obj.meshAgentBinaries[archid].pe; }
                obj.exeHandler.hashExecutableFile(options);
            }
        }
        if ((obj.meshAgentBinaries[3] == null) && (obj.meshAgentBinaries[10003] != null)) { obj.meshAgentBinaries[3] = obj.meshAgentBinaries[10003]; } // If only the unsigned windows binaries are present, use them.
        if ((obj.meshAgentBinaries[4] == null) && (obj.meshAgentBinaries[10004] != null)) { obj.meshAgentBinaries[4] = obj.meshAgentBinaries[10004]; } // If only the unsigned windows binaries are present, use them.
    };

    // Generate a time limited user login token
    obj.getLoginToken = function (userid, func) {
        if ((userid == null) || (typeof userid != 'string')) { func('Invalid userid.'); return; }
        var x = userid.split('/');
        if (x == null || x.length != 3 || x[0] != 'user') { func('Invalid userid.'); return; }
        obj.db.Get(userid, function (err, docs) {
            if (err != null || docs == null || docs.length == 0) {
                func('User ' + userid + ' not found.'); return;
            } else {
                // Load the login cookie encryption key from the database
                obj.db.Get('LoginCookieEncryptionKey', function (err, docs) {
                    if ((docs.length > 0) && (docs[0].key != null) && (obj.args.logintokengen == null)) {
                        // Key is present, use it.
                        obj.loginCookieEncryptionKey = Buffer.from(docs[0].key, 'hex');
                        func(obj.encodeCookie({ u: userid, a: 3 }, obj.loginCookieEncryptionKey));
                    } else {
                        // Key is not present, generate one.
                        obj.loginCookieEncryptionKey = obj.generateCookieKey();
                        obj.db.Set({ _id: 'LoginCookieEncryptionKey', key: obj.loginCookieEncryptionKey.toString('hex'), time: Date.now() }, function () { func(obj.encodeCookie({ u: userid, a: 3 }, obj.loginCookieEncryptionKey)); });
                    }
                });
            }
        });
    };

    // Show the yser login token generation key
    obj.showLoginTokenKey = function (func) {
        // Load the login cookie encryption key from the database
        obj.db.Get('LoginCookieEncryptionKey', function (err, docs) {
            if ((docs.length > 0) && (docs[0].key != null) && (obj.args.logintokengen == null)) {
                // Key is present, use it.
                func(docs[0].key);
            } else {
                // Key is not present, generate one.
                obj.loginCookieEncryptionKey = obj.generateCookieKey();
                obj.db.Set({ _id: 'LoginCookieEncryptionKey', key: obj.loginCookieEncryptionKey.toString('hex'), time: Date.now() }, function () { func(obj.loginCookieEncryptionKey.toString('hex')); });
            }
        });
    };

    // Generate a cryptographic key used to encode and decode cookies
    obj.generateCookieKey = function () {
        return new Buffer(obj.crypto.randomBytes(32), 'binary');
        //return Buffer.alloc(32, 0); // Sets the key to zeros, debug only.
    };

    // Encode an object as a cookie using a key. (key must be 32 bytes long)
    obj.encodeCookie = function (o, key) {
        try {
            if (key == null) { key = obj.serverKey; }
            o.time = Math.floor(Date.now() / 1000); // Add the cookie creation time
            var iv = new Buffer(obj.crypto.randomBytes(12), 'binary'), cipher = obj.crypto.createCipheriv('aes-256-gcm', key, iv);
            var crypted = Buffer.concat([cipher.update(JSON.stringify(o), 'utf8'), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), crypted]).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
        } catch (e) { return null; }
    };

    // Decode a cookie back into an object using a key. Return null if it's not a valid cookie.  (key must be 32 bytes long)
    obj.decodeCookie = function (cookie, key, timeout) {
        try {
            if (key == null) { key = obj.serverKey; }
            cookie = new Buffer(cookie.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64');
            var decipher = obj.crypto.createDecipheriv('aes-256-gcm', key, cookie.slice(0, 12));
            decipher.setAuthTag(cookie.slice(12, 16));
            var o = JSON.parse(decipher.update(cookie.slice(28), 'binary', 'utf8') + decipher.final('utf8'));
            if ((o.time == null) || (o.time == null) || (typeof o.time != 'number')) { return null; }
            o.time = o.time * 1000; // Decode the cookie creation time
            o.dtime = Date.now() - o.time; // Decode how long ago the cookie was created (in milliseconds)
            if (timeout == null) { timeout = 2; }
            if ((o.dtime > (timeout * 60000)) || (o.dtime < -30000)) return null; // The cookie is only valid 120 seconds, or 30 seconds back in time (in case other server's clock is not quite right)
            return o;
        } catch (e) { return null; }
    };

    // Debug
    obj.debug = function (lvl) {
        if (lvl > obj.debugLevel) return;
        if (arguments.length == 2) { console.log(arguments[1]); }
        else if (arguments.length == 3) { console.log(arguments[1], arguments[2]); }
        else if (arguments.length == 4) { console.log(arguments[1], arguments[2], arguments[3]); }
        else if (arguments.length == 5) { console.log(arguments[1], arguments[2], arguments[3], arguments[4]); }
    };

    // Update server state. Writes a server state file.
    var meshServerState = {};
    obj.updateServerState = function (name, val) {
        if ((name != null) && (val != null)) {
            var changed = false;
            if ((name != null) && (meshServerState[name] != val)) { if ((val == null) && (meshServerState[name] != null)) { delete meshServerState[name]; changed = true; } else { if (meshServerState[name] != val) { meshServerState[name] = val; changed = true; } } }
            if (changed == false) return;
        }
        var r = 'time=' + Date.now() + '\r\n';
        for (var i in meshServerState) { r += (i + '=' + meshServerState[i] + '\r\n'); }
        obj.fs.writeFileSync(obj.getConfigFilePath('serverstate.txt'), r);
    };
    
    // Logging funtions
    function logException(e) { e += ''; logErrorEvent(e); }
    function logInfoEvent(msg) { if (obj.servicelog != null) { obj.servicelog.info(msg); } console.log(msg); }
    function logWarnEvent(msg) { if (obj.servicelog != null) { obj.servicelog.warn(msg); } console.log(msg); }
    function logErrorEvent(msg) { if (obj.servicelog != null) { obj.servicelog.error(msg); } console.error(msg); }

    // Read entire file and return it in callback function
    function readEntireTextFile(filepath, func) {
        var called = false;
        try {
            obj.fs.open(filepath, 'r', function (err, fd) {
                if (fd == null) { func(null); return; }
                obj.fs.fstat(fd, function (err, stats) {
                    var bufferSize = stats.size, chunkSize = 512, buffer = new Buffer(bufferSize), bytesRead = 0;
                    while (bytesRead < bufferSize) {
                        if ((bytesRead + chunkSize) > bufferSize) { chunkSize = (bufferSize - bytesRead); }
                        obj.fs.readSync(fd, buffer, bytesRead, chunkSize, bytesRead);
                        bytesRead += chunkSize;
                    }
                    obj.fs.close(fd);
                    called = true;
                    func(buffer.toString('utf8', 0, bufferSize));
                });
            });
        } catch (e) { console.log(e); if (called == false) { func(null); } }
    }

    // Return the path of a file into the meshcentral-data path
    obj.getConfigFilePath = function (filename) {
        if ((obj.config != null) && (obj.config.configfiles != null) && (obj.config.configfiles[filename] != null) && (typeof obj.config.configfiles[filename] == 'string')) {
            //console.log('getConfigFilePath(\"' + filename + '\") = ' + obj.config.configfiles[filename]);
            return obj.config.configfiles[filename];
        }
        //console.log('getConfigFilePath(\"' + filename + '\") = ' + obj.path.join(obj.datapath, filename));
        return obj.path.join(obj.datapath, filename);
    };

    return obj;
}

// Return the server configuration
function getConfig() {
    // Figure out the datapath location
    var i;
    var fs = require('fs');
    var path = require('path');
    var datapath = null;
    var args = require('minimist')(process.argv.slice(2));
    if ((__dirname.endsWith('/node_modules/meshcentral')) || (__dirname.endsWith('\\node_modules\\meshcentral')) || (__dirname.endsWith('/node_modules/meshcentral/')) || (__dirname.endsWith('\\node_modules\\meshcentral\\'))) {
        datapath = path.join(__dirname, '../../meshcentral-data');
    } else {
        datapath = path.join(__dirname, '../meshcentral-data');
    }
    if (args.datapath) { datapath = args.datapath; }
    try { fs.mkdirSync(datapath); } catch (e) { }

    // Read configuration file if present and change arguments.
    var config = {}, configFilePath = path.join(datapath, 'config.json');
    if (fs.existsSync(configFilePath)) {
        // Load and validate the configuration file
        try { config = require(configFilePath); } catch (e) { console.log('ERROR: Unable to parse ' + configFilePath + '.'); return null; }
        if (config.domains == null) { config.domains = {}; }
        for (i in config.domains) { if ((i.split('/').length > 1) || (i.split(' ').length > 1)) { console.log("ERROR: Error in config.json, domain names can't have spaces or /."); return null; } }
    } else {
        // Copy the "sample-config.json" to give users a starting point
        var sampleConfigPath = path.join(__dirname, 'sample-config.json');
        if (fs.existsSync(sampleConfigPath)) { fs.createReadStream(sampleConfigPath).pipe(fs.createWriteStream(configFilePath)); }
    }

    // Set the command line arguments to the config file if they are not present
    if (!config.settings) { config.settings = {}; }
    for (i in args) { config.settings[i] = args[i]; }

    // Lower case all keys in the config file
    require('./common.js').objKeysToLower(config);
    return config;
}

// Check if a list of modules are present and install any missing ones
function InstallModules(modules, func) {
    if (modules.length > 0) { InstallModule(modules.shift(), InstallModules, modules, func); } else { func(); }
}

// Check if a module is present and install it if missing
function InstallModule(modulename, func, tag1, tag2) {
    try {
        var module = require(modulename);
    } catch (e) {
        console.log('Installing ' + modulename + '...');
        var child_process = require('child_process');
        child_process.exec('npm install ' + modulename + ' --save', { maxBuffer: 512000 }, function (error, stdout, stderr) {
            if (error != null) { console.log('ERROR: Unable to install missing package \'' + modulename + '\', make sure npm is installed.'); process.exit(); return; }
            func(tag1, tag2);
            return;
        });
        return;
    }
    func(tag1, tag2);
}

// Detect CTRL-C on Linux and stop nicely
process.on('SIGINT', function () { if (meshserver != null) { meshserver.Stop(); meshserver = null; } console.log('Server Ctrl-C exit...'); process.exit(); });

// Load the really basic modules
var meshserver = null;
function mainStart(args) {
    // Check the NodeJS is version 6 or better.
    if (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 6) { console.log("MeshCentral requires Node v6.x or above, current version is " + process.version + "."); return; }

    // Check for any missing modules.
    InstallModules(['minimist'], function () {
        // Get the server configuration
        var config = getConfig();
        if (config == null) { process.exit(); }

        // Check is Windows SSPI will be used
        var sspi = false;
        if (require('os').platform() == 'win32') { for (var i in config.domains) { if (config.domains[i].auth == 'sspi') { sspi = true; } } }

        // Build the list of required modules
        var modules = ['ws', 'nedb', 'https', 'yauzl', 'xmldom', 'express', 'archiver', 'multiparty', 'node-forge', 'express-ws', 'compression', 'body-parser', 'connect-redis', 'express-session', 'express-handlebars'];
        if (require('os').platform() == 'win32') { modules.push('node-windows'); if (sspi == true) { modules.push('node-sspi'); } } // Add Windows modules
        if (config.letsencrypt != null) { modules.push('greenlock'); modules.push('le-store-certbot'); modules.push('le-challenge-fs'); modules.push('le-acme-core'); } // Add Greenlock Modules
        if (config.settings.mongodb != null) { modules.push('mongojs'); } // Add MongoDB
        if (config.smtp != null) { modules.push('nodemailer'); } // Add SMTP support

        // Install any missing modules and launch the server
        InstallModules(modules, function () { meshserver = CreateMeshCentralServer(config, args); meshserver.Start(); });
    });
}

if (require.main === module) {
    mainStart(require('minimist')(process.argv.slice(2))); // Called directly, launch normally.
} else {
    module.exports.mainStart = mainStart; // Required as a module, useful for winservice.js
}