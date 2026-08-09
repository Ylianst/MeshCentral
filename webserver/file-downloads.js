/**
* @description Authorized HTTP file download handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createFileDownloads = function (options) {
    const state = options.state;
    const parent = options.parent;
    const serverRoot = options.serverRoot;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getDomain = options.getDomain;
    const checkAgentIpAddress = options.checkAgentIpAddress;
    const getRandomLowerCase = options.getRandomLowerCase;
    const setContentDispositionHeader = options.setContentDispositionHeader;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const getRootCertLink = options.getRootCertLink;
    const remoteControlRight = options.remoteControlRight;

    function downloadUserFile(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) === -1)) { res.sendStatus(404); return; }
        if (state.common.validateString(req.path, 1, 4096) === false) { res.sendStatus(404); return; }

        var domainName = 'domain', splitUrl = decodeURIComponent(req.path).split('/'), filename = '';
        if (splitUrl[1] !== 'userfiles') splitUrl.splice(1, 1);
        if ((splitUrl.length < 3) || (state.common.IsFilenameValid(splitUrl[2]) === false) || (domain.userQuota === -1)) { res.sendStatus(404); return; }
        if (domain.id !== '') domainName = 'domain-' + domain.id;
        var filePath = state.path.join(state.filespath, domainName + '/user-' + splitUrl[2] + '/Public');
        for (var i = 3; i < splitUrl.length; i++) {
            if (state.common.IsFilenameValid(splitUrl[i]) !== true) { res.sendStatus(404); return; }
            filePath += '/' + splitUrl[i];
            filename = splitUrl[i];
        }

        var stat = null;
        try { stat = state.fs.statSync(filePath); } catch (ex) { }
        if ((stat != null) && ((stat.mode & 0x004000) === 0)) {
            if (req.query.download == 1) {
                setContentDispositionHeader(res, 'application/octet-stream', filename, null, 'file.bin');
                try { res.sendFile(state.path.resolve(serverRoot, filePath)); } catch (ex) { res.sendStatus(404); }
                return;
            }
            const filenameJs = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'download2' : 'download', req, domain), getRenderArgs({ rootCertLink: getRootCertLink(domain), messageid: 1, fileurl: req.path + '?download=1', filename: filenameJs, filesize: stat.size }, req, domain));
            return;
        }
        render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'download2' : 'download', req, domain), getRenderArgs({ rootCertLink: getRootCertLink(domain), messageid: 2 }, req, domain));
    }

    function downloadDeviceFile(req, res) {
        const domain = getDomain(req, res);
        if (domain == null) return;
        if ((req.query.c == null) || (req.query.f == null)) { res.sendStatus(404); return; }

        const cookie = parent.decodeCookie(req.query.c, parent.loginCookieEncryptionKey, 60);
        if ((cookie == null) || (cookie.domainid !== domain.id)) { res.sendStatus(404); return; }
        const user = state.users[cookie.userid];
        if (user == null) { res.sendStatus(404); return; }
        if (Array.isArray(cookie.usages) && (cookie.usages.indexOf(10) < 0)) { res.sendStatus(404); return; }
        if (cookie.nid != null) req.query.n = cookie.nid.split('/')[2];
        if (req.query.n == null) { res.sendStatus(404); return; }

        state.GetNodeWithRights(domain, user, 'node/' + domain.id + '/' + req.query.n, function (node, rights, visible) {
            if ((node == null) || ((rights & remoteControlRight) === 0) || (visible === false)) { res.sendStatus(404); return; }
            req.query.id = getRandomLowerCase(12);
            state.meshDeviceFileHandler.CreateMeshDeviceFile(state, null, res, req, domain, user, node.meshid, node._id);
        });
    }

    function downloadAgentFile(req, res) {
        const domain = checkAgentIpAddress(req, res);
        if (domain == null) return;
        if (req.query.c == null) { res.sendStatus(404); return; }
        const cookie = parent.decodeCookie(req.query.c, parent.loginCookieEncryptionKey, 5);
        if ((cookie == null) || (cookie.a !== 'tmpdl') || (cookie.d !== domain.id) || (cookie.nid == null) || (cookie.f == null) || (state.common.IsFilenameValid(cookie.f) === false)) { res.sendStatus(404); return; }
        try { res.sendFile(state.path.join(state.filespath, 'tmp', cookie.f)); } catch (ex) { res.sendStatus(404); }
    }

    return { downloadUserFile: downloadUserFile, downloadDeviceFile: downloadDeviceFile, downloadAgentFile: downloadAgentFile };
};
