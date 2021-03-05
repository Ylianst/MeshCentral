/*
Copyright 2018-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
* @description APF/CIRA Client for Duktape
* @author Joko Sastriawan & Ylian Saint-Hilaire
* @copyright Intel Corporation 2020-2021
* @license Apache-2.0
* @version v0.0.2
*/

function CreateAPFClient(parent, args) {
    if ((args.clientuuid == null) || (args.clientuuid.length != 36)) return null; // Require a UUID if this exact length

    var obj = {};
    obj.parent = parent;
    obj.args = args;
    obj.http = require('http');
    obj.net = require('net');
    obj.forwardClient = null;
    obj.downlinks = {};
    obj.pfwd_idx = 0;
    obj.timer = null; // Keep alive timer

    // obj.onChannelClosed
    // obj.onJsonControl

    // Function copied from common.js
    function ReadInt(v, p) { return (v.charCodeAt(p) * 0x1000000) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); }; // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
    function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); };
    function hex2rstr(d) { var r = '', m = ('' + d).match(/../g), t; while (t = m.shift()) { r += String.fromCharCode('0x' + t); } return r; };
    function char2hex(i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); }; // Convert decimal to hex
    function rstr2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += char2hex(input.charCodeAt(i)); } return r; }; // Convert a raw string to a hex string
    function d2h(d) { return (d / 256 + 1 / 512).toString(16).substring(2, 4); }
    function buf2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += d2h(input[i]); } return r; };
    function Debug(str) { if (obj.parent.debug) { console.log(str); } }
    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }
    function strToGuid(s) { s = s.replace(/-/g, ''); var ret = s.substring(6, 8) + s.substring(4, 6) + s.substring(2, 4) + s.substring(0, 2) + s.substring(10, 12) + s.substring(8, 10) + s.substring(14, 16) + s.substring(12, 14) + s.substring(16, 20) + s.substring(20); return ret; }
    function binzerostring(len) { var res = ''; for (var l = 0; l < len; l++) { res += String.fromCharCode(0 & 0xFF); } return res; }

    // CIRA state
    var CIRASTATE = {
        INITIAL: 0,
        PROTOCOL_VERSION_SENT: 1,
        AUTH_SERVICE_REQUEST_SENT: 2,
        AUTH_REQUEST_SENT: 3,
        PFWD_SERVICE_REQUEST_SENT: 4,
        GLOBAL_REQUEST_SENT: 5,
        FAILED: -1
    }
    obj.cirastate = CIRASTATE.INITIAL;

    // REDIR state
    var REDIR_TYPE = {
        REDIR_UNKNOWN: 0,
        REDIR_SOL: 1,
        REDIR_KVM: 2,
        REDIR_IDER: 3
    }

    // redirection start command
    obj.RedirectStartSol = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x53, 0x4F, 0x4C, 0x20);
    obj.RedirectStartKvm = String.fromCharCode(0x10, 0x01, 0x00, 0x00, 0x4b, 0x56, 0x4d, 0x52);
    obj.RedirectStartIder = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x49, 0x44, 0x45, 0x52);

    // Intel AMT forwarded port list for non-TLS mode
    //var pfwd_ports = [16992, 623, 16994, 5900];
    var pfwd_ports = [ 16992, 16993 ];

    // protocol definitions
    var APFProtocol = {
        UNKNOWN: 0,
        DISCONNECT: 1,
        SERVICE_REQUEST: 5,
        SERVICE_ACCEPT: 6,
        USERAUTH_REQUEST: 50,
        USERAUTH_FAILURE: 51,
        USERAUTH_SUCCESS: 52,
        GLOBAL_REQUEST: 80,
        REQUEST_SUCCESS: 81,
        REQUEST_FAILURE: 82,
        CHANNEL_OPEN: 90,
        CHANNEL_OPEN_CONFIRMATION: 91,
        CHANNEL_OPEN_FAILURE: 92,
        CHANNEL_WINDOW_ADJUST: 93,
        CHANNEL_DATA: 94,
        CHANNEL_CLOSE: 97,
        PROTOCOLVERSION: 192,
        KEEPALIVE_REQUEST: 208,
        KEEPALIVE_REPLY: 209,
        KEEPALIVE_OPTIONS_REQUEST: 210,
        KEEPALIVE_OPTIONS_REPLY: 211,
        JSON_CONTROL: 250 // This is a Mesh specific command that sends JSON to and from the MPS server.
    }

    var APFDisconnectCode = {
        HOST_NOT_ALLOWED_TO_CONNECT: 1,
        PROTOCOL_ERROR: 2,
        KEY_EXCHANGE_FAILED: 3,
        RESERVED: 4,
        MAC_ERROR: 5,
        COMPRESSION_ERROR: 6,
        SERVICE_NOT_AVAILABLE: 7,
        PROTOCOL_VERSION_NOT_SUPPORTED: 8,
        HOST_KEY_NOT_VERIFIABLE: 9,
        CONNECTION_LOST: 10,
        BY_APPLICATION: 11,
        TOO_MANY_CONNECTIONS: 12,
        AUTH_CANCELLED_BY_USER: 13,
        NO_MORE_AUTH_METHODS_AVAILABLE: 14,
        INVALID_CREDENTIALS: 15,
        CONNECTION_TIMED_OUT: 16,
        BY_POLICY: 17,
        TEMPORARILY_UNAVAILABLE: 18
    }

    var APFChannelOpenFailCodes = {
        ADMINISTRATIVELY_PROHIBITED: 1,
        CONNECT_FAILED: 2,
        UNKNOWN_CHANNEL_TYPE: 3,
        RESOURCE_SHORTAGE: 4,
    }

    var APFChannelOpenFailureReasonCode = {
        AdministrativelyProhibited: 1,
        ConnectFailed: 2,
        UnknownChannelType: 3,
        ResourceShortage: 4,
    }

    obj.onSecureConnect = function onSecureConnect(resp, ws, head) {
        Debug("APF Secure WebSocket connected.");
        //console.log(JSON.stringify(resp));                
        obj.forwardClient.tag = { accumulator: [] };
        obj.forwardClient.ws = ws;
        obj.forwardClient.ws.on('end', function () {
            Debug("APF: Connection is closing.");
            if (obj.timer != null) { clearInterval(obj.timer); obj.timer = null; }
            if (obj.onChannelClosed) { obj.onChannelClosed(obj); }
        });

        obj.forwardClient.ws.on('data', function (data) {
            obj.forwardClient.tag.accumulator += hex2rstr(buf2hex(data));
            try {
                var len = 0;
                do {
                    len = ProcessData(obj.forwardClient);
                    if (len > 0) { obj.forwardClient.tag.accumulator = obj.forwardClient.tag.accumulator.slice(len); }
                    if (obj.cirastate == CIRASTATE.FAILED) {
                        Debug("APF: in a failed state, destroying socket.");
                        obj.forwardClient.ws.end();
                    }
                } while (len > 0);
            } catch (ex) { Debug(ex); }
        });

        obj.forwardClient.ws.on('error', function (e) {
            Debug("APF: Connection error, ending connecting.");
            if (obj.timer != null) { clearInterval(obj.timer); obj.timer = null; }
        });

        obj.state = CIRASTATE.INITIAL;
        if ((typeof obj.args.conntype == 'number') && (obj.args.conntype != 0)) {
            SendJsonControl(obj.forwardClient.ws, { action: 'connType', value: obj.args.conntype });
            if (obj.args.meiState != null) { SendJsonControl(obj.forwardClient.ws, { action: 'meiState', value: obj.args.meiState }); }
        }
        SendProtocolVersion(obj.forwardClient.ws, obj.args.clientuuid);
        SendServiceRequest(obj.forwardClient.ws, 'auth@amt.intel.com');
    }

    obj.updateMeiState = function (state) { SendJsonControl(obj.forwardClient.ws, { action: 'meiState', value: state }); }
    obj.sendMeiDeactivationState = function (state) { SendJsonControl(obj.forwardClient.ws, { action: 'deactivate', value: state }); }
    obj.sendStartTlsHostConfigResponse = function (state) { SendJsonControl(obj.forwardClient.ws, { action: 'startTlsHostConfig', value: state }); }
    obj.sendStopConfigurationResponse = function (state) { SendJsonControl(obj.forwardClient.ws, { action: 'stopConfiguration', value: state }); }

    function SendJsonControl(socket, o) {
        var data = JSON.stringify(o)
        socket.write(String.fromCharCode(APFProtocol.JSON_CONTROL) + IntToStr(data.length) + data);
        Debug("APF: Send JSON control: " + data);
    }

    function SendProtocolVersion(socket, uuid) {
        var data = String.fromCharCode(APFProtocol.PROTOCOLVERSION) + IntToStr(1) + IntToStr(0) + IntToStr(0) + hex2rstr(strToGuid(uuid)) + binzerostring(64);
        socket.write(data);
        Debug("APF: Send protocol version 1 0 " + uuid);
        obj.cirastate = CIRASTATE.PROTOCOL_VERSION_SENT;
    }

    function SendServiceRequest(socket, service) {
        var data = String.fromCharCode(APFProtocol.SERVICE_REQUEST) + IntToStr(service.length) + service;
        socket.write(data);
        Debug("APF: Send service request " + service);
        if (service == 'auth@amt.intel.com') {
            obj.cirastate = CIRASTATE.AUTH_SERVICE_REQUEST_SENT;
        } else if (service == 'pfwd@amt.intel.com') {
            obj.cirastate = CIRASTATE.PFWD_SERVICE_REQUEST_SENT;
        }
    }

    function SendUserAuthRequest(socket, user, pass) {
        var service = "pfwd@amt.intel.com";
        var data = String.fromCharCode(APFProtocol.USERAUTH_REQUEST) + IntToStr(user.length) + user + IntToStr(service.length) + service;
        //password auth
        data += IntToStr(8) + 'password';
        data += binzerostring(1) + IntToStr(pass.length) + pass;
        socket.write(data);
        Debug("APF: Send username password authentication to MPS");
        obj.cirastate = CIRASTATE.AUTH_REQUEST_SENT;
    }

    function SendGlobalRequestPfwd(socket, amthostname, amtport) {
        var tcpipfwd = 'tcpip-forward';
        var data = String.fromCharCode(APFProtocol.GLOBAL_REQUEST) + IntToStr(tcpipfwd.length) + tcpipfwd + binzerostring(1, 1);
        data += IntToStr(amthostname.length) + amthostname + IntToStr(amtport);
        socket.write(data);
        Debug("APF: Send tcpip-forward " + amthostname + ":" + amtport);
        obj.cirastate = CIRASTATE.GLOBAL_REQUEST_SENT;
    }

    function SendKeepAliveRequest(socket) {
        socket.write(String.fromCharCode(APFProtocol.KEEPALIVE_REQUEST) + IntToStr(255));
        Debug("APF: Send keepalive request");
    }

    function SendKeepAliveReply(socket, cookie) {
        socket.write(String.fromCharCode(APFProtocol.KEEPALIVE_REPLY) + IntToStr(cookie));
        Debug("APF: Send keepalive reply");
    }

    function ProcessData(socket) {
        var cmd = socket.tag.accumulator.charCodeAt(0);
        var len = socket.tag.accumulator.length;
        var data = socket.tag.accumulator;
        if (len == 0) { return 0; }

        // Respond to MPS according to obj.cirastate
        switch (cmd) {
            case APFProtocol.SERVICE_ACCEPT: {
                var slen = ReadInt(data, 1), service = data.substring(5, 6 + slen);
                Debug("APF: Service request to " + service + " accepted.");
                if (service == 'auth@amt.intel.com') {
                    if (obj.cirastate >= CIRASTATE.AUTH_SERVICE_REQUEST_SENT) {
                        SendUserAuthRequest(socket.ws, obj.args.mpsuser, obj.args.mpspass);
                    }
                } else if (service == 'pfwd@amt.intel.com') {
                    if (obj.cirastate >= CIRASTATE.PFWD_SERVICE_REQUEST_SENT) {
                        SendGlobalRequestPfwd(socket.ws, obj.args.clientname, pfwd_ports[obj.pfwd_idx++]);
                    }
                }
                return 5 + slen;
            }
            case APFProtocol.REQUEST_SUCCESS: {
                if (len >= 5) {
                    var port = ReadInt(data, 1);
                    Debug("APF: Request to port forward " + port + " successful.");
                    // iterate to pending port forward request
                    if (obj.pfwd_idx < pfwd_ports.length) {
                        SendGlobalRequestPfwd(socket.ws, obj.args.clientname, pfwd_ports[obj.pfwd_idx++]);
                    } else {
                        // no more port forward, now setup timer to send keep alive
                        Debug("APF: Start keep alive for every " + obj.args.mpskeepalive + " ms.");
                        obj.timer = setInterval(function () {
                            SendKeepAliveRequest(obj.forwardClient.ws);
                        }, obj.args.mpskeepalive);//
                    }
                    return 5;
                }
                Debug("APF: Request successful.");
                return 1;
            }
            case APFProtocol.USERAUTH_SUCCESS: {
                Debug("APF: User Authentication successful");
                // Send Pfwd service request
                SendServiceRequest(socket.ws, 'pfwd@amt.intel.com');
                return 1;
            }
            case APFProtocol.USERAUTH_FAILURE: {
                Debug("APF: User Authentication failed");
                obj.cirastate = CIRASTATE.FAILED;
                return 14;
            }
            case APFProtocol.KEEPALIVE_REQUEST: {
                Debug("APF: Keep Alive Request with cookie: " + ReadInt(data, 1));
                SendKeepAliveReply(socket.ws, ReadInt(data, 1));
                return 5;
            }
            case APFProtocol.KEEPALIVE_REPLY: {
                Debug("APF: Keep Alive Reply with cookie: " + ReadInt(data, 1));
                return 5;
            }
            // Channel management
            case APFProtocol.CHANNEL_OPEN: {
                // Parse CHANNEL OPEN request
                var p_res = parseChannelOpen(data);
                Debug("APF: CHANNEL_OPEN request: " + JSON.stringify(p_res));
                // Check if target port is in pfwd_ports
                if (pfwd_ports.indexOf(p_res.target_port) >= 0) {
                    // Connect socket to that port
                    var chan = obj.net.createConnection({ host: obj.args.clientaddress, port: p_res.target_port }, function () {
                        //require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: "CHANNEL_OPEN-open" });
                        // obj.downlinks[p_res.sender_chan].setEncoding('binary');//assume everything is binary, not interpreting
                        SendChannelOpenConfirm(socket.ws, p_res);
                    });

                    // Setup flow control
                    chan.maxInWindow = p_res.window_size; // Oddly, we are using the same window size as the other side.
                    chan.curInWindow = 0;

                    chan.on('data', function (ddata) {
                        // Relay data to fordwardclient
                        // TODO: Implement flow control
                        SendChannelData(socket.ws, p_res.sender_chan, ddata);
                    });

                    chan.on('error', function (e) {
                        //Debug("Downlink connection error: " + e);
                        SendChannelOpenFailure(socket.ws, p_res);
                    });

                    chan.on('end', function () {
                        var chan = obj.downlinks[p_res.sender_chan];
                        if (chan != null) {
                            Debug("Socket ends.");
                            try { SendChannelClose(socket.ws, p_res.sender_chan); } catch (ex) { }
                            delete obj.downlinks[p_res.sender_chan];
                        }
                    });

                    obj.downlinks[p_res.sender_chan] = chan;
                } else {
                    // Not a supported port, fail the connection
                    SendChannelOpenFailure(socket.ws, p_res);
                }
                return p_res.len;
            }
            case APFProtocol.CHANNEL_OPEN_CONFIRMATION: {
                Debug("APF: CHANNEL_OPEN_CONFIRMATION");
                return 17;
            }
            case APFProtocol.CHANNEL_CLOSE: {
                var rcpt_chan = ReadInt(data, 1);
                Debug("APF: CHANNEL_CLOSE: " + rcpt_chan);
                try { obj.downlinks[rcpt_chan].end(); } catch (ex) { }
                return 5;
            }
            case APFProtocol.CHANNEL_DATA: {
                Debug("APF: CHANNEL_DATA: " + JSON.stringify(rstr2hex(data)));
                var rcpt_chan = ReadInt(data, 1);
                var chan_data_len = ReadInt(data, 5);
                var chan_data = data.substring(9, 9 + chan_data_len);
                var chan = obj.downlinks[rcpt_chan];
                if (chan != null) {
                    chan.curInWindow += chan_data_len;
                    try {
                        chan.write(Buffer.from(chan_data, 'binary'), function () {
                            Debug("Write completed.");
                            // If the incoming window is over half used, send an adjust.
                            if (this.curInWindow > (this.maxInWindow / 2)) { SendChannelWindowAdjust(socket.ws, rcpt_chan, this.curInWindow); this.curInWindow = 0; }
                        });
                    } catch (ex) { Debug("Cannot forward data to downlink socket."); }
                }
                return 9 + chan_data_len;
            }
            case APFProtocol.CHANNEL_WINDOW_ADJUST: {
                Debug("APF: CHANNEL_WINDOW_ADJUST");
                return 9;
            }
            case APFProtocol.JSON_CONTROL: {
                Debug("APF: JSON_CONTROL");
                var len = ReadInt(data, 1);
                if (obj.onJsonControl) { var o = null; try { o = JSON.parse(data.substring(5, 5 + len)); } catch (ex) { } if (o != null) { obj.onJsonControl(o); } }
                return 5 + len;
            }
            default: {
                Debug("CMD: " + cmd + " is not implemented.");
                obj.cirastate = CIRASTATE.FAILED;
                return 0;
            }
        }
    }

    function parseChannelOpen(data) {
        var result = { cmd: APFProtocol.CHANNEL_OPEN };
        var chan_type_slen = ReadInt(data, 1);
        result.chan_type = data.substring(5, 5 + chan_type_slen);
        result.sender_chan = ReadInt(data, 5 + chan_type_slen);
        result.window_size = ReadInt(data, 9 + chan_type_slen);
        var c_len = ReadInt(data, 17 + chan_type_slen);
        result.target_address = data.substring(21 + chan_type_slen, 21 + chan_type_slen + c_len);
        result.target_port = ReadInt(data, 21 + chan_type_slen + c_len);
        var o_len = ReadInt(data, 25 + chan_type_slen + c_len);
        result.origin_address = data.substring(29 + chan_type_slen + c_len, 29 + chan_type_slen + c_len + o_len);
        result.origin_port = ReadInt(data, 29 + chan_type_slen + c_len + o_len);
        result.len = 33 + chan_type_slen + c_len + o_len;
        return result;
    }

    function SendChannelOpenFailure(socket, chan_data) {
        socket.write(String.fromCharCode(APFProtocol.CHANNEL_OPEN_FAILURE) + IntToStr(chan_data.sender_chan) + IntToStr(2) + IntToStr(0) + IntToStr(0));
        Debug("APF: Send ChannelOpenFailure");
    }

    function SendChannelOpenConfirm(socket, chan_data) {
        socket.write(String.fromCharCode(APFProtocol.CHANNEL_OPEN_CONFIRMATION) + IntToStr(chan_data.sender_chan) + IntToStr(chan_data.sender_chan) + IntToStr(chan_data.window_size) + IntToStr(0xFFFFFFFF));
        Debug("APF: Send ChannelOpenConfirmation");
    }

    function SendChannelWindowAdjust(socket, chan, size) {
        socket.write(String.fromCharCode(APFProtocol.CHANNEL_WINDOW_ADJUST) + IntToStr(chan) + IntToStr(size));
        Debug("APF: Send ChannelWindowAdjust, channel: " + chan + ", size: " + size);
    }

    function SendChannelData(socket, chan, data) {
        socket.write(Buffer.concat([Buffer.from(String.fromCharCode(APFProtocol.CHANNEL_DATA) + IntToStr(chan) + IntToStr(data.length), 'binary'), data]));
        Debug("APF: Send ChannelData: " + data.toString('hex'));
    }

    function SendChannelClose(socket, chan) {
        socket.write(String.fromCharCode(APFProtocol.CHANNEL_CLOSE) + IntToStr(chan));
        Debug("APF: Send ChannelClose ");
    }

    obj.connect = function () {
        if (obj.forwardClient != null) {
            try { obj.forwardClient.ws.end(); } catch (ex) { Debug(ex); }
            //obj.forwardClient = null;
        }
        obj.cirastate = CIRASTATE.INITIAL;
        obj.pfwd_idx = 0;

        //obj.forwardClient = new obj.ws(obj.args.mpsurl, obj.tlsoptions);
        //obj.forwardClient.on("open", obj.onSecureConnect);

        var wsoptions = obj.http.parseUri(obj.args.mpsurl);
        wsoptions.rejectUnauthorized = 0;
        obj.forwardClient = obj.http.request(wsoptions);
        obj.forwardClient.upgrade = obj.onSecureConnect;
        obj.forwardClient.end(); // end request, trigger completion of HTTP request
    }

    obj.disconnect = function () { try { obj.forwardClient.ws.end(); } catch (ex) { Debug(ex); } }

    return obj;
}

module.exports = CreateAPFClient; 