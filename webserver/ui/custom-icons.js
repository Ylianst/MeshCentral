/**
* @description Storage paths and upload validation for custom sidebar icons
* @license Apache-2.0
*/

'use strict';

const MAX_FILE_SIZE = 10485760;
const MAX_DIMENSION = 64;
const ALLOWED_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg']);

module.exports.createCustomIcons = function (options) {
    const crypto = options.crypto;
    const path = options.path;
    const fs = options.fs;
    const datapath = options.datapath;

    function getUserKey(user) {
        if ((user == null) || (typeof user._id !== 'string') || (user._id.length === 0)) return null;
        return crypto.createHash('sha256').update(user._id).digest('hex');
    }

    function getUserDir(user) {
        const userKey = getUserKey(user);
        if (userKey == null) return null;
        return path.join(datapath, 'icons', 'custom', userKey);
    }

    function getMimeType(iconName) {
        const lower = iconName.toLowerCase();
        if (lower.endsWith('.svg')) return 'image/svg+xml';
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
        return null;
    }

    function cleanSvg(svgContent) {
        if (typeof svgContent !== 'string') return null;
        const cleaned = (svgContent.charCodeAt(0) === 0xFEFF) ? svgContent.substring(1) : svgContent;
        if (cleaned.search(/<svg[\s>]/i) < 0) return null;
        if (cleaned.search(/<\s*(script|foreignObject|iframe|object|embed|applet|link|meta)\b/i) >= 0) return null;
        if (cleaned.search(/\s+on[a-z0-9_-]+\s*=/i) >= 0) return null;
        if (cleaned.search(/\s+(href|xlink:href|src)\s*=\s*(['"]?)\s*(?!#)/i) >= 0) return null;
        return cleaned;
    }

    function isJpegStartOfFrameMarker(marker) {
        return ((marker >= 0xC0) && (marker <= 0xC3)) || ((marker >= 0xC5) && (marker <= 0xC7)) || ((marker >= 0xC9) && (marker <= 0xCB)) || ((marker >= 0xCD) && (marker <= 0xCF));
    }

    function getJpegDimensions(data) {
        if ((data.length < 4) || (data[0] !== 0xFF) || (data[1] !== 0xD8)) return null;
        var offset = 2;
        while (offset + 9 < data.length) {
            if (data[offset] !== 0xFF) return null;
            while ((offset < data.length) && (data[offset] === 0xFF)) offset++;
            const marker = data[offset++];
            if ((marker === 0xD8) || (marker === 0xD9)) continue;
            if ((marker >= 0xD0) && (marker <= 0xD7)) continue;
            if (offset + 2 > data.length) return null;
            const segmentLength = data.readUInt16BE(offset);
            if (segmentLength < 2) return null;
            if (isJpegStartOfFrameMarker(marker)) {
                if (offset + 7 > data.length) return null;
                return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
            }
            offset += segmentLength;
        }
        return null;
    }

    function getDimensions(data, extension) {
        if ((extension === '.png') && (data.length >= 24) && (data[0] === 0x89) && (data[1] === 0x50) && (data[2] === 0x4E) && (data[3] === 0x47) && (data[4] === 0x0D) && (data[5] === 0x0A) && (data[6] === 0x1A) && (data[7] === 0x0A)) {
            return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
        }
        if (((extension === '.jpg') || (extension === '.jpeg')) && (data.length >= 3) && (data[0] === 0xFF) && (data[1] === 0xD8) && (data[2] === 0xFF)) return getJpegDimensions(data);
        return null;
    }

    function validateFile(iconTempPath, extension, callback) {
        fs.stat(iconTempPath, function (statErr, stats) {
            if (statErr) { callback('Unable to read uploaded icon.'); return; }
            if ((stats == null) || (stats.isFile() !== true)) { callback('Invalid icon file.'); return; }
            if ((stats.size < 4) || (stats.size > MAX_FILE_SIZE)) { callback('Icon files must be non-empty and ' + (MAX_FILE_SIZE / 1048576) + ' MB or smaller.'); return; }
            if (extension === '.svg') {
                fs.readFile(iconTempPath, 'utf8', function (readErr, svgContent) {
                    if (readErr) { callback('Unable to read uploaded icon.'); return; }
                    const cleanedSvg = cleanSvg(svgContent);
                    if (cleanedSvg == null) { callback('Invalid SVG icon file.'); return; }
                    fs.writeFile(iconTempPath, cleanedSvg, 'utf8', function (writeErr) { callback(writeErr ? 'Unable to clean uploaded SVG icon.' : null); });
                });
                return;
            }
            fs.open(iconTempPath, 'r', function (openErr, fd) {
                if (openErr) { callback('Unable to read uploaded icon.'); return; }
                const header = Buffer.alloc(Math.min(stats.size, 65536));
                fs.read(fd, header, 0, header.length, 0, function (readErr, bytesRead) {
                    fs.close(fd, function () { });
                    if (readErr) { callback('Unable to read uploaded icon.'); return; }
                    const dimensions = getDimensions(header.slice(0, bytesRead), extension);
                    if (dimensions == null) { callback('The uploaded icon does not match its file type.'); return; }
                    if ((dimensions.width < 1) || (dimensions.height < 1) || (dimensions.width > MAX_DIMENSION) || (dimensions.height > MAX_DIMENSION)) { callback('Icon images must be ' + MAX_DIMENSION + ' x ' + MAX_DIMENSION + ' pixels or smaller.'); return; }
                    callback(null);
                });
            });
        });
    }

    return {
        maxFileSize: MAX_FILE_SIZE,
        maxDimension: MAX_DIMENSION,
        allowedExtensions: ALLOWED_EXTENSIONS,
        getUserKey: getUserKey,
        getUserDir: getUserDir,
        getMimeType: getMimeType,
        cleanSvg: cleanSvg,
        getJpegDimensions: getJpegDimensions,
        getDimensions: getDimensions,
        validateFile: validateFile
    };
};

module.exports.createCustomIconHandlers = function (options) {
    const state = options.state;
    const parent = options.parent;
    const customIcons = options.customIcons;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getDomain = options.getDomain;
    const resolveSafeUploadTempPath = options.resolveSafeUploadTempPath;
    const multiparty = options.multiparty || require('multiparty');

    function resolvePath(requestPath, user) {
        if (typeof requestPath !== 'string') { return null; }
        if (requestPath.startsWith('http://') || requestPath.startsWith('https://') || requestPath.startsWith('data:')) { return null; }
        const pathOnly = requestPath.split('?')[0].split('#')[0];
        const marker = '/icons/custom/';
        const markerIndex = pathOnly.indexOf(marker);
        if (markerIndex < 0) { return null; }
        const relativePath = pathOnly.substring(markerIndex + marker.length);
        if ((relativePath.length === 0) || (relativePath.indexOf('\\') !== -1)) { return null; }
        const pathParts = relativePath.split('/');
        if ((pathParts.length !== 1) && (pathParts.length !== 2)) { return null; }
        for (var i = 0; i < pathParts.length; i++) {
            if ((pathParts[i].length === 0) || (state.common.IsFilenameValid(pathParts[i]) !== true)) { return null; }
        }

        var ownerKey = null, iconName = null, diskPath = null, isOwned = false;
        const iconsRoot = state.path.join(parent.datapath, 'icons', 'custom');
        if (pathParts.length === 1) {
            iconName = pathParts[0];
            diskPath = state.path.join(iconsRoot, iconName);
        } else {
            ownerKey = pathParts[0];
            iconName = pathParts[1];
            diskPath = state.path.join(iconsRoot, ownerKey, iconName);
            const currentUserKey = customIcons.getUserKey(user);
            isOwned = (currentUserKey != null) && (ownerKey === currentUserKey);
        }

        if (customIcons.getMimeType(iconName) == null) { return null; }
        return { ownerKey: ownerKey, iconName: iconName, diskPath: diskPath, isOwned: isOwned, isLegacy: (pathParts.length === 1) };
    }

    function upload(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((req.session == null) || (typeof req.session.userid !== 'string')) { res.sendStatus(401); return; }
        const user = state.users[req.session.userid];
        if (user == null) { res.sendStatus(401); return; }

        const form = new multiparty.Form({ maxFilesSize: customIcons.maxFileSize });
        form.parse(req, function (err, fields, files) {
            if (err) { res.status(400).json({ success: false, error: (err.status === 413) ? 'Icon files must be non-empty and ' + (customIcons.maxFileSize / 1048576) + ' MB or smaller.' : 'Invalid form submission.' }); return; }

            const allowedTypes = { myDevices: 1, myAccount: 1, myEvents: 1, myFiles: 1, myUsers: 1, myServer: 1 };
            const iconType = (fields && fields.iconType && fields.iconType[0]) ? fields.iconType[0] : null;
            if ((typeof iconType !== 'string') || (allowedTypes[iconType] !== 1)) { res.status(400).json({ success: false, error: 'Invalid icon type.' }); return; }

            const iconFile = (files && files.iconFile && files.iconFile[0]) ? files.iconFile[0] : null;
            if ((iconFile == null) || (typeof iconFile.path !== 'string')) { res.status(400).json({ success: false, error: 'Missing icon file.' }); return; }
            const iconTempPath = resolveSafeUploadTempPath(iconFile.path);
            if (iconTempPath == null) { res.status(400).json({ success: false, error: 'Invalid icon file location.' }); return; }

            const cleanupTempFile = function () { try { state.fs.unlink(iconTempPath, function () { }); } catch (ex) { } };
            const extension = state.path.extname(iconFile.originalFilename || '').toLowerCase();
            if (customIcons.allowedExtensions.has(extension) === false) { cleanupTempFile(); res.status(400).json({ success: false, error: 'Only SVG, PNG and JPEG icon files are supported.' }); return; }

            const iconsRoot = state.path.join(parent.datapath, 'icons');
            const customDir = state.path.join(iconsRoot, 'custom');
            const userCustomDir = customIcons.getUserDir(user);
            const userKey = customIcons.getUserKey(user);
            if ((userCustomDir == null) || (userKey == null)) { cleanupTempFile(); res.status(500).json({ success: false, error: 'Unable to prepare user icons directory.' }); return; }
            try { state.fs.mkdirSync(iconsRoot); } catch (ex) { if (ex.code !== 'EEXIST') { cleanupTempFile(); res.status(500).json({ success: false, error: 'Unable to prepare icons directory.' }); return; } }
            try { state.fs.mkdirSync(customDir); } catch (ex) { if (ex.code !== 'EEXIST') { cleanupTempFile(); res.status(500).json({ success: false, error: 'Unable to prepare icons directory.' }); return; } }
            try { state.fs.mkdirSync(userCustomDir); } catch (ex) { if (ex.code !== 'EEXIST') { cleanupTempFile(); res.status(500).json({ success: false, error: 'Unable to prepare user icons directory.' }); return; } }

            const previousIcon = (fields && fields.previousIcon && fields.previousIcon[0]) ? fields.previousIcon[0] : null;
            const previousInfo = resolvePath(previousIcon, user);
            const newFilename = iconType + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8) + extension;
            const destinationPath = state.path.join(userCustomDir, newFilename);

            const respondSuccess = function () {
                if ((previousInfo != null) && (previousInfo.isOwned === true)) {
                    try { state.fs.unlinkSync(previousInfo.diskPath); } catch (ex) { }
                }
                res.json({ success: true, path: domain.url + 'icons/custom/' + userKey + '/' + newFilename });
            };

            customIcons.validateFile(iconTempPath, extension, function (validationError) {
                if (validationError != null) { cleanupTempFile(); res.status(400).json({ success: false, error: validationError }); return; }
                state.fs.rename(iconTempPath, destinationPath, function (renameErr) {
                    if (renameErr == null) { respondSuccess(); return; }
                    if (renameErr.code === 'EXDEV') {
                        state.common.copyFile(iconTempPath, destinationPath, function (copyErr) {
                            cleanupTempFile();
                            if (copyErr) { res.status(500).json({ success: false, error: 'Failed to save uploaded icon.' }); return; }
                            respondSuccess();
                        });
                    } else {
                        cleanupTempFile();
                        res.status(500).json({ success: false, error: 'Failed to save uploaded icon.' });
                    }
                });
            });
        });
    }

    function remove(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((req.session == null) || (typeof req.session.userid !== 'string')) { res.sendStatus(401); return; }
        const user = state.users[req.session.userid];
        if (user == null) { res.sendStatus(401); return; }

        const iconPath = (req.body && (typeof req.body.iconPath === 'string')) ? req.body.iconPath : null;
        const iconInfo = resolvePath(iconPath, user);
        if ((iconInfo == null) || (iconInfo.isOwned !== true)) { res.status(400).json({ success: false, error: 'Invalid icon path.' }); return; }

        state.fs.unlink(iconInfo.diskPath, function (err) {
            if (err && (err.code !== 'ENOENT')) { res.status(500).json({ success: false, error: 'Failed to delete icon.' }); return; }
            res.json({ success: true });
        });
    }

    function download(req, res) {
        const domain = getDomain(req);
        if (domain == null) { res.sendStatus(404); return; }
        if ((req.session == null) || (typeof req.session.userid !== 'string')) { res.sendStatus(401); return; }
        const user = state.users[req.session.userid];
        if (user == null) { res.sendStatus(401); return; }

        if ((req.params == null) || (typeof req.params[0] !== 'string')) { res.sendStatus(404); return; }
        const iconInfo = resolvePath('/icons/custom/' + req.params[0], user);
        if (iconInfo == null) { res.sendStatus(404); return; }
        if ((iconInfo.isLegacy !== true) && (iconInfo.isOwned !== true)) { res.sendStatus(404); return; }
        const contentType = customIcons.getMimeType(iconInfo.iconName);
        if (contentType == null) { res.sendStatus(404); return; }

        state.fs.readFile(iconInfo.diskPath, function (err, data) {
            if (err) { res.sendStatus(404); return; }
            const headers = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' };
            if (contentType === 'image/svg+xml') { headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'"; }
            res.set(headers);
            res.send(data);
        });
    }

    return { resolvePath: resolvePath, upload: upload, remove: remove, download: download };
};
