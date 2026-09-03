/**
 * Tenant isolation tests for the OpenFrame fork.
 *
 * Every tenant server shares ONE MongoDB database and is separated only by the `domain` field, so
 * upstream's "one server owns the whole database" queries reach across tenants here. These tests
 * pin the behaviours that were changed for that: each one seeds two tenant domains into a single
 * database, drives db.js as tenant A, and asserts that tenant B is untouched.
 *
 * They run against a real MongoDB replica set rather than a mock: what is being tested is the shape
 * of the queries themselves, so a mock would only assert that the code calls the mock.
 *
 * Run with test/run-tests.sh (starts the datastore and executes this inside the meshcentral image).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MESH_DIR = process.env.MC_SRC || path.join(__dirname, '..');
const MONGO_URL = process.env.MC_TEST_MONGO_URL || 'mongodb://localhost:27017/meshcentral_test?replicaSet=rs0';

const A = 'aaaa1111-1111-1111-1111-111111111111';
const B = 'bbbb2222-2222-2222-2222-222222222222';

// --- Helpers ---------------------------------------------------------------

function config(domain) {
    // Mirrors the deployed shape: the default domain, the tenant's own, and the static share domain
    // that deriveTenantDomain() must skip.
    const domains = { '': { title: 'MeshCentral' }, openframe_public: { share: '/opt/mesh/public' } };
    domains[domain] = { title: domain };
    return { settings: { mongodb: MONGO_URL, mongodbname: dbName(), mongodbcol: 'meshcentral' }, domains: domains };
}

function dbName() {
    const m = /\/([^/?]+)(\?|$)/.exec(MONGO_URL);
    return m ? m[1] : 'meshcentral_test';
}

/** A minimal MeshCentral "parent", the same shim plugins/migrate.js uses to drive db.js standalone. */
function parentShim(domain) {
    const cfg = config(domain);
    return {
        datapath: '/tmp/meshcentral-test-data',
        args: { mongodb: cfg.settings.mongodb, mongodbname: cfg.settings.mongodbname, mongodbcol: cfg.settings.mongodbcol },
        config: cfg,
        crypto: require('crypto'), fs: require('fs'), path: require('path'),
        common: require(path.join(MESH_DIR, 'common.js')),
        debug: function () { }, DispatchEvent: function () { },
        GetConnectivityState: function () { return null; },
        webserver: { meshes: {}, users: {}, CreateNodeDispatchTargets: function () { return []; } },
        userGroups: {}
    };
}

/** Open db.js as a tenant server for `domain`. `env` is applied before setup, since the write guard
 *  binds itself at setup time. */
function openDb(domain, env) {
    const previous = {};
    const applied = Object.assign({ OPENFRAME_MODE: 'true' }, env || {});
    for (const k in applied) { previous[k] = process.env[k]; process.env[k] = applied[k]; }

    const parent = parentShim(domain);
    return new Promise((resolve) => {
        const db = require(path.join(MESH_DIR, 'db.js')).CreateDB(parent, function () {
            db.SetupDatabase(function () {
                for (const k in previous) { if (previous[k] === undefined) { delete process.env[k]; } else { process.env[k] = previous[k]; } }
                resolve({ db, parent });
            });
        });
    });
}

function seedDocs() {
    const old = Date.now() - (400 * 86400000); // far past any expireDevs setting
    const perDomain = (d) => ([
        { _id: 'user/' + d + '/admin', type: 'user', name: 'admin', domain: d, siteadmin: 0xFFFFFFFF, links: {} },
        { _id: 'mesh/' + d + '/GRP', type: 'mesh', name: 'OpenFrame', domain: d, mtype: 2, expireDevs: 30, links: {} },
        { _id: 'node/' + d + '/DEV', type: 'node', name: 'device', domain: d, meshid: 'mesh/' + d + '/GRP' },
        { _id: 'ifnode/' + d + '/DEV', domain: d, netif: {} },
        { _id: 'lcnode/' + d + '/DEV', type: 'lastconnect', domain: d, meshid: 'mesh/' + d + '/GRP', time: old },
        { _id: 'ugrp/' + d + '/G1', type: 'ugrp', name: 'group', domain: d, links: {} },
        // An orphan: its device group does not exist. Upstream cleanup() deleted these DB-wide.
        { _id: 'node/' + d + '/ORPHAN', type: 'node', name: 'orphan', domain: d, meshid: 'mesh/' + d + '/GONE' }
    ]);
    return perDomain(A).concat(perDomain(B));
}

