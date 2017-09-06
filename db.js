/** 
* @description Meshcentral database
* @author Ylian Saint-Hilaire
* @version v0.0.2
*/

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
module.exports.CreateDB = function (args, datapath) {
    var obj = {};
    obj.path = require('path');
    if (args.mongodb) {
        // Use MongoDB
        obj.databaseType = 2;
        var Datastore = require("mongojs");
        var db = Datastore(args.mongodb);
        var dbcollection = 'meshcentral';
        if (args.mongodbcol) { dbcollection = args.mongodbcol; }
        obj.file = db.collection(dbcollection);
    } else {
        // Use NeDB (The default)
        obj.databaseType = 1;
        var Datastore = require('nedb');
        obj.file = new Datastore({ filename: obj.path.join(datapath, 'meshcentral.db'), autoload: true });
        obj.file.persistence.setAutocompactionInterval(3600);
    }
    
    obj.SetupDatabase = function (func) {
        // Load database schema version and check if we need to update
        obj.Get('SchemaVersion', function (err, docs) {
            var ver = 0;
            if (docs && docs.length == 1) { ver = docs[0].value; }

            // Upgrade schema 0 to schema 1
            if (ver == 0) {
                // Add the default domain to all users
                obj.GetAllType('user', function (err, docs) {
                    for (var id in docs) {
                        var oldid, changed = false;
                        if (docs[id].subscriptions) { delete docs[id].subscriptions; changed = true; }
                        if (docs[id].domain == undefined) {
                            docs[id].domain = '';
                            oldid = docs[id]._id;
                            docs[id]._id = 'user//' + docs[id]._id.substring(5);
                            changed = true;
                        }
                        if (docs[id].links) {
                            for (var linkid in docs[id].links) {
                                var linkid2 = 'mesh//' + linkid.substring(5);
                                docs[id].links[linkid2] = docs[id].links[linkid];
                                delete docs[id].links[linkid];
                            }
                        }
                        if (changed == true) {
                            if (oldid) obj.Remove(oldid);
                            obj.Set(docs[id]);
                        }
                    }
                    
                    // Add the default domain to all nodes
                    obj.GetAllType('node', function (err, docs) {
                        for (var id in docs) {
                            var oldid, changed = false;
                            if (docs[id].domain == undefined) {
                                docs[id].domain = '';
                                oldid = docs[id]._id;
                                docs[id]._id = 'node//' + docs[id]._id.substring(5);
                                docs[id].meshid = 'mesh//' + docs[id].meshid.substring(5);
                                changed = true;
                            }
                            if (changed == true) {
                                if (oldid) obj.Remove(oldid);
                                obj.Set(docs[id]);
                            }
                        }
                    });
                    
                    // Add the default domain to all meshes
                    obj.GetAllType('mesh', function (err, docs) {
                        for (var id in docs) {
                            var oldid, changed = false;
                            if (docs[id].domain == undefined) {
                                docs[id].domain = '';
                                oldid = docs[id]._id;
                                docs[id]._id = 'mesh//' + docs[id]._id.substring(5);
                                if (docs[id].links) {
                                    for (var linkid in docs[id].links) {
                                        var linkid2 = 'user//' + linkid.substring(5);
                                        docs[id].links[linkid2] = docs[id].links[linkid];
                                        delete docs[id].links[linkid];
                                    }
                                }
                                changed = true;
                            }
                            if (changed == true) {
                                if (oldid) obj.Remove(oldid);
                                obj.Set(docs[id]);
                            }
                        }
                    });
                    
                    // Add the default domain to all events
                    obj.GetAllType('event', function (err, docs) {
                        var changed = false;
                        for (var id in docs) {
                            var oldid;
                            changed = true;
                            if (docs[id].domain == undefined) {
                                docs[id].domain = '';
                                obj.Set(docs[id]);
                            }
                        }
                        
                        obj.Set({ _id: 'SchemaVersion', value: 1 });
                        ver = 1;
                        if (changed == true) { console.log('Upgraded database to version 1.'); }
                        func(ver);
                    });
                });

            } else { func(ver); }
        });
    }

    obj.cleanup = function () {
        // TODO: Remove all mesh links to invalid users
        // TODO: Remove all meshes that dont have any links

        // Remove all objects that have a "meshid" that no longer points to a valid mesh.
        obj.GetAllType('mesh', function (err, docs) {
            var meshlist = [];
            if (err == null && docs.length > 0) { for (var i in docs) { meshlist.push(docs[i]._id); } }
            obj.file.remove({ meshid: { $exists: true, $nin: meshlist } }, { multi: true });
        });
    }

    obj.Set = function (data) { obj.file.update({ _id: data._id }, data, { upsert: true }); }
    obj.Get = function (id, func) { obj.file.find({ _id: id }, func); }
    obj.GetAll = function (func) { obj.file.find({}, func); }
    obj.GetAllTypeNoTypeField = function (type, domain, func) { obj.file.find({ type: type, domain: domain }, { type : 0 }, func); }
    obj.GetAllTypeNoTypeFieldMeshFiltered = function (meshes, domain, type, func) { obj.file.find({ type: type, domain: domain, meshid: { $in: meshes } }, { type : 0 }, func); }
    obj.GetAllType = function (type, func) { obj.file.find({ type: type }, func); }
    obj.GetAllIdsOfType = function (ids, domain, type, func) { obj.file.find({ type: type, domain: domain, _id: { $in: ids } }, func); }
    obj.Remove = function (id) { obj.file.remove({ _id: id }); }
    obj.RemoveAll = function (func) { obj.file.remove({}, { multi: true }, func); }
    obj.InsertMany = function (data, func) { obj.file.insert(data, func); }
    obj.StoreEvent = function (ids, source, event) { obj.file.insert(event); }
    obj.GetEvents = function (ids, domain, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0 }).sort({ time: -1 }).exec(func); } else { obj.file.find({ type: 'event', domain: domain, ids: { $in: ids } }, { type: 0, _id: 0 }).sort({ time: -1 }, func) } }
    obj.RemoveMesh = function (id) { obj.file.remove({ mesh: id }, { multi: true }); obj.file.remove({ _id: id }); }
    obj.RemoveAllEvents = function (domain) { obj.file.remove({ type: 'event', domain: domain }, { multi: true }); }
    obj.MakeSiteAdmin = function (username, domain) { obj.Get('user/' + domain + '/' + username, function (err, docs) { if (docs.length == 1) { docs[0].siteadmin = 0xFFFFFFFF; obj.Set(docs[0]); } }); }
    obj.DeleteDomain = function (domain, func) { obj.file.remove({ domain: domain }, { multi: true }, func); }
    obj.SetUser = function(user) { var u = Clone(user); if (u.subscriptions) { delete u.subscriptions; } obj.Set(u); }
    obj.dispose = function () { for (var x in obj) { if (obj[x].close) { obj[x].close(); } delete obj[x]; } }
    obj.clearOldEntries = function (type, days, domain) { var cutoff = Date.now() - (1000 * 60 * 60 * 24 * days); obj.file.remove({ type: type, time: { $lt: cutoff } }, { multi: true }); }
    obj.getPowerTimeline = function (nodeid, func) { if (obj.databaseType == 1) { obj.file.find({ type: 'power', node: { $in: ['*', nodeid] } }).sort({ time: 1 }).exec(func); } else { obj.file.find({ type: 'power', node: { $in: ['*', nodeid] } }).sort({ time: 1 }, func); } }
    obj.getLocalAmtNodes = function (func) { obj.file.find({ type: 'node', host: { $exists: true, $ne: null }, intelamt: { $exists: true } }, func); }

    // This is used to rate limit a number of operation per day. Returns a startValue each new days, but you can substract it and save the value in the db.
    obj.getValueOfTheDay = function (id, startValue, func) { obj.Get(id, function (err, docs) { var date = new Date(), t = date.toLocaleDateString(); if (docs.length == 1) { var r = docs[0]; if (r.day == t) { func({ _id: id, value: r.value, day: t }); return; } } func({ _id: id, value: startValue, day: t }); }); }

    function Clone(v) { return JSON.parse(JSON.stringify(v)); }

    return obj;
}