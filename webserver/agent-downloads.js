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
