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
