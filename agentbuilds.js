'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const compatibility = require('./agentcompatibility');

module.exports.CreateAgentBuilds = function (parent, db, catalog) {
    const server = parent.parent;
    const directory = path.join(server.datapath, 'agentbuilds');
    const changing = new Map();
    const checking = new Map();
    const observing = new Map();
    let generation = 0;
    const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
    const get = id => new Promise((resolve, reject) => db.Get(id, (err, docs) => err ? reject(err) : resolve(docs || [])));
    const set = value => new Promise((resolve, reject) => db.Set(value, err => err ? reject(err) : resolve()));

    function defaultAgent(domain, id) {
        return (domain.meshAgentBinaries && domain.meshAgentBinaries[id]) || server.meshAgentBinaries[id];
    }

    function held(agent) {
        const result = Object.assign({}, agent, { update: false });
        delete result.url;
        return result;
    }

    async function policy(nodeid, enrollment) {
        const docs = await get('ab' + nodeid);
        if (!docs.length) return { mode: 'default', revision: '' };
        if (docs[0].enrollment !== (enrollment || 0)) return { mode: 'default', revision: docs[0].revision };
        return docs[0];
    }

    function updating(agent) {
        return agent && (agent.agentUpdate || agent.agentUpdatePending || agent.agentCoreUpdate || (agent.agentCoreUpdateTaskId != null));
    }

    function observe(agent, disconnected) {
        if (parent.agentBuildUsage) parent.agentBuildUsage.observe(agent, disconnected).catch(err => server.debug('agentupdate', err.message));
        const nodeid = agent.dbNodeKey, value = agent.agentBuildPolicy;
        if (!value || !value.deployment || value.mode === 'hold' || agent.agentPolicyChanging) return Promise.resolve();
        const snapshot = { hash: agent.agentReportedHash, updating: !!updating(agent), time: Date.now(), disconnected: !!disconnected };
        const previous = observing.get(nodeid) || Promise.resolve();
        const task = previous.catch(function () {}).then(async function () {
            const current = await policy(nodeid, value.enrollment);
            if (current.revision !== value.revision) return;
            const docs = await get('abd' + nodeid);
            const old = docs.find(x => x.revision === value.revision && x.enrollment === value.enrollment);
            if (old && old.confirmedAt) return;
            const state = Object.assign({}, old, { _id: 'abd' + nodeid, type: 'agentbuilddeployment', domain: value.domain, nodeid: nodeid, enrollment: value.enrollment, revision: value.revision });
            state.firstSeenAt = state.firstSeenAt || snapshot.time;
            state.lastSeenAt = snapshot.time;
            if (snapshot.disconnected) {
                state.disconnectedAt = snapshot.time;
            } else if (snapshot.hash) {
                if (/^0+$/.test(snapshot.hash)) { state.state = 'blocked'; }
                else {
                    state.reportedHash = snapshot.hash;
                    state.state = snapshot.hash === value.deployment.expectedHash ? 'confirmed' : (snapshot.updating ? 'updating' : 'pending');
                    if (state.state === 'confirmed') state.confirmedAt = snapshot.time;
                    if (state.state === 'updating') state.startedAt = state.startedAt || snapshot.time;
                }
            }
            await set(state);
        });
        observing.set(nodeid, task);
        return task.finally(function () { if (observing.get(nodeid) === task) observing.delete(nodeid); });
    }

    async function status(domain, node, value) {
        const agent = parent.wsagents[node._id], base = defaultAgent(domain, node.agent.id);
        let state = agent ? 'connected' : 'offline';
        if (agent && agent.agentBuildError) state = 'unavailable';
        else if (agent && agent.agentReportedHash === '0'.repeat(96)) state = 'disabled';
        else if (updating(agent)) state = 'updating';
        else if ((value.mode === 'pin') && agent && (agent.agentReportedHash === value.hash)) state = 'matched';
        const result = { nodeid: node._id, name: node.name, agentId: node.agent.id, enrollment: node.firstconnect || 0, policy: value, status: state, serverUpdates: !!(base && base.update), canChange: !server.multiServer && !changing.has(node._id) && !updating(agent) };
        if (agent && agent.agentReportedHash && !/^0+$/.test(agent.agentReportedHash)) result.reportedHash = agent.agentReportedHash;
        if (value.deployment && value.mode !== 'hold') {
            const docs = await get('abd' + node._id);
            const saved = docs.find(x => x.revision === value.revision && x.enrollment === (node.firstconnect || 0));
            const progress = Object.assign({ state: 'pending' }, saved, { requestedAt: value.time, expectedHash: value.deployment.expectedHash });
            const since = value.deployment.requestedOnline ? value.time : progress.firstSeenAt;
            if (!progress.confirmedAt) {
                if (state === 'disabled' || state === 'unavailable' || !result.serverUpdates) progress.state = 'blocked';
                else if (since && (Date.now() - since >= 300000)) progress.state = 'unconfirmed';
                else if (state === 'updating') progress.state = 'updating';
                else if (progress.startedAt) progress.state = 'reconnecting';
            }
            result.deployment = progress;
            if (agent && agent.agentUpdate) {
                const transfer = agent.agentUpdate, total = transfer.agentUpdateData ? transfer.agentUpdateData.length : (agent.agentExeInfo || {}).size;
                if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(transfer.ptr)) result.deployment.transfer = { sent: Math.min(transfer.ptr, total), total: total };
            }
        }
        if (server.multiServer) result.error = 'Per-device build changes are not available on peered servers.';
        return result;
    }

    async function readPinned(value) {
        if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{96}$/.test(value.hash) ||
            !/^[a-f0-9]{96}$/.test(value.fileHash) || !Number.isSafeInteger(value.size) || (value.size < 20) || (value.size > 64 * 1024 * 1024)) throw new Error('Invalid pinned build');
        const handle = await fs.promises.open(path.join(directory, value.sha256), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || (stat.size !== value.size)) throw new Error('Pinned build file changed');
            const data = await handle.readFile();
            if ((data.length !== value.size) || (sha256(data) !== value.sha256) || (crypto.createHash('sha384').update(data).digest('hex') !== value.fileHash)) throw new Error('Pinned build file changed');
            return data;
        } finally { await handle.close(); }
    }

    async function prepare(domain, buildId, agentId, selectedFile, expectedHash) {
        const item = await catalog.getArtifact(buildId, agentId, selectedFile, domain), artifact = item.artifact;
        if (artifact.hashes.sha256 !== expectedHash) throw new Error('The build changed. Refresh and select it again.');
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid build storage directory');
        const filename = path.join(directory, artifact.hashes.sha256);
        try { await fs.promises.writeFile(filename, item.data, { flag: 'wx', mode: 0o600 }); }
        catch (ex) { if (ex.code !== 'EEXIST') throw ex; }
        const value = {
            build: item.build.id, name: item.build.name, agentId: agentId, filename: artifact.filename,
            sha256: artifact.hashes.sha256, hash: artifact.hashes.agentSha384, fileHash: artifact.hashes.sha384,
            size: artifact.size, requirements: item.build.artifacts.find(x => x.filename === artifact.filename).requirements,
            commit: item.build.commit, sourceUrl: item.build.sourceUrl, commitTime: item.build.commitTime
        };
        await readPinned(value);
        const hash = await new Promise((resolve, reject) => {
            const output = crypto.createHash('sha384');
            output.on('data', data => resolve(data.toString('hex')));
            output.on('error', reject);
            try { server.exeHandler.hashExecutableFile({ sourcePath: filename, targetStream: output }); } catch (ex) { reject(ex); }
        });
        if (hash !== value.hash) throw new Error('The build update hash does not match its manifest');
        return value;
    }

    async function resolveCurrent(domain, nodeid, agentId, enrollment) {
        const base = defaultAgent(domain, agentId);
        try {
            const value = await policy(nodeid, enrollment);
            if (value.mode === 'default') return { agent: base, policy: value };
            if (value.mode === 'hold') return { agent: held(base), policy: value };
            if ((value.mode !== 'pin') || (value.agentId !== agentId)) throw new Error('Pinned build does not match this agent architecture');
            const data = await readPinned(value);
            const agent = Object.assign({}, base, {
                id: agentId, desc: value.name, localname: value.filename, size: data.length, data: data,
                hash: Buffer.from(value.hash, 'hex').toString('binary'), hashhex: value.hash,
                fileHash: Buffer.from(value.fileHash, 'hex').toString('binary'), fileHashHex: value.fileHash,
                update: !!(base && base.update), pinned: true, url: 'https://localhost' + domain.url + 'meshagents'
            });
            delete agent.zdata;
            delete agent.zhash;
            delete agent.path;
            return { agent: agent, policy: value };
        } catch (ex) {
            server.debug('agentupdate', 'Holding updates for ' + nodeid + ': ' + ex.message);
            return { agent: held(base), error: 'Pinned build or policy is unavailable. Updates are held.' };
        }
    }

    async function resolve(domain, nodeid, agentId, enrollment) {
        for (;;) {
            if (changing.has(nodeid)) await changing.get(nodeid);
            const before = generation;
            const result = await resolveCurrent(domain, nodeid, agentId, enrollment);
            // A policy can change while the database or pinned file is being read.
            if ((before === generation) && !changing.has(nodeid)) return result;
        }
    }

    function updateUrl(agent) {
        if (!agent.agentExeInfo) return null;
        if (!agent.agentExeInfo.pinned) return agent.agentExeInfo.url;
        const value = agent.agentBuildPolicy;
        const cookie = server.encodeCookie({ a: 'agentbuild', n: agent.dbNodeKey, d: agent.domain.id, r: value.revision }, server.loginCookieEncryptionKey);
        return 'https://localhost' + agent.domain.url + 'meshagents?agentbuild=' + encodeURIComponent(cookie);
    }

    async function download(domain, cookie) {
        if (!cookie || (cookie.a !== 'agentbuild') || (cookie.d !== domain.id) || (typeof cookie.n !== 'string') || !cookie.n.startsWith('node/' + domain.id + '/')) throw new Error('Invalid build download');
        if (changing.has(cookie.n)) await changing.get(cookie.n);
        const nodes = await get(cookie.n), value = await policy(cookie.n, nodes.length ? nodes[0].firstconnect : 0);
        if ((nodes.length !== 1) || (nodes[0].domain !== domain.id) || (value.mode !== 'pin') || (value.revision !== cookie.r)) throw new Error('Build policy changed');
        if (!nodes[0].agent || (nodes[0].agent.id !== value.agentId)) throw new Error('Agent architecture changed');
        const base = defaultAgent(domain, value.agentId);
        if (!base || !base.update) throw new Error('Agent updates are disabled');
        return { data: await readPinned(value), filename: value.filename };
    }

    async function requirements(node, artifacts, refresh) {
        const query = compatibility.request(artifacts), key = sha256(JSON.stringify(query) + '|2');
        const agent = parent.wsagents[node._id], docs = await get('abi' + node._id);
        const cached = docs.find(x => (x.domain === node.domain) && (x.enrollment === (node.firstconnect || 0)) && (x.agentId === node.agent.id) && (x.query === key));
        const recent = cached && ((Date.now() - cached.time) < 300000) && (!agent || cached.time >= agent.connectTime);
        if (!agent || typeof agent.send !== 'function') return recent ? cached : null;
        if (!refresh && recent && cached.time >= agent.connectTime) return cached;
        const pending = checking.get(node._id);
        if (pending && pending.agent === agent && pending.key === key) return pending.promise;
        if (pending) pending.finish(null);
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        const state = { agent: agent, node: node, query: query, key: key, requestid: crypto.randomBytes(16).toString('hex'), promise: promise };
        state.finish = function (value) {
            clearTimeout(state.timer);
            if (checking.get(node._id) === state) checking.delete(node._id);
            finish(value || (recent ? cached : null));
        };
        checking.set(node._id, state);
        state.timer = setTimeout(function () { state.finish(null); }, 8000);
        try { agent.send(JSON.stringify({ action: 'agentbuildinfo', requestid: state.requestid, paths: query.paths, libraries: query.libraries })); }
        catch (ex) { state.finish(null); }
        return promise;
    }

    async function receive(agent, command) {
        const state = checking.get(agent.dbNodeKey);
        if (!state || state.agent !== agent || state.requestid !== command.requestid) return;
        const data = compatibility.validate(command.data, state.query);
        if (!data) { state.finish(null); return; }
        const value = { _id: 'abi' + state.node._id, type: 'agentbuildinfo', domain: state.node.domain, nodeid: state.node._id, enrollment: state.node.firstconnect || 0, agentId: state.node.agent.id, time: Date.now(), query: state.key, data: data };
        if (agent.agentReportedHash && !/^0+$/.test(agent.agentReportedHash)) value.reportedHash = agent.agentReportedHash;
        try { await set(value); state.finish(value); }
        catch (ex) { state.finish(null); }
    }

    async function info(domain, node, refresh) {
        const value = await policy(node._id, node.firstconnect);
        const data = await catalog.getCatalog(domain, node.agent.id), options = [];
        const artifacts = data.builds.flatMap(build => build.artifacts.filter(artifact => artifact.matches));
        const facts = await requirements(node, artifacts, refresh);
        for (const build of data.builds) {
            if (build.archived) continue;
            for (const artifact of build.artifacts) {
                if ((artifact.id === node.agent.id) && artifact.matches) options.push({ id: build.id, name: build.name, channel: build.channel, filename: artifact.filename, platform: artifact.platform, cpu: artifact.cpu, sha256: artifact.sha256, requirements: artifact.requirements, kvm: artifact.kvm, compatibility: compatibility.check(artifact, facts && facts.data) });
            }
        }
        const result = await status(domain, node, value);
        result.options = options;
        const hash = result.reportedHash || (result.deployment || {}).reportedHash;
        result.installed = { hash: hash, current: !!result.reportedHash, matches: [] };
        if (hash) {
            result.installed.matches = await catalog.identify(domain, node.agent.id, hash, data);
            if (value.mode === 'pin' && value.hash === hash && !result.installed.matches.some(x => x.build === value.build && x.filename === value.filename)) {
                result.installed.matches.push({ name: value.name, filename: value.filename, hash: hash, commit: value.commit, sourceUrl: value.sourceUrl, commitTime: value.commitTime, cached: true });
            }
        }
        if (hash && facts && facts.reportedHash === hash) result.installed.version = facts.data.agentVersion;
        if (facts) result.checkedAt = facts.time;
        return result;
    }

    async function change(domain, user, node, command) {
        if (command.mode === 'pin') return catalog.use(domain, command.build, () => changeCurrent(domain, user, node, command));
        return changeCurrent(domain, user, node, command);
    }

    async function changeCurrent(domain, user, node, command) {
        if (server.multiServer) throw new Error('Per-device build changes are not available on peered servers.');
        if (changing.has(node._id)) throw new Error('The device policy is being changed. Refresh and try again.');
        let release;
        changing.set(node._id, new Promise(resolve => { release = resolve; }));
        generation++;
        try {
            const current = await policy(node._id, node.firstconnect);
            if (command.revision !== current.revision) throw new Error('The device policy changed. Refresh and try again.');
            if (!['default', 'hold', 'pin'].includes(command.mode)) throw new Error('Invalid update policy');
            let value = { mode: command.mode };
            if (command.mode === 'pin') {
                if (!(defaultAgent(domain, node.agent.id) || {}).update) throw new Error('Agent updates are disabled on this server');
                const live = parent.wsagents[node._id];
                if (live && live.agentReportedHash === '0'.repeat(96)) throw new Error('This agent has disabled native updates');
                const inventory = await catalog.getCatalog(domain, node.agent.id);
                const build = inventory.builds.find(x => x.id === command.build && !x.archived);
                const choices = build ? build.artifacts.filter(x => x.matches && ((command.filename == null) || (x.filename === command.filename))) : [];
                if (!build) throw new Error('The build is archived or unavailable');
                if (choices.length === 1) {
                    const facts = await requirements(node, choices, true);
                    const checked = compatibility.check(choices[0], facts && facts.data).status;
                    if (command.requireCompatible === true && checked !== 'compatible') throw new Error('Requirements could not be verified. Refresh before deploying.');
                    if (checked === 'blocked') throw new Error('This file does not meet the device requirements. Refresh to see the required upgrades.');
                }
                value = Object.assign(value, await prepare(domain, command.build, node.agent.id, command.filename, command.sha256));
            }
            const nodes = await get(node._id);
            if ((nodes.length !== 1) || (nodes[0].domain !== domain.id) || !nodes[0].agent || (nodes[0].agent.id !== node.agent.id) || (nodes[0].meshid !== node.meshid) || (nodes[0].firstconnect !== node.firstconnect) || (nodes[0].mtype !== 2) || (nodes[0].agent.caps & 0x60) || ((parent.meshes[node.meshid] || {}).flags & 1)) throw new Error('The device changed. Refresh and try again.');
            const agent = parent.wsagents[node._id];
            if (command.requireOnline === true && !agent) throw new Error('Device went offline before the policy was applied.');
            if (updating(agent)) throw new Error('An agent update is already in progress. Wait for it to reconnect.');
            if (command.mode === 'pin' && agent && agent.agentReportedHash === '0'.repeat(96)) throw new Error('This agent has disabled native updates');
            if ((parent.GetNodeRights(user, node.meshid, node._id) >>> 0) !== 0xFFFFFFFF) throw new Error('Access denied');
            if (agent) agent.agentPolicyChanging = true;
            try {
                Object.assign(value, { _id: 'ab' + node._id, type: 'agentbuildpolicy', domain: domain.id, nodeid: node._id, enrollment: node.firstconnect || 0, mode: command.mode, revision: crypto.randomBytes(16).toString('hex'), time: Date.now(), userid: user._id });
                const target = defaultAgent(domain, node.agent.id);
                if (command.mode !== 'hold') value.deployment = { expectedHash: command.mode === 'pin' ? value.hash : (target && target.hashhex), requestedOnline: !!agent };
                await set(value);
                if (parent.agentBuildUsage) parent.agentBuildUsage.invalidate(domain);
            } catch (ex) {
                if (agent) {
                    delete agent.agentPolicyChanging;
                    if ((agent.authenticated === 2) && agent.agentExeInfo && agent.agentExeInfo.update) agent.sendBinary(Buffer.from([0, 12, 0, 0]));
                }
                throw new Error('Unable to save the update policy');
            }
            const message = (command.mode === 'pin') ? ('Pinned agent build: ' + value.name) : ((command.mode === 'hold') ? 'Held agent binary updates' : 'Restored default agent updates');
            try {
                server.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), null, { etype: 'node', action: 'agentbuildpolicy', nodeid: node._id, domain: domain.id, userid: user._id, username: user.name, msg: message });
            } finally { if (agent) agent.close(); }
            return value;
        } finally { changing.delete(node._id); release(); }
    }

    async function command(domain, user, request, loginToken) {
        if (!user || (user.domain !== domain.id) || loginToken) throw new Error('Access denied');
        if (!['get', 'set', 'status'].includes(request.op)) throw new Error('Invalid operation');
        const node = await new Promise((resolve, reject) => parent.GetNodeWithRights(domain, user, request.nodeid, (node, rights, visible) => {
            if (!node || !visible || ((rights >>> 0) !== 0xFFFFFFFF)) { reject(new Error('Access denied')); return; }
            resolve(node);
        }));
        if ((node.mtype !== 2) || !node.agent || (node.agent.caps & 0x60) || ((parent.meshes[node.meshid] || {}).flags & 1)) throw new Error('A persistent MeshAgent device is required');
        if (request.op === 'status') return Object.assign(await status(domain, node, await policy(node._id, node.firstconnect)), { statusOnly: true });
        if (request.op === 'set') {
            const value = await change(domain, user, node, request);
            try { return Object.assign(await status(domain, node, value), { statusOnly: true, saved: true }); }
            catch (ex) { throw new Error('The policy was saved. Refresh to load its status.'); }
        }
        return await info(domain, node, request.refresh === true);
    }

    return { command: command, resolve: resolve, updateUrl: updateUrl, download: download, receive: receive, observe: observe };
};
