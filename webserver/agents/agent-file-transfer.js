/**
* @description Agent-to-server file transfer endpoint
* @license Apache-2.0
*/

'use strict';

module.exports.createAgentFileTransfer = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkAgentIpAddress = options.checkAgentIpAddress;

    function handleAgentFileTransfer(ws, req) {
        const domain = checkAgentIpAddress(ws, req);
        if (domain == null) { parent.debug('web', 'Got agent file transfer connection with bad domain or blocked IP address ' + req.clientIp + ', dropping.'); ws.close(); return; }
        if (req.query.c == null) { parent.debug('web', 'Got agent file transfer connection without a cookie from ' + req.clientIp + ', dropping.'); ws.close(); return; }
        const cookie = parent.decodeCookie(req.query.c, parent.loginCookieEncryptionKey, 10);
        if ((cookie == null) || (cookie.a != 'aft')) { parent.debug('web', 'Got agent file transfer connection with invalid cookie from ' + req.clientIp + ', dropping.'); ws.close(); return; }
        ws.xcmd = cookie.b;
        ws.xarg = cookie.c;
        ws.xfilelen = 0;
        ws.send('c');
        ws.send('5');
        if (ws.xcmd == 'coredump') {
            const coreDumpName = (typeof ws.xarg == 'string') ? state.common.makeFilename(ws.xarg) : '';
            if (coreDumpName.length == 0) { parent.debug('web', 'Got agent core dump transfer with an invalid filename from ' + req.clientIp + ', dropping.'); ws.close(); return; }
            const coreDumpPath = state.path.join(parent.datapath, '..', 'meshcentral-coredumps');
            if (state.fs.existsSync(coreDumpPath) == false) { try { state.fs.mkdirSync(coreDumpPath); } catch (ex) { } }
            ws.xfilepath = state.path.join(coreDumpPath, coreDumpName);
            ws.xid = 'coredump';
            ws.send(JSON.stringify({ action: 'download', sub: 'start', ask: 'coredump', id: 'coredump' }));
        }

        ws.on('message', function (data) {
            if (typeof data == 'string') {
                var command = null;
                try { command = JSON.parse(data); } catch (ex) { }
                if ((command == null) || (command.action != 'download') || (command.sub == null)) return;
                if (command.sub == 'start') {
                    const activeWs = this;
                    state.fs.open(this.xfilepath + '.part', 'w', function (err, fileDescriptor) {
                        if ((err != null) || (fileDescriptor == null)) {
                            parent.debug('web', 'Unable to open agent core dump file: ' + ((err != null) ? err.toString() : 'invalid file descriptor'));
                            try { activeWs.close(); } catch (ex) { }
                            return;
                        }
                        activeWs.xfile = fileDescriptor;
                        try { activeWs.send(JSON.stringify({ action: 'download', sub: 'startack', id: activeWs.xid, ack: 1 })); } catch (ex) { }
                    });
                }
            } else {
                if (data.length < 4) return;
                const flags = data.readInt32BE(0);
                if (data.length > 4) {
                    this.xfilelen += data.length - 4;
                    try {
                        const activeWs = this;
                        state.fs.write(this.xfile, data, 4, data.length - 4, function () {
                            if (flags & 1) {
                                finishTransfer(activeWs);
                            } else {
                                try { activeWs.send(JSON.stringify({ action: 'download', sub: 'ack', id: activeWs.xid })); } catch (ex) { }
                            }
                        });
                    } catch (ex) { }
                } else if (flags & 1) {
                    finishTransfer(this);
                } else {
                    this.send(JSON.stringify({ action: 'download', sub: 'ack', id: this.xid }));
                }
            }
        });

        ws.on('error', function (err) { console.log('Agent file transfer server error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.'); });
        ws.on('close', function () {
            if (this.xfile) {
                state.fs.close(this.xfile, function () { });
                state.fs.unlink(this.xfilepath + '.part', function () { });
            }
        });
    }

    function finishTransfer(ws) {
        parent.debug('web', 'Completed downloads of agent dumpfile, ' + ws.xfilelen + ' bytes.');
        if (ws.xfile) {
            state.fs.close(ws.xfile, function () { });
            state.fs.rename(ws.xfilepath + '.part', ws.xfilepath, function () { });
            ws.xfile = null;
        }
        try { ws.send(JSON.stringify({ action: 'markcoredump' })); } catch (ex) { }
        try { ws.close(); } catch (ex) { }
    }

    return { handleAgentFileTransfer: handleAgentFileTransfer };
};
