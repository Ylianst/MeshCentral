/**
* @description MeshCore and Intel AMT recovery upload handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createSpecialUploads = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkCookieIp = options.checkCookieIp;
    const resolveSafeUploadTempPath = options.resolveSafeUploadTempPath;
    const multiparty = options.multiparty || require('multiparty');

    function getAuthenticatedUserId(req, fields, domain) {
        var userId = ((req.session != null) && (typeof req.session.userid === 'string')) ? req.session.userid : null;
        if ((fields != null) && (fields.auth != null) && (fields.auth.length === 1) && (typeof fields.auth[0] === 'string')) {
            var cookie = parent.decodeCookie(fields.auth[0], parent.loginCookieEncryptionKey, 60);
            if ((cookie != null) && (cookie.ip != null) && !checkCookieIp(cookie.ip, req.clientIp)) cookie = null;
            if ((cookie != null) && (domain.id === cookie.domainid)) userId = cookie.userid;
        }
        return userId;
    }

    function handle(req, res, action) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (domain.id !== '') { res.sendStatus(401); return; }

        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            const userId = getAuthenticatedUserId(req, fields, domain);
            if (userId == null) { res.sendStatus(401); return; }
            if ((fields == null) || (fields.attrib == null) || (fields.attrib.length !== 1)) { res.sendStatus(404); return; }
            const user = state.users[userId];
            if (user == null) { res.sendStatus(401); return; }
            const nodeId = fields.attrib[0];
            state.GetNodeWithRights(domain, user, nodeId, function (node, rights, visible) {
                if ((node == null) || (rights !== 0xFFFFFFFF) || (visible === false)) { res.sendStatus(404); return; }
                const uploads = (files && Array.isArray(files.files)) ? files.files : [];
                for (var i = 0; i < uploads.length; i++) {
                    const uploadTempPath = resolveSafeUploadTempPath(uploads[i].path);
                    if (uploadTempPath == null) { res.sendStatus(400); return; }
                    if (action === 'meshcore') {
                        state.fs.readFile(uploadTempPath, 'utf8', function (readError, data) {
                            if (readError != null) return;
                            state.sendMeshAgentCore(user, domain, nodeId, 'custom', state.common.IntToStr(0) + data);
                            try { state.fs.unlinkSync(uploadTempPath); } catch (ex) { }
                        });
                    } else {
                        parent.DispatchEvent('*', state, { action: 'oneclickrecovery', userid: user._id, username: user.name, nodeids: [node._id], domain: domain.id, nolog: 1, file: uploadTempPath });
                    }
                }
                res.send('');
            });
        });
    }

    return {
        getAuthenticatedUserId: getAuthenticatedUserId,
        uploadMeshCore: function (req, res) { handle(req, res, 'meshcore'); },
        uploadOneClickRecovery: function (req, res) { handle(req, res, 'recovery'); }
    };
};
