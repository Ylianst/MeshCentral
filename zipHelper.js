/**
 * zipHelper.js — Unified ZIP creation using @zip.js/zip.js
 * Replaces 'archiver' (66 dependencies) with '@zip.js/zip.js' (1 dependency).
 *
 * #7918: Remove archiver dependency in favor of @zip.js
 *
 * Provides two modes:
 *   1. Streaming (for meshcentral.js agent compression — pipes to a writable)
 *   2. File-based (for db.js backups and webserver.js agent download)
 *
 * Encrypted ZIP support via AES-256 (password-based).
 */

const { ZipWriter } = require('@zip.js/zip.js');
const { WritableStream, ReadableStream } = require('@zip.js/zip.js');

/**
 * Create a ZIP archive from an array of { name, data } entries.
 * @param {Array<{name: string, data: Buffer}>} entries
 * @param {Object} opts
 * @param {number} [opts.level=5] - Compression level (1-9, mapped to zip.js configuration)
 * @param {string} [opts.password] - Password for AES-256 encryption
 * @param {Function} [opts.onProgress] - Progress callback (entriesWritten, totalEntries)
 * @returns {Promise<Buffer>} The ZIP file as a Buffer
 */
async function createZipFromEntries(entries, opts) {
    opts = opts || {};
    const level = Math.min(Math.max(opts.level || 5, 1), 9);

    // Build zip.js options
    const zipOptions = { bufferedWrite: true };
    if (opts.password) {
        zipOptions.password = opts.password;
        zipOptions.encryption = 'AES-256';
    }

    // Use a writer that collects into a buffer
    const chunks = [];
    const writable = new WritableStream({
        write(chunk) { chunks.push(Buffer.from(chunk)); }
    });

    const writer = new ZipWriter(writable, zipOptions);

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        await writer.add(entry.name, new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(data));
                controller.close();
            }
        }));
        if (opts.onProgress) { opts.onProgress(i + 1, entries.length); }
    }

    await writer.close();
    return Buffer.concat(chunks);
}

/**
 * Create a ZIP archive and write it to a file path.
 * @param {string} outputPath
 * @param {Array<{name: string, data: Buffer}>} entries
 * @param {Object} opts - Same as createZipFromEntries
 * @returns {Promise<{size: number}>}
 */
async function createZipFile(outputPath, entries, opts) {
    const fs = require('fs');
    const data = await createZipFromEntries(entries, opts);
    fs.writeFileSync(outputPath, data);
    return { size: data.length };
}

/**
 * Create a streaming ZIP that writes to a Node.js Writable stream.
 * Useful for meshcentral.js agent compression where archiver used event-based streaming.
 * @param {NodeJS.WritableStream} outputStream
 * @param {Array<{name: string, data: Buffer}>} entries
 * @param {Object} opts
 * @param {Function} [opts.onEnd] - Called when ZIP is finalized with { size }
 * @param {Function} [opts.onError] - Called on error
 */
async function createZipStream(outputStream, entries, opts) {
    opts = opts || {};
    const zipOptions = { bufferedWrite: true };
    if (opts.password) {
        zipOptions.password = opts.password;
        zipOptions.encryption = 'AES-256';
    }

    const writer = new ZipWriter(outputStream, zipOptions);
    try {
        for (const entry of entries) {
            const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
            await writer.add(entry.name, new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array(data));
                    controller.close();
                }
            }));
        }
        await writer.close();
        if (opts.onEnd) { opts.onEnd({ size: writer.size }); }
    } catch (ex) {
        if (opts.onError) { opts.onError(ex); }
        else { throw ex; }
    }
}

module.exports = { createZipFromEntries, createZipFile, createZipStream };
