'use strict';

const storage = require('./agentbuildstorage');

exports.CreateAgentBuildAdmin = function (parent, db, catalog) {
    const uploads = require('./agentbuildupload').CreateAgentBuildUpload(parent.parent, catalog);
    const imports = require('./agentbuildimport').CreateAgentBuildImport(uploads);
    parent.agentBuildUsage = require('./agentbuildusage').CreateAgentBuildUsage(parent, db);
    const deployments = require('./agentdeployment').CreateAgentDeployment(parent, db, catalog, parent.agentBuilds);
    let defaultDownload = null, defaultError = null;
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        if (request.area === 'defaults') {
            const defaults = parent.parent.agentDefaults;
            if (!defaults) throw new Error('Default agent downloads are unavailable.');
            if (!['status', 'retry', 'updates'].includes(request.op)) throw new Error('Invalid operation');
            if (request.op === 'updates') {
                if (domain.id !== '') throw new Error('Manage shared defaults from the default server domain.');
                defaults.checkUpdates().catch(() => {});
            }
            if (request.op === 'retry') {
                if (domain.id !== '') throw new Error('Manage shared defaults from the default server domain.');
                if (!defaultDownload && !defaults.status().busy) {
                    defaultError = null;
                    defaultDownload = (async function () {
                        const files = [], expected = defaults.status().files, inventory = await catalog.getCatalog(domain);
                        for (const build of inventory.builds) {
                            for (const artifact of build.artifacts) {
                                if (!artifact.matches || !expected.some(x => x.sha384 === artifact.sha384 && x.size === artifact.size)) continue;
                                const item = await catalog.getArtifact(build.id, artifact.id, artifact.filename, domain);
                                files.push({ path: item.path, size: artifact.size, sha384: artifact.sha384 });
                            }
                        }
                        await defaults.prepare(files);
                    })().catch(err => { defaultError = err.message; }).finally(() => { defaultDownload = null; });
                    parent.parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Checking default agent downloads' });
                }
            }
            return Object.assign(defaults.status(), { busy: !!defaultDownload || defaults.status().busy, error: defaultError, canManage: domain.id === '' });
        }
        if (request.area === 'import') return imports.command(domain, user, request, loginToken);
        if (request.area === 'upload') return uploads.command(domain, user, request, loginToken);
        if (request.area === 'deployment') return deployments.command(domain, user, request, loginToken);
        if (request.area === 'usage') return parent.agentBuildUsage.page(domain, request);
        if (request.area !== 'catalog') throw new Error('Invalid operation');
        if (request.op === 'list') return parent.agentBuildUsage.catalogUsage(domain, await catalog.getCatalog(domain));
        if (!['archive', 'restore', 'remove'].includes(request.op)) throw new Error('Invalid operation');
        return catalog.use(domain, request.build, async function () {
            const build = (await catalog.getCatalog(domain)).builds.find(x => x.id === request.build);
            if (!build) throw new Error('Build is unavailable');
            if (await deployments.references(domain, build.id)) throw new Error('This build is referenced by a deployment. Complete or cancel that deployment first.');
            if (request.op === 'remove' && await parent.agentBuildUsage.references(domain, build)) throw new Error('This build is still installed, pinned or awaiting deployment. Archive it instead.');
            await catalog.manage(domain, build.id, request.op);
            parent.parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Agent build ' + request.op + ': ' + build.name });
            return { changed: true };
        }, true);
    }
    return { command, receive: uploads.receive };
};
