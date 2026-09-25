'use strict';

// Agent builds subsystem: the catalog of agent binaries, per-device build policy,
// bulk deployment, default release downloads and the upload/GitHub import pipeline.
// Agent architecture definitions stay in agenttypes.js so new agents can be added there.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { Reader, ZipReader } = require('@zip.js/zip.js');

// Agent build record storage helpers
const storage = {
    get: (db, id) => new Promise((resolve, reject) => db.Get(id, (err, docs) => err ? reject(err) : resolve((docs || [])[0]))),
    set: (db, value) => new Promise((resolve, reject) => db.Set(value, err => err ? reject(err) : resolve(value))),
    remove: (db, id) => new Promise((resolve, reject) => db.Remove(id, err => err ? reject(err) : resolve())),
    async *records(db, type, domain, prefix = '') {
        let cursor = prefix;
        for (;;) {
            const rows = await new Promise((resolve, reject) => db.GetAgentBuildRecords(type, domain, cursor, 500, (err, rows) => err ? reject(err) : resolve(rows || []), prefix));
            for (const row of rows) yield row;
            if (rows.length < 500) return;
            const next = rows[rows.length - 1]._id;
            if (next === cursor) throw new Error('Invalid agent build pagination.');
            cursor = next;
        }
    },
    admin(domain, user, loginToken) {
        if (!user || user.domain !== domain.id || user.siteadmin !== 0xFFFFFFFF || loginToken) throw new Error('Access denied');
    },
    domainKey: domain => crypto.createHash('sha256').update(domain.id || '').digest('hex')
};

// Native executable inspection (ELF, PE, Mach-O)
const binary = (function () {
    const policyGuids = ['b996015880544a19b7f7e9be44914c18', 'b996015880544a19b7f7e9be44914c19'];

    function inspect(data, architectures) {
        if (!Buffer.isBuffer(data) || data.length < 64 || data.length > 64 * 1024 * 1024) throw new Error('Agent files must be between 64 bytes and 64 MiB.');
        function range(offset, size) {
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > data.length) throw new Error('Invalid executable offsets.');
            return offset;
        }
        let little = true;
        const u16 = p => little ? data.readUInt16LE(range(p, 2)) : data.readUInt16BE(range(p, 2));
        const u32 = p => little ? data.readUInt32LE(range(p, 4)) : data.readUInt32BE(range(p, 4));
        function u64(p) {
            const value = little ? data.readBigUInt64LE(range(p, 8)) : data.readBigUInt64BE(range(p, 8));
            if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Executable offset is too large.');
            return Number(value);
        }
        function string(offset, end) {
            range(offset, end - offset);
            const zero = data.indexOf(0, offset);
            if (zero < offset || zero >= end || zero - offset > 4096) throw new Error('Invalid executable string.');
            return data.toString('utf8', offset, zero);
        }
        let platform, cpu, ids = [], checksum = 0, table = 0, end = data.length;
        const metadata = {}, warnings = [];
        if (data.subarray(0, 4).toString('hex') === '7f454c46') {
            if (![1, 2].includes(data[4]) || ![1, 2].includes(data[5]) || data[6] !== 1) throw new Error('Unsupported ELF header.');
            little = data[5] === 1;
            const wide = data[4] === 2, word = wide ? u64 : u32, machine = u16(18);
            if (![2, 3].includes(u16(16)) || !word(24)) throw new Error('Use an executable agent, not a library or object file.');
            cpu = ({ 3: 'x86', 62: 'x86_64', 40: 'arm', 183: 'arm64', 8: little ? 'mipsel' : 'mips', 243: 'riscv64' })[machine];
            metadata.elfClass = wide ? 64 : 32;
            metadata.elfMachine = machine;
            const phoff = word(wide ? 32 : 28), phsize = u16(wide ? 54 : 42), phnum = u16(wide ? 56 : 44), loads = [];
            if (!phnum || phnum > 1024 || phsize < (wide ? 56 : 32)) throw new Error('Invalid ELF program headers.');
            range(phoff, phsize * phnum);
            let dynamic;
            for (let i = 0; i < phnum; i++) {
                const p = phoff + i * phsize, type = u32(p), offset = word(p + (wide ? 8 : 4)), size = word(p + (wide ? 32 : 16));
                range(offset, size);
                if (type === 1) loads.push({ offset, size, address: word(p + (wide ? 16 : 8)) });
                if (type === 2) dynamic = { offset, size };
                if (type === 3) metadata.interpreter = string(offset, offset + size);
                if (type === 4) {
                    for (let n = offset; n + 12 <= offset + size;) {
                        const names = u32(n), desc = u32(n + 4), kind = u32(n + 8), next = n + 12 + Math.ceil(names / 4) * 4 + Math.ceil(desc / 4) * 4;
                        if (next > offset + size || next <= n) throw new Error('Invalid ELF note.');
                        if (names === 8 && data.toString('ascii', n + 12, n + 19) === 'FreeBSD' && kind === 1 && desc === 4) metadata.freebsdAbi = u32(n + 20);
                        n = next;
                    }
                }
            }
            platform = data[7] === 9 || metadata.freebsdAbi || metadata.interpreter === '/libexec/ld-elf.so.1' ? 'freebsd' : ([0, 3].includes(data[7]) ? 'linux' : null);
            if (dynamic) {
                let strtab, strsize; const needed = [], step = wide ? 16 : 8;
                if (dynamic.size / step > 65536) throw new Error('Too many ELF dynamic entries.');
                for (let p = dynamic.offset; p + step <= dynamic.offset + dynamic.size; p += step) {
                    const tag = word(p), value = word(p + step / 2);
                    if (!tag) break;
                    if (tag === 1) needed.push(value);
                    if (tag === 5) strtab = value;
                    if (tag === 10) strsize = value;
                }
                if (needed.length > 64) throw new Error('Too many required libraries.');
                if (needed.length) {
                    const load = loads.find(x => strtab >= x.address && strtab + strsize <= x.address + x.size);
                    if (!load || !strsize) throw new Error('Invalid ELF library table.');
                    const offset = load.offset + strtab - load.address;
                    metadata.neededLibraries = needed.map(x => { const name = string(offset + x, offset + strsize); if (name.length > 256) throw new Error('Invalid library name.'); return name; });
                }
            }
            const shoff = word(wide ? 40 : 32), shsize = u16(wide ? 58 : 46), shnum = u16(wide ? 60 : 48);
            if (shnum > 4096 || (shnum && shsize < (wide ? 64 : 40))) throw new Error('Invalid ELF section headers.');
            range(shoff, shsize * shnum);
            const sections = [];
            for (let i = 0; i < shnum; i++) {
                const p = shoff + i * shsize;
                sections.push({ type: u32(p + 4), offset: word(p + (wide ? 24 : 16)), size: word(p + (wide ? 32 : 20)), link: u32(p + (wide ? 40 : 24)) });
            }
            const versions = []; let versionCount = 0;
            for (const section of sections.filter(x => x.type === 0x6ffffffe)) {
                const strings = sections[section.link];
                if (!strings) throw new Error('Invalid ELF version table.');
                range(strings.offset, strings.size); range(section.offset, section.size);
                let p = section.offset;
                for (let count = 0; p < section.offset + section.size && count < 4096; count++) {
                    if (p + 16 > section.offset + section.size) throw new Error('Invalid ELF version entry.');
                    let a = p + u32(p + 8); const total = u16(p + 2), next = u32(p + 12);
                    if (total > 4096) throw new Error('Too many ELF versions.');
                    for (let j = 0; j < total; j++) {
                        if (a < section.offset || a + 16 > section.offset + section.size) throw new Error('Invalid ELF version requirement.');
                        if (++versionCount > 65536) throw new Error('Too many ELF version requirements.');
                        const name = string(strings.offset + u32(a + 8), strings.offset + strings.size);
                        if (/^GLIBC_[0-9]+(?:\.[0-9]+){1,2}$/.test(name)) versions.push(name.slice(6));
                        const advance = u32(a + 12);
                        if (j + 1 < total && advance < 16) throw new Error('Invalid ELF version chain.');
                        a += advance;
                    }
                    if (!next) break;
                    if (next < 16) throw new Error('Invalid ELF version chain.');
                    p += next;
                }
            }
            versions.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; });
            if (versions.length) metadata.glibcRequired = versions.at(-1);
            if ((metadata.interpreter || '').includes('ld-musl-')) metadata.libc = 'musl';
            if (platform === 'freebsd') ids = cpu === 'x86_64' ? [30] : [];
            else if (platform === 'linux') ids = ({ x86: [5, 8, 15, 19], x86_64: [6, 18, 20, 33, 36], arm: [9, 10, 13, 24, 25, 27, 35], arm64: [26, 32, 41], mips: [7, 28], mipsel: [40], riscv64: [45] })[cpu] || [];
            if (cpu === 'arm') { metadata.requirementsIncomplete = true; warnings.push('ARM instruction set requirements need manual verification.'); }
            if (wide !== ['x86_64', 'arm64', 'riscv64'].includes(cpu)) throw new Error('ELF word size does not match its CPU.');
        } else if (data.toString('ascii', 0, 2) === 'MZ') {
            const pe = u32(60); range(pe, 24);
            if (u32(pe) !== 0x4550) throw new Error('Invalid PE signature.');
            const machine = u16(pe + 4), sections = u16(pe + 6), optional = pe + 24, size = u16(pe + 20), magic = u16(optional), wide = magic === 0x20b;
            if (![0x10b, 0x20b].includes(magic) || size < (wide ? 152 : 136) || !sections || sections > 96 || (u16(pe + 22) & 0x2000)) throw new Error('Use a supported Windows executable agent.');
            range(optional, size); range(optional + size, sections * 40);
            for (let i = 0; i < sections; i++) { const p = optional + size + i * 40; range(u32(p + 20), u32(p + 16)); }
            platform = 'windows'; cpu = ({ 0x14c: 'x86', 0x8664: 'x86_64', 0xaa64: 'arm64' })[machine];
            if (wide !== ['x86_64', 'arm64'].includes(cpu)) throw new Error('PE word size does not match its CPU.');
            ids = ({ x86: [1, 3, 21, 22], x86_64: [2, 4], arm64: [42, 43] })[cpu] || [];
            checksum = optional + 64; table = optional + (wide ? 144 : 128);
            const certificate = u32(table), certificateSize = u32(table + 4);
            if (certificate) { range(certificate, certificateSize); if (certificate < table + 8 || !certificateSize) throw new Error('Invalid PE signature table.'); end = certificate; }
            metadata.peSubsystemVersion = u16(optional + 48) + '.' + u16(optional + 50);
            metadata.embeddedAuthenticode = certificate ? 'Present, trust not verified' : 'None';
        } else if ([0xfeedface, 0xfeedfacf].includes(data.readUInt32LE(0))) {
            const wide = u32(0) === 0xfeedfacf, machine = u32(4), commands = u32(16), size = u32(20);
            if (u32(12) !== 2 || commands > 4096) throw new Error('Upload a Mach-O executable agent.');
            platform = 'macos'; cpu = ({ 7: 'x86', 0x1000007: 'x86_64', 0x100000c: 'arm64' })[machine];
            if (wide !== ['x86_64', 'arm64'].includes(cpu)) throw new Error('Mach-O word size does not match its CPU.');
            ids = ({ x86: [11], x86_64: [16], arm64: [29] })[cpu] || [];
            const start = wide ? 32 : 28; range(start, size); let p = start;
            for (let i = 0; i < commands; i++) {
                const cmd = u32(p), length = u32(p + 4);
                if (length < 8 || p + length > start + size) throw new Error('Invalid Mach-O load command.');
                let version;
                if (cmd === 0x24 && length >= 16) version = u32(p + 8);
                if (cmd === 0x32 && length >= 24 && u32(p + 8) === 1) version = u32(p + 12);
                if (version) metadata.minimumMacos = (version >>> 16) + '.' + ((version >>> 8) & 255) + '.' + (version & 255);
                if (cmd === 0x1d && length >= 16) { range(u32(p + 8), u32(p + 12)); metadata.embeddedSignature = 'Present, trust not verified'; }
                p += length;
            }
            if (p !== start + size) throw new Error('Invalid Mach-O command count.');
        } else { throw new Error('Use a native ELF, PE or Mach-O agent file. Archives and universal agent files are not supported.'); }
        if (!platform || !cpu || !ids.length) throw new Error('This executable architecture is not supported.');
        if (policyGuids.includes(data.subarray(-16).toString('hex'))) {
            warnings.push('This file contains embedded connection settings. Use an unconfigured agent file.');
            throw new Error(warnings.at(-1));
        }
        const candidates = ids.filter(id => architectures[id] && architectures[id].update).map(id => ({ id, name: architectures[id].desc }));
        if (!candidates.length) throw new Error('No supported MeshAgent type matches this executable.');
        const digest = crypto.createHash('sha384');
        if (checksum) digest.update(data.subarray(0, checksum)).update(Buffer.alloc(4)).update(data.subarray(checksum + 4, table)).update(Buffer.alloc(8)).update(data.subarray(table + 8, end));
        else digest.update(data.subarray(0, end));
        const sha384 = crypto.createHash('sha384').update(data).digest('hex');
        return { platform, cpu, size: data.length, binaryMetadata: metadata, candidates, warnings, hashes: { sha256: crypto.createHash('sha256').update(data).digest('hex'), sha384, agentSha384: digest.digest('hex') } };
    }
    return { inspect };
})();

// ZIP archive extraction for imported builds
const archive = (function () {
    function native(header) {
        return ['7f454c46', 'cffaedfe', 'cefaedfe'].includes(header.subarray(0, 4).toString('hex')) || header.subarray(0, 2).toString() === 'MZ';
    }
    async function unpack(filename, directory, budget, signal) {
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
    }
    return { unpack };
})();

