'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./agentbuildstorage');
const fetch = require('./agentbuildfetch');
const unpack = require('./agentbuildarchive').unpack;

exports.CreateAgentBuildImport = function (uploads, client = fetch.createClient()) {
    const jobs = new Map(), browsing = new Set(), artifactCache = new Map();
    let active = 0;
    function key(domain, user) { return domain.id + '\0' + user._id; }
    function repository(value) {
        if (typeof value !== 'string' || value.length > 201 || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value) || ['.', '..'].includes(value.split('/')[1])) throw new Error('Enter a GitHub repository as owner/repository.');
        return value;
    }
    function id(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid GitHub resource ID.'); return value; }
    function token(value) {
        if (value == null || value === '') return undefined;
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,255}$/.test(value)) throw new Error('Invalid GitHub token.');
        return value;
    }
    function githubSettings(domain) {
        const config = domain.agentbuilds && domain.agentbuilds.github || {};
        const names = config.artifactnames || ['meshagent*', 'meshservice*'];
        if (!Array.isArray(names) || !names.length || names.length > 16 || names.some(x => typeof x !== 'string' || !x.length || x.length > 128)) throw new Error('Invalid agentBuilds.github.artifactNames in domain configuration.');
        return { credential: token(config.token), names, patterns: names.map(x => new RegExp('^' + x.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')) };
    }
    function availableArtifact(artifact, settings) {
        return !artifact.expired && Date.parse(artifact.expires_at) > Date.now() && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 128 * 1024 * 1024 && settings.patterns.some(x => x.test(artifact.name));
    }
    async function artifacts(domain, repo, run, credential, signal) {
        const cacheKey = domain.id + '\0' + repo.toLowerCase() + '\0' + run + '\0' + crypto.createHash('sha256').update(credential || '').digest('hex');
        const cached = artifactCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return cached.rows;
        const rows = [];
        for (let page = 1; page <= 10; page++) {
            const data = await api(repo, '/actions/runs/' + run + '/artifacts?per_page=100&page=' + page, credential, signal);
            rows.push(...data.artifacts);
            if (data.total_count <= page * 100 || data.artifacts.length < 100) {
                if (artifactCache.size >= 128) artifactCache.delete(artifactCache.keys().next().value);
                artifactCache.set(cacheKey, { rows, expires: Date.now() + 60000 });
                return rows;
            }
        }
        throw new Error('This workflow run has too many artifacts to browse.');
    }
    async function buildRuns(domain, repo, runs, credential, signal, settings) {
        const rows = new Array(runs.length);
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(4, runs.length) }, async () => {
            while (index < runs.length) {
                const current = index++, run = runs[current];
                if (run.status !== 'completed' || run.conclusion !== 'success') continue;
                const files = (await artifacts(domain, repo, id(run.id), credential, signal)).filter(x => availableArtifact(x, settings));
                if (files.length) { rows[current] = runRow(repo, run); rows[current].detail += ' / ' + files.length + ' agent artifacts'; }
            }
        }));
        return rows.filter(Boolean);
    }
    function sha(value) { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('GitHub did not return a source commit.'); return value; }
    function digest(value) {
        if (value == null || value === '') return undefined;
        if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Unsupported GitHub digest.');
        return value.slice(7);
    }
    function api(repo, suffix, credential, signal) { return client.json('https://api.github.com/repos/' + repo + suffix, credential, signal); }
    function runSource(repo, run) {
        const commit = sha(run.head_sha);
        return { kind: 'github-actions', repository: repo, commit, commitUrl: 'https://github.com/' + repo + '/commit/' + commit, branch: run.head_branch, event: run.event, headRepository: run.head_repository && run.head_repository.full_name, runId: id(run.id), runAttempt: run.run_attempt, workflow: run.path, conclusion: run.conclusion, url: 'https://github.com/' + repo + '/actions/runs/' + run.id };
    }
    function runRow(repo, run) {
        return { id: id(run.id), name: run.name, detail: [run.created_at, run.event, run.head_branch, sha(run.head_sha).slice(0, 12), run.conclusion || run.status].filter(Boolean).join(' / '), available: run.status === 'completed' && run.conclusion === 'success', source: runSource(repo, run) };
    }
    async function browse(domain, request, credential, signal, settings) {
        const repo = repository(request.repository), page = request.page == null ? 1 : id(request.page);
        if (page > 50) throw new Error('Narrow the search to a branch, commit or run.');
        const paging = 'per_page=20&page=' + page;
        if (request.kind === 'releases') {
            const rows = await api(repo, '/releases?' + paging, credential, signal);
            return { items: rows.filter(x => !x.draft).map(x => ({ id: x.id, name: x.name || x.tag_name, detail: [x.tag_name, x.prerelease ? 'Prerelease' : 'Release', x.published_at].join(' / '), available: true })), more: rows.length === 20, page };
        }
        if (request.kind === 'assets') {
            const release = await api(repo, '/releases/' + id(request.release), credential, signal);
            if (release.draft) throw new Error('Draft releases cannot be imported.');
            const rows = await api(repo, '/releases/' + release.id + '/assets?' + paging, credential, signal);
            return { items: rows.map(x => ({ id: x.id, name: x.name, size: x.size, available: x.state === 'uploaded' && x.size <= 128 * 1024 * 1024, digest: x.digest })), more: rows.length === 20, page };
        }
        if (request.kind === 'artifacts') {
            const run = await api(repo, '/actions/runs/' + id(request.run), credential, signal);
            const rows = (await artifacts(domain, repo, run.id, credential, signal)).filter(x => availableArtifact(x, settings));
            return { source: runSource(repo, run), items: rows.slice((page - 1) * 20, page * 20).map(x => ({ id: x.id, name: x.name, size: x.size_in_bytes, detail: 'Expires ' + x.expires_at, available: run.status === 'completed' && run.conclusion === 'success', digest: x.digest })), more: rows.length > page * 20, page };
        }
        if (request.kind === 'run') return { items: await buildRuns(domain, repo, [await api(repo, '/actions/runs/' + id(Number(request.filter)), credential, signal)], credential, signal, settings), more: false, page: 1 };
        if (!['runs', 'pull-request'].includes(request.kind)) throw new Error('Invalid GitHub source.');
        let filter = '', pull;
        if (request.kind === 'pull-request') {
            pull = await api(repo, '/pulls/' + id(Number(request.filter)), credential, signal);
            filter = '&head_sha=' + sha(pull.head.sha);
        } else if (request.filter) {
            if (typeof request.filter !== 'string' || request.filter.length > 200) throw new Error('Invalid branch or commit filter.');
            filter = (/^[a-f0-9]{40}$/.test(request.filter) ? '&head_sha=' : '&branch=') + encodeURIComponent(request.filter);
        }
        const data = await api(repo, '/actions/runs?' + paging + '&status=success' + filter, credential, signal);
        return { items: await buildRuns(domain, repo, data.workflow_runs, credential, signal, settings), more: Math.min(data.total_count, 1000) > page * 20, page, note: pull ? 'PR #' + pull.number + ': ' + pull.title + '. Runs for head commit ' + pull.head.sha + '.' : undefined };
    }
    async function resolve(domain, request, credential, signal) {
        if (request.kind === 'url') {
            const url = fetch.parseUrl(request.url);
            let filename = request.filename;
            if (!filename) { try { filename = decodeURIComponent(url.pathname.split('/').pop()); } catch (ex) {} }
            if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(filename || '')) throw new Error('Enter a filename containing letters, numbers, dots, underscores or hyphens.');
            if (request.sha256 && (typeof request.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(request.sha256))) throw new Error('Expected SHA256 must contain 64 hexadecimal characters.');
            return { name: filename, channel: 'custom', source: { kind: 'url', url: fetch.sourceUrl(url.href) }, downloads: [{ url: url.href, filename, sha256: request.sha256 && request.sha256.toLowerCase() }] };
        }
        const repo = repository(request.repository);
        if (!Array.isArray(request.ids) || request.ids.length < 1 || request.ids.length > 16 || new Set(request.ids).size !== request.ids.length) throw new Error('Select between 1 and 16 GitHub downloads.');
        request.ids.forEach(id);
        const downloads = [];
        if (request.kind === 'artifacts') {
            if (!credential) throw new Error('Configure agentBuilds.github.token in this domain with GitHub Actions read permission, then restart MeshCentral.');
            const run = await api(repo, '/actions/runs/' + id(request.run), credential, signal), source = runSource(repo, run);
            if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Select a completed, successful workflow run.');
            for (const artifactId of request.ids) {
                const artifact = await api(repo, '/actions/artifacts/' + artifactId, credential, signal);
                if (!artifact.workflow_run || artifact.workflow_run.id !== run.id || artifact.workflow_run.head_sha !== run.head_sha) throw new Error('Artifact does not belong to the selected run and commit.');
                if (artifact.expired || Date.parse(artifact.expires_at) <= Date.now()) throw new Error('This GitHub artifact has expired. Select a newer build.');
                if (artifact.size_in_bytes > 128 * 1024 * 1024) throw new Error('Artifact exceeds the download limit.');
                if (!availableArtifact(artifact, githubSettings(domain))) throw new Error('Artifact does not match the configured agent artifact names or is empty.');
                downloads.push({ id: artifact.id, name: artifact.name, url: 'https://api.github.com/repos/' + repo + '/actions/artifacts/' + artifactId + '/zip', filename: 'artifact-' + artifactId + '.zip', sha256: digest(artifact.digest) });
            }
            return { name: (repo + ' / ' + run.name + ' / ' + run.head_sha.slice(0, 12)).slice(0, 128), channel: /^pull_request/.test(run.event) ? 'pull-request' : run.event === 'schedule' ? 'nightly' : 'testing', source, workflows: [{ runId: run.id, url: source.url, path: run.path }], downloads };
        }
        if (request.kind !== 'assets') throw new Error('Invalid import source.');
        const release = await api(repo, '/releases/' + id(request.release), credential, signal);
        if (release.draft) throw new Error('Draft releases cannot be imported.');
        // Resolve the tag, not target_commitish, which can still name a moving branch.
        const ref = await api(repo, '/git/ref/tags/' + encodeURIComponent(release.tag_name), credential, signal);
        let commit = ref.object;
        for (let depth = 0; commit && commit.type === 'tag' && depth < 8; depth++) commit = (await api(repo, '/git/tags/' + sha(commit.sha), credential, signal)).object;
        if (!commit || commit.type !== 'commit') throw new Error('Release tag does not resolve to a commit.');
        sha(commit.sha);
        for (const assetId of request.ids) {
            const asset = await api(repo, '/releases/assets/' + assetId, credential, signal);
            const url = fetch.parseUrl(asset.browser_download_url);
            const parts = url.pathname.split('/');
            if (url.origin !== 'https://github.com' || parts.length !== 7 || (parts[1] + '/' + parts[2]).toLowerCase() !== repo.toLowerCase() || parts[3] !== 'releases' || parts[4] !== 'download' || decodeURIComponent(parts[5]) !== release.tag_name || asset.state !== 'uploaded') throw new Error('Asset does not belong to the selected release.');
            if (asset.size > 128 * 1024 * 1024) throw new Error('Asset exceeds the download limit.');
            downloads.push({ id: asset.id, name: asset.name, url: credential ? 'https://api.github.com/repos/' + repo + '/releases/assets/' + assetId : url.href, filename: asset.name, sha256: digest(asset.digest) });
        }
        const source = { kind: 'github-release', repository: repo, releaseId: release.id, tag: release.tag_name, commit: sha(commit.sha), commitUrl: 'https://github.com/' + repo + '/commit/' + commit.sha, url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(release.tag_name) };
        return { name: (repo + ' / ' + release.tag_name).slice(0, 128), channel: release.prerelease ? 'testing' : 'stable', source, downloads };
    }
    function report(job) { return { id: job.id, stage: job.stage, received: job.received, total: job.total, file: job.file, index: job.index, count: job.count, error: job.error, draft: job.draft }; }
    async function run(job, domain, user, request, credential) {
        const signal = job.controller.signal;
        const timeout = setTimeout(() => job.controller.abort(), 300000);
        try {
            job.draft = await uploads.stage(domain, user, async directory => {
                const info = await resolve(domain, request, credential, signal), files = [], skipped = [], budget = { entries: 0, bytes: 0, files: 0 };
                let downloaded = 0;
                info.source.downloads = [];
                job.count = info.downloads.length;
                for (const entry of info.downloads) {
                    if (signal.aborted) throw new Error('Import cancelled or timed out.');
                    job.stage = 'downloading'; job.file = entry.name || entry.filename; job.index = info.source.downloads.length + 1; job.received = 0; job.total = null;
                    const target = path.join(directory, 'download-' + job.index);
                    const result = await client.download(entry.url, target, { token: credential, signal, limit: 128 * 1024 * 1024 - downloaded, sha256: entry.sha256, progress: (received, total) => { job.received = received; job.total = total; } });
                    downloaded += result.size;
                    const download = Object.assign({ id: entry.id, name: entry.name || entry.filename }, result);
                    info.source.downloads.push(download); job.stage = 'inspecting';
                    const archive = await unpack(target, directory, budget, signal);
                    if (archive) {
                        for (const file of archive.files) files.push(Object.assign(file, { download: job.index - 1 }));
                        skipped.push(...archive.skipped);
                        await fs.promises.unlink(target);
                    } else {
                        if (result.size > 64 * 1024 * 1024 || (budget.bytes += result.size) > 128 * 1024 * 1024 || ++budget.files > 16) throw new Error('Use at most 16 native binaries, 64 MiB each and 128 MiB total.');
                        files.push({ originalFilename: entry.filename, path: target, download: job.index - 1 });
                    }
                }
                if (signal.aborted) throw new Error('Import cancelled or timed out.');
                if (!files.length) throw new Error('No supported native binaries were found. Select an agent artifact instead of logs or source code.');
                return { ...info, files, skipped };
            });
            if (signal.aborted) { await uploads.command(domain, user, { op: 'discard', token: job.draft.token }); delete job.draft; throw new Error('Import cancelled or timed out.'); }
            job.stage = 'review';
        } catch (ex) { job.stage = signal.aborted ? 'cancelled' : 'failed'; job.error = signal.aborted ? 'Import cancelled or timed out.' : ex.message; }
        finally { clearTimeout(timeout); delete job.controller; active--; job.finished = Date.now(); }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        const owner = key(domain, user);
        if (request.op === 'settings') {
            const settings = githubSettings(domain);
            return { tokenConfigured: !!settings.credential, artifactNames: settings.names };
        }
        if (request.op === 'browse') {
            if (browsing.has(owner) || browsing.size >= 4) throw new Error('Another GitHub lookup is in progress.');
            browsing.add(owner);
            const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
            try { const settings = githubSettings(domain); return await browse(domain, request, token(request.token) || settings.credential, controller.signal, settings); }
            finally { controller.abort(); clearTimeout(timeout); browsing.delete(owner); }
        }
        if (request.op === 'start') {
            if (active >= 2 || (jobs.get(owner) && jobs.get(owner).controller)) throw new Error('Another import is in progress. Try again shortly.');
            if (request.id != null && (typeof request.id !== 'string' || !/^[a-f0-9]{32}$/.test(request.id))) throw new Error('Invalid import ID.');
            const credential = request.kind === 'url' ? undefined : token(request.token) || githubSettings(domain).credential;
            const job = { id: request.id || crypto.randomBytes(16).toString('hex'), stage: 'resolving', controller: new AbortController() };
            const input = Object.assign({}, request); delete input.token;
            jobs.set(owner, job); active++;
            run(job, domain, user, input, credential);
            return report(job);
        }
        const job = jobs.get(owner);
        if (!job || job.id !== request.id) {
            if (request.op === 'get') return { stage: 'unavailable', error: 'Import no longer available. Start it again.' };
            throw new Error('Import no longer available. Start it again.');
        }
        if (request.op === 'cancel') {
            if (job.controller) job.controller.abort();
            else if (job.draft) { await uploads.command(domain, user, { op: 'discard', token: job.draft.token }); delete job.draft; job.stage = 'cancelled'; }
        } else if (request.op !== 'get') throw new Error('Invalid import operation.');
        return report(job);
    }
    const expiry = setInterval(() => { for (const [owner, job] of jobs) if (job.finished && Date.now() - job.finished > 1800000) jobs.delete(owner); }, 600000);
    expiry.unref();
    return { command };
};
