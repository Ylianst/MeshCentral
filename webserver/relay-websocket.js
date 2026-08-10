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
    if (!websocket.time || (request.query.p != 2) || !user) { return; }
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
};