// HTTPS downloads and GitHub API access with private-address guards
const fetch = (function () {
    const blocked = new net.BlockList();
    for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
    const global6 = new net.BlockList();
    global6.addSubnet('2000::', 3, 'ipv6');
    for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');
    function publicAddress(address) {
        const family = net.isIP(address);
        return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && global6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
    }
    function parseUrl(value) {
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a public HTTPS download URL.');
        let url;
        try { url = new URL(value); } catch (ex) { throw new Error('Enter a public HTTPS download URL.'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('Use HTTPS on port 443 without a username, password or fragment.');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && !publicAddress(host)) throw new Error('Downloads from private or reserved addresses are not allowed.');
        return url;
    }
    function sourceUrl(value) {
        const url = parseUrl(value);
        url.search = '';
        return url.href;
    }
    function createClient(transport = https, lookup = dns.lookup) {
        async function response(value, options, redirects = 0, authenticated = true) {
            const url = parseUrl(value), hostname = url.hostname.replace(/^\[|\]$/g, '');
            const headers = { 'User-Agent': 'MeshCentral-AgentBuilds', Accept: options.json ? 'application/vnd.github+json' : 'application/octet-stream', 'Accept-Encoding': 'identity' };
            if (url.hostname === 'api.github.com') {
                headers['X-GitHub-Api-Version'] = '2022-11-28';
                if (/\/actions\/artifacts\/\d+\/zip$/.test(url.pathname)) headers.Accept = 'application/vnd.github+json';
                if (options.token && authenticated) headers.Authorization = 'Bearer ' + options.token;
                if (options.etag) headers['If-None-Match'] = options.etag;
            }
            const res = await new Promise((resolve, reject) => {
                let timer;
                const request = transport.get(url, { headers, agent: false, signal: options.signal, lookup: function (host, settings, callback) {
                    lookup(host, { all: true, verbatim: true }, (err, addresses) => {
                        if (err || !addresses || !addresses.length) return callback(new Error('Unable to resolve the download host.'));
                        if (addresses.some(x => !publicAddress(x.address))) return callback(new Error('Downloads from private or reserved addresses are not allowed.'));
                        // Return the checked address to the socket so a second lookup cannot change the destination.
                        callback(null, settings.all ? [addresses[0]] : addresses[0].address, addresses[0].family);
                    });
                } }, res => { clearTimeout(timer); resolve(res); });
                timer = setTimeout(() => request.destroy(new Error('Download timed out.')), 20000);
                request.setTimeout(20000, () => request.destroy(new Error('Download timed out.')));
                request.on('error', err => { clearTimeout(timer); reject(err.name === 'AbortError' ? new Error('Import cancelled or timed out.') : new Error(/private or reserved|resolve the download|timed out/.test(err.message) ? err.message : 'Unable to download from this host.')); });
            });
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                res.destroy();
                if (redirects >= 5 || options.json) throw new Error('Too many redirects or an unexpected API redirect.');
                const next = parseUrl(new URL(res.headers.location || '', url).href);
                return response(next.href, options, redirects + 1, authenticated && next.origin === url.origin);
            }
            if (res.statusCode === 304 && options.conditional) {
                res.destroy();
                return { res, url: sourceUrl(url.href) };
            }
            if (res.statusCode !== 200) {
                res.destroy();
                if (options.conditional && (res.statusCode === 403 || res.statusCode === 429)) {
                    const error = new Error('GitHub denied the release check or its rate limit was reached. The next check has been delayed.');
                    error.retryAt = Math.min(Date.now() + 7 * 86400000, Math.max(Date.now() + 3600000, (Number(res.headers['x-ratelimit-reset']) || 0) * 1000, Date.now() + (Number(res.headers['retry-after']) || 0) * 1000));
                    throw error;
                }
                let message = 'Download failed (HTTP ' + res.statusCode + ').';
                if (res.statusCode === 401 || res.statusCode === 403) message = 'Download denied or API rate limit reached. Check the GitHub token and repository read permissions.';
                if (res.statusCode === 404) message = 'File or GitHub resource not found, or the token cannot access it.';
                if (res.statusCode === 410) message = 'This GitHub artifact has expired. Select a newer build.';
                const error = new Error(message);
                error.statusCode = res.statusCode;
                throw error;
            }
            if ((res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length']) > options.limit) {
                res.destroy(); throw new Error('Download exceeds the size limit or uses unsupported HTTP compression.');
            }
            return { res, url: sourceUrl(url.href) };
        }
        async function download(url, filename, options) {
            const { res, url: finalUrl } = await response(url, options), hash = crypto.createHash('sha256');
            let size = 0;
            const meter = new Transform({ transform(chunk, encoding, callback) {
                size += chunk.length;
                if (size > options.limit) return callback(new Error('Download exceeds the size limit.'));
                hash.update(chunk);
                if (options.progress) options.progress(size, Number(res.headers['content-length']) || null);
                callback(null, chunk);
            } });
            await pipeline(res, meter, fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }), { signal: options.signal });
            const sha256 = hash.digest('hex');
            if (options.sha256 && sha256 !== options.sha256) throw new Error('The downloaded SHA256 does not match the expected digest.');
            return { url: sourceUrl(url), finalUrl, size, sha256, digestVerified: !!options.sha256 };
        }
        async function readJson(res) {
            const chunks = []; let length = 0;
            try {
                for await (const chunk of res) {
                    length += chunk.length;
                    if (length > 4 * 1024 * 1024) throw new Error('GitHub response exceeds the size limit.');
                    chunks.push(chunk);
                }
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch (ex) { res.destroy(); throw new Error('Unable to read the GitHub response.'); }
        }
        async function json(url, token, signal) {
            const { res } = await response(url, { json: true, token, signal, limit: 4 * 1024 * 1024 });
            return readJson(res);
        }
        async function conditionalJson(url, etag, signal) {
            const { res } = await response(url, { json: true, conditional: true, etag, signal, limit: 4 * 1024 * 1024 });
            return { unchanged: res.statusCode === 304, etag: res.headers.etag, data: res.statusCode === 304 ? null : await readJson(res) };
        }
        return { download, json, conditionalJson };
    }
    return { publicAddress, parseUrl, sourceUrl, createClient };
})();

// Device compatibility checks against build requirements
const compatibility = (function () {
    function version(value) {
        return (typeof value === 'string' && /^\d+(\.\d+){0,3}$/.test(value)) ? value.split('.').map(Number) : null;
    }

    function compare(found, required) {
        const a = version(found), b = version(required);
        if (!a || !b) return null;
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
        }
        return true;
    }

    function request(artifacts) {
        const paths = new Set(), libraries = new Set();
        for (const artifact of artifacts) {
            const metadata = artifact.metadata || {};
            if (typeof metadata.interpreter === 'string' && /^\/(?:[a-zA-Z0-9_.+-]+\/)*[a-zA-Z0-9_.+-]+$/.test(metadata.interpreter) && !metadata.interpreter.includes('..')) paths.add(metadata.interpreter);
            if (Array.isArray(metadata.neededLibraries)) {
                for (const name of metadata.neededLibraries) { if (typeof name === 'string' && /^[a-zA-Z0-9_+.-]{1,100}$/.test(name)) libraries.add(name); }
            }
        }
        return { paths: Array.from(paths).sort().slice(0, 16), libraries: Array.from(libraries).sort().slice(0, 64) };
    }

    function check(artifact, facts) {
        const metadata = artifact.metadata || {}, checks = [];
        function add(name, required, detected, result, advice) {
            checks.push({ name: name, required: String(required || ''), detected: String(detected || 'Not reported'), status: result === true ? 'pass' : result === false ? 'fail' : 'unknown', advice: result === false || result == null ? advice : '' });
        }
        if (!facts || facts.version !== 1) return { status: 'unknown', checks: [], message: 'Device requirements have not been checked.' };
        const platform = { windows: 'win32', linux: 'linux', macos: 'darwin', freebsd: 'freebsd' }[artifact.platform];
        add('Operating system', platform, facts.platform, platform && facts.platform ? platform === facts.platform : null, 'Choose a build for this operating system.');
        const architecture = { x86: [32, 3], x86_64: [64, 62], arm: [32, 40], arm64: [64, 183] }[artifact.cpu];
        if (metadata.interpreter) {
            const loader = (facts.paths || []).find(x => x.path === metadata.interpreter);
            const present = loader && loader.status === 'present';
            const correct = architecture && present && loader.bits && loader.machine ? loader.bits === architecture[0] && loader.machine === architecture[1] : null;
            add('Loader', metadata.interpreter, loader && loader.status, loader && loader.status === 'missing' ? false : correct, 'Install the required runtime for this agent architecture, or choose a build for the existing runtime.');
        }
        if (metadata.glibcRequired) add('glibc', metadata.glibcRequired + '+', facts.glibc, compare(facts.glibc, metadata.glibcRequired), 'Use an OS release providing glibc ' + metadata.glibcRequired + ' or later, or choose an older agent build. Do not replace libc manually.');
        if (metadata.libc && !(metadata.libc === 'musl' && /^\/lib\/ld-musl-[a-zA-Z0-9_+-]+\.so\.1$/.test(metadata.interpreter || ''))) add('C runtime', metadata.libc, null, null, 'This runtime requirement cannot be checked automatically.');
        if (metadata.minimumMacos) add('macOS', metadata.minimumMacos + '+', facts.macos, compare(facts.macos, metadata.minimumMacos), 'Upgrade macOS to ' + metadata.minimumMacos + ' or later, or choose an older agent build.');
        if (Number.isInteger(metadata.freebsdAbi)) add('FreeBSD ABI', metadata.freebsdAbi, facts.freebsdAbi, Number.isInteger(facts.freebsdAbi) ? facts.freebsdAbi >= metadata.freebsdAbi : null, 'Upgrade to a FreeBSD release meeting this ABI requirement, or choose a build for the installed release.');
        if (Array.isArray(metadata.neededLibraries)) {
            for (const name of metadata.neededLibraries) {
                const library = (facts.libraries || []).find(x => x.name === name);
                const found = architecture && library && Array.isArray(library.architectures) && library.architectures.some(x => x.bits === architecture[0] && x.machine === architecture[1]);
                // A library outside the cache and standard paths may still be resolvable by the loader.
                add('Library', name, found ? 'Found for this architecture' : 'Not found in checked paths', found ? true : null, 'Install the package providing ' + name + ' for this architecture, or verify its library search path.');
            }
        }
        if (metadata.armAttributes) {
            const features = Array.isArray(facts.features) && facts.features.length ? facts.features : null;
            const requiredVersion = /^v(\d+)$/.exec(metadata.armAttributes.cpuArch || '');
            if (metadata.armAttributes.cpuArch) add('ARM architecture', metadata.armAttributes.cpuArch, facts.armVersion, requiredVersion && Number.isInteger(facts.armVersion) ? facts.armVersion >= Number(requiredVersion[1]) : null, 'Choose a build targeting this CPU.');
            for (const [field, flag] of [['advancedSimdArch', 'neon'], ['fpArch', 'vfpv3']]) {
                if (!metadata.armAttributes[field]) continue;
                const known = (field === 'advancedSimdArch' && metadata.armAttributes[field] === 'NEONv1') || (field === 'fpArch' && metadata.armAttributes[field] === 'VFPv3');
                const supported = known && features && !features.includes('asimd') ? (features.includes(flag) || (flag === 'vfpv3' && features.includes('vfpv4') && (features.includes('vfpd32') || features.includes('neon')))) : null;
                add('CPU feature', metadata.armAttributes[field], features ? (supported ? 'Present' : 'Not reported by CPU') : null, supported, 'Choose a build targeting this CPU. Software upgrades cannot add a missing CPU instruction set.');
            }
        }
        if (metadata.requirementsIncomplete) add('Additional requirements', 'Manual verification', null, null, 'The executable does not expose all requirements supported by this inspector. Verify them before deployment.');
        const declared = metadata.glibcRequired || metadata.libc || metadata.minimumMacos || metadata.freebsdAbi;
        if (!declared) add('Build requirements', 'Platform requirements', null, null, 'This build does not declare enough platform requirements for an automatic check.');
        return { status: checks.some(x => x.status === 'fail') ? 'blocked' : checks.some(x => x.status === 'unknown') ? 'unknown' : 'compatible', checks: checks };
    }

    function validate(data, query) {
        if (!data || data.version !== 1 || !['linux', 'freebsd', 'darwin', 'win32'].includes(data.platform) || JSON.stringify(data).length > 65536) return null;
        const result = { version: 1, platform: data.platform, paths: [], libraries: [] };
        if (data.agentVersion && /^[a-f0-9]{40}$/.test(data.agentVersion.commit)) {
            result.agentVersion = { commit: data.agentVersion.commit };
            if (typeof data.agentVersion.date === 'string' && data.agentVersion.date.length <= 100 && Number.isFinite(Date.parse(data.agentVersion.date))) result.agentVersion.date = new Date(data.agentVersion.date).toISOString();
            if (typeof data.agentVersion.compiled === 'string' && data.agentVersion.compiled.length <= 100) result.agentVersion.compiled = data.agentVersion.compiled;
        }
        if (version(data.glibc)) result.glibc = data.glibc;
        if (version(data.macos)) result.macos = data.macos;
        if (Number.isInteger(data.freebsdAbi) && data.freebsdAbi > 0) result.freebsdAbi = data.freebsdAbi;
        if (Number.isInteger(data.armVersion) && data.armVersion > 0 && data.armVersion < 100) result.armVersion = data.armVersion;
        if (Array.isArray(data.features) && data.features.length <= 256) result.features = data.features.filter(x => typeof x === 'string' && /^[a-z0-9_]{1,40}$/.test(x));
        if (Array.isArray(data.paths)) {
            for (const item of data.paths.slice(0, 16)) {
                if (!item || !query.paths.includes(item.path) || !['present', 'missing', 'unknown'].includes(item.status)) continue;
                result.paths.push({ path: item.path, status: item.status, bits: [32, 64].includes(item.bits) ? item.bits : null, machine: Number.isInteger(item.machine) ? item.machine : null });
            }
        }
        if (Array.isArray(data.libraries)) {
            for (const item of data.libraries.slice(0, 64)) {
                if (!item || !query.libraries.includes(item.name) || !Array.isArray(item.architectures)) continue;
                result.libraries.push({ name: item.name, architectures: item.architectures.slice(0, 16).filter(x => x && [32, 64].includes(x.bits) && Number.isInteger(x.machine)).map(x => ({ bits: x.bits, machine: x.machine })) });
            }
        }
        return result;
    }
    return { request, check, validate };
})();

// Scheduled GitHub release update checks
function CreateAgentReleaseUpdates(settings, client, entries) {
    const hours = Number.isInteger(settings.checkintervalhours) && settings.checkintervalhours >= 0 && settings.checkintervalhours <= 168 ? settings.checkintervalhours : 24;
    const enabled = settings.enabled !== false;
    const repositories = new Map();
    for (const file of entries) {
        if (!repositories.has(file.repository)) repositories.set(file.repository, { repository: file.repository, tags: new Set(), files: new Set(), failures: 0, nextCheck: 0 });
        const repository = repositories.get(file.repository);
        repository.tags.add(file.tag); repository.files.add(file.filename);
    }
    let pending = null, timer = null, stopped = false;

    function version(tag) {
        const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(tag);
        return match ? match.slice(1).map(Number) : null;
    }
    function compare(a, b) {
        for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
        return 0;
    }
    function latest(releases, repository) {
        if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response.');
        const candidates = releases.filter(release => release && !release.draft && !release.prerelease && version(release.tag_name) &&
            Array.isArray(release.assets) && release.assets.some(asset => asset.name === 'agent-release.json' && asset.size > 0));
        candidates.sort((a, b) => compare(version(b.tag_name), version(a.tag_name)));
        if (!candidates.length) return null;
        const release = candidates[0], tag = release.tag_name;
        const files = release.assets.filter(asset => asset && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(asset.name) && asset.size > 0).map(asset => asset.name);
        const current = Array.from(repository.tags).map(version).filter(Boolean);
        return { tag, sourceUrl: 'https://github.com/' + repository.repository + '/releases/tag/' + encodeURIComponent(tag),
            publishedAt: release.published_at, availableFiles: Array.from(repository.files).filter(name => files.includes(name)),
            updateAvailable: !current.length || current.some(value => compare(version(tag), value) > 0) };
    }
    function status() {
        return { enabled, intervalHours: hours, checking: !!pending, repositories: Array.from(repositories.values(), item => ({
            repository: item.repository, tags: Array.from(item.tags), latest: item.latest || null,
            lastCheck: item.lastCheck, lastSuccess: item.lastSuccess, nextCheck: item.nextCheck, error: item.error
        })) };
    }
    function schedule() {
        if (timer) clearTimeout(timer);
        timer = null;
        if (stopped || !enabled || !hours || !repositories.size) return;
        const next = Math.min(...Array.from(repositories.values(), item => item.nextCheck));
        timer = setTimeout(() => { check(false).catch(() => {}); }, Math.max(1000, next - Date.now()));
        timer.unref();
    }
    function check(manual) {
        if (pending) return pending;
        if (!enabled || stopped) return Promise.resolve();
        pending = (async function () {
            const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 120000);
            try {
                for (const repository of repositories.values()) {
                    if (repository.retryAt > Date.now() || (repository.lastCheck && Date.now() - repository.lastCheck < 60000) || (!manual && repository.nextCheck > Date.now())) continue;
                    repository.lastCheck = Date.now();
                    try {
                        const response = await client.conditionalJson('https://api.github.com/repos/' + repository.repository + '/releases?per_page=100', repository.etag, controller.signal);
                        if (!response.unchanged) repository.latest = latest(response.data, repository);
                        repository.etag = response.etag || repository.etag;
                        repository.lastSuccess = Date.now(); repository.error = null; repository.failures = 0;
                    } catch (ex) {
                        repository.error = ex.message; repository.failures++;
                        repository.retryAt = ex.retryAt || 0;
                    }
                    const delay = repository.failures ? Math.min(24 * 3600000, 3600000 * Math.pow(2, Math.min(5, repository.failures - 1))) : (hours || 24) * 3600000;
                    repository.nextCheck = Math.max(repository.retryAt || 0, Date.now() + delay + Math.floor(Math.random() * 300000));
                }
            } finally { clearTimeout(deadline); }
        })().finally(() => { pending = null; schedule(); });
        return pending;
    }
    function start() {
        if (timer || stopped) return;
        for (const repository of repositories.values()) repository.nextCheck = Date.now() + 30000 + Math.floor(Math.random() * 120000);
        schedule();
    }
    function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; }
    return { start, stop, check, status };
}

