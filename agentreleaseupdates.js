'use strict';

exports.CreateAgentReleaseUpdates = function (settings, client, entries) {
    const hours = Number.isInteger(settings.checkintervalhours) && settings.checkintervalhours >= 0 && settings.checkintervalhours <= 168 ? settings.checkintervalhours : 24;
    const enabled = settings.enabled !== false;
    const repositories = new Map();
    for (const file of entries) {
        if (!repositories.has(file.repository)) repositories.set(file.repository, { repository: file.repository, tags: new Set(), files: new Set(), failures: 0, nextCheck: 0 });
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
    function latest(releases, repository) {
        if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response.');
        const candidates = releases.filter(release => release && !release.draft && !release.prerelease && version(release.tag_name) &&
            Array.isArray(release.assets) && release.assets.some(asset => asset.name === 'agent-release.json' && asset.size > 0));
        candidates.sort((a, b) => compare(version(b.tag_name), version(a.tag_name)));
        if (!candidates.length) return null;
        const release = candidates[0], tag = release.tag_name;
        const files = release.assets.filter(asset => asset && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(asset.name) && asset.size > 0).map(asset => asset.name);
        const current = Array.from(repository.tags).map(version).filter(Boolean);
        return { tag, sourceUrl: 'https://github.com/' + repository.repository + '/releases/tag/' + encodeURIComponent(tag),
            publishedAt: release.published_at, availableFiles: Array.from(repository.files).filter(name => files.includes(name)),
            updateAvailable: !current.length || current.some(value => compare(version(tag), value) > 0) };
    }
    function status() {
        return { enabled, intervalHours: hours, checking: !!pending, repositories: Array.from(repositories.values(), item => ({
            repository: item.repository, tags: Array.from(item.tags), latest: item.latest || null,
            lastCheck: item.lastCheck, lastSuccess: item.lastSuccess, nextCheck: item.nextCheck, error: item.error
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
                        const response = await client.conditionalJson('https://api.github.com/repos/' + repository.repository + '/releases?per_page=100', repository.etag, controller.signal);
                        if (!response.unchanged) repository.latest = latest(response.data, repository);
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
};
