/**
* @description Server-side file paths, quotas and filesystem helpers
* @license Apache-2.0
*/

'use strict';

module.exports.createStorage = function (options) {
    const fs = options.fs;
    const path = options.path;
    const filespath = options.filespath;
    const common = options.common;
    const users = options.users;
    const meshes = options.meshes;
    const getMeshRights = options.getMeshRights;

    function getQuota(objectId, domain) {
        if (objectId == null) return 0;
        if (objectId.startsWith('user/')) {
            const user = users[objectId];
            if (user == null) return 0;
            if (user.siteadmin == 0xFFFFFFFF) return null;
            if ((user.quota != null) && (typeof user.quota == 'number')) return user.quota;
            if ((domain != null) && (domain.userquota != null) && (typeof domain.userquota == 'number')) return domain.userquota;
            return null;
        }
        if (objectId.startsWith('mesh/')) {
            const mesh = meshes[objectId];
            if (mesh == null) return 0;
            if ((mesh.quota != null) && (typeof mesh.quota == 'number')) return mesh.quota;
            if ((domain != null) && (domain.meshquota != null) && (typeof domain.meshquota == 'number')) return domain.meshquota;
            return null;
        }
        return 0;
    }

    function getServerFilePath(user, domain, requestedPath) {
        var splitpath = requestedPath.split('/'), serverpath = path.join(filespath, 'domain'), filename = '';
        if ((splitpath.length < 3) || (splitpath[0] != 'user' && splitpath[0] != 'mesh') || (splitpath[1] != domain.id)) return null;
        const objectId = splitpath[0] + '/' + splitpath[1] + '/' + splitpath[2];
        if ((splitpath[0] == 'user') && (objectId != user._id)) return null;
        if ((splitpath[0] == 'mesh') && ((getMeshRights(user, objectId) & 32) == 0)) return null;
        if (splitpath[1] != '') serverpath += '-' + splitpath[1];
        serverpath += ('/' + splitpath[0] + '-' + splitpath[2]);
        for (var i = 3; i < splitpath.length; i++) {
            if (common.IsFilenameValid(splitpath[i]) == true) { serverpath += '/' + splitpath[i]; filename = splitpath[i]; } else { return null; }
        }
        return { fullpath: path.resolve(filespath, serverpath), path: serverpath, name: filename, quota: getQuota(objectId, domain) };
    }

    function getServerRootFilePath(entry) {
        if ((typeof entry != 'object') || (entry.domain == null) || (entry._id == null)) return null;
        var domainName = 'domain', splitName = entry._id.split('/');
        if (splitName.length != 3) return null;
        if (entry.domain !== '') domainName = 'domain-' + entry.domain;
        return path.join(filespath, domainName, splitName[0] + '-' + splitName[2]);
    }

    function readTotalFileSize(folderPath) {
        var result = 0, entries;
        try { entries = fs.readdirSync(folderPath); } catch (e) { return 0; }
        for (var i in entries) {
            const entryPath = path.join(folderPath, entries[i]);
            const stat = fs.statSync(entryPath);
            if ((stat.mode & 0x004000) == 0) { result += stat.size; } else { result += readTotalFileSize(entryPath); }
        }
        return result;
    }

    function deleteFolderRec(folderPath) {
        if (fs.existsSync(folderPath) == false) return;
        try {
            fs.readdirSync(folderPath).forEach(function (file) {
                const entryPath = path.join(folderPath, file);
                if (fs.lstatSync(entryPath).isDirectory()) { deleteFolderRec(entryPath); } else { fs.unlinkSync(entryPath); }
            });
            fs.rmdirSync(folderPath);
        } catch (ex) { }
    }

    return {
        getQuota: getQuota,
        getServerFilePath: getServerFilePath,
        getServerRootFilePath: getServerRootFilePath,
        readTotalFileSize: readTotalFileSize,
        deleteFolderRec: deleteFolderRec
    };
};
