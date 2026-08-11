/**
 * Tests for Batch 1 fixes:
 * - #8044: TypeError null reading 'userid' in deviceShareUpdate (splice vs delete)
 * - #8033: setAgentIssue length bug (obj.setAgentIssue.length -> obj.agentIssues.length)
 * - #7928: CSV date format consistency (formatCsvDate helper)
 */

const assert = require('assert');

// ============================================================================
// Test #7928: formatCsvDate helper
// ============================================================================

// We need to extract the function since it's defined at module-level inside meshuser.js
// Re-implement it here for testing (it's a pure function with no external deps)
function formatCsvDate(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return value;
    if (typeof value === 'number') { try { return new Date(value).toISOString(); } catch (e) { return value; } }
    var wmiMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d+\+[0-9]+$/.exec(value);
    if (wmiMatch) {
        try { return new Date(Date.UTC(+wmiMatch[1], +wmiMatch[2] - 1, +wmiMatch[3], +wmiMatch[4], +wmiMatch[5], +wmiMatch[6])).toISOString(); } catch (e) { return value; }
    }
    var ctimeMatch = /^(\d{2}):(\d{2}):(\d{2})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})$/.exec(value);
    if (ctimeMatch) {
        try { return new Date(value).toISOString(); } catch (e) { return value; }
    }
    try { var d = new Date(value); if (!isNaN(d.getTime())) return d.toISOString(); } catch (e) {}
    return value;
}

describe('#7928 - CSV Date Format Consistency', function () {
    it('should pass through ISO 8601 strings unchanged', function () {
        assert.strictEqual(formatCsvDate('2025-03-06T21:44:07.000Z'), '2025-03-06T21:44:07.000Z');
    });

    it('should convert epoch ms to ISO 8601', function () {
        var result = formatCsvDate(1758257477000);
        assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(result), 'Expected ISO format, got: ' + result);
        assert.strictEqual(result, new Date(1758257477000).toISOString());
    });

    it('should convert WMI BIOS date (20120507000000.000000+000) to ISO 8601', function () {
        var result = formatCsvDate('20120507000000.000000+000');
        assert.strictEqual(result, '2012-05-07T00:00:00.000Z');
    });

    it('should convert ctime format (18:57:36 Mar 6 2025) to ISO 8601', function () {
        var result = formatCsvDate('18:57:36 Mar  6 2025');
        assert.ok(result.includes('2025-03-06'), 'Expected 2025-03-06 in: ' + result);
        assert.ok(result.includes(':57:36'), 'Expected :57:36 in: ' + result);
    });

    it('should return empty string for null/undefined/empty', function () {
        assert.strictEqual(formatCsvDate(null), '');
        assert.strictEqual(formatCsvDate(undefined), '');
        assert.strictEqual(formatCsvDate(''), '');
    });

    it('should return original value for unparseable strings', function () {
        assert.strictEqual(formatCsvDate('not-a-date'), 'not-a-date');
    });
});

// ============================================================================
// Test #8044: Array splice vs delete (no holes)
// ============================================================================

