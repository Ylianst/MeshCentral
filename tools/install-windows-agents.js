/**
 * Install Windows agent binaries built by GitHub Actions.
 *
 * The Windows agents are produced by the MeshAgent-jugu "Windows Build"
 * workflow, which cannot commit back into this repository. Without this step
 * the server keeps serving whatever MeshService*.exe is already in agents/, so
 * a rebuilt Docker image still hands out the previous agent -- and any feature
 * added to the agent (remote audio, for example) never reaches the device.
 *
 * Usage:
 *   1. Download the artifacts from the workflow run:
 *        Actions -> the run -> Artifacts ->
 *          meshagent-windows-x86 / -x64 / -ARM64
 *   2. Unzip them somewhere, then point this script at that directory:
 *        node tools/install-windows-agents.js ~/Downloads/meshagent-artifacts
 *
 * It copies each MeshService*.exe into agents/ and refreshes agents/hashagents.json
 * with the new SHA384, size and mtime. The server compares that hash against the
 * hash reported by each agent, so it must be updated or devices will not
 * self-update to the new binary.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// agent id -> filename, matching the table in meshcentral.js
const WINDOWS_AGENTS = [
    { id: '3',  filename: 'MeshService.exe',      arch: 'x86'   },
    { id: '4',  filename: 'MeshService64.exe',    arch: 'x64'   },
    { id: '43', filename: 'MeshServiceARM64.exe', arch: 'ARM64' }
];

const repoRoot = path.join(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');
const hashFile = path.join(agentsDir, 'hashagents.json');

function fail(msg) {
    console.error('ERROR: ' + msg);
    process.exit(1);
}

// The artifacts may be unzipped into per-architecture subdirectories or all
// into one folder, so search recursively for each expected filename.
function findFile(root, filename) {
    const matches = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (ex) { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); }
            else if (entry.name.toLowerCase() === filename.toLowerCase()) { matches.push(full); }
        }
    })(root);
    return matches;
}

function sha384(file) {
    return crypto.createHash('sha384').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function main() {
    const sourceDir = process.argv[2];
    if (!sourceDir) {
        fail('usage: node tools/install-windows-agents.js <directory-with-downloaded-artifacts>');
    }
    if (!fs.existsSync(sourceDir)) { fail('directory not found: ' + sourceDir); }
    if (!fs.existsSync(hashFile)) { fail('hashagents.json not found at ' + hashFile); }

    const hashes = JSON.parse(fs.readFileSync(hashFile, 'utf8'));
    const installed = [];
    const missing = [];

    for (const agent of WINDOWS_AGENTS) {
        const found = findFile(sourceDir, agent.filename);
        if (found.length === 0) { missing.push(agent); continue; }
        if (found.length > 1) {
            // Several artifacts contain a file of the same name only if the
            // wrong folder was passed; refuse rather than pick arbitrarily.
            fail('found ' + found.length + ' copies of ' + agent.filename + ':\n  ' + found.join('\n  '));
        }

        const src = found[0];
        const dest = path.join(agentsDir, agent.filename);
        const stat = fs.statSync(src);

        // Guard against installing a build that lacks the audio support, which
        // is the exact failure this script exists to prevent. Detect the Opus
        // encoder's own symbols rather than any message of ours: the Windows
        // capture path deliberately prints nothing, so there is no log string
        // to look for, whereas libopus is only linked when the audio support
        // is compiled in (verified: absent from pre-audio builds).
        const contents = fs.readFileSync(src);
        const hasAudio = contents.includes('silk_') && contents.includes('celt_');

        fs.copyFileSync(src, dest);

        hashes[agent.id] = {
            filename: agent.filename,
            hash: sha384(dest),
            size: stat.size,
            mtime: new Date().toISOString()
        };

        installed.push({ agent, size: stat.size, hasAudio });
    }

    if (installed.length === 0) {
        fail('no MeshService*.exe found under ' + sourceDir);
    }

    fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2) + '\n');

    console.log('Installed:');
    for (const item of installed) {
        console.log('  %s  %s  %s KB  audio:%s',
            item.agent.arch.padEnd(6),
            item.agent.filename.padEnd(22),
            String(Math.round(item.size / 1024)).padStart(6),
            item.hasAudio ? 'yes' : 'NO  <-- built without _KVM_AUDIO');
    }
    if (missing.length > 0) {
        console.log('Not found (skipped): ' + missing.map(function (m) { return m.filename; }).join(', '));
    }
    console.log('\nUpdated ' + path.relative(repoRoot, hashFile));
    console.log('Next: commit agents/, rebuild the Docker image, and let devices self-update.');

    if (installed.some(function (i) { return !i.hasAudio; })) {
        console.error('\nWARNING: at least one binary contains no audio code. The speaker');
        console.error('button will not appear for it. Check that the build defined _KVM_AUDIO.');
        process.exit(2);
    }
}

main();
