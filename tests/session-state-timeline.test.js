'use strict';

// Run with: node tests/session-state-timeline.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const corePath = process.argv[2] || path.join(__dirname, '..', 'agents', 'meshcore.js');
const source = fs.readFileSync(corePath, 'utf8');
const start = source.indexOf('var userSessionLockState = {};');
const end = source.indexOf('\ntry {\n    var userSession = require', start);
assert.ok(start >= 0 && end > start, 'Session handler must be present');
new vm.Script('(function(exports, require, module, __filename, __dirname) {\n' + source + '\n})');

function createCore(active, options = {}) {
    const context = {
        Buffer,
        process: { platform: options.platform || 'win32' },
        meshCoreObj: {},
        getDomainInfo: () => null,
        getJoinState: () => 0,
        meshCoreObjChanged: () => {},
        versionQueries: 0,
        nativeQueries: 0,
        userSession: {
            enumerateUsers: () => ({ then: fn => fn({ Active: active }) }),
            getRawSessionAttribute: (sessionId, infoClass) => {
                context.nativeQueries++;
                assert.equal(infoClass, 25);
                if (options.queryError || !options.flags || !(sessionId in options.flags)) throw new Error('Unavailable');
                const data = Buffer.alloc(options.length === undefined ? 232 : options.length);
                if (data.length >= 20) {
                    data.writeUInt32LE(options.level === undefined ? 1 : options.level, 0);
                    data.writeUInt32LE(options.wrongSession ? sessionId + 1 : sessionId, 8);
                    data.writeUInt32LE(options.flags[sessionId], 16);
                }
                return data;
            }
        },
        require: name => {
            assert.equal(name, '_GenericMarshal');
            if (options.versionError) throw new Error('Version API unavailable');
            return {
                CreateVariable: size => { const b = Buffer.alloc(size); return { toBuffer: () => b }; },
                CreateNativeProxy: library => {
                    assert.equal(library, 'ntdll.dll');
                    return {
                        CreateMethod: method => assert.equal(method, 'RtlGetVersion'),
                        RtlGetVersion: variable => {
                            context.versionQueries++;
                            const b = variable.toBuffer();
                            assert.equal(b.readUInt32LE(0), 276);
                            b.writeUInt32LE(options.major === undefined ? 10 : options.major, 4);
                            b.writeUInt32LE(options.minor || 0, 8);
                            return { Val: options.versionStatus || 0 };
                        }
                    };
                }
            };
        }
    };
    if (options.noNativeApi) delete context.userSession.getRawSessionAttribute;
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return context;
}

const first = { SessionId: 1, Username: 'first' };
const second = { SessionId: 2, Username: 'second' };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function snapshot(c) { c.onUserSessionChanged(null, false); return c.meshCoreObj.sessionstate; }

test('Already locked at core startup', () => {
    assert.equal(snapshot(createCore([first], { flags: { 1: 0 } })), 'locked');
});
test('Already unlocked at core startup', () => {
    assert.equal(snapshot(createCore([first], { flags: { 1: 1 } })), 'unlocked');
});
test('Reinitialization while locked reads Windows again', () => {
    assert.equal(snapshot(createCore([first], { flags: { 1: 0 } })), 'locked');
    assert.equal(snapshot(createCore([first], { flags: { 1: 0 } })), 'locked');
});
test('One unlocked session makes a multi-session device unlocked', () => {
    const c = createCore([first, second], { flags: { 1: 0, 2: 1 } });
    assert.equal(snapshot(c), 'unlocked');
    assert.equal(c.versionQueries, 1, 'Windows version is queried once');
});
test('All active sessions locked', () => {
    assert.equal(snapshot(createCore([first, second], { flags: { 1: 0, 2: 0 } })), 'locked');
});
test('Unknown second session is not assumed unlocked', () => {
    assert.equal(snapshot(createCore([first, second], { flags: { 1: 0 } })), 'unknown');
});
test('A known unlocked session still dominates an unknown session', () => {
    assert.equal(snapshot(createCore([first, second], { flags: { 1: 1 } })), 'unlocked');
});
test('Lock event wins over a stale native unlock snapshot', () => {
    const c = createCore([first], { flags: { 1: 1 } });
    c.onUserSessionChanged(first, true);
    assert.equal(c.meshCoreObj.sessionstate, 'locked');
    assert.equal(snapshot(c), 'locked');
    c.onUserSessionChanged(first, false);
    assert.equal(c.meshCoreObj.sessionstate, 'unlocked');
});
test('Windows 7 / Server 2008 R2 lock flags are reversed', () => {
    assert.equal(snapshot(createCore([first], { flags: { 1: 1 }, major: 6, minor: 1 })), 'locked');
    assert.equal(snapshot(createCore([first], { flags: { 1: 0 }, major: 6, minor: 1 })), 'unlocked');
});
test('Unsupported or failing queries remain unknown', () => {
    for (const options of [
        { noNativeApi: true }, { queryError: true },
        { flags: { 1: 0xffffffff } }, { flags: { 1: 0 }, versionError: true },
        { flags: { 1: 0 }, versionStatus: 1 }
    ]) assert.equal(snapshot(createCore([first], options)), 'unknown');
});
test('Malformed structures and mismatched session IDs are rejected', () => {
    for (const options of [{ length: 16 }, { level: 2 }, { wrongSession: true }]) {
        assert.equal(snapshot(createCore([first], { flags: { 1: 1 }, ...options })), 'unknown');
    }
});
test('Sign-out removes the old lock state; a new logon is queried', () => {
    const active = [first];
    const flags = { 1: 0 };
    const c = createCore(active, { flags });
    assert.equal(snapshot(c), 'locked');
    active.length = 0;
    assert.equal(snapshot(c), 'nouser');
    assert.equal(Object.keys(c.userSessionLockState).length, 0);
    flags[1] = 1;
    active.push(first);
    assert.equal(snapshot(c), 'unlocked');
});
test('Non-Windows platforms do not call Windows APIs', () => {
    const c = createCore([first], { platform: 'darwin', flags: { 1: 0 } });
    assert.equal(snapshot(c), 'unknown');
    assert.equal(c.nativeQueries, 0);
});
test('Legacy username fallback still tracks explicit lock events', () => {
    const legacy = { Username: 'legacy', Domain: 'domain' };
    const c = createCore([legacy], { flags: { 1: 0 } });
    assert.equal(snapshot(c), 'unknown');
    c.onUserSessionChanged({ Username: 'legacy', Domain: 'domain' }, true);
    assert.equal(c.meshCoreObj.sessionstate, 'locked');
});
console.log(passed + ' session-state regression tests passed.');
