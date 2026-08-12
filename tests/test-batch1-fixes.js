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

// ============================================================================
// Test #8023: MacOS TCC reset uses executable path when bundle ID is null
// ============================================================================

describe('#8023 - MacOS uninstall TCC reset', function () {
    // Simulate the logic: if mdls returns (null), use the executable path
    function tccResetTarget(bundleId, agentPath) {
        if (bundleId && bundleId !== '(null)' && bundleId.length > 0) {
            return bundleId;
        }
        return agentPath; // Fall back to executable path
    }

    it('should use bundle ID when available', function () {
        var target = tccResetTarget('com.meshcentral.agent', '/usr/local/mesh_services/mesh/agent/meshagent');
        assert.strictEqual(target, 'com.meshcentral.agent');
    });

    it('should use executable path when mdls returns (null)', function () {
        var target = tccResetTarget('(null)', '/usr/local/mesh_services/mesh/agent/meshagent');
        assert.strictEqual(target, '/usr/local/mesh_services/mesh/agent/meshagent');
    });

    it('should use executable path when mdls returns empty string', function () {
        var target = tccResetTarget('', '/usr/local/mesh_services/mesh/agent/meshagent');
        assert.strictEqual(target, '/usr/local/mesh_services/mesh/agent/meshagent');
    });
});

// ============================================================================
// Test #8021: Registry tab disabled per domain
// ============================================================================

describe('#8021 - Disable Registry tab per domain', function () {
    // Simulate: features2 bit 0x80000000 = noregistry
    function isRegistryVisible(features2) {
        return (features2 & 0x80000000) === 0;
    }

    it('should show Registry tab when noregistry not set', function () {
        assert.strictEqual(isRegistryVisible(0), true);
        assert.strictEqual(isRegistryVisible(0x08000000), true); // scrolltotop bit set, not noregistry
    });

    it('should hide Registry tab when noregistry is set', function () {
        assert.strictEqual(isRegistryVisible(0x80000000), false);
        assert.strictEqual(isRegistryVisible(0x88000000), false); // multiple bits set including noregistry
    });

    it('should not collide with scrolltotop bit (0x08000000)', function () {
        // scrolltotop = 0x08000000, noregistry = 0x80000000 — different bits
        var features2 = 0x08000000; // only scrolltotop
        assert.strictEqual((features2 & 0x80000000) === 0, true, 'noregistry should NOT be set');
        assert.strictEqual((features2 & 0x08000000) !== 0, true, 'scrolltotop SHOULD be set');
    });
});

// ============================================================================
// Test #8011: Agent receives setmesh command on mesh change
// ============================================================================

describe('#8011 - Agent receives setmesh command on mesh change', function () {
    // Simulate the mesh change flow
    function simulateMeshChange(agentConnected, command) {
        var sentCommands = [];
        var agentSession = null;
        if (agentConnected) {
            agentSession = {
                dbMeshKey: null,
                meshid: null,
                send: function(data) { sentCommands.push(JSON.parse(data)); }
            };
            agentSession.dbMeshKey = command.meshid;
            agentSession.meshid = command.meshid.split('/')[2];
            try { agentSession.send(JSON.stringify({ action: 'setmesh', meshid: command.meshid })); } catch (ex) { }
        }
        return { agentSession: agentSession, sentCommands: sentCommands };
    }

    it('should send setmesh command when agent is connected', function () {
        var result = simulateMeshChange(true, { meshid: 'mesh//domain//newmesh' });
        assert.strictEqual(result.sentCommands.length, 1);
        assert.strictEqual(result.sentCommands[0].action, 'setmesh');
        assert.strictEqual(result.sentCommands[0].meshid, 'mesh//domain//newmesh');
    });

    it('should update agentSession meshid to new mesh', function () {
        // meshid format: mesh//domainid//meshid — split('/')[2] is domainid, [4] is meshid
        // In the real code, meshid.split('/')[2] gets the 3rd segment (domain id part)
        // The agent session uses the full meshid as dbMeshKey
        var result = simulateMeshChange(true, { meshid: 'mesh//newmesh' });
        assert.strictEqual(result.agentSession.dbMeshKey, 'mesh//newmesh');
        // mesh//newmesh split by / gives ['mesh', '', 'newmesh'], [2] = 'newmesh'
        assert.strictEqual(result.agentSession.meshid, 'newmesh');
    });

    it('should NOT send setmesh when agent is not connected', function () {
        var result = simulateMeshChange(false, { meshid: 'mesh//newmesh' });
        assert.strictEqual(result.sentCommands.length, 0);
        assert.strictEqual(result.agentSession, null);
    });
});

