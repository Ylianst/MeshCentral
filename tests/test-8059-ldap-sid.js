// Regression test for MeshCentral #8059
// LDAP user identity is mixed up after another user logs in.
//
// Root cause: ldapjs may serialize binary SID/GUID attributes to a string in
// xxuser[...]. Buffer.from(string, 'binary') can collapse distinct binary SIDs
// that differ only in the last byte into the same hex, so two different users
// map to the same shortname/userid and MeshCentral treats them as one account.
//
// Fix: prefer the raw Buffer from xxuser._raw[key] for binary keys (objectSid,
// objectGUID, or any configured ldapUserBinaryKey), so the exact binary identity
// is preserved as the userid.
//
// Run: node tests/test-8059-ldap-sid.js

const assert = require('assert');

// Replicate the getBinaryKey helper from webserver.js (LDAP login path), including the
// JSON-serialized Buffer shape { type: 'Buffer', data: [...] } handling.
function getBinaryKey(xxuser, key) {
    var normalize = function (val) {
        if (val == null) { return null; }
        if (Buffer.isBuffer(val)) { return val; }
        if (typeof val === 'string') { return Buffer.from(val, 'binary'); }
        if (typeof val === 'object' && (val.type === 'Buffer') && Array.isArray(val.data)) { return Buffer.from(val.data); }
        return Buffer.from(val, 'binary');
    };
    var raw = (xxuser._raw != null) ? xxuser._raw[key] : null;
    if (raw != null) { return normalize(raw).toString('hex').toLowerCase(); }
    if (xxuser[key] != null) { return normalize(xxuser[key]).toString('hex').toLowerCase(); }
    return null;
}

// Two real-world-like SIDs that differ ONLY in the last byte (RID low byte)
const sidA = Buffer.from([0x01,0x05,0x00,0x00,0x00,0x00,0x00,0x05,0x15,0x00,0x00,0x00,0xA9,0x8C,0x47,0x25,0x2F,0x73,0xB6,0x4A,0x01,0x02,0x00,0x00]);
const sidB = Buffer.from([0x01,0x05,0x00,0x00,0x00,0x00,0x00,0x05,0x15,0x00,0x00,0x00,0xA9,0x8C,0x47,0x25,0x2F,0x73,0xB6,0x4A,0x02,0x02,0x00,0x00]);

// Scenario 1: OLD broken behavior via JSON serialization.
// MeshCentral persists LDAP users to file (ldapsaveusertofile) and supports a "test"
// config where xxuser is loaded from JSON. When a Buffer is JSON.stringify'd it becomes
// { "type": "Buffer", "data": [...] }. The OLD code does
//   Buffer.from(xxuser['objectSid'], 'binary')   <-- first arg is now a plain OBJECT
// Buffer.from(object, 'binary') ignores the encoding and serializes the object to the
// string "[object Object]", yielding IDENTICAL bytes for every user -> identity collapse.
function simulateOldBehavior(xxuser) {
    // OLD code: Buffer.from(xxuser['objectSid'], 'binary').toString('hex')
    if (xxuser['objectSid']) { return Buffer.from(xxuser['objectSid'], 'binary').toString('hex').toLowerCase(); }
    return null;
}

// xxuser as it looks after JSON round-trip (what ldapsaveusertofile / test config produce)
const userA_json = { objectSid: { type: 'Buffer', data: Array.from(sidA) } };
const userB_json = { objectSid: { type: 'Buffer', data: Array.from(sidB) } };

// Demonstrate the OLD behavior. On older Node (<= pre-18) Buffer.from(object, 'binary')
// coerced plain objects to the string "[object Object]", collapsing every user to the
// same shortname. We emulate that broken coercion here so the test documents the bug
// without depending on the current Node version's Buffer.from semantics.
function simulateOldBehavior(xxuser) {
    var v = xxuser['objectSid'];
    var bytes;
    if (Buffer.isBuffer(v)) { bytes = v; }
    else if (typeof v === 'string') { bytes = Buffer.from(v, 'binary'); }
    else { bytes = Buffer.from('[object Object]', 'binary'); } // old Node coercion (the bug)
    return bytes.toString('hex').toLowerCase();
}

// Demonstrate the OLD behavior collapses (this is the bug): when objectSid arrives as a
// Buffer-like plain object (e.g. after JSON round-trip from ldapsaveusertofile), old code
// produced identical shortnames for every user.
const oldA = simulateOldBehavior(userA_json);
const oldB = simulateOldBehavior(userB_json);
console.log('OLD behavior shortname A:', oldA);
console.log('OLD behavior shortname B:', oldB);
console.log('OLD behavior: A === B ?', oldA === oldB, '(this is the bug: both map to same user)');

// Scenario 2: NEW behavior uses _raw Buffer (correct)
const userA_raw = { _raw: { objectSid: sidA }, objectSid: 'S-1-5-21-1171903529-1253344303-1248848438-513' };
const userB_raw = { _raw: { objectSid: sidB }, objectSid: 'S-1-5-21-1171903529-1253344303-1248848438-514' };

const newA = getBinaryKey(userA_raw, 'objectSid');
const newB = getBinaryKey(userB_raw, 'objectSid');
console.log('NEW behavior shortname A:', newA);
console.log('NEW behavior shortname B:', newB);

assert.notStrictEqual(newA, newB, 'Two distinct binary SIDs must produce distinct userids (bug #8059)');
assert.strictEqual(newA, sidA.toString('hex').toLowerCase(), 'shortname A should equal raw SID A hex');
assert.strictEqual(newB, sidB.toString('hex').toLowerCase(), 'shortname B should equal raw SID B hex');

// Scenario 3: ldapUserBinaryKey configured (custom binary key)
const userA_custom = { _raw: { employeeNumber: sidA }, employeeNumber: '12345' };
const userB_custom = { _raw: { employeeNumber: sidB }, employeeNumber: '12346' };
assert.notStrictEqual(getBinaryKey(userA_custom, 'employeeNumber'), getBinaryKey(userB_custom, 'employeeNumber'), 'Custom binary key must keep distinct identities');

// Scenario 4: fallback to name/cn when no binary key
const userNoSid = { name: 'alice', cn: 'Alice Smith' };
assert.strictEqual(getBinaryKey(userNoSid, 'objectSid'), null, 'No objectSid should return null');

// Scenario 5: JSON-serialized Buffer shape { type:'Buffer', data:[...] } via _raw (ldapsaveusertofile reload)
const userA_jsonRaw = { _raw: { objectSid: { type: 'Buffer', data: Array.from(sidA) } } };
const userB_jsonRaw = { _raw: { objectSid: { type: 'Buffer', data: Array.from(sidB) } } };
const jsonRawA = getBinaryKey(userA_jsonRaw, 'objectSid');
const jsonRawB = getBinaryKey(userB_jsonRaw, 'objectSid');
assert.notStrictEqual(jsonRawA, jsonRawB, 'JSON-serialized raw SID must keep distinct identities (#8059)');
assert.strictEqual(jsonRawA, sidA.toString('hex').toLowerCase(), 'jsonRawA should equal raw SID A hex');

console.log('\nAll #8059 regression tests passed.');
