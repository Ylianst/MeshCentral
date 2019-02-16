/** 
* @description MeshCentral database module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
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
module.exports.CreateDB = function (parent) {
    var obj = {};
    var Datastore = null;
    obj.path = require('path');
    obj.parent = parent;
    obj.identifier = null;
    obj.dbKey = null;

    if (obj.parent.args.mongodb) {
        // Use MongoDB
        obj.databaseType = 2;
        Datastore = require('mongojs');
        var db = Datastore(obj.parent.args.mongodb);
        var dbcollection = 'meshcentral';
        if (obj.parent.args.mongodbcol) { dbcollection = obj.parent.args.mongodbcol; }
        obj.file = db.collection(dbcollection);

        // Setup MongoDB indexes
        obj.file.createIndex({ type: 1, domain: 1, meshid: 1 }, { sparse: 1 });         // Speeds up GetAllTypeNoTypeField() and GetAllTypeNoTypeFieldMeshFiltered()
        obj.file.createIndex({ email: 1 }, { sparse: 1 });                              // Speeds up GetUserWithEmail() and GetUserWithVerifiedEmail()
        obj.file.createIndex({ ids: 1, time: -1 }, { sparse: 1 });                      // Speeds up GetEvents() and GetEventsWithLimit()
        obj.file.createIndex({ type: 1, node: 1, time: -1 }, { sparse: 1 });            // Speeds up getPowerTimeline()
        obj.file.createIndex({ mesh: 1 }, { sparse: 1 });                               // Speeds up RemoveMesh()
    } else {
        // Use NeDB (The default)
        obj.databaseType = 1;
        Datastore = require('nedb');
        var datastoreOptions = { filename: obj.parent.getConfigFilePath('meshcentral.db'), autoload: true };

        // If a DB encryption key is provided, perform database encryption
        if ((typeof obj.parent.args.dbencryptkey == 'string') && (obj.parent.args.dbencryptkey.length != 0)) {
            // Hash the database password into a AES256 key and setup encryption and decryption.
            obj.dbKey = obj.parent.crypto.createHash('sha384').update(obj.parent.args.dbencryptkey).digest("raw").slice(0, 32);
            datastoreOptions.afterSerialization = function (plaintext) {
                const iv = obj.parent.crypto.randomBytes(16);
                const aes = obj.parent.crypto.createCipheriv('aes-256-cbc', obj.dbKey, iv);
                var ciphertext = aes.update(plaintext);
                ciphertext = Buffer.concat([iv, ciphertext, aes.final()]);
                return ciphertext.toString('base64');
            }
            datastoreOptions.beforeDeserialization = function (ciphertext) {
                const ciphertextBytes = Buffer.from(ciphertext, 'base64');
                const iv = ciphertextBytes.slice(0, 16);
                const data = ciphertextBytes.slice(16);
                const aes = obj.parent.crypto.createDecipheriv('aes-256-cbc', obj.dbKey, iv);
                var plaintextBytes = Buffer.from(aes.update(data));
                plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
                return plaintextBytes.toString();
            }
        }

        // Start NeDB
        obj.file = new Datastore(datastoreOptions);
        obj.file.persistence.setAutocompactionInterval(3600);

        // Setup NeDB indexes
        obj.file.ensureIndex({ fieldName: 'type' });
        obj.file.ensureIndex({ fieldName: 'domain' });
        obj.file.ensureIndex({ fieldName: 'meshid' });
        obj.file.ensureIndex({ fieldName: 'node' });
        obj.file.ensureIndex({ fieldName: 'email' });
    }

    obj.SetupDatabase = function (func) {
        // Check if the database unique identifier is present
        // This is used to check that in server peering mode, everyone is using the same database.
        obj.Get('DatabaseIdentifier', function (err, docs) {
            if ((docs.length == 1) && (docs[0].value != null)) {
                obj.identifier = docs[0].value;
            } else {
                obj.identifier = Buffer.from(require('crypto').randomBytes(48), 'binary').toString('hex');
                obj.Set({ _id: 'DatabaseIdentifier', value: obj.identifier });
            }
        });

        // Load database schema version and check if we need to update
        obj.Get('SchemaVersion', function (err, docs) {
            var ver = 0;
            if (docs && docs.length == 1) { ver = docs[0].value; }
            if (ver == 1) { console.log('This is an unsupported beta 1 database, delete it to create a new one.'); process.exit(0); }

            // TODO: Any schema upgrades here...
            obj.Set({ _id: 'SchemaVersion', value: 2 });

            func(ver);
        });
    };

    obj.cleanup = function (func) {
        // TODO: Remove all mesh links to invalid users
        // TODO: Remove all meshes that dont have any links

        // Remove all objects that have a "meshid" that no longer points to a valid mesh.
        obj.GetAllType('mesh', function (err, docs) {
            var meshlist = [];
            if (err == null && docs.length > 0) { for (var i in docs) { meshlist.push(docs[i]._id); } }
            obj.file.remove({ meshid: { $exists: true, $nin: meshlist } }, { multi: true });

            // Fix all of the creating & login to ticks by seconds, not milliseconds.
            obj.GetAllType('user', function (err, docs) {
                if (err == null && docs.length > 0) {
                    for (var i in docs) {
                        var fixed = false;

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

                        // We are done
                        if (func) { func(); }
                    }
                }
            });
        });
    };

    obj.Set = function (data, func) { obj.file.update({ _id: data._id }, data, { upsert: true }, func); };
    obj.Get = function (id, func) { obj.file.find({ _id: id }, func); };
    obj.GetAll = function (func) { obj.file.find({}, func); };
    obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }, { type: 0 }, func); };
    obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, domain, type, id, func) { var x = { type: type, domain: domain, meshid: { $in: meshes } }; if (id) { x._id = id; } obj.file.find(x, { type: 0 }, func); };
    obj.GetAllType = function (type, func) { obj.file.find({ type: type }, func); };
    obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.find({ type: type, domain: domain, _id: { $in: ids } }, func); };
    obj.GetUserWithEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email }, { type: 0 }, func); };
    obj.GetUserWithVerifiedEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email, emailVerified: true }, { type: 0 }, func); };
    obj.Remove = function (id) { obj.file.remove({ _id: id }); };
    obj.RemoveNode = function (id) { obj.file.remove({ node: id }, { multi: true }); };
    obj.RemoveAll = function (func) { obj.file.remove({}, { multi: true }, func); };
    obj.RemoveAllOfType = function (type, func) { obj.file.remove({ type: type }, { multi: true }, func); };
    obj.InsertMany = function (data, func) { obj.file.insert(data, func); };
    obj.StoreEvent = function (ids, source, event) { obj.file.insert(event); };
    obj.GetEvents = function (ids, domain, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).exec(func); } else { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }, func); } };
    obj.GetEventsWithLimit = function (ids, domain, limit, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func); } else { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func); } };
    obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'event', domain: domain, nodeid: nodeid }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func); } else { obj.file.find({ type: 'event', domain: domain, nodeid: nodeid }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func); } };
    obj.RemoveMesh = function (id) { obj.file.remove({ mesh: id }, { multi: true }); obj.file.remove({ _id: id }); obj.file.remove({ _id: 'nt' + id }); };
    obj.RemoveAllEvents = function (domain) { obj.file.remove({ type: 'event', domain: domain }, { multi: true }); };
    obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if (docs.length == 1) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
    obj.DeleteDomain = function (domain, func) { obj.file.remove({ domain: domain }, { multi: true }, func); };
    obj.SetUser = function (user) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); };
    obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
    obj.clearOldEntries = function (type, days, domain) { var cutoff = Date.now() - (1000 * 60 * 60 * 24 * days); obj.file.remove({ type: type, time: { $lt: cutoff } }, { multi: true }); };
    obj.getPowerTimeline = function (nodeid, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'power', node: { $in: ['*', nodeid] } }).sort({ time: 1 }).exec(func); } else { obj.file.find({ type: 'power', node: { $in: ['*', nodeid] } }).sort({ time: 1 }, func); } };
    obj.getLocalAmtNodes = function (func) { obj.file.find({ type: 'node', host: { $exists: true, $ne: null }, intelamt: { $exists: true } }, func); };
    obj.getAmtUuidNode = function (meshid, uuid, func) { obj.file.find({ type: 'node', meshid: meshid, 'intelamt.uuid': uuid }, func); };
    obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { obj.file.count({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max)); }); } }

    // Read a configuration file from the database
    obj.getConfigFile = function (path, func) { obj.Get('cfile/' + path, func); }

    // Write a configuration file to the database
    obj.setConfigFile = function (path, data, func) { obj.Set({ _id: 'cfile/' + path, type: 'cfile', data: data.toString('base64') }, func); }

    // List all configuration files
    obj.listConfigFiles = function (func) { obj.file.find({ type: 'cfile' }).sort({ _id: 1 }).exec(func); }

    // Get all configuration files
    obj.getAllConfigFiles = function (password, func) {
        obj.file.find({ type: 'cfile' }, function (err, docs) {
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

    // Get encryption key
    obj.getEncryptDataKey = function (password) {
        if (typeof password != 'string') return null;
        return obj.parent.crypto.createHash('sha384').update(password).digest("raw").slice(0, 32);
    }

    // Encrypt data 
    obj.encryptData = function (password, plaintext) {
        var key = obj.getEncryptDataKey(password);
        if (key == null) return null;
        const iv = obj.parent.crypto.randomBytes(16);
        const aes = obj.parent.crypto.createCipheriv('aes-256-cbc', key, iv);
        var ciphertext = aes.update(plaintext);
        ciphertext = Buffer.concat([iv, ciphertext, aes.final()]);
        return ciphertext.toString('base64');
    }

    // Decrypt data 
    obj.decryptData = function (password, ciphertext) {
        try {
            var key = obj.getEncryptDataKey(password);
            if (key == null) return null;
            const ciphertextBytes = Buffer.from(ciphertext, 'base64');
            const iv = ciphertextBytes.slice(0, 16);
            const data = ciphertextBytes.slice(16);
            const aes = obj.parent.crypto.createDecipheriv('aes-256-cbc', key, iv);
            var plaintextBytes = Buffer.from(aes.update(data));
            plaintextBytes = Buffer.concat([plaintextBytes, aes.final()]);
            return plaintextBytes;
        } catch (ex) { return null; }
    }

    // Get the number of records in the database for various types, this is the slow NeDB way.
    // WARNING: This is a terrible query for database performance. Only do this when needed. This query will look at almost every document in the database.
    obj.getStats = function (func) {
        if (obj.databaseType == 2) {
            // MongoDB version
            obj.file.aggregate([{ "$group": { _id: "$type", count: { $sum: 1 } } }], function (err, docs) {
                var counters = {}, totalCount = 0;
                for (var i in docs) { if (docs[i]._id != null) { counters[docs[i]._id] = docs[i].count; totalCount += docs[i].count; } }
                func({ nodes: counters['node'], meshes: counters['mesh'], powerEvents: counters['power'], users: counters['user'], total: totalCount });
            })
        } else {
            // NeDB version
            obj.file.count({ type: 'node' }, function (err, nodeCount) {
                obj.file.count({ type: 'mesh' }, function (err, meshCount) {
                    obj.file.count({ type: 'power' }, function (err, powerCount) {
                        obj.file.count({ type: 'user' }, function (err, userCount) {
                            obj.file.count({}, function (err, totalCount) {
                                func({ nodes: nodeCount, meshes: meshCount, powerEvents: powerCount, users: userCount, nodeInterfaces: nodeInterfaceCount, notes: noteCount, connectEvent: nodeLastConnectCount, smbios: nodeSmbiosCount, total: totalCount });
                            });
                        });
                    });
                });
            });
        }
    }

    // This is used to rate limit a number of operation per day. Returns a startValue each new days, but you can substract it and save the value in the db.
    obj.getValueOfTheDay = function (id, startValue, func) { obj.Get(id, function (err, docs) { var date = new Date(), t = date.toLocaleDateString(); if (docs.length == 1) { var r = docs[0]; if (r.day == t) { func({ _id: id, value: r.value, day: t }); return; } } func({ _id: id, value: startValue, day: t }); }); };

    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    return obj;
};