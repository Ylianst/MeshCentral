/**
* @description Base MeshCentral web server state creation
* @license Apache-2.0
*/

'use strict';

module.exports.createBaseState = function (parent, database, args, certificates, loadModule, environment) {
    const state = {};
    state.fs = loadModule('fs');
    state.net = loadModule('net');
    state.tls = loadModule('tls');
    state.path = loadModule('path');
    state.os = loadModule('os');
    state.bodyParser = loadModule('body-parser');
    state.exphbs = loadModule('express-handlebars');
    state.crypto = loadModule('crypto');
    state.common = loadModule('./common.js');
    state.express = loadModule('express');
    state.meshAgentHandler = loadModule('./meshagent.js');
    state.meshRelayHandler = loadModule('./meshrelay.js');
    state.meshDeviceFileHandler = loadModule('./meshdevicefile.js');
    state.meshDesktopMultiplexHandler = loadModule('./meshdesktopmultiplex.js');
    state.meshIderHandler = loadModule('./amt/amt-ider.js');
    state.meshUserHandler = loadModule('./meshuser.js');
    state.interceptor = loadModule('./interceptor');
    state.uaparser = loadModule('ua-parser-js');
    state.uaclienthints = loadModule('ua-client-hints-js');

    const proxyUrl = environment.HTTP_PROXY || environment.HTTPS_PROXY || environment.http_proxy || environment.https_proxy;
    if (proxyUrl) { state.httpsProxyAgent = new (loadModule('https-proxy-agent').HttpsProxyAgent)(proxyUrl); }

    state.args = args;
    state.parent = parent;
    state.filespath = parent.filespath;
    state.db = database;
    state.app = state.express();
    if (args.agentport) { state.agentapp = state.express(); }
    if (args.compression === true) {
        const compression = loadModule('compression');
        state.app.use(compression({ filter: function (request, response) {
            if (request.path == '/devicefile.ashx') { return false; }
            if ((args.relaydns != null) && (args.relaydns.indexOf(request.hostname) >= 0)) { return false; }
            return compression.filter(request, response);
        } }));
    }
    state.app.disable('x-powered-by');
    state.tlsServer = null;
    state.tcpServer = null;
    state.certificates = certificates;
    state.users = {};
    state.meshes = {};
    state.userGroups = {};
    return state;
};
