/**
* @description Meshcentral web server
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

"use strict";

/*
class SerialTunnel extends require('stream').Duplex {
    constructor(options) { super(options); this.forwardwrite = null; }
    updateBuffer(chunk) { this.push(chunk); }
    _write(chunk, encoding, callback) { if (this.forwardwrite != null) { this.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); } // Pass data written to forward
    _read(size) { } // Push nothing, anything to read should be pushed from updateBuffer()
}
*/

// Older NodeJS does not support the keyword "class", so we do without using this syntax
// TODO: Validate that it's the same as above and that it works.
function SerialTunnel(options) {
    var obj = new require('stream').Duplex(options);
    obj.forwardwrite = null;
    obj.updateBuffer = function (chunk) { this.push(chunk); }
    obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); } // Pass data written to forward
    obj._read = function(size) { } // Push nothing, anything to read should be pushed from updateBuffer()
    return obj;
}

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Polyfill startsWith/endsWith for older NodeJS
if (!String.prototype.startsWith) { String.prototype.startsWith = function (searchString, position) { position = position || 0; return this.substr(position, searchString.length) === searchString; }; }
if (!String.prototype.endsWith) { String.prototype.endsWith = function (searchString, position) { var subjectString = this.toString(); if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; } position -= searchString.length; var lastIndex = subjectString.lastIndexOf(searchString, position); return lastIndex !== -1 && lastIndex === position; }; }

