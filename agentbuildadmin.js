'use strict';

const storage = require('./agentbuildstorage');

exports.CreateAgentBuildAdmin = function (parent, db, catalog) {
    const uploads = require('./agentbuildupload').CreateAgentBuildUpload(parent.parent, catalog);
    const imports = require('./agentbuildimport').CreateAgentBuildImport(uploads);
    parent.agentBuildUsage = require('./agentbuildusage').CreateAgentBuildUsage(parent, db);
    const deployments = require('./agentdeployment').CreateAgentDeployment(parent, db, catalog, parent.agentBuilds);
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
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
