/**
 * Apache Guacamole (guacd) Web-RDP relay.
 *
 * The browser never chooses a network destination. guacd can only reach a
 * one-shot loopback listener which is backed by an authenticated MeshAgent
 * tunnel to the selected node.
 */

'use strict';

const Net = require('net');
const WebSocket = require('ws');
const { StringDecoder } = require('string_decoder');

const MESHRIGHT_ADMIN = 0xFFFFFFFF;
const MESHRIGHT_REMOTECONTROL = 8;
const MESHRIGHT_REMOTEVIEWONLY = 0x00000100;
const MESHRIGHT_DESKLIMITEDINPUT = 0x00001000;
const MESHRIGHT_RELAY = 0x00200000;
const PROTOCOL_WEBRDP = 201;

function encodeInstruction(elements) {
    return elements.map(function (element) {
        const value = (element == null) ? '' : String(element);
        return value.length + '.' + value;
    }).join(',') + ';';
}

function InstructionParser(onInstruction) {
    this.buffer = '';
    this.onInstruction = onInstruction;
}

InstructionParser.prototype.receive = function (data) {
    this.buffer += data;
    while (this.buffer.length > 0) {
        let offset = 0;
        const elements = [];
        while (true) {
            const dot = this.buffer.indexOf('.', offset);
            if (dot < 0) return;
            const lengthText = this.buffer.substring(offset, dot);
            if (!/^\d+$/.test(lengthText)) throw new Error('Invalid Guacamole instruction length.');
            const length = parseInt(lengthText);
            const start = dot + 1;
            const end = start + length;
            if (this.buffer.length <= end) return;
            elements.push(this.buffer.substring(start, end));
            const separator = this.buffer[end];
            offset = end + 1;
            if (separator === ';') break;
            if (separator !== ',') throw new Error('Invalid Guacamole instruction separator.');
        }
        const raw = this.buffer.substring(0, offset);
        this.buffer = this.buffer.substring(offset);
        this.onInstruction(elements[0], elements.slice(1), raw);
    }
};