// Per-device build usage tracking
function CreateAgentBuildUsage(parent, db) {
    const pending = new Map(), caches = new Map();
    function invalidate(domain) {
        const cached = caches.get(domain);
        if (cached && cached.loading) cached.invalidated = true; else caches.delete(domain);
    }
    function observe(agent, disconnected) {
        const node = agent.agentBuildNode;
        if (!node || !agent.dbNodeKey || (agent.agentInfo && (agent.agentInfo.capabilities & 96))) return Promise.resolve();
        const snapshot = { hash: agent.agentReportedHash, at: Date.now(), disconnected: !!disconnected };
        const previous = pending.get(agent.dbNodeKey) || Promise.resolve();
        const task = previous.catch(function () {}).then(async function () {
            if (parent.wsagents[agent.dbNodeKey] && parent.wsagents[agent.dbNodeKey] !== agent) return;
            const id = 'abu' + agent.dbNodeKey, old = await storage.get(db, id);
            const same = old && old.enrollment === node.enrollment && old.agentId === node.agentId;
            const record = Object.assign({}, same ? old : {}, node, { _id: id, type: 'agentbuildusage', nodeid: agent.dbNodeKey });
            if (!snapshot.disconnected && /^[a-f0-9]{96}$/.test(snapshot.hash || '') && !/^0+$/.test(snapshot.hash)) {
                record.hash = snapshot.hash; record.reportedAt = snapshot.at;
            }
            if (snapshot.disconnected) record.disconnectedAt = snapshot.at;
            else record.seenAt = snapshot.at;
            record.updatesDisabled = snapshot.hash === '0'.repeat(96);
            await storage.set(db, record);
            invalidate(node.domain);
        });
        pending.set(agent.dbNodeKey, task);
        return task.finally(() => { if (pending.get(agent.dbNodeKey) === task) pending.delete(agent.dbNodeKey); });
    }
    async function snapshot(domain, fresh) {
        let cached = caches.get(domain.id);
        if (cached && (!fresh || cached.loading) && Date.now() - cached.time < 10000) return cached.promise;
        cached = { time: Date.now(), loading: true };
        cached.promise = (async function () {
            const nodes = new Map(), policies = new Map(), reports = new Map(), deployments = new Map();
            await Promise.all([['node', nodes], ['agentbuildpolicy', policies], ['agentbuildusage', reports], ['agentbuilddeployment', deployments]].map(async ([type, map]) => {
                for await (const row of storage.records(db, type, domain.id)) {
                    if (type === 'node') {
                        if (row.mtype === 2 && row.agent && !(row.agent.caps & 96)) map.set(row._id, { nodeid: row._id, name: row.name, meshid: row.meshid, agentId: row.agent.id, enrollment: row.firstconnect || 0 });
                    } else map.set(row.nodeid, row);
                }
            }));
            const rows = [];
            for (const node of nodes.values()) {
                const policy = policies.get(node.nodeid), report = reports.get(node.nodeid), deployment = deployments.get(node.nodeid);
                const value = policy && policy.enrollment === node.enrollment ? policy : { mode: 'default' };
                const observed = report && report.enrollment === node.enrollment && report.agentId === node.agentId ? report : {};
                let state = value.mode === 'hold' ? 'held' : 'default';
                if (value.deployment) {
                    const confirmed = deployment && deployment.revision === value.revision && deployment.enrollment === node.enrollment && deployment.confirmedAt;
                    state = confirmed ? 'confirmed' : 'pending';
                    if (!confirmed && deployment && deployment.revision === value.revision) state = deployment.state || 'pending';
                    const since = value.deployment.requestedOnline ? value.time : deployment && deployment.firstSeenAt;
                    if (!confirmed && since && Date.now() - since >= 300000) state = 'unconfirmed';
                }
                rows.push(Object.assign(node, { mode: value.mode, build: value.build, filename: value.filename, expectedHash: value.hash || (value.deployment || {}).expectedHash, hash: observed.hash, reportedAt: observed.reportedAt, state }));
            }
            rows.sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.nodeid.localeCompare(b.nodeid));
            return rows;
        })();
        caches.set(domain.id, cached);
        try { return await cached.promise; }
        catch (ex) { caches.delete(domain.id); throw ex; }
        finally { cached.loading = false; if (cached.invalidated) caches.delete(domain.id); }
    }
    function matches(row, query) {
        if (query.agentId != null && row.agentId !== query.agentId) return false;
        if (query.hash && row.hash !== query.hash && row.expectedHash !== query.hash) return false;
        if (query.build && query.relation === 'pinned' && row.build !== query.build) return false;
        if (query.relation === 'installed' && row.hash !== query.hash) return false;
        if (query.relation === 'pinned' && row.mode !== 'pin') return false;
        if (query.filename && query.relation === 'pinned' && row.filename !== query.filename) return false;
        if (query.search && !(row.name || '').toLowerCase().includes(query.search.toLowerCase())) return false;
        return true;
    }
    function counts(rows, query) {
        const result = { installed: 0, pinned: 0, pending: 0, updating: 0, unconfirmed: 0 };
        for (const row of rows) {
            if (query.agentId != null && row.agentId !== query.agentId) continue;
            if (query.hash && row.hash === query.hash) result.installed++;
            if (row.mode === 'pin' && row.build === query.build && (!query.filename || row.filename === query.filename)) result.pinned++;
            if (query.hash && row.expectedHash === query.hash && ['pending', 'updating', 'unconfirmed', 'blocked', 'reconnecting'].includes(row.state)) {
                if (['blocked', 'unconfirmed'].includes(row.state)) result.unconfirmed++;
                else if (['updating', 'reconnecting'].includes(row.state)) result.updating++;
                else result.pending++;
            }
        }
        return result;
    }
    async function page(domain, query) {
        if (query.hash && !/^[a-f0-9]{96}$/.test(query.hash)) throw new Error('Invalid build hash');
        if (query.search && (typeof query.search !== 'string' || query.search.length > 128)) throw new Error('Invalid search');
        const all = await snapshot(domain), rows = all.filter(row => matches(row, query));
        const offset = Number.isSafeInteger(query.offset) && query.offset >= 0 ? query.offset : 0;
        return { counts: counts(all, query), total: rows.length, offset, rows: rows.slice(offset, offset + 50).map(row => Object.assign({}, row, { online: !!parent.wsagents[row.nodeid] })) };
    }
    async function catalogUsage(domain, catalog) {
        const rows = await snapshot(domain);
        for (const file of catalog.defaults) file.usage = counts(rows, { hash: file.agentHash, agentId: file.id });
        for (const build of catalog.builds) for (const file of build.artifacts) file.usage = counts(rows, { hash: file.agentHash, agentId: file.id, build: build.id, filename: file.filename });
        return catalog;
    }
    async function references(domain, build) {
        const rows = await snapshot(domain, true);
        const hashes = new Set(build.artifacts.map(x => x.agentHash));
        return rows.filter(x => x.build === build.id || hashes.has(x.hash) || hashes.has(x.expectedHash)).length;
    }
    return { observe, page, catalogUsage, references, invalidate: domain => invalidate(domain.id) };
}

// Local file upload staging and review
function CreateAgentBuildUpload(parent, catalog) {
    const inspect = binary.inspect;
    const root = path.join(parent.datapath, 'agentbuilds', 'staging'), busy = new Set(), receiving = new Set();
    let uploads = 0;
    const owner = (domain, user) => crypto.createHash('sha256').update(domain.id + '\0' + user._id).digest('hex');
    function draftPath(domain, user, token) {
        if (!/^[a-f0-9]{32}$/.test(token || '')) throw new Error('Invalid upload review');
        return path.join(root, owner(domain, user), token);
    }
    async function mkdir(directory) {
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid upload directory');
    }
    async function cleanup(directory) {
        let entries;
        try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch (ex) { if (ex.code === 'ENOENT') return []; throw ex; }
        const remaining = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
            const filename = path.join(directory, entry.name), stat = await fs.promises.lstat(filename);
            if (Date.now() - stat.mtimeMs > 1800000 && !busy.has(filename)) {
                try {
                    const info = path.join(filename, 'draft.json');
                    if ((await fs.promises.lstat(info)).size <= 1024 * 1024) {
                        const draft = JSON.parse(await fs.promises.readFile(info, 'utf8'));
                        if (typeof draft.domain === 'string' && typeof draft.userid === 'string' && owner({ id: draft.domain }, { _id: draft.userid }) === path.basename(directory)) {
                            await fs.promises.rm(path.join(catalog.managedRoot({ id: draft.domain }), '.upload-custom-' + entry.name), { recursive: true, force: true });
                        }
                    }
                } catch (ex) { if (ex.code !== 'ENOENT') parent.debug('agentupdate', ex.message); }
                await fs.promises.rm(filename, { recursive: true, force: true });
            }
            else remaining.push(entry.name);
        }
        return remaining;
    }
    async function receive(domain, user, req) {
        storage.admin(domain, user, req.session && req.session.loginToken);
        return stage(domain, user, async function (destination) {
            const files = await new Promise((resolve, reject) => {
                const form = new (require('multiparty').Form)({ uploadDir: destination, maxFilesSize: 128 * 1024 * 1024, maxFields: 16, maxFieldsSize: 16384 });
                form.parse(req, (err, fields, files) => err ? reject(new Error('Upload failed. Use at most 16 files, 64 MiB each and 128 MiB total.')) : resolve(Object.values(files || {}).flat()));
            });
            return { files };
        });
    }
    async function stage(domain, user, produce) {
        storage.admin(domain, user);
        const directory = path.join(root, owner(domain, user));
        if (uploads >= 4 || receiving.has(directory)) throw new Error('Another upload is being processed. Try again shortly.');
        uploads++; receiving.add(directory);
        const token = crypto.randomBytes(16).toString('hex'), destination = draftPath(domain, user, token);
        busy.add(destination);
        try {
            await mkdir(directory);
            if ((await cleanup(directory)).length >= 2) throw new Error('Finish or discard an existing upload before adding another build.');
            await fs.promises.mkdir(destination, { mode: 0o700 });
            const result = await produce(destination), files = result.files;
            if (!files.length || files.length > 16) throw new Error('Select between 1 and 16 agent files.');
            const names = new Set(), artifacts = [], rejected = [];
            let total = 0;
            for (const file of files) {
                const filename = file.originalFilename;
                if (typeof filename !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(filename) || names.has(filename.toLowerCase()) || filename.toLowerCase() === 'manifest.json') throw new Error('Use unique agent filenames containing letters, numbers, dots, underscores or hyphens.');
                names.add(filename.toLowerCase());
                if (path.dirname(file.path) !== destination) throw new Error('Invalid upload path');
                const stat = await fs.promises.lstat(file.path);
                if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || (total += stat.size) > 128 * 1024 * 1024) throw new Error(filename + ': each agent file must be at most 64 MiB, 128 MiB in total.');
                let result;
                // One unsupported file must not discard the batch. It is reported by name and kept out of
                // artifacts, because commit() checks that array's length against the review.
                try { result = inspect(await fs.promises.readFile(file.path), parent.meshAgentsArchitectureNumbers); }
                catch (ex) { rejected.push({ filename, error: ex.message }); continue; }
                const stored = 'file-' + artifacts.length;
                await fs.promises.rename(file.path, path.join(destination, stored));
                await fs.promises.chmod(path.join(destination, stored), 0o600);
                artifacts.push(Object.assign({ filename, stored, archivePath: file.archivePath, download: file.download }, result));
            }
            if (!artifacts.length) throw new Error(rejected.length ? (rejected[0].filename + ': ' + rejected[0].error) : 'Select between 1 and 16 agent files.');
            const draft = { token, created: Date.now(), domain: domain.id, userid: user._id, artifacts, source: result.source, channel: result.channel, name: result.name, workflows: result.workflows, skipped: result.skipped, rejected };
            await fs.promises.writeFile(path.join(destination, 'draft.json'), JSON.stringify(draft), { flag: 'wx', mode: 0o600 });
            return { token, expires: draft.created + 1800000, source: draft.source, name: draft.name, skipped: draft.skipped, rejected: draft.rejected, artifacts: artifacts.map(({ stored, ...artifact }) => artifact) };
        } catch (ex) {
            await fs.promises.rm(destination, { recursive: true, force: true });
            throw ex;
        } finally { busy.delete(destination); receiving.delete(directory); uploads--; }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        const directory = draftPath(domain, user, request.token);
        if (busy.has(directory)) throw new Error('This upload is already being processed.');
        busy.add(directory);
        try {
            const id = 'custom-' + request.token, base = catalog.managedRoot(domain);
            if (request.op === 'commit') {
                try {
                    const published = JSON.parse(await fs.promises.readFile(path.join(base, id, 'manifest.json'), 'utf8'));
                    if (published.uploadedBy !== user._id) throw new Error('Access denied');
                    return { added: true, build: id };
                } catch (ex) { if (ex.code !== 'ENOENT') throw ex; }
            }
            if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid upload review');
            if (request.op === 'discard') { await fs.promises.rm(directory, { recursive: true }); return { discarded: true }; }
            if (request.op !== 'commit' || request.trusted !== true) throw new Error('Confirm that these are trusted MeshAgent binaries.');
            if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 128) throw new Error('Enter a build name of at most 128 characters.');
            const filename = path.join(directory, 'draft.json'), stat = await fs.promises.lstat(filename);
            if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid upload review');
            const draft = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
            if (draft.domain !== domain.id || draft.userid !== user._id || Date.now() - draft.created > 1800000) throw new Error('The upload review expired. Upload the files again.');
            if (!Array.isArray(request.files) || request.files.length !== draft.artifacts.length) throw new Error('Review every agent file.');
            const artifacts = [], selected = [];
            for (let i = 0; i < draft.artifacts.length; i++) {
                const file = draft.artifacts[i], selection = request.files[i];
                if (selection && selection.include === false) continue;
                selected.push(file);
                if (!selection || !file.candidates.some(x => x.id === selection.agentId) || typeof selection.kvm !== 'boolean') throw new Error(file.filename + ': select the agent type and desktop support.');
                const handle = await fs.promises.open(path.join(directory, file.stored), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
                let actual;
                try {
                    const current = await handle.stat();
                    if (!current.isFile() || current.size > 64 * 1024 * 1024) throw new Error(file.filename + ': this file changed. Upload it again.');
                    actual = inspect(await handle.readFile(), parent.meshAgentsArchitectureNumbers);
                } finally { await handle.close(); }
                if (actual.hashes.sha256 !== file.hashes.sha256) throw new Error(file.filename + ': this file changed. Upload it again.');
                artifacts.push({ filename: file.filename, agentId: selection.agentId, platform: file.platform, cpu: file.cpu, size: file.size, binaryMetadata: file.binaryMetadata, features: { kvm: selection.kvm }, hashes: file.hashes, archivePath: file.archivePath, download: file.download });
            }
            if (!artifacts.length) throw new Error('Select at least one agent file.');
            const pending = path.join(base, '.upload-' + id);
            await fs.promises.rm(pending, { recursive: true, force: true });
            await mkdir(base); await fs.promises.mkdir(pending, { mode: 0o700 });
            try {
                for (const file of selected) await fs.promises.copyFile(path.join(directory, file.stored), path.join(pending, file.filename), fs.constants.COPYFILE_EXCL);
                const manifest = { schemaVersion: 1, id, name: request.name.trim(), channel: draft.channel || 'custom', source: draft.source || { kind: 'upload' }, workflows: draft.workflows, uploadedAt: new Date().toISOString(), uploadedBy: user._id, artifacts };
                await fs.promises.writeFile(path.join(pending, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
                await fs.promises.rename(pending, path.join(base, id));
            } catch (ex) { await fs.promises.rm(pending, { recursive: true, force: true }); throw ex; }
            await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
            try { parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Added agent build: ' + request.name.trim() }); } catch (ex) { parent.debug('agentupdate', ex.message); }
            return { added: true, build: id };
        } finally { busy.delete(directory); }
    }
    async function expire() {
        const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) await cleanup(path.join(root, entry.name));
    }
    const expiry = setInterval(() => expire().catch(ex => parent.debug('agentupdate', ex.message)), 600000);
    expiry.unref();
    return { receive, command, stage };
}

