/**
* @description Mesh agent and companion tool download helpers
* @license Apache-2.0
*/

'use strict';

module.exports.getSessionUser = function (users, request) {
    if ((request == null) || (request.session == null) || (request.session.userid == null)) { return null; }
    return users[request.session.userid] || null;
};

module.exports.hasDatabaseFailure = function (error, documents) {
    return (error != null) || !Array.isArray(documents);
};

module.exports.hasNodeAccess = function (state, user, node) {
    return state.GetNodeRights(user, node.meshid, node._id) != 0;
};

module.exports.getAgentInfo = function (defaultBinaries, domainBinaries, agentId) {
    if ((domainBinaries != null) && (domainBinaries[agentId] != null)) { return domainBinaries[agentId]; }
    return defaultBinaries[agentId];
};

module.exports.getMeshRelayUrl = function (state, domain, request) {
    const httpsPort = (state.args.aliasport == null) ? state.args.port : state.args.aliasport;
    return 'wss://' + state.getWebServerName(domain, request) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : (domain.id + '/')) + 'meshrelay.ashx';
};

module.exports.getCoreDownloadUrl = function (request, parameter, coreName) {
    const requestPath = request.originalUrl.split('?')[0];
    return requestPath + '?' + parameter + '=' + encodeURIComponent(coreName) + ((request.query.key != null) ? ('&key=' + encodeURIComponent(request.query.key)) : '');
};

module.exports.sendMeshCoreList = function (parent, request, response) {
    var html = '<html><head><title>Mesh Agents Cores</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
    html += '<tr style="background-color:lightgray"><th>Name</th><th>Size</th><th>Comp</th><th>Decompressed Hash SHA384</th></tr>';
    for (var name in parent.defaultMeshCores) {
        html += '<tr><td>' + name.split(' ').join('&nbsp;') + '</td><td style="text-align:right"><a download href="' + module.exports.getCoreDownloadUrl(request, 'dlcore', name) + '">' + parent.defaultMeshCores[name].length + '</a></td><td style="text-align:right"><a download href="' + module.exports.getCoreDownloadUrl(request, 'dlccore', name) + '">' + parent.defaultMeshCoresDeflate[name].length + '</a></td><td>' + Buffer.from(parent.defaultMeshCoresHash[name], 'binary').toString('hex') + '</td></tr>';
    }
    html += '</table><a href="' + request.originalUrl.split('?')[0] + (request.query.key ? ('?key=' + encodeURIComponent(request.query.key)) : '') + '">Mesh Agents</a></body></html>';
    response.send(html);
};

module.exports.sendMeshCore = function (parent, setContentDispositionHeader, request, response, compressed) {
    const name = compressed ? request.query.dlccore : request.query.dlcore;
    const cores = compressed ? parent.defaultMeshCoresDeflate : parent.defaultMeshCores;
    const data = cores[name];
    if ((data == null) || (!compressed && (data.length < 5))) { try { response.sendStatus(404); } catch (ex) { } return; }
    if (compressed) {
        setContentDispositionHeader(response, 'application/octet-stream', name + '.js.deflate', null, 'meshcore.js.deflate');
        response.send(data);
    } else {
        setContentDispositionHeader(response, 'application/octet-stream', encodeURIComponent(name) + '.js', null, 'meshcore.js');
        response.send(data.slice(4));
    }
};

