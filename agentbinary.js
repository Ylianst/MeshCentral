'use strict';

const crypto = require('crypto');
const policyGuids = ['b996015880544a19b7f7e9be44914c18', 'b996015880544a19b7f7e9be44914c19'];

module.exports.inspect = function (data, architectures) {
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
        if (![2, 3].includes(u16(16)) || !word(24)) throw new Error('Upload an executable agent, not a library or object file.');
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
        if (![0x10b, 0x20b].includes(magic) || size < (wide ? 152 : 136) || !sections || sections > 96 || (u16(pe + 22) & 0x2000)) throw new Error('Upload a supported Windows executable agent.');
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
    } else { throw new Error('Upload a native ELF, PE or Mach-O agent file. Archives and universal binaries are not supported.'); }
    if (!platform || !cpu || !ids.length) throw new Error('This executable architecture is not supported.');
    if (policyGuids.includes(data.subarray(-16).toString('hex'))) {
        warnings.push('This file contains embedded connection settings. Upload an unconfigured agent binary.');
        throw new Error(warnings.at(-1));
    }
    const candidates = ids.filter(id => architectures[id] && architectures[id].update).map(id => ({ id, name: architectures[id].desc }));
    if (!candidates.length) throw new Error('No supported MeshAgent type matches this executable.');
    const digest = crypto.createHash('sha384');
    if (checksum) digest.update(data.subarray(0, checksum)).update(Buffer.alloc(4)).update(data.subarray(checksum + 4, table)).update(Buffer.alloc(8)).update(data.subarray(table + 8, end));
    else digest.update(data.subarray(0, end));
    const sha384 = crypto.createHash('sha384').update(data).digest('hex');
    return { platform, cpu, size: data.length, binaryMetadata: metadata, candidates, warnings, hashes: { sha256: crypto.createHash('sha256').update(data).digest('hex'), sha384, agentSha384: digest.digest('hex') } };
};
