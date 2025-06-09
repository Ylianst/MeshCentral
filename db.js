/** 
* @description MeshCentral database module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.2
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

//
// Construct Meshcentral database object
//
// The default database is NeDB
// https://github.com/louischatriot/nedb
//
// Alternativety, MongoDB can be used
// https://www.mongodb.com/
// Just run with --mongodb [connectionstring], where the connection string is documented here: https://docs.mongodb.com/manual/reference/connection-string/
// The default collection is "meshcentral", but you can override it using --mongodbcol [collection]
//
module.exports.CreateDB = function (parent, func) {
    var obj = {};
    var Datastore = null;
    var expireEventsSeconds = (60 * 60 * 24 * 20);              // By default, expire events after 20 days (1728000). (Seconds * Minutes * Hours * Days)
    var expirePowerEventsSeconds = (60 * 60 * 24 * 10);         // By default, expire power events after 10 days (864000). (Seconds * Minutes * Hours * Days)
    var expireServerStatsSeconds = (60 * 60 * 24 * 30);         // By default, expire server stats after 30 days (2592000). (Seconds * Minutes * Hours * Days)
    const common = require('./common.js');
    const path = require('path');
    const fs = require('fs');
    const DB_NEDB = 1, DB_MONGOJS = 2, DB_MONGODB = 3,DB_MARIADB = 4, DB_MYSQL = 5, DB_POSTGRESQL = 6, DB_ACEBASE = 7, DB_SQLITE = 8;
    const DB_LIST = ['None', 'NeDB', 'MongoJS', 'MongoDB', 'MariaDB', 'MySQL', 'PostgreSQL', 'AceBase', 'SQLite'];  //for the info command
    let databaseName = 'meshcentral';
    let datapathParentPath = path.dirname(parent.datapath);
    let datapathFoldername = path.basename(parent.datapath);
    const SQLITE_AUTOVACUUM = ['none', 'full', 'incremental'];
    const SQLITE_SYNCHRONOUS = ['off', 'normal', 'full', 'extra'];
    obj.sqliteConfig = {
        maintenance: '',
        startupVacuum: false,
        autoVacuum: 'full',
        incrementalVacuum: 100,
        journalMode: 'delete',
        journalSize: 4096000,
        synchronous: 'full',
    };
    obj.performingBackup = false;
    const BACKUPFAIL_ZIPCREATE = 0x0001;
    const BACKUPFAIL_ZIPMODULE = 0x0010;
    const BACKUPFAIL_DBDUMP = 0x0100;
    obj.backupStatus = 0x0;
    obj.newAutoBackupFile = null;
    obj.newDBDumpFile = null;
    obj.identifier = null;
    obj.dbKey = null;
    obj.dbRecordsEncryptKey = null;
    obj.dbRecordsDecryptKey = null;
    obj.changeStream = false;
    obj.pluginsActive = ((parent.config) && (parent.config.settings) && (parent.config.settings.plugins != null) && (parent.config.settings.plugins != false) && ((typeof parent.config.settings.plugins != 'object') || (parent.config.settings.plugins.enabled != false)));
    obj.dbCounters = {
        fileSet: 0,
        fileRemove: 0,
        powerSet: 0,
        eventsSet: 0
    }

    // MongoDB bulk operations state
    if (parent.config.settings.mongodbbulkoperations) {
        // Added counters
        obj.dbCounters.fileSetPending = 0;
        obj.dbCounters.fileSetBulk = 0;
        obj.dbCounters.fileRemovePending = 0;
        obj.dbCounters.fileRemoveBulk = 0;
        obj.dbCounters.powerSetPending = 0;
        obj.dbCounters.powerSetBulk = 0;
        obj.dbCounters.eventsSetPending = 0;
        obj.dbCounters.eventsSetBulk = 0;

        /// Added bulk accumulators
        obj.filePendingGet = null;
        obj.filePendingGets = null;
        obj.filePendingRemove = null;
        obj.filePendingRemoves = null;
        obj.filePendingSet = false;
        obj.filePendingSets = null;
        obj.filePendingCb = null;
        obj.filePendingCbs = null;
        obj.powerFilePendingSet = false;
        obj.powerFilePendingSets = null;
        obj.powerFilePendingCb = null;
        obj.powerFilePendingCbs = null;
        obj.eventsFilePendingSet = false;
        obj.eventsFilePendingSets = null;
        obj.eventsFilePendingCb = null;
        obj.eventsFilePendingCbs = null;
    }

    obj.SetupDatabase = function (func) {
        // Check if the database unique identifier is present
        // This is used to check that in server peering mode, everyone is using the same database.
        obj.Get('DatabaseIdentifier', function (err, docs) {
            if (err != null) { parent.debug('db', 'ERROR (Get DatabaseIdentifier): ' + err); }
            if ((err == null) && (docs.length == 1) && (docs[0].value != null)) {
                obj.identifier = docs[0].value;
            } else {
                obj.identifier = Buffer.from(require('crypto').randomBytes(48), 'binary').toString('hex');
                obj.Set({ _id: 'DatabaseIdentifier', value: obj.identifier });
            }
        });

        // Load database schema version and check if we need to update
        obj.Get('SchemaVersion', function (err, docs) {
            if (err != null) { parent.debug('db', 'ERROR (Get SchemaVersion): ' + err); }
            var ver = 0;
            if ((err == null) && (docs.length == 1)) { ver = docs[0].value; }
            if (ver == 1) { console.log('This is an unsupported beta 1 database, delete it to create a new one.'); process.exit(0); }

            // TODO: Any schema upgrades here...
            obj.Set({ _id: 'SchemaVersion', value: 2 });

            func(ver);
        });
    };

    // Perform database maintenance
    obj.maintenance = function () {
        parent.debug('db', 'Entering database maintenance');
        if (obj.databaseType == DB_NEDB) { // NeDB will not remove expired records unless we try to access them. This will force the removal.
            obj.eventsfile.remove({ time: { '$lt': new Date(Date.now() - (expireEventsSeconds * 1000)) } }, { multi: true }); // Force delete older events
            obj.powerfile.remove({ time: { '$lt': new Date(Date.now() - (expirePowerEventsSeconds * 1000)) } }, { multi: true }); // Force delete older events
            obj.serverstatsfile.remove({ time: { '$lt': new Date(Date.now() - (expireServerStatsSeconds * 1000)) } }, { multi: true }); // Force delete older events
        } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL)) { // MariaDB or MySQL
            sqlDbQuery('DELETE FROM events WHERE time < ?', [new Date(Date.now() - (expireEventsSeconds * 1000))], function (doc, err) { }); // Delete events older than expireEventsSeconds
            sqlDbQuery('DELETE FROM power WHERE time < ?', [new Date(Date.now() - (expirePowerEventsSeconds * 1000))], function (doc, err) { }); // Delete events older than expirePowerSeconds
            sqlDbQuery('DELETE FROM serverstats WHERE expire < ?', [new Date()], function (doc, err) { }); // Delete events where expiration date is in the past
            sqlDbQuery('DELETE FROM smbios WHERE expire < ?', [new Date()], function (doc, err) { }); // Delete events where expiration date is in the past
        } else if (obj.databaseType == DB_ACEBASE) { // AceBase
            //console.log('Performing AceBase maintenance');
            obj.file.query('events').filter('time', '<', new Date(Date.now() - (expireEventsSeconds * 1000))).remove().then(function () {
                obj.file.query('stats').filter('time', '<', new Date(Date.now() - (expireServerStatsSeconds * 1000))).remove().then(function () {
                    obj.file.query('power').filter('time', '<', new Date(Date.now() - (expirePowerEventsSeconds * 1000))).remove().then(function () {
                        //console.log('AceBase maintenance done');
                    });
                });
            });
        } else if (obj.databaseType == DB_SQLITE) { // SQLite3
            //sqlite does not return rows affected for INSERT, UPDATE or DELETE statements, see https://www.sqlite.org/pragma.html#pragma_count_changes
            obj.file.serialize(function () {
                obj.file.run('DELETE FROM events WHERE time < ?', [new Date(Date.now() - (expireEventsSeconds * 1000))]); 
                obj.file.run('DELETE FROM power WHERE time < ?', [new Date(Date.now() - (expirePowerEventsSeconds * 1000))]);
                obj.file.run('DELETE FROM serverstats WHERE expire < ?', [new Date()]);
                obj.file.run('DELETE FROM smbios WHERE expire < ?', [new Date()]);
                obj.file.exec(obj.sqliteConfig.maintenance, function (err) {
                    if (err) {console.log('Maintenance error: ' + err.message)};
                    if (parent.config.settings.debug) {
                        sqliteGetPragmas(['freelist_count', 'page_size', 'page_count', 'cache_size' ], function (pragma, pragmaValue) {
                            parent.debug('db', 'SQLite Maintenance: ' + pragma + '=' + pragmaValue);
                        });
                    };
                });
            });
        }
        obj.removeInactiveDevices();
    }

    // Remove inactive devices
    obj.removeInactiveDevices = function (showall, cb) {
        // Get a list of domains and what their inactive device removal setting is
        var removeInactiveDevicesPerDomain = {}, minRemoveInactiveDevicesPerDomain = {}, minRemoveInactiveDevice = 9999;
        for (var i in parent.config.domains) {
            if (typeof parent.config.domains[i].autoremoveinactivedevices == 'number') {
                var v = parent.config.domains[i].autoremoveinactivedevices;
                if ((v >= 1) && (v <= 2000)) {
                    if (v < minRemoveInactiveDevice) { minRemoveInactiveDevice = v; }
                    removeInactiveDevicesPerDomain[i] = v;
                    minRemoveInactiveDevicesPerDomain[i] = v;
                }
            }
        }

        // Check if any device groups have a inactive device removal setting
        for (var i in parent.webserver.meshes) {
            if (typeof parent.webserver.meshes[i].expireDevs == 'number') {
                var v = parent.webserver.meshes[i].expireDevs;
                if ((v >= 1) && (v <= 2000)) {
                    if (v < minRemoveInactiveDevice) { minRemoveInactiveDevice = v; }
                    if ((minRemoveInactiveDevicesPerDomain[parent.webserver.meshes[i].domain] == null) || (minRemoveInactiveDevicesPerDomain[parent.webserver.meshes[i].domain] > v)) {
                        minRemoveInactiveDevicesPerDomain[parent.webserver.meshes[i].domain] = v;
                    }
                } else {
                    delete parent.webserver.meshes[i].expireDevs;
                }
            }
        }

        // If there are no such settings for any domain, we can exit now.
        if (minRemoveInactiveDevice == 9999) { if (cb) { cb("No device removal policy set, nothing to do."); } return; }
        const now = Date.now();

        // For each domain with a inactive device removal setting, get a list of last device connections
        for (var domainid in minRemoveInactiveDevicesPerDomain) {
            obj.GetAllTypeNoTypeField('lastconnect', domainid, function (err, docs) {
                if ((err != null) || (docs == null)) return;
                for (var j in docs) {
                    const days = Math.floor((now - docs[j].time) / 86400000); // Calculate the number of inactive days
                    var expireDays = -1;
                    if (removeInactiveDevicesPerDomain[docs[j].domain]) { expireDays = removeInactiveDevicesPerDomain[docs[j].domain]; }
                    const mesh = parent.webserver.meshes[docs[j].meshid];
                    if (mesh && (typeof mesh.expireDevs == 'number')) { expireDays = mesh.expireDevs; }
                    var remove = false;
                    if (expireDays > 0) {
                        if (expireDays < days) { remove = true; }
                        if (cb) { if (showall || remove) { cb(docs[j]._id.substring(2) + ', ' + days + ' days, expire ' + expireDays + ' days' + (remove ? ', removing' : '')); } }
                        if (remove) {
                            // Check if this device is connected right now
                            const nodeid = docs[j]._id.substring(2);
                            const conn = parent.GetConnectivityState(nodeid);
                            if (conn == null) {
                                // Remove the device
                                obj.Get(nodeid, function (err, docs) {
                                    if (err != null) return;
                                    if ((docs == null) || (docs.length != 1)) { obj.Remove('lc' + nodeid); return; } // Remove last connect time
                                    const node = docs[0];

                                    // Delete this node including network interface information, events and timeline
                                    obj.Remove(node._id);                                 // Remove node with that id
                                    obj.Remove('if' + node._id);                          // Remove interface information
                                    obj.Remove('nt' + node._id);                          // Remove notes
                                    obj.Remove('lc' + node._id);                          // Remove last connect time
                                    obj.Remove('si' + node._id);                          // Remove system information
                                    obj.Remove('al' + node._id);                          // Remove error log last time
                                    if (obj.RemoveSMBIOS) { obj.RemoveSMBIOS(node._id); } // Remove SMBios data
                                    obj.RemoveAllNodeEvents(node._id);                    // Remove all events for this node
                                    obj.removeAllPowerEventsForNode(node._id);            // Remove all power events for this node
                                    if (typeof node.pmt == 'string') { obj.Remove('pmt_' + node.pmt); } // Remove Push Messaging Token
                                    obj.Get('ra' + node._id, function (err, nodes) {
                                        if ((nodes != null) && (nodes.length == 1)) { obj.Remove('da' + nodes[0].daid); } // Remove diagnostic agent to real agent link
                                        obj.Remove('ra' + node._id); // Remove real agent to diagnostic agent link
                                    });

                                    // Remove any user node links
                                    if (node.links != null) {
                                        for (var i in node.links) {
                                            if (i.startsWith('user/')) {
                                                var cuser = parent.webserver.users[i];
                                                if ((cuser != null) && (cuser.links != null) && (cuser.links[node._id] != null)) {
                                                    // Remove the user link & save the user
                                                    delete cuser.links[node._id];
                                                    if (Object.keys(cuser.links).length == 0) { delete cuser.links; }
                                                    obj.SetUser(cuser);

                                                    // Notify user change
                                                    var targets = ['*', 'server-users', cuser._id];
                                                    var event = { etype: 'user', userid: cuser._id, username: cuser.name, action: 'accountchange', msgid: 86, msgArgs: [cuser.name], msg: 'Removed user device rights for ' + cuser.name, domain: node.domain, account: parent.webserver.CloneSafeUser(cuser) };
                                                    if (obj.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                                                    parent.DispatchEvent(targets, obj, event);
                                                }
                                            }
                                        }
                                    }

                                    // Event node deletion
                                    var meshname = '(unknown)';
                                    if ((parent.webserver.meshes[node.meshid] != null) && (parent.webserver.meshes[node.meshid].name != null)) { meshname = parent.webserver.meshes[node.meshid].name; }
                                    var event = { etype: 'node', action: 'removenode', nodeid: node._id, msgid: 87, msgArgs: [node.name, meshname], msg: 'Removed device ' + node.name + ' from device group ' + meshname, domain: node.domain };
                                    // TODO: We can't use the changeStream for node delete because we will not know the meshid the device was in.
                                    //if (obj.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to remove the node. Another event will come.
                                    parent.DispatchEvent(parent.webserver.CreateNodeDispatchTargets(node.meshid, node._id), obj, event);
                                });
                            }
                        }
                    }
                }
            });
        }
    }

    // Remove all reference to a domain from the database
    obj.removeDomain = function (domainName, func) {
        var pendingCalls;
        // Remove all events, power events and SMBIOS data from the main collection. They are all in seperate collections now.
        if (obj.databaseType == DB_ACEBASE) {
            // AceBase
            pendingCalls = 3;
            obj.file.query('meshcentral').filter('domain', '==', domainName).remove().then(function () { if (--pendingCalls == 0) { func(); } });
            obj.file.query('events').filter('domain', '==', domainName).remove().then(function () { if (--pendingCalls == 0) { func(); } });
            obj.file.query('power').filter('domain', '==', domainName).remove().then(function () { if (--pendingCalls == 0) { func(); } });
        } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL) || (obj.databaseType == DB_POSTGRESQL)) {
            // MariaDB, MySQL or PostgreSQL
            pendingCalls = 2;
            sqlDbQuery('DELETE FROM main WHERE domain = $1', [domainName], function () { if (--pendingCalls == 0) { func(); } });
            sqlDbQuery('DELETE FROM events WHERE domain = $1', [domainName], function () { if (--pendingCalls == 0) { func(); } });
        } else if (obj.databaseType == DB_MONGODB) {
            // MongoDB
            pendingCalls = 3;
            obj.file.deleteMany({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
            obj.eventsfile.deleteMany({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
            obj.powerfile.deleteMany({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
        } else {
            // NeDB or MongoJS
            pendingCalls = 3;
            obj.file.remove({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
            obj.eventsfile.remove({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
            obj.powerfile.remove({ domain: domainName }, { multi: true }, function () { if (--pendingCalls == 0) { func(); } });
        }
    }

    obj.cleanup = function (func) {
        // TODO: Remove all mesh links to invalid users
        // TODO: Remove all meshes that dont have any links

        // Remove all events, power events and SMBIOS data from the main collection. They are all in seperate collections now.
        if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL) || (obj.databaseType == DB_POSTGRESQL)) {
            // MariaDB, MySQL or PostgreSQL
            obj.RemoveAllOfType('event', function () { });
            obj.RemoveAllOfType('power', function () { });
            obj.RemoveAllOfType('smbios', function () { });
        } else if (obj.databaseType == DB_MONGODB) {
            // MongoDB
            obj.file.deleteMany({ type: 'event' }, { multi: true });
            obj.file.deleteMany({ type: 'power' }, { multi: true });
            obj.file.deleteMany({ type: 'smbios' }, { multi: true });
        } else if ((obj.databaseType == DB_NEDB) || (obj.databaseType == DB_MONGOJS)) {
            // NeDB or MongoJS
            obj.file.remove({ type: 'event' }, { multi: true });
            obj.file.remove({ type: 'power' }, { multi: true });
            obj.file.remove({ type: 'smbios' }, { multi: true });
        }

        // List of valid identifiers
        var validIdentifiers = {}

        // Load all user groups
        obj.GetAllType('ugrp', function (err, docs) {
            if (err != null) { parent.debug('db', 'ERROR (GetAll user): ' + err); }
            if ((err == null) && (docs.length > 0)) {
                for (var i in docs) {
                    // Add this as a valid user identifier
                    validIdentifiers[docs[i]._id] = 1;
                }
            }

            // Fix all of the creating & login to ticks by seconds, not milliseconds.
            obj.GetAllType('user', function (err, docs) {
                if (err != null) { parent.debug('db', 'ERROR (GetAll user): ' + err); }
                if ((err == null) && (docs.length > 0)) {
                    for (var i in docs) {
                        var fixed = false;

                        // Add this as a valid user identifier
                        validIdentifiers[docs[i]._id] = 1;

                        // Fix email address capitalization
                        if (docs[i].email && (docs[i].email != docs[i].email.toLowerCase())) {
                            docs[i].email = docs[i].email.toLowerCase(); fixed = true;
                        }

                        // Fix account creation
                        if (docs[i].creation) {
                            if (docs[i].creation > 1300000000000) { docs[i].creation = Math.floor(docs[i].creation / 1000); fixed = true; }
                            if ((docs[i].creation % 1) != 0) { docs[i].creation = Math.floor(docs[i].creation); fixed = true; }
                        }

                        // Fix last account login
                        if (docs[i].login) {
                            if (docs[i].login > 1300000000000) { docs[i].login = Math.floor(docs[i].login / 1000); fixed = true; }
                            if ((docs[i].login % 1) != 0) { docs[i].login = Math.floor(docs[i].login); fixed = true; }
                        }

                        // Fix last password change
                        if (docs[i].passchange) {
                            if (docs[i].passchange > 1300000000000) { docs[i].passchange = Math.floor(docs[i].passchange / 1000); fixed = true; }
                            if ((docs[i].passchange % 1) != 0) { docs[i].passchange = Math.floor(docs[i].passchange); fixed = true; }
                        }

                        // Fix subscriptions
                        if (docs[i].subscriptions != null) { delete docs[i].subscriptions; fixed = true; }

                        // Save the user if needed
                        if (fixed) { obj.Set(docs[i]); }
                    }

                    // Remove all objects that have a "meshid" that no longer points to a valid mesh.
                    // Fix any incorrectly escaped user identifiers
                    obj.GetAllType('mesh', function (err, docs) {
                        if (err != null) { parent.debug('db', 'ERROR (GetAll mesh): ' + err); }
                        var meshlist = [];
                        if ((err == null) && (docs.length > 0)) {
                            for (var i in docs) {
                                var meshChange = false;
                                docs[i] = common.unEscapeLinksFieldName(docs[i]);
                                meshlist.push(docs[i]._id);

                                // Make sure all mesh types are number type, if not, fix it.
                                if (typeof docs[i].mtype == 'string') { docs[i].mtype = parseInt(docs[i].mtype); meshChange = true; }

                                // If the device group is deleted, remove any invite codes
                                if (docs[i].deleted && docs[i].invite) { delete docs[i].invite; meshChange = true; }

                                // Take a look at the links
                                if (docs[i].links != null) {
                                    for (var j in docs[i].links) {
                                        if (validIdentifiers[j] == null) {
                                            // This identifier is not known, let see if we can fix it.
                                            var xid = j, xid2 = common.unEscapeFieldName(xid);
                                            while ((xid != xid2) && (validIdentifiers[xid2] == null)) { xid = xid2; xid2 = common.unEscapeFieldName(xid2); }
                                            if (validIdentifiers[xid2] == 1) {
                                                //console.log('Fixing id: ' + j + ' to ' + xid2);
                                                docs[i].links[xid2] = docs[i].links[j];
                                                delete docs[i].links[j];
                                                meshChange = true;
                                            } else {
                                                // TODO: here, we may want to clean up links to users and user groups that do not exist anymore.
                                                //console.log('Unknown id: ' + j);
                                            }
                                        }
                                    }
                                }

                                // Save the updated device group if needed
                                if (meshChange) { obj.Set(docs[i]); }
                            }
                        }
                        if (obj.databaseType == DB_SQLITE) {
                            // SQLite

                        } else if (obj.databaseType == DB_ACEBASE) {
                            // AceBase

                        } else if (obj.databaseType == DB_POSTGRESQL) {
                            // Postgres
                            sqlDbQuery('DELETE FROM Main WHERE ((extra != NULL) AND (extra LIKE (\'mesh/%\')) AND (extra != ANY ($1)))', [meshlist], function (err, response) { });
                        } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL)) {
                            // MariaDB
                            sqlDbQuery('DELETE FROM Main WHERE (extra LIKE ("mesh/%") AND (extra NOT IN ?)', [meshlist], function (err, response) { });
                        } else if (obj.databaseType == DB_MONGODB) {
                            // MongoDB
                            obj.file.deleteMany({ meshid: { $exists: true, $nin: meshlist } }, { multi: true });
                        } else {
                            // NeDB or MongoJS
                            obj.file.remove({ meshid: { $exists: true, $nin: meshlist } }, { multi: true });
                        }

                        // We are done
                        validIdentifiers = null;
                        if (func) { func(); }
                    });
                }
            });
        });
    };

    // Get encryption key
    obj.getEncryptDataKey = function (password, salt, iterations) {
        if (typeof password != 'string') return null;
        let key;
        try {
            key = parent.crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha384');
        } catch (ex) {
            // If this previous call fails, it's probably because older pbkdf2 did not specify the hashing function, just use the default.
            key = parent.crypto.pbkdf2Sync(password, salt, iterations, 32);
        }
        return key
    }

    // Encrypt data 
    obj.encryptData = function (password, plaintext) {
        let encryptionVersion = 0x01;
        let iterations = 100000
        const iv = parent.crypto.randomBytes(16);
        var key = obj.getEncryptDataKey(password, iv, iterations);
        if (key == null) return null;
        const aes = parent.crypto.createCipheriv('aes-256-gcm', key, iv);
        var ciphertext = aes.update(plaintext);
        let versionbuf = Buffer.allocUnsafe(2);
        versionbuf.writeUInt16BE(encryptionVersion);
        let iterbuf = Buffer.allocUnsafe(4);
        iterbuf.writeUInt32BE(iterations);
        let encryptedBuf = aes.final();
        ciphertext = Buffer.concat([versionbuf, iterbuf, aes.getAuthTag(), iv, ciphertext, encryptedBuf]);
        return ciphertext.toString('base64');
    }

    // Decrypt data 
    obj.decryptData = function (password, ciphertext) {
        // Adding an encryption version lets us avoid try catching in the future
        let ciphertextBytes = Buffer.from(ciphertext, 'base64');
        let encryptionVersion = ciphertextBytes.readUInt16BE(0);
        try {
            switch (encryptionVersion) {
                case 0x01:
                    let iterations = ciphertextBytes.readUInt32BE(2);
                    let authTag = ciphertextBytes.slice(6, 22);
                    const iv = ciphertextBytes.slice(22, 38);
                    const data = ciphertextBytes.slice(38);
                    let key = obj.getEncryptDataKey(password, iv, iterations);
                    if (key == null) return null;
                    const aes = parent.crypto.createDecipheriv('aes-256-gcm', key, iv);
                    aes.setAuthTag(authTag);
                    let plaintextBytes = Buffer.from(aes.update(data));
                    plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
                    return plaintextBytes;
                default:
                    return obj.oldDecryptData(password, ciphertextBytes);
            }
        } catch (ex) { return obj.oldDecryptData(password, ciphertextBytes); }
    }

    // Encrypt data 
    // The older encryption system uses CBC without integraty checking.
    // This method is kept only for testing
    obj.oldEncryptData = function (password, plaintext) {
        let key = parent.crypto.createHash('sha384').update(password).digest('raw').slice(0, 32);
        if (key == null) return null;
        const iv = parent.crypto.randomBytes(16);
        const aes = parent.crypto.createCipheriv('aes-256-cbc', key, iv);
        var ciphertext = aes.update(plaintext);
        ciphertext = Buffer.concat([iv, ciphertext, aes.final()]);
        return ciphertext.toString('base64');
    }

    // Decrypt data
    // The older encryption system uses CBC without integraty checking.
    // This method is kept only to convert the old encryption to the new one.
    obj.oldDecryptData = function (password, ciphertextBytes) {
        if (typeof password != 'string') return null;
        try {
            const iv = ciphertextBytes.slice(0, 16);
            const data = ciphertextBytes.slice(16);
            let key = parent.crypto.createHash('sha384').update(password).digest('raw').slice(0, 32);
            const aes = parent.crypto.createDecipheriv('aes-256-cbc', key, iv);
            let plaintextBytes = Buffer.from(aes.update(data));
            plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
            return plaintextBytes;
        } catch (ex) { return null; }
    }

    // Get the number of records in the database for various types, this is the slow NeDB way.
    // WARNING: This is a terrible query for database performance. Only do this when needed. This query will look at almost every document in the database.
    obj.getStats = function (func) {
        if (obj.databaseType == DB_ACEBASE) {
            // AceBase
            // TODO
        } else if (obj.databaseType == DB_POSTGRESQL) {
            // PostgreSQL
            // TODO
        } else if (obj.databaseType == DB_MYSQL) {
            // MySQL
            // TODO
        } else if (obj.databaseType == DB_MARIADB) {
            // MariaDB
            // TODO
        } else if (obj.databaseType == DB_MONGODB) {
            // MongoDB
            obj.file.aggregate([{ "$group": { _id: "$type", count: { $sum: 1 } } }]).toArray(function (err, docs) {
                var counters = {}, totalCount = 0;
                if (err == null) { for (var i in docs) { if (docs[i]._id != null) { counters[docs[i]._id] = docs[i].count; totalCount += docs[i].count; } } }
                func(counters);
            });
        } else if (obj.databaseType == DB_MONGOJS) {
            // MongoJS
            obj.file.aggregate([{ "$group": { _id: "$type", count: { $sum: 1 } } }], function (err, docs) {
                var counters = {}, totalCount = 0;
                if (err == null) { for (var i in docs) { if (docs[i]._id != null) { counters[docs[i]._id] = docs[i].count; totalCount += docs[i].count; } } }
                func(counters);
            });
        } else if (obj.databaseType == DB_NEDB) {
            // NeDB version
            obj.file.count({ type: 'node' }, function (err, nodeCount) {
                obj.file.count({ type: 'mesh' }, function (err, meshCount) {
                    obj.file.count({ type: 'user' }, function (err, userCount) {
                        obj.file.count({ type: 'sysinfo' }, function (err, sysinfoCount) {
                            obj.file.count({ type: 'note' }, function (err, noteCount) {
                                obj.file.count({ type: 'iploc' }, function (err, iplocCount) {
                                    obj.file.count({ type: 'ifinfo' }, function (err, ifinfoCount) {
                                        obj.file.count({ type: 'cfile' }, function (err, cfileCount) {
                                            obj.file.count({ type: 'lastconnect' }, function (err, lastconnectCount) {
                                                obj.file.count({}, function (err, totalCount) {
                                                    func({ node: nodeCount, mesh: meshCount, user: userCount, sysinfo: sysinfoCount, iploc: iplocCount, note: noteCount, ifinfo: ifinfoCount, cfile: cfileCount, lastconnect: lastconnectCount, total: totalCount });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        }
    }

    // This is used to rate limit a number of operation per day. Returns a startValue each new days, but you can substract it and save the value in the db.
    obj.getValueOfTheDay = function (id, startValue, func) { obj.Get(id, function (err, docs) { var date = new Date(), t = date.toLocaleDateString(); if ((err == null) && (docs.length == 1)) { var r = docs[0]; if (r.day == t) { func({ _id: id, value: r.value, day: t }); return; } } func({ _id: id, value: startValue, day: t }); }); };
    obj.escapeBase64 = function escapeBase64(val) { return (val.replace(/\+/g, '@').replace(/\//g, '$')); }

    // Encrypt an database object
    obj.performRecordEncryptionRecode = function (func) {
        var count = 0;
        obj.GetAllType('user', function (err, docs) {
            if (err != null) { parent.debug('db', 'ERROR (performRecordEncryptionRecode): ' + err); }
            if (err == null) { for (var i in docs) { count++; obj.Set(docs[i]); } }
            obj.GetAllType('node', function (err, docs) {
                if (err == null) { for (var i in docs) { count++; obj.Set(docs[i]); } }
                obj.GetAllType('mesh', function (err, docs) {
                    if (err == null) { for (var i in docs) { count++; obj.Set(docs[i]); } }
                    if (obj.databaseType == DB_NEDB) { // If we are using NeDB, compact the database.
                        obj.file.compactDatafile();
                        obj.file.on('compaction.done', function () { func(count); }); // It's important to wait for compaction to finish before exit, otherwise NeDB may corrupt.
                    } else {
                        func(count); // For all other databases, normal exit.
                    }
                });
            });
        });
    }

    // Encrypt an database object
    function performTypedRecordDecrypt(data) {
        if ((data == null) || (obj.dbRecordsDecryptKey == null) || (typeof data != 'object')) return data;
        for (var i in data) {
            if ((data[i] == null) || (typeof data[i] != 'object')) continue;
            data[i] = performPartialRecordDecrypt(data[i]);
            if ((data[i].intelamt != null) && (typeof data[i].intelamt == 'object') && (data[i].intelamt._CRYPT)) { data[i].intelamt = performPartialRecordDecrypt(data[i].intelamt); }
            if ((data[i].amt != null) && (typeof data[i].amt == 'object') && (data[i].amt._CRYPT)) { data[i].amt = performPartialRecordDecrypt(data[i].amt); }
            if ((data[i].kvm != null) && (typeof data[i].kvm == 'object') && (data[i].kvm._CRYPT)) { data[i].kvm = performPartialRecordDecrypt(data[i].kvm); }
        }
        return data;
    }

    // Encrypt an database object
    function performTypedRecordEncrypt(data) {
        if (obj.dbRecordsEncryptKey == null) return data;
        if (data.type == 'user') { return performPartialRecordEncrypt(Clone(data), ['otpkeys', 'otphkeys', 'otpsecret', 'salt', 'hash', 'oldpasswords']); }
        else if ((data.type == 'node') && (data.ssh || data.rdp || data.intelamt)) {
            var xdata = Clone(data);
            if (data.ssh || data.rdp) { xdata = performPartialRecordEncrypt(xdata, ['ssh', 'rdp']); }
            if (data.intelamt) { xdata.intelamt = performPartialRecordEncrypt(xdata.intelamt, ['pass', 'mpspass']); }
            return xdata;
        }
        else if ((data.type == 'mesh') && (data.amt || data.kvm)) {
            var xdata = Clone(data);
            if (data.amt) { xdata.amt = performPartialRecordEncrypt(xdata.amt, ['password']); }
            if (data.kvm) { xdata.kvm = performPartialRecordEncrypt(xdata.kvm, ['pass']); }
            return xdata;
        }
        return data;
    }

    // Encrypt an object and return a buffer.
    function performPartialRecordEncrypt(plainobj, encryptNames) {
        if (typeof plainobj != 'object') return plainobj;
        var enc = {}, enclen = 0;
        for (var i in encryptNames) { if (plainobj[encryptNames[i]] != null) { enclen++; enc[encryptNames[i]] = plainobj[encryptNames[i]]; delete plainobj[encryptNames[i]]; } }
        if (enclen > 0) { plainobj._CRYPT = performRecordEncrypt(enc); } else { delete plainobj._CRYPT; }
        return plainobj;
    }

    // Encrypt an object and return a buffer.
    function performPartialRecordDecrypt(plainobj) {
        if ((typeof plainobj != 'object') || (plainobj._CRYPT == null)) return plainobj;
        var enc = performRecordDecrypt(plainobj._CRYPT);
        if (enc != null) { for (var i in enc) { plainobj[i] = enc[i]; } }
        delete plainobj._CRYPT;
        return plainobj;
    }

    // Encrypt an object and return a base64.
    function performRecordEncrypt(plainobj) {
        if (obj.dbRecordsEncryptKey == null) return null;
        const iv = parent.crypto.randomBytes(12);
        const aes = parent.crypto.createCipheriv('aes-256-gcm', obj.dbRecordsEncryptKey, iv);
        var ciphertext = aes.update(JSON.stringify(plainobj));
        var cipherfinal = aes.final();
        ciphertext = Buffer.concat([iv, aes.getAuthTag(), ciphertext, cipherfinal]);
        return ciphertext.toString('base64');
    }

    // Takes a base64 and return an object.
    function performRecordDecrypt(ciphertext) {
        if (obj.dbRecordsDecryptKey == null) return null;
        const ciphertextBytes = Buffer.from(ciphertext, 'base64');
        const iv = ciphertextBytes.slice(0, 12);
        const data = ciphertextBytes.slice(28);
        const aes = parent.crypto.createDecipheriv('aes-256-gcm', obj.dbRecordsDecryptKey, iv);
        aes.setAuthTag(ciphertextBytes.slice(12, 28));
        var plaintextBytes, r;
        try {
            plaintextBytes = Buffer.from(aes.update(data));
            plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
            r = JSON.parse(plaintextBytes.toString());
        } catch (e) { throw "Incorrect DbRecordsDecryptKey/DbRecordsEncryptKey or invalid database _CRYPT data: " + e; }
        return r;
    }

    // Clone an object (TODO: Make this more efficient)
    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    // Read expiration time from configuration file
    if (typeof parent.args.dbexpire == 'object') {
        if (typeof parent.args.dbexpire.events == 'number') { expireEventsSeconds = parent.args.dbexpire.events; }
        if (typeof parent.args.dbexpire.powerevents == 'number') { expirePowerEventsSeconds = parent.args.dbexpire.powerevents; }
        if (typeof parent.args.dbexpire.statsevents == 'number') { expireServerStatsSeconds = parent.args.dbexpire.statsevents; }
    }

    // If a DB record encryption key is provided, perform database record encryption
    if ((typeof parent.args.dbrecordsencryptkey == 'string') && (parent.args.dbrecordsencryptkey.length != 0)) {
        // Hash the database password into a AES256 key and setup encryption and decryption.
        obj.dbRecordsEncryptKey = obj.dbRecordsDecryptKey = parent.crypto.createHash('sha384').update(parent.args.dbrecordsencryptkey).digest('raw').slice(0, 32);
    }

    // If a DB record decryption key is provided, perform database record decryption
    if ((typeof parent.args.dbrecordsdecryptkey == 'string') && (parent.args.dbrecordsdecryptkey.length != 0)) {
        // Hash the database password into a AES256 key and setup encryption and decryption.
        obj.dbRecordsDecryptKey = parent.crypto.createHash('sha384').update(parent.args.dbrecordsdecryptkey).digest('raw').slice(0, 32);
    }


    function createTablesIfNotExist(dbname) {
        var useDatabase = 'USE ' + dbname;
        sqlDbQuery(useDatabase, null, function (err, docs) {
            if (err != null) {
                console.log("Unable to connect to database: " + err);
                process.exit();
            }
            if (err == null) {
                parent.debug('db', 'Checking tables...');
                sqlDbBatchExec([
                    'CREATE TABLE IF NOT EXISTS main (id VARCHAR(256) NOT NULL, type CHAR(32), domain CHAR(64), extra CHAR(255), extraex CHAR(255), doc JSON, PRIMARY KEY(id), CHECK (json_valid(doc)))',
                    'CREATE TABLE IF NOT EXISTS events (id INT NOT NULL AUTO_INCREMENT, time DATETIME, domain CHAR(64), action CHAR(255), nodeid CHAR(255), userid CHAR(255), doc JSON, PRIMARY KEY(id), CHECK(json_valid(doc)))',
                    'CREATE TABLE IF NOT EXISTS eventids (fkid INT NOT NULL, target CHAR(255), CONSTRAINT fk_eventid FOREIGN KEY (fkid) REFERENCES events (id) ON DELETE CASCADE ON UPDATE RESTRICT)',
                    'CREATE TABLE IF NOT EXISTS serverstats (time DATETIME, expire DATETIME, doc JSON, PRIMARY KEY(time), CHECK (json_valid(doc)))',
                    'CREATE TABLE IF NOT EXISTS power (id INT NOT NULL AUTO_INCREMENT, time DATETIME, nodeid CHAR(255), doc JSON, PRIMARY KEY(id), CHECK (json_valid(doc)))',
                    'CREATE TABLE IF NOT EXISTS smbios (id CHAR(255), time DATETIME, expire DATETIME, doc JSON, PRIMARY KEY(id), CHECK (json_valid(doc)))',
                    'CREATE TABLE IF NOT EXISTS plugin (id INT NOT NULL AUTO_INCREMENT, doc JSON, PRIMARY KEY(id), CHECK (json_valid(doc)))'
                ], function (err) {
                    parent.debug('db', 'Checking indexes...');
                    sqlDbExec('CREATE INDEX ndxtypedomainextra ON main (type, domain, extra)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxextra ON main (extra)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxextraex ON main (extraex)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxeventstime ON events(time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxeventsusername ON events(domain, userid, time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxeventsdomainnodeidtime ON events(domain, nodeid, time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxeventids ON eventids(target)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxserverstattime ON serverstats (time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxserverstatexpire ON serverstats (expire)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxpowernodeidtime ON power (nodeid, time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxsmbiostime ON smbios (time)', null, function (err, response) { });
                    sqlDbExec('CREATE INDEX ndxsmbiosexpire ON smbios (expire)', null, function (err, response) { });
                    setupFunctions(func);
                });
            }
        });
    }

    if (parent.args.sqlite3) {
        // SQLite3 database setup
        obj.databaseType = DB_SQLITE;
        const sqlite3 = require('sqlite3');
        let configParams = parent.config.settings.sqlite3;
        if (typeof configParams == 'string') {databaseName = configParams} else {databaseName = configParams.name ? configParams.name : 'meshcentral';};
        obj.sqliteConfig.startupVacuum = configParams.startupvacuum ? configParams.startupvacuum : false;
        obj.sqliteConfig.autoVacuum = configParams.autovacuum ? configParams.autovacuum.toLowerCase() : 'incremental';
        obj.sqliteConfig.incrementalVacuum = configParams.incrementalvacuum ? configParams.incrementalvacuum : 100;
        obj.sqliteConfig.journalMode = configParams.journalmode ? configParams.journalmode.toLowerCase() : 'delete';
        //allowed modes, 'none' excluded because not usefull for this app, maybe also remove 'memory'?
        if (!(['delete', 'truncate', 'persist', 'memory', 'wal'].includes(obj.sqliteConfig.journalMode))) { obj.sqliteConfig.journalMode = 'delete'};
        obj.sqliteConfig.journalSize = configParams.journalsize ? configParams.journalsize : 409600;
        //wal can use the more performant 'normal' mode, see https://www.sqlite.org/pragma.html#pragma_synchronous
        obj.sqliteConfig.synchronous = (obj.sqliteConfig.journalMode == 'wal') ? 'normal' : 'full';
        if (obj.sqliteConfig.journalMode == 'wal') {obj.sqliteConfig.maintenance += 'PRAGMA wal_checkpoint(PASSIVE);'};
        if (obj.sqliteConfig.autoVacuum == 'incremental') {obj.sqliteConfig.maintenance += 'PRAGMA incremental_vacuum(' + obj.sqliteConfig.incrementalVacuum + ');'};
        obj.sqliteConfig.maintenance += 'PRAGMA optimize;';
        
        parent.debug('db', 'SQlite config options: ' + JSON.stringify(obj.sqliteConfig, null, 4));
        if (obj.sqliteConfig.journalMode == 'memory') { console.log('[WARNING] journal_mode=memory: this can lead to database corruption if there is a crash during a transaction. See https://www.sqlite.org/pragma.html#pragma_journal_mode') };
        //.cached not usefull
        obj.file = new sqlite3.Database(path.join(parent.datapath, databaseName + '.sqlite'), sqlite3.OPEN_READWRITE, function (err) {
            if (err && (err.code == 'SQLITE_CANTOPEN')) {
                // Database needs to be created
                obj.file = new sqlite3.Database(path.join(parent.datapath, databaseName + '.sqlite'), function (err) {
                    if (err) { console.log("SQLite Error: " + err); process.exit(1); }
                    obj.file.exec(`
                        CREATE TABLE main (id VARCHAR(256) PRIMARY KEY NOT NULL, type CHAR(32), domain CHAR(64), extra CHAR(255), extraex CHAR(255), doc JSON);
                        CREATE TABLE events(id INTEGER PRIMARY KEY, time TIMESTAMP, domain CHAR(64), action CHAR(255), nodeid CHAR(255), userid CHAR(255), doc JSON);
                        CREATE TABLE eventids(fkid INT NOT NULL, target CHAR(255), CONSTRAINT fk_eventid FOREIGN KEY (fkid) REFERENCES events (id) ON DELETE CASCADE ON UPDATE RESTRICT);
                        CREATE TABLE serverstats (time TIMESTAMP PRIMARY KEY, expire TIMESTAMP, doc JSON);
                        CREATE TABLE power (id INTEGER PRIMARY KEY, time TIMESTAMP, nodeid CHAR(255), doc JSON);
                        CREATE TABLE smbios (id CHAR(255) PRIMARY KEY, time TIMESTAMP, expire TIMESTAMP, doc JSON);
                        CREATE TABLE plugin (id INTEGER PRIMARY KEY, doc JSON);
                        CREATE INDEX ndxtypedomainextra ON main (type, domain, extra);
                        CREATE INDEX ndxextra ON main (extra);
                        CREATE INDEX ndxextraex ON main (extraex);
                        CREATE INDEX ndxeventstime ON events(time);
                        CREATE INDEX ndxeventsusername ON events(domain, userid, time);
                        CREATE INDEX ndxeventsdomainnodeidtime ON events(domain, nodeid, time);
                        CREATE INDEX ndxeventids ON eventids(target);
                        CREATE INDEX ndxserverstattime ON serverstats (time);
                        CREATE INDEX ndxserverstatexpire ON serverstats (expire);
                        CREATE INDEX ndxpowernodeidtime ON power (nodeid, time);
                        CREATE INDEX ndxsmbiostime ON smbios (time);
                        CREATE INDEX ndxsmbiosexpire ON smbios (expire);
                        `, function (err) {
                            // Completed DB creation of SQLite3
                            sqliteSetOptions(func);
                            //setupFunctions could be put in the sqliteSetupOptions, but left after it for clarity
                            setupFunctions(func);
                        }
                    );
                });
                return;
            } else if (err) { console.log("SQLite Error: " + err); process.exit(0); }

            //for existing db's
            sqliteSetOptions();
            //setupFunctions could be put in the sqliteSetupOptions, but left after it for clarity
            setupFunctions(func);
        });
    } else if (parent.args.acebase) {
        // AceBase database setup
        obj.databaseType = DB_ACEBASE;
        const { AceBase } = require('acebase');
        // For information on AceBase sponsor: https://github.com/appy-one/acebase/discussions/100
        obj.file = new AceBase('meshcentral', { sponsor: ((typeof parent.args.acebase == 'object') && (parent.args.acebase.sponsor)), logLevel: 'error', storage: { path: parent.datapath } });
        // Get all the databases ready
        obj.file.ready(function () {
            // Create AceBase indexes
            obj.file.indexes.create('meshcentral', 'type', { include: ['domain', 'meshid'] });
            obj.file.indexes.create('meshcentral', 'email');
            obj.file.indexes.create('meshcentral', 'meshid');
            obj.file.indexes.create('meshcentral', 'intelamt.uuid');
            obj.file.indexes.create('events', 'userid', { include: ['action'] });
            obj.file.indexes.create('events', 'domain', { include: ['nodeid', 'time'] });
            obj.file.indexes.create('events', 'ids', { include: ['time'] });
            obj.file.indexes.create('events', 'time');
            obj.file.indexes.create('power', 'nodeid', { include: ['time'] });
            obj.file.indexes.create('power', 'time');
            obj.file.indexes.create('stats', 'time');
            obj.file.indexes.create('stats', 'expire');
            // Completed setup of AceBase
            setupFunctions(func);
        });
    } else if (parent.args.mariadb || parent.args.mysql) {
        var connectinArgs = (parent.args.mariadb) ? parent.args.mariadb : parent.args.mysql;
        if (typeof connectinArgs == 'string') {
            const parts = connectinArgs.split(/[:@/]+/);
            var connectionObject = {
                "user": parts[1],
                "password": parts[2],
                "host": parts[3],
                "port": parts[4],
                "database": parts[5]
            };
            var dbname = (connectionObject.database != null) ? connectionObject.database : 'meshcentral';
        } else {
            var dbname = (connectinArgs.database != null) ? connectinArgs.database : 'meshcentral';

            // Including the db name in the connection obj will cause a connection faliure if it does not exist
            var connectionObject = Clone(connectinArgs);
            delete connectionObject.database;

            try {
                if (connectinArgs.ssl) {
                    if (connectinArgs.ssl.dontcheckserveridentity == true) { connectionObject.ssl.checkServerIdentity = function (name, cert) { return undefined; } };
                    if (connectinArgs.ssl.cacertpath) { connectionObject.ssl.ca = [require('fs').readFileSync(connectinArgs.ssl.cacertpath, 'utf8')]; }
                    if (connectinArgs.ssl.clientcertpath) { connectionObject.ssl.cert = [require('fs').readFileSync(connectinArgs.ssl.clientcertpath, 'utf8')]; }
                    if (connectinArgs.ssl.clientkeypath) { connectionObject.ssl.key = [require('fs').readFileSync(connectinArgs.ssl.clientkeypath, 'utf8')]; }
                }
            } catch (ex) {
                console.log('Error loading SQL Connector certificate: ' + ex);
                process.exit();
            }
        }

        if (parent.args.mariadb) {
            // Use MariaDB
            obj.databaseType = DB_MARIADB;
            var tempDatastore = require('mariadb').createPool(connectionObject);
            tempDatastore.getConnection().then(function (conn) {
                conn.query('CREATE DATABASE IF NOT EXISTS ' + dbname).then(function (result) {
                    conn.release();
                }).catch(function (ex) { console.log('Auto-create database failed: ' + ex); });
            }).catch(function (ex) { console.log('Auto-create database failed: ' + ex); });
            setTimeout(function () { tempDatastore.end(); }, 2000);

            connectionObject.database = dbname;
            Datastore = require('mariadb').createPool(connectionObject);
            createTablesIfNotExist(dbname);
        } else if (parent.args.mysql) {
            // Use MySQL
            obj.databaseType = DB_MYSQL;
            var tempDatastore = require('mysql2').createPool(connectionObject);
            tempDatastore.query('CREATE DATABASE IF NOT EXISTS ' + dbname, function (error) {
                if (error != null) {
                    console.log('Auto-create database failed: ' + error);
                }
                connectionObject.database = dbname;
                Datastore = require('mysql2').createPool(connectionObject);
                createTablesIfNotExist(dbname);
            });
            setTimeout(function () { tempDatastore.end(); }, 2000);
        }
    } else if (parent.args.postgres) {
        // Postgres SQL
        let connectinArgs = parent.args.postgres;
        connectinArgs.database = (databaseName = (connectinArgs.database != null) ? connectinArgs.database : 'meshcentral');

        let DatastoreTest;
        obj.databaseType = DB_POSTGRESQL;
        const { Client } = require('pg');
        Datastore = new Client(connectinArgs);
        //Connect to and check pg db first to check if own db exists. Otherwise errors out on 'database does not exist'
        connectinArgs.database = 'postgres';
        DatastoreTest = new Client(connectinArgs);
        DatastoreTest.connect();

        DatastoreTest.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [databaseName], function (err, res) { // check database exists first before creating
            if (res.rowCount != 0) { // database exists now check tables exists
                DatastoreTest.end();
                Datastore.connect();
                Datastore.query('SELECT doc FROM main WHERE id = $1', ['DatabaseIdentifier'], function (err, res) {
                    if (err == null) {
                      (res.rowCount ==0) ? postgreSqlCreateTables(func) : setupFunctions(func)
                    } else
                    if (err.code == '42P01') { //42P01 = undefined table, https://www.postgresql.org/docs/current/errcodes-appendix.html
                        postgreSqlCreateTables(func);
                    } else {
                        console.log('Postgresql database exists, other error: ', err.message); process.exit(0);
                    };
                });
            } else { // If not present, create the tables and indexes
                //not needed, just use a create db statement: const pgtools = require('pgtools'); 
                DatastoreTest.query('CREATE DATABASE '+ databaseName + ';', [], function (err, res) {
                    if (err == null) {
                        // Create the tables and indexes
                        DatastoreTest.end();
                        Datastore.connect();
                        postgreSqlCreateTables(func);
                    } else {
                            console.log('Postgresql database create error: ', err.message);
                            process.exit(0);
                    }
                });
            }
        });
    } else if (parent.args.mongodb) {
        // Use MongoDB
        obj.databaseType = DB_MONGODB;

        // If running an older NodeJS version, TextEncoder/TextDecoder is required
        if (global.TextEncoder == null) { global.TextEncoder = require('util').TextEncoder; }
        if (global.TextDecoder == null) { global.TextDecoder = require('util').TextDecoder; }

        require('mongodb').MongoClient.connect(parent.args.mongodb, { useNewUrlParser: true, useUnifiedTopology: true, enableUtf8Validation: false }, function (err, client) {
            if (err != null) { console.log("Unable to connect to database: " + err); process.exit(); return; }
            Datastore = client;
            parent.debug('db', 'Connected to MongoDB database...');

            // Get the database name and setup the database client
            var dbname = 'meshcentral';
            if (parent.args.mongodbname) { dbname = parent.args.mongodbname; }
            const dbcollectionname = (parent.args.mongodbcol) ? (parent.args.mongodbcol) : 'meshcentral';
            const db = client.db(dbname);

            // Check the database version
            db.admin().serverInfo(function (err, info) {
                if ((err != null) || (info == null) || (info.versionArray == null) || (Array.isArray(info.versionArray) == false) || (info.versionArray.length < 2) || (typeof info.versionArray[0] != 'number') || (typeof info.versionArray[1] != 'number')) {
                    console.log('WARNING: Unable to check MongoDB version.');
                } else {
                    if ((info.versionArray[0] < 3) || ((info.versionArray[0] == 3) && (info.versionArray[1] < 6))) {
                        // We are running with mongoDB older than 3.6, this is not good.
                        parent.addServerWarning("Current version of MongoDB (" + info.version + ") is too old, please upgrade to MongoDB 3.6 or better.", true);
                    }
                }
            });

            // Setup MongoDB main collection and indexes
            obj.file = db.collection(dbcollectionname);
            obj.file.indexes(function (err, indexes) {
                // Check if we need to reset indexes
                var indexesByName = {}, indexCount = 0;
                for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
                if ((indexCount != 5) || (indexesByName['TypeDomainMesh1'] == null) || (indexesByName['Email1'] == null) || (indexesByName['Mesh1'] == null) || (indexesByName['AmtUuid1'] == null)) {
                    console.log('Resetting main indexes...');
                    obj.file.dropIndexes(function (err) {
                        obj.file.createIndex({ type: 1, domain: 1, meshid: 1 }, { sparse: 1, name: 'TypeDomainMesh1' });       // Speeds up GetAllTypeNoTypeField() and GetAllTypeNoTypeFieldMeshFiltered()
                        obj.file.createIndex({ email: 1 }, { sparse: 1, name: 'Email1' });                                     // Speeds up GetUserWithEmail() and GetUserWithVerifiedEmail()
                        obj.file.createIndex({ meshid: 1 }, { sparse: 1, name: 'Mesh1' });                                     // Speeds up RemoveMesh()
                        obj.file.createIndex({ 'intelamt.uuid': 1 }, { sparse: 1, name: 'AmtUuid1' });                         // Speeds up getAmtUuidMeshNode()
                    });
                }
            });

            // Setup the changeStream on the MongoDB main collection if possible
            if (parent.args.mongodbchangestream == true) {
                obj.dbCounters.changeStream = { change: 0, update: 0, insert: 0, delete: 0 };
                if (typeof obj.file.watch != 'function') {
                    console.log('WARNING: watch() is not a function, MongoDB ChangeStream not supported.');
                } else {
                    obj.fileChangeStream = obj.file.watch([{ $match: { $or: [{ 'fullDocument.type': { $in: ['node', 'mesh', 'user', 'ugrp'] } }, { 'operationType': 'delete' }] } }], { fullDocument: 'updateLookup' });
                    obj.fileChangeStream.on('change', function (change) {
                        obj.dbCounters.changeStream.change++;
                        if ((change.operationType == 'update') || (change.operationType == 'replace')) {
                            obj.dbCounters.changeStream.update++;
                            switch (change.fullDocument.type) {
                                case 'node': { dbNodeChange(change, false); break; } // A node has changed
                                case 'mesh': { dbMeshChange(change, false); break; } // A device group has changed
                                case 'user': { dbUserChange(change, false); break; } // A user account has changed
                                case 'ugrp': { dbUGrpChange(change, false); break; } // A user account has changed
                            }
                        } else if (change.operationType == 'insert') {
                            obj.dbCounters.changeStream.insert++;
                            switch (change.fullDocument.type) {
                                case 'node': { dbNodeChange(change, true); break; } // A node has added
                                case 'mesh': { dbMeshChange(change, true); break; } // A device group has created
                                case 'user': { dbUserChange(change, true); break; } // A user account has created
                                case 'ugrp': { dbUGrpChange(change, true); break; } // A user account has created
                            }
                        } else if (change.operationType == 'delete') {
                            obj.dbCounters.changeStream.delete++;
                            if ((change.documentKey == null) || (change.documentKey._id == null)) return;
                            var splitId = change.documentKey._id.split('/');
                            switch (splitId[0]) {
                                case 'node': {
                                    //Not Good: Problem here is that we don't know what meshid the node belonged to before the delete.
                                    //parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', action: 'removenode', nodeid: change.documentKey._id, domain: splitId[1] });
                                    break;
                                }
                                case 'mesh': {
                                    parent.DispatchEvent(['*', change.documentKey._id], obj, { etype: 'mesh', action: 'deletemesh', meshid: change.documentKey._id, domain: splitId[1] });
                                    break;
                                }
                                case 'user': {
                                    //Not Good: This is not a perfect user removal because we don't know what groups the user was in.
                                    //parent.DispatchEvent(['*', 'server-users'], obj, { etype: 'user', action: 'accountremove', userid: change.documentKey._id, domain: splitId[1], username: splitId[2] });
                                    break;
                                }
                                case 'ugrp': {
                                    parent.DispatchEvent(['*', change.documentKey._id], obj, { etype: 'ugrp', action: 'deleteusergroup', ugrpid: change.documentKey._id, domain: splitId[1] });
                                    break;
                                }
                            }
                        }
                    });
                    obj.changeStream = true;
                }
            }

            // Setup MongoDB events collection and indexes
            obj.eventsfile = db.collection('events'); // Collection containing all events
            obj.eventsfile.indexes(function (err, indexes) {
                // Check if we need to reset indexes
                var indexesByName = {}, indexCount = 0;
                for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
                if ((indexCount != 5) || (indexesByName['UseridAction1'] == null) || (indexesByName['DomainNodeTime1'] == null) || (indexesByName['IdsAndTime1'] == null) || (indexesByName['ExpireTime1'] == null)) {
                    // Reset all indexes
                    console.log("Resetting events indexes...");
                    obj.eventsfile.dropIndexes(function (err) {
                        obj.eventsfile.createIndex({ userid: 1, action: 1 }, { sparse: 1, name: 'UseridAction1' });
                        obj.eventsfile.createIndex({ domain: 1, nodeid: 1, time: -1 }, { sparse: 1, name: 'DomainNodeTime1' });
                        obj.eventsfile.createIndex({ ids: 1, time: -1 }, { sparse: 1, name: 'IdsAndTime1' });
                        obj.eventsfile.createIndex({ time: 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
                    });
                } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireEventsSeconds) {
                    // Reset the timeout index
                    console.log("Resetting events expire index...");
                    obj.eventsfile.dropIndex('ExpireTime1', function (err) {
                        obj.eventsfile.createIndex({ time: 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
                    });
                }
            });

            // Setup MongoDB power events collection and indexes
            obj.powerfile = db.collection('power');                                 // Collection containing all power events
            obj.powerfile.indexes(function (err, indexes) {
                // Check if we need to reset indexes
                var indexesByName = {}, indexCount = 0;
                for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
                if ((indexCount != 3) || (indexesByName['NodeIdAndTime1'] == null) || (indexesByName['ExpireTime1'] == null)) {
                    // Reset all indexes
                    console.log("Resetting power events indexes...");
                    obj.powerfile.dropIndexes(function (err) {
                        // Create all indexes
                        obj.powerfile.createIndex({ nodeid: 1, time: 1 }, { sparse: 1, name: 'NodeIdAndTime1' });
                        obj.powerfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
                    });
                } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expirePowerEventsSeconds) {
                    // Reset the timeout index
                    console.log("Resetting power events expire index...");
                    obj.powerfile.dropIndex('ExpireTime1', function (err) {
                        // Reset the expire power events index
                        obj.powerfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
                    });
                }
            });

            // Setup MongoDB smbios collection, no indexes needed
            obj.smbiosfile = db.collection('smbios');                               // Collection containing all smbios information

            // Setup MongoDB server stats collection
            obj.serverstatsfile = db.collection('serverstats');                     // Collection of server stats
            obj.serverstatsfile.indexes(function (err, indexes) {
                // Check if we need to reset indexes
                var indexesByName = {}, indexCount = 0;
                for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
                if ((indexCount != 3) || (indexesByName['ExpireTime1'] == null)) {
                    // Reset all indexes
                    console.log("Resetting server stats indexes...");
                    obj.serverstatsfile.dropIndexes(function (err) {
                        // Create all indexes
                        obj.serverstatsfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                        obj.serverstatsfile.createIndex({ 'expire': 1 }, { expireAfterSeconds: 0, name: 'ExpireTime2' });  // Auto-expire events
                    });
                } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireServerStatsSeconds) {
                    // Reset the timeout index
                    console.log("Resetting server stats expire index...");
                    obj.serverstatsfile.dropIndex('ExpireTime1', function (err) {
                        // Reset the expire server stats index
                        obj.serverstatsfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                    });
                }
            });

            // Setup plugin info collection
            if (obj.pluginsActive) { obj.pluginsfile = db.collection('plugins'); }

            setupFunctions(func); // Completed setup of MongoDB
        });
    } else if (parent.args.xmongodb) {
        // Use MongoJS, this is the old system.
        obj.databaseType = DB_MONGOJS;
        Datastore = require('mongojs');
        var db = Datastore(parent.args.xmongodb);
        var dbcollection = 'meshcentral';
        if (parent.args.mongodbcol) { dbcollection = parent.args.mongodbcol; }

        // Setup MongoDB main collection and indexes
        obj.file = db.collection(dbcollection);
        obj.file.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 5) || (indexesByName['TypeDomainMesh1'] == null) || (indexesByName['Email1'] == null) || (indexesByName['Mesh1'] == null) || (indexesByName['AmtUuid1'] == null)) {
                console.log("Resetting main indexes...");
                obj.file.dropIndexes(function (err) {
                    obj.file.createIndex({ type: 1, domain: 1, meshid: 1 }, { sparse: 1, name: 'TypeDomainMesh1' });       // Speeds up GetAllTypeNoTypeField() and GetAllTypeNoTypeFieldMeshFiltered()
                    obj.file.createIndex({ email: 1 }, { sparse: 1, name: 'Email1' });                                     // Speeds up GetUserWithEmail() and GetUserWithVerifiedEmail()
                    obj.file.createIndex({ meshid: 1 }, { sparse: 1, name: 'Mesh1' });                                     // Speeds up RemoveMesh()
                    obj.file.createIndex({ 'intelamt.uuid': 1 }, { sparse: 1, name: 'AmtUuid1' });                         // Speeds up getAmtUuidMeshNode()
                });
            }
        });

        // Setup MongoDB events collection and indexes
        obj.eventsfile = db.collection('events');                               // Collection containing all events
        obj.eventsfile.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 5) || (indexesByName['UseridAction1'] == null) || (indexesByName['DomainNodeTime1'] == null) || (indexesByName['IdsAndTime1'] == null) || (indexesByName['ExpireTime1'] == null)) {
                // Reset all indexes
                console.log("Resetting events indexes...");
                obj.eventsfile.dropIndexes(function (err) {
                    obj.eventsfile.createIndex({ userid: 1, action: 1 }, { sparse: 1, name: 'UseridAction1' });
                    obj.eventsfile.createIndex({ domain: 1, nodeid: 1, time: -1 }, { sparse: 1, name: 'DomainNodeTime1' });
                    obj.eventsfile.createIndex({ ids: 1, time: -1 }, { sparse: 1, name: 'IdsAndTime1' });
                    obj.eventsfile.createIndex({ time: 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireEventsSeconds) {
                // Reset the timeout index
                console.log("Resetting events expire index...");
                obj.eventsfile.dropIndex('ExpireTime1', function (err) {
                    obj.eventsfile.createIndex({ time: 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
                });
            }
        });

        // Setup MongoDB power events collection and indexes
        obj.powerfile = db.collection('power');                                 // Collection containing all power events
        obj.powerfile.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 3) || (indexesByName['NodeIdAndTime1'] == null) || (indexesByName['ExpireTime1'] == null)) {
                // Reset all indexes
                console.log("Resetting power events indexes...");
                obj.powerfile.dropIndexes(function (err) {
                    // Create all indexes
                    obj.powerfile.createIndex({ nodeid: 1, time: 1 }, { sparse: 1, name: 'NodeIdAndTime1' });
                    obj.powerfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expirePowerEventsSeconds) {
                // Reset the timeout index
                console.log("Resetting power events expire index...");
                obj.powerfile.dropIndex('ExpireTime1', function (err) {
                    // Reset the expire power events index
                    obj.powerfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
                });
            }
        });

        // Setup MongoDB smbios collection, no indexes needed
        obj.smbiosfile = db.collection('smbios');                               // Collection containing all smbios information

        // Setup MongoDB server stats collection
        obj.serverstatsfile = db.collection('serverstats');                     // Collection of server stats
        obj.serverstatsfile.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 3) || (indexesByName['ExpireTime1'] == null)) {
                // Reset all indexes
                console.log("Resetting server stats indexes...");
                obj.serverstatsfile.dropIndexes(function (err) {
                    // Create all indexes
                    obj.serverstatsfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                    obj.serverstatsfile.createIndex({ 'expire': 1 }, { expireAfterSeconds: 0, name: 'ExpireTime2' });  // Auto-expire events
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireServerStatsSeconds) {
                // Reset the timeout index
                console.log("Resetting server stats expire index...");
                obj.serverstatsfile.dropIndex('ExpireTime1', function (err) {
                    // Reset the expire server stats index
                    obj.serverstatsfile.createIndex({ 'time': 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                });
            }
        });

        // Setup plugin info collection
        if (obj.pluginsActive) { obj.pluginsfile = db.collection('plugins'); }

        setupFunctions(func); // Completed setup of MongoJS
    } else {
        // Use NeDB (The default)
        obj.databaseType = DB_NEDB;
        try { Datastore = require('@seald-io/nedb'); } catch (ex) { } // This is the NeDB with Node 23 support.
        if (Datastore == null) {
            try { Datastore = require('@yetzt/nedb'); } catch (ex) { } // This is the NeDB with fixed security dependencies.
            if (Datastore == null) { Datastore = require('nedb'); } // So not to break any existing installations, if the old NeDB is present, use it.
        }
        var datastoreOptions = { filename: parent.getConfigFilePath('meshcentral.db'), autoload: true };

        // If a DB encryption key is provided, perform database encryption
        if ((typeof parent.args.dbencryptkey == 'string') && (parent.args.dbencryptkey.length != 0)) {
            // Hash the database password into a AES256 key and setup encryption and decryption.
            obj.dbKey = parent.crypto.createHash('sha384').update(parent.args.dbencryptkey).digest('raw').slice(0, 32);
            datastoreOptions.afterSerialization = function (plaintext) {
                const iv = parent.crypto.randomBytes(16);
                const aes = parent.crypto.createCipheriv('aes-256-cbc', obj.dbKey, iv);
                var ciphertext = aes.update(plaintext);
                ciphertext = Buffer.concat([iv, ciphertext, aes.final()]);
                return ciphertext.toString('base64');
            }
            datastoreOptions.beforeDeserialization = function (ciphertext) {
                const ciphertextBytes = Buffer.from(ciphertext, 'base64');
                const iv = ciphertextBytes.slice(0, 16);
                const data = ciphertextBytes.slice(16);
                const aes = parent.crypto.createDecipheriv('aes-256-cbc', obj.dbKey, iv);
                var plaintextBytes = Buffer.from(aes.update(data));
                plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
                return plaintextBytes.toString();
            }
        }

        // Start NeDB main collection and setup indexes
        obj.file = new Datastore(datastoreOptions);
        obj.file.setAutocompactionInterval(86400000); // Compact once a day
        obj.file.ensureIndex({ fieldName: 'type' });
        obj.file.ensureIndex({ fieldName: 'domain' });
        obj.file.ensureIndex({ fieldName: 'meshid', sparse: true });
        obj.file.ensureIndex({ fieldName: 'nodeid', sparse: true });
        obj.file.ensureIndex({ fieldName: 'email', sparse: true });

        // Setup the events collection and setup indexes
        obj.eventsfile = new Datastore({ filename: parent.getConfigFilePath('meshcentral-events.db'), autoload: true, corruptAlertThreshold: 1 });
        obj.eventsfile.setAutocompactionInterval(86400000); // Compact once a day
        obj.eventsfile.ensureIndex({ fieldName: 'ids' }); // TODO: Not sure if this is a good index, this is a array field.
        obj.eventsfile.ensureIndex({ fieldName: 'nodeid', sparse: true });
        obj.eventsfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: expireEventsSeconds });
        obj.eventsfile.remove({ time: { '$lt': new Date(Date.now() - (expireEventsSeconds * 1000)) } }, { multi: true }); // Force delete older events

        // Setup the power collection and setup indexes
        obj.powerfile = new Datastore({ filename: parent.getConfigFilePath('meshcentral-power.db'), autoload: true, corruptAlertThreshold: 1 });
        obj.powerfile.setAutocompactionInterval(86400000); // Compact once a day
        obj.powerfile.ensureIndex({ fieldName: 'nodeid' });
        obj.powerfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: expirePowerEventsSeconds });
        obj.powerfile.remove({ time: { '$lt': new Date(Date.now() - (expirePowerEventsSeconds * 1000)) } }, { multi: true }); // Force delete older events

        // Setup the SMBIOS collection, for NeDB we don't setup SMBIOS since NeDB will corrupt the database. Remove any existing ones.
        //obj.smbiosfile = new Datastore({ filename: parent.getConfigFilePath('meshcentral-smbios.db'), autoload: true, corruptAlertThreshold: 1 });
        fs.unlink(parent.getConfigFilePath('meshcentral-smbios.db'), function () { });

        // Setup the server stats collection and setup indexes
        obj.serverstatsfile = new Datastore({ filename: parent.getConfigFilePath('meshcentral-stats.db'), autoload: true, corruptAlertThreshold: 1 });
        obj.serverstatsfile.setAutocompactionInterval(86400000); // Compact once a day
        obj.serverstatsfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: expireServerStatsSeconds });
        obj.serverstatsfile.ensureIndex({ fieldName: 'expire', expireAfterSeconds: 0 }); // Auto-expire events
        obj.serverstatsfile.remove({ time: { '$lt': new Date(Date.now() - (expireServerStatsSeconds * 1000)) } }, { multi: true }); // Force delete older events

        // Setup plugin info collection
        if (obj.pluginsActive) {
            obj.pluginsfile = new Datastore({ filename: parent.getConfigFilePath('meshcentral-plugins.db'), autoload: true });
            obj.pluginsfile.setAutocompactionInterval(86400000); // Compact once a day
        }

        setupFunctions(func); // Completed setup of NeDB
    }

    function sqliteSetOptions(func) {
        //get current auto_vacuum mode for comparison
        obj.file.get('PRAGMA auto_vacuum;', function(err, current){
            let pragma = 'PRAGMA journal_mode=' + obj.sqliteConfig.journalMode + ';' + 
                'PRAGMA synchronous='+ obj.sqliteConfig.synchronous + ';' +
                'PRAGMA journal_size_limit=' + obj.sqliteConfig.journalSize + ';' +
                'PRAGMA auto_vacuum=' + obj.sqliteConfig.autoVacuum + ';' +
                'PRAGMA incremental_vacuum=' + obj.sqliteConfig.incrementalVacuum + ';' +
                'PRAGMA optimize=0x10002;';
            //check new autovacuum mode, if changing from or to 'none', a VACUUM needs to be done to activate it. See https://www.sqlite.org/pragma.html#pragma_auto_vacuum
            if ( obj.sqliteConfig.startupVacuum
                || (current.auto_vacuum == 0 && obj.sqliteConfig.autoVacuum !='none')
                || (current.auto_vacuum != 0 && obj.sqliteConfig.autoVacuum =='none'))
                {
                    pragma += 'VACUUM;';
                };
            parent.debug ('db', 'Config statement: ' + pragma);
            
            obj.file.exec( pragma,
                function (err) {
                if (err) { parent.debug('db', 'Config pragma error: ' + (err.message)) };
                sqliteGetPragmas(['journal_mode', 'journal_size_limit', 'freelist_count', 'auto_vacuum', 'page_size', 'wal_autocheckpoint', 'synchronous'], function (pragma, pragmaValue) {
                    parent.debug('db', 'PRAGMA: ' + pragma + '=' + pragmaValue);
                });
            });
        });
        //setupFunctions(func);
    }

    function sqliteGetPragmas (pragmas, func){
        //pragmas can only be gotting one by one
        pragmas.forEach (function (pragma) {
            obj.file.get('PRAGMA ' + pragma + ';', function(err, res){
                if (pragma == 'auto_vacuum') { res[pragma] = SQLITE_AUTOVACUUM[res[pragma]] };
                if (pragma == 'synchronous') { res[pragma] = SQLITE_SYNCHRONOUS[res[pragma]] };
                if (func) { func (pragma, res[pragma]); }
            });
        });
    }
    // Create the PostgreSQL tables
    function postgreSqlCreateTables(func) {
        // Database was created, create the tables
        parent.debug('db', 'Creating tables...');
        sqlDbBatchExec([
            'CREATE TABLE IF NOT EXISTS main (id VARCHAR(256) PRIMARY KEY NOT NULL, type CHAR(32), domain CHAR(64), extra CHAR(255), extraex CHAR(255), doc JSON)',
            'CREATE TABLE IF NOT EXISTS events(id SERIAL PRIMARY KEY, time TIMESTAMP, domain CHAR(64), action CHAR(255), nodeid CHAR(255), userid CHAR(255), doc JSON)',
            'CREATE TABLE IF NOT EXISTS eventids(fkid INT NOT NULL, target CHAR(255), CONSTRAINT fk_eventid FOREIGN KEY (fkid) REFERENCES events (id) ON DELETE CASCADE ON UPDATE RESTRICT)',
            'CREATE TABLE IF NOT EXISTS serverstats (time TIMESTAMP PRIMARY KEY, expire TIMESTAMP, doc JSON)',
            'CREATE TABLE IF NOT EXISTS power (id SERIAL PRIMARY KEY, time TIMESTAMP, nodeid CHAR(255), doc JSON)',
            'CREATE TABLE IF NOT EXISTS smbios (id CHAR(255) PRIMARY KEY, time TIMESTAMP, expire TIMESTAMP, doc JSON)',
            'CREATE TABLE IF NOT EXISTS plugin (id SERIAL PRIMARY KEY, doc JSON)'
        ], function (results) {
            parent.debug('db', 'Creating indexes...');
            sqlDbExec('CREATE INDEX ndxtypedomainextra ON main (type, domain, extra)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxextra ON main (extra)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxextraex ON main (extraex)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxeventstime ON events(time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxeventsusername ON events(domain, userid, time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxeventsdomainnodeidtime ON events(domain, nodeid, time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxeventids ON eventids(target)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxserverstattime ON serverstats (time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxserverstatexpire ON serverstats (expire)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxpowernodeidtime ON power (nodeid, time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxsmbiostime ON smbios (time)', null, function (err, response) { });
            sqlDbExec('CREATE INDEX ndxsmbiosexpire ON smbios (expire)', null, function (err, response) { });
            setupFunctions(func);
        });
    }

    // Check the object names for a "."
    function checkObjectNames(r, tag) {
        if (typeof r != 'object') return;
        for (var i in r) {
            if (i.indexOf('.') >= 0) { throw ('BadDbName (' + tag + '): ' + JSON.stringify(r)); }
            checkObjectNames(r[i], tag);
        }
    }

    // Query the database
    function sqlDbQuery(query, args, func, debug) {
        if (obj.databaseType == DB_SQLITE) { // SQLite
            if (args == null) { args = []; }
            obj.file.all(query, args, function (err, docs) {
                if (err != null) { console.log(query, args, err, docs); }
                if (docs != null) {
                    for (var i in docs) {
                        if (typeof docs[i].doc == 'string') {
                            try { docs[i] = JSON.parse(docs[i].doc); } catch (ex) {
                                console.log(query, args, docs[i]);
                            }
                        }
                    }
                }
                if (func) { func(err, docs); }
            });
        } else if (obj.databaseType == DB_MARIADB) { // MariaDB
            Datastore.getConnection()
                .then(function (conn) {
                    conn.query(query, args)
                        .then(function (rows) {
                            conn.release();
                            var docs = [];
                            for (var i in rows) {
                                if (rows[i].doc) {
                                    docs.push(performTypedRecordDecrypt((typeof rows[i].doc == 'object') ? rows[i].doc : JSON.parse(rows[i].doc)));
                                } else if ((rows.length == 1) && (rows[i]['COUNT(doc)'] != null)) {
                                    // This is a SELECT COUNT() operation
                                    docs = parseInt(rows[i]['COUNT(doc)']);
                                }
                            }
                            if (func) try { func(null, docs); } catch (ex) { console.log('SQLERR1', ex); }
                        })
                        .catch(function (err) { conn.release(); if (func) try { func(err); } catch (ex) { console.log('SQLERR2', ex); } });
                }).catch(function (err) { if (func) { try { func(err); } catch (ex) { console.log('SQLERR3', ex); } } });
        } else if (obj.databaseType == DB_MYSQL) { // MySQL
            Datastore.query(query, args, function (error, results, fields) {
                if (error != null) {
                    if (func) try { func(error); } catch (ex) { console.log('SQLERR4', ex); }
                } else {
                    var docs = [];
                    for (var i in results) {
                        if (results[i].doc) {
                            if (typeof results[i].doc == 'string') {
                                docs.push(JSON.parse(results[i].doc));
                            } else {
                                docs.push(results[i].doc);
                            }
                        } else if ((results.length == 1) && (results[i]['COUNT(doc)'] != null)) {
                            // This is a SELECT COUNT() operation
                            docs = results[i]['COUNT(doc)'];
                        }
                    }
                    if (func) { try { func(null, docs); } catch (ex) { console.log('SQLERR5', ex); } }
                }
            });
        } else if (obj.databaseType == DB_POSTGRESQL) { // Postgres SQL
            Datastore.query(query, args, function (error, results) {
                if (error != null) {
                    if (func) try { func(error); } catch (ex) { console.log('SQLERR4', ex); }
                } else {
                    var docs = [];
                    if ((results.command == 'INSERT') && (results.rows != null) && (results.rows.length == 1)) { docs = results.rows[0]; }
                    else if (results.command == 'SELECT') {
                        for (var i in results.rows) {
                            if (results.rows[i].doc) {
                                if (typeof results.rows[i].doc == 'string') {
                                    docs.push(JSON.parse(results.rows[i].doc));
                                } else {
                                    docs.push(results.rows[i].doc);
                                }
                            } else if (results.rows[i].count && (results.rows.length == 1)) {
                                // This is a SELECT COUNT() operation
                                docs = parseInt(results.rows[i].count);
                            }
                        }
                    }
                    if (func) { try { func(null, docs, results); } catch (ex) { console.log('SQLERR5', ex); } }
                }
            });
        }
    }

    // Exec on the database
    function sqlDbExec(query, args, func) {
        if (obj.databaseType == DB_MARIADB) { // MariaDB
            Datastore.getConnection()
                .then(function (conn) {
                    conn.query(query, args)
                        .then(function (rows) {
                            conn.release();
                            if (func) try { func(null, rows[0]); } catch (ex) { console.log(ex); }
                        })
                        .catch(function (err) { conn.release(); if (func) try { func(err); } catch (ex) { console.log(ex); } });
                }).catch(function (err) { if (func) { try { func(err); } catch (ex) { console.log(ex); } } });
        } else if ((obj.databaseType == DB_MYSQL) || (obj.databaseType == DB_POSTGRESQL)) { // MySQL or Postgres SQL
            Datastore.query(query, args, function (error, results, fields) {
                if (func) try { func(error, results ? results[0] : null); } catch (ex) { console.log(ex); }
            });
        }
    }

    // Execute a batch of commands on the database
    function sqlDbBatchExec(queries, func) {
        if (obj.databaseType == DB_MARIADB) { // MariaDB
            Datastore.getConnection()
                .then(function (conn) {
                    var Promises = [];
                    for (var i in queries) { if (typeof queries[i] == 'string') { Promises.push(conn.query(queries[i])); } else { Promises.push(conn.query(queries[i][0], queries[i][1])); } }
                    Promise.all(Promises)
                        .then(function (rows) { conn.release(); if (func) { try { func(null); } catch (ex) { console.log(ex); } } })
                        .catch(function (err) { conn.release(); if (func) { try { func(err); } catch (ex) { console.log(ex); } } });
                })
                .catch(function (err) { if (func) { try { func(err); } catch (ex) { console.log(ex); } } });
        } else if (obj.databaseType == DB_MYSQL) { // MySQL
            Datastore.getConnection(function(err, connection) {
                if (err) { if (func) { try { func(err); } catch (ex) { console.log(ex); } } return; }
                var Promises = [];
                for (var i in queries) { if (typeof queries[i] == 'string') { Promises.push(connection.promise().query(queries[i])); } else { Promises.push(connection.promise().query(queries[i][0], queries[i][1])); } }
                Promise.all(Promises)
                    .then(function (error, results, fields) { connection.release(); if (func) { try { func(error, results); } catch (ex) { console.log(ex); } } })
                    .catch(function (error, results, fields) { connection.release(); if (func) { try { func(error); } catch (ex) { console.log(ex); } } });
            });
        } else if (obj.databaseType == DB_POSTGRESQL) { // Postgres
            var Promises = [];
            for (var i in queries) { if (typeof queries[i] == 'string') { Promises.push(Datastore.query(queries[i])); } else { Promises.push(Datastore.query(queries[i][0], queries[i][1])); } }
            Promise.all(Promises)
                .then(function (error, results, fields) { if (func) { try { func(error, results); } catch (ex) { console.log(ex); } } })
                .catch(function (error, results, fields) { if (func) { try { func(error); } catch (ex) { console.log(ex); } } });
        }
    }

    function setupFunctions(func) {
        if (obj.databaseType == DB_SQLITE) {
            // Database actions on the main collection. SQLite3: https://www.linode.com/docs/guides/getting-started-with-nodejs-sqlite/
            obj.Set = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                value = common.escapeLinksFieldNameEx(value);
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('INSERT INTO main VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET type = $2, domain = $3, extra = $4, extraex = $5, doc = $6;', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, JSON.stringify(performTypedRecordEncrypt(value))], func);
            }
            obj.SetRaw = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('INSERT INTO main VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET type = $2, domain = $3, extra = $4, extraex = $5, doc = $6;', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, JSON.stringify(performTypedRecordEncrypt(value))], func);
            }
            obj.Get = function (_id, func) {
                sqlDbQuery('SELECT doc FROM main WHERE id = $1', [_id], function (err, docs) {
                    if ((docs != null) && (docs.length > 0)) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetAll = function (func) {
                sqlDbQuery('SELECT domain, doc FROM main', null, function (err, docs) {
                    if ((docs != null) && (docs.length > 0)) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetHash = function (id, func) {
                sqlDbQuery('SELECT doc FROM main WHERE id = $1', [id], function (err, docs) {
                    if ((docs != null) && (docs.length > 0)) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetAllTypeNoTypeField = function (type, domain, func) {
                sqlDbQuery('SELECT doc FROM main WHERE type = $1 AND domain = $2', [type, domain], function (err, docs) {
                    if ((docs != null) && (docs.length > 0)) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            };
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (limit == 0) { limit = -1; } // In SQLite, no limit is -1
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra IN (' + dbMergeSqlArray(meshes) + ')) LIMIT $4 OFFSET $5', [id, type, domain, limit, skip], function (err, docs) {
                        if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                        func(err, performTypedRecordDecrypt(docs));
                    });
                } else {
                    if (extrasids == null) {
                        sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND (extra IN (' + dbMergeSqlArray(meshes) + ')) LIMIT $3 OFFSET $4', [type, domain, limit, skip], function (err, docs) {
                            if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                            func(err, performTypedRecordDecrypt(docs));
                        });
                    } else {
                        sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND ((extra IN (' + dbMergeSqlArray(meshes) + ')) OR (id IN (' + dbMergeSqlArray(extrasids) + '))) LIMIT $3 OFFSET $4', [type, domain, limit, skip], function (err, docs) {
                            if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                            func(err, performTypedRecordDecrypt(docs));
                        });
                    }
                }
            };
            obj.CountAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, func) {
                if (id && (id != '')) {
                    sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra IN (' + dbMergeSqlArray(meshes) + '))', [id, type, domain], function (err, docs) {
                        func(err, (err == null) ? docs[0]['COUNT(doc)'] : null);
                    });
                } else {
                    if (extrasids == null) {
                        sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (type = $1) AND (domain = $2) AND (extra IN (' + dbMergeSqlArray(meshes) + '))', [type, domain], function (err, docs) {
                            func(err, (err == null) ? docs[0]['COUNT(doc)'] : null);
                        });
                    } else {
                        sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (type = $1) AND (domain = $2) AND ((extra IN (' + dbMergeSqlArray(meshes) + ')) OR (id IN (' + dbMergeSqlArray(extrasids) + ')))', [type, domain], function (err, docs) {
                            func(err, (err == null) ? docs[0]['COUNT(doc)'] : null);
                        });
                    }
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra IN (' + dbMergeSqlArray(nodes) + '))', [id, type, domain], function (err, docs) {
                        if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                        func(err, performTypedRecordDecrypt(docs));
                    });
                } else {
                    sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND (extra IN (' + dbMergeSqlArray(nodes) + '))', [type, domain], function (err, docs) {
                        if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                        func(err, performTypedRecordDecrypt(docs));
                    });
                }
            };
            obj.GetAllType = function (type, func) {
                sqlDbQuery('SELECT doc FROM main WHERE type = $1', [type], function (err, docs) {
                    if (docs != null) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetAllIdsOfType = function (ids, domain, type, func) {
                sqlDbQuery('SELECT doc FROM main WHERE (id IN (' + dbMergeSqlArray(ids) + ')) AND domain = $1 AND type = $2', [domain, type], function (err, docs) {
                    if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetUserWithEmail = function (domain, email, func) {
                sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extra = $2', [domain, 'email/' + email], function (err, docs) {
                    if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.GetUserWithVerifiedEmail = function (domain, email, func) {
                sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extra = $2', [domain, 'email/' + email], function (err, docs) {
                    if (docs != null) { for (var i in docs) { delete docs[i].type; if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, performTypedRecordDecrypt(docs));
                });
            }
            obj.Remove = function (id, func) { sqlDbQuery('DELETE FROM main WHERE id = $1', [id], func); };
            obj.RemoveAll = function (func) { sqlDbQuery('DELETE FROM main', null, func); };
            obj.RemoveAllOfType = function (type, func) { sqlDbQuery('DELETE FROM main WHERE type = $1', [type], func); };
            obj.InsertMany = function (data, func) { var pendingOps = 0; for (var i in data) { pendingOps++; obj.SetRaw(data[i], function () { if (--pendingOps == 0) { func(); } }); } }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id, func) { sqlDbQuery('DELETE FROM main WHERE extra = $1', [id], function () { sqlDbQuery('DELETE FROM main WHERE id = $1', ['nt' + id], func); }); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { sqlDbQuery('DELETE FROM main WHERE domain = $1', [domain], func); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) {
                sqlDbQuery('SELECT doc FROM main WHERE (type = \'node\') AND (extraex IS NULL)', null, function (err, docs) {
                    if (docs != null) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    var r = []; if (err == null) { for (var i in docs) { if (docs[i].host != null && docs[i].intelamt != null) { r.push(docs[i]); } } } func(err, r);
                });
            };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) {
                sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extraex = $2', [domainid, 'uuid/' + uuid], function (err, docs) {
                    if (docs != null) { for (var i in docs) { if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); } } }
                    func(err, docs);
                });
            };
            obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { sqlDbExec('SELECT COUNT(id) FROM main WHERE domain = $1 AND type = $2', [domainid, type], function (err, response) { func((response['COUNT(id)'] == null) || (response['COUNT(id)'] > max), response['COUNT(id)']) }); } }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) {
                sqlDbQuery('SELECT doc FROM events', null, func);
            };
            obj.StoreEvent = function (event, func) {
                obj.dbCounters.eventsSet++;
                sqlDbQuery('INSERT INTO events VALUES (NULL, $1, $2, $3, $4, $5, $6) RETURNING id', [event.time, ((typeof event.domain == 'string') ? event.domain : null), event.action, event.nodeid ? event.nodeid : null, event.userid ? event.userid : null, JSON.stringify(event)], function (err, docs) {
                    if(func){ func(); }
                    if ((err == null) && (docs[0].id)) {
                        for (var i in event.ids) {
                            if (event.ids[i] != '*') {
                                obj.pendingTransfer++;
                                sqlDbQuery('INSERT INTO eventids VALUES ($1, $2)', [docs[0].id, event.ids[i]], function(){ if(func){ func(); } });
                            }
                        }
                    }
                });
            };
            obj.GetEvents = function (ids, domain, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1";
                    if (filter != null) {
                        query = query + " AND action = $2";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    query = query + 'JOIN eventids ON id = fkid WHERE (domain = $1 AND (target IN (' + dbMergeSqlArray(ids) + '))';
                    if (filter != null) {
                        query = query + " AND action = $2";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC ";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1";
                    if (filter != null) {
                        query = query + " AND action = $2) ORDER BY time DESC LIMIT $3";
                        dataarray.push(filter);
                    } else {
                        query = query + ") ORDER BY time DESC LIMIT $2";
                    }
                } else {
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND (target IN (" + dbMergeSqlArray(ids) + "))";
                    if (filter != null) {
                        query = query + " AND action = $2) GROUP BY id ORDER BY time DESC LIMIT $3";
                        dataarray.push(filter);
                    } else {
                        query = query + ") GROUP BY id ORDER BY time DESC LIMIT $2";
                    }
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);                
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1 AND userid = $2";
                    if (filter != null) {
                        query = query + " AND action = $3";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    query = query + 'JOIN eventids ON id = fkid WHERE (domain = $1 AND userid = $2 AND (target IN (' + dbMergeSqlArray(ids) + '))';
                    if (filter != null) {
                        query = query + " AND action = $3";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1 AND userid = $2";
                    if (filter != null) {
                        query = query + " AND action = $3) ORDER BY time DESC LIMIT $4";
                        dataarray.push(filter);
                    } else {
                        query = query + ") ORDER BY time DESC LIMIT $3";
                    }
                } else {
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND userid = $2 AND (target IN (" + dbMergeSqlArray(ids) + "))";
                    if (filter != null) {
                        query = query + " AND action = $3) GROUP BY id ORDER BY time DESC LIMIT $4";
                        dataarray.push(filter);
                    } else {
                        query = query + ") GROUP BY id ORDER BY time DESC LIMIT $3";
                    }
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) {
                if (ids.indexOf('*') >= 0) {
                    sqlDbQuery('SELECT doc FROM events WHERE ((domain = $1) AND (time BETWEEN $2 AND $3)) ORDER BY time', [domain, start, end], func);
                } else {
                    sqlDbQuery('SELECT doc FROM events JOIN eventids ON id = fkid WHERE ((domain = $1) AND (target IN (' + dbMergeSqlArray(ids) + ')) AND (time BETWEEN $2 AND $3)) GROUP BY id ORDER BY time', [domain, start, end], func);
                }
            };
            //obj.GetUserLoginEvents = function (domain, userid, func) { } // TODO
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = $1 AND domain = $2";
                var dataarray = [nodeid, domain];
                if (filter != null) {
                    query = query + " AND action = $3) ORDER BY time DESC LIMIT $4";
                    dataarray.push(filter);
                } else {
                    query = query + ") ORDER BY time DESC LIMIT $3";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = $1) AND (domain = $2) AND ((userid = $3) OR (userid IS NULL)) ";
                var dataarray = [nodeid, domain, userid];
                if (filter != null) {
                    query = query + "AND (action = $4) ORDER BY time DESC LIMIT $5";
                    dataarray.push(filter);
                } else {
                    query = query + "ORDER BY time DESC LIMIT $4";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.RemoveAllEvents = function (domain) { sqlDbQuery('DELETE FROM events', null, function (err, docs) { }); };
            obj.RemoveAllNodeEvents = function (domain, nodeid) { if ((domain == null) || (nodeid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = $1 AND nodeid = $2', [domain, nodeid], function (err, docs) { }); };
            obj.RemoveAllUserEvents = function (domain, userid) { if ((domain == null) || (userid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = $1 AND userid = $2', [domain, userid], function (err, docs) { }); };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) { sqlDbQuery('SELECT COUNT(*) FROM events WHERE action = \'authfail\' AND domain = $1 AND userid = $2 AND time > $3', [domainid, userid, lastlogin], function (err, response) { func(err == null ? response[0]['COUNT(*)'] : 0); }); }

            // Database actions on the power collection
            obj.getAllPower = function (func) { sqlDbQuery('SELECT doc FROM power', null, func); };
            obj.storePowerEvent = function (event, multiServer, func) { obj.dbCounters.powerSet++; if (multiServer != null) { event.server = multiServer.serverid; } sqlDbQuery('INSERT INTO power VALUES (NULL, $1, $2, $3)', [event.time, event.nodeid ? event.nodeid : null, JSON.stringify(event)], func); };
            obj.getPowerTimeline = function (nodeid, func) { sqlDbQuery('SELECT doc FROM power WHERE ((nodeid = $1) OR (nodeid = \'*\')) ORDER BY time ASC', [nodeid], func); };
            obj.removeAllPowerEvents = function () { sqlDbQuery('DELETE FROM power', null, function (err, docs) { }); };
            obj.removeAllPowerEventsForNode = function (nodeid) { if (nodeid == null) return; sqlDbQuery('DELETE FROM power WHERE nodeid = $1', [nodeid], function (err, docs) { }); };

            // Database actions on the SMBIOS collection
            obj.GetAllSMBIOS = function (func) { sqlDbQuery('SELECT doc FROM smbios', null, func); };
            obj.SetSMBIOS = function (smbios, func) { var expire = new Date(smbios.time); expire.setMonth(expire.getMonth() + 6); sqlDbQuery('INSERT INTO smbios VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET time = $2, expire = $3, doc = $4', [smbios._id, smbios.time, expire, JSON.stringify(smbios)], func); };
            obj.RemoveSMBIOS = function (id) { sqlDbQuery('DELETE FROM smbios WHERE id = $1', [id], function (err, docs) { }); };
            obj.GetSMBIOS = function (id, func) { sqlDbQuery('SELECT doc FROM smbios WHERE id = $1', [id], func); };

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) { sqlDbQuery('INSERT INTO serverstats VALUES ($1, $2, $3) ON CONFLICT (time) DO UPDATE SET expire = $2, doc = $3', [data.time, data.expire, JSON.stringify(data)], func); };
            obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); sqlDbQuery('SELECT doc FROM serverstats WHERE time > $1', [t], func); }; // TODO: Expire old entries

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) { sqlDbQuery('SELECT doc FROM main WHERE type = "cfile" ORDER BY id', func); }

            // Get database information (TODO: Complete this)
            obj.getDbStats = function (func) {
                obj.stats = { c: 4 };
                sqlDbQuery('SELECT COUNT(*) FROM main', null, function (err, response) { obj.stats.meshcentral = (err == null ? response[0]['COUNT(*)'] : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM serverstats', null, function (err, response) { obj.stats.serverstats = (err == null ? response[0]['COUNT(*)'] : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM power', null, function (err, response) { obj.stats.power = (err == null ? response[0]['COUNT(*)'] : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM smbios', null, function (err, response) { obj.stats.smbios = (err == null ? response[0]['COUNT(*)'] : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { sqlDbQuery('INSERT INTO plugin VALUES (NULL, $1)', [JSON.stringify(plugin)], func); }; // Add a plugin
                obj.getPlugins = function (func) { sqlDbQuery('SELECT JSON_INSERT(doc, "$._id", id) as doc FROM plugin', null, func); }; // Get all plugins
                obj.getPlugin = function (id, func) { sqlDbQuery('SELECT JSON_INSERT(doc, "$._id", id) as doc FROM plugin WHERE id = $1', [id], func); }; // Get plugin
                obj.deletePlugin = function (id, func) { sqlDbQuery('DELETE FROM plugin WHERE id = $1', [id], func); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { sqlDbQuery('UPDATE plugin SET doc=JSON_SET(doc,"$.status",$1) WHERE id=$2', [status,id], func); };
                obj.updatePlugin = function (id, args, func) { delete args._id; sqlDbQuery('UPDATE plugin SET doc=json_patch(doc,$1) WHERE id=$2', [JSON.stringify(args),id], func); };
            }
        } else if (obj.databaseType == DB_ACEBASE) {
            // Database actions on the main collection. AceBase: https://github.com/appy-one/acebase
            obj.Set = function (data, func) {
                data = common.escapeLinksFieldNameEx(data);
                var xdata = performTypedRecordEncrypt(data);
                obj.dbCounters.fileSet++;
                obj.file.ref('meshcentral').child(encodeURIComponent(xdata._id)).set(common.aceEscapeFieldNames(xdata)).then(function (ref) { if (func) { func(); } })
            };
            obj.Get = function (id, func) {
                obj.file.ref('meshcentral').child(encodeURIComponent(id)).get(function (snapshot) {
                    if (snapshot.exists()) { func(null, performTypedRecordDecrypt([common.aceUnEscapeFieldNames(snapshot.val())])); } else { func(null, []); }
                });
            };
            obj.GetAll = function (func) {
                obj.file.ref('meshcentral').get(function(snapshot) {
                    const val = snapshot.val();
                    const docs = Object.keys(val).map(function(key) { return val[key]; });
                    func(null, common.aceUnEscapeAllFieldNames(docs));
                });
            };
            obj.GetHash = function (id, func) {
                obj.file.ref('meshcentral').child(encodeURIComponent(id)).get({ include: ['hash'] }, function (snapshot) {
                    if (snapshot.exists()) { func(null, snapshot.val()); } else { func(null, null); }
                });
            };
            obj.GetAllTypeNoTypeField = function (type, domain, func) {
                obj.file.query('meshcentral').filter('type', '==', type).filter('domain', '==', domain).get({ exclude: ['type'] }, function (snapshots) {
                    const docs = [];
                    for (var i in snapshots) { const x = snapshots[i].val(); docs.push(x); }
                    func(null, common.aceUnEscapeAllFieldNames(docs));
                });
            }
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (meshes.length == 0) { func(null, []); return; }
                var query = obj.file.query('meshcentral').skip(skip).take(limit).filter('type', '==', type).filter('domain', '==', domain);
                if (id) { query = query.filter('_id', '==', id); }
                if (extrasids == null) {
                    query = query.filter('meshid', 'in', meshes);
                    query.get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); });
                } else {
                    // TODO: This is a slow query as we did not find a filter-or-filter, so we query everything and filter manualy.
                    query.get(function (snapshots) {
                        const docs = [];
                        for (var i in snapshots) { const x = snapshots[i].val(); if ((extrasids.indexOf(x._id) >= 0) || (meshes.indexOf(x.meshid) >= 0)) { docs.push(x); } }
                        func(null, performTypedRecordDecrypt(docs));
                    });
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                var query = obj.file.query('meshcentral').filter('type', '==', type).filter('domain', '==', domain).filter('nodeid', 'in', nodes);
                if (id) { query = query.filter('_id', '==', id); }
                query.get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); });
            };
            obj.GetAllType = function (type, func) {
                obj.file.query('meshcentral').filter('type', '==', type).get(function (snapshots) {
                    const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); }
                    func(null, common.aceUnEscapeAllFieldNames(performTypedRecordDecrypt(docs)));
                });
            };
            obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.query('meshcentral').filter('_id', 'in', ids).filter('domain', '==', domain).filter('type', '==', type).get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithEmail = function (domain, email, func) { obj.file.query('meshcentral').filter('type', '==', 'user').filter('domain', '==', domain).filter('email', '==', email).get({ exclude: ['type'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithVerifiedEmail = function (domain, email, func) { obj.file.query('meshcentral').filter('type', '==', 'user').filter('domain', '==', domain).filter('email', '==', email).filter('emailVerified', '==', true).get({ exclude: ['type'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); }); };
            obj.Remove = function (id, func) { obj.file.ref('meshcentral').child(encodeURIComponent(id)).remove().then(function () { if (func) { func(); } }); };
            obj.RemoveAll = function (func) { obj.file.query('meshcentral').remove().then(function () { if (func) { func(); } }); };
            obj.RemoveAllOfType = function (type, func) { obj.file.query('meshcentral').filter('type', '==', type).remove().then(function () { if (func) { func(); } }); };
            obj.InsertMany = function (data, func) { var r = {}; for (var i in data) { const ref = obj.file.ref('meshcentral').child(encodeURIComponent(data[i]._id)); r[ref.key] = common.aceEscapeFieldNames(data[i]); } obj.file.ref('meshcentral').set(r).then(function (ref) { func(); }); }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id) { obj.file.query('meshcentral').filter('meshid', '==', id).remove(); obj.file.ref('meshcentral').child(encodeURIComponent('nt' + id)).remove(); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { obj.file.query('meshcentral').filter('domain', '==', domain).remove().then(function () { if (func) { func(); } }); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) { obj.file.query('meshcentral').filter('type', '==', 'node').filter('host', 'exists').filter('host', '!=', null).filter('intelamt', 'exists').get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); }); };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) { obj.file.query('meshcentral').filter('type', '==', 'node').filter('domain', '==', domainid).filter('mtype', '!=', mtype).filter('intelamt.uuid', '==', uuid).get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, performTypedRecordDecrypt(docs)); }); };
            obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { obj.file.query('meshcentral').filter('type', '==', type).filter('domain', '==', domainid).get({ snapshots: false }, function (snapshots) { func((snapshots.length > max), snapshots.length); }); } }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) { 
                obj.file.ref('events').get(function (snapshot) { 
                    const val = snapshot.val();
                    const docs = Object.keys(val).map(function(key) { return val[key]; });
                    func(null, docs);
                })
            };
            obj.StoreEvent = function (event, func) {
                if (typeof event.account == 'object') { event = Object.assign({}, event); event.account = common.aceEscapeFieldNames(event.account); }
                obj.dbCounters.eventsSet++;
                obj.file.ref('events').push(event).then(function (userRef) { if (func) { func(); } });
            };
            obj.GetEvents = function (ids, domain, filter, func) {
                // This request is slow since we have not found a .filter() that will take two arrays and match a single item.
                if (filter != null) {
                    obj.file.query('events').filter('domain', '==', domain).filter('action', '==', filter).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type'] }, function (snapshots) {
                        const docs = [];
                        for (var i in snapshots) {
                            const doc = snapshots[i].val();
                            if ((doc.ids == null) || (!Array.isArray(doc.ids))) continue;
                            var found = false;
                            for (var j in doc.ids) { if (ids.indexOf(doc.ids[j]) >= 0) { found = true; } } // Check if one of the items in both arrays matches
                            if (found) { delete doc.ids; if (typeof doc.account == 'object') { doc.account = common.aceUnEscapeFieldNames(doc.account); } docs.push(doc); }
                        }
                        func(null, docs);
                    });
                } else {
                    obj.file.query('events').filter('domain', '==', domain).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type'] }, function (snapshots) {
                        const docs = [];
                        for (var i in snapshots) {
                            const doc = snapshots[i].val();
                            if ((doc.ids == null) || (!Array.isArray(doc.ids))) continue;
                            var found = false;
                            for (var j in doc.ids) { if (ids.indexOf(doc.ids[j]) >= 0) { found = true; } } // Check if one of the items in both arrays matches
                            if (found) { delete doc.ids; if (typeof doc.account == 'object') { doc.account = common.aceUnEscapeFieldNames(doc.account); } docs.push(doc); }
                        }
                        func(null, docs);
                    });
                }
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                // This request is slow since we have not found a .filter() that will take two arrays and match a single item.
                // TODO: Request a new AceBase feature for a 'array:contains-one-of' filter:
                // obj.file.indexes.create('events', 'ids', { type: 'array' });
                // db.query('events').filter('ids', 'array:contains-one-of', ids)
                if (filter != null) {
                    obj.file.query('events').filter('domain', '==', domain).filter('action', '==', filter).take(limit).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type'] }, function (snapshots) {
                        const docs = [];
                        for (var i in snapshots) {
                            const doc = snapshots[i].val();
                            if ((doc.ids == null) || (!Array.isArray(doc.ids))) continue;
                            var found = false;
                            for (var j in doc.ids) { if (ids.indexOf(doc.ids[j]) >= 0) { found = true; } } // Check if one of the items in both arrays matches
                            if (found) { delete doc.ids; if (typeof doc.account == 'object') { doc.account = common.aceUnEscapeFieldNames(doc.account); } docs.push(doc); }
                        }
                        func(null, docs);
                    });
                } else {
                    obj.file.query('events').filter('domain', '==', domain).take(limit).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type'] }, function (snapshots) {
                        const docs = [];
                        for (var i in snapshots) {
                            const doc = snapshots[i].val();
                            if ((doc.ids == null) || (!Array.isArray(doc.ids))) continue;
                            var found = false;
                            for (var j in doc.ids) { if (ids.indexOf(doc.ids[j]) >= 0) { found = true; } } // Check if one of the items in both arrays matches
                            if (found) { delete doc.ids; if (typeof doc.account == 'object') { doc.account = common.aceUnEscapeFieldNames(doc.account); } docs.push(doc); }
                        }
                        func(null, docs);
                    });
                }
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                if (filter != null) {
                    obj.file.query('events').filter('domain', '==', domain).filter('userid', 'in', userid).filter('ids', 'in', ids).filter('action', '==', filter).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type', 'ids'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                } else {
                    obj.file.query('events').filter('domain', '==', domain).filter('userid', 'in', userid).filter('ids', 'in', ids).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type', 'ids'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                }
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                if (filter != null) {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('userid', 'in', userid).filter('ids', 'in', ids).filter('action', '==', filter).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type', 'ids'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                } else {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('userid', 'in', userid).filter('ids', 'in', ids).sort('time', false).get({ exclude: ['_id', 'domain', 'node', 'type', 'ids'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                }
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) {
                obj.file.query('events').filter('domain', '==', domain).filter('ids', 'in', ids).filter('msgid', 'in', msgids).filter('time', 'between', [start, end]).sort('time', false).get({ exclude: ['type', '_id', 'domain', 'node'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
            };
            obj.GetUserLoginEvents = function (domain, userid, func) {
                obj.file.query('events').filter('domain', '==', domain).filter('action', 'in', ['authfail', 'login']).filter('userid', '==', userid).filter('msgArgs', 'exists').sort('time', false).get({ include: ['action', 'time', 'msgid', 'msgArgs', 'tokenName'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
            };
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                if (filter != null) {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('nodeid', '==', nodeid).filter('action', '==', filter).sort('time', false).get({ exclude: ['type', 'etype', '_id', 'domain', 'ids', 'node', 'nodeid'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                } else {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('nodeid', '==', nodeid).sort('time', false).get({ exclude: ['type', 'etype', '_id', 'domain', 'ids', 'node', 'nodeid'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                }
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                if (filter != null) {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('nodeid', '==', nodeid).filter('userid', '==', userid).filter('action', '==', filter).sort('time', false).get({ exclude: ['type', 'etype', '_id', 'domain', 'ids', 'node', 'nodeid'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                } else {
                    obj.file.query('events').take(limit).filter('domain', '==', domain).filter('nodeid', '==', nodeid).filter('userid', '==', userid).sort('time', false).get({ exclude: ['type', 'etype', '_id', 'domain', 'ids', 'node', 'nodeid'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                }
                obj.file.query('events').take(limit).filter('domain', '==', domain).filter('nodeid', '==', nodeid).filter('userid', '==', userid).sort('time', false).get({ exclude: ['type', 'etype', '_id', 'domain', 'ids', 'node', 'nodeid'] }, function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
            };
            obj.RemoveAllEvents = function (domain) {
                obj.file.query('events').filter('domain', '==', domain).remove().then(function () { if (func) { func(); } });;
            };
            obj.RemoveAllNodeEvents = function (domain, nodeid) {
                if ((domain == null) || (nodeid == null)) return;
                obj.file.query('events').filter('domain', '==', domain).filter('nodeid', '==', nodeid).remove().then(function () { if (func) { func(); } });;
            };
            obj.RemoveAllUserEvents = function (domain, userid) {
                if ((domain == null) || (userid == null)) return;
                obj.file.query('events').filter('domain', '==', domain).filter('userid', '==', userid).remove().then(function () { if (func) { func(); } });;
            };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) {
                obj.file.query('events').filter('domain', '==', domainid).filter('userid', '==', userid).filter('time', '>', lastlogin).sort('time', false).get({ snapshots: false }, function (snapshots) { func(null, snapshots.length); });
            }

            // Database actions on the power collection
            obj.getAllPower = function (func) {
                obj.file.ref('power').get(function (snapshot) {
                    const val = snapshot.val(); 
                    const docs = Object.keys(val).map(function(key) { return val[key]; }); 
                    func(null, docs); 
                });
            };
            obj.storePowerEvent = function (event, multiServer, func) {
                if (multiServer != null) { event.server = multiServer.serverid; }
                obj.file.ref('power').push(event).then(function (userRef) { if (func) { func(); } });
            };
            obj.getPowerTimeline = function (nodeid, func) {
                obj.file.query('power').filter('nodeid', 'in', ['*', nodeid]).sort('time').get({ exclude: ['_id', 'nodeid', 's'] }, function (snapshots) {
                    const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs);
                });
            };
            obj.removeAllPowerEvents = function () {
                obj.file.ref('power').remove().then(function () { if (func) { func(); } });
            };
            obj.removeAllPowerEventsForNode = function (nodeid) {
                if (nodeid == null) return;
                obj.file.query('power').filter('nodeid', '==', nodeid).remove().then(function () { if (func) { func(); } });
            };

            // Database actions on the SMBIOS collection
            if (obj.smbiosfile != null) {
                obj.GetAllSMBIOS = function (func) {
                    obj.file.ref('smbios').get(function (snapshot) { 
                        const val = snapshot.val(); 
                        const docs = Object.keys(val).map(function(key) { return val[key]; }); 
                        func(null, docs); 
                    });
                };
                obj.SetSMBIOS = function (smbios, func) {
                    obj.file.ref('meshcentral/' + encodeURIComponent(smbios._id)).set(smbios).then(function (ref) { if (func) { func(); } })
                };
                obj.RemoveSMBIOS = function (id) {
                    obj.file.query('smbios').filter('_id', '==', id).remove().then(function () { if (func) { func(); } });
                };
                obj.GetSMBIOS = function (id, func) {
                    obj.file.query('smbios').filter('_id', '==', id).get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); });
                };
            }

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) {
                obj.file.ref('stats').push(data).then(function (userRef) { if (func) { func(); } });
            };
            obj.GetServerStats = function (hours, func) {
                var t = new Date();
                t.setTime(t.getTime() - (60 * 60 * 1000 * hours));
                obj.file.query('stats').filter('time', '>', t).get({ exclude: ['_id', 'cpu'] }, function (snapshots) {
                    const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs);
                });
            };

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) {
                obj.file.query('meshcentral').filter('type', '==', 'cfile').sort('_id').get(function (snapshots) {
                    const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs);
                });
            }

            // Get database information
            obj.getDbStats = function (func) {
                obj.stats = { c: 5 };
                obj.file.ref('meshcentral').count().then(function (count) { obj.stats.meshcentral = count; if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                obj.file.ref('events').count().then(function (count) { obj.stats.events = count; if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                obj.file.ref('power').count().then(function (count) { obj.stats.power = count; if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                obj.file.ref('smbios').count().then(function (count) { obj.stats.smbios = count; if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                obj.file.ref('stats').count().then(function (count) { obj.stats.serverstats = count; if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { plugin.type = 'plugin'; obj.file.ref('plugin').child(encodeURIComponent(plugin._id)).set(plugin).then(function (ref) { if (func) { func(); } }) }; // Add a plugin
                obj.getPlugins = function (func) { 
                    obj.file.ref('plugin').get({ exclude: ['type'] }, function (snapshot) {
                        const val = snapshot.val();
                        const docs = Object.keys(val).map(function(key) { return val[key]; }).sort(function(a, b) { return a.name < b.name ? -1 : 1 }); 
                        func(null, docs); 
                    });
                }; // Get all plugins
                obj.getPlugin = function (id, func) { obj.file.query('plugin').filter('_id', '==', id).get(function (snapshots) { const docs = []; for (var i in snapshots) { docs.push(snapshots[i].val()); } func(null, docs); }); }; // Get plugin
                obj.deletePlugin = function (id, func) { obj.file.ref('plugin').child(encodeURIComponent(id)).remove().then(function () { if (func) { func(); } }); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { obj.file.ref('plugin').child(encodeURIComponent(id)).update({ status: status }).then(function (ref) { if (func) { func(); } }) };
                obj.updatePlugin = function (id, args, func) { delete args._id; obj.file.ref('plugin').child(encodeURIComponent(id)).set(args).then(function (ref) { if (func) { func(); } }) };
            }
        } else if (obj.databaseType == DB_POSTGRESQL) {
            // Database actions on the main collection (Postgres)
            obj.Set = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                value = common.escapeLinksFieldNameEx(value);
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('INSERT INTO main VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET type = $2, domain = $3, extra = $4, extraex = $5, doc = $6;', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, performTypedRecordEncrypt(value)], func);
            }
            obj.SetRaw = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('INSERT INTO main VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET type = $2, domain = $3, extra = $4, extraex = $5, doc = $6;', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, performTypedRecordEncrypt(value)], func);
            }
            obj.Get = function (_id, func) { sqlDbQuery('SELECT doc FROM main WHERE id = $1', [_id], function (err, docs) { if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); } func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAll = function (func) { sqlDbQuery('SELECT domain, doc FROM main', null, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetHash = function (id, func) { sqlDbQuery('SELECT doc FROM main WHERE id = $1', [id], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAllTypeNoTypeField = function (type, domain, func) { sqlDbQuery('SELECT doc FROM main WHERE type = $1 AND domain = $2', [type, domain], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (limit == 0) { limit = 0xFFFFFFFF; }
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra = ANY ($4)) LIMIT $5 OFFSET $6', [id, type, domain, meshes, limit, skip], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    if (extrasids == null) {
                        sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND (extra = ANY ($3)) LIMIT $4 OFFSET $5', [type, domain, meshes, limit, skip], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); }, true);
                    } else {
                        sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND ((extra = ANY ($3)) OR (id = ANY ($4))) LIMIT $5 OFFSET $6', [type, domain, meshes, extrasids, limit, skip], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                    }
                }
            };
            obj.CountAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, func) {
                if (id && (id != '')) {
                    sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra = ANY ($4))', [id, type, domain, meshes], function (err, docs) { func(err, docs); });
                } else {
                    if (extrasids == null) {
                        sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (type = $1) AND (domain = $2) AND (extra = ANY ($3))', [type, domain, meshes], function (err, docs) { func(err, docs); }, true);
                    } else {
                        sqlDbQuery('SELECT COUNT(doc) FROM main WHERE (type = $1) AND (domain = $2) AND ((extra = ANY ($3)) OR (id = ANY ($4)))', [type, domain, meshes, extrasids], function (err, docs) { func(err, docs); });
                    }
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE (id = $1) AND (type = $2) AND (domain = $3) AND (extra = ANY ($4))', [id, type, domain, nodes], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    sqlDbQuery('SELECT doc FROM main WHERE (type = $1) AND (domain = $2) AND (extra = ANY ($3))', [type, domain, nodes], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                }
            };
            obj.GetAllType = function (type, func) { sqlDbQuery('SELECT doc FROM main WHERE type = $1', [type], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAllIdsOfType = function (ids, domain, type, func) { sqlDbQuery('SELECT doc FROM main WHERE (id = ANY ($1)) AND domain = $2 AND type = $3', [ids, domain, type], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetUserWithEmail = function (domain, email, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extra = $2', [domain, 'email/' + email], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetUserWithVerifiedEmail = function (domain, email, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extra = $2', [domain, 'email/' + email], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.Remove = function (id, func) { sqlDbQuery('DELETE FROM main WHERE id = $1', [id], func); };
            obj.RemoveAll = function (func) { sqlDbQuery('DELETE FROM main', null, func); };
            obj.RemoveAllOfType = function (type, func) { sqlDbQuery('DELETE FROM main WHERE type = $1', [type], func); };
            obj.InsertMany = function (data, func) { var pendingOps = 0; for (var i in data) { pendingOps++; obj.SetRaw(data[i], function () { if (--pendingOps == 0) { func(); } }); } }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id, func) { sqlDbQuery('DELETE FROM main WHERE extra = $1', [id], function () { sqlDbQuery('DELETE FROM main WHERE id = $1', ['nt' + id], func); }); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { sqlDbQuery('DELETE FROM main WHERE domain = $1', [domain], func); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) { sqlDbQuery('SELECT doc FROM main WHERE (type = \'node\') AND (extraex IS NULL)', null, function (err, docs) { var r = []; if (err == null) { for (var i in docs) { if (docs[i].host != null && docs[i].intelamt != null) { r.push(docs[i]); } } } func(err, r); }); };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = $1 AND extraex = $2', [domainid, 'uuid/' + uuid], func); };
            obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { sqlDbExec('SELECT COUNT(id) FROM main WHERE domain = $1 AND type = $2', [domainid, type], function (err, response) { func((response['COUNT(id)'] == null) || (response['COUNT(id)'] > max), response['COUNT(id)']) }); } }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) { sqlDbQuery('SELECT doc FROM events', null, func); };
            obj.StoreEvent = function (event, func) {
                obj.dbCounters.eventsSet++;
                sqlDbQuery('INSERT INTO events VALUES (DEFAULT, $1, $2, $3, $4, $5, $6) RETURNING id', [event.time, ((typeof event.domain == 'string') ? event.domain : null), event.action, event.nodeid ? event.nodeid : null, event.userid ? event.userid : null, event], function (err, docs) {
                    if(func){ func(); }
                    if (docs.id) {
                        for (var i in event.ids) {
                            if (event.ids[i] != '*') {
                                obj.pendingTransfer++;
                                sqlDbQuery('INSERT INTO eventids VALUES ($1, $2)', [docs.id, event.ids[i]], function(){ if(func){ func(); } });
                            }
                        }
                    }
                });
            };
            obj.GetEvents = function (ids, domain, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain]; 
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1";
                    if (filter != null) {
                        query = query + " AND action = $2";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND (target = ANY ($2))";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = $3";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1";
                    if (filter != null) {
                        query = query + " AND action = $2) ORDER BY time DESC LIMIT $3";
                        dataarray.push(filter);
                    } else {
                        query = query + ") ORDER BY time DESC LIMIT $2";
                    }
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND (target = ANY ($2))";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = $3) ORDER BY time DESC LIMIT $4";
                        dataarray.push(filter);
                    } else {
                        query = query + ") ORDER BY time DESC LIMIT $3";
                    }
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1 AND userid = $2";
                    if (filter != null) {
                        query = query + " AND action = $3";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND userid = $2 AND (target = ANY ($3))";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = $4";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = $1 AND userid = $2";
                    if (filter != null) {
                        query = query + " AND action = $3) ORDER BY time DESC LIMIT $4 ";
                        dataarray.push(filter);
                    } else {
                        query = query + ") ORDER BY time DESC LIMIT $3";
                    }
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = $1 AND userid = $2 AND (target = ANY ($3))";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = $4) GROUP BY id ORDER BY time DESC LIMIT $5";
                        dataarray.push(filter);
                    } else {
                        query = query + ") GROUP BY id ORDER BY time DESC LIMIT $4";
                    }
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) {
                if (ids.indexOf('*') >= 0) {
                    sqlDbQuery('SELECT doc FROM events WHERE ((domain = $1) AND (time BETWEEN $2 AND $3)) ORDER BY time', [domain, start, end], func);
                } else {
                    sqlDbQuery('SELECT doc FROM events JOIN eventids ON id = fkid WHERE ((domain = $1) AND (target = ANY ($2)) AND (time BETWEEN $3 AND $4)) GROUP BY id ORDER BY time', [domain, ids, start, end], func);
                }
            };
            //obj.GetUserLoginEvents = function (domain, userid, func) { } // TODO
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = $1 AND domain = $2";
                var dataarray = [nodeid, domain];
                if (filter != null) {
                    query = query + " AND action = $3) ORDER BY time DESC LIMIT $4";
                    dataarray.push(filter);
                } else {
                    query = query + ") ORDER BY time DESC LIMIT $3";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = $1 AND domain = $2 AND ((userid = $3) OR (userid IS NULL))";
                var dataarray = [nodeid, domain, userid];
                if (filter != null) {
                    query = query + "  AND action = $4) ORDER BY time DESC LIMIT $5";
                    dataarray.push(filter);
                } else {
                    query = query + ") ORDER BY time DESC LIMIT $4";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.RemoveAllEvents = function (domain) { sqlDbQuery('DELETE FROM events', null, function (err, docs) { }); };
            obj.RemoveAllNodeEvents = function (domain, nodeid) { if ((domain == null) || (nodeid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = $1 AND nodeid = $2', [domain, nodeid], function (err, docs) { }); };
            obj.RemoveAllUserEvents = function (domain, userid) { if ((domain == null) || (userid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = $1 AND userid = $2', [domain, userid], function (err, docs) { }); };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) { sqlDbQuery('SELECT COUNT(*) FROM events WHERE action = \'authfail\' AND domain = $1 AND userid = $2 AND time > $3', [domainid, userid, lastlogin], function (err, response, raw) { func(err == null ? parseInt(raw.rows[0].count) : 0); }); }

            // Database actions on the power collection
            obj.getAllPower = function (func) { sqlDbQuery('SELECT doc FROM power', null, func); };
            obj.storePowerEvent = function (event, multiServer, func) { obj.dbCounters.powerSet++; if (multiServer != null) { event.server = multiServer.serverid; } sqlDbQuery('INSERT INTO power VALUES (DEFAULT, $1, $2, $3)', [event.time, event.nodeid ? event.nodeid : null, event], func); };
            obj.getPowerTimeline = function (nodeid, func) { sqlDbQuery('SELECT doc FROM power WHERE ((nodeid = $1) OR (nodeid = \'*\')) ORDER BY time ASC', [nodeid], func); };
            obj.removeAllPowerEvents = function () { sqlDbQuery('DELETE FROM power', null, function (err, docs) { }); };
            obj.removeAllPowerEventsForNode = function (nodeid) { if (nodeid == null) return; sqlDbQuery('DELETE FROM power WHERE nodeid = $1', [nodeid], function (err, docs) { }); };

            // Database actions on the SMBIOS collection
            obj.GetAllSMBIOS = function (func) { sqlDbQuery('SELECT doc FROM smbios', null, func); };
            obj.SetSMBIOS = function (smbios, func) { var expire = new Date(smbios.time); expire.setMonth(expire.getMonth() + 6); sqlDbQuery('INSERT INTO smbios VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET time = $2, expire = $3, doc = $4', [smbios._id, smbios.time, expire, smbios], func); };
            obj.RemoveSMBIOS = function (id) { sqlDbQuery('DELETE FROM smbios WHERE id = $1', [id], function (err, docs) { }); };
            obj.GetSMBIOS = function (id, func) { sqlDbQuery('SELECT doc FROM smbios WHERE id = $1', [id], func); };

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) { sqlDbQuery('INSERT INTO serverstats VALUES ($1, $2, $3) ON CONFLICT (time) DO UPDATE SET expire = $2, doc = $3', [data.time, data.expire, data], func); };
            obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); sqlDbQuery('SELECT doc FROM serverstats WHERE time > $1', [t], func); }; // TODO: Expire old entries

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) { sqlDbQuery('SELECT doc FROM main WHERE type = "cfile" ORDER BY id', func); }

            // Get database information (TODO: Complete this)
            obj.getDbStats = function (func) {
                obj.stats = { c: 4 };
                sqlDbQuery('SELECT COUNT(*) FROM main', null, function (err, response, raw) { obj.stats.meshcentral = (err == null ? parseInt(raw.rows[0].count) : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM serverstats', null, function (err, response, raw) { obj.stats.serverstats = (err == null ? parseInt(raw.rows[0].count) : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM power', null, function (err, response, raw) { obj.stats.power = (err == null ? parseInt(raw.rows[0].count) : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbQuery('SELECT COUNT(*) FROM smbios', null, function (err, response, raw) { obj.stats.smbios = (err == null ? parseInt(raw.rows[0].count) : 0); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { sqlDbQuery('INSERT INTO plugin VALUES (DEFAULT, $1)', [plugin], func); }; // Add a plugin
                obj.getPlugins = function (func) { sqlDbQuery("SELECT doc::jsonb || ('{\"_id\":' || plugin.id || '}')::jsonb as doc FROM plugin", null, func); }; // Get all plugins
                obj.getPlugin = function (id, func) { sqlDbQuery("SELECT doc::jsonb || ('{\"_id\":' || plugin.id || '}')::jsonb as  doc FROM plugin WHERE id = $1", [id], func); }; // Get plugin
                obj.deletePlugin = function (id, func) { sqlDbQuery('DELETE FROM plugin WHERE id = $1', [id], func); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { sqlDbQuery("UPDATE plugin SET doc= jsonb_set(doc::jsonb,'{status}',$1) WHERE id=$2", [status,id], func); };
                obj.updatePlugin = function (id, args, func) { delete args._id; sqlDbQuery('UPDATE plugin SET doc= doc::jsonb || ($1) WHERE id=$2', [args,id], func); };
            }
        } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL)) {
            // Database actions on the main collection (MariaDB or MySQL)
            obj.Set = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                value = common.escapeLinksFieldNameEx(value);
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('REPLACE INTO main VALUE (?, ?, ?, ?, ?, ?)', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, JSON.stringify(performTypedRecordEncrypt(value))], func);
            }
            obj.SetRaw = function (value, func) {
                obj.dbCounters.fileSet++;
                var extra = null, extraex = null;
                if (value.meshid) { extra = value.meshid; } else if (value.email) { extra = 'email/' + value.email; } else if (value.nodeid) { extra = value.nodeid; }
                if ((value.type == 'node') && (value.intelamt != null) && (value.intelamt.uuid != null)) { extraex = 'uuid/' + value.intelamt.uuid; }
                if (value._id == null) { value._id = require('crypto').randomBytes(16).toString('hex'); }
                sqlDbQuery('REPLACE INTO main VALUE (?, ?, ?, ?, ?, ?)', [value._id, (value.type ? value.type : null), ((value.domain != null) ? value.domain : null), extra, extraex, JSON.stringify(performTypedRecordEncrypt(value))], func);
            }
            obj.Get = function (_id, func) { sqlDbQuery('SELECT doc FROM main WHERE id = ?', [_id], function (err, docs) { if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); } func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAll = function (func) { sqlDbQuery('SELECT domain, doc FROM main', null, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetHash = function (id, func) { sqlDbQuery('SELECT doc FROM main WHERE id = ?', [id], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAllTypeNoTypeField = function (type, domain, func) { sqlDbQuery('SELECT doc FROM main WHERE type = ? AND domain = ?', [type, domain], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (limit == 0) { limit = 0xFFFFFFFF; }
                if ((meshes == null) || (meshes.length == 0)) { meshes = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                if ((extrasids == null) || (extrasids.length == 0)) { extrasids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE id = ? AND type = ? AND domain = ? AND extra IN (?) LIMIT ? OFFSET ?', [id, type, domain, meshes, limit, skip], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    sqlDbQuery('SELECT doc FROM main WHERE type = ? AND domain = ? AND (extra IN (?) OR id IN (?)) LIMIT ? OFFSET ?', [type, domain, meshes, extrasids, limit, skip], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                }
            };
            obj.CountAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, func) {
                if ((meshes == null) || (meshes.length == 0)) { meshes = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                if ((extrasids == null) || (extrasids.length == 0)) { extrasids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                if (id && (id != '')) {
                    sqlDbQuery('SELECT COUNT(doc) FROM main WHERE id = ? AND type = ? AND domain = ? AND extra IN (?)', [id, type, domain, meshes], function (err, docs) { func(err, docs); });
                } else {
                    sqlDbQuery('SELECT COUNT(doc) FROM main WHERE type = ? AND domain = ? AND (extra IN (?) OR id IN (?))', [type, domain, meshes, extrasids], function (err, docs) { func(err, docs); });
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                if ((nodes == null) || (nodes.length == 0)) { nodes = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                if (id && (id != '')) {
                    sqlDbQuery('SELECT doc FROM main WHERE id = ? AND type = ? AND domain = ? AND extra IN (?)', [id, type, domain, nodes], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    sqlDbQuery('SELECT doc FROM main WHERE type = ? AND domain = ? AND extra IN (?)', [type, domain, nodes], function (err, docs) { if (err == null) { for (var i in docs) { delete docs[i].type } } func(err, performTypedRecordDecrypt(docs)); });
                }
            };
            obj.GetAllType = function (type, func) { sqlDbQuery('SELECT doc FROM main WHERE type = ?', [type], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetAllIdsOfType = function (ids, domain, type, func) {
                if ((ids == null) || (ids.length == 0)) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                sqlDbQuery('SELECT doc FROM main WHERE id IN (?) AND domain = ? AND type = ?', [ids, domain, type], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
            }
            obj.GetUserWithEmail = function (domain, email, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = ? AND extra = ?', [domain, 'email/' + email], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.GetUserWithVerifiedEmail = function (domain, email, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = ? AND extra = ?', [domain, 'email/' + email], function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); }
            obj.Remove = function (id, func) { sqlDbQuery('DELETE FROM main WHERE id = ?', [id], func); };
            obj.RemoveAll = function (func) { sqlDbQuery('DELETE FROM main', null, func); };
            obj.RemoveAllOfType = function (type, func) { sqlDbQuery('DELETE FROM main WHERE type = ?', [type], func); };
            obj.InsertMany = function (data, func) { var pendingOps = 0; for (var i in data) { pendingOps++; obj.SetRaw(data[i], function () { if (--pendingOps == 0) { func(); } }); } }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id, func) { sqlDbQuery('DELETE FROM main WHERE extra = ?', [id], function () { sqlDbQuery('DELETE FROM main WHERE id = ?', ['nt' + id], func); } ); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { sqlDbQuery('DELETE FROM main WHERE domain = ?', [domain], func); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) { sqlDbQuery('SELECT doc FROM main WHERE (type = "node") AND (extraex IS NULL)', null, function (err, docs) { var r = []; if (err == null) { for (var i in docs) { if (docs[i].host != null && docs[i].intelamt != null) { r.push(docs[i]); } } } func(err, r); }); };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) { sqlDbQuery('SELECT doc FROM main WHERE domain = ? AND extraex = ?', [domainid, 'uuid/' + uuid], func); };
            obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { sqlDbExec('SELECT COUNT(id) FROM main WHERE domain = ? AND type = ?', [domainid, type], function (err, response) { func((response['COUNT(id)'] == null) || (response['COUNT(id)'] > max), response['COUNT(id)']) }); } }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) { sqlDbQuery('SELECT doc FROM events', null, func); };
            obj.StoreEvent = function (event, func) {
                obj.dbCounters.eventsSet++;
                var batchQuery = [['INSERT INTO events VALUE (?, ?, ?, ?, ?, ?, ?)', [null, event.time, ((typeof event.domain == 'string') ? event.domain : null), event.action, event.nodeid ? event.nodeid : null, event.userid ? event.userid : null, JSON.stringify(event)]]];
                for (var i in event.ids) { if (event.ids[i] != '*') { batchQuery.push(['INSERT INTO eventids VALUE (LAST_INSERT_ID(), ?)', [event.ids[i]]]); } }
                sqlDbBatchExec(batchQuery, function (err, docs) { if (func != null) { func(err, docs); } });
            };
            obj.GetEvents = function (ids, domain, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = ?";
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = ? AND target IN (?)";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = ?";
                    if (filter != null) {
                        query = query + " AND action = ? ";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC LIMIT ?";
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = ? AND target IN (?)";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC LIMIT ?";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = ? AND userid = ?";
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC";
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = ? AND userid = ? AND target IN (?)";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC";
                }
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events ";
                var dataarray = [domain, userid];
                if (ids.indexOf('*') >= 0) {
                    query = query + "WHERE (domain = ? AND userid = ?";
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") ORDER BY time DESC LIMIT ?";
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    query = query + "JOIN eventids ON id = fkid WHERE (domain = ? AND userid = ? AND target IN (?)";
                    dataarray.push(ids);
                    if (filter != null) {
                        query = query + " AND action = ?";
                        dataarray.push(filter);
                    }
                    query = query + ") GROUP BY id ORDER BY time DESC LIMIT ?";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) {
                if (ids.indexOf('*') >= 0) {
                    sqlDbQuery('SELECT doc FROM events WHERE ((domain = ?) AND (time BETWEEN ? AND ?)) ORDER BY time', [domain, start, end], func);
                } else {
                    if (ids.length == 0) { ids = ''; } // MySQL can't handle a query with IN() on an empty array, we have to use an empty string instead.
                    sqlDbQuery('SELECT doc FROM events JOIN eventids ON id = fkid WHERE ((domain = ?) AND (target IN (?)) AND (time BETWEEN ? AND ?)) GROUP BY id ORDER BY time', [domain, ids, start, end], func);
                }
            };
            //obj.GetUserLoginEvents = function (domain, userid, func) { } // TODO
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = ? AND domain = ?";
                var dataarray = [nodeid, domain];
                if (filter != null) {
                    query = query + " AND action = ?) ORDER BY time DESC LIMIT ?";
                    dataarray.push(filter);
                } else {
                    query = query + ") ORDER BY time DESC LIMIT ?";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                var query = "SELECT doc FROM events WHERE (nodeid = ? AND domain = ? AND ((userid = ?) OR (userid IS NULL))";
                var dataarray = [nodeid, domain, userid];
                if (filter != null) {
                    query = query + " AND action = ?) ORDER BY time DESC LIMIT ?";
                    dataarray.push(filter);
                } else {
                    query = query + ") ORDER BY time DESC LIMIT ?";
                }
                dataarray.push(limit);
                sqlDbQuery(query, dataarray, func);
            };
            obj.RemoveAllEvents = function (domain) { sqlDbQuery('DELETE FROM events', null, function (err, docs) { }); };
            obj.RemoveAllNodeEvents = function (domain, nodeid) { if ((domain == null) || (nodeid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = ? AND nodeid = ?', [domain, nodeid], function (err, docs) { }); };
            obj.RemoveAllUserEvents = function (domain, userid) { if ((domain == null) || (userid == null)) return; sqlDbQuery('DELETE FROM events WHERE domain = ? AND userid = ?', [domain, userid], function (err, docs) { }); };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) { sqlDbExec('SELECT COUNT(id) FROM events WHERE action = "authfail" AND domain = ? AND userid = ? AND time > ?', [domainid, userid, lastlogin], function (err, response) { func(err == null ? response['COUNT(id)'] : 0); }); }

            // Database actions on the power collection
            obj.getAllPower = function (func) { sqlDbQuery('SELECT doc FROM power', null, func); };
            obj.storePowerEvent = function (event, multiServer, func) { obj.dbCounters.powerSet++; if (multiServer != null) { event.server = multiServer.serverid; } sqlDbQuery('INSERT INTO power VALUE (?, ?, ?, ?)', [null, event.time, event.nodeid ? event.nodeid : null, JSON.stringify(event)], func); };
            obj.getPowerTimeline = function (nodeid, func) { sqlDbQuery('SELECT doc FROM power WHERE ((nodeid = ?) OR (nodeid = "*")) ORDER BY time ASC', [nodeid], func); };
            obj.removeAllPowerEvents = function () { sqlDbQuery('DELETE FROM power', null, function (err, docs) { }); };
            obj.removeAllPowerEventsForNode = function (nodeid) { if (nodeid == null) return; sqlDbQuery('DELETE FROM power WHERE nodeid = ?', [nodeid], function (err, docs) { }); };

            // Database actions on the SMBIOS collection
            obj.GetAllSMBIOS = function (func) { sqlDbQuery('SELECT doc FROM smbios', null, func); };
            obj.SetSMBIOS = function (smbios, func) { var expire = new Date(smbios.time); expire.setMonth(expire.getMonth() + 6); sqlDbQuery('REPLACE INTO smbios VALUE (?, ?, ?, ?)', [smbios._id, smbios.time, expire, JSON.stringify(smbios)], func); };
            obj.RemoveSMBIOS = function (id) { sqlDbQuery('DELETE FROM smbios WHERE id = ?', [id], function (err, docs) { }); };
            obj.GetSMBIOS = function (id, func) { sqlDbQuery('SELECT doc FROM smbios WHERE id = ?', [id], func); };

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) { sqlDbQuery('REPLACE INTO serverstats VALUE (?, ?, ?)', [data.time, data.expire, JSON.stringify(data)], func); };
            obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); sqlDbQuery('SELECT doc FROM serverstats WHERE time > ?', [t], func); };

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) { sqlDbQuery('SELECT doc FROM main WHERE type = "cfile" ORDER BY id', func); }
            
            // Get database information (TODO: Complete this)
            obj.getDbStats = function (func) {
                obj.stats = { c: 4 };
                sqlDbExec('SELECT COUNT(id) FROM main', null, function (err, response) { obj.stats.meshcentral = Number(response['COUNT(id)']); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbExec('SELECT COUNT(time) FROM serverstats', null, function (err, response) { obj.stats.serverstats = Number(response['COUNT(time)']); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbExec('SELECT COUNT(id) FROM power', null, function (err, response) { obj.stats.power = Number(response['COUNT(id)']); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
                sqlDbExec('SELECT COUNT(id) FROM smbios', null, function (err, response) { obj.stats.smbios = Number(response['COUNT(id)']); if (--obj.stats.c == 0) { delete obj.stats.c; func(obj.stats); } });
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { sqlDbQuery('INSERT INTO plugin VALUE (?, ?)', [null, JSON.stringify(plugin)], func); }; // Add a plugin
                obj.getPlugins = function (func) { sqlDbQuery('SELECT JSON_INSERT(doc, "$._id", id) as doc FROM plugin', null, func); }; // Get all plugins
                obj.getPlugin = function (id, func) { sqlDbQuery('SELECT JSON_INSERT(doc, "$._id", id) as doc FROM plugin WHERE id = ?', [id], func); }; // Get plugin
                obj.deletePlugin = function (id, func) { sqlDbQuery('DELETE FROM plugin WHERE id = ?', [id], func); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { sqlDbQuery('UPDATE meshcentral.plugin SET doc=JSON_SET(doc,"$.status",?) WHERE id=?', [status,id], func); };
                obj.updatePlugin = function (id, args, func) { delete args._id; sqlDbQuery('UPDATE meshcentral.plugin SET doc=JSON_MERGE_PATCH(doc,?) WHERE id=?', [JSON.stringify(args),id], func); };
            }
        } else if (obj.databaseType == DB_MONGODB) {
            // Database actions on the main collection (MongoDB)

            // Bulk operations
            if (parent.config.settings.mongodbbulkoperations) {
                obj.Set = function (data, func) { // Fast Set operation using bulkWrite(), this is much faster then using replaceOne()
                    if (obj.filePendingSet == false) {
                        // Perform the operation now
                        obj.dbCounters.fileSet++;
                        obj.filePendingSet = true; obj.filePendingSets = null;
                        if (func != null) { obj.filePendingCbs = [func]; }
                        obj.file.bulkWrite([{ replaceOne: { filter: { _id: data._id }, replacement: performTypedRecordEncrypt(common.escapeLinksFieldNameEx(data)), upsert: true } }], fileBulkWriteCompleted);
                    } else {
                        // Add this operation to the pending list
                        obj.dbCounters.fileSetPending++;
                        if (obj.filePendingSets == null) { obj.filePendingSets = {} }
                        obj.filePendingSets[data._id] = data;
                        if (func != null) { if (obj.filePendingCb == null) { obj.filePendingCb = [func]; } else { obj.filePendingCb.push(func); } }
                    }
                };

                obj.Get = function (id, func) { // Fast Get operation using a bulk find() to reduce round trips to the database.
                    // Encode arguments into return function if any are present.
                    var func2 = func;
                    if (arguments.length > 2) {
                        var parms = [func];
                        for (var parmx = 2; parmx < arguments.length; ++parmx) { parms.push(arguments[parmx]); }
                        var func2 = function _func2(arg1, arg2) {
                            var userCallback = _func2.userArgs.shift();
                            _func2.userArgs.unshift(arg2);
                            _func2.userArgs.unshift(arg1);
                            userCallback.apply(obj, _func2.userArgs);
                        };
                        func2.userArgs = parms;
                    }

                    if (obj.filePendingGets == null) {
                        // No pending gets, perform the operation now.
                        obj.filePendingGets = {};
                        obj.filePendingGets[id] = [func2];
                        obj.file.find({ _id: id }).toArray(fileBulkReadCompleted);
                    } else {
                        // Add get to pending list.
                        if (obj.filePendingGet == null) { obj.filePendingGet = {}; }
                        if (obj.filePendingGet[id] == null) { obj.filePendingGet[id] = [func2]; } else { obj.filePendingGet[id].push(func2); }
                    }
                };
            } else {
                obj.Set = function (data, func) {
                    obj.dbCounters.fileSet++;
                    data = common.escapeLinksFieldNameEx(data);
                    obj.file.replaceOne({ _id: data._id }, performTypedRecordEncrypt(data), { upsert: true }, func);
                };
                obj.Get = function (id, func) {
                    if (arguments.length > 2) {
                        var parms = [func];
                        for (var parmx = 2; parmx < arguments.length; ++parmx) { parms.push(arguments[parmx]); }
                        var func2 = function _func2(arg1, arg2) {
                            var userCallback = _func2.userArgs.shift();
                            _func2.userArgs.unshift(arg2);
                            _func2.userArgs.unshift(arg1);
                            userCallback.apply(obj, _func2.userArgs);
                        };
                        func2.userArgs = parms;
                        obj.file.find({ _id: id }).toArray(function (err, docs) {
                            if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); }
                            func2(err, performTypedRecordDecrypt(docs));
                        });
                    } else {
                        obj.file.find({ _id: id }).toArray(function (err, docs) {
                            if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); }
                            func(err, performTypedRecordDecrypt(docs));
                        });
                    }
                };
            }
            obj.GetAll = function (func) { obj.file.find({}).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetHash = function (id, func) { obj.file.find({ _id: id }).project({ _id: 0, hash: 1 }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }).project({ type: 0 }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (extrasids == null) {
                    const x = { type: type, domain: domain, meshid: { $in: meshes } };
                    if (id) { x._id = id; }
                    var f = obj.file.find(x, { type: 0 });
                    if (skip > 0) f = f.skip(skip); // Skip records
                    if (limit > 0) f = f.limit(limit); // Limit records
                    f.toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    const x = { type: type, domain: domain, $or: [ { meshid: { $in: meshes } }, { _id: { $in: extrasids } } ] };
                    if (id) { x._id = id; }
                    var f = obj.file.find(x, { type: 0 });
                    if (skip > 0) f = f.skip(skip); // Skip records
                    if (limit > 0) f = f.limit(limit); // Limit records
                    f.toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
                }
            };
            obj.CountAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, func) {
                if (extrasids == null) {
                    const x = { type: type, domain: domain, meshid: { $in: meshes } };
                    if (id) { x._id = id; }
                    var f = obj.file.find(x, { type: 0 });
                    f.count(function (err, count) { func(err, count); });
                } else {
                    const x = { type: type, domain: domain, $or: [{ meshid: { $in: meshes } }, { _id: { $in: extrasids } }] };
                    if (id) { x._id = id; }
                    var f = obj.file.find(x, { type: 0 });
                    f.count(function (err, count) { func(err, count); });
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                var x = { type: type, domain: domain, nodeid: { $in: nodes } };
                if (id) { x._id = id; }
                obj.file.find(x, { type: 0 }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
            };
            obj.GetAllType = function (type, func) { obj.file.find({ type: type }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.find({ type: type, domain: domain, _id: { $in: ids } }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithVerifiedEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email, emailVerified: true }).toArray(function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };

            // Bulk operations
            if (parent.config.settings.mongodbbulkoperations) {
                obj.Remove = function (id, func) { // Fast remove operation using a bulk find() to reduce round trips to the database.
                    if (obj.filePendingRemoves == null) {
                        // No pending removes, perform the operation now.
                        obj.dbCounters.fileRemove++;
                        obj.filePendingRemoves = {};
                        obj.filePendingRemoves[id] = [func];
                        obj.file.deleteOne({ _id: id }, fileBulkRemoveCompleted);
                    } else {
                        // Add remove to pending list.
                        obj.dbCounters.fileRemovePending++;
                        if (obj.filePendingRemove == null) { obj.filePendingRemove = {}; }
                        if (obj.filePendingRemove[id] == null) { obj.filePendingRemove[id] = [func]; } else { obj.filePendingRemove[id].push(func); }
                    }
                };
            } else {
                obj.Remove = function (id, func) { obj.dbCounters.fileRemove++; obj.file.deleteOne({ _id: id }, func); };
            }

            obj.RemoveAll = function (func) { obj.file.deleteMany({}, { multi: true }, func); };
            obj.RemoveAllOfType = function (type, func) { obj.file.deleteMany({ type: type }, { multi: true }, func); };
            obj.InsertMany = function (data, func) { obj.file.insertMany(data, func); }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id) { obj.file.deleteMany({ meshid: id }, { multi: true }); obj.file.deleteOne({ _id: 'nt' + id }); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { obj.file.deleteMany({ domain: domain }, { multi: true }, func); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) { obj.file.find({ type: 'node', host: { $exists: true, $ne: null }, intelamt: { $exists: true } }).toArray(func); };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) { obj.file.find({ type: 'node', domain: domainid, mtype: mtype, 'intelamt.uuid': uuid }).toArray(func); };

            // TODO: Starting in MongoDB 4.0.3, you should use countDocuments() instead of count() that is deprecated. We should detect MongoDB version and switch.
            // https://docs.mongodb.com/manual/reference/method/db.collection.countDocuments/
            //obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { obj.file.countDocuments({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max)); }); } }
            obj.isMaxType = function (max, type, domainid, func) {
                if (obj.file.countDocuments) {
                    if (max == null) { func(false); } else { obj.file.countDocuments({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max), count); }); }
                } else {
                    if (max == null) { func(false); } else { obj.file.count({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max), count); }); }
                }
            }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) { obj.eventsfile.find({}).toArray(func); };

            // Bulk operations
            if (parent.config.settings.mongodbbulkoperations) {
                obj.StoreEvent = function (event, func) { // Fast MongoDB event store using bulkWrite()
                    if (obj.eventsFilePendingSet == false) {
                        // Perform the operation now
                        obj.dbCounters.eventsSet++;
                        obj.eventsFilePendingSet = true; obj.eventsFilePendingSets = null;
                        if (func != null) { obj.eventsFilePendingCbs = [func]; }
                        obj.eventsfile.bulkWrite([{ insertOne: { document: event } }], eventsFileBulkWriteCompleted);
                    } else {
                        // Add this operation to the pending list
                        obj.dbCounters.eventsSetPending++;
                        if (obj.eventsFilePendingSets == null) { obj.eventsFilePendingSets = [] }
                        obj.eventsFilePendingSets.push(event);
                        if (func != null) { if (obj.eventsFilePendingCb == null) { obj.eventsFilePendingCb = [func]; } else { obj.eventsFilePendingCb.push(func); } }
                    }
                };
            } else {
                obj.StoreEvent = function (event, func) { obj.dbCounters.eventsSet++; obj.eventsfile.insertOne(event, func); };
            }

            obj.GetEvents = function (ids, domain, filter, func) {
                var finddata = { domain: domain,  ids: { $in: ids } };
                if (filter != null) finddata.action = filter;
                obj.eventsfile.find(finddata).project({ type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).toArray(func);
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                var finddata = { domain: domain, ids: { $in: ids } };
                if (filter != null) finddata.action = filter;
                obj.eventsfile.find(finddata).project({ type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).toArray(func);
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                var finddata = { domain: domain, $or: [{ ids: { $in: ids } }, { userid: userid }] };
                if (filter != null) finddata.action = filter; 
                obj.eventsfile.find(finddata).project({ type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).toArray(func);
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                var finddata = { domain: domain, $or: [{ ids: { $in: ids } }, { userid: userid }] };
                if (filter != null) finddata.action = filter; 
                obj.eventsfile.find(finddata).project({ type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).toArray(func);
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) { obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }], msgid: { $in: msgids }, time: { $gte: start, $lte: end } }).project({ type: 0, _id: 0, domain: 0, node: 0 }).sort({ time: 1 }).toArray(func); };
            obj.GetUserLoginEvents = function (domain, userid, func) { obj.eventsfile.find({ domain: domain, action: { $in: ['authfail', 'login'] }, userid: userid, msgArgs: { $exists: true } }).project({ action: 1, time: 1, msgid: 1, msgArgs: 1, tokenName: 1 }).sort({ time: -1 }).toArray(func); };
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                var finddata = { domain: domain, nodeid: nodeid };
                if (filter != null) finddata.action = filter;
                obj.eventsfile.find(finddata).project({ type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit).toArray(func);
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                var finddata = { domain: domain, nodeid: nodeid, userid: { $in: [userid, null] } };
                if (filter != null) finddata.action = filter;
                obj.eventsfile.find(finddata).project({ type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit).toArray(func);
            };
            obj.RemoveAllEvents = function (domain) { obj.eventsfile.deleteMany({ domain: domain }, { multi: true }); };
            obj.RemoveAllNodeEvents = function (domain, nodeid) { if ((domain == null) || (nodeid == null)) return; obj.eventsfile.deleteMany({ domain: domain, nodeid: nodeid }, { multi: true }); };
            obj.RemoveAllUserEvents = function (domain, userid) { if ((domain == null) || (userid == null)) return; obj.eventsfile.deleteMany({ domain: domain, userid: userid }, { multi: true }); };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) {
                if (obj.eventsfile.countDocuments) {
                    obj.eventsfile.countDocuments({ action: 'authfail', userid: userid, domain: domainid, time: { "$gte": lastlogin } }, function (err, count) { func((err == null) ? count : 0); });
                } else {
                    obj.eventsfile.count({ action: 'authfail', userid: userid, domain: domainid, time: { "$gte": lastlogin } }, function (err, count) { func((err == null) ? count : 0); });
                }
            }

            // Database actions on the power collection
            obj.getAllPower = function (func) { obj.powerfile.find({}).toArray(func); };

            // Bulk operations
            if (parent.config.settings.mongodbbulkoperations) {
                obj.storePowerEvent = function (event, multiServer, func) { // Fast MongoDB event store using bulkWrite()
                    if (multiServer != null) { event.server = multiServer.serverid; }
                    if (obj.powerFilePendingSet == false) {
                        // Perform the operation now
                        obj.dbCounters.powerSet++;
                        obj.powerFilePendingSet = true; obj.powerFilePendingSets = null;
                        if (func != null) { obj.powerFilePendingCbs = [func]; }
                        obj.powerfile.bulkWrite([{ insertOne: { document: event } }], powerFileBulkWriteCompleted);
                    } else {
                        // Add this operation to the pending list
                        obj.dbCounters.powerSetPending++;
                        if (obj.powerFilePendingSets == null) { obj.powerFilePendingSets = [] }
                        obj.powerFilePendingSets.push(event);
                        if (func != null) { if (obj.powerFilePendingCb == null) { obj.powerFilePendingCb = [func]; } else { obj.powerFilePendingCb.push(func); } }
                    }
                };
            } else {
                obj.storePowerEvent = function (event, multiServer, func) { obj.dbCounters.powerSet++; if (multiServer != null) { event.server = multiServer.serverid; } obj.powerfile.insertOne(event, func); };
            }

            obj.getPowerTimeline = function (nodeid, func) { obj.powerfile.find({ nodeid: { $in: ['*', nodeid] } }).project({ _id: 0, nodeid: 0, s: 0 }).sort({ time: 1 }).toArray(func); };
            obj.removeAllPowerEvents = function () { obj.powerfile.deleteMany({}, { multi: true }); };
            obj.removeAllPowerEventsForNode = function (nodeid) { if (nodeid == null) return; obj.powerfile.deleteMany({ nodeid: nodeid }, { multi: true }); };

            // Database actions on the SMBIOS collection
            obj.GetAllSMBIOS = function (func) { obj.smbiosfile.find({}).toArray(func); };
            obj.SetSMBIOS = function (smbios, func) { obj.smbiosfile.updateOne({ _id: smbios._id }, { $set: smbios }, { upsert: true }, func); };
            obj.RemoveSMBIOS = function (id) { obj.smbiosfile.deleteOne({ _id: id }); };
            obj.GetSMBIOS = function (id, func) { obj.smbiosfile.find({ _id: id }).toArray(func); };

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) { obj.serverstatsfile.insertOne(data, func); };
            obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); obj.serverstatsfile.find({ time: { $gt: t } }, { _id: 0, cpu: 0 }).toArray(func); };

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) { obj.file.find({ type: 'cfile' }).sort({ _id: 1 }).toArray(func); }

            // Get database information
            obj.getDbStats = function (func) {
                obj.stats = { c: 6 };
                obj.getStats(function (r) { obj.stats.recordTypes = r; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } })
                obj.file.stats().then(function (stats) { obj.stats[stats.ns] = { size: stats.size, count: stats.count, avgObjSize: stats.avgObjSize, capped: stats.capped }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } }, function () { if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.eventsfile.stats().then(function (stats) { obj.stats[stats.ns] = { size: stats.size, count: stats.count, avgObjSize: stats.avgObjSize, capped: stats.capped }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } }, function () { if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.powerfile.stats().then(function (stats) { obj.stats[stats.ns] = { size: stats.size, count: stats.count, avgObjSize: stats.avgObjSize, capped: stats.capped }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } }, function () { if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.smbiosfile.stats().then(function (stats) { obj.stats[stats.ns] = { size: stats.size, count: stats.count, avgObjSize: stats.avgObjSize, capped: stats.capped }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } }, function () { if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.serverstatsfile.stats().then(function (stats) { obj.stats[stats.ns] = { size: stats.size, count: stats.count, avgObjSize: stats.avgObjSize, capped: stats.capped }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } }, function () { if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
            }

            // Correct database information of obj.getDbStats before returning it
            function getDbStatsEx(data) {
                var r = {};
                if (data.recordTypes != null) { r = data.recordTypes; }
                try { r.smbios = data['meshcentral.smbios'].count; } catch (ex) { }
                try { r.power = data['meshcentral.power'].count; } catch (ex) { }
                try { r.events = data['meshcentral.events'].count; } catch (ex) { }
                try { r.serverstats = data['meshcentral.serverstats'].count; } catch (ex) { }
                return r;
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { plugin.type = 'plugin'; obj.pluginsfile.insertOne(plugin, func); }; // Add a plugin
                obj.getPlugins = function (func) { obj.pluginsfile.find({ type: 'plugin' }).project({ type: 0 }).sort({ name: 1 }).toArray(func); }; // Get all plugins
                obj.getPlugin = function (id, func) { id = require('mongodb').ObjectId(id); obj.pluginsfile.find({ _id: id }).sort({ name: 1 }).toArray(func); }; // Get plugin
                obj.deletePlugin = function (id, func) { id = require('mongodb').ObjectId(id); obj.pluginsfile.deleteOne({ _id: id }, func); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { id = require('mongodb').ObjectId(id); obj.pluginsfile.updateOne({ _id: id }, { $set: { status: status } }, func); };
                obj.updatePlugin = function (id, args, func) { delete args._id; id = require('mongodb').ObjectId(id); obj.pluginsfile.updateOne({ _id: id }, { $set: args }, func); };
            }

        } else {
            // Database actions on the main collection (NeDB and MongoJS)
            obj.Set = function (data, func) {
                obj.dbCounters.fileSet++;
                data = common.escapeLinksFieldNameEx(data);
                var xdata = performTypedRecordEncrypt(data); obj.file.update({ _id: xdata._id }, xdata, { upsert: true }, func);
            };
            obj.Get = function (id, func) {
                if (arguments.length > 2) {
                    var parms = [func];
                    for (var parmx = 2; parmx < arguments.length; ++parmx) { parms.push(arguments[parmx]); }
                    var func2 = function _func2(arg1, arg2) {
                        var userCallback = _func2.userArgs.shift();
                        _func2.userArgs.unshift(arg2);
                        _func2.userArgs.unshift(arg1);
                        userCallback.apply(obj, _func2.userArgs);
                    };
                    func2.userArgs = parms;
                    obj.file.find({ _id: id }, function (err, docs) {
                        if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); }
                        func2(err, performTypedRecordDecrypt(docs));
                    });
                } else {
                    obj.file.find({ _id: id }, function (err, docs) {
                        if ((docs != null) && (docs.length > 0) && (docs[0].links != null)) { docs[0] = common.unEscapeLinksFieldName(docs[0]); }
                        func(err, performTypedRecordDecrypt(docs));
                    });
                }
            };
            obj.GetAll = function (func) { obj.file.find({}, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetHash = function (id, func) { obj.file.find({ _id: id }, { _id: 0, hash: 1 }, func); };
            obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }, { type: 0 }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            //obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, domain, type, id, skip, limit, func) {
                //var x = { type: type, domain: domain, meshid: { $in: meshes } };
                //if (id) { x._id = id; }
                //obj.file.find(x, { type: 0 }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
            //};
            obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, extrasids, domain, type, id, skip, limit, func) {
                if (extrasids == null) {
                    const x = { type: type, domain: domain, meshid: { $in: meshes } };
                    if (id) { x._id = id; }
                    obj.file.find(x, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
                } else {
                    const x = { type: type, domain: domain, $or: [{ meshid: { $in: meshes } }, { _id: { $in: extrasids } }] };
                    if (id) { x._id = id; }
                    obj.file.find(x, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
                }
            };
            obj.GetAllTypeNodeFiltered = function (nodes, domain, type, id, func) {
                var x = { type: type, domain: domain, nodeid: { $in: nodes } };
                if (id) { x._id = id; }
                obj.file.find(x, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); });
            };
            obj.GetAllType = function (type, func) { obj.file.find({ type: type }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.find({ type: type, domain: domain, _id: { $in: ids } }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email }, { type: 0 }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.GetUserWithVerifiedEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email, emailVerified: true }, function (err, docs) { func(err, performTypedRecordDecrypt(docs)); }); };
            obj.Remove = function (id, func) { obj.file.remove({ _id: id }, func); };
            obj.RemoveAll = function (func) { obj.file.remove({}, { multi: true }, func); };
            obj.RemoveAllOfType = function (type, func) { obj.file.remove({ type: type }, { multi: true }, func); };
            obj.InsertMany = function (data, func) { obj.file.insert(data, func); }; // Insert records directly, no link escaping
            obj.RemoveMeshDocuments = function (id) { obj.file.remove({ meshid: id }, { multi: true }); obj.file.remove({ _id: 'nt' + id }); };
            obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if ((err == null) && (docs.length == 1)) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
            obj.DeleteDomain = function (domain, func) { obj.file.remove({ domain: domain }, { multi: true }, func); };
            obj.SetUser = function (user) { if (user == null) return; if (user.subscriptions != null) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); } else { obj.Set(user); } };
            obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
            obj.getLocalAmtNodes = function (func) { obj.file.find({ type: 'node', host: { $exists: true, $ne: null }, intelamt: { $exists: true } }, func); };
            obj.getAmtUuidMeshNode = function (domainid, mtype, uuid, func) { obj.file.find({ type: 'node', domain: domainid, mtype: mtype, 'intelamt.uuid': uuid }, func); };
            obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { obj.file.count({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max), count); }); } }

            // Database actions on the events collection
            obj.GetAllEvents = function (func) { obj.eventsfile.find({}, func); };
            obj.StoreEvent = function (event, func) { obj.eventsfile.insert(event, func); };
            obj.GetEvents = function (ids, domain, filter, func) {
                var finddata = { domain: domain, ids: { $in: ids } };
                if (filter != null) finddata.action = filter; 
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }, func);
                }
            };
            obj.GetEventsWithLimit = function (ids, domain, limit, filter, func) {
                var finddata = { domain: domain, ids: { $in: ids } };
                if (filter != null) finddata.action = filter; 
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func);
                }
            };
            obj.GetUserEvents = function (ids, domain, userid, filter, func) {
                var finddata = { domain: domain, $or: [{ ids: { $in: ids } }, { userid: userid }] };
                if (filter != null) finddata.action = filter; 
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }, func);
                }
            };
            obj.GetUserEventsWithLimit = function (ids, domain, userid, limit, filter, func) {
                var finddata = { domain: domain, $or: [{ ids: { $in: ids } }, { userid: userid }] };
                if (filter != null) finddata.action = filter; 
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func);
                }
            };
            obj.GetEventsTimeRange = function (ids, domain, msgids, start, end, func) {
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }], msgid: { $in: msgids }, time: { $gte: start, $lte: end } }, { type: 0, _id: 0, domain: 0, node: 0 }).sort({ time: 1 }).exec(func);
                } else {
                    obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }], msgid: { $in: msgids }, time: { $gte: start, $lte: end } }, { type: 0, _id: 0, domain: 0, node: 0 }).sort({ time: 1 }, func);
                }
            };
            obj.GetUserLoginEvents = function (domain, userid, func) {
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find({ domain: domain, action: { $in: ['authfail', 'login'] }, userid: userid, msgArgs: { $exists: true } }, { action: 1, time: 1, msgid: 1, msgArgs: 1, tokenName: 1 }).sort({ time: -1 }).exec(func);
                } else {
                    obj.eventsfile.find({ domain: domain, action: { $in: ['authfail', 'login'] }, userid: userid, msgArgs: { $exists: true } }, { action: 1, time: 1, msgid: 1, msgArgs: 1, tokenName: 1 }).sort({ time: -1 }, func);
                }
            };
            obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, filter, func) {
                var finddata = { domain: domain, nodeid: nodeid };
                if (filter != null) finddata.action = filter;
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit, func);
                }
            };
            obj.GetNodeEventsSelfWithLimit = function (nodeid, domain, userid, limit, filter, func) {
                var finddata = { domain: domain, nodeid: nodeid, userid: { $in: [userid, null] } };
                if (filter != null) finddata.action = filter;
                if (obj.databaseType == DB_NEDB) {
                    obj.eventsfile.find(finddata, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit).exec(func);
                } else {
                    obj.eventsfile.find(finddata, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit, func);
                }
            };
            obj.RemoveAllEvents = function (domain) { obj.eventsfile.remove({ domain: domain }, { multi: true }); };
            obj.RemoveAllNodeEvents = function (domain, nodeid) { if ((domain == null) || (nodeid == null)) return; obj.eventsfile.remove({ domain: domain, nodeid: nodeid }, { multi: true }); };
            obj.RemoveAllUserEvents = function (domain, userid) { if ((domain == null) || (userid == null)) return; obj.eventsfile.remove({ domain: domain, userid: userid }, { multi: true }); };
            obj.GetFailedLoginCount = function (userid, domainid, lastlogin, func) { obj.eventsfile.count({ action: 'authfail', userid: userid, domain: domainid, time: { "$gte": lastlogin } }, function (err, count) { func((err == null) ? count : 0); }); }

            // Database actions on the power collection
            obj.getAllPower = function (func) { obj.powerfile.find({}, func); };
            obj.storePowerEvent = function (event, multiServer, func) { if (multiServer != null) { event.server = multiServer.serverid; } obj.powerfile.insert(event, func); };
            obj.getPowerTimeline = function (nodeid, func) { if (obj.databaseType == DB_NEDB) { obj.powerfile.find({ nodeid: { $in: ['*', nodeid] } }, { _id: 0, nodeid: 0, s: 0 }).sort({ time: 1 }).exec(func); } else { obj.powerfile.find({ nodeid: { $in: ['*', nodeid] } }, { _id: 0, nodeid: 0, s: 0 }).sort({ time: 1 }, func); } };
            obj.removeAllPowerEvents = function () { obj.powerfile.remove({}, { multi: true }); };
            obj.removeAllPowerEventsForNode = function (nodeid) { if (nodeid == null) return; obj.powerfile.remove({ nodeid: nodeid }, { multi: true }); };

            // Database actions on the SMBIOS collection
            if (obj.smbiosfile != null) {
                obj.GetAllSMBIOS = function (func) { obj.smbiosfile.find({}, func); };
                obj.SetSMBIOS = function (smbios, func) { obj.smbiosfile.update({ _id: smbios._id }, smbios, { upsert: true }, func); };
                obj.RemoveSMBIOS = function (id) { obj.smbiosfile.remove({ _id: id }); };
                obj.GetSMBIOS = function (id, func) { obj.smbiosfile.find({ _id: id }, func); };
            }

            // Database actions on the Server Stats collection
            obj.SetServerStats = function (data, func) { obj.serverstatsfile.insert(data, func); };
            obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); obj.serverstatsfile.find({ time: { $gt: t } }, { _id: 0, cpu: 0 }, func); };

            // Read a configuration file from the database
            obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

            // Write a configuration file to the database
            obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

            // List all configuration files
            obj.listConfigFiles = function (func) { obj.file.find({ type: 'cfile' }).sort({ _id: 1 }).exec(func); }

            // Get database information
            obj.getDbStats = function (func) {
                obj.stats = { c: 5 };
                obj.getStats(function (r) { obj.stats.recordTypes = r; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } })
                obj.file.count({}, function (err, count) { obj.stats.meshcentral = { count: count }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.eventsfile.count({}, function (err, count) { obj.stats.events = { count: count }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.powerfile.count({}, function (err, count) { obj.stats.power = { count: count }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
                obj.serverstatsfile.count({}, function (err, count) { obj.stats.serverstats = { count: count }; if (--obj.stats.c == 0) { delete obj.stats.c; func(getDbStatsEx(obj.stats)); } });
            }

            // Correct database information of obj.getDbStats before returning it
            function getDbStatsEx(data) {
                var r = {};
                if (data.recordTypes != null) { r = data.recordTypes; }
                try { r.smbios = data['smbios'].count; } catch (ex) { }
                try { r.power = data['power'].count; } catch (ex) { }
                try { r.events = data['events'].count; } catch (ex) { }
                try { r.serverstats = data['serverstats'].count; } catch (ex) { }
                return r;
            }

            // Plugin operations
            if (obj.pluginsActive) {
                obj.addPlugin = function (plugin, func) { plugin.type = 'plugin'; obj.pluginsfile.insert(plugin, func); }; // Add a plugin
                obj.getPlugins = function (func) { obj.pluginsfile.find({ 'type': 'plugin' }, { 'type': 0 }).sort({ name: 1 }).exec(func); }; // Get all plugins
                obj.getPlugin = function (id, func) { obj.pluginsfile.find({ _id: id }).sort({ name: 1 }).exec(func); }; // Get plugin
                obj.deletePlugin = function (id, func) { obj.pluginsfile.remove({ _id: id }, func); }; // Delete plugin
                obj.setPluginStatus = function (id, status, func) { obj.pluginsfile.update({ _id: id }, { $set: { status: status } }, func); };
                obj.updatePlugin = function (id, args, func) { delete args._id; obj.pluginsfile.update({ _id: id }, { $set: args }, func); };
            }

        }

        // Get all configuration files
        obj.getAllConfigFiles = function (password, func) {
            obj.GetAllType('cfile', function (err, docs) {
                if (err != null) { func(null); return; }
                var r = null;
                for (var i = 0; i < docs.length; i++) {
                    var name = docs[i]._id.split('/')[1];
                    var data = obj.decryptData(password, docs[i].data);
                    if (data != null) { if (r == null) { r = {}; } r[name] = data; }
                }
                func(r);
            });
        }

        func(obj); // Completed function setup
    }

    // Return a human readable string with current backup configuration
    obj.getBackupConfig = function () {
        var r = '', backupPath = parent.backuppath;

        let dbname = 'meshcentral';
        if (parent.args.mongodbname) { dbname = parent.args.mongodbname; }
        else if ((typeof parent.args.mariadb == 'object') && (typeof parent.args.mariadb.database == 'string')) { dbname = parent.args.mariadb.database; }
        else if ((typeof parent.args.mysql == 'object') && (typeof parent.args.mysql.database == 'string')) { dbname = parent.args.mysql.database; }
        else if (typeof parent.config.settings.sqlite3 == 'string') {dbname = parent.config.settings.sqlite3 + '.sqlite'};

        const currentDate = new Date();
        const fileSuffix = currentDate.getFullYear() + '-' + padNumber(currentDate.getMonth() + 1, 2) + '-' + padNumber(currentDate.getDate(), 2) + '-' + padNumber(currentDate.getHours(), 2) + '-' + padNumber(currentDate.getMinutes(), 2);
        obj.newAutoBackupFile = parent.config.settings.autobackup.backupname + fileSuffix;

        r += 'DB Name: ' + dbname + '\r\n';
        r += 'DB Type: ' + DB_LIST[obj.databaseType] + '\r\n';
        r += 'BackupPath: ' + backupPath + '\r\n';
        r += 'BackupFile: ' + obj.newAutoBackupFile + '.zip\r\n';

        if (parent.config.settings.autobackup == null) {
            r += 'No Settings/AutoBackup\r\n';
        } else {
            if (parent.config.settings.autobackup.backuphour != null && parent.config.settings.autobackup.backuphour != -1) {
                r += 'Backup between: ' + parent.config.settings.autobackup.backuphour + 'H-' + (parent.config.settings.autobackup.backuphour + 1)  + 'H\r\n';
            }
            if (parent.config.settings.autobackup.backupintervalhours != null) {
                r += 'Backup Interval (Hours): ' + parent.config.settings.autobackup.backupintervalhours + '\r\n';
            }
            if (parent.config.settings.autobackup.keeplastdaysbackup != null) {
                r += 'Keep Last Backups (Days): ' + parent.config.settings.autobackup.keeplastdaysbackup + '\r\n';
            }
            if (parent.config.settings.autobackup.zippassword != null) {
                r += 'ZIP Password: ';
                if (typeof parent.config.settings.autobackup.zippassword != 'string') { r += 'Bad zippassword type, Backups will not be encrypted\r\n'; }
                else if (parent.config.settings.autobackup.zippassword == "") { r += 'Blank zippassword, Backups will fail\r\n'; }
                else { r += 'Set\r\n'; }
            }
            if (parent.config.settings.autobackup.mongodumppath != null) {
                r += 'MongoDump Path: ';
                if (typeof parent.config.settings.autobackup.mongodumppath != 'string') { r += 'Bad mongodumppath type\r\n'; }
                else { r += parent.config.settings.autobackup.mongodumppath + '\r\n'; }
            }
            if (parent.config.settings.autobackup.mysqldumppath != null) {
                r += 'MySqlDump Path: ';
                if (typeof parent.config.settings.autobackup.mysqldumppath != 'string') { r += 'Bad mysqldump type\r\n'; }
                else { r += parent.config.settings.autobackup.mysqldumppath + '\r\n'; }
            }
            if (parent.config.settings.autobackup.backupotherfolders) {
                r += 'Backup other folders: ';
                r += parent.filespath + ', ' + parent.recordpath + '\r\n';
            }
            if (parent.config.settings.autobackup.backupwebfolders) {
                r += 'Backup webfolders: ';
                if (parent.webViewsOverridePath) {r += parent.webViewsOverridePath };
                if (parent.webPublicOverridePath) {r += ', '+ parent.webPublicOverridePath};
                if (parent.webEmailsOverridePath) {r += ',' + parent.webEmailsOverridePath};
                r+= '\r\n';
            }
            if (parent.config.settings.autobackup.backupignorefilesglob != []) {
                r += 'Backup IgnoreFilesGlob: ';
                { r += parent.config.settings.autobackup.backupignorefilesglob + '\r\n'; }
            }
            if (parent.config.settings.autobackup.backupskipfoldersglob != []) {
                r += 'Backup SkipFoldersGlob: ';
                { r += parent.config.settings.autobackup.backupskipfoldersglob + '\r\n'; }
            }

            if (typeof parent.config.settings.autobackup.s3 == 'object') {
                r += 'S3 Backups: Enabled\r\n';
            }
            if (typeof parent.config.settings.autobackup.webdav == 'object') {
                r += 'WebDAV Backups: Enabled\r\n';
                r += 'WebDAV backup path: ' + ((typeof parent.config.settings.autobackup.webdav.foldername == 'string') ? parent.config.settings.autobackup.webdav.foldername : 'MeshCentral-Backups') + '\r\n';
                r += 'WebDAV maximum files: '+ ((typeof parent.config.settings.autobackup.webdav.maxfiles == 'number') ? parent.config.settings.autobackup.webdav.maxfiles : 'no limit') + '\r\n';
            }
            if (typeof parent.config.settings.autobackup.googledrive == 'object') {
                r += 'Google Drive Backups: Enabled\r\n';
            }


        }

        return r;
    }

    function buildSqlDumpCommand() {
        var props = (obj.databaseType == DB_MARIADB) ? parent.args.mariadb : parent.args.mysql;

        var mysqldumpPath = 'mysqldump';
        if (parent.config.settings.autobackup && parent.config.settings.autobackup.mysqldumppath) { 
            mysqldumpPath = path.normalize(parent.config.settings.autobackup.mysqldumppath);
        }

        var cmd = '\"' + mysqldumpPath + '\" --user=\'' + props.user + '\'';
        // Windows will treat ' as part of the pw. Linux/Unix requires it to escape.
        cmd += (parent.platform == 'win32') ? ' --password=\"' + props.password + '\"' : ' --password=\'' + props.password + '\'';
        if (props.host) { cmd += ' -h ' + props.host; }
        if (props.port) { cmd += ' -P ' + props.port; }

        if (props.awsrds) { cmd += ' --single-transaction'; }

        // SSL options different on mariadb/mysql
        var sslOptions = '';
        if (obj.databaseType == DB_MARIADB) {
            if (props.ssl) {
                sslOptions = ' --ssl';
                if (props.ssl.cacertpath) sslOptions = ' --ssl-ca=' + props.ssl.cacertpath;
                if (props.ssl.dontcheckserveridentity != true) {sslOptions += ' --ssl-verify-server-cert'} else {sslOptions += ' --ssl-verify-server-cert=false'};
                if (props.ssl.clientcertpath) sslOptions += ' --ssl-cert=' + props.ssl.clientcertpath;
                if (props.ssl.clientkeypath) sslOptions += ' --ssl-key=' + props.ssl.clientkeypath;
            } 
        } else {
            if (props.ssl) {
                sslOptions = ' --ssl-mode=required';
                if (props.ssl.cacertpath) sslOptions = ' --ssl-ca=' + props.ssl.cacertpath;
                if (props.ssl.dontcheckserveridentity != true) sslOptions += ' --ssl-mode=verify_identity';
                else sslOptions += ' --ssl-mode=required';
                if (props.ssl.clientcertpath) sslOptions += ' --ssl-cert=' + props.ssl.clientcertpath;
                if (props.ssl.clientkeypath) sslOptions += ' --ssl-key=' + props.ssl.clientkeypath;
            }
        }
        cmd += sslOptions;

        var dbname = (props.database) ? props.database : 'meshcentral';
        cmd += ' ' + dbname

        return cmd;
    }

    function buildMongoDumpCommand() {
        const dburl = parent.args.mongodb;

        var mongoDumpPath = 'mongodump';
        if (parent.config.settings.autobackup && parent.config.settings.autobackup.mongodumppath) {
            mongoDumpPath = path.normalize(parent.config.settings.autobackup.mongodumppath);
        }

        var cmd = '"' + mongoDumpPath + '"';
        if (dburl) { cmd = '\"' + mongoDumpPath + '\" --uri=\"' + dburl + '\"'; }
        if (parent.config.settings.autobackup?.mongodumpargs) {
            cmd = '\"' + mongoDumpPath + '\" ' + parent.config.settings.autobackup.mongodumpargs;
            if (!parent.config.settings.autobackup.mongodumpargs.includes("--db=")) {cmd += ' --db=' + (parent.config.settings.mongodbname ? parent.config.settings.mongodbname : 'meshcentral')};
        }
        return cmd;
    }

    // Check that the server is capable of performing a backup
    // Tries configured custom location with fallback to default location
    // Now runs after autobackup config init in meshcentral.js so config options are checked
    obj.checkBackupCapability = function (func) {
        if ((parent.config.settings.autobackup == null) || (parent.config.settings.autobackup == false)) { return; };
        //block backup until validated. Gets put back if all checks are ok.
        let backupInterval = parent.config.settings.autobackup.backupintervalhours;
        parent.config.settings.autobackup.backupintervalhours = -1;
        let backupPath = parent.backuppath;

        if (backupPath.startsWith(parent.datapath)) {
            func(1, "Backup path can't be set within meshcentral-data folder. No backups will be made.");
            return;
        }
        // Check create/write backupdir
        try { fs.mkdirSync(backupPath); }
        catch (e) {
            // EEXIST error = dir already exists
            if (e.code != 'EEXIST' ) {
                //Unable to create backuppath
                console.error(e.message);
                func(1, 'Unable to create ' + backupPath + '. No backups will be made. Error: ' + e.message);
                return;
            }
        }
        const currentDate = new Date();
        const fileSuffix = currentDate.getFullYear() + '-' + padNumber(currentDate.getMonth() + 1, 2) + '-' + padNumber(currentDate.getDate(), 2) + '-' + padNumber(currentDate.getHours(), 2) + '-' + padNumber(currentDate.getMinutes(), 2);
        const testFile = path.join(backupPath, parent.config.settings.autobackup.backupname + fileSuffix + '.zip');
        try { fs.writeFileSync( testFile, "DeleteMe"); }
        catch (e) {
            //Unable to create file
            console.error (e.message);
            func(1, "Backuppath (" + backupPath + ") can't be written to. No backups will be made. Error: " + e.message);
            return;            
        }
        try { fs.unlinkSync(testFile); parent.debug('backup', 'Backuppath ' + backupPath + ' accesscheck successful');}
        catch (e) {
            console.error (e.message);
            func(1, "Backuppathtestfile (" + testFile + ") can't be deleted, check filerights. Error: " + e.message);
            // Assume write rights, no delete rights. Continue with warning.
            //return;
        }

        // Check database dumptools
        if ((obj.databaseType == DB_MONGOJS) || (obj.databaseType == DB_MONGODB)) {
            // Check that we have access to MongoDump
            var cmd = buildMongoDumpCommand();
            cmd += (parent.platform == 'win32') ? ' --archive=\"nul\"' : ' --archive=\"/dev/null\"';
            const child_process = require('child_process');
            child_process.exec(cmd, { cwd: backupPath }, function (error, stdout, stderr) {
                if ((error != null) && (error != '')) {
                        func(1, "Mongodump error, backup will not be performed. Command tried: " + cmd + ' --> ERROR: ' + stderr);
                        return;
                } else {parent.config.settings.autobackup.backupintervalhours = backupInterval;}
            });
        } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL)) {
            // Check that we have access to mysqldump
            var cmd = buildSqlDumpCommand();
            cmd += ' > ' + ((parent.platform == 'win32') ? '\"nul\"' : '\"/dev/null\"');
            const child_process = require('child_process');
            child_process.exec(cmd, { cwd: backupPath, timeout: 1000*30 }, function(error, stdout, stdin) {
                if ((error != null) && (error != '')) {
                        func(1, "mysqldump error, backup will not be performed. Command tried: " + cmd);
                        return;
                } else {parent.config.settings.autobackup.backupintervalhours = backupInterval;}

            });
        } else if (obj.databaseType == DB_POSTGRESQL) {
            // Check that we have access to pg_dump
            parent.config.settings.autobackup.pgdumppath = path.normalize(parent.config.settings.autobackup.pgdumppath ? parent.config.settings.autobackup.pgdumppath : 'pg_dump');
            let cmd = '"' + parent.config.settings.autobackup.pgdumppath + '"'
                    + ' --dbname=postgresql://' + parent.config.settings.postgres.user + ":" +parent.config.settings.postgres.password
                    + "@" + parent.config.settings.postgres.host + ":" + parent.config.settings.postgres.port + "/" + databaseName
                    + ' > ' + ((parent.platform == 'win32') ? '\"nul\"' : '\"/dev/null\"');
            const child_process = require('child_process');
            child_process.exec(cmd, { cwd: backupPath }, function(error, stdout, stdin) {
                if ((error != null) && (error != '')) {
                        func(1, "pg_dump error, backup will not be performed. Command tried: " + cmd);
                        return;
                } else {parent.config.settings.autobackup.backupintervalhours = backupInterval;}
            });        
        } else {
            //all ok, enable backup
            parent.config.settings.autobackup.backupintervalhours = backupInterval;}
    }

    // MongoDB pending bulk read operation, perform fast bulk document reads.
    function fileBulkReadCompleted(err, docs) {
        // Send out callbacks with results
        if (docs != null) {
            for (var i in docs) {
                if (docs[i].links != null) { docs[i] = common.unEscapeLinksFieldName(docs[i]); }
                const id = docs[i]._id;
                if (obj.filePendingGets[id] != null) {
                    for (var j in obj.filePendingGets[id]) {
                        if (typeof obj.filePendingGets[id][j] == 'function') { obj.filePendingGets[id][j](err, performTypedRecordDecrypt([docs[i]])); }
                    }
                    delete obj.filePendingGets[id];
                }
            }
        }

        // If there are not results, send out a null callback
        for (var i in obj.filePendingGets) { for (var j in obj.filePendingGets[i]) { obj.filePendingGets[i][j](err, []); } }

        // Move on to process any more pending get operations
        obj.filePendingGets = obj.filePendingGet;
        obj.filePendingGet = null;
        if (obj.filePendingGets != null) {
            var findlist = [];
            for (var i in obj.filePendingGets) { findlist.push(i); }
            obj.file.find({ _id: { $in: findlist } }).toArray(fileBulkReadCompleted);
        }
    }

    // MongoDB pending bulk remove operation, perform fast bulk document removes.
    function fileBulkRemoveCompleted(err) {
        // Send out callbacks
        for (var i in obj.filePendingRemoves) {
            for (var j in obj.filePendingRemoves[i]) {
                if (typeof obj.filePendingRemoves[i][j] == 'function') { obj.filePendingRemoves[i][j](err); }
            }
        }

        // Move on to process any more pending get operations
        obj.filePendingRemoves = obj.filePendingRemove;
        obj.filePendingRemove = null;
        if (obj.filePendingRemoves != null) {
            obj.dbCounters.fileRemoveBulk++;
            var findlist = [], count = 0;
            for (var i in obj.filePendingRemoves) { findlist.push(i); count++; }
            obj.file.deleteMany({ _id: { $in: findlist } }, { multi: true }, fileBulkRemoveCompleted);
        }
    }

    // MongoDB pending bulk write operation, perform fast bulk document replacement.
    function fileBulkWriteCompleted() {
        // Callbacks
        if (obj.filePendingCbs != null) {
            for (var i in obj.filePendingCbs) { if (typeof obj.filePendingCbs[i] == 'function') { obj.filePendingCbs[i](); } }
            obj.filePendingCbs = null;
        }
        if (obj.filePendingSets != null) {
            // Perform pending operations
            obj.dbCounters.fileSetBulk++;
            var ops = [];
            obj.filePendingCbs = obj.filePendingCb;
            obj.filePendingCb = null;
            for (var i in obj.filePendingSets) { ops.push({ replaceOne: { filter: { _id: i }, replacement: performTypedRecordEncrypt(common.escapeLinksFieldNameEx(obj.filePendingSets[i])), upsert: true } }); }
            obj.file.bulkWrite(ops, fileBulkWriteCompleted);
            obj.filePendingSets = null;
        } else {
            // All done, no pending operations.
            obj.filePendingSet = false;
        }
    }

    // MongoDB pending bulk write operation, perform fast bulk document replacement.
    function eventsFileBulkWriteCompleted() {
        // Callbacks
        if (obj.eventsFilePendingCbs != null) { for (var i in obj.eventsFilePendingCbs) { obj.eventsFilePendingCbs[i](); } obj.eventsFilePendingCbs = null; }
        if (obj.eventsFilePendingSets != null) {
            // Perform pending operations
            obj.dbCounters.eventsSetBulk++;
            var ops = [];
            for (var i in obj.eventsFilePendingSets) { ops.push({ insertOne: { document: obj.eventsFilePendingSets[i] } }); }
            obj.eventsFilePendingCbs = obj.eventsFilePendingCb;
            obj.eventsFilePendingCb = null;
            obj.eventsFilePendingSets = null;
            obj.eventsfile.bulkWrite(ops, eventsFileBulkWriteCompleted);
        } else {
            // All done, no pending operations.
            obj.eventsFilePendingSet = false;
        }
    }

    // MongoDB pending bulk write operation, perform fast bulk document replacement.
    function powerFileBulkWriteCompleted() {
        // Callbacks
        if (obj.powerFilePendingCbs != null) { for (var i in obj.powerFilePendingCbs) { obj.powerFilePendingCbs[i](); } obj.powerFilePendingCbs = null; }
        if (obj.powerFilePendingSets != null) {
            // Perform pending operations
            obj.dbCounters.powerSetBulk++;
            var ops = [];
            for (var i in obj.powerFilePendingSets) { ops.push({ insertOne: { document: obj.powerFilePendingSets[i] } }); }
            obj.powerFilePendingCbs = obj.powerFilePendingCb;
            obj.powerFilePendingCb = null;
            obj.powerFilePendingSets = null;
            obj.powerfile.bulkWrite(ops, powerFileBulkWriteCompleted);
        } else {
            // All done, no pending operations.
            obj.powerFilePendingSet = false;
        }
    }

    // Perform a server backup
    obj.performBackup = function (func) {
        parent.debug('backup','Entering performBackup');
        try {
            if (obj.performingBackup) return 'Backup alreay in progress.';
            if (parent.config.settings.autobackup.backupintervalhours == -1) { if (func) { func('Backup disabled.'); return 'Backup disabled.' }};
            obj.performingBackup = true;
            let backupPath = parent.backuppath;
            let dataPath = parent.datapath;

            const currentDate = new Date();
            const fileSuffix = currentDate.getFullYear() + '-' + padNumber(currentDate.getMonth() + 1, 2) + '-' + padNumber(currentDate.getDate(), 2) + '-' + padNumber(currentDate.getHours(), 2) + '-' + padNumber(currentDate.getMinutes(), 2);
            obj.newAutoBackupFile = path.join(backupPath, parent.config.settings.autobackup.backupname + fileSuffix + '.zip');
            parent.debug('backup','newAutoBackupFile=' + obj.newAutoBackupFile);

            if ((obj.databaseType == DB_MONGOJS) || (obj.databaseType == DB_MONGODB)) {
                // Perform a MongoDump
                const dbname = (parent.args.mongodbname) ? (parent.args.mongodbname) : 'meshcentral';
                const dburl = parent.args.mongodb;
    
                obj.newDBDumpFile = path.join(backupPath, (dbname + '-mongodump-' + fileSuffix + '.archive'));

                var cmd = buildMongoDumpCommand();
                cmd += (dburl) ? ' --archive=\"' + obj.newDBDumpFile + '\"' :
                                 ' --db=\"' + dbname + '\" --archive=\"' + obj.newDBDumpFile + '\"';
                parent.debug('backup','Mongodump cmd: ' + cmd);
                const child_process = require('child_process');
                const dumpProcess = child_process.exec(
                    cmd,
                    { cwd: parent.parentpath },
                    (error)=> {if (error) {obj.backupStatus |= BACKUPFAIL_DBDUMP; console.error('ERROR: Unable to perform MongoDB backup: ' + error + '\r\n'); obj.createBackupfile(func);}}
                );
                
                dumpProcess.on('exit', (code) => {
                    if (code != 0) {console.log(`Mongodump child process exited with code ${code}`); obj.backupStatus |= BACKUPFAIL_DBDUMP;}
                    obj.createBackupfile(func);
                  });

            } else if ((obj.databaseType == DB_MARIADB) || (obj.databaseType == DB_MYSQL)) {
                // Perform a MySqlDump backup
                const newBackupFile = 'mysqldump-' + fileSuffix;
                obj.newDBDumpFile = path.join(backupPath, newBackupFile + '.sql');
           
                var cmd = buildSqlDumpCommand();
                cmd += ' --result-file=\"' + obj.newDBDumpFile + '\"';
                parent.debug('backup','Maria/MySQLdump cmd: ' + cmd);

                const child_process = require('child_process');
                const dumpProcess = child_process.exec(
                    cmd,
                    { cwd: parent.parentpath },
                    (error)=> {if (error) {obj.backupStatus |= BACKUPFAIL_DBDUMP; console.error('ERROR: Unable to perform MySQL backup: ' + error + '\r\n'); obj.createBackupfile(func);}}
                );
                dumpProcess.on('exit', (code) => {
                    if (code != 0) {console.error(`MySQLdump child process exited with code ${code}`); obj.backupStatus |= BACKUPFAIL_DBDUMP;}
                    obj.createBackupfile(func);
                  });

            } else if (obj.databaseType == DB_SQLITE) {
                //.db3 suffix to escape escape backupfile glob to exclude the sqlite db files
                obj.newDBDumpFile = path.join(backupPath, databaseName + '-sqlitedump-' + fileSuffix + '.db3');
                // do a VACUUM INTO in favor of the backup API to compress the export, see https://www.sqlite.org/backup.html
                parent.debug('backup','SQLitedump: VACUUM INTO ' + obj.newDBDumpFile);
                obj.file.exec('VACUUM INTO \'' + obj.newDBDumpFile + '\'', function (err) {
                    if (err) { console.error('SQLite backup error: ' + err); obj.backupStatus |=BACKUPFAIL_DBDUMP;};
                    //always finish/clean up
                    obj.createBackupfile(func);
                });
            } else if (obj.databaseType == DB_POSTGRESQL) {
                // Perform a PostgresDump backup
                const newBackupFile = databaseName + '-pgdump-' + fileSuffix + '.sql';
                obj.newDBDumpFile = path.join(backupPath, newBackupFile);
                let cmd = '"' + parent.config.settings.autobackup.pgdumppath + '"'
                    + ' --dbname=postgresql://' + parent.config.settings.postgres.user + ":" +parent.config.settings.postgres.password
                    + "@" + parent.config.settings.postgres.host + ":" + parent.config.settings.postgres.port + "/" + databaseName
                    + " --file=" + obj.newDBDumpFile;
                parent.debug('backup','Postgresqldump cmd: ' + cmd);
                const child_process = require('child_process');
                const dumpProcess = child_process.exec(
                    cmd,
                    { cwd: dataPath },
                    (error)=> {if (error) {obj.backupStatus |= BACKUPFAIL_DBDUMP; console.log('ERROR: Unable to perform PostgreSQL dump: ' + error.message + '\r\n'); obj.createBackupfile(func);}}
                );
                dumpProcess.on('exit', (code) => {
                    if (code != 0) {console.log(`PostgreSQLdump child process exited with code: ` + code); obj.backupStatus |= BACKUPFAIL_DBDUMP;}
                    obj.createBackupfile(func);
                });
            } else {
                // NeDB/Acebase backup, no db dump needed, just make a file backup
                obj.createBackupfile(func);
            }
        } catch (ex) { console.error(ex); parent.addServerWarning( 'Something went wrong during performBackup, check errorlog: ' +ex.message, true);  };
        return 'Starting auto-backup...';
    };

    obj.createBackupfile = function(func) {
        parent.debug('backup', 'Entering createBackupfile');
        let archiver = require('archiver');
        let archive = null;
        let zipLevel = Math.min(Math.max(Number(parent.config.settings.autobackup.zipcompression ? parent.config.settings.autobackup.zipcompression : 5),1),9);

        //if password defined, create encrypted zip
        if (parent.config.settings.autobackup && (typeof parent.config.settings.autobackup.zippassword == 'string')) {
            try {
                //Only register format once, otherwise it triggers an error
                if (archiver.isRegisteredFormat('zip-encrypted') == false) { archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted')); }
                archive = archiver.create('zip-encrypted', { zlib: { level: zipLevel }, encryptionMethod: 'aes256', password: parent.config.settings.autobackup.zippassword });
                if (func) { func('Creating encrypted ZIP'); }
            } catch (ex) { // registering encryption failed, do not fall back to non-encrypted, fail backup and skip old backup removal as a precaution to not lose any backups
                obj.backupStatus |= BACKUPFAIL_ZIPMODULE;
                if (func) { func('Zipencryptionmodule failed, aborting');}
                console.error('Zipencryptionmodule failed, aborting');
            }
        } else {
            if (func) { func('Creating a NON-ENCRYPTED ZIP'); }
            archive = archiver('zip', { zlib: { level: zipLevel } });
        }

        //original behavior, just a filebackup if dbdump fails : (obj.backupStatus == 0 || obj.backupStatus == BACKUPFAIL_DBDUMP)
        if (obj.backupStatus == 0) {
            // Zip the data directory with the dbdump|NeDB files
            let output = fs.createWriteStream(obj.newAutoBackupFile);

            // Archive finalized and closed
            output.on('close', function () { 
                if (obj.backupStatus == 0) {
                    let mesg = 'Auto-backup completed: ' + obj.newAutoBackupFile + ', backup-size: ' + ((archive.pointer() / 1048576).toFixed(2)) + "Mb";
                    console.log(mesg);
                    if (func) { func(mesg); };
                    obj.performCloudBackup(obj.newAutoBackupFile, func);
                    obj.removeExpiredBackupfiles(func);

                } else {
                    let mesg = 'Zipbackup failed (' + obj.backupStatus.toString(2).slice(-8) + '), deleting incomplete backup: ' + obj.newAutoBackupFile;
                    if (func) { func(mesg) }
                    else { parent.addServerWarning(mesg, true ) };
                    if (fs.existsSync(obj.newAutoBackupFile)) { fs.unlink(obj.newAutoBackupFile, function (err) { if (err) {console.error('Failed to clean up backupfile: ' + err.message)} }) };
                };
                if (obj.databaseType != DB_NEDB) {
                    //remove dump archive file, because zipped and otherwise fills up
                    if (fs.existsSync(obj.newDBDumpFile)) { fs.unlink(obj.newDBDumpFile, function (err) { if (err) {console.error('Failed to clean up dbdump file: ' + err.message) } }) };
                };
                obj.performingBackup = false;
                obj.backupStatus = 0x0;
                }
            );
            output.on('end', function () { });
            output.on('error', function (err) {
                if ((obj.backupStatus & BACKUPFAIL_ZIPCREATE) == 0) {
                    console.error('Output error: ' + err.message);
                    if (func) { func('Output error: ' + err.message); };
                    obj.backupStatus |= BACKUPFAIL_ZIPCREATE;
                    archive.abort();
                };
            });
            archive.on('warning', function (err) {
                //if files added to the archiver object aren't reachable anymore (e.g. sqlite-journal files)
                //an ENOENT warning is given, but the archiver module has no option to/does not skip/resume
                //so the backup needs te be aborted as it otherwise leaves an incomplete zip and never 'ends'
                if ((obj.backupStatus & BACKUPFAIL_ZIPCREATE) == 0) {
                    console.log('Zip warning: ' + err.message); 
                    if (func) { func('Zip warning: ' + err.message); };
                    obj.backupStatus |= BACKUPFAIL_ZIPCREATE;
                    archive.abort();
                };
            });
            archive.on('error', function (err) {
                if ((obj.backupStatus & BACKUPFAIL_ZIPCREATE) == 0) {
                    console.error('Zip error: ' + err.message);
                    if (func) { func('Zip error: ' + err.message); };
                    obj.backupStatus |= BACKUPFAIL_ZIPCREATE;
                    archive.abort();
                }
                });
            archive.pipe(output);

            let globIgnoreFiles;
            //slice in case exclusion gets pushed
            globIgnoreFiles = parent.config.settings.autobackup.backupignorefilesglob ? parent.config.settings.autobackup.backupignorefilesglob.slice() : [];
            if (parent.config.settings.sqlite3) { globIgnoreFiles.push (datapathFoldername + '/' + databaseName + '.sqlite*'); }; //skip sqlite database file, and temp files with ext -journal, -wal & -shm
            //archiver.glob doesn't seem to use the third param, archivesubdir. Bug?
            //workaround: go up a dir and add data dir explicitly to keep the zip tidy
            archive.glob((datapathFoldername + '/**'), {
                cwd: datapathParentPath,
                ignore: globIgnoreFiles,
                skip: (parent.config.settings.autobackup.backupskipfoldersglob ? parent.config.settings.autobackup.backupskipfoldersglob : [])
            });

            if (parent.config.settings.autobackup.backupwebfolders) {
                if (parent.webViewsOverridePath) { archive.directory(parent.webViewsOverridePath, 'meshcentral-views'); }
                if (parent.webPublicOverridePath) { archive.directory(parent.webPublicOverridePath, 'meshcentral-public'); }
                if (parent.webEmailsOverridePath) { archive.directory(parent.webEmailsOverridePath, 'meshcentral-emails'); }
            };
            if (parent.config.settings.autobackup.backupotherfolders) {
                archive.directory(parent.filespath, 'meshcentral-files');
                archive.directory(parent.recordpath, 'meshcentral-recordings');
            };
            //add dbdump to the root of the zip
            if (obj.newDBDumpFile != null) archive.file(obj.newDBDumpFile, { name: path.basename(obj.newDBDumpFile) });
            archive.finalize();
        } else {
            //failed somewhere before zipping
            console.error('Backup failed ('+ obj.backupStatus.toString(2).slice(-8) + ')');
            if (func) { func('Backup failed ('+ obj.backupStatus.toString(2).slice(-8) + ')') }
            else {
                parent.addServerWarning('Backup failed ('+ obj.backupStatus.toString(2).slice(-8) + ')', true);
            }
            //Just in case something's there
            if (fs.existsSync(obj.newDBDumpFile)) { fs.unlink(obj.newDBDumpFile, function (err) { if (err) {console.error('Failed to clean up dbdump file: ' + err.message) } }); };
            obj.backupStatus = 0x0;
            obj.performingBackup = false;
        };
    };

    // Remove expired backupfiles by filenamedate
    obj.removeExpiredBackupfiles = function (func) {
        if (parent.config.settings.autobackup && (typeof parent.config.settings.autobackup.keeplastdaysbackup == 'number')) {
            let cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - parent.config.settings.autobackup.keeplastdaysbackup);
            fs.readdir(parent.backuppath, function (err, dir) {
                try {
                    if (err == null) {
                        if (dir.length > 0) {
                            let fileName = parent.config.settings.autobackup.backupname;
                            let checked = 0;
                            let removed = 0;
                            for (var i in dir) {
                                var name = dir[i];
                                parent.debug('backup', "checking file: ", path.join(parent.backuppath, name));
                                if (name.startsWith(fileName) && name.endsWith('.zip')) {
                                    var timex = name.substring(fileName.length, name.length - 4).split('-');
                                    if (timex.length == 5) {
                                        checked++;
                                        var fileDate = new Date(parseInt(timex[0]), parseInt(timex[1]) - 1, parseInt(timex[2]), parseInt(timex[3]), parseInt(timex[4]));
                                        if (fileDate && (cutoffDate > fileDate)) {
                                            console.log("Removing expired backup file: ", path.join(parent.backuppath, name));
                                            fs.unlink(path.join(parent.backuppath, name), function (err) { if (err) { console.error(err.message); if (func) {func('Error removing: ' + err.message); } } });
                                            removed++;
                                        }
                                    }
                                    else { parent.debug('backup', "file: " + name + " timestamp failure: ", timex); }
                                }
                            }
                            let mesg= 'Checked ' + checked + ' candidates in ' + parent.backuppath + '. Removed ' + removed + ' expired backupfiles using cutoffDate: '+ cutoffDate.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' });
                            parent.debug (mesg);
                            if (func) { func(mesg); }
                        } else { console.error('No files found in ' + parent.backuppath + '. There should be at least one.')}
                    }
                    else
                    { console.error(err); parent.addServerWarning( 'Reading files in backup directory ' + parent.backuppath + ' failed, check errorlog: ' + err.message, true); }
                } catch (ex) { console.error(ex); parent.addServerWarning( 'Something went wrong during removeExpiredBackupfiles, check errorlog: ' +ex.message, true); }
            });
        }
    }

    async function webDAVBackup(filename, func) {
        try {
            const webDAV = await import ('webdav');
            const wdConfig = parent.config.settings.autobackup.webdav;
            const client = webDAV.createClient(wdConfig.url, {
                username: wdConfig.username,
                password: wdConfig.password,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            if (await client.exists(wdConfig.foldername) === false) {
                await client.createDirectory(wdConfig.foldername, { recursive: true});
            } else {
                // Clean up our WebDAV folder
                if ((typeof wdConfig.maxfiles == 'number') && (wdConfig.maxfiles > 1)) {
                    const fileName = parent.config.settings.autobackup.backupname;
                    //only files matching our backupfilename
                    let files = await client.getDirectoryContents(wdConfig.foldername, { deep: false, glob: "/**/" + fileName + "*.zip" });
                    const xdateTimeSort = function (a, b) { if (a.xdate > b.xdate) return 1; if (a.xdate < b.xdate) return -1; return 0; }
                    for (const i in files) { files[i].xdate = new Date(files[i].lastmod); }
                    files.sort(xdateTimeSort);
                    while (files.length >= wdConfig.maxfiles) {
                        let delFile = files.shift().filename;
                        await client.deleteFile(delFile);
                        console.log('WebDAV file deleted: ' + delFile); if (func) { func('WebDAV file deleted: ' + delFile); }
                    }
                }
            }
            // Upload to the WebDAV folder
            const { pipeline } = require('stream/promises');
            await pipeline(fs.createReadStream(filename), client.createWriteStream( wdConfig.foldername + path.basename(filename)));
            console.log('WebDAV upload completed: ' + wdConfig.foldername + path.basename(filename)); if (func) { func('WebDAV upload completed: ' + wdConfig.foldername + path.basename(filename)); }
        }
        catch(err) {
            console.error('WebDAV error: ' + err.message); if (func) { func('WebDAV error: ' + err.message);}
        }
    }

    // Perform cloud backup
    obj.performCloudBackup = function (filename, func) {
        // WebDAV Backup
        if ((typeof parent.config.settings.autobackup == 'object') && (typeof parent.config.settings.autobackup.webdav == 'object')) {
            parent.debug( 'backup', 'Entering WebDAV backup'); if (func) { func('Entering WebDAV backup.'); }
            webDAVBackup(filename, func);
        }

        // Google Drive Backup
        if ((typeof parent.config.settings.autobackup == 'object') && (typeof parent.config.settings.autobackup.googledrive == 'object')) {
            parent.debug( 'backup', 'Entering Google Drive backup');
            obj.Get('GoogleDriveBackup', function (err, docs) {
                if ((err != null) || (docs.length != 1) || (docs[0].state != 3)) return;
                if (func) { func('Attempting Google Drive upload...'); }
                const {google} = require('googleapis');
                const oAuth2Client = new google.auth.OAuth2(docs[0].clientid, docs[0].clientsecret, "urn:ietf:wg:oauth:2.0:oob");
                oAuth2Client.on('tokens', function (tokens) { if (tokens.refresh_token) { docs[0].token = tokens.refresh_token; parent.db.Set(docs[0]); } }); // Update the token in the database
                oAuth2Client.setCredentials(docs[0].token);
                const drive = google.drive({ version: 'v3', auth: oAuth2Client });
                const createdTimeSort = function (a, b) { if (a.createdTime > b.createdTime) return 1; if (a.createdTime < b.createdTime) return -1; return 0; }

                // Called once we know our folder id, clean up and upload a backup.
                var useGoogleDrive = function (folderid) {
                    // List files to see if we need to delete older ones
                    if (typeof parent.config.settings.autobackup.googledrive.maxfiles == 'number') {
                        drive.files.list({
                            q: 'trashed = false and \'' + folderid + '\' in parents',
                            fields: 'nextPageToken, files(id, name, size, createdTime)',
                        }, function (err, res) {
                            if (err) {
                                console.log('GoogleDrive (files.list) error: ' + err);
                                if (func) { func('GoogleDrive (files.list) error: ' + err); }
                                return;
                            }
                            // Delete any old files if more than 10 files are present in the backup folder.
                            res.data.files.sort(createdTimeSort);
                            while (res.data.files.length >= parent.config.settings.autobackup.googledrive.maxfiles) { drive.files.delete({ fileId: res.data.files.shift().id }, function (err, res) { }); }
                        });
                    }

                    //console.log('Uploading...');
                    if (func) { func('Uploading to Google Drive...'); }

                    // Upload the backup
                    drive.files.create({
                        requestBody: { name: require('path').basename(filename), mimeType: 'text/plain', parents: [folderid] },
                        media: { mimeType: 'application/zip', body: require('fs').createReadStream(filename) },
                    }, function (err, res) {
                        if (err) {
                            console.log('GoogleDrive (files.create) error: ' + err);
                            if (func) { func('GoogleDrive (files.create) error: ' + err); }
                            return;
                        }
                        //console.log('Upload done.');
                        if (func) { func('Google Drive upload completed.'); }
                    });
                }

                // Fetch the folder name
                var folderName = 'MeshCentral-Backups';
                if (typeof parent.config.settings.autobackup.googledrive.foldername == 'string') { folderName = parent.config.settings.autobackup.googledrive.foldername; }

                // Find our backup folder, create one if needed.
                drive.files.list({
                    q: 'mimeType = \'application/vnd.google-apps.folder\' and name=\'' + folderName + '\' and trashed = false',
                    fields: 'nextPageToken, files(id, name)',
                }, function (err, res) {
                    if (err) {
                        console.log('GoogleDrive error: ' + err);
                        if (func) { func('GoogleDrive error: ' + err); }
                        return;
                    }
                    if (res.data.files.length == 0) {
                        // Create a folder
                        drive.files.create({ resource: { 'name': folderName, 'mimeType': 'application/vnd.google-apps.folder' }, fields: 'id' }, function (err, file) {
                            if (err) {
                                console.log('GoogleDrive (folder.create) error: ' + err);
                                if (func) { func('GoogleDrive (folder.create) error: ' + err); }
                                return;
                            }
                            useGoogleDrive(file.data.id);
                        });
                    } else { useGoogleDrive(res.data.files[0].id); }
                });
            });
        }

        // S3 Backup
        if ((typeof parent.config.settings.autobackup == 'object') && (typeof parent.config.settings.autobackup.s3 == 'object')) {
            parent.debug( 'backup', 'Entering S3 backup');
            var s3folderName = 'MeshCentral-Backups';
            if (typeof parent.config.settings.autobackup.s3.foldername == 'string') { s3folderName = parent.config.settings.autobackup.s3.foldername; }
            // Construct the config object
            var accessKey = parent.config.settings.autobackup.s3.accesskey,
                secretKey = parent.config.settings.autobackup.s3.secretkey,
                endpoint = parent.config.settings.autobackup.s3.endpoint ? parent.config.settings.autobackup.s3.endpoint : 's3.amazonaws.com',
                port = parent.config.settings.autobackup.s3.port ? parent.config.settings.autobackup.s3.port : 443,
                useSsl = parent.config.settings.autobackup.s3.ssl ? parent.config.settings.autobackup.s3.ssl : true,
                bucketName = parent.config.settings.autobackup.s3.bucketname,
                pathPrefix = s3folderName,
                threshold = parent.config.settings.autobackup.s3.maxfiles ? parent.config.settings.autobackup.s3.maxfiles : 0,
                fileToUpload = filename;
            // Create a MinIO client
            const Minio = require('minio');
            var minioClient = new Minio.Client({
                endPoint: endpoint,
                port: port,
                useSSL: useSsl,
                accessKey: accessKey,
                secretKey: secretKey
            });
            // List objects in the specified bucket and path prefix
            var listObjectsPromise = new Promise(function(resolve, reject) {
                var items = [];
                var stream = minioClient.listObjects(bucketName, pathPrefix, true);
                stream.on('data', function(item) {
                    if (!item.name.endsWith('/')) { // Exclude directories
                        items.push(item);
                    }
                });
                stream.on('end', function() {
                    resolve(items);
                });
                stream.on('error', function(err) {
                    reject(err);
                });
            });
            listObjectsPromise.then(function(objects) {
                // Count the number of files
                var fileCount = objects.length;
                 // Return if no files to carry on uploading
                if (fileCount === 0) { return Promise.resolve(); }
                // Sort the files by LastModified date (oldest first)
                objects.sort(function(a, b) { return new Date(a.lastModified) - new Date(b.lastModified); });
                // Check if the threshold is zero and return if 
                if (threshold === 0) { return Promise.resolve(); }
                // Check if the number of files exceeds the threshold (maxfiles) is 0
                if (fileCount >= threshold) {
                    // Calculate how many files need to be deleted to make space for the new file
                    var filesToDelete = fileCount - threshold + 1; // +1 to make space for the new file
                    if (func) { func('Deleting ' + filesToDelete + ' older ' + (filesToDelete == 1 ? 'file' : 'files') + ' from S3 ...'); }
                    // Create an array of promises for deleting files
                    var deletePromises = objects.slice(0, filesToDelete).map(function(fileToDelete) {
                        return new Promise(function(resolve, reject) {
                            minioClient.removeObject(bucketName, fileToDelete.name, function(err) {
                                if (err) {
                                    reject(err);
                                } else {
                                    if (func) { func('Deleted file: ' + fileToDelete.name + ' from S3'); }
                                    resolve();
                                }
                            });
                        });
                    });
                    // Wait for all deletions to complete
                    return Promise.all(deletePromises);
                } else {
                    return Promise.resolve(); // No deletion needed
                }
            }).then(function() {
                // Determine the upload path by combining the pathPrefix with the filename
                var fileName = require('path').basename(fileToUpload);
                var uploadPath = require('path').join(pathPrefix, fileName);
                // Upload a new file
                var uploadPromise = new Promise(function(resolve, reject) {
                    if (func) { func('Uploading file ' + uploadPath + ' to S3'); }
                    minioClient.fPutObject(bucketName, uploadPath, fileToUpload, function(err, etag) {
                    if (err) {
                        reject(err);
                    } else {
                        if (func) { func('Uploaded file: ' + uploadPath + ' to S3'); }
                        resolve(etag);
                    }
                    });
                });
                return uploadPromise;
            }).catch(function(error) {
                if (func) { func('Error managing files in S3: ' + error); }
            });
        }
    }

    // Transfer NeDB data into the current database
    obj.nedbtodb = function (func) {
        var nedbDatastore = null;
        try { nedbDatastore = require('@seald-io/nedb'); } catch (ex) { } // This is the NeDB with Node 23 support.
        if (nedbDatastore == null) {
            try { nedbDatastore = require('@yetzt/nedb'); } catch (ex) { } // This is the NeDB with fixed security dependencies.
            if (nedbDatastore == null) { nedbDatastore = require('nedb'); } // So not to break any existing installations, if the old NeDB is present, use it.
        }

        var datastoreOptions = { filename: parent.getConfigFilePath('meshcentral.db'), autoload: true };

        // If a DB encryption key is provided, perform database encryption
        if ((typeof parent.args.dbencryptkey == 'string') && (parent.args.dbencryptkey.length != 0)) {
            // Hash the database password into a AES256 key and setup encryption and decryption.
            var nedbKey = parent.crypto.createHash('sha384').update(parent.args.dbencryptkey).digest('raw').slice(0, 32);
            datastoreOptions.afterSerialization = function (plaintext) {
                const iv = parent.crypto.randomBytes(16);
                const aes = parent.crypto.createCipheriv('aes-256-cbc', nedbKey, iv);
                var ciphertext = aes.update(plaintext);
                ciphertext = Buffer.concat([iv, ciphertext, aes.final()]);
                return ciphertext.toString('base64');
            }
            datastoreOptions.beforeDeserialization = function (ciphertext) {
                const ciphertextBytes = Buffer.from(ciphertext, 'base64');
                const iv = ciphertextBytes.slice(0, 16);
                const data = ciphertextBytes.slice(16);
                const aes = parent.crypto.createDecipheriv('aes-256-cbc', nedbKey, iv);
                var plaintextBytes = Buffer.from(aes.update(data));
                plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
                return plaintextBytes.toString();
            }
        }

        // Setup all NeDB collections
        var nedbfile = new nedbDatastore(datastoreOptions);
        var nedbeventsfile = new nedbDatastore({ filename: parent.getConfigFilePath('meshcentral-events.db'), autoload: true, corruptAlertThreshold: 1 });
        var nedbpowerfile = new nedbDatastore({ filename: parent.getConfigFilePath('meshcentral-power.db'), autoload: true, corruptAlertThreshold: 1 });
        var nedbserverstatsfile = new nedbDatastore({ filename: parent.getConfigFilePath('meshcentral-stats.db'), autoload: true, corruptAlertThreshold: 1 });

        // Transfered record counts
        var normalRecordsTransferCount = 0;
        var eventRecordsTransferCount = 0;
        var powerRecordsTransferCount = 0;
        var statsRecordsTransferCount = 0;
        obj.pendingTransfer = 0;

        // Transfer the data from main database
        nedbfile.find({}, function (err, docs) {
            if ((err == null) && (docs.length > 0)) {
                performTypedRecordDecrypt(docs)
                for (var i in docs) {
                    obj.pendingTransfer++;
                    normalRecordsTransferCount++;
                    obj.Set(common.unEscapeLinksFieldName(docs[i]), function () { obj.pendingTransfer--; });
                }
            }

            // Transfer events
            nedbeventsfile.find({}, function (err, docs) {
                if ((err == null) && (docs.length > 0)) {
                    for (var i in docs) {
                        obj.pendingTransfer++;
                        eventRecordsTransferCount++;
                        obj.StoreEvent(docs[i], function () { obj.pendingTransfer--; });
                    }
                }

                // Transfer power events
                nedbpowerfile.find({}, function (err, docs) {
                    if ((err == null) && (docs.length > 0)) {
                        for (var i in docs) {
                            obj.pendingTransfer++;
                            powerRecordsTransferCount++;
                            obj.storePowerEvent(docs[i], null, function () { obj.pendingTransfer--; });
                        }
                    }

                    // Transfer server stats
                    nedbserverstatsfile.find({}, function (err, docs) {
                        if ((err == null) && (docs.length > 0)) {
                            for (var i in docs) {
                                obj.pendingTransfer++;
                                statsRecordsTransferCount++;
                                obj.SetServerStats(docs[i], function () { obj.pendingTransfer--; });
                            }
                        }

                        // Only exit when all the records are stored.
                        setInterval(function () {
                            if (obj.pendingTransfer == 0) { func("Done. " + normalRecordsTransferCount + " record(s), " + eventRecordsTransferCount + " event(s), " + powerRecordsTransferCount + " power change(s), " + statsRecordsTransferCount + " stat(s)."); }
                        }, 200)
                    });
                });
            });
        });
    }

    function padNumber(number, digits) { return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number; }

    // Called when a node has changed
    function dbNodeChange(nodeChange, added) {
        if (parent.webserver == null) return;
        common.unEscapeLinksFieldName(nodeChange.fullDocument);
        const node = performTypedRecordDecrypt([nodeChange.fullDocument])[0];
        parent.DispatchEvent(['*', node.meshid], obj, { etype: 'node', action: (added ? 'addnode' : 'changenode'), node: parent.webserver.CloneSafeNode(node), nodeid: node._id, domain: node.domain, nolog: 1 });
    }

    // Called when a device group has changed
    function dbMeshChange(meshChange, added) {
        if (parent.webserver == null) return;
        common.unEscapeLinksFieldName(meshChange.fullDocument);
        const mesh = performTypedRecordDecrypt([meshChange.fullDocument])[0];

        // Update the mesh object in memory
        const mmesh = parent.webserver.meshes[mesh._id];
        if (mmesh != null) {
            // Update an existing device group
            for (var i in mesh) { mmesh[i] = mesh[i]; }
            for (var i in mmesh) { if (mesh[i] == null) { delete mmesh[i]; } }
        } else {
            // Device group not present, create it.
            parent.webserver.meshes[mesh._id] = mesh;
        }

        // Send the mesh update
        var mesh2 = Object.assign({}, mesh); // Shallow clone
        if (mesh2.deleted) { mesh2.action = 'deletemesh'; } else { mesh2.action = (added ? 'createmesh' : 'meshchange'); }
        mesh2.meshid = mesh2._id;
        mesh2.nolog = 1;
        delete mesh2.type;
        delete mesh2._id;
        parent.DispatchEvent(['*', mesh2.meshid], obj, parent.webserver.CloneSafeMesh(mesh2));
    }

    // Called when a user account has changed
    function dbUserChange(userChange, added) {
        if (parent.webserver == null) return;
        common.unEscapeLinksFieldName(userChange.fullDocument);
        const user = performTypedRecordDecrypt([userChange.fullDocument])[0];
        
        // Update the user object in memory
        const muser = parent.webserver.users[user._id];
        if (muser != null) {
            // Update an existing user
            for (var i in user) { muser[i] = user[i]; }
            for (var i in muser) { if (user[i] == null) { delete muser[i]; } }
        } else {
            // User not present, create it.
            parent.webserver.users[user._id] = user;
        }

        // Send the user update
        var targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + i); } }
        parent.DispatchEvent(targets, obj, { etype: 'user', userid: user._id, username: user.name, account: parent.webserver.CloneSafeUser(user), action: (added ? 'accountcreate' : 'accountchange'), domain: user.domain, nolog: 1 });
    }

    // Called when a user group has changed
    function dbUGrpChange(ugrpChange, added) {
        if (parent.webserver == null) return;
        common.unEscapeLinksFieldName(ugrpChange.fullDocument);
        const usergroup = ugrpChange.fullDocument;

        // Update the user group object in memory
        const uusergroup = parent.webserver.userGroups[usergroup._id];
        if (uusergroup != null) {
            // Update an existing user group
            for (var i in usergroup) { uusergroup[i] = usergroup[i]; }
            for (var i in uusergroup) { if (usergroup[i] == null) { delete uusergroup[i]; } }
        } else {
            // Usergroup not present, create it.
            parent.webserver.userGroups[usergroup._id] = usergroup;
        }

        // Send the user group update
        var usergroup2 = Object.assign({}, usergroup); // Shallow clone
        usergroup2.action = (added ? 'createusergroup' : 'usergroupchange');
        usergroup2.ugrpid = usergroup2._id;
        usergroup2.nolog = 1;
        delete usergroup2.type;
        delete usergroup2._id;
        parent.DispatchEvent(['*', usergroup2.ugrpid], obj, usergroup2);
    }

    function dbMergeSqlArray(arr) {
        var x = '';
        for (var i in arr) { if (x != '') { x += ','; } x += '\'' + arr[i] + '\''; }
        return x;
    }

    return obj;
};
