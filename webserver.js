/**
* @description MeshCentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
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

// Construct a HTTP server object
module.exports.CreateWebServer = function (parent, db, args, certificates) {
    var obj = {}, i  = 0;

    // Modules
    obj.fs = require('fs');
    obj.net = require('net');
    obj.tls = require('tls');
    obj.path = require('path');
    obj.bodyParser = require('body-parser');
    obj.session = require('cookie-session');
    obj.exphbs = require('express-handlebars');
    obj.crypto = require('crypto');
    obj.common = require('./common.js');
    obj.express = require('express');
    obj.meshAgentHandler = require('./meshagent.js');
    obj.meshRelayHandler = require('./meshrelay.js');
    obj.meshIderHandler = require('./amt/amt-ider.js');
    obj.meshUserHandler = require('./meshuser.js');
    obj.interceptor = require('./interceptor');
    const constants = (obj.crypto.constants ? obj.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Setup WebAuthn / FIDO2
    obj.webauthn = require("./webauthn.js").CreateWebAuthnModule();

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
    obj.agentAllowedIp = args.agentallowedip;  // List of allowed IP addresses for agents
    obj.agentBlockedIp = args.agentblockedip;  // List of blocked IP addresses for agents
    obj.tlsSniCredentials = null;
    obj.dnsDomains = {};
    obj.relaySessionCount = 0;
    obj.relaySessionErrorCount = 0;

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
    obj.webCertificateHash = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.web.cert);
    obj.webCertificateHashs = { '': obj.webCertificateHash };
    obj.webCertificateHashBase64 = Buffer.from(obj.webCertificateHash, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.webCertificateFullHash = parent.certificateOperations.getCertHashBinary(obj.certificates.web.cert);
    obj.webCertificateFullHashs = { '': obj.webCertificateFullHash };
    obj.agentCertificateHashHex = parent.certificateOperations.getPublicKeyHash(obj.certificates.agent.cert);
    obj.agentCertificateHashBase64 = Buffer.from(obj.agentCertificateHashHex, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.agentCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();

    // Compute the hash of all of the web certificates for each domain
    for (var i in obj.parent.config.domains) {
        if (obj.parent.config.domains[i].certhash != null) {
            // If the web certificate hash is provided, use it.
            obj.webCertificateHashs[i] = obj.webCertificateFullHashs[i] = Buffer.from(obj.parent.config.domains[i].certhash, 'hex').toString('binary');
            if (obj.parent.config.domains[i].certkeyhash != null) { obj.webCertificateHashs[i] = Buffer.from(obj.parent.config.domains[i].certkeyhash, 'hex').toString('binary'); }
        } else if ((obj.parent.config.domains[i].dns != null) && (obj.parent.config.domains[i].certs != null)) {
            // If the domain has a different DNS name, use a different certificate hash.
            // Hash the full certificate
            obj.webCertificateFullHashs[i] = parent.certificateOperations.getCertHashBinary(obj.parent.config.domains[i].certs.cert);
            try {
                // Decode a RSA certificate and hash the public key.
                obj.webCertificateHashs[i] = parent.certificateOperations.getPublicKeyHashBinary(obj.parent.config.domains[i].certs.cert);
            } catch (ex) {
                // This may be a ECDSA certificate, hash the entire cert.
                obj.webCertificateHashs[i] = obj.webCertificateFullHashs[i];
            }
        } else if ((obj.parent.config.domains[i].dns != null) && (obj.certificates.dns[i] != null)) {
            // If this domain has a DNS and a matching DNS cert, use it. This case works for wildcard certs.
            obj.webCertificateFullHashs[i] = parent.certificateOperations.getCertHashBinary(obj.certificates.dns[i].cert);
            obj.webCertificateHashs[i] = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.dns[i].cert);
        } else if (i != '') {
            // For any other domain, use the default cert.
            obj.webCertificateFullHashs[i] = obj.webCertificateFullHashs[''];
            obj.webCertificateHashs[i] = obj.webCertificateHashs[''];
        }
    }

    // If we are running the legacy swarm server, compute the hash for that certificate
    if (parent.certificates.swarmserver != null) {
        obj.swarmCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.swarmserver.cert))).getBytes();
        obj.swarmCertificateHash384 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' });
        obj.swarmCertificateHash256 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'binary' });
    }

    // Main lists
    obj.wsagents = {};              // NodeId --> Agent
    obj.wsagentsDisconnections = {};
    obj.wsagentsDisconnectionsTimer = null;
    obj.duplicateAgentsLog = {};
    obj.wssessions = {};            // UserId --> Array Of Sessions
    obj.wssessions2 = {};           // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
    obj.wsPeerSessions = {};        // ServerId --> Array Of "UserId + SessionRnd"
    obj.wsPeerSessions2 = {};       // "UserId + SessionRnd" --> ServerId
    obj.wsPeerSessions3 = {};       // ServerId --> UserId --> [ SessionId ]
    obj.sessionsCount = {};         // Merged session counters, used when doing server peering. UserId --> SessionCount
    obj.wsrelays = {};              // Id -> Relay
    obj.wsPeerRelays = {};          // Id -> { ServerId, Time }
    var tlsSessionStore = {};       // Store TLS session information for quick resume.
    var tlsSessionStoreCount = 0;   // Number of cached TLS session information in store.

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
    function TlsSniCallback(name, cb) {
        var c = obj.tlsSniCredentials[name];
        if (c != null) {
            cb(null, c);
        } else {
            cb(null, obj.tlsSniCredentials['']);
        }
    }

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    // Fetch all users from the database, keep this in memory
    obj.db.GetAllType('user', function (err, docs) {
        var domainUserCount = {}, i = 0;
        for (i in parent.config.domains) { domainUserCount[i] = 0; }
        for (i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
        for (i in parent.config.domains) {
            if (domainUserCount[i] == 0) {
                // If newaccounts is set to no new accounts, but no accounts exists, temporarly allow account creation.
                //if ((parent.config.domains[i].newaccounts === 0) || (parent.config.domains[i].newaccounts === false)) { parent.config.domains[i].newaccounts = 2; }
                console.log('Server ' + ((i == '') ? '' : (i + ' ')) + 'has no users, next new account will be site administrator.');
            }
        }

        // Fetch all meshes from the database, keep this in memory
        obj.db.GetAllType('mesh', function (err, docs) {
            obj.common.unEscapeAllLinksFieldName(docs);
            for (var i in docs) {obj.meshes[docs[i]._id] = docs[i]; } // Get all meshes, including deleted ones.

            // We loaded the users and mesh state, start the server
            serverStart();
        });
    });

    // Return statistics about this web server
    obj.getStats = function () {
        return {
            users: Object.keys(obj.users).length,
            meshes: Object.keys(obj.meshes).length,
            dnsDomains: Object.keys(obj.dnsDomains).length,
            relaySessionCount: obj.relaySessionCount,
            relaySessionErrorCount: obj.relaySessionErrorCount,
            wsagents: Object.keys(obj.wsagents).length,
            wsagentsDisconnections: Object.keys(obj.wsagentsDisconnections).length,
            wsagentsDisconnectionsTimer: Object.keys(obj.wsagentsDisconnectionsTimer).length,
            wssessions: Object.keys(obj.wssessions).length,
            wssessions2: Object.keys(obj.wssessions2).length,
            wsPeerSessions: Object.keys(obj.wsPeerSessions).length,
            wsPeerSessions2: Object.keys(obj.wsPeerSessions2).length,
            wsPeerSessions3: Object.keys(obj.wsPeerSessions3).length,
            sessionsCount: Object.keys(obj.sessionsCount).length,
            wsrelays: Object.keys(obj.wsrelays).length,
            wsPeerRelays: Object.keys(obj.wsPeerRelays).length,
            tlsSessionStore: Object.keys(tlsSessionStore).length
        };
    }

    // Agent counters
    obj.agentStats = {
        createMeshAgentCount: 0,
        agentClose: 0,
        agentBinaryUpdate: 0,
        coreIsStableCount: 0,
        verifiedAgentConnectionCount: 0,
        clearingCoreCount: 0,
        updatingCoreCount: 0,
        recoveryCoreIsStableCount: 0,
        meshDoesNotExistCount: 0,
        invalidPkcsSignatureCount: 0,
        invalidRsaSignatureCount: 0,
        invalidJsonCount: 0,
        unknownAgentActionCount: 0,
        agentBadWebCertHashCount: 0,
        agentBadSignature1Count: 0,
        agentBadSignature2Count: 0,
        agentMaxSessionHoldCount: 0,
        invalidDomainMeshCount: 0,
        invalidMeshTypeCount: 0,
        invalidDomainMesh2Count: 0,
        invalidMeshType2Count: 0,
        duplicateAgentCount: 0,
        maxDomainDevicesReached: 0
    }
    obj.getAgentStats = function () { return obj.agentStats; }

    // Authenticate the user
    obj.authenticate = function (name, pass, domain, fn) {
        if ((typeof (name) != 'string') || (typeof (pass) != 'string') || (typeof (domain) != 'object')) { fn(new Error('invalid fields')); return; }
        if (!module.parent) console.log('authenticating %s:%s:%s', domain.id, name, pass);

        if (domain.auth == 'ldap') {
            if (domain.ldapoptions.url == 'test') {
                // Fake LDAP login
                var xxuser = domain.ldapoptions[name.toLowerCase()];
                if (xxuser == null) {
                    fn(new Error('invalid password'));
                    return;
                } else {
                    var username = xxuser['displayName'];
                    if (domain.ldapusername) { username = xxuser[domain.ldapusername]; }
                    var shortname = null;
                    if (domain.ldapuserbinarykey) {
                        // Use a binary key as the userid
                        if (xxuser[domain.ldapuserbinarykey]) { shortname = Buffer.from(xxuser[domain.ldapuserbinarykey], 'binary').toString('hex'); }
                    } else if (domain.ldapuserkey) {
                        // Use a string key as the userid
                        if (xxuser[domain.ldapuserkey]) { shortname = xxuser[domain.ldapuserkey]; }
                    } else {
                        // Use the default key as the userid
                        if (xxuser.objectSid) { shortname = Buffer.from(xxuser.objectSid, 'binary').toString('hex').toLowerCase(); }
                        else if (xxuser.objectGUID) { shortname = Buffer.from(xxuser.objectGUID, 'binary').toString('hex').toLowerCase(); }
                        else if (xxuser.name) { shortname = xxuser.name; }
                        else if (xxuser.cn) { shortname = xxuser.cn; }
                    }
                    if (username == null) { fn(new Error('no user name')); return; }
                    if (shortname == null) { fn(new Error('no user identifier')); return; }
                    var userid = 'user/' + domain.id + '/' + shortname;
                    var user = obj.users[userid];

                    if (user == null) {
                        // Create a new user
                        var user = { type: 'user', _id: userid, name: username, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), domain: domain.id };
                        if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                        var usercount = 0;
                        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                        if (usercount == 0) { user.siteadmin = 0xFFFFFFFF; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.
                        obj.users[user._id] = user;
                        obj.db.SetUser(user);
                        var event = { etype: 'user', userid: userid, username: username, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, name is ' + name, domain: domain.id };
                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                        obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                        return fn(null, user._id);
                    } else {
                        // This is an existing user
                        // If the display username has changes, update it.
                        if (user.name != username) {
                            user.name = username;
                            obj.db.SetUser(user);
                            var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Changed account display name to ' + username, domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
                        }
                        // If user is locker out, block here.
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                        return fn(null, user._id);
                    }
                }
            } else {
                // LDAP login
                var LdapAuth = require('ldapauth-fork');
                var ldap = new LdapAuth(domain.ldapoptions);
                ldap.authenticate(name, pass, function (err, xxuser) {
                    try { ldap.close(); } catch (ex) { console.log(ex); } // Close the LDAP object
                    if (err) { fn(new Error('invalid password')); return; }
                    var shortname = null;
                    var username = xxuser['displayName'];
                    if (domain.ldapusername) { username = xxuser[domain.ldapusername]; }
                    if (domain.ldapuserbinarykey) {
                        // Use a binary key as the userid
                        if (xxuser[domain.ldapuserbinarykey]) { shortname = Buffer.from(xxuser[domain.ldapuserbinarykey], 'binary').toString('hex').toLowerCase(); }
                    } else if (domain.ldapuserkey) {
                        // Use a string key as the userid
                        if (xxuser[domain.ldapuserkey]) { shortname = xxuser[domain.ldapuserkey]; }
                    } else {
                        // Use the default key as the userid
                        if (xxuser.objectSid) { shortname = Buffer.from(xxuser.objectSid, 'binary').toString('hex').toLowerCase(); }
                        else if (xxuser.objectGUID) { shortname = Buffer.from(xxuser.objectGUID, 'binary').toString('hex').toLowerCase(); }
                        else if (xxuser.name) { shortname = xxuser.name; }
                        else if (xxuser.cn) { shortname = xxuser.cn; }
                    }
                    if (username == null) { fn(new Error('no user name')); return; }
                    if (shortname == null) { fn(new Error('no user identifier')); return; }
                    var userid = 'user/' + domain.id + '/' + shortname;
                    var user = obj.users[userid];

                    if (user == null) {
                        // This user does not exist, create a new account.
                        var user = { type: 'user', _id: userid, name: shortname, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), domain: domain.id };
                        if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                        var usercount = 0;
                        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                        if (usercount == 0) { user.siteadmin = 0xFFFFFFFF; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.
                        obj.users[user._id] = user;
                        obj.db.SetUser(user);
                        var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, name is ' + name, domain: domain.id };
                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                        obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                        return fn(null, user._id);
                    } else {
                        // This is an existing user
                        // If the display username has changes, update it.
                        if (user.name != username) {
                            user.name = username;
                            obj.db.SetUser(user);
                            var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Changed account display name to ' + username, domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
                        }
                        // If user is locker out, block here.
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                        return fn(null, user._id);
                    }
                });
            }
        } else {
            // Regular login
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
                            require('./pass').hash(pass, function (err, salt, hash, tag) { if (err) throw err; user.salt = salt; user.hash = hash; delete user.passtype; obj.db.SetUser(user); }, 0);
                            if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                            return fn(null, user._id);
                        }
                        fn(new Error('invalid password'), null, user.passhint);
                    });
                } else {
                    // Default strong password hashing (pbkdf2 SHA384)
                    require('./pass').hash(pass, user.salt, function (err, hash, tag) {
                        if (err) return fn(err);
                        if (hash == user.hash) {
                            if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                            return fn(null, user._id);
                        }
                        fn(new Error('invalid password'), null, user.passhint);
                    }, 0);
                }
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

    // Check if the source IP address is in the IP list, return false if not.
    function checkIpAddressEx(req, res, ipList, closeIfThis) {
        try {
            var ip;
            if (req.connection) { // HTTP(S) request
                ip = req.ip;
                if (ip) { for (var i = 0; i < ipList.length; i++) { if (require('ipcheck').match(ip, ipList[i])) { if (closeIfThis === true) { res.sendStatus(401); } return true; } } }
                if (closeIfThis === false) { res.sendStatus(401); }
            } else if (req._socket) { // WebSocket request
                ip = req._socket.remoteAddress;

                // If a trusted reverse-proxy is sending us the remote IP address, use it.
                // This is not done automatically for web socket like it's done for HTTP requests.
                if ((obj.args.tlsoffload) && (res.headers['x-forwarded-for']) && ((obj.args.tlsoffload === true) || (obj.args.tlsoffload === ip) || (('::ffff:') + obj.args.tlsoffload === ip))) { ip = res.headers['x-forwarded-for']; }

                if (ip) { for (var i = 0; i < ipList.length; i++) { if (require('ipcheck').match(ip, ipList[i])) { if (closeIfThis === true) { try { req.close(); } catch (e) { } } return true; } } }
                if (closeIfThis === false) { try { req.close(); } catch (e) { } }
            } 
        } catch (e) { console.log(e); } // Should never happen
        return false;
    }

    // Check if the source IP address is allowed, return domain if allowed
    function checkUserIpAddress(req, res) {
        if ((obj.userBlockedIp != null) && (checkIpAddressEx(req, res, obj.userBlockedIp, true) == true)) { return null; }
        if ((obj.userAllowedIp != null) && (checkIpAddressEx(req, res, obj.userAllowedIp, false) == false)) { return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if ((domain.userblockedip != null) && (checkIpAddressEx(req, res, domain.userblockedip, true) == true)) { return null; }
        if ((domain.userallowedip != null) && (checkIpAddressEx(req, res, domain.userallowedip, false) == false)) { return null; }
        return domain;
    }

    // Check if the source IP address is allowed, return domain if allowed
    function checkAgentIpAddress(req, res) {
        if ((obj.agentBlockedIp != null) && (checkIpAddressEx(req, res, obj.agentBlockedIp, null) == true)) { return null; }
        if ((obj.agentAllowedIp != null) && (checkIpAddressEx(req, res, obj.agentAllowedIp, null) == false)) { return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if ((domain.agentblockedip != null) && (checkIpAddressEx(req, res, domain.agentblockedip, null) == true)) { return null; }
        if ((domain.agentallowedip != null) && (checkIpAddressEx(req, res, domain.agentallowedip, null) == false)) { return null; }
        return domain;
    }

    // Return the current domain of the request
    function getDomain(req) {
        if (req.xdomain != null) { return req.xdomain; } // Domain already set for this request, return it.
        if (req.headers.host != null) { var d = obj.dnsDomains[req.headers.host.toLowerCase()]; if (d != null) return d; } // If this is a DNS name domain, return it here.
        var x = req.url.split('/');
        if (x.length < 2) return parent.config.domains[''];
        var y = parent.config.domains[x[1].toLowerCase()];
        if ((y != null) && (y.dns == null)) { return parent.config.domains[x[1].toLowerCase()]; }
        return parent.config.domains[''];
    }

    function handleLogoutRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi')) { res.sendStatus(404); return; }

        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        // Destroy the user's session to log them out will be re-created next request
        if (req.session.userid) {
            var user = obj.users[req.session.userid];
            if (user != null) { obj.parent.DispatchEvent(['*'], obj, { etype: 'user', username: user.name, action: 'logout', msg: 'Account logout', domain: domain.id }); }
        }
        req.session = null;
        res.redirect(domain.url);
    }

    // Return true if this user has 2-step auth active
    function checkUserOneTimePasswordRequired(domain, user) {
        return ((parent.config.settings.no2factorauth !== true) && ((user.otpsecret != null) || ((user.otphkeys != null) && (user.otphkeys.length > 0))));
    }

    // Check the 2-step auth token
    function checkUserOneTimePassword(req, domain, user, token, hwtoken, func) {
        const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (parent.config.settings.no2factorauth !== true));
        if (twoStepLoginSupported == false) { func(true); return; };

        // Check hardware key
        if (user.otphkeys && (user.otphkeys.length > 0) && (typeof (hwtoken) == 'string') && (hwtoken.length > 0)) {
            var authResponse = null;
            try { authResponse = JSON.parse(hwtoken); } catch (ex) { }
            if ((authResponse != null) && (authResponse.clientDataJSON)) {
                // Get all WebAuthn keys
                var webAuthnKeys = [];
                for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type == 3) { webAuthnKeys.push(user.otphkeys[i]); } }
                if (webAuthnKeys.length > 0) {
                    // Decode authentication response
                    var clientAssertionResponse = { response: {} };
                    clientAssertionResponse.id = authResponse.id;
                    clientAssertionResponse.rawId = Buffer.from(authResponse.id, 'base64');
                    clientAssertionResponse.response.authenticatorData = Buffer.from(authResponse.authenticatorData, 'base64');
                    clientAssertionResponse.response.clientDataJSON = Buffer.from(authResponse.clientDataJSON, 'base64');
                    clientAssertionResponse.response.signature = Buffer.from(authResponse.signature, 'base64');
                    clientAssertionResponse.response.userHandle = Buffer.from(authResponse.userHandle, 'base64');

                    // Look for the key with clientAssertionResponse.id
                    var webAuthnKey = null;
                    for (var i = 0; i < webAuthnKeys.length; i++) { if (webAuthnKeys[i].keyId == clientAssertionResponse.id) { webAuthnKey = webAuthnKeys[i]; } }

                    // If we found a valid key to use, let's validate the response
                    if (webAuthnKey != null) {
                        // Figure out the origin
                        var httpport = ((args.aliasport != null) ? args.aliasport : args.port);
                        var origin = "https://" + (domain.dns ? domain.dns : parent.certificates.CommonName);
                        if (httpport != 443) { origin += ':' + httpport; }

                        var assertionExpectations = {
                            challenge: req.session.u2fchallenge,
                            origin: origin,
                            factor: "either",
                            fmt: "fido-u2f",
                            publicKey: webAuthnKey.publicKey,
                            prevCounter: webAuthnKey.counter,
                            userHandle: Buffer(user._id, 'binary').toString('base64')
                        };

                        var webauthnResponse = null;
                        try { webauthnResponse = obj.webauthn.verifyAuthenticatorAssertionResponse(clientAssertionResponse.response, assertionExpectations); } catch (ex) { console.log(ex); }
                        if ((webauthnResponse != null) && (webauthnResponse.verified === true)) {
                            // Update the hardware key counter and accept the 2nd factor
                            webAuthnKey.counter = webauthnResponse.counter;
                            obj.db.SetUser(user);
                            func(true);
                        } else {
                            func(false);
                        }
                        return;
                    }
                }
            }
        }

        // Check Google Authenticator
        const otplib = require('otplib')
        otplib.authenticator.options = { window: 2 }; // Set +/- 1 minute window
        if (user.otpsecret && (typeof (token) == 'string') && (token.length == 6) && (otplib.authenticator.check(token, user.otpsecret) == true)) { func(true); return; };

        // Check written down keys
        if ((user.otpkeys != null) && (user.otpkeys.keys != null) && (typeof (token) == 'string') && (token.length == 8)) {
            var tokenNumber = parseInt(token);
            for (var i = 0; i < user.otpkeys.keys.length; i++) { if ((tokenNumber === user.otpkeys.keys[i].p) && (user.otpkeys.keys[i].u === true)) { user.otpkeys.keys[i].u = false; func(true); return; } }
        }

        // Check OTP hardware key
        if ((domain.yubikey != null) && (domain.yubikey.id != null) && (domain.yubikey.secret != null) && (user.otphkeys != null) && (user.otphkeys.length > 0) && (typeof (token) == 'string') && (token.length == 44)) {
            var keyId = token.substring(0, 12);

            // Find a matching OTP key
            var match = false;
            for (var i = 0; i < user.otphkeys.length; i++) { if ((user.otphkeys[i].type === 2) && (user.otphkeys[i].keyid === keyId)) { match = true; } }

            // If we have a match, check the OTP
            if (match === true) {
                var yubikeyotp = require('yubikeyotp');
                var request = { otp: token, id: domain.yubikey.id, key: domain.yubikey.secret, timestamp: true }
                if (domain.yubikey.proxy) { request.requestParams = { proxy: domain.yubikey.proxy }; }
                yubikeyotp.verifyOTP(request, function (err, results) { func(results.status == 'OK'); });
                return;
            }
        }

        func(false);
    }

    // Return a U2F hardware key challenge
    function getHardwareKeyChallenge(req, domain, user, func) {
        if (req.session.u2fchallenge) { delete req.session.u2fchallenge; };
        if (user.otphkeys && (user.otphkeys.length > 0)) {
            // Get all WebAuthn keys
            var webAuthnKeys = [];
            for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type == 3) { webAuthnKeys.push(user.otphkeys[i]); } }
            if (webAuthnKeys.length > 0) {
                // Generate a Webauthn challenge, this is really easy, no need to call any modules to do this.
                var authnOptions = { type: 'webAuthn', keyIds: [], timeout: 60000, challenge: obj.crypto.randomBytes(64).toString('base64') };
                for (var i = 0; i < webAuthnKeys.length; i++) { authnOptions.keyIds.push(webAuthnKeys[i].keyId); }
                req.session.u2fchallenge = authnOptions.challenge;
                func(JSON.stringify(authnOptions));
                return;
            }
        }
        func('');
    }

    function handleLoginRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }

        // Normally, use the body username/password. If this is a token, use the username/password in the session.
        var xusername = req.body.username, xpassword = req.body.password;
        if ((xusername == null) && (xpassword == null) && (req.body.token != null)) { xusername = req.session.tokenusername; xpassword = req.session.tokenpassword; }

        // Authenticate the user
        obj.authenticate(xusername, xpassword, domain, function (err, userid, passhint) {
            if (userid) {
                var user = obj.users[userid];

                // Check if this user has 2-step login active
                if ((req.session.loginmode != '6') && checkUserOneTimePasswordRequired(domain, user)) {
                    checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result) {
                        if (result == false) {
                            var randomWaitTime = 0;
                            
                            // 2-step auth is required, but the token is not present or not valid.
                            if ((req.body.token != null) || (req.body.hwtoken != null)) {
                                randomWaitTime = 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095); // This is a fail, wait a random time. 2 to 6 seconds.
                                req.session.error = '<b style=color:#8C001A>Invalid token, try again.</b>';
                            }

                            // Wait and redirect the user
                            setTimeout(function () {
                                req.session.loginmode = '4';
                                req.session.tokenusername = xusername;
                                req.session.tokenpassword = xpassword;
                                res.redirect(domain.url + getQueryPortion(req));
                            }, randomWaitTime);
                        } else {
                            // Login succesful
                            completeLoginRequest(req, res, domain, user, userid, xusername, xpassword);
                        }
                    });
                    return;
                }

                // Login succesful
                completeLoginRequest(req, res, domain, user, userid, xusername, xpassword);
            } else {
                // Login failed, wait a random delay
                setTimeout(function () {
                    // If the account is locked, display that.
                    if (err == 'locked') { req.session.error = '<b style=color:#8C001A>Account locked.</b>'; } else { req.session.error = '<b style=color:#8C001A>Login failed, check username and password.</b>'; }

                    // Clean up login mode and display password hint if present.
                    delete req.session.loginmode;
                    if ((passhint != null) && (passhint.length > 0)) {
                        req.session.passhint = passhint;
                    } else {
                        delete req.session.passhint;
                    }
                    res.redirect(domain.url + getQueryPortion(req));
                }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095)); // Wait for 2 to ~6 seconds.
            }
        });
    }

    function completeLoginRequest(req, res, domain, user, userid, xusername, xpassword) {
        // Check if we need to change the password
        if ((typeof user.passchange == 'number') && ((user.passchange == -1) || ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.reset == 'number') && (user.passchange + (domain.passwordrequirements.reset * 86400) < Math.floor(Date.now() / 1000))))) {
            // Request a password change
            req.session.loginmode = '6';
            req.session.error = '<b style=color:#8C001A>Password change requested.</b>';
            req.session.resettokenusername = xusername;
            req.session.resettokenpassword = xpassword;
            res.redirect(domain.url + getQueryPortion(req));
            return;
        }

        // Save login time
        user.login = Math.floor(Date.now() / 1000);
        obj.db.SetUser(user);

        // Notify account login
        var targets = ['*', 'server-users'];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
        obj.parent.DispatchEvent(targets, obj, { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'login', msg: 'Account login', domain: domain.id });

        // Regenerate session when signing in to prevent fixation
        //req.session.regenerate(function () {
        // Store the user's primary key in the session store to be retrieved, or in this case the entire user object
        // req.session.success = 'Authenticated as ' + user.name + 'click to <a href="/logout">logout</a>. You may now access <a href="/restricted">/restricted</a>.';
        delete req.session.loginmode;
        delete req.session.tokenusername;
        delete req.session.tokenpassword;
        delete req.session.tokenemail;
        delete req.session.success;
        delete req.session.error;
        delete req.session.passhint;
        req.session.userid = userid;
        req.session.domainid = domain.id;
        req.session.currentNode = '';
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
                res.redirect(domain.url + getQueryPortion(req));
            });
            */
            res.redirect(domain.url + getQueryPortion(req)); // Temporary
        } else {
            res.redirect(domain.url + getQueryPortion(req));
        }
        //});
    }

    function handleCreateAccountRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap')) { res.sendStatus(404); return; }

        // Check if we are allowed to create new users using the login screen
        var domainUserCount = -1;
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true)) {
            domainUserCount = 0;
            for (var i in obj.users) { if (obj.users[i].domain == domain.id) { domainUserCount++; } }
            if (domainUserCount > 0) { res.sendStatus(401); return; }
        }

        // Check if this request is for an allows email domain
        if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains)) {
            var i = -1;
            if (typeof req.body.email == 'string') { i = req.body.email.indexOf('@'); }
            if (i == -1) {
                req.session.loginmode = '2';
                req.session.error = '<b style=color:#8C001A>Unable to create account.</b>';
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }
            var emailok = false, emaildomain = req.body.email.substring(i + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emaildomain == domain.newaccountemaildomains[i].toLowerCase()) { emailok = true; } }
            if (emailok == false) {
                req.session.loginmode = '2';
                req.session.error = '<b style=color:#8C001A>Unable to create account.</b>';
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }
        }

        // Check if we exceed the maximum number of user accounts
        obj.db.isMaxType(domain.limits.maxuseraccounts, 'user', domain.id, function (maxExceed) {
            if (maxExceed) {
                req.session.loginmode = '2';
                req.session.error = '<b style=color:#8C001A>Account limit reached.</b>';
                console.log('max', req.session);
                res.redirect(domain.url + getQueryPortion(req));
            } else {
                if (!obj.common.validateUsername(req.body.username, 1, 64) || !obj.common.validateEmail(req.body.email, 1, 256) || !obj.common.validateString(req.body.password1, 1, 256) || !obj.common.validateString(req.body.password2, 1, 256) || (req.body.password1 != req.body.password2) || req.body.username == '~' || !obj.common.checkPasswordRequirements(req.body.password1, domain.passwordrequirements)) {
                    req.session.loginmode = '2';
                    req.session.error = '<b style=color:#8C001A>Unable to create account.</b>';
                    res.redirect(domain.url + getQueryPortion(req));
                } else {
                    // Check if this email was already verified
                    obj.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (err, docs) {
                        if (docs.length > 0) {
                            req.session.loginmode = '2';
                            req.session.error = '<b style=color:#8C001A>Existing account with this email address.</b>';
                            res.redirect(domain.url + getQueryPortion(req));
                        } else {
                            // Check if there is domain.newAccountToken, check if supplied token is valid
                            if ((domain.newaccountspass != null) && (domain.newaccountspass != '') && (req.body.anewaccountpass != domain.newaccountspass)) {
                                req.session.loginmode = '2';
                                req.session.error = '<b style=color:#8C001A>Invalid account creation token.</b>';
                                res.redirect(domain.url + getQueryPortion(req));
                                return;
                            }
                            // Check if user exists
                            if (obj.users['user/' + domain.id + '/' + req.body.username.toLowerCase()]) {
                                req.session.loginmode = '2';
                                req.session.error = '<b style=color:#8C001A>Username already exists.</b>';
                            } else {
                                var user = { type: 'user', _id: 'user/' + domain.id + '/' + req.body.username.toLowerCase(), name: req.body.username, email: req.body.email, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), domain: domain.id };
                                if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                                if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) { hint = hint.substring(0, 250); } user.passhint = hint; }
                                if (domainUserCount == 0) { user.siteadmin = 0xFFFFFFFF; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.
                                obj.users[user._id] = user;
                                req.session.userid = user._id;
                                req.session.domainid = domain.id;
                                // Create a user, generate a salt and hash the password
                                require('./pass').hash(req.body.password1, function (err, salt, hash, tag) {
                                    if (err) throw err;
                                    user.salt = salt;
                                    user.hash = hash;
                                    delete user.passtype;
                                    obj.db.SetUser(user);

                                    // Send the verification email
                                    if ((obj.parent.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (obj.common.validateEmail(user.email, 1, 256) == true)) { obj.parent.mailserver.sendAccountCheckMail(domain, user.name, user.email); }
                                }, 0);
                                var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id };
                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                            }
                            res.redirect(domain.url + getQueryPortion(req));
                        }
                    });
                }
            }
        });
    }

    // Called to process an account password reset
    function handleResetPasswordRequest(req, res) {
        const domain = checkUserIpAddress(req, res);

        // Check everything is ok
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.body.rpassword1 != 'string') || (typeof req.body.rpassword2 != 'string') || (req.body.rpassword1 != req.body.rpassword2) || (typeof req.body.rpasswordhint != 'string') || (req.session == null) || (typeof req.session.resettokenusername != 'string') || (typeof req.session.resettokenpassword != 'string')) {
            delete req.session.loginmode;
            delete req.session.tokenusername;
            delete req.session.tokenpassword;
            delete req.session.resettokenusername;
            delete req.session.resettokenpassword;
            delete req.session.tokenemail;
            delete req.session.success;
            delete req.session.error;
            delete req.session.passhint;
            res.redirect(domain.url + getQueryPortion(req));
            return;
        }

        // Authenticate the user
        obj.authenticate(req.session.resettokenusername, req.session.resettokenpassword, domain, function (err, userid, passhint) {
            if (userid) {
                // Login
                var user = obj.users[userid];

                // If we have password requirements, check this here.
                if (!obj.common.checkPasswordRequirements(req.body.rpassword1, domain.passwordrequirements)) {
                    req.session.loginmode = '6';
                    req.session.error = '<b style=color:#8C001A>Password rejected, use a different one.</b>';
                    res.redirect(domain.url + getQueryPortion(req));
                    return;
                }

                // Check if the password is the same as the previous one
                require('./pass').hash(req.body.rpassword1, user.salt, function (err, hash, tag) {
                    if (user.hash == hash) {
                        // This is the same password, request a password change again
                        req.session.loginmode = '6';
                        req.session.error = '<b style=color:#8C001A>Password rejected, use a different one.</b>';
                        res.redirect(domain.url + getQueryPortion(req));
                    } else {
                        // Update the password, use a different salt.
                        require('./pass').hash(req.body.rpassword1, function (err, salt, hash, tag) {
                            if (err) throw err;
                            user.salt = salt;
                            user.hash = hash;
                            if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { var hint = req.body.rpasswordhint; if (hint.length > 250) { hint = hint.substring(0, 250); } user.passhint = hint; } else { delete user.passhint; }
                            user.passchange = Math.floor(Date.now() / 1000);
                            delete user.passtype;
                            obj.db.SetUser(user);
                            var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'User password reset', domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                            // Login succesful
                            req.session.userid = userid;
                            req.session.domainid = domain.id;
                            completeLoginRequest(req, res, domain, obj.users[userid], userid, req.session.tokenusername, req.session.tokenpassword);
                        }, 0);
                    }
                }, 0);
            } else {
                // Failed, error out.
                delete req.session.loginmode;
                delete req.session.tokenusername;
                delete req.session.tokenpassword;
                delete req.session.resettokenusername;
                delete req.session.resettokenpassword;
                delete req.session.tokenemail;
                delete req.session.success;
                delete req.session.error;
                delete req.session.passhint;
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }
        });
    }

    // Called to process an account reset request
    function handleResetAccountRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (obj.args.lanonly == true) || (obj.parent.certificates.CommonName == null) || (obj.parent.certificates.CommonName.indexOf('.') == -1)) { res.sendStatus(404); return; }

        // Get the email from the body or session.
        var email = req.body.email;
        if ((email == null) || (email == '')) { email = req.session.tokenemail; }

        // Check the email string format
        if (!email || checkEmail(email) == false) {
            req.session.loginmode = '3';
            req.session.error = '<b style=color:#8C001A>Invalid email.</b>';
            res.redirect(domain.url + getQueryPortion(req));
        } else {
            obj.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
                if ((err != null) || (docs.length == 0)) {
                    req.session.loginmode = '3';
                    req.session.error = '<b style=color:#8C001A>Account not found.</b>';
                    res.redirect(domain.url + getQueryPortion(req));
                } else {
                    // If many accounts have the same validated e-mail, we are going to use the first one for display, but sent a reset email for all accounts.
                    var responseSent = false;
                    for (var i in docs) {
                        var user = docs[i];
                        if (checkUserOneTimePasswordRequired(domain, user) == true) {
                            // Second factor setup, request it now.
                            checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result) {
                                if (result == false) {
                                    if (i == 0) {
                                        // 2-step auth is required, but the token is not present or not valid.
                                        if ((req.body.token != null) || (req.body.hwtoken != null)) { req.session.error = '<b style=color:#8C001A>Invalid token, try again.</b>'; }
                                        req.session.loginmode = '5';
                                        req.session.tokenemail = email;
                                        res.redirect(domain.url + getQueryPortion(req));
                                    }
                                } else {
                                    // Send email to perform recovery.
                                    delete req.session.tokenemail;
                                    if (obj.parent.mailserver != null) {
                                        obj.parent.mailserver.sendAccountResetMail(domain, user.name, user.email);
                                        if (i == 0) {
                                            req.session.loginmode = '1';
                                            req.session.error = '<b style=color:darkgreen>Hold on, reset mail sent.</b>';
                                            res.redirect(domain.url + getQueryPortion(req));
                                        }
                                    } else {
                                        if (i == 0) {
                                            req.session.loginmode = '3';
                                            req.session.error = '<b style=color:#8C001A>Unable to sent email.</b>';
                                            res.redirect(domain.url + getQueryPortion(req));
                                        }
                                    }
                                }
                            });
                        } else {
                            // No second factor, send email to perform recovery.
                            if (obj.parent.mailserver != null) {
                                obj.parent.mailserver.sendAccountResetMail(domain, user.name, user.email);
                                if (i == 0) {
                                    req.session.loginmode = '1';
                                    req.session.error = '<b style=color:darkgreen>Hold on, reset mail sent.</b>';
                                    res.redirect(domain.url + getQueryPortion(req));
                                }
                            } else {
                                if (i == 0) {
                                    req.session.loginmode = '3';
                                    req.session.error = '<b style=color:#8C001A>Unable to sent email.</b>';
                                    res.redirect(domain.url + getQueryPortion(req));
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Called to process a web based email verification request
    function handleCheckMailRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap')) { res.sendStatus(404); return; }

        if (req.query.c != null) {
            var cookie = obj.parent.decodeCookie(req.query.c, obj.parent.mailserver.mailCookieEncryptionKey, 30);
            if ((cookie != null) && (cookie.u != null) && (cookie.e != null)) {
                var idsplit = cookie.u.split('/');
                if ((idsplit.length != 2) || (idsplit[0] != domain.id)) {
                    res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'ERROR: Invalid domain. <a href="' + domain.url + '">Go to login page</a>.' });
                } else {
                    obj.db.Get('user/' + cookie.u.toLowerCase(), function (err, docs) {
                        if (docs.length == 0) {
                            res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'ERROR: Invalid username \"' + EscapeHtml(idsplit[1]) + '\". <a href="' + domain.url + '">Go to login page</a>.' });
                        } else {
                            var user = docs[0];
                            if (user.email != cookie.e) {
                                res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'ERROR: Invalid e-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\". <a href="' + domain.url + '">Go to login page</a>.' });
                            } else {
                                if (cookie.a == 1) {
                                    // Account email verification
                                    if (user.emailVerified == true) {
                                        res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'E-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\" already verified. <a href="' + domain.url + '">Go to login page</a>.' });
                                    } else {
                                        obj.db.GetUserWithVerifiedEmail(domain.id, user.email, function (err, docs) {
                                            if (docs.length > 0) {
                                                res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'E-mail \"' + EscapeHtml(user.email) + '\" already in use on a different account. Change the email address and try again. <a href="' + domain.url + '">Go to login page</a>.' });
                                            } else {
                                                // Set the verified flag
                                                obj.users[user._id].emailVerified = true;
                                                user.emailVerified = true;
                                                obj.db.SetUser(user);

                                                // Event the change
                                                var event = { etype: 'user', username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Verified email of user ' + EscapeHtml(user.name) + ' (' + EscapeHtml(user.email) + ')', domain: domain.id };
                                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                                                // Send the confirmation page
                                                res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'Verified email <b>' + EscapeHtml(user.email) + '</b> for user account <b>' + EscapeHtml(user.name) + '</b>. <a href="' + domain.url + '">Go to login page</a>.' });

                                                // Send a notification
                                                obj.parent.DispatchEvent([user._id], obj, { action: 'notify', value: 'Email verified:<br /><b>' + EscapeHtml(user.email) + '</b>.', nolog: 1 });
                                            }
                                        });
                                    }
                                } else if (cookie.a == 2) {
                                    // Account reset
                                    if (user.emailVerified != true) {
                                        res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'E-mail \"' + EscapeHtml(user.email) + '\" for user \"' + EscapeHtml(user.name) + '\" not verified. <a href="' + domain.url + '">Go to login page</a>.' });
                                    } else {
                                        // Set a temporary password
                                        obj.crypto.randomBytes(16, function (err, buf) {
                                            var newpass = buf.toString('base64').split('=').join('').split('/').join('');
                                            require('./pass').hash(newpass, function (err, salt, hash, tag) {
                                                var userinfo = null;
                                                if (err) throw err;

                                                // Change the password
                                                userinfo = obj.users[user._id];
                                                userinfo.salt = salt;
                                                userinfo.hash = hash;
                                                delete userinfo.passtype;
                                                userinfo.passchange = Math.floor(Date.now() / 1000);
                                                delete userinfo.passhint;
                                                //delete userinfo.otpsecret; // Currently a email password reset will turn off 2-step login.
                                                obj.db.SetUser(userinfo);

                                                // Event the change
                                                var event = { etype: 'user', username: userinfo.name, account: obj.CloneSafeUser(userinfo), action: 'accountchange', msg: 'Password reset for user ' + EscapeHtml(user.name), domain: domain.id };
                                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                                                // Send the new password
                                                res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: '<div>Password for account <b>' + EscapeHtml(user.name) + '</b> has been reset to:</div><div style=padding:14px;font-size:18px><b>' + EscapeHtml(newpass) + '</b></div>Login and go to the \"My Account\" tab to update your password. <a href="' + domain.url + '">Go to login page</a>.' });
                                            }, 0);
                                        });
                                    }
                                } else {
                                    res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'ERROR: Invalid account check. <a href="' + domain.url + '">Go to login page</a>.' });
                                }
                            }
                        }
                    });
                }
            } else {
                res.render(obj.path.join(obj.parent.webViewsPath, 'message'), { title: domain.title, title2: domain.title2, title3: 'Account Verification', domainurl: domain.url, message: 'ERROR: Invalid account check, verification url is only valid for 30 minutes. <a href="' + domain.url + '">Go to login page</a>.' });
            }
        }
    }

    // Called to process an agent invite request
    function handleAgentInviteRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || ((req.query.m == null) && (req.query.c == null))) { res.sendStatus(404); return; }
        if (req.query.c != null) {
            // A cookie is specified in the query string, use that
            var cookie = obj.parent.decodeCookie(req.query.c, obj.parent.invitationLinkEncryptionKey);
            if (cookie == null) { res.sendStatus(404); return; }
            var mesh = obj.meshes[cookie.mid];
            if (mesh == null) { res.sendStatus(404); return; }
            var installflags = cookie.f;
            if (typeof installflags != 'number') { installflags = 0; }
            res.render(obj.path.join(obj.parent.webViewsPath, 'agentinvite'), { title: domain.title, title2: domain.title2, domainurl: domain.url, meshid: mesh._id.split('/')[2], serverport: ((args.aliasport != null) ? args.aliasport : args.port), serverhttps: ((args.notls == true) ? '0' : '1'), servernoproxy: ((domain.agentnoproxy === true) ? '1' : '0'), meshname: encodeURIComponent(mesh.name), installflags: installflags });
        } else if (req.query.m != null) {
            // The MeshId is specified in the query string, use that
            var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.m.toLowerCase()];
            if (mesh == null) { res.sendStatus(404); return; }
            var installflags = 0;
            if (req.query.f) { installflags = parseInt(req.query.f); }
            if (typeof installflags != 'number') { installflags = 0; }
            res.render(obj.path.join(obj.parent.webViewsPath, 'agentinvite'), { title: domain.title, title2: domain.title2, domainurl: domain.url, meshid: mesh._id.split('/')[2], serverport: ((args.aliasport != null) ? args.aliasport : args.port), serverhttps: ((args.notls == true) ? '0' : '1'), servernoproxy: ((domain.agentnoproxy === true) ? '1' : '0'), meshname: encodeURIComponent(mesh.name), installflags: installflags });
        }
    }

    function handleDeleteAccountRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap')) { res.sendStatus(404); return; }

        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url + getQueryPortion(req)); return; }
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
                res.redirect(domain.url + getQueryPortion(req));
                obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
            } else {
                res.redirect(domain.url + getQueryPortion(req));
            }
        });
    }

    // Check a user's password
    obj.checkUserPassword = function(domain, user, password, func) {
        // Check the old password
        if (user.passtype != null) {
            // IIS default clear or weak password hashing (SHA-1)
            require('./pass').iishash(user.passtype, password, user.salt, function (err, hash) {
                if (err) return func(false);
                if (hash == user.hash) {
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { return func(false); } // Account is locked
                    return func(true); // Allow password change
                }
                func(false);
            });
        } else {
            // Default strong password hashing (pbkdf2 SHA384)
            require('./pass').hash(password, user.salt, function (err, hash, tag) {
                if (err) return func(false);
                if (hash == user.hash) {
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { return func(false); } // Account is locked
                    return func(true); // Allow password change
                }
                func(false);
            }, 0);
        }
    }

    // Handle password changes
    function handlePasswordChangeRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap')) { res.sendStatus(404); return; }

        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword0 || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.domainid != domain.id)) { res.redirect(domain.url + getQueryPortion(req)); return; }

        // Get the current user
        var user = obj.users[req.session.userid];
        if (!user) { res.redirect(domain.url + getQueryPortion(req)); return; }

        // Check old password
        obj.checkUserPassword(domain, user, req.body.apassword0, function (result) {
            if (result == true) {
                // Update the password
                require('./pass').hash(req.body.apassword1, function (err, salt, hash, tag) {
                    if (err) throw err;
                    user.salt = salt;
                    user.hash = hash;
                    if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) hint = hint.substring(0, 250); user.passhint = hint; } else { delete user.passhint; }
                    user.passchange = Math.floor(Date.now() / 1000);
                    delete user.passtype;
                    obj.db.SetUser(user);
                    req.session.viewmode = 2;
                    res.redirect(domain.url + getQueryPortion(req));
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id });
                }, 0);
            }
        });
    }

    // Indicates that any request to "/" should render "default" or "login" depending on login state
    function handleRootRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if (!obj.args) { res.sendStatus(500); return; }

        if ((domain.sspi != null) && ((req.query.login == null) || (obj.parent.loginCookieEncryptionKey == null))) {
            // Login using SSPI
            domain.sspi.authenticate(req, res, function (err) { if ((err != null) || (req.connection.user == null)) { res.end('Authentication Required...'); } else { handleRootRequestEx(req, res, domain); } });
        } else if (req.query.user && req.query.pass) {
            // User credentials are being passed in the URL. WARNING: Putting credentials in a URL is not good security... but people are requesting this option.
            obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid) {
                req.session.userid = userid;
                req.session.domainid = domain.id;
                req.session.currentNode = '';
                handleRootRequestEx(req, res, domain);
            });
        } else {
            // Login using a different system
            handleRootRequestEx(req, res, domain);
        }
    }

    function handleRootRequestEx(req, res, domain) {
        var nologout = false, user = null, features = 0;
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });

        // Check if we have an incomplete domain name in the path
        if ((domain.id != '') && (domain.dns == null) && (req.url.split('/').length == 2)) { res.redirect(domain.url + getQueryPortion(req)); return; }

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
                req.session.userid = 'user/' + domain.id + '/' + req.connection.user.toLowerCase();
                req.session.usersid = req.connection.userSid;
                req.session.usersGroups = req.connection.userGroups;
                req.session.domainid = domain.id;
                req.session.currentNode = '';

                // Check if this user exists, create it if not.
                user = obj.users[req.session.userid];
                if ((user == null) || (user.sid != req.session.usersid)) {
                    // Create the domain user
                    var usercount = 0, user2 = { type: 'user', _id: req.session.userid, name: req.connection.user, domain: domain.id, sid: req.session.usersid, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000) };
                    if (domain.newaccountsrights) { user2.siteadmin = domain.newaccountsrights; }
                    for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                    if (usercount == 0) { user2.siteadmin = 0xFFFFFFFF; } // If this is the first user, give the account site admin.
                    obj.users[req.session.userid] = user2;
                    obj.db.SetUser(user2);
                    var event = { etype: 'user', username: req.connection.user, account: obj.CloneSafeUser(user2), action: 'accountcreate', msg: 'Domain account created, user ' + req.connection.user, domain: domain.id };
                    if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                }
            }
        }

        // Figure out the minimal password requirement
        var passRequirements = null;
        if (domain.passwordrequirements != null) {
            if (domain.passrequirementstr == null) { domain.passwordrequirementsstr = encodeURIComponent(JSON.stringify(domain.passwordrequirements)); }
            passRequirements = domain.passwordrequirementsstr;
        }

        // If a user exists and is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid && obj.users[req.session.userid]) {
            var user = obj.users[req.session.userid];
            if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check is the session is for the correct domain

            // Check if this is a locked account
            if ((user.siteadmin != null) && ((user.siteadmin & 32) != 0) && (user.siteadmin != 0xFFFFFFFF)) {
                // Locked account
                delete req.session.userid;
                delete req.session.domainid;
                delete req.session.currentNode;
                delete req.session.passhint;
                req.session.error = '<b style=color:#8C001A>Account locked.</b>';
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }

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
            if (obj.args.nousers != true) { logoutcontrol = 'Welcome ' + user.name + '.'; }

            // Give the web page a list of supported server features
            features = 0;
            if (obj.args.wanonly == true) { features += 0x00000001; } // WAN-only mode
            if (obj.args.lanonly == true) { features += 0x00000002; } // LAN-only mode
            if (obj.args.nousers == true) { features += 0x00000004; } // Single user mode
            if (domain.userQuota == -1) { features += 0x00000008; } // No server files mode
            if (obj.args.mpstlsoffload) { features += 0x00000010; } // No mutual-auth CIRA
            if (parent.config.settings.allowframing == true) { features += 0x00000020; } // Allow site within iframe
            if ((obj.parent.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true)) { features += 0x00000040; } // Email invites
            if (obj.args.webrtc == true) { features += 0x00000080; } // Enable WebRTC (Default false for now)
            if (obj.args.clickonce !== false) { features += 0x00000100; } // Enable ClickOnce (Default true)
            if (obj.args.allowhighqualitydesktop == true) { features += 0x00000200; } // Enable AllowHighQualityDesktop (Default false)
            if (obj.args.lanonly == true || obj.args.mpsport == 0) { features += 0x00000400; } // No CIRA
            if ((obj.parent.serverSelfWriteAllowed == true) && (user != null) && (user.siteadmin == 0xFFFFFFFF)) { features += 0x00000800; } // Server can self-write (Allows self-update)
            if ((parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true)) { features += 0x00001000; } // 2-step login supported
            if (domain.agentnoproxy === true) { features += 0x00002000; } // Indicates that agents should be installed without using a HTTP proxy
            if ((parent.config.settings.no2factorauth !== true) && domain.yubikey && domain.yubikey.id && domain.yubikey.secret) { features += 0x00004000; } // Indicates Yubikey support
            if (domain.geolocation == true) { features += 0x00008000; } // Enable geo-location features
            if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { features += 0x00010000; } // Enable password hints
            if (parent.config.settings.no2factorauth !== true) { features += 0x00020000; } // Enable WebAuthn/FIDO2 support
            if ((obj.args.nousers != true) && (domain.passwordrequirements != null) && (domain.passwordrequirements.force2factor === true)) { features += 0x00040000; } // Force 2-factor auth
            if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { features += 0x00080000; } // LDAP or SSPI in use, warn that users must login first before adding a user to a group.
            if (domain.amtacmactivation) { features += 0x00100000; } // Intel AMT ACM activation/upgrade is possible

            // Create a authentication cookie
            const authCookie = obj.parent.encodeCookie({ userid: user._id, domainid: domain.id }, obj.parent.loginCookieEncryptionKey);

            // Send the master web application
            if ((!obj.args.user) && (obj.args.nousers != true) && (nologout == false)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
            var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

            // Fetch the web state
            obj.db.Get('ws' + user._id, function (err, states) {
                var webstate = (states.length == 1) ? states[0].state : '';
                if (obj.args.minify && !req.query.nominify) {
                    // Try to server the minified version if we can.
                    try {
                        res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'default-mobile-min' : 'default-min'), { authCookie: authCookie, viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, extitle: encodeURIComponent(domain.title), extitle2: encodeURIComponent(domain.title2), domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: obj.getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, passRequirements: passRequirements, webcerthash: Buffer.from(obj.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'), footer: (domain.footer == null) ? '' : domain.footer, webstate: encodeURIComponent(webstate) });
                    } catch (ex) {
                        // In case of an exception, serve the non-minified version.
                        res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'default-mobile' : 'default'), { authCookie: authCookie, viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, extitle: encodeURIComponent(domain.title), extitle2: encodeURIComponent(domain.title2), domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: obj.getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, passRequirements: passRequirements, webcerthash: Buffer.from(obj.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'), footer: (domain.footer == null) ? '' : domain.footer, webstate: encodeURIComponent(webstate) });
                    }
                } else {
                    // Serve non-minified version of web pages.
                    res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'default-mobile' : 'default'), { authCookie: authCookie, viewmode: viewmode, currentNode: currentNode, logoutControl: logoutcontrol, title: domain.title, title2: domain.title2, extitle: encodeURIComponent(domain.title), extitle2: encodeURIComponent(domain.title2), domainurl: domain.url, domain: domain.id, debuglevel: parent.debugLevel, serverDnsName: obj.getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, noServerBackup: (args.noserverbackup == 1 ? 1 : 0), features: features, sessiontime: args.sessiontime, mpspass: args.mpspass, passRequirements: passRequirements, webcerthash: Buffer.from(obj.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'), footer: (domain.footer == null) ? '' : domain.footer, webstate: encodeURIComponent(webstate) });
                }
            });
        } else {
            // Send back the login application
            // If this is a 2 factor auth request, look for a hardware key challenge.
            // Normal login 2 factor request
            if ((req.session.loginmode == '4') && (req.session.tokenusername)) {
                var user = obj.users['user/' + domain.id + '/' + req.session.tokenusername.toLowerCase()];
                if (user != null) {
                    getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                    return;
                }
            }
            // Password recovery 2 factor request
            if ((req.session.loginmode == '5') && (req.session.tokenemail)) {
                obj.db.GetUserWithVerifiedEmail(domain.id, req.session.tokenemail, function (err, docs) {
                    if ((err != null) || (docs.length == 0)) {
                        req.session = null;
                        res.redirect(domain.url + getQueryPortion(req));
                    } else {
                        var user = obj.users[docs[0]._id];
                        if (user != null) {
                            getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                        } else {
                            req.session = null;
                            res.redirect(domain.url + getQueryPortion(req));
                        }
                    }
                });
                return;
            }
            handleRootRequestLogin(req, res, domain, '', passRequirements);
        }
    }

    function handleRootRequestLogin(req, res, domain, hardwareKeyChallenge, passRequirements) {
        var features = 0;
        if ((parent.config != null) && (parent.config.settings != null) && (parent.config.settings.allowframing == true)) { features += 32; } // Allow site within iframe
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        var loginmode = req.session.loginmode;
        delete req.session.loginmode; // Clear this state, if the user hits refresh, we want to go back to the login page.

        // Format an error message if needed
        var err = null, msg = null, passhint = null;
        if (req.session != null) {
            err = req.session.error;
            msg = req.session.success;
            if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { passhint = EscapeHtml(req.session.passhint); }
            delete req.session.error;
            delete req.session.success;
            delete req.session.passhint;
        }
        var message = '';
        if (err != null) message = '<p class="msg error">' + err + '</p>';
        if (msg != null) message = '<p class="msg success">' + msg + '</p>';
        var emailcheck = ((obj.parent.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

        // Check if we are allowed to create new users using the login screen
        var newAccountsAllowed = true;
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true)) { for (var i in obj.users) { if (obj.users[i].domain == domain.id) { newAccountsAllowed = false; break; } } }

        if (obj.args.minify && !req.query.nominify) {
            // Try to server the minified version if we can.
            try {
                res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'login-mobile-min' : 'login-min'), { loginmode: loginmode, rootCertLink: getRootCertLink(), domainurl: domain.url, title: domain.title, title2: domain.title2, newAccount: newAccountsAllowed, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: obj.getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: emailcheck, features: features, sessiontime: args.sessiontime, passRequirements: passRequirements, footer: (domain.footer == null) ? '' : domain.footer, hkey: encodeURIComponent(hardwareKeyChallenge), message: message, passhint: passhint, welcometext: domain.welcometext?encodeURIComponent(domain.welcometext):null });
            } catch (ex) {
                // In case of an exception, serve the non-minified version.
                res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'login-mobile' : 'login'), { loginmode: loginmode, rootCertLink: getRootCertLink(), domainurl: domain.url, title: domain.title, title2: domain.title2, newAccount: newAccountsAllowed, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: obj.getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: emailcheck, features: features, sessiontime: args.sessiontime, passRequirements: passRequirements, footer: (domain.footer == null) ? '' : domain.footer, hkey: encodeURIComponent(hardwareKeyChallenge), message: message, passhint: passhint, welcometext: domain.welcometext ? encodeURIComponent(domain.welcometext) : null });
            }
        } else {
            // Serve non-minified version of web pages.
            res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'login-mobile' : 'login'), { loginmode: loginmode, rootCertLink: getRootCertLink(), domainurl: domain.url, title: domain.title, title2: domain.title2, newAccount: newAccountsAllowed, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: obj.getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: emailcheck, features: features, sessiontime: args.sessiontime, passRequirements: passRequirements, footer: (domain.footer == null) ? '' : domain.footer, hkey: encodeURIComponent(hardwareKeyChallenge), message: message, passhint: passhint, welcometext: domain.welcometext ? encodeURIComponent(domain.welcometext) : null });
        }

        /*
        var xoptions = { loginmode: loginmode, rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, newAccount: newAccountsAllowed, newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), serverDnsName: obj.getWebServerName(domain), serverPublicPort: httpsPort, emailcheck: obj.parent.mailserver != null, features: features, footer: (domain.footer == null) ? '' : domain.footer };
        var xpath = obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'login-mobile' : 'login');
        console.log('Render...');
        res.render(xpath, xoptions, function (err, html) {
            console.log(err, html);
        });
        */
    }

    // Return true if it looks like we are using a real TLS certificate.
    function isTrustedCert() {
        if (obj.args.notls == true) return false; // We are not using TLS, so not trusted cert.
        if (obj.args.tlsoffload != null) return true; // We are using TLS offload, a real cert is likely used.
        if (obj.parent.config.letsencrypt != null) return true; // We are using Let's Encrypt, real cert in use.
        if (obj.certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0) return false; // Our cert is issued by self-signed cert.
        if (obj.certificates.CommonName.indexOf('.') == -1) return false; // Our cert is named with a fake name
        return true; // This is a guess
    }

    // Get the link to the root certificate if needed
    function getRootCertLink() {
        // Check if the HTTPS certificate is issued from MeshCentralRoot, if so, add download link to root certificate.
        if ((obj.args.notls == null) && (obj.args.tlsoffload == null) && (obj.parent.config.letsencrypt == null) && (obj.tlsSniCredentials == null) && (obj.certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0) && (obj.certificates.CommonName.indexOf('.') != -1)) { return '<a href=/MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>'; }
        return '';
    }

    // Render the terms of service.
    function handleTermsRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }

        // See if term.txt was loaded from the database
        if ((parent.configurationFiles != null) && (parent.configurationFiles['terms.txt'] != null)) {
            // Send the terms from the database
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
            if (req.session && req.session.userid) {
                if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check is the session is for the correct domain
                var user = obj.users[req.session.userid];
                var logoutcontrol = 'Welcome ' + user.name + '.';
                if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
                res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url, terms: encodeURIComponent(parent.configurationFiles['terms.txt'].toString()), logoutControl: logoutcontrol });
            } else {
                res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url, terms: encodeURIComponent(parent.configurationFiles['terms.txt'].toString()) });
            }
        } else {
            // See if there is a terms.txt file in meshcentral-data
            var p = obj.path.join(obj.parent.datapath, 'terms.txt');
            if (obj.fs.existsSync(p)) {
                obj.fs.readFile(p, 'utf8', function (err, data) {
                    if (err != null) { res.sendStatus(404); return; }

                    // Send the terms from terms.txt
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
                    if (req.session && req.session.userid) {
                        if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check is the session is for the correct domain
                        var user = obj.users[req.session.userid];
                        var logoutcontrol = 'Welcome ' + user.name + '.';
                        if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
                        res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url, terms: encodeURIComponent(data), logoutControl: logoutcontrol });
                    } else {
                        res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url, terms: encodeURIComponent(data) });
                    }
                });
            } else {
                // Send the default terms
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
                if (req.session && req.session.userid) {
                    if (req.session.domainid != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check is the session is for the correct domain
                    var user = obj.users[req.session.userid];
                    var logoutcontrol = 'Welcome ' + user.name + '.';
                    if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrol += ' <a href=' + domain.url + 'logout?' + Math.random() + ' style=color:white>Logout</a>'; } // If a default user is in use or no user mode, don't display the logout button
                    res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url, logoutControl: logoutcontrol });
                } else {
                    res.render(obj.path.join(obj.parent.webViewsPath, isMobileBrowser(req) ? 'terms-mobile' : 'terms'), { title: domain.title, title2: domain.title2, domainurl: domain.url });
                }
            }
        }
    }

    // Render the messenger application.
    function handleMessengerRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }

        var webRtcConfig = null;
        if (obj.parent.config.settings && obj.parent.config.settings.webrtconfig && (typeof obj.parent.config.settings.webrtconfig == 'object')) { webRtcConfig = encodeURIComponent(JSON.stringify(obj.parent.config.settings.webrtconfig)); }
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
        res.render(obj.path.join(obj.parent.webViewsPath, 'messenger'), { webrtconfig: webRtcConfig, domainurl: domain.url });
    }

    // Returns the server root certificate encoded in base64
    function getRootCertBase64() {
        var rootcert = obj.certificates.root.cert;
        var i = rootcert.indexOf("-----BEGIN CERTIFICATE-----\r\n");
        if (i >= 0) { rootcert = rootcert.substring(i + 29); }
        i = rootcert.indexOf("-----END CERTIFICATE-----");
        if (i >= 0) { rootcert = rootcert.substring(i, 0); }
        return Buffer.from(rootcert, 'base64').toString('base64');
    }

    // Returns the mesh server root certificate
    function handleRootCertRequest(req, res) {
        if ((obj.userAllowedIp != null) && (checkIpAddressEx(req, res, obj.userAllowedIp, false) === false)) { return; } // Check server-wide IP filter only.
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + certificates.RootName + '.cer"' });
        res.send(Buffer.from(getRootCertBase64(), 'base64'));
    }

    // Return the CIRA configuration script
    obj.getCiraCleanupScript = function(func) {
        obj.fs.readFile(obj.parent.path.join(obj.parent.webPublicPath, 'scripts/cira_cleanup.mescript'), 'utf8', function (err, data) {
            if (err != null) { func(null); return; }
            func(Buffer.from(data));
        });
    }

    // Return the CIRA configuration script
    obj.getCiraConfigurationScript = function(meshid, func) {
        var serverNameSplit = obj.certificates.AmtMpsName.split('.');

        // Figure out the MPS port, use the alias if set
        var mpsport = ((obj.args.mpsaliasport != null) ? obj.args.mpsaliasport : obj.args.mpsport);

        if ((serverNameSplit.length == 4) && (parseInt(serverNameSplit[0]) == serverNameSplit[0]) && (parseInt(serverNameSplit[1]) == serverNameSplit[1]) && (parseInt(serverNameSplit[2]) == serverNameSplit[2]) && (parseInt(serverNameSplit[3]) == serverNameSplit[3])) {
            // Server name is an IPv4 address
            obj.fs.readFile(obj.parent.path.join(obj.parent.webPublicPath, 'scripts/cira_setup_script_ip.mescript'), 'utf8', function (err, data) {
                if (err != null) { func(null); return; }
                var scriptFile = JSON.parse(data);

                // Change a few things in the script
                scriptFile.scriptBlocks[2].vars.CertBin.value = getRootCertBase64(); // Set the root certificate
                scriptFile.scriptBlocks[3].vars.IP.value = obj.certificates.AmtMpsName; // Set the server IPv4 address name
                scriptFile.scriptBlocks[3].vars.ServerName.value = obj.certificates.AmtMpsName; // Set the server certificate name
                scriptFile.scriptBlocks[3].vars.Port.value = mpsport; // Set the server MPS port
                scriptFile.scriptBlocks[3].vars.username.value = meshid; // Set the username
                scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the primary server name:port to set periodic timer
                //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the secondary server name:port to set periodic timer
                if (obj.args.ciralocalfqdn != null) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                // Compile the script
                var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                scriptFile.mescript = Buffer.from(scriptEngine.script_compile(runscript), 'binary').toString('base64');
                scriptFile.scriptText = runscript;

                // Send the script
                func(Buffer.from(JSON.stringify(scriptFile, null, ' ')));
            });
        } else {
            // Server name is a hostname
            obj.fs.readFile(obj.parent.path.join(obj.parent.webPublicPath, 'scripts/cira_setup_script_dns.mescript'), 'utf8', function (err, data) {
                if (err != null) { res.sendStatus(404); return; }
                var scriptFile = JSON.parse(data);

                // Change a few things in the script
                scriptFile.scriptBlocks[2].vars.CertBin.value = getRootCertBase64(); // Set the root certificate
                scriptFile.scriptBlocks[3].vars.FQDN.value = obj.certificates.AmtMpsName; // Set the server DNS name
                scriptFile.scriptBlocks[3].vars.Port.value = mpsport; // Set the server MPS port
                scriptFile.scriptBlocks[3].vars.username.value = meshid; // Set the username
                scriptFile.scriptBlocks[3].vars.password.value = obj.args.mpspass ? obj.args.mpspass : 'A@xew9rt'; // Set the password
                scriptFile.scriptBlocks[4].vars.AccessInfo1.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the primary server name:port to set periodic timer
                //scriptFile.scriptBlocks[4].vars.AccessInfo2.value = obj.certificates.AmtMpsName + ':' + mpsport; // Set the secondary server name:port to set periodic timer
                if (obj.args.ciralocalfqdn != null) { scriptFile.scriptBlocks[6].vars.DetectionStrings.value = obj.args.ciralocalfqdn; } // Set the environment detection local FQDN's

                // Compile the script
                var scriptEngine = require('./amtscript.js').CreateAmtScriptEngine();
                var runscript = scriptEngine.script_blocksToScript(scriptFile.blocks, scriptFile.scriptBlocks);
                scriptFile.mescript = Buffer.from(scriptEngine.script_compile(runscript), 'binary').toString('base64');
                scriptFile.scriptText = runscript;

                // Send the script
                func(Buffer.from(JSON.stringify(scriptFile, null, ' ')));
            });
        }
    }

    // Returns an mescript for Intel AMT configuration
    function handleMeScriptRequest(req, res) {
        if ((obj.userAllowedIp != null) && (checkIpAddressEx(req, res, obj.userAllowedIp, false) === false)) { return; } // Check server-wide IP filter only.
        if (req.query.type == 1) {
            obj.getCiraConfigurationScript(req.query.meshid, function (script) {
                if (script == null) { res.sendStatus(404); } else {
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="cira_setup.mescript"' });
                    res.send(script);
                }
            });
        } else if (req.query.type == 2) {
            obj.getCiraCleanupScript(function (script) {
                if (script == null) { res.sendStatus(404); } else {
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="cira_cleanup.mescript"' });
                    res.send(script);
                }
            });
        }
    }

    // Handle user public file downloads
    function handleDownloadUserFiles(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if (obj.common.validateString(req.path, 1, 4096) == false) { res.sendStatus(404); return; }
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
                res.render(obj.path.join(obj.parent.webViewsPath, 'download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, domainurl: domain.url, message: "<a href='" + req.path + "?download=1'>" + filename + "</a>, " + stat.size + " byte" + ((stat.size < 2) ? '' : 's') + "." });
            }
        } else {
            res.render(obj.path.join(obj.parent.webViewsPath, 'download'), { rootCertLink: getRootCertLink(), title: domain.title, title2: domain.title2, domainurl: domain.url, message: "Invalid file link, please check the URL again." });
        }
    }

    // Handle logo request
    function handleLogoRequest(req, res) {
        const domain = checkUserIpAddress(req, res);

        res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if ((domain != null) && domain.titlepicture) {
            if ((parent.configurationFiles != null) && (parent.configurationFiles[domain.titlepicture] != null)) {
                // Use the logo in the database
                res.set({ 'Content-Type': 'image/jpeg' });
                res.send(parent.configurationFiles[domain.titlepicture]);
            } else {
                // Use the logo on file
                try { res.sendFile(obj.path.join(obj.parent.datapath, domain.titlepicture)); } catch (e) {
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/logoback.png')); } catch (e) { res.sendStatus(404); }
                }
            }
        } else {
            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/logoback.png')); } catch (e) { res.sendStatus(404); }
        }
    }

    // Handle welcome image request
    function handleWelcomeImageRequest(req, res) {
        const domain = checkUserIpAddress(req, res);

        res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if ((domain != null) && domain.welcomepicture) {
            if ((parent.configurationFiles != null) && (parent.configurationFiles[domain.welcomepicture] != null)) {
                // Use the welcome image in the database
                res.set({ 'Content-Type': 'image/jpeg' });
                res.send(parent.configurationFiles[domain.welcomepicture]);
            } else {
                // Use the logo on file
                try { res.sendFile(obj.path.join(obj.parent.datapath, domain.welcomepicture)); } catch (e) {
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/mainwelcome.jpg')); } catch (e) { res.sendStatus(404); }
                }
            }
        } else {
            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/mainwelcome.jpg')); } catch (e) { res.sendStatus(404); }
        }
    }

    // Handle domain redirection
    function handleDomainRedirect(req, res) {
        const domain = checkUserIpAddress(req, res);
        if ((domain == null) || (domain.redirects == null)) { res.sendStatus(404); return; }
        var urlArgs = '', urlName = null, splitUrl = req.originalUrl.split("?");
        if (splitUrl.length > 1) { urlArgs = '?' + splitUrl[1]; }
        if ((splitUrl.length > 0) && (splitUrl[0].length > 1)) { urlName = splitUrl[0].substring(1).toLowerCase(); }
        if ((urlName == null) || (domain.redirects[urlName] == null) || (urlName[0] == '_')) { res.sendStatus(404); return; }
        if (domain.redirects[urlName] == '~showversion') {
            // Show the current version
            res.end('MeshCentral v' + obj.parent.currentVer);
        } else {
            // Perform redirection
            res.redirect(domain.redirects[urlName] + urlArgs + getQueryPortion(req));
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
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((req.query.link == null) || (req.session == null) || (req.session.userid == null) || (domain == null) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        const user = obj.users[req.session.userid];
        if (user == null) { res.sendStatus(404); return; }
        const file = obj.getServerFilePath(user, domain, req.query.link);
        if (file == null) { res.sendStatus(404); return; }
        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=\"' + file.name + '\"' });
        try { res.sendFile(file.fullpath); } catch (e) { res.sendStatus(404); }
    }

    // Upload a MeshCore.js file to the server
    function handleUploadMeshCoreFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
        const user = obj.users[req.session.userid];
        if (user.siteadmin != 0xFFFFFFFF) { res.sendStatus(401); return; } // Check if we have mesh core upload rights (Full admin only)

        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == null) || (fields.attrib == null) || (fields.attrib.length != 1)) { res.sendStatus(404); return; }
            for (var i in files.files) {
                var file = files.files[i];
                obj.fs.readFile(file.path, 'utf8', function (err, data) {
                    if (err != null) return;
                    data = obj.common.IntToStr(0) + data; // Add the 4 bytes encoding type & flags (Set to 0 for raw)
                    obj.sendMeshAgentCore(user, domain, fields.attrib[0], 'custom', data); // Upload the core
                    try { obj.fs.unlinkSync(file.path); } catch (e) { }
                });
            }
            res.send('');
        });
    }

    // Upload a file to the server
    function handleUploadFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (domain.userQuota == -1)) { res.sendStatus(401); return; }
        const user = obj.users[req.session.userid];
        if ((user.siteadmin & 8) == 0) { res.sendStatus(401); return; } // Check if we have file rights

        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if ((fields == null) || (fields.link == null) || (fields.link.length != 1)) { /*console.log('UploadFile, Invalid Fields:', fields, files);*/ res.sendStatus(404); return; }
            var xfile = obj.getServerFilePath(user, domain, decodeURIComponent(fields.link[0]));
            if (xfile == null) { res.sendStatus(404); return; }
            // Get total bytes in the path
            var totalsize = readTotalFileSize(xfile.fullpath);
            if ((xfile.quota == null) || (totalsize < xfile.quota)) { // Check if the quota is not already broken
                if (fields.name != null) {

                    // See if we need to create the folder
                    var domainx = 'domain';
                    if (domain.id.length > 0) { domainx = 'domain-' + usersplit[1]; }
                    try { obj.fs.mkdirSync(obj.parent.filespath); } catch (e) { }
                    try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx)); } catch (e) { }
                    try { obj.fs.mkdirSync(xfile.fullpath); } catch (e) { }

                    // Upload method where all the file data is within the fields.
                    var names = fields.name[0].split('*'), sizes = fields.size[0].split('*'), types = fields.type[0].split('*'), datas = fields.data[0].split('*');
                    if ((names.length == sizes.length) && (types.length == datas.length) && (names.length == types.length)) {
                        for (var i = 0; i < names.length; i++) {
                            if (obj.common.IsFilenameValid(names[i]) == false) { res.sendStatus(404); return; }
                            var filedata = Buffer.from(datas[i].split(',')[1], 'base64');
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

                            // See if we need to create the folder
                            var domainx = 'domain';
                            if (domain.id.length > 0) { domainx = 'domain-' + usersplit[1]; }
                            try { obj.fs.mkdirSync(obj.parent.filespath); } catch (e) { }
                            try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx)); } catch (e) { }
                            try { obj.fs.mkdirSync(xfile.fullpath); } catch (e) { }

                            obj.fs.rename(file.path, fpath, function () {
                                obj.parent.DispatchEvent([user._id], obj, 'updatefiles'); // Fire an event causing this user to update this files
                            });
                        } else {
                            try { obj.fs.unlink(file.path, function (err) { }); } catch (e) { }
                        }
                    }
                }
            }
            res.send('');
        });
    }

    // Subscribe to all events we are allowed to receive
    obj.subscribe = function (userid, target) {
        const user = obj.users[userid];
        const subscriptions = [userid, 'server-global'];
        if (user.siteadmin != null) {
            if (user.siteadmin == 0xFFFFFFFF) subscriptions.push('*');
            if ((user.siteadmin & 2) != 0) {
                if ((user.groups == null) || (user.groups.length == 0)) {
                    // Subscribe to all user changes
                    subscriptions.push('server-users');
                } else {
                    // Subscribe to user changes for some groups
                    for (var i in user.groups) { subscriptions.push('server-users:' + i); }
                }
            }
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
                    const TLSSocket = require('tls').TLSSocket;
                    const tlsoptions = { secureProtocol: ((req.query.tls1only == 1) ? 'TLSv1_method' : 'SSLv23_method'), ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                    const tlsock = new TLSSocket(ser, tlsoptions);
                    tlsock.on('error', function (err) { Debug(1, "CIRA TLS Connection Error ", err); });
                    tlsock.on('secureConnect', function () { Debug(2, "CIRA Secure TLS Connection"); ws._socket.resume(); });

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
                    ws._socket.resume();
                }

                // When data is received from the web socket, forward the data into the associated CIRA cahnnel.
                // If the CIRA connection is pending, the CIRA channel has built-in buffering, so we are ok sending anyway.
                ws.on('message', function (msg) {
                    // WS ---> AMT/TLS
                    msg = msg.toString('binary');
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor
                    //console.log('WS --> AMT', Buffer.from(msg, 'binary').toString('hex'));
                    if (ws.forwardclient.xtls == 1) { ws.forwardclient.write(Buffer.from(msg, 'binary')); } else { ws.forwardclient.write(msg); }
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('CIRA server websocket error from ' + ws._socket.remoteAddress + ', ' + err.toString().split('\r')[0] + '.');
                    Debug(1, 'Websocket relay closed on error.');
                    if (ws.forwardclient && ws.forwardclient.close) { ws.forwardclient.close(); } // TODO: If TLS is used, we need to close the socket that is wrapped by TLS
                });

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
                    //console.log('AMT --> WS', Buffer.from(data, 'binary').toString('hex'));
                    if (data.length > 0) { try { ws.send(Buffer.from(data, 'binary')); } catch (e) { } } // TODO: Add TLS support
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
                        Debug(2, 'TCP relay data to ' + node.host + ', ' + msg.length + ' bytes');
                        if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + msg.toString('hex')); }
                    }
                    msg = msg.toString('binary');
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor
                    ws.forwardclient.write(Buffer.from(msg, 'binary')); // Forward data to the associated TCP connection.
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('Error with relay web socket connection from ' + ws._socket.remoteAddress + ', ' + err.toString().split('\r')[0] + '.');
                    Debug(1, 'Error with relay web socket connection from ' + ws._socket.remoteAddress + '.');
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }
                });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function () {
                    Debug(1, 'Closing relay web socket connection to ' + req.query.host + '.');
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
                    ws._socket.resume();
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    var tlsoptions = { secureProtocol: ((req.query.tls1only == 1) ? 'TLSv1_method' : 'SSLv23_method'), ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                    ws.forwardclient = obj.tls.connect(port, node.host, tlsoptions, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        Debug(2, 'TLS connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws._socket.resume();
                    });
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                }

                // When we receive data on the TCP connection, forward it back into the web socket connection.
                ws.forwardclient.on('data', function (data) {
                    if (obj.parent.debugLevel >= 1) { // DEBUG
                        Debug(2, 'TCP relay data from ' + node.host + ', ' + data.length + ' bytes.');
                        if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + Buffer.from(data, 'binary').toString('hex')); }
                    }
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    try { ws.send(Buffer.from(data, 'binary')); } catch (e) { }
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
                        ws._socket.resume();
                    });
                }
                return;
            }

        });
    }

    // Handle the web socket echo request, just echo back the data sent
    function handleEchoWebSocket(ws, req) {
        const domain = checkUserIpAddress(ws, req);
        if (domain == null) { res.sendStatus(404); return; }
        ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive

        // When data is received from the web socket, echo it back
        ws.on('message', function (data) {
            if (data.toString('utf8') == 'close') {
                try { ws.close(); } catch (e) { console.log(e); }
            } else {
                try { ws.send(data); } catch (e) { console.log(e); }
            }
        });

        // If error, do nothing.
        ws.on('error', function (err) { console.log('Echo server error from ' + ws._socket.remoteAddress + ', ' + err.toString().split('\r')[0] + '.'); });

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
        const domain = getDomain(req);
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
                                                var amthost = req.ip;
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
                                                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
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
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((!req.session) || (req.session == null) || (!req.session.userid) || (obj.parent.args.noserverbackup == 1)) { res.sendStatus(401); return; }
        var user = obj.users[req.session.userid];
        if ((user == null) || ((user.siteadmin & 1) == 0)) { res.sendStatus(401); return; } // Check if we have server backup rights

        // Require modules
        const archive = require('archiver')('zip', { level: 9 }); // Sets the compression method to maximum. 

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
            if (obj.fs.existsSync(filepath)) { archive.file(filepath, { name: filename }); }
        }

        // Finalize the archive (ie we are done appending files but streams have to finish yet) 
        archive.finalize();
    }

    // Handle a server restore request
    function handleRestoreRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((!req.session) || (req.session == null) || (!req.session.userid) || (obj.parent.args.noserverbackup == 1)) { res.sendStatus(401); return; }
        const user = obj.users[req.session.userid];
        if ((user == null) || ((user.siteadmin & 4) == 0)) { res.sendStatus(401); return; } // Check if we have server restore rights

        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            res.send('Server must be restarted, <a href="' + domain.url + '">click here to login</a>.');
            parent.Stop(files.datafile[0].path);
        });
    }

    // Handle a request to download a mesh agent
    obj.handleMeshAgentRequest = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && (obj.parent.config.settings.lockagentdownload == true) && (req.session.userid == null)) { res.sendStatus(401); return; }

        if (req.query.id != null) {
            // Send a specific mesh agent back
            var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
            if (argentInfo == null) { res.sendStatus(404); return; }
            if ((req.query.meshid == null) || (argentInfo.platform != 'win32')) {
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + argentInfo.rname + '"' });
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

                var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

                // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                var xdomain = (domain.dns == null) ? domain.id : '';
                if (xdomain != '') xdomain += "/";
                var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
                if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + obj.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local\r\n"; }
                if (req.query.tag != null) { meshsettings += "Tag=" + req.query.tag + "\r\n"; }
                if ((req.query.installflags != null) && (req.query.installflags != 0)) { meshsettings += "InstallFlags=" + req.query.installflags + "\r\n"; }
                if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += "ignoreProxyFile=1\r\n"; }
                if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + "\r\n"; } }
                if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + "\r\n"; } }

                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + argentInfo.rname + '"' });
                obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: obj.parent.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: obj.parent.meshAgentBinaries[req.query.id].pe });
            }
        } else if (req.query.script != null) {
            // Send a specific mesh install script back
            var scriptInfo = obj.parent.meshAgentInstallScripts[req.query.script];
            if (scriptInfo == null) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="' + scriptInfo.rname + '"' });
            res.send(scriptInfo.data.split('{{{noproxy}}}').join((domain.agentnoproxy === true)?'--no-proxy ':''));
        } else if (req.query.meshcmd != null) {
            // Send meshcmd for a specific platform back
            var agentid = parseInt(req.query.meshcmd);
            // If the agentid is 3 or 4, check if we have a signed MeshCmd.exe
            if ((agentid == 3)) { // Signed Windows MeshCmd.exe x86
                var stats = null, meshCmdPath = obj.path.join(__dirname, 'agents', 'MeshCmd-signed.exe');
                try { stats = obj.fs.statSync(meshCmdPath); } catch (e) { }
                if ((stats != null)) { res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="meshcmd' + ((req.query.meshcmd <= 3) ? '.exe' : '') + '"' }); res.sendFile(meshCmdPath); return; }
            } else if ((agentid == 4)) { // Signed Windows MeshCmd64.exe x64
                var stats = null, meshCmd64Path = obj.path.join(__dirname, 'agents', 'MeshCmd64-signed.exe');
                try { stats = obj.fs.statSync(meshCmd64Path); } catch (e) { }
                if ((stats != null)) { res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : '') + '"' }); res.sendFile(meshCmd64Path); return; }
            }
            // No signed agents, we are going to merge a new MeshCmd.
            if ((agentid < 10000) && (obj.parent.meshAgentBinaries[agentid + 10000] != null)) { agentid += 10000; } // Avoid merging javascript to a signed mesh agent.
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if ((argentInfo == null) || (obj.parent.defaultMeshCmd == null)) { res.sendStatus(404); return; }
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : '') + '"' });
            res.statusCode = 200;
            if (argentInfo.signedMeshCmdPath != null) {
                // If we hav a pre-signed MeshCmd, send that.
                res.sendFile(argentInfo.signedMeshCmdPath);
            } else {
                // Merge JavaScript to a unsigned agent and send that.
                obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: Buffer.from(obj.parent.defaultMeshCmd, 'utf8'), peinfo: argentInfo.pe });
            }
        } else if (req.query.meshaction != null) {
            const domain = checkUserIpAddress(req, res);
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
                        serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                        debugLevel: 0
                    };
                    if (user != null) { meshaction.username = user.name; }
                    var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                    if (obj.args.lanonly != true) { meshaction.serverUrl = ((obj.args.notls == true) ? 'ws://' : 'wss://') + obj.getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="meshaction.txt"' });
                    res.send(JSON.stringify(meshaction, null, ' '));
                });
            }
            else if (req.query.meshaction == 'generic') {
                var meshaction = {
                    username: '',
                    password: '',
                    serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                    serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                    debugLevel: 0
                };
                if (user != null) { meshaction.username = user.name; }
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                if (obj.args.lanonly != true) { meshaction.serverUrl = ((obj.args.notls == true) ? 'ws://' : 'wss://') + obj.getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="meshaction.txt"' });
                res.send(JSON.stringify(meshaction, null, ' '));
            } else if (req.query.meshaction == 'winrouter') {
                var p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.exe');
                if (obj.fs.existsSync(p)) {
                    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="MeshCentralRouter.exe"' });
                    try { res.sendFile(p); } catch (e) { res.sendStatus(404); }
                } else { res.sendStatus(404); }
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
                response += '<td><a rel="noreferrer noopener" target=_blank href="' + req.originalUrl + '?id=' + agentinfo.id + '">' + agentinfo.rname + '</a></td>';
                response += '<td>' + agentinfo.size + '</td><td>' + agentinfo.hash + '</td>';
                response += '<td><a rel="noreferrer noopener" target=_blank href="' + req.originalUrl + '?meshcmd=' + agentinfo.id + '">' + agentinfo.rname.replace('agent', 'cmd') + '</a></td></tr>';
            }
            response += '</table></body></html>';
            res.send(response);
        }
    };

    // Get the web server hostname. This may change if using a domain with a DNS name.
    obj.getWebServerName = function(domain) {
        if (domain.dns != null) return domain.dns;
        return obj.certificates.CommonName;
    }

    // Create a OSX mesh agent installer
    obj.handleMeshOsxAgentRequest = function (req, res) {
        const domain = checkUserIpAddress(req, res);
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

        var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += "/";
        var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + obj.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local\r\n"; }
        if (req.query.tag != null) { meshsettings += "Tag=" + req.query.tag + "\r\n"; }
        if ((req.query.installflags != null) && (req.query.installflags != 0)) { meshsettings += "InstallFlags=" + req.query.installflags + "\r\n"; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += "ignoreProxyFile=1\r\n"; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + "\r\n"; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + "\r\n"; } }

        // Setup the response output
        var archive = require('archiver')('zip', { level: 5 }); // Sets the compression method.
        archive.on('error', function (err) { throw err; });
        try {
            // Set the agent download including the mesh name.
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="MeshAgent-' + mesh.name + '.zip"' });
        } catch (ex) {
            // If the mesh name contains invalid characters, just use a generic name.
            res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="MeshAgent.zip"' });
        }
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
                    if (entry.fileName == 'MeshAgent.mpkg/Contents/distribution.dist') {
                        // This is a special file entry, we need to fix it.
                        zipfile.openReadStream(entry, function (err, readStream) {
                            readStream.on("data", function (data) { if (readStream.xxdata) { readStream.xxdata += data; } else { readStream.xxdata = data; } });
                            readStream.on("end", function () {
                                var meshname = mesh.name.split(']').join('').split('[').join(''); // We can't have ']]' in the string since it will terminate the CDATA.
                                var welcomemsg = 'Welcome to the MeshCentral agent for MacOS\n\nThis installer will install the mesh agent for "' + meshname + '" and allow the administrator to remotely monitor and control this computer over the internet. For more information, go to https://www.meshcommander.com/meshcentral2.\n\nThis software is provided under Apache 2.0 license.\n';
                                var installsize = Math.floor((argentInfo.size + meshsettings.length) / 1024);
                                archive.append(readStream.xxdata.toString().split('###WELCOMEMSG###').join(welcomemsg).split('###INSTALLSIZE###').join(installsize), { name: entry.fileName });
                                zipfile.readEntry();
                            });
                        });
                    } else {
                        // Normal file entry
                        zipfile.openReadStream(entry, function (err, readStream) {
                            if (err) { throw err; }
                            var options = { name: entry.fileName };
                            if (entry.fileName.endsWith('postflight') || entry.fileName.endsWith('Uninstall.command')) { options.mode = 493; }
                            archive.append(readStream, options);
                            readStream.on('end', function () { zipfile.readEntry(); });
                        });
                    }
                }
            });
            zipfile.on("end", function () {
                archive.file(argentInfo.path, { name: "MeshAgent.mpkg/Contents/Packages/internal.pkg/Contents/meshagent_osx64.bin" });
                archive.append(meshsettings, { name: "MeshAgent.mpkg/Contents/Packages/internal.pkg/Contents/meshagent_osx64.msh" });
                archive.finalize();
            });
        });
    }

    // Handle a request to download a mesh settings
    obj.handleMeshSettingsRequest = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
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

        var meshidhex = Buffer.from(req.query.id.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += "/";
        var meshsettings = "MeshName=" + mesh.name + "\r\nMeshType=" + mesh.mtype + "\r\nMeshID=0x" + meshidhex + "\r\nServerID=" + serveridhex + "\r\n";
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.lanonly != true) { meshsettings += "MeshServer=ws" + (obj.args.notls ? '' : 's') + "://" + obj.getWebServerName(domain) + ":" + httpsPort + "/" + xdomain + "agent.ashx\r\n"; } else { meshsettings += "MeshServer=local\r\n"; }
        if (req.query.tag != null) { meshsettings += "Tag=" + req.query.tag + "\r\n"; }
        if ((req.query.installflags != null) && (req.query.installflags != 0)) { meshsettings += "InstallFlags=" + req.query.installflags + "\r\n"; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += "ignoreProxyFile=1\r\n"; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + "\r\n"; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + "\r\n"; } }

        res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="meshagent.msh"' });
        res.send(meshsettings);
    };

    // Handle a request for power events
    obj.handleDevicePowerEvents = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { res.sendStatus(404); return; }
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (req.query.id == null) || (typeof req.query.id != 'string')) { res.sendStatus(401); return; }
        var x = req.query.id.split('/');
        var user = obj.users[req.session.userid];
        if ((x.length != 3) || (x[0] != 'node') || (x[1] != domain.id) || (user == null) || (user.links == null)) { res.sendStatus(401); return; }

        obj.db.Get(req.query.id, function (err, docs) {
            if (docs.length != 1) {
                res.sendStatus(401);
            } else {
                var node = docs[0];

                // Check if we have right to this node
                var rights = 0;
                for (var i in user.links) { if (i == node.meshid) { rights = user.links[i].rights; } }
                if (rights == 0) { res.sendStatus(401); return; }

                // Get the list of power events and send them
                res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="powerevents.csv"' });
                obj.db.getPowerTimeline(node._id, function (err, docs) {
                    var xevents = [ 'Time, State, Previous State' ], prevState = 0;
                    for (var i in docs) {
                        if (docs[i].power != prevState) {
                            prevState = docs[i].power;
                            if (docs[i].oldPower != null) {
                                xevents.push(docs[i].time.toString() + ',' + docs[i].power + ',' + docs[i].oldPower);
                            } else {
                                xevents.push(docs[i].time.toString() + ',' + docs[i].power);
                            }
                        }
                    }
                    res.send(xevents.join('\r\n'));
                });
            }
        });
    }

    // Starts the HTTPS server, this should be called after the user/mesh tables are loaded
    function serverStart() {
        // Start the server, only after users and meshes are loaded from the database.
        if (obj.args.notls || obj.args.tlsoffload) {
            // Setup the HTTP server without TLS
            obj.expressWs = require('express-ws')(obj.app);
        } else {
            // Setup the HTTP server with TLS, use only TLS 1.2 and higher with perfect forward secrecy (PFS).
            const tlsOptions = { cert: obj.certificates.web.cert, key: obj.certificates.web.key, ca: obj.certificates.web.ca, rejectUnauthorized: true, ciphers: "HIGH:!aNULL:!eNULL:!EXPORT:!RSA:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 };
            if (obj.tlsSniCredentials != null) { tlsOptions.SNICallback = TlsSniCallback; } // We have multiple web server certificate used depending on the domain name
            obj.tlsServer = require('https').createServer(tlsOptions, obj.app);
            obj.tlsServer.on('secureConnection', function () { /*console.log('tlsServer secureConnection');*/ });
            obj.tlsServer.on('error', function () { console.log('tlsServer error'); });
            obj.tlsServer.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
            obj.tlsServer.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
            obj.expressWs = require('express-ws')(obj.app, obj.tlsServer);
        }

        // Setup middleware
        obj.app.engine('handlebars', obj.exphbs({ defaultLayout: null })); // defaultLayout: 'main'
        obj.app.set('view engine', 'handlebars');
        if (obj.args.tlsoffload) { obj.app.set('trust proxy', obj.args.tlsoffload); } // Reverse proxy should add the "X-Forwarded-*" headers
        obj.app.use(obj.bodyParser.urlencoded({ extended: false }));
        var sessionOptions = {
            name: 'xid', // Recommended security practice to not use the default cookie name
            httpOnly: true,
            keys: [obj.args.sessionkey], // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
            secure: (obj.args.notls != true) // Use this cookie only over TLS (Check this: https://expressjs.com/en/guide/behind-proxies.html)
        }
        if (obj.args.sessiontime != null) { sessionOptions.maxAge = (obj.args.sessiontime * 60 * 1000); }
        obj.app.use(obj.session(sessionOptions));

        // Add HTTP security headers to all responses
        obj.app.use(function (req, res, next) {
            res.removeHeader("X-Powered-By");
            var domain = req.xdomain = getDomain(req);

            // If this domain has configured headers, use them.
            // Example headers: { 'Strict-Transport-Security': 'max-age=360000;includeSubDomains' };
            //                  { 'Referrer-Policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN', 'X-XSS-Protection': '1; mode=block', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src http: ws: data: 'self';script-src http: 'unsafe-inline';style-src http: 'unsafe-inline'" };
            if ((domain != null) && (domain.httpheaders != null) && (typeof domain.httpheaders == 'object')) { res.set(domain.httpheaders); }

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
                //if (parent.config.settings.accesscontrolalloworigin != null) { headers['Access-Control-Allow-Origin'] = parent.config.settings.accesscontrolalloworigin; }
                return next();
            }
        });

        // Setup all HTTP handlers
        if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req); }); }
        for (var i in parent.config.domains) {
            if (parent.config.domains[i].dns != null) { continue; } // This is a subdomain with a DNS name, no added HTTP bindings needed.
            var url = parent.config.domains[i].url;
            obj.app.get(url, handleRootRequest);
            obj.app.get(url + 'backup.zip', handleBackupRequest);
            obj.app.post(url + 'restoreserver.ashx', handleRestoreRequest);
            obj.app.get(url + 'terms', handleTermsRequest);
            obj.app.post(url + 'login', handleLoginRequest);
            obj.app.post(url + 'tokenlogin', handleLoginRequest);
            obj.app.get(url + 'logout', handleLogoutRequest);
            obj.app.get(url + 'MeshServerRootCert.cer', handleRootCertRequest);
            obj.app.get(url + 'mescript.ashx', handleMeScriptRequest);
            obj.app.post(url + 'changepassword', handlePasswordChangeRequest);
            obj.app.post(url + 'deleteaccount', handleDeleteAccountRequest);
            obj.app.post(url + 'createaccount', handleCreateAccountRequest);
            obj.app.post(url + 'resetpassword', handleResetPasswordRequest);
            obj.app.post(url + 'resetaccount', handleResetAccountRequest);
            obj.app.get(url + 'checkmail', handleCheckMailRequest);
            obj.app.get(url + 'agentinvite', handleAgentInviteRequest);
            obj.app.post(url + 'amtevents.ashx', obj.handleAmtEventRequest);
            obj.app.get(url + 'meshagents', obj.handleMeshAgentRequest);
            obj.app.get(url + 'messenger', handleMessengerRequest);
            obj.app.get(url + 'meshosxagent', obj.handleMeshOsxAgentRequest);
            obj.app.get(url + 'meshsettings', obj.handleMeshSettingsRequest);
            obj.app.get(url + 'devicepowerevents.ashx', obj.handleDevicePowerEvents);
            obj.app.get(url + 'downloadfile.ashx', handleDownloadFile);
            obj.app.post(url + 'uploadfile.ashx', handleUploadFile);
            obj.app.post(url + 'uploadmeshcorefile.ashx', handleUploadMeshCoreFile);
            obj.app.get(url + 'userfiles/*', handleDownloadUserFiles);
            obj.app.ws(url + 'echo.ashx', handleEchoWebSocket);
            obj.app.ws(url + 'meshrelay.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie) { obj.meshRelayHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); }); });
            obj.app.get(url + 'webrelay.ashx', function (req, res) { res.send('Websocket connection expected'); });
            obj.app.get(url + 'health.ashx', function (req, res) { res.send('ok'); }); // TODO: Perform more server checking.
            obj.app.ws(url + 'webrelay.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, handleRelayWebSocket); });
            obj.app.ws(url + 'webider.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, function (ws1, req1, domain, user, cookie) { obj.meshIderHandler.CreateAmtIderSession(obj, obj.db, ws1, req1, obj.args, domain, user); }); });
            obj.app.ws(url + 'control.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, function (ws1, req1, domain, user, cookie) { obj.meshUserHandler.CreateMeshUser(obj, obj.db, ws1, req1, obj.args, domain, user); }); });
            obj.app.get(url + 'logo.png', handleLogoRequest);
            obj.app.get(url + 'welcome.jpg', handleWelcomeImageRequest);

            // Server redirects
            if (parent.config.domains[i].redirects) { for (var j in parent.config.domains[i].redirects) { if (j[0] != '_') { obj.app.get(url + j, handleDomainRedirect); } } }

            // Server picture
            obj.app.get(url + 'serverpic.ashx', function (req, res) {
                // Check if we have "server.jpg" in the data folder, if so, use that.
                if ((parent.configurationFiles != null) && (parent.configurationFiles['server.png'] != null)) {
                    res.set({ 'Content-Type': 'image/png' });
                    res.send(parent.configurationFiles['server.png']);
                } else {
                    // Check if we have "server.jpg" in the data folder, if so, use that.
                    var p = obj.path.join(obj.parent.datapath, 'server.png');
                    if (obj.fs.existsSync(p)) {
                        // Use the data folder server picture
                        try { res.sendFile(p); } catch (e) { res.sendStatus(404); }
                    } else {
                        // Use the default server picture
                        try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/server-256.png')); } catch (e) { res.sendStatus(404); }
                    }
                }
            });

            // Receive mesh agent connections
            obj.app.ws(url + 'agent.ashx', function (ws, req) {
                var domain = checkAgentIpAddress(ws, req);
                if (domain == null) { Debug(1, 'Got agent connection from blocked IP address ' + ws._socket.remoteAddress + ', holding.'); return; }
                // console.log('Agent connect: ' + ws._socket.remoteAddress);
                try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (e) { console.log(e); }
            });

            // Memory Tracking
            if (typeof obj.args.memorytracking == 'number') {
                obj.app.get(url + 'memorytracking.csv', function (req, res) {
                    try { res.sendFile(obj.parent.getConfigFilePath('memorytracking.csv')); } catch (e) { res.sendStatus(404); }
                });
            }

            // Creates a login token using the user/pass that is passed in as URL arguments.
            // For example: https://localhost/createLoginToken.ashx?user=admin&pass=admin&a=3
            // It's not advised to use this to create login tokens since the URL is often logged and you got credentials in the URL.
            // Since it's bad, it's only offered when an untrusted certificate is used as a way to help developers get started. 
            if (isTrustedCert() == false) {
                obj.app.get(url + 'createLoginToken.ashx', function (req, res) {
                    // A web socket session can be authenticated in many ways (Default user, session, user/pass and cookie). Check authentication here.
                    if ((req.query.user != null) && (req.query.pass != null)) {
                        // A user/pass is provided in URL arguments
                        obj.authenticate(req.query.user, req.query.pass, getDomain(req), function (err, userid) {
                            if ((err == null) && (obj.users[userid])) {
                                // User is authenticated, create a token
                                var x = { a: 3 }; for (var i in req.query) { if ((i != 'user') && (i != 'pass')) { x[i] = obj.common.toNumber(req.query[i]); } } x.u = userid;
                                res.send(obj.parent.encodeCookie(x, obj.parent.loginCookieEncryptionKey));
                            } else {
                                res.sendStatus(404);
                            }
                        });
                    } else {
                        res.sendStatus(404);
                    }
                });
            }

            obj.app.get(url + 'stop', function (req, res) { res.send('Stopping Server, <a href="' + url + '">click here to login</a>.'); setTimeout(function () { parent.Stop(); }, 500); });

            // Indicates to ExpressJS that the public folder should be used to serve static files.
            obj.app.use(url, obj.express.static(obj.parent.webPublicPath));

            // Start regular disconnection list flush every 2 minutes.
            obj.wsagentsDisconnectionsTimer = setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000);
        }

        // Start server on a free port
        CheckListenPort(obj.args.port, StartWebServer);
    }

    // Authenticates a session and forwards
    function PerformWSSessionAuth(ws, req, noAuthOk, func) {
        try {
            // Hold this websocket until we are ready.
            ws._socket.pause();

            // Check IP filtering and domain
            var domain = null;
            if (noAuthOk == true) { domain = getDomain(req); } else { domain = checkUserIpAddress(ws, req); } // If auth is required, enforce IP address filtering.
            if (domain == null) { try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-1' })); ws.close(); return; } catch (e) { return; } }

            // A web socket session can be authenticated in many ways (Default user, session, user/pass and cookie). Check authentication here.
            if ((req.query.user != null) && (req.query.pass != null)) {
                // A user/pass is provided in URL arguments
                obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid) {
                    var user = obj.users[userid];
                    if ((err == null) && (user)) {
                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user) == true) {
                            if (req.query.token) {
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired' })); ws.close(); } catch (e) { }
                            } else {
                                checkUserOneTimePassword(req, domain, user, req.query.token, null, function (result) {
                                    if (result == false) {
                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired' })); ws.close(); } catch (e) { }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        func(ws, req, domain, user);
                                    }
                                });
                            }
                        } else {
                            // We are authenticated
                            func(ws, req, domain, user);
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            Debug(1, 'ERR: Websocket bad user/pass auth');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            } else if ((req.query.auth != null) && (req.query.auth != '')) {
                // This is a encrypted cookie authentication
                var cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey, 240); // Cookie with 4 hour timeout
                if ((cookie != null) && (obj.users[cookie.userid]) && (cookie.domainid == domain.id)) {
                    // Valid cookie, we are authenticated
                    func(ws, req, domain, obj.users[cookie.userid], cookie);
                } else {
                    // This is a bad cookie, keep going anyway, maybe we have a active session that will save us.
                    Debug(1, 'ERR: Websocket bad cookie auth: ' + req.query.auth);
                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2' })); ws.close(); } catch (e) { }
                }
                return;
            } else if (req.headers['x-meshauth'] != null) {
                // This is authentication using a custom HTTP header
                var s = req.headers['x-meshauth'].split(',');
                for (var i in s) { s[i] = Buffer.from(s[i], 'base64').toString(); }
                if ((s.length < 2) || (s.length > 3)) { try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2' })); ws.close(); } catch (e) { } return; }
                obj.authenticate(s[0], s[1], domain, function (err, userid) {
                    var user = obj.users[userid];
                    if ((err == null) && (user)) {
                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user) == true) {
                            if (s.length != 3) {
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired' })); ws.close(); } catch (e) { }
                            } else {
                                checkUserOneTimePassword(req, domain, user, s[2], null, function (result) {
                                    if (result == false) {
                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired' })); ws.close(); } catch (e) { }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        func(ws, req, domain, user);
                                    }
                                });
                            }
                        } else {
                            // We are authenticated
                            func(ws, req, domain, user);
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            Debug(1, 'ERR: Websocket bad user/pass auth');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            }

            //console.log(req.headers['x-meshauth']);

            if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
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
                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-4' })); ws.close(); } catch (e) { }
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
            if (args.exactports) { console.error('ERROR: MeshCentral HTTPS server port ' + port + ' not available.'); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server
    function StartWebServer(port) {
        if (port == 0 || port == 65535) return;
        obj.args.port = port;
        if (obj.tlsServer != null) {
            if (obj.args.lanonly == true) {
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
            } else {
                obj.tcpServer = obj.tlsServer.listen(port, function () { console.log('MeshCentral HTTPS server running on ' + certificates.CommonName + ':' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
                obj.parent.updateServerState('servername', certificates.CommonName);
            }
            obj.parent.updateServerState('https-port', port);
            if (args.aliasport != null) { obj.parent.updateServerState('https-aliasport', args.aliasport); }
        } else {
            obj.tcpServer = obj.app.listen(port, function () { console.log('MeshCentral HTTP server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
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
        if ((rights != null) && ((rights & MESHRIGHT_AGENTCONSOLE) != 0) || (user.siteadmin == 0xFFFFFFFF)) { agent.close(disconnectMode); }
    };

    // Send the core module to the mesh agent
    obj.sendMeshAgentCore = function (user, domain, nodeid, coretype, coredata) {
        if (nodeid == null) return;
        const splitnode = nodeid.split('/');
        if ((splitnode.length != 3) || (splitnode[1] != domain.id)) return; // Check that nodeid is valid and part of our domain

        // TODO: This command only works if the agent is connected on the same server. Will not work with multi server peering.
        const agent = obj.wsagents[nodeid];
        if (agent == null) return;

        // Check we have agent rights
        var rights = user.links[agent.dbMeshKey].rights;
        if ((rights != null) && ((rights & MESHRIGHT_AGENTCONSOLE) != 0) || (user.siteadmin == 0xFFFFFFFF)) {
            if (coretype == 'clear') {
                // Clear the mesh agent core
                agent.agentCoreCheck = 1000; // Tell the agent object we are using a custom core.
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0));
            } else if (coretype == 'default') {
                // Reset to default code
                agent.agentCoreCheck = 0; // Tell the agent object we are using a default code
                agent.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else if (coretype == 'recovery') {
                // Reset to recovery core
                agent.agentCoreCheck = 1001; // Tell the agent object we are using the recovery core.
                agent.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else if (coretype == 'custom') {
                agent.agentCoreCheck = 1000; // Tell the agent object we are using a custom core.
                const hash = obj.crypto.createHash('sha384').update(Buffer.from(coredata, 'binary')).digest().toString('binary'); // Perform a SHA384 hash on the core module
                agent.send(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + hash + coredata); // Send the code module to the agent
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
                    var u = users[userid];
                    if (u) {
                        var targets = ['*', 'server-users'];
                        if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                        obj.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                    }
                }
            }

            // If there are any counts left in the old counts, event to zero
            for (userid in obj.sessionsCount) {
                oldcount = obj.sessionsCount[userid];
                if ((oldcount != null) && (oldcount != 0)) {
                    x = userid.split('/');
                    var u = users[userid];
                    if (u) {
                        var targets = ['*', 'server-users'];
                        if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                        obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', username: x[2], count: 0, domain: x[1], nolog: 1, nopeers: 1 })
                    }
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
                var u = users[userid];
                if (u) {
                    var targets = ['*', 'server-users'];
                    if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                    obj.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                    obj.sessionsCount[userid] = newcount;
                }
            }
        }
    };

    // Clone a safe version of a user object, remove everything that is secret.
    obj.CloneSafeUser = function(user) {
        if (typeof user != 'object') { return user; }
        var user2 = obj.common.Clone(user);
        delete user2.hash;
        delete user2.passhint;
        delete user2.salt;
        delete user2.type;
        delete user2.domain;
        delete user2.subscriptions;
        delete user2.passtype;
        if (typeof user2.otpsecret == 'string') { user2.otpsecret = 1; } // Indicates a time secret is present.
        if (typeof user2.otpkeys == 'object') { user2.otpkeys = 0; if (user.otpkeys != null) { for (var i = 0; i < user.otpkeys.keys.length; i++) { if (user.otpkeys.keys[i].u == true) { user2.otpkeys = 1; } } } } // Indicates the number of one time backup codes that are active.
        if (typeof user2.otphkeys == 'object') { user2.otphkeys = user2.otphkeys.length; } // Indicates the number of hardware keys setup
        return user2;
    }

    // Return true if a mobile browser is detected.
    // This code comes from "http://detectmobilebrowsers.com/" and was modified, This is free and unencumbered software released into the public domain. For more information, please refer to the http://unlicense.org/
    function isMobileBrowser(req) {
        //var ua = req.headers['user-agent'].toLowerCase();
        //return (/(android|bb\d+|meego).+mobile|mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(ua) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(ua.substr(0, 4)));
        if (typeof req.headers['user-agent'] != 'string') return false;
        return (req.headers['user-agent'].toLowerCase().indexOf('mobile') >= 0);
    }

    // Return the query string portion of the URL, the ? and anything after.
    function getQueryPortion(req) { var s = req.url.indexOf('?'); if (s == -1) { if (req.body && req.body.urlargs) { return req.body.urlargs; } return ''; } return req.url.substring(s); }

    return obj;
};