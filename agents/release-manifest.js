'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
    const args = process.argv.slice(2), files = [], release = { repository: null, tag: null, files: [] };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repository') release.repository = args[++i];
        else if (args[i] === '--tag') release.tag = args[++i];
        else if (args[i].startsWith('--')) throw new Error('Unknown option: ' + args[i]);
        else files.push(args[i]);
    }
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(release.repository || '') ||
        !release.tag || release.tag.length > 128 || /[\x00-\x20\x7f]/.test(release.tag) || !files.length) {
        throw new Error('Usage: node agents/release-manifest.js --repository owner/repository --tag version file [file ...]');
    }
    const names = new Set();
    for (const filename of files) {
        const name = path.basename(filename), before = await fs.promises.lstat(filename);
        if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(name) || names.has(name.toLowerCase()) ||
            !before.isFile() || !before.size || before.size > 128 * 1024 * 1024) throw new Error('Invalid or duplicate release file: ' + name);
        names.add(name.toLowerCase());
        const hash = crypto.createHash('sha384');
        for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
        const after = await fs.promises.lstat(filename);
        if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Release file changed: ' + name);
        release.files.push({ filename: name, asset: name, size: after.size, sha384: hash.digest('hex') });
    }
    release.files.sort((a, b) => a.filename.localeCompare(b.filename));
    process.stdout.write(JSON.stringify({ schemaVersion: 1, releases: [release] }, null, 2) + '\n');
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