module.exports.CreateGuacamoleRelay = function (parent, ws, req, args, domain) {
    const obj = {
        ws: ws,
        relayActive: false,
        closed: false,
        decoder: new StringDecoder('utf8')
    };
    const guacdConfig = parent.parent.config.settings.guacd || {};
    const guacdHost = (typeof guacdConfig.host == 'string') ? guacdConfig.host : '127.0.0.1';
    const guacdPort = (typeof guacdConfig.port == 'number') ? guacdConfig.port : 4822;
    const connectTimeout = (typeof guacdConfig.connecttimeoutms == 'number') ? guacdConfig.connecttimeoutms : 10000;

    function safeSend(data, callback) {
        if ((obj.closed === true) || (ws.readyState !== WebSocket.OPEN)) return;
        try { ws.send(data, callback); } catch (ex) { close(); }
    }

    function sendError(code, message) {
        safeSend(encodeInstruction(['error', message || code, code || 0x0200]));
    }

    function close(arg) {
        if (obj.closed === true) return;
        obj.closed = true;
        if (obj.connectTimer) clearTimeout(obj.connectTimer);
        if (obj.guacdSocket) { try { obj.guacdSocket.destroy(); } catch (ex) { } }
        if (obj.relaySocket) { try { obj.relaySocket.destroy(); } catch (ex) { } }
        if (obj.wsClient) { try { obj.wsClient.close(); } catch (ex) { } }
        if (obj.tcpServer) { try { obj.tcpServer.close(); } catch (ex) { } }

        if ((obj.startTime != null) && (obj.nodeid != null)) {
            const sessionSeconds = Math.round((Date.now() - obj.startTime) / 1000);
            const user = parent.users[obj.userid];
            const event = { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.userid, username: user ? user.name : null, sessionid: obj.sessionid, msg: 'Left Web-RDP session after ' + sessionSeconds + ' second(s).', protocol: PROTOCOL_WEBRDP };
            parent.parent.DispatchEvent(['*', obj.nodeid, obj.userid, obj.meshid], obj, event);
        }

        if ((arg == null) || (arg === 1)) { try { ws.close(); } catch (ex) { } }
    }

    function connectAgentTunnel(node, port, callback) {
        const mesh = parent.meshes[node.meshid];
        const relayNodeId = (mesh != null) ? mesh.relayid : null;

        function start(tunnelNodeId) {
            const cookieContent = { userid: obj.userid, domainid: domain.id, nodeid: tunnelNodeId, tcpport: port };
            if (relayNodeId != null) {
                if (typeof node.host != 'string') { callback(new Error('The device has no address for its relay.')); return; }
                cookieContent.tcpaddr = node.host;
            } else if (node.mtype === 3) {
                cookieContent.lc = 1;
            }

            obj.tcpServer = new Net.Server();
            obj.tcpServer.on('error', function () { callback(new Error('Unable to create MeshAgent tunnel listener.')); });
            obj.tcpServer.on('connection', function (socket) {
                if (obj.relaySocket != null) { socket.destroy(); return; }
                obj.relaySocket = socket;
                obj.relaySocket.pause();
                obj.tcpServer.close();

                const options = { rejectUnauthorized: false };
                const protocol = args.tlsoffload ? 'ws' : 'wss';
                const domainadd = ((domain.dns == null) && (domain.id != '')) ? domain.id + '/' : '';
                const relayCookie = parent.parent.encodeCookie(cookieContent, parent.parent.loginCookieEncryptionKey);
                const relayPath = ((node.mtype === 3) && (relayNodeId == null)) ? 'localrelay.ashx' : 'meshrelay.ashx';
                const url = protocol + '://localhost:' + args.port + '/' + domainadd + relayPath + '?p=10&auth=' + relayCookie + ((domain.id != '') ? '&domainid=' + domain.id : '');
                obj.wsClient = new WebSocket(url, options);
                obj.wsClient.on('message', function (data) {
                    if (obj.relayActive === false) {
                        if ((data.toString() === 'c') || (data.toString() === 'cr')) {
                            obj.relayActive = true;
                            obj.relaySocket.resume();
                        }
                        return;
                    }
                    try {
                        const command = JSON.parse(data.toString());
                        if ((command != null) && (command.ctrlChannel === '102938')) return;
                    } catch (ex) { }
                    obj.wsClient._socket.pause();
                    obj.relaySocket.write(data, function () { if (obj.wsClient && obj.wsClient._socket) obj.wsClient._socket.resume(); });
                });
                obj.wsClient.on('close', function () { close(); });
                obj.wsClient.on('error', function () { close(); });
                obj.relaySocket.on('data', function (chunk) {
                    obj.relaySocket.pause();
                    if (obj.wsClient != null) obj.wsClient.send(chunk, function () { if (obj.relaySocket) obj.relaySocket.resume(); });
                });
                obj.relaySocket.on('error', function () { close(); });
                obj.relaySocket.on('end', function () { close(); });
            });
            obj.tcpServer.listen(0, '127.0.0.1', function () {
                obj.tcpServerPort = obj.tcpServer.address().port;
                // guacd shares this network namespace and reaches this listener on loopback.
                callback(null, obj.tcpServerPort);
            });
        }

        if (relayNodeId == null) { start(node._id); return; }
        parent.GetNodeWithRights(domain, obj.userid, relayNodeId, function (relayNode, rights, visible) {
            if (obj.closed === true) return;
            if ((relayNode == null) || (visible === false) || ((rights & (MESHRIGHT_REMOTECONTROL | MESHRIGHT_RELAY)) === 0)) {
                callback(new Error('Not authorized to use the device relay.'));
                return;
            }
            start(relayNodeId);
        });
    }

    function saveRdpCredentials(credentials) {
        if ((obj.savepass !== true) || (domain.allowsavingdevicecredentials === false)) return;
        parent.db.Get(obj.nodeid, function (err, nodes) {
            if ((err != null) || !Array.isArray(nodes) || (nodes.length !== 1)) return;
            const node = nodes[0];
            if ((node.rdp == null) || (typeof node.rdp != 'object')) node.rdp = {};
            node.rdp[obj.userid] = { d: credentials.domain || '', u: credentials.username, p: credentials.password };
            parent.db.Set(node);
            const event = { etype: 'node', action: 'changenode', nodeid: obj.nodeid, domain: domain.id, userid: obj.userid, node: parent.CloneSafeNode(node), msg: 'Changed RDP credentials' };
            if (parent.db.changeStream) event.noact = 1;
            parent.parent.DispatchEvent(parent.CreateMeshDispatchTargets(node.meshid, [obj.nodeid]), obj, event);
        });
    }

    function connectGuacd(credentials, width, height, dpi, tunnelPort) {
        obj.guacdSocket = Net.connect({ host: guacdHost, port: guacdPort });
        obj.connectTimer = setTimeout(function () { sendError(0x0204, 'guacd connection timed out.'); close(); }, connectTimeout);
        let handshakeComplete = false;
        const parser = new InstructionParser(function (opcode, parameters, raw) {
            if (handshakeComplete === true) { safeSend(raw); return; }
            if (opcode === 'args') {
                const names = parameters;
                const values = {
                    hostname: '127.0.0.1', port: String(tunnelPort), username: credentials.username || '', password: credentials.password || '', domain: credentials.domain || '',
                    security: 'any', 'ignore-cert': 'true', 'resize-method': 'display-update', 'read-only': obj.viewonly ? 'true' : 'false',
                    width: String(width), height: String(height), dpi: String(dpi), 'enable-wallpaper': 'true', 'enable-font-smoothing': 'true'
                };
                obj.guacdSocket.write(encodeInstruction(['size', width, height, dpi]));
                obj.guacdSocket.write(encodeInstruction(['audio']));
                obj.guacdSocket.write(encodeInstruction(['video']));
                obj.guacdSocket.write(encodeInstruction(['image', 'image/webp', 'image/png', 'image/jpeg']));
                obj.guacdSocket.write(encodeInstruction(['timezone', obj.timezone || 'Europe/Amsterdam']));
                obj.guacdSocket.write(encodeInstruction(['name', parent.users[obj.userid] ? parent.users[obj.userid].name : 'MeshCentral']));
                obj.guacdSocket.write(encodeInstruction(['connect'].concat(names.map(function (name) {
                    // guacd 1.6 includes the newest supported protocol version
                    // as the first pseudo-argument and expects it back.
                    if (name.startsWith('VERSION_')) return name;
                    return values[name] || '';
                }))));
            } else if (opcode === 'ready') {
                handshakeComplete = true;
                clearTimeout(obj.connectTimer);
                obj.startTime = Date.now();
                obj.sessionid = parameters[0] || parent.parent.crypto.randomBytes(9).toString('hex');
                saveRdpCredentials(credentials);
                safeSend(raw);
                const user = parent.users[obj.userid];
                parent.parent.DispatchEvent(['*', obj.nodeid, obj.userid, obj.meshid], obj, { etype: 'relay', action: 'relaylog', domain: domain.id, nodeid: obj.nodeid, userid: obj.userid, username: user ? user.name : null, sessionid: obj.sessionid, msg: 'Started Web-RDP session.', protocol: PROTOCOL_WEBRDP });
            } else if (opcode === 'error') {
                safeSend(raw);
                close();
            }
        });
        obj.guacdSocket.on('connect', function () { obj.guacdSocket.write(encodeInstruction(['select', 'rdp'])); });
        obj.guacdSocket.on('data', function (chunk) {
            try {
                const text = obj.decoder.write(chunk);
                if (handshakeComplete === true) safeSend(text); else parser.receive(text);
            } catch (ex) { sendError(0x0200, ex.message); close(); }
        });
        obj.guacdSocket.on('error', function (err) { sendError(0x0202, 'Unable to connect to guacd: ' + err.message); close(); });
        obj.guacdSocket.on('end', function () { close(); });
    }

    function begin(node, credentials, port, init) {
        obj.savepass = (init.savepass === true) && (init.useServerCreds !== true);
        connectAgentTunnel(node, port, function (err, tunnelPort) {
            if (err != null) { sendError(0x0202, err.message); close(); return; }
            connectGuacd(credentials, init.width, init.height, init.dpi, tunnelPort);
        });
    }

    function authorize(init) {
        let cookie = null;
        try { cookie = parent.parent.decodeCookie(init.cookie, parent.parent.loginCookieEncryptionKey); } catch (ex) { }
        if ((cookie == null) || (cookie.domainid !== domain.id) || (typeof cookie.nodeid != 'string') || (typeof cookie.userid != 'string')) { close(); return; }
        if ((req.session != null) && (req.session.userid != null) && (req.session.userid !== cookie.userid)) { close(); return; }
        obj.nodeid = cookie.nodeid;
        obj.userid = cookie.userid;
        obj.timezone = init.timezone;
        parent.GetNodeWithRights(domain, obj.userid, obj.nodeid, function (node, rights, visible) {
            if (obj.closed === true) return;
            if ((node == null) || (visible === false) || ((rights & MESHRIGHT_REMOTECONTROL) === 0)) { close(); return; }
            obj.meshid = node.meshid;
            obj.viewonly = ((rights !== MESHRIGHT_ADMIN) && ((rights & (MESHRIGHT_REMOTEVIEWONLY | MESHRIGHT_DESKLIMITEDINPUT)) !== 0));
            node = parent.common.unEscapeLinksFieldName(node);

            let credentials = {
                domain: (typeof init.domain == 'string') ? init.domain : '',
                username: (typeof init.username == 'string') ? init.username : '',
                password: (typeof init.password == 'string') ? init.password : ''
            };
            if (init.useServerCreds === true) {
                if ((node.rdp != null) && (node.rdp[obj.userid] != null)) credentials = { domain: node.rdp[obj.userid].d || '', username: node.rdp[obj.userid].u || '', password: node.rdp[obj.userid].p || '' };
                else if ((node.rdp != null) && (typeof node.rdp.u == 'string')) credentials = { domain: node.rdp.d || '', username: node.rdp.u, password: node.rdp.p || '' };
            }
            const port = (typeof cookie.tcpport == 'number') ? cookie.tcpport : ((typeof node.rdpport == 'number') ? node.rdpport : 3389);

            begin(node, credentials, port, init);
        });
    }

    let initialized = false;
    ws.on('message', function (data) {
        if (initialized === false) {
            initialized = true;
            let init;
            try { init = JSON.parse(data.toString()); } catch (ex) { close(); return; }
            if ((init == null) || (init.action !== 'connect')) { close(); return; }
            init.width = Math.max(320, Math.min(8192, parseInt(init.width) || 1280));
            init.height = Math.max(200, Math.min(8192, parseInt(init.height) || 720));
            init.dpi = Math.max(48, Math.min(384, parseInt(init.dpi) || 96));
            authorize(init);
            return;
        }
        const text = data.toString();
        if (text.startsWith('0.,')) { safeSend(text); return; } // Tunnel stability ping.
        if (obj.guacdSocket != null) obj.guacdSocket.write(text);
    });
    ws.on('error', function () { close(); });
    ws.on('close', function () { close(0); });
    ws._socket.resume();
    return obj;
};