module.exports.sendAgentList = function (parent, domain, user, request, response, coreDumpsAllowed) {
    var html = '<html><head><title>Mesh Agents</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
    html += '<tr style="background-color:lightgray"><th>ID</th><th>Description</th><th>Link</th><th>Size</th><th>SHA384</th><th>MeshCmd</th></tr>';
    const originalUrl = request.originalUrl.split('?')[0];
    for (var agentId in parent.meshAgentBinaries) {
        if ((agentId >= 10000) && (agentId != 10005)) continue;
        const agentInfo = module.exports.getAgentInfo(parent.meshAgentBinaries, domain.meshAgentBinaries, agentId);
        html += '<tr><td>' + agentInfo.id + '</td><td>' + agentInfo.desc.split(' ').join('&nbsp;') + '</td>';
        html += '<td><a download href="' + originalUrl + '?id=' + agentInfo.id + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">' + agentInfo.rname + '</a>';
        if ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(parent.config.settings.agentcoredumpusers)) && (parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0))) {
            if ((agentId == 3) || (agentId == 4)) { html += ', <a download href="' + originalUrl + '?id=' + agentInfo.id + '&pdb=1' + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">PDB</a>'; }
        }
        if (agentInfo.zdata != null) { html += ', <a download href="' + originalUrl + '?id=' + agentInfo.id + '&zip=1' + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">ZIP</a>'; }
        html += '</td><td>' + agentInfo.size + '</td><td>' + agentInfo.hashhex + '</td>';
        html += '<td><a download href="' + originalUrl + '?meshcmd=' + agentInfo.id + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">' + agentInfo.rname.replace('agent', 'cmd') + '</a></td></tr>';
    }
    html += '</table><a href="' + originalUrl + '?cores=1' + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">MeshCores</a> ';
    if (coreDumpsAllowed) { html += '<a href="' + originalUrl + '?dumps=1' + (request.query.key ? ('&key=' + encodeURIComponent(request.query.key)) : '') + '">MeshAgent Crash Dumps</a>'; }
    html += '</body></html>';
    response.send(html);
};

module.exports.sendAgentInstallScript = function (state, parent, domain, setContentDispositionHeader, request, response) {
    const scriptInfo = parent.meshAgentInstallScripts[request.query.script];
    if (scriptInfo == null) { try { response.sendStatus(404); } catch (ex) { } return; }
    setContentDispositionHeader(response, 'application/octet-stream', scriptInfo.rname, null, 'script');
    var data = scriptInfo.data;
    var cmdoptions = { wgetoptionshttp: '', wgetoptionshttps: '', curloptionshttp: '-L ', curloptionshttps: '-L ' };
    if (state.isTrustedCert(domain) != true) {
        cmdoptions.wgetoptionshttps += '--no-check-certificate ';
        cmdoptions.curloptionshttps += '-k ';
    }
    if (domain.agentnoproxy === true) {
        cmdoptions.wgetoptionshttp += '--no-proxy ';
        cmdoptions.wgetoptionshttps += '--no-proxy ';
        cmdoptions.curloptionshttp += '--noproxy \'*\' ';
        cmdoptions.curloptionshttps += '--noproxy \'*\' ';
    }
    for (var option in cmdoptions) { data = data.split('{{{' + option + '}}}').join(cmdoptions[option]); }
    response.send(data);
};

module.exports.sendMeshCmd = function (state, parent, domain, setContentDispositionHeader, request, response) {
    var agentId = parseInt(request.query.meshcmd);
    var signedId = null;
    if (agentId == 3) { signedId = 11000; }
    else if (agentId == 4) { signedId = 11001; }
    else if (agentId == 43) { signedId = 11002; }
    if ((signedId != null) && (parent.meshAgentBinaries[signedId] != null)) {
        const signedPath = parent.meshAgentBinaries[signedId].path;
        var stats = null;
        try { stats = state.fs.statSync(signedPath); } catch (ex) { }
        if (stats != null) {
            setContentDispositionHeader(response, 'application/octet-stream', (agentId == 43) ? 'meshcmd-arm64.exe' : 'meshcmd.exe', null, 'meshcmd');
            response.sendFile(signedPath);
            return;
        }
    }

    if (((agentId == 3) || (agentId == 4)) && (parent.meshAgentBinaries[agentId + 10000] != null)) { agentId += 10000; }
    const agentInfo = module.exports.getAgentInfo(parent.meshAgentBinaries, domain.meshAgentBinaries, agentId);
    if ((agentInfo == null) || (parent.defaultMeshCmd == null)) { try { response.sendStatus(404); } catch (ex) { } return; }
    setContentDispositionHeader(response, 'application/octet-stream', 'meshcmd' + ((request.query.meshcmd <= 4) ? '.exe' : ''), null, 'meshcmd');
    response.statusCode = 200;
    if (agentInfo.signedMeshCmdPath != null) {
        response.sendFile(agentInfo.signedMeshCmdPath);
    } else {
        parent.exeHandler.streamExeWithJavaScript({ platform: agentInfo.platform, sourceFileName: agentInfo.path, destinationStream: response, js: Buffer.from(parent.defaultMeshCmd, 'utf8'), peinfo: agentInfo.pe });
    }
};