// URL and GitHub build imports
function CreateAgentBuildImport(uploads, client = fetch.createClient()) {
    const unpack = archive.unpack;
    const jobs = new Map(), browsing = new Set(), artifactCache = new Map();
    let active = 0;
    function key(domain, user) { return domain.id + '\0' + user._id; }
    function repository(value) {
        if (typeof value !== 'string' || value.length > 201 || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value) || ['.', '..'].includes(value.split('/')[1])) throw new Error('Enter a GitHub repository as owner/repository.');
        return value;
    }
    function id(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid GitHub resource ID.'); return value; }
    function token(value) {
        if (value == null || value === '') return undefined;
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,255}$/.test(value)) throw new Error('Invalid GitHub token.');
        return value;
    }
    function githubSettings(domain) {
        const config = domain.agentbuilds && domain.agentbuilds.github || {};
        const names = config.artifactnames || ['meshagent*', 'meshservice*'];
        if (!Array.isArray(names) || !names.length || names.length > 16 || names.some(x => typeof x !== 'string' || !x.length || x.length > 128)) throw new Error('Invalid agentBuilds.github.artifactNames in domain configuration.');
        return { credential: token(config.token), names, patterns: names.map(x => new RegExp('^' + x.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')) };
    }
    function availableArtifact(artifact, settings) {
        return !artifact.expired && Date.parse(artifact.expires_at) > Date.now() && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 128 * 1024 * 1024 && settings.patterns.some(x => x.test(artifact.name));
    }
    async function artifacts(domain, repo, run, credential, signal) {
        const cacheKey = domain.id + '\0' + repo.toLowerCase() + '\0' + run + '\0' + crypto.createHash('sha256').update(credential || '').digest('hex');
        const cached = artifactCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return cached.rows;
        const rows = [];
        for (let page = 1; page <= 10; page++) {
            const data = await api(repo, '/actions/runs/' + run + '/artifacts?per_page=100&page=' + page, credential, signal);
            rows.push(...data.artifacts);
            if (data.total_count <= page * 100 || data.artifacts.length < 100) {
                if (artifactCache.size >= 128) artifactCache.delete(artifactCache.keys().next().value);
                artifactCache.set(cacheKey, { rows, expires: Date.now() + 60000 });
                return rows;
            }
        }
        throw new Error('This workflow run has too many artifacts to browse.');
    }
    async function buildRuns(domain, repo, runs, credential, signal, settings) {
        const rows = new Array(runs.length);
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(4, runs.length) }, async () => {
            while (index < runs.length) {
                const current = index++, run = runs[current];
                if (run.status !== 'completed' || run.conclusion !== 'success') continue;
                const files = (await artifacts(domain, repo, id(run.id), credential, signal)).filter(x => availableArtifact(x, settings));
                if (files.length) { rows[current] = runRow(repo, run); rows[current].detail += ' / ' + files.length + ' agent artifacts'; }
            }
        }));
        return rows.filter(Boolean);
    }
    function sha(value) { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('GitHub did not return a source commit.'); return value; }
    function digest(value) {
        if (value == null || value === '') return undefined;
        if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Unsupported GitHub digest.');
        return value.slice(7);
    }
    function api(repo, suffix, credential, signal) { return client.json('https://api.github.com/repos/' + repo + suffix, credential, signal); }
    function runSource(repo, run) {
        const commit = sha(run.head_sha);
        return { kind: 'github-actions', repository: repo, commit, commitUrl: 'https://github.com/' + repo + '/commit/' + commit, branch: run.head_branch, event: run.event, headRepository: run.head_repository && run.head_repository.full_name, runId: id(run.id), runAttempt: run.run_attempt, workflow: run.path, conclusion: run.conclusion, url: 'https://github.com/' + repo + '/actions/runs/' + run.id };
    }
    function runRow(repo, run) {
        return { id: id(run.id), name: run.name, detail: [run.created_at, run.event, run.head_branch, sha(run.head_sha).slice(0, 12), run.conclusion || run.status].filter(Boolean).join(' / '), available: run.status === 'completed' && run.conclusion === 'success', source: runSource(repo, run) };
    }
    async function browse(domain, request, credential, signal, settings) {
        const repo = repository(request.repository), page = request.page == null ? 1 : id(request.page);
        if (page > 50) throw new Error('Narrow the search to a branch, commit or run.');
        const paging = 'per_page=20&page=' + page;
        if (request.kind === 'releases') {
            const rows = await api(repo, '/releases?' + paging, credential, signal);
            return { items: rows.filter(x => !x.draft).map(x => ({ id: x.id, name: x.name || x.tag_name, detail: [x.tag_name, x.prerelease ? 'Prerelease' : 'Release', x.published_at].join(' / '), available: true })), more: rows.length === 20, page };
        }
        if (request.kind === 'assets') {
            const release = await api(repo, '/releases/' + id(request.release), credential, signal);
            if (release.draft) throw new Error('Draft releases cannot be imported.');
            const rows = await api(repo, '/releases/' + release.id + '/assets?' + paging, credential, signal);
            return { items: rows.map(x => ({ id: x.id, name: x.name, size: x.size, available: x.state === 'uploaded' && x.size <= 128 * 1024 * 1024, digest: x.digest })), more: rows.length === 20, page };
        }
        if (request.kind === 'artifacts') {
            const run = await api(repo, '/actions/runs/' + id(request.run), credential, signal);
            const rows = (await artifacts(domain, repo, run.id, credential, signal)).filter(x => availableArtifact(x, settings));
            return { source: runSource(repo, run), items: rows.slice((page - 1) * 20, page * 20).map(x => ({ id: x.id, name: x.name, size: x.size_in_bytes, detail: 'Expires ' + x.expires_at, available: run.status === 'completed' && run.conclusion === 'success', digest: x.digest })), more: rows.length > page * 20, page };
        }
        if (request.kind === 'run') return { items: await buildRuns(domain, repo, [await api(repo, '/actions/runs/' + id(Number(request.filter)), credential, signal)], credential, signal, settings), more: false, page: 1 };
        if (!['runs', 'pull-request'].includes(request.kind)) throw new Error('Invalid GitHub source.');
        let filter = '', pull;
        if (request.kind === 'pull-request') {
            pull = await api(repo, '/pulls/' + id(Number(request.filter)), credential, signal);
            filter = '&head_sha=' + sha(pull.head.sha);
        } else if (request.filter) {
            if (typeof request.filter !== 'string' || request.filter.length > 200) throw new Error('Invalid branch or commit filter.');
            filter = (/^[a-f0-9]{40}$/.test(request.filter) ? '&head_sha=' : '&branch=') + encodeURIComponent(request.filter);
        }
        const data = await api(repo, '/actions/runs?' + paging + '&status=success' + filter, credential, signal);
        return { items: await buildRuns(domain, repo, data.workflow_runs, credential, signal, settings), more: Math.min(data.total_count, 1000) > page * 20, page, note: pull ? 'PR #' + pull.number + ': ' + pull.title + '. Runs for head commit ' + pull.head.sha + '.' : undefined };
    }
    async function resolve(domain, request, credential, signal) {
        if (request.kind === 'url') {
            const url = fetch.parseUrl(request.url);
            let filename = request.filename;
            if (!filename) { try { filename = decodeURIComponent(url.pathname.split('/').pop()); } catch (ex) {} }
            if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(filename || '')) throw new Error('Enter a filename containing letters, numbers, dots, underscores or hyphens.');
            if (request.sha256 && (typeof request.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(request.sha256))) throw new Error('Expected SHA256 must contain 64 hexadecimal characters.');
            return { name: filename, channel: 'custom', source: { kind: 'url', url: fetch.sourceUrl(url.href) }, downloads: [{ url: url.href, filename, sha256: request.sha256 && request.sha256.toLowerCase() }] };
        }
        const repo = repository(request.repository);
        if (!Array.isArray(request.ids) || request.ids.length < 1 || request.ids.length > 16 || new Set(request.ids).size !== request.ids.length) throw new Error('Select between 1 and 16 GitHub downloads.');
        request.ids.forEach(id);
        const downloads = [];
        if (request.kind === 'artifacts') {
            if (!credential) throw new Error('Configure agentBuilds.github.token in this domain with GitHub Actions read permission, then restart MeshCentral.');
            const run = await api(repo, '/actions/runs/' + id(request.run), credential, signal), source = runSource(repo, run);
            if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Select a completed, successful workflow run.');
            for (const artifactId of request.ids) {
                const artifact = await api(repo, '/actions/artifacts/' + artifactId, credential, signal);
                if (!artifact.workflow_run || artifact.workflow_run.id !== run.id || artifact.workflow_run.head_sha !== run.head_sha) throw new Error('Artifact does not belong to the selected run and commit.');
                if (artifact.expired || Date.parse(artifact.expires_at) <= Date.now()) throw new Error('This GitHub artifact has expired. Select a newer build.');
                if (artifact.size_in_bytes > 128 * 1024 * 1024) throw new Error('Artifact exceeds the download limit.');
                if (!availableArtifact(artifact, githubSettings(domain))) throw new Error('Artifact does not match the configured agent artifact names or is empty.');
                downloads.push({ id: artifact.id, name: artifact.name, url: 'https://api.github.com/repos/' + repo + '/actions/artifacts/' + artifactId + '/zip', filename: 'artifact-' + artifactId + '.zip', sha256: digest(artifact.digest) });
            }
            return { name: (repo + ' / ' + run.name + ' / ' + run.head_sha.slice(0, 12)).slice(0, 128), channel: /^pull_request/.test(run.event) ? 'pull-request' : run.event === 'schedule' ? 'nightly' : 'testing', source, workflows: [{ runId: run.id, url: source.url, path: run.path }], downloads };
        }
        if (request.kind !== 'assets') throw new Error('Invalid import source.');
        const release = await api(repo, '/releases/' + id(request.release), credential, signal);
        if (release.draft) throw new Error('Draft releases cannot be imported.');
        // Resolve the tag, not target_commitish, which can still name a moving branch.
        const ref = await api(repo, '/git/ref/tags/' + encodeURIComponent(release.tag_name), credential, signal);
        let commit = ref.object;
        for (let depth = 0; commit && commit.type === 'tag' && depth < 8; depth++) commit = (await api(repo, '/git/tags/' + sha(commit.sha), credential, signal)).object;
        if (!commit || commit.type !== 'commit') throw new Error('Release tag does not resolve to a commit.');
        sha(commit.sha);
        for (const assetId of request.ids) {
            const asset = await api(repo, '/releases/assets/' + assetId, credential, signal);
            const url = fetch.parseUrl(asset.browser_download_url);
            const parts = url.pathname.split('/');
            if (url.origin !== 'https://github.com' || parts.length !== 7 || (parts[1] + '/' + parts[2]).toLowerCase() !== repo.toLowerCase() || parts[3] !== 'releases' || parts[4] !== 'download' || decodeURIComponent(parts[5]) !== release.tag_name || asset.state !== 'uploaded') throw new Error('Asset does not belong to the selected release.');
            if (asset.size > 128 * 1024 * 1024) throw new Error('Asset exceeds the download limit.');
            downloads.push({ id: asset.id, name: asset.name, url: credential ? 'https://api.github.com/repos/' + repo + '/releases/assets/' + assetId : url.href, filename: asset.name, sha256: digest(asset.digest) });
        }
        const source = { kind: 'github-release', repository: repo, releaseId: release.id, tag: release.tag_name, commit: sha(commit.sha), commitUrl: 'https://github.com/' + repo + '/commit/' + commit.sha, url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(release.tag_name) };
        return { name: (repo + ' / ' + release.tag_name).slice(0, 128), channel: release.prerelease ? 'testing' : 'stable', source, downloads };
    }
    function report(job) { return { id: job.id, stage: job.stage, received: job.received, total: job.total, file: job.file, index: job.index, count: job.count, error: job.error, draft: job.draft }; }
    async function run(job, domain, user, request, credential) {
        const signal = job.controller.signal;
        const timeout = setTimeout(() => job.controller.abort(), 300000);
        try {
            job.draft = await uploads.stage(domain, user, async directory => {
                const info = await resolve(domain, request, credential, signal), files = [], skipped = [], budget = { entries: 0, bytes: 0, files: 0 };
                let downloaded = 0;
                info.source.downloads = [];
                job.count = info.downloads.length;
                for (const entry of info.downloads) {
                    if (signal.aborted) throw new Error('Import cancelled or timed out.');
                    job.stage = 'downloading'; job.file = entry.name || entry.filename; job.index = info.source.downloads.length + 1; job.received = 0; job.total = null;
                    const target = path.join(directory, 'download-' + job.index);
                    const result = await client.download(entry.url, target, { token: credential, signal, limit: 128 * 1024 * 1024 - downloaded, sha256: entry.sha256, progress: (received, total) => { job.received = received; job.total = total; } });
                    downloaded += result.size;
                    const download = Object.assign({ id: entry.id, name: entry.name || entry.filename }, result);
                    info.source.downloads.push(download); job.stage = 'inspecting';
                    const archive = await unpack(target, directory, budget, signal);
                    if (archive) {
                        for (const file of archive.files) files.push(Object.assign(file, { download: job.index - 1 }));
                        skipped.push(...archive.skipped);
                        await fs.promises.unlink(target);
                    } else {
                        if (result.size > 64 * 1024 * 1024 || (budget.bytes += result.size) > 128 * 1024 * 1024 || ++budget.files > 16) throw new Error('Use at most 16 native binaries, 64 MiB each and 128 MiB total.');
                        files.push({ originalFilename: entry.filename, path: target, download: job.index - 1 });
                    }
                }
                if (signal.aborted) throw new Error('Import cancelled or timed out.');
                if (!files.length) throw new Error('No supported native binaries were found. Select an agent artifact instead of logs or source code.');
                return { ...info, files, skipped };
            });
            if (signal.aborted) { await uploads.command(domain, user, { op: 'discard', token: job.draft.token }); delete job.draft; throw new Error('Import cancelled or timed out.'); }
            job.stage = 'review';
        } catch (ex) { job.stage = signal.aborted ? 'cancelled' : 'failed'; job.error = signal.aborted ? 'Import cancelled or timed out.' : ex.message; }
        finally { clearTimeout(timeout); delete job.controller; active--; job.finished = Date.now(); }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        const owner = key(domain, user);
        if (request.op === 'settings') {
            const settings = githubSettings(domain);
            return { tokenConfigured: !!settings.credential, artifactNames: settings.names };
        }
        if (request.op === 'browse') {
            if (browsing.has(owner) || browsing.size >= 4) throw new Error('Another GitHub lookup is in progress.');
            browsing.add(owner);
            const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
            try { const settings = githubSettings(domain); return await browse(domain, request, token(request.token) || settings.credential, controller.signal, settings); }
            finally { controller.abort(); clearTimeout(timeout); browsing.delete(owner); }
        }
        if (request.op === 'start') {
            if (active >= 2 || (jobs.get(owner) && jobs.get(owner).controller)) throw new Error('Another import is in progress. Try again shortly.');
            if (request.id != null && (typeof request.id !== 'string' || !/^[a-f0-9]{32}$/.test(request.id))) throw new Error('Invalid import ID.');
            const credential = request.kind === 'url' ? undefined : token(request.token) || githubSettings(domain).credential;
            const job = { id: request.id || crypto.randomBytes(16).toString('hex'), stage: 'resolving', controller: new AbortController() };
            const input = Object.assign({}, request); delete input.token;
            jobs.set(owner, job); active++;
            run(job, domain, user, input, credential);
            return report(job);
        }
        const job = jobs.get(owner);
        if (!job || job.id !== request.id) {
            if (request.op === 'get') return { stage: 'unavailable', error: 'Import no longer available. Start it again.' };
            throw new Error('Import no longer available. Start it again.');
        }
        if (request.op === 'cancel') {
            if (job.controller) job.controller.abort();
            else if (job.draft) { await uploads.command(domain, user, { op: 'discard', token: job.draft.token }); delete job.draft; job.stage = 'cancelled'; }
        } else if (request.op !== 'get') throw new Error('Invalid import operation.');
        return report(job);
    }
    const expiry = setInterval(() => { for (const [owner, job] of jobs) if (job.finished && Date.now() - job.finished > 1800000) jobs.delete(owner); }, 600000);
    expiry.unref();
    return { command };
}