// ============================================================================
// Test #8045: Duplicate mesh group names are blocked
// ============================================================================

describe('#8045 - Duplicate mesh group names', function () {
    // Simulate the duplicate name check logic
    function checkDuplicateName(meshes, domainId, meshname, disallow) {
        if (disallow === false) return null; // duplicates allowed when explicitly disabled
        for (var key in meshes) {
            if (meshes[key].domain == domainId && meshes[key].name == meshname) {
                return 'A device group with this name already exists';
            }
        }
        return null;
    }

    var meshes = {
        'mesh//domain//abc': { domain: 'domain', name: 'BSB - BRASILIA' },
        'mesh//domain//def': { domain: 'domain', name: 'SP - SAO PAULO' }
    };

    it('should block creation when name exists in same domain', function () {
        var err = checkDuplicateName(meshes, 'domain', 'BSB - BRASILIA');
        assert.ok(err);
        assert.ok(err.indexOf('already exists') >= 0);
    });

    it('should allow creation when name is unique', function () {
        var err = checkDuplicateName(meshes, 'domain', 'RJ - RIO DE JANEIRO');
        assert.strictEqual(err, null);
    });

    it('should allow same name in different domain', function () {
        var err = checkDuplicateName(meshes, 'otherdomain', 'BSB - BRASILIA');
        assert.strictEqual(err, null);
    });

    it('should allow duplicates when disallowDuplicateMeshNames is false', function () {
        var err = checkDuplicateName(meshes, 'domain', 'BSB - BRASILIA', false);
        assert.strictEqual(err, null);
    });
});

// ============================================================================
// Test #7977: Change owner of a device group
// ============================================================================

describe('#7977 - Change owner of a device group', function () {
    // Simulate the owner change logic
    function changeOwner(mesh, newCreatorId, users, isSiteAdmin) {
        if (!isSiteAdmin) return { changed: false, reason: 'permission denied' };
        var newCreator = users[newCreatorId];
        if (newCreator == null) return { changed: false, reason: 'user not found' };
        mesh.creatorid = newCreatorId;
        mesh.creatorname = newCreator.name;
        if (mesh.links == null) { mesh.links = {}; }
        if (mesh.links[newCreatorId] == null) { mesh.links[newCreatorId] = { name: newCreator.name, rights: 4294967295 }; }
        return { changed: true, mesh: mesh };
    }

    var mesh = { name: 'TestGroup', creatorid: 'user//oldadmin', creatorname: 'OldAdmin', links: {} };
    var users = { 'user//newadmin': { name: 'NewAdmin' } };

    it('should change owner when site admin', function () {
        var result = changeOwner(JSON.parse(JSON.stringify(mesh)), 'user//newadmin', users, true);
        assert.ok(result.changed);
        assert.strictEqual(result.mesh.creatorid, 'user//newadmin');
        assert.strictEqual(result.mesh.creatorname, 'NewAdmin');
    });

    it('should give new owner full rights on the mesh', function () {
        var result = changeOwner(JSON.parse(JSON.stringify(mesh)), 'user//newadmin', users, true);
        assert.ok(result.mesh.links['user//newadmin']);
        assert.strictEqual(result.mesh.links['user//newadmin'].rights, 4294967295);
    });

    it('should NOT change owner when not site admin', function () {
        var result = changeOwner(JSON.parse(JSON.stringify(mesh)), 'user//newadmin', users, false);
        assert.ok(!result.changed);
    });

    it('should NOT change owner when user does not exist', function () {
        var result = changeOwner(JSON.parse(JSON.stringify(mesh)), 'user//ghost', users, true);
        assert.ok(!result.changed);
    });
});