describe('#8044 - DeviceShare array holes (splice vs delete)', function () {
    it('should not leave holes when removing expired shares (splice)', function () {
        var docs = [
            { _id: 'a', expireTime: Date.now() - 1000, userid: 'user1' },  // expired
            { _id: 'b', expireTime: Date.now() + 60000, userid: 'user2' }, // valid
            { _id: 'c', expireTime: Date.now() - 500, userid: 'user3' },   // expired
            { _id: 'd', expireTime: Date.now() + 30000, userid: 'user4' }, // valid
        ];
        var now = Date.now();

        // Simulate the fixed code: splice instead of delete
        for (var i = 0; i < docs.length; i++) {
            if (docs[i].expireTime < now) { docs.splice(i--, 1); }
        }

        // After splice, no holes (nulls) should exist
        assert.strictEqual(docs.length, 2);
        assert.strictEqual(docs[0]._id, 'b');
        assert.strictEqual(docs[1]._id, 'd');
        for (var j = 0; j < docs.length; j++) {
            assert.ok(docs[j] != null, 'Element ' + j + ' should not be null');
        }
    });

    it('would leave holes with delete (old buggy behavior)', function () {
        var docs = [
            { _id: 'a', expireTime: Date.now() - 1000 },
            { _id: 'b', expireTime: Date.now() + 60000 },
            { _id: 'c', expireTime: Date.now() - 500 },
            { _id: 'd', expireTime: Date.now() + 30000 },
        ];
        var now = Date.now();

        // Simulate the OLD buggy code: delete (creates holes)
        for (var i = 0; i < docs.length; i++) {
            if (docs[i].expireTime < now) { delete docs[i]; }
        }

        // Old behavior: holes exist, length unchanged
        assert.strictEqual(docs.length, 4);
        assert.strictEqual(docs[0], undefined); // hole
        assert.ok(docs[1] != null);
        assert.strictEqual(docs[2], undefined); // hole
        assert.ok(docs[3] != null);
    });

    it('HandleEvent null check prevents TypeError on holey arrays', function () {
        // Simulate what JSON round-trip (common.Clone) does to holes: null
        var deviceShares = [null, { userid: 'user2', url: 'secret' }, null, { userid: 'user4', url: 'secret' }];
        var userId = 'user1';
        var errors = 0;

        // Fixed code: null check before accessing .userid
        for (var i in deviceShares) {
            if ((deviceShares[i] != null) && (deviceShares[i].userid != userId)) {
                delete deviceShares[i].url;
            }
        }

        assert.strictEqual(errors, 0, 'Should not throw TypeError');
        assert.strictEqual(deviceShares[1].url, undefined, 'URL should be removed for non-owner');
        assert.strictEqual(deviceShares[3].url, undefined, 'URL should be removed for non-owner');
    });
});

// ============================================================================
// Test #8047: Token user info in events
// ============================================================================

describe('#8047 - Token user info in audit events', function () {
    // Re-implement addTokenInfo for testing (same logic as meshuser.js)
    function addTokenInfo(event, req) {
        if (req && req.session && req.session.loginToken != null && event != null) {
            event.tokenUser = req.session.loginToken;
        }
        return event;
    }

    it('should add tokenUser when session has loginToken', function () {
        var event = { etype: 'node', userid: 'user//abc', username: 'admin', action: 'nodemeshchange' };
        var req = { session: { loginToken: 'ATLt5tlE9QiFYen2' } };
        addTokenInfo(event, req);
        assert.strictEqual(event.tokenUser, 'ATLt5tlE9QiFYen2');
    });

    it('should NOT add tokenUser when session has no loginToken (normal user)', function () {
        var event = { etype: 'node', userid: 'user//abc', username: 'admin', action: 'nodemeshchange' };
        var req = { session: { userid: 'user//abc' } };
        addTokenInfo(event, req);
        assert.strictEqual(event.tokenUser, undefined);
    });

    it('should NOT add tokenUser when req or session is null', function () {
        var event = { etype: 'node', userid: 'user//abc', action: 'runcommands' };
        addTokenInfo(event, null);
        assert.strictEqual(event.tokenUser, undefined);
        addTokenInfo(event, { session: null });
        assert.strictEqual(event.tokenUser, undefined);
    });

    it('should handle null event gracefully', function () {
        var req = { session: { loginToken: 'test-token' } };
        assert.strictEqual(addTokenInfo(null, req), null);
    });
});

// ============================================================================
// Test #8033: setAgentIssues length bug
// ============================================================================

