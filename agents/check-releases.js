'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
    const args = process.argv.slice(2);
    let directory, packageFile;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--directory') directory = path.resolve(args[++i]);
        else if (args[i] === '--package') packageFile = args[++i];
        else throw new Error('Unknown option: ' + args[i]);
    }
    if (packageFile) {
        const data = JSON.parse(await fs.promises.readFile(packageFile, 'utf8'));
        const packages = Array.isArray(data) ? data : Object.values(data);
        if (packages.length !== 1 || !Array.isArray(packages[0].files)) throw new Error('Invalid npm package file list.');
        const names = packages[0].files.map(file => file.path);
        if (['agents/agent-defaults.json', 'agentdefaults.js', 'agenttypes.js', 'agentreleaseupdates.js', 'agentbuildfetch.js'].some(name => !names.includes(name))) throw new Error('Agent download support is missing from the package.');
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
        const defaults = require('../agentdefaults').CreateAgentDefaults(parent, { directory: directory || temporary });
        await defaults.prepare();
        const status = defaults.status();
        if (status.errors.length) throw new Error('Default release files must be published and verified before MeshCentral is released:\n' + status.errors.join('\n'));
        if (status.files.length !== files.length || status.files.some(file => file.status !== 'Ready')) throw new Error('Some default release files were not verified.');
        console.log('Verified ' + files.length + ' default release files.');
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