// Bulk deployment jobs
function CreateAgentDeployment(parent, db, catalog, builds) {
    const jobs = new Map(), loading = new Map(), previews = new Set(), server = parent.parent;
    function audit(job, user, message) {
        server.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildjob', domain: job.domain, userid: user._id, username: user.name, job: job.id, msg: message });
    }
    function summary(job, user) {
        const counts = job.targets ? {} : Object.assign({}, job.counts);
        for (const target of job.targets ? job.targets.values() : []) counts[target.state] = (counts[target.state] || 0) + 1;
        if (job.targets && ['cancelling', 'cancelled'].includes(job.stage)) counts.cancelled = (counts.cancelled || 0) + job.nodeids.length - job.targets.size;
        return { id: job.id, name: job.name, mode: job.mode, stage: job.stage, created: job.created, updated: job.updated, total: job.nodeids ? job.nodeids.length : job.total, counts, batchSize: job.batchSize, error: job.error, allowUnknown: job.allowUnknown, owner: !user || (job.userid === user._id) };
    }
    function trimJobs() {
        for (const [id, job] of jobs) {
            if (jobs.size <= 20) return;
            if (!job.working && !job.timer && ['complete', 'cancelled'].includes(job.stage)) jobs.delete(id);
        }
    }
    async function save(job) {
        if (job.deleted) return;
        job.updated = Date.now();
        const { targets, working, timer, saving, ...record } = job;
        record.total = job.nodeids.length;
        if (job.targets.size === record.total) delete record.nodeids;
        const value = JSON.parse(JSON.stringify(Object.assign(record, { counts: summary(job).counts })));
        job.saving = (saving || Promise.resolve()).catch(() => {}).then(() => storage.set(db, value));
        await job.saving;
    }
    const targetKey = (job, index) => 'abt' + job.id + ':' + String(index).padStart(5, '0');
    async function saveTarget(job, target) {
        await storage.set(db, target);
        job.targets.set(target.index, target);
    }
    async function load(domain, id) {
        if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('Invalid deployment');
        if (jobs.has(id)) { const job = jobs.get(id); if (job.domain !== domain.id) throw new Error('Access denied'); return job; }
        if (loading.has(id)) { await loading.get(id); return load(domain, id); }
        const task = loadRecord(domain, id);
        loading.set(id, task);
        try { return await task; } finally { loading.delete(id); }
    }
    async function loadRecord(domain, id) {
        const record = await storage.get(db, 'abj' + id);
        if (!record || record.domain !== domain.id) throw new Error('Deployment is unavailable');
        const job = Object.assign(record, { targets: new Map() });
        for await (const target of storage.records(db, 'agentbuildtarget', domain.id, 'abt' + id + ':')) job.targets.set(target.index, target);
        if (!job.nodeids) {
            if (!Number.isInteger(job.total) || job.total < 1 || job.total > 10000) throw new Error('Invalid deployment size');
            job.nodeids = Array(job.total).fill(null);
            for (const target of job.targets.values()) if (target.index >= 0 && target.index < job.total) job.nodeids[target.index] = target.nodeid;
            if (job.nodeids.some(x => typeof x !== 'string')) throw new Error('Deployment records are incomplete');
        }
        if (['preparing', 'running', 'cancelling'].includes(job.stage)) {
            job.stage = 'paused'; job.error = 'Server restarted. Review the results before resuming.';
            for (const target of job.targets.values()) {
                if (target.state === 'starting') { target.state = 'failed'; target.error = 'The server restarted while saving this policy. Check the device before retrying.'; await saveTarget(job, target); }
            }
            await save(job);
        }
        jobs.set(id, job);
        schedule(job);
        return job;
    }
    function identity(job) {
        const domain = server.config.domains[job.domain], user = parent.users[job.userid];
        if (!domain || !user) throw new Error('The deployment owner or domain is no longer available.');
        storage.admin(domain, user);
        return { domain, user };
    }
    async function check(job, nodeid, fresh) {
        const { domain, user } = identity(job);
        const info = await builds.command(domain, user, { op: 'get', nodeid, refresh: fresh });
        try {
        if (!info.canChange) throw new Error('The device already has an update in progress.');
        if (job.mode !== 'hold' && info.status === 'offline') throw new Error('Device offline. It has not been scheduled.');
        if (job.mode !== 'hold' && (!info.serverUpdates || info.status === 'disabled')) throw new Error('Agent updates are disabled for this device.');
        if (job.mode === 'default' && info.defaultAvailable === false) throw new Error('The server default agent file is unavailable.');
        const file = job.files.find(x => x.agentId === info.agentId);
        if (job.mode === 'pin') {
            const option = info.options.find(x => x.id === job.build && file && x.filename === file.filename && x.sha256 === file.sha256);
            if (!option) throw new Error('No selected file matches this agent type, or the build changed.');
            const status = (option.compatibility || {}).status;
            if (status === 'blocked') throw new Error('Device requirements are not met.');
            if (status !== 'compatible' && !job.allowUnknown) throw new Error('Requirements could not be verified.');
        }
        return { info, file };
        } catch (ex) { ex.deviceName = info.name; throw ex; }
    }
    async function prepare(job) {
        if (job.working) return;
        job.working = true;
        try {
            let next = 0;
            async function worker() {
                while (job.stage === 'preparing' && next < job.nodeids.length) {
                    const index = next++;
                    if (job.targets.has(index)) continue;
                    const target = { _id: targetKey(job, index), type: 'agentbuildtarget', domain: job.domain, job: job.id, index, nodeid: job.nodeids[index], state: 'ready' };
                    try {
                        const { info } = await check(job, target.nodeid, false);
                        Object.assign(target, { name: info.name, enrollment: info.enrollment, agentId: info.agentId, revision: info.policy.revision });
                    } catch (ex) { target.state = 'skipped'; target.error = ex.message; target.name = ex.deviceName; }
                    if (['cancelling', 'cancelled'].includes(job.stage)) target.state = 'cancelled';
                    await saveTarget(job, target);
                    if (index % 20 === 0) await save(job);
                }
            }
            await Promise.all(Array.from({ length: 4 }, worker));
            if (job.stage === 'preparing') job.stage = 'ready';
            await save(job);
        } catch (ex) { if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = ex.message; await save(job); }
        finally { job.working = false; schedule(job); }
    }
    function schedule(job) {
        if (job.timer) clearTimeout(job.timer);
        if (['complete', 'cancelled', 'ready', 'preparing'].includes(job.stage)) { trimJobs(); return; }
        if (job.stage === 'paused' && !Array.from(job.targets.values()).some(x => x.state === 'waiting')) return;
        job.timer = setTimeout(() => { job.timer = null; tick(job).catch(ex => server.debug('agentupdate', ex.message)); }, 2000);
        if (job.timer.unref) job.timer.unref();
    }
    async function tick(job) {
        if (job.working) { schedule(job); return; }
        job.working = true;
        try {
            let actor;
            try { actor = identity(job); } catch (ex) {
                for (const target of job.targets.values()) {
                    if (['waiting', 'starting'].includes(target.state)) { target.state = 'failed'; target.error = ex.message; await saveTarget(job, target); }
                    else if (job.stage === 'cancelling' && target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); }
                }
                job.stage = job.stage === 'cancelling' ? 'cancelled' : 'paused'; job.error = ex.message; await save(job); return;
            }
            const { domain, user } = actor;
            const active = Array.from(job.targets.values()).filter(x => x.state === 'waiting');
            for (const target of active) {
                try {
                    const value = await builds.command(domain, user, { op: 'status', nodeid: target.nodeid });
                    if (value.enrollment !== target.enrollment || value.policy.revision !== target.appliedRevision) throw new Error('The device or its policy changed outside this deployment.');
                    const progress = value.deployment || {};
                    if (progress.state === 'confirmed' || (job.mode === 'hold' && value.policy.mode === 'hold')) { target.state = 'confirmed'; target.confirmedAt = Date.now(); }
                    else if (['blocked', 'unconfirmed'].includes(progress.state) || Date.now() - target.startedAt >= 300000) throw new Error('Installation could not be confirmed. Check this device before resuming.');
                    else { target.progress = progress.state || 'pending'; }
                } catch (ex) {
                    target.state = 'failed'; target.error = ex.message;
                    if (job.stage === 'running') { job.stage = 'paused'; job.error = 'A device failed verification. Review the results before resuming.'; }
                }
                await saveTarget(job, target);
            }
            if (!Array.from(job.targets.values()).some(x => ['waiting', 'starting'].includes(x.state))) {
                if (job.stage === 'cancelling') {
                    for (const target of job.targets.values()) if (target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); }
                    job.stage = 'cancelled';
                }
                else if (job.stage === 'running') {
                    const batch = Array.from(job.targets.values()).filter(x => x.state === 'ready').slice(0, job.batchSize);
                    if (!batch.length) job.stage = 'complete';
                    for (const target of batch) {
                        if (job.stage !== 'running') break;
                        try {
                            const { info, file } = await check(job, target.nodeid, true);
                            if (job.stage !== 'running') break;
                            if (info.enrollment !== target.enrollment || info.agentId !== target.agentId || info.policy.revision !== target.revision) throw new Error('The device or its policy changed after the preview.');
                            target.state = 'starting'; target.startedAt = Date.now();
                            await saveTarget(job, target);
                            if (job.stage !== 'running') {
                                target.state = job.stage === 'cancelling' ? 'cancelled' : 'ready';
                                await saveTarget(job, target); break;
                            }
                            const request = { op: 'set', nodeid: target.nodeid, mode: job.mode, revision: target.revision, requireOnline: job.mode !== 'hold', requireCompatible: !job.allowUnknown };
                            if (file) Object.assign(request, { build: job.build, filename: file.filename, sha256: file.sha256 });
                            const actor = identity(job);
                            const result = await builds.command(actor.domain, actor.user, request);
                            target.appliedRevision = result.policy.revision;
                            target.state = job.mode === 'hold' ? 'confirmed' : 'waiting';
                        } catch (ex) {
                            target.state = 'failed'; target.error = ex.message;
                            if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = 'A device could not be scheduled. Review the results before resuming.';
                        }
                        await saveTarget(job, target);
                    }
                }
            }
            await save(job);
        } catch (ex) { if (job.stage !== 'cancelling') job.stage = 'paused'; job.error = ex.message; await save(job); }
        finally { job.working = false; schedule(job); }
    }
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        if (server.multiServer) throw new Error('Bulk agent deployments are not available on peered servers.');
        if (request.op === 'preview') {
            if (previews.has(user._id)) throw new Error('A deployment preview is already being created.');
            previews.add(user._id);
            try {
            let activeJobs = 0;
            for await (const row of storage.records(db, 'agentbuildjob', domain.id)) if (row.userid === user._id && !['complete', 'cancelled'].includes(row.stage)) activeJobs++;
            if (activeJobs >= 10) throw new Error('Complete or cancel an existing deployment before creating another.');
            if (!['pin', 'hold', 'default'].includes(request.mode) || !Array.isArray(request.nodeids) || !request.nodeids.length || request.nodeids.length > 10000 || request.nodeids.some(x => typeof x !== 'string' || !x.startsWith('node/' + domain.id + '/') || x.length > 200)) throw new Error('Select between 1 and 10000 devices in this domain.');
            if (!Number.isInteger(request.batchSize) || request.batchSize < 1 || request.batchSize > 20) throw new Error('Use a batch size between 1 and 20.');
            const all = await catalog.getCatalog(domain);
            const build = request.mode === 'pin' ? all.builds.find(x => x.id === request.build && !x.archived) : null;
            let files = [];
            if (request.mode === 'pin') {
                if (!build || !Array.isArray(request.files) || !request.files.length || request.files.length > 100) throw new Error('Select the files to deploy.');
                const ids = new Set();
                files = request.files.map(file => {
                    const artifact = build.artifacts.find(x => x.id === file.agentId && x.filename === file.filename && x.sha256 === file.sha256 && x.matches);
                    if (!artifact || ids.has(file.agentId)) throw new Error('Select one verified file per agent type.');
                    ids.add(file.agentId);
                    return { agentId: file.agentId, filename: file.filename, sha256: file.sha256 };
                });
            }
            const id = crypto.randomBytes(16).toString('hex'), job = { _id: 'abj' + id, type: 'agentbuildjob', id, domain: domain.id, userid: user._id, created: Date.now(), stage: 'preparing', name: build ? build.name : '', build: build && build.id, files, mode: request.mode, nodeids: Array.from(new Set(request.nodeids)), batchSize: request.batchSize, allowUnknown: request.allowUnknown === true, targets: new Map() };
            await save(job); jobs.set(id, job);
            prepare(job).catch(ex => server.debug('agentupdate', ex.message));
            return summary(job, user);
            } finally { previews.delete(user._id); }
        }
        if (request.op === 'list') {
            const records = [];
            for await (const row of storage.records(db, 'agentbuildjob', domain.id)) records.push(row);
            records.sort((a, b) => b.created - a.created);
            const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
            const page = [];
            for (const row of records.slice(offset, offset + 20)) page.push(summary(jobs.get(row.id) || (['preparing', 'running', 'cancelling'].includes(row.stage) ? await load(domain, row.id) : row), user));
            trimJobs();
            return { total: records.length, offset, jobs: page };
        }
        const job = await load(domain, request.id);
        if (request.op === 'get') {
            const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
            const filters = { attention: ['failed', 'skipped'], active: ['starting', 'waiting'], done: ['confirmed'], ready: ['ready'] };
            const states = request.state ? filters[request.state] : null;
            if (request.state && !states) throw new Error('Invalid target filter');
            let targets = Array.from(job.targets.values()).sort((a, b) => a.index - b.index);
            if (states) targets = targets.filter(x => states.includes(x.state));
            return Object.assign(summary(job, user), { offset, state: request.state || '', filtered: targets.length, targets: targets.slice(offset, offset + 50).map(({ _id, type, domain, ...target }) => target) });
        }
        if (job.userid !== user._id && request.op !== 'pause' && request.op !== 'cancel') throw new Error('Only the deployment owner can start or resume it.');
        if (request.op === 'remove') {
            // A deployment that never ran, or one that has finished, is history the owner can drop. A
            // schedulable one stays: removing it would forget applied policies without reverting them.
            if (!['ready', 'complete', 'cancelled'].includes(job.stage)) throw new Error('Cancel this deployment before removing it.');
            if (job.working || job.timer) throw new Error('Wait for the current checks to finish.');
            audit(job, user, 'Agent deployment remove: ' + (job.name || job.mode));
            job.deleted = true;
            await (job.saving || Promise.resolve()).catch(() => {});
            jobs.delete(job.id);
            for await (const target of storage.records(db, 'agentbuildtarget', domain.id, 'abt' + job.id + ':')) await storage.remove(db, target._id);
            await storage.remove(db, 'abj' + job.id);
            return { removed: job.id };
        }
        if (request.op === 'pause' && ['preparing', 'running'].includes(job.stage)) { job.stage = 'paused'; }
        else if (request.op === 'cancel' && !['complete', 'cancelled'].includes(job.stage)) {
            job.stage = 'cancelling';
            for (const target of job.targets.values()) { if (target.state === 'ready') { target.state = 'cancelled'; await saveTarget(job, target); } }
        } else if (['start', 'resume'].includes(request.op) && ['ready', 'paused'].includes(job.stage)) {
            if (request.confirm !== true) throw new Error('Confirm local recovery and the interruption of active sessions.');
            if (job.working) throw new Error('Wait for the current checks to finish.');
            delete job.error;
            if (job.targets.size !== job.nodeids.length) { job.stage = 'preparing'; await save(job); prepare(job).catch(ex => server.debug('agentupdate', ex.message)); return summary(job, user); }
            job.stage = 'running';
        } else throw new Error('The deployment state changed. Refresh its status.');
        await save(job); audit(job, user, 'Agent deployment ' + request.op + ': ' + (job.name || job.mode)); schedule(job);
        return summary(job, user);
    }
    async function references(domain, build) {
        for await (const job of storage.records(db, 'agentbuildjob', domain.id)) if (job.build === build && !['complete', 'cancelled'].includes(job.stage)) return true;
        return false;
    }
    return { command, references };
}

