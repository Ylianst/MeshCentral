'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { createMacOSInstaller } = require('../macosinstaller');

const fsp = fs.promises;
const companyName = 'Example Company';
const serviceName = 'meshagent-service';
const executableName = 'meshagent';
const installPath = 'usr/local/mesh_services/' + companyName + '/' + serviceName;
const posixOnly = { skip: process.platform === 'win32', concurrency: false };

// Read a member from the generated XAR container, then decode the standard ODC CPIO archive.
function readArchive(pkg, member) {
    assert.equal(pkg.readUInt32BE(0), 0x78617221);
    const tocStart = pkg.readUInt16BE(4);
    const tocLength = Number(pkg.readBigUInt64BE(8));
    const toc = zlib.inflateSync(pkg.subarray(tocStart, tocStart + tocLength)).toString();
    const match = toc.match(new RegExp('<name>' + member + '</name>[\\s\\S]*?<offset>(\\d+)</offset>[\\s\\S]*?<length>(\\d+)</length>'));
    assert.ok(match, 'Missing XAR member: ' + member);
    const start = tocStart + tocLength + Number(match[1]);
    const archive = zlib.gunzipSync(pkg.subarray(start, start + Number(match[2])));
    const entries = new Map();
    let offset = 0;
    while (offset + 76 <= archive.length) {
        const header = archive.subarray(offset, offset + 76).toString('ascii');
        assert.equal(header.substring(0, 6), '070707');
        const mode = parseInt(header.substring(18, 24), 8);
        const nameSize = parseInt(header.substring(59, 65), 8);
        const size = parseInt(header.substring(65, 76), 8);
        const name = archive.subarray(offset + 76, offset + 76 + nameSize - 1).toString();
        offset += 76 + nameSize;
        if (name === 'TRAILER!!!') { return entries; }
        entries.set(name, { mode: mode, data: archive.subarray(offset, offset + size) });
        offset += size;
    }
    assert.fail('Missing CPIO trailer');
}

async function withInstaller(umask, verify) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meshcentral-macos-test-'));
    const oldUmask = process.umask(umask);
    try {
        const agentPath = path.join(root, executableName);
        const backgroundPath = path.join(root, 'background.png');
        await fsp.writeFile(agentPath, 'agent test fixture');
        await fsp.writeFile(backgroundPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/K7sAAAAASUVORK5CYII=', 'base64'));
        const result = await createMacOSInstaller({
            agentPath: agentPath,
            backgroundPath: backgroundPath,
            companyName: companyName,
            serviceName: serviceName,
            executableName: executableName,
            meshName: 'Test Group',
            displayName: 'Test Agent',
            meshSettings: 'MeshServer=wss://example.invalid/agent.ashx\n'
        });
        await verify(result.pkg, root);
    } finally {
        process.umask(oldUmask);
        await fsp.rm(root, { recursive: true, force: true });
    }
}

for (const umask of [0o022, 0o077]) {
    test('macOS payload directory permissions with umask ' + umask.toString(8), posixOnly, async () => {
        await withInstaller(umask, async (pkg) => {
            const payload = readArchive(pkg, 'Payload');
            const directories = [
                'usr', 'usr/local', 'usr/local/mesh_services',
                'usr/local/mesh_services/' + companyName, installPath,
                'Library', 'Library/LaunchDaemons', 'Library/LaunchAgents'
            ];
            for (const directory of directories) {
                const entry = payload.get(directory);
                assert.ok(entry, 'Missing directory: ' + directory);
                assert.equal(entry.mode & 0o170000, 0o040000, directory);
                assert.equal(entry.mode & 0o777, 0o755, directory);
            }
            assert.equal(payload.get(installPath + '/' + executableName).mode & 0o777, 0o755);
            for (const file of [
                installPath + '/' + executableName + '.msh',
                'Library/LaunchDaemons/' + serviceName + '.plist',
                'Library/LaunchAgents/' + serviceName + '-launchagent.plist'
            ]) {
                assert.equal(payload.get(file).mode & 0o777, 0o644, file);
            }
            const scripts = readArchive(pkg, 'Scripts');
            assert.equal(scripts.get('postinstall').mode & 0o777, 0o755);
            execFileSync('/bin/bash', ['-n'], { input: scripts.get('postinstall').data });
        });
    });
}

test('postinstall repairs existing container directories without changing private files', posixOnly, async () => {
    await withInstaller(0o077, async (pkg, root) => {
        const script = readArchive(pkg, 'Scripts').get('postinstall').data.toString();
        const chmodLine = script.split('\n').find(line => line.startsWith('chmod 755 '));
        assert.ok(chmodLine, 'Missing postinstall permission correction');
        const serviceRoot = path.join(root, 'existing-services');
        const companyDirectory = path.join(serviceRoot, companyName);
        const installDirectory = path.join(companyDirectory, serviceName);
        const agent = path.join(installDirectory, executableName);
        const database = path.join(installDirectory, 'private.db');
        await fsp.mkdir(installDirectory, { recursive: true });
        await fsp.writeFile(agent, 'agent fixture', { mode: 0o700 });
        await fsp.writeFile(database, 'private fixture', { mode: 0o600 });
        for (const directory of [serviceRoot, companyDirectory, installDirectory]) {
            await fsp.chmod(directory, 0o700);
        }

        // Execute only the emitted chmod command against an isolated tree, not /usr/local.
        execFileSync('/bin/bash', ['-eu', '-c', chmodLine.split('/usr/local/mesh_services').join(serviceRoot)], {
            env: Object.assign({}, process.env, {
                BASH_ENV: '', COMPANYNAME: companyName, INSTALLDIR: installDirectory, EXECUTABLENAME: executableName
            })
        });
        for (const entry of [serviceRoot, companyDirectory, installDirectory, agent]) {
            assert.equal((await fsp.stat(entry)).mode & 0o777, 0o755, entry);
        }
        assert.equal((await fsp.stat(database)).mode & 0o777, 0o600);
    });
});
