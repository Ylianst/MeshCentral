/**
* @description One-shot migration: convert pre-key-list BitLocker sysinfo documents to the
*              identifier-keyed hardware.windows.bitlocker map and convert DriveType
*
* Run with:  node meshcentral --migrateVolumeInfo
*
* Old sysinfo documents stored BitLocker recovery keys per-volume (recoveryPassword).
* The current schema keeps them in hardware.windows.bitlocker[identifier] = { rp, t }.
* Devices whose agents have not reconnected still hold the old shape.
* This moves the existing keys into the new map.
* Old DriveTypes (cdrom, removable) are converted to the raw windows code
*
* Notes:
*  - Idempotent: any document that already has hardware.windows.bitlocker is left untouched, so it is
*    safe to run repeatedly and a no-op once every device has re-sent sysinfo.
*  - Volume status strings written by the old agent are converted back to their raw codes.
*    Any unrecognized string is left untouched and still renders via the views' typeof==='string' branch.
*  - The timestamp (t) is taken from the document's own 'time' field (last sysinfo). With the default
*    bitlockerKeyRetentionDays=0, migrated keys persist for non-reconnecting devices and are rebuilt
*    from the live scan once a device reconnects.
*
* @license Apache-2.0
*/
'use strict';

// db: the MeshCentral database object (obj.db). callback(err, { scanned, migrated, keysMoved }).
module.exports.migrateVolumeInfo = function (db, callback) {
    // Legacy string (old agent stringified values) -> raw code, to restore the schema the current views expect.
    var conversionStatusCodes = { 'FullyDecrypted': 0, 'FullyEncrypted': 1, 'EncryptionInProgress': 2, 'DecryptionInProgress': 3, 'EncryptionPaused': 4, 'DecryptionPaused': 5 };
    db.GetAllType('sysinfo', function (err, docs) {
        if (err != null) { if (callback != null) { callback(err); } return; }
        var scanned = 0, migrated = 0, keysMoved = 0, writesPending = 0, listed = false;
        var done = function () { if (listed && (writesPending == 0) && (callback != null)) { callback(null, { scanned: scanned, migrated: migrated, keysMoved: keysMoved }); } };
        for (var d in docs) {
            var doc = docs[d];
            scanned++;
            var windows = (doc.hardware != null) ? doc.hardware.windows : null;
            // Skip non-Windows documents and anything already on the new schema.
            if ((windows == null) || (windows.volumes == null) || (windows.bitlocker != null)) { continue; }

            var keys = {};
            for (var letter in windows.volumes) {
                var v = windows.volumes[letter];
                // Live key read at the time of the last sysinfo, for the current protector.
                if (v.identifier && v.recoveryPassword) { keys[v.identifier] = { rp: v.recoveryPassword, t: (doc.time || 0) }; }
                // Reconstruct the raw Win32_LogicalDisk.DriveType code from the legacy boolean flags
                if (v.dType == null) {
                    if (v.removable) { v.dType = 2; }        // Removable Disk
                    else if (v.cdrom) { v.dType = 5; }       // Compact Disc / CD-ROM
                }
                delete v.removable; delete v.cdrom;
                // Restore raw status/method codes from the legacy stringified values. Unrecognized strings are left as is, handled in the views
                if ((typeof v.volumeStatus === 'string') && (conversionStatusCodes[v.volumeStatus] != null)) { v.volumeStatus = conversionStatusCodes[v.volumeStatus]; }
                // Old documents stored protectionStatus as a boolean (true = On; Off/Locked were dropped). Restore the
                // raw code: true -> 1 (On). Locked (2) was not retained by the old agent, so it cannot be recovered.
                if (typeof v.protectionStatus === 'boolean') { if (v.protectionStatus) { v.protectionStatus = 1; } else { delete v.protectionStatus; } }
            }
            windows.bitlocker = keys;
            migrated++;
            keysMoved += Object.keys(keys).length;
            writesPending++;
            db.Set(doc, function () { writesPending--; done(); });
        }
        listed = true;
        done();   // handle the case where nothing needed writing
    });
};
