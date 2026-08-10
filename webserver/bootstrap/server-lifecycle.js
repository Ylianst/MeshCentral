/**
* @description Port probing and HTTP/TLS listener startup for the MeshCentral web server
* @license Apache-2.0
*/

'use strict';

module.exports.createServerLifecycle = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const certificates = options.certificates;
    const os = options.os;

    function checkListenPort(port, addr, callback) {
        const probe = state.net.createServer(function () { });
        state.tcpServer = probe.listen(port, addr, function () { probe.close(function () { if (callback) callback(port, addr); }); }).on('error', function () {
            if (args.exactports) { console.error('ERROR: MeshCentral HTTPS server port ' + port + ' not available.'); process.exit(); }
            else if (port < 65535) { checkListenPort(port + 1, addr, callback); }
            else if (callback) { callback(0); }
        });
    }

    function startWebServer(port, addr) {
        if ((port < 1) || (port > 65535)) return;
        state.args.port = port;
        if (state.tlsServer != null) {
            if (state.args.lanonly == true) {
                state.tcpServer = state.tlsServer.listen(port, addr, function () { console.log('MeshCentral HTTPS server running on port ' + port + ((typeof args.aliasport == 'number') ? (', alias port ' + args.aliasport) : '') + '.'); });
            } else {
                state.tcpServer = state.tlsServer.listen(port, addr, function () {
                    console.log('MeshCentral HTTPS server running on ' + certificates.CommonName + ':' + port + ((typeof args.aliasport == 'number') ? (', alias port ' + args.aliasport) : '') + '.');
                    if (args.relaydns != null) console.log('MeshCentral HTTPS relay server running on ' + args.relaydns[0] + ':' + port + ((typeof args.aliasport == 'number') ? (', alias port ' + args.aliasport) : '') + '.');
                });
                parent.updateServerState('servername', certificates.CommonName);
            }
            parent.debug('https', 'Server listening on ' + ((addr != null) ? addr : '0.0.0.0') + ' port ' + port + '.');
            parent.updateServerState('https-port', port);
            if (args.aliasport != null) parent.updateServerState('https-aliasport', args.aliasport);
        } else {
            state.tcpServer = state.app.listen(port, addr, function () {
                console.log('MeshCentral HTTP server running on port ' + port + ((typeof args.aliasport == 'number') ? (', alias port ' + args.aliasport) : '') + '.');
                if (args.relaydns != null) console.log('MeshCentral HTTP relay server running on ' + args.relaydns[0] + ':' + port + ((typeof args.aliasport == 'number') ? (', alias port ' + args.aliasport) : '') + '.');
            });
            parent.updateServerState('http-port', port);
            if (args.aliasport != null) parent.updateServerState('http-aliasport', args.aliasport);
        }

        if (os.platform() != 'win32') {
            const expectedPort = parent.config.settings.port ? parent.config.settings.port : 443;
            if ((expectedPort != port) && (port >= 1024) && (port < 1034)) {
                console.log('');
                console.log('WARNING: MeshCentral is running without permissions to use ports below 1025.');
                console.log('         Use setcap to grant access to lower ports, or read installation guide.');
                console.log('');
                console.log('   sudo setcap \'cap_net_bind_service=+ep\' `which node` \r\n');
                parent.addServerWarning('Server running without permissions to use ports below 1025.', false);
            }
        }
    }

    function startAltWebServer(port, addr) {
        if ((port < 1) || (port > 65535)) return;
        const agentAliasPort = (args.agentaliasport != null) ? args.agentaliasport : null;
        const agentAliasDns = (args.agentaliasdns != null) ? args.agentaliasdns : null;
        if (state.tlsAltServer != null) {
            if (state.args.lanonly == true) {
                state.tcpAltServer = state.tlsAltServer.listen(port, addr, function () { console.log('MeshCentral HTTPS agent-only server running on port ' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            } else {
                state.tcpAltServer = state.tlsAltServer.listen(port, addr, function () { console.log('MeshCentral HTTPS agent-only server running on ' + ((agentAliasDns != null) ? agentAliasDns : certificates.CommonName) + ':' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            }
            parent.debug('https', 'Server listening on 0.0.0.0 port ' + port + '.');
            parent.updateServerState('https-agent-port', port);
        } else {
            state.tcpAltServer = state.agentapp.listen(port, addr, function () { console.log('MeshCentral HTTP agent-only server running on port ' + port + ((agentAliasPort != null) ? (', alias port ' + agentAliasPort) : '') + '.'); });
            parent.updateServerState('http-agent-port', port);
        }
    }

    return { CheckListenPort: checkListenPort, StartWebServer: startWebServer, StartAltWebServer: startAltWebServer };
};
