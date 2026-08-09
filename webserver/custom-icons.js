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
