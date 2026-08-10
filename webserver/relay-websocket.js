/**
* @description Intel AMT relay WebSocket helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasDatabaseFailure = function (error, documents) {
    return (error != null) || !Array.isArray(documents);
};

module.exports.isSelectedDeviceGroup = function (mesh) {
    return (mesh != null) && (mesh.flags != null) && ((mesh.flags & 4) != 0);
};

module.exports.openRecordingFile = function (fileSystem, filename, onError) {
    try { return fileSystem.openSync(filename, 'w'); } catch (error) { onError(error); return null; }
};

module.exports.closeRecordingFile = function (fileSystem, descriptor, onError) {
    try { fileSystem.close(descriptor, function (error) { if (error != null) { onError(error); } }); } catch (error) { onError(error); }
};

module.exports.setupSessionRecording = function (options) {
    const state = options.state;
    const parent = options.parent;
    const domain = options.domain;
    const user = options.user;
    const websocket = options.websocket;
    const request = options.request;
    const node = options.node;
    const ciraConnection = options.ciraConnection;
    const connectivity = options.connectivity;
    if (!(domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf((request.query.p == 2) ? 101 : 100) >= 0))))) { return; }

    var record = true;
    if ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.onlyselectedusers === true) || (domain.sessionrecording.onlyselecteddevicegroups === true))) {
        record = false;
        if (domain.sessionrecording.onlyselecteddevicegroups === true) {
            if (module.exports.isSelectedDeviceGroup(state.meshes[node.meshid])) { record = true; }
        }
        if ((domain.sessionrecording.onlyselectedusers === true) && (user.flags != null) && ((user.flags & 2) != 0)) { record = true; }
    }
    if (!record) { return; }

    const now = new Date(Date.now());
    var username = '';
    if (user._id) { username = '-' + parent.common.makeFilename(user._id.split('/')[2]); }
    const deviceFilename = '-' + parent.common.makeFilename(node.name);
    const filename = 'relaysession' + ((domain.id == '') ? '' : '-') + domain.id + '-' + now.getUTCFullYear() + '-' + state.common.zeroPad(now.getUTCMonth() + 1, 2) + '-' + state.common.zeroPad(now.getUTCDate(), 2) + '-' + state.common.zeroPad(now.getUTCHours(), 2) + '-' + state.common.zeroPad(now.getUTCMinutes(), 2) + '-' + state.common.zeroPad(now.getUTCSeconds(), 2) + username + deviceFilename + '-' + websocket.id + '.mcrec';
    var fullFilename;
    if (domain.sessionrecording.filepath) {
        try { state.fs.mkdirSync(domain.sessionrecording.filepath); } catch (ex) { }
        fullFilename = state.path.join(domain.sessionrecording.filepath, filename);
    } else {
        try { state.fs.mkdirSync(parent.recordpath); } catch (ex) { }
        fullFilename = state.path.join(parent.recordpath, filename);
    }
    const fd = module.exports.openRecordingFile(state.fs, fullFilename, function (err) { parent.debug('relay', 'Relay: Failed to open recording file ' + fullFilename + ': ' + err); });
    if (fd == null) { return; }

    parent.debug('relay', 'Relay: Started recording to file: ' + fullFilename);
    const metadata = {
        magic: 'MeshCentralRelaySession',
        ver: 1,
        userid: user._id,
        username: user.name,
        sessionid: websocket.id,
        ipaddr1: request.clientIp,
        time: new Date().toLocaleString(),
        protocol: (request.query.p == 2) ? 101 : 100,
        nodeid: node._id,
        intelamt: true
    };
    if (ciraConnection != null) { metadata.ipaddr2 = ciraConnection.remoteAddr; }
    else if ((connectivity & 4) != 0) { metadata.ipaddr2 = node.host; }
    if (node.name != null) { metadata.devicename = node.name; }
    websocket.logfile = { fd: fd, lock: false, filename: fullFilename, startTime: Date.now(), size: 0, text: 0, req: request };
    state.meshRelayHandler.recordingEntry(websocket.logfile, 1, 0, JSON.stringify(metadata), function () { });
    websocket.logfile.nodeid = node._id;
    websocket.logfile.meshid = node.meshid;
    websocket.logfile.name = node.name;
    websocket.logfile.icon = node.icon;
    if (request.query.p == 2) { websocket.send(Buffer.from(String.fromCharCode(0xF0), 'binary')); }
};

module.exports.routeToPeerServer = function (parent, websocket, request, user, cookie) {
    if ((parent.multiServer == null) || ((cookie != null) && (cookie.ps == 1))) { return false; }
    var server = parent.GetRoutingServerId(request.query.host, 2);
    if (server != null) {
        if (server.serverid != parent.serverId) {
            parent.debug('web', 'Route Intel AMT CIRA connection to peer server: ' + server.serverid);
            parent.multiServer.createPeerRelay(websocket, request, server.serverid, user);
            return true;
        }
    } else {
        server = parent.GetRoutingServerId(request.query.host, 4);
        if ((server != null) && (server.serverid != parent.serverId)) {
            parent.debug('web', 'Route Intel AMT direct connection to peer server: ' + server.serverid);
            parent.multiServer.createPeerRelay(websocket, request, server.serverid, user);
            return true;
        }
    }
    return false;
};

module.exports.finishSessionRecording = function (options) {
    const state = options.state;
    const parent = options.parent;
    const domain = options.domain;
    const user = options.user;
    const websocket = options.websocket;
    const logfile = websocket.logfile;
    if (logfile == null) { return false; }
    delete websocket.logfile;
    const schedule = options.schedule || setTimeout;
    schedule(function () {
        state.meshRelayHandler.recordingEntry(logfile, 3, 0, 'MeshCentralMCREC', function () {
            module.exports.closeRecordingFile(state.fs, logfile.fd, function (err) { parent.debug('relay', 'Relay: Failed to close recording file ' + logfile.filename + ': ' + err); });
            parent.debug('relay', 'Relay: Finished recording to file: ' + logfile.filename);
            var sessionLength = null;
            if (logfile.startTime != null) { sessionLength = Math.round((Date.now() - logfile.startTime) / 1000) - (options.delayAdjustmentSeconds || 0); }
            const event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: logfile.nodeid, msg: 'Finished recording session' + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: parent.path.basename(logfile.filename), size: logfile.size };
            if (user) { event.userids = [user._id]; }
            const protocol = (((logfile.req == null) || (logfile.req.query == null)) ? null : (logfile.req.query.p == 2) ? 101 : 100);
            if (protocol != null) { event.protocol = parseInt(protocol); }
            const mesh = state.meshes[logfile.meshid];
            if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
            if (logfile.startTime) { event.startTime = logfile.startTime; event.lengthTime = sessionLength; }
            if (logfile.name) { event.name = logfile.name; }
            if (logfile.icon) { event.icon = logfile.icon; }
            parent.DispatchEvent(['*', 'recording', logfile.nodeid, logfile.meshid], state, event);
        }, websocket);
    }, 5000);
    return true;
};

module.exports.logRelaySessionEnd = function (state, parent, domain, user, websocket, request, node, ciraConnection, connectivity) {
    if (!websocket.time || (request.query.p != 2) || !user || (websocket.relayEndLogged === true)) { return false; }
    websocket.relayEndLogged = true;
    const ip = (ciraConnection != null) ? ciraConnection.remoteAddr : (((connectivity & 4) != 0) ? node.host : request.clientIp);
    const seconds = Math.floor((Date.now() - websocket.time) / 1000);
    const event = {
        etype: 'relay',
        action: 'relaylog',
        domain: domain.id,
        userid: user._id,
        username: user.name,
        msgid: 9,
        msgArgs: [websocket.id, request.clientIp, ip, seconds],
        msg: 'Ended relay session "' + websocket.id + '" from ' + request.clientIp + ' to ' + ip + ', ' + seconds + ' second(s)',
        protocol: 101,
        nodeid: node._id
    };
    parent.DispatchEvent(['*', user._id, node._id, node.meshid], state, event);
    return true;
};

module.exports.writeOrQueueCiraRelayData = function (websocket, data) {
    if (websocket.relayTransportClosed === true) { return false; }
    if (websocket.forwardclient != null) {
        try { websocket.forwardclient.write(data); } catch (ex) { }
    } else {
        if (websocket.pendingRelayData == null) { websocket.pendingRelayData = []; }
        websocket.pendingRelayData.push(data);
    }
    return true;
};

module.exports.flushCiraRelayData = function (websocket) {
    const pendingRelayData = websocket.pendingRelayData;
    delete websocket.pendingRelayData;
    if (!Array.isArray(pendingRelayData) || (websocket.forwardclient == null)) { return 0; }
    for (var i = 0; i < pendingRelayData.length; i++) {
        try { websocket.forwardclient.write(pendingRelayData[i]); } catch (ex) { }
    }
    return pendingRelayData.length;
};

module.exports.closeCiraRelayTransport = function (websocket) {
    websocket.relayTransportClosed = true;
    delete websocket.pendingRelayData;
    const forwardclient = websocket.forwardclient;
    const forwardchannel = websocket.forwardchannel;
    delete websocket.forwardclient;
    delete websocket.forwardchannel;
    if (forwardclient != null) {
        if (forwardclient.close) { forwardclient.close(); }
        if (forwardclient.end) { forwardclient.end(); }
        if (forwardclient.chnl) { forwardclient.chnl.close(); }
    }
    if ((forwardchannel != null) && ((forwardclient == null) || (forwardclient.chnl !== forwardchannel))) { forwardchannel.close(); }
};

module.exports.setupCiraRelayTransport = function (options) {
    const state = options.state;
    const parent = options.parent;
    const domain = options.domain;
    const user = options.user;
    const websocket = options.websocket;
    const request = options.request;
    const node = options.node;
    const ciraConnection = options.ciraConnection;
    const connectivity = options.connectivity;
    const tlsConstants = options.tlsConstants;
    const SerialTunnel = options.createSerialTunnel;

    parent.debug('web', 'Opening relay CIRA channel connection to ' + request.query.host + '.');
    var port = 16993;
    if (ciraConnection.tag.boundPorts.indexOf(16992) >= 0) port = 16992;
    if (request.query.p == 2) port += 2;

    if ((port == 16993) || (port == 16995)) {
        var ser = new SerialTunnel();
        var chnl = parent.mpsserver.SetupChannel(ciraConnection, port);
        websocket.forwardchannel = chnl;
        ser.forwardwrite = function (data) { if (data.length > 0) { chnl.write(data); } };
        chnl.onData = function (ciraConnection, data) { if (data.length > 0) { try { ser.updateBuffer(data); } catch (ex) { console.log(ex); } } };
        chnl.onStateChange = function (ciraConnection, channelState) {
            parent.debug('webrelay', 'Relay TLS CIRA state change', channelState);
            if (channelState == 0) { try { websocket.close(); } catch (e) { } }
            if (channelState == 2) {
                if (websocket.relayTransportClosed === true) { return; }
                const tlsoptions = { socket: ser, ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: tlsConstants.SSL_OP_NO_SSLv2 | tlsConstants.SSL_OP_NO_SSLv3 | tlsConstants.SSL_OP_NO_COMPRESSION | tlsConstants.SSL_OP_CIPHER_SERVER_PREFERENCE | tlsConstants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION, rejectUnauthorized: false };
                if (request.query.tls1only == 1) {
                    tlsoptions.secureProtocol = 'TLSv1_method';
                } else {
                    tlsoptions.minVersion = 'TLSv1';
                }
                var tlsock = state.tls.connect(tlsoptions, function () { parent.debug('webrelay', 'CIRA Secure TLS Connection'); websocket._socket.resume(); });
                tlsock.chnl = chnl;
                tlsock.setEncoding('binary');
                tlsock.on('error', function (err) { parent.debug('webrelay', 'CIRA TLS Connection Error', err); });
                tlsock.on('data', function (data) {
                    if (websocket.interceptor) { data = websocket.interceptor.processAmtData(data); }
                    try { websocket.send(data); } catch (ex) { }
                });
                websocket.forwardclient = tlsock;
                websocket.forwardclient.xtls = 1;
                delete websocket.forwardchannel;
                module.exports.flushCiraRelayData(websocket);
                websocket.forwardclient.onStateChange = function (ciraConnection, channelState) {
                    parent.debug('webrelay', 'Relay CIRA state change', channelState);
                    if (channelState == 0) { try { websocket.close(); } catch (e) { } }
                };
                websocket.forwardclient.onData = function (ciraConnection, data) {
                    if (websocket.interceptor) { data = websocket.interceptor.processAmtData(data); }
                    if (data.length > 0) {
                        if (websocket.logfile == null) {
                            try { websocket.send(data); } catch (e) { }
                        } else {
                            state.meshRelayHandler.recordingEntry(websocket.logfile, 2, 0, data, function () { try { websocket.send(data); } catch (ex) { console.log(ex); } });
                        }
                    }
                };
                websocket.forwardclient.onSendOk = function (ciraConnection) { };
            }
        };
    } else {
        websocket.forwardclient = parent.mpsserver.SetupChannel(ciraConnection, port);
        websocket.forwardclient.xtls = 0;
        websocket._socket.resume();
        websocket.forwardclient.onStateChange = function (ciraConnection, channelState) {
            parent.debug('webrelay', 'Relay CIRA state change', channelState);
            if (channelState == 0) { try { websocket.close(); } catch (e) { } }
        };
        websocket.forwardclient.onData = function (ciraConnection, data) {
            if (websocket.interceptor) { data = websocket.interceptor.processAmtData(data); }
            if (data.length > 0) {
                if (websocket.logfile == null) {
                    try { websocket.send(data); } catch (e) { }
                } else {
                    state.meshRelayHandler.recordingEntry(websocket.logfile, 2, 0, data, function () { try { websocket.send(data); } catch (ex) { console.log(ex); } });
                }
            }
        };
        websocket.forwardclient.onSendOk = function (ciraConnection) { };
    }

    websocket.on('message', function (data) {
        if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }
        if (websocket.interceptor) { data = websocket.interceptor.processBrowserData(data); }
        if (websocket.logfile == null) {
            module.exports.writeOrQueueCiraRelayData(websocket, data);
        } else {
            state.meshRelayHandler.recordingEntry(websocket.logfile, 2, 2, data, function () { module.exports.writeOrQueueCiraRelayData(websocket, data); });
        }
    });

    websocket.on('error', function (err) {
        console.log('CIRA server websocket error from ' + request.clientIp + ', ' + err.toString().split('\r')[0] + '.');
        parent.debug('webrelay', 'Websocket relay closed on error.');
        module.exports.logRelaySessionEnd(state, parent, domain, user, websocket, request, node, ciraConnection, connectivity);
        module.exports.closeCiraRelayTransport(websocket);
        module.exports.finishSessionRecording({ state: state, parent: parent, domain: domain, user: user, websocket: websocket, delayAdjustmentSeconds: 5 });
    });

    websocket.on('close', function () {
        parent.debug('webrelay', 'Websocket relay closed.');
        module.exports.logRelaySessionEnd(state, parent, domain, user, websocket, request, node, ciraConnection, connectivity);
        module.exports.closeCiraRelayTransport(websocket);
        module.exports.finishSessionRecording({ state: state, parent: parent, domain: domain, user: user, websocket: websocket, delayAdjustmentSeconds: 5 });
    });

    if (request.query.p == 1) {
        parent.debug('webrelaydata', 'INTERCEPTOR1', { host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
        websocket.interceptor = state.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
        websocket.interceptor.blockAmtStorage = true;
    } else if (request.query.p == 2) {
        parent.debug('webrelaydata', 'INTERCEPTOR2', { user: node.intelamt.user, pass: node.intelamt.pass });
        websocket.interceptor = state.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass });
        websocket.interceptor.blockAmtStorage = true;
    }
};

module.exports.setupDirectRelayTransport = function (options) {
    const state = options.state;
    const parent = options.parent;
    const domain = options.domain;
    const user = options.user;
    const websocket = options.websocket;
    const request = options.request;
    const node = options.node;
    const ciraConnection = options.ciraConnection;
    const connectivity = options.connectivity;
    const tlsConstants = options.tlsConstants;

    parent.debug('webrelay', 'Opening relay TCP socket connection to ' + request.query.host + '.');

    websocket.on('message', function (msg) {
        if (typeof msg == 'string') { msg = Buffer.from(msg, 'binary'); }
        if (websocket.interceptor) { msg = websocket.interceptor.processBrowserData(msg); }
        if (websocket.logfile == null) {
            try { websocket.forwardclient.write(msg); } catch (ex) { }
        } else {
            state.meshRelayHandler.recordingEntry(websocket.logfile, 2, 2, msg, function () { try { websocket.forwardclient.write(msg); } catch (ex) { } });
        }
    });

    websocket.on('error', function (err) {
        console.log('Error with relay web socket connection from ' + request.clientIp + ', ' + err.toString().split('\r')[0] + '.');
        parent.debug('webrelay', 'Error with relay web socket connection from ' + request.clientIp + '.');
        module.exports.logRelaySessionEnd(state, parent, domain, user, websocket, request, node, ciraConnection, connectivity);
        if (websocket.forwardclient) { try { websocket.forwardclient.destroy(); } catch (e) { } }
        module.exports.finishSessionRecording({ state: state, parent: parent, domain: domain, user: user, websocket: websocket, delayAdjustmentSeconds: 0 });
    });

    websocket.on('close', function () {
        parent.debug('webrelay', 'Closing relay web socket connection to ' + request.query.host + '.');
        module.exports.logRelaySessionEnd(state, parent, domain, user, websocket, request, node, ciraConnection, connectivity);
        if (websocket.forwardclient) { try { websocket.forwardclient.destroy(); } catch (e) { } }
        module.exports.finishSessionRecording({ state: state, parent: parent, domain: domain, user: user, websocket: websocket, delayAdjustmentSeconds: 0 });
    });

    var port = 16992;
    if (node.intelamt.tls > 0) port = 16993;
    if ((request.query.p == 2) || (request.query.p == 4)) port += 2;

    if (node.intelamt.tls == 0) {
        websocket.forwardclient = new state.net.Socket();
        websocket.forwardclient.setEncoding('binary');
        websocket.forwardclient.xstate = 0;
        websocket.forwardclient.forwardwsocket = websocket;
        websocket._socket.resume();
    } else {
        var tlsoptions = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: tlsConstants.SSL_OP_NO_SSLv2 | tlsConstants.SSL_OP_NO_SSLv3 | tlsConstants.SSL_OP_NO_COMPRESSION | tlsConstants.SSL_OP_CIPHER_SERVER_PREFERENCE | tlsConstants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION, rejectUnauthorized: false };
        if (request.query.tls1only == 1) {
            tlsoptions.secureProtocol = 'TLSv1_method';
        } else {
            tlsoptions.minVersion = 'TLSv1';
        }
        websocket.forwardclient = state.tls.connect(port, node.host, tlsoptions, function () {
            parent.debug('webrelay', user.name + ' - TLS connected to ' + node.host + ':' + port + '.');
            websocket.forwardclient.xstate = 1;
            websocket._socket.resume();
        });
        websocket.forwardclient.setEncoding('binary');
        websocket.forwardclient.xstate = 0;
        websocket.forwardclient.forwardwsocket = websocket;
    }

    websocket.forwardclient.on('data', function (data) {
        if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }
        if (state.parent.debugLevel >= 1) {
            parent.debug('webrelaydata', user.name + ' - TCP relay data from ' + node.host + ', ' + data.length + ' bytes.');
        }
        if (websocket.interceptor) { data = websocket.interceptor.processAmtData(data); }
        if (websocket.logfile == null) {
            try { websocket.send(data); } catch (e) { }
        } else {
            state.meshRelayHandler.recordingEntry(websocket.logfile, 2, 0, data, function () { try { websocket.send(data); } catch (e) { } });
        }
    });

    websocket.forwardclient.on('close', function () {
        parent.debug('webrelay', user.name + ' - TCP relay disconnected from ' + node.host + ':' + port + '.');
        try { websocket.close(); } catch (e) { }
    });

    websocket.forwardclient.on('error', function (err) {
        parent.debug('webrelay', user.name + ' - TCP relay error from ' + node.host + ':' + port + ': ' + err);
        try { websocket.close(); } catch (e) { }
    });

    if (request.query.p == 1) { websocket.interceptor = state.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass }); }
    else if (request.query.p == 2) { websocket.interceptor = state.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass }); }

    if (node.intelamt.tls == 0) {
        websocket.forwardclient.connect(port, node.host, function () {
            parent.debug('webrelay', user.name + ' - TCP relay connected to ' + node.host + ':' + port + '.');
            websocket.forwardclient.xstate = 1;
            websocket._socket.resume();
        });
    }
};

module.exports.recordRelayStartAndUserAccess = function (state, parent, domain, user, websocket, request, node, ciraConnection, connectivity) {
    if (user == null) { return; }
    if (request.query.p == 2) {
        const ip = (ciraConnection != null) ? ciraConnection.remoteAddr : (((connectivity & 4) != 0) ? node.host : request.clientIp);
        const event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: 13, msgArgs: [websocket.id, request.clientIp, ip], msg: 'Started relay session "' + websocket.id + '" from ' + request.clientIp + ' to ' + ip, protocol: 101, nodeid: node._id };
        parent.DispatchEvent(['*', user._id], state, event);
    }
    const timeNow = Math.floor(Date.now() / 1000);
    if (user.access < (timeNow - 300)) {
        user.access = timeNow;
        parent.db.SetUser(user);
        const message = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
        if (parent.db.changeStream) { message.noact = 1; }
        const targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
        parent.DispatchEvent(targets, state, message);
    }
};
