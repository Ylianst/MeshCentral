/**
* @description Authenticated server file upload handler
* @license Apache-2.0
*/

'use strict';

module.exports.prepareBatchUploadFiles = function (options) {
    const uploads = options.files && options.files.files;
    if (!Array.isArray(uploads) || (uploads.length === 0)) return { error: 'missing-files' };
    const prepared = [];
    for (var i = 0; i < uploads.length; i++) {
        const file = uploads[i];
        const originalName = (file && (typeof file.originalFilename === 'string')) ? file.originalFilename : '';
        const safeName = options.path.basename(originalName);
        const tempPath = (file && (typeof file.path === 'string')) ? options.resolveSafeUploadTempPath(file.path) : null;
        if ((safeName !== originalName) || (options.common.IsFilenameValid(safeName) !== true)) {
            if (tempPath != null) { try { options.fs.unlink(tempPath, function () { }); } catch (ex) { } }
            return { error: 'invalid-filename' };
        }
        if (tempPath == null) return { error: 'invalid-temp-path' };
        prepared.push({ name: safeName, tempPath: tempPath });
    }
    return { files: prepared };
};

module.exports.createFileUploads = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkCookieIp = options.checkCookieIp;
    const resolveSafeUploadTempPath = options.resolveSafeUploadTempPath;
    const readTotalFileSize = options.readTotalFileSize;
    const createUploadQuota = options.createUploadQuota;
    const getRandomPassword = options.getRandomPassword;
    const remoteControlRight = options.remoteControlRight;
    const multiparty = options.multiparty || require('multiparty');

    function getAuthenticatedUserId(req, fields, domain) {
        var userId = ((req.session != null) && (typeof req.session.userid === 'string')) ? req.session.userid : null;
        if ((fields != null) && Array.isArray(fields.auth) && (fields.auth.length === 1) && (typeof fields.auth[0] === 'string')) {
            var cookie = parent.decodeCookie(fields.auth[0], parent.loginCookieEncryptionKey, 60);
            if ((cookie != null) && (cookie.ip != null) && !checkCookieIp(cookie.ip, req.clientIp)) cookie = null;
            if ((cookie != null) && (domain.id === cookie.domainid)) userId = cookie.userid;
        }
        return userId;
    }

    function ensureUploadFolders(domain, destination) {
        const domainFolder = (domain.id.length > 0) ? ('domain-' + domain.id) : 'domain';
        try { state.fs.mkdirSync(state.filespath); } catch (ex) { }
        try { state.fs.mkdirSync(state.path.join(state.filespath, domainFolder)); } catch (ex) { }
        try { state.fs.mkdirSync(destination); } catch (ex) { }
    }

    function notifyQuota(user, filename) {
        parent.DispatchEvent([user._id], state, { action: 'notify', title: 'Disk quota exceed', value: filename, nolog: 1, id: Math.random() });
    }

    function notifyFilesChanged(user) { parent.DispatchEvent([user._id], state, 'updatefiles'); }

    function parseEmbeddedFiles(fields) {
        const names = getSingleStringList(fields, 'name');
        const sizes = getSingleStringList(fields, 'size');
        const types = getSingleStringList(fields, 'type');
        const data = getSingleStringList(fields, 'data');
        if ((names == null) || (sizes == null) || (types == null) || (data == null)) return null;
        if ((names.length !== sizes.length) || (names.length !== types.length) || (names.length !== data.length)) return null;
        const files = [];
        for (var i = 0; i < names.length; i++) {
            const comma = data[i].indexOf(',');
            const header = (comma < 0) ? '' : data[i].substring(0, comma);
            const encoded = (comma < 0) ? '' : data[i].substring(comma + 1);
            if ((comma < 0) || !/^data:[^,]*;base64$/i.test(header) || !isBase64(encoded)) return null;
            files.push({ name: names[i], data: Buffer.from(encoded, 'base64') });
        }
        return files;
    }

    function getSingleStringList(fields, name) {
        if (!Array.isArray(fields[name]) || (fields[name].length !== 1) || (typeof fields[name][0] !== 'string')) return null;
        return fields[name][0].split('*');
    }

    function isBase64(value) {
        if ((value.length % 4) !== 0) return false;
        return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
    }

    function writeEmbeddedFiles(req, res, domain, user, destination, quota, fields) {
        const files = parseEmbeddedFiles(fields);
        if (files == null) { res.sendStatus(400); return false; }
        ensureUploadFolders(domain, destination.fullpath);
        for (var i = 0; i < files.length; i++) {
            const safeName = state.path.basename(files[i].name);
            if ((safeName !== files[i].name) || (state.common.IsFilenameValid(safeName) === false)) { res.sendStatus(404); return false; }
            if (!quota.tryReserve(files[i].data.length)) { notifyQuota(user, files[i].name); continue; }
            const fileData = files[i].data;
            state.fs.mkdir(destination.fullpath, function () {
                state.fs.writeFile(state.path.join(destination.fullpath, safeName), fileData, function () { notifyFilesChanged(user); });
            });
        }
        return true;
    }

    function moveMultipartFiles(req, res, domain, user, destination, quota, files) {
        const uploads = (files && Array.isArray(files.files)) ? files.files : [];
        for (var i = 0; i < uploads.length; i++) {
            const file = uploads[i];
            const originalName = (typeof file.originalFilename === 'string') ? file.originalFilename : '';
            const safeName = state.path.basename(originalName);
            const uploadTempPath = resolveSafeUploadTempPath(file.path);
            if (uploadTempPath == null) { res.sendStatus(400); return false; }
            if ((safeName !== originalName) || (state.common.IsFilenameValid(safeName) !== true) || !quota.tryReserve(file.size)) {
                notifyQuota(user, originalName);
                try { state.fs.unlink(uploadTempPath, function () { }); } catch (ex) { }
                continue;
            }
            ensureUploadFolders(domain, destination.fullpath);
            const targetPath = state.path.join(destination.fullpath, safeName);
            state.fs.rename(uploadTempPath, targetPath, function (err) {
                if (err && (err.code === 'EXDEV')) {
                    state.common.copyFile(uploadTempPath, targetPath, function () {
                        state.fs.unlink(uploadTempPath, function () { notifyFilesChanged(user); });
                    });
                } else {
                    notifyFilesChanged(user);
                }
            });
        }
        return true;
    }

    function handleUpload(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (domain.userQuota === -1) { res.sendStatus(401); return; }
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if (err) { res.sendStatus(400); return; }
            const userId = getAuthenticatedUserId(req, fields, domain);
            if (userId == null) { res.sendStatus(401); return; }
            const user = state.users[userId];
            if ((user == null) || ((user.siteadmin & 8) === 0)) { res.sendStatus(401); return; }
            if ((fields == null) || !Array.isArray(fields.link) || (fields.link.length !== 1) || (typeof fields.link[0] !== 'string')) { res.sendStatus(404); return; }
            var destination = null;
            try { destination = state.getServerFilePath(user, domain, decodeURIComponent(fields.link[0])); } catch (ex) { }
            if (destination == null) { res.sendStatus(404); return; }
            const totalSize = readTotalFileSize(destination.fullpath);
            const quota = createUploadQuota(totalSize, destination.quota);
            if ((destination.quota != null) && (totalSize >= destination.quota)) { notifyQuota(user, 'Disk quota exceed'); res.send(''); return; }
            const completed = (fields.name != null) ? writeEmbeddedFiles(req, res, domain, user, destination, quota, fields) : moveMultipartFiles(req, res, domain, user, destination, quota, files);
            if (completed) res.send('');
        });
    }

    function handleBatchUpload(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            const userId = getAuthenticatedUserId(req, fields, domain);
            if (userId == null) { res.sendStatus(401); return; }

            const user = state.users[userId];
            if (user == null) { parent.debug('web', 'Batch upload error, invalid user.'); res.sendStatus(401); return; }
            if ((fields == null) || (fields.nodeIds == null) || (fields.nodeIds.length != 1)) { res.sendStatus(404); return; }
            const cmd = { nodeids: fields.nodeIds[0].split(','), files: [], user: user, domain: domain, overwrite: false, createFolder: false };
            if ((fields.winpath != null) && (fields.winpath.length == 1)) { cmd.windowsPath = fields.winpath[0]; }
            if ((fields.linuxpath != null) && (fields.linuxpath.length == 1)) { cmd.linuxPath = fields.linuxpath[0]; }
            if ((fields.overwriteFiles != null) && (fields.overwriteFiles.length == 1) && (fields.overwriteFiles[0] == 'on')) { cmd.overwrite = true; }
            if ((fields.createFolder != null) && (fields.createFolder.length == 1) && (fields.createFolder[0] == 'on')) { cmd.createFolder = true; }

            if ((cmd.windowsPath == null) && (cmd.linuxPath == null)) {
                parent.debug('web', 'Batch upload error, invalid fields: ' + JSON.stringify(fields));
                res.send('');
                return;
            }

            const preparedUploads = module.exports.prepareBatchUploadFiles({ files: files, path: state.path, common: state.common, fs: state.fs, resolveSafeUploadTempPath: resolveSafeUploadTempPath });
            if (preparedUploads.error != null) { res.sendStatus(400); return; }

            const serverpath = state.path.join(state.filespath, 'tmp');
            try { state.fs.mkdirSync(state.parent.filespath); } catch (ex) { }
            try { state.fs.mkdirSync(serverpath); } catch (ex) { }
            for (var i in preparedUploads.files) {
                const file = preparedUploads.files[i];
                const ftarget = getRandomPassword() + '-' + file.name;
                const targetPath = state.path.join(serverpath, ftarget);
                const uploadTempPath = file.tempPath;
                cmd.files.push({ name: file.name, target: ftarget });
                state.fs.rename(uploadTempPath, targetPath, function (err) {
                    if (err && (err.code === 'EXDEV')) {
                        state.common.copyFile(uploadTempPath, targetPath, function () { state.fs.unlink(uploadTempPath, function () { }); });
                    }
                });
            }

            var tlsCertHash = null;
            if ((parent.args.ignoreagenthashcheck == null) || (parent.args.ignoreagenthashcheck === false)) {
                tlsCertHash = state.webCertificateFullHashs[cmd.domain.id];
                if (tlsCertHash != null) { tlsCertHash = Buffer.from(tlsCertHash, 'binary').toString('hex'); }
            }
            for (var nodeIndex in cmd.nodeids) {
                state.GetNodeWithRights(cmd.domain, cmd.user, cmd.nodeids[nodeIndex], function (node, rights, visible) {
                    if ((node == null) || ((rights & remoteControlRight) == 0) || (visible == false)) return;
                    const agentPath = (((node.agent.id > 0) && (node.agent.id < 5)) || (node.agent.id == 34)) ? cmd.windowsPath : cmd.linuxPath;
                    if (agentPath == null) return;

                    var consent = 0;
                    const mesh = state.meshes[node.meshid];
                    if (typeof domain.userconsentflags == 'number') { consent |= domain.userconsentflags; }
                    if ((mesh != null) && (typeof mesh.consent == 'number')) { consent |= mesh.consent; }
                    if (typeof node.consent == 'number') { consent |= node.consent; }
                    if (typeof user.consent == 'number') { consent |= user.consent; }
                    if ((mesh != null) && (user.links != null) && (user.links[mesh._id] == null) && (user.links[node._id] == null)) {
                        for (var linkId in user.links) {
                            const userGroup = state.userGroups[linkId];
                            if ((userGroup != null) && (userGroup.consent != null) && (userGroup.links != null) && ((userGroup.links[mesh._id] != null) || (userGroup.links[node._id] != null))) {
                                consent |= userGroup.consent;
                            }
                        }
                    }

                    const targets = state.CreateNodeDispatchTargets(node.meshid, node._id, ['server-users', cmd.user._id]);
                    const event = { etype: 'node', userid: cmd.user._id, username: cmd.user.name, nodeid: node._id, action: 'batchupload', msg: 'Performing batch upload of ' + cmd.files.length + ' file(s) to ' + agentPath, msgid: 103, msgArgs: [cmd.files.length, agentPath], domain: cmd.domain.id };
                    parent.DispatchEvent(targets, state, event);

                    for (var fileIndex in cmd.files) {
                        if (cmd.files[fileIndex].name != null) {
                            const agentCommand = { action: 'wget', userid: user._id, username: user.name, realname: user.realname, remoteaddr: req.clientIp, consent: consent, rights: rights, overwrite: cmd.overwrite, createFolder: cmd.createFolder, urlpath: '/agentdownload.ashx?c=' + state.parent.encodeCookie({ a: 'tmpdl', d: cmd.domain.id, nid: node._id, f: cmd.files[fileIndex].target }, state.parent.loginCookieEncryptionKey), path: state.path.join(agentPath, cmd.files[fileIndex].name), folder: agentPath, servertlshash: tlsCertHash };
                            const agent = state.wsagents[node._id];
                            if (agent != null) { try { agent.send(JSON.stringify(agentCommand)); } catch (ex) { } }
                        }
                    }
                });
            }

            res.send('');
        });
    }

    return { getAuthenticatedUserId: getAuthenticatedUserId, parseEmbeddedFiles: parseEmbeddedFiles, handleUpload: handleUpload, handleBatchUpload: handleBatchUpload };
};
