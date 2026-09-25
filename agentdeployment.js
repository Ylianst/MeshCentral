'use strict';

const crypto = require('crypto');
const storage = require('./agentbuildstorage');

exports.CreateAgentDeployment = function (parent, db, catalog, builds) {
    const jobs = new Map(), loading = new Map(), previews = new Set(), server = parent.parent;
    function audit(job, user, message) {
        server.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildjob', domain: job.domain, userid: user._id, username: user.name, job: job.id, msg: message });
    }
    function summary(job, user) {
        const counts = job.targets ? {} : Object.assign({}, job.counts);
        for (const target of job.targets ? job.targets.values() : []) counts[target.state] = (counts[target.state] || 0) + 1;
        if (job.targets && ['cancelling', 'cancelled'].includes(job.stage)) counts.cancelled = (counts.cancelled || 0) + job.nodeids.length - job.targets.size;
        return { id: job.id, name: job.name, mode: job.mode, stage: job.stage, created: job.created, updated: job.updated, total: job.nodeids ? job.nodeids.length : job.total, counts, batchSize: job.batchSize, error: job.error, allowUnknown: job.allowUnknown, owner: !user || (job.userid === user._id) };
    }
    function trimJobs() {
        for (const [id, job] of jobs) {
            if (jobs.size <= 20) return;
            if (!job.working && !job.timer && ['complete', 'cancelled'].includes(job.stage)) jobs.delete(id);
        }
    }
    async function save(job) {
        if (job.deleted) return;
        job.updated = Date.now();
        const { targets, working, timer, saving, ...record } = job;
        record.total = job.nodeids.length;
        if (job.targets.size === record.total) delete record.nodeids;
        const value = JSON.parse(JSON.stringify(Object.assign(record, { counts: summary(job).counts })));
        job.saving = (saving || Promise.resolve()).catch(() => {}).then(() => storage.set(db, value));
        await job.saving;
    }
    const targetKey = (job, index) => 'abt' + job.id + ':' + String(index).padStart(5, '0');
    async function saveTarget(job, target) {
        await storage.set(db, target);
        job.targets.set(target.index, target);
    }
    async function load(domain, id) {
        if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('Invalid deployment');
        if (jobs.has(id)) { const job = jobs.get(id); if (job.domain !== domain.id) throw new Error('Access denied'); return job; }
        if (loading.has(id)) { await loading.get(id); return load(domain, id); }
        const task = loadRecord(domain, id);
        loading.set(id, task);
        try { return await task; } finally { loading.delete(id); }
    }
    async function loadRecord(domain, id) {
        const record = await storage.get(db, 'abj' + id);
        if (!record || record.domain !== domain.id) throw new Error('Deployment is unavailable');
        const job = Object.assign(record, { targets: new Map() });
        for await (const target of storage.records(db, 'agentbuildtarget', domain.id, 'abt' + id + ':')) job.targets.set(target.index, target);
        if (!job.nodeids) {
            if (!Number.isInteger(job.total) || job.total < 1 || job.total > 10000) throw new Error('Invalid deployment size');
            job.nodeids = Array(job.total).fill(null);
            for (const target of job.targets.values()) if (target.index >= 0 && target.index < job.total) job.nodeids[target.index] = target.nodeid;
            if (job.nodeids.some(x => typeof x !== 'string')) throw new Error('Deployment records are incomplete');
        }
        if (['preparing', 'running', 'cancelling'].includes(job.stage)) {
            job.stage = 'paused'; job.error = 'Server restarted. Review the results before resuming.';
            for (const target of job.targets.values()) {
                if (target.state === 'starting') { target.state = 'failed'; target.error = 'The server restarted while saving this policy. Check the device before retrying.'; await saveTarget(job, target); }
            }
            await save(job);
        }
        jobs.set(id, job);
        schedule(job);
        return job;
    }
    function identity(job) {
        const domain = server.config.domains[job.domain], user = parent.users[job.userid];
        if (!domain || !user) throw new Error('The deployment owner or domain is no longer available.');
        storage.admin(domain, user);
        return { domain, user };
    }
    async function check(job, nodeid, fresh) {
        const { domain, user } = identity(job);
        const info = await builds.command(domain, user, { op: 'get', nodeid, refresh: fresh });
        try {
        if (!info.canChange) throw new Error('The device already has an update in progress.');
        if (job.mode !== 'hold' && info.status === 'offline') throw new Error('Device offline. It has not been scheduled.');
        if (job.mode !== 'hold' && (!info.serverUpdates || info.status === 'disabled')) throw new Error('Agent updates are disabled for this device.');
        if (job.mode === 'default' && info.defaultAvailable === false) throw new Error('The server default agent file is unavailable.');
        const file = job.files.find(x => x.agentId === info.agentId);
        if (job.mode === 'pin') {
            const option = info.options.find(x => x.id === job.build && file && x.filename === file.filename && x.sha256 === file.sha256);
            if (!option) throw new Error('No selected file matches this agent type, or the build changed.');
            const status = (option.compatibility || {}).status;
            if (status === 'blocked') throw new Error('Device requirements are not met.');
            if (status !== 'compatible' && !job.allowUnknown) throw new Error('Requirements could not be verified.');
        }
        return { info, file };
        } catch (ex) { ex.deviceName = info.name; throw ex; }
    }
    async function prepare(job) {
        if (job.working) return;
        job.working = true;
        try {
            let next = 0;
            async function worker() {
                while (job.stage === 'preparing' && next < job.nodeids.length) {
                    const index = next++;
                    if (job.targets.has(index)) continue;
                    const target = { _id: targetKey(job, index), type: 'agentbuildtarget', domain: job.domain, job: job.id, index, nodeid: job.nodeids[index], state: 'ready' };
                    try {
                        const { info } = await check(job, target.nodeid, false);
                        Object.assign(target, { name: info.name, enrollment: info.enrollment, agentId: info.agentId, revision: info.policy.revision });
                    } catch (ex) { target.state = 'skipped'; target.error = ex.message; target.name = ex.deviceName; }
                    if (['cancelling', 'cancelled'].includes(job.stage)) target.state = 'cancelled';
                    await saveTarget(job, target);
                    if (index % 20 === 0) await save(job);
                }
            }
            await Promise.all(Array.from({ length: 4 }, worker));
            if (job.stage === 'preparing') job.stage = 'ready';
            await save(job);
        } catch (ex) { if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = ex.message; await save(job); }
        finally { job.working = false; schedule(job); }
    }
    function schedule(job) {
        if (job.timer) clearTimeout(job.timer);
        if (['complete', 'cancelled', 'ready', 'preparing'].includes(job.stage)) { trimJobs(); return; }
        if (job.stage === 'paused' && !Array.from(job.targets.values()).some(x => x.state === 'waiting')) return;
        job.timer = setTimeout(() => { job.timer = null; tick(job).catch(ex => server.debug('agentupdate', ex.message)); }, 2000);
        if (job.timer.unref) job.timer.unref();
    }
    async function tick(job) {
        if (job.working) { schedule(job); return; }
        job.working = true;
        try {
            let actor;
            try { actor = identity(job); } catch (ex) {
                for (const target of job.targets.values()) {
                    if (['waiting', 'starting'].includes(target.state)) { target.state = 'failed'; target.error = ex.message; await saveTarget(job, target); }
                    else if (job.stage === 'cancelling' && target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); }
                }
                job.stage = job.stage === 'cancelling' ? 'cancelled' : 'paused'; job.error = ex.message; await save(job); return;
            }
            const { domain, user } = actor;
            const active = Array.from(job.targets.values()).filter(x => x.state === 'waiting');
            for (const target of active) {
                try {
                    const value = await builds.command(domain, user, { op: 'status', nodeid: target.nodeid });
                    if (value.enrollment !== target.enrollment || value.policy.revision !== target.appliedRevision) throw new Error('The device or its policy changed outside this deployment.');
                    const progress = value.deployment || {};
                    if (progress.state === 'confirmed' || (job.mode === 'hold' && value.policy.mode === 'hold')) { target.state = 'confirmed'; target.confirmedAt = Date.now(); }
                    else if (['blocked', 'unconfirmed'].includes(progress.state) || Date.now() - target.startedAt >= 300000) throw new Error('Installation could not be confirmed. Check this device before resuming.');
                    else { target.progress = progress.state || 'pending'; }
                } catch (ex) {
                    target.state = 'failed'; target.error = ex.message;
                    if (job.stage === 'running') { job.stage = 'paused'; job.error = 'A device failed verification. Review the results before resuming.'; }
                }
                await saveTarget(job, target);
            }
            if (!Array.from(job.targets.values()).some(x => ['waiting', 'starting'].includes(x.state))) {
                if (job.stage === 'cancelling') {
                    for (const target of job.targets.values()) if (target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); }
                    job.stage = 'cancelled';
                }
                else if (job.stage === 'running') {
                    const batch = Array.from(job.targets.values()).filter(x => x.state === 'ready').slice(0, job.batchSize);
                    if (!batch.length) job.stage = 'complete';
                    for (const target of batch) {
                        if (job.stage !== 'running') break;
                        try {
                            const { info, file } = await check(job, target.nodeid, true);
                            if (job.stage !== 'running') break;
                            if (info.enrollment !== target.enrollment || info.agentId !== target.agentId || info.policy.revision !== target.revision) throw new Error('The device or its policy changed after the preview.');
                            target.state = 'starting'; target.startedAt = Date.now();
                            await saveTarget(job, target);
                            if (job.stage !== 'running') {
                                target.state = job.stage === 'cancelling' ? 'cancelled' : 'ready';
                                await saveTarget(job, target); break;
                            }
                            const request = { op: 'set', nodeid: target.nodeid, mode: job.mode, revision: target.revision, requireOnline: job.mode !== 'hold', requireCompatible: !job.allowUnknown };
                            if (file) Object.assign(request, { build: job.build, filename: file.filename, sha256: file.sha256 });
                            const actor = identity(job);
                            const result = await builds.command(actor.domain, actor.user, request);
                            target.appliedRevision = result.policy.revision;
                            target.state = job.mode === 'hold' ? 'confirmed' : 'waiting';
                        } catch (ex) {
                            target.state = 'failed'; target.error = ex.message;
                            if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = 'A device could not be scheduled. Review the results before resuming.';
                        }
                        await saveTarget(job, target);
                    }
                }
            }
            await save(job);
        } catch (ex) { if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = ex.message; await save(job); }
        finally { job.working = false; schedule(job); }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        if (server.multiServer) throw new Error('Bulk agent deployments are not available on peered servers.');
        if (request.op === 'preview') {
            if (previews.has(user._id)) throw new Error('A deployment preview is already being created.');
            previews.add(user._id);
            try {
            let activeJobs = 0;
            for await (const row of storage.records(db, 'agentbuildjob', domain.id)) if (row.userid === user._id && !['complete', 'cancelled'].includes(row.stage)) activeJobs++;
            if (activeJobs >= 10) throw new Error('Complete or cancel an existing deployment before creating another.');
            if (!['pin', 'hold', 'default'].includes(request.mode) || !Array.isArray(request.nodeids) || !request.nodeids.length || request.nodeids.length > 10000 || request.nodeids.some(x => typeof x !== 'string' || !x.startsWith('node/' + domain.id + '/') || x.length > 200)) throw new Error('Select between 1 and 10000 devices in this domain.');
            if (!Number.isInteger(request.batchSize) || request.batchSize < 1 || request.batchSize > 20) throw new Error('Use a batch size between 1 and 20.');
            const all = await catalog.getCatalog(domain);
            const build = request.mode === 'pin' ? all.builds.find(x => x.id === request.build && !x.archived) : null;
            let files = [];
            if (request.mode === 'pin') {
                if (!build || !Array.isArray(request.files) || !request.files.length || request.files.length > 100) throw new Error('Select the files to deploy.');
                const ids = new Set();
                files = request.files.map(file => {
                    const artifact = build.artifacts.find(x => x.id === file.agentId && x.filename === file.filename && x.sha256 === file.sha256 && x.matches);
                    if (!artifact || ids.has(file.agentId)) throw new Error('Select one verified file per agent type.');
                    ids.add(file.agentId);
                    return { agentId: file.agentId, filename: file.filename, sha256: file.sha256 };
                });
            }
            const id = crypto.randomBytes(16).toString('hex'), job = { _id: 'abj' + id, type: 'agentbuildjob', id, domain: domain.id, userid: user._id, created: Date.now(), stage: 'preparing', name: build ? build.name : '', build: build && build.id, files, mode: request.mode, nodeids: Array.from(new Set(request.nodeids)), batchSize: request.batchSize, allowUnknown: request.allowUnknown === true, targets: new Map() };
            await save(job); jobs.set(id, job);
            prepare(job).catch(ex => server.debug('agentupdate', ex.message));
            return summary(job, user);
            } finally { previews.delete(user._id); }
        }
        if (request.op === 'list') {
            const records = [];
            for await (const row of storage.records(db, 'agentbuildjob', domain.id)) records.push(row);
            records.sort((a, b) => b.created - a.created);
            const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
            const page = [];
            for (const row of records.slice(offset, offset + 20)) page.push(summary(jobs.get(row.id) || (['preparing', 'running', 'cancelling'].includes(row.stage) ? await load(domain, row.id) : row), user));
            trimJobs();
            return { total: records.length, offset, jobs: page };
        }
        const job = await load(domain, request.id);
        if (request.op === 'get') {
            const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
            const filters = { attention: ['failed', 'skipped'], active: ['starting', 'waiting'], done: ['confirmed'], ready: ['ready'] };
            const states = request.state ? filters[request.state] : null;
            if (request.state && !states) throw new Error('Invalid target filter');
            let targets = Array.from(job.targets.values()).sort((a, b) => a.index - b.index);
            if (states) targets = targets.filter(x => states.includes(x.state));
            return Object.assign(summary(job, user), { offset, state: request.state || '', filtered: targets.length, targets: targets.slice(offset, offset + 50).map(({ _id, type, domain, ...target }) => target) });
        }
        if (job.userid !== user._id && request.op !== 'pause' && request.op !== 'cancel') throw new Error('Only the deployment owner can start or resume it.');
        if (request.op === 'remove') {
            // A deployment that never ran, or one that has finished, is history the owner can drop. A
            // schedulable one stays: removing it would forget applied policies without reverting them.
            if (!['ready', 'complete', 'cancelled'].includes(job.stage)) throw new Error('Cancel this deployment before removing it.');
            if (job.working || job.timer) throw new Error('Wait for the current checks to finish.');
            audit(job, user, 'Agent deployment remove: ' + (job.name || job.mode));
            job.deleted = true;
            await (job.saving || Promise.resolve()).catch(() => {});
            jobs.delete(job.id);
            for await (const target of storage.records(db, 'agentbuildtarget', domain.id, 'abt' + job.id + ':')) await storage.remove(db, target._id);
            await storage.remove(db, 'abj' + job.id);
            return { removed: job.id };
        }
        if (request.op === 'pause' && ['preparing', 'running'].includes(job.stage)) { job.stage = 'paused'; }
        else if (request.op === 'cancel' && !['complete', 'cancelled'].includes(job.stage)) {
            job.stage = 'cancelling';
            for (const target of job.targets.values()) { if (target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); } }
        } else if (['start', 'resume'].includes(request.op) && ['ready', 'paused'].includes(job.stage)) {
            if (request.confirm !== true) throw new Error('Confirm local recovery and the interruption of active sessions.');
            if (job.working) throw new Error('Wait for the current checks to finish.');
            delete job.error;
            if (job.targets.size !== job.nodeids.length) { job.stage = 'preparing'; await save(job); prepare(job).catch(ex => server.debug('agentupdate', ex.message)); return summary(job, user); }
            job.stage = 'running';
        } else throw new Error('The deployment state changed. Refresh its status.');
        await save(job); audit(job, user, 'Agent deployment ' + request.op + ': ' + (job.name || job.mode)); schedule(job);
        return summary(job, user);
    }
    async function references(domain, build) {
        for await (const job of storage.records(db, 'agentbuildjob', domain.id)) if (job.build === build && !['complete', 'cancelled'].includes(job.stage)) return true;
        return false;
    }
    return { command, references };
};
