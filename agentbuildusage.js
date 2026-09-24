'use strict';

const storage = require('./agentbuildstorage');

exports.CreateAgentBuildUsage = function (parent, db) {
    const pending = new Map(), caches = new Map();
    function invalidate(domain) {
        const cached = caches.get(domain);
        if (cached && cached.loading) cached.invalidated = true; else caches.delete(domain);
    }
    function observe(agent, disconnected) {
        const node = agent.agentBuildNode;
        if (!node || !agent.dbNodeKey || (agent.agentInfo && (agent.agentInfo.capabilities & 96))) return Promise.resolve();
        const snapshot = { hash: agent.agentReportedHash, at: Date.now(), disconnected: !!disconnected };
        const previous = pending.get(agent.dbNodeKey) || Promise.resolve();
        const task = previous.catch(function () {}).then(async function () {
            if (parent.wsagents[agent.dbNodeKey] && parent.wsagents[agent.dbNodeKey] !== agent) return;
            const id = 'abu' + agent.dbNodeKey, old = await storage.get(db, id);
            const same = old && old.enrollment === node.enrollment && old.agentId === node.agentId;
            const record = Object.assign({}, same ? old : {}, node, { _id: id, type: 'agentbuildusage', nodeid: agent.dbNodeKey });
            if (!snapshot.disconnected && /^[a-f0-9]{96}$/.test(snapshot.hash || '') && !/^0+$/.test(snapshot.hash)) {
                record.hash = snapshot.hash; record.reportedAt = snapshot.at;
            }
            if (snapshot.disconnected) record.disconnectedAt = snapshot.at;
            else record.seenAt = snapshot.at;
            record.updatesDisabled = snapshot.hash === '0'.repeat(96);
            await storage.set(db, record);
            invalidate(node.domain);
        });
        pending.set(agent.dbNodeKey, task);
        return task.finally(() => { if (pending.get(agent.dbNodeKey) === task) pending.delete(agent.dbNodeKey); });
    }
    async function snapshot(domain, fresh) {
        let cached = caches.get(domain.id);
        if (cached && (!fresh || cached.loading) && Date.now() - cached.time < 10000) return cached.promise;
        cached = { time: Date.now(), loading: true };
        cached.promise = (async function () {
            const nodes = new Map(), policies = new Map(), reports = new Map(), deployments = new Map();
            await Promise.all([['node', nodes], ['agentbuildpolicy', policies], ['agentbuildusage', reports], ['agentbuilddeployment', deployments]].map(async ([type, map]) => {
                for await (const row of storage.records(db, type, domain.id)) {
                    if (type === 'node') {
                        if (row.mtype === 2 && row.agent && !(row.agent.caps & 96)) map.set(row._id, { nodeid: row._id, name: row.name, meshid: row.meshid, agentId: row.agent.id, enrollment: row.firstconnect || 0 });
                    } else map.set(row.nodeid, row);
                }
            }));
            const rows = [];
            for (const node of nodes.values()) {
                const policy = policies.get(node.nodeid), report = reports.get(node.nodeid), deployment = deployments.get(node.nodeid);
                const value = policy && policy.enrollment === node.enrollment ? policy : { mode: 'default' };
                const observed = report && report.enrollment === node.enrollment && report.agentId === node.agentId ? report : {};
                let state = value.mode === 'hold' ? 'held' : 'default';
                if (value.deployment) {
                    const confirmed = deployment && deployment.revision === value.revision && deployment.enrollment === node.enrollment && deployment.confirmedAt;
                    state = confirmed ? 'confirmed' : 'pending';
                    if (!confirmed && deployment && deployment.revision === value.revision) state = deployment.state || 'pending';
                    const since = value.deployment.requestedOnline ? value.time : deployment && deployment.firstSeenAt;
                    if (!confirmed && since && Date.now() - since >= 300000) state = 'unconfirmed';
                }
                rows.push(Object.assign(node, { mode: value.mode, build: value.build, filename: value.filename, expectedHash: value.hash || (value.deployment || {}).expectedHash, hash: observed.hash, reportedAt: observed.reportedAt, state }));
            }
            rows.sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.nodeid.localeCompare(b.nodeid));
            return rows;
        })();
        caches.set(domain.id, cached);
        try { return await cached.promise; }
        catch (ex) { caches.delete(domain.id); throw ex; }
        finally { cached.loading = false; if (cached.invalidated) caches.delete(domain.id); }
    }
    function matches(row, query) {
        if (query.agentId != null && row.agentId !== query.agentId) return false;
        if (query.hash && row.hash !== query.hash && row.expectedHash !== query.hash) return false;
        if (query.build && query.relation === 'pinned' && row.build !== query.build) return false;
        if (query.relation === 'installed' && row.hash !== query.hash) return false;
        if (query.relation === 'pinned' && row.mode !== 'pin') return false;
        if (query.filename && query.relation === 'pinned' && row.filename !== query.filename) return false;
        if (query.search && !(row.name || '').toLowerCase().includes(query.search.toLowerCase())) return false;
        return true;
    }
    function counts(rows, query) {
        const result = { installed: 0, pinned: 0, pending: 0, updating: 0, unconfirmed: 0 };
        for (const row of rows) {
            if (query.agentId != null && row.agentId !== query.agentId) continue;
            if (query.hash && row.hash === query.hash) result.installed++;
            if (row.mode === 'pin' && row.build === query.build && (!query.filename || row.filename === query.filename)) result.pinned++;
            if (query.hash && row.expectedHash === query.hash && ['pending', 'updating', 'unconfirmed', 'blocked', 'reconnecting'].includes(row.state)) {
                if (['blocked', 'unconfirmed'].includes(row.state)) result.unconfirmed++;
                else if (['updating', 'reconnecting'].includes(row.state)) result.updating++;
                else result.pending++;
            }
        }
        return result;
    }
    async function page(domain, query) {
        if (query.hash && !/^[a-f0-9]{96}$/.test(query.hash)) throw new Error('Invalid build hash');
        if (query.search && (typeof query.search !== 'string' || query.search.length > 128)) throw new Error('Invalid search');
        const all = await snapshot(domain), rows = all.filter(row => matches(row, query));
        const offset = Number.isSafeInteger(query.offset) && query.offset >= 0 ? query.offset : 0;
        return { counts: counts(all, query), total: rows.length, offset, rows: rows.slice(offset, offset + 50).map(row => Object.assign({}, row, { online: !!parent.wsagents[row.nodeid] })) };
    }
    async function catalogUsage(domain, catalog) {
        const rows = await snapshot(domain);
        for (const file of catalog.defaults) file.usage = counts(rows, { hash: file.agentHash, agentId: file.id });
        for (const build of catalog.builds) for (const file of build.artifacts) file.usage = counts(rows, { hash: file.agentHash, agentId: file.id, build: build.id, filename: file.filename });
        return catalog;
    }
    async function references(domain, build) {
        const rows = await snapshot(domain, true);
        const hashes = new Set(build.artifacts.map(x => x.agentHash));
        return rows.filter(x => x.build === build.id || hashes.has(x.hash) || hashes.has(x.expectedHash)).length;
    }
    return { observe, page, catalogUsage, references, invalidate: domain => invalidate(domain.id) };
};