// Default agent release downloads
function CreateAgentDefaults(parent, options = {}) {
    const root = path.join(parent.datapath, 'agentbuilds');
    const bundled = options.directory || path.join(__dirname, 'agents');
    const client = options.client || fetch.createClient();
    const settings = (parent.config.settings || {}).agentdownloads || {};
    const names = new Set(Object.values(parent.meshAgentsArchitectureNumbers).map(x => x.localname));
    for (const name of ['MeshCentralRouter.exe', 'MeshCentralRouter.dmg', 'MeshCentralAssistant.exe']) names.add(name);
    const selected = new Map(), entries = new Map();
    let busy = null, errors = [], loaded = false, started = false, restartRequired = false, updates = null;

    function regular(filename) {
        try { return fs.lstatSync(filename).isFile(); } catch (ex) { return false; }
    }
    function sourcePath(name) {
        if (!names.has(name)) return null;
        if (selected.has(name)) return selected.get(name);
        if (entries.has(name)) return null;
        const local = path.join(root, name);
        if (regular(local)) return local;
        const original = path.join(bundled, name);
        return regular(original) ? original : null;
    }
    function validate(manifest) {
        if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.releases) || manifest.releases.length > 32) throw new Error('Invalid default agent release manifest.');
        const files = new Map();
        for (const release of manifest.releases) {
            if (!release || typeof release.repository !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(release.repository) ||
                typeof release.tag !== 'string' || !release.tag || release.tag.length > 128 || /[\x00-\x20\x7f]/.test(release.tag) ||
                !Array.isArray(release.files) || !release.files.length) throw new Error('Specify a repository, release tag and files for each default release.');
            const base = 'https://github.com/' + release.repository + '/releases/';
            for (const file of release.files) {
                if (!file || !names.has(file.filename) || files.has(file.filename) ||
                    typeof file.asset !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(file.asset) ||
                    !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024 ||
                    typeof file.sha384 !== 'string' || !/^[a-f0-9]{96}$/.test(file.sha384)) throw new Error('Invalid or duplicate default release file.');
                files.set(file.filename, {
                    filename: file.filename, asset: file.asset, size: file.size, sha384: file.sha384,
                    repository: release.repository, tag: release.tag, sourceUrl: base + 'tag/' + encodeURIComponent(release.tag),
                    url: base + 'download/' + encodeURIComponent(release.tag) + '/' + encodeURIComponent(file.asset), status: 'Not checked'
                });
            }
        }
        return files;
    }
    async function load() {
        const filename = settings.manifest ? path.resolve(parent.datapath, settings.manifest) : path.join(bundled, 'agent-defaults.json');
        const stat = await fs.promises.lstat(filename);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid default agent release manifest.');
        const files = validate(JSON.parse(await fs.promises.readFile(filename, 'utf8')));
        entries.clear();
        for (const [name, file] of files) entries.set(name, file);
        loaded = true;
        updates = CreateAgentReleaseUpdates(settings, client, entries.values());
    }
    async function verified(filename, file) {
        let handle;
        try {
            const entry = await fs.promises.lstat(filename);
            if (!entry.isFile() || entry.size !== file.size) return false;
            handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size !== file.size) return false;
            const hash = crypto.createHash('sha384');
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            const after = await handle.stat();
            return hash.digest('hex') === file.sha384 && stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs;
        } catch (ex) { if (ex.code === 'ENOENT' || ex.code === 'ELOOP') return false; throw ex; }
        finally { if (handle) await handle.close(); }
    }
    async function directory(filename) {
        await fs.promises.mkdir(filename, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(filename)).isDirectory()) throw new Error('Invalid default agent cache directory.');
    }
    async function resolve(file, signal, localFiles) {
        const cache = path.join(root, 'defaults', file.sha384), target = path.join(cache, file.filename);
        if (await verified(target, file)) { file.status = 'Ready'; return target; }
        let local;
        for (const filename of [path.join(root, file.filename), path.join(bundled, file.filename)]) {
            if (await verified(filename, file)) { local = filename; break; }
        }
        const imported = localFiles && localFiles.find(x => x.sha384 === file.sha384 && x.size === file.size);
        if (!local && imported && await verified(imported.path, file)) local = imported.path;
        await directory(root); await directory(path.join(root, 'defaults')); await directory(cache);
        const temp = path.join(cache, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
        try {
            if (local) {
                await fs.promises.copyFile(local, temp, fs.constants.COPYFILE_EXCL);
            } else {
                if (settings.enabled === false) throw new Error('Automatic downloads are disabled. Supply this release file locally.');
                file.status = 'Downloading'; file.received = 0;
                try {
                    await client.download(file.url, temp, { limit: file.size, signal, progress: received => { file.received = received; } });
                } catch (ex) {
                    if (ex.statusCode === 404) throw new Error('Release asset not found. Publish the configured release and asset before downloading it.');
                    if (ex.statusCode === 401 || ex.statusCode === 403) throw new Error('GitHub denied the public release download. Check that the release is public or retry later.');
                    throw ex;
                }
            }
            if (!await verified(temp, file)) throw new Error('The release file does not match its expected size and SHA384.');
            await fs.promises.chmod(temp, 0o600);
            await fs.promises.rename(temp, target);
            file.status = 'Ready';
            return target;
        } finally { await fs.promises.unlink(temp).catch(() => {}); }
    }
    function status() {
        return {
            busy: !!busy, enabled: settings.enabled !== false, restartRequired, errors: errors.slice(),
            updates: updates ? updates.status() : null,
            files: Array.from(entries.values(), ({ url, ...file }) => ({ ...file }))
        };
    }
    function prepare(localFiles) {
        if (busy) return busy;
        const initial = !started;
        busy = (async function () {
            errors = [];
            try { if (!loaded) await load(); }
            catch (ex) { errors.push('Unable to read default agent releases: ' + ex.message); return; }
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
            try {
                const pending = Array.from(entries.values());
                await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async function () {
                    while (pending.length) {
                        const file = pending.shift();
                        delete file.error; delete file.received;
                        try {
                            const filename = await resolve(file, controller.signal, localFiles);
                            if (initial) selected.set(file.filename, filename);
                            else if (sourcePath(file.filename) !== filename) restartRequired = true;
                        } catch (ex) {
                            file.status = 'Unavailable'; file.error = ex.message;
                            errors.push(file.filename + ': ' + ex.message);
                        }
                    }
                }));
            } finally { clearTimeout(timer); }
        })().finally(() => { started = true; busy = null; });
        return busy;
    }
    function info(name) {
        const file = entries.get(name);
        if (!file || !selected.has(name)) return null;
        return { repository: file.repository, tag: file.tag, sourceUrl: file.sourceUrl, sha384: file.sha384 };
    }
    return { prepare, status, sourcePath, info, start: () => { if (updates) updates.start(); }, checkUpdates: () => updates ? updates.check(true) : Promise.resolve() };
}

// Build catalog: bundled agents, uploads and imports
function CreateAgentCatalog(parent, directory) {
    const root = path.resolve(directory || path.join(__dirname, 'agents'));
    const hashes = new Map();
    const updateHashes = new Map(), readers = new Map(), writers = new Set();
    const managedRoot = domain => path.join(parent.datapath, 'agentbuilds', 'catalog', storage.domainKey(domain));
    const filenamePattern = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

    function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':'); }

    async function inspect(filename) {
        try {
            const stat = await fs.promises.lstat(filename);
            if (!stat.isFile()) return { status: 'Not a regular file' };
            const key = signature(stat);
            const cached = hashes.get(filename);
            if (cached && cached.key == key) return await cached.result;
            const result = new Promise((resolve, reject) => {
                const sha256 = crypto.createHash('sha256'), sha384 = crypto.createHash('sha384');
                const input = fs.createReadStream(filename);
                input.on('data', data => { sha256.update(data); sha384.update(data); });
                input.on('error', reject);
                input.on('end', async () => {
                    try {
                        if (signature(await fs.promises.lstat(filename)) != key) { resolve({ status: 'File changed while reading' }); return; }
                        resolve({ status: 'Available', available: true, size: stat.size, sha256: sha256.digest('hex'), sha384: sha384.digest('hex') });
                    } catch (ex) { reject(ex); }
                });
            });
            hashes.set(filename, { key: key, result: result });
            return await result;
        } catch (ex) {
            hashes.delete(filename);
            return { status: (ex.code == 'ENOENT') ? 'Missing file' : 'Unable to read file' };
        }
    }

    function githubUrl(value) {
        try {
            const url = new URL(value);
            if ((url.protocol == 'https:') && (url.hostname == 'github.com') && !url.username && !url.password && !url.port) return url.href;
        } catch (ex) { }
        return null;
    }

    function importSource(source) {
        if (!['url', 'github-actions', 'github-release'].includes(source.kind)) return null;
        function url(value) {
            try { return fetch.sourceUrl(value); } catch (ex) { return null; }
        }
        const result = { kind: source.kind, url: url(source.url), repository: source.repository, tag: source.tag, branch: source.branch, event: source.event, headRepository: source.headRepository, runId: source.runId, runAttempt: source.runAttempt, downloads: [] };
        for (const item of Array.isArray(source.downloads) ? source.downloads.slice(0, 16) : []) {
            if (item && /^[a-f0-9]{64}$/.test(item.sha256)) result.downloads.push({ name: item.name, url: url(item.url), sha256: item.sha256, digestVerified: item.digestVerified === true });
        }
        return result;
    }

    function compatibility(artifact) {
        const metadata = artifact.binaryMetadata || {}, requirements = [];
        if (typeof metadata.glibcRequired == 'string') requirements.push('glibc ' + metadata.glibcRequired + '+');
        if (metadata.libc == 'musl') requirements.push('musl');
        if (typeof metadata.minimumMacos == 'string') requirements.push('macOS ' + metadata.minimumMacos + '+');
        if (Number.isInteger(metadata.freebsdAbi)) requirements.push('FreeBSD ABI ' + metadata.freebsdAbi);
        if (metadata.armAttributes) {
            if (typeof metadata.armAttributes.fpArch == 'string') requirements.push(metadata.armAttributes.fpArch);
            if (typeof metadata.armAttributes.advancedSimdArch == 'string') requirements.push(metadata.armAttributes.advancedSimdArch);
        }
        return requirements.join(', ');
    }

    function validate(manifest) {
        if (!manifest || (manifest.schemaVersion !== 1) || (typeof manifest.id != 'string') || !filenamePattern.test(manifest.id) || (typeof manifest.name != 'string') ||
            !['stable', 'testing', 'nightly', 'pull-request', 'custom'].includes(manifest.channel) || !Array.isArray(manifest.artifacts) ||
            (manifest.artifacts.length == 0) || (manifest.artifacts.length > 1000)) return false;
        const filenames = new Set();
        for (const artifact of manifest.artifacts) {
            if (!artifact || (typeof artifact.filename != 'string') || !filenamePattern.test(artifact.filename) ||
                !Number.isInteger(artifact.agentId) || (artifact.agentId <= 0) || (artifact.agentId >= 10000) ||
                !Number.isSafeInteger(artifact.size) || (artifact.size <= 0) || !artifact.hashes ||
                !artifact.features || (typeof artifact.features.kvm != 'boolean') ||
                !/^[a-f0-9]{64}$/.test(artifact.hashes.sha256) || !/^[a-f0-9]{96}$/.test(artifact.hashes.sha384) ||
                !/^[a-f0-9]{96}$/.test(artifact.hashes.agentSha384) ||
                (typeof artifact.platform != 'string') || (typeof artifact.cpu != 'string') ||
                filenames.has(artifact.filename)) return false;
            filenames.add(artifact.filename);
        }
        return true;
    }

    async function buildDirectories(domain) {
        const result = [];
        for (const base of [root, managedRoot(domain)]) {
            try {
                const stat = await fs.promises.lstat(base);
                if (!stat.isDirectory()) throw new Error('Invalid agent build directory');
                for (const entry of await fs.promises.readdir(base, { withFileTypes: true })) {
                    if (entry.isDirectory() && filenamePattern.test(entry.name)) result.push({ name: entry.name, path: path.join(base, entry.name), managed: base !== root });
                }
            } catch (ex) { if (ex.code !== 'ENOENT') throw ex; }
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    async function archived(domain, id) {
        try {
            const filename = path.join(managedRoot(domain), '.state', id + '.json');
            const stat = await fs.promises.lstat(filename);
            if (!stat.isFile() || stat.size > 1024) throw new Error('Invalid build state');
            return JSON.parse(await fs.promises.readFile(filename, 'utf8')).archived === true;
        } catch (ex) { if (ex.code === 'ENOENT') return false; throw ex; }
    }

    async function use(domain, id, callback, exclusive) {
        if (typeof id !== 'string' || !filenamePattern.test(id)) throw new Error('Invalid build');
        const key = storage.domainKey(domain) + '/' + id;
        if (writers.has(key) || (exclusive && readers.get(key))) throw new Error('This build is in use. Try again when the operation finishes.');
        if (exclusive) writers.add(key); else readers.set(key, (readers.get(key) || 0) + 1);
        try { return await callback(); }
        finally { if (exclusive) writers.delete(key); else if (readers.get(key) === 1) readers.delete(key); else readers.set(key, readers.get(key) - 1); }
    }

    async function manage(domain, id, operation) {
        const build = (await getCatalog(domain)).builds.find(x => x.id === id);
        if (!build) throw new Error('Build is unavailable');
        if (operation === 'remove') {
            if (!build.managed) throw new Error('Bundled catalog entries can be archived but cannot be removed.');
            const entries = await buildDirectories(domain);
            const entry = entries.find(x => x.managed && x.name === id);
            if (!entry) throw new Error('Build is unavailable');
            await fs.promises.rm(entry.path, { recursive: true });
        } else {
            const directory = path.join(managedRoot(domain), '.state');
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
            if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid build state directory');
            const temp = path.join(directory, crypto.randomBytes(16).toString('hex') + '.tmp');
            await fs.promises.writeFile(temp, JSON.stringify({ archived: operation === 'archive' }), { flag: 'wx', mode: 0o600 });
            await fs.promises.rename(temp, path.join(directory, id + '.json'));
        }
    }

    async function getCatalog(domain, agentId) {
        const defaults = [], bundled = [], builds = [], errors = [];
        const architectures = parent.meshAgentsArchitectureNumbers;
        const active = Object.assign({}, parent.meshAgentBinaries, domain.meshAgentBinaries);
        for (const id of Object.keys(active).sort((a, b) => a - b)) {
            if (agentId != null) continue;
            if (Number(id) >= 10000) continue;
            const agent = active[id];
            let source = 'Server override';
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[id]) { source = 'Domain override'; }
            else if (path.resolve(agent.path) == path.join(root, agent.localname)) { source = 'Bundled'; }
            else if (path.dirname(path.resolve(agent.path)) == path.resolve(parent.datapath, 'signedagents')) { source = 'Server signed'; }
            else if (agent.release) { source = 'Release'; }
            else if (path.dirname(path.resolve(agent.path)) == path.resolve(parent.datapath, 'agentbuilds')) { source = 'Local file'; }
            defaults.push({ id: Number(id), name: agent.desc, filename: agent.localname, source: source, size: agent.size, agentHash: agent.hashhex, release: agent.release });
        }
        for (const id of Object.keys(architectures).sort((a, b) => a - b)) {
            if (agentId != null) continue;
            if (Number(id) >= 10000) continue;
            const agent = architectures[id];
            if (!filenamePattern.test(agent.localname)) continue;
            const file = await inspect(path.join(root, agent.localname));
            if (file.status == 'Missing file') continue;
            bundled.push(Object.assign({ id: Number(id), name: agent.desc, filename: agent.localname }, file));
        }
        let directories;
        try { directories = await buildDirectories(domain); }
        catch (ex) { return { defaults: defaults, bundled: bundled, builds: builds, errors: ['Unable to read agent directory'] }; }
        const buildIds = new Set();
        for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
            const manifestPath = path.join(entry.path, 'manifest.json');
            let manifest;
            try {
                const stat = await fs.promises.lstat(manifestPath);
                if (!stat.isFile() || (stat.size > 1024 * 1024)) throw new Error('Invalid manifest');
                manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                if (!validate(manifest) || buildIds.has(manifest.id)) throw new Error('Invalid manifest');
            } catch (ex) {
                if (ex.code != 'ENOENT') errors.push(entry.name + ': invalid or unreadable manifest');
                continue;
            }
            buildIds.add(manifest.id);
            const source = manifest.source || {};
            const build = {
                id: manifest.id, name: manifest.name, channel: manifest.channel, managed: entry.managed, archived: await archived(domain, manifest.id), uploadedAt: manifest.uploadedAt,
                commit: typeof source.commit == 'string' ? source.commit : null, sourceUrl: githubUrl(source.commitUrl),
                commitTime: typeof source.commitTime == 'string' ? source.commitTime : null,
                provenance: importSource(source), workflows: [], artifacts: []
            };
            if (Array.isArray(manifest.workflows)) {
                for (const workflow of manifest.workflows) {
                    if (workflow && Number.isSafeInteger(workflow.runId) && githubUrl(workflow.url)) {
                        build.workflows.push({ id: workflow.runId, name: (typeof workflow.path == 'string') ? path.basename(workflow.path).replace(/\.ya?ml$/, '') : String(workflow.runId), url: githubUrl(workflow.url) });
                    }
                }
            }
            for (const artifact of manifest.artifacts) {
                if ((agentId != null) && (artifact.agentId !== agentId)) continue;
                const file = await inspect(path.join(entry.path, artifact.filename));
                const matches = file.available && (file.size == artifact.size) && (file.sha256 == artifact.hashes.sha256) && (file.sha384 == artifact.hashes.sha384);
                const row = Object.assign({
                    id: artifact.agentId, filename: artifact.filename, platform: artifact.platform, cpu: artifact.cpu,
                    agentHash: artifact.hashes.agentSha384,
                    kvm: artifact.features && (artifact.features.kvm === true), requirements: compatibility(artifact), metadata: artifact.binaryMetadata || {},
                    signature: (artifact.binaryMetadata || {}).embeddedAuthenticode || (artifact.binaryMetadata || {}).embeddedSignature
                }, file);
                row.matches = matches === true;
                row.status = file.available ? (matches ? 'Matches manifest' : 'Manifest mismatch') : file.status;
                build.artifacts.push(row);
            }
            if (build.artifacts.length) builds.push(build);
        }
        return { defaults: defaults, bundled: bundled, builds: builds, errors: errors, downloads: parent.agentDefaults ? parent.agentDefaults.status() : null };
    }

    async function getArtifact(buildId, agentId, selectedFile, domain = {}) {
        const catalog = await getCatalog(domain, agentId);
        const build = catalog.builds.find(x => x.id === buildId);
        if (!build) throw new Error('Build is unavailable or its files have changed');
        const candidates = build.artifacts.filter(x => x.id === agentId);
        if ((selectedFile == null) && (candidates.length !== 1)) throw new Error('Select an agent file for this build');
        const selected = candidates.find(x => (selectedFile == null) || (x.filename === selectedFile));
        if (!selected || !selected.matches) throw new Error('Build is unavailable or its files have changed');
        const directories = await buildDirectories(domain);
        for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
            const manifestPath = path.join(entry.path, 'manifest.json');
            let manifest;
            try {
                const stat = await fs.promises.lstat(manifestPath);
                if (!stat.isFile() || (stat.size > 1024 * 1024)) continue;
                manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
            } catch (ex) { continue; }
            if (!validate(manifest) || (manifest.id !== buildId)) continue;
            const artifact = manifest.artifacts.find(x => (x.agentId === agentId) && (x.filename === selected.filename));
            if (!artifact || (artifact.size > 64 * 1024 * 1024)) throw new Error('Unsupported build file');
            const filename = path.join(entry.path, artifact.filename);
            const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || (stat.size !== artifact.size)) throw new Error('Build file changed');
                const data = await handle.readFile();
                if ((data.length !== artifact.size) || (crypto.createHash('sha256').update(data).digest('hex') !== artifact.hashes.sha256) ||
                    (crypto.createHash('sha384').update(data).digest('hex') !== artifact.hashes.sha384)) throw new Error('Build file changed');
                return { build: build, artifact: artifact, data: data, path: filename };
            } finally { await handle.close(); }
        }
        throw new Error('Build is unavailable');
    }

    async function identify(domain, agentId, hash, inventory) {
        if (!/^[a-f0-9]{96}$/.test(hash) || /^0+$/.test(hash)) return [];
        const matches = [], active = (domain.meshAgentBinaries && domain.meshAgentBinaries[agentId]) || parent.meshAgentBinaries[agentId];
        if (active && active.hashhex === hash) matches.push(Object.assign({ group: 'defaults', name: 'Server default', filename: active.localname, hash: hash }, active.release));
        for (const build of inventory.builds) {
            for (const artifact of build.artifacts) {
                if (!artifact.matches || artifact.id !== agentId || artifact.agentHash !== hash) continue;
                try {
                    const item = await getArtifact(build.id, agentId, artifact.filename, domain);
                    const key = signature(await fs.promises.lstat(item.path));
                    let cached = updateHashes.get(item.path);
                    if (!cached || cached.key !== key) {
                        const result = new Promise((resolve, reject) => {
                            const output = crypto.createHash('sha384');
                            output.on('data', value => resolve(value.toString('hex')));
                            output.on('error', reject);
                            try { require('./exeHandler').hashExecutableFile({ sourcePath: item.path, targetStream: output }); } catch (ex) { reject(ex); }
                        });
                        cached = { key: key, result: result };
                        updateHashes.set(item.path, cached);
                    }
                    if (await cached.result !== hash || signature(await fs.promises.lstat(item.path)) !== key) continue;
                    matches.push({ group: 'builds', build: build.id, name: build.name, filename: artifact.filename, hash: hash, commit: build.commit, sourceUrl: build.sourceUrl, commitTime: build.commitTime });
                } catch (ex) { }
            }
        }
        return matches;
    }

    return { getCatalog: getCatalog, getArtifact: getArtifact, identify: identify, managedRoot: managedRoot, use: use, manage: manage };
}

