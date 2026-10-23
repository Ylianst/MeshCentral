const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.argv[2] || path.resolve(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function functionSource(text, name) {
    const start = text.indexOf('    function ' + name + '(');
    assert.ok(start >= 0, name);
    const end = text.indexOf('\n    }', start);
    assert.ok(end > start, name);
    return text.slice(start, end + 6);
}
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

test('State transitions are dispatched once with readable messages and device-group targets', () => {
    const agent = source('meshagent.js');
    const device = { agent: {}, meshid: 'mesh/test/group', ip: '127.0.0.1' };
    const dispatched = [];
    const obj = { agentInfo: { capabilities: 0 }, dbNodeKey: 'node/test/device', dbMeshKey: device.meshid, remoteaddr: device.ip };
    const parent = {
        meshes: { [device.meshid]: { mtype: 2 } },
        CreateMeshDispatchTargets: (mesh, nodes) => [mesh, ...nodes],
        parent: { DispatchEvent: (ids, origin, event) => dispatched.push({ ids, origin, event }) }
    };
    const context = vm.createContext({ obj, parent, domain: { id: 'test' }, args: { wanonly: true },
        db: { Get: (id, callback) => callback(null, [device]), GetNodeEventsWithLimit: (node, domain, limit, filter, callback) => callback(null, []), StoreEvent: () => { throw Error('Direct double store'); } } });
    vm.runInContext(functionSource(agent, 'isUserSessionTimelineState') + '\n' + functionSource(agent, 'ChangeAgentCoreInfo'), context);
    const expected = { locked: 'Locked', unlocked: 'Unlocked', nouser: 'No active user', unknown: 'Unknown' };
    for (const state of Object.keys(expected)) {
        context.ChangeAgentCoreInfo({ sessionstate: state });
        context.ChangeAgentCoreInfo({ sessionstate: state });
    }
    context.ChangeAgentCoreInfo({ sessionstate: 'invalid' });
    context.ChangeAgentCoreInfo({});
    assert.equal(dispatched.length, 4);
    for (const { ids, origin, event } of dispatched) {
        assert.deepEqual(Array.from(ids), [device.meshid, obj.dbNodeKey]);
        assert.equal(origin, obj);
        assert.equal(event.meshid, device.meshid);
        assert.equal(event.nodeid, obj.dbNodeKey);
        assert.equal(event.domain, 'test');
        assert.equal(event.action, 'sessionstate');
        assert.equal(event.msg, 'User session state: ' + expected[event.state]);
        assert.equal(event.nolog, undefined);
    }
});

function sessionAgent(history, options = {}) {
    const device = { agent: {}, meshid: 'mesh/test/group', ip: '127.0.0.1' };
    const obj = { agentInfo: { capabilities: 0 }, dbNodeKey: 'node/test/device', dbMeshKey: device.meshid, remoteaddr: device.ip };
    const dispatched = [], queries = [], timers = [], pending = [];
    const parent = {
        meshes: { [device.meshid]: { mtype: 2 } },
        CreateMeshDispatchTargets: (mesh, nodes) => [mesh, ...nodes],
        parent: { DispatchEvent: (ids, origin, event) => { dispatched.push(event); history.unshift(event); } }
    };
    const context = vm.createContext({ obj, parent, domain: { id: 'test' }, args: { wanonly: true },
        setTimeout: callback => timers.push(callback),
        db: {
            Get: (id, callback) => callback(null, [device]),
            GetNodeEventsWithLimit: (node, domain, limit, filter, callback) => {
                queries.push([node, domain, limit, filter]);
                const finish = () => callback(options.error || null, history.slice(0, 1));
                if (options.delayed) pending.push(finish); else finish();
            }
        }
    });
    const agent = source('meshagent.js');
    vm.runInContext(functionSource(agent, 'isUserSessionTimelineState') + '\n' + functionSource(agent, 'ChangeAgentCoreInfo'), context);
    return { context, obj, dispatched, queries, timers, pending };
}

test('Reconnects restore every saved state once and retain genuine transitions', () => {
    for (const state of ['locked', 'unlocked', 'nouser', 'unknown']) {
        const agent = sessionAgent([{ state }]);
        agent.context.ChangeAgentCoreInfo({ sessionstate: state });
        agent.context.ChangeAgentCoreInfo({ sessionstate: state });
        assert.equal(agent.dispatched.length, 0);
        assert.deepEqual(agent.queries, [['node/test/device', 'test', 1, 'sessionstate']]);
        const next = state === 'locked' ? 'unlocked' : 'locked';
        agent.context.ChangeAgentCoreInfo({ sessionstate: next });
        assert.equal(agent.dispatched.length, 1);
        assert.equal(agent.dispatched[0].state, next);
        assert.equal(agent.queries.length, 1);
    }
});

test('A first report is recorded when history is missing, invalid, or unavailable', () => {
    for (const [history, options] of [[[], {}], [[{ state: 'invalid' }], {}], [[], { error: new Error('Database read failed') }]]) {
        const agent = sessionAgent(history, options);
        agent.context.ChangeAgentCoreInfo({});
        agent.context.ChangeAgentCoreInfo({ sessionstate: 'invalid' });
        assert.equal(agent.queries.length, 0);
        agent.context.ChangeAgentCoreInfo({ sessionstate: 'unlocked' });
        agent.context.ChangeAgentCoreInfo({ sessionstate: 'unlocked' });
        assert.equal(agent.dispatched.length, 1);
        assert.equal(agent.queries.length, 1);
    }
});

test('New connection objects and server restarts do not repeat the last stored state', () => {
    const history = [];
    const original = sessionAgent(history);
    original.context.ChangeAgentCoreInfo({ sessionstate: 'unlocked' });
    assert.equal(original.dispatched.length, 1);
    for (let reconnect = 0; reconnect < 3; reconnect++) {
        const fresh = sessionAgent(history);
        fresh.context.ChangeAgentCoreInfo({ sessionstate: 'unlocked' });
        assert.equal(fresh.dispatched.length, 0);
    }
    assert.equal(history.length, 1);
});

test('A pending history lookup serializes reports without losing a later transition', () => {
    const agent = sessionAgent([{ state: 'locked' }], { delayed: true });
    agent.context.ChangeAgentCoreInfo({ sessionstate: 'unlocked' });
    assert.equal(agent.obj.deviceChanging, true);
    agent.context.ChangeAgentCoreInfo({ sessionstate: 'locked' });
    assert.equal(agent.timers.length, 1);
    agent.pending.shift()();
    agent.timers.shift()();
    assert.deepEqual(agent.dispatched.map(event => event.state), ['unlocked', 'locked']);
    assert.equal(agent.queries.length, 1);
    assert.equal(agent.obj.deviceChanging, undefined);
});

test('Device and global session filters reach the database with existing rights checks', () => {
    const userSource = source('meshuser.js');
    const eventsCase = userSource.slice(userSource.indexOf("            case 'events':"), userSource.indexOf("            case 'recordings':"));
    for (const limited of [false, true]) {
        const calls = [];
        const responses = [];
        const user = { _id: 'user/test/viewer', siteadmin: 0, links: {} };
        const context = vm.createContext({ user, domain: { id: 'test' }, obj: { user },
            MESHRIGHT_LIMITEVENTS: 8192, MESHRIGHT_ADMIN: 0xFFFFFFFF, SITERIGHT_MANAGEUSERS: 2,
            ws: { send: value => responses.push(JSON.parse(value)) },
            common: { validateInt: value => Number.isInteger(value) },
            parent: { GetNodeWithRights: (domain, user, id, callback) => callback({ _id: id }, limited ? 8192 : 0xFFFFFFFF, true) },
            db: {
                GetNodeEventsWithLimit: (...args) => { calls.push(args.slice(0, -1)); args.at(-1)(null, []); },
                GetNodeEventsSelfWithLimit: (...args) => { calls.push(args.slice(0, -1)); args.at(-1)(null, []); },
                GetEventsWithLimit: (...args) => { calls.push(args.slice(0, -1)); args.at(-1)(null, []); }
            }
        });
        user.subscriptions = ['mesh/test/group'];
        vm.runInContext('function query(command) { switch(command.action) {\n' + eventsCase + '\n} }', context);
        context.query({ action: 'events', nodeid: 'node/test/device', filter: 'sessionstate', limit: 60 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].at(-1), 'sessionstate');
        assert.equal(calls[0].length, limited ? 5 : 4);
        assert.equal(responses[0].nodeid, 'node/test/device');
        context.query({ action: 'events', filter: 'sessionstate', limit: 60 });
        assert.equal(calls[1].at(-1), 'sessionstate');
    }
});

for (const view of ['default', 'default3', 'default-mobile']) {
    const text = source('views/' + view + '.handlebars');
    const helpers = text.slice(text.indexOf('        function sessionTimelineLegend('), text.indexOf('        // Return a color for the given power state'));
    const context = vm.createContext({ format: (text, value) => text.replace('{0}', value) });
    vm.runInContext(helpers, context);
    test(view + ': legend explains colors and gaps', () => {
        const legend = context.sessionTimelineLegend();
        for (const label of ['Unlocked', 'Locked', 'No active user', 'Blank: Offline or unknown']) assert.ok(legend.includes(label));
        for (const color of ['#5cb85c', '#f0ad4e', '#8a8a8a']) assert.ok(legend.includes(color));
    });
    if (view !== 'default-mobile') {
        test(view + ': historical and live events display known and unknown states', () => {
            for (const [state, label] of Object.entries({ locked: 'Locked', unlocked: 'Unlocked', nouser: 'No active user', unknown: 'Unknown' })) {
                for (const msg of [undefined, 'old server text']) {
                    const event = { action: 'sessionstate', state, msg };
                    context.localizeSessionStateEvent(event);
                    assert.equal(event.msg, 'User session state: ' + label);
                }
            }
            const unrelated = { action: 'changenode', msg: 'Original message' };
            context.localizeSessionStateEvent(unrelated);
            assert.equal(unrelated.msg, 'Original message');
            const invalid = { action: 'sessionstate', state: '<script>', msg: 'Original message' };
            context.localizeSessionStateEvent(invalid);
            assert.equal(invalid.msg, 'Original message');
        });
    }
}
console.log(passed + ' session event/UI tests passed');
