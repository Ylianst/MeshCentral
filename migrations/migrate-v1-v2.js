/**
* @description example migrationscript
*
* Example info: This migration converts db v1 to the v2 schema
* 
*
* !!Important
* - Migrate scripts need to be idempotent. They must be able to be run multiple times without side-effects.
*   This is needed for multipeer environments and fail-safety.
*
*/
'use strict';

// db: the MeshCentral database object (obj.db). callback(err, { scanned, migrated }).
module.exports.migrateDB = function (db, callback) {
    // iterate through all sysinfo records to perform some change
    db.GetAllType('sysinfo', function (err, docs) {
        if (err != null) { if (callback != null) { callback(err); } return; }
        var scanned = 0, migrated = 0, writesPending = 0, listed = false, changed;
        var done = function () { if (listed && (writesPending == 0) && (callback != null)) { callback(null, { scanned: scanned, migrated: migrated }); } };
        for (var d in docs) {
            changed = false;
            var doc = docs[d];
            scanned++;
            var windows = (doc.hardware != null) ? doc.hardware.windows : null;
            // Skip non-Windows documents and anything already on the new schema.
            if ((windows == null) || (windows.volumes == null) || (windows.volumes.somePropertyAddedByThisMigration != null )) { continue; }

            var keys = {};
            for (var letter in windows.volumes) {
                var v = windows.volumes[letter];
                // check/change something
                // if (something changed) { changed = true; }
                
            }
            // only write changed records
            if (!changed) { continue; }
            migrated++;
            writesPending++;
            db.Set(doc, function () { writesPending--; done(); });
        }
        listed = true;
        done();
    });
};