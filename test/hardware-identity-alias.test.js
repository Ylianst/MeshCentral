// Hardware identity alias cleanup regression tests.
// Run: node test/hardware-identity-alias.test.js
// No MeshCentral service or production database is required.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'meshagent.js'), 'utf8');
const start = source.indexOf('    function resolveHardwareIdentityAlias(callback) {');
const end = source.indexOf('    function tryHardwareIdentityRebind(sysinfo) {', start);
assert(start !== -1 && end > start, 'Hardware alias resolver not found');
const resolver = source.slice(start, end);
const original = 'node//original';
const duplicate = 'node//duplicate';
const uuid = '95f71c86-5651-ef11-a4f7-28c5c8d6f212';

function runCase(label, opts = {}) {
    return new Promise((resolve, reject) => {
        const records = new Map();
        if (!opts.missingAlias) records.set('hwi' + duplicate, { target: original, uuid });
        if (!opts.missingOriginal) records.set(original, { _id: original, name: 'Original device', tags: ['preserve'] });
        if (!opts.missingDuplicate) records.set(duplicate, { _id: duplicate });
        records.set('si' + duplicate, { hardware: { identifiers: { product_uuid: opts.wrongUuid ? '00000000-0000-4000-8000-000000000001' : uuid } } });
        const removed = [];
        const power = [{ _id: 'p1', nodeid: duplicate, time: 100 }];
        const obj = { nodeid: 'new-cert', dbNodeKey: duplicate, actualDbNodeKey: duplicate };
        const agents = {};
        if (opts.originalOnline) agents[original] = { nodeid: 'other-cert' };
        if (opts.duplicateOnline) agents[duplicate] = { nodeid: 'other-cert' };
        const db = {
            databaseType: opts.unsupportedBackend ? 8 : 1,
            powerfile: {
                update(query, changes, settings, cb) {
                    queueMicrotask(() => {
                        if (opts.powerFailure) { cb(new Error('simulated write failure')); return; }
                        for (const row of power) if (row.nodeid === query.nodeid) row.nodeid = changes.$set.nodeid;
                        cb(null, 1);
                    });
                },
                count(query, cb) { queueMicrotask(() => cb(null, power.filter(row => row.nodeid === query.nodeid).length)); }
            },
            Get(key, cb) { queueMicrotask(() => cb(null, records.has(key) ? [records.get(key)] : [])); },
            Remove(key, cb) {
                removed.push(key);
                records.delete(key);
                if (cb) queueMicrotask(() => cb(null));
            }
        };
        const parent = {
            wsagents: agents,
            parent: {
                debug() {},
                GetConnectivityState(key) { return (opts.duplicateOnline && key === duplicate) ? { connectivity: 1 } : null; }
            }
        };
        const context = { args: { hardwareidentityrebind: true }, obj, db, parent, domain: { id: '' },
            getHardwareIdentity(info) { const v = info?.hardware?.identifiers?.product_uuid; return v ? { uuid: v } : null; } };
        vm.createContext(context);
        vm.runInContext(resolver + '\nthis.invoke = resolveHardwareIdentityAlias;', context, { timeout: 2000 });
        const timer = setTimeout(() => reject(new Error(label + ': callback timeout')), 1500);
        let called = false;
        context.invoke(() => {
            if (called) return reject(new Error(label + ': callback invoked twice'));
            called = true;
            clearTimeout(timer);
            try {
                assert(records.has(original), 'Original device must survive');
                assert.equal(records.get(original).name, 'Original device');
                assert.deepEqual(records.get(original).tags, ['preserve']);
                if (opts.originalOnline || opts.missingAlias) {
                    assert.equal(obj.dbNodeKey, duplicate);
                    assert(records.has(duplicate), 'Duplicate must remain when rebind refused');
                } else {
                    assert.equal(obj.dbNodeKey, original);
                    if (!opts.duplicateOnline && !opts.wrongUuid && !opts.missingDuplicate && !opts.powerFailure && !opts.unsupportedBackend) {
                        assert(!records.has(duplicate), 'Verified offline duplicate should be removed');
                        assert(records.has('hwi' + duplicate), 'Alias must survive');
                        assert.equal(power[0].nodeid, original, 'Power ownership must migrate');
                    } else if (!opts.missingDuplicate) {
                        assert(records.has(duplicate), 'Unverified/online duplicate must remain');
                    }
                }
                console.log('[PASS] ' + label);
                resolve();
            } catch (e) { reject(e); }
        });
    });
}
(async () => {
    await runCase('Verified offline duplicate is removed');
    await runCase('Original online prevents takeover', { originalOnline: true });
    await runCase('Online duplicate is retained', { duplicateOnline: true });
    await runCase('UUID mismatch prevents deletion', { wrongUuid: true });
    await runCase('Missing alias does not rebind', { missingAlias: true });
    await runCase('Missing duplicate still resolves alias', { missingDuplicate: true });
    await runCase('Power migration failure retains duplicate', { powerFailure: true });
    await runCase('Unsupported database retains duplicate', { unsupportedBackend: true });
    console.log('All hardware identity alias regression tests passed.');
})().catch(err => { console.error('[FAIL]', err); process.exitCode = 1; });
