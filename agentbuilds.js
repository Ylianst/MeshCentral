'use strict';

// Default agent release downloads: the pinned release manifest, the verified download cache and a
// local copy of each new agent release. Agent architecture definitions stay in agenttypes.js so new
// agents can be added there.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

// HTTPS downloads and GitHub API access with private-address guards
const httpsDownloads = (function () {
    const blocked = new net.BlockList();
    for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
        blocked.addSubnet(address, prefix, 'ipv4');
        blocked.addSubnet('64:ff9b::' + address, 96 + prefix, 'ipv6');
    }
    const global6 = new net.BlockList();
    global6.addSubnet('2000::', 3, 'ipv6');
    // DNS64 on IPv6-only networks answers with the IPv4 address inside the NAT64 well-known prefix. Those count
    // as public when the IPv4 address does, which the blocked list above checks.
    global6.addSubnet('64:ff9b::', 96, 'ipv6');
    for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');
    function publicAddress(address) {
        const family = net.isIP(address);
        return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && global6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
    }
    function parseUrl(value) {
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a public HTTPS download URL.');
        let url;
        try { url = new URL(value); } catch (ex) { throw new Error('Enter a public HTTPS download URL.'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('Use HTTPS on port 443 without a username, password or fragment.');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && !publicAddress(host)) throw new Error('Downloads from private or reserved addresses are not allowed.');
        return url;
    }
    function sourceUrl(value) {
        const url = parseUrl(value);
        url.search = '';
        return url.href;
    }
    function createClient(transport = https, lookup = dns.lookup, proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
        // A forward proxy, from npmProxy in config.json or from the environment, carries each request through a
        // CONNECT tunnel. The proxy resolves the host itself, so the address checks on DNS answers do not apply behind it.
        function tunnel(options, callback) {
            let target;
            try { target = new URL(proxy); } catch (ex) { return callback(new Error('The proxy URL is not valid.')); }
            const host = options.hostname || options.host, authority = (net.isIPv6(host) ? '[' + host + ']' : host) + ':' + options.port, headers = { Host: authority };
            if (target.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(decodeURIComponent(target.username) + ':' + decodeURIComponent(target.password)).toString('base64');
            const secure = target.protocol === 'https:';
            const request = (secure ? https : http).request({ host: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || (secure ? 443 : 80), method: 'CONNECT', path: authority, headers, agent: false, timeout: 10000 });
            request.on('connect', (res, socket) => {
                if (res.statusCode !== 200) { socket.destroy(); return callback(new Error('The proxy refused the connection (HTTP ' + res.statusCode + ').')); }
                callback(null, tls.connect({ socket, host, servername: net.isIP(host) ? undefined : host }));
            });
            request.on('timeout', () => request.destroy(new Error('The proxy timed out.')));
            request.on('error', err => callback(new Error(/proxy/.test(err.message) ? err.message : 'Unable to reach the proxy' + (/^[A-Z0-9_]+$/.test(err.code) ? ' (' + err.code + ')' : '') + '.')));
            request.end();
        }
        async function response(value, options, redirects = 0, authenticated = true) {
            const url = parseUrl(value), hostname = url.hostname.replace(/^\[|\]$/g, '');
            const headers = { 'User-Agent': 'MeshCentral-AgentBuilds', Accept: options.json ? 'application/vnd.github+json' : 'application/octet-stream', 'Accept-Encoding': 'identity' };
            if (url.hostname === 'api.github.com') {
                headers['X-GitHub-Api-Version'] = '2022-11-28';
                if (/\/actions\/artifacts\/\d+\/zip$/.test(url.pathname)) headers.Accept = 'application/vnd.github+json';
                if (options.token && authenticated) headers.Authorization = 'Bearer ' + options.token;
                if (options.etag) headers['If-None-Match'] = options.etag;
            }
            const res = await new Promise((resolve, reject) => {
                let timer, connecting;
                const request = transport.get(url, { headers, agent: proxy ? undefined : false, createConnection: proxy ? tunnel : undefined, defaultPort: 443, signal: options.signal, lookup: function (host, settings, callback) {
                    lookup(host, { all: true, verbatim: true }, (err, addresses) => {
                        if (err || !addresses || !addresses.length) return callback(new Error('Unable to resolve the download host.'));
                        if (addresses.some(x => !publicAddress(x.address))) return callback(new Error('Downloads from private or reserved addresses are not allowed.'));
                        // Return the checked addresses to the socket so a second lookup cannot change the destination. All
                        // of them, so a host without IPv4 still reaches a DNS64 address after the IPv4 one fails.
                        callback(null, settings.all ? addresses : addresses[0].address, addresses[0].family);
                    });
                } }, res => { clearTimeout(timer); clearTimeout(connecting); resolve(res); });
                timer = setTimeout(() => request.destroy(new Error('Download timed out.')), 20000);
                // A firewall that drops packets leaves the connection pending rather than refusing it, so connecting
                // gets less time than a slow response.
                connecting = setTimeout(() => request.destroy(new Error('Connection timed out.')), 10000);
                request.once('socket', socket => socket.once('secureConnect', () => clearTimeout(connecting)));
                request.setTimeout(20000, () => request.destroy(new Error('Download timed out.')));
                request.on('error', err => {
                    clearTimeout(timer); clearTimeout(connecting);
                    if (err.name === 'AbortError') return reject(Object.assign(new Error('Download cancelled or timed out.'), { name: 'AbortError' }));
                    // Nothing came back, so other downloads from this host will fail the same way.
                    const code = /^[A-Z0-9_]+$/.test(err.code) ? ' (' + err.code + ')' : '';
                    reject(Object.assign(new Error(/private or reserved|resolve the download|timed out|proxy/.test(err.message) ? err.message : 'Unable to download from this host' + code + '.'), { unreachable: true }));
                });
            });
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                res.destroy();
                if (redirects >= 5 || options.json) throw new Error('Too many redirects or an unexpected API redirect.');
                const next = parseUrl(new URL(res.headers.location || '', url).href);
                return response(next.href, options, redirects + 1, authenticated && next.origin === url.origin);
            }
            if (res.statusCode === 304 && options.conditional) {
                res.destroy();
                return { res, url: sourceUrl(url.href) };
            }
            if (res.statusCode !== 200) {
                res.destroy();
                if (options.conditional && (res.statusCode === 403 || res.statusCode === 429)) {
                    const error = new Error('GitHub denied the release check or its rate limit was reached. The next check has been delayed.');
                    error.retryAt = Math.min(Date.now() + 7 * 86400000, Math.max(Date.now() + 3600000, (Number(res.headers['x-ratelimit-reset']) || 0) * 1000, Date.now() + (Number(res.headers['retry-after']) || 0) * 1000));
                    throw error;
                }
                let message = 'Download failed (HTTP ' + res.statusCode + ').';
                if (res.statusCode === 401 || res.statusCode === 403) message = 'Download denied or API rate limit reached. Check the GitHub token and repository read permissions.';
                if (res.statusCode === 404) message = 'File or GitHub resource not found, or the token cannot access it.';
                if (res.statusCode === 410) message = 'This GitHub artifact has expired. Select a newer build.';
                const error = new Error(message);
                error.statusCode = res.statusCode;
                throw error;
            }
            if ((res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length']) > options.limit) {
                res.destroy(); throw new Error('Download exceeds the size limit or uses unsupported HTTP compression.');
            }
            return { res, url: sourceUrl(url.href) };
        }
        async function download(url, filename, options) {
            const { res, url: finalUrl } = await response(url, options), hash = crypto.createHash('sha256');
            let size = 0;
            const meter = new Transform({ transform(chunk, encoding, callback) {
                size += chunk.length;
                if (size > options.limit) return callback(new Error('Download exceeds the size limit.'));
                hash.update(chunk);
                if (options.progress) options.progress(size, Number(res.headers['content-length']) || null);
                callback(null, chunk);
            } });
            await pipeline(res, meter, fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }), { signal: options.signal });
            const sha256 = hash.digest('hex');
            if (options.sha256 && sha256 !== options.sha256) throw new Error('The downloaded SHA256 does not match the expected digest.');
            return { url: sourceUrl(url), finalUrl, size, sha256, digestVerified: !!options.sha256 };
        }
        async function readJsonBody(res) {
            const chunks = []; let length = 0;
            try {
                for await (const chunk of res) {
                    length += chunk.length;
                    if (length > 4 * 1024 * 1024) throw new Error('GitHub response exceeds the size limit.');
                    chunks.push(chunk);
                }
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch (ex) { res.destroy(); throw new Error('Unable to read the GitHub response.'); }
        }
        async function getJson(url, token, signal) {
            const { res } = await response(url, { json: true, token, signal, limit: 4 * 1024 * 1024 });
            return readJsonBody(res);
        }
        async function getJsonIfChanged(url, etag, signal) {
            const { res } = await response(url, { json: true, conditional: true, etag, signal, limit: 4 * 1024 * 1024 });
            return { unchanged: res.statusCode === 304, etag: res.headers.etag, data: res.statusCode === 304 ? null : await readJsonBody(res) };
        }
        return { download, getJson, getJsonIfChanged };
    }
    return { publicAddress, parseUrl, sourceUrl, createClient };
})();

