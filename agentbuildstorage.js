'use strict';

exports.get = (db, id) => new Promise((resolve, reject) => db.Get(id, (err, docs) => err ? reject(err) : resolve((docs || [])[0])));
exports.set = (db, value) => new Promise((resolve, reject) => db.Set(value, err => err ? reject(err) : resolve(value)));
exports.remove = (db, id) => new Promise((resolve, reject) => db.Remove(id, err => err ? reject(err) : resolve()));
exports.records = async function* (db, type, domain, prefix = '') {
    let cursor = prefix;
    for (;;) {
        const rows = await new Promise((resolve, reject) => db.GetAgentBuildRecords(type, domain, cursor, 500, (err, rows) => err ? reject(err) : resolve(rows || []), prefix));
        for (const row of rows) yield row;
        if (rows.length < 500) return;
        const next = rows[rows.length - 1]._id;
        if (next === cursor) throw new Error('Invalid agent build pagination.');
        cursor = next;
    }
};
exports.admin = function (domain, user, loginToken) {
    if (!user || user.domain !== domain.id || user.siteadmin !== 0xFFFFFFFF || loginToken) throw new Error('Access denied');
};
exports.domainKey = domain => require('crypto').createHash('sha256').update(domain.id || '').digest('hex');
