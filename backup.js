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

// restore zipfile
// removePath: optional path to remove from destination path
module.exports.zipExtract = async function (zipPath, destPath, removePath = '', password = "") {
    try {
        const { ZipReader, BlobReader } = require("@zip.js/zip.js");
        const { createWriteStream } = require("fs");
        const { readFile, mkdir } = require("fs/promises");
        const path = require("path");
        const { Readable } = require("stream");
        const { pipeline } = require("stream/promises");

        const zipReader = new ZipReader(new BlobReader(new Blob([(await readFile(zipPath))])));
        const entries = await zipReader.getEntries();
        const resolveDestPath = path.resolve(destPath);

        for (const entry of entries) {
            const fullPath = path.posix.join(destPath.replaceAll(path.sep, path.posix.sep), entry.filename).replace(removePath, '');
            // don't allow destPath dir escapes
            const resolveEntry = path.resolve(destPath, entry.filename);
            if (!resolveEntry.startsWith(resolveDestPath)) {
                throw new Error('Illegal path in zip entry');
            }
            if (entry.directory) {
                await mkdir(fullPath, { recursive: true });
            } else {
                // zipFileEntry, make sure the path is there
                await mkdir(path.dirname(fullPath), { recursive: true });
                const { writable, readable } = new TransformStream();
                await Promise.all([
                    entry.getData(writable, { password: password }),
                    pipeline(Readable.fromWeb(readable), createWriteStream(fullPath)),
                ]);
            }
            // console.log('extracted: ' + fullPath);
        }
        await zipReader.close();
        return { res: true, mes: 'Extraction successful' };
    } catch (e) {
        // console.error(e.message);
        return { res: false, mes: e.message };
    }
}