// Per-device build policy, pinning and updates
function CreateAgentBuilds(parent, db, catalog) {
    const server = parent.parent;
    const directory = path.join(server.datapath, 'agentbuilds');
    const changing = new Map();
    const checking = new Map();
    const observing = new Map();
    let generation = 0;
    const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
    const get = id => new Promise((resolve, reject) => db.Get(id, (err, docs) => err ? reject(err) : resolve(docs || [])));
    const set = value => new Promise((resolve, reject) => db.Set(value, err => err ? reject(err) : resolve()));

    function defaultAgent(domain, id) {
        return (domain.meshAgentBinaries && domain.meshAgentBinaries[id]) || server.meshAgentBinaries[id];
    }

    function agentType(domain, id) {
        return defaultAgent(domain, id) || server.meshAgentsArchitectureNumbers[id];
    }

    function held(agent) {
        const result = Object.assign({}, agent, { update: false });
        delete result.url;
        return result;
    }

    async function policy(nodeid, enrollment) {
        const docs = await get('ab' + nodeid);
        if (!docs.length) return { mode: 'default', revision: '' };
        if (docs[0].enrollment !== (enrollment || 0)) return { mode: 'default', revision: docs[0].revision };
        return docs[0];
    }

    function updating(agent) {
        return agent && (agent.agentUpdate || agent.agentUpdatePending || agent.agentCoreUpdate || (agent.agentCoreUpdateTaskId != null));
    }

    function observe(agent, disconnected) {
        if (parent.agentBuildUsage) parent.agentBuildUsage.observe(agent, disconnected).catch(err => server.debug('agentupdate', err.message));
        const nodeid = agent.dbNodeKey, value = agent.agentBuildPolicy;
        if (!value || !value.deployment || value.mode === 'hold' || agent.agentPolicyChanging) return Promise.resolve();
        const snapshot = { hash: agent.agentReportedHash, updating: !!updating(agent), time: Date.now(), disconnected: !!disconnected };
        const previous = observing.get(nodeid) || Promise.resolve();
        const task = previous.catch(function () {}).then(async function () {
            const current = await policy(nodeid, value.enrollment);
            if (current.revision !== value.revision) return;
            const docs = await get('abd' + nodeid);
            const old = docs.find(x => x.revision === value.revision && x.enrollment === value.enrollment);
            if (old && old.confirmedAt) return;
            const state = Object.assign({}, old, { _id: 'abd' + nodeid, type: 'agentbuilddeployment', domain: value.domain, nodeid: nodeid, enrollment: value.enrollment, revision: value.revision });
            state.firstSeenAt = state.firstSeenAt || snapshot.time;
            state.lastSeenAt = snapshot.time;
            if (snapshot.disconnected) {
                state.disconnectedAt = snapshot.time;
            } else if (snapshot.hash) {
                if (/^0+$/.test(snapshot.hash)) { state.state = 'blocked'; }
                else {
                    state.reportedHash = snapshot.hash;
                    state.state = snapshot.hash === value.deployment.expectedHash ? 'confirmed' : (snapshot.updating ? 'updating' : 'pending');
                    if (state.state === 'confirmed') state.confirmedAt = snapshot.time;
                    if (state.state === 'updating') state.startedAt = state.startedAt || snapshot.time;
                }
            }
            await set(state);
        });
        observing.set(nodeid, task);
        return task.finally(function () { if (observing.get(nodeid) === task) observing.delete(nodeid); });
    }

    async function status(domain, node, value) {
        const agent = parent.wsagents[node._id], base = defaultAgent(domain, node.agent.id);
        let state = agent ? 'connected' : 'offline';
        if (agent && agent.agentBuildError) state = 'unavailable';
        else if (agent && agent.agentReportedHash === '0'.repeat(96)) state = 'disabled';
        else if (updating(agent)) state = 'updating';
        else if ((value.mode === 'pin') && agent && (agent.agentReportedHash === value.hash)) state = 'matched';
        const type = agentType(domain, node.agent.id);
        const result = { nodeid: node._id, name: node.name, agentId: node.agent.id, enrollment: node.firstconnect || 0, policy: value, status: state, serverUpdates: !!(type && type.update), defaultAvailable: !!(base && base.hashhex), canChange: !server.multiServer && !changing.has(node._id) && !updating(agent) };
        if (agent && agent.agentReportedHash && !/^0+$/.test(agent.agentReportedHash)) result.reportedHash = agent.agentReportedHash;
        if (value.deployment && value.mode !== 'hold') {
            const docs = await get('abd' + node._id);
            const saved = docs.find(x => x.revision === value.revision && x.enrollment === (node.firstconnect || 0));
            const progress = Object.assign({ state: 'pending' }, saved, { requestedAt: value.time, expectedHash: value.deployment.expectedHash });
            const since = value.deployment.requestedOnline ? value.time : progress.firstSeenAt;
            if (!progress.confirmedAt) {
                if (state === 'disabled' || state === 'unavailable' || !result.serverUpdates || (value.mode === 'default' && !result.defaultAvailable)) progress.state = 'blocked';
                else if (since && (Date.now() - since >= 300000)) progress.state = 'unconfirmed';
                else if (state === 'updating') progress.state = 'updating';
                else if (progress.startedAt) progress.state = 'reconnecting';
            }
            result.deployment = progress;
            if (agent && agent.agentUpdate) {
                const transfer = agent.agentUpdate, total = transfer.agentUpdateData ? transfer.agentUpdateData.length : (agent.agentExeInfo || {}).size;
                if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(transfer.ptr)) result.deployment.transfer = { sent: Math.min(transfer.ptr, total), total: total };
            }
        }
        if (server.multiServer) result.error = 'Per-device build changes are not available on peered servers.';
        return result;
    }

    async function readPinned(value) {
        if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{96}$/.test(value.hash) ||
            !/^[a-f0-9]{96}$/.test(value.fileHash) || !Number.isSafeInteger(value.size) || (value.size < 20) || (value.size > 64 * 1024 * 1024)) throw new Error('Invalid pinned build');
        const handle = await fs.promises.open(path.join(directory, value.sha256), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || (stat.size !== value.size)) throw new Error('Pinned build file changed');
            const data = await handle.readFile();
            if ((data.length !== value.size) || (sha256(data) !== value.sha256) || (crypto.createHash('sha384').update(data).digest('hex') !== value.fileHash)) throw new Error('Pinned build file changed');
            return data;
        } finally { await handle.close(); }
    }

    async function prepare(domain, buildId, agentId, selectedFile, expectedHash) {
        const item = await catalog.getArtifact(buildId, agentId, selectedFile, domain), artifact = item.artifact;
        if (artifact.hashes.sha256 !== expectedHash) throw new Error('The build changed. Refresh and select it again.');
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.promises.lstat(directory)).isDirectory()) throw new Error('Invalid build storage directory');
        const filename = path.join(directory, artifact.hashes.sha256);
        try { await fs.promises.writeFile(filename, item.data, { flag: 'wx', mode: 0o600 }); }
        catch (ex) { if (ex.code !== 'EEXIST') throw ex; }
        const value = {
            build: item.build.id, name: item.build.name, agentId: agentId, filename: artifact.filename,
            sha256: artifact.hashes.sha256, hash: artifact.hashes.agentSha384, fileHash: artifact.hashes.sha384,
            size: artifact.size, requirements: item.build.artifacts.find(x => x.filename === artifact.filename).requirements,
            commit: item.build.commit, sourceUrl: item.build.sourceUrl, commitTime: item.build.commitTime
        };
        await readPinned(value);
        const hash = await new Promise((resolve, reject) => {
            const output = crypto.createHash('sha384');
            output.on('data', data => resolve(data.toString('hex')));
            output.on('error', reject);
            try { server.exeHandler.hashExecutableFile({ sourcePath: filename, targetStream: output }); } catch (ex) { reject(ex); }
        });
        if (hash !== value.hash) throw new Error('The build update hash does not match its manifest');
        return value;
    }

    async function resolveCurrent(domain, nodeid, agentId, enrollment) {
        const base = defaultAgent(domain, agentId), type = agentType(domain, agentId);
        try {
            const value = await policy(nodeid, enrollment);
            if (value.mode === 'default') return { agent: base || held(type), policy: value, error: base ? undefined : 'The server default agent file is unavailable. The installed binary is retained.' };
            if (value.mode === 'hold') return { agent: held(type), policy: value };
            if ((value.mode !== 'pin') || (value.agentId !== agentId)) throw new Error('Pinned build does not match this agent architecture');
            const data = await readPinned(value);
            const agent = Object.assign({}, type, {
                id: agentId, desc: value.name, localname: value.filename, size: data.length, data: data,
                hash: Buffer.from(value.hash, 'hex').toString('binary'), hashhex: value.hash,
                fileHash: Buffer.from(value.fileHash, 'hex').toString('binary'), fileHashHex: value.fileHash,
                update: !!(type && type.update), pinned: true, url: 'https://localhost' + domain.url + 'meshagents'
            });
            delete agent.zdata;
            delete agent.zhash;
            delete agent.path;
            return { agent: agent, policy: value };
        } catch (ex) {
            server.debug('agentupdate', 'Holding updates for ' + nodeid + ': ' + ex.message);
            return { agent: held(type), error: 'Pinned build or policy is unavailable. Updates are held.' };
        }
    }

    async function resolve(domain, nodeid, agentId, enrollment) {
        for (;;) {
            if (changing.has(nodeid)) await changing.get(nodeid);
            const before = generation;
            const result = await resolveCurrent(domain, nodeid, agentId, enrollment);
            // A policy can change while the database or pinned file is being read.
            if ((before === generation) && !changing.has(nodeid)) return result;
        }
    }

    function updateUrl(agent) {
        if (!agent.agentExeInfo) return null;
        if (!agent.agentExeInfo.pinned) return agent.agentExeInfo.url;
        const value = agent.agentBuildPolicy;
        const cookie = server.encodeCookie({ a: 'agentbuild', n: agent.dbNodeKey, d: agent.domain.id, r: value.revision }, server.loginCookieEncryptionKey);
        return 'https://localhost' + agent.domain.url + 'meshagents?agentbuild=' + encodeURIComponent(cookie);
    }

    async function download(domain, cookie) {
        if (!cookie || (cookie.a !== 'agentbuild') || (cookie.d !== domain.id) || (typeof cookie.n !== 'string') || !cookie.n.startsWith('node/' + domain.id + '/')) throw new Error('Invalid build download');
        if (changing.has(cookie.n)) await changing.get(cookie.n);
        const nodes = await get(cookie.n), value = await policy(cookie.n, nodes.length ? nodes[0].firstconnect : 0);
        if ((nodes.length !== 1) || (nodes[0].domain !== domain.id) || (value.mode !== 'pin') || (value.revision !== cookie.r)) throw new Error('Build policy changed');
        if (!nodes[0].agent || (nodes[0].agent.id !== value.agentId)) throw new Error('Agent architecture changed');
        const base = agentType(domain, value.agentId);
        if (!base || !base.update) throw new Error('Agent updates are disabled');
        return { data: await readPinned(value), filename: value.filename };
    }

    async function requirements(node, artifacts, refresh) {
        const query = compatibility.request(artifacts), key = sha256(JSON.stringify(query) + '|2');
        const agent = parent.wsagents[node._id], docs = await get('abi' + node._id);
        const cached = docs.find(x => (x.domain === node.domain) && (x.enrollment === (node.firstconnect || 0)) && (x.agentId === node.agent.id) && (x.query === key));
        const recent = cached && ((Date.now() - cached.time) < 300000) && (!agent || cached.time >= agent.connectTime);
        if (!agent || typeof agent.send !== 'function') return recent ? cached : null;
        if (!refresh && recent && cached.time >= agent.connectTime) return cached;
        const pending = checking.get(node._id);
        if (pending && pending.agent === agent && pending.key === key) return pending.promise;
        if (pending) pending.finish(null);
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        const state = { agent: agent, node: node, query: query, key: key, requestid: crypto.randomBytes(16).toString('hex'), promise: promise };
        state.finish = function (value) {
            clearTimeout(state.timer);
            if (checking.get(node._id) === state) checking.delete(node._id);
            finish(value || (recent ? cached : null));
        };
        checking.set(node._id, state);
        state.timer = setTimeout(function () { state.finish(null); }, 8000);
        try { agent.send(JSON.stringify({ action: 'agentbuildinfo', requestid: state.requestid, paths: query.paths, libraries: query.libraries })); }
        catch (ex) { state.finish(null); }
        return promise;
    }

    async function receive(agent, command) {
        const state = checking.get(agent.dbNodeKey);
        if (!state || state.agent !== agent || state.requestid !== command.requestid) return;
        const data = compatibility.validate(command.data, state.query);
        if (!data) { state.finish(null); return; }
        const value = { _id: 'abi' + state.node._id, type: 'agentbuildinfo', domain: state.node.domain, nodeid: state.node._id, enrollment: state.node.firstconnect || 0, agentId: state.node.agent.id, time: Date.now(), query: state.key, data: data };
        if (agent.agentReportedHash && !/^0+$/.test(agent.agentReportedHash)) value.reportedHash = agent.agentReportedHash;
        try { await set(value); state.finish(value); }
        catch (ex) { state.finish(null); }
    }

    async function info(domain, node, refresh) {
        const value = await policy(node._id, node.firstconnect);
        const data = await catalog.getCatalog(domain, node.agent.id), options = [];
        const artifacts = data.builds.flatMap(build => build.artifacts.filter(artifact => artifact.matches));
        const facts = await requirements(node, artifacts, refresh);
        for (const build of data.builds) {
            if (build.archived) continue;
            for (const artifact of build.artifacts) {
                if ((artifact.id === node.agent.id) && artifact.matches) options.push({ id: build.id, name: build.name, channel: build.channel, filename: artifact.filename, platform: artifact.platform, cpu: artifact.cpu, sha256: artifact.sha256, requirements: artifact.requirements, kvm: artifact.kvm, compatibility: compatibility.check(artifact, facts && facts.data) });
            }
        }
        const result = await status(domain, node, value);
        result.options = options;
        const hash = result.reportedHash || (result.deployment || {}).reportedHash;
        result.installed = { hash: hash, current: !!result.reportedHash, matches: [] };
        if (hash) {
            result.installed.matches = await catalog.identify(domain, node.agent.id, hash, data);
            if (value.mode === 'pin' && value.hash === hash && !result.installed.matches.some(x => x.build === value.build && x.filename === value.filename)) {
                result.installed.matches.push({ name: value.name, filename: value.filename, hash: hash, commit: value.commit, sourceUrl: value.sourceUrl, commitTime: value.commitTime, cached: true });
            }
        }
        if (hash && facts && facts.reportedHash === hash) result.installed.version = facts.data.agentVersion;
        if (facts) result.checkedAt = facts.time;
        return result;
    }

    async function change(domain, user, node, command) {
        if (command.mode === 'pin') return catalog.use(domain, command.build, () => changeCurrent(domain, user, node, command));
        return changeCurrent(domain, user, node, command);
    }

    async function changeCurrent(domain, user, node, command) {
        if (server.multiServer) throw new Error('Per-device build changes are not available on peered servers.');
        if (changing.has(node._id)) throw new Error('The device policy is being changed. Refresh and try again.');
        let release;
        changing.set(node._id, new Promise(resolve => { release = resolve; }));
        generation++;
        try {
            const current = await policy(node._id, node.firstconnect);
            if (command.revision !== current.revision) throw new Error('The device policy changed. Refresh and try again.');
            if (!['default', 'hold', 'pin'].includes(command.mode)) throw new Error('Invalid update policy');
            if (command.mode === 'default' && !(defaultAgent(domain, node.agent.id) || {}).hashhex) throw new Error('The server default agent file is unavailable. Restore it before changing this policy.');
            let value = { mode: command.mode };
            if (command.mode === 'pin') {
                if (!(agentType(domain, node.agent.id) || {}).update) throw new Error('Agent updates are disabled on this server');
                const live = parent.wsagents[node._id];
                if (live && live.agentReportedHash === '0'.repeat(96)) throw new Error('This agent has disabled native updates');
                const inventory = await catalog.getCatalog(domain, node.agent.id);
                const build = inventory.builds.find(x => x.id === command.build && !x.archived);
                const choices = build ? build.artifacts.filter(x => x.matches && ((command.filename == null) || (x.filename === command.filename))) : [];
                if (!build) throw new Error('The build is archived or unavailable');
                if (choices.length === 1) {
                    const facts = await requirements(node, choices, true);
                    const checked = compatibility.check(choices[0], facts && facts.data).status;
                    if (command.requireCompatible === true && checked !== 'compatible') throw new Error('Requirements could not be verified. Refresh before deploying.');
                    if (checked === 'blocked') throw new Error('This file does not meet the device requirements. Refresh to see the required upgrades.');
                }
                value = Object.assign(value, await prepare(domain, command.build, node.agent.id, command.filename, command.sha256));
            }
            const nodes = await get(node._id);
            if ((nodes.length !== 1) || (nodes[0].domain !== domain.id) || !nodes[0].agent || (nodes[0].agent.id !== node.agent.id) || (nodes[0].meshid !== node.meshid) || (nodes[0].firstconnect !== node.firstconnect) || (nodes[0].mtype !== 2) || (nodes[0].agent.caps & 0x60) || ((parent.meshes[node.meshid] || {}).flags & 1)) throw new Error('The device changed. Refresh and try again.');
            const agent = parent.wsagents[node._id];
            if (command.requireOnline === true && !agent) throw new Error('Device went offline before the policy was applied.');
            if (updating(agent)) throw new Error('An agent update is already in progress. Wait for it to reconnect.');
            if (command.mode === 'pin' && agent && agent.agentReportedHash === '0'.repeat(96)) throw new Error('This agent has disabled native updates');
            if ((parent.GetNodeRights(user, node.meshid, node._id) >>> 0) !== 0xFFFFFFFF) throw new Error('Access denied');
            if (agent) agent.agentPolicyChanging = true;
            try {
                Object.assign(value, { _id: 'ab' + node._id, type: 'agentbuildpolicy', domain: domain.id, nodeid: node._id, enrollment: node.firstconnect || 0, mode: command.mode, revision: crypto.randomBytes(16).toString('hex'), time: Date.now(), userid: user._id });
                const target = defaultAgent(domain, node.agent.id);
                if (command.mode !== 'hold') value.deployment = { expectedHash: command.mode === 'pin' ? value.hash : (target && target.hashhex), requestedOnline: !!agent };
                await set(value);
                if (parent.agentBuildUsage) parent.agentBuildUsage.invalidate(domain);
            } catch (ex) {
                if (agent) {
                    delete agent.agentPolicyChanging;
                    if ((agent.authenticated === 2) && agent.agentExeInfo && agent.agentExeInfo.update) agent.sendBinary(Buffer.from([0, 12, 0, 0]));
                }
                throw new Error('Unable to save the update policy');
            }
            const message = (command.mode === 'pin') ? ('Pinned agent build: ' + value.name) : ((command.mode === 'hold') ? 'Held agent binary updates' : 'Restored default agent updates');
            try {
                server.DispatchEvent(parent.CreateNodeDispatchTargets(node.meshid, node._id, [user._id]), null, { etype: 'node', action: 'agentbuildpolicy', nodeid: node._id, domain: domain.id, userid: user._id, username: user.name, msg: message });
            } finally { if (agent) agent.close(); }
            return value;
        } finally { changing.delete(node._id); release(); }
    }

    async function command(domain, user, request, loginToken) {
        if (!user || (user.domain !== domain.id) || loginToken) throw new Error('Access denied');
        if (!['get', 'set', 'status'].includes(request.op)) throw new Error('Invalid operation');
        const node = await new Promise((resolve, reject) => parent.GetNodeWithRights(domain, user, request.nodeid, (node, rights, visible) => {
            if (!node || !visible || ((rights >>> 0) !== 0xFFFFFFFF)) { reject(new Error('Access denied')); return; }
            resolve(node);
        }));
        if ((node.mtype !== 2) || !node.agent || (node.agent.caps & 0x60) || ((parent.meshes[node.meshid] || {}).flags & 1)) throw new Error('A persistent MeshAgent device is required');
        if (request.op === 'status') return Object.assign(await status(domain, node, await policy(node._id, node.firstconnect)), { statusOnly: true });
        if (request.op === 'set') {
            const value = await change(domain, user, node, request);
            try { return Object.assign(await status(domain, node, value), { statusOnly: true, saved: true }); }
            catch (ex) { throw new Error('The policy was saved. Refresh to load its status.'); }
        }
        return await info(domain, node, request.refresh === true);
    }

    return { command: command, resolve: resolve, updateUrl: updateUrl, download: download, receive: receive, observe: observe };
}