module.exports.sendMeshTool = function (state, parent, rootDirectory, setContentDispositionHeader, action, response) {
    const tools = {
        winrouter: { key: 'MeshCentralRouter', filename: 'MeshCentralRouter.exe' },
        winassistant: { key: 'MeshCentralAssistant', filename: 'MeshCentralAssistant.exe' },
        macrouter: { key: 'MeshCentralRouterMacOS', filename: 'MeshCentralRouter.dmg' }
    };
    const tool = tools[action];
    if (tool == null) { return false; }
    var filePath = null;
    if (parent.meshToolsBinaries[tool.key]) { filePath = parent.meshToolsBinaries[tool.key].path; }
    if ((filePath == null) || !state.fs.existsSync(filePath)) { filePath = state.path.join(rootDirectory, 'agents', tool.filename); }
    if (state.fs.existsSync(filePath)) {
        setContentDispositionHeader(response, 'application/octet-stream', tool.filename, null, tool.filename);
        try { response.sendFile(filePath); } catch (ex) { }
    } else {
        try { response.sendStatus(404); } catch (ex) { }
    }
    return true;
};

module.exports.sendGenericMeshAction = function (state, domain, user, setContentDispositionHeader, request, response) {
    const action = {
        username: user.name,
        password: '',
        serverId: state.agentCertificateHashHex.toUpperCase(),
        serverHttpsHash: Buffer.from(state.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(),
        debugLevel: 0
    };
    if (request.query.key != null) { action.loginKey = request.query.key; }
    if (state.args.lanonly != true) { action.serverUrl = module.exports.getMeshRelayUrl(state, domain, request); }
    setContentDispositionHeader(response, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
    response.send(JSON.stringify(action, null, ' '));
};

module.exports.sendRouteMeshAction = function (state, domain, user, setContentDispositionHeader, request, response) {
    const nodeIdSplit = request.query.nodeid.split('/');
    if ((nodeIdSplit[0] != 'node') || (nodeIdSplit[1] != domain.id)) { try { response.sendStatus(401); } catch (ex) { } return; }
    state.db.Get(request.query.nodeid, function (err, nodes) {
        if (module.exports.hasDatabaseFailure(err, nodes) || (nodes.length != 1)) { try { response.sendStatus(401); } catch (ex) { } return; }
        const node = nodes[0];
        if (!module.exports.hasNodeAccess(state, user, node)) { try { response.sendStatus(401); } catch (ex) { } return; }
        const action = {
            action: request.query.meshaction,
            localPort: 1234,
            remoteName: node.name,
            remoteNodeId: node._id,
            remoteTarget: null,
            remotePort: 3389,
            username: '',
            password: '',
            serverId: state.agentCertificateHashHex.toUpperCase(),
            serverHttpsHash: Buffer.from(state.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(),
            debugLevel: 0
        };
        if (user != null) { action.username = user.name; }
        if (request.query.key != null) { action.loginKey = request.query.key; }
        if (state.args.lanonly != true) { action.serverUrl = module.exports.getMeshRelayUrl(state, domain, request); }
        setContentDispositionHeader(response, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
        response.send(JSON.stringify(action, null, ' '));
    });
};

module.exports.sendAgentSelfInstaller = function (parent, domain, getMshFromRequest, setContentDispositionHeader, request, response) {
    const meshSettings = getMshFromRequest(request, response, domain);
    if (meshSettings == null) { try { response.sendStatus(401); } catch (ex) { } return; }
    const agentId = parseInt(request.query.meshinstall);
    const agentInfo = module.exports.getAgentInfo(parent.meshAgentBinaries, domain.meshAgentBinaries, agentId);
    const scriptInfo = parent.meshAgentInstallScripts[6];
    if ((agentInfo == null) || (scriptInfo == null) || (agentInfo.platform == 'win32')) { try { response.sendStatus(404); } catch (ex) { } return; }

    var tokens;
    const msh = {};
    const lines = meshSettings.split('\r').join('').split('\n');
    for (var i in lines) { tokens = lines[i].split('='); if (tokens.length == 2) { msh[tokens[0]] = tokens[1]; } }
    const js = scriptInfo.data.replace('var msh = {};', 'var msh = ' + JSON.stringify(msh) + ';');
    var filename = 'meshagent';
    if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { filename = domain.agentcustomization.filename; }
    setContentDispositionHeader(response, 'application/octet-stream', filename, null, 'meshagent');
    if (agentInfo.mtime != null) { response.setHeader('Last-Modified', agentInfo.mtime.toUTCString()); }
    response.statusCode = 200;
    parent.exeHandler.streamExeWithJavaScript({ platform: agentInfo.platform, sourceFileName: agentInfo.path, destinationStream: response, js: Buffer.from(js, 'utf8'), peinfo: agentInfo.pe });
};

module.exports.sendAgentPdb = function (state, parent, agentInfo, setContentDispositionHeader, request, response) {
    const user = module.exports.getSessionUser(state.users, request);
    if (user == null) { try { response.sendStatus(404); } catch (ex) { } return; }
    const allowed = (user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(parent.config.settings.agentcoredumpusers)) && (parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0));
    if (allowed && ((agentInfo.id == 3) || (agentInfo.id == 4))) {
        const filename = (agentInfo.id == 3) ? 'MeshService.pdb' : 'MeshService64.pdb';
        const executable = (agentInfo.id == 3) ? 'MeshService-signed.exe' : 'MeshService64-signed.exe';
        setContentDispositionHeader(response, 'application/octet-stream', filename, null, filename);
        if (agentInfo.mtime != null) { response.setHeader('Last-Modified', agentInfo.mtime.toUTCString()); }
        try { response.sendFile(agentInfo.path.split(executable).join(filename)); } catch (ex) { }
        return;
    }
    try { response.sendStatus(404); } catch (ex) { }
};

module.exports.sendAgentBinary = function (domain, agentInfo, setContentDispositionHeader, request, response) {
    var filename = agentInfo.rname;
    if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { filename = domain.agentcustomization.filename; }
    if (agentInfo.rname.endsWith('.apk') && !filename.endsWith('.apk')) { filename += '.apk'; }
    if (agentInfo.mtime != null) { response.setHeader('Last-Modified', agentInfo.mtime.toUTCString()); }
    if (request.query.zip == 1) {
        if (agentInfo.zdata != null) {
            setContentDispositionHeader(response, 'application/octet-stream', filename + '.zip', null, 'meshagent.zip');
            response.send(agentInfo.zdata);
        } else {
            try { response.sendStatus(404); } catch (ex) { }
        }
        return;
    }
    setContentDispositionHeader(response, 'application/octet-stream', filename, null, 'meshagent');
    if (agentInfo.data == null) { response.sendFile(agentInfo.path); } else { response.send(agentInfo.data); }
};

module.exports.sendCustomizedWindowsAgent = function (state, parent, domain, agentInfo, checkAgentColorString, setContentDispositionHeader, request, response) {
    const meshCookie = parent.decodeCookie(request.query.meshid, parent.invitationLinkEncryptionKey);
    if ((meshCookie != null) && (meshCookie.m != null)) { request.query.meshid = meshCookie.m; }
    const mesh = state.meshes['mesh/' + domain.id + '/' + request.query.meshid];
    if (mesh == null) { try { response.sendStatus(401); } catch (ex) { } return; }
    if ((parent.config.settings != null) && ((parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
        if ((domain.id != mesh.domain) || ((state.GetMeshRights(request.session.userid, mesh) & 1) == 0)) { try { response.sendStatus(401); } catch (ex) { } return; }
    }

    const meshIdHex = Buffer.from(request.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
    const serverIdHex = Buffer.from(state.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
    var httpsPort = (state.args.aliasport == null) ? state.args.port : state.args.aliasport;
    if (state.args.agentport != null) { httpsPort = state.args.agentport; }
    if (state.args.agentaliasport != null) { httpsPort = state.args.agentaliasport; }

    var filename = mesh.name;
    filename = filename.split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split(' ').join('').split('\'').join('');
    if (agentInfo.rname.endsWith('.exe')) { filename = agentInfo.rname.substring(0, agentInfo.rname.length - 4) + '-' + filename + '.exe'; } else { filename = agentInfo.rname + '-' + filename; }
    if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) {
        filename = filename.split('meshagent').join(domain.agentcustomization.filename).split('MeshAgent').join(domain.agentcustomization.filename);
    }

    var serverName = state.getWebServerName(domain, request);
    if (typeof state.args.agentaliasdns == 'string') { serverName = state.args.agentaliasdns; }
    var domainPath = (domain.dns == null) ? domain.id : '';
    if (domainPath != '') domainPath += '/';
    var meshSettings = '';
    if (request.query.ac != '4') {
        meshSettings += '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshIdHex + '\r\nServerID=' + serverIdHex + '\r\n';
        if (state.args.lanonly != true) { meshSettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + domainPath + 'agent.ashx\r\n'; } else {
            meshSettings += 'MeshServer=local\r\n';
            if ((state.args.localdiscovery != null) && (typeof state.args.localdiscovery.key == 'string') && (state.args.localdiscovery.key.length > 0)) { meshSettings += 'DiscoveryKey=' + state.args.localdiscovery.key + '\r\n'; }
        }
        if ((request.query.tag != null) && (typeof request.query.tag == 'string') && (state.common.isAlphaNumeric(request.query.tag) == true)) { meshSettings += 'Tag=' + encodeURIComponent(request.query.tag) + '\r\n'; }
        if ((request.query.installflags != null) && (request.query.installflags != 0) && (parseInt(request.query.installflags) == request.query.installflags)) { meshSettings += 'InstallFlags=' + parseInt(request.query.installflags) + '\r\n'; }
    }
    if (request.query.id == '10006') {
        if (request.query.ac != null) { meshSettings += 'AutoConnect=' + request.query.ac + '\r\n'; }
        if (state.args.assistantconfig) { for (var i in state.args.assistantconfig) { meshSettings += state.args.assistantconfig[i] + '\r\n'; } }
        if (domain.assistantconfig) { for (var i in domain.assistantconfig) { meshSettings += domain.assistantconfig[i] + '\r\n'; } }
        if ((domain.assistantnoproxy === true) || (state.args.lanonly == true)) { meshSettings += 'ignoreProxyFile=1\r\n'; }
        if ((domain.assistantcustomization != null) && (typeof domain.assistantcustomization == 'object')) {
            if (typeof domain.assistantcustomization.title == 'string') { meshSettings += 'Title=' + domain.assistantcustomization.title + '\r\n'; }
            if (typeof domain.assistantcustomization.image == 'string') {
                try { meshSettings += 'Image=' + Buffer.from(state.fs.readFileSync(parent.getConfigFilePath(domain.assistantcustomization.image)), 'binary').toString('base64') + '\r\n'; } catch (ex) { console.log(ex); }
            }
            if (request.query.ac != '4') {
                if (typeof domain.assistantcustomization.filename == 'string') { filename = filename.split('MeshCentralAssistant').join(domain.assistantcustomization.filename); }
            } else {
                if (typeof domain.assistantcustomization.filename == 'string') { filename = domain.assistantcustomization.filename + '.exe'; } else { filename = 'MeshCentralAssistant.exe'; }
            }
        }
    } else {
        if (state.args.agentconfig) { for (var i in state.args.agentconfig) { meshSettings += state.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshSettings += domain.agentconfig[i] + '\r\n'; } }
        if ((domain.agentnoproxy === true) || (state.args.lanonly == true)) { meshSettings += 'ignoreProxyFile=1\r\n'; }
        if (domain.agentcustomization != null) {
            if (domain.agentcustomization.displayname != null) { meshSettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshSettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshSettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshSettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshSettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshSettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshSettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshSettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshSettings += 'translation=' + domain.agentTranslations + '\r\n'; }
    }
    setContentDispositionHeader(response, 'application/octet-stream', filename, null, agentInfo.rname);
    if (agentInfo.mtime != null) { response.setHeader('Last-Modified', agentInfo.mtime.toUTCString()); }
    parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: agentInfo.path, destinationStream: response, msh: meshSettings, peinfo: agentInfo.pe });
};
