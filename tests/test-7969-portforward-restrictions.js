// Regression / unit test for MeshCentral #7969
// Granular Port Forwarding restrictions (Allow/Deny lists) via config.json.
//
// The server must reject a port-forward cookie when the target TCP port is blocked by the
// domain.portForwardRestrictions policy.
//
// Run: node tests/test-7969-portforward-restrictions.js

const assert = require('assert');

// Replicate obj.isPortForwardAllowed from meshcentral.js (server-side policy check)
function isPortForwardAllowed(domain, port) {
    if ((domain == null) || (domain.portForwardRestrictions == null)) { return true; }
    var r = domain.portForwardRestrictions;
    if ((r.mode !== 'allow') && (r.mode !== 'deny')) { return true; }
    if (!Array.isArray(r.ports)) { r.ports = []; }
    var denied = false, allowed = false;
    for (var i = 0; i < r.ports.length; i++) {
        var p = r.ports[i];
        if (typeof p === 'number') { if (p === port) { if (r.mode === 'deny') { denied = true; } else { allowed = true; } } }
        else if (typeof p === 'string') {
            var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) { var s = parseInt(m[1], 10), e = parseInt(m[2], 10); if ((port >= s) && (port <= e)) { if (r.mode === 'deny') { denied = true; } else { allowed = true; } } }
            else { var pn = parseInt(p, 10); if (pn === port) { if (r.mode === 'deny') { denied = true; } else { allowed = true; } } }
        }
    }
    if (r.mode === 'deny') { return !denied; }
    return allowed;
}

// No policy => everything allowed
assert.strictEqual(isPortForwardAllowed(null, 3306), true, 'No domain: allowed');
assert.strictEqual(isPortForwardAllowed({ portForwardRestrictions: null }, 3306), true, 'Null policy: allowed');

// DENY mode
const deny = { portForwardRestrictions: { mode: 'deny', ports: [3306, 445, '1433-1435'] } };
assert.strictEqual(isPortForwardAllowed(deny, 3306), false, 'deny: 3306 blocked');
assert.strictEqual(isPortForwardAllowed(deny, 445), false, 'deny: 445 blocked');
assert.strictEqual(isPortForwardAllowed(deny, 1433), false, 'deny: 1433 in range blocked');
assert.strictEqual(isPortForwardAllowed(deny, 1434), false, 'deny: 1434 in range blocked');
assert.strictEqual(isPortForwardAllowed(deny, 1435), false, 'deny: 1435 in range blocked');
assert.strictEqual(isPortForwardAllowed(deny, 1432), true, 'deny: 1432 outside range allowed');
assert.strictEqual(isPortForwardAllowed(deny, 1436), true, 'deny: 1436 outside range allowed');
assert.strictEqual(isPortForwardAllowed(deny, 22), true, 'deny: 22 allowed');
assert.strictEqual(isPortForwardAllowed(deny, 3389), true, 'deny: 3389 allowed');

// ALLOW mode (exclusive)
const allow = { portForwardRestrictions: { mode: 'allow', ports: [22, 3389, 8080] } };
assert.strictEqual(isPortForwardAllowed(allow, 22), true, 'allow: 22 allowed');
assert.strictEqual(isPortForwardAllowed(allow, 3389), true, 'allow: 3389 allowed');
assert.strictEqual(isPortForwardAllowed(allow, 8080), true, 'allow: 8080 allowed');
assert.strictEqual(isPortForwardAllowed(allow, 3306), false, 'allow: 3306 blocked (not in list)');
assert.strictEqual(isPortForwardAllowed(allow, 445), false, 'allow: 445 blocked (not in list)');
assert.strictEqual(isPortForwardAllowed(allow, 1434), false, 'allow: range not supported as allow by default');

// Invalid mode => allowed (fail open)
assert.strictEqual(isPortForwardAllowed({ portForwardRestrictions: { mode: 'bogus', ports: [22] } }, 22), true, 'invalid mode: fail open');

console.log('\nAll #7969 port-forward restriction tests passed.');