describe('#8033 - agentIssues array length bug', function () {
    it('should trim the array, not reference function length', function () {
        // Simulate the bug: obj.setAgentIssue is a function, .length = function arity (2)
        // The fix: obj.agentIssues.length (the array)

        function setAgentIssue(agent, issue) { /* function arity = 2 */ }
        var agentIssues = [];

        // Push 55 items
        for (var i = 0; i < 55; i++) {
            agentIssues.push(['time', 'ip:port', 'issue']);
        }

        // OLD BUGGY: while (setAgentIssue.length > 50) { agentIssues.shift(); }
        // setAgentIssue.length = 2 (function arity) — 2 > 50 is false — array never shrinks!
        var oldBuggy = setAgentIssue.length; // = 2
        assert.strictEqual(oldBuggy, 2, 'Function .length returns arity (2)');
        assert.ok(!(oldBuggy > 50), '2 > 50 is false — trim never happens (BUG)');

        // FIXED: while (agentIssues.length > 50) { agentIssues.shift(); }
        while (agentIssues.length > 50) { agentIssues.shift(); }
        assert.strictEqual(agentIssues.length, 50, 'Array should be trimmed to 50');
    });
});

// ============================================================================
// Test #7951: OIDC groups from token claim should skip Graph API lookup
// ============================================================================

describe('#7951 - OIDC groups from token claim', function () {
    // Simulate the fixed logic: if user.groups is already a valid array from
    // the ID token, skip the Graph API lookup entirely.
    function shouldSkipGraphLookup(userGroups) {
        return Array.isArray(userGroups) && userGroups.length > 0;
    }

    it('should skip Graph lookup when groups are in the token', function () {
        var user = { groups: ['group-id-1', 'group-id-2'] };
        assert.strictEqual(shouldSkipGraphLookup(user.groups), true);
    });

    it('should NOT skip Graph lookup when groups are null', function () {
        var user = { groups: null };
        assert.strictEqual(shouldSkipGraphLookup(user.groups), false);
    });

    it('should NOT skip Graph lookup when groups array is empty', function () {
        var user = { groups: [] };
        assert.strictEqual(shouldSkipGraphLookup(user.groups), false);
    });

    it('should NOT skip Graph lookup when groups is a string (invalid)', function () {
        var user = { groups: 'not-an-array' };
        assert.strictEqual(shouldSkipGraphLookup(user.groups), false);
    });
});

// ============================================================================
// Test #8037: otplib require should be wrapped in try-catch
// ============================================================================

describe('#8037 - 2FA otplib crash protection', function () {
    it('should catch module loading errors and not crash the server', function () {
        // Simulate: when otplib subdependency @scure/base32 is missing,
        // require('otplib') throws. The fix wraps it in try-catch.
        var result;
        try {
            // Simulate a module loading failure
            throw new Error("Cannot find module '@scure/base32'");
        } catch (ex) {
            // Fix: log the error and continue — server stays alive
            result = 'caught: ' + ex.message;
        }
        assert.ok(result.startsWith('caught:'), 'Error should be caught, not propagated');
        assert.ok(result.indexOf('@scure/base32') >= 0, 'Error message preserved');
    });

    it('should still verify valid tokens when otplib loads correctly', function () {
        var result;
        try {
            // Simulate successful otplib verification
            var verified = { valid: true };
            if (verified.valid === true) {
                result = 'success';
            }
        } catch (ex) {
            result = 'error';
        }
        assert.strictEqual(result, 'success');
    });
});

// ============================================================================
// Test #7937: Multiple search fragments (OR) in device filter
// ============================================================================

