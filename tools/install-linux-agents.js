/**
 * Install Linux agent binaries built by GitHub Actions.
 *
 * Companion to install-windows-agents.js; see that file for why the built
 * agents belong in git rather than being fetched at container start.
 *
 * Usage:
 *   node tools/install-linux-agents.js <directory-with-downloaded-artifacts>
 *
 * Only filenames already present in agents/hashagents.json are installed. The
 * Linux workflow drops every meshagent_* it produced into one directory, and
 * that set does not always line up with what this server publishes, so an
 * unknown name is reported and skipped rather than added blindly with an id
 * this script would have to invent.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Targets built with AUDIO=1 in .github/workflows/linux-build.yml. Anything
// else is expected to have no audio support, so absence is not a warning.
const AUDIO_EXPECTED = new Set(['meshagent_x86', 'meshagent_x86-64', 'meshagent_arm64', 'meshagent_aarch64']);

const repoRoot = path.join(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');
const hashFile = path.join(agentsDir, 'hashagents.json');

function fail(msg) {
    console.error('ERROR: ' + msg);
    process.exit(1);
}

function findAgentBinaries(root) {
    const found = new Map(); // filename -> full path
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (ex) { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.startsWith('meshagent_')) { continue; }
            // Debug builds are much larger and are not what we publish.
            if (entry.name.startsWith('DEBUG_')) { continue; }
            if (found.has(entry.name)) {
                fail('two copies of ' + entry.name + ':\n  ' + found.get(entry.name) + '\n  ' + full);
            }
            found.set(entry.name, full);
        }
    })(root);
    return found;
}

function sha384(file) {
    return crypto.createHash('sha384').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function main() {
    const sourceDir = process.argv[2];
    if (!sourceDir) { fail('usage: node tools/install-linux-agents.js <directory-with-downloaded-artifacts>'); }
    if (!fs.existsSync(sourceDir)) { fail('directory not found: ' + sourceDir); }
    if (!fs.existsSync(hashFile)) { fail('hashagents.json not found at ' + hashFile); }

    const hashes = JSON.parse(fs.readFileSync(hashFile, 'utf8'));

    // filename -> agent id, from the entries this server already publishes
    const idByFilename = new Map();
    for (const [id, entry] of Object.entries(hashes)) {
        if (entry && typeof entry.filename === 'string') { idByFilename.set(entry.filename, id); }
    }

    const candidates = findAgentBinaries(sourceDir);
    if (candidates.size === 0) { fail('no meshagent_* binaries found under ' + sourceDir); }

    const installed = [];
    const unknown = [];

    for (const [filename, src] of candidates) {
        const id = idByFilename.get(filename);
        if (id === undefined) { unknown.push(filename); continue; }

        const dest = path.join(agentsDir, filename);
        const contents = fs.readFileSync(src);
        const stat = fs.statSync(src);
        const hasAudio = contents.includes('MeshAudio') || contents.includes('KVM Audio');

        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755); // artifact download loses the executable bit

        hashes[id] = {
            filename: filename,
            hash: sha384(dest),
            size: stat.size,
            mtime: new Date().toISOString()
        };

        installed.push({ id, filename, size: stat.size, hasAudio });
    }

    if (installed.length === 0) {
        fail('none of the downloaded binaries match an agent this server publishes:\n  ' + unknown.join('\n  '));
    }

    fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2) + '\n');

    console.log('Installed:');
    installed.sort((a, b) => Number(a.id) - Number(b.id));
    for (const item of installed) {
        const expectAudio = AUDIO_EXPECTED.has(item.filename);
        let note = '';
        if (expectAudio) { note = item.hasAudio ? 'audio:yes' : 'audio:NO  <-- expected AUDIO=1'; }
        console.log('  id=%s  %s  %s KB  %s',
            item.id.padEnd(4), item.filename.padEnd(28),
            String(Math.round(item.size / 1024)).padStart(6), note);
    }
    if (unknown.length > 0) {
        console.log('\nSkipped (no entry in hashagents.json): ' + unknown.join(', '));
    }
    console.log('\nUpdated ' + path.relative(repoRoot, hashFile));

    const missingAudio = installed.filter((i) => AUDIO_EXPECTED.has(i.filename) && !i.hasAudio);
    if (missingAudio.length > 0) {
        console.error('\nWARNING: built without audio support: ' + missingAudio.map((i) => i.filename).join(', '));
        console.error('The speaker button will not appear for those platforms.');
        console.error('Check that the build passed AUDIO=1.');
        process.exit(2);
    }
}

main();