// Construct a HTTP web server object
module.exports.CreateWebServer = function (parent, db, args, secret, certificates) {
    var obj = {};

    // Modules    
    obj.fs = require('fs');
    obj.net = require('net');
    obj.tls = require('tls');
    obj.path = require('path');
    obj.hash = require('./pass').hash;
    obj.bodyParser = require('body-parser');
    obj.session = require('express-session');
    obj.exphbs = require('express-handlebars');
    obj.crypto = require('crypto');
    obj.common = require('./common.js');
    obj.express = require('express');
    obj.meshAgentHandler = require('./meshagent.js');
    obj.meshRelayHandler = require('./meshrelay.js')
    obj.interceptor = require('./interceptor');
    
    // Variables
    obj.parent = parent;
    obj.filespath = parent.filespath;
    obj.db = db;
    obj.app = obj.express();
    obj.app.use(require('compression')());
    obj.tlsServer = null;
    obj.tcpServer;
    obj.certificates = certificates;
    obj.args = args;
    obj.users = {};
    obj.meshes = {};
    
    // Perform hash on web certificate and agent certificate
    obj.webCertificatHash = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.web.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'binary' });
    obj.agentCertificatHashHex = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'hex' });
    obj.agentCertificatAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();

    // Main lists    
    obj.wsagents = {};
    obj.wssessions = {};    // UserId --> Array Of Sessions
    obj.wssessions2 = {};   // UserId + SessionId --> Session
    obj.wsrelays = {};
    
    // Setup randoms
    obj.crypto.randomBytes(32, function (err, buf) { obj.httpAuthRandom = buf; });
    obj.crypto.randomBytes(16, function (err, buf) { obj.httpAuthRealm = buf.toString('hex'); });
    obj.crypto.randomBytes(32, function (err, buf) { obj.relayRandom = buf; });

    if (obj.args.notls) {
        // Setup the HTTP server without TLS
        obj.expressWs = require('express-ws')(obj.app);
    } else {
        // Setup the HTTP server with TLS
        //var certOperations = require('./certoperations.js').CertificateOperations();
        //var webServerCert = certOperations.GetWebServerCertificate('./data', 'SampleServer.org', 'US', 'SampleOrg');
        obj.tlsServer = require('https').createServer({ cert: obj.certificates.web.cert, key: obj.certificates.web.key, rejectUnauthorized: true }, obj.app);
        obj.expressWs = require('express-ws')(obj.app, obj.tlsServer);
    }
    
    // Setup middleware
    obj.app.engine('handlebars', obj.exphbs({})); // defaultLayout: 'main'
    obj.app.set('view engine', 'handlebars');
    obj.app.use(obj.bodyParser.urlencoded({ extended: false }));
    obj.app.use(obj.session({
        resave: false, // don't save session if unmodified
        saveUninitialized: false, // don't create session until something stored
        secret: secret // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
    }));
    
    // Session-persisted message middleware
    obj.app.use(function (req, res, next) {
        if (req.session != undefined) {
            var err = req.session.error;
            var msg = req.session.success;
            delete req.session.error;
            delete req.session.success;
        }
        res.locals.message = '';
        if (err) res.locals.message = '<p class="msg error">' + err + '</p>';
        if (msg) res.locals.message = '<p class="msg success">' + msg + '</p>';
        next();
    });

    // Fetch all users from the database, keep this in memory
    obj.db.GetAllType('user', function (err, docs) {
        var domainUserCount = {};
        for (var i in parent.config.domains) { domainUserCount[i] = 0; }
        for (var i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
        for (var i in parent.config.domains) {
            if (domainUserCount[i] == 0) {
                if (parent.config.domains[i].newAccounts == 0) { parent.config.domains[i].newAccounts = 2; }
                console.log('Server ' + ((i == '') ? '' : (i + ' ')) + 'has no users, next new account will be site administrator.');
            }
        }
    });
    
    // Fetch all meshes from the database, keep this in memory
    obj.db.GetAllType('mesh', function (err, docs) { for (var i in docs) { obj.meshes[docs[i]._id] = docs[i]; } });

    // Authenticate the user
    obj.authenticate = function (name, pass, domain, fn) {
        if (!module.parent) console.log('authenticating %s:%s:%s', domain.id, name, pass);
        var user = obj.users['user/' + domain.id + '/' + name.toLowerCase()];
        // Query the db for the given username
        if (!user) return fn(new Error('cannot find user'));
        // Apply the same algorithm to the POSTed password, applying the hash against the pass / salt, if there is a match we found the user
        if (user.salt == undefined) {
            fn(new Error('invalid password'));
        } else {
            obj.hash(pass, user.salt, function (err, hash) {
                if (err) return fn(err);
                if (hash == user.hash) return fn(null, user._id);
                fn(new Error('invalid password'));
            });
        }
    }
    
    /*
    obj.restrict = function (req, res, next) {
        console.log('restrict', req.url);
        var domain = getDomain(req);
        if (req.session.userid) {
            next();
        } else {
            req.session.error = 'Access denied!';
            res.redirect(domain.url + 'login');
        }
    }
    */

    // Return the current domain of the request
    function getDomain(req) {
        var x = req.url.split('/');
        if (x.length < 2) return parent.config.domains[''];
        if (parent.config.domains[x[1].toLowerCase()]) return parent.config.domains[x[1].toLowerCase()];
        return parent.config.domains[''];
    }
    
    function handleLogoutRequest(req, res) {
        var domain = getDomain(req);
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        // Destroy the user's session to log them out will be re-created next request
        if (req.session.userid) {
            var user = obj.users[req.session.userid]
            obj.parent.DispatchEvent(['*'], obj, { etype: 'user', username: user.name, action: 'logout', msg: 'Account logout', domain: domain.id })
        }
        req.session.destroy(function () {
            res.redirect(domain.url);
        });
    }
    
    function handleLoginRequest(req, res) {
        var domain = getDomain(req);
        obj.authenticate(req.body.username, req.body.password, domain, function (err, userid) {
            if (userid) {
                var user = obj.users[userid];
                
                // Save login time
                user.login = Date.now();
                obj.db.SetUser(user);
                
                // Regenerate session when signing in to prevent fixation
                req.session.regenerate(function () {
                    // Store the user's primary key in the session store to be retrieved, or in this case the entire user object
                    // req.session.success = 'Authenticated as ' + user.name + 'click to <a href="/logout">logout</a>. You may now access <a href="/restricted">/restricted</a>.';
                    delete req.session.loginmode;
                    req.session.userid = userid;
                    req.session.domainid = domain.id;
                    req.session.currentNode = '';
                    if (req.body.viewmode) {
                        req.session.viewmode = req.body.viewmode;
                    }
                    if (req.body.host) {
                        obj.db.GetAllType('node', function (err, docs) {
                            for (var i = 0; i < docs.length; i++) {
                                if (docs[i].name == req.body.host) {
                                    req.session.currentNode = docs[i]._id;
                                    break;
                                }
                            }
                            console.log("CurrentNode: " + req.session.currentNode);
                            // This redirect happens after finding node is completed
                            res.redirect(domain.url);
                        });
                    } else {
                        res.redirect(domain.url);
                    }
                });
                
                obj.parent.DispatchEvent(['*'], obj, { etype: 'user', username: user.name, action: 'login', msg: 'Account login', domain: domain.id })
            } else {
                delete req.session.loginmode;
                req.session.error = '<b style=color:#8C001A>Login failed, check username and password.</b>';
                res.redirect(domain.url);
            }
        });
    }
    
    function handleCreateAccountRequest(req, res) {
        var domain = getDomain(req);
        if (domain.newAccounts == 0) { res.sendStatus(401); return; }
        if (!req.body.username || !req.body.email || !req.body.password1 || !req.body.password2 || (req.body.password1 != req.body.password2) || req.body.username == '~') {
            req.session.loginmode = 2;
            req.session.error = '<b style=color:#8C001A>Unable to create account.</b>';;
            res.redirect(domain.url);
        } else {
            // Check if user exists
            if (obj.users['user/' + domain.id + '/' + req.body.username.toLowerCase()]) {
                req.session.loginmode = 2;
                req.session.error = '<b style=color:#8C001A>Username already exists.</b>';
            } else {
                var user = { type: 'user', _id: 'user/' + domain.id + '/' + req.body.username.toLowerCase(), name: req.body.username, email: req.body.email, creation: Date.now(), login: Date.now(), domain: domain.id };
                var usercount = 0;
                for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                if (usercount == 0) { user.siteadmin = 0xFFFFFFFF; if (domain.newAccounts == 2) { domain.newAccounts = 0; } } // If this is the first user, give the account site admin.
                obj.users[user._id] = user;
                req.session.userid = user._id;
                req.session.domainid = domain.id;
                // Create a user, generate a salt and hash the password
                obj.hash(req.body.password1, function (err, salt, hash) {
                    if (err) throw err;
                    user.salt = salt;
                    user.hash = hash;
                    obj.db.SetUser(user);
                });
                obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, account: user, action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id })
            }
            res.redirect(domain.url);
        }
    }
    
    function handleDeleteAccountRequest(req, res) {
        var domain = getDomain(req);
        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url); return; }
        var user = obj.users[req.session.userid];
        if (!user) return;
        
        // Check if the password is correct
        obj.authenticate(user.name, req.body.apassword1, domain, function (err, userid) {
            var user = obj.users[userid];
            if (user) {
                obj.db.Remove(user._id);
                delete obj.users[user._id];
                req.session.destroy(function () { res.redirect(domain.url); });
                obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'accountremove', msg: 'Account removed', domain: domain.id })
            } else {
                res.redirect(domain.url);
            }
        });
    }
    
    // Handle password changes
    function handlePasswordChangeRequest(req, res) {
        var domain = getDomain(req);
        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url); return; }
        
        // Update the password
        obj.hash(req.body.apassword1, function (err, salt, hash) {
            if (err) throw err;
            var user = obj.users[req.session.userid];
            user.salt = salt;
            user.hash = hash;
            user.passchange = Date.now();
            obj.db.SetUser(user);
            req.session.viewmode = 2;
            res.redirect(domain.url);
            obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id })
        });
    }

    // Indicates that any request to "/" should render "default" or "login" depending on login state
    function handleRootRequest(req, res) {
        if (!obj.args) { res.sendStatus(500); return; }
        var domain = getDomain(req);
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        // Check if we have an incomplete domain name in the path
        if (domain.id != '' && req.url.split('/').length == 2) { res.redirect(domain.url); return; }
        if (obj.args.nousers == true) {
            // If in single user mode, setup things here.
            if (req.session && req.session.loginmode) { delete req.session.loginmode; }
            req.session.userid = 'user/' + domain.id + '/~';
            req.session.domainid = domain.id;
            req.session.currentNode = '';
            if (obj.users[req.session.userid] == undefined) {
                // Create the dummy user ~ with impossible password
                obj.users[req.session.userid] = { type: 'user', _id: req.session.userid, name: '~', email: '~', domain: domain.id, siteadmin: 0xFFFFFFFF };
                obj.db.SetUser(obj.users[req.session.userid]);
            }
        } else if (obj.args.user && (!req.session || !req.session.userid) && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
            // If a default user is active, setup the session here.
            if (req.session && req.session.loginmode) { delete req.session.loginmode; }
            req.session.userid = 'user/' + domain.id + '/' + obj.args.user.toLowerCase();
            req.session.domainid = domain.id;
            req.session.currentNode = '';
        }
        // If a user is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid) {
            if (req.session.domainid != domain.id) { req.session.destroy(function () { res.redirect(domain.url); }); return; } // Check is the session is for the correct domain
            var viewmode = 1;
            if (req.session.viewmode) {
                viewmode = req.session.viewmode;
                delete req.session.viewmode;
            }
            var currentNode = '';
            if (req.session.currentNode) {
                currentNode = req.session.currentNode;
                delete req.session.currentNode;
            }
            var user;
            var logoutcontrol;
            if (!obj.args.nousers) {
                user = obj.users[req.session.userid]
                logoutcontrol = 'Welcome ' + user.name + '.';
            }
            var features = 0;
            if (obj.args.wanonly == true) { features += 1; } // WAN-only mode
            if (obj.args.lanonly == true) { features += 2; } // LAN-only mode
            if (obj.args.nousers == true) { features += 4; } // Single user mode
            if (domain.userQuota == -1) { features += 8; } // No server files mode
            if ((!obj.args.user) && (!obj.args.nousers)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
            res.render(obj.path.join(__dirname, 'views/default'), { viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: obj.certificates.CommonName, serverPublicPort: args.port, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, mpspass: args.mpspass });
        } else {
            // Send back the login application
            res.render(obj.path.join(__dirname, 'views/login'), { loginmode: req.session.loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: domain.newAccounts, serverDnsName: obj.certificates.CommonName, serverPublicPort: obj.args.port });
        }
    }
    
    // Get the link to the root certificate if needed
    function getRootCertLink() {
        // TODO: This is not quite right, we need to check if the HTTPS certificate is issued from MeshCentralRoot, if so, add this download link.
        if (obj.args.notls == undefined && obj.certificates.RootName.substring(0, 16) == 'MeshCentralRoot-') { return '<a href=/MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>'; }
        return '';
    }

    // Renter the terms of service.
    function handleTermsRequest(req, res) {
        var domain = getDomain(req);
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        if (req.session && req.session.userid) {
            if (req.session.domainid != domain.id) { req.session.destroy(function () { res.redirect(domain.url); }); return; } // Check is the session is for the correct domain
            var user = obj.users[req.session.userid];
            res.render(obj.path.join(__dirname, 'views/terms'), { logoutControl: 'Welcome ' + user.name + '. <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>' });
        } else {
            res.render(obj.path.join(__dirname, 'views/terms'), { title: domain.title, title2: domain.title2 });
        }
    }

    // Returns the server root certificate encoded in base64
    function getRootCertBase64() {
        var rootcert = obj.certificates.root.cert;
        var i = rootcert.indexOf("-----BEGIN CERTIFICATE-----\r\n");
        if (i >= 0) { rootcert = rootcert.substring(i + 29); }
        i = rootcert.indexOf("-----END CERTIFICATE-----");
        if (i >= 0) { rootcert = rootcert.substring(i, 0); }
        return new Buffer(rootcert, 'base64').toString('base64');
    }

    // Returns the mesh server root certificate
    function handleRootCertRequest(req, res) {
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + certificates.RootName + '.cer' });
        res.send(new Buffer(getRootCertBase64(), 'base64'));
    }

    // Returns an mescript for Intel AMT configuration
    function handleMeScriptRequest(req, res) {
        if (req.query.type == 1) {
            var filename = 'cira_setup.mescript';
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + filename });
            var serverNameSplit = obj.certificates.CommonName.split('.');
            if ((serverNameSplit.length == 4) && (parseInt(serverNameSplit[0]) == serverNameSplit[0]) && (parseInt(serverNameSplit[1]) == serverNameSplit[1]) && (parseInt(serverNameSplit[2]) == serverNameSplit[2]) && (parseInt(serverNameSplit[3]) == serverNameSplit[3])) {
                // Server name is an IPv4 address
                var filepath = obj.parent.path.join(__dirname, 'public/scripts/cira_setup_script_ip.mescript');
                readEntireTextFile(filepath, function (data) {
                    if (data == null) { res.sendStatus(404); return; }
                    var scriptFile = JSON.parse(data);

                    // Change a few things in the script
                    scriptFile.scriptBlocks[2].vars.CertBin.value = getRootCertBase64(); // Set the root certificate
                    scriptFile.scriptBlocks[3].vars.IP.value = obj.certificates.CommonName; // Set the server IPv4 address name
                    scriptFile.scriptBlocks[3].vars.ServerName.value = obj.certificates.CommonName; // Set the server certificate name
                    scriptFile.scriptBlocks[3].vars.Port.value = obj.args.mpsport; // Set the server MPS port
                    scriptFile.scriptBlocks[3].vars.username.value = req.query.meshid; // Set the username
                    scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                    scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.CommonName + ':' + obj.args.mpsport; // Set the primary server name:port to set periodic timer
                    //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.CommonName + ':' + obj.args.mpsport; // Set the secondary server name:port to set periodic timer
                    if (obj.args.ciralocalfqdn != undefined) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                    // Compile the script
                    var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                    var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                    scriptFile.mescript = new Buffer(scriptEngine.script_compile(runscript), 'binary').toString('base64');

                    // Send the script
                    res.send(new Buffer(JSON.stringify(scriptFile, null, ' ')));
                });
            } else {
                // Server name is a hostname
                var filepath = obj.parent.path.join(__dirname, 'public/scripts/cira_setup_script_dns.mescript');
                readEntireTextFile(filepath, function (data) {
                    if (data == null) { res.sendStatus(404); return; }
                    var scriptFile = JSON.parse(data);

                    // Change a few things in the script
                    scriptFile.scriptBlocks[2].vars.CertBin.value = getRootCertBase64(); // Set the root certificate
                    scriptFile.scriptBlocks[3].vars.FQDN.value = obj.certificates.CommonName; // Set the server DNS name
                    scriptFile.scriptBlocks[3].vars.Port.value = obj.args.mpsport; // Set the server MPS port
                    scriptFile.scriptBlocks[3].vars.username.value = req.query.meshid; // Set the username
                    scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                    scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.CommonName + ':' + obj.args.mpsport; // Set the primary server name:port to set periodic timer
                    //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.CommonName + ':' + obj.args.mpsport; // Set the secondary server name:port to set periodic timer
                    if (obj.args.ciralocalfqdn != undefined) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                    // Compile the script
                    var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                    var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                    scriptFile.mescript = new Buffer(scriptEngine.script_compile(runscript), 'binary').toString('base64');

                    // Send the script
                    res.send(new Buffer(JSON.stringify(scriptFile, null, ' ')));
                });
            }
        }
        else if (req.query.type == 2) {
            var filename = 'cira_cleanup.mescript';
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + filename });
            var filepath = obj.parent.path.join(__dirname, 'public/scripts/cira_cleanup.mescript');
            readEntireTextFile(filepath, function (data) {
                if (data == null) { res.sendStatus(404); return; }
                res.send(new Buffer(data));
            });
        }
    }
    
    // Handle user public file downloads
    function handleDownloadUserFiles(req, res) {
        var domain = getDomain(req), domainname = 'domain', spliturl = decodeURIComponent(req.path).split('/'), filename = '';
        if ((spliturl.length < 3) || (obj.common.IsFilenameValid(spliturl[2]) == false) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        if (domain.id != '') { domainname = 'domain-' + domain.id; }
        var path = obj.path.join(obj.filespath, domainname + "/user-" + spliturl[2] + "/Public");
        for (var i = 3; i < spliturl.length; i++) { if (obj.common.IsFilenameValid(spliturl[i]) == true) { path += '/' + spliturl[i]; filename = spliturl[i]; } else { res.sendStatus(404); return; } }
        
        var stat = null;
        try { stat = obj.fs.statSync(path) } catch (e) { }
        if ((stat != null) && ((stat.mode & 0x004000) == 0)) {
            if (req.query.download == 1) {
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=\"' + filename + '\"' });
                try { res.sendFile(obj.path.resolve(__dirname, path)); } catch (e) { res.sendStatus(404); }
            } else {
                res.render(obj.path.join(__dirname, 'views/download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, message: "<a href='" + req.path + "?download=1'>" + filename + "</a>, " + stat.size + " byte" + ((stat.size < 2)?'':'s') + "." });
            }
        } else {
            res.render(obj.path.join(__dirname, 'views/download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, message: "Invalid file link, please check the URL again." });
        }
    }

    // Download a file from the server
    function handleDownloadFile(req, res) {
        var domain = getDomain(req);
        if ((req.query.link == undefined) || (req.session == undefined) || (req.session.userid == undefined) || (domain == null) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        var user = obj.users[req.session.userid];
        if (user == undefined) { res.sendStatus(404); return; }
        var file = getServerFilePath(user, domain, req.query.link);
        if (file == null) { res.sendStatus(404); return; }
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=\"' + file.name + '\"' });
        try { res.sendFile(file.fullpath); } catch (e) { res.sendStatus(404); }
    }
    
    // Upload a MeshCore.js file to the server
    function handleUploadMeshCoreFile(req, res) {
        var domain = getDomain(req);
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if (user.siteadmin != 0xFFFFFFFF) { res.sendStatus(401); return; } // Check if we have mesh core upload rights (Full admin only)
        
        var multiparty = require('multiparty');
        var form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == undefined) || (fields.attrib == undefined) || (fields.attrib.length != 1)) { res.sendStatus(404); return; }
            for (var i in files.files) {
                var file = files.files[i];
                readEntireTextFile(file.path, function (data) {
                    if (data == null) return;
                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                    sendMeshAgentCore(user, domain, fields.attrib[0], data); // Upload the core
                    try { obj.fs.unlinkSync(file.path); } catch (e) { }
                });
            }
            res.send('');
        });
    }

    // Upload a file to the server
    function handleUploadFile(req, res) {
        var domain = getDomain(req);
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (domain.userQuota == -1)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if ((user.siteadmin & 8) == 0) { res.sendStatus(401); return; } // Check if we have file rights

        var multiparty = require('multiparty');
        var form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == undefined) || (fields.link == undefined) || (fields.link.length != 1)) { res.sendStatus(404); return; }
            var xfile = getServerFilePath(user, domain, decodeURIComponent(fields.link[0]));
            if (xfile == null) { res.sendStatus(404); return; }
            // Get total bytes in the path
            var totalsize = readTotalFileSize(xfile.fullpath);
            if (totalsize < xfile.quota) { // Check if the quota is not already broken
                if (fields.name != undefined) {
                    // Upload method where all the file data is within the fields.
                    var names = fields.name[0].split('*'), sizes = fields.size[0].split('*'), types = fields.type[0].split('*'), datas = fields.data[0].split('*');
                    if ((names.length == sizes.length) && (types.length == datas.length) && (names.length == types.length)) {
                        for (var i = 0; i < names.length; i++) {
                            if (obj.common.IsFilenameValid(names[i]) == false) { res.sendStatus(404); return; }
                            var filedata = new Buffer(datas[i].split(',')[1], 'base64');
                            if ((totalsize + filedata.length) < xfile.quota) { // Check if quota would not be broken if we add this file
                                obj.fs.writeFileSync(xfile.fullpath + '/' + names[i], filedata);
                            }
                        }
                    }
                } else {
                    // More typical upload method, the file data is in a multipart mime post.
                    for (var i in files.files) {
                        var file = files.files[i], fpath = xfile.fullpath + '/' + file.originalFilename;
                        if (obj.common.IsFilenameValid(file.originalFilename) && ((totalsize + file.size) < xfile.quota)) { // Check if quota would not be broken if we add this file
                            obj.fs.rename(file.path, fpath);
                        } else {
                            try { obj.fs.unlinkSync(file.path); } catch (e) { }
                        }
                    }
                }
            }
            res.send('');
            obj.parent.DispatchEvent([user._id], obj, 'updatefiles') // Fire an event causing this user to update this files
        });
    }
    
    // Subscribe to all events we are allowed to receive
    obj.subscribe = function (userid, target) {
        var user = obj.users[userid];
        var subscriptions = [userid, 'server-global'];
        if (user.siteadmin != undefined) {
            if (user.siteadmin == 0xFFFFFFFF) subscriptions.push('*');
            if ((user.siteadmin & 2) != 0) subscriptions.push('server-users');
        }
        if (user.links != undefined) {
            for (var i in user.links) { subscriptions.push(i); }
        }
        obj.parent.RemoveAllEventDispatch(target);
        obj.parent.AddEventDispatch(subscriptions, target);
        return subscriptions;
    }

    // Handle a web socket relay request
    function handleRelayWebSocket(ws, req) {
        var node, domain = getDomain(req);
        // Check if this is a logged in user
        if (!req.session || !req.session.userid) { return; } // Web socket attempt without login, disconnect.
        if (req.session.domainid != domain.id) { console.log('ERR: Invalid domain'); return; }
        var user = obj.users[req.session.userid];
        if (!user) { console.log('ERR: Not a user'); return; }
        Debug(1, 'Websocket relay connected from ' + user.name + ' for ' + req.query.host + '.');
        
        // Fetch information about the target
        obj.db.Get(req.query.host, function (err, docs) {
            if (docs.length == 0) { console.log('ERR: Node not found'); return; }
            node = docs[0];
            if (!node.intelamt) { console.log('ERR: Not AMT node'); return; }
            
            // Check if this user has permission to manage this computer
            var meshlinks = user.links[node.meshid];
            if (!meshlinks || !meshlinks.rights) { console.log('ERR: Access denied (1)'); return; }
            if ((meshlinks.rights & 8) == 0) { console.log('ERR: Access denied (2)'); return; }
            
            // Check what connectivity is available for this node
            var state = parent.connectivityByNode[req.query.host];
            var conn = 0;
            if (!state || state.connectivity == 0) {
                conn = 4; // DEBUG: Allow local connections for now... change this later when we can monitor Intel AMT machines and confirm routing before connections.
                //Debug(1, 'ERR: No routing possible (1)');
                //try { ws.close(); } catch (e) { }
                //return;
            } else {
                conn = state.connectivity;
            }
            
            // If Intel AMT CIRA connection is available, use it
            if (((conn & 2) != 0) && (parent.mpsserver.ciraConnections[req.query.host] != undefined)) {
                var ciraconn = parent.mpsserver.ciraConnections[req.query.host];
                
                // Compute target port, look at the CIRA port mappings, if non-TLS is allowed, use that, if not use TLS
                var port = 16993;
                //if (node.intelamt.tls == 0) port = 16992; // DEBUG: Allow TLS flag to set TLS mode within CIRA
                if (ciraconn.tag.boundPorts.indexOf(16992) >= 0) port = 16992; // RELEASE: Always use non-TLS mode if available within CIRA
                if (req.query.p == 2) port += 2;
                
                // Setup a new CIRA channel
                if ((port == 16993) || (port == 16995)) {
                    // Perform TLS - ( TODO: THIS IS BROKEN on Intel AMT v7 but works on v10, Not sure why )
                    var ser = new SerialTunnel();
                    var chnl = parent.mpsserver.SetupCiraChannel(ciraconn, port);

                    // let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                    // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                    ser.forwardwrite = function (msg) {
                        // Convert a buffer into a string, "msg = msg.toString('ascii');" does not work
                        // TLS ---> CIRA
                        var msg2 = "";
                        for (var i = 0; i < msg.length; i++) { msg2 += String.fromCharCode(msg[i]); }
                        chnl.write(msg2);
                    };

                    // When APF tunnel return something, update SerialTunnel buffer
                    chnl.onData = function (ciraconn, data) {
                        // CIRA ---> TLS
                        Debug(3, 'Relay TLS CIRA data', data.length);
                        if (data.length > 0) { try { ser.updateBuffer(Buffer.from(data, 'binary')); } catch (e) { } }
                    }

                    // Handke CIRA tunnel state change
                    chnl.onStateChange = function (ciraconn, state) {
                        Debug(2, 'Relay TLS CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                    }

                    // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                    var TLSSocket = require('tls').TLSSocket;
                    var tlsock = new TLSSocket(ser, { secureProtocol: 'SSLv23_method', rejectUnauthorized: false }); // TLSv1_2_method
                    tlsock.on('error', function (err) { Debug(1, "CIRA TLS Connection Error ", err); });
                    tlsock.on('secureConnect', function () { Debug(2, "CIRA Secure TLS Connection"); });
                        
                    // Decrypted tunnel from TLS communcation to be forwarded to websocket
                    tlsock.on('data', function (data) {
                        // AMT/TLS ---> WS
                        try {
                            var data2 = "";
                            for (var i = 0; i < data.length; i++) { data2 += String.fromCharCode(data[i]); }
                            if (ws.interceptor) { data2 = ws.interceptor.processAmtData(data2); } // Run data thru interceptor
                            ws.send(data2);
                        } catch (e) { }
                    });

                    // If TLS is on, forward it through TLSSocket
                    ws.forwardclient = tlsock;
                    ws.forwardclient.xtls = 1;
                } else {
                    // Without TLS
                    ws.forwardclient = parent.mpsserver.SetupCiraChannel(ciraconn, port);
                    ws.forwardclient.xtls = 0;
                }
                
                // When data is received from the web socket, forward the data into the associated CIRA cahnnel.
                // If the CIRA connection is pending, the CIRA channel has built-in buffering, so we are ok sending anyway.
                ws.on('message', function (msg) {
                    // WS ---> AMT/TLS
                    // Convert a buffer into a string, "msg = msg.toString('ascii');" does not work
                    var msg2 = "";
                    for (var i = 0; i < msg.length; i++) { msg2 += String.fromCharCode(msg[i]); }
                    if (ws.interceptor) { msg2 = ws.interceptor.processBrowserData(msg2); } // Run data thru interceptor
                    if (ws.forwardclient.xtls == 1) { ws.forwardclient.write(Buffer.from(msg2, 'binary')); } else { ws.forwardclient.write(msg2); }
                });

                // If error, do nothing
                ws.on('error', function (err) { console.log(err); });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function (req) {
                    Debug(1, 'Websocket relay closed.');
                    if (ws.forwardclient && ws.forwardclient.close) { ws.forwardclient.close(); } // TODO: If TLS is used, we need to close the socket that is wrapped by TLS
                });
                
                ws.forwardclient.onStateChange = function (ciraconn, state) {
                    Debug(2, 'Relay CIRA state change', state);
                    if (state == 0) { try { ws.close(); } catch (e) { } }
                }
                
                ws.forwardclient.onData = function (ciraconn, data) {
                    Debug(3, 'Relay CIRA data', data.length);
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    if (data.length > 0) { try { ws.send(data); } catch (e) { } } // TODO: Add TLS support
                }
                
                ws.forwardclient.onSendOk = function (ciraconn) {
                    // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                    //console.log('onSendOk');
                }
                
                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) {
                    Debug(3, 'INTERCEPTOR1', { host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                }
                else if (req.query.p == 2) {
                    Debug(3, 'INTERCEPTOR2', { user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass });
                }

                return;
            }
            
            // If Intel AMT direct connection is possible, option a direct socket
            if ((conn & 4) != 0) {   // We got a new web socket connection, initiate a TCP connection to the target Intel AMT host/port.
                Debug(2, 'Opening relay TCP socket connection to ' + req.query.host + '.');
                
                // Compute target port
                var port = 16992;
                if (node.intelamt.tls > 0) port = 16993; // This is a direct connection, use TLS when possible
                if (req.query.p == 2) port += 2;
                
                if (node.intelamt.tls == 0) {
                    // If this is TCP (without TLS) set a normal TCP socket
                    ws.forwardclient = new obj.net.Socket();
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    ws.forwardclient = obj.tls.connect(port, node.host, { secureProtocol: 'TLSv1_method', rejectUnauthorized: false }, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        Debug(2, 'TLS connected to ' + node.host + ':' + port + '.');
                        if (ws.xpendingdata && ws.xpendingdata.length > 0) {
                            //console.log('TLS sending pending data: ' + ws.xpendingdata.length);
                            ws.forwardclient.write(ws.xpendingdata);
                            delete ws.xpendingdata;
                        }
                        ws.forwardclient.xstate = 1;
                    });
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                    ws.xpendingdata = '';
                }
                
                // When data is received from the web socket, forward the data into the associated TCP connection.
                // If the TCP connection is pending, buffer up the data until it connects.
                ws.on('message', function (msg) {
                    // Debug(1, 'TCP relay data to ' + node.host + ', ' + msg.length + ' bytes'); // DEBUG
                    // Convert a buffer into a string, "msg = msg.toString('ascii');" does not work
                    var msg2 = "";
                    for (var i = 0; i < msg.length; i++) { msg2 += String.fromCharCode(msg[i]); }
                    if (ws.interceptor) { msg2 = ws.interceptor.processBrowserData(msg2); } // Run data thru interceptor
                    if (ws.forwardclient == undefined || ws.forwardclient.xstate == 0) {
                        // TCP connection is pending, buffer up the data.
                        if (ws.xpendingdata) { ws.xpendingdata += msg2; } else { ws.xpendingdata = msg2; }
                    } else {
                        // Forward data to the associated TCP connection.
                        ws.forwardclient.write(new Buffer(msg2, "ascii"));
                    }
                });

                // If error, do nothing
                ws.on('error', function (err) { console.log(err); });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function (req) {
                    Debug(1, 'Closing relay web socket connection to ' + ws.upgradeReq.query.host + '.');
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }
                });
                
                // When we receive data on the TCP connection, forward it back into the web socket connection.
                ws.forwardclient.on('data', function (data) {
                    //Debug(1, 'TCP relay data from ' + node.host + ', ' + data.length + ' bytes.'); // DEBUG
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    try { ws.send(data); } catch (e) { }
                });
                
                // If the TCP connection closes, disconnect the associated web socket.
                ws.forwardclient.on('close', function () {
                    Debug(1, 'TCP relay disconnected from ' + node.host + '.');
                    try { ws.close(); } catch (e) { }
                });
                
                // If the TCP connection causes an error, disconnect the associated web socket.
                ws.forwardclient.on('error', function (err) {
                    Debug(1, 'TCP relay error from ' + node.host + ': ' + err.errno);
                    try { ws.close(); } catch (e) { }
                });
                
                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) { ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass }); }
                else if (req.query.p == 2) { ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass }); }
                
                if (node.intelamt.tls == 0) {
                    // A TCP connection to Intel AMT just connected, send any pending data and start forwarding.
                    ws.forwardclient.connect(port, node.host, function () {
                        Debug(1, 'TCP relay connected to ' + node.host + ':' + port + '.');
                        if (ws.xpendingdata && ws.xpendingdata.length > 0) {
                            //console.log('TCP sending pending data: ' + ws.xpendingdata.length);
                            ws.forwardclient.write(new Buffer(ws.xpendingdata, "ascii"));
                            delete ws.xpendingdata;
                        }
                        ws.forwardclient.xstate = 1;
                    });
                }
                return;
            }

        });
    }

    // Handle the web socket echo request, just echo back the data sent
    function handleEchoWebSocket(ws, req) {
        // When data is received from the web socket, echo it back
        ws.on('message', function (data) {
            var cmd = data.toString('utf8');
            if (cmd == 'close') {
                try { ws.close(); } catch (e) { console.log(e); }
            } else {
                try { ws.send(data); } catch (e) { console.log(e); }
            }
        });

        // If error, do nothing
        ws.on('error', function (err) { console.log(err); });

        // If closed, do nothing
        ws.on('close', function (req) { });
    }

    // Read the folder and all sub-folders and serialize that into json.
    function readFilesRec(path) {
        var r = {}, dir = obj.fs.readdirSync(path);
        for (var i in dir) {
            var f = { t: 3, d: 111 };
            var stat = obj.fs.statSync(path + '/' + dir[i])
            if ((stat.mode & 0x004000) == 0) { f.s = stat.size; f.d = stat.mtime.getTime(); } else { f.t = 2; f.f = readFilesRec(path + '/' + dir[i]); }
            r[dir[i]] = f;
        }
        return r;
    }
    
    // Get the total size of all files in a folder and all sub-folders
    function readTotalFileSize(path) {
        var r = 0, dir = obj.fs.readdirSync(path);
        for (var i in dir) {
            var stat = obj.fs.statSync(path + '/' + dir[i])
            if ((stat.mode & 0x004000) == 0) { r += stat.size; } else { r += readTotalFileSize(path + '/' + dir[i]); }
        }
        return r;
    }
    
    // Delete a folder and all sub items.
    function deleteFolderRec(path) {
        if (obj.fs.existsSync(path) == false) return;
        obj.fs.readdirSync(path).forEach(function (file, index) {
            var pathx = path + "/" + file;
            if (obj.fs.lstatSync(pathx).isDirectory()) { deleteFolderRec(pathx); } else { obj.fs.unlinkSync(pathx); }
        });
        obj.fs.rmdirSync(path);
    };

    // Indicates we want to handle websocket requests on "/control.ashx".
    function handleControlRequest(ws, req) {
        var domain = getDomain(req);
        try {
            // Check if the user is logged in
            if ((!req.session) || (!req.session.userid) || (req.session.domainid != domain.id)) { try { ws.close(); } catch (e) { } return; }
            req.session.ws = ws; // Associate this websocket session with the web session
            req.session.ws.userid = req.session.userid;
            req.session.ws.domainid = domain.id;
            var user = obj.users[req.session.userid];
            if (user == undefined || user == null) { try { ws.close(); } catch (e) { } return; }
            
            // Add this web socket session to session list
            ws.sessionId = user._id + '/' + ('' + Math.random()).substring(2);
            obj.wssessions2[ws.sessionId] = ws;
            if (!obj.wssessions[user._id]) { obj.wssessions[user._id] = [ws]; } else { obj.wssessions[user._id].push(ws); }
            obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.wssessions[user._id].length, nolog: 1, domain: domain.id })
            
            // Handle events
            ws.HandleEvent = function (source, event) {
                if (!event.domain || event.domain == domain.id) {
                    try {
                        if (event == 'close') { req.session.destroy(); ws.close(); }
                        else if (event == 'resubscribe') { user.subscriptions = obj.subscribe(user._id, ws); }
                        else if (event == 'updatefiles') { updateUserFiles(user, ws, domain); }
                        else { ws.send(JSON.stringify({ action: 'event', event: event })); }
                    } catch (e) { }
                }
            }
            
            // Subscribe to events
            user.subscriptions = obj.subscribe(user._id, ws);
            
            // When data is received from the web socket
            ws.on('message', function (msg) {
                var user = obj.users[req.session.userid];
                var command = JSON.parse(msg.toString('utf8'))
                switch (command.action) {
                    case 'meshes':
                        {
                            // Request a list of all meshes this user as rights to
                            var docs = [];
                            for (var i in user.links) { if (obj.meshes[i]) { docs.push(obj.meshes[i]); } }
                            ws.send(JSON.stringify({ action: 'meshes', meshes: docs }));
                            break;
                        }
                    case 'nodes':
                        {
                            // Request a list of all meshes this user as rights to
                            var links = [];
                            for (var i in user.links) { links.push(i); }
                            
                            // Request a list of all nodes
                            obj.db.GetAllTypeNoTypeFieldMeshFiltered(links, domain.id, 'node', function (err, docs) {
                                var r = {};
                                for (var i in docs) {
                                    // Add the connection state
                                    var state = parent.connectivityByNode[docs[i]._id];
                                    if (state) {
                                        docs[i].conn = state.connectivity;
                                        docs[i].pwr = state.powerState;
                                        if ((state.connectivity & 1) != 0) { var agent = obj.wsagents[docs[i]._id]; if (agent != undefined) { docs[i].agct = agent.connectTime; } }
                                        if ((state.connectivity & 2) != 0) { var cira = obj.parent.mpsserver.ciraConnections[docs[i]._id]; if (cira != undefined) { docs[i].cict = cira.tag.connectTime; } }
                                    }
                                    // Compress the meshid's
                                    var meshid = docs[i].meshid;
                                    if (!r[meshid]) { r[meshid] = []; }
                                    delete docs[i].meshid;
                                    r[meshid].push(docs[i]);
                                }
                                ws.send(JSON.stringify({ action: 'nodes', nodes: r }));
                            });
                            break; 
                        }
                    case 'powertimeline':
                        {
                            // Query the database for the power timeline for a given node
                            // The result is a compacted array: [ startPowerState, startTimeUTC, powerState ] + many[ deltaTime, powerState ]
                            obj.db.getPowerTimeline(command.nodeid, function (err, docs) {
                                if (err == null && docs.length > 0) {
                                    var timeline = [], time = null, previousPower;
                                    for (var i in docs) {
                                        var doc = docs[i];
                                        if (time == null) {
                                            // First element
                                            time = doc.time;
                                            if (doc.oldPower) { timeline.push(doc.oldPower); } else { timeline.push(0); }
                                            timeline.push(time);
                                            timeline.push(doc.power);
                                            previousPower = doc.power;
                                        } else {
                                            // Delta element
                                            if ((previousPower != doc.power) && ((doc.time - time) > 60000)) { // To boost speed, any blocks less than a minute get approximated.
                                                // Create a new timeline
                                                timeline.push(doc.time - time);
                                                timeline.push(doc.power);
                                                time = doc.time;
                                                previousPower = doc.power;
                                            } else {
                                                // Extend the previous timeline
                                                if ((timeline.length >= 6) && (timeline[timeline.length - 3] == doc.power)) { // We can merge the block with the previous block
                                                    timeline[timeline.length - 4] += (timeline[timeline.length - 2] + (doc.time - time));
                                                    timeline.pop();
                                                    timeline.pop();
                                                } else { // Extend the last block in the timeline
                                                    timeline[timeline.length - 2] += (doc.time - time);
                                                    timeline[timeline.length - 1] = doc.power;
                                                }
                                                time = doc.time;
                                                previousPower = doc.power;
                                            }
                                        }
                                    }
                                    ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: timeline }));
                                } else {
                                    // No records found, send current state if we have it
                                    var state = obj.parent.connectivityByNode[command.nodeid];
                                    if (state != undefined) { ws.send(JSON.stringify({ action: 'powertimeline', nodeid: command.nodeid, timeline: [state.powerState, Date.now(), state.powerState] })); }
                                }
                            });
                            break;
                        }
                    case 'files':
                        {
                            // Send the full list of server files to the browser app
                            if ((user.siteadmin & 8) != 0) { updateUserFiles(user, ws, domain); }
                            break;
                        }
                    case 'fileoperation':
                        {
                            // Check permissions
                            if ((user.siteadmin & 8) != 0) {
                                // Perform a file operation (Create Folder, Delete Folder, Delete File...)
                                if ((command.path != undefined) && (typeof command.path == 'object') && command.path.length > 0) {
                                    var rootfolder = command.path[0];
                                    var rootfoldersplit = rootfolder.split('/'), domainx = 'domain';
                                    if (rootfoldersplit[1].length > 0) domainx = 'domain-' + rootfoldersplit[1];
                                    var path = obj.path.join(obj.filespath, domainx + "/" + rootfoldersplit[0] + "-" + rootfoldersplit[2]);
                                    for (var i = 1; i < command.path.length; i++) { if (obj.common.IsFilenameValid(command.path[i]) == false) { path = null; break; } path += ("/" + command.path[i]); }
                                    if (path == null) break;
                                    
                                    if ((command.fileop == 'createfolder') && (obj.common.IsFilenameValid(command.newfolder) == true)) { try { obj.fs.mkdirSync(path + "/" + command.newfolder); } catch (e) { } } // Create a new folder
                                    else if (command.fileop == 'delete') { for (var i in command.delfiles) { if (obj.common.IsFilenameValid(command.delfiles[i]) == true) { var fullpath = path + "/" + command.delfiles[i]; try { obj.fs.rmdirSync(fullpath); } catch (e) { try { obj.fs.unlinkSync(fullpath); } catch (e) { } } } } } // Delete
                                    else if ((command.fileop == 'rename') && (obj.common.IsFilenameValid(command.oldname) == true) && (obj.common.IsFilenameValid(command.newname) == true)) { try { obj.fs.renameSync(path + "/" + command.oldname, path + "/" + command.newname); } catch (e) { } } // Rename
                                    
                                    obj.parent.DispatchEvent([user._id], obj, 'updatefiles') // Fire an event causing this user to update this files
                                }
                            }
                            break;
                        }
                    case 'msg':
                        {
                            // Route a message.
                            // This this command has a nodeid, that is the target.
                            if (command.nodeid != undefined) {
                                var splitnodeid = command.nodeid.split('/');
                                // Check that we are in the same domain and the user has rights over this node.
                                if ((splitnodeid[0] == 'node') && (splitnodeid[1] == domain.id)) {
                                    // See if the node is connected
                                    var agent = obj.wsagents[command.nodeid];
                                    if (agent != undefined) {
                                        // Check if we have permission to send a message to that node
                                        var rights = user.links[agent.dbMeshKey];
                                        if (rights != undefined || ((rights & 16) != 0)) { // TODO: 16 is console permission, may need more gradular permission checking
                                            command.sessionid = ws.sessionId;   // Set the session id, required for responses.
                                            command.rights = rights.rights;     // Add user rights flags to the message
                                            delete command.nodeid;              // Remove the nodeid since it's implyed.
                                            agent.send(JSON.stringify(command));
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    case 'events':
                        {
                            // Send the list of events for this session
                            obj.db.GetEvents(user.subscriptions, domain.id, function (err, docs) { if (err != null) return; ws.send(JSON.stringify({ action: 'events', events: docs })); });
                            break;
                        }
                    case 'clearevents':
                        {
                            // Delete all events
                            if (user.siteadmin != 0xFFFFFFFF) break;
                            obj.db.RemoveAllEvents(domain.id);
                            obj.parent.DispatchEvent(['*', 'server-global'], obj, { action: 'clearevents', nolog: 1, domain: domain.id })
                            break;
                        }
                    case 'users':
                        {
                            // Request a list of all users
                            if ((user.siteadmin & 2) == 0) break;
                            var docs = [];
                            for (var i in obj.users) { if ((obj.users[i].domain == domain.id) && (obj.users[i].name != '~')) { docs.push(obj.users[i]); } }
                            ws.send(JSON.stringify({ action: 'users', users: docs }));
                            break;
                        }
                    case 'wssessioncount':
                        {
                            // Request a list of all web socket session count
                            if ((user.siteadmin & 2) == 0) break;
                            var wssessions = {};
                            for (var i in obj.wssessions) { if (obj.wssessions[i][0].domainid == domain.id) { wssessions[i] = obj.wssessions[i].length; } }
                            ws.send(JSON.stringify({ action: 'wssessioncount', wssessions: wssessions }));
                            break;
                        }
                    case 'deleteuser':
                        {
                            // Delete a user account
                            if ((user.siteadmin & 2) == 0) break;
                            var delusername = command.username, deluserid = command.userid, deluser = obj.users[deluserid];
                            if ((deluser.siteadmin != undefined) && (deluser.siteadmin > 0) && (user.siteadmin != 0xFFFFFFFF)) break; // Need full admin to remote another administrator
                            if ((deluserid.split('/').length != 3) || (deluserid.split('/')[1] != domain.id)) break; // Invalid domain, operation only valid for current domain
                            
                            // Delete all files on the server for this account
                            try {
                                var deluserpath = getServerRootFilePath(deluser);
                                if (deluserpath != null) { deleteFolderRec(deluserpath); }
                            } catch (e) { }
                            
                            obj.db.Remove(deluserid);
                            delete obj.users[deluserid];
                            obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: deluserid, username: delusername, action: 'accountremove', msg: 'Account removed', domain: domain.id })
                            obj.parent.DispatchEvent([deluserid], obj, 'close');

                            break;
                        }
                    case 'adduser':
                        {
                            // Add a new user account
                            if ((user.siteadmin & 2) == 0) break;
                            var newusername = command.username, newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase();
                            if (newusername == '~') break; // This is a reserved user name
                            if (!obj.users[newuserid]) {
                                var newuser = { type: 'user', _id: newuserid, name: newusername, email: command.email, creation: Date.now(), domain: domain.id };
                                obj.users[newuserid] = newuser;
                                // Create a user, generate a salt and hash the password
                                obj.hash(command.pass, function (err, salt, hash) {
                                    if (err) throw err;
                                    newuser.salt = salt;
                                    newuser.hash = hash;
                                    obj.db.SetUser(newuser);
                                    var newuser2 = obj.common.Clone(newuser);
                                    if (newuser2.subscriptions) { delete newuser2.subscriptions; }
                                    if (newuser2.salt) { delete newuser2.salt; }
                                    if (newuser2.hash) { delete newuser2.hash; }
                                    obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: newusername, account: newuser2, action: 'accountcreate', msg: 'Account created, email is ' + command.email, domain: domain.id })
                                });
                            }
                            break;
                        }
                    case 'edituser':
                        {
                            // Edit a user account, may involve changing email or administrator permissions
                            if (((user.siteadmin & 2) != 0) || (user.name == command.name)) {
                                var chguserid = 'user/' + domain.id + '/' + command.name.toLowerCase(), chguser = obj.users[chguserid], change = 0;
                                if (chguser) {
                                    if (command.email && chguser.email != command.email) { chguser.email = command.email; change = 1; }
                                    if (command.quota != chguser.quota) { chguser.quota = command.quota; if (chguser.quota == undefined) { delete chguser.quota; } change = 1; }
                                    if ((user.siteadmin == 0xFFFFFFFF) && (command.siteadmin != undefined) && (chguser.siteadmin != command.siteadmin)) { chguser.siteadmin = command.siteadmin; change = 1 }
                                    if (change == 1) {
                                        obj.db.Set(chguser);
                                        obj.parent.DispatchEvent([chguser._id], obj, 'resubscribe');
                                        var chguser2 = obj.common.Clone(chguser);
                                        delete chguser2.salt;
                                        delete chguser2.hash;
                                        obj.parent.DispatchEvent(['*', 'server-users', user._id, chguser._id], obj, { etype: 'user', username: user.name, account: chguser2, action: 'accountchange', msg: 'Account changed: ' + command.name, domain: domain.id })
                                    }
                                }
                            }
                            break;
                        }
                    case 'serverversion':
                        {
                            // Check the server version
                            if ((user.siteadmin & 16) == 0) break;
                            obj.parent.getLatestServerVersion(function (currentVersion, latestVersion) { ws.send(JSON.stringify({ action: 'serverversion', current: currentVersion, latest: latestVersion })); });
                            break;
                        }
                    case 'createmesh':
                        {
                            // Create mesh
                            // TODO: Right now, we only create type 1 Agent-less Intel AMT mesh, or type 2 Agent mesh
                            if ((command.meshtype == 1) || (command.meshtype == 2)) {
                                // Create a type 1 agent-less Intel AMT mesh.
                                obj.crypto.randomBytes(32, function (err, buf) {
                                    var meshid = 'mesh/' + domain.id + '/' + buf.toString('hex').toUpperCase();
                                    var links = {}
                                    links[user._id] = { name: user.name, rights: 0xFFFFFFFF };
                                    var mesh = { type: 'mesh', _id: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, domain: domain.id, links: links };
                                    obj.db.Set(mesh);
                                    obj.meshes[meshid] = mesh;
                                    obj.parent.AddEventDispatch([meshid], ws);
                                    if (user.links == undefined) user.links = {};
                                    user.links[meshid] = { rights: 0xFFFFFFFF };
                                    user.subscriptions = obj.subscribe(user._id, ws);
                                    obj.db.SetUser(user);
                                    obj.parent.DispatchEvent(['*', meshid, user._id], obj, { etype: 'mesh', username: user.name, meshid: meshid, name: command.meshname, mtype: command.meshtype, desc: command.desc, action: 'createmesh', links: links, msg: 'Mesh created: ' + command.meshname, domain: domain.id })
                                });
                            }
                            break;
                        }
                    case 'deletemesh':
                        {
                            // Delete a mesh and all computers within it
                            obj.db.Get(command.meshid, function (err, meshes) {
                                if (meshes.length != 1) return;
                                var mesh = meshes[0];
                                
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == undefined || mesh.links[user._id].rights != 0xFFFFFFFF) return;
                                if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                                
                                // Fire the removal event first, because after this, the event will not route
                                obj.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'mesh', username: user.name, meshid: command.meshid, name: command.meshname, action: 'deletemesh', msg: 'Mesh deleted: ' + command.meshname, domain: domain.id })
                                                                
                                // Remove all user links to this mesh
                                for (var i in meshes) {
                                    var links = meshes[i].links;
                                    for (var j in links) {
                                        var xuser = obj.users[j];
                                        delete xuser.links[meshes[i]._id];
                                        obj.db.Set(xuser);
                                        obj.parent.DispatchEvent([xuser._id], obj, 'resubscribe');
                                    }
                                }
                                
                                // Delete all files on the server for this mesh
                                try {
                                    var meshpath = getServerRootFilePath(mesh);
                                    if (meshpath != null) { deleteFolderRec(meshpath); }
                                } catch (e) { }
                                
                                obj.parent.RemoveEventDispatchId(command.meshid); // Remove all subscriptions to this mesh
                                obj.db.RemoveMesh(command.meshid); // Remove mesh from database
                                delete obj.meshes[command.meshid]; // Remove mesh from memory
                            });
                            break;
                        }
                    case 'editmesh':
                        {
                            // Change the name or description of a mesh
                            var mesh = obj.meshes[command.meshid], change = '';
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 1) == 0)) return;
                                if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                                
                                if (command.meshname && command.meshname != '' && command.meshname != mesh.name) { change = 'Mesh name changed from "' + mesh.name + '" to "' + command.meshname + '"'; mesh.name = command.meshname; }
                                if (command.desc != undefined && command.desc != mesh.desc) { if (change != '') change += ' and description changed'; else change += 'Mesh "' + mesh.name + '" description changed'; mesh.desc = command.desc; }
                                if (change != '') { obj.db.Set(mesh); obj.parent.DispatchEvent(['*', mesh._id, user._id], obj, { etype: 'mesh', username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id }) }
                            }
                            break;
                        }
                    case 'addmeshuser':
                        {
                            // Check if the user exists
                            var newuserid = 'user/' + domain.id + '/' + command.username.toLowerCase(), newuser = obj.users[newuserid];
                            if (newuser == undefined) {
                                // TODO: Send error back, user not found.
                                break;
                            }
                            
                            // Get the mesh
                            var mesh = obj.meshes[command.meshid], change = '';
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 2) == 0)) return;
                                if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                                
                                // Add mesh to user
                                if (newuser.links == undefined) newuser.links = {};
                                newuser.links[command.meshid] = { rights: command.meshadmin };
                                obj.db.Set(newuser);
                                obj.parent.DispatchEvent([newuser._id], obj, 'resubscribe');
                                
                                // Add a user to the mesh
                                mesh.links[newuserid] = { name: command.username, rights: command.meshadmin };
                                obj.db.Set(mesh);
                                
                                // Notify mesh change
                                var change = 'Added user ' + command.username + ' to mesh ' + mesh.name;
                                obj.parent.DispatchEvent(['*', mesh._id, user._id, newuserid], obj, { etype: 'mesh', username: user.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                            }
                            break;
                        }
                    case 'removemeshuser':
                        {
                            if ((command.userid.split('/').length != 3) || (command.userid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                            
                            // Check if the user exists
                            var deluserid = command.userid, deluser = obj.users[deluserid];
                            if (deluser == undefined) {
                                // TODO: Send error back, user not found.
                                break;
                            }
                            
                            // Get the mesh
                            var mesh = obj.meshes[command.meshid];
                            if (mesh) {
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 2) == 0)) return;
                                
                                // Remove mesh from user
                                if (deluser.links != undefined && deluser.links[command.meshid] != undefined) {
                                    var delmeshrights = deluser.links[command.meshid].rights;
                                    if ((delmeshrights == 0xFFFFFFFF) && (mesh.links[user._id].rights != 0xFFFFFFFF)) return; // A non-admin can't kick out an admin
                                    delete deluser.links[command.meshid];
                                    obj.db.Set(deluser);
                                    obj.parent.DispatchEvent([deluser._id], obj, 'resubscribe');
                                }
                                
                                // Remove user from the mesh
                                if (mesh.links[command.userid] != undefined) {
                                    delete mesh.links[command.userid];
                                    obj.db.Set(mesh);
                                }
                                
                                // Notify mesh change
                                var change = 'Removed user ' + deluser.name + ' from mesh ' + mesh.name;
                                obj.parent.DispatchEvent(['*', mesh._id, user._id, command.userid], obj, { etype: 'mesh', username: user.name, userid: command.userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id })
                            }
                            break;
                        }
                    case 'addamtdevice':
                        {
                            if (obj.args.wanonly == true) return; // This is a WAN-only server, local Intel AMT computers can't be added

                            if ((command.meshid.split('/').length != 3) || (command.meshid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                            
                            // Get the mesh
                            var mesh = obj.meshes[command.meshid];
                            if (mesh) {
                                if (mesh.mtype != 1) return; // This operation is only allowed for mesh type 1, Intel AMT agentless mesh.
                                
                                // Check if this user has rights to do this
                                if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 4) == 0)) return;
                                
                                // Create a new nodeid
                                obj.crypto.randomBytes(32, function (err, buf) {
                                    // create the new node
                                    var nodeid = 'node/' + domain.id + '/' + buf.toString('hex').toUpperCase();
                                    var device = { type: 'node', mtype: 1, _id: nodeid, meshid: command.meshid, name: command.devicename, host: command.hostname, domain: domain.id, intelamt: { user: command.amtusername, pass: command.amtpassword, tls: parseInt(command.amttls) } };
                                    obj.db.Set(device);
                                    
                                    // Event the new node
                                    var device2 = obj.common.Clone(device);
                                    delete device2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                    var change = 'Added device ' + command.devicename + ' to mesh ' + mesh.name;
                                    obj.parent.DispatchEvent(['*', command.meshid], obj, { etype: 'node', username: user.name, action: 'addnode', node: device2, msg: change, domain: domain.id })
                                });
                            }
                            break;
                        }
                    case 'scanamtdevice':
                        {
                            if (obj.args.wanonly == true) return; // This is a WAN-only server, this type of scanning is not allowed.

                            // Ask the RMCP scanning to scan a range of IP addresses
                            if (obj.parent.amtScanner) {
                                if (obj.parent.amtScanner.performRangeScan(ws.userid, command.range) == false) {
                                    obj.parent.DispatchEvent(['*', ws.userid], obj, { action: 'scanamtdevice', range: command.range, results: null, nolog: 1 });
                                }
                            }
                            break;
                        }
                    case 'removedevices':
                        {
                            for (var i in command.nodeids) {
                                var nodeid = command.nodeids[i];
                                if ((nodeid.split('/').length != 3) || (nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                                // Get the device
                                obj.db.Get(nodeid, function (err, nodes) {
                                    if (nodes.length != 1) return;
                                    var node = nodes[0];

                                    // Get the mesh for this device
                                    var mesh = obj.meshes[node.meshid];
                                    if (mesh) {
                                        // Check if this user has rights to do this
                                        if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 4) == 0)) return;

                                        // Delete this node including network interface information and events
                                        obj.db.Remove(node._id);
                                        obj.db.Remove('if' + node._id);

                                        // Event node deletion
                                        var change = 'Removed device ' + node.name + ' from mesh ' + mesh.name;
                                        obj.parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', username: user.name, action: 'removenode', nodeid: node._id, msg: change, domain: domain.id })

                                        // Disconnect all connections if needed
                                        var state = obj.parent.connectivityByNode[command.nodeid];
                                        if ((state != undefined) && (state.connectivity != undefined)) {
                                            if ((state.connectivity & 1) != 0) { obj.wsagents[command.nodeid].close(); } // Disconnect mesh agent
                                            if ((state.connectivity & 2) != 0) { obj.parent.mpsserver.close(obj.parent.mpsserver.ciraConnections[command.nodeid]); } // Disconnect CIRA connection
                                        }
                                    }
                                });
                            }

                            break;
                        }
                    case 'wakedevices':
                        {
                            // TODO: We can optimize this a lot.
                            // - We should get a full list of all MAC's to wake first.
                            // - We should try to only have one agent per subnet (using Gateway MAC) send a wake-on-lan.
                            for (var i in command.nodeids) {
                                var nodeid = command.nodeids[i], wakeActions = 0;
                                if ((nodeid.split('/').length == 3) && (nodeid.split('/')[1] == domain.id)) { // Validate the domain, operation only valid for current domain
                                    // Get the device
                                    obj.db.Get(nodeid, function (err, nodes) {
                                        if (nodes.length != 1) return;
                                        var node = nodes[0];

                                        // Get the mesh for this device
                                        var mesh = obj.meshes[node.meshid];
                                        if (mesh) {

                                            // Check if this user has rights to do this
                                            if (mesh.links[user._id] != undefined && ((mesh.links[user._id].rights & 64) != 0)) {

                                                // Get the device interface information
                                                obj.db.Get('if' + node._id, function (err, nodeifs) {
                                                    if (nodeifs.length == 1) {
                                                        var nodeif = nodeifs[0];
                                                        var macs = [];
                                                        for (var i in nodeif.netif) { if (nodeif.netif[i].mac) { macs.push(nodeif.netif[i].mac); } }

                                                        // Have the server send a wake-on-lan packet (Will not work in WAN-only)
                                                        if (obj.parent.meshScanner != null) { obj.parent.meshScanner.wakeOnLan(macs); wakeActions++; }

                                                        // Get the list of mesh this user as access to
                                                        var targetMeshes = [];
                                                        for (var i in user.links) { targetMeshes.push(i); }

                                                        // Go thru all the connected agents and send wake-on-lan on all the ones in the target mesh list
                                                        for (var i in obj.wsagents) {
                                                            var agent = obj.wsagents[i];
                                                            if ((targetMeshes.indexOf(agent.dbMeshKey) >= 0) && (agent.authenticated == 2)) {
                                                                //console.log('Asking agent ' + agent.dbNodeKey + ' to wake ' + macs.join(','));
                                                                agent.send(JSON.stringify({ action: 'wakeonlan', macs: macs }));
                                                                wakeActions++;
                                                            }
                                                        }
                                                    }
                                                });

                                            }
                                        }
                                    });
                                }
                                // Confirm we may be doing something (TODO)
                                ws.send(JSON.stringify({ action: 'wakedevices' }));
                            }

                            break;
                        }
                    case 'getnetworkinfo':
                        {
                            // Argument validation
                            if ((command.nodeid == undefined) || (typeof command.nodeid != 'string') || (command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain

                            // Get the device
                            obj.db.Get(command.nodeid, function (err, nodes) {
                                if (nodes.length != 1) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }
                                var node = nodes[0];

                                // Get the mesh for this device
                                var mesh = obj.meshes[node.meshid];
                                if (mesh) {
                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] == undefined || (mesh.links[user._id].rights == 0)) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }

                                    // Get network information about this node
                                    obj.db.Get('if' + command.nodeid, function (err, netinfos) {
                                        if (netinfos.length != 1) { ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, netif: null })); return; }
                                        var netinfo = netinfos[0];
                                        ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: command.nodeid, updateTime: netinfo.updateTime, netif: netinfo.netif }));
                                    });
                                }
                            });
                            break;
                        }
                    case 'changedevice':
                        {
                            // Argument validation
                            if ((command.nodeid == undefined) || (typeof command.nodeid != 'string') || (command.nodeid.split('/').length != 3) || (command.nodeid.split('/')[1] != domain.id)) return; // Invalid domain, operation only valid for current domain
                            
                            // Change the device
                            obj.db.Get(command.nodeid, function (err, nodes) {
                                if (nodes.length != 1) return;
                                var node = nodes[0];
                                
                                // Get the mesh for this device
                                var mesh = obj.meshes[node.meshid];
                                if (mesh) {
                                    // Check if this user has rights to do this
                                    if (mesh.links[user._id] == undefined || ((mesh.links[user._id].rights & 4) == 0)) return;
                                    
                                    // Ready the node change event
                                    var changes = [], change = 0, event = { etype: 'node', username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id };
                                    event.msg = ": ";
                                    
                                    // Look for a change
                                    if (command.icon && (command.icon != node.icon)) { change = 1; node.icon = command.icon; changes.push('icon'); }
                                    if (command.name && (command.name != node.name)) { change = 1; node.name = command.name; changes.push('name'); }
                                    if (command.host && (command.host != node.host)) { change = 1; node.host = command.host; changes.push('host'); }
                                    if (command.desc != undefined && (command.desc != node.desc)) { change = 1; node.desc = command.desc; changes.push('description'); }
                                    if ((command.intelamt != undefined) && (node.intelamt != undefined)) {
                                        if ((command.intelamt.user != undefined) && (command.intelamt.pass != undefined) && ((command.intelamt.user != node.intelamt.user) || (command.intelamt.pass != node.intelamt.pass))) { change = 1; node.intelamt.user = command.intelamt.user; node.intelamt.pass = command.intelamt.pass; changes.push('Intel AMT credentials'); }
                                        if (command.intelamt.tls && (command.intelamt.tls != node.intelamt.tls)) { change = 1; node.intelamt.tls = command.intelamt.tls; changes.push('Intel AMT TLS'); }
                                    }

                                    if (change == 1) {
                                        // Save the node
                                        obj.db.Set(node);
                                        
                                        // Event the node change
                                        event.msg = 'Changed device ' + node.name + ' from mesh ' + mesh.name + ': ' + changes.join(', ');
                                        var node2 = obj.common.Clone(node);
                                        if (node2.intelamt && node2.intelamt.pass) delete node2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                        event.node = node2;
                                        obj.parent.DispatchEvent(['*', node.meshid], obj, event);
                                    }
                                }
                            });
                            break;
                        }
                    case 'uploadagentcore':
                        {
                            if (user.siteadmin != 0xFFFFFFFF) break;
                            if (command.path) {
                                if (command.path == '*') {
                                    // Update the server default core and send a core hash request
                                    // Load default mesh agent core if present, then perform a core update
                                    parent.updateMeshCore(function () { sendMeshAgentCore(user, domain, command.nodeid, '*'); });
                                } else {
                                    // Send a mesh agent core to the mesh agent
                                    var file = getServerFilePath(user, domain, command.path);
                                    if (file != null) {
                                        readEntireTextFile(file.fullpath, function (data) {
                                            if (data != null) {
                                                data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                                                sendMeshAgentCore(user, domain, command.nodeid, data);
                                            }
                                        })
                                    }
                                }
                            } else {
                                // Clear the mesh agent core on the mesh agent
                                sendMeshAgentCore(user, domain, command.nodeid, null);
                            }
                            break;
                        }
                    case 'agentdisconnect':
                        {
                            // Force mesh agent disconnection
                            forceMeshAgentDisconnect(user, domain, command.nodeid, command.disconnectMode);
                            break;
                        }
                    case 'close':
                        {
                            // Close the web socket session
                            if (req.session && req.session.ws && req.session.ws == ws) delete req.session.ws;
                            try { ws.close(); } catch (e) { }
                            break;
                        }
                }
            });

            // If error, do nothing
            ws.on('error', function (err) { console.log(err); });

            // If the web socket is closed
            ws.on('close', function (req) {
                obj.parent.RemoveAllEventDispatch(ws);
                if (req.session && req.session.ws && req.session.ws == ws) { delete req.session.ws; }
                if (obj.wssessions2[ws.sessionId]) { delete obj.wssessions2[ws.sessionId]; }
                if (obj.wssessions[ws.userid]) {
                    var i = obj.wssessions[ws.userid].indexOf(ws);
                    if (i >= 0) {
                        obj.wssessions[ws.userid].splice(i, 1);
                        var user = obj.users[ws.userid];
                        if (user) { obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: user.name, count: obj.wssessions[ws.userid].length, nolog: 1, domain: domain.id }) }
                        if (obj.wssessions[ws.userid].length == 0) { delete obj.wssessions[ws.userid]; }
                    }
                }
            });
            
            // Send user information to web socket, this is the first thing we send
            var userinfo = obj.common.Clone(obj.users[req.session.userid]);
            delete userinfo.salt;
            delete userinfo.hash;
            ws.send(JSON.stringify({ action: 'userinfo', userinfo: userinfo }));
            
            // Next, send server information
            if (obj.args.notls == true) {
                ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: { name: obj.certificates.CommonName, mpsport: obj.args.mpsport, mpspass: obj.args.mpspass, port: obj.args.port, https: false } }));
            } else {
                ws.send(JSON.stringify({ action: 'serverinfo', serverinfo: { name: obj.certificates.CommonName, mpsport: obj.args.mpsport, mpspass: obj.args.mpspass, redirport: obj.args.redirport, port: obj.args.port, https: true } }));
            }
        } catch (e) { console.log(e); }
    }
    
    // Handle Intel AMT events
    // To subscribe, add "http://server:port/amtevents.ashx" to Intel AMT subscriptions.
    obj.handleAmtEventRequest = function (req, res) {
        var domain = getDomain(req);
        try {
            if (req.headers['authorization']) {
                var authstr = req.headers['authorization'];
                if (authstr.substring(0, 7) == "Digest ") {
                    var auth = obj.common.parseNameValueList(obj.common.quoteSplit(authstr.substring(7)));
                    if ((req.url === auth.uri) && (obj.httpAuthRealm === auth.realm) && (auth.opaque === obj.crypto.createHmac('SHA256', obj.httpAuthRandom).update(auth.nonce).digest('hex'))) {
                        
                        // Read the data, we need to get the arg field
                        var eventData = '';
                        req.on('data', function (chunk) { eventData += chunk; });
                        req.on('end', function () {
                            
                            // Completed event read, let get the argument that must contain the nodeid
                            var i = eventData.indexOf('<m:arg xmlns:m="http://x.com">');
                            if (i > 0) {
                                var nodeid = eventData.substring(i + 30, i + 30 + 64).toUpperCase();
                                if (nodeid.length == 64) {
                                    var nodekey = 'node/' + domain.id + '/' + nodeid;
                                    
                                    // See if this node exists in the database
                                    obj.db.Get(nodekey, function (err, nodes) {
                                        if (nodes.length == 1) {
                                            // Yes, the node exists, compute Intel AMT digest password
                                            var node = nodes[0];
                                            var amtpass = obj.crypto.createHash('sha256').update(auth.username.toLowerCase() + ":" + nodeid + ":" + obj.parent.dbconfig.amtWsEventSecret).digest("base64").substring(0, 12).split("/").join("x").split("\\").join("x");
                                            
                                            // Check the MD5 hash
                                            if (auth.response === obj.common.ComputeDigesthash(auth.username, amtpass, auth.realm, "POST", auth.uri, auth.qop, auth.nonce, auth.nc, auth.cnonce)) {
                                                
                                                // This is an authenticated Intel AMT event, update the host address
                                                var amthost = req.connection.remoteAddress;
                                                if (amthost.substring(0, 7) === '::ffff:') { amthost = amthost.substring(7); }
                                                if (node.host != amthost) {
                                                    // Get the mesh for this device
                                                    var mesh = obj.meshes[node.meshid];
                                                    if (mesh) {
                                                        // Update the database
                                                        var oldname = node.host;
                                                        node.host = amthost;
                                                        obj.db.Set(node);

                                                        // Event the node change
                                                        var event = { etype: 'node', action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Intel(R) AMT host change ' + node.name + ' from mesh ' + mesh.name + ': ' + oldname + ' to ' + amthost };
                                                        var node2 = obj.common.Clone(node);
                                                        if (node2.intelamt && node2.intelamt.pass) delete node2.intelamt.pass; // Remove the Intel AMT password before eventing this.
                                                        event.node = node2;
                                                        obj.parent.DispatchEvent(['*', node.meshid], obj, event);
                                                    }
                                                }
                                                
                                                parent.amtEventHandler.handleAmtEvent(eventData, nodeid, amthost);
                                                //res.send('OK');
                                                
                                                return;
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            }
        } catch (e) { console.log(e); }
        
        // Send authentication response
        obj.crypto.randomBytes(32, function (err, buf) {
            var nonce = buf.toString('hex'), opaque = obj.crypto.createHmac('SHA256', obj.httpAuthRandom).update(nonce).digest('hex');
            res.set({ 'WWW-Authenticate': 'Digest realm="' + obj.httpAuthRealm + '", qop="auth,auth-int", nonce="' + nonce + '", opaque="' + opaque + '"' });
            res.sendStatus(401);
        });
    }
    
    // Handle a server backup request
    function handleBackupRequest(req, res) {
        var domain = getDomain(req);
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (obj.parent.args.noserverbackup == 1)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if ((user.siteadmin & 1) == 0) { res.sendStatus(401); return; } // Check if we have server backup rights

        // Require modules
        var fs = require('fs');
        var archive = require('archiver')('zip', { level: 9 }); // Sets the compression method to maximum. 
        
        // Good practice to catch this error explicitly 
        archive.on('error', function (err) { throw err; });
        
        // Set the archive name
        res.attachment(domain.title + '-Backup-' + new Date().toLocaleDateString().replace('/', '-').replace('/', '-') + '.zip');

        // Pipe archive data to the file 
        archive.pipe(res);
        
        // Append all of the files for this backup
        var backupList = ['config.json', 'meshcentral.db', 'agentserver-cert-private.key', 'agentserver-cert-public.crt', 'mpsserver-cert-private.key', 'mpsserver-cert-public.crt', 'data/root-cert-private.key', 'root-cert-public.crt', 'webserver-cert-private.key', 'webserver-cert-public.crt'];
        for (var i in backupList) {
            var filename = backupList[i];
            var filepath = obj.path.join(obj.parent.datapath, filename);
            if (fs.existsSync(filepath)) { archive.file(filepath, { name: filename }); }
        }

        // Finalize the archive (ie we are done appending files but streams have to finish yet) 
        archive.finalize();
    }
    
    // Handle a server restore request
    function handleRestoreRequest(req, res) {
        var domain = getDomain(req);
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (obj.parent.args.noserverbackup == 1)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if ((user.siteadmin & 4) == 0) { res.sendStatus(401); return; } // Check if we have server restore rights
        
        var multiparty = require('multiparty');
        var form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            res.send('Server must be restarted, <a href="' + domain.url + '">click here to login</a>.');
            parent.Stop(files.datafile[0].path);
        });
    }
    
    // Handle a request to download a mesh agent
    obj.handleMeshAgentRequest = function (req, res) {
        if (req.query.id != undefined) {
            // Send a specific mesh agent back
            var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
            if (argentInfo == undefined) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + argentInfo.rname });
            res.sendFile(argentInfo.path);
        } else if (req.query.script != undefined) {
            // Send a specific mesh install script back
            var scriptInfo = obj.parent.meshAgentInstallScripts[req.query.script];
            if (scriptInfo == undefined) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=' + scriptInfo.rname });
            res.sendFile(scriptInfo.path);
        } else {
            // Send a list of available mesh agents
            var response = '<html><head><title>Mesh Agents</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body><table>';
            response += '<tr style="background-color:lightgray"><th>ID</th><th>Description</th><th>Link</th><th>Size</th><th>SHA256</th></tr>';
            for (var agentid in obj.parent.meshAgentBinaries) {
                var agentinfo = obj.parent.meshAgentBinaries[agentid];
                response += '<tr><td>' + agentinfo.id + '</td><td>' + agentinfo.desc + '</td>';
                response += '<td><a target=_blank href="' + req.originalUrl + '?id=' + agentinfo.id + '">' + agentinfo.rname + '</a></td>';
                response += '<td>' + agentinfo.size + '</td><td>' + agentinfo.hash + '</td></tr>';
            }
            response += '</table></body></html>';
            res.send(response);
        }
    }
    
    // Handle a request to download a mesh settings
    obj.handleMeshSettingsRequest = function (req, res) {
        var domain = getDomain(req);
        //if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
        
        // Delete a mesh and all computers within it
        obj.db.Get('mesh/' + domain.id + '/' + req.query.id, function (err, meshes) {
            if (meshes.length != 1) { res.sendStatus(401); return; }
            var mesh = meshes[0];
            
            // Check if this user has rights to do this
            //var user = obj.users[req.session.userid];
            //if ((user == undefined) || (mesh.links[user._id] == undefined) || ((mesh.links[user._id].rights & 1) == 0)) { res.sendStatus(401); return; }
            //if (domain.id != mesh.domain) { res.sendStatus(401); return; }
                        
            var xdomain = domain.id;
            if (xdomain != '') xdomain += "/";
            var meshsettings = "MeshName=" + mesh.name + "\r\nMeshID=0x" + req.query.id.toUpperCase() + "\r\nServerID=" + obj.agentCertificatHashHex.toUpperCase() + "\r\n";
            if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + certificates.CommonName + ":" + obj.args.port + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local"; }

            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=meshagent.msh' });
            res.send(meshsettings);
        });
    }

    function updateUserFiles(user, ws, domain) {
        // Request the list of server files
        var files = { action: 'files', filetree: { n : 'Root', f : {} } };
        
        // Add user files
        files.filetree.f[user._id] = { t: 1, n: 'My Files', f: {} };
        files.filetree.f[user._id].maxbytes = getQuota(user._id, domain);
        var usersplit = user._id.split('/'), domainx = 'domain';
        if (usersplit[1].length > 0) domainx = 'domain-' + usersplit[1];
        
        // Read all files recursively
        try {
            files.filetree.f[user._id].f = readFilesRec(obj.path.join(obj.filespath, domainx + "/user-" + usersplit[2]));
        } catch (e) {
            // Got an error, try to create all the folders and try again...
            try { obj.fs.mkdirSync(obj.filespath); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.filespath, domainx)); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.filespath, domainx + "/user-" + usersplit[2])); } catch (e) { }
            try { obj.fs.mkdirSync(obj.path.join(obj.filespath, domainx + "/user-" + usersplit[2] + "/Public")); } catch (e) { }
            try { files.filetree.f[user._id].f = readFilesRec(obj.path.join(obj.filespath, domainx + "/user-" + usersplit[2])); } catch (e) { }
        }
        
        // Add files for each mesh
        for (var i in user.links) {
            if ((user.links[i].rights & 32) != 0) { // Check that we have file permissions
                var mesh = obj.meshes[i];
                if (mesh) {
                    var meshsplit = mesh._id.split('/');
                    files.filetree.f[mesh._id] = { t: 1, n: mesh.name, f: {} };
                    files.filetree.f[mesh._id].maxbytes = getQuota(mesh._id, domain);

                    // Read all files recursively
                    try {
                        files.filetree.f[mesh._id].f = readFilesRec(obj.path.join(__dirname, "files/" + domainx + "/mesh-" + meshsplit[2]));
                    } catch (e) {
                        // Got an error, try to create all the folders and try again...
                        try { obj.fs.mkdirSync(obj.filespath); } catch (e) { }
                        try { obj.fs.mkdirSync(obj.path.join(obj.filespath, domainx)); } catch (e) { }
                        try { obj.fs.mkdirSync(obj.path.join(obj.filespath, domainx + "/mesh-" + meshsplit[2])); } catch (e) { }
                        try { files.filetree.f[mesh._id].f = readFilesRec(obj.path.join(obj.filespath, domainx + "/mesh-" + meshsplit[2])); } catch (e) { }
                    }
                }
            }
        }

        // Respond
        ws.send(JSON.stringify(files));
    }

    // Add HTTP security headers to all responses
    obj.app.use(function (req, res, next) {
        // Two more headers to take a look at:
        //   'Public-Key-Pins': 'pin-sha256="X3pGTSOuJeEVw989IJ/cEtXUEmy52zs1TZQrU06KUKg="; max-age=10'
        //   'strict-transport-security': 'max-age=31536000; includeSubDomains'
        res.removeHeader("X-Powered-By");
        if (obj.args.notls) {
            // Default headers if no TLS is used
            res.set({ 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src http: ws: data: 'self';script-src http: 'unsafe-inline';style-src http: 'unsafe-inline'" });
        } else {
            // Default headers if TLS is used
            res.set({ 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src https: wss: data: 'self';script-src https: 'unsafe-inline';style-src https: 'unsafe-inline'" });
        }
        return next();
    });

    // Setup all HTTP handlers
    obj.app.get('/backup.zip', handleBackupRequest);
    obj.app.post('/restoreserver.ashx', handleRestoreRequest);
    if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', parent.multiServer.handleServerWebSocket); }
    for (var i in parent.config.domains) {
        var url = parent.config.domains[i].url;
        obj.app.get(url, handleRootRequest);
        obj.app.get(url + 'terms', handleTermsRequest);
        obj.app.post(url + 'login', handleLoginRequest);
        obj.app.get(url + 'logout', handleLogoutRequest);
        obj.app.get(url + 'MeshServerRootCert.cer', handleRootCertRequest);
        obj.app.get(url + 'mescript.ashx', handleMeScriptRequest);
        obj.app.post(url + 'changepassword', handlePasswordChangeRequest);
        obj.app.post(url + 'deleteaccount', handleDeleteAccountRequest);
        obj.app.post(url + 'createaccount', handleCreateAccountRequest);
        obj.app.post(url + 'amtevents.ashx', obj.handleAmtEventRequest);
        obj.app.get(url + 'webrelay.ashx', function (req, res) { res.send('Websocket connection expected'); });
        obj.app.ws(url + 'webrelay.ashx', handleRelayWebSocket);
        obj.app.ws(url + 'control.ashx', handleControlRequest);
        obj.app.get(url + 'meshagents', obj.handleMeshAgentRequest);
        obj.app.get(url + 'meshsettings', obj.handleMeshSettingsRequest);
        obj.app.get(url + 'downloadfile.ashx', handleDownloadFile);
        obj.app.post(url + 'uploadfile.ashx', handleUploadFile);
        obj.app.post(url + 'uploadmeshcorefile.ashx', handleUploadMeshCoreFile);
        obj.app.get(url + 'userfiles/*', handleDownloadUserFiles);
        obj.app.ws(url + 'echo.ashx', handleEchoWebSocket);
        obj.app.ws(url + 'meshrelay.ashx', function (ws, req) { try { obj.meshRelayHandler.CreateMeshRelay(obj, ws, req); } catch (e) { console.log(e); } });

        // Receive mesh agent connections
        obj.app.ws(url + 'agent.ashx', function (ws, req) { try { var domain = getDomain(req); obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (e) { console.log(e); } });
                
        obj.app.get(url + 'stop', function (req, res) { res.send('Stopping Server, <a href="' + url + '">click here to login</a>.'); setTimeout(function () { parent.Stop(); }, 500); });

        /*
        // DEBUG ONLY: Returns a mesh relay key
        obj.app.get(url + 'getkey', function (req, res) {
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain' });
            require('./meshrelay.js').CreateMeshRelayKey(obj, function (x) { res.send(x); });
        });
        */

        /*
        // Test
        obj.app.get(url + 'test.json', function (req, res) {
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain' });
            res.send('{ "glossary": { "title": "example glossary", "bob" : 5 } }');
        });
        */

        // Indicates to ExpressJS that the public folder should be used to serve static files.
        obj.app.use(url, obj.express.static(obj.path.join(__dirname, 'public')));
    }

    // Find a free port starting with the specified one and going up.
    function CheckListenPort(port, func) {
        var s = obj.net.createServer(function (socket) { });
        obj.tcpServer = s.listen(port, function () { s.close(function () { if (func) { func(port); } }); }).on('error', function (err) {
            if (args.exactports) { console.error('ERROR: MeshCentral HTTPS web server port ' + port + ' not available.'); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server
    function StartWebServer(port) {
        if (port == 0 || port == 65535) return;
        obj.args.port = port;
        if (obj.tlsServer != null) {
            if (obj.args.lanonly == true) {
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS web server running on port ' + port + '.'); });
            } else {
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS web server running on ' + certificates.CommonName + ':' + port + '.'); });
            }
        } else {
            obj.tcpServer = obj.app.listen(port, function () { console.log('MeshCentral HTTP web server running on port ' + port + '.'); });
        }
    }

    // Force mesh agent disconnection
    function forceMeshAgentDisconnect(user, domain, nodeid, disconnectMode) {
        if ((nodeid == undefined) || (nodeid == null)) return;
        var splitnode = nodeid.split('/');
        if ((splitnode.length != 3) || (splitnode[1] != domain.id)) return; // Check that nodeid is valid and part of our domain
        var agent = obj.wsagents[nodeid];
        if (agent == undefined) return;

        // Check we have agent rights
        var rights = user.links[agent.dbMeshKey].rights;
        if ((rights != undefined) && ((rights & 16) != 0) && (user.siteadmin == 0xFFFFFFFF)) { agent.close(disconnectMode); }
    }

    // Send the core module to the mesh agent
    function sendMeshAgentCore(user, domain, nodeid, core) {
        if ((nodeid == undefined) || (nodeid == null)) return;
        var splitnode = nodeid.split('/');
        if ((splitnode.length != 3) || (splitnode[1] != domain.id)) return; // Check that nodeid is valid and part of our domain
        var agent = obj.wsagents[nodeid];
        if (agent == undefined) return;

        // Check we have agent rights
        var rights = user.links[agent.dbMeshKey].rights;
        if ((rights != undefined) && ((rights & 16) != 0) && (user.siteadmin == 0xFFFFFFFF)) {
            if ((core == null) || (core == undefined)) {
                // Clear the mesh agent core
                agent.agentCoreCheck = 1000; // Tell the agent object we are not using a custom core.
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0));
            } else if (core == '*') {
                agent.agentCoreCheck = 0; // Tell the agent object we are using a default code
                // Reset the core to the server default
                agent.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else {
                agent.agentCoreCheck = 1000; // Tell the agent object we are not using a custom core.
                // Perform a SHA256 hash on the core module
                var buf = new Buffer(core, 'ascii');
                var hash = obj.crypto.createHash('sha256').update(buf).digest(), hash2 = "";
                for (var i = 0; i < hash.length; i++) { hash2 += String.fromCharCode(hash[i]); }

                // Send the code module to the agent
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + hash2 + core); // TODO: Add core encoding short
            }
        }
    }

    // Return the maximum number of bytes allowed in the user account "My Files".
    function getQuota(objid, domain) {
        if ((objid == undefined) || (objid == null)) return 0;
        if (objid.startsWith('user/')) {
            var user = obj.users[objid];
            if (user == undefined) return 0;
            if ((user.quota != undefined) && (typeof user.quota == 'number')) { return user.quota; }
            if ((domain != undefined) && (domain.userQuota != undefined) && (typeof domain.userQuota == 'number')) { return domain.userQuota; }
            return 1048576; // By default, the server will have a 1 meg limit on user accounts
        } else if (objid.startsWith('mesh/')) {
            var mesh = obj.meshes[objid];
            if (mesh == undefined) return 0;
            if ((mesh.quota != undefined) && (typeof mesh.quota == 'number')) { return mesh.quota; }
            if ((domain != undefined) && (domain.meshQuota != undefined) && (typeof domain.meshQuota == 'number')) { return domain.meshQuota; }
            return 1048576; // By default, the server will have a 1 meg limit on mesh accounts
        }
        return 0;
    }
    
    // Get the server path of a user or mesh object
    function getServerRootFilePath(obj) {
        if ((typeof obj != 'object') || (obj.domain == undefined) || (obj._id == undefined)) return null;
        var domainname = 'domain', splitname = obj._id.split('/');
        if (splitname.length != 3) return null;
        if (obj.domain !== '') domainname = 'domain-' + obj.domain;
        return obj.path.join(obj.filespath, domainname + "/" + splitname[0] + "-" + splitname[2]);
    }

    // Take a "user/domain/userid/path/file" format and return the actual server disk file path if access is allowed
    function getServerFilePath(user, domain, path) {
        var splitpath = path.split('/'), serverpath = obj.path.join(obj.filespath, 'domain'), filename = '';
        if ((splitpath.length < 3) || (splitpath[0] != 'user' && splitpath[0] != 'mesh') || (splitpath[1] != domain.id)) return null; // Basic validation
        var objid = splitpath[0] + '/' + splitpath[1] + '/' + splitpath[2];
        if (splitpath[0] == 'user' && (objid != user._id)) return null; // User validation, only self allowed
        if (splitpath[0] == 'mesh') { var link = user.links[objid]; if ((link == undefined) || (link.rights == undefined) || ((link.rights & 32) == 0)) { return null; } } // Check mesh server file rights
        if (splitpath[1] != '') { serverpath += '-' + splitpath[1]; } // Add the domain if needed
        serverpath += ('/' + splitpath[0] + '-' + splitpath[2]);
        for (var i = 3; i < splitpath.length; i++) { if (obj.common.IsFilenameValid(splitpath[i]) == true) { serverpath += '/' + splitpath[i]; filename = splitpath[i]; } else { return null; } } // Check that each folder is correct
        var fullpath = obj.path.resolve(obj.filespath, serverpath), quota = 0;
        return { fullpath: fullpath, path: serverpath, name: filename, quota: getQuota(objid, domain) };
    }
    
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
        } catch (e) { if (called == false) { func(null); } }
    }

    // Debug
    function Debug(lvl) {
        if (lvl > obj.parent.debugLevel) return;
        if (arguments.length == 2) { console.log(arguments[1]); }
        else if (arguments.length == 3) { console.log(arguments[1], arguments[2]); }
        else if (arguments.length == 4) { console.log(arguments[1], arguments[2], arguments[3]); }
        else if (arguments.length == 5) { console.log(arguments[1], arguments[2], arguments[3], arguments[4]); }
        else if (arguments.length == 6) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]); }
        else if (arguments.length == 7) { console.log(arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]); }
    }

    // Start server on a free port
    CheckListenPort(obj.args.port, StartWebServer);

    return obj;
}
