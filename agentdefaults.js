'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

exports.CreateAgentDefaults = function (parent, options = {}) {
    const root = path.join(parent.datapath, 'agentbuilds');
    const bundled = options.directory || path.join(__dirname, 'agents');
    const client = options.client || require('./agentbuildfetch').createClient();
    const settings = (parent.config.settings || {}).agentdownloads || {};
    const names = new Set(Object.values(parent.meshAgentsArchitectureNumbers).map(x => x.localname));
    for (const name of ['MeshCentralRouter.exe', 'MeshCentralRouter.dmg', 'MeshCentralAssistant.exe']) names.add(name);
    const selected = new Map(), entries = new Map();
    let busy = null, errors = [], loaded = false, started = false, restartRequired = false, updates = null;

    function regular(filename) {
        try { return fs.lstatSync(filename).isFile(); } catch (ex) { return false; }
    }
    function sourcePath(name) {
        if (!names.has(name)) return null;
        if (selected.has(name)) return selected.get(name);
        if (entries.has(name)) return null;
        const local = path.join(root, name);
        if (regular(local)) return local;
        const original = path.join(bundled, name);
        return regular(original) ? original : null;
    }
    function validate(manifest) {
        if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.releases) || manifest.releases.length > 32) throw new Error('Invalid default agent release manifest.');
        const files = new Map();
        for (const release of manifest.releases) {
            if (!release || typeof release.repository !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(release.repository) ||
                typeof release.tag !== 'string' || !release.tag || release.tag.length > 128 || /[\x00-\x20\x7f]/.test(release.tag) ||
                !Array.isArray(release.files) || !release.files.length) throw new Error('Specify a repository, release tag and files for each default release.');
            const base = 'https://github.com/' + release.repository + '/releases/';
            for (const file of release.files) {
                if (!file || !names.has(file.filename) || files.has(file.filename) ||
                    typeof file.asset !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(file.asset) ||
                    !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024 ||
                    typeof file.sha384 !== 'string' || !/^[a-f0-9]{96}$/.test(file.sha384)) throw new Error('Invalid or duplicate default release file.');
                files.set(file.filename, {
                    filename: file.filename, asset: file.asset, size: file.size, sha384: file.sha384,
                    repository: release.repository, tag: release.tag, sourceUrl: base + 'tag/' + encodeURIComponent(release.tag),
                    url: base + 'download/' + encodeURIComponent(release.tag) + '/' + encodeURIComponent(file.asset), status: 'Not checked'
                });
            }
        }
        return files;
    }
    async function load() {
        const filename = settings.manifest ? path.resolve(parent.datapath, settings.manifest) : path.join(bundled, 'agent-defaults.json');
        const stat = await fs.promises.lstat(filename);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid default agent release manifest.');
        const files = validate(JSON.parse(await fs.promises.readFile(filename, 'utf8')));
        entries.clear();
        for (const [name, file] of files) entries.set(name, file);
        loaded = true;
        updates = require('./agentreleaseupdates').CreateAgentReleaseUpdates(settings, client, entries.values());
    }
    async function verified(filename, file) {
        let handle;
        try {
            const entry = await fs.promises.lstat(filename);
            if (!entry.isFile() || entry.size !== file.size) return false;
            handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size !== file.size) return false;
            const hash = crypto.createHash('sha384');
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            const after = await handle.stat();
            return hash.digest('hex') === file.sha384 && stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs;
        } catch (ex) { if (ex.code === 'ENOENT' || ex.code === 'ELOOP') return false; throw ex; }
        finally { if (handle) await handle.close(); }
    }
    async function directory(filename) {
        await fs.promises.mkdir(filename, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(filename)).isDirectory()) throw new Error('Invalid default agent cache directory.');
    }
    async function resolve(file, signal, localFiles) {
        const cache = path.join(root, 'defaults', file.sha384), target = path.join(cache, file.filename);
        if (await verified(target, file)) { file.status = 'Ready'; return target; }
        let local;
        for (const filename of [path.join(root, file.filename), path.join(bundled, file.filename)]) {
            if (await verified(filename, file)) { local = filename; break; }
        }
        const imported = localFiles && localFiles.find(x => x.sha384 === file.sha384 && x.size === file.size);
        if (!local && imported && await verified(imported.path, file)) local = imported.path;
        await directory(root); await directory(path.join(root, 'defaults')); await directory(cache);
        const temp = path.join(cache, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
        try {
            if (local) {
                await fs.promises.copyFile(local, temp, fs.constants.COPYFILE_EXCL);
            } else {
                if (settings.enabled === false) throw new Error('Automatic downloads are disabled. Supply this release file locally.');
                file.status = 'Downloading'; file.received = 0;
                try {
                    await client.download(file.url, temp, { limit: file.size, signal, progress: received => { file.received = received; } });
                } catch (ex) {
                    if (ex.statusCode === 404) throw new Error('Release asset not found. Publish the configured release and asset before downloading it.');
                    if (ex.statusCode === 401 || ex.statusCode === 403) throw new Error('GitHub denied the public release download. Check that the release is public or retry later.');
                    throw ex;
                }
            }
            if (!await verified(temp, file)) throw new Error('The release file does not match its expected size and SHA384.');
            await fs.promises.chmod(temp, 0o600);
            await fs.promises.rename(temp, target);
            file.status = 'Ready';
            return target;
        } finally { await fs.promises.unlink(temp).catch(() => {}); }
    }
    function status() {
        return {
            busy: !!busy, enabled: settings.enabled !== false, restartRequired, errors: errors.slice(),
            updates: updates ? updates.status() : null,
            files: Array.from(entries.values(), ({ url, ...file }) => ({ ...file }))
        };
    }
    function prepare(localFiles) {
        if (busy) return busy;
        const initial = !started;
        busy = (async function () {
            errors = [];
            try { if (!loaded) await load(); }
            catch (ex) { errors.push('Unable to read default agent releases: ' + ex.message); return; }
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
            try {
                const pending = Array.from(entries.values());
                await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async function () {
                    while (pending.length) {
                        const file = pending.shift();
                        delete file.error; delete file.received;
                        try {
                            const filename = await resolve(file, controller.signal, localFiles);
                            if (initial) selected.set(file.filename, filename);
                            else if (sourcePath(file.filename) !== filename) restartRequired = true;
                        } catch (ex) {
                            file.status = 'Unavailable'; file.error = ex.message;
                            errors.push(file.filename + ': ' + ex.message);
                        }
                    }
                }));
            } finally { clearTimeout(timer); }
        })().finally(() => { started = true; busy = null; });
        return busy;
    }
    function info(name) {
        const file = entries.get(name);
        if (!file || !selected.has(name)) return null;
        return { repository: file.repository, tag: file.tag, sourceUrl: file.sourceUrl, sha384: file.sha384 };
    }
    return { prepare, status, sourcePath, info, start: () => { if (updates) updates.start(); }, checkUpdates: () => updates ? updates.check(true) : Promise.resolve() };
};
