/**
* @description MeshCentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
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
    obj.updateBuffer = function (chunk) { this.push(chunk); };
    obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } else { console.err("Failed to fwd _write."); } if (callback) callback(); }; // Pass data written to forward
    obj._read = function (size) { }; // Push nothing, anything to read should be pushed from updateBuffer()
    return obj;
}

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Polyfill startsWith/endsWith for older NodeJS
if (!String.prototype.startsWith) { String.prototype.startsWith = function (searchString, position) { position = position || 0; return this.substr(position, searchString.length) === searchString; }; }
if (!String.prototype.endsWith) { String.prototype.endsWith = function (searchString, position) { var subjectString = this.toString(); if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; } position -= searchString.length; var lastIndex = subjectString.lastIndexOf(searchString, position); return lastIndex !== -1 && lastIndex === position; }; }

// Construct a HTTP web server object
module.exports.CreateWebServer = function (parent, db, args, certificates) {
    var obj = {}, i  = 0;

    // Modules
    obj.fs = require('fs');
    obj.net = require('net');
    obj.tls = require('tls');
    obj.path = require('path');
    obj.constants = require('constants');
    obj.bodyParser = require('body-parser');
    obj.session = require('cookie-session');
    obj.exphbs = require('express-handlebars');
    obj.crypto = require('crypto');
    obj.common = require('./common.js');
    obj.express = require('express');
    obj.meshAgentHandler = require('./meshagent.js');
    obj.meshRelayHandler = require('./meshrelay.js');
    obj.meshUserHandler = require('./meshuser.js');
    obj.interceptor = require('./interceptor');

    // Variables
    obj.parent = parent;
    obj.filespath = parent.filespath;
    obj.db = db;
    obj.app = obj.express();
    obj.app.use(require('compression')());
    obj.tlsServer = null;
    obj.tcpServer = null;
    obj.certificates = certificates;
    obj.args = args;
    obj.users = {};
    obj.meshes = {};
    obj.userAllowedIp = args.userallowedip;  // List of allowed IP addresses for users
    obj.tlsSniCredentials = null;
    obj.dnsDomains = {};
    //obj.agentConnCount = 0;

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 1;
    const MESHRIGHT_MANAGEUSERS = 2;
    const MESHRIGHT_MANAGECOMPUTERS = 4;
    const MESHRIGHT_REMOTECONTROL = 8;
    const MESHRIGHT_AGENTCONSOLE = 16;
    const MESHRIGHT_SERVERFILES = 32;
    const MESHRIGHT_WAKEDEVICE = 64;
    const MESHRIGHT_SETNOTES = 128;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 1;
    const SITERIGHT_MANAGEUSERS = 2;
    const SITERIGHT_SERVERRESTORE = 4;
    const SITERIGHT_FILEACCESS = 8;
    const SITERIGHT_SERVERUPDATE = 16;
    const SITERIGHT_LOCKED = 32;

    // Setup SSPI authentication if needed
    if ((obj.parent.platform == 'win32') && (obj.args.nousers != true) && (obj.parent.config != null) && (obj.parent.config.domains != null)) {
        for (i in obj.parent.config.domains) { if (obj.parent.config.domains[i].auth == 'sspi') { var nodeSSPI = require('node-sspi'); obj.parent.config.domains[i].sspi = new nodeSSPI({ retrieveGroups: true, offerBasic: false }); } }
    }

    // Perform hash on web certificate and agent certificate
    obj.webCertificateHash = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.web.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' });
    obj.webCertificateHashs = { '': obj.webCertificateHash };
    for (var i in obj.parent.config.domains) { if (obj.parent.config.domains[i].dns != null) { obj.webCertificateHashs[i] = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.parent.config.domains[i].certs.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' }); } }
    obj.webCertificateHashBase64 = new Buffer(parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.web.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' }), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.agentCertificateHashHex = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'hex' });
    obj.agentCertificateHashBase64 = new Buffer(parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.agent.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' }), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.agentCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();
    if (parent.certificates.swarmserver != null) {
        obj.swarmCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.swarmserver.cert))).getBytes();
        obj.swarmCertificateHash384 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' });
        obj.swarmCertificateHash256 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'binary' });
    }

    // Main lists    
    obj.wsagents = {};
    obj.wssessions = {};         // UserId --> Array Of Sessions
    obj.wssessions2 = {};        // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
    obj.wsPeerSessions = {};     // ServerId --> Array Of "UserId + SessionRnd"
    obj.wsPeerSessions2 = {};    // "UserId + SessionRnd" --> ServerId
    obj.wsPeerSessions3 = {};    // ServerId --> UserId --> [ SessionId ]
    obj.sessionsCount = {};      // Merged session counters, used when doing server peering. UserId --> SessionCount
    obj.wsrelays = {};           // Id -> Relay
    obj.wsPeerRelays = {};       // Id -> { ServerId, Time }

    // Setup randoms
    obj.crypto.randomBytes(48, function (err, buf) { obj.httpAuthRandom = buf; });
    obj.crypto.randomBytes(16, function (err, buf) { obj.httpAuthRealm = buf.toString('hex'); });
    obj.crypto.randomBytes(48, function (err, buf) { obj.relayRandom = buf; });

    // Setup DNS domain TLS SNI credentials
    {
        var dnscount = 0;
        obj.tlsSniCredentials = {};
        for (i in obj.certificates.dns) { if (obj.parent.config.domains[i].dns != null) { obj.dnsDomains[obj.parent.config.domains[i].dns.toLowerCase()] = obj.parent.config.domains[i]; obj.tlsSniCredentials[obj.parent.config.domains[i].dns] = obj.tls.createSecureContext(obj.certificates.dns[i]).context; dnscount++; } }
        if (dnscount > 0) { obj.tlsSniCredentials[''] = obj.tls.createSecureContext({ cert: obj.certificates.web.cert, key: obj.certificates.web.key, ca: obj.certificates.web.ca }).context; } else { obj.tlsSniCredentials = null; }
    }
    function TlsSniCallback(name, cb) { var c = obj.tlsSniCredentials[name]; if (c != null) { cb(null, c); } else { cb(null, obj.tlsSniCredentials['']); } }

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    if (obj.args.notls || obj.args.tlsoffload) {
        // Setup the HTTP server without TLS
        obj.expressWs = require('express-ws')(obj.app);
    } else {
        // Setup the HTTP server with TLS, use only TLS 1.2 and higher.
        var tlsOptions = { cert: obj.certificates.web.cert, key: obj.certificates.web.key, ca: obj.certificates.web.ca, rejectUnauthorized: true, secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE | obj.constants.SSL_OP_NO_TLSv1 | obj.constants.SSL_OP_NO_TLSv11 };
        if (obj.tlsSniCredentials != null) { tlsOptions.SNICallback = TlsSniCallback; } // We have multiple web server certificate used depending on the domain name
        obj.tlsServer = require('https').createServer(tlsOptions, obj.app);
        obj.expressWs = require('express-ws')(obj.app, obj.tlsServer);
    }

    // Setup middleware
    obj.app.engine('handlebars', obj.exphbs({})); // defaultLayout: 'main'
    obj.app.set('view engine', 'handlebars');
    obj.app.use(obj.bodyParser.urlencoded({ extended: false }));
    if (obj.args.sessiontime != null) {
        obj.app.use(obj.session({
            name: 'xid', // Recommanded security practice to not use the default cookie name
            httpOnly: true,
            keys: [obj.args.sessionkey], // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
            secure: (obj.args.notls != true), // Use this cookie only over TLS
            maxAge: (obj.args.sessiontime * 60 * 1000) // Number of minutes
        }));
    } else {
        obj.app.use(obj.session({
            name: 'xid', // Recommanded security practice to not use the default cookie name
            httpOnly: true,
            keys: [obj.args.sessionkey], // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
            secure: (obj.args.notls != true) // Use this cookie only over TLS
        }));
    }

    // Session-persisted message middleware
    obj.app.use(function (req, res, next) {
        var err = null, msg = null, passhint = null;
        if (req.session != null) {
            err = req.session.error;
            msg = req.session.success;
            passhint = req.session.passhint;
            delete req.session.error;
            delete req.session.success;
            delete req.session.passhint;
        }
        res.locals.message = '';
        if (err != null) res.locals.message = '<p class="msg error">' + err + '</p>';
        if (msg != null) res.locals.message = '<p class="msg success">' + msg + '</p>';
        if (passhint != null) res.locals.passhint = EscapeHtml(passhint);
        next();
    });

    // Fetch all users from the database, keep this in memory
    obj.db.GetAllType('user', function (err, docs) {
        var domainUserCount = {}, i = 0;
        for (i in parent.config.domains) { domainUserCount[i] = 0; }
        for (i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
        for (i in parent.config.domains) {
            if (domainUserCount[i] == 0) {
                if (parent.config.domains[i].newaccounts == 0) { parent.config.domains[i].newaccounts = 2; }
                console.log('Server ' + ((i == '') ? '' : (i + ' ')) + 'has no users, next new account will be site administrator.');
            }
        }
    });

    // Fetch all meshes from the database, keep this in memory
    obj.db.GetAllType('mesh', function (err, docs) { obj.common.unEscapeAllLinksFieldName(docs); for (var i in docs) { obj.meshes[docs[i]._id] = docs[i]; } });

    // Authenticate the user
    obj.authenticate = function (name, pass, domain, fn) {
        if (!module.parent) console.log('authenticating %s:%s:%s', domain.id, name, pass);
        var user = obj.users['user/' + domain.id + '/' + name.toLowerCase()];
        // Query the db for the given username
        if (!user) { fn(new Error('cannot find user')); return; }
        // Apply the same algorithm to the POSTed password, applying the hash against the pass / salt, if there is a match we found the user
        if (user.salt == null) {
            fn(new Error('invalid password'));
        } else {
            if (user.passtype != null) {
                // IIS default clear or weak password hashing (SHA-1)
                require('./pass').iishash(user.passtype, pass, user.salt, function (err, hash) {
                    if (err) return fn(err);
                    if (hash == user.hash) {
                        // Update the password to the stronger format.
                        require('./pass').hash(pass, function (err, salt, hash) { if (err) throw err; user.salt = salt; user.hash = hash; delete user.passtype; obj.db.SetUser(user); });
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                        return fn(null, user._id);
                    }
                    fn(new Error('invalid password'), null, user.passhint);
                });
            } else {
                // Default strong password hashing (pbkdf2 SHA384)
                require('./pass').hash(pass, user.salt, function (err, hash) {
                    if (err) return fn(err);
                    if (hash == user.hash) {
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                        return fn(null, user._id);
                    }
                    fn(new Error('invalid password'), null, user.passhint);
                });
            }
        }
    };

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
    };
    */

    // Check if the source IP address is allowed for a given allowed list, return false if not
    function checkUserIpAddressEx(req, res, allowedIpList) {
        if (allowedIpList == null) { return true; }
        try {
            var ip = null, type = 0;
            if (req.connection) { ip = req.connection.remoteAddress; type = 1; } // HTTP(S) request
            else if (req._socket) { ip = req._socket.remoteAddress; type = 2; } // WebSocket request
            if (ip.startsWith('::ffff:')) { ip = ip.substring(7); } // Fix IPv4 IP's encoded in IPv6 form
            if ((ip != null) && (allowedIpList.indexOf(ip) >= 0)) { return true; }
            if (type == 1) { res.sendStatus(401); }
            else if (type == 2) { try { req.close(); } catch (e) { } }
        } catch (e) { console.log(e); }
        return false;
    }

    // Check if the source IP address is allowed, return domain if allowed
    function checkUserIpAddress(req, res, rootonly) {
        if (obj.userAllowedIp != null) {
            if (typeof obj.userAllowedIp == 'string') { if (obj.userAllowedIp == "") { obj.userAllowedIp = null; return true; } else { obj.userAllowedIp = obj.userAllowedIp.split(','); } }
            if (checkUserIpAddressEx(req, res, obj.userAllowedIp) == false) return null;
        }
        if (rootonly == true) return;
        var domain;
        if (req.url) { domain = getDomain(req); } else { domain = getDomain(res); }
        if (domain.userallowedip == null) return domain;
        if (checkUserIpAddressEx(req, res, domain.userallowedip) == false) return null;
        return domain;
    }

    // Return the current domain of the request
    function getDomain(req) {
        if (req.xdomain != null) { return req.xdomain; } // Domain already set for this request, return it.
        if (req.headers.host != null) { var d = obj.dnsDomains[req.headers.host.toLowerCase()]; if (d != null) return d; } // If this is a DNS name domain, return it here.
        var x = req.url.split('/');
        if (x.length < 2) return parent.config.domains[''];
        var y = parent.config.domains[x[1].toLowerCase()];
        if ((y != null) && (y.dns == null)) return parent.config.domains[x[1].toLowerCase()];
        return parent.config.domains[''];
    }

    function handleLogoutRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        // Destroy the user's session to log them out will be re-created next request
        if (req.session.userid) {
            var user = obj.users[req.session.userid];
            obj.parent.DispatchEvent(['*'], obj, { etype: 'user', username: user.name, action: 'logout', msg: 'Account logout', domain: domain.id });
        }
        req.session = null;
        res.redirect(domain.url);
    }

    function handleLoginRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        obj.authenticate(req.body.username, req.body.password, domain, function (err, userid, passhint) {
            if (userid) {
                var user = obj.users[userid];

                // Save login time
                user.login = Date.now();
                obj.db.SetUser(user);


                // Regenerate session when signing in to prevent fixation
                //req.session.regenerate(function () {
                // Store the user's primary key in the session store to be retrieved, or in this case the entire user object
                // req.session.success = 'Authenticated as ' + user.name + 'click to <a href="/logout">logout</a>. You may now access <a href="/restricted">/restricted</a>.';
                delete req.session.loginmode;
                req.session.userid = userid;
                req.session.domainid = domain.id;
                req.session.currentNode = '';
                if (req.session.passhint) { delete req.session.passhint; }
                if (req.body.viewmode) { req.session.viewmode = req.body.viewmode; }
                if (req.body.host) {
                    // TODO: This is a terrible search!!! FIX THIS.
                    /*
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
                    */
                } else {
                    res.redirect(domain.url);
                }
                //});

                obj.parent.DispatchEvent(['*'], obj, { etype: 'user', username: user.name, action: 'login', msg: 'Account login', domain: domain.id });
            } else {
                delete req.session.loginmode;
                if (err == 'locked') { req.session.error = '<b style=color:#8C001A>Account locked.</b>'; } else { req.session.error = '<b style=color:#8C001A>Login failed, check username and password.</b>'; }
                if ((passhint != null) && (passhint.length > 0)) {
                    req.session.passhint = passhint;
                } else {
                    if (req.session.passhint) { delete req.session.passhint; }
                }
                res.redirect(domain.url);
            }
        });
    }

    function handleCreateAccountRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (domain.newaccounts == 0) { res.sendStatus(401); return; }
        if (!obj.common.validateUsername(req.body.username, 1, 64) || !obj.common.validateEmail(req.body.email, 1, 256) || !obj.common.validateString(req.body.password1, 1, 256) || !obj.common.validateString(req.body.password2, 1, 256) || (req.body.password1 != req.body.password2) || req.body.username == '~') {
            req.session.loginmode = 2;
            req.session.error = '<b style=color:#8C001A>Unable to create account.</b>';
            res.redirect(domain.url);
        } else {
            // Check if this email was already verified
            obj.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (err, docs) {
                if (docs.length > 0) {
                    req.session.loginmode = 2;
                    req.session.error = '<b style=color:#8C001A>Existing account with this email address.</b>';
                    res.redirect(domain.url);
                } else {
                    // Check if there is domain.newAccountToken, check if supplied token is valid
                    if ((domain.newaccountspass != null) && (domain.newaccountspass != '') && (req.body.anewaccountpass != domain.newaccountspass)) {
                        req.session.loginmode = 2;
                        req.session.error = '<b style=color:#8C001A>Invalid account creation token.</b>';
                        res.redirect(domain.url);
                        return;
                    }
                    // Check if user exists
                    if (obj.users['user/' + domain.id + '/' + req.body.username.toLowerCase()]) {
                        req.session.loginmode = 2;
                        req.session.error = '<b style=color:#8C001A>Username already exists.</b>';
                    } else {
                        var hint = req.body.apasswordhint;
                        if (hint.length > 250) hint = hint.substring(0, 250);
                        var user = { type: 'user', _id: 'user/' + domain.id + '/' + req.body.username.toLowerCase(), name: req.body.username, email: req.body.email, creation: Date.now(), login: Date.now(), domain: domain.id, passhint: hint };
                        var usercount = 0;
                        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                        if (usercount == 0) { user.siteadmin = 0xFFFFFFFF; if (domain.newaccounts == 2) { domain.newaccounts = 0; } } // If this is the first user, give the account site admin.
                        obj.users[user._id] = user;
                        req.session.userid = user._id;
                        req.session.domainid = domain.id;
                        // Create a user, generate a salt and hash the password
                        require('./pass').hash(req.body.password1, function (err, salt, hash) {
                            if (err) throw err;
                            user.salt = salt;
                            user.hash = hash;
                            obj.db.SetUser(user);
                            if (obj.parent.mailserver != null) { obj.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email); }
                        });
                        obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, account: user, action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id });
                    }
                    res.redirect(domain.url);
                }
            });
        }
    }

    // Called to process an account reset request
    function handleResetAccountRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (domain.newaccounts == 0) { res.sendStatus(401); return; }
        if (!req.body.email || checkEmail(req.body.email) == false) {
            req.session.loginmode = 3;
            req.session.error = '<b style=color:#8C001A>Invalid email.</b>';
            res.redirect(domain.url);
        } else {
            obj.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (err, docs) {
                if (docs.length == 0) {
                    req.session.loginmode = 3;
                    req.session.error = '<b style=color:#8C001A>Account not found.</b>';
                    res.redirect(domain.url);
                } else {
                    var userFound = docs[0];
                    if (obj.parent.mailserver != null) {
                        obj.parent.mailserver.sendAccountResetMail(domain, userFound.name, userFound.email);
                        req.session.loginmode = 1;
                        req.session.error = '<b style=color:darkgreen>Hold on, reset mail sent.</b>';
                        res.redirect(domain.url);
                    } else {
                        req.session.loginmode = 3;
                        req.session.error = '<b style=color:#8C001A>Unable to sent email.</b>';
                        res.redirect(domain.url);
                    }
                }
            });
        }
    }

    // Called to process a web based email verification request
    function handleCheckMailRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (req.query.c != null) {
            var cookie = obj.parent.decodeCookie(req.query.c, obj.parent.mailserver.mailCookieEncryptionKey, 30);
            if ((cookie != null) && (cookie.u != null) && (cookie.e != null)) {
                var idsplit = cookie.u.split('/');
                if ((idsplit.length != 2) || (idsplit[0] != domain.id)) {
                    res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'ERROR: Invalid domain. <a href="' + domain.url + '">Go to login page</a>.' });
                } else {
                    obj.db.Get('user/' + cookie.u, function (err, docs) {
                        if (docs.length == 0) {
                            res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'ERROR: Invalid username \"' + EscapeHtml(cookie.u) + '\". <a href="' + domain.url + '">Go to login page</a>.' });
                        } else {
                            var user = docs[0];
                            if (user.email != cookie.e) {
                                res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'ERROR: Invalid e-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\". <a href="' + domain.url + '">Go to login page</a>.' });
                            } else {
                                if (cookie.a == 1) {
                                    // Account email verification
                                    if (user.emailVerified == true) {
                                        res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'E-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\" already verified. <a href="' + domain.url + '">Go to login page</a>.' });
                                    } else {
                                        obj.db.GetUserWithVerifiedEmail(domain.id, user.email, function (err, docs) {
                                            if (docs.length > 0) {
                                                res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'E-mail \"' + EscapeHtml(user.email) + '\" already in use on a different account. Change the email address and try again. <a href="' + domain.url + '">Go to login page</a>.' });
                                            } else {
                                                // Set the verified flag
                                                obj.users[user._id].emailVerified = true;
                                                user.emailVerified = true;
                                                obj.db.SetUser(user);

                                                // Event the change
                                                var userinfo = obj.common.Clone(user);
                                                delete userinfo.hash;
                                                delete userinfo.passhint;
                                                delete userinfo.salt;
                                                delete userinfo.type;
                                                delete userinfo.domain;
                                                delete userinfo.subscriptions;
                                                delete userinfo.passtype;
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { etype: 'user', username: userinfo.name, account: userinfo, action: 'accountchange', msg: 'Verified email of user ' + EscapeHtml(user.name) + ' (' + EscapeHtml(userinfo.email) + ')', domain: domain.id });

                                                // Send the confirmation page
                                                res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'Verified email <b>' + EscapeHtml(user.email) + '</b> for user account <b>' + EscapeHtml(user.name) + '</b>. <a href="' + domain.url + '">Go to login page</a>.' });

                                                // Send a notification
                                                obj.parent.DispatchEvent([user._id], obj, { action: 'notify', value: 'Email verified:<br /><b>' + EscapeHtml(userinfo.email) + '</b>.', nolog: 1 });
                                            }
                                        });
                                    }
                                } else if (cookie.a == 2) {
                                    // Account reset
                                    if (user.emailVerified != true) {
                                        res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'E-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\" not verified. <a href="' + domain.url + '">Go to login page</a>.' });
                                    } else {
                                        // Set a temporary password
                                        obj.crypto.randomBytes(16, function (err, buf) {
                                            var newpass = buf.toString('base64').split('=').join('').split('/').join('');
                                            require('./pass').hash(newpass, function (err, salt, hash) {
                                                var userinfo = null;
                                                if (err) throw err;

                                                // Change the password
                                                userinfo = obj.users[user._id];
                                                userinfo.salt = salt;
                                                userinfo.hash = hash;
                                                userinfo.passchange = Date.now();
                                                userinfo.passhint = null;
                                                obj.db.SetUser(userinfo);

                                                // Event the change
                                                userinfo = obj.common.Clone(userinfo);
                                                delete userinfo.hash;
                                                delete userinfo.passhint;
                                                delete userinfo.salt;
                                                delete userinfo.type;
                                                delete userinfo.domain;
                                                delete userinfo.subscriptions;
                                                delete userinfo.passtype;
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { etype: 'user', username: userinfo.name, account: userinfo, action: 'accountchange', msg: 'Password reset for user ' + EscapeHtml(user.name), domain: domain.id });

                                                // Send the new password
                                                res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: '<div>Password for account <b>' + EscapeHtml(user.name) + '</b> has been reset to:</div><div style=padding:14px;font-size:18px><b>' + EscapeHtml(newpass) + '</b></div>Login and go to the \"My Account\" tab to update your password. <a href="' + domain.url + '">Go to login page</a>.' });
                                            });
                                        });
                                    }
                                } else {
                                    res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'ERROR: Invalid account check. <a href="' + domain.url + '">Go to login page</a>.' });
                                }
                            }
                        }
                    });
                }
            } else {
                res.render(obj.path.join(__dirname, 'views/message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', message: 'ERROR: Invalid account check, verification url is only valid for 30 minutes. <a href="' + domain.url + '">Go to login page</a>.' });
            }
        }
    }

    function handleDeleteAccountRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url); return; }
        var user = obj.users[req.session.userid];
        if (!user) return;

        // Check if the password is correct
        obj.authenticate(user.name, req.body.apassword1, domain, function (err, userid) {
            var user = obj.users[userid];
            if (user) {
                // Remove all the mesh links to this user
                if (user.links != null) {
                    for (var meshid in user.links) {
                        // Get the mesh
                        var mesh = obj.meshes[meshid];
                        if (mesh) {
                            // Remove user from the mesh
                            var escUserId = obj.common.escapeFieldName(userid);
                            if (mesh.links[escUserId] != null) { delete mesh.links[escUserId]; obj.db.Set(mesh); }
                            // Notify mesh change
                            var change = 'Removed user ' + user.name + ' from group ' + mesh.name;
                            obj.parent.DispatchEvent(['*', mesh._id, user._id, userid], obj, { etype: 'mesh', username: user.name, userid: userid, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id });
                        }
                    }
                }

                // Remove notes for this user
                obj.db.Remove('nt' + user._id);

                // Remove the user
                obj.db.Remove(user._id);
                delete obj.users[user._id];
                req.session = null;
                res.redirect(domain.url);
                obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
            } else {
                res.redirect(domain.url);
            }
        });
    }

    // Handle password changes
    function handlePasswordChangeRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url); return; }

        // Update the password
        require('./pass').hash(req.body.apassword1, function (err, salt, hash) {
            if (err) throw err;
            var hint = req.body.apasswordhint;
            if (hint.length > 250) hint = hint.substring(0, 250);
            var user = obj.users[req.session.userid];
            user.salt = salt;
            user.hash = hash;
            user.passchange = Date.now();
            user.passhint = req.body.apasswordhint;
            obj.db.SetUser(user);
            req.session.viewmode = 2;
            res.redirect(domain.url);
            obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id });
        });
    }

    // Indicates that any request to "/" should render "default" or "login" depending on login state
    function handleRootRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (!obj.args) { res.sendStatus(500); return; }

        if ((domain.sspi != null) && ((req.query.login == null) || (obj.parent.loginCookieEncryptionKey == null))) {
            // Login using SSPI
            domain.sspi.authenticate(req, res, function (err) { if ((err != null) || (req.connection.user == null)) { res.end('Authentication Required...'); } else { handleRootRequestEx(req, res, domain); } });
        } else {
            // Login using a different system
            handleRootRequestEx(req, res, domain);
        }
    }

    function handleRootRequestEx(req, res, domain) {
        var nologout = false, user = null, features = 0;
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });

        // Check if we have an incomplete domain name in the path
        if ((domain.id != '') && (domain.dns == null) && (req.url.split('/').length == 2)) { res.redirect(domain.url); return; }

        if (obj.args.nousers == true) {
            // If in single user mode, setup things here.
            if (req.session && req.session.loginmode) { delete req.session.loginmode; }
            req.session.userid = 'user/' + domain.id + '/~';
            req.session.domainid = domain.id;
            req.session.currentNode = '';
            if (obj.users[req.session.userid] == null) {
                // Create the dummy user ~ with impossible password
                obj.users[req.session.userid] = { type: 'user', _id: req.session.userid, name: '~', email: '~', domain: domain.id, siteadmin: 0xFFFFFFFF };
                obj.db.SetUser(obj.users[req.session.userid]);
            }
        } else if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
            // If a default user is active, setup the session here.
            if (req.session && req.session.loginmode) { delete req.session.loginmode; }
            req.session.userid = 'user/' + domain.id + '/' + obj.args.user.toLowerCase();
            req.session.domainid = domain.id;
            req.session.currentNode = '';
        } else if (req.query.login && (obj.parent.loginCookieEncryptionKey != null)) {
            var loginCookie = obj.parent.decodeCookie(req.query.login, obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
            if ((loginCookie != null) && (loginCookie.a == 3) && (loginCookie.u != null) && (loginCookie.u.split('/')[1] == domain.id)) {
                // If a login cookie was provided, setup the session here.
                if (req.session && req.session.loginmode) { delete req.session.loginmode; }
                req.session.userid = loginCookie.u;
                req.session.domainid = domain.id;
                req.session.currentNode = '';
            }
        } else if (domain.sspi != null) {
            // SSPI login (Windows only)
            //console.log(req.connection.user, req.connection.userSid);
            if ((req.connection.user == null) || (req.connection.userSid == null)) {
                res.sendStatus(404); return;
            } else {
                nologout = true;
                req.session.userid = 'user/' + domain.id + '/' + req.connection.user;
                req.session.usersid = req.connection.userSid;
                req.session.usersGroups = req.connection.userGroups;
                req.session.domainid = domain.id;
                req.session.currentNode = '';

                // Check if this user exists, create it if not.
                user = obj.users[req.session.userid];
                if ((user == null) || (user.sid != req.session.usersid)) {
                    // Create the domain user
                    var usercount = 0, user2 = { type: 'user', _id: req.session.userid, name: req.connection.user, domain: domain.id, sid: req.session.usersid };
                    for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                    if (usercount == 0) { user2.siteadmin = 0xFFFFFFFF; } // If this is the first user, give the account site admin.
                    obj.users[req.session.userid] = user2;
                    obj.db.SetUser(user2);
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: req.connection.user, account: user2, action: 'accountcreate', msg: 'Domain account created, user ' + req.connection.user, domain: domain.id });
                }
            }
        }

        // If a user is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid) {
            if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url); return; } // Check is the session is for the correct domain
            var viewmode = 1;
            if (req.session.viewmode) {
                viewmode = req.session.viewmode;
                delete req.session.viewmode;
            } else if (req.query.viewmode) {
                viewmode = req.query.viewmode;
            }
            var currentNode = '';
            if (req.session.currentNode) {
                currentNode = req.session.currentNode;
                delete req.session.currentNode;
            } else if (req.query.node) {
                currentNode = 'node/' + domain.id + '/' + req.query.node;
            }
            var logoutcontrol = '';
            if (obj.args.nousers != true) { logoutcontrol = 'Welcome ' + obj.users[req.session.userid].name + '.'; }

            // Give the web page a list of supported server features
            features = 0;
            user = obj.users[req.session.userid];
            if (obj.args.wanonly == true) { features += 1; } // WAN-only mode
            if (obj.args.lanonly == true) { features += 2; } // LAN-only mode
            if (obj.args.nousers == true) { features += 4; } // Single user mode
            if (domain.userQuota == -1) { features += 8; } // No server files mode
            if (obj.args.tlsoffload == true) { features += 16; } // No mutual-auth CIRA
            if ((parent.config != null) && (parent.config.settings != null) && (parent.config.settings.allowframing == true)) { features += 32; } // Allow site within iframe
            if ((obj.parent.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName != 'un-configured') && (obj.args.lanonly != true)) { features += 64; } // Email invites
            if (obj.args.webrtc == true) { features += 128; } // Enable WebRTC (Default false for now)
            if (obj.args.clickonce !== false) { features += 256; } // Enable ClickOnce (Default true)
            if (obj.args.allowhighqualitydesktop == true) { features += 512; } // Enable AllowHighQualityDesktop (Default false)
            if (obj.args.lanonly == true || obj.args.mpsport == 0) { features += 1024; } // No CIRA
            if ((obj.parent.serverSelfWriteAllowed == true) && (user != null) && (user.siteadmin == 0xFFFFFFFF)) { features += 2048; } // Server can self-write (Allows self-update)
            
            // Send the master web application
            if ((!obj.args.user) && (obj.args.nousers != true) && (nologout == false)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
            var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

            if (obj.args.minify && !req.query.nominify) {
                // Try to server the minified version if we can.
                try {
                    res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/default-mobile-min' : 'views/default-min'), { viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, webcerthash: obj.webCertificateHashBase64, footer: (domain.footer == null) ? '' : domain.footer });
                } catch (ex) {
                    // In case of an exception, serve the non-minified version.
                    res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/default-mobile' : 'views/default'), { viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, webcerthash: obj.webCertificateHashBase64, footer: (domain.footer == null) ? '' : domain.footer });
                }
            } else {
                // Serve non-minified version of web pages.
                res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/default-mobile' : 'views/default'), { viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, webcerthash: obj.webCertificateHashBase64, footer: (domain.footer == null) ? '' : domain.footer });
            }
        } else {
            // Send back the login application
            var loginmode = req.session.loginmode;
            features = 0;
            delete req.session.loginmode; // Clear this state, if the user hits refresh, we want to go back to the login page.
            if ((parent.config != null) && (parent.config.settings != null) && (parent.config.settings.allowframing == true)) { features += 32; } // Allow site within iframe
            var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

            if (obj.args.minify && !req.query.nominify) {
                // Try to server the minified version if we can.
                try {
                    res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/login-mobile-min' : 'views/login-min'), { loginmode: loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: domain.newaccounts, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: obj.parent.mailserver != null, features: features, sessiontime: args.sessiontime, footer: (domain.footer == null) ? '' : domain.footer });
                } catch (ex) {
                    // In case of an exception, serve the non-minified version.
                    res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/login-mobile' : 'views/login'), { loginmode: loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: domain.newaccounts, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: obj.parent.mailserver != null, features: features, sessiontime: args.sessiontime, footer: (domain.footer == null) ? '' : domain.footer });
                }
            } else {
                // Serve non-minified version of web pages.
                res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/login-mobile' : 'views/login'), { loginmode: loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: domain.newaccounts, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: obj.parent.mailserver != null, features: features, sessiontime: args.sessiontime, footer: (domain.footer == null) ? '' : domain.footer });
            }

            /*
            var xoptions = { loginmode: loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: domain.newaccounts, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: obj.parent.mailserver != null, features: features, footer: (domain.footer == null) ? '' : domain.footer };
            var xpath = obj.path.join(__dirname, isMobileBrowser(req) ? 'views/login-mobile' : 'views/login');
            console.log('Render...');
            res.render(xpath, xoptions, function (err, html) {
                console.log(err, html);
            });
            */
        }
    }

    // Get the link to the root certificate if needed
    function getRootCertLink() {
        // Check if the HTTPS certificate is issued from MeshCentralRoot, if so, add download link to root certificate.
        if ((obj.args.notls == null) && (obj.tlsSniCredentials == null) && (obj.certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0) && (obj.certificates.CommonName != 'un-configured')) { return '<a href=/MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>'; }
        return '';
    }

    // Renter the terms of service.
    function handleTermsRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        if (req.session && req.session.userid) {
            if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url); return; } // Check is the session is for the correct domain
            var user = obj.users[req.session.userid];
            res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/terms-mobile' : 'views/terms'), { title: domain.title, title2: domain.title2, logoutControl: 'Welcome ' + user.name + '. <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>' });
        } else {
            res.render(obj.path.join(__dirname, isMobileBrowser(req) ? 'views/terms-mobile' : 'views/terms'), { title: domain.title, title2: domain.title2 });
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
        if (checkUserIpAddress(req, res, true) == false) { return; }
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + certificates.RootName + '.cer' });
        res.send(new Buffer(getRootCertBase64(), 'base64'));
    }

    // Returns an mescript for Intel AMT configuration
    function handleMeScriptRequest(req, res) {
        if (checkUserIpAddress(req, res, true) == false) { return; }
        if (req.query.type == 1) {
            var filename = 'cira_setup.mescript';
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + filename });
            var serverNameSplit = obj.certificates.AmtMpsName.split('.');

            // Figure out the MPS port, use the alias if set
            var mpsport = ((obj.args.mpsaliasport != null) ? obj.args.mpsaliasport : obj.args.mpsport);

            if ((serverNameSplit.length == 4) && (parseInt(serverNameSplit[0]) == serverNameSplit[0]) && (parseInt(serverNameSplit[1]) == serverNameSplit[1]) && (parseInt(serverNameSplit[2]) == serverNameSplit[2]) && (parseInt(serverNameSplit[3]) == serverNameSplit[3])) {
                // Server name is an IPv4 address
                var filepath = obj.parent.path.join(__dirname, 'public/scripts/cira_setup_script_ip.mescript');
                readEntireTextFile(filepath, function (data) {
                    if (data == null) { res.sendStatus(404); return; }
                    var scriptFile = JSON.parse(data);

                    // Change a few things in the script
                    scriptFile.scriptBlocks[2].vars.CertBin.value = getRootCertBase64(); // Set the root certificate
                    scriptFile.scriptBlocks[3].vars.IP.value = obj.certificates.AmtMpsName; // Set the server IPv4 address name
                    scriptFile.scriptBlocks[3].vars.ServerName.value = obj.certificates.AmtMpsName; // Set the server certificate name
                    scriptFile.scriptBlocks[3].vars.Port.value = mpsport; // Set the server MPS port
                    scriptFile.scriptBlocks[3].vars.username.value = req.query.meshid; // Set the username
                    scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                    scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the primary server name:port to set periodic timer
                    //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the secondary server name:port to set periodic timer
                    if (obj.args.ciralocalfqdn != null) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                    // Compile the script
                    var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                    var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                    scriptFile.mescript = new Buffer(scriptEngine.script_compile(runscript), 'binary').toString('base64');
                    scriptFile.scriptText = runscript;

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
                    scriptFile.scriptBlocks[3].vars.FQDN.value = obj.certificates.AmtMpsName; // Set the server DNS name
                    scriptFile.scriptBlocks[3].vars.Port.value = mpsport; // Set the server MPS port
                    scriptFile.scriptBlocks[3].vars.username.value = req.query.meshid; // Set the username
                    scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                    scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the primary server name:port to set periodic timer
                    //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the secondary server name:port to set periodic timer
                    if (obj.args.ciralocalfqdn != null) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                    // Compile the script
                    var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                    var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                    scriptFile.mescript = new Buffer(scriptEngine.script_compile(runscript), 'binary').toString('base64');
                    scriptFile.scriptText = runscript;

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
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        var domainname = 'domain', spliturl = decodeURIComponent(req.path).split('/'), filename = '';
        if ((spliturl.length < 3) || (obj.common.IsFilenameValid(spliturl[2]) == false) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        if (domain.id != '') { domainname = 'domain-' + domain.id; }
        var path = obj.path.join(obj.filespath, domainname + "/user-" + spliturl[2] + "/Public");
        for (var i = 3; i < spliturl.length; i++) { if (obj.common.IsFilenameValid(spliturl[i]) == true) { path += '/' + spliturl[i]; filename = spliturl[i]; } else { res.sendStatus(404); return; } }

        var stat = null;
        try { stat = obj.fs.statSync(path); } catch (e) { }
        if ((stat != null) && ((stat.mode & 0x004000) == 0)) {
            if (req.query.download == 1) {
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=\"' + filename + '\"' });
                try { res.sendFile(obj.path.resolve(__dirname, path)); } catch (e) { res.sendStatus(404); }
            } else {
                res.render(obj.path.join(__dirname, 'views/download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, message: "<a href='" + req.path + "?download=1'>" + filename + "</a>, " + stat.size + " byte" + ((stat.size < 2) ? '' : 's') + "." });
            }
        } else {
            res.render(obj.path.join(__dirname, 'views/download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, message: "Invalid file link, please check the URL again." });
        }
    }

    // Take a "user/domain/userid/path/file" format and return the actual server disk file path if access is allowed
    obj.getServerFilePath = function (user, domain, path) {
        var splitpath = path.split('/'), serverpath = obj.path.join(obj.filespath, 'domain'), filename = '';
        if ((splitpath.length < 3) || (splitpath[0] != 'user' && splitpath[0] != 'mesh') || (splitpath[1] != domain.id)) return null; // Basic validation
        var objid = splitpath[0] + '/' + splitpath[1] + '/' + splitpath[2];
        if (splitpath[0] == 'user' && (objid != user._id)) return null; // User validation, only self allowed
        if (splitpath[0] == 'mesh') { var link = user.links[objid]; if ((link == null) || (link.rights == null) || ((link.rights & 32) == 0)) { return null; } } // Check mesh server file rights
        if (splitpath[1] != '') { serverpath += '-' + splitpath[1]; } // Add the domain if needed
        serverpath += ('/' + splitpath[0] + '-' + splitpath[2]);
        for (var i = 3; i < splitpath.length; i++) { if (obj.common.IsFilenameValid(splitpath[i]) == true) { serverpath += '/' + splitpath[i]; filename = splitpath[i]; } else { return null; } } // Check that each folder is correct
        return { fullpath: obj.path.resolve(obj.filespath, serverpath), path: serverpath, name: filename, quota: obj.getQuota(objid, domain) };
    };

    // Return the maximum number of bytes allowed in the user account "My Files".
    obj.getQuota = function (objid, domain) {
        if (objid == null) return 0;
        if (objid.startsWith('user/')) {
            var user = obj.users[objid];
            if (user == null) return 0;
            if (user.siteadmin == 0xFFFFFFFF) return null; // Administrators have no user limit
            if ((user.quota != null) && (typeof user.quota == 'number')) { return user.quota; }
            if ((domain != null) && (domain.userquota != null) && (typeof domain.userquota == 'number')) { return domain.userquota; }
            return null; // By default, the user will have no limit
        } else if (objid.startsWith('mesh/')) {
            var mesh = obj.meshes[objid];
            if (mesh == null) return 0;
            if ((mesh.quota != null) && (typeof mesh.quota == 'number')) { return mesh.quota; }
            if ((domain != null) && (domain.meshquota != null) && (typeof domain.meshquota == 'number')) { return domain.meshquota; }
            return null; // By default, the mesh will have no limit
        }
        return 0;
    };

    // Download a file from the server
    function handleDownloadFile(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((req.query.link == null) || (req.session == null) || (req.session.userid == null) || (domain == null) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        var user = obj.users[req.session.userid];
        if (user == null) { res.sendStatus(404); return; }
        var file = obj.getServerFilePath(user, domain, req.query.link);
        if (file == null) { res.sendStatus(404); return; }
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=\"' + file.name + '\"' });
        try { res.sendFile(file.fullpath); } catch (e) { res.sendStatus(404); }
    }

    // Upload a MeshCore.js file to the server
    function handleUploadMeshCoreFile(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if (user.siteadmin != 0xFFFFFFFF) { res.sendStatus(401); return; } // Check if we have mesh core upload rights (Full admin only)

        var multiparty = require('multiparty');
        var form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == null) || (fields.attrib == null) || (fields.attrib.length != 1)) { res.sendStatus(404); return; }
            for (var i in files.files) {
                var file = files.files[i];
                readEntireTextFile(file.path, function (data) {
                    if (data == null) return;
                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                    obj.sendMeshAgentCore(user, domain, fields.attrib[0], data); // Upload the core
                    try { obj.fs.unlinkSync(file.path); } catch (e) { }
                });
            }
            res.send('');
        });
    }

    // Upload a file to the server
    function handleUploadFile(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (domain.userQuota == -1)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if ((user.siteadmin & 8) == 0) { res.sendStatus(401); return; } // Check if we have file rights

        var multiparty = require('multiparty');
        var form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == null) || (fields.link == null) || (fields.link.length != 1)) { /*console.log('UploadFile, Invalid Fields:', fields, files);*/ res.sendStatus(404); return; }
            var xfile = obj.getServerFilePath(user, domain, decodeURIComponent(fields.link[0]));
            if (xfile == null) { res.sendStatus(404); return; }
            // Get total bytes in the path
            var totalsize = readTotalFileSize(xfile.fullpath);
            if ((xfile.quota == null) || (totalsize < xfile.quota)) { // Check if the quota is not already broken
                if (fields.name != null) {
                    // Upload method where all the file data is within the fields.
                    var names = fields.name[0].split('*'), sizes = fields.size[0].split('*'), types = fields.type[0].split('*'), datas = fields.data[0].split('*');
                    if ((names.length == sizes.length) && (types.length == datas.length) && (names.length == types.length)) {
                        for (var i = 0; i < names.length; i++) {
                            if (obj.common.IsFilenameValid(names[i]) == false) { res.sendStatus(404); return; }
                            var filedata = new Buffer(datas[i].split(',')[1], 'base64');
                            if ((xfile.quota == null) || ((totalsize + filedata.length) < xfile.quota)) { // Check if quota would not be broken if we add this file
                                // Create the user folder if needed
                                (function (fullpath, filename, filedata) {
                                    obj.fs.mkdir(xfile.fullpath, function () {
                                        // Write the file
                                        obj.fs.writeFile(obj.path.join(xfile.fullpath, filename), filedata, function () {
                                            obj.parent.DispatchEvent([user._id], obj, 'updatefiles'); // Fire an event causing this user to update this files
                                        });
                                    });
                                })(xfile.fullpath, names[i], filedata);
                            }
                        }
                    }
                } else {
                    // More typical upload method, the file data is in a multipart mime post.
                    for (var i in files.files) {
                        var file = files.files[i], fpath = obj.path.join(xfile.fullpath, file.originalFilename);
                        if (obj.common.IsFilenameValid(file.originalFilename) && ((xfile.quota == null) || ((totalsize + file.size) < xfile.quota))) { // Check if quota would not be broken if we add this file
                            obj.fs.rename(file.path, fpath, function () {
                                obj.parent.DispatchEvent([user._id], obj, 'updatefiles'); // Fire an event causing this user to update this files
                            });
                        } else {
                            try { obj.fs.unlink(file.path); } catch (e) { }
                        }
                    }
                }
            }
            res.send('');
        });
    }

    // Subscribe to all events we are allowed to receive
    obj.subscribe = function (userid, target) {
        var user = obj.users[userid];
        var subscriptions = [userid, 'server-global'];
        if (user.siteadmin != null) {
            if (user.siteadmin == 0xFFFFFFFF) subscriptions.push('*');
            if ((user.siteadmin & 2) != 0) subscriptions.push('server-users');
        }
        if (user.links != null) { for (var i in user.links) { subscriptions.push(i); } }
        obj.parent.RemoveAllEventDispatch(target);
        obj.parent.AddEventDispatch(subscriptions, target);
        return subscriptions;
    };

    // Handle a web socket relay request
    function handleRelayWebSocket(ws, req, domain, user, cookie) {
        if (!(req.query.host)) { console.log('ERR: No host target specified'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
        Debug(1, 'Websocket relay connected from ' + user.name + ' for ' + req.query.host + '.');

        try { ws._socket.setKeepAlive(true, 240000); } catch (ex) { }   // Set TCP keep alive

        // Fetch information about the target
        obj.db.Get(req.query.host, function (err, docs) {
            if (docs.length == 0) { console.log('ERR: Node not found'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
            var node = docs[0];
            if (!node.intelamt) { console.log('ERR: Not AMT node'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket

            // Check if this user has permission to manage this computer
            var meshlinks = user.links[node.meshid];
            if ((!meshlinks) || (!meshlinks.rights) || ((meshlinks.rights & MESHRIGHT_REMOTECONTROL) == 0)) { console.log('ERR: Access denied (2)'); try { ws.close(); } catch (e) { } return; }

            // Check what connectivity is available for this node
            var state = parent.GetConnectivityState(req.query.host);
            var conn = 0;
            if (!state || state.connectivity == 0) { Debug(1, 'ERR: No routing possible (1)'); try { ws.close(); } catch (e) { } return; } else { conn = state.connectivity; }

            // Check what server needs to handle this connection
            if ((obj.parent.multiServer != null) && (cookie == null)) { // If a cookie is provided, don't allow the connection to jump again to a different server
                var server = obj.parent.GetRoutingServerId(req.query.host, 2); // Check for Intel CIRA connection
                if (server != null) {
                    if (server.serverid != obj.parent.serverId) {
                        // Do local Intel CIRA routing using a different server
                        Debug(1, 'Route Intel AMT CIRA connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                } else {
                    server = obj.parent.GetRoutingServerId(req.query.host, 4); // Check for local Intel AMT connection
                    if ((server != null) && (server.serverid != obj.parent.serverId)) {
                        // Do local Intel AMT routing using a different server
                        Debug(1, 'Route Intel AMT direct connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                }
            }

            // If Intel AMT CIRA connection is available, use it
            if (((conn & 2) != 0) && (parent.mpsserver.ciraConnections[req.query.host] != null)) {
                Debug(1, 'Opening relay CIRA channel connection to ' + req.query.host + '.');

                var ciraconn = parent.mpsserver.ciraConnections[req.query.host];

                // Compute target port, look at the CIRA port mappings, if non-TLS is allowed, use that, if not use TLS
                var port = 16993;
                //if (node.intelamt.tls == 0) port = 16992; // DEBUG: Allow TLS flag to set TLS mode within CIRA
                if (ciraconn.tag.boundPorts.indexOf(16992) >= 0) port = 16992; // RELEASE: Always use non-TLS mode if available within CIRA
                if (req.query.p == 2) port += 2;

                // Setup a new CIRA channel
                if ((port == 16993) || (port == 16995)) {
                    // Perform TLS - ( TODO: THIS IS BROKEN on Intel AMT v7 but works on v10, Not sure why. Well, could be broken TLS 1.0 in firmware )
                    var ser = new SerialTunnel();
                    var chnl = parent.mpsserver.SetupCiraChannel(ciraconn, port);

                    // let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                    // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                    ser.forwardwrite = function (msg) {
                        // TLS ---> CIRA
                        chnl.write(msg.toString('binary'));
                    };

                    // When APF tunnel return something, update SerialTunnel buffer
                    chnl.onData = function (ciraconn, data) {
                        // CIRA ---> TLS
                        Debug(3, 'Relay TLS CIRA data', data.length);
                        if (data.length > 0) { try { ser.updateBuffer(Buffer.from(data, 'binary')); } catch (e) { } }
                    };

                    // Handle CIRA tunnel state change
                    chnl.onStateChange = function (ciraconn, state) {
                        Debug(2, 'Relay TLS CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                    };

                    // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                    var TLSSocket = require('tls').TLSSocket;
                    var tlsoptions = { secureProtocol: ((req.query.tls1only == 1) ? 'TLSv1_method' : 'SSLv23_method'), ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false, cert: obj.certificates.console.cert, key: obj.certificates.console.key };
                    var tlsock = new TLSSocket(ser, tlsoptions);
                    tlsock.on('error', function (err) { Debug(1, "CIRA TLS Connection Error ", err); });
                    tlsock.on('secureConnect', function () { Debug(2, "CIRA Secure TLS Connection"); ws.resume(); });

                    // Decrypted tunnel from TLS communcation to be forwarded to websocket
                    tlsock.on('data', function (data) {
                        // AMT/TLS ---> WS
                        try {
                            data = data.toString('binary');
                            if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                            //ws.send(Buffer.from(data, 'binary'));
                            ws.send(data);
                        } catch (e) { }
                    });

                    // If TLS is on, forward it through TLSSocket
                    ws.forwardclient = tlsock;
                    ws.forwardclient.xtls = 1;
                } else {
                    // Without TLS
                    ws.forwardclient = parent.mpsserver.SetupCiraChannel(ciraconn, port);
                    ws.forwardclient.xtls = 0;
                    ws.resume();
                }

                // When data is received from the web socket, forward the data into the associated CIRA cahnnel.
                // If the CIRA connection is pending, the CIRA channel has built-in buffering, so we are ok sending anyway.
                ws.on('message', function (msg) {
                    // WS ---> AMT/TLS
                    msg = msg.toString('binary');
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor
                    if (ws.forwardclient.xtls == 1) { ws.forwardclient.write(Buffer.from(msg, 'binary')); } else { ws.forwardclient.write(msg); }
                });

                // If error, do nothing
                ws.on('error', function (err) { console.log('WEBSERVER WSERR1: ' + err); });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function (req) {
                    Debug(1, 'Websocket relay closed.');
                    if (ws.forwardclient && ws.forwardclient.close) { ws.forwardclient.close(); } // TODO: If TLS is used, we need to close the socket that is wrapped by TLS
                });

                ws.forwardclient.onStateChange = function (ciraconn, state) {
                    Debug(2, 'Relay CIRA state change', state);
                    if (state == 0) { try { ws.close(); } catch (e) { } }
                };

                ws.forwardclient.onData = function (ciraconn, data) {
                    Debug(4, 'Relay CIRA data', data.length);
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    if (data.length > 0) { try { ws.send(new Buffer(data, 'binary')); } catch (e) { } } // TODO: Add TLS support
                };

                ws.forwardclient.onSendOk = function (ciraconn) {
                    // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                    //console.log('onSendOk');
                };

                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) {
                    Debug(3, 'INTERCEPTOR1', { host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                }
                else if (req.query.p == 2) {
                    Debug(3, 'INTERCEPTOR2', { user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                }

                return;
            }

            // If Intel AMT direct connection is possible, option a direct socket
            if ((conn & 4) != 0) {   // We got a new web socket connection, initiate a TCP connection to the target Intel AMT host/port.
                Debug(1, 'Opening relay TCP socket connection to ' + req.query.host + '.');

                // When data is received from the web socket, forward the data into the associated TCP connection.
                ws.on('message', function (msg) {
                    if (obj.parent.debugLevel >= 1) { // DEBUG
                        Debug(1, 'TCP relay data to ' + node.host + ', ' + msg.length + ' bytes');
                        if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + msg.toString('hex')); }
                    }
                    msg = msg.toString('binary');
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor
                    ws.forwardclient.write(new Buffer(msg, 'binary')); // Forward data to the associated TCP connection.
                });

                // If error, do nothing
                ws.on('error', function (err) { console.log('WEBSERVER WSERR2: ' + err); });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function (req) {
                    Debug(1, 'Closing relay web socket connection to ' + ws.upgradeReq.query.host + '.');
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }
                });

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
                    ws.resume();
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    var tlsoptions = { secureProtocol: ((req.query.tls1only == 1) ? 'TLSv1_method' : 'SSLv23_method'), ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false, cert: obj.certificates.console.cert, key: obj.certificates.console.key };
                    ws.forwardclient = obj.tls.connect(port, node.host, tlsoptions, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        Debug(2, 'TLS connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws.resume();
                    });
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                }

                // When we receive data on the TCP connection, forward it back into the web socket connection.
                ws.forwardclient.on('data', function (data) {
                    if (obj.parent.debugLevel >= 1) { // DEBUG
                        Debug(1, 'TCP relay data from ' + node.host + ', ' + data.length + ' bytes.');
                        if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + new Buffer(data, 'binary').toString('hex')); }
                    }
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    try { ws.send(new Buffer(data, 'binary')); } catch (e) { }
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
                    // A TCP connection to Intel AMT just connected, start forwarding.
                    ws.forwardclient.connect(port, node.host, function () {
                        Debug(1, 'TCP relay connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws.resume();
                    });
                }
                return;
            }

        });
    }

    // Handle the web socket echo request, just echo back the data sent
    function handleEchoWebSocket(ws, req) {
        var domain = checkUserIpAddress(ws, req);
        if (domain == null) return;
        ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive

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
        ws.on('error', function (err) { console.log('WEBSERVER WSERR3: ' + err); });

        // If closed, do nothing
        ws.on('close', function (req) { });
    }

    // Get the total size of all files in a folder and all sub-folders. (TODO: try to make all async version)
    function readTotalFileSize(path) {
        var r = 0, dir;
        try { dir = obj.fs.readdirSync(path); } catch (e) { return 0; }
        for (var i in dir) {
            var stat = obj.fs.statSync(path + '/' + dir[i]);
            if ((stat.mode & 0x004000) == 0) { r += stat.size; } else { r += readTotalFileSize(path + '/' + dir[i]); }
        }
        return r;
    }

    // Delete a folder and all sub items.  (TODO: try to make all async version)
    function deleteFolderRec(path) {
        if (obj.fs.existsSync(path) == false) return;
        obj.fs.readdirSync(path).forEach(function (file, index) {
            var pathx = path + "/" + file;
            if (obj.fs.lstatSync(pathx).isDirectory()) { deleteFolderRec(pathx); } else { obj.fs.unlinkSync(pathx); }
        });
        obj.fs.rmdirSync(path);
    }

    // Handle Intel AMT events
    // To subscribe, add "http://server:port/amtevents.ashx" to Intel AMT subscriptions.
    obj.handleAmtEventRequest = function (req, res) {
        var domain = getDomain(req);
        try {
            if (req.headers.authorization) {
                var authstr = req.headers.authorization;
                if (authstr.substring(0, 7) == "Digest ") {
                    var auth = obj.common.parseNameValueList(obj.common.quoteSplit(authstr.substring(7)));
                    if ((req.url === auth.uri) && (obj.httpAuthRealm === auth.realm) && (auth.opaque === obj.crypto.createHmac('SHA384', obj.httpAuthRandom).update(auth.nonce).digest('hex'))) {

                        // Read the data, we need to get the arg field
                        var eventData = '';
                        req.on('data', function (chunk) { eventData += chunk; });
                        req.on('end', function () {

                            // Completed event read, let get the argument that must contain the nodeid
                            var i = eventData.indexOf('<m:arg xmlns:m="http://x.com">');
                            if (i > 0) {
                                var nodeid = eventData.substring(i + 30, i + 30 + 64);
                                if (nodeid.length == 64) {
                                    var nodekey = 'node/' + domain.id + '/' + nodeid;

                                    // See if this node exists in the database
                                    obj.db.Get(nodekey, function (err, nodes) {
                                        if (nodes.length == 1) {
                                            // Yes, the node exists, compute Intel AMT digest password
                                            var node = nodes[0];
                                            var amtpass = obj.crypto.createHash('sha384').update(auth.username.toLowerCase() + ":" + nodeid + ":" + obj.parent.dbconfig.amtWsEventSecret).digest("base64").substring(0, 12).split("/").join("x").split("\\").join("x");

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
                                                        var event = { etype: 'node', action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Intel(R) AMT host change ' + node.name + ' from group ' + mesh.name + ': ' + oldname + ' to ' + amthost };
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
        obj.crypto.randomBytes(48, function (err, buf) {
            var nonce = buf.toString('hex'), opaque = obj.crypto.createHmac('SHA384', obj.httpAuthRandom).update(nonce).digest('hex');
            res.set({ 'WWW-Authenticate': 'Digest realm="' + obj.httpAuthRealm + '", qop="auth,auth-int", nonce="' + nonce + '", opaque="' + opaque + '"' });
            res.sendStatus(401);
        });
    };

    // Handle a server backup request
    function handleBackupRequest(req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
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
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
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
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true) && (req.session.userid == null)) { res.sendStatus(401); return; }

        if (req.query.id != null) {
            // Send a specific mesh agent back
            var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
            if (argentInfo == null) { res.sendStatus(404); return; }
            if ((req.query.meshid == null) || (argentInfo.platform != 'win32')) {
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + argentInfo.rname });
                res.sendFile(argentInfo.path);
            } else {
                // We are going to embed the .msh file into the Windows executable (signed or not).
                // First, fetch the mesh object to build the .msh file
                var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
                if (mesh == null) { res.sendStatus(401); return; }

                // If required, check if this user has rights to do this
                if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true)) {
                    var user = obj.users[req.session.userid];
                    var escUserId = obj.common.escapeFieldName(user._id);
                    if ((user == null) || (mesh.links[escUserId] == null) || ((mesh.links[escUserId].rights & 1) == 0)) { res.sendStatus(401); return; }
                    if (domain.id != mesh.domain) { res.sendStatus(401); return; }
                }

                var meshidhex = new Buffer(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var serveridhex = new Buffer(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

                // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                var xdomain = (domain.dns == null) ? domain.id : '';
                if (xdomain != '') xdomain += "/";
                var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
                if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local"; }
                if (req.query.tag != null) { meshsettings += "Tag=" + req.query.tag + "\r\n"; }
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + argentInfo.rname });
                obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: obj.parent.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: obj.parent.meshAgentBinaries[req.query.id].pe });
            }
        } else if (req.query.script != null) {
            // Send a specific mesh install script back
            var scriptInfo = obj.parent.meshAgentInstallScripts[req.query.script];
            if (scriptInfo == null) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=' + scriptInfo.rname });
            res.sendFile(scriptInfo.path);
        } else if (req.query.meshcmd != null) {
            // Send meshcmd for a specific platform back
            var agentid = parseInt(req.query.meshcmd);
            // If the agentid is 3 or 4, check if we have a signed MeshCmd.exe
            if ((agentid == 3)) { // Signed Windows MeshCmd.exe x86
                var stats = null, meshCmdPath = obj.path.join(__dirname, 'agents', 'MeshCmd-signed.exe');
                try { stats = obj.fs.statSync(meshCmdPath); } catch (e) { }
                if ((stats != null)) { res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=meshcmd' + ((req.query.meshcmd <= 3) ? '.exe' : '') }); res.sendFile(meshCmdPath); return; }
            } else if ((agentid == 4)) { // Signed Windows MeshCmd64.exe x64
                var stats = null, meshCmd64Path = obj.path.join(__dirname, 'agents', 'MeshCmd64-signed.exe');
                try { stats = obj.fs.statSync(meshCmd64Path); } catch (e) { }
                if ((stats != null)) { res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : '') }); res.sendFile(meshCmd64Path); return; }
            }
            // No signed agents, we are going to merge a new MeshCmd.
            if ((agentid < 10000) && (obj.parent.meshAgentBinaries[agentid + 10000] != null)) { agentid += 10000; } // Avoid merging javascript to a signed mesh agent.
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if ((argentInfo == null) || (obj.parent.defaultMeshCmd == null)) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : '') });
            res.statusCode = 200;
            if (argentInfo.signedMeshCmdPath != null) {
                // If we hav a pre-signed MeshCmd, send that.
                res.sendFile(argentInfo.signedMeshCmdPath);
            } else {
                // Merge JavaScript to a unsigned agent and send that.
                obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: new Buffer(obj.parent.defaultMeshCmd, 'utf8'), peinfo: argentInfo.pe });
            }
        } else if (req.query.meshaction != null) {
            var domain = checkUserIpAddress(req, res);
            if (domain == null) { res.sendStatus(404); return; }
            var user = obj.users[req.session.userid];
            if ((req.query.meshaction == 'route') && (req.query.nodeid != null)) {
                obj.db.Get(req.query.nodeid, function (err, nodes) {
                    if (nodes.length != 1) { res.sendStatus(401); return; }
                    var node = nodes[0];
                    // Create the meshaction.txt file for meshcmd.exe
                    var meshaction = {
                        action: req.query.meshaction,
                        localPort: 1234,
                        remoteName: node.name,
                        remoteNodeId: node._id,
                        remotePort: 3389,
                        username: '',
                        password: '',
                        serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                        serverHttpsHash: new Buffer(obj.webCertificateHash, 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                        debugLevel: 0
                    };
                    if (user != null) { meshaction.username = user.name; }
                    var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                    if (obj.args.lanonly != true) { meshaction.serverUrl = ((obj.args.notls == true) ? 'ws://' : 'wss://') + getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=meshaction.txt' });
                    res.send(JSON.stringify(meshaction, null, ' '));
                });
            }
            else if (req.query.meshaction == 'generic') {
                var meshaction = {
                    username: '',
                    password: '',
                    serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                    serverHttpsHash: new Buffer(obj.webCertificateHash, 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                    debugLevel: 0
                };
                if (user != null) { meshaction.username = user.name; }
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                if (obj.args.lanonly != true) { meshaction.serverUrl = ((obj.args.notls == true) ? 'ws://' : 'wss://') + getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=meshaction.txt' });
                res.send(JSON.stringify(meshaction, null, ' '));
            } else {
                res.sendStatus(401);
            }
        } else {
            // Send a list of available mesh agents
            var response = '<html><head><title>Mesh Agents</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body><table>';
            response += '<tr style="background-color:lightgray"><th>ID</th><th>Description</th><th>Link</th><th>Size</th><th>SHA384</th><th>MeshCmd</th></tr>';
            for (var agentid in obj.parent.meshAgentBinaries) {
                var agentinfo = obj.parent.meshAgentBinaries[agentid];
                response += '<tr><td>' + agentinfo.id + '</td><td>' + agentinfo.desc + '</td>';
                response += '<td><a target=_blank href="' + req.originalUrl + '?id=' + agentinfo.id + '">' + agentinfo.rname + '</a></td>';
                response += '<td>' + agentinfo.size + '</td><td>' + agentinfo.hash + '</td>';
                response += '<td><a target=_blank href="' + req.originalUrl + '?meshcmd=' + agentinfo.id + '">' + agentinfo.rname.replace('agent', 'cmd') + '</a></td></tr>';
            }
            response += '</table></body></html>';
            res.send(response);
        }
    };

    // Get the web server hostname. This may change if using a domain with a DNS name.
    function getWebServerName(domain) {
        if (domain.dns != null) return domain.dns;
        return obj.certificates.CommonName;
    }

    // Create a OSX mesh agent installer
    obj.handleMeshOsxAgentRequest = function (req, res) {
        var domain = checkUserIpAddress(req, res);
        if ((domain == null) || (req.query.id == null)) { res.sendStatus(404); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true) && (req.session.userid == null)) { res.sendStatus(401); return; }

        // Send a specific mesh agent back
        var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
        if ((argentInfo == null) || (req.query.meshid == null)) { res.sendStatus(404); return; }

        // We are going to embed the .msh file into the Windows executable (signed or not).
        // First, fetch the mesh object to build the .msh file
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
        if (mesh == null) { res.sendStatus(401); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true)) {
            var user = obj.users[req.session.userid];
            var escUserId = obj.common.escapeFieldName(user._id);
            if ((user == null) || (mesh.links[escUserId] == null) || ((mesh.links[escUserId].rights & 1) == 0)) { res.sendStatus(401); return; }
            if (domain.id != mesh.domain) { res.sendStatus(401); return; }
        }

        var meshidhex = new Buffer(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = new Buffer(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += "/";
        var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
        if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local"; }
        if (req.query.tag != null) { meshsettings += "Tag=" + req.query.tag + "\r\n"; }

        // Setup the response output
        var archive = require('archiver')('zip', { level: 5 }); // Sets the compression method.
        archive.on('error', function (err) { throw err; });
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename=MeshAgent-' + mesh.name + '.zip' });
        archive.pipe(res);

        // Opens the "MeshAgentOSXPackager.zip"
        var yauzl = require("yauzl");
        yauzl.open(obj.path.join(__dirname, 'agents', 'MeshAgentOSXPackager.zip'), { lazyEntries: true }, function (err, zipfile) {
            if (err) { res.sendStatus(500); return; }
            zipfile.readEntry();
            zipfile.on("entry", function (entry) {
                if (/\/$/.test(entry.fileName)) {
                    // Skip all folder entries
                    zipfile.readEntry();
                } else {
                    if (entry.fileName == 'Mesh Agent.mpkg/Contents/distribution.dist') {
                        // This is a special file entry, we need to fix it.
                        zipfile.openReadStream(entry, function (err, readStream) {
                            readStream.on("data", function (data) { if (readStream.xxdata) { readStream.xxdata += data; } else { readStream.xxdata = data; } });
                            readStream.on("end", function () {
                                var welcomemsg = 'Welcome to the MeshCentral agent for OSX\\\n\\\nThis installer will install the mesh agent for "' + mesh.name + '" and allow the administrator to remotely monitor and control this computer over the internet. For more information, go to info.meshcentral.com.\\\n\\\nThis software is provided under Apache 2.0 license.\\\n';
                                var installsize = Math.floor((argentInfo.size + meshsettings.length) / 1024);
                                archive.append(readStream.xxdata.toString().split('###WELCOMEMSG###').join(welcomemsg).split('###INSTALLSIZE###').join(installsize), { name: entry.fileName });
                                zipfile.readEntry();
                            });
                        });
                    } else {
                        // Normal file entry
                        zipfile.openReadStream(entry, function (err, readStream) {
                            if (err) { throw err; }
                            archive.append(readStream, { name: entry.fileName });
                            readStream.on('end', function () { zipfile.readEntry(); });
                        });
                    }
                }
            });
            zipfile.on("end", function () {
                archive.file(argentInfo.path, { name: "Mesh Agent.mpkg/Contents/Packages/meshagent.pkg/Contents/MeshAgent" });
                archive.append(meshsettings, { name: "Mesh Agent.mpkg/Contents/Packages/meshagent.pkg/Contents/MeshAgent.msh" });
                archive.finalize();
            });
        });
    }

    // Handle a request to download a mesh settings
    obj.handleMeshSettingsRequest = function (req, res) {
        var domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        //if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true) && (req.session.userid == null)) { res.sendStatus(401); return; }

        // Fetch the mesh object
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.id];
        if (mesh == null) { res.sendStatus(401); return; }

        // If needed, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true)) {
            var user = obj.users[req.session.userid];
            var escUserId = obj.common.escapeFieldName(user._id);
            if ((user == null) || (mesh.links[escUserId] == null) || ((mesh.links[escUserId].rights & 1) == 0)) { res.sendStatus(401); return; }
            if (domain.id != mesh.domain) { res.sendStatus(401); return; }
        }

        var meshidhex = new Buffer(req.query.id.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = new Buffer(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += "/";
        var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local"; }

        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=meshagent.msh' });
        res.send(meshsettings);
    };

    // Add HTTP security headers to all responses
    obj.app.use(function (req, res, next) {
        res.removeHeader("X-Powered-By");
        var domain = req.xdomain = getDomain(req);

        // Detect if this is a file sharing domain, if so, just share files.
        if ((domain != null) && (domain.share != null)) {
            var rpath;
            if (domain.dns == null) { rpath = req.url.split('/'); rpath.splice(1, 1); rpath = rpath.join('/'); } else { rpath = req.url; }
            if ((res.headers != null) && (res.headers.upgrade)) {
                // If this is a websocket, stop here.
                res.sendStatus(404);
            } else {
                // Check if the file exists, if so, serve it.
                obj.fs.exists(obj.path.join(domain.share, rpath), function (exists) { if (exists == true) { res.sendfile(rpath, { root: domain.share }); } else { res.sendStatus(404); } });
            }
        } else {
            // Two more headers to take a look at:
            //   'Public-Key-Pins': 'pin-sha256="X3pGTSOuJeEVw989IJ/cEtXUEmy52zs1TZQrU06KUKg="; max-age=10'
            //   'strict-transport-security': 'max-age=31536000; includeSubDomains'
            var headers = null;
            if (obj.args.notls) {
                // Default headers if no TLS is used
                headers = { 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src http: ws: data: 'self';script-src http: 'unsafe-inline';style-src http: 'unsafe-inline'" };
            } else {
                // Default headers if TLS is used
                headers = { 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src https: wss: data: 'self';script-src https: 'unsafe-inline';style-src https: 'unsafe-inline'" };
            }
            if (parent.config.settings.accesscontrolalloworigin != null) { headers['Access-Control-Allow-Origin'] = parent.config.settings.accesscontrolalloworigin; }
            res.set(headers);
            return next();
        }
    });

    // Setup all HTTP handlers
    obj.app.get('/backup.zip', handleBackupRequest);
    obj.app.post('/restoreserver.ashx', handleRestoreRequest);
    if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req); }); }
    for (var i in parent.config.domains) {
        if (parent.config.domains[i].dns != null) { continue; } // This is a subdomain with a DNS name, no added HTTP bindings needed.
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
        obj.app.post(url + 'resetaccount', handleResetAccountRequest);
        obj.app.get(url + 'checkmail', handleCheckMailRequest);
        obj.app.post(url + 'amtevents.ashx', obj.handleAmtEventRequest);
        obj.app.get(url + 'meshagents', obj.handleMeshAgentRequest);
        obj.app.get(url + 'meshosxagent', obj.handleMeshOsxAgentRequest);
        obj.app.get(url + 'meshsettings', obj.handleMeshSettingsRequest);
        obj.app.get(url + 'downloadfile.ashx', handleDownloadFile);
        obj.app.post(url + 'uploadfile.ashx', handleUploadFile);
        obj.app.post(url + 'uploadmeshcorefile.ashx', handleUploadMeshCoreFile);
        obj.app.get(url + 'userfiles/*', handleDownloadUserFiles);
        obj.app.ws(url + 'echo.ashx', handleEchoWebSocket);
        obj.app.ws(url + 'meshrelay.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie) { obj.meshRelayHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); }); });
        obj.app.get(url + 'webrelay.ashx', function (req, res) { res.send('Websocket connection expected'); });
        obj.app.ws(url + 'webrelay.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, handleRelayWebSocket); });
        obj.app.ws(url + 'control.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, function (ws1, req1, domain, user, cookie) { obj.meshUserHandler.CreateMeshUser(obj, obj.db, ws1, req1, obj.args, domain, user); }); });

        // Server picture
        obj.app.get(url + 'serverpic.ashx', function (req, res) {
            // Check if we have "server.png" in the data folder, if so, use that.
            var p = obj.path.join(obj.parent.datapath, 'server.png');
            if (obj.fs.existsSync(p)) {
                // Use the data folder server picture
                try { res.sendFile(p); } catch (e) { res.sendStatus(404); }
            } else {
                // Use the default server picture
                try { res.sendFile(obj.path.join(__dirname, 'public/images/server-200.png')); } catch (e) { res.sendStatus(404); }
            }
        });

        // Receive mesh agent connections
        obj.app.ws(url + 'agent.ashx', function (ws, req) {
            //console.log(++obj.agentConnCount);
            /*
            var ip, port, type;
            if (req.connection) { ip = req.connection.remoteAddress; port = req.connection.remotePort; type = 1; } // HTTP(S) request
            else if (req._socket) { ip = req._socket.remoteAddress; port = req._socket.remotePort; type = 2; } // WebSocket request
            console.log('AgentConnect', ip, port, type);
            */
            try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, getDomain(req)); } catch (e) { console.log(e); }
        });

        obj.app.get(url + 'stop', function (req, res) { res.send('Stopping Server, <a href="' + url + '">click here to login</a>.'); setTimeout(function () { parent.Stop(); }, 500); });

        // Indicates to ExpressJS that the public folder should be used to serve static files.
        obj.app.use(url, obj.express.static(obj.path.join(__dirname, 'public')));
    }

    // Authenticates a session and forwards
    function PerformWSSessionAuth(ws, req, noAuthOk, func) {
        try {
            // Hold this websocket until we are ready.
            ws.pause();

            // Check IP filtering and domain
            var domain = checkUserIpAddress(ws, req);
            if (domain == null) { try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth' })); ws.close(); return; } catch (e) { return; } }

            // A web socket session can be authenticated in many ways (Default user, session, user/pass and cookie). Check authentication here.
            if ((req.query.user != null) && (req.query.pass != null)) {
                // A user/pass is provided in URL arguments
                obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid) {
                    if ((err == null) && (obj.users[userid])) {
                        // We are authenticated
                        func(ws, req, domain, obj.users[userid]);
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            Debug(1, 'ERR: Websocket bad user/pass auth');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            } else if (req.query.auth != null) {
                // This is a encrypted cookie authentication
                var cookie = obj.parent.decodeCookie(req.query.auth, null, 60); // Cookie with 60 minute timeout
                if ((cookie != null) && (obj.users[cookie.userid])) {
                    // Valid cookie, we are authenticated
                    func(ws, req, domain, obj.users[cookie.userid], cookie);
                } else {
                    // This is a bad cookie
                    Debug(1, 'ERR: Websocket bad cookie auth: ' + req.query.auth);
                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth' })); ws.close(); } catch (e) { }
                }
                return;
            } else if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                // A default user is active
                func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                return;
            } else if (req.session && (req.session.userid != null) && (req.session.domainid == domain.id) && (obj.users[req.session.userid])) {
                // This user is logged in using the ExpressJS session
                func(ws, req, domain, obj.users[req.session.userid]);
                return;
            }

            if (noAuthOk != true) {
                // If not authenticated, close the websocket connection
                Debug(1, 'ERR: Websocket no auth');
                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth' })); ws.close(); } catch (e) { }
            } else {
                // Continue this session without user authentication,
                // this is expected if the agent is connecting for a tunnel.
                func(ws, req, domain, null);
            }
        } catch (e) { console.log(e); }
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
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS web server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
            } else {
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS web server running on ' + certificates.CommonName + ':' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
                obj.parent.updateServerState('servername', certificates.CommonName);
            }
            obj.parent.updateServerState('https-port', port);
            if (args.aliasport != null) { obj.parent.updateServerState('https-aliasport', args.aliasport); }
        } else {
            obj.tcpServer = obj.app.listen(port, function () { console.log('MeshCentral HTTP web server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
            obj.parent.updateServerState('http-port', port);
            if (args.aliasport != null) { obj.parent.updateServerState('http-aliasport', args.aliasport); }
        }
    }

    // Force mesh agent disconnection
    obj.forceMeshAgentDisconnect = function (user, domain, nodeid, disconnectMode) {
        if (nodeid == null) return;
        var splitnode = nodeid.split('/');
        if ((splitnode.length != 3) || (splitnode[1] != domain.id)) return; // Check that nodeid is valid and part of our domain
        var agent = obj.wsagents[nodeid];
        if (agent == null) return;

        // Check we have agent rights
        var rights = user.links[agent.dbMeshKey].rights;
        if ((rights != null) && ((rights & MESHRIGHT_AGENTCONSOLE) != 0) && (user.siteadmin == 0xFFFFFFFF)) { agent.close(disconnectMode); }
    };

    // Send the core module to the mesh agent
    obj.sendMeshAgentCore = function (user, domain, nodeid, core) {
        if (nodeid == null) return;
        var splitnode = nodeid.split('/');
        if ((splitnode.length != 3) || (splitnode[1] != domain.id)) return; // Check that nodeid is valid and part of our domain
        var agent = obj.wsagents[nodeid];
        if (agent == null) return;

        // Check we have agent rights
        var rights = user.links[agent.dbMeshKey].rights;
        if ((rights != null) && ((rights & MESHRIGHT_AGENTCONSOLE) != 0) && (user.siteadmin == 0xFFFFFFFF)) {
            if (core == null) {
                // Clear the mesh agent core
                agent.agentCoreCheck = 1000; // Tell the agent object we are not using a custom core.
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0));
            } else if (core == '*') {
                agent.agentCoreCheck = 0; // Tell the agent object we are using a default code
                // Reset the core to the server default
                agent.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else {
                agent.agentCoreCheck = 1000; // Tell the agent object we are not using a custom core.
                // Perform a SHA384 hash on the core module
                var hash = obj.crypto.createHash('sha384').update(new Buffer(core, 'binary')).digest().toString('binary');

                // Send the code module to the agent
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + hash + core);
            }
        }
    };

    // Get the server path of a user or mesh object
    function getServerRootFilePath(obj) {
        if ((typeof obj != 'object') || (obj.domain == null) || (obj._id == null)) return null;
        var domainname = 'domain', splitname = obj._id.split('/');
        if (splitname.length != 3) return null;
        if (obj.domain !== '') domainname = 'domain-' + obj.domain;
        return obj.path.join(obj.filespath, domainname + "/" + splitname[0] + "-" + splitname[2]);
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

    // Return true is the input string looks like an email address
    function checkEmail(str) {
        var x = str.split('@');
        var ok = ((x.length == 2) && (x[0].length > 0) && (x[1].split('.').length > 1) && (x[1].length > 2));
        if (ok == true) { var y = x[1].split('.'); for (var i in y) { if (y[i].length == 0) { ok = false; } } }
        return ok;
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

    /*
        obj.wssessions = {};         // UserId --> Array Of Sessions
        obj.wssessions2 = {};        // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
        obj.wsPeerSessions = {};     // ServerId --> Array Of "UserId + SessionRnd"
        obj.wsPeerSessions2 = {};    // "UserId + SessionRnd" --> ServerId
        obj.wsPeerSessions3 = {};    // ServerId --> UserId --> [ SessionId ]
    */

    // Count sessions and event any changes
    obj.recountSessions = function (changedSessionId) {
        var userid, oldcount, newcount, x, serverid;
        if (changedSessionId == null) {
            // Recount all sessions

            // Calculate the session count for all userid's
            var newSessionsCount = {};
            for (userid in obj.wssessions) { newSessionsCount[userid] = obj.wssessions[userid].length; }
            for (serverid in obj.wsPeerSessions3) {
                for (userid in obj.wsPeerSessions3[serverid]) {
                    x = obj.wsPeerSessions3[serverid][userid].length;
                    if (newSessionsCount[userid] == null) { newSessionsCount[userid] = x; } else { newSessionsCount[userid] += x; }
                }
            }

            // See what session counts have changed, event any changes
            for (userid in newSessionsCount) {
                newcount = newSessionsCount[userid];
                oldcount = obj.sessionsCount[userid];
                if (oldcount == null) { oldcount = 0; } else { delete obj.sessionsCount[userid]; }
                if (newcount != oldcount) {
                    x = userid.split('/');
                    obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                }
            }

            // If there are any counts left in the old counts, event to zero
            for (userid in obj.sessionsCount) {
                oldcount = obj.sessionsCount[userid];
                if ((oldcount != null) && (oldcount != 0)) {
                    x = userid.split('/');
                    obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: x[2], count: 0, domain: x[1], nolog: 1, nopeers: 1 });
                }
            }

            // Set the new session counts
            obj.sessionsCount = newSessionsCount;
        } else {
            // Figure out the userid
            userid = changedSessionId.split('/').slice(0, 3).join('/');

            // Recount only changedSessionId
            newcount = 0;
            if (obj.wssessions[userid] != null) { newcount = obj.wssessions[userid].length; }
            for (serverid in obj.wsPeerSessions3) { if (obj.wsPeerSessions3[serverid][userid] != null) { newcount += obj.wsPeerSessions3[serverid][userid].length; } }
            oldcount = obj.sessionsCount[userid];
            if (oldcount == null) { oldcount = 0; }

            // If the count changed, update and event
            if (newcount != oldcount) {
                x = userid.split('/');
                obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                obj.sessionsCount[userid] = newcount;
            }
        }
    };

    // Return true if a mobile browser is detected.
    // This code comes from "http://detectmobilebrowsers.com/" and was modified, This is free and unencumbered software released into the public domain. For more information, please refer to the http://unlicense.org/
    function isMobileBrowser(req) {
        //var ua = req.headers['user-agent'].toLowerCase();
        //return (/(android|bb\d+|meego).+mobile|mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(ua) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(ua.substr(0, 4)));
        if (typeof req.headers['user-agent'] != 'string') return false;
        return (req.headers['user-agent'].toLowerCase().indexOf('mobile') >= 0);
    }

    return obj;
};