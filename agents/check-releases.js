'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

async function main() {
    const args = process.argv.slice(2);
    let directory, packageFile, output;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--directory') directory = path.resolve(args[++i]);
        else if (args[i] === '--package') packageFile = args[++i];
        else if (args[i] === '--output') output = path.resolve(args[++i]);
        else throw new Error('Unknown option: ' + args[i]);
    }
    if (output && (directory || packageFile)) throw new Error('--output cannot be combined with --directory or --package.');
    if (packageFile) {
        const data = JSON.parse(await fs.promises.readFile(packageFile, 'utf8'));
        const packages = Array.isArray(data) ? data : Object.values(data);
        if (packages.length !== 1 || !Array.isArray(packages[0].files)) throw new Error('Invalid npm package file list.');
        const names = packages[0].files.map(file => file.path);
        if (['agents/agent-defaults.json', 'agentbuilds.js', 'agenttypes.js'].some(name => !names.includes(name))) throw new Error('Agent download support is missing from the package.');
        const binaries = names.filter(name => /^agents\/(?:meshagent[_-]|MeshService|MeshConsole|MeshCmd.*\.exe$|agents_[^/]+\/)/i.test(name));
        if (binaries.length) throw new Error('Agent binaries must be release assets: ' + binaries.join(', '));
    }
    const manifestPath = path.join(__dirname, 'agent-defaults.json');
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    if (!manifest.releases || !manifest.releases.length) throw new Error('Pin agent releases before publishing MeshCentral.');
    const files = manifest.releases.flatMap(release => release.files || []);
    if (files.some(file => !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(file.filename))) throw new Error('Invalid default filename.');
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meshcentral-releases-'));
    try {
        const parent = {
            datapath: temporary,
            config: { settings: { agentdownloads: { manifest: manifestPath, enabled: !directory } } },
            meshAgentsArchitectureNumbers: require('../agenttypes')()
        };
        // Files already in the output folder that match the pins are reused instead of downloaded again.
        const defaults = require('../agentbuilds').CreateAgentDefaults(parent, { directory: directory || output || temporary });
        await defaults.prepare();
        const status = defaults.status();
        if (output && status.errors.length) {
            // Listed per file: the server's warning would name the temporary cache folder.
            const failed = status.files.filter(file => file.status !== 'Ready');
            throw new Error('Unable to save the default release files:\n' + (failed.length ? failed.map(file => file.filename + ': ' + file.error) : status.errors).join('\n'));
        }
        if (status.errors.length) throw new Error('Default release files must be published and verified before MeshCentral is released:\n' + status.errors.join('\n'));
        if (status.files.length !== files.length || status.files.some(file => file.status !== 'Ready')) throw new Error('Some default release files were not verified.');
        if (output) {
            await fs.promises.mkdir(output, { recursive: true });
            for (const file of status.files) {
                const temp = path.join(output, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
                try {
                    await fs.promises.copyFile(defaults.sourcePath(file.filename), temp, fs.constants.COPYFILE_EXCL);
                    // The cache copy is private to this user, and the server may run as another.
                    await fs.promises.chmod(temp, 0o644);
                    await fs.promises.rename(temp, path.join(output, file.filename));
                } finally { await fs.promises.unlink(temp).catch(() => {}); }
            }
        }
        console.log('Verified ' + files.length + ' default release files' + (output ? ' in ' + output : '') + '.');
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
