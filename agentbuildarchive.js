'use strict';

const fs = require('fs');
const path = require('path');
const { Reader, ZipReader } = require('@zip.js/zip.js');

function native(header) {
    return ['7f454c46', 'cffaedfe', 'cefaedfe'].includes(header.subarray(0, 4).toString('hex')) || header.subarray(0, 2).toString() === 'MZ';
}
exports.unpack = async function (filename, directory, budget, signal) {
    const handle = await fs.promises.open(filename, 'r');
    let zip;
    try {
        const header = Buffer.alloc(4);
        await handle.read(header, 0, 4, 0);
        if (header.readUInt32LE(0) !== 0x04034b50) return null;
        const reader = new Reader();
        reader.size = (await handle.stat()).size;
        reader.readUint8Array = async function (offset, length) {
            if (signal.aborted) throw new Error('Import cancelled or timed out.');
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > reader.size) throw new Error('Invalid ZIP offsets.');
            const data = Buffer.alloc(length);
            let read = 0;
            while (read < length) {
                const result = await handle.read(data, read, length - read, offset + read);
                if (!result.bytesRead) throw new Error('Truncated ZIP archive.');
                read += result.bytesRead;
            }
            return data;
        };
        zip = new ZipReader(reader, { useWebWorkers: false });
        const files = [], skipped = [], names = new Set();
        for await (const entry of zip.getEntriesGenerator()) {
            if (signal.aborted) throw new Error('Import cancelled or timed out.');
            const name = entry.filename, type = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (++budget.entries > 512 || name.length > 1024 || name.includes('\\') || name.includes('\0') || /^[a-zA-Z]:/.test(name) || name.startsWith('/') || name.split('/').some(x => x === '..' || x === '.') || names.has(name.toLowerCase())) throw new Error('Unsafe or duplicate ZIP entry.');
            names.add(name.toLowerCase());
            if (type && type !== 0x8000 && type !== 0x4000) throw new Error('ZIP links and special files are not supported.');
            if (name.endsWith('/')) continue;
            if (type === 0x4000 || entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > 64 * 1024 * 1024 || budget.bytes + entry.uncompressedSize > 128 * 1024 * 1024) throw new Error('ZIP must be unencrypted, at most 64 MiB per file and 128 MiB unpacked.');
            const target = path.join(directory, 'entry-' + budget.entries), head = Buffer.alloc(4), output = await fs.promises.open(target, 'wx', 0o600);
            let length = 0;
            try {
                await entry.getData(new WritableStream({ async write(chunk) {
                    if (length < 4) Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(head, length, 0, Math.min(4 - length, chunk.length));
                    length += chunk.length; budget.bytes += chunk.length;
                    if (length > entry.uncompressedSize || length > 64 * 1024 * 1024 || budget.bytes > 128 * 1024 * 1024) throw new Error('ZIP exceeds the unpacked size limit.');
                    await output.writeFile(chunk);
                } }), { signal, checkSignature: true, useWebWorkers: false });
                if (length !== entry.uncompressedSize) throw new Error('ZIP entry size does not match.');
            } finally { await output.close(); }
            if (native(head)) {
                if (++budget.files > 16) throw new Error('Select archives containing at most 16 native binaries in total.');
                files.push({ originalFilename: path.posix.basename(name), path: target, archivePath: name });
            } else { skipped.push(name); await fs.promises.unlink(target); }
        }
        return { files, skipped };
    } catch (ex) {
        if (signal.aborted) throw new Error('Import cancelled or timed out.');
        throw new Error(ex.message && /ZIP|native binaries/.test(ex.message) ? ex.message : 'ZIP extraction or integrity check failed.');
    } finally { if (zip) await zip.close(); await handle.close(); }
};
