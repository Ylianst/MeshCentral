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
    var expireEventsSeconds = (60 * 60 * 24 * 20);              // By default, expire events after 20 days. (Seconds * Minutes * Hours * Days)
    var expirePowerEventsSeconds = (60 * 60 * 24 * 10);         // By default, expire power events after 10 days. (Seconds * Minutes * Hours * Days)
    var expireServerStatsSeconds = (60 * 60 * 24 * 30);         // By default, expire power events after 30 days. (Seconds * Minutes * Hours * Days)
    obj.path = require('path');
    obj.parent = parent;
    obj.identifier = null;
    obj.dbKey = null;

    // Read expiration time from configuration file
    if (typeof obj.parent.args.dbexpire == 'object') {
        if (typeof obj.parent.args.dbexpire.events == 'number') { expireEventsSeconds = obj.parent.args.dbexpire.events; }
        if (typeof obj.parent.args.dbexpire.powerevents == 'number') { expirePowerEventsSeconds = obj.parent.args.dbexpire.powerevents; }
        if (typeof obj.parent.args.dbexpire.statsevents == 'number') { expireServerStatsSeconds = obj.parent.args.dbexpire.statsevents; }
    }

    if (obj.parent.args.mongodb) {
        // Use MongoDB
        obj.databaseType = 2;
        Datastore = require('mongojs');
        var db = Datastore(obj.parent.args.mongodb);
        var dbcollection = 'meshcentral';
        if (obj.parent.args.mongodbcol) { dbcollection = obj.parent.args.mongodbcol; }

        // Setup MongoDB main collection and indexes
        obj.file = db.collection(dbcollection);
        obj.file.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 4) || (indexesByName['TypeDomainMesh1'] == null) || (indexesByName['Email1'] == null) || (indexesByName['Mesh1'] == null)) {
                console.log('Resetting main indexes...');
                obj.file.dropIndexes(function (err) {
                    obj.file.createIndex({ type: 1, domain: 1, meshid: 1 }, { sparse: 1, name: 'TypeDomainMesh1' });       // Speeds up GetAllTypeNoTypeField() and GetAllTypeNoTypeFieldMeshFiltered()
                    obj.file.createIndex({ email: 1 }, { sparse: 1, name: 'Email1' });                                     // Speeds up GetUserWithEmail() and GetUserWithVerifiedEmail()
                    obj.file.createIndex({ meshid: 1 }, { sparse: 1, name: 'Mesh1' });                                     // Speeds up RemoveMesh()
                });
            }
        });

        // Setup MongoDB events collection and indexes
        obj.eventsfile = db.collection('events');                               // Collection containing all events
        obj.eventsfile.getIndexes(function (err, indexes) {
            // Check if we need to reset indexes
            var indexesByName = {}, indexCount = 0;
            for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
            if ((indexCount != 5) || (indexesByName['Username1'] == null) || (indexesByName['DomainNodeTime1'] == null) || (indexesByName['IdsAndTime1'] == null) || (indexesByName['ExpireTime1'] == null)) {
                // Reset all indexes
                console.log('Resetting events indexes...');
                obj.eventsfile.dropIndexes(function (err) {
                    obj.eventsfile.createIndex({ username: 1 }, { sparse: 1, name: 'Username1' });
                    obj.eventsfile.createIndex({ domain: 1, nodeid: 1, time: -1 }, { sparse: 1, name: 'DomainNodeTime1' });
                    obj.eventsfile.createIndex({ ids: 1, time: -1 }, { sparse: 1, name: 'IdsAndTime1' });
                    obj.eventsfile.createIndex({ "time": 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireEventsSeconds) {
                // Reset the timeout index
                console.log('Resetting events expire index...');
                obj.eventsfile.dropIndex("ExpireTime1", function (err) {
                    obj.eventsfile.createIndex({ "time": 1 }, { expireAfterSeconds: expireEventsSeconds, name: 'ExpireTime1' });
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
                console.log('Resetting power events indexes...');
                obj.powerfile.dropIndexes(function (err) {
                    // Create all indexes
                    obj.powerfile.createIndex({ nodeid: 1, time: 1 }, { sparse: 1, name: 'NodeIdAndTime1' });
                    obj.powerfile.createIndex({ "time": 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expirePowerEventsSeconds) {
                // Reset the timeout index
                console.log('Resetting power events expire index...');
                obj.powerfile.dropIndex("ExpireTime1", function (err) {
                    // Reset the expire power events index
                    obj.powerfile.createIndex({ "time": 1 }, { expireAfterSeconds: expirePowerEventsSeconds, name: 'ExpireTime1' });
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
                console.log('Resetting server stats indexes...');
                obj.serverstatsfile.dropIndexes(function (err) {
                    // Create all indexes
                    obj.serverstatsfile.createIndex({ "time": 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                    obj.serverstatsfile.createIndex({ "expire": 1 }, { expireAfterSeconds: 0, name: 'ExpireTime2' });  // Auto-expire events
                });
            } else if (indexesByName['ExpireTime1'].expireAfterSeconds != expireServerStatsSeconds) {
                // Reset the timeout index
                console.log('Resetting server stats expire index...');
                obj.serverstatsfile.dropIndex("ExpireTime1", function (err) {
                    // Reset the expire server stats index
                    obj.serverstatsfile.createIndex({ "time": 1 }, { expireAfterSeconds: expireServerStatsSeconds, name: 'ExpireTime1' });
                });
            }
        });
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

        // Start NeDB main collection and setup indexes
        obj.file = new Datastore(datastoreOptions);
        obj.file.persistence.setAutocompactionInterval(36000);
        obj.file.ensureIndex({ fieldName: 'type' });
        obj.file.ensureIndex({ fieldName: 'domain' });
        obj.file.ensureIndex({ fieldName: 'meshid', sparse: true });
        obj.file.ensureIndex({ fieldName: 'nodeid', sparse: true });
        obj.file.ensureIndex({ fieldName: 'email', sparse: true });

        // Setup the events collection and setup indexes
        obj.eventsfile = new Datastore({ filename: obj.parent.getConfigFilePath('meshcentral-events.db'), autoload: true });
        obj.eventsfile.persistence.setAutocompactionInterval(36000);
        obj.eventsfile.ensureIndex({ fieldName: 'ids' }); // TODO: Not sure if this is a good index, this is a array field.
        obj.eventsfile.ensureIndex({ fieldName: 'nodeid', sparse: true });
        obj.eventsfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: 60 * 60 * 24 * 20 }); // Limit the power event log to 20 days (Seconds * Minutes * Hours * Days)

        // Setup the power collection and setup indexes
        obj.powerfile = new Datastore({ filename: obj.parent.getConfigFilePath('meshcentral-power.db'), autoload: true });
        obj.powerfile.persistence.setAutocompactionInterval(36000);
        obj.powerfile.ensureIndex({ fieldName: 'nodeid' });
        obj.powerfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: 60 * 60 * 24 * 10 }); // Limit the power event log to 10 days (Seconds * Minutes * Hours * Days)

        // Setup the SMBIOS collection
        obj.smbiosfile = new Datastore({ filename: obj.parent.getConfigFilePath('meshcentral-smbios.db'), autoload: true });

        // Setup the server stats collection and setup indexes
        obj.serverstatsfile = new Datastore({ filename: obj.parent.getConfigFilePath('meshcentral-stats.db'), autoload: true });
        obj.serverstatsfile.persistence.setAutocompactionInterval(36000);
        obj.serverstatsfile.ensureIndex({ fieldName: 'time', expireAfterSeconds: 60 * 60 * 24 * 30 }); // Limit the server stats log to 30 days (Seconds * Minutes * Hours * Days)
        obj.serverstatsfile.ensureIndex({ fieldName: 'expire', expireAfterSeconds: 0 }); // Auto-expire events
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

        // Remove all events, power events and SMBIOS data from the main collection. They are all in seperate collections now.
        obj.file.remove({ type: 'event' }, { multi: true });
        obj.file.remove({ type: 'power' }, { multi: true });
        obj.file.remove({ type: 'smbios' }, { multi: true });

        // Remove all objects that have a "meshid" that no longer points to a valid mesh.
        obj.GetAllType('mesh', function (err, docs) {
            var meshlist = [];
            if ((err == null) && (docs.length > 0)) { for (var i in docs) { meshlist.push(docs[i]._id); } }
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

    // Database actions on the main collection
    obj.Set = function (data, func) { obj.file.update({ _id: data._id }, data, { upsert: true }, func); };
    obj.Get = function (id, func)
    {
        if (arguments.length > 2)
        {
            var parms = [func];
            for (var parmx = 2; parmx < arguments.length; ++parmx) { parms.push(arguments[parmx]); }
            var func2 = function _func2(arg1, arg2)
            {
                var userCallback = _func2.userArgs.shift();
                _func2.userArgs.unshift(arg2);
                _func2.userArgs.unshift(arg1);
                userCallback.apply(obj, _func2.userArgs);
            };
            func2.userArgs = parms;
            obj.file.find({ _id: id }, func2);
        }
        else
        {
            obj.file.find({ _id: id }, func);
        }
    };
    obj.GetAll = function (func) { obj.file.find({}, func); };
    obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }, { type: 0 }, func); };
    obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, domain, type, id, func) { var x = { type: type, domain: domain, meshid: { $in: meshes } }; if (id) { x._id = id; } obj.file.find(x, { type: 0 }, func); };
    obj.GetAllType = function (type, func) { obj.file.find({ type: type }, func); };
    obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.find({ type: type, domain: domain, _id: { $in: ids } }, func); };
    obj.GetUserWithEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email }, { type: 0 }, func); };
    obj.GetUserWithVerifiedEmail = function (domain, email, func) { obj.file.find({ type: 'user', domain: domain, email: email, emailVerified: true }, { type: 0 }, func); };
    obj.Remove = function (id) { obj.file.remove({ _id: id }); };
    obj.RemoveAll = function (func) { obj.file.remove({}, { multi: true }, func); };
    obj.RemoveAllOfType = function (type, func) { obj.file.remove({ type: type }, { multi: true }, func); };
    obj.InsertMany = function (data, func) { obj.file.insert(data, func); };
    obj.RemoveMeshDocuments = function (id) { obj.file.remove({ meshid: id }, { multi: true }); obj.file.remove({ _id: 'nt' + id }); };
    obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if (docs.length == 1) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); };
    obj.DeleteDomain = function (domain, func) { obj.file.remove({ domain: domain }, { multi: true }, func); };
    obj.SetUser = function (user) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); };
    obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } };
    obj.getLocalAmtNodes = function (func) { obj.file.find({ type: 'node', host: { $exists: true, $ne: null }, intelamt: { $exists: true } }, func); };
    obj.getAmtUuidNode = function (meshid, uuid, func) { obj.file.find({ type: 'node', meshid: meshid, 'intelamt.uuid': uuid }, func); };
    obj.isMaxType = function (max, type, domainid, func) { if (max == null) { func(false); } else { obj.file.count({ type: type, domain: domainid }, function (err, count) { func((err != null) || (count > max)); }); } }

    // Database actions on the events collection
    obj.GetAllEvents = function (func) { obj.eventsfile.find({}, func); };
    obj.StoreEvent = function (event) { obj.eventsfile.insert(event); };
    obj.GetEvents = function (ids, domain, func) { if (obj.databaseType == 1) { obj.eventsfile.find({ domain: domain, ids: { $in: ids } }, { _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).exec(func); } else { obj.eventsfile.find({ domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }, func); } };
    obj.GetEventsWithLimit = function (ids, domain, limit, func) { if (obj.databaseType == 1) { obj.eventsfile.find({ domain: domain, ids: { $in: ids } }, { _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func); } else { obj.eventsfile.find({ domain: domain, ids: { $in: ids } }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func); } };
    obj.GetUserEvents = function (ids, domain, username, func) {
        if (obj.databaseType == 1) {
            obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }, { username: username }] }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).exec(func);
        } else {
            obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }, { username: username }] }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }, func);
        }
    };
    obj.GetUserEventsWithLimit = function (ids, domain, username, limit, func) {
        if (obj.databaseType == 1) {
            obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }, { username: username }] }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit).exec(func);
        } else {
            obj.eventsfile.find({ domain: domain, $or: [{ ids: { $in: ids } }, { username: username }] }, { type: 0, _id: 0, domain: 0, ids: 0, node: 0 }).sort({ time: -1 }).limit(limit, func);
        }
    };
    obj.GetNodeEventsWithLimit = function (nodeid, domain, limit, func) { if (obj.databaseType == 1) { obj.eventsfile.find({ domain: domain, nodeid: nodeid }, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit).exec(func); } else { obj.eventsfile.find({ domain: domain, nodeid: nodeid }, { type: 0, etype: 0, _id: 0, domain: 0, ids: 0, node: 0, nodeid: 0 }).sort({ time: -1 }).limit(limit, func); } };
    obj.RemoveAllEvents = function (domain) { obj.eventsfile.remove({ domain: domain }, { multi: true }); };
    obj.RemoveAllNodeEvents = function (domain, nodeid) { obj.eventsfile.remove({ domain: domain, nodeid: nodeid }, { multi: true }); };

    // Database actions on the power collection
    obj.getAllPower = function (func) { obj.powerfile.find({}, func); };
    obj.storePowerEvent = function (event, multiServer, func) { if (multiServer != null) { event.server = multiServer.serverid; } obj.powerfile.insert(event, func); };
    obj.getPowerTimeline = function (nodeid, func) { if (obj.databaseType == 1) { obj.powerfile.find({ nodeid: { $in: ['*', nodeid] } }, { _id: 0, nodeid: 0, s: 0 }).sort({ time: 1 }).exec(func); } else { obj.powerfile.find({ nodeid: { $in: ['*', nodeid] } }, { _id: 0, nodeid: 0, s: 0 }).sort({ time: 1 }, func); } };
    obj.removeAllPowerEvents = function () { obj.powerfile.remove({}, { multi: true }); };
    obj.removeAllPowerEventsForNode = function (nodeid) { obj.powerfile.remove({ nodeid: nodeid }, { multi: true }); };

    // Database actions on the SMBIOS collection
    obj.SetSMBIOS = function (smbios, func) { obj.smbiosfile.update({ _id: smbios._id }, smbios, { upsert: true }, func); };
    obj.RemoveSMBIOS = function (id) { obj.smbiosfile.remove({ _id: id }); };
    obj.GetSMBIOS = function (id, func) { obj.smbiosfile.find({ _id: id }, func); };

    // Database actions on the Server Stats collection
    obj.SetServerStats = function (data, func) { obj.serverstatsfile.insert(data, func); };
    obj.GetServerStats = function (hours, func) { var t = new Date(); t.setTime(t.getTime() - (60 * 60 * 1000 * hours)); obj.serverstatsfile.find({ time: { $gt: t } }, { _id: 0, cpu: 0 }, func); };

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
                func({ nodes: counters['node'], meshes: counters['mesh'], users: counters['user'], total: totalCount });
            })
        } else {
            // NeDB version
            obj.file.count({ type: 'node' }, function (err, nodeCount) {
                obj.file.count({ type: 'mesh' }, function (err, meshCount) {
                    obj.file.count({ type: 'user' }, function (err, userCount) {
                        obj.file.count({}, function (err, totalCount) {
                            func({ nodes: nodeCount, meshes: meshCount, users: userCount, total: totalCount });
                        });
                    });
                });
            });
        }
    }

    // This is used to rate limit a number of operation per day. Returns a startValue each new days, but you can substract it and save the value in the db.
    obj.getValueOfTheDay = function (id, startValue, func) { obj.Get(id, function (err, docs) { var date = new Date(), t = date.toLocaleDateString(); if (docs.length == 1) { var r = docs[0]; if (r.day == t) { func({ _id: id, value: r.value, day: t }); return; } } func({ _id: id, value: startValue, day: t }); }); };
    obj.escapeBase64 = function escapeBase64(val) { return (val.replace(/\+/g, '@').replace(/\//g, '$')); }

    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    return obj;
};