// Release folders: one per tag under meshcentral-data/agentbuilds, with a SHA256SUMS listing every verified file
const releaseFolder = (function () {
    const writes = new Map();
    function hashes(filename) {
        return new Promise((resolve, reject) => {
            const sha256 = crypto.createHash('sha256'), sha384 = crypto.createHash('sha384');
            let size = 0;
            fs.createReadStream(filename).on('data', chunk => { size += chunk.length; sha256.update(chunk); sha384.update(chunk); })
                .on('error', reject).on('end', () => resolve({ size, sha256: sha256.digest('hex'), sha384: sha384.digest('hex') }));
        });
    }
    async function directory(filename) {
        await fs.promises.mkdir(filename, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(filename)).isDirectory()) throw new Error('Invalid agent release folder.');
    }
    async function sums(folder) {
        const result = new Map();
        let text;
        try { text = await fs.promises.readFile(path.join(folder, 'SHA256SUMS'), 'utf8'); } catch (ex) { if (ex.code === 'ENOENT') return result; throw ex; }
        for (const line of text.split('\n')) {
            const match = /^([a-f0-9]{64}) [ *](\S+)$/.exec(line.trim());
            if (match) result.set(match[2], match[1]);
        }
        return result;
    }
    // Downloads run a few at a time, so updates to one folder's listing are queued behind each other.
    function record(folder, filename, sha256) {
        const previous = writes.get(folder) || Promise.resolve();
        const task = previous.catch(() => {}).then(async function () {
            const entries = await sums(folder);
            entries.set(filename, sha256);
            const temp = path.join(folder, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
            await fs.promises.writeFile(temp, Array.from(entries, ([name, hash]) => hash + '  ' + name + '\n').join(''), { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(temp, path.join(folder, 'SHA256SUMS'));
        });
        writes.set(folder, task);
        return task.finally(() => { if (writes.get(folder) === task) writes.delete(folder); });
    }
    // Free space on the volume holding the folder, or null when the runtime cannot say.
    async function freeSpace(folder) {
        if (typeof fs.promises.statfs !== 'function') return null;
        const stat = await fs.promises.statfs(folder);
        return Number(stat.bavail) * Number(stat.bsize);
    }
    function reserve(settings) {
        const mib = Number.isInteger(settings.minfreespacemib) && settings.minfreespacemib >= 0 && settings.minfreespacemib <= 1048576 ? settings.minfreespacemib : 256;
        return mib * 1048576;
    }
    async function ensureSpace(folder, bytes, reserved, probe) {
        const free = await (probe || freeSpace)(folder);
        const mib = value => Math.ceil(value / 1048576);
        if (free != null && free < bytes + reserved) throw new Error('Not enough free disk space: ' + mib(bytes) + ' MiB to download, ' + mib(free) + ' MiB free, ' + mib(reserved) + ' MiB kept in reserve.');
    }
    return { hashes, directory, sums, record, freeSpace, reserve, ensureSpace };
})();

// Scheduled GitHub release checks, and a local copy of each new release for administrators to try
function CreateAgentReleaseUpdates(settings, client, entries, options = {}) {
    const hours = Number.isInteger(settings.checkintervalhours) && settings.checkintervalhours >= 0 && settings.checkintervalhours <= 168 ? settings.checkintervalhours : 24;
    const enabled = settings.enabled !== false;
    const fetching = (settings.fetchreleases !== false) && (typeof options.root === 'string');
    const prereleases = settings.includeprereleases === true;
    const keep = Number.isInteger(settings.keepreleases) && settings.keepreleases >= 0 && settings.keepreleases <= 100 ? settings.keepreleases : 3;
    const names = options.names || new Set(), pinned = options.pinned || new Set(), log = options.log || function () { }, reserved = releaseFolder.reserve(settings);
    const repositories = new Map();
    for (const file of entries) {
        if (!repositories.has(file.repository)) repositories.set(file.repository, { repository: file.repository, tags: new Set(), files: new Set(), fetched: new Set(), failures: 0, nextCheck: 0 });
        const repository = repositories.get(file.repository);
        repository.tags.add(file.tag); repository.files.add(file.filename);
    }
    let pending = null, timer = null, stopped = false;

    function version(tag) {
        const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(tag);
        return match ? match.slice(1).map(Number) : null;
    }
    function compare(a, b) {
        for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
        return 0;
    }
    function safeName(value) { return typeof value === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(value); }
    function latest(releases, repository) {
        if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response.');
        // Releases from before the fixed asset names, such as the versioned-only Android APKs, carry none of these files.
        const candidates = releases.filter(release => release && !release.draft && !release.prerelease && version(release.tag_name) &&
            Array.isArray(release.assets) && release.assets.some(asset => asset && asset.size > 0 && repository.files.has(asset.name)));
        candidates.sort((a, b) => compare(version(b.tag_name), version(a.tag_name)));
        if (!candidates.length) return null;
        const release = candidates[0], tag = release.tag_name;
        const files = release.assets.filter(asset => asset && safeName(asset.name) && asset.size > 0).map(asset => asset.name);
        const current = Array.from(repository.tags).map(version).filter(Boolean);
        return { tag, sourceUrl: 'https://github.com/' + repository.repository + '/releases/tag/' + encodeURIComponent(tag),
            publishedAt: release.published_at, availableFiles: Array.from(repository.files).filter(name => files.includes(name)),
            updateAvailable: !current.length || current.some(value => compare(version(tag), value) > 0) };
    }
    // Releases worth a local copy: published, carrying at least one agent file under its served name, and not
    // already pinned as a default. Only the newest few, so a fresh server does not fetch years of history.
    function candidates(releases, repository) {
        if (!Array.isArray(releases)) return [];
        return releases.filter(release => release && !release.draft && (prereleases || !release.prerelease) && safeName(release.tag_name) && !repository.tags.has(release.tag_name) &&
            Array.isArray(release.assets) && release.assets.some(asset => asset && asset.size > 0 && names.has(asset.name)))
            .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0)).slice(0, keep || undefined);
    }
    // Copies that are no longer among the newest for any repository are removed. Pinned defaults are never
    // touched, nor is a folder without a listing, which is not ours. Nothing is removed until every
    // repository has answered, or a repository that is down would lose its copies.
    async function prune() {
        if (!keep) return;
        const wanted = new Set();
        for (const repository of repositories.values()) {
            if (!repository.releases) return;
            for (const release of candidates(repository.releases, repository)) wanted.add(release.tag_name);
        }
        let entries;
        try { entries = await fs.promises.readdir(options.root, { withFileTypes: true }); } catch (ex) { return; }
        for (const entry of entries) {
            if (!entry.isDirectory() || !safeName(entry.name) || pinned.has(entry.name) || wanted.has(entry.name)) continue;
            const listing = await fs.promises.lstat(path.join(options.root, entry.name, 'SHA256SUMS')).catch(() => null);
            if (!listing || !listing.isFile()) continue;
            await fs.promises.rm(path.join(options.root, entry.name), { recursive: true, force: true });
            log('Agent release ' + entry.name + ' removed, keeping the newest ' + keep + ' releases');
        }
    }
    // A file counts as present once it matches its SHA256SUMS line, so an interrupted copy keeps what it has
    // and fetches the rest. Returns the folder when anything was downloaded.
    async function pickup(repository, release, signal) {
        const target = path.join(options.root, release.tag_name);
        const listed = await releaseFolder.sums(target), missing = [];
        for (const asset of release.assets) {
            if (!asset || !names.has(asset.name) || !(asset.size > 0) || (asset.size > 128 * 1024 * 1024)) continue;
            const digest = (typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)) ? asset.digest.slice(7) : undefined;
            const info = listed.has(asset.name) ? await releaseFolder.hashes(path.join(target, asset.name)).catch(() => null) : null;
            if (info && (info.size === asset.size) && (info.sha256 === listed.get(asset.name)) && (!digest || info.sha256 === digest)) continue;
            missing.push({ asset, digest });
        }
        if (!missing.length) return false;
        await releaseFolder.directory(target);
        await releaseFolder.ensureSpace(target, missing.reduce((total, item) => total + item.asset.size, 0), reserved, options.freeSpace);
        for (const { asset, digest } of missing) {
            const filename = path.join(target, asset.name);
            const temp = path.join(target, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
            try {
                await client.download('https://github.com/' + repository.repository + '/releases/download/' + encodeURIComponent(release.tag_name) + '/' + encodeURIComponent(asset.name), temp, { limit: asset.size, signal, sha256: digest });
                const fetched = await releaseFolder.hashes(temp);
                if (fetched.size !== asset.size) throw new Error(asset.name + ': the downloaded size does not match the release.');
                await fs.promises.chmod(temp, 0o600);
                await fs.promises.rename(temp, filename);
                await releaseFolder.record(target, asset.name, fetched.sha256);
            } finally { await fs.promises.unlink(temp).catch(() => {}); }
        }
        return target;
    }
    function status() {
        return { enabled, intervalHours: hours, fetching, prereleases, checking: !!pending, repositories: Array.from(repositories.values(), item => ({
            repository: item.repository, tags: Array.from(item.tags), latest: item.latest || null, fetched: Array.from(item.fetched),
            lastCheck: item.lastCheck, lastSuccess: item.lastSuccess, nextCheck: item.nextCheck, error: item.error || item.copyError || null
        })) };
    }
    function schedule() {
        if (timer) clearTimeout(timer);
        timer = null;
        if (stopped || !enabled || !hours || !repositories.size) return;
        const next = Math.min(...Array.from(repositories.values(), item => item.nextCheck));
        timer = setTimeout(() => { check(false).catch(() => {}); }, Math.max(1000, next - Date.now()));
        timer.unref();
    }
    function check(manual) {
        if (pending) return pending;
        if (!enabled || stopped) return Promise.resolve();
        pending = (async function () {
            const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 120000);
            try {
                for (const repository of repositories.values()) {
                    if (repository.retryAt > Date.now() || (repository.lastCheck && Date.now() - repository.lastCheck < 60000) || (!manual && repository.nextCheck > Date.now())) continue;
                    repository.lastCheck = Date.now();
                    try {
                        const response = await client.getJsonIfChanged('https://api.github.com/repos/' + repository.repository + '/releases?per_page=100', repository.etag, controller.signal);
                        if (!response.unchanged) { repository.latest = latest(response.data, repository); repository.releases = response.data; }
                        repository.etag = response.etag || repository.etag;
                        repository.lastSuccess = Date.now(); repository.error = null; repository.failures = 0;
                    } catch (ex) {
                        repository.error = ex.message; repository.failures++;
                        repository.retryAt = ex.retryAt || 0;
                    }
                    const delay = repository.failures ? Math.min(24 * 3600000, 3600000 * Math.pow(2, Math.min(5, repository.failures - 1))) : (hours || 24) * 3600000;
                    repository.nextCheck = Math.max(repository.retryAt || 0, Date.now() + delay + Math.floor(Math.random() * 300000));
                }
            } finally { clearTimeout(deadline); }
            if (!fetching) return;
            // Copies get their own deadline: a release is tens of megabytes and the API check above is not.
            const copies = new AbortController(), limit = setTimeout(() => copies.abort(), 600000);
            try {
                for (const repository of repositories.values()) {
                    // A copy that failed last time is retried from the cached release list, so its error clears on success.
                    repository.copyError = null;
                    for (const release of candidates(repository.releases, repository)) {
                        if (repository.fetched.has(release.tag_name)) continue;
                        try {
                            const target = await pickup(repository, release, copies.signal);
                            repository.fetched.add(release.tag_name);
                            if (target) log('Agent release ' + repository.repository + ' ' + release.tag_name + ' downloaded to ' + target);
                        } catch (ex) { repository.copyError = release.tag_name + ': ' + ex.message; }
                    }
                }
                await prune().catch(ex => log('Unable to remove old agent release copies: ' + ex.message));
            } finally { clearTimeout(limit); }
        })().finally(() => { pending = null; schedule(); });
        return pending;
    }
    function start() {
        if (timer || stopped) return;
        for (const repository of repositories.values()) repository.nextCheck = Date.now() + 30000 + Math.floor(Math.random() * 120000);
        schedule();
    }
    function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; }
    return { start, stop, check, status };
}

