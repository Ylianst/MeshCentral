'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./agentbuildstorage');
const inspect = require('./agentbinary').inspect;

exports.CreateAgentBuildUpload = function (parent, catalog) {
    const root = path.join(parent.datapath, 'agentbuilds', 'staging'), busy = new Set(), receiving = new Set();
    let uploads = 0;
    const owner = (domain, user) => crypto.createHash('sha256').update(domain.id + '\0' + user._id).digest('hex');
    function draftPath(domain, user, token) {
        if (!/^[a-f0-9]{32}$/.test(token || '')) throw new Error('Invalid upload review');
        return path.join(root, owner(domain, user), token);
    }
    async function mkdir(directory) {
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid upload directory');
    }
    async function cleanup(directory) {
        let entries;
        try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch (ex) { if (ex.code === 'ENOENT') return []; throw ex; }
        const remaining = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
            const filename = path.join(directory, entry.name), stat = await fs.promises.lstat(filename);
            if (Date.now() - stat.mtimeMs > 1800000 && !busy.has(filename)) {
                try {
                    const info = path.join(filename, 'draft.json');
                    if ((await fs.promises.lstat(info)).size <= 1024 * 1024) {
                        const draft = JSON.parse(await fs.promises.readFile(info, 'utf8'));
                        if (typeof draft.domain === 'string' && typeof draft.userid === 'string' && owner({ id: draft.domain }, { _id: draft.userid }) === path.basename(directory)) {
                            await fs.promises.rm(path.join(catalog.managedRoot({ id: draft.domain }), '.upload-custom-' + entry.name), { recursive: true, force: true });
                        }
                    }
                } catch (ex) { if (ex.code !== 'ENOENT') parent.debug('agentupdate', ex.message); }
                await fs.promises.rm(filename, { recursive: true, force: true });
            }
            else remaining.push(entry.name);
        }
        return remaining;
    }
    async function receive(domain, user, req) {
        storage.admin(domain, user, req.session && req.session.loginToken);
        return stage(domain, user, async function (destination) {
            const files = await new Promise((resolve, reject) => {
                const form = new (require('multiparty').Form)({ uploadDir: destination, maxFilesSize: 128 * 1024 * 1024, maxFields: 16, maxFieldsSize: 16384 });
                form.parse(req, (err, fields, files) => err ? reject(new Error('Upload failed. Use at most 16 files, 64 MiB each and 128 MiB total.')) : resolve(Object.values(files || {}).flat()));
            });
            return { files };
        });
    }
    async function stage(domain, user, produce) {
        storage.admin(domain, user);
        const directory = path.join(root, owner(domain, user));
        if (uploads >= 4 || receiving.has(directory)) throw new Error('Another upload is being processed. Try again shortly.');
        uploads++; receiving.add(directory);
        const token = crypto.randomBytes(16).toString('hex'), destination = draftPath(domain, user, token);
        busy.add(destination);
        try {
            await mkdir(directory);
            if ((await cleanup(directory)).length >= 2) throw new Error('Finish or discard an existing upload before adding another build.');
            await fs.promises.mkdir(destination, { mode: 0o700 });
            const result = await produce(destination), files = result.files;
            if (!files.length || files.length > 16) throw new Error('Select between 1 and 16 agent files.');
            const names = new Set(), artifacts = [];
            let total = 0;
            for (const file of files) {
                const filename = file.originalFilename;
                if (typeof filename !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(filename) || names.has(filename.toLowerCase()) || filename.toLowerCase() === 'manifest.json') throw new Error('Use unique agent filenames containing letters, numbers, dots, underscores or hyphens.');
                names.add(filename.toLowerCase());
                if (path.dirname(file.path) !== destination) throw new Error('Invalid upload path');
                const stat = await fs.promises.lstat(file.path);
                if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || (total += stat.size) > 128 * 1024 * 1024) throw new Error('Each agent file must be at most 64 MiB.');
                const result = inspect(await fs.promises.readFile(file.path), parent.meshAgentsArchitectureNumbers);
                const stored = 'file-' + artifacts.length;
                await fs.promises.rename(file.path, path.join(destination, stored));
                await fs.promises.chmod(path.join(destination, stored), 0o600);
                artifacts.push(Object.assign({ filename, stored, archivePath: file.archivePath, download: file.download }, result));
            }
            const draft = { token, created: Date.now(), domain: domain.id, userid: user._id, artifacts, source: result.source, channel: result.channel, name: result.name, workflows: result.workflows, skipped: result.skipped };
            await fs.promises.writeFile(path.join(destination, 'draft.json'), JSON.stringify(draft), { flag: 'wx', mode: 0o600 });
            return { token, expires: draft.created + 1800000, source: draft.source, name: draft.name, skipped: draft.skipped, artifacts: artifacts.map(({ stored, ...artifact }) => artifact) };
        } catch (ex) {
            await fs.promises.rm(destination, { recursive: true, force: true });
            throw ex;
        } finally { busy.delete(destination); receiving.delete(directory); uploads--; }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        const directory = draftPath(domain, user, request.token);
        if (busy.has(directory)) throw new Error('This upload is already being processed.');
        busy.add(directory);
        try {
            const id = 'custom-' + request.token, base = catalog.managedRoot(domain);
            if (request.op === 'commit') {
                try {
                    const published = JSON.parse(await fs.promises.readFile(path.join(base, id, 'manifest.json'), 'utf8'));
                    if (published.uploadedBy !== user._id) throw new Error('Access denied');
                    return { added: true, build: id };
                } catch (ex) { if (ex.code !== 'ENOENT') throw ex; }
            }
            if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid upload review');
            if (request.op === 'discard') { await fs.promises.rm(directory, { recursive: true }); return { discarded: true }; }
            if (request.op !== 'commit' || request.trusted !== true) throw new Error('Confirm that these are trusted MeshAgent binaries.');
            if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 128) throw new Error('Enter a build name of at most 128 characters.');
            const filename = path.join(directory, 'draft.json'), stat = await fs.promises.lstat(filename);
            if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid upload review');
            const draft = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
            if (draft.domain !== domain.id || draft.userid !== user._id || Date.now() - draft.created > 1800000) throw new Error('The upload review expired. Upload the files again.');
            if (!Array.isArray(request.files) || request.files.length !== draft.artifacts.length) throw new Error('Review every agent file.');
            const artifacts = [], selected = [];
            for (let i = 0; i < draft.artifacts.length; i++) {
                const file = draft.artifacts[i], selection = request.files[i];
                if (selection && selection.include === false) continue;
                selected.push(file);
                if (!selection || !file.candidates.some(x => x.id === selection.agentId) || typeof selection.kvm !== 'boolean') throw new Error('Select the agent type and desktop support for every file.');
                const handle = await fs.promises.open(path.join(directory, file.stored), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
                let actual;
                try {
                    const current = await handle.stat();
                    if (!current.isFile() || current.size > 64 * 1024 * 1024) throw new Error('An uploaded file changed. Upload it again.');
                    actual = inspect(await handle.readFile(), parent.meshAgentsArchitectureNumbers);
                } finally { await handle.close(); }
                if (actual.hashes.sha256 !== file.hashes.sha256) throw new Error('An uploaded file changed. Upload it again.');
                artifacts.push({ filename: file.filename, agentId: selection.agentId, platform: file.platform, cpu: file.cpu, size: file.size, binaryMetadata: file.binaryMetadata, features: { kvm: selection.kvm }, hashes: file.hashes, archivePath: file.archivePath, download: file.download });
            }
            if (!artifacts.length) throw new Error('Select at least one agent file.');
            const pending = path.join(base, '.upload-' + id);
            await fs.promises.rm(pending, { recursive: true, force: true });
            await mkdir(base); await fs.promises.mkdir(pending, { mode: 0o700 });
            try {
                for (const file of selected) await fs.promises.copyFile(path.join(directory, file.stored), path.join(pending, file.filename), fs.constants.COPYFILE_EXCL);
                const manifest = { schemaVersion: 1, id, name: request.name.trim(), channel: draft.channel || 'custom', source: draft.source || { kind: 'upload' }, workflows: draft.workflows, uploadedAt: new Date().toISOString(), uploadedBy: user._id, artifacts };
                await fs.promises.writeFile(path.join(pending, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
                await fs.promises.rename(pending, path.join(base, id));
            } catch (ex) { await fs.promises.rm(pending, { recursive: true, force: true }); throw ex; }
            await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
            try { parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Added agent build: ' + request.name.trim() }); } catch (ex) { parent.debug('agentupdate', ex.message); }
            return { added: true, build: id };
        } finally { busy.delete(directory); }
    }
    async function expire() {
        const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) await cleanup(path.join(root, entry.name));
    }
    const expiry = setInterval(() => expire().catch(ex => parent.debug('agentupdate', ex.message)), 600000);
    expiry.unref();
    return { receive, command, stage };
};
