/**
* @description Meshcentral
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

function CreateMeshCentralServer() {
    var obj = {};
    obj.db;
    obj.webserver;
    obj.redirserver;
    obj.mpsserver;
    obj.amtEventHandler;
    obj.amtScanner;
    obj.meshScanner;
    obj.eventsDispatch = {};
    obj.fs = require('fs');
    obj.path = require('path');
    obj.crypto = require('crypto');
    obj.platform = require('os').platform();
    obj.args = require('minimist')(process.argv.slice(2));
    obj.common = require('./common.js');
    obj.certificates = null;
    obj.connectivityByMesh = {};      // This object keeps a list of all connected CIRA and agents, by meshid->nodeid->value (value: 1 = Agent, 2 = CIRA, 4 = AmtDirect)
    obj.connectivityByNode = {};      // This object keeps a list of all connected CIRA and agents, by nodeid->value (value: 1 = Agent, 2 = CIRA, 4 = AmtDirect)
    obj.debugLevel = 0;
    obj.config = {};                  // Configuration file
    obj.dbconfig = {};                // Persistance values, loaded from database
    obj.datapath = obj.path.join(__dirname, '../.meshcentral-data');
    obj.filespath = obj.path.join(__dirname, '../.meshcentral-files');
    obj.certificateOperations = require('./certoperations.js').CertificateOperations();
    obj.defaultMeshCore = null;
    obj.defaultMeshCoreHash = null;
    obj.meshAgentBinaries = {};       // Mesh Agent Binaries, Architecture type --> { hash:(sha256 hash), size:(binary size), path:(binary path) }
    obj.meshAgentInstallScripts = {}; // Mesh Install Scripts, Script ID -- { hash:(sha256 hash), size:(binary size), path:(binary path) }
    obj.multiServer = null;
    obj.currentVer = null;
    obj.maintenanceTimer = null;
    
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
        try { require('./pass').hash('test', function () { }); } catch (e) { console.log('Old version of node, must upgrade.'); return; } // TODO: Not sure if this test works or not.
        
        // Check for invalid arguments
        var validArguments = ['_', 'notls', 'user', 'port', 'mpsport', 'redirport', 'cert', 'deletedomain', 'deletedefaultdomain', 'showusers', 'shownodes', 'showmeshes', 'showevents', 'showpower', 'showiplocations', 'help', 'exactports', 'install', 'uninstall', 'start', 'stop', 'restart', 'debug', 'filespath', 'datapath', 'noagentupdate', 'launch', 'noserverbackup', 'mongodb', 'mongodbcol', 'wanonly', 'lanonly', 'nousers', 'mpsdebug', 'mpspass', 'ciralocalfqdn', 'dbexport', 'dbimport', 'selfupdate'];
        for (var arg in obj.args) { if (validArguments.indexOf(arg.toLocaleLowerCase()) == -1) { console.log('Invalid argument "' + arg + '", use --help.'); return; } }
        if (obj.args.mongodb == true) { console.log('Must specify: --mongodb [connectionstring] \r\nSee https://docs.mongodb.com/manual/reference/connection-string/ for MongoDB connection string.'); return; }

        if ((obj.args.help == true) || (obj.args['?'] == true)) {
            console.log('MeshCentral2 Beta 1, a web-based remote computer management web portal.\r\n');
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
            console.log('   --cert [name], (country), (org)   Create a web server certificate with [name]server name.');
            console.log('                                     country and organization can optionaly be set.');
            return;
        }
        
        // Check if we need to install, start, stop, remove ourself as a background service
        if ((obj.service != null) && ((obj.args.install == true) || (obj.args.uninstall == true) || (obj.args.start == true) || (obj.args.stop == true) || (obj.args.restart == true))) {
            var env = [], xenv = ['user', 'port', 'mpsport', 'redirport', 'exactport', 'debug'];
            for (var i in xenv) { if (obj.args[xenv[i]] != undefined) { env.push({ name: 'mesh' + xenv[i], value: obj.args[xenv[i]] }); } } // Set some args as service environement variables.
            var svc = new obj.service({ name: 'MeshCentral', description: 'MeshCentral Remote Management Server', script: process.argv[1] + '.js', env: env, wait: 2, grow: .5 });
            svc.on('install', function () { console.log('MeshCentral service installed.'); svc.start(); });
            svc.on('uninstall', function () { console.log('MeshCentral service uninstalled.'); process.exit(); });
            svc.on('start', function () { console.log('MeshCentral service started.'); process.exit(); });
            svc.on('stop', function () { console.log('MeshCentral service stopped.'); if (obj.args.stop) { process.exit(); } if (obj.args.restart) { console.log('Holding 5 seconds...'); setTimeout(function () { svc.start(); }, 5000); } });
            svc.on('alreadyinstalled', function () { console.log('MeshCentral service already installed.'); process.exit(); });
            svc.on('invalidinstallation', function () { console.log('Invalid MeshCentral service installation.'); process.exit(); });
            try {
                if (obj.args.install == true) { svc.install(); return; }
                else if (obj.args.uninstall == true) { svc.uninstall(); return; }
                else if (obj.args.start == true) { svc.start(); return; }
                else if (obj.args.stop == true || obj.args.restart == true) { svc.stop(); return; }
            } catch (e) { logException(e); }
        }

        // If "--launch" is in the arguments, launch now
        if (obj.args.launch == 1) {
            obj.StartEx();
        } else {
            // if "--launch" is not specified, launch the server as a child process.
            var startLine = '';
            for (var i in process.argv) {
                var arg = process.argv[i];
                if (arg.length > 0) {
                    if (startLine.length > 0) startLine += ' ';
                    if (arg.indexOf(' ') >= 0) { startLine += '"' + arg + '"'; } else { startLine += arg; }
                }
            }
            obj.launchChildServer(startLine);
        }
    }

    // Launch MeshCentral as a child server and monitor it.
    obj.launchChildServer = function (startLine) {
        var child_process = require('child_process');
        var xprocess = child_process.exec(startLine + ' --launch', function (error, stdout, stderr) {
            if (xprocess.xrestart == 1) {
                setTimeout(function () { obj.launchChildServer(startLine); }, 500); // This is an expected restart.
            } else if (xprocess.xrestart == 2) {
                console.log('Expected exit...');
                process.exit(); // User CTRL-C exit.
            } else if (xprocess.xrestart == 3) {
                // Server self-update exit
                var child_process = require('child_process');
                var xxprocess = child_process.exec('npm install meshcentral', { cwd: obj.path.join(__dirname, '../..') }, function (error, stdout, stderr) { });
                xxprocess.data = '';
                xxprocess.stdout.on('data', function (data) { xxprocess.data += data; });
                xxprocess.stderr.on('data', function (data) { xxprocess.data += data; });
                xxprocess.on('close', function (code) { console.log('Update completed...'); setTimeout(function () { obj.launchChildServer(startLine); }, 1000); });
            } else {
                if (error != null) {
                    // This is an un-expected restart
                    console.log('ERROR: MeshCentral failed with critical error, check MeshErrors.txt. Restarting...');
                    setTimeout(function () { obj.launchChildServer(startLine); }, 1000);
                } 
            }
        });
        xprocess.stdout.on('data', function (data) { if (data[data.length - 1] == '\n') { data = data.substring(0, data.length - 1); } if (data.indexOf('Updating settings folder...') >= 0) { xprocess.xrestart = 1; } else if (data.indexOf('Server Ctrl-C exit...') >= 0) { xprocess.xrestart = 2; } else if (data.indexOf('Starting self upgrade...') >= 0) { xprocess.xrestart = 3; } console.log(data); });
        xprocess.stderr.on('data', function (data) { if (data[data.length - 1] == '\n') { data = data.substring(0, data.length - 1); } obj.fs.appendFileSync('mesherrors.txt', '-------- ' + new Date().toLocaleString() + ' --------\r\n\r\n' + data + '\r\n\r\n\r\n'); });
        xprocess.on('close', function (code) { if ((code != 0) && (code != 123)) { /* console.log("Exited with code " + code); */ } });
    }

    // Get current and latest MeshCentral server versions using NPM
    obj.getLatestServerVersion = function (callback) {
        if (callback == undefined) return;
        var child_process = require('child_process');
        var xprocess = child_process.exec('npm view meshcentral dist-tags.latest', function (error, stdout, stderr) { });
        xprocess.data = '';
        xprocess.stdout.on('data', function (data) { xprocess.data += data; });
        xprocess.stderr.on('data', function (data) { });
        xprocess.on('close', function (code) {
            var currentVer = null;
            try { currentVer = JSON.parse(require('fs').readFileSync(obj.path.join(__dirname, 'package.json'), 'utf8')).version; } catch (e) { }
            var latestVer = null;
            if (code == 0) { try { latestVer = xprocess.data.split(' ').join('').split('\r').join('').split('\n').join(''); } catch (e) { } }
            callback(currentVer, latestVer);
        });
    }

    // Initiate server self-update
    obj.performServerUpdate = function () { console.log('Starting self upgrade...'); process.exit(200); }

    obj.StartEx = function () {
        // Look to see if data and/or file path is specified
        if (obj.args.datapath) { obj.datapath = obj.args.datapath; }
        if (obj.args.filespath) { obj.filespath = obj.args.filespath; }

        // Read configuration file if present and change arguments.
        if (require('fs').existsSync(obj.path.join(obj.datapath, 'config.json'))) {
            // Load and validate the configuration file
            try { obj.config = require(obj.path.join(obj.datapath, 'config.json')); } catch (e) { console.log('ERROR: Unable to parse ./data/config.json.'); return; }
            if (obj.config.domains == undefined) { obj.config.domains = {}; }
            for (var i in obj.config.domains) { if ((i.split('/').length > 1) || (i.split(' ').length > 1)) { console.log("ERROR: Error in config.json, domain names can't have spaces or /."); return; } }
            
            // Set the command line arguments to the config file if they are not present
            if (obj.config.settings) { for (var i in obj.config.settings) { if (obj.args[i] == undefined) obj.args[i] = obj.config.settings[i]; } }
        }
        
        // Read environment variables. For a subset of arguments, we allow them to be read from environment variables.
        var xenv = ['user', 'port', 'mpsport', 'redirport', 'exactport', 'debug'];
        for (var i in xenv) { if ((obj.args[xenv[i]] == undefined) && (process.env['mesh' + xenv[i]])) { obj.args[xenv[i]] = obj.common.toNumber(process.env['mesh' + xenv[i]]); } }
        
        // Validate the domains, this is used for multi-hosting
        if (obj.config.domains == undefined) { obj.config.domains = {}; }
        if (obj.config.domains[''] == undefined) { obj.config.domains[''] = { }; }
        var xdomains = {}; for (var i in obj.config.domains) { if (!obj.config.domains[i].title) { obj.config.domains[i].title = 'MeshCentral'; } if (!obj.config.domains[i].title2) { obj.config.domains[i].title2 = '2.0 Beta 1'; } xdomains[i.toLowerCase()] = obj.config.domains[i]; } obj.config.domains = xdomains;
        var bannedDomains = ['public', 'private', 'images', 'scripts', 'styles', 'views']; // List of banned domains
        for (var i in obj.config.domains) { for (var j in bannedDomains) { if (i == bannedDomains[j]) { console.log("ERROR: Domain '" + i + "' is not allowed domain name in ./data/config.json."); return; } } }
        for (var i in obj.config.domains) { obj.config.domains[i].url = (i == '')?'/':('/' + i + '/'); obj.config.domains[i].id = i; }
        
        // Log passed arguments into Windows Service Log
        //if (obj.servicelog != null) { var s = ''; for (var i in obj.args) { if (i != '_') { if (s.length > 0) { s += ', '; } s += i + "=" + obj.args[i]; } } logInfoEvent('MeshServer started with arguments: ' + s); }

        // Look at passed in arguments
        if ((obj.args.ciralocalfqdn != undefined) && ((obj.args.lanonly == true) || (obj.args.wanonly == true))) { console.log("WARNING: CIRA local FQDN's ignored when server in LAN-only or WAN-only mode."); }
        if ((obj.args.ciralocalfqdn != undefined) && (obj.args.ciralocalfqdn.split(',').length > 4)) { console.log("WARNING: Can't have more than 4 CIRA local FQDN's. Ignoring value."); obj.args.ciralocalfqdn = undefined; }
        if (obj.args.port == undefined || typeof obj.args.port != 'number') { if (obj.args.notls == undefined) { obj.args.port = 443; } else { obj.args.port = 80; } }
        if (obj.args.mpsport == undefined || typeof obj.args.mpsport != 'number') obj.args.mpsport = 4433;
        if (obj.args.notls == undefined && obj.args.redirport == undefined) obj.args.redirport = 80;
        if (typeof obj.args.debug == 'number') obj.debugLevel = obj.args.debug;
        if (obj.args.debug == true) obj.debugLevel = 1;
        obj.db = require('./db.js').CreateDB(obj.args, obj.datapath);
        obj.db.SetupDatabase(function (dbversion) {
            // See if any database operations needs to be completed
            if (obj.args.deletedomain) { obj.db.DeleteDomain(obj.args.deletedomain, function () { console.log('Deleted domain ' + obj.args.deletedomain + '.'); process.exit(); }); return; }
            if (obj.args.deletedefaultdomain) { obj.db.DeleteDomain('', function () { console.log('Deleted default domain.'); process.exit(); }); return; }
            if (obj.args.showusers) { obj.db.GetAllType('user', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.shownodes) { obj.db.GetAllType('node', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showmeshes) { obj.db.GetAllType('mesh', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showevents) { obj.db.GetAllType('event', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showpower) { obj.db.GetAllType('power', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.showiplocations) { obj.db.GetAllType('iploc', function (err, docs) { console.log(docs); process.exit(); }); return; }
            if (obj.args.dbexport) {
                // Export the entire database to a JSON file
                if (obj.args.dbexport == true) { console.log('Use --dbexport [filename]'); process.exit(); } else { obj.db.GetAll(function (err, docs) { obj.fs.writeFileSync(obj.args.dbexport, JSON.stringify(docs)); console.log('Exported ' + docs.length + ' document(s).'); process.exit(); }); }
                return;
            }
            if (obj.args.dbimport) {
                // Import the entire database from a JSON file
                if (obj.args.dbimport == true) { console.log('Use --dbimport [filename]'); process.exit(); } else {
                    var json = null;
                    try { json = obj.fs.readFileSync(obj.args.dbimport); } catch (e) { console.log('Invalid JSON file'); process.exit(); }
                    try { json = JSON.parse(json); } catch (e) { console.log('Invalid JSON format'); process.exit(); }
                    if ((json == null) || (typeof json.length != 'number') || (json.length < 1)) { console.log('Invalid JSON format'); }
                    obj.db.RemoveAll(function () { obj.db.InsertMany(json, function () { console.log('Imported ' + json.length + ' document(s)'); process.exit(); }); });
                }
                return;
            }

            // Clear old event entries and power entires
            obj.db.clearOldEntries('event', 30); // Clear all event entires that are older than 30 days.
            obj.db.clearOldEntries('power', 10); // Clear all event entires that are older than 10 days. If a node is connected longer than 10 days, current power state will be used for everything.

            // Perform other database cleanup
            obj.db.cleanup();

            // Set all nodes to power state of unknown (0)
            // TODO: This time for this message can be earlier: When server closed or last time did an update to the db.
            obj.db.file.insert({ type: 'power', time: Date.now(), node: '*', power: 0 });

            // Read or setup database configuration values
            obj.db.Get('dbconfig', function (err, dbconfig) {
                if (dbconfig.length == 1) { obj.dbconfig = dbconfig[0]; } else { obj.dbconfig = { _id: 'dbconfig', version: 1 }; }
                if (obj.dbconfig.amtWsEventSecret == undefined) { require('crypto').randomBytes(32, function (err, buf) { obj.dbconfig.amtWsEventSecret = buf.toString('hex'); obj.db.Set(obj.dbconfig); }); }
                
                // This is used by the user to create a username/password for a Intel AMT WSMAN event subscription
                if (obj.args.getwspass) {
                    if (obj.args.getwspass.length == 64) {
                        require('crypto').randomBytes(6, function (err, buf) {
                            while (obj.dbconfig.amtWsEventSecret == undefined) { process.nextTick(); }
                            var username = buf.toString('hex');
                            var nodeid = obj.args.getwspass;
                            var pass = require('crypto').createHash('sha256').update(username.toLowerCase() + ":" + nodeid.toUpperCase() + ":" + obj.dbconfig.amtWsEventSecret).digest("base64").substring(0, 12).split("/").join("x").split("\\").join("x");
                            console.log('--- Intel(r) AMT WSMAN eventing credentials ---');
                            console.log('Username: ' + username);
                            console.log('Password: ' + pass);
                            console.log('Argument: ' + nodeid.toLowerCase());
                            process.exit();
                        });
                    } else {
                        console.log('Invalid NodeID.');
                        process.exit();
                    }
                    return;
                }

                // Load the default mesh core
                obj.updateMeshCore();

                // Load server certificates
                obj.certificateOperations.GetMeshServerCertificate(obj.datapath, obj.args.cert, function (certs) {
                    obj.certificates = certs;

                    // If the certificate is un-configured, force LAN-only mode
                    if (obj.certificates.CommonName == 'un-configured') { console.log('Server name not configured, running in LAN-only mode.'); obj.args.lanonly = true; }

                    // Load the list of mesh agents and install scripts
                    if (obj.args.noagentupdate == 1) { for (var i in meshAgentsArchitectureNumbers) { meshAgentsArchitectureNumbers[i].update = false; } }
                    obj.updateMeshAgentsTable();
                    obj.updateMeshAgentInstallScripts();

                    // Setup and start the web server
                    require('crypto').randomBytes(32, function (err, buf) {
                        // Setup Mesh Multi-Server if needed
                        obj.multiServer = require('./multiserver.js').CreateMultiServer(obj, obj.args);

                        if (obj.args.secret) {
                            // This secret is used to encrypt HTTP session information, if specified, user it.
                            obj.webserver = require('./webserver.js').CreateWebServer(obj, obj.db, obj.args, obj.args.secret, obj.certificates);
                        } else {
                            // If the secret is not specified, generate a random number.
                            obj.webserver = require('./webserver.js').CreateWebServer(obj, obj.db, obj.args, buf.toString('hex').toUpperCase(), obj.certificates);
                        }

                        // Setup and start the redirection server if needed
                        if (obj.args.redirport != undefined && typeof obj.args.redirport == 'number') {
                            obj.redirserver = require('./redirserver.js').CreateRedirServer(obj, obj.db, obj.args, obj.certificates);
                        }

                        // Setup the Intel AMT event handler
                        obj.amtEventHandler = require('./amtevents.js').CreateAmtEventsHandler(obj);

                        // Setup the Intel AMT local network scanner
                        if (obj.args.wanonly != true) {
                            obj.amtScanner = require('./amtscanner.js').CreateAmtScanner(obj).start();
                            obj.meshScanner = require('./meshscanner.js').CreateMeshScanner(obj).start();
                        }

                        // Setup and start the MPS server
                        if (obj.args.lanonly != true) {
                            obj.mpsserver = require('./mpsserver.js').CreateMpsServer(obj, obj.db, obj.args, obj.certificates);
                        }

                        // Start periodic maintenance
                        obj.maintenanceTimer = setInterval(obj.maintenanceActions, 1000 * 60 * 60); // Run this every hour

                        // Dispatch an event that the server is now running
                        obj.DispatchEvent(['*'], obj, { etype: 'server', action: 'started', msg: 'Server started' })

                        obj.debug(1, 'Server started');
                    });
                });
            });
        });
    }

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
    }

    // Stop the Meshcentral server
    obj.Stop = function (restoreFile) {
        // If the database is not setup, exit now.
        if (!obj.db) return;

        // Dispatch an event saying the server is now stopping
        obj.DispatchEvent(['*'], obj, { etype: 'server', action: 'stopped', msg: 'Server stopped' })

        // Set all nodes to power state of unknown (0)
        obj.db.file.insert({ type: 'power', time: Date.now(), node: '*', power: 0 }, function () {
            if (restoreFile) {
                obj.debug(1, 'Server stopped, updating settings: ' + restoreFile);
                console.log('Updating settings folder...');
                var fs = require('fs');
                var unzip = require('unzip');
                var rs = fs.createReadStream(restoreFile);
                rs.on('end', () => { setTimeout(function () { fs.unlinkSync(restoreFile); process.exit(123); }, 500); });
                rs.pipe(unzip.Extract({ path: obj.datapath }));
            } else {
                obj.debug(1, 'Server stopped');
                process.exit(0);
            }
        });
    }
    
    // Event Dispatch
    obj.AddEventDispatch = function (ids, target) {
        obj.debug(3, 'AddEventDispatch', ids);
        for (var i in ids) { var id = ids[i]; if (!obj.eventsDispatch[id]) { obj.eventsDispatch[id] = [target]; } else { obj.eventsDispatch[id].push(target); } }
    }
    obj.RemoveEventDispatch = function (ids, target) {
        obj.debug(3, 'RemoveEventDispatch', id);
        for (var i in ids) { var id = ids[i]; if (obj.eventsDispatch[id]) { var j = obj.eventsDispatch[id].indexOf(target); if (j >= 0) { array.splice(j, 1); } } }
    }
    obj.RemoveEventDispatchId = function (id) {
        obj.debug(3, 'RemoveEventDispatchId', id);
        if (obj.eventsDispatch[id] != undefined) { delete obj.eventsDispatch[id]; }
    }
    obj.RemoveAllEventDispatch = function (target) {
        obj.debug(3, 'RemoveAllEventDispatch');
        for (var i in obj.eventsDispatch) { var j = obj.eventsDispatch[i].indexOf(target); if (j >= 0) { obj.eventsDispatch[i].splice(j, 1); } }
    }
    obj.DispatchEvent = function (ids, source, event, fromPeerServer) {
        // If the database is not setup, exit now.
        if (!obj.db) return;

        obj.debug(3, 'DispatchEvent', ids);
        event.type = 'event';
        event.time = Date.now();
        event.ids = ids;
        if (!event.nolog) { obj.db.StoreEvent(ids, source, event); }
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
        if ((fromPeerServer == undefined) && (obj.multiServer != null)) { obj.multiServer.DispatchEvent(ids, source, event); }
        delete targets;
    }


    // Set the connectivity state of a node and setup the server so that messages can be routed correctly.
    // meshId: mesh identifier of format mesh/domain/meshidhex
    // nodeId: node identifier of format node/domain/nodeidhex
    // connectTime: time of connection, milliseconds elapsed since the UNIX epoch.
    // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 4 = Intel AMT local.
    // powerState: Value, 0 = Unknown, 1 = S0 power on, 2 = S1 Sleep, 3 = S2 Sleep, 4 = S3 Sleep, 5 = S4 Hibernate, 6 = S5 Soft-Off, 7 = Present
    var connectTypeStrings = ['', 'MeshAgent', 'Intel AMT CIRA', '', 'Intel AMT local'];
    var powerStateStrings = ['Unknown', 'Powered', 'Sleep', 'Sleep', 'Deep Sleep', 'Hibernating', 'Soft-Off', 'Present'];
    obj.SetConnectivityState = function (meshid, nodeid, connectTime, connectType, powerState) {
        //console.log('SetConnectivity for ' + nodeid.substring(0, 16) + ', Type: ' + connectTypeStrings[connectType] + ', Power: ' + powerStateStrings[powerState]);

        // Change the node connection state
        var eventConnectChange = 0;
        var state = obj.connectivityByNode[nodeid];
        if (state) {
            // Change the connection in the node and mesh state lists
            if ((state.connectivity & connectType) == 0) {
                state.connectivity |= connectType;
                eventConnectChange = 1;
            }
        } else {
            // Add the connection to the node and mesh state list
            obj.connectivityByNode[nodeid] = state = { connectivity: connectType };
            if (!obj.connectivityByMesh[meshid]) { obj.connectivityByMesh[meshid] = {}; }
            obj.connectivityByMesh[meshid][nodeid] = state;
            eventConnectChange = 1;
        }

        // Set node power state
        if (connectType == 1) { state.agentPower = powerState; } else if (connectType == 2) { state.ciraPower = powerState; } else if (connectType == 4) { state.amtPower = powerState; }
        var powerState = 0, oldPowerState = state.powerState;
        if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
        if ((state.powerState == undefined) || (state.powerState != powerState)) {
            state.powerState = powerState;
            eventConnectChange = 1;

            // Set new power state in database
            obj.db.file.insert({ type: 'power', time: connectTime, node: nodeid, power: powerState, oldPower: oldPowerState });
        }

        // Event the node connection change
        if (eventConnectChange == 1) { obj.DispatchEvent(['*', meshid], obj, { action: 'nodeconnect', meshid: meshid, nodeid: nodeid, conn: state.connectivity, pwr: state.powerState, ct: connectTime, nolog: 1 }); }
    }

    // Clear the connectivity state of a node and setup the server so that messages can be routed correctly.
    // meshId: mesh identifier of format mesh/domain/meshidhex
    // nodeId: node identifier of format node/domain/nodeidhex
    // connectType: Bitmask, 1 = MeshAgent, 2 = Intel AMT CIRA, 3 = Intel AMT local.
    obj.ClearConnectivityState = function (meshid, nodeid, connectType) {
        //console.log('ClearConnectivity for ' + nodeid.substring(0, 16) + ', Type: ' + connectTypeStrings[connectType]);

        // Remove the agent connection from the nodes connection list
        var state = obj.connectivityByNode[nodeid];
        if (state == undefined) return;

        if ((state.connectivity & connectType) != 0) {
            state.connectivity -= connectType;

            // If the node is completely disconnected, clean it up completely
            if (state.connectivity == 0) {
                delete obj.connectivityByNode[nodeid];
                delete obj.connectivityByMesh[meshid][nodeid];
                state.powerState = 0;
            }
            eventConnectChange = 1;
        }

        // Clear node power state
        if (connectType == 1) { state.agentPower = 0; } else if (connectType == 2) { state.ciraPower = 0; } else if (connectType == 4) { state.amtPower = 0; }
        var powerState = 0, oldPowerState = state.powerState;
        if ((state.connectivity & 1) != 0) { powerState = state.agentPower; } else if ((state.connectivity & 2) != 0) { powerState = state.ciraPower; } else if ((state.connectivity & 4) != 0) { powerState = state.amtPower; }
        if ((state.powerState == undefined) || (state.powerState != powerState)) {
            state.powerState = powerState;
            eventConnectChange = 1;

            // Set new power state in database
            obj.db.file.insert({ type: 'power', time: Date.now(), node: nodeid, power: powerState, oldPower: oldPowerState });
        }

        // Event the node connection change
        if (eventConnectChange == 1) { obj.DispatchEvent(['*', meshid], obj, { action: 'nodeconnect', meshid: meshid, nodeid: nodeid, conn: state.connectivity, pwr: state.powerState, nolog: 1 }); }
    }

    // Update the default mesh core
    obj.updateMeshCore = function (func) {
        var altCorePath = obj.path.join(obj.datapath, 'meshcore.js');
        if (require('fs').existsSync(altCorePath)) {
            // Load default mesh agent core from data path if present
            readEntireTextFile(altCorePath, function (data) {
                if (data != null) {
                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                    obj.defaultMeshCore = data;
                    obj.defaultMeshCoreHash = obj.crypto.createHash('sha256').update(data).digest("binary");
                } else {
                    obj.parent.defaultMeshCore = null;
                    obj.parent.defaultMeshCoreHash = null;
                }
                if (func != undefined) { func(); }
            });
        } else {
            // Load default mesh agent core from meshcentral path if present
            readEntireTextFile(obj.path.join(__dirname, 'agents', 'meshcore.js'), function (data) {
                if (data != null) {
                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                    obj.defaultMeshCore = data;
                    obj.defaultMeshCoreHash = obj.crypto.createHash('sha256').update(data).digest("binary");
                } else {
                    obj.parent.defaultMeshCore = null;
                    obj.parent.defaultMeshCoreHash = null;
                }
                if (func != undefined) { func(); }
            });
        }
    }

    // List of possible mesh agent install scripts
    var meshAgentsInstallScriptList = {
        1: { id: 1, localname: 'meshinstall-linux.sh', rname: 'meshinstall.sh' }
    };

    // Update the list of available mesh agents
    obj.updateMeshAgentInstallScripts = function () {
        for (var scriptid in meshAgentsInstallScriptList) {
            var scriptpath = obj.path.join(__dirname, 'agents', meshAgentsInstallScriptList[scriptid].localname);
            var stream = null;
            try {
                stream = obj.fs.createReadStream(scriptpath);
                stream.on('data', function (data) { this.hash.update(data, 'binary') });
                stream.on('error', function (data) {
                    // If there is an error reading this file, make sure this agent is not in the agent table
                    if (obj.meshAgentInstallScripts[this.info.id] != undefined) { delete obj.meshAgentInstallScripts[this.info.id]; }
                });
                stream.on('end', function () {
                    // Add the agent to the agent table with all information and the hash
                    obj.meshAgentInstallScripts[this.info.id] = obj.common.Clone(this.info);
                    obj.meshAgentInstallScripts[this.info.id].hash = this.hash.digest('hex');
                    obj.meshAgentInstallScripts[this.info.id].path = this.agentpath;
                    obj.meshAgentInstallScripts[this.info.id].url = ((obj.args.notls == true) ? 'http://' : 'https://') + obj.certificates.CommonName + ':' + obj.args.port + '/meshagents?script=' + this.info.id;
                    var stats = null;
                    try { stats = obj.fs.statSync(this.agentpath) } catch (e) { }
                    if (stats != null) { obj.meshAgentInstallScripts[this.info.id].size = stats.size; }
                });
                stream.info = meshAgentsInstallScriptList[scriptid];
                stream.agentpath = scriptpath;
                stream.hash = obj.crypto.createHash('sha256', stream);
            } catch (e) { }
        }
    }

    // List of possible mesh agents
    var meshAgentsArchitectureNumbers = {
        1: { id: 1, localname: 'MeshConsole.exe', rname: 'MeshConsole.exe', desc: 'Windows x86-32 console', update: true },
        2: { id: 2, localname: 'MeshConsole64.exe', rname: 'MeshConsole.exe', desc: 'Windows x86-64 console', update: true },
        3: { id: 3, localname: 'MeshService.exe', rname: 'MeshAgent.exe', desc: 'Windows x86-32 service', update: true },
        4: { id: 4, localname: 'MeshService64.exe', rname: 'MeshAgent.exe', desc: 'Windows x86-64 service', update: true },
        5: { id: 5, localname: 'meshagent_x86', rname: 'meshagent', desc: 'Linux x86-32', update: true },
        6: { id: 6, localname: 'meshagent_x86-64', rname: 'meshagent', desc: 'Linux x86-64', update: true },
        7: { id: 7, localname: 'meshagent_mips', rname: 'meshagent', desc: 'Linux MIPS', update: true },
        8: { id: 8, localname: 'MeshAgent-Linux-XEN-x86-32', rname: 'meshagent', desc: 'XEN x86-64', update: true },
        9: { id: 9, localname: 'meshagent_arm', rname: 'meshagent', desc: 'Linux ARM5', update: true },
        10: { id: 10, localname: 'MeshAgent-Linux-ARM-PlugPC', rname: 'meshagent', desc: 'Linux ARM PlugPC', update: true },
        11: { id: 11, localname: 'MeshAgent-OSX-x86-32', rname: 'meshosx', desc: 'Apple OSX x86-32', update: true },
        12: { id: 12, localname: 'MeshAgent-Android-x86', rname: 'meshandroid', desc: 'Android x86-32', update: true },
        13: { id: 13, localname: 'meshagent_pogo', rname: 'meshagent', desc: 'Linux ARM PogoPlug', update: true },
        14: { id: 14, localname: 'MeshAgent-Android-APK', rname: 'meshandroid', desc: 'Android Market', update: false }, // Get this one from Google Play
        15: { id: 15, localname: 'meshagent_poky', rname: 'meshagent', desc: 'Linux Poky x86-32', update: true },
        16: { id: 16, localname: 'MeshAgent-OSX-x86-64', rname: 'meshosx', desc: 'Apple OSX x86-64', update: true },
        17: { id: 17, localname: 'MeshAgent-ChromeOS', rname: 'meshchrome', desc: 'Google ChromeOS', update: false }, // Get this one from Chrome store
        18: { id: 18, localname: 'meshagent_poky64', rname: 'meshagent', desc: 'Linux Poky x86-64', update: true },
        19: { id: 19, localname: 'meshagent_x86_nokvm', rname: 'meshagent', desc: 'Linux x86-32 NoKVM', update: true },
        20: { id: 20, localname: 'meshagent_x86-64_nokvm', rname: 'meshagent', desc: 'Linux x86-64 NoKVM', update: true },
        21: { id: 21, localname: 'MeshAgent-WinMinCore-Console-x86-32.exe', rname: 'MeshAgent.exe', desc: 'Windows MinCore Console x86-32', update: true },
        22: { id: 22, localname: 'MeshAgent-WinMinCore-Service-x86-64.exe', rname: 'MeshAgent.exe', desc: 'Windows MinCore Service x86-32', update: true },
        23: { id: 23, localname: 'MeshAgent-NodeJS', rname: 'meshagent', desc: 'NodeJS', update: false }, // Get this one from NPM
        24: { id: 24, localname: 'meshagent_arm-linaro', rname: 'meshagent', desc: 'Linux ARM Linaro', update: true },
        25: { id: 25, localname: 'meshagent_pi', rname: 'meshagent', desc: 'Linux ARM - Raspberry Pi', update: true } // "armv6l" and "armv7l"
    };

    // Update the list of available mesh agents
    obj.updateMeshAgentsTable = function () {
        for (var archid in meshAgentsArchitectureNumbers) {
            var agentpath = obj.path.join(__dirname, 'agents', meshAgentsArchitectureNumbers[archid].localname);
            var stream = null;
            try {
                stream = obj.fs.createReadStream(agentpath);
                stream.on('data', function (data) { this.hash.update(data, 'binary') });
                stream.on('error', function (data) {
                    // If there is an error reading this file, make sure this agent is not in the agent table
                    if (obj.meshAgentBinaries[this.info.id] != undefined) { delete obj.meshAgentBinaries[this.info.id]; }
                });
                stream.on('end', function () {
                    // Add the agent to the agent table with all information and the hash
                    obj.meshAgentBinaries[this.info.id] = obj.common.Clone(this.info);
                    obj.meshAgentBinaries[this.info.id].hash = this.hash.digest('hex');
                    obj.meshAgentBinaries[this.info.id].path = this.agentpath;
                    obj.meshAgentBinaries[this.info.id].url = ((obj.args.notls == true) ? 'http://' : 'https://') + obj.certificates.CommonName + ':' + obj.args.port + '/meshagents?id=' + this.info.id;
                    var stats = null;
                    try { stats = obj.fs.statSync(this.agentpath) } catch (e) { }
                    if (stats != null) { obj.meshAgentBinaries[this.info.id].size = stats.size; }
                });
                stream.info = meshAgentsArchitectureNumbers[archid];
                stream.agentpath = agentpath;
                stream.hash = obj.crypto.createHash('sha256', stream);
            } catch (e) { }
        }
    }

    // Debug
    obj.debug = function (lvl) {
        if (lvl > obj.debugLevel) return;
        if (arguments.length == 2) { console.log(arguments[1]); }
        else if (arguments.length == 3) { console.log(arguments[1], arguments[2]); }
        else if (arguments.length == 4) { console.log(arguments[1], arguments[2], arguments[3]); }
        else if (arguments.length == 5) { console.log(arguments[1], arguments[2], arguments[3], arguments[4]); }
    }
    
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

    return obj;
}

function InstallModules(modules, func) {
    if (modules.length > 0) { InstallModule(modules.shift(), InstallModules, modules, func); } else { func(); }
}

function InstallModule(modulename, func, tag1, tag2) {
    try {
        var module = require(modulename);
        delete module;
    } catch (e) {
        console.log('Installing ' + modulename + '...');
        var child_process = require('child_process');
        child_process.exec('npm install ' + modulename + ' --save', function (error, stdout, stderr) {
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

// Build the list of required modules
var modules = ['nedb', 'https', 'unzip', 'xmldom', 'express', 'mongojs', 'archiver', 'minimist', 'multiparty', 'node-forge', 'express-ws', 'compression', 'body-parser', 'connect-redis', 'express-session', 'express-handlebars'];
if (require('os').platform() == 'win32') { modules.push("node-windows"); }

// Run as a command line, if we are not using service arguments, don't need to install the service package.
var meshserver = null;
InstallModules(modules, function () { meshserver = CreateMeshCentralServer(); meshserver.Start(); });