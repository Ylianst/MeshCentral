// Table with the version ordered migrations, will be run in order from the version in the database to the version in the source
// Only data tranformations. For databasestructure changes, update the creation DDL and add an IF NOT EXISTS/ALTER for existing DBs in db.js

module.exports.migrations = [
    // example entry
    {
        version: 2,
        name: 'beta v1 -> v2',
        run: function (db, parent, done) {                  // done(err, summaryString)
            require('./migrations/migrate-v1-v2.js').migrateDB(db, function (err, r) {
                done(err, r ? ('scanned ' + r.scanned + ', migrated ' + r.migrated) : null);
            });
        }
    }
/*      
    ,
    {
        version: 3,
        name: 'v2 -> v3',
        run: function (db, parent, done) {                  // done(err, summaryString)
            require('./migrations/migrate-v3.js').migrateDB(db, function (err, r) {
                done(err, r ? ('scanned ' + r.scanned + ', migrated ' + r.migrated) : null);
            });
        }
    }
*/    
];