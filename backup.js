// backup to zipfile
module.exports.zipDirectory = async function (dirPath, outputZip, password = '', compression = 5) {
    try {
        const { ZipWriterStream } = require("@zip.js/zip.js");
        const { readdir, stat } = require("fs/promises");
        const path = require("path");
        const { createReadStream, createWriteStream } = require("fs");
        const { Readable } = require("stream");
        const { pipeline } = require("stream/promises");

        const zipStream = new ZipWriterStream({
        ...(password ? { password, encryptionStrength: 3 } : {}),   // 3 = AES-256
        level: compression
        // msDosCompatible: true  // to write EntryMetaData#externalFileAttributes in MS-DOS format for folder entries. Fixes Dir entries issue
        });

        async function addFiles() {
            const entries = await readdir(dirPath, { recursive: true, withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(entry.parentPath, entry.name);
                const relPath = path.relative(dirPath, fullPath).replaceAll(path.sep, path.posix.sep);

                if (entry.isDirectory()) {
                    await zipStream.zipWriter.add(relPath + '/', null);
                } else {
                    await Readable.toWeb(createReadStream(fullPath)).pipeTo(zipStream.writable(relPath));
                }
                // console.log ("zip addfile: " + entry);
            }
        }

        await Promise.all([
            addFiles().then(() => zipStream.close()),
            pipeline(Readable.fromWeb(zipStream.readable), createWriteStream(outputZip)),
        ]);
        return { res: true, mes: 'Zip created succesfully' };
    } catch (e) {
        // console.error(e);
        return { res: false, mes: e.message };
    }
}

// Move the folders zipExtract kept at the root of destPath to where they belong
// Try rename (move) first, else copy/remove
module.exports.moveExtractedFolders = async function (destPath, destinations) {
    const path = require('path');
    const fsp = require('fs/promises');
    const { existsSync } = require('fs');
    const moved = [], failed = [];

    for (const folderName in destinations) {
        const srcPath = path.join(destPath, folderName);
        const folderDest = destinations[folderName];
        if (!existsSync(srcPath)) continue;
        if (typeof folderDest != 'string') { failed.push(folderName + ': no destination, left in ' + srcPath); continue; }
        try {
            await fsp.mkdir(path.dirname(folderDest), { recursive: true });
            try {
                await fsp.rename(srcPath, folderDest);
            } catch (e) {
                if (['EXDEV', 'ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES'].indexOf(e.code) == -1) throw e;
                await fsp.cp(srcPath, folderDest, { recursive: true, force: true });
                await fsp.rm(srcPath, { recursive: true, force: true });
            }
            moved.push(folderName + ' -> ' + folderDest);
        } catch (e) {
            failed.push(folderName + ' -> ' + folderDest + ': ' + e.message);
        }
    }

    return { res: (failed.length == 0), moved: moved, mes: failed.length ? ('Unable to move: ' + failed.join('; ')) : ('Moved ' + moved.length + ' folder(s)') };
}

// restore zipfile
// First check archive on illegal paths (updirs and absolute paths), then extract
module.exports.zipExtract = async function (zipPath, destPath, removePath = '', password = "") {
    try {
        const { ZipReader, Uint8ArrayReader } = require("@zip.js/zip.js");
        const { createWriteStream } = require("fs");
        const { readFile, mkdir } = require("fs/promises");
        const path = require("path");
        const { Readable } = require("stream");
        const { pipeline } = require("stream/promises");

        const zipReader = new ZipReader(new Uint8ArrayReader(await readFile(zipPath)));
        const entries = await zipReader.getEntries();
        const resolveDestPath = path.resolve(destPath);

        // Archive validation: Abort the restore on any bad path before extraction
        const targets = []; // { entry, fullPath } cache the paths while we're at it
        for (const entry of entries) {
            // skip symlinks in unix-mode zips (upper 16 bits hold st_mode); not present in dos/win zips
            if (((entry.externalFileAttributes >>> 16) & 0xF000) === 0xA000) { continue; }

            // anchored prefix strip — must match what the extraction pass writes
            let name = entry.filename;
            if (Array.isArray(removePath)) {
                const parts = name.split(/[/\\]/);
                if ((parts.length > 1) && (removePath.indexOf(parts[0]) == -1)) { name = parts.slice(1).join('/'); }
            } else if (removePath && name.startsWith(removePath)) { name = name.slice(removePath.length); }

            // reject any parent-dir token outright (split on both separators; segment match, not substring)
            if (name.split(/[/\\]/).includes('..')) {
                throw new Error('Aborting, nothing restored. Illegal path (parent traversal) in zip, entry: ' + entry.filename);
            }
            // reject absolute paths (posix root, or Windows drive / UNC)
            if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith('\\')) {
                throw new Error('Aborting, nothing restored. Illegal absolute path in zip, entry: ' + entry.filename);
            }

            // backstop: resolved target must stay inside destPath
            const fullPath = path.resolve(destPath, name);
            if (fullPath !== resolveDestPath && !fullPath.startsWith(resolveDestPath + path.sep)) {
                throw new Error('Illegal path in zip entry: ' + entry.filename);
            }

            targets.push({ entry, fullPath });
        }

        // Validated, extract!
        for (const { entry, fullPath } of targets) {
            if (entry.directory) {
                await mkdir(fullPath, { recursive: true });
            } else {
                await mkdir(path.dirname(fullPath), { recursive: true });
                const { writable, readable } = new TransformStream();
                await Promise.all([
                    entry.getData(writable, { password }),
                    pipeline(Readable.fromWeb(readable), createWriteStream(fullPath)),
                ]);
            }
        }

        await zipReader.close();
        return { res: true, mes: 'Extraction successful' };
    } catch (e) {
        // console.error(e.message);
        return { res: false, mes: e.message };
    }
}