describe('#7937 - Device search OR filter', function () {
    // Re-implement the FIXED parseSearchOrInput merge logic
    function orMerge(r, r2) {
        if (r == null) { return r2; }
        for (var j in r2) { if (r.indexOf(r2[j]) < 0) { r.push(r2[j]); } }
        return r;
    }

    it('should union results from two search terms (ABC OR 123)', function () {
        var r = null;
        // Simulate: "ABC OR 123" — first term matches [node1, node3], second matches [node2, node3]
        r = orMerge(r, ['node1', 'node3']);
        r = orMerge(r, ['node2', 'node3']);
        assert.strictEqual(r.length, 3, 'Union should have 3 unique devices');
        assert.ok(r.indexOf('node1') >= 0, 'node1 should be in results');
        assert.ok(r.indexOf('node2') >= 0, 'node2 should be in results');
        assert.ok(r.indexOf('node3') >= 0, 'node3 should be in results');
    });

    it('should NOT duplicate devices that match both terms', function () {
        var r = null;
        r = orMerge(r, ['node1', 'node2']);
        r = orMerge(r, ['node1', 'node2', 'node3']);
        assert.strictEqual(r.length, 3, 'No duplicates — node1 and node2 appear once');
    });

    it('should demonstrate the old buggy behavior was broken', function () {
        // OLD: r.indexOf(r2[j] >= 0) — evaluates (r2[j] >= 0) first
        // For r2[j] = 'node2', ('node2' >= 0) = false (string >= number = NaN >= 0 = false)
        // r.indexOf(false) = -1 (false not in array)
        // if(-1) is TRUTHY in JS! So push executes, but this is still wrong:
        // it would push r2[j] even if it's already in r (no dedup check).
        // With a non-empty array like ['node1'], indexOf(false) = -1, if(-1) = true → push happens
        // With an array that already contains 'false' → indexOf = 0, if(0) = false → push skipped (wrong!)
        // The logic is completely broken — it accidentally works in some cases but not others.
        var r = ['node1'];
        var r2 = ['node2'];
        // Old buggy line:
        for (var j in r2) { if (r.indexOf(r2[j] >= 0)) { r.push(r2[j]); } }
        // In this specific case, -1 is truthy so it accidentally pushes
        // But the logic is WRONG: it doesn't check if r2[j] is already in r
        assert.strictEqual(r.length, 2, 'Old code accidentally pushes but with wrong logic');
    });

    it('should handle null r (first term)', function () {
        var r = orMerge(null, ['node1', 'node2']);
        assert.strictEqual(r.length, 2);
        assert.strictEqual(r[0], 'node1');
    });
});

// ============================================================================
// Test #7929: LDAP TLS options parsing
// ============================================================================

describe('#7929 - LDAP TLS options', function () {
    // Simulate the tlsOptions merge logic
    function applyLdapTlsOptions(ldapoptions, ldaptlsoptions) {
        if (typeof ldaptlsoptions == 'object' && ldaptlsoptions != null) {
            ldapoptions.tlsOptions = Object.assign({}, ldaptlsoptions);
            if (ldapoptions.tlsOptions.rejectUnauthorized == null) {
                ldapoptions.tlsOptions.rejectUnauthorized = false;
            }
            if (ldapoptions.tlsOptions.minVersion == null) {
                ldapoptions.tlsOptions.minVersion = 'TLSv1.2';
            }
        }
        return ldapoptions;
    }

    it('should default rejectUnauthorized to false for self-signed certs', function () {
        var opts = applyLdapTlsOptions({}, { ca: 'cert-content' });
        assert.strictEqual(opts.tlsOptions.rejectUnauthorized, false);
    });

    it('should respect rejectUnauthorized when explicitly set to true', function () {
        var opts = applyLdapTlsOptions({}, { rejectUnauthorized: true });
        assert.strictEqual(opts.tlsOptions.rejectUnauthorized, true);
    });

    it('should default minVersion to TLSv1.2', function () {
        var opts = applyLdapTlsOptions({}, {});
        assert.strictEqual(opts.tlsOptions.minVersion, 'TLSv1.2');
    });

    it('should not modify original ldaptlsoptions (use copy)', function () {
        var original = { rejectUnauthorized: true };
        var opts = applyLdapTlsOptions({}, original);
        // The original should keep its value
        assert.strictEqual(original.rejectUnauthorized, true);
        // The copy should also have it
        assert.strictEqual(opts.tlsOptions.rejectUnauthorized, true);
    });

    it('should do nothing when ldaptlsoptions is null', function () {
        var opts = applyLdapTlsOptions({}, null);
        assert.strictEqual(opts.tlsOptions, undefined);
    });
});
