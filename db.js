/** 
* @description MeshCentral database module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
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

    if (obj.parent.args.mongodb) {
        // Use MongoDB
        obj.databaseType = 2;
        Datastore = require('mongojs');
        var db = Datastore(obj.parent.args.mongodb);
        var dbcollection = 'meshcentral';
        if (obj.parent.args.mongodbcol) { dbcollection = obj.parent.args.mongodbcol; }
        obj.file = db.collection(dbcollection);
    } else {
        // Use NeDB (The default)
        obj.databaseType = 1;
        Datastore = require('nedb');
        obj.file = new Datastore({ filename: obj.parent.getConfigFilePath('meshcentral.db'), autoload: true });
        obj.file.persistence.setAutocompactionInterval(3600);
    }

    obj.SetupDatabase = function (func) {
        // Check if the database unique identifier is present
        // This is used to check that in server peering mode, everyone is using the same database.
        obj.Get('DatabaseIdentifier', function (err, docs) {
            if ((docs.length == 1) && (docs[0].value != null)) {
                obj.identifier = docs[0].value;
            } else {
                obj.identifier = new Buffer(require('crypto').randomBytes(48), 'binary').toString('hex');
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

    obj.cleanup = function () {
        // TODO: Remove all mesh links to invalid users
        // TODO: Remove all meshes that dont have any links

        // Remove all objects that have a "meshid" that no longer points to a valid mesh.
        obj.GetAllType('mesh', function (err, docs) {
            var meshlist = [];
            if (err == null && docs.length > 0) { for (var i in docs) { meshlist.push(docs[i]._id); } }
            obj.file.remove({ meshid: { $exists: true, $nin: meshlist } }, { multi: true });
        });

        // Clear up all users
        /*
        obj.GetAllType('user', function (err, docs) {
            for (var i in docs) { if (docs[i].subscriptions != null) { console.log('Clean user: ' + docs[i].name); obj.SetUser(docs[i]); } } // Remove "subscriptions" that should not be there.
        });
        */
    };

    obj.Set = function (data, func) { obj.file.update({ _id: data._id }, data, { upsert: true }, func); };
    obj.Get = function (id, func) { obj.file.find({ _id: id }, func); };
    obj.GetAll = function (func) { obj.file.find({}, func); };
    obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }, { type: 0 }, func); };
    obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, domain, type, func) { obj.file.find({ type: type, domain: domain, meshid: { $in: meshes } }, { type: 0 }, func); };
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

    // Get the number of records in the database for various types, this is the slow NeDB way. TODO: MongoDB can use group() to do this faster.
    obj.getStats = function (func) {
        obj.file.count({ type: 'node' }, function (err, nodeCount) {
            obj.file.count({ type: 'mesh' }, function (err, meshCount) {
                obj.file.count({ type: 'power' }, function (err, powerCount) {
                    obj.file.count({ type: 'user' }, function (err, userCount) {
                        obj.file.count({ type: 'ifinfo' }, function (err, nodeInterfaceCount) {
                            obj.file.count({ type: 'note' }, function (err, noteCount) {
                                obj.file.count({ type: 'smbios' }, function (err, nodeSmbiosCount) {
                                    obj.file.count({ type: 'lastconnect' }, function (err, nodeLastConnectCount) {
                                        obj.file.count({ }, function (err, totalCount) {
                                            func({ nodes: nodeCount, meshes: meshCount, powerEvents: powerCount, users: userCount, nodeInterfaces: nodeInterfaceCount, notes: noteCount, connectEvent: nodeLastConnectCount, smbios: nodeSmbiosCount, total: totalCount });
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

    // This is used to rate limit a number of operation per day. Returns a startValue each new days, but you can substract it and save the value in the db.
    obj.getValueOfTheDay = function (id, startValue, func) { obj.Get(id, function (err, docs) { var date = new Date(), t = date.toLocaleDateString(); if (docs.length == 1) { var r = docs[0]; if (r.day == t) { func({ _id: id, value: r.value, day: t }); return; } } func({ _id: id, value: startValue, day: t }); }); };

    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    return obj;
};