/**
* @description MeshCentral web server
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
'use strict';

// SerialTunnel object is used to embed TLS within another connection.
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
module.exports.CreateWebServer = function (parent, db, args, certificates, doneFunc) {
    var obj = {}, i = 0;

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
    obj.meshDeviceFileHandler = require('./meshdevicefile.js');
    obj.meshDesktopMultiplexHandler = require('./meshdesktopmultiplex.js');
    obj.meshIderHandler = require('./amt/amt-ider.js');
    obj.meshUserHandler = require('./meshuser.js');
    obj.interceptor = require('./interceptor');
    obj.uaparser = require('./ua-parser');
    const constants = (obj.crypto.constants ? obj.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Setup WebAuthn / FIDO2
    obj.webauthn = require('./webauthn.js').CreateWebAuthnModule();

    // Variables
    obj.args = args;
    obj.parent = parent;
    obj.filespath = parent.filespath;
    obj.db = db;
    obj.app = obj.express();
    if (obj.args.agentport) { obj.agentapp = obj.express(); }
    if (args.compression !== false) { obj.app.use(require('compression')()); }
    obj.app.disable('x-powered-by');
    obj.tlsServer = null;
    obj.tcpServer = null;
    obj.certificates = certificates;
    obj.users = {};                             // UserID --> User
    obj.meshes = {};                            // MeshID --> Mesh (also called device group)
    obj.userGroups = {};                        // UGrpID --> User Group
    obj.userAllowedIp = args.userallowedip;     // List of allowed IP addresses for users
    obj.agentAllowedIp = args.agentallowedip;   // List of allowed IP addresses for agents
    obj.agentBlockedIp = args.agentblockedip;   // List of blocked IP addresses for agents
    obj.tlsSniCredentials = null;
    obj.dnsDomains = {};
    obj.relaySessionCount = 0;
    obj.relaySessionErrorCount = 0;
    obj.blockedUsers = 0;
    obj.blockedAgents = 0;
    obj.renderPages = null;
    obj.renderLanguages = [];
    obj.destroyedSessions = {};

    // Mesh Rights
    const MESHRIGHT_EDITMESH            = 0x00000001;
    const MESHRIGHT_MANAGEUSERS         = 0x00000002;
    const MESHRIGHT_MANAGECOMPUTERS     = 0x00000004;
    const MESHRIGHT_REMOTECONTROL       = 0x00000008;
    const MESHRIGHT_AGENTCONSOLE        = 0x00000010;
    const MESHRIGHT_SERVERFILES         = 0x00000020;
    const MESHRIGHT_WAKEDEVICE          = 0x00000040;
    const MESHRIGHT_SETNOTES            = 0x00000080;
    const MESHRIGHT_REMOTEVIEWONLY      = 0x00000100;
    const MESHRIGHT_NOTERMINAL          = 0x00000200;
    const MESHRIGHT_NOFILES             = 0x00000400;
    const MESHRIGHT_NOAMT               = 0x00000800;
    const MESHRIGHT_DESKLIMITEDINPUT    = 0x00001000;
    const MESHRIGHT_LIMITEVENTS         = 0x00002000;
    const MESHRIGHT_CHATNOTIFY          = 0x00004000;
    const MESHRIGHT_UNINSTALL           = 0x00008000;
    const MESHRIGHT_NODESKTOP           = 0x00010000;
    const MESHRIGHT_REMOTECOMMAND       = 0x00020000;
    const MESHRIGHT_RESETOFF            = 0x00040000;
    const MESHRIGHT_GUESTSHARING        = 0x00080000;
    const MESHRIGHT_ADMIN               = 0xFFFFFFFF;

    // Site rights
    const SITERIGHT_SERVERBACKUP        = 0x00000001;
    const SITERIGHT_MANAGEUSERS         = 0x00000002;
    const SITERIGHT_SERVERRESTORE       = 0x00000004;
    const SITERIGHT_FILEACCESS          = 0x00000008;
    const SITERIGHT_SERVERUPDATE        = 0x00000010;
    const SITERIGHT_LOCKED              = 0x00000020;
    const SITERIGHT_NONEWGROUPS         = 0x00000040;
    const SITERIGHT_NOMESHCMD           = 0x00000080;
    const SITERIGHT_USERGROUPS          = 0x00000100;
    const SITERIGHT_RECORDINGS          = 0x00000200;
    const SITERIGHT_LOCKSETTINGS        = 0x00000400;
    const SITERIGHT_ALLEVENTS           = 0x00000800;
    const SITERIGHT_NONEWDEVICES        = 0x00001000;
    const SITERIGHT_ADMIN               = 0xFFFFFFFF;

    // Setup SSPI authentication if needed
    if ((obj.parent.platform == 'win32') && (obj.args.nousers != true) && (obj.parent.config != null) && (obj.parent.config.domains != null)) {
        for (i in obj.parent.config.domains) { if (obj.parent.config.domains[i].auth == 'sspi') { var nodeSSPI = require('node-sspi'); obj.parent.config.domains[i].sspi = new nodeSSPI({ retrieveGroups: false, offerBasic: false }); } }
    }

    // Perform hash on web certificate and agent certificate
    obj.webCertificateHash = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.web.cert);
    obj.webCertificateHashs = { '': obj.webCertificateHash };
    obj.webCertificateHashBase64 = Buffer.from(obj.webCertificateHash, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.webCertificateFullHash = parent.certificateOperations.getCertHashBinary(obj.certificates.web.cert);
    obj.webCertificateFullHashs = { '': obj.webCertificateFullHash };
    obj.webCertificateExpire = { '': Date.parse(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.web.cert).validity.notAfter) };
    obj.agentCertificateHashHex = parent.certificateOperations.getPublicKeyHash(obj.certificates.agent.cert);
    obj.agentCertificateHashBase64 = Buffer.from(obj.agentCertificateHashHex, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.agentCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();
    obj.defaultWebCertificateHash = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.webdefault.cert);
    obj.defaultWebCertificateFullHash = parent.certificateOperations.getCertHashBinary(obj.certificates.webdefault.cert);

    // Compute the hash of all of the web certificates for each domain
    for (var i in obj.parent.config.domains) {
        if (obj.parent.config.domains[i].certhash != null) {
            // If the web certificate hash is provided, use it.
            obj.webCertificateHashs[i] = obj.webCertificateFullHashs[i] = Buffer.from(obj.parent.config.domains[i].certhash, 'hex').toString('binary');
            if (obj.parent.config.domains[i].certkeyhash != null) { obj.webCertificateHashs[i] = Buffer.from(obj.parent.config.domains[i].certkeyhash, 'hex').toString('binary'); }
            delete obj.webCertificateExpire[i]; // Expire time is not provided
        } else if ((obj.parent.config.domains[i].dns != null) && (obj.parent.config.domains[i].certs != null)) {
            // If the domain has a different DNS name, use a different certificate hash.
            // Hash the full certificate
            obj.webCertificateFullHashs[i] = parent.certificateOperations.getCertHashBinary(obj.parent.config.domains[i].certs.cert);
            obj.webCertificateExpire[i] = Date.parse(parent.certificateOperations.forge.pki.certificateFromPem(obj.parent.config.domains[i].certs.cert).validity.notAfter);
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
            obj.webCertificateExpire[i] = Date.parse(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.dns[i].cert).validity.notAfter);
        } else if (i != '') {
            // For any other domain, use the default cert.
            obj.webCertificateFullHashs[i] = obj.webCertificateFullHashs[''];
            obj.webCertificateHashs[i] = obj.webCertificateHashs[''];
            obj.webCertificateExpire[i] = obj.webCertificateExpire[''];
        }
    }

    // If we are running the legacy swarm server, compute the hash for that certificate
    if (parent.certificates.swarmserver != null) {
        obj.swarmCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.swarmserver.cert))).getBytes();
        obj.swarmCertificateHash384 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' });
        obj.swarmCertificateHash256 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'binary' });
    }

    // Main lists
    obj.wsagents = {};                // NodeId --> Agent
    obj.wsagentsWithBadWebCerts = {}; // NodeId --> Agent
    obj.wsagentsDisconnections = {};
    obj.wsagentsDisconnectionsTimer = null;
    obj.duplicateAgentsLog = {};
    obj.wssessions = {};              // UserId --> Array Of Sessions
    obj.wssessions2 = {};             // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
    obj.wsPeerSessions = {};          // ServerId --> Array Of "UserId + SessionRnd"
    obj.wsPeerSessions2 = {};         // "UserId + SessionRnd" --> ServerId
    obj.wsPeerSessions3 = {};         // ServerId --> UserId --> [ SessionId ]
    obj.sessionsCount = {};           // Merged session counters, used when doing server peering. UserId --> SessionCount
    obj.wsrelays = {};                // Id -> Relay
    obj.desktoprelays = {};           // Id -> Desktop Multiplexor Relay
    obj.wsPeerRelays = {};            // Id -> { ServerId, Time }
    var tlsSessionStore = {};         // Store TLS session information for quick resume.
    var tlsSessionStoreCount = 0;     // Number of cached TLS session information in store.

    // Setup randoms
    obj.crypto.randomBytes(48, function (err, buf) { obj.httpAuthRandom = buf; });
    obj.crypto.randomBytes(16, function (err, buf) { obj.httpAuthRealm = buf.toString('hex'); });
    obj.crypto.randomBytes(48, function (err, buf) { obj.relayRandom = buf; });

    // Get non-english web pages and emails
    getRenderList();
    getEmailLanguageList();

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

    function EscapeHtml(x) { if (typeof x == 'string') return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == 'boolean') return x; if (typeof x == 'number') return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    // Fetch all users from the database, keep this in memory
    obj.db.GetAllType('user', function (err, docs) {
        obj.common.unEscapeAllLinksFieldName(docs);
        var domainUserCount = {}, i = 0;
        for (i in parent.config.domains) { domainUserCount[i] = 0; }
        for (i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
        for (i in parent.config.domains) {
            if ((parent.config.domains[i].share == null) && (domainUserCount[i] == 0)) {
                // If newaccounts is set to no new accounts, but no accounts exists, temporarly allow account creation.
                //if ((parent.config.domains[i].newaccounts === 0) || (parent.config.domains[i].newaccounts === false)) { parent.config.domains[i].newaccounts = 2; }
                console.log('Server ' + ((i == '') ? '' : (i + ' ')) + 'has no users, next new account will be site administrator.');
            }
        }

        // Fetch all device groups (meshes) from the database, keep this in memory
        // As we load things in memory, we will also be doing some cleaning up.
        // We will not save any clean up in the database right now, instead it will be saved next time there is a change.
        obj.db.GetAllType('mesh', function (err, docs) {
            obj.common.unEscapeAllLinksFieldName(docs);
            for (var i in docs) { obj.meshes[docs[i]._id] = docs[i]; } // Get all meshes, including deleted ones.

            // Fetch all user groups from the database, keep this in memory
            obj.db.GetAllType('ugrp', function (err, docs) {
                obj.common.unEscapeAllLinksFieldName(docs);

                // Perform user group link cleanup
                for (var i in docs) {
                    const ugrp = docs[i];
                    if (ugrp.links != null) {
                        for (var j in ugrp.links) {
                            if (j.startsWith('user/') && (obj.users[j] == null)) { delete ugrp.links[j]; } // User group has a link to a user that does not exist
                            else if (j.startsWith('mesh/') && ((obj.meshes[j] == null) || (obj.meshes[j].deleted != null))) { delete ugrp.links[j]; } // User has a link to a device group that does not exist
                        }
                    }
                    obj.userGroups[docs[i]._id] = docs[i]; // Get all user groups
                }

                // Perform device group link cleanup
                for (var i in obj.meshes) {
                    const mesh = obj.meshes[i];
                    if (mesh.links != null) {
                        for (var j in mesh.links) {
                            if (j.startsWith('ugrp/') && (obj.userGroups[j] == null)) { delete mesh.links[j]; } // Device group has a link to a user group that does not exist
                            else if (j.startsWith('user/') && (obj.users[j] == null)) { delete mesh.links[j]; } // Device group has a link to a user that does not exist
                        }
                    }
                }

                // Perform user link cleanup
                for (var i in obj.users) {
                    const user = obj.users[i];
                    if (user.links != null) {
                        for (var j in user.links) {
                            if (j.startsWith('ugrp/') && (obj.userGroups[j] == null)) { delete user.links[j]; } // User has a link to a user group that does not exist
                            else if (j.startsWith('mesh/') && ((obj.meshes[j] == null) || (obj.meshes[j].deleted != null))) { delete user.links[j]; } // User has a link to a device group that does not exist
                            //else if (j.startsWith('node/') && (obj.nodes[j] == null)) { delete user.links[j]; } // TODO
                        }
                        //if (Object.keys(user.links).length == 0) { delete user.links; }
                    }
                }

                // We loaded the users, device groups and user group state, start the server
                serverStart();
            });
        });
    });

    // Clean up a device, used before saving it in the database
    obj.cleanDevice = function (device) {
        // Check device links, if a link points to an unknown user, remove it.
        if (device.links != null) {
            for (var j in device.links) {
                if ((obj.users[j] == null) && (obj.userGroups[j] == null)) {
                    delete device.links[j];
                    if (Object.keys(device.links).length == 0) { delete device.links; }
                }
            }
        }
        return device;
    }

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
            tlsSessionStore: Object.keys(tlsSessionStore).length,
            blockedUsers: obj.blockedUsers,
            blockedAgents: obj.blockedAgents
        };
    }

    // Agent counters
    obj.agentStats = {
        createMeshAgentCount: 0,
        agentClose: 0,
        agentBinaryUpdate: 0,
        agentMeshCoreBinaryUpdate: 0,
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
        maxDomainDevicesReached: 0,
        agentInTrouble: 0,
        agentInBigTrouble: 0
    }
    obj.getAgentStats = function () { return obj.agentStats; }

    // Traffic counters
    obj.trafficStats = {
        httpRequestCount: 0,
        httpWebSocketCount: 0,
        httpIn: 0,
        httpOut: 0,
        relayCount: {},
        relayIn: {},
        relayOut: {},
        localRelayCount: {},
        localRelayIn: {},
        localRelayOut: {},
        AgentCtrlIn: 0,
        AgentCtrlOut: 0,
        LMSIn: 0,
        LMSOut: 0,
        CIRAIn: 0,
        CIRAOut: 0
    }
    obj.trafficStats.time = Date.now();
    obj.getTrafficStats = function () { return obj.trafficStats; }
    obj.getTrafficDelta = function (oldTraffic) { // Return the difference between the old and new data along with the delta time.
        const data = obj.common.Clone(obj.trafficStats);
        data.time = Date.now();
        const delta = calcDelta(oldTraffic ? oldTraffic : {}, data);
        if (oldTraffic && oldTraffic.time) { delta.delta = (data.time - oldTraffic.time); }
        delta.time = data.time;
        return { current: data, delta: delta }
    }
    function calcDelta(oldData, newData) { // Recursive function that computes the difference of all numbers
        const r = {};
        for (var i in newData) {
            if (typeof newData[i] == 'object') { r[i] = calcDelta(oldData[i] ? oldData[i] : {}, newData[i]); }
            if (typeof newData[i] == 'number') { if (typeof oldData[i] == 'number') { r[i] = (newData[i] - oldData[i]); } else { r[i] = newData[i]; } }
        }
        return r;
    }

    // Keep a record of the last agent issues.
    obj.getAgentIssues = function () { return obj.agentIssues; }
    obj.setAgentIssue = function (agent, issue) { obj.agentIssues.push([new Date().toLocaleString(), agent.remoteaddrport, issue]); while (obj.setAgentIssue.length > 50) { obj.agentIssues.shift(); } }
    obj.agentIssues = [];

    // Authenticate the user
    obj.authenticate = function (name, pass, domain, fn) {
        if ((typeof (name) != 'string') || (typeof (pass) != 'string') || (typeof (domain) != 'object')) { fn(new Error('invalid fields')); return; }
        if (name.startsWith('~t:')) {
            // Login token, try to fetch the token from the database
            obj.db.Get('logintoken-' + name, function (err, docs) {
                if (err != null) { fn(err); return; }
                if ((docs == null) || (docs.length != 1)) { fn(new Error('login token not found')); return; }
                const loginToken = docs[0];
                if ((loginToken.expire != 0) && (loginToken.expire < Date.now())) { fn(new Error('login token expired')); return; }

                // Default strong password hashing (pbkdf2 SHA384)
                require('./pass').hash(pass, loginToken.salt, function (err, hash, tag) {
                    if (err) return fn(err);
                    if (hash == loginToken.hash) {
                        // Login username and password are valid.
                        var user = obj.users[loginToken.userid];
                        if (!user) { fn(new Error('cannot find user')); return; }
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }

                        // Succesful login token authentication
                        var loginOptions = { tokenName: loginToken.name, tokenUser: loginToken.tokenUser };
                        if (loginToken.expire != 0) { loginOptions.expire = loginToken.expire; }
                        return fn(null, user._id, null, loginOptions);
                    }
                    fn(new Error('invalid password'));
                }, 0);
            });
        } else if (domain.auth == 'ldap') {
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
                    if (shortname == null) { fn(new Error('no user identifier')); return; }
                    if (username == null) { username = shortname; }
                    var userid = 'user/' + domain.id + '/' + shortname;
                    var user = obj.users[userid];
                    var email = null;
                    if (domain.ldapuseremail) {
                        email = xxuser[domain.ldapuseremail];
                    } else if (xxuser.mail) { // use default 
                        email = xxuser.mail;
                    }
                    if ('[object Array]' == Object.prototype.toString.call(email)) {
                        // mail may be multivalued in ldap in which case, answer is an array. Use the 1st value.
                        email = email[0];
                    }
                    if (email) { email = email.toLowerCase(); } // it seems some code otherwhere also lowercase the emailaddress. be compatible.

                    if (user == null) {
                        // Create a new user
                        var user = { type: 'user', _id: userid, name: username, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                        if (email) { user['email'] = email; user['emailVerified'] = true; }
                        if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                        if (obj.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                        var usercount = 0;
                        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                        if (usercount == 0) { user.siteadmin = 4294967295; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.

                        // Auto-join any user groups
                        if (typeof domain.newaccountsusergroups == 'object') {
                            for (var i in domain.newaccountsusergroups) {
                                var ugrpid = domain.newaccountsusergroups[i];
                                if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                                var ugroup = obj.userGroups[ugrpid];
                                if (ugroup != null) {
                                    // Add group to the user
                                    if (user.links == null) { user.links = {}; }
                                    user.links[ugroup._id] = { rights: 1 };

                                    // Add user to the group
                                    ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                    db.Set(ugroup);

                                    // Notify user group change
                                    var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msgid: 71, msgArgs: [user.name, ugroup.name], msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                    parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                                }
                            }
                        }

                        obj.users[user._id] = user;
                        obj.db.SetUser(user);
                        var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msgid: 128, msgArgs: [user.name], msg: 'Account created, name is ' + user.name, domain: domain.id };
                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                        obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                        return fn(null, user._id);
                    } else {
                        // This is an existing user
                        // If the display username has changes, update it.
                        if (user.name != username) {
                            user.name = username;
                            obj.db.SetUser(user);
                            var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msgid: 127, msgArgs: [user.name], msg: 'Changed account display name to ' + user.name, domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
                        }
                        // Check if user email has changed
                        var emailreason = null;
                        if (user.email && !email) { // email unset in ldap => unset
                            delete user.email;
                            delete user.emailVerified;
                            emailreason = 'Unset email (no more email in LDAP)'
                        } else if (user.email != email) { // update email
                            user['email'] = email;
                            user['emailVerified'] = true;
                            emailreason = 'Set account email to ' + email + '. Sync with LDAP.';
                        }
                        if (emailreason) {
                            obj.db.SetUser(user);
                            var event = { etype: 'user', userid: userid, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: emailreason, domain: domain.id };
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
                ldap.on('error', function (err) { console.log('ldap error: ', err); });
                ldap.authenticate(name, pass, function (err, xxuser) {
                    try { ldap.close(); } catch (ex) { console.log(ex); } // Close the LDAP object
                    if (err) { fn(new Error('invalid password')); return; }
                    var shortname = null;
                    var email = null;
                    if (domain.ldapuseremail) {
                        email = xxuser[domain.ldapuseremail];
                    } else if (xxuser.mail) {
                        email = xxuser.mail;
                    }
                    if ('[object Array]' == Object.prototype.toString.call(email)) {
                        // mail may be multivalued in ldap in which case, answer would be an array. Use the 1st one.
                        email = email[0];
                    }
                    if (email) { email = email.toLowerCase(); } // it seems some code otherwhere also lowercase the emailaddress. be compatible.
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
                    if (shortname == null) { fn(new Error('no user identifier')); return; }
                    if (username == null) { username = shortname; }
                    var userid = 'user/' + domain.id + '/' + shortname;
                    var user = obj.users[userid];

                    if (user == null) {
                        // This user does not exist, create a new account.
                        var user = { type: 'user', _id: userid, name: username, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                        if (email) { user['email'] = email; user['emailVerified'] = true; }
                        if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                        if (obj.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                        var usercount = 0;
                        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                        if (usercount == 0) { user.siteadmin = 4294967295; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.

                        // Auto-join any user groups
                        if (typeof domain.newaccountsusergroups == 'object') {
                            for (var i in domain.newaccountsusergroups) {
                                var ugrpid = domain.newaccountsusergroups[i];
                                if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                                var ugroup = obj.userGroups[ugrpid];
                                if (ugroup != null) {
                                    // Add group to the user
                                    if (user.links == null) { user.links = {}; }
                                    user.links[ugroup._id] = { rights: 1 };

                                    // Add user to the group
                                    ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                    db.Set(ugroup);

                                    // Notify user group change
                                    var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msgid: 71, msgArgs: [user.name, ugroup.name], msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                    parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                                }
                            }
                        }

                        obj.users[user._id] = user;
                        obj.db.SetUser(user);
                        var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msgid: 128, msgArgs: [user.name], msg: 'Account created, name is ' + user.name, domain: domain.id };
                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                        obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                        return fn(null, user._id);
                    } else {
                        // This is an existing user
                        // If the display username has changes, update it.
                        if (user.name != username) {
                            user.name = username;
                            obj.db.SetUser(user);
                            var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msgid: 127, msgArgs: [user.name], msg: 'Changed account display name to ' + user.name, domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
                        }
                        // Check if user email has changed
                        var emailreason = null;
                        if (user.email && !email) { // email unset in ldap => unset
                            delete user.email;
                            delete user.emailVerified;
                            emailreason = 'Unset email (no more email in LDAP)'
                        } else if (user.email != email) { // update email
                            user['email'] = email;
                            user['emailVerified'] = true;
                            emailreason = 'Set account email to ' + email + '. Sync with LDAP.';
                        }
                        if (emailreason) {
                            obj.db.SetUser(user);
                            var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: emailreason, domain: domain.id };
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
            req.session.messageid = 111; // Access denied.
            res.redirect(domain.url + 'login');
        }
    };
    */

    // Check if the source IP address is in the IP list, return false if not.
    function checkIpAddressEx(req, res, ipList, closeIfThis, redirectUrl) {
        try {
            if (req.connection) {
                // HTTP(S) request
                if (req.clientIp) { for (var i = 0; i < ipList.length; i++) { if (require('ipcheck').match(req.clientIp, ipList[i])) { if (closeIfThis === true) { if (typeof redirectUrl == 'string') { res.redirect(redirectUrl); } else { res.sendStatus(401); } } return true; } } }
                if (closeIfThis === false) { if (typeof redirectUrl == 'string') { res.redirect(redirectUrl); } else { res.sendStatus(401); } }
            } else {
                // WebSocket request
                if (res.clientIp) { for (var i = 0; i < ipList.length; i++) { if (require('ipcheck').match(res.clientIp, ipList[i])) { if (closeIfThis === true) { try { req.close(); } catch (e) { } } return true; } } }
                if (closeIfThis === false) { try { req.close(); } catch (e) { } }
            }
        } catch (e) { console.log(e); } // Should never happen
        return false;
    }

    // Check if the source IP address is allowed, return domain if allowed
    // If there is a fail and null is returned, the request or connection is closed already.
    function checkUserIpAddress(req, res) {
        if ((parent.config.settings.userblockedip != null) && (checkIpAddressEx(req, res, parent.config.settings.userblockedip, true, parent.config.settings.ipblockeduserredirect) == true)) { obj.blockedUsers++; return null; }
        if ((parent.config.settings.userallowedip != null) && (checkIpAddressEx(req, res, parent.config.settings.userallowedip, false, parent.config.settings.ipblockeduserredirect) == false)) { obj.blockedUsers++; return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }
        if ((domain.userblockedip != null) && (checkIpAddressEx(req, res, domain.userblockedip, true, domain.ipblockeduserredirect) == true)) { obj.blockedUsers++; return null; }
        if ((domain.userallowedip != null) && (checkIpAddressEx(req, res, domain.userallowedip, false, domain.ipblockeduserredirect) == false)) { obj.blockedUsers++; return null; }
        return domain;
    }

    // Check if the source IP address is allowed, return domain if allowed
    // If there is a fail and null is returned, the request or connection is closed already.
    function checkAgentIpAddress(req, res) {
        if ((parent.config.settings.agentblockedip != null) && (checkIpAddressEx(req, res, parent.config.settings.agentblockedip, null) == true)) { obj.blockedAgents++; return null; }
        if ((parent.config.settings.agentallowedip != null) && (checkIpAddressEx(req, res, parent.config.settings.agentallowedip, null) == false)) { obj.blockedAgents++; return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if ((domain.agentblockedip != null) && (checkIpAddressEx(req, res, domain.agentblockedip, null) == true)) { obj.blockedAgents++; return null; }
        if ((domain.agentallowedip != null) && (checkIpAddressEx(req, res, domain.agentallowedip, null) == false)) { obj.blockedAgents++; return null; }
        return domain;
    }

    // Return the current domain of the request
    // Request or connection says open regardless of the response
    function getDomain(req) {
        if (req.xdomain != null) { return req.xdomain; } // Domain already set for this request, return it.
        if (req.headers.host != null) { var d = obj.dnsDomains[req.headers.host.split(':')[0].toLowerCase()]; if (d != null) return d; } // If this is a DNS name domain, return it here.
        var x = req.url.split('/');
        if (x.length < 2) return parent.config.domains[''];
        var y = parent.config.domains[x[1].toLowerCase()];
        if ((y != null) && (y.dns == null)) { return parent.config.domains[x[1].toLowerCase()]; }
        return parent.config.domains[''];
    }

    function handleLogoutRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.auth == 'sspi') { parent.debug('web', 'handleLogoutRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        res.set({ 'Cache-Control': 'no-store' });
        // Destroy the user's session to log them out will be re-created next request
        var userid = req.session.userid;
        if (req.session.userid) {
            var user = obj.users[req.session.userid];
            if (user != null) { obj.parent.DispatchEvent(['*'], obj, { etype: 'user', userid: user._id, username: user.name, action: 'logout', msgid: 2, msg: 'Account logout', domain: domain.id }); }
            if (req.session.x) { clearDestroyedSessions(); obj.destroyedSessions[req.session.userid + '/' + req.session.x] = Date.now(); } // Destroy this session
        }
        req.session = null;
        parent.debug('web', 'handleLogoutRequest: success.');

        // If this user was logged in using an authentication strategy and there is a logout URL, use it.
        if ((userid != null) && (domain.authstrategies != null)) {
            const u = userid.split('/')[2];
            if (u.startsWith('~twitter:') && (domain.authstrategies.twitter != null) && (typeof domain.authstrategies.twitter.logouturl == 'string')) { res.redirect(domain.authstrategies.twitter.logouturl); return; }
            if (u.startsWith('~google:') && (domain.authstrategies.google != null) && (typeof domain.authstrategies.google.logouturl == 'string')) { res.redirect(domain.authstrategies.google.logouturl); return; }
            if (u.startsWith('~github:') && (domain.authstrategies.github != null) && (typeof domain.authstrategies.github.logouturl == 'string')) { res.redirect(domain.authstrategies.github.logouturl); return; }
            if (u.startsWith('~reddit:') && (domain.authstrategies.reddit != null) && (typeof domain.authstrategies.reddit.logouturl == 'string')) { res.redirect(domain.authstrategies.reddit.logouturl); return; }
            if (u.startsWith('~azure:') && (domain.authstrategies.azure != null) && (typeof domain.authstrategies.azure.logouturl == 'string')) { res.redirect(domain.authstrategies.azure.logouturl); return; }
            if (u.startsWith('~jumpcloud:') && (domain.authstrategies.jumpcloud != null) && (typeof domain.authstrategies.jumpcloud.logouturl == 'string')) { res.redirect(domain.authstrategies.jumpcloud.logouturl); return; }
            if (u.startsWith('~saml:') && (domain.authstrategies.saml != null) && (typeof domain.authstrategies.saml.logouturl == 'string')) { res.redirect(domain.authstrategies.saml.logouturl); return; }
            if (u.startsWith('~intel:') && (domain.authstrategies.intel != null) && (typeof domain.authstrategies.intel.logouturl == 'string')) { res.redirect(domain.authstrategies.intel.logouturl); return; }
        }

        // This is the default logout redirect to the login page
        if (req.query.key != null) { res.redirect(domain.url + '?key=' + req.query.key); } else { res.redirect(domain.url); }
    }

    // Return an object with 2FA type if 2-step auth can be skipped
    function checkUserOneTimePasswordSkip(domain, user, req, loginOptions) {
        if (parent.config.settings.no2factorauth == true) return null;

        // If this login occured using a login token, no 2FA needed.
        if ((loginOptions != null) && (typeof loginOptions.tokenName === 'string')) { return { twoFactorType: 'tokenlogin' }; }

        // Check if we can skip 2nd factor auth because of the source IP address
        if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
            for (var i in domain.passwordrequirements.skip2factor) { if (require('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) { return { twoFactorType: 'ipaddr' }; } }
        }

        // Check if a 2nd factor cookie is present
        if (typeof req.headers.cookie == 'string') {
            const cookies = req.headers.cookie.split('; ');
            for (var i in cookies) {
                if (cookies[i].startsWith('twofactor=')) {
                    var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(cookies[i].substring(10)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire feild, assume 30 day timeout.
                    if ((twoFactorCookie != null) && ((obj.args.cookieipcheck === false) || (twoFactorCookie.ip == null) || (twoFactorCookie.ip === req.clientIp)) && (twoFactorCookie.userid == user._id)) { return { twoFactorType: 'cookie' }; }
                }
            }
        }

        return null;
    }

    // Return true if this user has 2-step auth active
    function checkUserOneTimePasswordRequired(domain, user, req, loginOptions) {
        // If this login occured using a login token, no 2FA needed.
        if ((loginOptions != null) && (typeof loginOptions.tokenName === 'string')) { return false; }

        // Check if we can skip 2nd factor auth because of the source IP address
        if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
            for (var i in domain.passwordrequirements.skip2factor) { if (require('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) return false; }
        }

        // Check if a 2nd factor cookie is present
        if (typeof req.headers.cookie == 'string') {
            const cookies = req.headers.cookie.split('; ');
            for (var i in cookies) {
                if (cookies[i].startsWith('twofactor=')) {
                    var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(cookies[i].substring(10)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire feild, assume 30 day timeout.
                    if ((twoFactorCookie != null) && ((obj.args.cookieipcheck === false) || (twoFactorCookie.ip == null) || (twoFactorCookie.ip === req.clientIp)) && (twoFactorCookie.userid == user._id)) { return false; }
                }
            }
        }

        // See if SMS 2FA is available
        var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));

        // Check if a 2nd factor is present
        return ((parent.config.settings.no2factorauth !== true) && (sms2fa || (user.otpsecret != null) || ((user.email != null) && (user.emailVerified == true) && (domain.mailserver != null) && (user.otpekey != null)) || ((user.otphkeys != null) && (user.otphkeys.length > 0))));
    }

    // Check the 2-step auth token
    function checkUserOneTimePassword(req, domain, user, token, hwtoken, func) {
        parent.debug('web', 'checkUserOneTimePassword()');
        const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (parent.config.settings.no2factorauth !== true));
        if (twoStepLoginSupported == false) { parent.debug('web', 'checkUserOneTimePassword: not supported.'); func(true); return; };

        // Check if we can use OTP tokens with email
        var otpemail = (domain.mailserver != null);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.email2factor == false)) { otpemail = false; }
        var otpsms = (parent.smsserver != null);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.sms2factor == false)) { otpsms = false; }

        // Check 2FA login cookie
        if ((token != null) && (token.startsWith('cookie='))) {
            var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(token.substring(7)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire feild, assume 30 day timeout.
            if ((twoFactorCookie != null) && ((obj.args.cookieipcheck === false) || (twoFactorCookie.ip == null) || (twoFactorCookie.ip === req.clientIp)) && (twoFactorCookie.userid == user._id)) { func(true, { twoFactorType: 'cookie' }); return; }
        }

        // Check email key
        if ((otpemail) && (user.otpekey != null) && (user.otpekey.d != null) && (user.otpekey.k === token)) {
            var deltaTime = (Date.now() - user.otpekey.d);
            if ((deltaTime > 0) && (deltaTime < 300000)) { // Allow 5 minutes to use the email token (10000 * 60 * 5).
                user.otpekey = {};
                obj.db.SetUser(user);
                parent.debug('web', 'checkUserOneTimePassword: success (email).');
                func(true, { twoFactorType: 'email' });
                return;
            }
        }

        // Check sms key
        if ((otpsms) && (user.phone != null) && (user.otpsms != null) && (user.otpsms.d != null) && (user.otpsms.k === token)) {
            var deltaTime = (Date.now() - user.otpsms.d);
            if ((deltaTime > 0) && (deltaTime < 300000)) { // Allow 5 minutes to use the SMS token (10000 * 60 * 5).
                delete user.otpsms;
                obj.db.SetUser(user);
                parent.debug('web', 'checkUserOneTimePassword: success (SMS).');
                func(true, { twoFactorType: 'sms' });
                return;
            }
        }

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
                        var origin = 'https://' + (domain.dns ? domain.dns : parent.certificates.CommonName);
                        if (httpport != 443) { origin += ':' + httpport; }

                        var assertionExpectations = {
                            challenge: req.session.u2f,
                            origin: origin,
                            factor: 'either',
                            fmt: 'fido-u2f',
                            publicKey: webAuthnKey.publicKey,
                            prevCounter: webAuthnKey.counter,
                            userHandle: Buffer.from(user._id, 'binary').toString('base64')
                        };

                        var webauthnResponse = null;
                        try { webauthnResponse = obj.webauthn.verifyAuthenticatorAssertionResponse(clientAssertionResponse.response, assertionExpectations); } catch (ex) { parent.debug('web', 'checkUserOneTimePassword: exception ' + ex); console.log(ex); }
                        if ((webauthnResponse != null) && (webauthnResponse.verified === true)) {
                            // Update the hardware key counter and accept the 2nd factor
                            webAuthnKey.counter = webauthnResponse.counter;
                            obj.db.SetUser(user);
                            parent.debug('web', 'checkUserOneTimePassword: success (hardware).');
                            func(true, { twoFactorType: 'fido' });
                        } else {
                            parent.debug('web', 'checkUserOneTimePassword: fail (hardware).');
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
        if (user.otpsecret && (typeof (token) == 'string') && (token.length == 6) && (otplib.authenticator.check(token, user.otpsecret) == true)) {
            parent.debug('web', 'checkUserOneTimePassword: success (authenticator).');
            func(true, { twoFactorType: 'otp' });
            return;
        };

        // Check written down keys
        if ((user.otpkeys != null) && (user.otpkeys.keys != null) && (typeof (token) == 'string') && (token.length == 8)) {
            var tokenNumber = parseInt(token);
            for (var i = 0; i < user.otpkeys.keys.length; i++) {
                if ((tokenNumber === user.otpkeys.keys[i].p) && (user.otpkeys.keys[i].u === true)) {
                    parent.debug('web', 'checkUserOneTimePassword: success (one-time).');
                    user.otpkeys.keys[i].u = false; func(true, { twoFactorType: 'backup' }); return;
                }
            }
        }

        // Check OTP hardware key (Yubikey OTP)
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
                yubikeyotp.verifyOTP(request, function (err, results) {
                    if ((results != null) && (results.status == 'OK')) {
                        parent.debug('web', 'checkUserOneTimePassword: success (Yubikey).');
                        func(true, { twoFactorType: 'hwotp' });
                    } else {
                        parent.debug('web', 'checkUserOneTimePassword: fail (Yubikey).');
                        func(false);
                    }
                });
                return;
            }
        }

        parent.debug('web', 'checkUserOneTimePassword: fail (2).');
        func(false);
    }

    // Return a U2F hardware key challenge
    function getHardwareKeyChallenge(req, domain, user, func) {
        delete req.session.u2f;
        if (user.otphkeys && (user.otphkeys.length > 0)) {
            // Get all WebAuthn keys
            var webAuthnKeys = [];
            for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type == 3) { webAuthnKeys.push(user.otphkeys[i]); } }
            if (webAuthnKeys.length > 0) {
                // Generate a Webauthn challenge, this is really easy, no need to call any modules to do this.
                var authnOptions = { type: 'webAuthn', keyIds: [], timeout: 60000, challenge: obj.crypto.randomBytes(64).toString('base64') };
                for (var i = 0; i < webAuthnKeys.length; i++) { authnOptions.keyIds.push(webAuthnKeys[i].keyId); }
                req.session.u2f = authnOptions.challenge;
                parent.debug('web', 'getHardwareKeyChallenge: success');
                func(JSON.stringify(authnOptions));
                return;
            }
        }
        parent.debug('web', 'getHardwareKeyChallenge: fail');
        func('');
    }

    // Redirect a root request to a different page
    function handleRootRedirect(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        res.redirect(domain.rootredirect + getQueryPortion(req));
    }

    function handleLoginRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        // Check if this is a banned ip address
        if (obj.checkAllowLogin(req) == false) {
            // Wait and redirect the user
            setTimeout(function () {
                req.session.messageid = 114; // IP address blocked, try again later.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        // Normally, use the body username/password. If this is a token, use the username/password in the session.
        var xusername = req.body.username, xpassword = req.body.password;
        if ((xusername == null) && (xpassword == null) && (req.body.token != null)) { xusername = req.session.tuser; xpassword = req.session.tpass; }

        // Authenticate the user
        obj.authenticate(xusername, xpassword, domain, function (err, userid, passhint, loginOptions) {
            if (userid) {
                var user = obj.users[userid];

                // Check if we are in maintenance mode
                if ((parent.config.settings.maintenancemode != null) && (user.siteadmin != 4294967295)) {
                    req.session.messageid = 115; // Server under maintenance
                    req.session.loginmode = 1;
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.email != null) && (user.emailVerified == true) && (user.otpekey != null));
                var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                var push2fa = ((parent.firebase != null) && (user.otpdev != null));

                // Check if two factor can be skipped
                const twoFactorSkip = checkUserOneTimePasswordSkip(domain, user, req, loginOptions);

                // Check if this user has 2-step login active
                if ((twoFactorSkip == null) && (req.session.loginmode != 6) && checkUserOneTimePasswordRequired(domain, user, req, loginOptions)) {
                    if ((req.body.hwtoken == '**timeout**')) {
                        delete req.session; // Clear the session
                        res.redirect(domain.url + getQueryPortion(req));
                        return;
                    }

                    if ((req.body.hwtoken == '**email**') && email2fa) {
                        user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                        obj.db.SetUser(user);
                        parent.debug('web', 'Sending 2FA email to: ' + user.email);
                        domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                        req.session.messageid = 2; // "Email sent" message
                        req.session.loginmode = 4;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    if ((req.body.hwtoken == '**sms**') && sms2fa) {
                        // Cause a token to be sent to the user's phone number
                        user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                        obj.db.SetUser(user);
                        parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                        parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                        // Ask for a login token & confirm sms was sent
                        req.session.messageid = 4; // "SMS sent" message
                        req.session.loginmode = 4;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    // Handle device push notification 2FA request
                    // We create a browser cookie, send it back and when the browser connects it's web socket, it will trigger the push notification.
                    if ((req.body.hwtoken == '**push**') && push2fa && ((domain.passwordrequirements == null) || (domain.passwordrequirements.push2factor != false))) {
                        const logincodeb64 = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                        const sessioncode = obj.crypto.randomBytes(24).toString('base64');

                        // Create a browser cookie so the browser can connect using websocket and wait for device accept/reject.
                        const browserCookie = parent.encodeCookie({ a: 'waitAuth', c: logincodeb64, u: user._id, n: user.otpdev, s: sessioncode, d: domain.id });

                        // Get the HTTPS port
                        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port if specified
                        if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
                        if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.

                        // Get the agent connection server name
                        var serverName = obj.getWebServerName(domain);
                        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

                        // Build the connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                        var xdomain = (domain.dns == null) ? domain.id : '';
                        if (xdomain != '') xdomain += '/';
                        var url = 'wss://' + serverName + ':' + httpsPort + '/' + xdomain + '2fahold.ashx?c=' + browserCookie;

                        // Request that the login page wait for device auth
                        req.session.messageid = 5; // "Sending notification..." message
                        req.session.passhint = url;
                        req.session.loginmode = 8;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result, authData) {
                        if (result == false) {
                            var randomWaitTime = 0;

                            // Check if 2FA is allowed for this IP address
                            if (obj.checkAllow2Fa(req) == false) {
                                // Wait and redirect the user
                                setTimeout(function () {
                                    req.session.messageid = 114; // IP address blocked, try again later.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                                return;
                            }

                            // 2-step auth is required, but the token is not present or not valid.
                            if ((req.body.token != null) || (req.body.hwtoken != null)) {
                                randomWaitTime = 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095); // This is a fail, wait a random time. 2 to 6 seconds.
                                req.session.messageid = 108; // Invalid token, try again.
                                if (obj.parent.authlog) { obj.parent.authLog('https', 'Failed 2FA for ' + xusername + ' from ' + cleanRemoteAddr(req.clientIp) + ' port ' + req.port); }
                                parent.debug('web', 'handleLoginRequest: invalid 2FA token');
                                const ua = getUserAgentInfo(req);
                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                                obj.setbad2Fa(req);
                            } else {
                                parent.debug('web', 'handleLoginRequest: 2FA token required');
                            }

                            // Wait and redirect the user
                            setTimeout(function () {
                                req.session.loginmode = 4;
                                if ((user.email != null) && (user.emailVerified == true) && (domain.mailserver != null) && (user.otpekey != null)) { req.session.temail = 1; }
                                if ((user.phone != null) && (parent.smsserver != null)) { req.session.tsms = 1; }
                                if ((user.otpdev != null) && (parent.firebase != null)) { req.session.tpush = 1; }
                                req.session.tuserid = userid;
                                req.session.tuser = xusername;
                                req.session.tpass = xpassword;
                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                            }, randomWaitTime);
                        } else {
                            // Check if we need to remember this device
                            if ((req.body.remembertoken === 'on') && ((domain.twofactorcookiedurationdays == null) || (domain.twofactorcookiedurationdays > 0))) {
                                var maxCookieAge = domain.twofactorcookiedurationdays;
                                if (typeof maxCookieAge != 'number') { maxCookieAge = 30; }
                                const twoFactorCookie = obj.parent.encodeCookie({ userid: user._id, expire: maxCookieAge * 24 * 60 /*, ip: req.clientIp*/ }, obj.parent.loginCookieEncryptionKey);
                                res.cookie('twofactor', twoFactorCookie, { maxAge: (maxCookieAge * 24 * 60 * 60 * 1000), httpOnly: true, sameSite: ((parent.config.settings.cookieipcheck === false) ? 'none' : 'strict'), secure: true });
                            }

                            // Check if email address needs to be confirmed
                            const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))
                            if (emailcheck && (user.emailVerified !== true)) {
                                parent.debug('web', 'Redirecting using ' + user.name + ' to email check login page');
                                req.session.messageid = 3; // "Email verification required" message
                                req.session.loginmode = 7;
                                req.session.passhint = user.email;
                                req.session.cuserid = userid;
                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                return;
                            }

                            // Login successful
                            if (obj.parent.authlog) { obj.parent.authLog('https', 'Accepted password for ' + xusername + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }
                            parent.debug('web', 'handleLoginRequest: successful 2FA login');
                            if (authData != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = authData.twoFactorType; }
                            completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions);
                        }
                    });
                    return;
                }

                // Check if email address needs to be confirmed
                const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))
                if (emailcheck && (user.emailVerified !== true)) {
                    parent.debug('web', 'Redirecting using ' + user.name + ' to email check login page');
                    req.session.messageid = 3; // "Email verification required" message
                    req.session.loginmode = 7;
                    req.session.passhint = user.email;
                    req.session.cuserid = userid;
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                // Login successful
                if (obj.parent.authlog) { obj.parent.authLog('https', 'Accepted password for ' + xusername + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }
                parent.debug('web', 'handleLoginRequest: successful login');
                if (twoFactorSkip != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = twoFactorSkip.twoFactorType; }
                completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions);
            } else {
                // Login failed, log the error
                if (obj.parent.authlog) { obj.parent.authLog('https', 'Failed password for ' + xusername + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }

                // Wait a random delay
                setTimeout(function () {
                    // If the account is locked, display that.
                    if (typeof xusername == 'string') {
                        var xuserid = 'user/' + domain.id + '/' + xusername.toLowerCase();
                        if (err == 'locked') {
                            parent.debug('web', 'handleLoginRequest: login failed, locked account');
                            req.session.messageid = 110; // Account locked.
                            const ua = getUserAgentInfo(req);
                            obj.parent.DispatchEvent(['*', 'server-users', xuserid], obj, { action: 'authfail', userid: xuserid, username: xusername, domain: domain.id, msg: 'User login attempt on locked account from ' + req.clientIp, msgid: 109, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                            obj.setbadLogin(req);
                        } else {
                            parent.debug('web', 'handleLoginRequest: login failed, bad username and password');
                            req.session.messageid = 112; // Login failed, check username and password.
                            const ua = getUserAgentInfo(req);
                            obj.parent.DispatchEvent(['*', 'server-users', xuserid], obj, { action: 'authfail', userid: xuserid, username: xusername, domain: domain.id, msg: 'Invalid user login attempt from ' + req.clientIp, msgid: 110, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                            obj.setbadLogin(req);
                        }
                    }

                    // Clean up login mode and display password hint if present.
                    delete req.session.loginmode;
                    if ((passhint != null) && (passhint.length > 0)) {
                        req.session.passhint = passhint;
                    } else {
                        delete req.session.passhint;
                    }

                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095)); // Wait for 2 to ~6 seconds.
            }
        });
    }

    function completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions) {
        // Check if we need to change the password
        if ((typeof user.passchange == 'number') && ((user.passchange == -1) || ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.reset == 'number') && (user.passchange + (domain.passwordrequirements.reset * 86400) < Math.floor(Date.now() / 1000))))) {
            // Request a password change
            parent.debug('web', 'handleLoginRequest: login ok, password change requested');
            req.session.loginmode = 6;
            req.session.messageid = 113; // Password change requested.
            req.session.resettokenuserid = userid;
            req.session.resettokenusername = xusername;
            req.session.resettokenpassword = xpassword;
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Save login time
        user.pastlogin = user.login;
        user.login = user.access = Math.floor(Date.now() / 1000);
        obj.db.SetUser(user);

        // Notify account login
        const targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
        const ua = getUserAgentInfo(req);
        const loginEvent = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login', domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'] };
        if (loginOptions != null) {
            if ((loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) { loginEvent.tokenName = loginOptions.tokenName; loginEvent.tokenUser = loginOptions.tokenUser; } // If a login token was used, add it to the event.
            if (loginOptions.twoFactorType != null) { loginEvent.twoFactorType = loginOptions.twoFactorType; }
        }
        obj.parent.DispatchEvent(targets, obj, loginEvent);

        // Regenerate session when signing in to prevent fixation
        //req.session.regenerate(function () {
        // Store the user's primary key in the session store to be retrieved, or in this case the entire user object
        delete req.session.u2f;
        delete req.session.loginmode;
        delete req.session.tuserid;
        delete req.session.tuser;
        delete req.session.tpass;
        delete req.session.temail;
        delete req.session.tsms;
        delete req.session.tpush;
        delete req.session.messageid;
        delete req.session.passhint;
        delete req.session.cuserid;
        delete req.session.expire;
        delete req.session.currentNode;
        req.session.userid = userid;
        req.session.ip = req.clientIp;
        setSessionRandom(req);

        // If a login token was used, add this information and expire time to the session.
        if ((loginOptions != null) && (loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) {
            req.session.loginToken = loginOptions.tokenUser;
            if (loginOptions.expire != null) { req.session.expire = loginOptions.expire; }
        }

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
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            });
            */
            parent.debug('web', 'handleLoginRequest: login ok (1)');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); } // Temporary
        } else {
            parent.debug('web', 'handleLoginRequest: login ok (2)');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        }
        //});
    }

    function handleCreateAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handleCreateAccountRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        // Check if we are in maintenance mode
        if (parent.config.settings.maintenancemode != null) {
            req.session.messageid = 115; // Server under maintenance
            req.session.loginmode = 1;
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Always lowercase the email address
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }

        // If the email is the username, set this here.
        if (domain.usernameisemail) { req.body.username = req.body.email; }

        // Accounts that start with ~ are not allowed
        if ((typeof req.body.username != 'string') || (req.body.username.length < 1) || (req.body.username[0] == '~')) {
            parent.debug('web', 'handleCreateAccountRequest: unable to create account (0)');
            req.session.loginmode = 2;
            req.session.messageid = 100; // Unable to create account.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Count the number of users in this domain
        var domainUserCount = 0;
        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { domainUserCount++; } }

        // Check if we are allowed to create new users using the login screen
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true) && (domainUserCount > 0)) {
            parent.debug('web', 'handleCreateAccountRequest: domainUserCount > 1.');
            res.sendStatus(401);
            return;
        }

        // Check if this request is for an allows email domain
        if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains)) {
            var i = -1;
            if (typeof req.body.email == 'string') { i = req.body.email.indexOf('@'); }
            if (i == -1) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (1)');
                req.session.loginmode = 2;
                req.session.messageid = 100; // Unable to create account.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
            var emailok = false, emaildomain = req.body.email.substring(i + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emaildomain == domain.newaccountemaildomains[i].toLowerCase()) { emailok = true; } }
            if (emailok == false) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (2)');
                req.session.loginmode = 2;
                req.session.messageid = 100; // Unable to create account.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        }

        // Check if we exceed the maximum number of user accounts
        obj.db.isMaxType(domain.limits.maxuseraccounts, 'user', domain.id, function (maxExceed) {
            if (maxExceed) {
                parent.debug('web', 'handleCreateAccountRequest: account limit reached');
                req.session.loginmode = 2;
                req.session.messageid = 101; // Account limit reached.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            } else {
                if (!obj.common.validateUsername(req.body.username, 1, 64) || !obj.common.validateEmail(req.body.email, 1, 256) || !obj.common.validateString(req.body.password1, 1, 256) || !obj.common.validateString(req.body.password2, 1, 256) || (req.body.password1 != req.body.password2) || req.body.username == '~' || !obj.common.checkPasswordRequirements(req.body.password1, domain.passwordrequirements)) {
                    parent.debug('web', 'handleCreateAccountRequest: unable to create account (3)');
                    req.session.loginmode = 2;
                    req.session.messageid = 100; // Unable to create account.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                } else {
                    // Check if this email was already verified
                    obj.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (err, docs) {
                        if ((docs != null) && (docs.length > 0)) {
                            parent.debug('web', 'handleCreateAccountRequest: Existing account with this email address');
                            req.session.loginmode = 2;
                            req.session.messageid = 102; // Existing account with this email address.
                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        } else {
                            // Check if there is domain.newAccountToken, check if supplied token is valid
                            if ((domain.newaccountspass != null) && (domain.newaccountspass != '') && (req.body.anewaccountpass != domain.newaccountspass)) {
                                parent.debug('web', 'handleCreateAccountRequest: Invalid account creation token');
                                req.session.loginmode = 2;
                                req.session.messageid = 103; // Invalid account creation token.
                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                return;
                            }
                            // Check if user exists
                            if (obj.users['user/' + domain.id + '/' + req.body.username.toLowerCase()]) {
                                parent.debug('web', 'handleCreateAccountRequest: Username already exists');
                                req.session.loginmode = 2;
                                req.session.messageid = 104; // Username already exists.
                            } else {
                                var user = { type: 'user', _id: 'user/' + domain.id + '/' + req.body.username.toLowerCase(), name: req.body.username, email: req.body.email, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                                if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                                if (obj.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                                if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) { hint = hint.substring(0, 250); } user.passhint = hint; }
                                if (domainUserCount == 0) { user.siteadmin = 4294967295; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.

                                // Auto-join any user groups
                                if (typeof domain.newaccountsusergroups == 'object') {
                                    for (var i in domain.newaccountsusergroups) {
                                        var ugrpid = domain.newaccountsusergroups[i];
                                        if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                                        var ugroup = obj.userGroups[ugrpid];
                                        if (ugroup != null) {
                                            // Add group to the user
                                            if (user.links == null) { user.links = {}; }
                                            user.links[ugroup._id] = { rights: 1 };

                                            // Add user to the group
                                            ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                            db.Set(ugroup);

                                            // Notify user group change
                                            var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                            parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                                        }
                                    }
                                }

                                obj.users[user._id] = user;
                                req.session.userid = user._id;
                                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                                setSessionRandom(req);
                                // Create a user, generate a salt and hash the password
                                require('./pass').hash(req.body.password1, function (err, salt, hash, tag) {
                                    if (err) throw err;
                                    user.salt = salt;
                                    user.hash = hash;
                                    delete user.passtype;
                                    obj.db.SetUser(user);

                                    // Send the verification email
                                    if ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (obj.common.validateEmail(user.email, 1, 256) == true)) { domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key); }
                                }, 0);
                                var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id };
                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                            }
                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        }
                    });
                }
            }
        });
    }

    // Called to process an account password reset
    function handleResetPasswordRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        // Check everything is ok
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        if ((allowAccountReset === false) || (domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.body.rpassword1 != 'string') || (typeof req.body.rpassword2 != 'string') || (req.body.rpassword1 != req.body.rpassword2) || (typeof req.body.rpasswordhint != 'string') || (req.session == null) || (typeof req.session.resettokenusername != 'string') || (typeof req.session.resettokenpassword != 'string')) {
            parent.debug('web', 'handleResetPasswordRequest: checks failed');
            delete req.session.u2f;
            delete req.session.loginmode;
            delete req.session.tuserid;
            delete req.session.tuser;
            delete req.session.tpass;
            delete req.session.resettokenuserid;
            delete req.session.resettokenusername;
            delete req.session.resettokenpassword;
            delete req.session.temail;
            delete req.session.tsms;
            delete req.session.tpush;
            delete req.session.messageid;
            delete req.session.passhint;
            delete req.session.cuserid;
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Authenticate the user
        obj.authenticate(req.session.resettokenusername, req.session.resettokenpassword, domain, function (err, userid, passhint, loginOptions) {
            if (userid) {
                // Login
                var user = obj.users[userid];

                // If we have password requirements, check this here.
                if (!obj.common.checkPasswordRequirements(req.body.rpassword1, domain.passwordrequirements)) {
                    parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (1)');
                    req.session.loginmode = 6;
                    req.session.messageid = 105; // Password rejected, use a different one.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                // Check if the password is the same as a previous one
                obj.checkOldUserPasswords(domain, user, req.body.rpassword1, function (result) {
                    if (result != 0) {
                        // This is the same password as an older one, request a password change again
                        parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (2)');
                        req.session.loginmode = 6;
                        req.session.messageid = 105; // Password rejected, use a different one.
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    } else {
                        // Update the password, use a different salt.
                        require('./pass').hash(req.body.rpassword1, function (err, salt, hash, tag) {
                            const nowSeconds = Math.floor(Date.now() / 1000);
                            if (err) { parent.debug('web', 'handleResetPasswordRequest: hash error.'); throw err; }

                            if (domain.passwordrequirements != null) {
                                // Save password hint if this feature is enabled
                                if ((domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) hint = hint.substring(0, 250); user.passhint = hint; } else { delete user.passhint; }

                                // Save previous password if this feature is enabled
                                if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                    if (user.oldpasswords == null) { user.oldpasswords = []; }
                                    user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                    const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                    if (extraOldPasswords > 0) { user.oldpasswords.splice(0, extraOldPasswords); }
                                }
                            }

                            user.salt = salt;
                            user.hash = hash;
                            user.passchange = user.access = nowSeconds;
                            delete user.passtype;
                            obj.db.SetUser(user);

                            // Event the account change
                            var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'User password reset', domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                            // Login successful
                            parent.debug('web', 'handleResetPasswordRequest: success');
                            req.session.userid = userid;
                            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                            setSessionRandom(req);
                            completeLoginRequest(req, res, domain, obj.users[userid], userid, req.session.tuser, req.session.tpass, direct, loginOptions);
                        }, 0);
                    }
                }, 0);
            } else {
                // Failed, error out.
                parent.debug('web', 'handleResetPasswordRequest: failed authenticate()');
                delete req.session.u2f;
                delete req.session.loginmode;
                delete req.session.tuserid;
                delete req.session.tuser;
                delete req.session.tpass;
                delete req.session.resettokenuserid;
                delete req.session.resettokenusername;
                delete req.session.resettokenpassword;
                delete req.session.temail;
                delete req.session.tsms;
                delete req.session.tpush;
                delete req.session.messageid;
                delete req.session.passhint;
                delete req.session.cuserid;
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        });
    }

    // Called to process an account reset request
    function handleResetAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        if ((allowAccountReset === false) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (obj.args.lanonly == true) || (obj.parent.certificates.CommonName == null) || (obj.parent.certificates.CommonName.indexOf('.') == -1)) { parent.debug('web', 'handleResetAccountRequest: check failed'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        // Always lowercase the email address
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }

        // Get the email from the body or session.
        var email = req.body.email;
        if ((email == null) || (email == '')) { email = req.session.temail; }

        // Check the email string format
        if (!email || checkEmail(email) == false) {
            parent.debug('web', 'handleResetAccountRequest: Invalid email');
            req.session.loginmode = 3;
            req.session.messageid = 106; // Invalid email.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        } else {
            obj.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
                // Remove all accounts that start with ~ since they are special accounts.
                var cleanDocs = [];
                if ((err == null) && (docs.length > 0)) {
                    for (var i in docs) {
                        const user = docs[i];
                        const locked = ((user.siteadmin != null) && (user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)); // No password recovery for locked accounts
                        const specialAccount = (user._id.split('/')[2].startsWith('~')); // No password recovery for special accounts
                        if ((specialAccount == false) && (locked == false)) { cleanDocs.push(user); }
                    }
                }
                docs = cleanDocs;

                // Check if we have any account that match this email address
                if ((err != null) || (docs.length == 0)) {
                    parent.debug('web', 'handleResetAccountRequest: Account not found');
                    req.session.loginmode = 3;
                    req.session.messageid = 1; // If valid, reset mail sent. Instead of "Account not found" (107), we send this hold on message so users can't know if this account exists or not.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                } else {
                    // If many accounts have the same validated e-mail, we are going to use the first one for display, but sent a reset email for all accounts.
                    var responseSent = false;
                    for (var i in docs) {
                        var user = docs[i];
                        if (checkUserOneTimePasswordRequired(domain, user, req) == true) {
                            // Second factor setup, request it now.
                            checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result, authData) {
                                if (result == false) {
                                    if (i == 0) {

                                        // Check if 2FA is allowed for this IP address
                                        if (obj.checkAllow2Fa(req) == false) {
                                            // Wait and redirect the user
                                            setTimeout(function () {
                                                req.session.messageid = 114; // IP address blocked, try again later.
                                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                            }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                                            return;
                                        }

                                        // 2-step auth is required, but the token is not present or not valid.
                                        parent.debug('web', 'handleResetAccountRequest: Invalid 2FA token, try again');
                                        if ((req.body.token != null) || (req.body.hwtoken != null)) {
                                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                            if ((req.body.hwtoken == '**sms**') && sms2fa) {
                                                // Cause a token to be sent to the user's phone number
                                                user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA SMS for password recovery to: ' + user.phone);
                                                parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                                req.session.messageid = 4; // SMS sent.
                                            } else {
                                                req.session.messageid = 108; // Invalid token, try again.
                                                const ua = getUserAgentInfo(req);
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                                                obj.setbad2Fa(req);
                                            }
                                        }
                                        req.session.loginmode = 5;
                                        req.session.temail = email;
                                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                    }
                                } else {
                                    // Send email to perform recovery.
                                    delete req.session.temail;
                                    if (domain.mailserver != null) {
                                        domain.mailserver.sendAccountResetMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);
                                        if (i == 0) {
                                            parent.debug('web', 'handleResetAccountRequest: Hold on, reset mail sent.');
                                            req.session.loginmode = 1;
                                            req.session.messageid = 1; // If valid, reset mail sent.
                                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                        }
                                    } else {
                                        if (i == 0) {
                                            parent.debug('web', 'handleResetAccountRequest: Unable to sent email.');
                                            req.session.loginmode = 3;
                                            req.session.messageid = 109; // Unable to sent email.
                                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                        }
                                    }
                                }
                            });
                        } else {
                            // No second factor, send email to perform recovery.
                            if (domain.mailserver != null) {
                                domain.mailserver.sendAccountResetMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);
                                if (i == 0) {
                                    parent.debug('web', 'handleResetAccountRequest: Hold on, reset mail sent.');
                                    req.session.loginmode = 1;
                                    req.session.messageid = 1; // If valid, reset mail sent.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }
                            } else {
                                if (i == 0) {
                                    parent.debug('web', 'handleResetAccountRequest: Unable to sent email.');
                                    req.session.loginmode = 3;
                                    req.session.messageid = 109; // Unable to sent email.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Handle account email change and email verification request
    function handleCheckAccountEmailRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.mailserver == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.session.cuserid != 'string') || (obj.users[req.session.cuserid] == null) || (!obj.common.validateEmail(req.body.email, 1, 256))) { parent.debug('web', 'handleCheckAccountEmailRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        // Always lowercase the email address
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }

        // Get the email from the body or session.
        var email = req.body.email;
        if ((email == null) || (email == '')) { email = req.session.temail; }

        // Check if this request is for an allows email domain
        if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains)) {
            var i = -1;
            if (typeof req.body.email == 'string') { i = req.body.email.indexOf('@'); }
            if (i == -1) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (1)');
                req.session.loginmode = 7;
                req.session.messageid = 106; // Invalid email.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
            var emailok = false, emaildomain = req.body.email.substring(i + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emaildomain == domain.newaccountemaildomains[i].toLowerCase()) { emailok = true; } }
            if (emailok == false) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (2)');
                req.session.loginmode = 7;
                req.session.messageid = 106; // Invalid email.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        }

        // Check the email string format
        if (!email || checkEmail(email) == false) {
            parent.debug('web', 'handleCheckAccountEmailRequest: Invalid email');
            req.session.loginmode = 7;
            req.session.messageid = 106; // Invalid email.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        } else {
            // Check is email already exists
            obj.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
                if ((err != null) || (docs.length > 0)) {
                    // Email already exitst
                    req.session.messageid = 102; // Existing account with this email address.
                } else {
                    // Update the user and notify of user email address change
                    var user = obj.users[req.session.cuserid];
                    if (user.email != email) {
                        user.email = email;
                        db.SetUser(user);
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Account changed: ' + user.name, domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.DispatchEvent(targets, obj, event);
                    }

                    // Send the verification email
                    domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);

                    // Send the response
                    req.session.messageid = 2; // Email sent.
                }
                req.session.loginmode = 7;
                delete req.session.cuserid;
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            });
        }
    }

    // Called to process a web based email verification request
    function handleCheckMailRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap') || (domain.mailserver == null)) { parent.debug('web', 'handleCheckMailRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        if (req.query.c != null) {
            var cookie = obj.parent.decodeCookie(req.query.c, domain.mailserver.mailCookieEncryptionKey, 30);
            if ((cookie != null) && (cookie.u != null) && (cookie.u.startsWith('user/')) && (cookie.e != null)) {
                var idsplit = cookie.u.split('/');
                if ((idsplit.length != 3) || (idsplit[1] != domain.id)) {
                    parent.debug('web', 'handleCheckMailRequest: Invalid domain.');
                    render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 1, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
                } else {
                    obj.db.Get(cookie.u, function (err, docs) {
                        if (docs.length == 0) {
                            parent.debug('web', 'handleCheckMailRequest: Invalid username.');
                            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 2, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: encodeURIComponent(idsplit[1]).replace(/'/g, '%27') }, req, domain));
                        } else {
                            var user = docs[0];
                            if (user.email != cookie.e) {
                                parent.debug('web', 'handleCheckMailRequest: Invalid e-mail.');
                                render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 3, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') }, req, domain));
                            } else {
                                if (cookie.a == 1) {
                                    // Account email verification
                                    if (user.emailVerified == true) {
                                        parent.debug('web', 'handleCheckMailRequest: email already verified.');
                                        render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 4, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') }, req, domain));
                                    } else {
                                        obj.db.GetUserWithVerifiedEmail(domain.id, user.email, function (err, docs) {
                                            if (docs.length > 0) {
                                                parent.debug('web', 'handleCheckMailRequest: email already in use.');
                                                render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 5, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: encodeURIComponent(user.email).replace(/'/g, '%27') }, req, domain));
                                            } else {
                                                parent.debug('web', 'handleCheckMailRequest: email verification success.');

                                                // Set the verified flag
                                                obj.users[user._id].emailVerified = true;
                                                user.emailVerified = true;
                                                obj.db.SetUser(user);

                                                // Event the change
                                                var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Verified email of user ' + EscapeHtml(user.name) + ' (' + EscapeHtml(user.email) + ')', domain: domain.id };
                                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                                                // Send the confirmation page
                                                render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 6, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') }, req, domain));

                                                // Send a notification
                                                obj.parent.DispatchEvent([user._id], obj, { action: 'notify', title: 'Email verified', value: user.email, nolog: 1, id: Math.random() });

                                                // Send to authlog
                                                if (obj.parent.authlog) { obj.parent.authLog('https', 'Verified email address ' + user.email + ' for user ' + user.name); }
                                            }
                                        });
                                    }
                                } else if (cookie.a == 2) {
                                    // Account reset
                                    if (user.emailVerified != true) {
                                        parent.debug('web', 'handleCheckMailRequest: email not verified.');
                                        render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 7, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: EscapeHtml(user.email), arg2: EscapeHtml(user.name) }, req, domain));
                                    } else {
                                        if (req.query.confirm == 1) {
                                            // Set a temporary password
                                            obj.crypto.randomBytes(16, function (err, buf) {
                                                var newpass = buf.toString('base64').split('=').join('').split('/').join('').split('+').join('');
                                                require('./pass').hash(newpass, function (err, salt, hash, tag) {
                                                    if (err) throw err;

                                                    // Change the password
                                                    var userinfo = obj.users[user._id];
                                                    userinfo.salt = salt;
                                                    userinfo.hash = hash;
                                                    delete userinfo.passtype;
                                                    userinfo.passchange = userinfo.access = Math.floor(Date.now() / 1000);
                                                    delete userinfo.passhint;
                                                    obj.db.SetUser(userinfo);

                                                    // Event the change
                                                    var event = { etype: 'user', userid: user._id, username: userinfo.name, account: obj.CloneSafeUser(userinfo), action: 'accountchange', msg: 'Password reset for user ' + EscapeHtml(user.name), domain: domain.id };
                                                    if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                                    obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                                                    // Send the new password
                                                    render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 8, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), arg1: EscapeHtml(user.name), arg2: EscapeHtml(newpass) }, req, domain));
                                                    parent.debug('web', 'handleCheckMailRequest: send temporary password.');

                                                    // Send to authlog
                                                    if (obj.parent.authlog) { obj.parent.authLog('https', 'Performed account reset for user ' + user.name); }
                                                }, 0);
                                            });
                                        } else {
                                            // Display a link for the user to confirm password reset
                                            // We must do this because GMail will also load this URL a few seconds after the user does and we don't want to cause two password resets.
                                            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 14, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
                                        }
                                    }
                                } else {
                                    render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 9, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
                                }
                            }
                        }
                    });
                }
            } else {
                render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 1, msgid: 10, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            }
        }
    }

    // Called to process an agent invite GET/POST request
    function handleInviteRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleInviteRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((req.body.inviteCode == null) || (req.body.inviteCode == '')) { render(req, res, getRenderPage('invite', req, domain), getRenderArgs({ messageid: 0 }, req, domain)); return; } // No invitation code

        // Each for a device group that has this invite code.
        for (var i in obj.meshes) {
            if ((obj.meshes[i].domain == domain.id) && (obj.meshes[i].deleted == null) && (obj.meshes[i].invite != null) && (obj.meshes[i].invite.codes.indexOf(req.body.inviteCode) >= 0)) {
                // Send invitation link, valid for 1 minute.
                res.redirect(domain.url + 'agentinvite?c=' + parent.encodeCookie({ a: 4, mid: i, f: obj.meshes[i].invite.flags, ag: obj.meshes[i].invite.ag, expire: 1 }, parent.invitationLinkEncryptionKey) + (req.query.key ? ('&key=' + req.query.key) : '') + (req.query.hide ? ('&hide=' + req.query.hide) : ''));
                return;
            }
        }

        render(req, res, getRenderPage('invite', req, domain), getRenderArgs({ messageid: 100 }, req, domain)); // Bad invitation code
    }

    // Called to render the MSTSC (RDP) or SSH web page
    function handleMSTSCRequest(req, res, page) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMSTSCRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        // Check if we are in maintenance mode
        if ((parent.config.settings.maintenancemode != null) && (req.query.loginscreen !== '1')) {
            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            return;
        }

        if (req.query.ws != null) {
            // This is a query with a websocket relay cookie, check that the cookie is valid and use it.
            var rcookie = parent.decodeCookie(req.query.ws, parent.loginCookieEncryptionKey, 60); // Cookie with 1 hour timeout
            if ((rcookie != null) && (rcookie.domainid == domain.id) && (rcookie.nodeid != null) && (rcookie.tcpport != null)) {

                // Fetch the node from the database
                obj.db.Get(rcookie.nodeid, function (err, nodes) {
                    if ((err != null) || (nodes.length != 1)) { res.sendStatus(404); return; }
                    const node = nodes[0];

                    // Check if we have RDP credentials for this device
                    var serverCredentials = ((typeof node.rdp == 'object') && (typeof node.rdp.d == 'string') && (typeof node.rdp.u == 'string') && (typeof node.rdp.p == 'string'));

                    // Render the page
                    render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: req.query.ws, name: encodeURIComponent(req.query.name).replace(/'/g, '%27'), serverCredentials: serverCredentials }, req, domain));
                });
                return;
            }
        }

        // Get the logged in user if present
        var user = null;

        // If there is a login token, use that
        if (req.query.login != null) {
            var ucookie = parent.decodeCookie(req.query.login, parent.loginCookieEncryptionKey, 60); // Cookie with 1 hour timeout
            if ((ucookie != null) && (ucookie.a === 3) && (typeof ucookie.u == 'string')) { user = obj.users[ucookie.u]; }
        }

        // If no token, see if we have an active session
        if ((user == null) && (req.session.userid != null)) { user = obj.users[req.session.userid]; }

        // If still no user, see if we have a default user
        if ((user == null) && (obj.args.user)) { user = obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]; }

        // No user login, exit now
        if (user == null) { res.sendStatus(401); return; }

        // Check the nodeid
        if (req.query.node != null) {
            var nodeidsplit = req.query.node.split('/');
            if (nodeidsplit.length == 1) {
                req.query.node = 'node/' + domain.id + '/' + nodeidsplit[0]; // Format the nodeid correctly
            } else if (nodeidsplit.length == 3) {
                if ((nodeidsplit[0] != 'node') || (nodeidsplit[1] != domain.id)) { req.query.node = null; } // Check the nodeid format
            } else {
                req.query.node = null; // Bad nodeid
            }
        }

        // If there is no nodeid, exit now
        if (req.query.node == null) { render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: '', name: '' }, req, domain)); return; }

        // Fetch the node from the database
        obj.db.Get(req.query.node, function (err, nodes) {
            if ((err != null) || (nodes.length != 1)) { res.sendStatus(404); return; }
            const node = nodes[0];

            // Check if we have RDP credentials for this device
            var serverCredentials = ((typeof node.rdp == 'object') && (typeof node.rdp.d == 'string') && (typeof node.rdp.u == 'string') && (typeof node.rdp.p == 'string'));

            // Check access rights, must have remote control rights
            if ((obj.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { res.sendStatus(401); return; }

            // Figure out the target port
            var port = 0;
            if (page == 'ssh') {
                // SSH port
                port = 22;
                if (typeof node.sshport == 'number') { port = node.sshport; }
            } else {
                // RDP port
                port = 3389;
                if (typeof node.rdpport == 'number') { port = node.rdpport; }
            }
            if (req.query.port != null) { var qport = 0; try { qport = parseInt(req.query.port); } catch (ex) { } if ((typeof qport == 'number') && (qport > 0) && (qport < 65536)) { port = qport; } }

            // Generate a cookie and respond
            var cookie = parent.encodeCookie({ userid: user._id, domainid: user.domain, nodeid: node._id, tcpport: port }, parent.loginCookieEncryptionKey);
            render(req, res, getRenderPage(page, req, domain), getRenderArgs({ cookie: cookie, name: encodeURIComponent(node.name).replace(/'/g, '%27'), serverCredentials: serverCredentials }, req, domain));
        });
    }
    
    // Called to handle push-only requests
    function handleFirebasePushOnlyRelayRequest(req, res) {
        parent.debug('email', 'handleFirebasePushOnlyRelayRequest');
        if ((req.body == null) || (req.body.msg == null) || (obj.parent.firebase == null)) { res.sendStatus(404); return; }
        if (obj.parent.config.firebase.pushrelayserver == null) { res.sendStatus(404); return; }
        if ((typeof obj.parent.config.firebase.pushrelayserver == 'string') && (req.query.key != obj.parent.config.firebase.pushrelayserver)) { res.sendStatus(404); return; }
        var data = null;
        try { data = JSON.parse(req.body.msg) } catch (ex) { res.sendStatus(404); return; }
        if (typeof data != 'object') { res.sendStatus(404); return; }
        if (typeof data.pmt != 'string') { res.sendStatus(404); return; }
        if (typeof data.payload != 'object') { res.sendStatus(404); return; }
        if (typeof data.payload.notification != 'object') { res.sendStatus(404); return; }
        if (typeof data.payload.notification.title != 'string') { res.sendStatus(404); return; }
        if (typeof data.payload.notification.body != 'string') { res.sendStatus(404); return; }
        if (typeof data.options != 'object') { res.sendStatus(404); return; }
        if ((data.options.priority != 'Normal') && (data.options.priority != 'High')) { res.sendStatus(404); return; }
        if ((typeof data.options.timeToLive != 'number') || (data.options.timeToLive < 1)) { res.sendStatus(404); return; }
        parent.debug('email', 'handleFirebasePushOnlyRelayRequest - ok');
        obj.parent.firebase.sendToDevice({ pmt: data.pmt }, data.payload, data.options, function (id, err, errdesc) {
            if (err == null) { res.sendStatus(200); } else { res.sendStatus(500); }
        });
    }

    // Called to handle two-way push notification relay request
    function handleFirebaseRelayRequest(ws, req) {
        parent.debug('email', 'handleFirebaseRelayRequest');
        if (obj.parent.firebase == null) { try { ws.close(); } catch (e) { } return; }
        if (obj.parent.firebase.setupRelay == null) { try { ws.close(); } catch (e) { } return; }
        if (obj.parent.config.firebase.relayserver == null) { try { ws.close(); } catch (e) { } return; }
        if ((typeof obj.parent.config.firebase.relayserver == 'string') && (req.query.key != obj.parent.config.firebase.relayserver)) { res.sendStatus(404); try { ws.close(); } catch (e) { } return; }
        obj.parent.firebase.setupRelay(ws);
    }

    // Called to process an agent invite request
    function handleAgentInviteRequest(req, res) {
        const domain = getDomain(req);
        if ((domain == null) || ((req.query.m == null) && (req.query.c == null))) { parent.debug('web', 'handleAgentInviteRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        if (req.query.c != null) {
            // A cookie is specified in the query string, use that
            var cookie = obj.parent.decodeCookie(req.query.c, obj.parent.invitationLinkEncryptionKey);
            if (cookie == null) { res.sendStatus(404); return; }
            var mesh = obj.meshes[cookie.mid];
            if (mesh == null) { res.sendStatus(404); return; }
            var installflags = cookie.f;
            if (typeof installflags != 'number') { installflags = 0; }
            var showagents = cookie.ag;
            if (typeof showagents != 'number') { showagents = 0; }
            parent.debug('web', 'handleAgentInviteRequest using cookie.');

            // Build the mobile agent URL, this is used to connect mobile devices
            var agentServerName = obj.getWebServerName(domain);
            if (typeof obj.args.agentaliasdns == 'string') { agentServerName = obj.args.agentaliasdns; }
            var xdomain = (domain.dns == null) ? domain.id : '';
            var agentHttpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
            if (obj.args.agentport != null) { agentHttpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
            if (obj.args.agentaliasport != null) { agentHttpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
            var magenturl = 'mc://' + agentServerName + ((agentHttpsPort != 443) ? (':' + agentHttpsPort) : '') + ((xdomain != '') ? ('/' + xdomain) : '') + ',' + obj.agentCertificateHashBase64 + ',' + mesh._id.split('/')[2];

            var meshcookie = parent.encodeCookie({ m: mesh._id.split('/')[2] }, parent.invitationLinkEncryptionKey);
            render(req, res, getRenderPage('agentinvite', req, domain), getRenderArgs({ meshid: meshcookie, serverport: ((args.aliasport != null) ? args.aliasport : args.port), serverhttps: 1, servernoproxy: ((domain.agentnoproxy === true) ? '1' : '0'), meshname: encodeURIComponent(mesh.name).replace(/'/g, '%27'), installflags: installflags, showagents: showagents, magenturl: magenturl }, req, domain));
        } else if (req.query.m != null) {
            // The MeshId is specified in the query string, use that
            var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.m.toLowerCase()];
            if (mesh == null) { res.sendStatus(404); return; }
            var installflags = 0;
            if (req.query.f) { installflags = parseInt(req.query.f); }
            if (typeof installflags != 'number') { installflags = 0; }
            var showagents = 0;
            if (req.query.f) { showagents = parseInt(req.query.ag); }
            if (typeof showagents != 'number') { showagents = 0; }
            parent.debug('web', 'handleAgentInviteRequest using meshid.');

            // Build the mobile agent URL, this is used to connect mobile devices
            var agentServerName = obj.getWebServerName(domain);
            if (typeof obj.args.agentaliasdns == 'string') { agentServerName = obj.args.agentaliasdns; }
            var xdomain = (domain.dns == null) ? domain.id : '';
            var agentHttpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
            if (obj.args.agentport != null) { agentHttpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
            if (obj.args.agentaliasport != null) { agentHttpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
            var magenturl = 'mc://' + agentServerName + ((agentHttpsPort != 443) ? (':' + agentHttpsPort) : '') + ((xdomain != '') ? ('/' + xdomain) : '') + ',' + obj.agentCertificateHashBase64 + ',' + mesh._id.split('/')[2];

            var meshcookie = parent.encodeCookie({ m: mesh._id.split('/')[2] }, parent.invitationLinkEncryptionKey);
            render(req, res, getRenderPage('agentinvite', req, domain), getRenderArgs({ meshid: meshcookie, serverport: ((args.aliasport != null) ? args.aliasport : args.port), serverhttps: 1, servernoproxy: ((domain.agentnoproxy === true) ? '1' : '0'), meshname: encodeURIComponent(mesh.name).replace(/'/g, '%27'), installflags: installflags, showagents: showagents, magenturl: magenturl }, req, domain));
        }
    }

    // Called to process an agent invite request
    function handleUserImageRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleUserImageRequest: failed checks.'); res.sendStatus(404); return; }
        if ((req.session == null) || (req.session.userid == null)) { parent.debug('web', 'handleUserImageRequest: failed checks 2.'); res.sendStatus(404); return; }
        var imageUserId = req.session.userid;
        if ((req.query.id != null)) {
            var user = obj.users[req.session.userid];
            if ((user == null) || (user.siteadmin == null) && ((user.siteadmin & 2) == 0)) { res.sendStatus(404); return; }
            imageUserId = 'user/' + domain.id + '/' + req.query.id;
        }
        obj.db.Get('im' + imageUserId, function (err, docs) {
            if ((err != null) || (docs == null) || (docs.length != 1) || (typeof docs[0].image != 'string')) { res.sendStatus(404); return; }
            var imagebase64 = docs[0].image;
            if (imagebase64.startsWith('data:image/png;base64,')) {
                res.set('Content-Type', 'image/png');
                res.set({ 'Cache-Control': 'no-store' });
                res.send(Buffer.from(imagebase64.substring(22), 'base64'));
            } else if (imagebase64.startsWith('data:image/jpeg;base64,')) {
                res.set('Content-Type', 'image/jpeg');
                res.set({ 'Cache-Control': 'no-store' });
                res.send(Buffer.from(imagebase64.substring(23), 'base64'));
            } else {
                res.sendStatus(404);
            }
        });
    }

    function handleDeleteAccountRequest(req, res, direct) {
        parent.debug('web', 'handleDeleteAccountRequest()');
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handleDeleteAccountRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        var user = null;
        if (req.body.authcookie) {
            // If a authentication cookie is provided, decode it here
            var loginCookie = obj.parent.decodeCookie(req.body.authcookie, obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
            if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { user = obj.users[loginCookie.userid]; }
        } else {
            // Check if the user is logged and we have all required parameters
            if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.userid.split('/')[1] != domain.id)) {
                parent.debug('web', 'handleDeleteAccountRequest: required parameters not present.');
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            } else {
                user = obj.users[req.session.userid];
            }
        }
        if (!user) { parent.debug('web', 'handleDeleteAccountRequest: user not found.'); res.sendStatus(404); return; }
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) { parent.debug('web', 'handleDeleteAccountRequest: account settings locked.'); res.sendStatus(404); return; }

        // Check if the password is correct
        obj.authenticate(user._id.split('/')[2], req.body.apassword1, domain, function (err, userid, passhint, loginOptions) {
            var deluser = obj.users[userid];
            if ((userid != null) && (deluser != null)) {
                // Remove all links to this user
                if (deluser.links != null) {
                    for (var i in deluser.links) {
                        if (i.startsWith('mesh/')) {
                            // Get the device group
                            var mesh = obj.meshes[i];
                            if (mesh) {
                                // Remove user from the mesh
                                if (mesh.links[deluser._id] != null) { delete mesh.links[deluser._id]; parent.db.Set(mesh); }

                                // Notify mesh change
                                var change = 'Removed user ' + deluser.name + ' from group ' + mesh.name;
                                var event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: change, domain: domain.id, invite: mesh.invite };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                parent.DispatchEvent(['*', mesh._id, deluser._id, user._id], obj, event);
                            }
                        } else if (i.startsWith('node/')) {
                            // Get the node and the rights for this node
                            obj.GetNodeWithRights(domain, deluser, i, function (node, rights, visible) {
                                if ((node == null) || (node.links == null) || (node.links[deluser._id] == null)) return;

                                // Remove the link and save the node to the database
                                delete node.links[deluser._id];
                                if (Object.keys(node.links).length == 0) { delete node.links; }
                                db.Set(obj.cleanDevice(node));

                                // Event the node change
                                var event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: ('Removed user device rights for ' + node.name), node: obj.CloneSafeNode(node) }
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                                parent.DispatchEvent(['*', node.meshid, node._id], obj, event);
                            });
                        } else if (i.startsWith('ugrp/')) {
                            // Get the device group
                            var ugroup = obj.userGroups[i];
                            if (ugroup) {
                                // Remove user from the user group
                                if (ugroup.links[deluser._id] != null) { delete ugroup.links[deluser._id]; parent.db.Set(ugroup); }

                                // Notify user group change
                                var change = 'Removed user ' + deluser.name + ' from user group ' + ugroup.name;
                                var event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Removed user ' + deluser.name + ' from user group ' + ugroup.name, addUserDomain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                parent.DispatchEvent(['*', ugroup._id, user._id, deluser._id], obj, event);
                            }
                        }
                    }
                }

                obj.db.Remove('ws' + deluser._id);  // Remove user web state
                obj.db.Remove('nt' + deluser._id);  // Remove notes for this user
                obj.db.Remove('ntp' + deluser._id); // Remove personal notes for this user
                obj.db.Remove('im' + deluser._id);  // Remove image for this user

                // Delete any login tokens
                parent.db.GetAllTypeNodeFiltered(['logintoken-' + deluser._id], domain.id, 'logintoken', null, function (err, docs) {
                    if ((err == null) && (docs != null)) { for (var i = 0; i < docs.length; i++) { parent.db.Remove(docs[i]._id, function () { }); } }
                });

                // Delete all files on the server for this account
                try {
                    var deluserpath = obj.getServerRootFilePath(deluser);
                    if (deluserpath != null) { obj.deleteFolderRec(deluserpath); }
                } catch (e) { }

                // Remove the user
                obj.db.Remove(deluser._id);
                delete obj.users[deluser._id];
                req.session = null;
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: deluser._id, username: deluser.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
                parent.debug('web', 'handleDeleteAccountRequest: removed user.');
            } else {
                parent.debug('web', 'handleDeleteAccountRequest: auth failed.');
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            }
        });
    }

    // Check a user's password
    obj.checkUserPassword = function (domain, user, password, func) {
        // Check the old password
        if (user.passtype != null) {
            // IIS default clear or weak password hashing (SHA-1)
            require('./pass').iishash(user.passtype, password, user.salt, function (err, hash) {
                if (err) { parent.debug('web', 'checkUserPassword: SHA-1 fail.'); return func(false); }
                if (hash == user.hash) {
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { parent.debug('web', 'checkUserPassword: SHA-1 locked.'); return func(false); } // Account is locked
                    parent.debug('web', 'checkUserPassword: SHA-1 ok.');
                    return func(true); // Allow password change
                }
                func(false);
            });
        } else {
            // Default strong password hashing (pbkdf2 SHA384)
            require('./pass').hash(password, user.salt, function (err, hash, tag) {
                if (err) { parent.debug('web', 'checkUserPassword: pbkdf2 SHA384 fail.'); return func(false); }
                if (hash == user.hash) {
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { parent.debug('web', 'checkUserPassword: pbkdf2 SHA384 locked.'); return func(false); } // Account is locked
                    parent.debug('web', 'checkUserPassword: pbkdf2 SHA384 ok.');
                    return func(true); // Allow password change
                }
                func(false);
            }, 0);
        }
    }

    // Check a user's old passwords
    // Callback: 0=OK, 1=OldPass, 2=CommonPass
    obj.checkOldUserPasswords = function (domain, user, password, func) {
        // Check how many old passwords we need to check
        if ((domain.passwordrequirements != null) && (typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
            if (user.oldpasswords != null) {
                const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                if (extraOldPasswords > 0) { user.oldpasswords.splice(0, extraOldPasswords); }
            }
        } else {
            delete user.oldpasswords;
        }

        // If there is no old passwords, exit now.
        var oldPassCount = 1;
        if (user.oldpasswords != null) { oldPassCount += user.oldpasswords.length; }
        var oldPassCheckState = { response: 0, count: oldPassCount, user: user, func: func };

        // Test against common passwords if this feature is enabled
        // Example of common passwords: 123456789, password123
        if ((domain.passwordrequirements != null) && (domain.passwordrequirements.bancommonpasswords == true)) {
            oldPassCheckState.count++;
            require('wildleek')(password).then(function (wild) {
                if (wild == true) { oldPassCheckState.response = 2; }
                if (--oldPassCheckState.count == 0) { oldPassCheckState.func(oldPassCheckState.response); }
            });
        }

        // Try current password
        require('./pass').hash(password, user.salt, function oldPassCheck(err, hash, tag) {
            if ((err == null) && (hash == tag.user.hash)) { tag.response = 1; }
            if (--tag.count == 0) { tag.func(tag.response); }
        }, oldPassCheckState);

        // Try each old password
        if (user.oldpasswords != null) {
            for (var i in user.oldpasswords) {
                const oldpassword = user.oldpasswords[i];
                // Default strong password hashing (pbkdf2 SHA384)
                require('./pass').hash(password, oldpassword.salt, function oldPassCheck(err, hash, tag) {
                    if ((err == null) && (hash == tag.oldPassword.hash)) { tag.state.response = 1; }
                    if (--tag.state.count == 0) { tag.state.func(tag.state.response); }
                }, { oldPassword: oldpassword, state: oldPassCheckState });
            }
        }
    }

    // Handle password changes
    function handlePasswordChangeRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handlePasswordChangeRequest: failed checks (1).'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token

        // Check if the user is logged and we have all required parameters
        if (!req.session || !req.session.userid || !req.body.apassword0 || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.userid.split('/')[1] != domain.id)) {
            parent.debug('web', 'handlePasswordChangeRequest: failed checks (2).');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Get the current user
        var user = obj.users[req.session.userid];
        if (!user) {
            parent.debug('web', 'handlePasswordChangeRequest: user not found.');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Check account settings locked
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) {
            parent.debug('web', 'handlePasswordChangeRequest: account settings locked.');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Check old password
        obj.checkUserPassword(domain, user, req.body.apassword1, function (result) {
            if (result == true) {
                // Check if the new password is allowed, only do this if this feature is enabled.
                parent.checkOldUserPasswords(domain, user, command.newpass, function (result) {
                    if (result == 1) {
                        parent.debug('web', 'handlePasswordChangeRequest: old password reuse attempt.');
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    } else if (result == 2) {
                        parent.debug('web', 'handlePasswordChangeRequest: commonly used password use attempt.');
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    } else {
                        // Update the password
                        require('./pass').hash(req.body.apassword1, function (err, salt, hash, tag) {
                            const nowSeconds = Math.floor(Date.now() / 1000);
                            if (err) { parent.debug('web', 'handlePasswordChangeRequest: hash error.'); throw err; }
                            if (domain.passwordrequirements != null) {
                                // Save password hint if this feature is enabled
                                if ((domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) hint = hint.substring(0, 250); user.passhint = hint; } else { delete user.passhint; }

                                // Save previous password if this feature is enabled
                                if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                    if (user.oldpasswords == null) { user.oldpasswords = []; }
                                    user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                    const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                    if (extraOldPasswords > 0) { user.oldpasswords.splice(0, extraOldPasswords); }
                                }
                            }
                            user.salt = salt;
                            user.hash = hash;
                            user.passchange = user.access = nowSeconds;
                            delete user.passtype;

                            obj.db.SetUser(user);
                            req.session.viewmode = 2;
                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                            obj.parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', userid: user._id, username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id });
                        }, 0);
                    }
                });
            }
        });
    }

    // Called when a strategy login occured
    // This is called after a succesful Oauth to Twitter, Google, GitHub...
    function handleStrategyLogin(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        parent.debug('web', 'handleStrategyLogin: ' + JSON.stringify(req.user));
        if ((req.user != null) && (req.user.sid != null)) {
            const userid = 'user/' + domain.id + '/' + req.user.sid;
            var user = obj.users[userid];
            if (user == null) {
                var newAccountAllowed = false;
                var newAccountRealms = null;

                if (domain.newaccounts === true) { newAccountAllowed = true; }
                if (obj.common.validateStrArray(domain.newaccountrealms)) { newAccountRealms = domain.newaccountrealms; }

                if ((domain.authstrategies != null) && (domain.authstrategies[req.user.strategy] != null)) {
                    if (domain.authstrategies[req.user.strategy].newaccounts === true) { newAccountAllowed = true; }
                    if (obj.common.validateStrArray(domain.authstrategies[req.user.strategy].newaccountrealms)) { newAccountRealms = domain.authstrategies[req.user.strategy].newaccountrealms; }
                }

                if (newAccountAllowed === true) {
                    // Create the user
                    parent.debug('web', 'handleStrategyLogin: creating new user: ' + userid);
                    user = { type: 'user', _id: userid, name: req.user.name, email: req.user.email, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                    if (req.user.email != null) { user.email = req.user.email; user.emailVerified = true; }
                    if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; } // New accounts automatically assigned server rights.
                    if (domain.authstrategies[req.user.strategy].newaccountsrights) { user.siteadmin = obj.common.meshServerRightsArrayToNumber(domain.authstrategies[req.user.strategy].newaccountsrights); } // If there are specific SSO server rights, use these instead.
                    if (newAccountRealms) { user.groups = newAccountRealms; } // New accounts automatically part of some groups (Realms).
                    obj.users[userid] = user;

                    // Auto-join any user groups
                    var newaccountsusergroups = null;
                    if (typeof domain.newaccountsusergroups == 'object') { newaccountsusergroups = domain.newaccountsusergroups; }
                    if (typeof domain.authstrategies[req.user.strategy].newaccountsusergroups == 'object') { newaccountsusergroups = domain.authstrategies[req.user.strategy].newaccountsusergroups; }
                    if (newaccountsusergroups) {
                        for (var i in newaccountsusergroups) {
                            var ugrpid = newaccountsusergroups[i];
                            if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                            var ugroup = obj.userGroups[ugrpid];
                            if (ugroup != null) {
                                // Add group to the user
                                if (user.links == null) { user.links = {}; }
                                user.links[ugroup._id] = { rights: 1 };

                                // Add user to the group
                                ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                db.Set(ugroup);

                                // Notify user group change
                                var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                            }
                        }
                    }

                    // Save the user
                    obj.db.SetUser(user);

                    // Event user creation
                    var targets = ['*', 'server-users'];
                    var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, username is ' + user.name, domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    parent.DispatchEvent(targets, obj, event);

                    req.session.userid = userid;
                    setSessionRandom(req);
                } else {
                    // New users not allowed
                    parent.debug('web', 'handleStrategyLogin: Can\'t create new accounts');
                    req.session.loginmode = 1;
                    req.session.messageid = 100; // Unable to create account.
                    res.redirect(domain.url + getQueryPortion(req));
                    return;
                }
            } else {
                // Login success
                var userChange = false;
                if ((req.user.name != null) && (req.user.name != user.name)) { user.name = req.user.name; userChange = true; }
                if ((req.user.email != null) && (req.user.email != user.email)) { user.email = req.user.email; user.emailVerified = true; userChange = true; }
                if (userChange) {
                    obj.db.SetUser(user);

                    // Event user creation
                    var targets = ['*', 'server-users'];
                    var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Account changed', domain: domain.id };
                    if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    parent.DispatchEvent(targets, obj, event);
                }
                parent.debug('web', 'handleStrategyLogin: succesful login: ' + userid);
                req.session.userid = userid;
                setSessionRandom(req);
            }
        }
        //res.redirect(domain.url); // This does not handle cookie correctly.
        res.set('Content-Type', 'text/html');
        res.end('<html><head><meta http-equiv="refresh" content=0;url="' + domain.url + '"></head><body></body></html>');
    }

    // Indicates that any request to "/" should render "default" or "login" depending on login state
    function handleRootRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (!obj.args) { parent.debug('web', 'handleRootRequest: no obj.args.'); res.sendStatus(500); return; }

        // If the session is expired, clear it.
        if ((req.session != null) && (typeof req.session.expire == 'number') && ((req.session.expire - Date.now()) <= 0)) { for (var i in req.session) { delete req.session[i]; } }

        // Check if we are in maintenance mode
        if ((parent.config.settings.maintenancemode != null) && (req.query.loginscreen !== '1')) {
            parent.debug('web', 'handleLoginRequest: Server under maintenance.');
            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            return;
        }

        // If set and there is no user logged in, redirect the root page. Make sure not to redirect if /login is used
        if ((typeof domain.unknownuserrootredirect == 'string') && ((req.session == null) || (req.session.userid == null))) {
            var q = require('url').parse(req.url, true);
            if (!q.pathname.endsWith('/login')) { res.redirect(domain.unknownuserrootredirect + getQueryPortion(req)); return; }
        }
        
        if ((domain.sspi != null) && ((req.query.login == null) || (obj.parent.loginCookieEncryptionKey == null))) {
            // Login using SSPI
            domain.sspi.authenticate(req, res, function (err) {
                if ((err != null) || (req.connection.user == null)) {
                    if (obj.parent.authlog) { obj.parent.authLog('https', 'Failed SSPI-auth for ' + req.connection.user + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }
                    parent.debug('web', 'handleRootRequest: SSPI auth required.');
                    res.end('Authentication Required...');
                } else {
                    if (obj.parent.authlog) { obj.parent.authLog('https', 'Accepted SSPI-auth for ' + req.connection.user + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }
                    parent.debug('web', 'handleRootRequest: SSPI auth ok.');
                    handleRootRequestEx(req, res, domain, direct);
                }
            });
        } else if (req.query.user && req.query.pass) {
            // User credentials are being passed in the URL. WARNING: Putting credentials in a URL is bad security... but people are requesting this option.
            obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid, passhint, loginOptions) {
                if (obj.parent.authlog) { obj.parent.authLog('https', 'Accepted password for ' + userid + ' from ' + req.clientIp + ' port ' + req.connection.remotePort); }
                parent.debug('web', 'handleRootRequest: user/pass in URL auth ok.');
                req.session.userid = userid;
                delete req.session.currentNode;
                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                setSessionRandom(req);
                handleRootRequestEx(req, res, domain, direct);
            });
        } else if ((req.session != null) && (typeof req.session.loginToken == 'string')) {
            // Check if the loginToken is still valid
            obj.db.Get('logintoken-' + req.session.loginToken, function (err, docs) {
                if ((err != null) || (docs == null) || (docs.length != 1) || (docs[0].tokenUser != req.session.loginToken)) { for (var i in req.session) { delete req.session[i]; } }
                handleRootRequestEx(req, res, domain, direct); // Login using a different system
            });
        } else {
            // Login using a different system
            handleRootRequestEx(req, res, domain, direct);
        }
    }

    function handleRootRequestEx(req, res, domain, direct) {
        var nologout = false, user = null;
        res.set({ 'Cache-Control': 'no-store' });

        // Check if we have an incomplete domain name in the path
        if ((domain.id != '') && (domain.dns == null) && (req.url.split('/').length == 2)) {
            parent.debug('web', 'handleRootRequestEx: incomplete domain name in the path.');
            res.redirect(domain.url + getQueryPortion(req)); // BAD***
            return;
        }

        if (obj.args.nousers == true) {
            // If in single user mode, setup things here.
            delete req.session.loginmode;
            req.session.userid = 'user/' + domain.id + '/~';
            delete req.session.currentNode;
            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
            setSessionRandom(req);
            if (obj.users[req.session.userid] == null) {
                // Create the dummy user ~ with impossible password
                parent.debug('web', 'handleRootRequestEx: created dummy user in nouser mode.');
                obj.users[req.session.userid] = { type: 'user', _id: req.session.userid, name: '~', email: '~', domain: domain.id, siteadmin: 4294967295 };
                obj.db.SetUser(obj.users[req.session.userid]);
            }
        } else if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
            // If a default user is active, setup the session here.
            parent.debug('web', 'handleRootRequestEx: auth using default user.');
            delete req.session.loginmode;
            req.session.userid = 'user/' + domain.id + '/' + obj.args.user.toLowerCase();
            delete req.session.currentNode;
            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
            setSessionRandom(req);
        } else if (req.query.login && (obj.parent.loginCookieEncryptionKey != null)) {
            var loginCookie = obj.parent.decodeCookie(req.query.login, obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
            //if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // If the cookie if binded to an IP address, check here.
            if ((loginCookie != null) && (loginCookie.a == 3) && (loginCookie.u != null) && (loginCookie.u.split('/')[1] == domain.id)) {
                // If a login cookie was provided, setup the session here.
                parent.debug('web', 'handleRootRequestEx: cookie auth ok.');
                delete req.session.loginmode;
                req.session.userid = loginCookie.u;
                delete req.session.currentNode;
                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                setSessionRandom(req);
            } else {
                parent.debug('web', 'handleRootRequestEx: cookie auth failed.');
            }
        } else if (domain.sspi != null) {
            // SSPI login (Windows only)
            //console.log(req.connection.user, req.connection.userSid);
            if ((req.connection.user == null) || (req.connection.userSid == null)) {
                parent.debug('web', 'handleRootRequestEx: SSPI no user auth.');
                res.sendStatus(404); return;
            } else {
                nologout = true;
                req.session.userid = 'user/' + domain.id + '/' + req.connection.user.toLowerCase();
                req.session.usersid = req.connection.userSid;
                req.session.usersGroups = req.connection.userGroups;
                delete req.session.currentNode;
                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                setSessionRandom(req);

                // Check if this user exists, create it if not.
                user = obj.users[req.session.userid];
                if ((user == null) || (user.sid != req.session.usersid)) {
                    // Create the domain user
                    var usercount = 0, user2 = { type: 'user', _id: req.session.userid, name: req.connection.user, domain: domain.id, sid: req.session.usersid, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000) };
                    if (domain.newaccountsrights) { user2.siteadmin = domain.newaccountsrights; }
                    if (obj.common.validateStrArray(domain.newaccountrealms)) { user2.groups = domain.newaccountrealms; }
                    for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                    if (usercount == 0) { user2.siteadmin = 4294967295; } // If this is the first user, give the account site admin.

                    // Auto-join any user groups
                    if (typeof domain.newaccountsusergroups == 'object') {
                        for (var i in domain.newaccountsusergroups) {
                            var ugrpid = domain.newaccountsusergroups[i];
                            if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                            var ugroup = obj.userGroups[ugrpid];
                            if (ugroup != null) {
                                // Add group to the user
                                if (user2.links == null) { user2.links = {}; }
                                user2.links[ugroup._id] = { rights: 1 };

                                // Add user to the group
                                ugroup.links[user2._id] = { userid: user2._id, name: user2.name, rights: 1 };
                                db.Set(ugroup);

                                // Notify user group change
                                var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user2.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                parent.DispatchEvent(['*', ugroup._id, user2._id], obj, event);
                            }
                        }
                    }

                    obj.users[req.session.userid] = user2;
                    obj.db.SetUser(user2);
                    var event = { etype: 'user', userid: req.session.userid, username: req.connection.user, account: obj.CloneSafeUser(user2), action: 'accountcreate', msg: 'Domain account created, user ' + req.connection.user, domain: domain.id };
                    if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                    parent.debug('web', 'handleRootRequestEx: SSPI new domain user.');
                }
            }
        }

        // Figure out the minimal password requirement
        var passRequirements = null;
        if (domain.passwordrequirements != null) {
            if (domain.passrequirementstr == null) {
                var passRequirements = {};
                if (typeof domain.passwordrequirements.min == 'number') { passRequirements.min = domain.passwordrequirements.min; }
                if (typeof domain.passwordrequirements.max == 'number') { passRequirements.max = domain.passwordrequirements.max; }
                if (typeof domain.passwordrequirements.upper == 'number') { passRequirements.upper = domain.passwordrequirements.upper; }
                if (typeof domain.passwordrequirements.lower == 'number') { passRequirements.lower = domain.passwordrequirements.lower; }
                if (typeof domain.passwordrequirements.numeric == 'number') { passRequirements.numeric = domain.passwordrequirements.numeric; }
                if (typeof domain.passwordrequirements.nonalpha == 'number') { passRequirements.nonalpha = domain.passwordrequirements.nonalpha; }
                domain.passwordrequirementsstr = encodeURIComponent(JSON.stringify(passRequirements));
            }
            passRequirements = domain.passwordrequirementsstr;
        }

        // If a user exists and is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid && obj.users[req.session.userid]) {
            const user = obj.users[req.session.userid];

            // Check if we are in maintenance mode
            if ((parent.config.settings.maintenancemode != null) && (user.siteadmin != 4294967295)) {
                req.session.messageid = 115; // Server under maintenance
                req.session.loginmode = 1;
                res.redirect(domain.url);
                return;
            }

            // If the request has a "meshmessengerid", redirect to MeshMessenger
            // This situation happens when you get a push notification for a chat session, but are not logged in.
            if (req.query.meshmessengerid != null) {
                res.redirect(domain.url + 'messenger?id=' + req.query.meshmessengerid + ((req.query.key != null) ? ('&key=' + req.query.key) : ''));
                return;
            }

            const xdbGetFunc = function dbGetFunc(err, states) {
                if (dbGetFunc.req.session.userid.split('/')[1] != domain.id) { // Check if the session is for the correct domain
                    parent.debug('web', 'handleRootRequestEx: incorrect domain.');
                    dbGetFunc.req.session = null;
                    dbGetFunc.res.redirect(domain.url + getQueryPortion(dbGetFunc.req)); // BAD***
                    return;
                }

                // Check if this is a locked account
                if ((dbGetFunc.user.siteadmin != null) && ((dbGetFunc.user.siteadmin & 32) != 0) && (dbGetFunc.user.siteadmin != 0xFFFFFFFF)) {
                    // Locked account
                    parent.debug('web', 'handleRootRequestEx: locked account.');
                    delete dbGetFunc.req.session.userid;
                    delete dbGetFunc.req.session.currentNode;
                    delete dbGetFunc.req.session.passhint;
                    delete dbGetFunc.req.session.cuserid;
                    dbGetFunc.req.session.messageid = 110; // Account locked.
                    dbGetFunc.res.redirect(domain.url + getQueryPortion(dbGetFunc.req)); // BAD***
                    return;
                }

                var viewmode = 1;
                if (dbGetFunc.req.session.viewmode) {
                    viewmode = dbGetFunc.req.session.viewmode;
                    delete dbGetFunc.req.session.viewmode;
                } else if (dbGetFunc.req.query.viewmode) {
                    viewmode = dbGetFunc.req.query.viewmode;
                }
                var currentNode = '';
                if (dbGetFunc.req.session.currentNode) {
                    currentNode = dbGetFunc.req.session.currentNode;
                    delete dbGetFunc.req.session.currentNode;
                } else if (dbGetFunc.req.query.node) {
                    currentNode = 'node/' + domain.id + '/' + dbGetFunc.req.query.node;
                }
                var logoutcontrols = {};
                if (obj.args.nousers != true) { logoutcontrols.name = user.name; }

                // Give the web page a list of supported server features for this domain and user
                const allFeatures = obj.getDomainUserFeatures(domain, dbGetFunc.user, dbGetFunc.req);

                // Create a authentication cookie
                const authCookie = obj.parent.encodeCookie({ userid: dbGetFunc.user._id, domainid: domain.id, ip: req.clientIp }, obj.parent.loginCookieEncryptionKey);
                const authRelayCookie = obj.parent.encodeCookie({ ruserid: dbGetFunc.user._id, domainid: domain.id }, obj.parent.loginCookieEncryptionKey);

                // Send the main web application
                var extras = (dbGetFunc.req.query.key != null) ? ('&key=' + dbGetFunc.req.query.key) : '';
                if ((!obj.args.user) && (obj.args.nousers != true) && (nologout == false)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

                // Clean up the U2F challenge if needed
                if (dbGetFunc.req.session.u2f) { delete dbGetFunc.req.session.u2f; };

                // Intel AMT Scanning options
                var amtscanoptions = '';
                if (typeof domain.amtscanoptions == 'string') { amtscanoptions = encodeURIComponent(domain.amtscanoptions); }
                else if (obj.common.validateStrArray(domain.amtscanoptions)) { domain.amtscanoptions = domain.amtscanoptions.join(','); amtscanoptions = encodeURIComponent(domain.amtscanoptions); }

                // Fetch the web state
                parent.debug('web', 'handleRootRequestEx: success.');

                var webstate = '';
                if ((err == null) && (states != null) && (Array.isArray(states)) && (states.length == 1) && (states[0].state != null)) { webstate = obj.filterUserWebState(states[0].state); }
                if ((webstate == '') && (typeof domain.defaultuserwebstate == 'object')) { webstate = JSON.stringify(domain.defaultuserwebstate); } // User has no web state, use defaults.
                if (typeof domain.forceduserwebstate == 'object') { // Forces initial user web state if present, use it.
                    var webstate2 = {};
                    try { if (webstate != '') { webstate2 = JSON.parse(webstate); } } catch (ex) { }
                    for (var i in domain.forceduserwebstate) { webstate2[i] = domain.forceduserwebstate[i]; }
                    webstate = JSON.stringify(webstate2);
                }

                // Custom user interface
                var customui = '';
                if (domain.customui != null) { customui = encodeURIComponent(JSON.stringify(domain.customui)); }

                // Server features
                var serverFeatures = 127;
                if (domain.myserver === false) { serverFeatures = 0; } // 64 = Show "My Server" tab
                else if (typeof domain.myserver == 'object') {
                    if (domain.myserver.backup !== true) { serverFeatures -= 1; } // Disallow simple server backups
                    if (domain.myserver.restore !== true) { serverFeatures -= 2; } // Disallow simple server restore
                    if (domain.myserver.upgrade !== true) { serverFeatures -= 4; } // Disallow server upgrade
                    if (domain.myserver.errorlog !== true) { serverFeatures -= 8; } // Disallow show server crash log
                    if (domain.myserver.console !== true) { serverFeatures -= 16; } // Disallow server console
                    if (domain.myserver.trace !== true) { serverFeatures -= 32; } // Disallow server tracing
                }
                if (obj.db.databaseType != 1) { // If not using NeDB, we can't backup using the simple system.
                    if ((serverFeatures & 1) != 0) { serverFeatures -= 1; } // Disallow server backups
                    if ((serverFeatures & 2) != 0) { serverFeatures -= 2; } // Disallow simple server restore
                }

                // Refresh the session
                render(dbGetFunc.req, dbGetFunc.res, getRenderPage('default', dbGetFunc.req, domain), getRenderArgs({
                    authCookie: authCookie,
                    authRelayCookie: authRelayCookie,
                    viewmode: viewmode,
                    currentNode: currentNode,
                    logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27'),
                    domain: domain.id,
                    debuglevel: parent.debugLevel,
                    serverDnsName: obj.getWebServerName(domain),
                    serverRedirPort: args.redirport,
                    serverPublicPort: httpsPort,
                    serverfeatures: serverFeatures,
                    features: allFeatures.features,
                    features2: allFeatures.features2,
                    sessiontime: (args.sessiontime) ? args.sessiontime : 60,
                    mpspass: args.mpspass,
                    passRequirements: passRequirements,
                    customui: customui,
                    webcerthash: Buffer.from(obj.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'),
                    footer: (domain.footer == null) ? '' : domain.footer,
                    webstate: encodeURIComponent(webstate).replace(/'/g, '%27'),
                    amtscanoptions: amtscanoptions,
                    pluginHandler: (parent.pluginHandler == null) ? 'null' : parent.pluginHandler.prepExports()
                }, dbGetFunc.req, domain), user);
            }
            xdbGetFunc.req = req;
            xdbGetFunc.res = res;
            xdbGetFunc.user = user;
            obj.db.Get('ws' + user._id, xdbGetFunc);
        } else {
            // Send back the login application
            // If this is a 2 factor auth request, look for a hardware key challenge.
            // Normal login 2 factor request
            if (req.session && (req.session.loginmode == 4) && (req.session.tuserid)) {
                var user = obj.users[req.session.tuserid];
                if (user != null) {
                    parent.debug('web', 'handleRootRequestEx: sending 2FA challenge.');
                    getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                    return;
                }
            }
            // Password recovery 2 factor request
            if (req.session && (req.session.loginmode == 5) && (req.session.temail)) {
                obj.db.GetUserWithVerifiedEmail(domain.id, req.session.temail, function (err, docs) {
                    if ((err != null) || (docs.length == 0)) {
                        parent.debug('web', 'handleRootRequestEx: password recover 2FA fail.');
                        req.session = null;
                        res.redirect(domain.url + getQueryPortion(req)); // BAD***
                    } else {
                        var user = obj.users[docs[0]._id];
                        if (user != null) {
                            parent.debug('web', 'handleRootRequestEx: password recover 2FA challenge.');
                            getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                        } else {
                            parent.debug('web', 'handleRootRequestEx: password recover 2FA no user.');
                            req.session = null;
                            res.redirect(domain.url + getQueryPortion(req)); // BAD***
                        }
                    }
                });
                return;
            }
            handleRootRequestLogin(req, res, domain, '', passRequirements);
        }
    }

    // Return a list of server supported features for a given domain and user
    obj.getDomainUserFeatures = function(domain, user, req) {
        var features = 0;
        var features2 = 0;
        if (obj.args.wanonly == true) { features += 0x00000001; } // WAN-only mode
        if (obj.args.lanonly == true) { features += 0x00000002; } // LAN-only mode
        if (obj.args.nousers == true) { features += 0x00000004; } // Single user mode
        if (domain.userQuota == -1) { features += 0x00000008; } // No server files mode
        if (obj.args.mpstlsoffload) { features += 0x00000010; } // No mutual-auth CIRA
        if ((parent.config.settings.allowframing != null) || (domain.allowframing != null)) { features += 0x00000020; } // Allow site within iframe
        if ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true)) { features += 0x00000040; } // Email invites
        if (obj.args.webrtc == true) { features += 0x00000080; } // Enable WebRTC (Default false for now)
        // 0x00000100 --> This feature flag is free for future use.
        if (obj.args.allowhighqualitydesktop !== false) { features += 0x00000200; } // Enable AllowHighQualityDesktop (Default true)
        if ((obj.args.lanonly == true) || (obj.args.mpsport == 0)) { features += 0x00000400; } // No CIRA
        if ((obj.parent.serverSelfWriteAllowed == true) && (user != null) && (user.siteadmin == 0xFFFFFFFF)) { features += 0x00000800; } // Server can self-write (Allows self-update)
        if ((parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (user._id.split('/')[2][0] != '~')) { features += 0x00001000; } // 2FA login supported
        if (domain.agentnoproxy === true) { features += 0x00002000; } // Indicates that agents should be installed without using a HTTP proxy
        if ((parent.config.settings.no2factorauth !== true) && domain.yubikey && domain.yubikey.id && domain.yubikey.secret && (user._id.split('/')[2][0] != '~')) { features += 0x00004000; } // Indicates Yubikey support
        if (domain.geolocation == true) { features += 0x00008000; } // Enable geo-location features
        if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { features += 0x00010000; } // Enable password hints
        if (parent.config.settings.no2factorauth !== true) { features += 0x00020000; } // Enable WebAuthn/FIDO2 support
        if ((obj.args.nousers != true) && (domain.passwordrequirements != null) && (domain.passwordrequirements.force2factor === true) && (user._id.split('/')[2][0] != '~')) {
            // Check if we can skip 2nd factor auth because of the source IP address
            var skip2factor = false;
            if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
                for (var i in domain.passwordrequirements.skip2factor) {
                    if (require('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) { skip2factor = true; }
                }
            }
            if (skip2factor == false) { features += 0x00040000; } // Force 2-factor auth
        }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { features += 0x00080000; } // LDAP or SSPI in use, warn that users must login first before adding a user to a group.
        if (domain.amtacmactivation) { features += 0x00100000; } // Intel AMT ACM activation/upgrade is possible
        if (domain.usernameisemail) { features += 0x00200000; } // Username is email address
        if (parent.mqttbroker != null) { features += 0x00400000; } // This server supports MQTT channels
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null)) { features += 0x00800000; } // using email for 2FA is allowed
        if (domain.agentinvitecodes == true) { features += 0x01000000; } // Support for agent invite codes
        if (parent.smsserver != null) { features += 0x02000000; } // SMS messaging is supported
        if ((parent.smsserver != null) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false))) { features += 0x04000000; } // SMS 2FA is allowed
        if (domain.sessionrecording != null) { features += 0x08000000; } // Server recordings enabled
        if (domain.urlswitching === false) { features += 0x10000000; } // Disables the URL switching feature
        if (domain.novnc === false) { features += 0x20000000; } // Disables noVNC
        if (domain.mstsc !== true) { features += 0x40000000; } // Disables MSTSC.js
        if (obj.isTrustedCert(domain) == false) { features += 0x80000000; } // Indicate we are not using a trusted certificate
        if (obj.parent.amtManager != null) { features2 += 0x00000001; } // Indicates that the Intel AMT manager is active
        if (obj.parent.firebase != null) { features2 += 0x00000002; } // Indicates the server supports Firebase push messaging
        if ((obj.parent.firebase != null) && (obj.parent.firebase.pushOnly != true)) { features2 += 0x00000004; } // Indicates the server supports Firebase two-way push messaging
        if (obj.parent.webpush != null) { features2 += 0x00000008; } // Indicates web push is enabled
        if (((obj.args.noagentupdate == 1) || (obj.args.noagentupdate == true))) { features2 += 0x00000010; } // No agent update
        if (parent.amtProvisioningServer != null) { features2 += 0x00000020; } // Intel AMT LAN provisioning server
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.push2factor != false)) && (obj.parent.firebase != null)) { features2 += 0x00000040; } // Indicates device push notification 2FA is enabled
        if ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.logintokens != false)) { features2 += 0x00000080; } // Indicates login tokens are allowed
        if (req.session.loginToken != null) { features2 += 0x00000100; } // LoginToken mode, no account changes.
        if (domain.ssh == true) { features2 += 0x00000200; } // SSH is enabled
        if (domain.localsessionrecording === false) { features2 += 0x00000400; } // Disable local recording feature
        if (domain.clipboardget == false) { features2 += 0x00000800; } // Disable clipboard get
        if (domain.clipboardset == false) { features2 += 0x00001000; } // Disable clipboard set
        if ((typeof domain.desktop == 'object') && (domain.desktop.viewonly == true)) { features2 += 0x00002000; } // Indicates remote desktop is viewonly
        if (domain.mailserver != null) { features2 += 0x00004000; } // Indicates email server is active
        if (domain.devicesearchbarserverandclientname) { features2 += 0x00008000; } // Search bar will find both server name and client name
        if (domain.ipkvm) { features2 += 0x00010000; } // Indicates support for IP KVM device groups
        if ((domain.passwordrequirements) && (domain.passwordrequirements.otp2factor == false)) { features2 += 0x00020000; } // Indicates support for OTP 2FA is disabled
        if ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.backupcode2factor === false)) { features2 += 0x00040000; } // Indicates 2FA backup codes are disabled
        if ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.single2factorwarning === false)) { features2 += 0x00080000; } // Indicates no warning if a single 2FA is in use
        if (domain.nightmode === 1) { features2 += 0x00100000; } // Always night mode
        if (domain.nightmode === 2) { features2 += 0x00200000; } // Always day mode
        return { features: features, features2: features2 };
    }

    function handleRootRequestLogin(req, res, domain, hardwareKeyChallenge, passRequirements) {
        parent.debug('web', 'handleRootRequestLogin()');
        var features = 0;
        if ((parent.config != null) && (parent.config.settings != null) && ((parent.config.settings.allowframing == true) || (typeof parent.config.settings.allowframing == 'string'))) { features += 32; } // Allow site within iframe
        if (domain.usernameisemail) { features += 0x00200000; } // Username is email address
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        var loginmode = 0;
        if (req.session) { loginmode = req.session.loginmode; delete req.session.loginmode; } // Clear this state, if the user hits refresh, we want to go back to the login page.

        // Format an error message if needed
        var passhint = null, msgid = 0;
        if (req.session != null) {
            msgid = req.session.messageid;
            if ((msgid == 5) || (loginmode == 7) || ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true))) { passhint = EscapeHtml(req.session.passhint); }
            delete req.session.messageid;
            delete req.session.passhint;
        }
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        const emailcheck = (allowAccountReset && (domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

        // Check if we are allowed to create new users using the login screen
        var newAccountsAllowed = true;
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true)) { for (var i in obj.users) { if (obj.users[i].domain == domain.id) { newAccountsAllowed = false; break; } } }
        if (parent.config.settings.maintenancemode != null) { newAccountsAllowed = false; }

        // Encrypt the hardware key challenge state if needed
        var hwstate = null;
        if (hardwareKeyChallenge) { hwstate = obj.parent.encodeCookie({ u: req.session.tuser, p: req.session.tpass, c: req.session.u2f }, obj.parent.loginCookieEncryptionKey) }

        // Check if we can use OTP tokens with email. We can't use email for 2FA password recovery (loginmode 5).
        var otpemail = (loginmode != 5) && (domain.mailserver != null) && (req.session != null) && ((req.session.temail === 1) || (typeof req.session.temail == 'string'));
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.email2factor == false)) { otpemail = false; }
        var otpsms = (parent.smsserver != null) && (req.session != null) && (req.session.tsms === 1);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.sms2factor == false)) { otpsms = false; }
        var otppush = (parent.firebase != null) && (req.session != null) && (req.session.tpush === 1);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.push2factor == false)) { otppush = false; }
        const autofido = ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.autofido2fa == true)); // See if FIDO should be automatically prompted if user account has it.

        // See if we support two-factor trusted cookies
        var twoFactorCookieDays = 30;
        if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

        // See what authentication strategies we have
        var authStrategies = [];
        if (typeof domain.authstrategies == 'object') {
            if (typeof domain.authstrategies.twitter == 'object') { authStrategies.push('twitter'); }
            if (typeof domain.authstrategies.google == 'object') { authStrategies.push('google'); }
            if (typeof domain.authstrategies.github == 'object') { authStrategies.push('github'); }
            if (typeof domain.authstrategies.reddit == 'object') { authStrategies.push('reddit'); }
            if (typeof domain.authstrategies.azure == 'object') { authStrategies.push('azure'); }
            if (typeof domain.authstrategies.intel == 'object') { authStrategies.push('intel'); }
            if (typeof domain.authstrategies.jumpcloud == 'object') { authStrategies.push('jumpcloud'); }
            if (typeof domain.authstrategies.saml == 'object') { authStrategies.push('saml'); }
        }

        // Custom user interface
        var customui = '';
        if (domain.customui != null) { customui = encodeURIComponent(JSON.stringify(domain.customui)); }

        // Get two-factor screen timeout
        var twoFactorTimeout = 300000; // Default is 5 minutes, 0 for no timeout.
        if ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.twofactortimeout == 'number')) {
            twoFactorTimeout = domain.passwordrequirements.twofactortimeout * 1000;
        }

        // Render the login page
        render(req, res,
            getRenderPage((domain.sitestyle == 2) ? 'login2' : 'login', req, domain),
            getRenderArgs({
                loginmode: loginmode,
                rootCertLink: getRootCertLink(domain),
                newAccount: newAccountsAllowed,
                newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1),
                serverDnsName: obj.getWebServerName(domain),
                serverPublicPort: httpsPort,
                passlogin: (typeof domain.showpasswordlogin == 'boolean') ? domain.showpasswordlogin : true,
                emailcheck: emailcheck,
                features: features,
                sessiontime: (args.sessiontime) ? args.sessiontime : 60,
                passRequirements: passRequirements,
                customui: customui,
                footer: (domain.loginfooter == null) ? '' : domain.loginfooter,
                hkey: encodeURIComponent(hardwareKeyChallenge).replace(/'/g, '%27'),
                messageid: msgid,
                passhint: passhint,
                welcometext: domain.welcometext ? encodeURIComponent(domain.welcometext).split('\'').join('\\\'') : null,
                welcomePictureFullScreen: ((typeof domain.welcomepicturefullscreen == 'boolean') ? domain.welcomepicturefullscreen : false),
                hwstate: hwstate,
                otpemail: otpemail,
                otpsms: otpsms,
                otppush: otppush,
                autofido: autofido,
                twoFactorCookieDays: twoFactorCookieDays,
                authStrategies: authStrategies.join(','),
                loginpicture: (typeof domain.loginpicture == 'string'),
                tokenTimeout: twoFactorTimeout // Two-factor authentication screen timeout in milliseconds
            }, req, domain, (domain.sitestyle == 2) ? 'login2' : 'login'));
    }

    // Handle a post request on the root
    function handleRootPostRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.end("Not Found"); return; } // Check 3FA URL key
        parent.debug('web', 'handleRootPostRequest, action: ' + req.body.action);

        switch (req.body.action) {
            case 'login': { handleLoginRequest(req, res, true); break; }
            case 'tokenlogin': {
                if (req.body.hwstate) {
                    var cookie = obj.parent.decodeCookie(req.body.hwstate, obj.parent.loginCookieEncryptionKey, 10);
                    if (cookie != null) { req.session.tuser = cookie.u; req.session.tpass = cookie.p; req.session.u2f = cookie.c; }
                }
                handleLoginRequest(req, res, true); break;
            }
            case 'pushlogin': {
                if (req.body.hwstate) {
                    var cookie = obj.parent.decodeCookie(req.body.hwstate, obj.parent.loginCookieEncryptionKey, 1);
                    if ((cookie != null) && (typeof cookie.u == 'string') && (cookie.d == domain.id) && (cookie.a == 'pushAuth')) {
                        // Push authentication is a success, login the user
                        req.session = { userid: cookie.u };

                        // Check if we need to remember this device
                        if ((req.body.remembertoken === 'on') && ((domain.twofactorcookiedurationdays == null) || (domain.twofactorcookiedurationdays > 0))) {
                            var maxCookieAge = domain.twofactorcookiedurationdays;
                            if (typeof maxCookieAge != 'number') { maxCookieAge = 30; }
                            const twoFactorCookie = obj.parent.encodeCookie({ userid: cookie.u, expire: maxCookieAge * 24 * 60 /*, ip: req.clientIp*/ }, obj.parent.loginCookieEncryptionKey);
                            res.cookie('twofactor', twoFactorCookie, { maxAge: (maxCookieAge * 24 * 60 * 60 * 1000), httpOnly: true, sameSite: ((parent.config.settings.cookieipcheck === false) ? 'none' : 'strict'), secure: true });
                        }

                        handleRootRequestEx(req, res, domain);
                        return;
                    }
                }
                handleLoginRequest(req, res, true); break;
            }
            case 'changepassword': { handlePasswordChangeRequest(req, res, true); break; }
            case 'deleteaccount': { handleDeleteAccountRequest(req, res, true); break; }
            case 'createaccount': { handleCreateAccountRequest(req, res, true); break; }
            case 'resetpassword': { handleResetPasswordRequest(req, res, true); break; }
            case 'resetaccount': { handleResetAccountRequest(req, res, true); break; }
            case 'checkemail': { handleCheckAccountEmailRequest(req, res, true); break; }
            default: { handleLoginRequest(req, res, true); break; }
        }
    }

    // Return true if it looks like we are using a real TLS certificate.
    obj.isTrustedCert = function (domain) {
        if ((domain != null) && (typeof domain.trustedcert == 'boolean')) return domain.trustedcert; // If the status of the cert specified, use that.
        if (typeof obj.args.trustedcert == 'boolean') return obj.args.trustedcert; // If the status of the cert specified, use that.
        if (obj.args.tlsoffload != null) return true; // We are using TLS offload, a real cert is likely used.
        if (obj.parent.config.letsencrypt != null) return (obj.parent.config.letsencrypt.production === true); // We are using Let's Encrypt, real cert in use if production is set to true.
        if (obj.certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0) return false; // Our cert is issued by self-signed cert.
        if (obj.certificates.CommonName.indexOf('.') == -1) return false; // Our cert is named with a fake name
        return true; // This is a guess
    }

    // Get the link to the root certificate if needed
    function getRootCertLink(domain) {
        // Check if the HTTPS certificate is issued from MeshCentralRoot, if so, add download link to root certificate.
        if (obj.isTrustedCert(domain) == false) {
            // Get the domain suffix
            var xdomain = (domain.dns == null) ? domain.id : '';
            if (xdomain != '') xdomain += '/';
            return '<a href=/' + xdomain + 'MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>';
        }
        return '';
    }

    // Serve the xterm page
    function handleXTermRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        parent.debug('web', 'handleXTermRequest: sending xterm');
        res.set({ 'Cache-Control': 'no-store' });
        if (req.session && req.session.userid) {
            if (req.session.userid.split('/')[1] != domain.id) { res.redirect(domain.url + getQueryPortion(req)); return; } // Check if the session is for the correct domain
            var user = obj.users[req.session.userid];
            if ((user == null) || (req.query.nodeid == null)) { res.redirect(domain.url + getQueryPortion(req)); return; } // Check if the user exists

            // Check permissions
            obj.GetNodeWithRights(domain, user, req.query.nodeid, function (node, rights, visible) {
                if ((node == null) || ((rights & 8) == 0) || ((rights != 0xFFFFFFFF) && ((rights & 512) != 0))) { res.redirect(domain.url + getQueryPortion(req)); return; }

                var logoutcontrols = { name: user.name };
                var extras = (req.query.key != null) ? ('&key=' + req.query.key) : '';
                if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button

                // Create a authentication cookie
                const authCookie = obj.parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: req.clientIp }, obj.parent.loginCookieEncryptionKey);
                const authRelayCookie = obj.parent.encodeCookie({ ruserid: user._id, domainid: domain.id }, obj.parent.loginCookieEncryptionKey);
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                render(req, res, getRenderPage('xterm', req, domain), getRenderArgs({ serverDnsName: obj.getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, authCookie: authCookie, authRelayCookie: authRelayCookie, logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27'), name: EscapeHtml(node.name) }, req, domain));
            });
        } else {
            res.redirect(domain.url + getQueryPortion(req));
            return;
        }
    }

    // Render the terms of service.
    function handleTermsRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        // See if term.txt was loaded from the database
        if ((parent.configurationFiles != null) && (parent.configurationFiles['terms.txt'] != null)) {
            // Send the terms from the database
            res.set({ 'Cache-Control': 'no-store' });
            if (req.session && req.session.userid) {
                if (req.session.userid.split('/')[1] != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check if the session is for the correct domain
                var user = obj.users[req.session.userid];
                var logoutcontrols = { name: user.name };
                var extras = (req.query.key != null) ? ('&key=' + req.query.key) : '';
                if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button
                render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ terms: encodeURIComponent(parent.configurationFiles['terms.txt'].toString()).split('\'').join('\\\''), logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27') }, req, domain));
            } else {
                render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ terms: encodeURIComponent(parent.configurationFiles['terms.txt'].toString()).split('\'').join('\\\''), logoutControls: encodeURIComponent('{}') }, req, domain));
            }
        } else {
            // See if there is a terms.txt file in meshcentral-data
            var p = obj.path.join(obj.parent.datapath, 'terms.txt');
            if (obj.fs.existsSync(p)) {
                obj.fs.readFile(p, 'utf8', function (err, data) {
                    if (err != null) { parent.debug('web', 'handleTermsRequest: no terms.txt'); res.sendStatus(404); return; }

                    // Send the terms from terms.txt
                    res.set({ 'Cache-Control': 'no-store' });
                    if (req.session && req.session.userid) {
                        if (req.session.userid.split('/')[1] != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check if the session is for the correct domain
                        var user = obj.users[req.session.userid];
                        var logoutcontrols = { name: user.name };
                        var extras = (req.query.key != null) ? ('&key=' + req.query.key) : '';
                        if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button
                        render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ terms: encodeURIComponent(data).split('\'').join('\\\''), logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27') }, req, domain));
                    } else {
                        render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ terms: encodeURIComponent(data).split('\'').join('\\\''), logoutControls: encodeURIComponent('{}') }, req, domain));
                    }
                });
            } else {
                // Send the default terms
                parent.debug('web', 'handleTermsRequest: sending default terms');
                res.set({ 'Cache-Control': 'no-store' });
                if (req.session && req.session.userid) {
                    if (req.session.userid.split('/')[1] != domain.id) { req.session = null; res.redirect(domain.url + getQueryPortion(req)); return; } // Check if the session is for the correct domain
                    var user = obj.users[req.session.userid];
                    var logoutcontrols = { name: user.name };
                    var extras = (req.query.key != null) ? ('&key=' + req.query.key) : '';
                    if ((domain.ldap == null) && (domain.sspi == null) && (obj.args.user == null) && (obj.args.nousers != true)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button
                    render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27') }, req, domain));
                } else {
                    render(req, res, getRenderPage('terms', req, domain), getRenderArgs({ logoutControls: encodeURIComponent('{}') }, req, domain));
                }
            }
        }
    }

    // Render the messenger application.
    function handleMessengerRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMessengerRequest: no domain'); res.sendStatus(404); return; }
        parent.debug('web', 'handleMessengerRequest()');

        // Check if we are in maintenance mode
        if (parent.config.settings.maintenancemode != null) {
            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            return;
        }

        // Check if this session is for a user
        if (req.query.id == null) { res.sendStatus(404); return; }
        var idSplit = decodeURIComponent(req.query.id).split('/');
        if ((idSplit.length != 7) || (idSplit[0] != 'meshmessenger')) { res.sendStatus(404); return; }
        if ((idSplit[1] == 'user') && (idSplit[4] == 'user')) {
            // This is a user to user conversation, both users must be logged in.
            var user1 = idSplit[1] + '/' + idSplit[2] + '/' + idSplit[3]
            var user2 = idSplit[4] + '/' + idSplit[5] + '/' + idSplit[6]
            if (!req.session || !req.session.userid) {
                // Redirect to login page
                if (req.query.key != null) { res.redirect(domain.url + '?key=' + req.query.key + '&meshmessengerid=' + req.query.id); } else { res.redirect(domain.url + '?meshmessengerid=' + req.query.id); }
                return;
            }
            if ((req.session.userid != user1) && (req.session.userid != user2)) { res.sendStatus(404); return; }
        }

        // Get WebRTC configuration
        var webRtcConfig = null;
        if (obj.parent.config.settings && obj.parent.config.settings.webrtconfig && (typeof obj.parent.config.settings.webrtconfig == 'object')) { webRtcConfig = encodeURIComponent(JSON.stringify(obj.parent.config.settings.webrtconfig)).replace(/'/g, '%27'); }
        else if (args.webrtconfig && (typeof args.webrtconfig == 'object')) { webRtcConfig = encodeURIComponent(JSON.stringify(args.webrtconfig)).replace(/'/g, '%27'); }

        // Setup other options
        var options = { webrtconfig: webRtcConfig };
        if (typeof domain.meshmessengertitle == 'string') { options.meshMessengerTitle = domain.meshmessengertitle; } else { options.meshMessengerTitle = '!'; }

        // Get the userid and name
        if ((domain.meshmessengertitle != null) && (req.query.id != null) && (req.query.id.startsWith('meshmessenger/node'))) {
            if (idSplit.length == 7) {
                const user = obj.users[idSplit[4] + '/' + idSplit[5] + '/' + idSplit[6]];
                if (user != null) {
                    if (domain.meshmessengertitle.indexOf('{0}') >= 0) { options.username = encodeURIComponent(user.realname ? user.realname : user.name).replace(/'/g, '%27'); }
                    if (domain.meshmessengertitle.indexOf('{1}') >= 0) { options.userid = encodeURIComponent(user.name).replace(/'/g, '%27'); }
                }
            }
        }

        // Render the page
        res.set({ 'Cache-Control': 'no-store' });
        render(req, res, getRenderPage('messenger', req, domain), getRenderArgs(options, req, domain));
    }

    // Handle messenger image request
    function handleMessengerImageRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMessengerImageRequest: no domain'); res.sendStatus(404); return; }
        parent.debug('web', 'handleMessengerImageRequest()');

        // Check if we are in maintenance mode
        if (parent.config.settings.maintenancemode != null) { res.sendStatus(404); return; }

        //res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if (domain.meshmessengerpicture) {
            // Use the configured messenger logo picture
            try { res.sendFile(obj.common.joinPath(obj.parent.datapath, domain.meshmessengerpicture)); return; } catch (ex) { }
        }

        var imagefile = 'images/messenger.png';
        if (domain.webpublicpath != null) {
            obj.fs.exists(obj.path.join(domain.webpublicpath, imagefile), function (exists) {
                if (exists) {
                    // Use the domain logo picture
                    try { res.sendFile(obj.path.join(domain.webpublicpath, imagefile)); } catch (ex) { res.sendStatus(404); }
                } else {
                    // Use the default logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
                }
            });
        } else if (parent.webPublicOverridePath) {
            obj.fs.exists(obj.path.join(obj.parent.webPublicOverridePath, imagefile), function (exists) {
                if (exists) {
                    // Use the override logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicOverridePath, imagefile)); } catch (ex) { res.sendStatus(404); }
                } else {
                    // Use the default logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
                }
            });
        } else {
            // Use the default logo picture
            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
        }
    }

    // Returns the server root certificate encoded in base64
    function getRootCertBase64() {
        var rootcert = obj.certificates.root.cert;
        var i = rootcert.indexOf('-----BEGIN CERTIFICATE-----\r\n');
        if (i >= 0) { rootcert = rootcert.substring(i + 29); }
        i = rootcert.indexOf('-----END CERTIFICATE-----');
        if (i >= 0) { rootcert = rootcert.substring(i, 0); }
        return Buffer.from(rootcert, 'base64').toString('base64');
    }

    // Returns the mesh server root certificate
    function handleRootCertRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleRootCertRequest: no domain'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((obj.userAllowedIp != null) && (checkIpAddressEx(req, res, obj.userAllowedIp, false) === false)) { parent.debug('web', 'handleRootCertRequest: invalid ip'); return; } // Check server-wide IP filter only.
        parent.debug('web', 'handleRootCertRequest()');
        setContentDispositionHeader(res, 'application/octet-stream', certificates.RootName + '.cer', null, 'rootcert.cer');
        res.send(Buffer.from(getRootCertBase64(), 'base64'));
    }

    // Handle user public file downloads
    function handleDownloadUserFiles(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key

        if (obj.common.validateString(req.path, 1, 4096) == false) { res.sendStatus(404); return; }
        var domainname = 'domain', spliturl = decodeURIComponent(req.path).split('/'), filename = '';
        if ((spliturl.length < 3) || (obj.common.IsFilenameValid(spliturl[2]) == false) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        if (domain.id != '') { domainname = 'domain-' + domain.id; }
        var path = obj.path.join(obj.filespath, domainname + '/user-' + spliturl[2] + '/Public');
        for (var i = 3; i < spliturl.length; i++) { if (obj.common.IsFilenameValid(spliturl[i]) == true) { path += '/' + spliturl[i]; filename = spliturl[i]; } else { res.sendStatus(404); return; } }

        var stat = null;
        try { stat = obj.fs.statSync(path); } catch (e) { }
        if ((stat != null) && ((stat.mode & 0x004000) == 0)) {
            if (req.query.download == 1) {
                setContentDispositionHeader(res, 'application/octet-stream', filename, null, 'file.bin');
                try { res.sendFile(obj.path.resolve(__dirname, path)); } catch (e) { res.sendStatus(404); }
            } else {
                render(req, res, getRenderPage((domain.sitestyle == 2) ? 'download2' : 'download', req, domain), getRenderArgs({ rootCertLink: getRootCertLink(domain), messageid: 1, fileurl: req.path + '?download=1', filename: filename, filesize: stat.size }, req, domain));
            }
        } else {
            render(req, res, getRenderPage((domain.sitestyle == 2) ? 'download2' : 'download', req, domain), getRenderArgs({ rootCertLink: getRootCertLink(domain), messageid: 2 }, req, domain));
        }
    }

    // Handle device file request
    function handleDeviceFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((req.query.c == null) || (req.query.f == null)) { res.sendStatus(404); return; }

        // Check the inbound desktop sharing cookie
        var c = obj.parent.decodeCookie(req.query.c, obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
        if ((c == null) || (c.domainid !== domain.id)) { res.sendStatus(404); return; }

        // Check userid
        const user = obj.users[c.userid];
        if ((c == user)) { res.sendStatus(404); return; }

        // If this cookie has restricted usages, check that it's allowed to perform downloads
        if (Array.isArray(c.usages) && (c.usages.indexOf(10) < 0)) { res.sendStatus(404); return; } // Check protocol #10

        if (c.nid != null) { req.query.n = c.nid.split('/')[2]; } // This cookie is restricted to a specific nodeid.
        if (req.query.n == null) { res.sendStatus(404); return; }

        // Check if this user has permission to manage this computer
        obj.GetNodeWithRights(domain, user, 'node/' + domain.id + '/' + req.query.n, function (node, rights, visible) {
            if ((node == null) || ((rights & MESHRIGHT_REMOTECONTROL) == 0) || (visible == false)) { res.sendStatus(404); return; } // We don't have remote control rights to this device

            // All good, start the file transfer
            req.query.id = getRandomLowerCase(12);
            obj.meshDeviceFileHandler.CreateMeshDeviceFile(obj, null, res, req, domain, user, node.meshid, node._id);
        });
    }

    // Handle download of a server file by an agent
    function handleAgentDownloadFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (req.query.c == null) { res.sendStatus(404); return; }

        // Check the inbound desktop sharing cookie
        var c = obj.parent.decodeCookie(req.query.c, obj.parent.loginCookieEncryptionKey, 5); // 5 minute timeout
        if ((c == null) || (c.a != 'tmpdl') || (c.d != domain.id) || (c.nid == null) || (c.f == null) || (obj.common.IsFilenameValid(c.f) == false)) { res.sendStatus(404); return; }

        // Send the file back
        try { res.sendFile(obj.path.join(obj.filespath, 'tmp', c.f)); return; } catch (ex) { res.sendStatus(404); }
    }

    // Handle logo request
    function handleLogoRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }

        //res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if (domain.titlepicture) {
            if ((parent.configurationFiles != null) && (parent.configurationFiles[domain.titlepicture] != null)) {
                // Use the logo in the database
                res.set({ 'Content-Type': domain.titlepicture.toLowerCase().endsWith('.png')?'image/png':'image/jpeg' });
                res.send(parent.configurationFiles[domain.titlepicture]);
                return;
            } else {
                // Use the logo on file
                try { res.sendFile(obj.common.joinPath(obj.parent.datapath, domain.titlepicture)); return; } catch (ex) { }
            }
        }

        if ((domain.webpublicpath != null) && (obj.fs.existsSync(obj.path.join(domain.webpublicpath, 'images/logoback.png')))) {
            // Use the domain logo picture
            try { res.sendFile(obj.path.join(domain.webpublicpath, 'images/logoback.png')); } catch (ex) { res.sendStatus(404); }
        } else if (parent.webPublicOverridePath && obj.fs.existsSync(obj.path.join(obj.parent.webPublicOverridePath, 'images/logoback.png'))) {
            // Use the override logo picture
            try { res.sendFile(obj.path.join(obj.parent.webPublicOverridePath, 'images/logoback.png')); } catch (ex) { res.sendStatus(404); }
        } else {
            // Use the default logo picture
            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/logoback.png')); } catch (ex) { res.sendStatus(404); }
        }
    }

    // Handle login logo request
    function handleLoginLogoRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }

        //res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if (domain.loginpicture) {
            if ((parent.configurationFiles != null) && (parent.configurationFiles[domain.loginpicture] != null)) {
                // Use the logo in the database
                res.set({ 'Content-Type': domain.loginpicture.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' });
                res.send(parent.configurationFiles[domain.loginpicture]);
                return;
            } else {
                // Use the logo on file
                try { res.sendFile(obj.common.joinPath(obj.parent.datapath, domain.loginpicture)); return; } catch (ex) { res.sendStatus(404); }
            }
        } else {
            res.sendStatus(404);
        }
    }

    // Handle translation request
    function handleTranslationsRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        //if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((obj.userAllowedIp != null) && (checkIpAddressEx(req, res, obj.userAllowedIp, false) === false)) { return; } // Check server-wide IP filter only.

        var user = null;
        if (obj.args.user != null) {
            // A default user is active
            user = obj.users['user/' + domain.id + '/' + obj.args.user];
            if (!user) { parent.debug('web', 'handleTranslationsRequest: user not found.'); res.sendStatus(401); return; }
        } else {
            // Check if the user is logged and we have all required parameters
            if (!req.session || !req.session.userid) { parent.debug('web', 'handleTranslationsRequest: failed checks (2).'); res.sendStatus(401); return; }

            // Get the current user
            user = obj.users[req.session.userid];
            if (!user) { parent.debug('web', 'handleTranslationsRequest: user not found.'); res.sendStatus(401); return; }
            if (user.siteadmin != 0xFFFFFFFF) { parent.debug('web', 'handleTranslationsRequest: user not site administrator.'); res.sendStatus(401); return; }
        }

        var data = '';
        req.setEncoding('utf8');
        req.on('data', function (chunk) { data += chunk; });
        req.on('end', function () {
            try { data = JSON.parse(data); } catch (ex) { data = null; }
            if (data == null) { res.sendStatus(404); return; }
            if (data.action == 'getTranslations') {
                if (obj.fs.existsSync(obj.path.join(obj.parent.datapath, 'translate.json'))) {
                    // Return the translation file (JSON)
                    try { res.sendFile(obj.path.join(obj.parent.datapath, 'translate.json')); } catch (ex) { res.sendStatus(404); }
                } else if (obj.fs.existsSync(obj.path.join(__dirname, 'translate', 'translate.json'))) {
                    // Return the default translation file (JSON)
                    try { res.sendFile(obj.path.join(__dirname, 'translate', 'translate.json')); } catch (ex) { res.sendStatus(404); }
                } else { res.sendStatus(404); }
            } else if (data.action == 'setTranslations') {
                obj.fs.writeFile(obj.path.join(obj.parent.datapath, 'translate.json'), obj.common.translationsToJson({ strings: data.strings }), function (err) { if (err == null) { res.send(JSON.stringify({ response: 'ok' })); } else { res.send(JSON.stringify({ response: err })); } });
            } else if (data.action == 'translateServer') {
                if (obj.pendingTranslation === true) { res.send(JSON.stringify({ response: 'Server is already performing a translation.' })); return; }
                const nodeVersion = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
                if (nodeVersion < 8) { res.send(JSON.stringify({ response: 'Server requires NodeJS 8.x or better.' })); return; }
                var translateFile = obj.path.join(obj.parent.datapath, 'translate.json');
                if (obj.fs.existsSync(translateFile) == false) { translateFile = obj.path.join(__dirname, 'translate', 'translate.json'); }
                if (obj.fs.existsSync(translateFile) == false) { res.send(JSON.stringify({ response: 'Unable to find translate.js file on the server.' })); return; }
                res.send(JSON.stringify({ response: 'ok' }));
                console.log('Started server translation...');
                obj.pendingTranslation = true;
                require('child_process').exec('node translate.js translateall \"' + translateFile + '\"', { maxBuffer: 512000, timeout: 120000, cwd: obj.path.join(__dirname, 'translate') }, function (error, stdout, stderr) {
                    delete obj.pendingTranslation;
                    //console.log('error', error);
                    //console.log('stdout', stdout);
                    //console.log('stderr', stderr);
                    //console.log('Server restart...'); // Perform a server restart
                    //process.exit(0);
                    console.log('Server translation completed.');
                });
            } else {
                // Unknown request
                res.sendStatus(404);
            }
        });
    }

    // Handle welcome image request
    function handleWelcomeImageRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }

        //res.set({ 'Cache-Control': 'max-age=86400' }); // 1 day
        if (domain.welcomepicture) {
            if ((parent.configurationFiles != null) && (parent.configurationFiles[domain.welcomepicture] != null)) {
                // Use the welcome image in the database
                res.set({ 'Content-Type': domain.welcomepicture.toLowerCase().endsWith('.png')?'image/png':'image/jpeg' });
                res.send(parent.configurationFiles[domain.welcomepicture]);
                return;
            }

            // Use the configured logo picture
            try { res.sendFile(obj.common.joinPath(obj.parent.datapath, domain.welcomepicture)); return; } catch (ex) { }
        }

        var imagefile = 'images/mainwelcome.jpg';
        if (domain.sitestyle == 2) { imagefile = 'images/login/back.png'; }
        if (domain.webpublicpath != null) {
            obj.fs.exists(obj.path.join(domain.webpublicpath, imagefile), function (exists) {
                if (exists) {
                    // Use the domain logo picture
                    try { res.sendFile(obj.path.join(domain.webpublicpath, imagefile)); } catch (ex) { res.sendStatus(404); }
                } else {
                    // Use the default logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
                }
            });
        } else if (parent.webPublicOverridePath) {
            obj.fs.exists(obj.path.join(obj.parent.webPublicOverridePath, imagefile), function (exists) {
                if (exists) {
                    // Use the override logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicOverridePath, imagefile)); } catch (ex) { res.sendStatus(404); }
                } else {
                    // Use the default logo picture
                    try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
                }
            });
        } else {
            // Use the default logo picture
            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, imagefile)); } catch (ex) { res.sendStatus(404); }
        }
    }

    // Download a session recording
    function handleGetRecordings(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;

        // Check the query
        if ((domain.sessionrecording == null) || (req.query.file == null) || (obj.common.IsFilenameValid(req.query.file) !== true) || (req.query.file.endsWith('.mcrec') == false)) { res.sendStatus(401); return; }

        // Get the recording path
        var recordingsPath = null;
        if (domain.sessionrecording.filepath) { recordingsPath = domain.sessionrecording.filepath; } else { recordingsPath = parent.recordpath; }
        if (recordingsPath == null) { res.sendStatus(401); return; }

        // Get the user and check user rights
        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }
        if (authUserid == null) { res.sendStatus(401); return; }
        const user = obj.users[authUserid];
        if (user == null) { res.sendStatus(401); return; }
        if ((user.siteadmin & 512) == 0) { res.sendStatus(401); return; } // Check if we have right to get recordings

        // Send the recorded file
        setContentDispositionHeader(res, 'application/octet-stream', req.query.file, null, 'recording.mcrec');
        try { res.sendFile(obj.path.join(recordingsPath, req.query.file)); } catch (ex) { res.sendStatus(404); }
    }

    // Stream a session recording
    function handleGetRecordingsWebSocket(ws, req) {
        var domain = checkAgentIpAddress(ws, req);
        if (domain == null) { parent.debug('web', 'Got recordings file transfer connection with bad domain or blocked IP address ' + req.clientIp + ', dropping.'); try { ws.close(); } catch (ex) { } return; }

        // Check the query
        if ((domain.sessionrecording == null) || (req.query.file == null) || (obj.common.IsFilenameValid(req.query.file) !== true) || (req.query.file.endsWith('.mcrec') == false)) { try { ws.close(); } catch (ex) { } return; }

        // Get the recording path
        var recordingsPath = null;
        if (domain.sessionrecording.filepath) { recordingsPath = domain.sessionrecording.filepath; } else { recordingsPath = parent.recordpath; }
        if (recordingsPath == null) { try { ws.close(); } catch (ex) { } return; }

        // Get the user and check user rights
        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }
        if (authUserid == null) { try { ws.close(); } catch (ex) { } return; }
        const user = obj.users[authUserid];
        if (user == null) { try { ws.close(); } catch (ex) { } return; }
        if ((user.siteadmin & 512) == 0) { try { ws.close(); } catch (ex) { } return; } // Check if we have right to get recordings
        const filefullpath = obj.path.join(recordingsPath, req.query.file);

        obj.fs.stat(filefullpath, function(err, stats) {
            if (err) {
                try { ws.close(); } catch (ex) { } // File does not exist
            } else {
                obj.fs.open(filefullpath, 'r', function (err, fd) {
                    if (err == null) {
                        // When data is received from the web socket
                        ws.on('message', function (msg) {
                            if (typeof msg != 'string') return;
                            var command;
                            try { command = JSON.parse(msg); } catch (e) { return; }
                            if ((command == null) || (typeof command.action != 'string')) return;
                            switch (command.action) {
                                case 'get': {
                                    const buffer = Buffer.alloc(8 + command.size);
                                    //buffer.writeUInt32BE((command.ptr >> 32), 0);
                                    buffer.writeUInt32BE((command.ptr & 0xFFFFFFFF), 4);
                                    obj.fs.read(fd, buffer, 8, command.size, command.ptr, function (err, bytesRead, buffer) { if (bytesRead > (buffer.length - 8)) { buffer = buffer.slice(0, bytesRead + 8); } ws.send(buffer); });
                                    break;
                                }
                            }
                        });

                        // If error, do nothing
                        ws.on('error', function (err) { try { ws.close(); } catch (ex) { } obj.fs.close(fd, function (err) { }); });

                        // If the web socket is closed
                        ws.on('close', function (req) { try { ws.close(); } catch (ex) { } obj.fs.close(fd, function (err) { }); });

                        ws.send(JSON.stringify({ "action": "info", "name": req.query.file, "size": stats.size }));
                    } else {
                        try { ws.close(); } catch (ex) { }
                    }
                });
            }
        });
    }

    // Serve the player page
    function handlePlayerRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }

        parent.debug('web', 'handlePlayerRequest: sending player');
        res.set({ 'Cache-Control': 'no-store' });
        render(req, res, getRenderPage('player', req, domain), getRenderArgs({}, req, domain));
    }

    // Serve the guest sharing page
    function handleSharingRequest(req, res) {
        const domain = getDomain(req, res);
        if (domain == null) { return; }
        if (req.query.c == null) { res.sendStatus(404); return; }
        if (domain.guestdevicesharing === false) { res.sendStatus(404); return; } // This feature is not allowed.

        // Check the inbound guest sharing cookie
        var c = obj.parent.decodeCookie(req.query.c, obj.parent.invitationLinkEncryptionKey, 9999999999); // Decode cookies with unlimited time.
        if (c == null) { res.sendStatus(404); return; }

        if (c.a === 5) {
            // This is the older style sharing cookie with everything encoded within it.
            // This cookie style gives a very large URL, so it's not used anymore.
            if ((typeof c.p !== 'number') || (c.p < 1) || (c.p > 7) || (typeof c.uid != 'string') || (typeof c.nid != 'string') || (typeof c.gn != 'string') || (typeof c.cf != 'number') || (typeof c.pid != 'string')) { res.sendStatus(404); return; }
            handleSharingRequestEx(req, res, domain, c);
            return;
        }
        if (c.a === 6) {
            // This is the new style sharing cookie, just encodes the pointer to the sharing information in the database.
            // Gives a much more compact URL.
            if (typeof c.pid != 'string') { res.sendStatus(404); return; }

            // Check the expired time, expire message.
            if ((c.e != null) && (c.e <= Date.now())) { render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: 12, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain)); return; }

            obj.db.Get('deviceshare-' + c.pid, function (err, docs) {
                if ((err != null) || (docs == null) || (docs.length != 1)) { res.sendStatus(404); return; }
                const doc = docs[0];

                // If this is a recurrent share, check if we are at the currect time to make use of it
                if (typeof doc.recurring == 'number') {
                    const now = Date.now();
                    if (now >= doc.startTime) { // We don't want to move the validity window before the start time
                        const deltaTime = (now - doc.startTime);
                        if (doc.recurring === 1) {
                            // This moves the start time to the next valid daily window
                            const oneDay = (24 * 60 * 60 * 1000);
                            var addition = Math.floor(deltaTime / oneDay);
                            if ((deltaTime - (addition * oneDay)) > (doc.duration * 60000)) { addition++; } // If we are passed the current windows, move to the next one. This will show link as not being valid yet.
                            doc.startTime += (addition * oneDay);
                        } else if (doc.recurring === 2) {
                            // This moves the start time to the next valid weekly window
                            const oneWeek = (7 * 24 * 60 * 60 * 1000);
                            var addition = Math.floor(deltaTime / oneWeek);
                            if ((deltaTime - (addition * oneWeek)) > (doc.duration * 60000)) { addition++; } // If we are passed the current windows, move to the next one. This will show link as not being valid yet.
                            doc.startTime += (addition * oneWeek);
                        }
                    }
                }

                // Generate an old style cookie from the information in the database
                var cookie = { a: 5, p: doc.p, gn: doc.guestName, nid: doc.nodeid, cf: doc.consent, pid: doc.publicid, k: doc.extrakey };
                if (doc.userid) { cookie.uid = doc.userid; }
                if ((cookie.userid == null) && (cookie.pid.startsWith('AS:node/'))) { cookie.nouser = 1; }
                if (doc.startTime != null) {
                    if (doc.expireTime != null) { cookie.start = doc.startTime; cookie.expire = doc.expireTime; }
                    else if (doc.duration != null) { cookie.start = doc.startTime; cookie.expire = doc.startTime + (doc.duration * 60000); }
                }
                if (doc.viewOnly === true) { cookie.vo = 1; }
                handleSharingRequestEx(req, res, domain, cookie);
            });
            return;
        }
        res.sendStatus(404); return;
    }

    // Serve the guest sharing page
    function handleSharingRequestEx(req, res, domain, c) {
        // Check the expired time, expire message.
        if ((c.expire != null) && (c.expire <= Date.now())) { render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: 12, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain)); return; }

        // Check the public id
        obj.db.GetAllTypeNodeFiltered([c.nid], domain.id, 'deviceshare', null, function (err, docs) {
            // Check if any desktop sharing links are present, expire message.
            if ((err != null) || (docs.length == 0)) { render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: 12, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain)); return; }

            // Search for the device share public identifier, expire message.
            var found = false;
            for (var i = 0; i < docs.length; i++) { if ((docs[i].publicid == c.pid) && ((docs[i].extrakey == null) || (docs[i].extrakey === c.k))) { found = true; } }
            if (found == false) { render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: 12, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain)); return; }

            // Get information about this node
            obj.db.Get(c.nid, function (err, nodes) {
                if ((err != null) || (nodes == null) || (nodes.length != 1)) { res.sendStatus(404); return; }
                var node = nodes[0];

                // Check the start time, not yet valid message.
                if ((c.start != null) && (c.expire != null) && ((c.start > Date.now()) || (c.start > c.expire))) { render(req, res, getRenderPage((domain.sitestyle == 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 2, msgid: 11, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain)); return; }

                // Looks good, let's create the outbound session cookies.
                // Consent flags are 1 = Notify, 8 = Prompt, 64 = Privacy Bar.
                const authCookieData = { userid: c.uid, domainid: domain.id, nid: c.nid, ip: req.clientIp, p: c.p, gn: c.gn, cf: c.cf, r: 8, expire: c.expire, pid: c.pid, vo: c.vo };
                if ((authCookieData.userid == null) && (authCookieData.pid.startsWith('AS:node/'))) { authCookieData.nouser = 1; }
                if (c.k != null) { authCookieData.k = c.k; }
                const authCookie = obj.parent.encodeCookie(authCookieData, obj.parent.loginCookieEncryptionKey);

                // Server features
                var features2 = 0;
                if (obj.args.allowhighqualitydesktop !== false) { features2 += 1; } // Enable AllowHighQualityDesktop (Default true)

                // Lets respond by sending out the desktop viewer.
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                parent.debug('web', 'handleSharingRequest: Sending guest sharing page for \"' + c.uid + '\", guest \"' + c.gn + '\".');
                res.set({ 'Cache-Control': 'no-store' });
                render(req, res, getRenderPage('sharing', req, domain), getRenderArgs({ authCookie: authCookie, authRelayCookie: '', domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27'), nodeid: c.nid, serverDnsName: obj.getWebServerName(domain), serverRedirPort: args.redirport, serverPublicPort: httpsPort, expire: c.expire, viewOnly: (c.vo == 1) ? 1 : 0, nodeName: encodeURIComponent(node.name).replace(/'/g, '%27'), features: c.p, features2: features2 }, req, domain));
            });
        });
    }

    // Handle domain redirection
    obj.handleDomainRedirect = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.redirects == null) { res.sendStatus(404); return; }
        var urlArgs = '', urlName = null, splitUrl = req.originalUrl.split('?');
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
        if (splitpath[0] == 'mesh') { if ((obj.GetMeshRights(user, objid) & 32) == 0) { return null; } } // Check mesh server file rights
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
        if (domain == null) { return; }
        if ((req.query.link == null) || (req.session == null) || (req.session.userid == null) || (domain == null) || (domain.userQuota == -1)) { res.sendStatus(404); return; }
        const user = obj.users[req.session.userid];
        if (user == null) { res.sendStatus(404); return; }
        const file = obj.getServerFilePath(user, domain, req.query.link);
        if (file == null) { res.sendStatus(404); return; }
        setContentDispositionHeader(res, 'application/octet-stream', file.name, null, 'file.bin');
        obj.fs.exists(file.fullpath, function (exists) { if (exists == true) { res.sendFile(file.fullpath); } else { res.sendStatus(404); } });
    }

    // Upload a MeshCore.js file to the server
    function handleUploadMeshCoreFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.id !== '') { res.sendStatus(401); return; }

        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }

        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            // If an authentication cookie is embedded in the form, use that.
            if ((fields != null) && (fields.auth != null) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = obj.parent.decodeCookie(fields.auth[0], obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
                if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // Check cookie IP binding.
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { authUserid = loginCookie.userid; } // Use cookie authentication
            }
            if (authUserid == null) { res.sendStatus(401); return; }
            if ((fields == null) || (fields.attrib == null) || (fields.attrib.length != 1)) { res.sendStatus(404); return; }

            // Get the user
            const user = obj.users[authUserid];
            if (user == null) { res.sendStatus(401); return; } // Check this user exists

            // Get the node and check node rights
            const nodeid = fields.attrib[0];
            obj.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                if ((node == null) || (rights != 0xFFFFFFFF) || (visible == false)) { res.sendStatus(404); return; } // We don't have remote control rights to this device
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
        });
    }

    // Upload a MeshCore.js file to the server
    function handleOneClickRecoveryFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.id !== '') { res.sendStatus(401); return; }

        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }

        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            // If an authentication cookie is embedded in the form, use that.
            if ((fields != null) && (fields.auth != null) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = obj.parent.decodeCookie(fields.auth[0], obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
                if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // Check cookie IP binding.
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { authUserid = loginCookie.userid; } // Use cookie authentication
            }
            if (authUserid == null) { res.sendStatus(401); return; }
            if ((fields == null) || (fields.attrib == null) || (fields.attrib.length != 1)) { res.sendStatus(404); return; }

            // Get the user
            const user = obj.users[authUserid];
            if (user == null) { res.sendStatus(401); return; } // Check this user exists

            // Get the node and check node rights
            const nodeid = fields.attrib[0];
            obj.GetNodeWithRights(domain, user, nodeid, function (node, rights, visible) {
                if ((node == null) || (rights != 0xFFFFFFFF) || (visible == false)) { res.sendStatus(404); return; } // We don't have remote control rights to this device
                for (var i in files.files) {
                    var file = files.files[i];

                    // Event Intel AMT One Click Recovery, this will cause Intel AMT wake operations on this and other servers.
                    parent.DispatchEvent('*', obj, { action: 'oneclickrecovery', userid: user._id, username: user.name, nodeids: [node._id], domain: domain.id, nolog: 1, file: file.path });

                    //try { obj.fs.unlinkSync(file.path); } catch (e) { } // TODO: Remove this file after 30 minutes.
                }
                res.send('');
            });
        });
    }

    // Upload a file to the server
    function handleUploadFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (domain.userQuota == -1) { res.sendStatus(401); return; }
        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }
        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            // If an authentication cookie is embedded in the form, use that.
            if ((fields != null) && (fields.auth != null) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = obj.parent.decodeCookie(fields.auth[0], obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
                if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // Check cookie IP binding.
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { authUserid = loginCookie.userid; } // Use cookie authentication
            }
            if (authUserid == null) { res.sendStatus(401); return; }

            // Get the user
            const user = obj.users[authUserid];
            if ((user == null) || (user.siteadmin & 8) == 0) { res.sendStatus(401); return; } // Check if we have file rights

            if ((fields == null) || (fields.link == null) || (fields.link.length != 1)) { /*console.log('UploadFile, Invalid Fields:', fields, files);*/ console.log('err4'); res.sendStatus(404); return; }
            var xfile = null;
            try { xfile = obj.getServerFilePath(user, domain, decodeURIComponent(fields.link[0])); } catch (ex) { }
            if (xfile == null) { res.sendStatus(404); return; }
            // Get total bytes in the path
            var totalsize = readTotalFileSize(xfile.fullpath);
            if ((xfile.quota == null) || (totalsize < xfile.quota)) { // Check if the quota is not already broken
                if (fields.name != null) {

                    // See if we need to create the folder
                    var domainx = 'domain';
                    if (domain.id.length > 0) { domainx = 'domain-' + usersplit[1]; }
                    try { obj.fs.mkdirSync(obj.parent.filespath); } catch (ex) { }
                    try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx)); } catch (ex) { }
                    try { obj.fs.mkdirSync(xfile.fullpath); } catch (ex) { }

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
                            } else {
                                // Send a notification
                                obj.parent.DispatchEvent([user._id], obj, { action: 'notify', title: "Disk quota exceed", value: names[i], nolog: 1, id: Math.random() });
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
                            if (domain.id.length > 0) { domainx = 'domain-' + domain.id; }
                            try { obj.fs.mkdirSync(obj.parent.filespath); } catch (e) { }
                            try { obj.fs.mkdirSync(obj.parent.path.join(obj.parent.filespath, domainx)); } catch (e) { }
                            try { obj.fs.mkdirSync(xfile.fullpath); } catch (e) { }

                            // Rename the file
                            obj.fs.rename(file.path, fpath, function (err) {
                                if (err && (err.code === 'EXDEV')) {
                                    // On some Linux, the rename will fail with a "EXDEV" error, do a copy+unlink instead.
                                    obj.common.copyFile(file.path, fpath, function (err) {
                                        obj.fs.unlink(file.path, function (err) {
                                            obj.parent.DispatchEvent([user._id], obj, 'updatefiles'); // Fire an event causing this user to update this files
                                        });
                                    });
                                } else {
                                    obj.parent.DispatchEvent([user._id], obj, 'updatefiles'); // Fire an event causing this user to update this files
                                }
                            });
                        } else {
                            // Send a notification
                            obj.parent.DispatchEvent([user._id], obj, { action: 'notify', title: "Disk quota exceed", value: file.originalFilename, nolog: 1, id: Math.random() });
                            try { obj.fs.unlink(file.path, function (err) { }); } catch (e) { }
                        }
                    }
                }
            } else {
                // Send a notification
                obj.parent.DispatchEvent([user._id], obj, { action: 'notify', value: "Disk quota exceed", nolog: 1, id: Math.random() });
            }
            res.send('');
        });
    }

    // Upload a file to the server and then batch upload to many agents
    function handleUploadFileBatch(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }
        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            // If an authentication cookie is embedded in the form, use that.
            if ((fields != null) && (fields.auth != null) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = obj.parent.decodeCookie(fields.auth[0], obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
                if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // Check cookie IP binding.
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { authUserid = loginCookie.userid; } // Use cookie authentication
            }
            if (authUserid == null) { res.sendStatus(401); return; }

            // Get the user
            const user = obj.users[authUserid];
            if (user == null) { parent.debug('web', 'Batch upload error, invalid user.'); res.sendStatus(401); return; } // Check if user exists

            // Get fields
            if ((fields == null) || (fields.nodeIds == null) || (fields.nodeIds.length != 1)) { res.sendStatus(404); return; }
            var cmd = { nodeids: fields.nodeIds[0].split(','), files: [], user: user, domain: domain, overwrite: false, createFolder: false };
            if ((fields.winpath != null) && (fields.winpath.length == 1)) { cmd.windowsPath = fields.winpath[0]; }
            if ((fields.linuxpath != null) && (fields.linuxpath.length == 1)) { cmd.linuxPath = fields.linuxpath[0]; }
            if ((fields.overwriteFiles != null) && (fields.overwriteFiles.length == 1) && (fields.overwriteFiles[0] == 'on')) { cmd.overwrite = true; }
            if ((fields.createFolder != null) && (fields.createFolder.length == 1) && (fields.createFolder[0] == 'on')) { cmd.createFolder = true; }

            // Check if we have at least one target path
            if ((cmd.windowsPath == null) && (cmd.linuxPath == null)) {
                parent.debug('web', 'Batch upload error, invalid fields: ' + JSON.stringify(fields));
                res.send('');
                return;
            }

            // Get server temporary path
            var serverpath = obj.path.join(obj.filespath, 'tmp')
            try { obj.fs.mkdirSync(obj.parent.filespath); } catch (ex) { }
            try { obj.fs.mkdirSync(serverpath); } catch (ex) { }

            // More typical upload method, the file data is in a multipart mime post.
            for (var i in files.files) {
                var file = files.files[i], ftarget = getRandomPassword() + '-' + file.originalFilename, fpath = obj.path.join(serverpath, ftarget);
                cmd.files.push({ name: file.originalFilename, target: ftarget });
                // Rename the file
                obj.fs.rename(file.path, fpath, function (err) {
                    if (err && (err.code === 'EXDEV')) {
                        // On some Linux, the rename will fail with a "EXDEV" error, do a copy+unlink instead.
                        obj.common.copyFile(file.path, fpath, function (err) { obj.fs.unlink(file.path, function (err) { }); });
                    }
                });
            }

            // Instruct one of more agents to download a URL to a given local drive location.
            var tlsCertHash = null;
            if ((parent.args.ignoreagenthashcheck == null) || (parent.args.ignoreagenthashcheck === false)) { // TODO: If ignoreagenthashcheck is an array of IP addresses, not sure how to handle this.
                tlsCertHash = obj.webCertificateFullHashs[cmd.domain.id];
                if (tlsCertHash != null) { tlsCertHash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
            }
            for (var i in cmd.nodeids) {
                obj.GetNodeWithRights(cmd.domain, cmd.user, cmd.nodeids[i], function (node, rights, visible) {
                    if ((node == null) || ((rights & 8) == 0) || (visible == false)) return; // We don't have remote control rights to this device
                    var agentPath = (((node.agent.id > 0) && (node.agent.id < 5)) || (node.agent.id == 34)) ? cmd.windowsPath : cmd.linuxPath;
                    if (agentPath == null) return;

                    // Compute user consent
                    var consent = 0;
                    var mesh = obj.meshes[node.meshid];
                    if (typeof domain.userconsentflags == 'number') { consent |= domain.userconsentflags; } // Add server required consent flags
                    if ((mesh != null) && (typeof mesh.consent == 'number')) { consent |= mesh.consent; } // Add device group user consent
                    if (typeof node.consent == 'number') { consent |= node.consent; } // Add node user consent
                    if (typeof user.consent == 'number') { consent |= user.consent; } // Add user consent

                    // Check if we need to add consent flags because of a user group link
                    if ((mesh != null) && (user.links != null) && (user.links[mesh._id] == null) && (user.links[node._id] == null)) {
                        // This user does not have a direct link to the device group or device. Find all user groups the would cause the link.
                        for (var i in user.links) {
                            var ugrp = obj.userGroups[i];
                            if ((ugrp != null) && (ugrp.consent != null) && (ugrp.links != null) && ((ugrp.links[mesh._id] != null) || (ugrp.links[node._id] != null))) {
                                consent |= ugrp.consent; // Add user group consent flags
                            }
                        }
                    }

                    // Event that this operation is being performed.
                    var targets = obj.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', cmd.user._id]);
                    var msgid = 103; // "Batch upload of {0} file(s) to folder {1}"
                    var event = { etype: 'node', userid: cmd.user._id, username: cmd.user.name, nodeid: node._id, action: 'batchupload', msg: 'Performing batch upload of ' + cmd.files.length + ' file(s) to ' + agentPath, msgid: msgid, msgArgs: [cmd.files.length, agentPath], domain: cmd.domain.id };
                    parent.DispatchEvent(targets, obj, event);

                    // Send the agent commands to perform the batch upload operation
                    for (var f in cmd.files) {
                        if (cmd.files[f].name != null) {
                            const acmd = { action: 'wget', userid: user._id, username: user.name, realname: user.realname, remoteaddr: req.clientIp, consent: consent, rights: rights, overwrite: cmd.overwrite, createFolder: cmd.createFolder, urlpath: '/agentdownload.ashx?c=' + obj.parent.encodeCookie({ a: 'tmpdl', d: cmd.domain.id, nid: node._id, f: cmd.files[f].target }, obj.parent.loginCookieEncryptionKey), path: obj.path.join(agentPath, cmd.files[f].name), folder: agentPath, servertlshash: tlsCertHash };
                            var agent = obj.wsagents[node._id];
                            if (agent != null) { try { agent.send(JSON.stringify(acmd)); } catch (ex) { } }
                            // TODO: Add support for peer servers.
                        }
                    }
                });
            }

            res.send('');
        });
    }

    // Subscribe to all events we are allowed to receive
    obj.subscribe = function (userid, target) {
        const user = obj.users[userid];
        const subscriptions = [userid, 'server-allusers'];
        if (user.siteadmin != null) {
            // Allow full site administrators of users with all events rights to see all events.
            if ((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 2048) != 0)) { subscriptions.push('*'); }
            else if ((user.siteadmin & 2) != 0) {
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
        parent.debug('web', 'Websocket relay connected from ' + user.name + ' for ' + req.query.host + '.');

        try { ws._socket.setKeepAlive(true, 240000); } catch (ex) { }   // Set TCP keep alive

        // Fetch information about the target
        obj.db.Get(req.query.host, function (err, docs) {
            if (docs.length == 0) { console.log('ERR: Node not found'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
            var node = docs[0];
            if (!node.intelamt) { console.log('ERR: Not AMT node'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket

            // Check if this user has permission to manage this computer
            if ((obj.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (3)'); try { ws.close(); } catch (e) { } return; }

            // Check what connectivity is available for this node
            var state = parent.GetConnectivityState(req.query.host);
            var conn = 0;
            if (!state || state.connectivity == 0) { parent.debug('web', 'ERR: No routing possible (1)'); try { ws.close(); } catch (e) { } return; } else { conn = state.connectivity; }

            // Check what server needs to handle this connection
            if ((obj.parent.multiServer != null) && ((cookie == null) || (cookie.ps != 1))) { // If a cookie is provided and is from a peer server, don't allow the connection to jump again to a different server
                var server = obj.parent.GetRoutingServerId(req.query.host, 2); // Check for Intel CIRA connection
                if (server != null) {
                    if (server.serverid != obj.parent.serverId) {
                        // Do local Intel CIRA routing using a different server
                        parent.debug('web', 'Route Intel AMT CIRA connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                } else {
                    server = obj.parent.GetRoutingServerId(req.query.host, 4); // Check for local Intel AMT connection
                    if ((server != null) && (server.serverid != obj.parent.serverId)) {
                        // Do local Intel AMT routing using a different server
                        parent.debug('web', 'Route Intel AMT direct connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                }
            }

            // Setup session recording if needed
            if (domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf((req.query.p == 2) ? 101 : 100) >= 0)))) { // TODO 100
                // Check again if we need to do recording
                var record = true;

                // Check user or device group recording
                if ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.onlyselectedusers === true) || (domain.sessionrecording.onlyselecteddevicegroups === true))) {
                    record = false;

                    // Check device group recording
                    if (domain.sessionrecording.onlyselecteddevicegroups === true) {
                        var mesh = obj.meshes[node.meshid];
                        if ((mesh.flags != null) && ((mesh.flags & 4) != 0)) { record = true; } // Record the session
                    }

                    // Check user recording
                    if (domain.sessionrecording.onlyselectedusers === true) {
                        if ((user.flags != null) && ((user.flags & 2) != 0)) { record = true; } // Record the session
                    }
                }

                if (record == true) {
                    var now = new Date(Date.now());
                    var recFilename = 'relaysession' + ((domain.id == '') ? '' : '-') + domain.id + '-' + now.getUTCFullYear() + '-' + obj.common.zeroPad(now.getUTCMonth() + 1, 2) + '-' + obj.common.zeroPad(now.getUTCDate(), 2) + '-' + obj.common.zeroPad(now.getUTCHours(), 2) + '-' + obj.common.zeroPad(now.getUTCMinutes(), 2) + '-' + obj.common.zeroPad(now.getUTCSeconds(), 2) + '-' + getRandomPassword() + '.mcrec'
                    var recFullFilename = null;
                    if (domain.sessionrecording.filepath) {
                        try { obj.fs.mkdirSync(domain.sessionrecording.filepath); } catch (e) { }
                        recFullFilename = obj.path.join(domain.sessionrecording.filepath, recFilename);
                    } else {
                        try { obj.fs.mkdirSync(parent.recordpath); } catch (e) { }
                        recFullFilename = obj.path.join(parent.recordpath, recFilename);
                    }
                    var fd = obj.fs.openSync(recFullFilename, 'w');
                    if (fd != null) {
                        // Write the recording file header
                        var firstBlock = JSON.stringify({ magic: 'MeshCentralRelaySession', ver: 1, userid: user._id, username: user.name, ipaddr: req.clientIp, nodeid: node._id, intelamt: true, protocol: (req.query.p == 2) ? 101 : 100, time: new Date().toLocaleString() })
                        recordingEntry(fd, 1, 0, firstBlock, function () { });
                        ws.logfile = { fd: fd, lock: false };
                        if (req.query.p == 2) { ws.send(Buffer.from(String.fromCharCode(0xF0), 'binary')); } // Intel AMT Redirection: Indicate the session is being recorded
                    }
                }
            }

            // If Intel AMT CIRA connection is available, use it
            var ciraconn = parent.mpsserver.GetConnectionToNode(req.query.host, null, false);
            if (ciraconn != null) {
                parent.debug('web', 'Opening relay CIRA channel connection to ' + req.query.host + '.');

                // TODO: If the CIRA connection is a relay or LMS connection, we can't detect the TLS state like this.
                // Compute target port, look at the CIRA port mappings, if non-TLS is allowed, use that, if not use TLS
                var port = 16993;
                //if (node.intelamt.tls == 0) port = 16992; // DEBUG: Allow TLS flag to set TLS mode within CIRA
                if (ciraconn.tag.boundPorts.indexOf(16992) >= 0) port = 16992; // RELEASE: Always use non-TLS mode if available within CIRA
                if (req.query.p == 2) port += 2;

                // Setup a new CIRA channel
                if ((port == 16993) || (port == 16995)) {
                    // Perform TLS
                    var ser = new SerialTunnel();
                    var chnl = parent.mpsserver.SetupChannel(ciraconn, port);

                    // Let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                    // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                    ser.forwardwrite = function (data) { if (data.length > 0) { chnl.write(data); } }; // TLS ---> CIRA

                    // When APF tunnel return something, update SerialTunnel buffer
                    chnl.onData = function (ciraconn, data) { if (data.length > 0) { try { ser.updateBuffer(data); } catch (ex) { console.log(ex); } } }; // CIRA ---> TLS

                    // Handle CIRA tunnel state change
                    chnl.onStateChange = function (ciraconn, state) {
                        parent.debug('webrelay', 'Relay TLS CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                        if (state == 2) {
                            // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                            const tlsoptions = { socket: ser, ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                            if (req.query.tls1only == 1) { tlsoptions.secureProtocol = 'TLSv1_method'; }
                            var tlsock = obj.tls.connect(tlsoptions, function () { parent.debug('webrelay', "CIRA Secure TLS Connection"); ws._socket.resume(); });
                            tlsock.chnl = chnl;
                            tlsock.setEncoding('binary');
                            tlsock.on('error', function (err) { parent.debug('webrelay', "CIRA TLS Connection Error", err); });

                            // Decrypted tunnel from TLS communcation to be forwarded to websocket
                            tlsock.on('data', function (data) {
                                // AMT/TLS ---> WS
                                if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                                try { ws.send(data); } catch (ex) { }
                            });

                            // If TLS is on, forward it through TLSSocket
                            ws.forwardclient = tlsock;
                            ws.forwardclient.xtls = 1;

                            ws.forwardclient.onStateChange = function (ciraconn, state) {
                                parent.debug('webrelay', 'Relay CIRA state change', state);
                                if (state == 0) { try { ws.close(); } catch (e) { } }
                            };

                            ws.forwardclient.onData = function (ciraconn, data) {
                                // Run data thru interceptor
                                if (ws.interceptor) { data = ws.interceptor.processAmtData(data); }

                                if (data.length > 0) {
                                    if (ws.logfile == null) {
                                        try { ws.send(data); } catch (e) { }
                                    } else {
                                        // Log to recording file
                                        recordingEntry(ws.logfile.fd, 2, 0, data, function () { try { ws.send(data); } catch (ex) { console.log(ex); } }); // TODO: Add TLS support
                                    }
                                }
                            };

                            // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                            ws.forwardclient.onSendOk = function (ciraconn) { };
                        }
                    };
                } else {
                    // Without TLS
                    ws.forwardclient = parent.mpsserver.SetupChannel(ciraconn, port);
                    ws.forwardclient.xtls = 0;
                    ws._socket.resume();

                    ws.forwardclient.onStateChange = function (ciraconn, state) {
                        parent.debug('webrelay', 'Relay CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                    };

                    ws.forwardclient.onData = function (ciraconn, data) {
                        //parent.debug('webrelaydata', 'Relay CIRA data to WS', data.length);

                        // Run data thru interceptorp
                        if (ws.interceptor) { data = ws.interceptor.processAmtData(data); }

                        //console.log('AMT --> WS', Buffer.from(data, 'binary').toString('hex'));
                        if (data.length > 0) {
                            if (ws.logfile == null) {
                                try { ws.send(data); } catch (e) { }
                            } else {
                                // Log to recording file
                                recordingEntry(ws.logfile.fd, 2, 0, data, function () { try { ws.send(data); } catch (ex) { console.log(ex); } });
                            }
                        }
                    };

                    // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                    ws.forwardclient.onSendOk = function (ciraconn) { };
                }

                // When data is received from the web socket, forward the data into the associated CIRA cahnnel.
                // If the CIRA connection is pending, the CIRA channel has built-in buffering, so we are ok sending anyway.
                ws.on('message', function (data) {
                    //parent.debug('webrelaydata', 'Relay WS data to CIRA', data.length);
                    if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }

                    // WS ---> AMT/TLS
                    if (ws.interceptor) { data = ws.interceptor.processBrowserData(data); } // Run data thru interceptor

                    // Log to recording file
                    if (ws.logfile == null) {
                        // Forward data to the associated TCP connection.
                        try { ws.forwardclient.write(data); } catch (ex) { }
                    } else {
                        // Log to recording file
                        recordingEntry(ws.logfile.fd, 2, 2, data, function () { try { ws.forwardclient.write(data); } catch (ex) { } });
                    }
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('CIRA server websocket error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
                    parent.debug('webrelay', 'Websocket relay closed on error.');

                    // Websocket closed, close the CIRA channel and TLS session.
                    if (ws.forwardclient) {
                        if (ws.forwardclient.close) { ws.forwardclient.close(); }      // NonTLS, close the CIRA channel
                        if (ws.forwardclient.end) { ws.forwardclient.end(); }          // TLS, close the TLS session
                        if (ws.forwardclient.chnl) { ws.forwardclient.chnl.close(); }  // TLS, close the CIRA channel
                        delete ws.forwardclient;
                    }

                    // Close the recording file
                    if (ws.logfile != null) { recordingEntry(ws.logfile.fd, 3, 0, 'MeshCentralMCREC', function (fd, ws) { obj.fs.close(fd); delete ws.logfile; }, ws); }
                });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function (req) {
                    parent.debug('webrelay', 'Websocket relay closed.');

                    // Websocket closed, close the CIRA channel and TLS session.
                    if (ws.forwardclient) {
                        if (ws.forwardclient.close) { ws.forwardclient.close(); }      // NonTLS, close the CIRA channel
                        if (ws.forwardclient.end) { ws.forwardclient.end(); }          // TLS, close the TLS session
                        if (ws.forwardclient.chnl) { ws.forwardclient.chnl.close(); }  // TLS, close the CIRA channel
                        delete ws.forwardclient;
                    }

                    // Close the recording file
                    if (ws.logfile != null) { recordingEntry(ws.logfile.fd, 3, 0, 'MeshCentralMCREC', function (fd, ws) { obj.fs.close(fd); delete ws.logfile; }, ws); }
                });

                // Note that here, req.query.p: 1 = WSMAN with server auth, 2 = REDIR with server auth, 3 = WSMAN without server auth, 4 = REDIR with server auth

                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) {
                    parent.debug('webrelaydata', 'INTERCEPTOR1', { host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                } else if (req.query.p == 2) {
                    parent.debug('webrelaydata', 'INTERCEPTOR2', { user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                }

                return;
            }

            // If Intel AMT direct connection is possible, option a direct socket
            if ((conn & 4) != 0) {   // We got a new web socket connection, initiate a TCP connection to the target Intel AMT host/port.
                parent.debug('webrelay', 'Opening relay TCP socket connection to ' + req.query.host + '.');

                // When data is received from the web socket, forward the data into the associated TCP connection.
                ws.on('message', function (msg) {
                    //parent.debug('webrelaydata', 'TCP relay data to ' + node.host + ', ' + msg.length + ' bytes');

                    if (typeof msg == 'string') { msg = Buffer.from(msg, 'binary'); }
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor

                    // Log to recording file
                    if (ws.logfile == null) {
                        // Forward data to the associated TCP connection.
                        try { ws.forwardclient.write(msg); } catch (ex) { }
                    } else {
                        // Log to recording file
                        recordingEntry(ws.logfile.fd, 2, 2, msg, function () { try { ws.forwardclient.write(msg); } catch (ex) { } });
                    }
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('Error with relay web socket connection from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
                    parent.debug('webrelay', 'Error with relay web socket connection from ' + req.clientIp + '.');
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }

                    // Close the recording file
                    if (ws.logfile != null) {
                        recordingEntry(ws.logfile.fd, 3, 0, 'MeshCentralMCREC', function (fd) {
                            obj.fs.close(fd);
                            ws.logfile = null;
                        });
                    }
                });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function () {
                    parent.debug('webrelay', 'Closing relay web socket connection to ' + req.query.host + '.');
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }

                    // Close the recording file
                    if (ws.logfile != null) {
                        recordingEntry(ws.logfile.fd, 3, 0, 'MeshCentralMCREC', function (fd) {
                            obj.fs.close(fd);
                            ws.logfile = null;
                        });
                    }
                });

                // Compute target port
                var port = 16992;
                if (node.intelamt.tls > 0) port = 16993; // This is a direct connection, use TLS when possible
                if ((req.query.p == 2) || (req.query.p == 4)) port += 2;

                if (node.intelamt.tls == 0) {
                    // If this is TCP (without TLS) set a normal TCP socket
                    ws.forwardclient = new obj.net.Socket();
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                    ws._socket.resume();
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    var tlsoptions = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false };
                    if (req.query.tls1only == 1) { tlsoptions.secureProtocol = 'TLSv1_method'; }
                    ws.forwardclient = obj.tls.connect(port, node.host, tlsoptions, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        parent.debug('webrelay', 'TLS connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws._socket.resume();
                    });
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                }

                // When we receive data on the TCP connection, forward it back into the web socket connection.
                ws.forwardclient.on('data', function (data) {
                    if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }
                    if (obj.parent.debugLevel >= 1) { // DEBUG
                        parent.debug('webrelaydata', 'TCP relay data from ' + node.host + ', ' + data.length + ' bytes.');
                        //if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + Buffer.from(data, 'binary').toString('hex')); }
                    }
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    if (ws.logfile == null) {
                        // No logging
                        try { ws.send(data); } catch (e) { }
                    } else {
                        // Log to recording file
                        recordingEntry(ws.logfile.fd, 2, 0, data, function () { try { ws.send(data); } catch (e) { } });
                    }
                });

                // If the TCP connection closes, disconnect the associated web socket.
                ws.forwardclient.on('close', function () {
                    parent.debug('webrelay', 'TCP relay disconnected from ' + node.host + ':' + port + '.');
                    try { ws.close(); } catch (e) { }
                });

                // If the TCP connection causes an error, disconnect the associated web socket.
                ws.forwardclient.on('error', function (err) {
                    parent.debug('webrelay', 'TCP relay error from ' + node.host + ':' + port + ': ' + err);
                    try { ws.close(); } catch (e) { }
                });

                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) { ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass }); }
                else if (req.query.p == 2) { ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass }); }

                if (node.intelamt.tls == 0) {
                    // A TCP connection to Intel AMT just connected, start forwarding.
                    ws.forwardclient.connect(port, node.host, function () {
                        parent.debug('webrelay', 'TCP relay connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws._socket.resume();
                    });
                }
                return;
            }

        });
    }    

    // Setup agent to/from server file transfer handler
    function handleAgentFileTransfer(ws, req) {
        var domain = checkAgentIpAddress(ws, req);
        if (domain == null) { parent.debug('web', 'Got agent file transfer connection with bad domain or blocked IP address ' + req.clientIp + ', dropping.'); ws.close(); return; }
        if (req.query.c == null) { parent.debug('web', 'Got agent file transfer connection without a cookie from ' + req.clientIp + ', dropping.'); ws.close(); return; }
        var c = obj.parent.decodeCookie(req.query.c, obj.parent.loginCookieEncryptionKey, 10); // 10 minute timeout
        if ((c == null) || (c.a != 'aft')) { parent.debug('web', 'Got agent file transfer connection with invalid cookie from ' + req.clientIp + ', dropping.'); ws.close(); return; }
        ws.xcmd = c.b; ws.xarg = c.c, ws.xfilelen = 0;
        ws.send('c'); // Indicate connection of the tunnel. In this case, we are the termination point.
        ws.send('5'); // Indicate we want to perform file transfers (5 = Files).
        if (ws.xcmd == 'coredump') {
            // Check the agent core dump folder if not already present.
            var coreDumpPath = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps');
            if (obj.fs.existsSync(coreDumpPath) == false) { try { obj.fs.mkdirSync(coreDumpPath); } catch (ex) { } }
            ws.xfilepath = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', ws.xarg);
            ws.xid = 'coredump';
            ws.send(JSON.stringify({ action: 'download', sub: 'start', ask: 'coredump', id: 'coredump' })); // Ask for a core dump file
        }

        // When data is received from the web socket, echo it back
        ws.on('message', function (data) {
            if (typeof data == 'string') {
                // Control message
                var cmd = null;
                try { cmd = JSON.parse(data); } catch (ex) { }
                if ((cmd == null) || (cmd.action != 'download') || (cmd.sub == null)) return;
                switch (cmd.sub) {
                    case 'start': {
                        // Perform an async file open
                        var callback = function onFileOpen(err, fd) {
                            onFileOpen.xws.xfile = fd;
                            try { onFileOpen.xws.send(JSON.stringify({ action: 'download', sub: 'startack', id: onFileOpen.xws.xid, ack: 1 })); } catch (ex) { } // Ask for a directory (test)
                        };
                        callback.xws = this;
                        obj.fs.open(this.xfilepath + '.part', 'w', callback);
                        break;
                    }
                }
            } else {
                // Binary message
                if (data.length < 4) return;
                var flags = data.readInt32BE(0);
                if ((data.length > 4)) {
                    // Write the file
                    this.xfilelen += (data.length - 4);
                    try {
                        var callback = function onFileDataWritten(err, bytesWritten, buffer) {
                            if (onFileDataWritten.xflags & 1) {
                                // End of file
                                parent.debug('web', "Completed downloads of agent dumpfile, " + onFileDataWritten.xws.xfilelen + " bytes.");
                                if (onFileDataWritten.xws.xfile) {
                                    obj.fs.close(onFileDataWritten.xws.xfile, function (err) { });
                                    obj.fs.rename(onFileDataWritten.xws.xfilepath + '.part', onFileDataWritten.xws.xfilepath, function (err) { });
                                    onFileDataWritten.xws.xfile = null;
                                }
                                try { onFileDataWritten.xws.send(JSON.stringify({ action: 'markcoredump' })); } catch (ex) { } // Ask to delete the core dump file
                                try { onFileDataWritten.xws.close(); } catch (ex) { }
                            } else {
                                // Send ack
                                try { onFileDataWritten.xws.send(JSON.stringify({ action: 'download', sub: 'ack', id: onFileDataWritten.xws.xid })); } catch (ex) { } // Ask for a directory (test)
                            }
                        };
                        callback.xws = this;
                        callback.xflags = flags;
                        obj.fs.write(this.xfile, data, 4, data.length - 4, callback);
                    } catch (ex) { }
                } else {
                    if (flags & 1) {
                        // End of file
                        parent.debug('web', "Completed downloads of agent dumpfile, " + this.xfilelen + " bytes.");
                        if (this.xfile) {
                            obj.fs.close(this.xfile, function (err) { });
                            obj.fs.rename(this.xfilepath + '.part', this.xfilepath, function (err) { });
                            this.xfile = null;
                        }
                        this.send(JSON.stringify({ action: 'markcoredump' })); // Ask to delete the core dump file
                        try { this.close(); } catch (ex) { }
                    } else {
                        // Send ack
                        this.send(JSON.stringify({ action: 'download', sub: 'ack', id: this.xid })); // Ask for a directory (test)
                    }
                }
            }
        });

        // If error, do nothing.
        ws.on('error', function (err) { console.log('Agent file transfer server error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.'); });

        // If closed, do nothing
        ws.on('close', function (req) {
            if (this.xfile) {
                obj.fs.close(this.xfile, function (err) { });
                obj.fs.unlink(this.xfilepath + '.part', function (err) { }); // Remove a partial file
            }
        });
    }

    // Handle the web socket echo request, just echo back the data sent
    function handleEchoWebSocket(ws, req) {
        const domain = checkUserIpAddress(ws, req);
        if (domain == null) { return; }
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
        ws.on('error', function (err) { console.log('Echo server error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.'); });

        // If closed, do nothing
        ws.on('close', function (req) { });
    }

    // Handle the 2FA hold web socket
    // Accept an hold a web socket connection until the 2FA response is received.
    function handle2faHoldWebSocket(ws, req) {
        const domain = checkUserIpAddress(ws, req);
        if (domain == null) { return; }
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.push2factor == false)) { ws.close(); return; } // Push 2FA is disabled
        if (typeof req.query.c !== 'string') { ws.close(); return; }
        const cookie = parent.decodeCookie(req.query.c, null, 1);
        if ((cookie == null) || (cookie.d != domain.id)) { ws.close(); return; }
        var user = obj.users[cookie.u];
        if ((user == null) || (typeof user.otpdev != 'string')) { ws.close(); return; }
        ws._socket.setKeepAlive(true, 240000); // Set TCP keep alive

        // 2FA event subscription
        obj.parent.AddEventDispatch(['2fadev-' + cookie.s], ws);
        ws.cookie = cookie;
        ws.HandleEvent = function (source, event, ids, id) {
            obj.parent.RemoveAllEventDispatch(this);
            if ((event.approved === true) && (event.userid == this.cookie.u)) {
                // Create a login cookie
                const loginCookie = obj.parent.encodeCookie({ a: 'pushAuth', u: event.userid, d: event.domain }, obj.parent.loginCookieEncryptionKey);
                try { ws.send(JSON.stringify({ approved: true, token: loginCookie })); } catch (ex) { }
            } else {
                // Reject the login
                try { ws.send(JSON.stringify({ approved: false })); } catch (ex) { }
            }
        }

        // We do not accept any data on this connection.
        ws.on('message', function (data) { this.close(); });

        // If error, do nothing.
        ws.on('error', function (err) { });

        // If closed, unsubscribe
        ws.on('close', function (req) { obj.parent.RemoveAllEventDispatch(this); });

        // Perform push notification to device
        try {
            const deviceCookie = parent.encodeCookie({ a: 'checkAuth', c: cookie.c, u: cookie.u, n: cookie.n, s: cookie.s });
            var code = Buffer.from(cookie.c, 'base64').toString();
            var payload = { notification: { title: (domain.title ? domain.title : 'MeshCentral'), body: "Authentication - " + code }, data: { url: '2fa://auth?code=' + cookie.c + '&c=' + deviceCookie } };
            var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
            parent.firebase.sendToDevice(user.otpdev, payload, options, function (id, err, errdesc) {
                if (err == null) {
                    try { ws.send(JSON.stringify({ sent: true, code: code })); } catch (ex) { }
                } else {
                    try { ws.send(JSON.stringify({ sent: false })); } catch (ex) { }
                }
            });
        } catch (ex) { console.log(ex); }
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
        try {
            obj.fs.readdirSync(path).forEach(function (file, index) {
                var pathx = path + '/' + file;
                if (obj.fs.lstatSync(pathx).isDirectory()) { deleteFolderRec(pathx); } else { obj.fs.unlinkSync(pathx); }
            });
            obj.fs.rmdirSync(path);
        } catch (ex) { }
    }

    // Handle Intel AMT events
    // To subscribe, add "http://server:port/amtevents.ashx" to Intel AMT subscriptions.
    obj.handleAmtEventRequest = function (req, res) {
        const domain = getDomain(req);
        try {
            if (req.headers.authorization) {
                var authstr = req.headers.authorization;
                if (authstr.substring(0, 7) == 'Digest ') {
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
                                            var amtpass = obj.crypto.createHash('sha384').update(auth.username.toLowerCase() + ':' + nodeid + ":" + obj.parent.dbconfig.amtWsEventSecret).digest('base64').substring(0, 12).split('/').join('x').split('\\').join('x');

                                            // Check the MD5 hash
                                            if (auth.response === obj.common.ComputeDigesthash(auth.username, amtpass, auth.realm, 'POST', auth.uri, auth.qop, auth.nonce, auth.nc, auth.cnonce)) {

                                                // This is an authenticated Intel AMT event, update the host address
                                                var amthost = req.clientIp;
                                                if (amthost.substring(0, 7) === '::ffff:') { amthost = amthost.substring(7); }
                                                if (node.host != amthost) {
                                                    // Get the mesh for this device
                                                    var mesh = obj.meshes[node.meshid];
                                                    if (mesh) {
                                                        // Update the database
                                                        var oldname = node.host;
                                                        node.host = amthost;
                                                        obj.db.Set(obj.cleanDevice(node));

                                                        // Event the node change
                                                        var event = { etype: 'node', action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Intel(R) AMT host change ' + node.name + ' from group ' + mesh.name + ': ' + oldname + ' to ' + amthost };

                                                        // Remove the Intel AMT password before eventing this.
                                                        event.node = node;
                                                        if (event.node.intelamt && event.node.intelamt.pass) {
                                                            event.node = Object.assign({}, event.node); // Shallow clone
                                                            event.node.intelamt = Object.assign({}, event.node.intelamt); // Shallow clone
                                                            delete event.node.intelamt.pass;
                                                        }

                                                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                                                        obj.parent.DispatchEvent(['*', node.meshid], obj, event);
                                                    }
                                                }

                                                if (parent.amtEventHandler) { parent.amtEventHandler.handleAmtEvent(eventData, nodeid, amthost); }
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
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
        if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver.backup !== true))) { res.sendStatus(401); return; }

        var user = obj.users[req.session.userid];
        if ((user == null) || ((user.siteadmin & 1) == 0)) { res.sendStatus(401); return; } // Check if we have server backup rights

        // Require modules
        const archive = require('archiver')('zip', { level: 9 }); // Sets the compression method to maximum. 

        // Good practice to catch this error explicitly
        archive.on('error', function (err) { throw err; });

        // Set the archive name
        res.attachment((domain.title ? domain.title : 'MeshCentral') + '-Backup-' + new Date().toLocaleDateString().replace('/', '-').replace('/', '-') + '.zip');

        // Pipe archive data to the file 
        archive.pipe(res);

        // Append files from a glob pattern
        archive.directory(obj.parent.datapath, false);

        // Finalize the archive (ie we are done appending files but streams have to finish yet) 
        archive.finalize();
    }

    // Handle a server restore request
    function handleRestoreRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver.restore !== true))) { res.sendStatus(401); return; }

        var authUserid = null;
        if ((req.session != null) && (typeof req.session.userid == 'string')) { authUserid = req.session.userid; }
        const multiparty = require('multiparty');
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            // If an authentication cookie is embedded in the form, use that.
            if ((fields != null) && (fields.auth != null) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = obj.parent.decodeCookie(fields.auth[0], obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
                if ((loginCookie != null) && (obj.args.cookieipcheck !== false) && (loginCookie.ip != null) && (loginCookie.ip != req.clientIp)) { loginCookie = null; } // Check cookie IP binding.
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) { authUserid = loginCookie.userid; } // Use cookie authentication
            }
            if (authUserid == null) { res.sendStatus(401); return; }

            // Get the user
            const user = obj.users[req.session.userid];
            if ((user == null) || ((user.siteadmin & 4) == 0)) { res.sendStatus(401); return; } // Check if we have server restore rights

            res.set('Content-Type', 'text/html');
            res.end('<html><body>Server must be restarted, <a href="' + domain.url + '">click here to login</a>.</body></html>');
            parent.Stop(files.datafile[0].path);
        });
    }

    // Handle a request to download a mesh agent
    obj.handleMeshAgentRequest = function (req, res) {
        var domain = getDomain(req, res);
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { res.sendStatus(401); return; }

        if ((req.query.meshinstall != null) && (req.query.id != null)) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send meshagent with included self installer for a specific platform back
            // Start by getting the .msh for this request
            var meshsettings = getMshFromRequest(req, res, domain);
            if (meshsettings == null) { try { res.sendStatus(401); } catch (ex) { } return; }

            // Get the interactive install script, this only works for non-Windows agents
            var agentid = parseInt(req.query.meshinstall);
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
            var scriptInfo = obj.parent.meshAgentInstallScripts[6];
            if ((argentInfo == null) || (scriptInfo == null) || (argentInfo.platform == 'win32')) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Change the .msh file into JSON format and merge it into the install script
            var tokens, msh = {}, meshsettingslines = meshsettings.split('\r').join('').split('\n');
            for (var i in meshsettingslines) { tokens = meshsettingslines[i].split('='); if (tokens.length == 2) { msh[tokens[0]] = tokens[1]; } }
            var js = scriptInfo.data.replace('var msh = {};', 'var msh = ' + JSON.stringify(msh) + ';');

            // Get the agent filename
            var meshagentFilename = 'meshagent';
            if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }

            setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename, null, 'meshagent');
            if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
            res.statusCode = 200;
            obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: Buffer.from(js, 'utf8'), peinfo: argentInfo.pe });
        } else if (req.query.id != null) {
            // Send a specific mesh agent back
            var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) { argentInfo = domain.meshAgentBinaries[req.query.id]; }
            if (argentInfo == null) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Download PDB debug files, only allowed for administrator or accounts with agent dump access
            if (req.query.pdb == 1) {
                if ((req.session == null) || (req.session.userid == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
                var user = obj.users[req.session.userid];
                if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                if ((user != null) && ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0)))) {
                    if (argentInfo.id == 3) {
                        setContentDispositionHeader(res, 'application/octet-stream', 'MeshService.pdb', null, 'MeshService.pdb');
                        if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                        try { res.sendFile(argentInfo.path.split('MeshService-signed.exe').join('MeshService.pdb')); } catch (ex) { }
                        return;
                    }
                    if (argentInfo.id == 4) {
                        setContentDispositionHeader(res, 'application/octet-stream', 'MeshService64.pdb', null, 'MeshService64.pdb');
                        if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                        try { res.sendFile(argentInfo.path.split('MeshService64-signed.exe').join('MeshService64.pdb')); } catch (ex) { }
                        return;
                    }
                }
                try { res.sendStatus(404); } catch (ex) { }
                return;
            }

            if ((req.query.meshid == null) || (argentInfo.platform != 'win32')) {
                // Get the agent filename
                var meshagentFilename = argentInfo.rname;
                if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }
                if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                if (req.query.zip == 1) { if (argentInfo.zdata != null) { setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename + '.zip', null, 'meshagent.zip'); res.send(argentInfo.zdata); } else { try { res.sendStatus(404); } catch (ex) { } } return; } // Send compressed agent
                setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename, null, 'meshagent');
                if (argentInfo.data == null) { res.sendFile(argentInfo.path); } else { res.send(argentInfo.data); }
                return;
            } else {
                // Check if the meshid is a time limited, encrypted cookie
                var meshcookie = obj.parent.decodeCookie(req.query.meshid, obj.parent.invitationLinkEncryptionKey);
                if ((meshcookie != null) && (meshcookie.m != null)) { req.query.meshid = meshcookie.m; }

                // We are going to embed the .msh file into the Windows executable (signed or not).
                // First, fetch the mesh object to build the .msh file
                var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
                if (mesh == null) { try { res.sendStatus(401); } catch (ex) { } return; }

                // If required, check if this user has rights to do this
                if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
                    if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { try { res.sendStatus(401); } catch (ex) { } return; }
                }

                var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port if specified
                if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
                if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.

                // Prepare a mesh agent file name using the device group name.
                var meshfilename = mesh.name
                meshfilename = meshfilename.split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split(' ').join('').split('\'').join('');
                if (argentInfo.rname.endsWith('.exe')) { meshfilename = argentInfo.rname.substring(0, argentInfo.rname.length - 4) + '-' + meshfilename + '.exe'; } else { meshfilename = argentInfo.rname + '-' + meshfilename; }

                // Customize the mesh agent file name
                if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) {
                    meshfilename = meshfilename.split('meshagent').join(domain.agentcustomization.filename).split('MeshAgent').join(domain.agentcustomization.filename);
                }

                // Get the agent connection server name
                var serverName = obj.getWebServerName(domain);
                if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

                // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                var xdomain = (domain.dns == null) ? domain.id : '';
                if (xdomain != '') xdomain += '/';
                var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
                if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
                    meshsettings += 'MeshServer=local\r\n';
                    if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
                }
                if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + req.query.tag + '\r\n'; }
                if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
                if (req.query.id == '10006') { // Assistant settings and customizations
                    if ((req.query.ac != null)) { meshsettings += 'AutoConnect=' + req.query.ac + '\r\n'; } // Set MeshCentral Assistant flags if needed. 0x01 = Always Connected, 0x02 = Not System Tray
                    if (obj.args.assistantconfig) { for (var i in obj.args.assistantconfig) { meshsettings += obj.args.assistantconfig[i] + '\r\n'; } }
                    if (domain.assistantconfig) { for (var i in domain.assistantconfig) { meshsettings += domain.assistantconfig[i] + '\r\n'; } }
                    if ((domain.assistantnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
                    if ((domain.assistantcustomization != null) && (typeof domain.assistantcustomization == 'object')) {
                        if (typeof domain.assistantcustomization.title == 'string') { meshsettings += 'Title=' + domain.assistantcustomization.title + '\r\n'; }
                        if (typeof domain.assistantcustomization.image == 'string') {
                            try { meshsettings += 'Image=' + Buffer.from(obj.fs.readFileSync(parent.getConfigFilePath(domain.assistantcustomization.image)), 'binary').toString('base64') + '\r\n'; } catch (ex) { console.log(ex); }
                        }
                        if (req.query.ac != '4') {
                            // Send with custom filename followed by device group name
                            if (typeof domain.assistantcustomization.filename == 'string') { meshfilename = meshfilename.split('MeshCentralAssistant').join(domain.assistantcustomization.filename); }
                        } else {
                            // Send with custom filename, no device group name
                            if (typeof domain.assistantcustomization.filename == 'string') { meshfilename = domain.assistantcustomization.filename + '.exe'; } else { meshfilename = 'MeshCentralAssistant.exe'; }
                        }
                    }
                } else { // Add agent customization, not for Assistant
                    if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
                    if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
                    if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
                    if (domain.agentcustomization != null) {
                        if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
                        if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
                        if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
                        if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
                        if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
                        if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
                        if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
                        if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
                    }
                    if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; } // Translation strings, not for MeshCentral Assistant
                }
                setContentDispositionHeader(res, 'application/octet-stream', meshfilename, null, argentInfo.rname);
                if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) {
                    obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: domain.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: domain.meshAgentBinaries[req.query.id].pe });
                } else {
                    obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: obj.parent.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: obj.parent.meshAgentBinaries[req.query.id].pe });
                }
                return;
            }
        } else if (req.query.script != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send a specific mesh install script back
            var scriptInfo = obj.parent.meshAgentInstallScripts[req.query.script];
            if (scriptInfo == null) { try { res.sendStatus(404); } catch (ex) { } return; }
            setContentDispositionHeader(res, 'application/octet-stream', scriptInfo.rname, null, 'script');
            var data = scriptInfo.data;
            var cmdoptions = { wgetoptionshttp: '', wgetoptionshttps: '', curloptionshttp: '-L ', curloptionshttps: '-L ' }
            if (obj.isTrustedCert(domain) != true) {
                cmdoptions.wgetoptionshttps += '--no-check-certificate ';
                cmdoptions.curloptionshttps += '-k ';
            }
            if (domain.agentnoproxy === true) {
                cmdoptions.wgetoptionshttp += '--no-proxy ';
                cmdoptions.wgetoptionshttps += '--no-proxy ';
                cmdoptions.curloptionshttp += '--noproxy \'*\' ';
                cmdoptions.curloptionshttps += '--noproxy \'*\' ';
            }
            for (var i in cmdoptions) { data = data.split('{{{' + i + '}}}').join(cmdoptions[i]); }
            res.send(data);
            return;
        } else if (req.query.meshcmd != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send meshcmd for a specific platform back
            var agentid = parseInt(req.query.meshcmd);
            // If the agentid is 3 or 4, check if we have a signed MeshCmd.exe
            if ((agentid == 3)) { // Signed Windows MeshCmd.exe x86
                var stats = null, meshCmdPath = obj.path.join(__dirname, 'agents', 'MeshCmd-signed.exe');
                try { stats = obj.fs.statSync(meshCmdPath); } catch (e) { }
                if ((stats != null)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd' + ((req.query.meshcmd <= 3) ? '.exe' : ''), null, 'meshcmd');
                    res.sendFile(meshCmdPath); return;
                }
            } else if ((agentid == 4)) { // Signed Windows MeshCmd64.exe x64
                var stats = null, meshCmd64Path = obj.path.join(__dirname, 'agents', 'MeshCmd64-signed.exe');
                try { stats = obj.fs.statSync(meshCmd64Path); } catch (e) { }
                if ((stats != null)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : ''), null, 'meshcmd');
                    res.sendFile(meshCmd64Path); return;
                }
            }

            // No signed agents, we are going to merge a new MeshCmd.
            if (((agentid == 3) || (agentid == 4)) && (obj.parent.meshAgentBinaries[agentid + 10000] != null)) { agentid += 10000; } // Avoid merging javascript to a signed mesh agent.
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
            if ((argentInfo == null) || (obj.parent.defaultMeshCmd == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
            setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : ''), null, 'meshcmd');
            res.statusCode = 200;

            if (argentInfo.signedMeshCmdPath != null) {
                // If we have a pre-signed MeshCmd, send that.
                res.sendFile(argentInfo.signedMeshCmdPath);
            } else {
                // Merge JavaScript to a unsigned agent and send that.
                obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: Buffer.from(obj.parent.defaultMeshCmd, 'utf8'), peinfo: argentInfo.pe });
            }
            return;
        } else if (req.query.meshaction != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key
            var user = obj.users[req.session.userid];
            if (user == null) {
                // Check if we have an authentication cookie
                var c = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey);
                if (c == null) { try { res.sendStatus(404); } catch (ex) { } return; }

                // Download tools using a cookie
                if (c.download == req.query.meshaction) {
                    if (req.query.meshaction == 'winrouter') {
                        var p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.exe');
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.exe', null, 'MeshCentralRouter.exe');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    } else if (req.query.meshaction == 'winassistant') {
                        var p = obj.path.join(__dirname, 'agents', 'MeshCentralAssistant.exe');
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralAssistant.exe', null, 'MeshCentralAssistant.exe');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    } else if (req.query.meshaction == 'macrouter') {
                        var p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.dmg');
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.dmg', null, 'MeshCentralRouter.dmg');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    }
                    return;
                }

                // Check if the cookie authenticates a user
                if (c.userid == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                user = obj.users[c.userid];
                if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }
            }
            if ((req.query.meshaction == 'route') && (req.query.nodeid != null)) {
                var nodeIdSplit = req.query.nodeid.split('/');
                if ((nodeIdSplit[0] != 'node') || (nodeIdSplit[1] != domain.id)) { try { res.sendStatus(401); } catch (ex) { } return; }
                obj.db.Get(req.query.nodeid, function (err, nodes) {
                    if ((err != null) || (nodes.length != 1)) { try { res.sendStatus(401); } catch (ex) { } return; }
                    var node = nodes[0];

                    // Create the meshaction.txt file for meshcmd.exe
                    var meshaction = {
                        action: req.query.meshaction,
                        localPort: 1234,
                        remoteName: node.name,
                        remoteNodeId: node._id,
                        remoteTarget: null,
                        remotePort: 3389,
                        username: '',
                        password: '',
                        serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                        serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                        debugLevel: 0
                    };
                    if (user != null) { meshaction.username = user.name; }
                    if (req.query.key != null) { meshaction.loginKey = req.query.key; }
                    var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                    if (obj.args.lanonly != true) { meshaction.serverUrl = 'wss://' + obj.getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }

                    setContentDispositionHeader(res, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
                    res.send(JSON.stringify(meshaction, null, ' '));
                    return;
                });
            } else if (req.query.meshaction == 'generic') {
                var meshaction = {
                    username: user.name,
                    password: '',
                    serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                    serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                    debugLevel: 0
                };
                if (user != null) { meshaction.username = user.name; }
                if (req.query.key != null) { meshaction.loginKey = req.query.key; }
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                if (obj.args.lanonly != true) { meshaction.serverUrl = 'wss://' + obj.getWebServerName(domain) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                setContentDispositionHeader(res, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
                res.send(JSON.stringify(meshaction, null, ' '));
                return;
            } else if (req.query.meshaction == 'winrouter') {
                var p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.exe');
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.exe', null, 'MeshCentralRouter.exe');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else if (req.query.meshaction == 'winassistant') {
                var p = obj.path.join(__dirname, 'agents', 'MeshCentralAssistant.exe');
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralAssistant.exe', null, 'MeshCentralAssistant.exe');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else if (req.query.meshaction == 'macrouter') {
                var p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.dmg');
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.dmg', null, 'MeshCentralRouter.dmg');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else {
                try { res.sendStatus(401); } catch (ex) { }
                return;
            }
        } else {
            domain = checkUserIpAddress(req, res); // Recheck the domain to apply user IP filtering.
            if (domain == null) return;
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key
            if ((req.session == null) || (req.session.userid == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
            var user = null, coreDumpsAllowed = false;
            if (typeof req.session.userid == 'string') { user = obj.users[req.session.userid]; }
            if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Check if this user has access to agent core dumps
            if ((obj.parent.config.settings.agentcoredump === true) && ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0)))) {
                coreDumpsAllowed = true;

                if ((req.query.dldump != null) && obj.common.IsFilenameValid(req.query.dldump)) {
                    // Download a dump file
                    var dumpFile = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', req.query.dldump);
                    if (obj.fs.existsSync(dumpFile)) {
                        setContentDispositionHeader(res, 'application/octet-stream', req.query.dldump, null, 'file.bin');
                        res.sendFile(dumpFile); return;
                    } else {
                        try { res.sendStatus(404); } catch (ex) { } return;
                    }
                }

                if ((req.query.deldump != null) && obj.common.IsFilenameValid(req.query.deldump)) {
                    // Delete a dump file
                    try { obj.fs.unlinkSync(obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', req.query.deldump)); } catch (ex) { console.log(ex); }
                }

                if ((req.query.dumps != null) || (req.query.deldump != null)) {
                    // Send list of agent core dumps
                    var response = '<html><head><title>Mesh Agents Core Dumps</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
                    response += '<tr style="background-color:lightgray"><th>ID</th><th>Upload Date</th><th>Description</th><th>Current</th><th>Dump</th><th>Size</th><th>Agent</th><th>Agent SHA384</th><th>NodeID</th><th></th></tr>';

                    var coreDumpPath = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps');
                    if (obj.fs.existsSync(coreDumpPath)) {
                        var files = obj.fs.readdirSync(coreDumpPath);
                        var coredumps = [];
                        for (var i in files) {
                            var file = files[i];
                            if (file.endsWith('.dmp')) {
                                var fileSplit = file.substring(0, file.length - 4).split('-');
                                if (fileSplit.length == 3) {
                                    var agentid = parseInt(fileSplit[0]);
                                    if ((isNaN(agentid) == false) && (obj.parent.meshAgentBinaries[agentid] != null)) {
                                        var agentinfo = obj.parent.meshAgentBinaries[agentid];
                                        if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
                                        var filestats = obj.fs.statSync(obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', file));
                                        coredumps.push({
                                            fileSplit: fileSplit,
                                            agentinfo: agentinfo,
                                            filestats: filestats,
                                            currentAgent: agentinfo.hashhex.startsWith(fileSplit[1].toLowerCase()),
                                            downloadUrl: req.originalUrl.split('?')[0] + '?dldump=' + file + (req.query.key ? ('&key=' + req.query.key) : ''),
                                            deleteUrl: req.originalUrl.split('?')[0] + '?deldump=' + file + (req.query.key ? ('&key=' + req.query.key) : ''),
                                            agentUrl: req.originalUrl.split('?')[0] + '?id=' + agentinfo.id + (req.query.key ? ('&key=' + req.query.key) : ''),
                                            time: new Date(filestats.ctime)
                                        });
                                    }
                                }
                            }
                        }
                        coredumps.sort(function (a, b) { if (a.time > b.time) return -1; if (a.time < b.time) return 1; return 0; });
                        for (var i in coredumps) {
                            var d = coredumps[i];
                            response += '<tr><td>' + d.agentinfo.id + '</td><td>' + d.time.toDateString().split(' ').join('&nbsp;') + '</td><td>' + d.agentinfo.desc.split(' ').join('&nbsp;') + '</td>';
                            response += '<td style=text-align:center>' + d.currentAgent + '</td><td><a download href="' + d.downloadUrl + '">Download</a></td><td style=text-align:right>' + d.filestats.size + '</td>';
                            if (d.currentAgent) { response += '<td><a download href="' + d.agentUrl + '">Download</a></td>'; } else { response += '<td></td>'; }
                            response += '<td>' + d.fileSplit[1].toLowerCase() + '</td><td>' + d.fileSplit[2] + '</td><td><a href="' + d.deleteUrl + '">Delete</a></td></tr>';
                        }
                    }
                    response += '</table><a href="' + req.originalUrl.split('?')[0] + (req.query.key ? ('?key=' + req.query.key) : '') + '">Mesh Agents</a></body></html>';
                    res.send(response);
                    return;
                }
            }

            if (req.query.cores != null) {
                // Send list of agent cores
                var response = '<html><head><title>Mesh Agents Cores</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
                response += '<tr style="background-color:lightgray"><th>Name</th><th>Size</th><th>Comp</th><th>Decompressed Hash SHA384</th></tr>';
                for (var i in parent.defaultMeshCores) {
                    response += '<tr><td>' + i.split(' ').join('&nbsp;') + '</td><td style="text-align:right"><a download href="/meshagents?dlcore=' + i + '">' + parent.defaultMeshCores[i].length + (req.query.key ? ('?key=' + req.query.key) : '') + '</a></td><td style="text-align:right"><a download href="/meshagents?dlccore=' + i + (req.query.key ? ('?key=' + req.query.key) : '') + '">' + parent.defaultMeshCoresDeflate[i].length + '</a></td><td>' + Buffer.from(parent.defaultMeshCoresHash[i], 'binary').toString('hex') + '</td></tr>';
                }
                response += '</table><a href="' + req.originalUrl.split('?')[0] + (req.query.key ? ('?key=' + req.query.key) : '') + '">Mesh Agents</a></body></html>';
                res.send(response);
                return;
            }

            if (req.query.dlcore != null) {
                // Download mesh core
                var bin = parent.defaultMeshCores[req.query.dlcore];
                if ((bin == null) || (bin.length < 5)) { try { res.sendStatus(404); } catch (ex) { } return; }
                setContentDispositionHeader(res, 'application/octet-stream', req.query.dlcore + '.js', null, 'meshcore.js');
                res.send(bin.slice(4));
                return;
            }

            if (req.query.dlccore != null) {
                // Download compressed mesh core
                var bin = parent.defaultMeshCoresDeflate[req.query.dlccore];
                if (bin == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                setContentDispositionHeader(res, 'application/octet-stream', req.query.dlccore + '.js.deflate', null, 'meshcore.js.deflate');
                res.send(bin);
                return;
            }

            // Send a list of available mesh agents
            var response = '<html><head><title>Mesh Agents</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
            response += '<tr style="background-color:lightgray"><th>ID</th><th>Description</th><th>Link</th><th>Size</th><th>SHA384</th><th>MeshCmd</th></tr>';
            var originalUrl = req.originalUrl.split('?')[0];
            for (var agentid in obj.parent.meshAgentBinaries) {
                if ((agentid >= 10000) && (agentid != 10005)) continue;
                var agentinfo = obj.parent.meshAgentBinaries[agentid];
                if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
                response += '<tr><td>' + agentinfo.id + '</td><td>' + agentinfo.desc.split(' ').join('&nbsp;') + '</td>';
                response += '<td><a download href="' + originalUrl + '?id=' + agentinfo.id + (req.query.key ? ('&key=' + req.query.key) : '') + '">' + agentinfo.rname + '</a>';
                if ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0))) {
                    if ((agentid == 3) || (agentid == 4)) { response += ', <a download href="' + originalUrl + '?id=' + agentinfo.id + '&pdb=1' + (req.query.key ? ('&key=' + req.query.key) : '') + '">PDB</a>'; }
                }
                if (agentinfo.zdata != null) { response += ', <a download href="' + originalUrl + '?id=' + agentinfo.id + '&zip=1' + (req.query.key ? ('&key=' + req.query.key) : '') + '">ZIP</a>'; }
                response += '</td>';
                response += '<td>' + agentinfo.size + '</td><td>' + agentinfo.hashhex + '</td>';
                response += '<td><a download href="' + originalUrl + '?meshcmd=' + agentinfo.id + (req.query.key ? ('&key=' + req.query.key) : '') + '">' + agentinfo.rname.replace('agent', 'cmd') + '</a></td></tr>';
            }
            response += '</table>';
            response += '<a href="' + originalUrl + '?cores=1' + (req.query.key ? ('&key=' + req.query.key) : '') + '">MeshCores</a> ';
            if (coreDumpsAllowed) { response += '<a href="' + originalUrl + '?dumps=1' + (req.query.key ? ('&key=' + req.query.key) : '') + '">MeshAgent Crash Dumps</a>'; }
            response += '</body></html>';
            res.send(response);
            return;
        }
    };

    // Get the web server hostname. This may change if using a domain with a DNS name.
    obj.getWebServerName = function (domain) {
        if (domain.dns != null) return domain.dns;
        return obj.certificates.CommonName;
    }

    // Create a OSX mesh agent installer
    obj.handleMeshOsxAgentRequest = function (req, res) {
        const domain = getDomain(req, res);
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }
        if (req.query.id == null) { res.sendStatus(404); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { res.sendStatus(401); return; }

        // Send a specific mesh agent back
        var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
        if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) { argentInfo = domain.meshAgentBinaries[req.query.id]; }
        if ((argentInfo == null) || (req.query.meshid == null)) { res.sendStatus(404); return; }

        // Check if the meshid is a time limited, encrypted cookie
        var meshcookie = obj.parent.decodeCookie(req.query.meshid, obj.parent.invitationLinkEncryptionKey);
        if ((meshcookie != null) && (meshcookie.m != null)) { req.query.meshid = meshcookie.m; }

        // We are going to embed the .msh file into the Windows executable (signed or not).
        // First, fetch the mesh object to build the .msh file
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
        if (mesh == null) { res.sendStatus(401); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
            if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { res.sendStatus(401); return; }
        }

        var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Get the agent connection server name
        var serverName = obj.getWebServerName(domain);
        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
        if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
        if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
            meshsettings += 'MeshServer=local\r\n';
            if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
        }
        if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + req.query.tag + '\r\n'; }
        if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
        if (domain.agentcustomization != null) { // Add agent customization
            if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; }

        // Setup the response output
        var archive = require('archiver')('zip', { level: 5 }); // Sets the compression method.
        archive.on('error', function (err) { throw err; });

        // Set the agent download including the mesh name.
        setContentDispositionHeader(res, 'application/octet-stream', 'MeshAgent-' + mesh.name + '.zip', null, 'MeshAgent.zip');
        archive.pipe(res);

        // Opens the "MeshAgentOSXPackager.zip"
        var yauzl = require('yauzl');
        yauzl.open(obj.path.join(__dirname, 'agents', 'MeshAgentOSXPackager.zip'), { lazyEntries: true }, function (err, zipfile) {
            if (err) { res.sendStatus(500); return; }
            zipfile.readEntry();
            zipfile.on('entry', function (entry) {
                if (/\/$/.test(entry.fileName)) {
                    // Skip all folder entries
                    zipfile.readEntry();
                } else {
                    if (entry.fileName == 'MeshAgent.mpkg/Contents/distribution.dist') {
                        // This is a special file entry, we need to fix it.
                        zipfile.openReadStream(entry, function (err, readStream) {
                            readStream.on('data', function (data) { if (readStream.xxdata) { readStream.xxdata += data; } else { readStream.xxdata = data; } });
                            readStream.on('end', function () {
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
            zipfile.on('end', function () {
                archive.file(argentInfo.path, { name: 'MeshAgent.mpkg/Contents/Packages/internal.pkg/Contents/meshagent_osx64.bin' });
                archive.append(meshsettings, { name: 'MeshAgent.mpkg/Contents/Packages/internal.pkg/Contents/meshagent_osx64.msh' });
                archive.finalize();
            });
        });
    }

    // Return a .msh file from a given request, id is the device group identifier or encrypted cookie with the identifier.
    function getMshFromRequest(req, res, domain) {
        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { return null; }

        // Check if the meshid is a time limited, encrypted cookie
        var meshcookie = obj.parent.decodeCookie(req.query.id, obj.parent.invitationLinkEncryptionKey);
        if ((meshcookie != null) && (meshcookie.m != null)) { req.query.id = meshcookie.m; }

        // Fetch the mesh object
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.id];
        if (mesh == null) { return null; }

        // If needed, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
            if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { return null; }
        }

        var meshidhex = Buffer.from(req.query.id.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Get the agent connection server name
        var serverName = obj.getWebServerName(domain);
        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
        if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
        if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
            meshsettings += 'MeshServer=local\r\n';
            if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
        }
        if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + req.query.tag + '\r\n'; }
        if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
        if (domain.agentcustomization != null) { // Add agent customization
            if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; }
        return meshsettings;
    }

    // Handle a request to download a mesh settings
    obj.handleMeshSettingsRequest = function (req, res) {
        const domain = getDomain(req);
        if (domain == null) { return; }
        //if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }

        var meshsettings = getMshFromRequest(req, res, domain);
        if (meshsettings == null) { res.sendStatus(401); return; }

        // Get the agent filename
        var meshagentFilename = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }

        setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename + '.msh', null, 'meshagent.msh');
        res.send(meshsettings);
    };

    // Handle a request for power events
    obj.handleDevicePowerEvents = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
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
                if (obj.GetNodeRights(user, node.meshid, node._id) == 0) { res.sendStatus(401); return; }

                // See how we will convert UTC time to local time
                var localTimeOffset = 0;
                var timeConversionSystem = 0;
                if ((req.query.l != null) && (req.query.tz != null)) {
                    timeConversionSystem = 1;
                } else if (req.query.tf != null) {
                    // Get local time offset (bad way)
                    timeConversionSystem = 2;
                    localTimeOffset = parseInt(req.query.tf);
                    if (isNaN(localTimeOffset)) { localTimeOffset = 0; }
                }

                // Get the list of power events and send them
                setContentDispositionHeader(res, 'application/octet-stream', 'powerevents.csv', null, 'powerevents.csv');
                obj.db.getPowerTimeline(node._id, function (err, docs) {
                    var xevents = ['UTC Time, Local Time, State, Previous State'], prevState = 0;
                    for (var i in docs) {
                        if (docs[i].power != prevState) {
                            var timedoc = docs[i].time;
                            if (typeof timedoc == 'string') {
                                timedoc = new Date(timedoc);
                            }
                            prevState = docs[i].power;
                            var localTime = '';
                            if (timeConversionSystem == 1) { // Good way
                                localTime = new Date(timedoc.getTime()).toLocaleString(req.query.l, { timeZone: req.query.tz })
                            } else if (timeConversionSystem == 2) { // Bad way
                                localTime = new Date(timedoc.getTime() + (localTimeOffset * 60000)).toISOString();
                                localTime = localTime.substring(0, localTime.length - 1);
                            }
                            if (docs[i].oldPower != null) {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power + ',' + docs[i].oldPower);
                            } else {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power);
                            }
                        }
                    }
                    res.send(xevents.join('\r\n'));
                });
            }
        });
    }

    if (parent.pluginHandler != null) {
        // Handle a plugin admin request
        obj.handlePluginAdminReq = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.handleAdminReq(req, res, user, obj);
        }

        obj.handlePluginAdminPostReq = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.handleAdminPostReq(req, res, user, obj);
        }

        obj.handlePluginJS = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.refreshJS(req, res);
        }
    }

    // Starts the HTTPS server, this should be called after the user/mesh tables are loaded
    function serverStart() {
        // Start the server, only after users and meshes are loaded from the database.
        if (obj.args.tlsoffload) {
            // Setup the HTTP server without TLS
            obj.expressWs = require('express-ws')(obj.app, null, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        } else {
            // Setup the HTTP server with TLS, use only TLS 1.2 and higher with perfect forward secrecy (PFS).
            //const tlsOptions = { cert: obj.certificates.web.cert, key: obj.certificates.web.key, ca: obj.certificates.web.ca, rejectUnauthorized: true, ciphers: "HIGH:!aNULL:!eNULL:!EXPORT:!RSA:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 }; // This does not work with TLS 1.3
            const tlsOptions = { cert: obj.certificates.web.cert, key: obj.certificates.web.key, ca: obj.certificates.web.ca, rejectUnauthorized: true, ciphers: "HIGH:TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_CCM_SHA256:TLS_CHACHA20_POLY1305_SHA256", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 };
            if (obj.tlsSniCredentials != null) { tlsOptions.SNICallback = TlsSniCallback; } // We have multiple web server certificate used depending on the domain name
            obj.tlsServer = require('https').createServer(tlsOptions, obj.app);
            obj.tlsServer.on('secureConnection', function () { /*console.log('tlsServer secureConnection');*/ });
            obj.tlsServer.on('error', function (err) { console.log('tlsServer error', err); });
            //obj.tlsServer.on('tlsClientError', function (err) { console.log('tlsClientError', err); });
            obj.tlsServer.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
            obj.tlsServer.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
            obj.expressWs = require('express-ws')(obj.app, obj.tlsServer, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        }

        // Start a second agent-only server if needed
        if (obj.args.agentport) {
            var agentPortTls = true;
            if (obj.args.tlsoffload != null) { agentPortTls = false; }
            if (typeof obj.args.agentporttls == 'boolean') { agentPortTls = obj.args.agentporttls; }
            if (obj.certificates.webdefault == null) { agentPortTls = false; }

            if (agentPortTls == false) {
                // Setup the HTTP server without TLS
                obj.expressWsAlt = require('express-ws')(obj.agentapp, null, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
            } else {
                // Setup the agent HTTP server with TLS, use only TLS 1.2 and higher with perfect forward secrecy (PFS).
                // If TLS is used on the agent port, we always use the default TLS certificate.
                const tlsOptions = { cert: obj.certificates.webdefault.cert, key: obj.certificates.webdefault.key, ca: obj.certificates.webdefault.ca, rejectUnauthorized: true, ciphers: "HIGH:TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_CCM_SHA256:TLS_CHACHA20_POLY1305_SHA256", secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1 };
                obj.tlsAltServer = require('https').createServer(tlsOptions, obj.agentapp);
                obj.tlsAltServer.on('secureConnection', function () { /*console.log('tlsAltServer secureConnection');*/ });
                obj.tlsAltServer.on('error', function (err) { console.log('tlsAltServer error', err); });
                //obj.tlsAltServer.on('tlsClientError', function (err) { console.log('tlsClientError', err); });
                obj.tlsAltServer.on('newSession', function (id, data, cb) { if (tlsSessionStoreCount > 1000) { tlsSessionStoreCount = 0; tlsSessionStore = {}; } tlsSessionStore[id.toString('hex')] = data; tlsSessionStoreCount++; cb(); });
                obj.tlsAltServer.on('resumeSession', function (id, cb) { cb(null, tlsSessionStore[id.toString('hex')] || null); });
                obj.expressWsAlt = require('express-ws')(obj.agentapp, obj.tlsAltServer, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
            }
        }

        // Setup middleware
        obj.app.engine('handlebars', obj.exphbs({ defaultLayout: false }));
        obj.app.set('view engine', 'handlebars');
        if (obj.args.trustedproxy) {
            // Reverse proxy should add the "X-Forwarded-*" headers
            try {
                obj.app.set('trust proxy', obj.args.trustedproxy);
            } catch (ex) {
                // If there is an error, try to resolve the string
                if ((obj.args.trustedproxy.length == 1) && (typeof obj.args.trustedproxy[0] == 'string')) {
                    require('dns').lookup(obj.args.trustedproxy[0], function (err, address, family) { if (err == null) { obj.app.set('trust proxy', address); obj.args.trustedproxy = [address]; } });
                }
            }
        } 
        else if (typeof obj.args.tlsoffload == 'object') {
            // Reverse proxy should add the "X-Forwarded-*" headers
            try {
                obj.app.set('trust proxy', obj.args.tlsoffload);
            } catch (ex) {
                // If there is an error, try to resolve the string
                if ((Array.isArray(obj.args.tlsoffload)) && (obj.args.tlsoffload.length == 1) && (typeof obj.args.tlsoffload[0] == 'string')) {
                    require('dns').lookup(obj.args.tlsoffload[0], function (err, address, family) { if (err == null) { obj.app.set('trust proxy', address); obj.args.tlsoffload = [address]; } });
                }
            }
        }
        obj.app.use(obj.bodyParser.urlencoded({ extended: false }));
        var sessionOptions = {
            name: 'xid', // Recommended security practice to not use the default cookie name
            httpOnly: true,
            keys: [obj.args.sessionkey], // If multiple instances of this server are behind a load-balancer, this secret must be the same for all instances
            secure: (obj.args.tlsoffload == null) // Use this cookie only over TLS (Check this: https://expressjs.com/en/guide/behind-proxies.html)
        }
        if (obj.args.sessionsamesite != null) { sessionOptions.sameSite = obj.args.sessionsamesite; } else { sessionOptions.sameSite = ((parent.config.settings.cookieipcheck === false) ? 'none' : 'strict'); }
        if (obj.args.sessiontime != null) { sessionOptions.maxAge = (obj.args.sessiontime * 60 * 1000); }
        obj.app.use(obj.session(sessionOptions));

        // Add HTTP security headers to all responses
        obj.app.use(function (req, res, next) {
            // Check if a session is destroyed
            if (typeof req.session.userid == 'string') {
                if (typeof req.session.x == 'string') {
                    if (obj.destroyedSessions[req.session.userid + '/' + req.session.x] != null) {
                        delete req.session.userid;
                        delete req.session.ip;
                        delete req.session.t;
                        delete req.session.x;
                    }
                } else {
                    // Legacy session without a random, add one.
                    setSessionRandom(req);
                }
            }

            // Remove legacy values from the session to keep the session as small as possible
            delete req.session.domainid;
            delete req.session.u2fchallenge
            delete req.session.nowInMinutes;
            delete req.session.tokenuserid;
            delete req.session.tokenusername;
            delete req.session.tokenpassword;
            delete req.session.tokenemail;
            delete req.session.tokensms;
            delete req.session.tokenpush;
            delete req.session.tusername;
            delete req.session.tpassword;

            // Useful for debugging reverse proxy issues
            parent.debug('httpheaders', req.method, req.url, req.headers);

            // If this request came over HTTP, redirect to HTTPS
            if (req.headers['x-forwarded-proto'] == 'http') {
                var host = req.headers.host;
                if (typeof host == 'string') { host = host.split(':')[0]; }
                if ((host == null) && (obj.certificates != null)) { host = obj.certificates.CommonName; if (obj.certificates.CommonName.indexOf('.') == -1) { host = req.headers.host; } }
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                res.redirect('https://' + host + ':' + httpsPort + req.url);
                return;
            }

            // Perform traffic accounting
            if (req.headers.upgrade == 'websocket') {
                // We don't count traffic on WebSockets since it's counted by the handling modules.
                obj.trafficStats.httpWebSocketCount++;
            } else {
                // Normal HTTP traffic is counted
                obj.trafficStats.httpRequestCount++;
                if (typeof req.socket.xbytesRead != 'number') {
                    req.socket.xbytesRead = 0;
                    req.socket.xbytesWritten = 0;
                    req.socket.on('close', function () {
                        // Perform final accounting
                        obj.trafficStats.httpIn += (this.bytesRead - this.xbytesRead);
                        obj.trafficStats.httpOut += (this.bytesWritten - this.xbytesWritten);
                        this.xbytesRead = this.bytesRead;
                        this.xbytesWritten = this.bytesWritten;
                    });
                } else {
                    // Update counters
                    obj.trafficStats.httpIn += (req.socket.bytesRead - req.socket.xbytesRead);
                    obj.trafficStats.httpOut += (req.socket.bytesWritten - req.socket.xbytesWritten);
                    req.socket.xbytesRead = req.socket.bytesRead;
                    req.socket.xbytesWritten = req.socket.bytesWritten;
                }
            }

            // Set the real IP address of the request
            // If a trusted reverse-proxy is sending us the remote IP address, use it.
            var ipex = '0.0.0.0', xforwardedhost = req.headers.host;
            if (typeof req.connection.remoteAddress == 'string') { ipex = (req.connection.remoteAddress.startsWith('::ffff:')) ? req.connection.remoteAddress.substring(7) : req.connection.remoteAddress; }
            if (
                (obj.args.trustedproxy === true) || (obj.args.tlsoffload === true) ||
                ((typeof obj.args.trustedproxy == 'object') && (isIPMatch(ipex, obj.args.trustedproxy))) ||
                ((typeof obj.args.tlsoffload == 'object') && (isIPMatch(ipex, obj.args.tlsoffload)))
            ) {
                // Get client IP
                if (req.headers['cf-connecting-ip']) { // Use CloudFlare IP address if present
                    req.clientIp = req.headers['cf-connecting-ip'].split(',')[0].trim();
                } else if (req.headers['x-forwarded-for']) {
                    req.clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
                } else if (req.headers['x-real-ip']) {
                    req.clientIp = req.headers['x-real-ip'].split(',')[0].trim();
                } else {
                    req.clientIp = ipex;
                }

                // If there is a port number, remove it. This will only work for IPv4, but nice for people that have a bad reverse proxy config.
                const clientIpSplit = req.clientIp.split(':');
                if (clientIpSplit.length == 2) { req.clientIp = clientIpSplit[0]; }

                // Get server host
                if (req.headers['x-forwarded-host']) { xforwardedhost = req.headers['x-forwarded-host'].split(',')[0]; } // If multiple hosts are specified with a comma, take the first one.
            } else {
                req.clientIp = ipex;
            }

            // Get the domain for this request
            const domain = req.xdomain = getDomain(req);
            parent.debug('webrequest', '(' + req.clientIp + ') ' + req.url);

            // Skip the rest is this is an agent connection
            if ((req.url.indexOf('/meshrelay.ashx/.websocket') >= 0) || (req.url.indexOf('/agent.ashx/.websocket') >= 0) || (req.url.indexOf('/localrelay.ashx/.websocket') >= 0)) { next(); return; }

            // Setup security headers
            const geourl = (domain.geolocation ? ' *.openstreetmap.org' : '');
            var selfurl = ' wss://' + req.headers.host;
            if ((xforwardedhost != null) && (xforwardedhost != req.headers.host)) { selfurl += ' wss://' + xforwardedhost; }
            const extraScriptSrc = (parent.config.settings.extrascriptsrc != null) ? (' ' + parent.config.settings.extrascriptsrc) : '';
            const headers = {
                'Referrer-Policy': 'no-referrer',
                'X-XSS-Protection': '1; mode=block',
                'X-Content-Type-Options': 'nosniff',
                'Permissions-Policy': 'interest-cohort=()', // Remove Google's FLoC Network
                'Content-Security-Policy': "default-src 'none'; font-src 'self'; script-src 'self' 'unsafe-inline'" + extraScriptSrc + "; connect-src 'self'" + geourl + selfurl + "; img-src 'self' blob: data:" + geourl + " data:; style-src 'self' 'unsafe-inline'; frame-src 'self' mcrouter:; media-src 'self'; form-action 'self'"
            };
            if ((parent.config.settings.allowframing !== true) && (typeof parent.config.settings.allowframing !== 'string')) { headers['X-Frame-Options'] = 'sameorigin'; }
            if ((parent.config.settings.stricttransportsecurity === true) || ((parent.config.settings.stricttransportsecurity !== false) && (obj.isTrustedCert(domain)))) { if (typeof parent.config.settings.stricttransportsecurity == 'string') { headers['Strict-Transport-Security'] = parent.config.settings.stricttransportsecurity; } else { headers['Strict-Transport-Security'] = 'max-age=63072000'; } }

            // If this domain has configured headers, add them. If a header is set to null, remove it.
            if ((domain != null) && (domain.httpheaders != null) && (typeof domain.httpheaders == 'object')) {
                for (var i in domain.httpheaders) { if (domain.httpheaders[i] === null) { delete headers[i]; } else { headers[i] = domain.httpheaders[i]; } }
            }
            res.set(headers);

            // Check the session if bound to the external IP address
            if ((parent.config.settings.cookieipcheck !== false) && (req.session.ip != null) && (req.clientIp != null) && (req.session.ip != req.clientIp)) { req.session = {}; }

            // Extend the session time by forcing a change to the session every minute.
            if (req.session.userid != null) { req.session.t = Math.floor(Date.now() / 60e3); } else { delete req.session.t; }

            // Debugging code, this will stop the agent from crashing if two responses are made to the same request.
            const render = res.render;
            const send = res.send;
            res.render = function renderWrapper(...args) {
                Error.captureStackTrace(this);
                return render.apply(this, args);
            };
            res.send = function sendWrapper(...args) {
                try {
                    send.apply(this, args);
                } catch (err) {
                    console.error(`Error in res.send | ${err.code} | ${err.message} | ${res.stack}`);
                    try {
                        var errlogpath = null;
                        if (typeof parent.args.mesherrorlogpath == 'string') { errlogpath = parent.path.join(parent.args.mesherrorlogpath, 'mesherrors.txt'); } else { errlogpath = parent.getConfigFilePath('mesherrors.txt'); }
                        parent.fs.appendFileSync(errlogpath, new Date().toLocaleString() + ': ' + `Error in res.send | ${err.code} | ${err.message} | ${res.stack}` + '\r\n');
                    } catch (ex) { console.log('ERROR: Unable to write to mesherrors.txt.'); }
                }
            };

            // Continue processing the request
            return next();
        });

        if (obj.agentapp) {
            // Add HTTP security headers to all responses
            obj.agentapp.use(function (req, res, next) {
                // Set the real IP address of the request
                // If a trusted reverse-proxy is sending us the remote IP address, use it.
                var ipex = '0.0.0.0';
                if (typeof req.connection.remoteAddress == 'string') { ipex = (req.connection.remoteAddress.startsWith('::ffff:')) ? req.connection.remoteAddress.substring(7) : req.connection.remoteAddress; }
                if (
                    (obj.args.trustedproxy === true) || (obj.args.tlsoffload === true) ||
                    ((typeof obj.args.trustedproxy == 'object') && (isIPMatch(ipex, obj.args.trustedproxy))) ||
                    ((typeof obj.args.tlsoffload == 'object') && (isIPMatch(ipex, obj.args.tlsoffload)))
                ) {
                    if (req.headers['cf-connecting-ip']) { // Use CloudFlare IP address if present
                        req.clientIp = req.headers['cf-connecting-ip'].split(',')[0].trim();
                    } else if (req.headers['x-forwarded-for']) {
                        req.clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
                    } else if (req.headers['x-real-ip']) {
                        req.clientIp = req.headers['x-real-ip'].split(',')[0].trim();
                    } else {
                        req.clientIp = ipex;
                    }
                } else {
                    req.clientIp = ipex;
                }

                // Get the domain for this request
                const domain = req.xdomain = getDomain(req);
                parent.debug('webrequest', '(' + req.clientIp + ') AgentPort: ' + req.url);
                res.removeHeader('X-Powered-By');
                return next();
            });
        }

        // Setup all sharing domains
        for (var i in parent.config.domains) {
            if ((parent.config.domains[i].dns == null) && (parent.config.domains[i].share != null)) { obj.app.use(parent.config.domains[i].url, obj.express.static(parent.config.domains[i].share)); }
        }

        // Setup all HTTP handlers
        if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req, obj.args.tlsoffload == null); }); }
        for (var i in parent.config.domains) {
            if ((parent.config.domains[i].dns != null) || (parent.config.domains[i].share != null)) { continue; } // This is a subdomain with a DNS name, no added HTTP bindings needed.
            var domain = parent.config.domains[i];
            var url = domain.url;
            if (typeof domain.rootredirect == 'string') {
                // Root page redirects the user to a different URL
                obj.app.get(url, handleRootRedirect);
            } else {
                // Present the login page as the root page
                obj.app.get(url, handleRootRequest);
                obj.app.post(url, handleRootPostRequest);
            }
            obj.app.get(url + 'refresh.ashx', function (req, res) { res.sendStatus(200); });
            if ((domain.myserver !== false) && ((domain.myserver == null) || (domain.myserver.backup === true))) { obj.app.get(url + 'backup.zip', handleBackupRequest); }
            if ((domain.myserver !== false) && ((domain.myserver == null) || (domain.myserver.restore === true))) { obj.app.post(url + 'restoreserver.ashx', handleRestoreRequest); }
            obj.app.get(url + 'terms', handleTermsRequest);
            obj.app.get(url + 'xterm', handleXTermRequest);
            obj.app.get(url + 'login', handleRootRequest);
            obj.app.post(url + 'login', handleRootPostRequest);
            obj.app.post(url + 'tokenlogin', handleLoginRequest);
            obj.app.get(url + 'logout', handleLogoutRequest);
            obj.app.get(url + 'MeshServerRootCert.cer', handleRootCertRequest);
            obj.app.post(url + 'changepassword', handlePasswordChangeRequest);
            obj.app.post(url + 'deleteaccount', handleDeleteAccountRequest);
            obj.app.post(url + 'createaccount', handleCreateAccountRequest);
            obj.app.post(url + 'resetpassword', handleResetPasswordRequest);
            obj.app.post(url + 'resetaccount', handleResetAccountRequest);
            obj.app.get(url + 'checkmail', handleCheckMailRequest);
            obj.app.get(url + 'agentinvite', handleAgentInviteRequest);
            obj.app.get(url + 'userimage.ashx', handleUserImageRequest);
            obj.app.post(url + 'amtevents.ashx', obj.handleAmtEventRequest);
            obj.app.get(url + 'meshagents', obj.handleMeshAgentRequest);
            obj.app.get(url + 'messenger', handleMessengerRequest);
            obj.app.get(url + 'messenger.png', handleMessengerImageRequest);
            obj.app.get(url + 'meshosxagent', obj.handleMeshOsxAgentRequest);
            obj.app.get(url + 'meshsettings', obj.handleMeshSettingsRequest);
            obj.app.get(url + 'devicepowerevents.ashx', obj.handleDevicePowerEvents);
            obj.app.get(url + 'downloadfile.ashx', handleDownloadFile);
            obj.app.post(url + 'uploadfile.ashx', handleUploadFile);
            obj.app.post(url + 'uploadfilebatch.ashx', handleUploadFileBatch);
            obj.app.post(url + 'uploadmeshcorefile.ashx', handleUploadMeshCoreFile);
            obj.app.post(url + 'oneclickrecovery.ashx', handleOneClickRecoveryFile);
            obj.app.get(url + 'userfiles/*', handleDownloadUserFiles);
            obj.app.ws(url + 'echo.ashx', handleEchoWebSocket);
            obj.app.ws(url + '2fahold.ashx', handle2faHoldWebSocket);
            obj.app.ws(url + 'apf.ashx', function (ws, req) { obj.parent.mpsserver.onWebSocketConnection(ws, req); })
            obj.app.get(url + 'webrelay.ashx', function (req, res) { res.send('Websocket connection expected'); });
            obj.app.get(url + 'health.ashx', function (req, res) { res.send('ok'); }); // TODO: Perform more server checking.
            obj.app.ws(url + 'webrelay.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, handleRelayWebSocket); });
            obj.app.ws(url + 'webider.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, function (ws1, req1, domain, user, cookie, authData) { obj.meshIderHandler.CreateAmtIderSession(obj, obj.db, ws1, req1, obj.args, domain, user); }); });
            obj.app.ws(url + 'control.ashx', function (ws, req) {
                getWebsocketArgs(ws, req, function (ws, req) {
                    const domain = getDomain(req);
                    if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { ws.close(); return; } // Check 3FA URL key
                    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                        if (user == null) { // User is not authenticated, perform inner server authentication
                            if (req.headers['x-meshauth'] === '*') {
                                PerformWSSessionInnerAuth(ws, req, domain, function (ws1, req1, domain, user) { obj.meshUserHandler.CreateMeshUser(obj, obj.db, ws1, req1, obj.args, domain, user, authData); }); // User is authenticated
                            } else {
                                try { ws.close(); } catch (ex) { } // user is not authenticated and inner authentication was not requested, disconnect now.
                            }
                        } else {
                            obj.meshUserHandler.CreateMeshUser(obj, obj.db, ws1, req1, obj.args, domain, user, authData); // User is authenticated
                        }
                    });
                });
            });
            obj.app.ws(url + 'devicefile.ashx', function (ws, req) { obj.meshDeviceFileHandler.CreateMeshDeviceFile(obj, ws, null, req, domain); });
            obj.app.get(url + 'devicefile.ashx', handleDeviceFile);
            obj.app.get(url + 'agentdownload.ashx', handleAgentDownloadFile);
            obj.app.get(url + 'logo.png', handleLogoRequest);
            obj.app.get(url + 'loginlogo.png', handleLoginLogoRequest);
            obj.app.post(url + 'translations', handleTranslationsRequest);
            obj.app.get(url + 'welcome.jpg', handleWelcomeImageRequest);
            obj.app.get(url + 'welcome.png', handleWelcomeImageRequest);
            obj.app.get(url + 'recordings.ashx', handleGetRecordings);
            obj.app.ws(url + 'recordings.ashx', handleGetRecordingsWebSocket);
            obj.app.get(url + 'player.htm', handlePlayerRequest);
            obj.app.get(url + 'player', handlePlayerRequest);
            obj.app.get(url + 'sharing', handleSharingRequest);
            obj.app.ws(url + 'agenttransfer.ashx', handleAgentFileTransfer); // Setup agent to/from server file transfer handler
            obj.app.ws(url + 'meshrelay.ashx', function (ws, req) {
                PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                    if (((parent.config.settings.desktopmultiplex === true) || (domain.desktopmultiplex === true)) && (req.query.p == 2)) {
                        obj.meshDesktopMultiplexHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // Desktop multiplexor 1-to-n
                    } else {
                        obj.meshRelayHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // Normal relay 1-to-1
                    }
                });
            });
            if (obj.args.wanonly != true) { // If the server is not in WAN mode, allow server relayed connections.
                obj.app.ws(url + 'localrelay.ashx', function (ws, req) {
                    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                        if ((user == null) || (cookie == null)) {
                            try { ws1.close(); } catch (ex) { } 
                        } else {
                            obj.meshRelayHandler.CreateLocalRelay(obj, ws1, req1, domain, user, cookie); // Local relay
                        }
                    });
                });
            }
            if (domain.agentinvitecodes == true) {
                obj.app.get(url + 'invite', handleInviteRequest);
                obj.app.post(url + 'invite', handleInviteRequest);
            }
            if (parent.pluginHandler != null) {
                obj.app.get(url + 'pluginadmin.ashx', obj.handlePluginAdminReq);
                obj.app.post(url + 'pluginadmin.ashx', obj.handlePluginAdminPostReq);
                obj.app.get(url + 'pluginHandler.js', obj.handlePluginJS);
            }

            // Setup IP-KVM relay if supported
            if (domain.ipkvm) {
                obj.app.ws(url + 'ipkvm.ashx/*', function (ws, req) {
                    const domain = getDomain(req);
                    if (domain == null) { parent.debug('web', 'ipkvm: failed domain checks.'); try { ws.close(); } catch (ex) { } return; }
                    parent.ipKvmManager.handleIpKvmWebSocket(domain, ws, req);
                });
                obj.app.get(url + 'ipkvm.ashx/*', function (req, res, next) {
                    const domain = getDomain(req);
                    if (domain == null) return;
                    parent.ipKvmManager.handleIpKvmGet(domain, req, res, next);
                });
            }

            // Setup MSTSC.js if needed
            if (domain.mstsc === true) {
                obj.app.get(url + 'mstsc.html', function (req, res) { handleMSTSCRequest(req, res, 'mstsc'); });
                obj.app.ws(url + 'mstscrelay.ashx', function (ws, req) {
                    const domain = getDomain(req);
                    if (domain == null) { parent.debug('web', 'mstsc: failed checks.'); try { ws.close(); } catch (e) { } return; }
                    require('./apprelays.js').CreateMstscRelay(obj, obj.db, ws, req, obj.args, domain);
                });
            }

            // Setup SSH if needed
            if (domain.ssh === true) {
                obj.app.get(url + 'ssh.html', function (req, res) { handleMSTSCRequest(req, res, 'ssh'); });
                obj.app.ws(url + 'sshrelay.ashx', function (ws, req) {
                    const domain = getDomain(req);
                    if (domain == null) { parent.debug('web', 'ssh: failed checks.'); try { ws.close(); } catch (e) { } return; }
                    try {
                        require('./apprelays.js').CreateSshRelay(obj, obj.db, ws, req, obj.args, domain);
                    } catch (ex) { console.log(ex); }
                });
                obj.app.ws(url + 'sshterminalrelay.ashx', function (ws, req) {
                    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                        require('./apprelays.js').CreateSshTerminalRelay(obj, obj.db, ws1, req1, domain, user, cookie, obj.args);
                    });
                });
                obj.app.ws(url + 'sshfilesrelay.ashx', function (ws, req) {
                    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                        require('./apprelays.js').CreateSshFilesRelay(obj, obj.db, ws1, req1, domain, user, cookie, obj.args);
                    });
                });
            }

            // Setup firebase push only server
            if ((obj.parent.firebase != null) && (obj.parent.config.firebase)) {
                if (obj.parent.config.firebase.pushrelayserver) { parent.debug('email', 'Firebase-pushrelay-handler'); obj.app.post(url + 'firebaserelay.aspx', handleFirebasePushOnlyRelayRequest); }
                if (obj.parent.config.firebase.relayserver) { parent.debug('email', 'Firebase-relay-handler'); obj.app.ws(url + 'firebaserelay.aspx', handleFirebaseRelayRequest); }
            }

            // Setup auth strategies using passport if needed
            if (typeof domain.authstrategies == 'object') {
                const passport = domain.passport = require('passport');
                passport.serializeUser(function (user, done) { done(null, user.sid); });
                passport.deserializeUser(function (sid, done) { done(null, { sid: sid }); });
                obj.app.use(passport.initialize());
                //obj.app.use(passport.session());

                // Twitter
                if ((typeof domain.authstrategies.twitter == 'object') && (typeof domain.authstrategies.twitter.clientid == 'string') && (typeof domain.authstrategies.twitter.clientsecret == 'string')) {
                    const TwitterStrategy = require('passport-twitter');
                    var options = { consumerKey: domain.authstrategies.twitter.clientid, consumerSecret: domain.authstrategies.twitter.clientsecret };
                    if (typeof domain.authstrategies.twitter.callbackurl == 'string') { options.callbackURL = domain.authstrategies.twitter.callbackurl; } else { options.callbackURL = url + 'auth-twitter-callback'; }
                    parent.debug('web', 'Adding Twitter SSO with options: ' + JSON.stringify(options));
                    passport.use('twitter-' + domain.id, new TwitterStrategy(options,
                        function (token, tokenSecret, profile, cb) {
                            parent.debug('web', 'Twitter profile: ' + JSON.stringify(profile));
                            var user = { sid: '~twitter:' + profile.id, name: profile.displayName, strategy: 'twitter' };
                            if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string')) { user.email = profile.emails[0].value; }
                            return cb(null, user);
                        }
                    ));
                    obj.app.get(url + 'auth-twitter', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('twitter-' + domain.id)(req, res, function (err) { console.log('c1', err, req.session); next(); });
                    });
                    obj.app.get(url + 'auth-twitter-callback', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        if ((Object.keys(req.session).length == 0) && (req.query.nmr == null)) {
                            // This is an empty session likely due to the 302 redirection, redirect again (this is a bit of a hack).
                            var url = req.url;
                            if (url.indexOf('?') >= 0) { url += '&nmr=1'; } else { url += '?nmr=1'; } // Add this to the URL to prevent redirect loop.
                            res.set('Content-Type', 'text/html');
                            res.end('<html><head><meta http-equiv="refresh" content=0;url="' + url + '"></head><body></body></html>');
                        } else {
                            domain.passport.authenticate('twitter-' + domain.id, { failureRedirect: '/' })(req, res, function (err) { if (err != null) { console.log(err); } next(); });
                        }
                    }, handleStrategyLogin);
                }

                // Google
                if ((typeof domain.authstrategies.google == 'object') && (typeof domain.authstrategies.google.clientid == 'string') && (typeof domain.authstrategies.google.clientsecret == 'string')) {
                    const GoogleStrategy = require('passport-google-oauth20');
                    var options = { clientID: domain.authstrategies.google.clientid, clientSecret: domain.authstrategies.google.clientsecret };
                    if (typeof domain.authstrategies.google.callbackurl == 'string') { options.callbackURL = domain.authstrategies.google.callbackurl; } else { options.callbackURL = url + 'auth-google-callback'; }
                    parent.debug('web', 'Adding Google SSO with options: ' + JSON.stringify(options));
                    passport.use('google-' + domain.id, new GoogleStrategy(options,
                        function (token, tokenSecret, profile, cb) {
                            parent.debug('web', 'Google profile: ' + JSON.stringify(profile));
                            var user = { sid: '~google:' + profile.id, name: profile.displayName, strategy: 'google' };
                            if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string') && (profile.emails[0].verified == true)) { user.email = profile.emails[0].value; }
                            return cb(null, user);
                        }
                    ));
                    obj.app.get(url + 'auth-google', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('google-' + domain.id, { scope: ['profile', 'email'] })(req, res, next);
                    });
                    obj.app.get(url + 'auth-google-callback', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('google-' + domain.id, { failureRedirect: '/' })(req, res, function (err) { if (err != null) { console.log(err); } next(); });
                    }, handleStrategyLogin);
                }

                // Github
                if ((typeof domain.authstrategies.github == 'object') && (typeof domain.authstrategies.github.clientid == 'string') && (typeof domain.authstrategies.github.clientsecret == 'string')) {
                    const GitHubStrategy = require('passport-github2');
                    var options = { clientID: domain.authstrategies.github.clientid, clientSecret: domain.authstrategies.github.clientsecret };
                    if (typeof domain.authstrategies.github.callbackurl == 'string') { options.callbackURL = domain.authstrategies.github.callbackurl; } else { options.callbackURL = url + 'auth-github-callback'; }
                    parent.debug('web', 'Adding Github SSO with options: ' + JSON.stringify(options));
                    passport.use('github-' + domain.id, new GitHubStrategy(options,
                        function (token, tokenSecret, profile, cb) {
                            parent.debug('web', 'Github profile: ' + JSON.stringify(profile));
                            var user = { sid: '~github:' + profile.id, name: profile.displayName, strategy: 'github' };
                            if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string')) { user.email = profile.emails[0].value; }
                            return cb(null, user);
                        }
                    ));
                    obj.app.get(url + 'auth-github', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('github-' + domain.id, { scope: ['user:email'] })(req, res, next);
                    });
                    obj.app.get(url + 'auth-github-callback', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('github-' + domain.id, { failureRedirect: '/' })(req, res, next);
                    }, handleStrategyLogin);
                }

                // Reddit
                if ((typeof domain.authstrategies.reddit == 'object') && (typeof domain.authstrategies.reddit.clientid == 'string') && (typeof domain.authstrategies.reddit.clientsecret == 'string')) {
                    const RedditStrategy = require('passport-reddit');
                    var options = { clientID: domain.authstrategies.reddit.clientid, clientSecret: domain.authstrategies.reddit.clientsecret };
                    if (typeof domain.authstrategies.reddit.callbackurl == 'string') { options.callbackURL = domain.authstrategies.reddit.callbackurl; } else { options.callbackURL = url + 'auth-reddit-callback'; }
                    parent.debug('web', 'Adding Reddit SSO with options: ' + JSON.stringify(options));
                    passport.use('reddit-' + domain.id, new RedditStrategy.Strategy(options,
                        function (token, tokenSecret, profile, cb) {
                            parent.debug('web', 'Reddit profile: ' + JSON.stringify(profile));
                            var user = { sid: '~reddit:' + profile.id, name: profile.name, strategy: 'reddit' };
                            if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string')) { user.email = profile.emails[0].value; }
                            return cb(null, user);
                        }
                    ));
                    obj.app.get(url + 'auth-reddit', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('reddit-' + domain.id, { state: obj.parent.encodeCookie({ 'p': 'reddit' }, obj.parent.loginCookieEncryptionKey), duration: 'permanent' })(req, res, next);
                    });
                    obj.app.get(url + 'auth-reddit-callback', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        if ((Object.keys(req.session).length == 0) && (req.query.nmr == null)) {
                            // This is an empty session likely due to the 302 redirection, redirect again (this is a bit of a hack).
                            var url = req.url;
                            if (url.indexOf('?') >= 0) { url += '&nmr=1'; } else { url += '?nmr=1'; } // Add this to the URL to prevent redirect loop.
                            res.set('Content-Type', 'text/html');
                            res.end('<html><head><meta http-equiv="refresh" content=0;url="' + url + '"></head><body></body></html>');
                        } else {
                            if (req.query.state != null) {
                                var c = obj.parent.decodeCookie(req.query.state, obj.parent.loginCookieEncryptionKey, 10); // 10 minute timeout
                                if ((c != null) && (c.p == 'reddit')) { domain.passport.authenticate('reddit-' + domain.id, { failureRedirect: '/' })(req, res, next); return; }
                            }
                            next();
                        }
                    }, handleStrategyLogin);
                }

                // Azure
                if ((typeof domain.authstrategies.azure == 'object') && (typeof domain.authstrategies.azure.clientid == 'string') && (typeof domain.authstrategies.azure.clientsecret == 'string')) {
                    const AzureOAuth2Strategy = require('passport-azure-oauth2');
                    var options = { clientID: domain.authstrategies.azure.clientid, clientSecret: domain.authstrategies.azure.clientsecret, tenant: domain.authstrategies.azure.tenantid };
                    if (typeof domain.authstrategies.azure.callbackurl == 'string') { options.callbackURL = domain.authstrategies.azure.callbackurl; } else { options.callbackURL = url + 'auth-azure-callback'; }
                    parent.debug('web', 'Adding Azure SSO with options: ' + JSON.stringify(options));
                    passport.use('azure-' + domain.id, new AzureOAuth2Strategy(options,
                        function (accessToken, refreshtoken, params, profile, done) {
                            var userex = null;
                            try { userex = require('jwt-simple').decode(params.id_token, "", true); } catch (ex) { }
                            parent.debug('web', 'Azure profile: ' + JSON.stringify(userex));
                            var user = null;
                            if (userex != null) {
                                var user = { sid: '~azure:' + userex.unique_name, name: userex.name, strategy: 'azure' };
                                if (typeof userex.email == 'string') { user.email = userex.email; }
                            }
                            return done(null, user);
                        }
                    ));
                    obj.app.get(url + 'auth-azure', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        domain.passport.authenticate('azure-' + domain.id, { state: obj.parent.encodeCookie({ 'p': 'azure' }, obj.parent.loginCookieEncryptionKey) })(req, res, next);
                    });
                    obj.app.get(url + 'auth-azure-callback', function (req, res, next) {
                        var domain = getDomain(req);
                        if (domain.passport == null) { next(); return; }
                        if ((Object.keys(req.session).length == 0) && (req.query.nmr == null)) {
                            // This is an empty session likely due to the 302 redirection, redirect again (this is a bit of a hack).
                            var url = req.url;
                            if (url.indexOf('?') >= 0) { url += '&nmr=1'; } else { url += '?nmr=1'; } // Add this to the URL to prevent redirect loop.
                            res.set('Content-Type', 'text/html');
                            res.end('<html><head><meta http-equiv="refresh" content=0;url="' + url + '"></head><body></body></html>');
                        } else {
                            if (req.query.state != null) {
                                var c = obj.parent.decodeCookie(req.query.state, obj.parent.loginCookieEncryptionKey, 10); // 10 minute timeout
                                if ((c != null) && (c.p == 'azure')) { domain.passport.authenticate('azure-' + domain.id, { failureRedirect: '/' })(req, res, next); return; }
                            }
                            next();
                        }
                    }, handleStrategyLogin);
                }

                // Generic SAML
                if (typeof domain.authstrategies.saml == 'object') {
                    if ((typeof domain.authstrategies.saml.cert != 'string') || (typeof domain.authstrategies.saml.idpurl != 'string')) {
                        console.log('ERROR: Missing SAML configuration.');
                    } else {
                        const certPath = obj.common.joinPath(obj.parent.datapath, domain.authstrategies.saml.cert);
                        var cert = obj.fs.readFileSync(certPath);
                        if (cert == null) {
                            console.log('ERROR: Unable to read SAML IdP certificate: ' + domain.authstrategies.saml.cert);
                        } else {
                            var options = { entryPoint: domain.authstrategies.saml.idpurl, issuer: 'meshcentral' };
                            if (typeof domain.authstrategies.saml.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.saml.callbackurl; } else { options.callbackUrl = url + 'auth-saml-callback'; }
                            if (domain.authstrategies.saml.disablerequestedauthncontext != null) { options.disableRequestedAuthnContext = domain.authstrategies.saml.disablerequestedauthncontext; }
                            if (typeof domain.authstrategies.saml.entityid == 'string') { options.issuer = domain.authstrategies.saml.entityid; }
                            parent.debug('web', 'Adding SAML SSO with options: ' + JSON.stringify(options));
                            options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                            const SamlStrategy = require('passport-saml').Strategy;
                            passport.use('saml-' + domain.id, new SamlStrategy(options,
                                function (profile, done) {
                                    parent.debug('web', 'SAML profile: ' + JSON.stringify(profile));
                                    if (typeof profile.nameID != 'string') { return done(); }
                                    var user = { sid: '~saml:' + profile.nameID, name: profile.nameID, strategy: 'saml' };
                                    if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) { user.name = profile.firstname + ' ' + profile.lastname; }
                                    if (typeof profile.email == 'string') { user.email = profile.email; }
                                    return done(null, user);
                                }
                            ));
                            obj.app.get(url + 'auth-saml', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('saml-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            });
                            obj.app.post(url + 'auth-saml-callback', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('saml-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            }, handleStrategyLogin);
                        }
                    }
                }

                // Intel SAML
                if (typeof domain.authstrategies.intel == 'object') {
                    if ((typeof domain.authstrategies.intel.cert != 'string') || (typeof domain.authstrategies.intel.idpurl != 'string')) {
                        console.log('ERROR: Missing Intel SAML configuration.');
                    } else {
                        var cert = obj.fs.readFileSync(obj.common.joinPath(obj.parent.datapath, domain.authstrategies.intel.cert));
                        if (cert == null) {
                            console.log('ERROR: Unable to read Intel SAML IdP certificate: ' + domain.authstrategies.intel.cert);
                        } else {
                            var options = { entryPoint: domain.authstrategies.intel.idpurl, issuer: 'meshcentral' };
                            if (typeof domain.authstrategies.intel.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.intel.callbackurl; } else { options.callbackUrl = url + 'auth-intel-callback'; }
                            if (domain.authstrategies.intel.disablerequestedauthncontext != null) { options.disableRequestedAuthnContext = domain.authstrategies.intel.disablerequestedauthncontext; }
                            if (typeof domain.authstrategies.intel.entityid == 'string') { options.issuer = domain.authstrategies.intel.entityid; }
                            parent.debug('web', 'Adding Intel SSO with options: ' + JSON.stringify(options));
                            options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                            const SamlStrategy = require('passport-saml').Strategy;
                            passport.use('isaml-' + domain.id, new SamlStrategy(options,
                                function (profile, done) {
                                    parent.debug('web', 'Intel profile: ' + JSON.stringify(profile));
                                    if (typeof profile.nameID != 'string') { return done(); }
                                    var user = { sid: '~intel:' + profile.nameID, name: profile.nameID, strategy: 'intel' };
                                    if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) { user.name = profile.firstname + ' ' + profile.lastname; }
                                    else if ((typeof profile.FirstName == 'string') && (typeof profile.LastName == 'string')) { user.name = profile.FirstName + ' ' + profile.LastName; }
                                    if (typeof profile.email == 'string') { user.email = profile.email; }
                                    else if (typeof profile.EmailAddress == 'string') { user.email = profile.EmailAddress; }
                                    return done(null, user);
                                }
                            ));
                            obj.app.get(url + 'auth-intel', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('isaml-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            });
                            obj.app.post(url + 'auth-intel-callback', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('isaml-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            }, handleStrategyLogin);
                        }
                    }
                }

                // JumpCloud SAML
                if (typeof domain.authstrategies.jumpcloud == 'object') {
                    if ((typeof domain.authstrategies.jumpcloud.cert != 'string') || (typeof domain.authstrategies.jumpcloud.idpurl != 'string')) {
                        console.log('ERROR: Missing JumpCloud SAML configuration.');
                    } else {
                        var cert = obj.fs.readFileSync(obj.common.joinPath(obj.parent.datapath, domain.authstrategies.jumpcloud.cert));
                        if (cert == null) {
                            console.log('ERROR: Unable to read JumpCloud IdP certificate: ' + domain.authstrategies.jumpcloud.cert);
                        } else {
                            var options = { entryPoint: domain.authstrategies.jumpcloud.idpurl, issuer: 'meshcentral' };
                            if (typeof domain.authstrategies.jumpcloud.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.jumpcloud.callbackurl; } else { options.callbackUrl = url + 'auth-jumpcloud-callback'; }
                            if (typeof domain.authstrategies.jumpcloud.entityid == 'string') { options.issuer = domain.authstrategies.jumpcloud.entityid; }
                            parent.debug('web', 'Adding JumpCloud SSO with options: ' + JSON.stringify(options));
                            options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                            const SamlStrategy = require('passport-saml').Strategy;
                            passport.use('jumpcloud-' + domain.id, new SamlStrategy(options,
                                function (profile, done) {
                                    parent.debug('web', 'JumpCloud profile: ' + JSON.stringify(profile));
                                    if (typeof profile.nameID != 'string') { return done(); }
                                    var user = { sid: '~jumpcloud:' + profile.nameID, name: profile.nameID, strategy: 'jumpcloud' };
                                    if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) { user.name = profile.firstname + ' ' + profile.lastname; }
                                    if (typeof profile.email == 'string') { user.email = profile.email; }
                                    return done(null, user);
                                }
                            ));
                            obj.app.get(url + 'auth-jumpcloud', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('jumpcloud-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            });
                            obj.app.post(url + 'auth-jumpcloud-callback', function (req, res, next) {
                                var domain = getDomain(req);
                                if (domain.passport == null) { next(); return; }
                                domain.passport.authenticate('jumpcloud-' + domain.id, { failureRedirect: '/', failureFlash: true })(req, res, next);
                            }, handleStrategyLogin);
                        }
                    }
                }

            }

            // Server redirects
            if (parent.config.domains[i].redirects) { for (var j in parent.config.domains[i].redirects) { if (j[0] != '_') { obj.app.get(url + j, obj.handleDomainRedirect); } } }

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
                        try { res.sendFile(p); } catch (ex) { res.sendStatus(404); }
                    } else {
                        var domain = getDomain(req);
                        if ((domain != null) && (domain.webpublicpath != null) && (obj.fs.existsSync(obj.path.join(domain.webpublicpath, 'images/server-256.png')))) {
                            // Use the domain server picture
                            try { res.sendFile(obj.path.join(domain.webpublicpath, 'images/server-256.png')); } catch (ex) { res.sendStatus(404); }
                        } else if (parent.webPublicOverridePath && obj.fs.existsSync(obj.path.join(obj.parent.webPublicOverridePath, 'images/server-256.png'))) {
                            // Use the override server picture
                            try { res.sendFile(obj.path.join(obj.parent.webPublicOverridePath, 'images/server-256.png')); } catch (ex) { res.sendStatus(404); }
                        } else {
                            // Use the default server picture
                            try { res.sendFile(obj.path.join(obj.parent.webPublicPath, 'images/server-256.png')); } catch (ex) { res.sendStatus(404); }
                        }
                    }
                }
            });

            // Receive mesh agent connections
            obj.app.ws(url + 'agent.ashx', function (ws, req) {
                var domain = checkAgentIpAddress(ws, req);
                if (domain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
                if (domain.agentkey && ((req.query.key == null) || (domain.agentkey.indexOf(req.query.key) == -1))) { return; } // If agent key is required and not provided or not valid, just hold the websocket and do nothing.
                //console.log('Agent connect: ' + req.clientIp);
                try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (e) { console.log(e); }
            });

            // Setup MQTT broker over websocket
            if (obj.parent.mqttbroker != null) {
                obj.app.ws(url + 'mqtt.ashx', function (ws, req) {
                    var domain = checkAgentIpAddress(ws, req);
                    if (domain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
                    var serialtunnel = SerialTunnel();
                    serialtunnel.xtransport = 'ws';
                    serialtunnel.xdomain = domain;
                    serialtunnel.xip = req.clientIp;
                    ws.on('message', function (b) { serialtunnel.updateBuffer(Buffer.from(b, 'binary')) });
                    serialtunnel.forwardwrite = function (b) { ws.send(b, 'binary') }
                    ws.on('close', function () { serialtunnel.emit('end'); });
                    obj.parent.mqttbroker.handle(serialtunnel); // Pass socket wrapper to MQTT broker
                });
            }

            // Setup any .well-known folders
            var p = obj.parent.path.join(obj.parent.datapath, '.well-known' + ((parent.config.domains[i].id == '') ? '' : ('-' + parent.config.domains[i].id)));
            if (obj.parent.fs.existsSync(p)) { obj.app.use(url + '.well-known', obj.express.static(p)); }

            // Setup the alternative agent-only port
            if (obj.agentapp) {
                // Receive mesh agent connections on alternate port
                obj.agentapp.ws(url + 'agent.ashx', function (ws, req) {
                    var domain = checkAgentIpAddress(ws, req);
                    if (domain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
                    if (domain.agentkey && ((req.query.key == null) || (domain.agentkey.indexOf(req.query.key) == -1))) { return; } // If agent key is required and not provided or not valid, just hold the websocket and do nothing.
                    try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (e) { console.log(e); }
                });

                // Setup mesh relay on alternative agent-only port
                obj.agentapp.ws(url + 'meshrelay.ashx', function (ws, req) {
                    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
                        if (((parent.config.settings.desktopmultiplex === true) || (domain.desktopmultiplex === true)) && (req.query.p == 2)) {
                            obj.meshDesktopMultiplexHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // Desktop multiplexor 1-to-n
                        } else {
                            obj.meshRelayHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // Normal relay 1-to-1
                        }
                    });
                });

                // Allows agents to transfer files
                obj.agentapp.ws(url + 'devicefile.ashx', function (ws, req) { obj.meshDeviceFileHandler.CreateMeshDeviceFile(obj, ws, null, req, domain); });

                // Setup agent to/from server file transfer handler
                obj.agentapp.ws(url + 'agenttransfer.ashx', handleAgentFileTransfer); // Setup agent to/from server file transfer handler

                // Setup agent downloads for meshcore updates
                obj.agentapp.get(url + 'meshagents', obj.handleMeshAgentRequest);
            }

            // Indicates to ExpressJS that the override public folder should be used to serve static files.
            if (parent.config.domains[i].webpublicpath != null) {
                // Use domain public path
                obj.app.use(url, obj.express.static(parent.config.domains[i].webpublicpath));
            } else if (obj.parent.webPublicOverridePath != null) {
                // Use override path
                obj.app.use(url, obj.express.static(obj.parent.webPublicOverridePath));
            }

            // Indicates to ExpressJS that the default public folder should be used to serve static files.
            obj.app.use(url, obj.express.static(obj.parent.webPublicPath));

            // Start regular disconnection list flush every 2 minutes.
            obj.wsagentsDisconnectionsTimer = setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000);
        }

        // Handle 404 error
        if (obj.args.nice404 !== false) {
            obj.app.use(function (req, res, next) {
                parent.debug('web', '404 Error ' + req.url);
                var domain = getDomain(req);
                if ((domain == null) || (domain.auth == 'sspi')) { res.sendStatus(404); return; }
                if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL 
                const cspNonce = obj.crypto.randomBytes(15).toString('base64');
                res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'nonce-" + cspNonce + "'; img-src 'self'; style-src 'self' 'nonce-" + cspNonce + "';" }); // This page supports very tight CSP policy
                res.status(404).render(getRenderPage((domain.sitestyle == 2) ? 'error4042' : 'error404', req, domain), getRenderArgs({ cspNonce: cspNonce }, req, domain));
            });
        }

        // Start server on a free port.
        CheckListenPort(obj.args.port, obj.args.portbind, StartWebServer);

        // Start on a second agent-only alternative port if needed.
        if (obj.args.agentport) { CheckListenPort(obj.args.agentport, obj.args.agentportbind, StartAltWebServer); }

        // We are done starting the web server.
        if (doneFunc) doneFunc();
    }

    // Perform server inner authentication
    // This is a type of server authentication where the client will open the socket regardless of the TLS certificate and request that the server
    // sign a client nonce with the server agent cert and return the response. Only after that will the client send the client authentication username
    // and password or authentication cookie.
    function PerformWSSessionInnerAuth(ws, req, domain, func) {
        // When data is received from the web socket
        ws.on('message', function (data) {
            var command;
            try { command = JSON.parse(data.toString('utf8')); } catch (e) { return; }
            if (obj.common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

            switch (command.action) {
                case 'serverAuth': { // This command is used to perform server "inner" authentication.
                    // Check the client nonce and TLS hash
                    if ((obj.common.validateString(command.cnonce, 1, 256) == false) || (obj.common.validateString(command.tlshash, 1, 512) == false)) {
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'badargs' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                        break; 
                    }

                    // Check that the TLS hash is an acceptable one.
                    var h = Buffer.from(command.tlshash, 'hex').toString('binary');
                    if ((obj.webCertificateHashs[domain.id] != h) && (obj.webCertificateFullHashs[domain.id] != h) && (obj.defaultWebCertificateHash != h) && (obj.defaultWebCertificateFullHash != h)) {
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'badtlscert' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                        return;
                    }

                    // TLS hash check is a success, sign the request.
                    // Perform the hash signature using the server agent certificate
                    var nonce = obj.crypto.randomBytes(48);
                    var signData = Buffer.from(command.cnonce, 'base64').toString('binary') + h + nonce.toString('binary'); // Client Nonce + TLS Hash + Server Nonce
                    parent.certificateOperations.acceleratorPerformSignature(0, signData, null, function (tag, signature) {
                        // Send back our certificate + nonce + signature
                        ws.send(JSON.stringify({ 'action': 'serverAuth', 'cert': Buffer.from(obj.agentCertificateAsn1, 'binary').toString('base64'), 'nonce': nonce.toString('base64'), 'signature': Buffer.from(signature, 'binary').toString('base64') }));
                    });
                    break;
                }
                case 'userAuth': { // This command is used to perform user authentication.
                    // Check username and password authentication
                    if ((typeof command.username == 'string') && (typeof command.password == 'string')) {
                        obj.authenticate(Buffer.from(command.username, 'base64').toString(), Buffer.from(command.password, 'base64').toString(), domain, function (err, userid, passhint, loginOptions) {
                            if ((err != null) || (userid == null)) {
                                // Invalid authentication
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); } catch (ex) { }
                                try { ws.close(); } catch (ex) { }
                            } else {
                                var user = obj.users[userid];
                                if ((err == null) && (user)) {
                                    // Check if a 2nd factor is needed
                                    const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

                                    // See if we support two-factor trusted cookies
                                    var twoFactorCookieDays = 30;
                                    if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                                    // Check if two factor can be skipped
                                    const twoFactorSkip = checkUserOneTimePasswordSkip(domain, user, req, loginOptions);

                                    if ((twoFactorSkip == null) && (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true)) {
                                        // Figure out if email 2FA is allowed
                                        var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                        var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                        //var push2fa = ((parent.firebase != null) && (user.otpdev != null));
                                        if ((typeof command.token != 'string') || (command.token == '**email**') || (command.token == '**sms**')/* || (command.token == '**push**')*/) {
                                            if ((command.token == '**email**') && (email2fa == true)) {
                                                // Cause a token to be sent to the user's registered email
                                                user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                                domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                                // Ask for a login token & confirm email was sent
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                            } else if ((command.token == '**sms**') && (sms2fa == true)) {
                                                // Cause a token to be sent to the user's phone number
                                                user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                                parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                                // Ask for a login token & confirm sms was sent
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                                /*
                                            } else if ((command.token == '**push**') && (push2fa == true)) {
                                                // Cause push notification to device
                                                const code = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                                                const authCookie = parent.encodeCookie({ a: 'checkAuth', c: code, u: user._id, n: user.otpdev });
                                                var payload = { notification: { title: "MeshCentral", body: user.name + " authentication" }, data: { url: '2fa://auth?code=' + code + '&c=' + authCookie } };
                                                var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
                                                parent.firebase.sendToDevice(user.otpdev, payload, options, function (id, err, errdesc) {
                                                    if (err == null) { parent.debug('email', 'Successfully auth check send push message to device'); } else { parent.debug('email', 'Failed auth check push message to device, error: ' + errdesc); }
                                                });
                                                */
                                            } else {
                                                // Ask for a login token
                                                parent.debug('web', 'Asking for login token');
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (ex) { console.log(ex); }
                                            }
                                        } else {
                                            checkUserOneTimePassword(req, domain, user, command.token, null, function (result, authData) {
                                                if (result == false) {
                                                    // Failed, ask for a login token again
                                                    parent.debug('web', 'Invalid login token, asking again');
                                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                                } else {
                                                    // We are authenticated with 2nd factor.
                                                    // Check email verification
                                                    if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                                        parent.debug('web', 'Invalid login, asking for email validation');
                                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                                    } else {
                                                        // We are authenticated
                                                        ws._socket.pause();
                                                        ws.removeAllListeners(['message', 'close', 'error']);
                                                        func(ws, req, domain, user, authData);
                                                    }
                                                }
                                            });
                                        }
                                    } else {
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                        } else {
                                            // We are authenticated
                                            ws._socket.pause();
                                            ws.removeAllListeners(['message', 'close', 'error']);
                                            func(ws, req, domain, user, twoFactorSkip);
                                        }
                                    }
                                }
                            }
                        });
                    } else {
                        // Invalid authentication
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                    }
                    break;
                }
            }

        });

        // If error, do nothing
        ws.on('error', function (err) { try { ws.close(); } catch (e) { console.log(e); } });

        // If the web socket is closed
        ws.on('close', function (req) { try { ws.close(); } catch (e) { console.log(e); } });

        // Resume the socket to perform inner authentication
        try { ws._socket.resume(); } catch (ex) { }
    }

    // Authenticates a session and forwards
    function PerformWSSessionAuth(ws, req, noAuthOk, func) {
        // Check if the session expired
        if ((req.session != null) && (typeof req.session.expire == 'number') && (req.session.expire <= Date.now())) {
            parent.debug('web', 'WSERROR: Session expired.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'expired', msg: 'expired-1' })); ws.close(); } catch (e) { } return;
        }

        // Check if this is a banned ip address
        if (obj.checkAllowLogin(req) == false) { parent.debug('web', 'WSERROR: Banned connection.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'banned', msg: 'banned-1' })); ws.close(); } catch (e) { } return; }
        try {
            // Hold this websocket until we are ready.
            ws._socket.pause();

            // Check IP filtering and domain
            var domain = null;
            if (noAuthOk == true) {
                domain = getDomain(req);
                if (domain == null) { parent.debug('web', 'WSERROR: Got no domain, no auth ok.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-1' })); ws.close(); return; } catch (e) { } return; }
            } else {
                // If authentication is required, enforce IP address filtering.
                domain = checkUserIpAddress(ws, req);
                if (domain == null) { parent.debug('web', 'WSERROR: Got no domain, user auth required.'); return; }
            }

            // Check if inner authentication is requested
            if (req.headers['x-meshauth'] === '*') { func(ws, req, domain, null); return; }

            const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

            // A web socket session can be authenticated in many ways (Default user, session, user/pass and cookie). Check authentication here.
            if ((req.query.user != null) && (req.query.pass != null)) {
                // A user/pass is provided in URL arguments
                obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid, passhint, loginOptions) {

                    var user = obj.users[userid];

                    // Check if user as the "notools" site right. If so, deny this connection as tools are not allowed to connect.
                    if ((user != null) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & SITERIGHT_NOMESHCMD)) {
                        // No tools allowed, close the websocket connection
                        parent.debug('web', 'ERR: Websocket no tools allowed');
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'notools', msg: 'notools' })); ws.close(); } catch (e) { }
                        return;
                    }

                    // See if we support two-factor trusted cookies
                    var twoFactorCookieDays = 30;
                    if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                    if ((err == null) && (user)) {
                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true) {
                            // Figure out if email 2FA is allowed
                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                            //var push2fa = ((parent.firebase != null) && (user.otpdev != null));
                            if ((typeof req.query.token != 'string') || (req.query.token == '**email**') || (req.query.token == '**sms**')/* || (req.query.token == '**push**')*/) {
                                if ((req.query.token == '**email**') && (email2fa == true)) {
                                    // Cause a token to be sent to the user's registered email
                                    user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                    obj.db.SetUser(user);
                                    parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                    domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                    // Ask for a login token & confirm email was sent
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                } else if ((req.query.token == '**sms**') && (sms2fa == true)) {
                                    // Cause a token to be sent to the user's phone number
                                    user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                    obj.db.SetUser(user);
                                    parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                    parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                    // Ask for a login token & confirm sms was sent
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                    /*
                                } else if ((command.token == '**push**') && (push2fa == true)) {
                                    // Cause push notification to device
                                    const code = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                                    const authCookie = parent.encodeCookie({ a: 'checkAuth', c: code, u: user._id, n: user.otpdev });
                                    var payload = { notification: { title: "MeshCentral", body: user.name + " authentication" }, data: { url: '2fa://auth?code=' + code + '&c=' + authCookie } };
                                    var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
                                    parent.firebase.sendToDevice(user.otpdev, payload, options, function (id, err, errdesc) {
                                        if (err == null) { parent.debug('email', 'Successfully auth check send push message to device'); } else { parent.debug('email', 'Failed auth check push message to device, error: ' + errdesc); }
                                    });
                                    */
                                } else {
                                    // Ask for a login token
                                    parent.debug('web', 'Asking for login token');
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                }
                            } else {
                                checkUserOneTimePassword(req, domain, user, req.query.token, null, function (result, authData) {
                                    if (result == false) {
                                        // Failed, ask for a login token again
                                        parent.debug('web', 'Invalid login token, asking again');
                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                        } else {
                                            func(ws, req, domain, user, null, authData);
                                        }
                                    }
                                });
                            }
                        } else {
                            // Check email verification
                            if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                parent.debug('web', 'Invalid login, asking for email validation');
                                var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, email2fasent: true })); ws.close(); } catch (e) { }
                            } else {
                                // We are authenticated
                                func(ws, req, domain, user);
                            }
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            parent.debug('web', 'ERR: Websocket bad user/pass auth');
                            //obj.parent.DispatchEvent(['*', 'server-users', 'user/' + domain.id + '/' + obj.args.user.toLowerCase()], obj, { action: 'authfail', userid: 'user/' + domain.id + '/' + obj.args.user.toLowerCase(), username: obj.args.user, domain: domain.id, msg: 'Invalid user login attempt from ' + req.clientIp });
                            //obj.setbadLogin(req);
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2a' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            } else if ((req.query.auth != null) && (req.query.auth != '')) {
                // This is a encrypted cookie authentication
                var cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey, 60); // Cookie with 1 hour timeout
                if ((cookie == null) && (obj.parent.multiServer != null)) { cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.serverKey, 60); } // Try the server key
                if ((obj.args.cookieipcheck !== false) && (cookie != null) && (cookie.ip != null) && (cookie.ip != req.clientIp && (cookie.ip != req.clientIp))) { // If the cookie if binded to an IP address, check here.
                    parent.debug('web', 'ERR: Invalid cookie IP address, got \"' + cookie.ip + '\", expected \"' + cleanRemoteAddr(req.clientIp) + '\".');
                    cookie = null;
                }
                if ((cookie != null) && (cookie.userid != null) && (obj.users[cookie.userid]) && (cookie.domainid == domain.id) && (cookie.userid.split('/')[1] == domain.id)) {
                    // Valid cookie, we are authenticated. Cookie of format { userid: 'user//name', domain: '' }
                    func(ws, req, domain, obj.users[cookie.userid], cookie);
                } else if ((cookie != null) && (cookie.a === 3) && (typeof cookie.u == 'string') && (obj.users[cookie.u]) && (cookie.u.split('/')[1] == domain.id)) {
                    // Valid cookie, we are authenticated. Cookie of format { u: 'user//name', a: 3 }
                    func(ws, req, domain, obj.users[cookie.u], cookie);
                } else if ((cookie != null) && (cookie.nouser === 1)) {
                    // This is a valid cookie, but no user. This is used for agent self-sharing.
                    func(ws, req, domain, null, cookie);
                } else {
                    // This is a bad cookie, keep going anyway, maybe we have a active session that will save us.
                    if ((cookie != null) && (cookie.domainid != domain.id)) { parent.debug('web', 'ERR: Invalid domain, got \"' + cookie.domainid + '\", expected \"' + domain.id + '\".'); }
                    parent.debug('web', 'ERR: Websocket bad cookie auth (Cookie:' + (cookie != null) + '): ' + req.query.auth);
                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2b' })); ws.close(); } catch (e) { }
                }
                return;
            } else if (req.headers['x-meshauth'] != null) {
                // This is authentication using a custom HTTP header
                var s = req.headers['x-meshauth'].split(',');
                for (var i in s) { s[i] = Buffer.from(s[i], 'base64').toString(); }
                if ((s.length < 2) || (s.length > 3)) { try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); ws.close(); } catch (e) { } return; }
                obj.authenticate(s[0], s[1], domain, function (err, userid, passhint, loginOptions) {
                    var user = obj.users[userid];
                    if ((err == null) && (user)) {
                        // Check if user as the "notools" site right. If so, deny this connection as tools are not allowed to connect.
                        if ((user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & SITERIGHT_NOMESHCMD)) {
                            // No tools allowed, close the websocket connection
                            parent.debug('web', 'ERR: Websocket no tools allowed');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'notools', msg: 'notools' })); ws.close(); } catch (e) { }
                            return;
                        }

                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true) {

                            // See if we support two-factor trusted cookies
                            var twoFactorCookieDays = 30;
                            if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                            // Figure out if email 2FA is allowed
                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                            if (s.length != 3) {
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                            } else {
                                checkUserOneTimePassword(req, domain, user, s[2], null, function (result, authData) {
                                    if (result == false) {
                                        if ((s[2] == '**email**') && (email2fa == true)) {
                                            // Cause a token to be sent to the user's registered email
                                            user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                            obj.db.SetUser(user);
                                            parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                            domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                            // Ask for a login token & confirm email was sent
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else if ((s[2] == '**sms**') && (sms2fa == true)) {
                                            // Cause a token to be sent to the user's phone number
                                            user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                            obj.db.SetUser(user);
                                            parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                            parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                            // Ask for a login token & confirm sms was sent
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', sms2fa: sms2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else {
                                            // Ask for a login token
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else {
                                            func(ws, req, domain, user, null, authData);
                                        }
                                    }
                                });
                            }
                        } else {
                            // We are authenticated
                            // Check email verification
                            if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                parent.debug('web', 'Invalid login, asking for email validation');
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, email2fasent: true })); ws.close(); } catch (e) { }
                            } else {
                                func(ws, req, domain, user);
                            }
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            parent.debug('web', 'ERR: Websocket bad user/pass auth');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2d' })); ws.close(); } catch (e) { }
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
            } else if (req.session && (req.session.userid != null) && (req.session.userid.split('/')[1] == domain.id) && (obj.users[req.session.userid])) {
                // This user is logged in using the ExpressJS session
                func(ws, req, domain, obj.users[req.session.userid]);
                return;
            }

            if (noAuthOk != true) {
                // If not authenticated, close the websocket connection
                parent.debug('web', 'ERR: Websocket no auth');
                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-4' })); ws.close(); } catch (e) { }
            } else {
                // Continue this session without user authentication,
                // this is expected if the agent is connecting for a tunnel.
                func(ws, req, domain, null);
            }
        } catch (e) { console.log(e); }
    }

    // Find a free port starting with the specified one and going up.
    function CheckListenPort(port, addr, func) {
        var s = obj.net.createServer(function (socket) { });
        obj.tcpServer = s.listen(port, addr, function () { s.close(function () { if (func) { func(port, addr); } }); }).on('error', function (err) {
            if (args.exactports) { console.error('ERROR: MeshCentral HTTPS server port ' + port + ' not available.'); process.exit(); }
            else { if (port < 65535) { CheckListenPort(port + 1, addr, func); } else { if (func) { func(0); } } }
        });
    }

    // Start the ExpressJS web server
    function StartWebServer(port, addr) {
        if ((port < 1) || (port > 65535)) return;
        obj.args.port = port;
        if (obj.tlsServer != null) {
            if (obj.args.lanonly == true) {
                obj.tcpServer = obj.tlsServer.listen(port, addr, function () { console.log('MeshCentral HTTPS server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
            } else {
                obj.tcpServer = obj.tlsServer.listen(port, addr, function () { console.log('MeshCentral HTTPS server running on ' + certificates.CommonName + ':' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
                obj.parent.updateServerState('servername', certificates.CommonName);
            }
            if (obj.parent.authlog) { obj.parent.authLog('https', 'Server listening on ' + ((addr != null) ? addr : '0.0.0.0') + ' port ' + port + '.'); }
            obj.parent.updateServerState('https-port', port);
            if (args.aliasport != null) { obj.parent.updateServerState('https-aliasport', args.aliasport); }
        } else {
            obj.tcpServer = obj.app.listen(port, addr, function () { console.log('MeshCentral HTTP server running on port ' + port + ((args.aliasport != null) ? (', alias port ' + args.aliasport) : '') + '.'); });
            obj.parent.updateServerState('http-port', port);
            if (args.aliasport != null) { obj.parent.updateServerState('http-aliasport', args.aliasport); }
        }

        // Check if there is a permissions problem with the ports.
        if (require('os').platform() != 'win32') {
            var expectedPort = obj.parent.config.settings.port ? obj.parent.config.settings.port : 443;
            if ((expectedPort != port) && (port >= 1024) && (port < 1034)) {
                console.log('');
                console.log('WARNING: MeshCentral is running without permissions to use ports below 1025.');
                console.log('         Use setcap to grant access to lower ports, or read installation guide.');
                console.log('');
                console.log('   sudo setcap \'cap_net_bind_service=+ep\' `which node` \r\n');
                obj.parent.addServerWarning('Server running without permissions to use ports below 1025.', false);
            }
        }
    }

    // Start the ExpressJS web server on agent-only alternative port
    function StartAltWebServer(port, addr) {
        if ((port < 1) || (port > 65535)) return;
        var agentAliasPort = null;
        if (args.agentaliasport != null) { agentAliasPort = args.agentaliasport; }
        if (obj.tlsAltServer != null) {
            if (obj.args.lanonly == true) {
                obj.tcpAltServer = obj.tlsAltServer.listen(port, addr, function () { console.log('MeshCentral HTTPS agent-only server running on port ' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            } else {
                obj.tcpAltServer = obj.tlsAltServer.listen(port, addr, function () { console.log('MeshCentral HTTPS agent-only server running on ' + certificates.CommonName + ':' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            }
            if (obj.parent.authlog) { obj.parent.authLog('https', 'Server listening on 0.0.0.0 port ' + port + '.'); }
            obj.parent.updateServerState('https-agent-port', port);
        } else {
            obj.tcpAltServer = obj.agentapp.listen(port, addr, function () { console.log('MeshCentral HTTP agent-only server running on port ' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            obj.parent.updateServerState('http-agent-port', port);
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
        if (((obj.GetMeshRights(user, agent.dbMeshKey) & MESHRIGHT_AGENTCONSOLE) != 0) || (user.siteadmin == 0xFFFFFFFF)) { agent.close(disconnectMode); }
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
        if (((obj.GetMeshRights(user, agent.dbMeshKey) & MESHRIGHT_AGENTCONSOLE) != 0) || (user.siteadmin == 0xFFFFFFFF)) {
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
            } else if (coretype == 'tiny') {
                // Reset to tiny core
                agent.agentCoreCheck = 1011; // Tell the agent object we are using the tiny core.
                agent.send(obj.common.ShortToStr(11) + obj.common.ShortToStr(0)); // Command 11, ask for mesh core hash.
            } else if (coretype == 'custom') {
                agent.agentCoreCheck = 1000; // Tell the agent object we are using a custom core.
                var buf = Buffer.from(coredata, 'utf8');
                const hash = obj.crypto.createHash('sha384').update(buf).digest().toString('binary'); // Perform a SHA384 hash on the core module
                agent.sendBinary(obj.common.ShortToStr(10) + obj.common.ShortToStr(0) + hash + buf.toString('binary')); // Send the code module to the agent
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
                    var u = obj.users[userid];
                    if (u) {
                        var targets = ['*', 'server-users'];
                        if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                        obj.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', userid: userid, username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                    }
                }
            }

            // If there are any counts left in the old counts, event to zero
            for (userid in obj.sessionsCount) {
                oldcount = obj.sessionsCount[userid];
                if ((oldcount != null) && (oldcount != 0)) {
                    x = userid.split('/');
                    var u = obj.users[userid];
                    if (u) {
                        var targets = ['*', 'server-users'];
                        if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                        obj.parent.DispatchEvent(['*'], obj, { action: 'wssessioncount', userid: userid, username: x[2], count: 0, domain: x[1], nolog: 1, nopeers: 1 })
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
                var u = obj.users[userid];
                if (u) {
                    var targets = ['*', 'server-users'];
                    if (u.groups) { for (var i in u.groups) { targets.push('server-users:' + i); } }
                    obj.parent.DispatchEvent(targets, obj, { action: 'wssessioncount', userid: userid, username: x[2], count: newcount, domain: x[1], nolog: 1, nopeers: 1 });
                    obj.sessionsCount[userid] = newcount;
                }
            }
        }
    };

    //
    // Access Control Functions
    //

    // Remove user rights
    function removeUserRights(rights, user) {
        if (user.removeRights == null) return rights;
        var add = 0, substract = 0;
        if ((user.removeRights & 0x00000008) != 0) { substract += 0x00000008; } // No Remote Control
        if ((user.removeRights & 0x00010000) != 0) { add += 0x00010000; } // No Desktop
        if ((user.removeRights & 0x00000100) != 0) { add += 0x00000100; } // Desktop View Only
        if ((user.removeRights & 0x00000200) != 0) { add += 0x00000200; } // No Terminal
        if ((user.removeRights & 0x00000400) != 0) { add += 0x00000400; } // No Files
        if ((user.removeRights & 0x00000010) != 0) { substract += 0x00000010; } // No Console
        if ((user.removeRights & 0x00008000) != 0) { substract += 0x00008000; } // No Uninstall
        if ((user.removeRights & 0x00020000) != 0) { substract += 0x00020000; } // No Remote Command
        if ((user.removeRights & 0x00000040) != 0) { substract += 0x00000040; } // No Wake
        if ((user.removeRights & 0x00040000) != 0) { substract += 0x00040000; } // No Reset/Off
        if (rights != 0xFFFFFFFF) {
            // If not administrator, add and subsctract restrictions
            rights |= add;
            rights &= (0xFFFFFFFF - substract);
        } else {
            // If administrator for a device group, start with permissions and add and subsctract restrictions
            rights = 1 + 2 + 4 + 8 + 32 + 64 + 128 + 16384 + 32768 + 131072 + 262144 + 524288 + 1048576;
            rights |= add;
            rights &= (0xFFFFFFFF - substract);
        }
        return rights;
    }

    // Return the node and rights for a given nodeid
    obj.GetNodeWithRights = function (domain, user, nodeid, func) {
        // Perform user pre-validation
        if ((user == null) || (nodeid == null)) { func(null, 0, false); return; } // Invalid user
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { func(null, 0, false); return; } // No rights

        // Perform node pre-validation
        if (obj.common.validateString(nodeid, 0, 128) == false) { func(null, 0, false); return; } // Invalid nodeid
        const snode = nodeid.split('/');
        if ((snode.length != 3) || (snode[0] != 'node')) { func(null, 0, false); return; } // Invalid nodeid
        if ((domain != null) && (snode[1] != domain.id)) { func(null, 0, false); return; } // Invalid domain

        // Check that we have permissions for this node.
        db.Get(nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { func(null, 0, false); return; } // No such nodeid

            // This is a super user that can see all device groups for a given domain
            if ((user.siteadmin == 0xFFFFFFFF) && (parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) && (nodes[0].domain == user.domain)) {
                func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return;
            }

            // If no links, stop here.
            if (user.links == null) { func(null, 0, false); return; }

            // Check device link
            var rights = 0, visible = false, r = user.links[nodeid];
            if (r != null) {
                if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; } // User has full rights thru a device link, stop here.
                rights |= r.rights;
                visible = true;
            }

            // Check device group link
            r = user.links[nodes[0].meshid];
            if (r != null) {
                if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; } // User has full rights thru a device group link, stop here.
                rights |= r.rights;
                visible = true;
            }

            // Check user group links
            for (var i in user.links) {
                if (i.startsWith('ugrp/')) {
                    const g = obj.userGroups[i];
                    if (g && (g.links != null)) {
                        r = g.links[nodes[0].meshid];
                        if (r != null) {
                            if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; } // User has full rights thru a user group link, stop here.
                            rights |= r.rights; // TODO: Deal with reverse rights
                            visible = true;
                        }
                        r = g.links[nodeid];
                        if (r != null) {
                            if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; } // User has full rights thru a user group direct link, stop here.
                            rights |= r.rights; // TODO: Deal with reverse rights
                            visible = true;
                        }
                    }
                }
            }

            // Remove any user rights
            rights = removeUserRights(rights, user);

            // Return the rights we found
            func(nodes[0], rights, visible);
        });
    }

    // Returns a list of all meshes that this user has some rights too
    obj.GetAllMeshWithRights = function (user, rights) {
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { return []; }

        var r = [];
        if ((user.siteadmin == 0xFFFFFFFF) && (parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0)) {
            // This is a super user that can see all device groups for a given domain
            var meshStartStr = 'mesh/' + user.domain + '/';
            for (var i in obj.meshes) { if ((obj.meshes[i]._id.startsWith(meshStartStr)) && (obj.meshes[i].deleted == null)) { r.push(obj.meshes[i]); } }
            return r;
        }
        if (user.links == null) { return []; }
        for (var i in user.links) {
            if (i.startsWith('mesh/')) {
                // Grant access to a device group thru a direct link
                const m = obj.meshes[i];
                if ((m) && (r.indexOf(m) == -1) && (m.deleted == null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) { r.push(m); }
            } else if (i.startsWith('ugrp/')) {
                // Grant access to a device group thru a user group
                const g = obj.userGroups[i];
                for (var j in g.links) {
                    if (j.startsWith('mesh/') && ((rights == null) || ((g.links[j].rights != null) && (g.links[j].rights & rights) != 0))) {
                        const m = obj.meshes[j];
                        if ((m) && (m.deleted == null) && (r.indexOf(m) == -1)) { r.push(m); }
                    }
                }
            }
        }
        return r;
    }

    // Returns a list of all mesh id's that this user has some rights too
    obj.GetAllMeshIdWithRights = function (user, rights) {
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { return []; }
        var r = [];
        if ((user.siteadmin == 0xFFFFFFFF) && (parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0)) {
            // This is a super user that can see all device groups for a given domain
            var meshStartStr = 'mesh/' + user.domain + '/';
            for (var i in obj.meshes) { if ((obj.meshes[i]._id.startsWith(meshStartStr)) && (obj.meshes[i].deleted == null)) { r.push(obj.meshes[i]._id); } }
            return r;
        }
        if (user.links == null) { return []; }
        for (var i in user.links) {
            if (i.startsWith('mesh/')) {
                // Grant access to a device group thru a direct link
                const m = obj.meshes[i];
                if ((m) && (m.deleted == null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) {
                    if (r.indexOf(m._id) == -1) { r.push(m._id); }
                }
            } else if (i.startsWith('ugrp/')) {
                // Grant access to a device group thru a user group
                const g = obj.userGroups[i];
                if (g && (g.links != null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) {
                    for (var j in g.links) {
                        if (j.startsWith('mesh/')) {
                            const m = obj.meshes[j];
                            if ((m) && (m.deleted == null)) {
                                if (r.indexOf(m._id) == -1) { r.push(m._id); }
                            }
                        }
                    }
                }
            }
        }
        return r;
    }

    // Get the rights of a user on a given device group
    obj.GetMeshRights = function (user, mesh) {
        if ((user == null) || (mesh == null)) { return 0; }
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { return 0; }
        var r, meshid;
        if (typeof mesh == 'string') {
            meshid = mesh;
        } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) {
            meshid = mesh._id;
        } else return 0;

        // Check if this is a super user that can see all device groups for a given domain
        if ((user.siteadmin == 0xFFFFFFFF) && (parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) && (meshid.startsWith('mesh/' + user.domain + '/'))) { return removeUserRights(0xFFFFFFFF, user); }

        // Check direct user to device group permissions
        if (user.links == null) return 0;
        var rights = 0;
        r = user.links[meshid];
        if (r != null) {
            var rights = r.rights;
            if (rights == 0xFFFFFFFF) { return removeUserRights(rights, user); } // If the user has full access thru direct link, stop here.
        }

        // Check if we are part of any user groups that would give this user more access.
        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = obj.userGroups[i];
                if (g) {
                    r = g.links[meshid];
                    if (r != null) {
                        if (r.rights == 0xFFFFFFFF) {
                            return removeUserRights(r.rights, user); // If the user hash full access thru a user group link, stop here.
                        } else {
                            rights |= r.rights; // Add to existing rights (TODO: Deal with reverse rights)
                        }
                    }
                }

            }
        }

        return removeUserRights(rights, user);
    }

    // Returns true if the user can view the given device group
    obj.IsMeshViewable = function (user, mesh) {
        if ((user == null) || (mesh == null)) { return false; }
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { return false; }
        var meshid;
        if (typeof mesh == 'string') {
            meshid = mesh;
        } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) {
            meshid = mesh._id;
        } else return false;

        // Check if this is a super user that can see all device groups for a given domain
        if ((user.siteadmin == 0xFFFFFFFF) && (parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) && (meshid.startsWith('mesh/' + user.domain + '/'))) { return true; }

        // Check direct user to device group permissions
        if (user.links == null) { return false; }
        if (user.links[meshid] != null) { return true; } // If the user has a direct link, stop here.

        // Check if we are part of any user groups that would give this user visibility to this device group.
        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = obj.userGroups[i];
                if (g && (g.links[meshid] != null)) { return true; } // If the user has a user group link, stop here.
            }
        }

        return false;
    }

    var GetNodeRightsCache = {};
    var GetNodeRightsCacheCount = 0;

    // Return the user rights for a given node
    obj.GetNodeRights = function (user, mesh, nodeid) {
        if ((user == null) || (mesh == null) || (nodeid == null)) { return 0; }
        if (typeof user == 'string') { user = obj.users[user]; }
        if (user == null) { return 0; }
        var meshid;
        if (typeof mesh == 'string') { meshid = mesh; } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) { meshid = mesh._id; } else return 0;

        // Check if we have this in the cache
        const cacheid = user._id + '/' + meshid + '/' + nodeid;
        const cache = GetNodeRightsCache[cacheid];
        if (cache != null) { if (cache.t > Date.now()) { return cache.o; } else { GetNodeRightsCacheCount--; } } // Cache hit, or we need to update the cache
        if (GetNodeRightsCacheCount > 2000) { GetNodeRightsCache = {}; GetNodeRightsCacheCount = 0; } // From time to time, flush the cache

        var r = obj.GetMeshRights(user, mesh);
        if (r == 0xFFFFFFFF) {
            const out = removeUserRights(r, user);
            GetNodeRightsCache[cacheid] = { t: Date.now() + 10000, o: out };
            GetNodeRightsCacheCount++;
            return out;
        }

        // Check direct device rights using device data
        if ((user.links != null) && (user.links[nodeid] != null)) { r |= user.links[nodeid].rights; } // TODO: Deal with reverse permissions
        if (r == 0xFFFFFFFF) {
            const out = removeUserRights(r, user);
            GetNodeRightsCache[cacheid] = { t: Date.now() + 10000, o: out };
            GetNodeRightsCacheCount++;
            return out;
        }

        // Check direct device rights thru a user group
        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = obj.userGroups[i];
                if (g && (g.links[nodeid] != null)) { r |= g.links[nodeid].rights; }
            }
        }

        const out = removeUserRights(r, user);
        GetNodeRightsCache[cacheid] = { t: Date.now() + 10000, o: out };
        GetNodeRightsCacheCount++;
        return out;
    }

    // Returns a list of displatch targets for a given mesh
    // We have to target the meshid and all user groups for this mesh, plus any added targets
    obj.CreateMeshDispatchTargets = function (mesh, addedTargets) {
        var targets = (addedTargets != null) ? addedTargets : [];
        if (targets.indexOf('*') == -1) { targets.push('*'); }
        if (typeof mesh == 'string') { mesh = obj.meshes[mesh]; }
        if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
        return targets;
    }

    // Returns a list of displatch targets for a given mesh
    // We have to target the meshid and all user groups for this mesh, plus any added targets
    obj.CreateNodeDispatchTargets = function (mesh, nodeid, addedTargets) {
        var targets = (addedTargets != null) ? addedTargets : [];
        targets.push(nodeid);
        if (targets.indexOf('*') == -1) { targets.push('*'); }
        if (typeof mesh == 'string') { mesh = obj.meshes[mesh]; }
        if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
        for (var i in obj.userGroups) { const g = obj.userGroups[i]; if ((g != null) && (g.links != null) && (g.links[nodeid] != null)) { targets.push(i); } }
        return targets;
    }

    // Clone a safe version of a user object, remove everything that is secret.
    obj.CloneSafeUser = function (user) {
        if (typeof user != 'object') { return user; }
        var user2 = Object.assign({}, user); // Shallow clone
        delete user2.hash;
        delete user2.passhint;
        delete user2.salt;
        delete user2.type;
        delete user2.domain;
        delete user2.subscriptions;
        delete user2.passtype;
        delete user2.otpsms;
        if ((typeof user2.otpekey == 'object') && (user2.otpekey != null)) { user2.otpekey = 1; } // Indicates that email 2FA is enabled.
        if ((typeof user2.otpsecret == 'string') && (user2.otpsecret != null)) { user2.otpsecret = 1; } // Indicates a time secret is present.
        if ((typeof user2.otpkeys == 'object') && (user2.otpkeys != null)) { user2.otpkeys = 0; if (user.otpkeys != null) { for (var i = 0; i < user.otpkeys.keys.length; i++) { if (user.otpkeys.keys[i].u == true) { user2.otpkeys = 1; } } } } // Indicates the number of one time backup codes that are active.
        if ((typeof user2.otphkeys == 'object') && (user2.otphkeys != null)) { user2.otphkeys = user2.otphkeys.length; } // Indicates the number of hardware keys setup
        if ((typeof user2.otpdev == 'string') && (user2.otpdev != null)) { user2.otpdev = 1; } // Indicates device for 2FA push notification
        if ((typeof user2.webpush == 'object') && (user2.webpush != null)) { user2.webpush = user2.webpush.length; } // Indicates the number of web push sessions we have
        return user2;
    }

    // Clone a safe version of a node object, remove everything that is secret.
    obj.CloneSafeNode = function (node) {
        if (typeof node != 'object') { return node; }
        var r = node;
        if ((r.pmt != null) || (r.ssh != null) || (r.rdp != null) || ((r.intelamt != null) && ((r.intelamt.pass != null) || (r.intelamt.mpspass != null)))) {
            r = Object.assign({}, r); // Shallow clone
            if (r.pmt != null) { r.pmt = 1; }
            if (r.ssh != null) { r.ssh = (r.ssh.k != null) ? 2 : 1; }
            if (r.rdp != null) { r.rdp = 1; }
            if ((r.intelamt != null) && ((r.intelamt.pass != null) || (r.intelamt.mpspass != null))) {
                r.intelamt = Object.assign({}, r.intelamt); // Shallow clone
                if (r.intelamt.pass != null) { r.intelamt.pass = 1; }; // Remove the Intel AMT administrator password from the node
                if (r.intelamt.mpspass != null) { r.intelamt.mpspass = 1; }; // Remove the Intel AMT MPS password from the node
            }
        }
        return r;
    }

    // Clone a safe version of a mesh object, remove everything that is secret.
    obj.CloneSafeMesh = function (mesh) {
        if (typeof mesh != 'object') { return mesh; }
        var r = mesh;
        if (((r.amt != null) && (r.amt.password != null)) || ((r.kvm != null) && (r.kvm.pass != null))) {
            r = Object.assign({}, r); // Shallow clone
            if ((r.amt != null) && (r.amt.password != null)) {
                r.amt = Object.assign({}, r.amt); // Shallow clone
                if ((r.amt.password != null) && (r.amt.password != '')) { r.amt.password = 1; } // Remove the Intel AMT password from the policy
            }
            if ((r.kvm != null) && (r.kvm.pass != null)) {
                r.kvm = Object.assign({}, r.kvm); // Shallow clone
                if ((r.kvm.pass != null) && (r.kvm.pass != '')) { r.kvm.pass = 1; } // Remove the IP KVM device password
            }
        }
        return r;
    }

    // Filter the user web site and only output state that we need to keep
    const acceptableUserWebStateStrings = ['webPageStackMenu', 'notifications', 'deviceView', 'nightMode', 'webPageFullScreen', 'search', 'showRealNames', 'sort', 'deskAspectRatio', 'viewsize', 'DeskControl', 'uiMode', 'footerBar'];
    const acceptableUserWebStateDesktopStrings = ['encoding', 'showfocus', 'showmouse', 'showcad', 'limitFrameRate', 'noMouseRotate', 'quality', 'scaling']
    obj.filterUserWebState = function (state) {
        if (typeof state == 'string') { try { state = JSON.parse(state); } catch (ex) { return null; } }
        if ((state == null) || (typeof state != 'object')) { return null; }
        var out = {};
        for (var i in acceptableUserWebStateStrings) {
            var n = acceptableUserWebStateStrings[i];
            if ((state[n] != null) && ((typeof state[n] == 'number') || (typeof state[n] == 'boolean') || ((typeof state[n] == 'string') && (state[n].length < 64)))) { out[n] = state[n]; }
        }
        if ((typeof state.stars == 'string') && (state.stars.length < 2048)) { out.stars = state.stars; }
        if (typeof state.desktopsettings == 'string') { try { state.desktopsettings = JSON.parse(state.desktopsettings); } catch (ex) { delete state.desktopsettings; } }
        if (state.desktopsettings != null) {
            out.desktopsettings = {};
            for (var i in acceptableUserWebStateDesktopStrings) {
                var n = acceptableUserWebStateDesktopStrings[i];
                if ((state.desktopsettings[n] != null) && ((typeof state.desktopsettings[n] == 'number') || (typeof state.desktopsettings[n] == 'boolean') || ((typeof state.desktopsettings[n] == 'string') && (state.desktopsettings[n].length < 32)))) { out.desktopsettings[n] = state.desktopsettings[n]; }
            }
            out.desktopsettings = JSON.stringify(out.desktopsettings);
        }
        if ((typeof state.deskKeyShortcuts == 'string') && (state.deskKeyShortcuts.length < 2048)) { out.deskKeyShortcuts = state.deskKeyShortcuts; }
        if ((typeof state.deskStrings == 'string') && (state.deskStrings.length < 10000)) { out.deskStrings = state.deskStrings; }
        return JSON.stringify(out);
    }

    // Return the correct render page given mobile, minify and override path.
    function getRenderPage(pagename, req, domain) {
        var mobile = isMobileBrowser(req), minify = (domain.minify == true), p;
        if (req.query.mobile == '1') { mobile = true; } else if (req.query.mobile == '0') { mobile = false; }
        if (req.query.minify == '1') { minify = true; } else if (req.query.minify == '0') { minify = false; }
        if ((domain != null) && (domain.mobilesite === false)) { mobile = false; }
        if (mobile) {
            if ((domain != null) && (domain.webviewspath != null)) { // If the domain has a web views path, use that first
                if (minify) {
                    p = obj.path.join(domain.webviewspath, pagename + '-mobile-min');
                    if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile + Minify + Override document
                }
                p = obj.path.join(domain.webviewspath, pagename + '-mobile');
                if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile + Override document
            }
            if (obj.parent.webViewsOverridePath != null) {
                if (minify) {
                    p = obj.path.join(obj.parent.webViewsOverridePath, pagename + '-mobile-min');
                    if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile + Minify + Override document
                }
                p = obj.path.join(obj.parent.webViewsOverridePath, pagename + '-mobile');
                if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile + Override document
            }
            if (minify) {
                p = obj.path.join(obj.parent.webViewsPath, pagename + '-mobile-min');
                if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile + Minify document
            }
            p = obj.path.join(obj.parent.webViewsPath, pagename + '-mobile');
            if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Mobile document
        }
        if ((domain != null) && (domain.webviewspath != null)) { // If the domain has a web views path, use that first
            if (minify) {
                p = obj.path.join(domain.webviewspath, pagename + '-min');
                if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Minify + Override document
            }
            p = obj.path.join(domain.webviewspath, pagename);
            if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Override document
        }
        if (obj.parent.webViewsOverridePath != null) {
            if (minify) {
                p = obj.path.join(obj.parent.webViewsOverridePath, pagename + '-min');
                if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Minify + Override document
            }
            p = obj.path.join(obj.parent.webViewsOverridePath, pagename);
            if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Override document
        }
        if (minify) {
            p = obj.path.join(obj.parent.webViewsPath, pagename + '-min');
            if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Minify document
        }
        p = obj.path.join(obj.parent.webViewsPath, pagename);
        if (obj.fs.existsSync(p + '.handlebars')) { return p; } // Default document
        return null;
    }

    // Return the correct render page arguments.
    function getRenderArgs(xargs, req, domain, page) {
        var minify = (domain.minify == true);
        if (req.query.minify == '1') { minify = true; } else if (req.query.minify == '0') { minify = false; }
        xargs.min = minify ? '-min' : '';
        xargs.titlehtml = domain.titlehtml;
        xargs.title = (domain.title != null) ? domain.title : 'MeshCentral';
        if (
            ((page == 'login2') && (domain.loginpicture == null) && (domain.titlehtml == null)) ||
            ((page != 'login2') && (domain.titlepicture == null) && (domain.titlehtml == null))
        ) {
            if (domain.title == null) {
                xargs.title1 = 'MeshCentral';
                xargs.title2 = '';
            } else {
                xargs.title1 = domain.title;
                xargs.title2 = domain.title2 ? domain.title2 : '';
            }
        } else {
            xargs.title1 = domain.title1 ? domain.title1 : '';
            xargs.title2 = (domain.title1 && domain.title2) ? domain.title2 : '';
        }
        xargs.extitle = encodeURIComponent(xargs.title).split('\'').join('\\\'');
        xargs.domainurl = domain.url;
        xargs.autocomplete = (domain.autocomplete === false)?'x':'autocomplete'; // This option allows autocomplete to be turned off on the login page.
        if (typeof domain.hide == 'number') { xargs.hide = domain.hide; }
        return xargs;
    }

    // Route a command from a agent. domainid, nodeid and meshid are the values of the source agent.
    obj.routeAgentCommand = function (command, domainid, nodeid, meshid) {
        // Route a message.
        // If this command has a sessionid, that is the target.
        if (command.sessionid != null) {
            if (typeof command.sessionid != 'string') return;
            var splitsessionid = command.sessionid.split('/');
            // Check that we are in the same domain and the user has rights over this node.
            if ((splitsessionid.length == 4) && (splitsessionid[0] == 'user') && (splitsessionid[1] == domainid)) {
                // Check if this user has rights to get this message
                if (obj.GetNodeRights(splitsessionid[0] + '/' + splitsessionid[1] + '/' + splitsessionid[2], meshid, nodeid) == 0) return; // TODO: Check if this is ok

                // See if the session is connected. If so, go ahead and send this message to the target node
                var ws = obj.wssessions2[command.sessionid];
                if (ws != null) {
                    command.nodeid = nodeid;  // Set the nodeid, required for responses.
                    delete command.sessionid; // Remove the sessionid, since we are sending to that sessionid, so it's implyed.
                    try { ws.send(JSON.stringify(command)); } catch (ex) { }
                } else if (parent.multiServer != null) {
                    // See if we can send this to a peer server
                    var serverid = obj.wsPeerSessions2[command.sessionid];
                    if (serverid != null) {
                        command.fromNodeid = nodeid;
                        parent.multiServer.DispatchMessageSingleServer(command, serverid);
                    }
                }
            }
        } else if (command.userid != null) { // If this command has a userid, that is the target.
            if (typeof command.userid != 'string') return;
            var splituserid = command.userid.split('/');
            // Check that we are in the same domain and the user has rights over this node.
            if ((splituserid[0] == 'user') && (splituserid[1] == domainid)) {
                // Check if this user has rights to get this message
                if (obj.GetNodeRights(command.userid, meshid, nodeid) == 0) return; // TODO: Check if this is ok

                // See if the session is connected
                var sessions = obj.wssessions[command.userid];

                // Go ahead and send this message to the target node
                if (sessions != null) {
                    command.nodeid = nodeid; // Set the nodeid, required for responses.
                    delete command.userid;   // Remove the userid, since we are sending to that userid, so it's implyed.
                    for (i in sessions) { sessions[i].send(JSON.stringify(command)); }
                }

                if (parent.multiServer != null) {
                    // TODO: Add multi-server support
                }
            }
        } else { // Route this command to all users with MESHRIGHT_AGENTCONSOLE rights to this device group
            command.nodeid = nodeid;
            var cmdstr = JSON.stringify(command);

            // Find all connected user sessions with access to this device
            for (var userid in obj.wssessions) {
                var xsessions = obj.wssessions[userid];
                if (obj.GetNodeRights(userid, meshid, nodeid) != 0) {
                    // Send the message to all sessions for this user on this server
                    for (i in xsessions) { try { xsessions[i].send(cmdstr); } catch (e) { } }
                }
            }

            // Send the message to all users of other servers
            if (parent.multiServer != null) {
                delete command.nodeid;
                command.fromNodeid = nodeid;
                command.meshid = meshid;
                parent.multiServer.DispatchMessage(command);
            }
        }
    }

    // Returns a list of acceptable languages in order
    obj.getLanguageCodes = function (req) {
        // If a user set a localization, use that
        if ((req.query.lang == null) && (req.session != null) && (req.session.userid)) {
            var user = obj.users[req.session.userid];
            if ((user != null) && (user.lang != null)) { req.query.lang = user.lang; }
        };

        // Get a list of acceptable languages in order
        var acceptLanguages = [];
        if (req.query.lang != null) {
            acceptLanguages.push(req.query.lang.toLowerCase());
        } else {
            if (req.headers['accept-language'] != null) {
                var acceptLanguageSplit = req.headers['accept-language'].split(';');
                for (var i in acceptLanguageSplit) {
                    var acceptLanguageSplitEx = acceptLanguageSplit[i].split(',');
                    for (var j in acceptLanguageSplitEx) { if (acceptLanguageSplitEx[j].startsWith('q=') == false) { acceptLanguages.push(acceptLanguageSplitEx[j].toLowerCase()); } }
                }
            }
        }

        return acceptLanguages;
    }

    // Render a page using the proper language
    function render(req, res, filename, args, user) {
        if (obj.renderPages != null) {
            // Get the list of acceptable languages in order
            var acceptLanguages = obj.getLanguageCodes(req);

            // Take a look at the options we have for this file
            var fileOptions = obj.renderPages[obj.path.basename(filename)];
            if (fileOptions != null) {
                for (var i in acceptLanguages) {
                    if ((acceptLanguages[i] == 'en') || (acceptLanguages[i].startsWith('en-'))) {
                        // English requested
                        args.lang = 'en';
                        if (user && user.llang) { delete user.llang; obj.db.SetUser(user); } // Clear user 'last language' used if needed. Since English is the default, remove "last language".
                        break;
                    }
                    if (fileOptions[acceptLanguages[i]] != null) {
                        // Found a match. If the file no longer exists, default to English.
                        obj.fs.exists(fileOptions[acceptLanguages[i]] + '.handlebars', function (exists) {
                            if (exists) { args.lang = acceptLanguages[i]; res.render(fileOptions[acceptLanguages[i]], args); } else { args.lang = 'en'; res.render(filename, args); }
                        });
                        if (user && (user.llang != acceptLanguages[i])) { user.llang = acceptLanguages[i]; obj.db.SetUser(user); }  // Set user 'last language' used if needed.
                        return;
                    }
                }
            }
        }

        // No matches found, render the default English page.
        res.render(filename, args);
    }

    // Get the list of pages with different languages that can be rendered
    function getRenderList() {
        // Fetch default rendeing pages
        var translateFolder = null;
        if (obj.fs.existsSync('views/translations')) { translateFolder = 'views/translations'; }
        if (obj.fs.existsSync(obj.path.join(__dirname, 'views', 'translations'))) { translateFolder = obj.path.join(__dirname, 'views', 'translations'); }

        if (translateFolder != null) {
            obj.renderPages = {};
            obj.renderLanguages = ['en'];
            var files = obj.fs.readdirSync(translateFolder);
            for (var i in files) {
                var name = files[i];
                if (name.endsWith('.handlebars')) {
                    name = name.substring(0, name.length - 11);
                    var xname = name.split('_');
                    if (xname.length == 2) {
                        if (obj.renderPages[xname[0]] == null) { obj.renderPages[xname[0]] = {}; }
                        obj.renderPages[xname[0]][xname[1]] = obj.path.join(translateFolder, name);
                        if (obj.renderLanguages.indexOf(xname[1]) == -1) { obj.renderLanguages.push(xname[1]); }
                    }
                }
            }

            // See if there are any custom rending pages that will override the default ones
            if ((obj.parent.webViewsOverridePath != null) && (obj.fs.existsSync(obj.path.join(obj.parent.webViewsOverridePath, 'translations')))) {
                translateFolder = obj.path.join(obj.parent.webViewsOverridePath, 'translations');
                var files = obj.fs.readdirSync(translateFolder);
                for (var i in files) {
                    var name = files[i];
                    if (name.endsWith('.handlebars')) {
                        name = name.substring(0, name.length - 11);
                        var xname = name.split('_');
                        if (xname.length == 2) {
                            if (obj.renderPages[xname[0]] == null) { obj.renderPages[xname[0]] = {}; }
                            obj.renderPages[xname[0]][xname[1]] = obj.path.join(translateFolder, name);
                            if (obj.renderLanguages.indexOf(xname[1]) == -1) { obj.renderLanguages.push(xname[1]); }
                        }
                    }
                }
            }
        }
    }

    // Get the list of pages with different languages that can be rendered
    function getEmailLanguageList() {
        // Fetch default rendeing pages
        var translateFolder = null;
        if (obj.fs.existsSync('emails/translations')) { translateFolder = 'emails/translations'; }
        if (obj.fs.existsSync(obj.path.join(__dirname, 'emails', 'translations'))) { translateFolder = obj.path.join(__dirname, 'emails', 'translations'); }

        if (translateFolder != null) {
            obj.emailLanguages = ['en'];
            var files = obj.fs.readdirSync(translateFolder);
            for (var i in files) {
                var name = files[i];
                if (name.endsWith('.html')) {
                    name = name.substring(0, name.length - 5);
                    var xname = name.split('_');
                    if (xname.length == 2) {
                        if (obj.emailLanguages.indexOf(xname[1]) == -1) { obj.emailLanguages.push(xname[1]); }
                    }
                }
            }

            // See if there are any custom rending pages that will override the default ones
            if ((obj.parent.webEmailsOverridePath != null) && (obj.fs.existsSync(obj.path.join(obj.parent.webEmailsOverridePath, 'translations')))) {
                translateFolder = obj.path.join(obj.parent.webEmailsOverridePath, 'translations');
                var files = obj.fs.readdirSync(translateFolder);
                for (var i in files) {
                    var name = files[i];
                    if (name.endsWith('.html')) {
                        name = name.substring(0, name.length - 5);
                        var xname = name.split('_');
                        if (xname.length == 2) {
                            if (obj.emailLanguages.indexOf(xname[1]) == -1) { obj.emailLanguages.push(xname[1]); }
                        }
                    }
                }
            }
        }
    }

    // Perform a web push to a user
    // If any of the push fail, remove the subscription from the user's webpush subscription list.
    obj.performWebPush = function (domain, user, payload, options) {
        if ((parent.webpush == null) || (Array.isArray(user.webpush) == false) || (user.webpush.length == 0)) return;

        var completionFunc = function pushCompletionFunc(sub, fail) {
            pushCompletionFunc.failCount += fail;
            if (--pushCompletionFunc.pushCount == 0) {
                if (pushCompletionFunc.failCount > 0) {
                    var user = pushCompletionFunc.user, newwebpush = [];
                    for (var i in user.webpush) { if (user.webpush[i].fail == null) { newwebpush.push(user.webpush[i]); } }
                    user.webpush = newwebpush;

                    // Update the database
                    obj.db.SetUser(user);

                    // Event the change
                    var message = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
                    if (db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                    var targets = ['*', 'server-users', user._id];
                    if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
                    parent.DispatchEvent(targets, obj, message);
                }
            }
        }
        completionFunc.pushCount = user.webpush.length;
        completionFunc.user = user;
        completionFunc.domain = domain;
        completionFunc.failCount = 0;

        for (var i in user.webpush) {
            var errorFunc = function pushErrorFunc(error) { pushErrorFunc.sub.fail = 1; pushErrorFunc.call(pushErrorFunc.sub, 1); }
            errorFunc.sub = user.webpush[i];
            errorFunc.call = completionFunc;
            var successFunc = function pushSuccessFunc(value) { pushSuccessFunc.call(pushSuccessFunc.sub, 0); }
            successFunc.sub = user.webpush[i];
            successFunc.call = completionFunc;
            parent.webpush.sendNotification(user.webpush[i], JSON.stringify(payload), options).then(successFunc, errorFunc);
        }

    }

    // Insure exclusivity of a push messaging token for Android device
    obj.removePmtFromAllOtherNodes = function (node) {
        if (typeof node.pmt != 'string') return;
        db.Get('pmt_' + node.pmt, function (err, docs) {
            if ((err == null) && (docs.length == 1)) {
                var oldNodeId = docs[0].nodeid;
                db.Get(oldNodeId, function (nerr, ndocs) {
                    if ((nerr == null) && (ndocs.length == 1)) {
                        var oldNode = ndocs[0];
                        if (oldNode.pmt == node.pmt) {
                            // Remove the push messaging token and save the node.
                            delete oldNode.pmt;
                            db.Set(oldNode);

                            // Event the node change
                            var event = { etype: 'node', action: 'changenode', nodeid: oldNode._id, domain: oldNode.domain, node: obj.CloneSafeNode(oldNode) }
                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the mesh. Another event will come.
                            parent.DispatchEvent(['*', oldNode.meshid, oldNode._id], obj, event);
                        } 
                    }
                });
            }
            db.Set({ _id: 'pmt_' + node.pmt, type: 'pmt', domain: node.domain, time: Date.now(), nodeid: node._id })
        });
    }

    // Return true if a mobile browser is detected.
    // This code comes from "http://detectmobilebrowsers.com/" and was modified, This is free and unencumbered software released into the public domain. For more information, please refer to the http://unlicense.org/
    function isMobileBrowser(req) {
        //var ua = req.headers['user-agent'].toLowerCase();
        //return (/(android|bb\d+|meego).+mobile|mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(ua) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(ua.substr(0, 4)));
        if (typeof req.headers['user-agent'] != 'string') return false;
        return (req.headers['user-agent'].toLowerCase().indexOf('mobile') >= 0);
    }

    // Return decoded user agent information
    function getUserAgentInfo(req) {
        var browser = 'Unknown', os = 'Unknown';
        try {
            const ua = obj.uaparser(req.headers['user-agent']);
            if (ua.browser && ua.browser.name) { ua.browserStr = ua.browser.name; if (ua.browser.version) { ua.browserStr += '/' + ua.browser.version } }
            if (ua.os && ua.os.name) { ua.osStr = ua.os.name; if (ua.os.version) { ua.osStr += '/' + ua.os.version } }
            return ua;
        } catch (ex) { return { browserStr: browser, osStr: os } }
    }

    // Return the query string portion of the URL, the ? and anything after.
    function getQueryPortion(req) { var s = req.url.indexOf('?'); if (s == -1) { if (req.body && req.body.urlargs) { return req.body.urlargs; } return ''; } return req.url.substring(s); }

    // Generate a random Intel AMT password
    function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
    function getRandomAmtPassword() { var p; do { p = Buffer.from(obj.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }
    function getRandomPassword() { return Buffer.from(obj.crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); }
    function getRandomLowerCase(len) { var r = '', random = obj.crypto.randomBytes(len); for (var i = 0; i < len; i++) { r += String.fromCharCode(97 + (random[i] % 26)); } return r; }

    // Generate a 8 digit integer with even random probability for each value.
    function getRandomEightDigitInteger() { var bigInt; do { bigInt = parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 100000000; }
    function getRandomSixDigitInteger() { var bigInt; do { bigInt = parent.crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 1000000; }

    // Clean a IPv6 address that encodes a IPv4 address
    function cleanRemoteAddr(addr) { if (typeof addr != 'string') { return null; } if (addr.indexOf('::ffff:') == 0) { return addr.substring(7); } else { return addr; } }

    // Set the content disposition header for a HTTP response.
    // Because the filename can't have any special characters in it, we need to be extra careful.
    function setContentDispositionHeader(res, type, name, size, altname) {
        var name = require('path').basename(name).split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split('\'').join('');
        try {
            var x = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + encodeURIComponent(name) + '"' };
            if (typeof size == 'number') { x['Content-Length'] = size; }
            res.set(x);
        } catch (ex) {
            var x = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + altname + '"' };
            if (typeof size == 'number') { x['Content-Length'] = size; }
            res.set(x);
        }
    }

    // Record a new entry in a recording log
    function recordingEntry(fd, type, flags, data, func, tag) {
        try {
            if (typeof data == 'string') {
                // String write
                var blockData = Buffer.from(data), header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                header.writeInt16BE(flags, 2); // Flags (1 = Binary, 2 = User)
                header.writeInt32BE(blockData.length, 4); // Size
                header.writeIntBE(new Date(), 10, 6); // Time
                var block = Buffer.concat([header, blockData]);
                obj.fs.write(fd, block, 0, block.length, function () { func(fd, tag); });
            } else {
                // Binary write
                var header = Buffer.alloc(16); // Header: Type (2) + Flags (2) + Size(4) + Time(8)
                header.writeInt16BE(type, 0); // Type (1 = Header, 2 = Network Data)
                header.writeInt16BE(flags | 1, 2); // Flags (1 = Binary, 2 = User)
                header.writeInt32BE(data.length, 4); // Size
                header.writeIntBE(new Date(), 10, 6); // Time
                var block = Buffer.concat([header, data]);
                obj.fs.write(fd, block, 0, block.length, function () { func(fd, tag); });
            }
        } catch (ex) { console.log(ex); func(fd, tag); }
    }

    // Perform a IP match against a list
    function isIPMatch(ip, matchList) {
        const ipcheck = require('ipcheck');
        for (var i in matchList) { if (ipcheck.match(ip, matchList[i]) == true) return true; }
        return false;
    }

    // This is the invalid login throttling code
    obj.badLoginTable = {};
    obj.badLoginTableLastClean = 0;
    if (parent.config.settings == null) { parent.config.settings = {}; }
    if (parent.config.settings.maxinvalidlogin !== false) {
        if (typeof parent.config.settings.maxinvalidlogin != 'object') { parent.config.settings.maxinvalidlogin = { time: 10, count: 10 }; }
        if (typeof parent.config.settings.maxinvalidlogin.time != 'number') { parent.config.settings.maxinvalidlogin.time = 10; }
        if (typeof parent.config.settings.maxinvalidlogin.count != 'number') { parent.config.settings.maxinvalidlogin.count = 10; }
        if ((typeof parent.config.settings.maxinvalidlogin.coolofftime != 'number') || (parent.config.settings.maxinvalidlogin.coolofftime < 1)) { parent.config.settings.maxinvalidlogin.coolofftime = null; }
    }
    obj.setbadLogin = function (ip) { // Set an IP address that just did a bad login request
        if (parent.config.settings.maxinvalidlogin === false) return;
        if (typeof ip == 'object') { ip = ip.clientIp; }
        if (parent.config.settings.maxinvalidlogin != null) {
            if (typeof parent.config.settings.maxinvalidlogin.exclude == 'string') {
                const excludeSplit = parent.config.settings.maxinvalidlogin.exclude.split(',');
                for (var i in excludeSplit) { if (require('ipcheck').match(ip, excludeSplit[i])) return; }
            } else if (Array.isArray(parent.config.settings.maxinvalidlogin.exclude)) {
                for (var i in parent.config.settings.maxinvalidlogin.exclude) { if (require('ipcheck').match(ip, parent.config.settings.maxinvalidlogin.exclude[i])) return; }
            }
        }
        var splitip = ip.split('.');
        if (splitip.length == 4) { ip = (splitip[0] + '.' + splitip[1] + '.' + splitip[2] + '.*'); }
        if (++obj.badLoginTableLastClean > 100) { obj.cleanBadLoginTable(); }
        if (typeof obj.badLoginTable[ip] == 'number') { if (obj.badLoginTable[ip] < Date.now()) { delete obj.badLoginTable[ip]; } else { return; } }  // Check cooloff period
        if (obj.badLoginTable[ip] == null) { obj.badLoginTable[ip] = [Date.now()]; } else { obj.badLoginTable[ip].push(Date.now()); }
        if ((obj.badLoginTable[ip].length >= parent.config.settings.maxinvalidlogin.count) && (parent.config.settings.maxinvalidlogin.coolofftime != null)) {
            obj.badLoginTable[ip] = Date.now() + (parent.config.settings.maxinvalidlogin.coolofftime * 60000); // Move to cooloff period
        }
    }
    obj.checkAllowLogin = function (ip) { // Check if an IP address is allowed to login
        if (parent.config.settings.maxinvalidlogin === false) return true;
        if (typeof ip == 'object') { ip = ip.clientIp; }
        var splitip = ip.split('.');
        if (splitip.length == 4) { ip = (splitip[0] + '.' + splitip[1] + '.' + splitip[2] + '.*'); } // If this is IPv4, keep only the 3 first 
        var cutoffTime = Date.now() - (parent.config.settings.maxinvalidlogin.time * 60000); // Time in minutes
        var ipTable = obj.badLoginTable[ip];
        if (ipTable == null) return true;
        if (typeof ipTable == 'number') { if (obj.badLoginTable[ip] < Date.now()) { delete obj.badLoginTable[ip]; } else { return false; } } // Check cooloff period
        while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
        if (ipTable.length == 0) { delete obj.badLoginTable[ip]; return true; }
        return (ipTable.length < parent.config.settings.maxinvalidlogin.count); // No more than x bad logins in x minutes
    }
    obj.cleanBadLoginTable = function () { // Clean up the IP address login blockage table, we do this occasionaly.
        if (parent.config.settings.maxinvalidlogin === false) return;
        var cutoffTime = Date.now() - (parent.config.settings.maxinvalidlogin.time * 60000); // Time in minutes
        for (var ip in obj.badLoginTable) {
            var ipTable = obj.badLoginTable[ip];
            if (typeof ipTable == 'number') {
                if (obj.badLoginTable[ip] < Date.now()) { delete obj.badLoginTable[ip]; } // Check cooloff period
            } else {
                while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
                if (ipTable.length == 0) { delete obj.badLoginTable[ip]; }
            }
        }
        obj.badLoginTableLastClean = 0;
    }

    // This is the invalid 2FA throttling code
    obj.bad2faTable = {};
    obj.bad2faTableLastClean = 0;
    if (parent.config.settings == null) { parent.config.settings = {}; }
    if (parent.config.settings.maxinvalid2fa !== false) {
        if (typeof parent.config.settings.maxinvalid2fa != 'object') { parent.config.settings.maxinvalid2fa = { time: 10, count: 10 }; }
        if (typeof parent.config.settings.maxinvalid2fa.time != 'number') { parent.config.settings.maxinvalid2fa.time = 10; }
        if (typeof parent.config.settings.maxinvalid2fa.count != 'number') { parent.config.settings.maxinvalid2fa.count = 10; }
        if ((typeof parent.config.settings.maxinvalid2fa.coolofftime != 'number') || (parent.config.settings.maxinvalid2fa.coolofftime < 1)) { parent.config.settings.maxinvalid2fa.coolofftime = null; }
    }
    obj.setbad2Fa = function (ip) { // Set an IP address that just did a bad 2FA request
        if (parent.config.settings.maxinvalid2fa === false) return;
        if (typeof ip == 'object') { ip = ip.clientIp; }
        if (parent.config.settings.maxinvalid2fa != null) {
            if (typeof parent.config.settings.maxinvalid2fa.exclude == 'string') {
                const excludeSplit = parent.config.settings.maxinvalid2fa.exclude.split(',');
                for (var i in excludeSplit) { if (require('ipcheck').match(ip, excludeSplit[i])) return; }
            } else if (Array.isArray(parent.config.settings.maxinvalid2fa.exclude)) {
                for (var i in parent.config.settings.maxinvalid2fa.exclude) { if (require('ipcheck').match(ip, parent.config.settings.maxinvalid2fa.exclude[i])) return; }
            }
        }
        var splitip = ip.split('.');
        if (splitip.length == 4) { ip = (splitip[0] + '.' + splitip[1] + '.' + splitip[2] + '.*'); }
        if (++obj.bad2faTableLastClean > 100) { obj.cleanBad2faTable(); }
        if (typeof obj.bad2faTable[ip] == 'number') { if (obj.bad2faTable[ip] < Date.now()) { delete obj.bad2faTable[ip]; } else { return; } }  // Check cooloff period
        if (obj.bad2faTable[ip] == null) { obj.bad2faTable[ip] = [Date.now()]; } else { obj.bad2faTable[ip].push(Date.now()); }
        if ((obj.bad2faTable[ip].length >= parent.config.settings.maxinvalid2fa.count) && (parent.config.settings.maxinvalid2fa.coolofftime != null)) {
            obj.bad2faTable[ip] = Date.now() + (parent.config.settings.maxinvalid2fa.coolofftime * 60000); // Move to cooloff period
        }
    }
    obj.checkAllow2Fa = function (ip) { // Check if an IP address is allowed to perform 2FA
        if (parent.config.settings.maxinvalid2fa === false) return true;
        if (typeof ip == 'object') { ip = ip.clientIp; }
        var splitip = ip.split('.');
        if (splitip.length == 4) { ip = (splitip[0] + '.' + splitip[1] + '.' + splitip[2] + '.*'); } // If this is IPv4, keep only the 3 first 
        var cutoffTime = Date.now() - (parent.config.settings.maxinvalid2fa.time * 60000); // Time in minutes
        var ipTable = obj.bad2faTable[ip];
        if (ipTable == null) return true;
        if (typeof ipTable == 'number') { if (obj.bad2faTable[ip] < Date.now()) { delete obj.bad2faTable[ip]; } else { return false; } } // Check cooloff period
        while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
        if (ipTable.length == 0) { delete obj.bad2faTable[ip]; return true; }
        return (ipTable.length < parent.config.settings.maxinvalid2fa.count); // No more than x bad 2FAs in x minutes
    }
    obj.cleanBad2faTable = function () { // Clean up the IP address 2FA blockage table, we do this occasionaly.
        if (parent.config.settings.maxinvalid2fa === false) return;
        var cutoffTime = Date.now() - (parent.config.settings.maxinvalid2fa.time * 60000); // Time in minutes
        for (var ip in obj.bad2faTable) {
            var ipTable = obj.bad2faTable[ip];
            if (typeof ipTable == 'number') {
                if (obj.bad2faTable[ip] < Date.now()) { delete obj.bad2faTable[ip]; } // Check cooloff period
            } else {
                while ((ipTable.length > 0) && (ipTable[0] < cutoffTime)) { ipTable.shift(); }
                if (ipTable.length == 0) { delete obj.bad2faTable[ip]; }
            }
        }
        obj.bad2faTableLastClean = 0;
    }

    // Hold a websocket until additional arguments are provided within the socket.
    // This is a generic function that can be used for any websocket to avoid passing arguments in the URL.
    function getWebsocketArgs(ws, req, func) {
        if (req.query.moreargs != '1') {
            // No more arguments needed, pass the websocket thru
            func(ws, req);
        } else {
            // More arguments are needed
            delete req.query.moreargs;
            const xfunc = function getWebsocketArgsEx(msg) {
                var command = null;
                try { command = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
                if ((command != null) && (command.action === 'urlargs') && (typeof command.args == 'object')) {
                    for (var i in command.args) { getWebsocketArgsEx.req.query[i] = command.args[i]; }
                    ws.removeEventListener('message', getWebsocketArgsEx);
                    getWebsocketArgsEx.func(getWebsocketArgsEx.ws, getWebsocketArgsEx.req);
                }
            }
            xfunc.ws = ws;
            xfunc.req = req;
            xfunc.func = func;
            ws.on('message', xfunc);
        }
    }

    // Set a random value to this session. Only works if the session has a userid.
    // This random value along with the userid is used to destroy the session when logging out.
    function setSessionRandom(req) {
        if ((req.session == null) || (req.session.userid == null) || (req.session.x != null)) return;
        var x = obj.crypto.randomBytes(6).toString('base64');
        while (obj.destroyedSessions[req.session.userid + '/' + x] != null) { x = obj.crypto.randomBytes(6).toString('base64'); }
        req.session.x = x;
    }

    // Remove all destroyed sessions after 2 hours, these sessions would have timed out anyway.
    function clearDestroyedSessions() {
        var toRemove = [], t = Date.now() - (2 * 60 * 60 * 1000);
        for (var i in obj.destroyedSessions) { if (obj.destroyedSessions[i] < t) { toRemove.push(i); } }
        for (var i in toRemove) { delete obj.destroyedSessions[toRemove[i]]; }
    }

    // Check and/or convert the agent color value into a correct string or return empty string.
    function checkAgentColorString(header, value) {
        if ((typeof header !== 'string') || (typeof value !== 'string')) return '';
        if (value.startsWith('#') && (value.length == 7)) {
            // Convert color in hex format
            value = parseInt(value.substring(1, 3), 16) + ',' + parseInt(value.substring(3, 5), 16) + ',' + parseInt(value.substring(5, 7), 16);
        } else {
            // Check color in decimal format
            const valueSplit = value.split(',');
            if (valueSplit.length != 3) return '';
            const r = parseInt(valueSplit[0]), g = parseInt(valueSplit[1]), b = parseInt(valueSplit[2]);
            if (isNaN(r) || (r < 0) || (r > 255) || isNaN(g) || (g < 0) || (g > 255) || isNaN(b) || (b < 0) || (b > 255)) return '';
            value = r + ',' + g + ',' + b;
        }
        return header + value + '\r\n';
    }

    return obj;
};