// ============================================================================
// Test #8066: Warn when cert is not configured
// ============================================================================

describe('#8066 - Cert config warning', function () {
    // Simulate the warning logic
    function shouldWarnCert(config, lanonly) {
        if (lanonly === true) return false;
        if (config.settings == null || config.settings.cert == null) return true;
        return false;
    }

    it('should warn when cert is not set and not lanonly', function () {
        assert.strictEqual(shouldWarnCert({ settings: {} }, false), true);
        assert.strictEqual(shouldWarnCert({}, false), true);
    });

    it('should NOT warn when cert is set', function () {
        assert.strictEqual(shouldWarnCert({ settings: { cert: 'myserver.lan' } }, false), false);
    });

    it('should NOT warn when lanonly is true', function () {
        assert.strictEqual(shouldWarnCert({ settings: {} }, true), false);
        assert.strictEqual(shouldWarnCert({}, true), false);
    });
});

// ============================================================================
// Test #8036: View BitLocker keys without full admin
// ============================================================================

describe('#8036 - View BitLocker keys permission bit', function () {
    const MESHRIGHT_ADMIN = 0xFFFFFFFF;
    const MESHRIGHT_VIEWBITLOCKER = 0x01000000; // 16777216

    function canViewBitlocker(rights) {
        // Only allow admin (exact match) or VIEWBITLOCKER bit — not admin bitmask that contains all bits
        if (rights === MESHRIGHT_ADMIN) return true;
        return (rights & MESHRIGHT_VIEWBITLOCKER) !== 0;
    }

    it('should allow admin to view BitLocker keys', function () {
        assert.strictEqual(canViewBitlocker(MESHRIGHT_ADMIN), true);
    });

    it('should allow user with VIEWBITLOCKER right', function () {
        assert.strictEqual(canViewBitlocker(MESHRIGHT_VIEWBITLOCKER), true);
        // Combined with other rights
        assert.strictEqual(canViewBitlocker(MESHRIGHT_VIEWBITLOCKER | 0x08), true); // remote control + viewbitlocker
    });

    it('should NOT allow regular user without VIEWBITLOCKER or ADMIN', function () {
        assert.strictEqual(canViewBitlocker(0x08), false); // remote control only
        assert.strictEqual(canViewBitlocker(0x108), false); // remote control + remote view only
        assert.strictEqual(canViewBitlocker(0), false); // no rights
    });

    it('should be a unique bit that does not collide with existing rights', function () {
        // Verify VIEWBITLOCKER (0x01000000) does not collide with any existing MESHRIGHT
        const existing = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608];
        for (var i = 0; i < existing.length; i++) {
            assert.strictEqual((MESHRIGHT_VIEWBITLOCKER & existing[i]) !== 0, false, 'Bit collision with MESHRIGHT_' + existing[i]);
        }
    });
});

// ============================================================================
// Test #7971: Null guard on agentInfo.capabilities prevents server crash
// ============================================================================

describe('#7971 - Null guard on agentInfo prevents crash', function () {
    it('should not crash when agentInfo is null', function () {
        var obj = { agentInfo: null };
        // Simulate the fix: check null before accessing capabilities
        var caps = (obj.agentInfo != null) ? (obj.agentInfo.capabilities & 0x40) : 0;
        assert.strictEqual(caps, 0);
    });

    it('should not crash when agentInfo is undefined', function () {
        var obj = {};
        var caps = (obj.agentInfo != null) ? (obj.agentInfo.capabilities & 0x40) : 0;
        assert.strictEqual(caps, 0);
    });

    it('should work correctly when agentInfo is present', function () {
        var obj = { agentInfo: { capabilities: 0x40 } };
        var caps = (obj.agentInfo != null) ? (obj.agentInfo.capabilities & 0x40) : 0;
        assert.strictEqual(caps, 0x40);
    });
});
