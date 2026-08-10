/**
* @description Session recording download, streaming and player handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createRecordings = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkAgentIpAddress = options.checkAgentIpAddress;
    const setContentDispositionHeader = options.setContentDispositionHeader;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const recordingRight = options.recordingRight;

    function getRecordingContext(domain, req, allowText) {
        if ((domain.sessionrecording == null) || (req.query.file == null) || (state.common.IsFilenameValid(req.query.file) !== true)) return null;
        if (!req.query.file.endsWith('.mcrec') && ((allowText !== true) || !req.query.file.endsWith('.txt'))) return null;
        const recordingsPath = domain.sessionrecording.filepath || parent.recordpath;
        if (recordingsPath == null) return null;
        const userId = ((req.session != null) && (typeof req.session.userid === 'string')) ? req.session.userid : null;
        const user = (userId == null) ? null : state.users[userId];
        if ((user == null) || ((user.siteadmin & recordingRight) === 0)) return null;
        return { user: user, filePath: state.path.join(recordingsPath, req.query.file) };
    }

    function download(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        const context = getRecordingContext(domain, req, true);
        if (context == null) { res.sendStatus(401); return; }
        setContentDispositionHeader(res, 'application/octet-stream', req.query.file, null, 'recording.mcrec');
        try { res.sendFile(context.filePath); } catch (ex) { res.sendStatus(404); }
    }

    function closeWebSocket(ws) { try { ws.close(); } catch (ex) { } }

    function stream(ws, req) {
        const domain = checkAgentIpAddress(ws, req);
        if (domain == null) {
            parent.debug('web', 'Got recordings file transfer connection with bad domain or blocked IP address ' + req.clientIp + ', dropping.');
            closeWebSocket(ws);
            return;
        }
        const context = getRecordingContext(domain, req, false);
        if (context == null) { closeWebSocket(ws); return; }

        state.fs.stat(context.filePath, function (statError, stats) {
            if (statError) { closeWebSocket(ws); return; }
            state.fs.open(context.filePath, 'r', function (openError, fd) {
                if (openError != null) { closeWebSocket(ws); return; }
                ws.on('message', function (message) {
                    if (typeof message !== 'string') return;
                    var command;
                    try { command = JSON.parse(message); } catch (ex) { return; }
                    if ((command == null) || (command.action !== 'get')) return;
                    const buffer = Buffer.alloc(8 + command.size);
                    buffer.writeUInt32BE((command.ptr & 0xFFFFFFFF), 4);
                    state.fs.read(fd, buffer, 8, command.size, command.ptr, function (err, bytesRead, result) {
                        if (bytesRead > (result.length - 8)) result = result.slice(0, bytesRead + 8);
                        ws.send(result);
                    });
                });
                const closeFile = function () { closeWebSocket(ws); state.fs.close(fd, function () { }); };
                ws.on('error', closeFile);
                ws.on('close', closeFile);
                ws.send(JSON.stringify({ action: 'info', name: req.query.file, size: stats.size }));
            });
        });
    }

    function player(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        parent.debug('web', 'handlePlayerRequest: sending player');
        res.set({ 'Cache-Control': 'no-store' });
        render(req, res, getRenderPage('player', req, domain), getRenderArgs({}, req, domain));
    }

    return { getRecordingContext: getRecordingContext, download: download, stream: stream, player: player };
};