// Default agent release downloads
function CreateAgentDefaults(parent, options = {}) {
    const root = path.join(parent.datapath, 'agentbuilds');
    const bundled = options.directory || path.join(__dirname, 'agents');
    // npmProxy comes ahead of the environment, as it does for npm and the time stamp server.
    const npmProxy = (parent.args && (typeof parent.args.npmproxy == 'string') && parent.args.npmproxy) ? parent.args.npmproxy : undefined;
    const client = options.client || httpsDownloads.createClient(undefined, undefined, npmProxy), log = options.log || (message => console.log(message));
    const settings = (parent.config.settings || {}).agentdownloads || {};
    const names = new Set(Object.values(parent.meshAgentsArchitectureNumbers).map(x => x.localname));
    for (const name of ['MeshCentralRouter.exe', 'MeshCentralRouter.dmg', 'MeshCentralAssistant.exe']) names.add(name);
    const ready = new Map(), entries = new Map(), rejected = new Set();
    const mismatch = 'The release file does not match its expected size and SHA384.';
    let busy = null, errors = [], loaded = false, activating = null, updates = null, activePaths = null, announced = false, retryTimer = null, retries = 0;

    function regular(filename) {
        try { return fs.lstatSync(filename).isFile(); } catch (ex) { return false; }
    }
    // Where a name resolves right now: a verified release file, else a local or bundled file for names
    // outside the manifest. Nothing outside the manifest stands in for a release file that is not ready.
    function current(name) {
        if (ready.has(name)) return ready.get(name);
        if (entries.has(name)) return null;
        const local = path.join(root, name);
        if (regular(local)) return local;
        const original = path.join(bundled, name);
        return regular(original) ? original : null;
    }
    function sourcePath(name) {
        if (!names.has(name)) return null;
        return activePaths ? activePaths.get(name) : current(name);
    }
    function changed() {
        return Array.from(names).some(name => activePaths.get(name) !== current(name));
    }
    // Swap in what changed since the paths were frozen. The server calls this at the start of an
    // activation pass so signing and the table rebuild see the same files.
    function activate() {
        if (!activePaths || !changed()) return false;
        activePaths = new Map(Array.from(names, name => [name, current(name)]));
        return true;
    }
    function notify() {
        if (typeof parent.activateAgentDefaults !== 'function') { activate(); return; }
        const task = new Promise(resolve => parent.activateAgentDefaults(resolve)).catch(() => {}).finally(() => { if (activating === task) activating = null; });
        activating = task;
    }
    function validate(manifest) {
        if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.releases) || manifest.releases.length > 32) throw new Error('Invalid default agent release manifest.');
        const files = new Map(), skipped = new Set();
        for (const release of manifest.releases) {
            if (!release || typeof release.repository !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(release.repository) ||
                typeof release.tag !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(release.tag) ||
                !Array.isArray(release.files) || !release.files.length) throw new Error('Specify a repository, release tag and files for each default release.');
            const base = 'https://github.com/' + release.repository + '/releases/';
            for (const file of release.files) {
                if (!file || typeof file.filename !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(file.filename)) throw new Error('Invalid default release file name in ' + release.tag + '.');
                // Newer releases can carry agent types this server does not know. Nothing would serve them, so they
                // are left out instead of failing the whole manifest.
                if (!names.has(file.filename)) { skipped.add(file.filename); continue; }
                if (files.has(file.filename)) throw new Error(file.filename + ' is listed more than once in the default releases.');
                if (typeof file.asset !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(file.asset) ||
                    !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024 ||
                    typeof file.sha384 !== 'string' || !/^[a-f0-9]{96}$/.test(file.sha384)) throw new Error('Invalid asset, size or SHA384 for default release file ' + file.filename + '.');
                files.set(file.filename, {
                    filename: file.filename, asset: file.asset, size: file.size, sha384: file.sha384,
                    repository: release.repository, tag: release.tag, sourceUrl: base + 'tag/' + encodeURIComponent(release.tag),
                    url: base + 'download/' + encodeURIComponent(release.tag) + '/' + encodeURIComponent(file.asset), status: 'Not checked'
                });
            }
        }
        if (!files.size) throw new Error('The default releases list no agent files this server uses.');
        if (skipped.size) log('Ignoring ' + Array.from(skipped).join(', ') + ' in the default agent releases: no agent type on this server uses ' + (skipped.size === 1 ? 'that file name.' : 'those file names.'));
        return files;
    }
    async function read(filename) {
        try {
            const stat = await fs.promises.lstat(filename);
            if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid default agent release manifest.');
            return validate(JSON.parse(await fs.promises.readFile(filename, 'utf8')));
        } catch (ex) { if (ex.code === 'ENOENT') throw ex; throw new Error(filename + ': ' + ex.message); }
    }
    async function load() {
        const shipped = path.resolve(bundled, 'agent-defaults.json');
        let custom = settings.manifest ? path.resolve(parent.datapath, settings.manifest) : null, files;
        if (custom === shipped) custom = null;
        // check-releases.js passes the shipped manifest as the custom one, from a folder that holds no copy of it.
        try { files = await read(shipped); } catch (ex) { if (!custom || ex.code !== 'ENOENT') throw ex; files = new Map(); }
        // Laid over the shipped pins file by file, so a release that carries only some agents, like a testing
        // build, does not leave the others with nothing to serve.
        if (custom) for (const [name, file] of await read(custom)) files.set(name, file);
        entries.clear();
        for (const [name, file] of files) entries.set(name, file);
        loaded = true;
        updates = CreateAgentReleaseUpdates(settings, client, entries.values(), { root: root, names: names, pinned: new Set(Array.from(entries.values(), file => file.tag)), freeSpace: options.freeSpace, log: message => console.log(message) });
        if (activePaths) updates.start();
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
        const cache = path.join(root, file.tag), target = path.join(cache, file.filename);
        if (await verified(target, file)) {
            // A file supplied by hand is listed on first use, so SHA256SUMS covers the whole folder.
            if (!(await releaseFolder.sums(cache)).has(file.filename)) await releaseFolder.record(cache, file.filename, (await releaseFolder.hashes(target)).sha256);
            file.status = 'Ready'; return target;
        }
        let local;
        if (await verified(path.join(bundled, file.filename), file)) local = path.join(bundled, file.filename);
        const imported = localFiles && localFiles.find(x => x.sha384 === file.sha384 && x.size === file.size);
        if (!local && imported && await verified(imported.path, file)) local = imported.path;
        if (!local && settings.enabled === false) return null;
        // Checked only now so files already on disk still load after the pass has given up on GitHub.
        if (!local) signal.throwIfAborted();
        // A published asset that failed verification would fail again, so it is fetched once per start.
        if (!local && rejected.has(file.filename)) throw new Error(mismatch);
        await directory(root); await directory(cache);
        await releaseFolder.ensureSpace(cache, file.size, releaseFolder.reserve(settings), options.freeSpace);
        const temp = path.join(cache, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
        try {
            if (local) {
                await fs.promises.copyFile(local, temp, fs.constants.COPYFILE_EXCL);
            } else {
                announce();
                file.status = 'Downloading'; file.received = 0;
                try {
                    await client.download(file.url, temp, { limit: file.size, signal, progress: received => { file.received = received; } });
                } catch (ex) {
                    if (ex.statusCode === 404) throw new Error('Release asset not found. Publish the configured release and asset before downloading it.');
                    if (ex.statusCode === 401 || ex.statusCode === 403) throw new Error('GitHub denied the public release download. Check that the release is public or retry later.');
                    throw ex;
                }
            }
            if (!await verified(temp, file)) { if (!local) rejected.add(file.filename); throw new Error(mismatch); }
            await fs.promises.chmod(temp, 0o600);
            await fs.promises.rename(temp, target);
            await releaseFolder.record(cache, file.filename, (await releaseFolder.hashes(target)).sha256);
            file.status = 'Ready';
            return target;
        } finally { await fs.promises.unlink(temp).catch(() => {}); }
    }
    function status() {
        return {
            busy: !!busy, activating: !!activating, enabled: settings.enabled !== false, errors: errors.slice(),
            updates: updates ? updates.status() : null,
            files: Array.from(entries.values(), ({ url, ...file }) => ({ ...file }))
        };
    }
    // One line when the first download starts, so a slow link explains a quiet startup. Background retries
    // stay quiet until their files load.
    function announce() {
        if (announced) return;
        announced = true;
        const waiting = Array.from(entries.values()).filter(file => file.status !== 'Ready');
        log('Downloading ' + waiting.length + ' default agent files (' + Math.ceil(waiting.reduce((total, file) => total + file.size, 0) / 1048576) + ' MiB) from GitHub releases...');
    }
    // One warning for all the files that could not be fetched, with the release pages to get them from and
    // the folders they go in.
    function missingWarning(files, cause) {
        const folders = new Map();
        for (const file of files) {
            if (!folders.has(file.tag)) folders.set(file.tag, new Set());
            folders.get(file.tag).add(file.sourceUrl);
        }
        const one = files.length === 1, what = (!one && files.length === entries.size) ? 'the ' + files.length + ' default agent files' : files.map(file => file.filename).join(', ');
        const where = (one ? 'it' : 'them') + ' from ' + Array.from(folders, ([tag, pages]) => Array.from(pages).join(' and ') + ' into "' + path.join(root, tag) + '"').join(', and from ') + '.';
        if (!cause) return 'Agent downloads are disabled and ' + what + (one ? ' is' : ' are') + ' missing. Download ' + where;
        return 'Unable to download ' + what + ' from GitHub: ' + cause.message + ' Retrying in the background. On a server without internet access, download ' + where;
    }
    // Missing files are looked for again in the background, so a network that was down at startup or files
    // copied in by hand need no restart. The wait doubles from a minute up to an hour.
    function retry() {
        clearTimeout(retryTimer); retryTimer = null;
        if (!activePaths || Array.from(entries.keys()).every(name => ready.has(name) || rejected.has(name))) { retries = 0; return; }
        retryTimer = setTimeout(() => { retryTimer = null; prepare(); }, Math.min(3600000, 60000 * Math.pow(2, retries++)));
        retryTimer.unref();
    }
    function prepare(localFiles) {
        if (busy) return busy;
        busy = (async function () {
            errors = [];
            try { if (!loaded) await load(); }
            catch (ex) { errors.push('Unable to read default agent releases: ' + ex.message); return; }
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Downloads did not finish within 10 minutes.')), 600000);
            const missing = new Set();
            let cause = null;
            try {
                const pending = Array.from(entries.values()).filter(file => !ready.has(file.filename));
                await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async function () {
                    while (pending.length) {
                        const file = pending.shift();
                        delete file.error; delete file.received;
                        try {
                            const target = await resolve(file, controller.signal, localFiles);
                            if (target) { ready.set(file.filename, target); continue; }
                            file.status = 'Unavailable'; file.error = 'Automatic downloads are disabled. Supply this release file locally.';
                            missing.add(file);
                        } catch (ex) {
                            // Without GitHub every other download would wait out the same timeout, so the rest are stopped
                            // and report why rather than their cancellation.
                            if (ex.unreachable && !controller.signal.aborted) controller.abort(ex);
                            const stopped = controller.signal.aborted && (ex === controller.signal.reason || ex.name === 'AbortError');
                            const reason = ex.unreachable ? ex : stopped ? controller.signal.reason : null;
                            file.status = 'Unavailable'; file.error = (reason || ex).message;
                            if (reason) { cause = cause || reason; missing.add(file); } else errors.push(file.filename + ': ' + ex.message);
                        }
                    }
                }));
            } finally { clearTimeout(timer); }
            // Listed in manifest order, not the order the downloads happened to fail in.
            if (missing.size) errors.unshift(missingWarning(Array.from(entries.values()).filter(file => missing.has(file)), cause));
            // Files that landed after start() froze the paths are switched in by the server, not by a restart.
            if (activePaths && changed()) notify();
            retry();
        })().finally(() => { busy = null; });
        return busy;
    }
    function info(name) {
        const file = entries.get(name);
        if (!file || !ready.has(name) || (activePaths && activePaths.get(name) !== ready.get(name))) return null;
        return { repository: file.repository, tag: file.tag, sourceUrl: file.sourceUrl, sha384: file.sha384 };
    }
    function start() {
        // Signing and table loading must see the same files after the startup download wait ends.
        if (!activePaths) activePaths = new Map(Array.from(names, name => [name, current(name)]));
        if (updates) updates.start();
        if (!busy) retry();
    }
    return { prepare, status, sourcePath, info, start, activate, checkUpdates: () => updates ? updates.check(true) : Promise.resolve() };
}

module.exports = { CreateAgentDefaults, CreateAgentReleaseUpdates, httpsDownloads };
