/**
* @description Unit tests for Mesh agent and companion tool downloads
* @license Apache-2.0
*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const getSessionUser = require('../webserver/agent-downloads.js').getSessionUser;
const hasDatabaseFailure = require('../webserver/agent-downloads.js').hasDatabaseFailure;
const hasNodeAccess = require('../webserver/agent-downloads.js').hasNodeAccess;
const getAgentInfo = require('../webserver/agent-downloads.js').getAgentInfo;
const getMeshRelayUrl = require('../webserver/agent-downloads.js').getMeshRelayUrl;
const getCoreDownloadUrl = require('../webserver/agent-downloads.js').getCoreDownloadUrl;
const sendMeshCoreList = require('../webserver/agent-downloads.js').sendMeshCoreList;
const sendMeshCore = require('../webserver/agent-downloads.js').sendMeshCore;
const sendAgentList = require('../webserver/agent-downloads.js').sendAgentList;
const sendAgentInstallScript = require('../webserver/agent-downloads.js').sendAgentInstallScript;
const sendMeshCmd = require('../webserver/agent-downloads.js').sendMeshCmd;
const sendMeshTool = require('../webserver/agent-downloads.js').sendMeshTool;
const sendGenericMeshAction = require('../webserver/agent-downloads.js').sendGenericMeshAction;
const sendRouteMeshAction = require('../webserver/agent-downloads.js').sendRouteMeshAction;
const sendAgentSelfInstaller = require('../webserver/agent-downloads.js').sendAgentSelfInstaller;
const sendAgentPdb = require('../webserver/agent-downloads.js').sendAgentPdb;
const sendAgentBinary = require('../webserver/agent-downloads.js').sendAgentBinary;
const sendCustomizedWindowsAgent = require('../webserver/agent-downloads.js').sendCustomizedWindowsAgent;
const handleCoreDumpRequest = require('../webserver/agent-downloads.js').handleCoreDumpRequest;
const createAgentDownloadHandler = require('../webserver/agent-downloads.js').createAgentDownloadHandler;

test('agent tool downloads safely resolve optional session users', function () {
    const users = { 'user//alice': { name: 'Alice' } };
    assert.equal(getSessionUser(users, null), null);
    assert.equal(getSessionUser(users, {}), null);
    assert.equal(getSessionUser(users, { session: null }), null);
    assert.equal(getSessionUser(users, { session: {} }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//missing' } }), null);
    assert.equal(getSessionUser(users, { session: { userid: 'user//alice' } }), users['user//alice']);
});

test('agent action node lookups reject database failures and missing arrays', function () {
    assert.equal(hasDatabaseFailure(new Error('database unavailable'), []), true);
    assert.equal(hasDatabaseFailure(null, null), true);
    assert.equal(hasDatabaseFailure(null, undefined), true);
    assert.equal(hasDatabaseFailure(null, []), false);
});

test('route actions require user rights on the requested node', function () {
    const user = { _id: 'user//alice' };
    const node = { _id: 'node//node1', meshid: 'mesh//main' };
    const allowed = { GetNodeRights: function (actualUser, meshId, nodeId) { return (actualUser === user && meshId == node.meshid && nodeId == node._id) ? 1 : 0; } };
    const denied = { GetNodeRights: function () { return 0; } };
    assert.equal(hasNodeAccess(allowed, user, node), true);
    assert.equal(hasNodeAccess(denied, user, node), false);
});

test('agent listings prefer binaries customized for the domain', function () {
    const defaults = { 3: { name: 'default' }, 4: { name: 'default-64' } };
    const domain = { 3: { name: 'custom' } };
    assert.equal(getAgentInfo(defaults, domain, 3), domain[3]);
    assert.equal(getAgentInfo(defaults, domain, 4), defaults[4]);
    assert.equal(getAgentInfo(defaults, null, 3), defaults[3]);
});

test('agent actions build valid relay URLs for root and path domains', function () {
    const state = { args: { port: 443 }, getWebServerName: function () { return 'server.example.com'; } };
    assert.equal(getMeshRelayUrl(state, { id: '' }, {}), 'wss://server.example.com:443/meshrelay.ashx');
    assert.equal(getMeshRelayUrl(state, { id: 'tenant' }, {}), 'wss://server.example.com:443/tenant/meshrelay.ashx');
    state.args.aliasport = 8443;
    assert.equal(getMeshRelayUrl(state, { id: 'tenant' }, {}), 'wss://server.example.com:8443/tenant/meshrelay.ashx');
});

test('MeshCore links preserve the request path and encode query values', function () {
    assert.equal(getCoreDownloadUrl({ originalUrl: '/meshagents?cores=1', query: {} }, 'dlcore', 'Core 1'), '/meshagents?dlcore=Core%201');
    assert.equal(getCoreDownloadUrl({ originalUrl: '/tenant/meshagents?cores=1', query: { key: 'a&b' } }, 'dlccore', 'Core 1'), '/tenant/meshagents?dlccore=Core%201&key=a%26b');
});

test('MeshCore listings contain download links, sizes and hashes', function () {
    const parent = {
        defaultMeshCores: { 'Core 1': Buffer.alloc(8) },
        defaultMeshCoresDeflate: { 'Core 1': Buffer.alloc(4) },
        defaultMeshCoresHash: { 'Core 1': Buffer.from([1, 2]) }
    };
    const res = { send: function (body) { this.body = body; } };
    sendMeshCoreList(parent, { originalUrl: '/tenant/meshagents?cores=1', query: { key: 'secret' } }, res);
    assert.match(res.body, /href="\/tenant\/meshagents\?dlcore=Core%201&amp;key=secret"|href="\/tenant\/meshagents\?dlcore=Core%201&key=secret"/);
    assert.match(res.body, />8<\/a>/);
    assert.match(res.body, /0102/);
});

test('MeshCore downloads strip the uncompressed header and preserve compressed data', function () {
    const parent = { defaultMeshCores: { core: Buffer.from('HEADcode') }, defaultMeshCoresDeflate: { core: Buffer.from('zip') } };
    const headers = [];
    const setHeader = function (res, type, filename) { headers.push(filename); };
    const plain = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendMeshCore(parent, setHeader, { query: { dlcore: 'core' } }, plain, false);
    assert.equal(plain.body.toString(), 'code');
    assert.equal(headers[0], 'core.js');

    const compressed = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendMeshCore(parent, setHeader, { query: { dlccore: 'core' } }, compressed, true);
    assert.equal(compressed.body, parent.defaultMeshCoresDeflate.core);
    assert.equal(headers[1], 'core.js.deflate');
});

test('unknown MeshCore downloads return not found', function () {
    const res = { sendStatus: function (status) { this.status = status; } };
    sendMeshCore({ defaultMeshCores: {} }, function () { }, { query: { dlcore: 'missing' } }, res, false);
    assert.equal(res.status, 404);
});

test('agent listings use domain binaries and expose authorized downloads', function () {
    const parent = {
        config: { settings: { agentcoredumpusers: [] } },
        meshAgentBinaries: { 3: { id: 3, desc: 'Default Agent', rname: 'meshagent.exe', size: 10, hashhex: 'default' } }
    };
    const custom = { id: 3, desc: 'Custom Agent', rname: 'customagent.exe', size: 20, hashhex: 'custom', zdata: Buffer.alloc(1) };
    const res = { send: function (body) { this.body = body; } };
    sendAgentList(parent, { meshAgentBinaries: { 3: custom } }, { _id: 'user//admin', siteadmin: 0xFFFFFFFF }, { originalUrl: '/tenant/meshagents', query: {} }, res, true);
    assert.match(res.body, /Custom&nbsp;Agent/);
    assert.match(res.body, /customagent\.exe/);
    assert.match(res.body, />PDB<\/a>/);
    assert.match(res.body, />ZIP<\/a>/);
    assert.match(res.body, /MeshAgent Crash Dumps/);
});

test('agent install scripts receive certificate and proxy command options', function () {
    const parent = { meshAgentInstallScripts: { 1: { rname: 'install.sh', data: '{{{wgetoptionshttp}}}|{{{wgetoptionshttps}}}|{{{curloptionshttp}}}|{{{curloptionshttps}}}' } } };
    const state = { isTrustedCert: function () { return false; } };
    const headers = [];
    const res = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendAgentInstallScript(state, parent, { agentnoproxy: true }, function (response, type, filename) { headers.push(filename); }, { query: { script: 1 } }, res);
    assert.equal(headers[0], 'install.sh');
    assert.equal(res.body, '--no-proxy |--no-check-certificate --no-proxy |-L --noproxy \'*\' |-L -k --noproxy \'*\' ');
});

test('unknown agent install scripts return not found', function () {
    const res = { sendStatus: function (status) { this.status = status; } };
    sendAgentInstallScript({}, { meshAgentInstallScripts: {} }, {}, function () { }, { query: { script: 99 } }, res);
    assert.equal(res.status, 404);
});

test('MeshCmd downloads prefer available signed executables', function () {
    const parent = { meshAgentBinaries: { 11000: { path: 'signed.exe' } } };
    const res = { sendFile: function (path) { this.path = path; }, sendStatus: function (status) { this.status = status; } };
    const headers = [];
    sendMeshCmd({ fs: { statSync: function () { return {}; } } }, parent, {}, function (response, type, filename) { headers.push(filename); }, { query: { meshcmd: '3' } }, res);
    assert.equal(res.path, 'signed.exe');
    assert.equal(headers[0], 'meshcmd.exe');
});

test('MeshCmd downloads merge the command core into unsigned agents', function () {
    const streams = [];
    const parent = {
        meshAgentBinaries: { 6: { platform: 'linux', path: 'agent', pe: null } },
        defaultMeshCmd: 'command-core',
        exeHandler: { streamExeWithJavaScript: function (options) { streams.push(options); } }
    };
    const res = { sendFile: function () { }, sendStatus: function (status) { this.status = status; } };
    sendMeshCmd({ fs: { statSync: function () { throw new Error('missing'); } } }, parent, {}, function () { }, { query: { meshcmd: '6' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(streams[0].sourceFileName, 'agent');
    assert.equal(streams[0].js.toString(), 'command-core');
});

test('companion tool downloads prefer configured binaries', function () {
    const sent = [], headers = [];
    const state = { fs: { existsSync: function (path) { return path == 'custom-router.exe'; } }, path: { join: function () { return Array.from(arguments).join('/'); } } };
    const parent = { meshToolsBinaries: { MeshCentralRouter: { path: 'custom-router.exe' } } };
    const res = { sendFile: function (path) { sent.push(path); }, sendStatus: function (status) { this.status = status; } };
    assert.equal(sendMeshTool(state, parent, 'root', function (response, type, filename) { headers.push(filename); }, 'winrouter', res), true);
    assert.deepEqual(sent, ['custom-router.exe']);
    assert.deepEqual(headers, ['MeshCentralRouter.exe']);
});

test('companion tool downloads use repository fallbacks and reject unknown actions', function () {
    const sent = [];
    const fallback = 'root/agents/MeshCentralRouter.dmg';
    const state = { fs: { existsSync: function (path) { return path == fallback; } }, path: { join: function () { return Array.from(arguments).join('/'); } } };
    const parent = { meshToolsBinaries: {} };
    const res = { sendFile: function (path) { sent.push(path); }, sendStatus: function (status) { this.status = status; } };
    assert.equal(sendMeshTool(state, parent, 'root', function () { }, 'macrouter', res), true);
    assert.deepEqual(sent, [fallback]);
    assert.equal(sendMeshTool(state, parent, 'root', function () { }, 'unknown', res), false);
});

test('generic mesh actions contain user and server connection details', function () {
    const state = {
        agentCertificateHashHex: 'aabb',
        webCertificateHashs: { tenant: Buffer.from([1, 2]).toString('binary') },
        args: { port: 443 },
        getWebServerName: function () { return 'server.example.com'; }
    };
    const headers = [];
    const res = { send: function (body) { this.body = body; } };
    sendGenericMeshAction(state, { id: 'tenant' }, { name: 'Alice' }, function (response, type, filename) { headers.push(filename); }, { query: { key: 'secret' } }, res);
    const action = JSON.parse(res.body);
    assert.equal(action.username, 'Alice');
    assert.equal(action.serverId, 'AABB');
    assert.equal(action.serverHttpsHash, '0102');
    assert.equal(action.serverUrl, 'wss://server.example.com:443/tenant/meshrelay.ashx');
    assert.equal(action.loginKey, 'secret');
    assert.deepEqual(headers, ['meshaction.txt']);
});

test('route mesh actions resolve authorized nodes and connection details', function () {
    const user = { name: 'Alice' };
    const node = { _id: 'node/tenant/node1', meshid: 'mesh/tenant/main', name: 'Desktop' };
    const state = {
        db: { Get: function (id, callback) { callback(null, [node]); } },
        GetNodeRights: function () { return 1; },
        agentCertificateHashHex: 'aabb',
        webCertificateHashs: { tenant: Buffer.from([1, 2]).toString('binary') },
        args: { port: 443 },
        getWebServerName: function () { return 'server.example.com'; }
    };
    const res = { sendStatus: function (status) { this.status = status; }, send: function (body) { this.body = body; } };
    sendRouteMeshAction(state, { id: 'tenant' }, user, function () { }, { query: { meshaction: 'route', nodeid: node._id } }, res);
    const action = JSON.parse(res.body);
    assert.equal(action.remoteName, 'Desktop');
    assert.equal(action.remoteNodeId, node._id);
    assert.equal(action.username, 'Alice');
    assert.equal(action.serverUrl, 'wss://server.example.com:443/tenant/meshrelay.ashx');
});

test('route mesh actions reject unauthorized nodes', function () {
    const node = { _id: 'node/tenant/node1', meshid: 'mesh/tenant/main' };
    const state = { db: { Get: function (id, callback) { callback(null, [node]); } }, GetNodeRights: function () { return 0; } };
    const res = { sendStatus: function (status) { this.status = status; } };
    sendRouteMeshAction(state, { id: 'tenant' }, {}, function () { }, { query: { meshaction: 'route', nodeid: node._id } }, res);
    assert.equal(res.status, 401);
});

test('agent self installers embed MSH settings into non-Windows binaries', function () {
    const streams = [], headers = [];
    const parent = {
        meshAgentBinaries: { 6: { platform: 'linux', path: 'agent', pe: null } },
        meshAgentInstallScripts: { 6: { data: 'before; var msh = {}; after;' } },
        exeHandler: { streamExeWithJavaScript: function (options) { streams.push(options); } }
    };
    const req = { query: { meshinstall: '6', id: 'mesh-id' } };
    const res = { sendStatus: function (status) { this.status = status; }, setHeader: function () { } };
    sendAgentSelfInstaller(parent, { agentcustomization: { filename: 'company-agent' } }, function () { return '\r\nMeshName=Main\r\nMeshType=2\r\n'; }, function (response, type, filename) { headers.push(filename); }, req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(headers, ['company-agent']);
    assert.equal(streams[0].sourceFileName, 'agent');
    assert.match(streams[0].js.toString(), /var msh = \{"MeshName":"Main","MeshType":"2"\};/);
});

test('agent self installers reject missing MSH authorization', function () {
    const res = { sendStatus: function (status) { this.status = status; } };
    sendAgentSelfInstaller({}, {}, function () { return null; }, function () { }, { query: {} }, res);
    assert.equal(res.status, 401);
});

test('PDB downloads require an authorized user and resolve symbol paths', function () {
    const user = { _id: 'user//admin', siteadmin: 0xFFFFFFFF };
    const state = { users: { [user._id]: user } };
    const parent = { config: { settings: {} } };
    const agent = { id: 3, path: 'bin/MeshService-signed.exe' };
    const res = { sendStatus: function (status) { this.status = status; }, sendFile: function (path) { this.path = path; }, setHeader: function () { } };
    sendAgentPdb(state, parent, agent, function () { }, { session: { userid: user._id } }, res);
    assert.equal(res.path, 'bin/MeshService.pdb');

    const denied = { sendStatus: function (status) { this.status = status; } };
    sendAgentPdb(state, parent, agent, function () { }, {}, denied);
    assert.equal(denied.status, 404);
});

test('direct agent downloads apply customized APK filenames', function () {
    const headers = [];
    const agent = { rname: 'meshagent.apk', data: Buffer.from('agent') };
    const res = { send: function (body) { this.body = body; }, sendFile: function (path) { this.path = path; }, setHeader: function () { } };
    sendAgentBinary({ agentcustomization: { filename: 'company-agent' } }, agent, function (response, type, filename) { headers.push(filename); }, { query: {} }, res);
    assert.deepEqual(headers, ['company-agent.apk']);
    assert.equal(res.body, agent.data);
});

test('compressed agent downloads return ZIP data or not found', function () {
    const headers = [];
    const data = Buffer.from('zip');
    const res = { send: function (body) { this.body = body; }, sendStatus: function (status) { this.status = status; }, setHeader: function () { } };
    sendAgentBinary({}, { rname: 'meshagent', zdata: data }, function (response, type, filename) { headers.push(filename); }, { query: { zip: 1 } }, res);
    assert.equal(res.body, data);
    assert.deepEqual(headers, ['meshagent.zip']);

    const missing = { sendStatus: function (status) { this.status = status; }, setHeader: function () { } };
    sendAgentBinary({}, { rname: 'meshagent' }, function () { }, { query: { zip: 1 } }, missing);
    assert.equal(missing.status, 404);
});

test('customized Windows agents embed device group and server policy', function () {
    const meshId = Buffer.from('mesh-id').toString('base64');
    const streams = [], headers = [];
    const state = {
        meshes: { ['mesh/tenant/' + meshId]: { name: 'Main Group', mtype: 2, domain: 'tenant' } },
        agentCertificateHashBase64: Buffer.from('server-id').toString('base64'),
        args: { port: 443 },
        common: { isAlphaNumeric: function () { return true; } },
        GetMeshRights: function () { return 1; },
        getWebServerName: function () { return 'server.example.com'; }
    };
    const parent = {
        config: { settings: {} },
        decodeCookie: function () { return null; },
        exeHandler: { streamExeWithMeshPolicy: function (options) { streams.push(options); } }
    };
    const domain = { id: 'tenant', agentcustomization: { displayname: 'Company Agent' } };
    const agent = { rname: 'MeshAgent.exe', path: 'agent.exe', pe: null };
    const req = { query: { id: '3', meshid: meshId, tag: 'branch1' }, session: {} };
    const res = { sendStatus: function (status) { this.status = status; }, setHeader: function () { } };
    sendCustomizedWindowsAgent(state, parent, domain, agent, function () { return ''; }, function (response, type, filename) { headers.push(filename); }, req, res);
    assert.deepEqual(headers, ['MeshAgent-MainGroup.exe']);
    assert.equal(streams[0].sourceFileName, 'agent.exe');
    assert.match(streams[0].msh, /MeshName=Main Group/);
    assert.match(streams[0].msh, /MeshServer=wss:\/\/server\.example\.com:443\/tenant\/agent\.ashx/);
    assert.match(streams[0].msh, /Tag=branch1/);
    assert.match(streams[0].msh, /displayName=Company Agent/);
});

test('core dump requests list authorized dumps with domain agent metadata', function () {
    const parent = {
        datapath: 'data',
        config: { settings: { agentcoredump: true } },
        meshAgentBinaries: { 3: { id: 3, desc: 'Default Agent', hashhex: 'abc123' } }
    };
    const custom = { id: 3, desc: 'Custom Agent', hashhex: 'abc999' };
    const state = {
        path: { join: function () { return Array.from(arguments).join('/'); } },
        common: { IsFilenameValid: function () { return true; } },
        fs: {
            existsSync: function () { return true; },
            readdirSync: function () { return ['3-ABC-node1.dmp']; },
            statSync: function () { return { ctime: new Date('2024-01-02T00:00:00Z'), size: 50 }; }
        }
    };
    const res = { send: function (body) { this.body = body; }, sendStatus: function (status) { this.status = status; } };
    const result = handleCoreDumpRequest(state, parent, { meshAgentBinaries: { 3: custom } }, { siteadmin: 0xFFFFFFFF }, function () { }, { originalUrl: '/tenant/meshagents?dumps=1', query: { dumps: 1 } }, res);
    assert.deepEqual(result, { allowed: true, handled: true });
    assert.match(res.body, /Custom&nbsp;Agent/);
    assert.match(res.body, /\?dldump=3-ABC-node1\.dmp/);
    assert.match(res.body, />50<\/td>/);
});

test('core dump requests remain inactive for unauthorized users', function () {
    const result = handleCoreDumpRequest({}, { config: { settings: { agentcoredump: true, agentcoredumpusers: [] } } }, {}, { _id: 'user//alice', siteadmin: 0 }, function () { }, { query: { dumps: 1 } }, {});
    assert.deepEqual(result, { allowed: false, handled: false });
});

test('agent download handler rejects locked anonymous requests', function () {
    const handler = createAgentDownloadHandler({
        state: {},
        parent: { config: { settings: { lockagentdownload: true } }, debug: function () { } },
        getDomain: function () { return { id: '' }; },
        isAgentDownloadLocked: function () { return true; },
        hasUserSession: function () { return false; }
    });
    const res = { sendStatus: function (status) { this.status = status; } };
    handler({ query: {} }, res);
    assert.equal(res.status, 401);
});

test('agent download handler dispatches direct binary requests', function () {
    const data = Buffer.from('agent');
    const parent = { config: { settings: {} }, meshAgentBinaries: { 6: { rname: 'meshagent', platform: 'linux', data: data } }, debug: function () { } };
    const handler = createAgentDownloadHandler({
        state: {},
        parent: parent,
        getDomain: function () { return { id: '' }; },
        setContentDispositionHeader: function () { },
        isAgentDownloadLocked: function () { return false; },
        hasUserSession: function () { return false; }
    });
    const res = { send: function (body) { this.body = body; }, sendStatus: function (status) { this.status = status; }, setHeader: function () { } };
    handler({ query: { id: 6 } }, res);
    assert.equal(res.body, data);
});
