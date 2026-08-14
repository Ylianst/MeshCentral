/**
* @description Mesh agent settings generation
* @license Apache-2.0
*/

'use strict';

module.exports.hasUserSession = function (request) {
    return (request != null) && (request.session != null) && (request.session.userid != null);
};

module.exports.isAgentDownloadLocked = function (settings, domain) {
    return (settings != null) && ((settings.lockagentdownload == true) || (domain.lockagentdownload == true));
};

module.exports.createAgentSettings = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkAgentColorString = options.checkAgentColorString;
    const getDomain = options.getDomain;
    const setContentDispositionHeader = options.setContentDispositionHeader;

    function getMshFromRequest(req, res, domain) {
        const settings = parent.config.settings;
        const downloadLocked = module.exports.isAgentDownloadLocked(settings, domain);
        if (downloadLocked && !module.exports.hasUserSession(req)) { return null; }

        var meshcookie = parent.decodeCookie(req.query.id, parent.invitationLinkEncryptionKey);
        if ((meshcookie != null) && (meshcookie.m != null)) { req.query.id = meshcookie.m; }
        var mesh = state.meshes['mesh/' + domain.id + '/' + req.query.id];
        if (mesh == null) { return null; }
        if (downloadLocked && ((domain.id != mesh.domain) || ((state.GetMeshRights(req.session.userid, mesh) & 1) == 0))) { return null; }

        var meshidhex = Buffer.from(req.query.id.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(state.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serverName = state.getWebServerName(domain, req);
        if (typeof state.args.agentaliasdns == 'string') { serverName = state.args.agentaliasdns; }

        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
        var httpsPort = ((state.args.aliasport == null) ? state.args.port : state.args.aliasport);
        if (state.args.agentport != null) { httpsPort = state.args.agentport; }
        if (state.args.agentaliasport != null) { httpsPort = state.args.agentaliasport; }
        if (state.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
            meshsettings += 'MeshServer=local\r\n';
            if ((state.args.localdiscovery != null) && (typeof state.args.localdiscovery.key == 'string') && (state.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + state.args.localdiscovery.key + '\r\n'; }
        }
        if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (state.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + encodeURIComponent(req.query.tag) + '\r\n'; }
        if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
        if ((domain.agentnoproxy === true) || (state.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
        if (state.args.agentconfig) { for (var i in state.args.agentconfig) { meshsettings += state.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
        if (domain.agentcustomization != null) {
            if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; }
        return meshsettings;
    }

    function handleMeshSettingsRequest(req, res) {
        const domain = getDomain(req);
        if (domain == null) { return; }

        const meshsettings = getMshFromRequest(req, res, domain);
        if (meshsettings == null) { res.sendStatus(401); return; }

        var meshagentFilename = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }
        setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename + '.msh', null, 'meshagent.msh');
        res.send(meshsettings);
    }

    return { getMshFromRequest: getMshFromRequest, handleMeshSettingsRequest: handleMeshSettingsRequest };
};
