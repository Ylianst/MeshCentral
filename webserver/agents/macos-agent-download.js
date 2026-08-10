/**
* @description macOS MeshAgent installer download helpers
* @license Apache-2.0
*/

'use strict';

module.exports.handleArchiveError = function (parent, response, error) {
    parent.debug('web', 'Failed to archive macOS MeshAgent package: ' + error);
    if (!response.headersSent) {
        try { response.sendStatus(500); } catch (ex) { }
    } else if (typeof response.destroy == 'function') {
        try { response.destroy(error); } catch (ex) { }
    } else {
        try { response.end(); } catch (ex) { }
    }
};

module.exports.createMacOsAgentHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const getMshFromRequest = options.getMshFromRequest;
    const setContentDispositionHeader = options.setContentDispositionHeader;
    const isAgentDownloadLocked = options.isAgentDownloadLocked;
    const hasUserSession = options.hasUserSession;
    const createArchive = options.createArchive;
    const createInstaller = options.createInstaller;

    return function handleMeshOsxAgentRequest(request, response) {
        const domain = getDomain(request, response);
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { response.sendStatus(404); } catch (ex) { } return; }
        if (request.query.id == null) { response.sendStatus(404); return; }
        if (isAgentDownloadLocked(parent.config.settings, domain) && !hasUserSession(request)) { response.sendStatus(401); return; }

        var agentInfo = parent.meshAgentBinaries[request.query.id];
        if ((domain.meshAgentBinaries != null) && (domain.meshAgentBinaries[request.query.id] != null)) { agentInfo = domain.meshAgentBinaries[request.query.id]; }
        if ((agentInfo == null) || (request.query.meshid == null)) { response.sendStatus(404); return; }
        const settingsRequest = Object.assign({}, request, { query: Object.assign({}, request.query, { id: request.query.meshid }) });
        const meshSettings = getMshFromRequest(settingsRequest, response, domain);
        if (meshSettings == null) { response.sendStatus(401); return; }
        request.query.meshid = settingsRequest.query.id;
        const mesh = state.meshes['mesh/' + domain.id + '/' + request.query.meshid];

        const archive = createArchive();
        archive.on('error', function (err) { module.exports.handleArchiveError(parent, response, err); });
        var archiveName = 'MeshAgent-' + mesh.name + '.zip';
        var executableName = 'meshagent';
        var packageName = 'MeshAgent.pkg';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) {
            archiveName = archiveName.split('MeshAgent').join(domain.agentcustomization.filename);
            executableName = executableName.split('meshagent').join(domain.agentcustomization.filename);
            packageName = packageName.split('MeshAgent').join(domain.agentcustomization.filename);
        }
        var displayName = 'Mesh Agent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.displayname == 'string')) { displayName = displayName.split('Mesh Agent').join(domain.agentcustomization.displayname); }
        var serviceName = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.servicename == 'string')) { serviceName = serviceName.split('meshagent').join(domain.agentcustomization.servicename); }
        var companyName = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.companyname == 'string')) { companyName = companyName.split('meshagent').join(domain.agentcustomization.companyname); }

        setContentDispositionHeader(response, 'application/octet-stream', archiveName, null, 'MeshAgent.zip');
        archive.pipe(response);
        const installerOptions = {
            agentPath: agentInfo.path,
            meshSettings: meshSettings,
            meshName: mesh.name.split(']').join('').split('[').join(''),
            executableName: executableName,
            packageName: packageName,
            displayName: displayName,
            serviceName: serviceName,
            companyName: companyName
        };
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.macosinstallerimage == 'string')) {
            installerOptions.backgroundPath = parent.path.join(parent.datapath, domain.agentcustomization.macosinstallerimage);
        }
        createInstaller(installerOptions).then(function (installer) {
            archive.append(installer.pkg, { name: packageName });
            archive.append(installer.uninstall, { name: 'Uninstall.command', mode: 493 });
            archive.finalize();
        }).catch(function (err) {
            parent.debug('web', 'Failed to build macOS MeshAgent package: ' + err);
            try { response.sendStatus(500); } catch (ex) { }
        });
    };
};