// Administrative command dispatch (catalog, imports, uploads, deployments, defaults)
function CreateAgentBuildAdmin(parent, db, catalog) {
    const uploads = CreateAgentBuildUpload(parent.parent, catalog);
    const imports = CreateAgentBuildImport(uploads);
    parent.agentBuildUsage = CreateAgentBuildUsage(parent, db);
    const deployments = CreateAgentDeployment(parent, db, catalog, parent.agentBuilds);
    let defaultDownload = null, defaultError = null;
    async function command(domain, user, request, loginToken) {
        storage.admin(domain, user, loginToken);
        if (request.area === 'defaults') {
            const defaults = parent.parent.agentDefaults;
            if (!defaults) throw new Error('Default agent downloads are unavailable.');
            if (!['status', 'retry', 'updates'].includes(request.op)) throw new Error('Invalid operation');
            if (request.op === 'updates') {
                if (domain.id !== '') throw new Error('Manage shared defaults from the default server domain.');
                defaults.checkUpdates().catch(() => {});
            }
            if (request.op === 'retry') {
                if (domain.id !== '') throw new Error('Manage shared defaults from the default server domain.');
                if (!defaultDownload && !defaults.status().busy) {
                    defaultError = null;
                    defaultDownload = (async function () {
                        const files = [], expected = defaults.status().files, inventory = await catalog.getCatalog(domain);
                        for (const build of inventory.builds) {
                            for (const artifact of build.artifacts) {
                                if (!artifact.matches || !expected.some(x => x.sha384 === artifact.sha384 && x.size === artifact.size)) continue;
                                const item = await catalog.getArtifact(build.id, artifact.id, artifact.filename, domain);
                                files.push({ path: item.path, size: artifact.size, sha384: artifact.sha384 });
                            }
                        }
                        await defaults.prepare(files);
                    })().catch(err => { defaultError = err.message; }).finally(() => { defaultDownload = null; });
                    parent.parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Checking default agent downloads' });
                }
            }
            return Object.assign(defaults.status(), { busy: !!defaultDownload || defaults.status().busy, error: defaultError, canManage: domain.id === '' });
        }
        if (request.area === 'import') return imports.command(domain, user, request, loginToken);
        if (request.area === 'upload') return uploads.command(domain, user, request, loginToken);
        if (request.area === 'deployment') return deployments.command(domain, user, request, loginToken);
        if (request.area === 'usage') return parent.agentBuildUsage.page(domain, request);
        if (request.area !== 'catalog') throw new Error('Invalid operation');
        if (request.op === 'list') return parent.agentBuildUsage.catalogUsage(domain, await catalog.getCatalog(domain));
        if (!['archive', 'restore', 'remove'].includes(request.op)) throw new Error('Invalid operation');
        return catalog.use(domain, request.build, async function () {
            const build = (await catalog.getCatalog(domain)).builds.find(x => x.id === request.build);
            if (!build) throw new Error('Build is unavailable');
            if (await deployments.references(domain, build.id)) throw new Error('This build is referenced by a deployment. Complete or cancel that deployment first.');
            if (request.op === 'remove' && await parent.agentBuildUsage.references(domain, build)) throw new Error('This build is still installed, pinned or awaiting deployment. Archive it instead.');
            await catalog.manage(domain, build.id, request.op);
            parent.parent.DispatchEvent(['*', user._id], null, { etype: 'server', action: 'agentbuildcatalog', domain: domain.id, userid: user._id, username: user.name, msg: 'Agent build ' + request.op + ': ' + build.name });
            return { changed: true };
        }, true);
    }
    return { command, receive: uploads.receive };
}

module.exports = {
    CreateAgentCatalog, CreateAgentBuilds, CreateAgentBuildAdmin, CreateAgentDefaults,
    CreateAgentBuildUpload, CreateAgentBuildImport, CreateAgentBuildUsage, CreateAgentDeployment,
    CreateAgentReleaseUpdates, storage, fetch, compatibility, binary, archive
};
