'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports.CreateAgentCatalog = function (parent, directory) {
    const root = path.resolve(directory || path.join(__dirname, 'agents'));
    const hashes = new Map();
    const updateHashes = new Map(), readers = new Map(), writers = new Set();
    const storage = require('./agentbuildstorage');
    const managedRoot = domain => path.join(parent.datapath, 'agentbuilds', 'catalog', storage.domainKey(domain));
    const filenamePattern = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

    function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':'); }

    async function inspect(filename) {
        try {
            const stat = await fs.promises.lstat(filename);
            if (!stat.isFile()) return { status: 'Not a regular file' };
            const key = signature(stat);
            const cached = hashes.get(filename);
            if (cached && cached.key == key) return await cached.result;
            const result = new Promise((resolve, reject) => {
                const sha256 = crypto.createHash('sha256'), sha384 = crypto.createHash('sha384');
                const input = fs.createReadStream(filename);
                input.on('data', data => { sha256.update(data); sha384.update(data); });
                input.on('error', reject);
                input.on('end', async () => {
                    try {
                        if (signature(await fs.promises.lstat(filename)) != key) { resolve({ status: 'File changed while reading' }); return; }
                        resolve({ status: 'Available', available: true, size: stat.size, sha256: sha256.digest('hex'), sha384: sha384.digest('hex') });
                    } catch (ex) { reject(ex); }
                });
            });
            hashes.set(filename, { key: key, result: result });
            return await result;
        } catch (ex) {
            hashes.delete(filename);
            return { status: (ex.code == 'ENOENT') ? 'Missing file' : 'Unable to read file' };
        }
    }

    function githubUrl(value) {
        try {
            const url = new URL(value);
            if ((url.protocol == 'https:') && (url.hostname == 'github.com') && !url.username && !url.password && !url.port) return url.href;
        } catch (ex) { }
        return null;
    }

    function importSource(source) {
        if (!['url', 'github-actions', 'github-release'].includes(source.kind)) return null;
        function url(value) {
            try { return require('./agentbuildfetch').sourceUrl(value); } catch (ex) { return null; }
        }
        const result = { kind: source.kind, url: url(source.url), repository: source.repository, tag: source.tag, branch: source.branch, event: source.event, headRepository: source.headRepository, runId: source.runId, runAttempt: source.runAttempt, downloads: [] };
        for (const item of Array.isArray(source.downloads) ? source.downloads.slice(0, 16) : []) {
            if (item && /^[a-f0-9]{64}$/.test(item.sha256)) result.downloads.push({ name: item.name, url: url(item.url), sha256: item.sha256, digestVerified: item.digestVerified === true });
        }
        return result;
    }

    function compatibility(artifact) {
        const metadata = artifact.binaryMetadata || {}, requirements = [];
        if (typeof metadata.glibcRequired == 'string') requirements.push('glibc ' + metadata.glibcRequired + '+');
        if (metadata.libc == 'musl') requirements.push('musl');
        if (typeof metadata.minimumMacos == 'string') requirements.push('macOS ' + metadata.minimumMacos + '+');
        if (Number.isInteger(metadata.freebsdAbi)) requirements.push('FreeBSD ABI ' + metadata.freebsdAbi);
        if (metadata.armAttributes) {
            if (typeof metadata.armAttributes.fpArch == 'string') requirements.push(metadata.armAttributes.fpArch);
            if (typeof metadata.armAttributes.advancedSimdArch == 'string') requirements.push(metadata.armAttributes.advancedSimdArch);
        }
        return requirements.join(', ');
    }

    function validate(manifest) {
        if (!manifest || (manifest.schemaVersion !== 1) || (typeof manifest.id != 'string') || !filenamePattern.test(manifest.id) || (typeof manifest.name != 'string') ||
            !['stable', 'testing', 'nightly', 'pull-request', 'custom'].includes(manifest.channel) || !Array.isArray(manifest.artifacts) ||
            (manifest.artifacts.length == 0) || (manifest.artifacts.length > 1000)) return false;
        const filenames = new Set();
        for (const artifact of manifest.artifacts) {
            if (!artifact || (typeof artifact.filename != 'string') || !filenamePattern.test(artifact.filename) ||
                !Number.isInteger(artifact.agentId) || (artifact.agentId <= 0) || (artifact.agentId >= 10000) ||
                !Number.isSafeInteger(artifact.size) || (artifact.size <= 0) || !artifact.hashes ||
                !artifact.features || (typeof artifact.features.kvm != 'boolean') ||
                !/^[a-f0-9]{64}$/.test(artifact.hashes.sha256) || !/^[a-f0-9]{96}$/.test(artifact.hashes.sha384) ||
                !/^[a-f0-9]{96}$/.test(artifact.hashes.agentSha384) ||
                (typeof artifact.platform != 'string') || (typeof artifact.cpu != 'string') ||
                filenames.has(artifact.filename)) return false;
            filenames.add(artifact.filename);
        }
        return true;
    }

    async function buildDirectories(domain) {
        const result = [];
        for (const base of [root, managedRoot(domain)]) {
            try {
                const stat = await fs.promises.lstat(base);
                if (!stat.isDirectory()) throw new Error('Invalid agent build directory');
                for (const entry of await fs.promises.readdir(base, { withFileTypes: true })) {
                    if (entry.isDirectory() && filenamePattern.test(entry.name)) result.push({ name: entry.name, path: path.join(base, entry.name), managed: base !== root });
                }
            } catch (ex) { if (ex.code !== 'ENOENT') throw ex; }
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    async function archived(domain, id) {
        try {
            const filename = path.join(managedRoot(domain), '.state', id + '.json');
            const stat = await fs.promises.lstat(filename);
            if (!stat.isFile() || stat.size > 1024) throw new Error('Invalid build state');
            return JSON.parse(await fs.promises.readFile(filename, 'utf8')).archived === true;
        } catch (ex) { if (ex.code === 'ENOENT') return false; throw ex; }
    }

    async function use(domain, id, callback, exclusive) {
        if (typeof id !== 'string' || !filenamePattern.test(id)) throw new Error('Invalid build');
        const key = storage.domainKey(domain) + '/' + id;
        if (writers.has(key) || (exclusive && readers.get(key))) throw new Error('This build is in use. Try again when the operation finishes.');
        if (exclusive) writers.add(key); else readers.set(key, (readers.get(key) || 0) + 1);
        try { return await callback(); }
        finally { if (exclusive) writers.delete(key); else if (readers.get(key) === 1) readers.delete(key); else readers.set(key, readers.get(key) - 1); }
    }

    async function manage(domain, id, operation) {
        const build = (await getCatalog(domain)).builds.find(x => x.id === id);
        if (!build) throw new Error('Build is unavailable');
        if (operation === 'remove') {
            if (!build.managed) throw new Error('Bundled catalog entries can be archived but cannot be removed.');
            const entries = await buildDirectories(domain);
            const entry = entries.find(x => x.managed && x.name === id);
            if (!entry) throw new Error('Build is unavailable');
            await fs.promises.rm(entry.path, { recursive: true });
        } else {
            const directory = path.join(managedRoot(domain), '.state');
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
            if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid build state directory');
            const temp = path.join(directory, crypto.randomBytes(16).toString('hex') + '.tmp');
            await fs.promises.writeFile(temp, JSON.stringify({ archived: operation === 'archive' }), { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(temp, path.join(directory, id + '.json'));
        }
    }

    async function getCatalog(domain, agentId) {
        const defaults = [], bundled = [], builds = [], errors = [];
        const architectures = parent.meshAgentsArchitectureNumbers;
        const active = Object.assign({}, parent.meshAgentBinaries, domain.meshAgentBinaries);
        for (const id of Object.keys(active).sort((a, b) => a - b)) {
            if (agentId != null) continue;
            if (Number(id) >= 10000) continue;
            const agent = active[id];
            let source = 'Server override';
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[id]) { source = 'Domain override'; }
            else if (path.resolve(agent.path) == path.join(root, agent.localname)) { source = 'Bundled'; }
            else if (path.dirname(path.resolve(agent.path)) == path.resolve(parent.datapath, 'signedagents')) { source = 'Server signed'; }
            else if (agent.release) { source = 'Release'; }
            else if (path.dirname(path.resolve(agent.path)) == path.resolve(parent.datapath, 'agentbuilds')) { source = 'Local file'; }
            defaults.push({ id: Number(id), name: agent.desc, filename: agent.localname, source: source, size: agent.size, agentHash: agent.hashhex, release: agent.release });
        }
        for (const id of Object.keys(architectures).sort((a, b) => a - b)) {
            if (agentId != null) continue;
            if (Number(id) >= 10000) continue;
            const agent = architectures[id];
            if (!filenamePattern.test(agent.localname)) continue;
            const file = await inspect(path.join(root, agent.localname));
            if (file.status == 'Missing file') continue;
            bundled.push(Object.assign({ id: Number(id), name: agent.desc, filename: agent.localname }, file));
        }
        let directories;
        try { directories = await buildDirectories(domain); }
        catch (ex) { return { defaults: defaults, bundled: bundled, builds: builds, errors: ['Unable to read agent directory'] }; }
        const buildIds = new Set();
        for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
            const manifestPath = path.join(entry.path, 'manifest.json');
            let manifest;
            try {
                const stat = await fs.promises.lstat(manifestPath);
                if (!stat.isFile() || (stat.size > 1024 * 1024)) throw new Error('Invalid manifest');
                manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                if (!validate(manifest) || buildIds.has(manifest.id)) throw new Error('Invalid manifest');
            } catch (ex) {
                if (ex.code != 'ENOENT') errors.push(entry.name + ': invalid or unreadable manifest');
                continue;
            }
            buildIds.add(manifest.id);
            const source = manifest.source || {};
            const build = {
                id: manifest.id, name: manifest.name, channel: manifest.channel, managed: entry.managed, archived: await archived(domain, manifest.id), uploadedAt: manifest.uploadedAt,
                commit: typeof source.commit == 'string' ? source.commit : null, sourceUrl: githubUrl(source.commitUrl),
                commitTime: typeof source.commitTime == 'string' ? source.commitTime : null,
                provenance: importSource(source), workflows: [], artifacts: []
            };
            if (Array.isArray(manifest.workflows)) {
                for (const workflow of manifest.workflows) {
                    if (workflow && Number.isSafeInteger(workflow.runId) && githubUrl(workflow.url)) {
                        build.workflows.push({ id: workflow.runId, name: (typeof workflow.path == 'string') ? path.basename(workflow.path).replace(/\.ya?ml$/, '') : String(workflow.runId), url: githubUrl(workflow.url) });
                    }
                }
            }
            for (const artifact of manifest.artifacts) {
                if ((agentId != null) && (artifact.agentId !== agentId)) continue;
                const file = await inspect(path.join(entry.path, artifact.filename));
                const matches = file.available && (file.size == artifact.size) && (file.sha256 == artifact.hashes.sha256) && (file.sha384 == artifact.hashes.sha384);
                const row = Object.assign({
                    id: artifact.agentId, filename: artifact.filename, platform: artifact.platform, cpu: artifact.cpu,
                    agentHash: artifact.hashes.agentSha384,
                    kvm: artifact.features && (artifact.features.kvm === true), requirements: compatibility(artifact), metadata: artifact.binaryMetadata || {},
                    signature: (artifact.binaryMetadata || {}).embeddedAuthenticode || (artifact.binaryMetadata || {}).embeddedSignature
                }, file);
                row.matches = matches === true;
                row.status = file.available ? (matches ? 'Matches manifest' : 'Manifest mismatch') : file.status;
                build.artifacts.push(row);
            }
            if (build.artifacts.length) builds.push(build);
        }
        return { defaults: defaults, bundled: bundled, builds: builds, errors: errors, downloads: parent.agentDefaults ? parent.agentDefaults.status() : null };
    }

    async function getArtifact(buildId, agentId, selectedFile, domain = {}) {
        const catalog = await getCatalog(domain, agentId);
        const build = catalog.builds.find(x => x.id === buildId);
        if (!build) throw new Error('Build is unavailable or its files have changed');
        const candidates = build.artifacts.filter(x => x.id === agentId);
        if ((selectedFile == null) && (candidates.length !== 1)) throw new Error('Select an agent file for this build');
        const selected = candidates.find(x => (selectedFile == null) || (x.filename === selectedFile));
        if (!selected || !selected.matches) throw new Error('Build is unavailable or its files have changed');
        const directories = await buildDirectories(domain);
        for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
            const manifestPath = path.join(entry.path, 'manifest.json');
            let manifest;
            try {
                const stat = await fs.promises.lstat(manifestPath);
                if (!stat.isFile() || (stat.size > 1024 * 1024)) continue;
                manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
            } catch (ex) { continue; }
            if (!validate(manifest) || (manifest.id !== buildId)) continue;
            const artifact = manifest.artifacts.find(x => (x.agentId === agentId) && (x.filename === selected.filename));
            if (!artifact || (artifact.size > 64 * 1024 * 1024)) throw new Error('Unsupported build file');
            const filename = path.join(entry.path, artifact.filename);
            const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || (stat.size !== artifact.size)) throw new Error('Build file changed');
                const data = await handle.readFile();
                if ((data.length !== artifact.size) || (crypto.createHash('sha256').update(data).digest('hex') !== artifact.hashes.sha256) ||
                    (crypto.createHash('sha384').update(data).digest('hex') !== artifact.hashes.sha384)) throw new Error('Build file changed');
                return { build: build, artifact: artifact, data: data, path: filename };
            } finally { await handle.close(); }
        }
        throw new Error('Build is unavailable');
    }

    async function identify(domain, agentId, hash, inventory) {
        if (!/^[a-f0-9]{96}$/.test(hash) || /^0+$/.test(hash)) return [];
        const matches = [], active = (domain.meshAgentBinaries && domain.meshAgentBinaries[agentId]) || parent.meshAgentBinaries[agentId];
        if (active && active.hashhex === hash) matches.push(Object.assign({ group: 'defaults', name: 'Server default', filename: active.localname, hash: hash }, active.release));
        for (const build of inventory.builds) {
            for (const artifact of build.artifacts) {
                if (!artifact.matches || artifact.id !== agentId || artifact.agentHash !== hash) continue;
                try {
                    const item = await getArtifact(build.id, agentId, artifact.filename, domain);
                    const key = signature(await fs.promises.lstat(item.path));
                    let cached = updateHashes.get(item.path);
                    if (!cached || cached.key !== key) {
                        const result = new Promise((resolve, reject) => {
                            const output = crypto.createHash('sha384');
                            output.on('data', value => resolve(value.toString('hex')));
                            output.on('error', reject);
                            try { require('./exeHandler').hashExecutableFile({ sourcePath: item.path, targetStream: output }); } catch (ex) { reject(ex); }
                        });
                        cached = { key: key, result: result };
                        updateHashes.set(item.path, cached);
                    }
                    if (await cached.result !== hash || signature(await fs.promises.lstat(item.path)) !== key) continue;
                    matches.push({ group: 'builds', build: build.id, name: build.name, filename: artifact.filename, hash: hash, commit: build.commit, sourceUrl: build.sourceUrl, commitTime: build.commitTime });
                } catch (ex) { }
            }
        }
        return matches;
    }

    return { getCatalog: getCatalog, getArtifact: getArtifact, identify: identify, managedRoot: managedRoot, use: use, manage: manage };
};