async function freshDatabase() {
    const { MongoClient } = require('mongodb');
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(dbName());
    for (const c of ['meshcentral', 'serverstats', 'events', 'power', 'smbios']) {
        await db.collection(c).deleteMany({});
    }
    await db.collection('meshcentral').insertMany(seedDocs());
    return { client, db };
}

function ids(docs) { return docs.map((d) => d._id).sort(); }

// --- Tests -----------------------------------------------------------------

test('cleanup() does not delete documents whose device group is missing', async () => {
    // Upstream ended cleanup() with deleteMany({meshid: {$nin: meshlist}}) over the whole database.
    // On a shared database that deletes other tenants' devices, and an empty meshlist (a transient
    // read error) matches everything. The statement is gone; nothing may be deleted here.
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        // Counted per domain rather than globally: SetupDatabase fires off its own
        // DatabaseIdentifier / SchemaVersion writes without waiting, which would race a total.
        const countA = () => raw.collection('meshcentral').countDocuments({ domain: A });
        const countB = () => raw.collection('meshcentral').countDocuments({ domain: B });
        const beforeA = await countA(), beforeB = await countB();
        await new Promise((res) => db.cleanup(res));
        assert.strictEqual(await countA(), beforeA);
        assert.strictEqual(await countB(), beforeB);
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + B + '/ORPHAN' }), 1);
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + A + '/ORPHAN' }), 1);
    } finally { await client.close(); }
});

test('removeInactiveDevices only removes devices of this tenant', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db, parent } = await openDb(A);
    try {
        // The boot cache still holds both tenants here on purpose: that is the state the function
        // used to read foreign domains from.
        const meshes = await new Promise((res) => db.GetAllType('mesh', (err, docs) => res(docs)));
        for (const m of meshes) { parent.webserver.meshes[m._id] = m; }

        await new Promise((res) => { db.removeInactiveDevices(false, function () { }); setTimeout(res, 2000); });

        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + A + '/DEV' }), 0, "own tenant's inactive device should be removed");
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'node/' + B + '/DEV' }), 1, "other tenant's device must be untouched");
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'lcnode/' + B + '/DEV' }), 1);
    } finally { await client.close(); }
});

test('writes into another tenant are blocked, own-domain writes pass', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A);
    try {
        const foreign = await new Promise((res) => db.Set({ _id: 'user/' + B + '/admin', type: 'user', domain: B, name: 'overwritten' }, (err) => res(err)));
        assert.ok(foreign instanceof Error, 'a cross-tenant Set must fail its callback rather than hang');
        assert.strictEqual((await raw.collection('meshcentral').findOne({ _id: 'user/' + B + '/admin' })).name, 'admin');

        const own = await new Promise((res) => db.Set({ _id: 'user/' + A + '/second', type: 'user', domain: A, name: 'second' }, (err) => res(err)));
        assert.ok(!own, 'own-domain writes must not be affected');
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'user/' + A + '/second' }), 1);

        // Remove resolves the domain from the id, which carries it even for prefixed keys.
        await new Promise((res) => db.Remove('lcnode/' + B + '/DEV', res));
        assert.strictEqual(await raw.collection('meshcentral').countDocuments({ _id: 'lcnode/' + B + '/DEV' }), 1);
    } finally { await client.close(); }
});

test('the write guard can be turned off for rollback', async () => {
    const { client, db: raw } = await freshDatabase();
    const { db } = await openDb(A, { OPENFRAME_CROSS_TENANT_WRITES: 'allow' });
    try {
        await new Promise((res) => db.Set({ _id: 'user/' + B + '/admin', type: 'user', domain: B, name: 'overwritten' }, res));
        assert.strictEqual((await raw.collection('meshcentral').findOne({ _id: 'user/' + B + '/admin' })).name, 'overwritten');
    } finally { await client.close(); }
});

test('deriveTenantDomain picks the tenant, ignoring the default and share domains', () => {
    const { deriveTenantDomain } = require(path.join(MESH_DIR, 'db.js'));
    assert.strictEqual(deriveTenantDomain(config(A).domains), A);
    // A legacy single-tenant install has only the default domain and must stay unscoped.
    assert.strictEqual(deriveTenantDomain({ '': { title: 'MeshCentral' } }), '');
    assert.strictEqual(deriveTenantDomain(null), '');
});
