/*
 * @description Cross-platform macOS flat package builder for MeshAgent installers.
 * Creates a XAR-based distribution package instead of the legacy bundle .mpkg
 * format that macOS Sequoia/Tahoe rejects.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cpiofs = require('cpio-fs');
const mkbom = require('mkbom');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipe = promisify(pipeline);
const deflate = promisify(zlib.deflate);

const LAUNCH_DAEMON_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>###SERVICENAME###</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/###EXECUTABLENAME###</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>Crashed</key>
      <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
  </dict>
</plist>
`;

const LAUNCH_AGENT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>###SERVICENAME###-launchagent</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/###EXECUTABLENAME###</string>
      <string>-kvm1</string>
    </array>
    <key>LimitLoadToSessionType</key>
    <array>
      <string>LoginWindow</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
`;

const POSTINSTALL = `#!/bin/bash
set -e

SERVICENAME="###SERVICENAME###"
COMPANYNAME="###COMPANYNAME###"
EXECUTABLENAME="###EXECUTABLENAME###"
INSTALLDIR="/usr/local/mesh_services/\${COMPANYNAME}/\${SERVICENAME}"

chown -R root:wheel "/usr/local/mesh_services/\${COMPANYNAME}" || true
chown root:wheel "\${INSTALLDIR}/\${EXECUTABLENAME}" "\${INSTALLDIR}/\${EXECUTABLENAME}.msh"
chown root:wheel "/Library/LaunchDaemons/\${SERVICENAME}.plist" "/Library/LaunchAgents/\${SERVICENAME}.plist"

chmod 755 "\${INSTALLDIR}" "\${INSTALLDIR}/\${EXECUTABLENAME}"
chmod 644 "\${INSTALLDIR}/\${EXECUTABLENAME}.msh" "/Library/LaunchDaemons/\${SERVICENAME}.plist" "/Library/LaunchAgents/\${SERVICENAME}.plist"

/bin/launchctl bootout system "/Library/LaunchDaemons/\${SERVICENAME}.plist" >/dev/null 2>&1 || true
/bin/launchctl bootstrap system "/Library/LaunchDaemons/\${SERVICENAME}.plist" >/dev/null 2>&1 || /bin/launchctl load "/Library/LaunchDaemons/\${SERVICENAME}.plist"
`;

const UNINSTALL = `#!/bin/bash

echo "Stopping ###SERVICENAME###..."
sudo /bin/launchctl bootout system "/Library/LaunchDaemons/###SERVICENAME###.plist" &> /dev/null || sudo /bin/launchctl unload "/Library/LaunchDaemons/###SERVICENAME###.plist" &> /dev/null
sudo /bin/launchctl unload "/Library/LaunchDaemons/meshagentDiagnostic_periodicStart.plist" &> /dev/null
sudo /bin/launchctl unload "/Library/LaunchDaemons/meshagentDiagnostic.plist" &> /dev/null
sudo rm "/Library/LaunchDaemons/meshagentDiagnostic_periodicStart.plist" &> /dev/null
sudo rm "/Library/LaunchDaemons/meshagentDiagnostic.plist" &> /dev/null
sudo rm "/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/###EXECUTABLENAME###" &> /dev/null
sudo rm "/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/###EXECUTABLENAME###.msh" &> /dev/null
sudo rm "/usr/local/mesh_services/###COMPANYNAME###/###SERVICENAME###/###EXECUTABLENAME###.db" &> /dev/null
sudo rm "/usr/local/mesh_services/meshagentDiagnostic/meshagentDiagnostic" &> /dev/null
sudo rm "/Library/LaunchDaemons/###SERVICENAME###.plist" &> /dev/null
sudo rm "/Library/LaunchAgents/###SERVICENAME###.plist" &> /dev/null
echo "###SERVICENAME### was uninstalled."
`;

function replaceTokens(str, tokens) {
    return str.split('###SERVICENAME###').join(tokens.serviceName)
        .split('###COMPANYNAME###').join(tokens.companyName)
        .split('###EXECUTABLENAME###').join(tokens.executableName);
}

function xmlEscape(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function pkgIdentifierSegment(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '') || 'meshagent';
}

async function chmodIfExists(file, mode) {
    try { await fsp.chmod(file, mode); } catch (ex) { }
}

async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let files = 0, bytes = 0;
    for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const r = await walk(p);
            files += r.files;
            bytes += r.bytes;
        } else if (entry.isFile()) {
            const s = await fsp.stat(p);
            files++;
            bytes += s.size;
        }
    }
    return { files, bytes };
}

async function createPayload(payloadRoot, targetFile) {
    await pipe(
        cpiofs.pack(payloadRoot, {
            map: function (header) {
                header.uid = 0;
                header.gid = 0;
                return header;
            }
        }),
        zlib.createGzip(),
        fs.createWriteStream(targetFile)
    );
}

async function createBom(payloadRoot, targetFile) {
    await pipe(mkbom(payloadRoot, { uid: 0, gid: 0 }), fs.createWriteStream(targetFile));
}

async function collectXarEntry(filePath, name, id) {
    const stat = await fsp.stat(filePath);
    const entry = {
        id: id,
        name: name,
        type: stat.isDirectory() ? 'directory' : 'file',
        mode: stat.mode,
        uid: stat.uid,
        gid: stat.gid,
        atime: stat.atime,
        mtime: stat.mtime,
        ctime: stat.ctime
    };
    if (stat.isFile()) {
        entry.data = await fsp.readFile(filePath);
    } else if (stat.isDirectory()) {
        const names = (await fsp.readdir(filePath)).sort();
        entry.children = [];
        for (const childName of names) {
            entry.children.push(await collectXarEntry(path.join(filePath, childName), childName, ++collectXarEntry.nextId));
        }
    }
    return entry;
}

function xarDate(d) {
    return d.toISOString();
}

function xarFileXml(entry, depth, heapParts) {
    const indent = ' '.repeat(depth);
    let xml = indent + '<file id="' + entry.id + '">\n'
        + indent + ' <name>' + xmlEscape(entry.name) + '</name>\n'
        + indent + ' <type>' + entry.type + '</type>\n'
        + indent + ' <mode>' + entry.mode.toString(8) + '</mode>\n'
        + indent + ' <uid>' + entry.uid + '</uid>\n'
        + indent + ' <gid>' + entry.gid + '</gid>\n'
        + indent + ' <atime>' + xarDate(entry.atime) + '</atime>\n'
        + indent + ' <mtime>' + xarDate(entry.mtime) + '</mtime>\n'
        + indent + ' <ctime>' + xarDate(entry.ctime) + '</ctime>\n';
    if (entry.type == 'file') {
        const offset = 20 + heapParts.reduce(function (total, part) { return total + part.length; }, 0);
        const sum = crypto.createHash('sha1').update(entry.data).digest('hex');
        heapParts.push(entry.data);
        xml += indent + ' <data>\n'
            + indent + '  <archived-checksum style="sha1">' + sum + '</archived-checksum>\n'
            + indent + '  <extracted-checksum style="sha1">' + sum + '</extracted-checksum>\n'
            + indent + '  <offset>' + offset + '</offset>\n'
            + indent + '  <encoding style="application/octet-stream"/>\n'
            + indent + '  <size>' + entry.data.length + '</size>\n'
            + indent + '  <length>' + entry.data.length + '</length>\n'
            + indent + ' </data>\n';
    } else {
        for (const child of entry.children) { xml += xarFileXml(child, depth + 1, heapParts); }
    }
    return xml + indent + '</file>\n';
}

async function createXarPackage(paths) {
    collectXarEntry.nextId = 0;
    const entries = [];
    for (const p of paths) { entries.push(await collectXarEntry(p, path.basename(p), ++collectXarEntry.nextId)); }

    const heapParts = [];
    let toc = '<?xml version="1.0" encoding="UTF-8"?>\n<xar>\n <toc>\n'
        + '  <checksum style="sha1">\n   <size>20</size>\n   <offset>0</offset>\n  </checksum>\n'
        + '  <creation-time>' + (new Date()).toISOString() + '</creation-time>\n';
    for (const entry of entries) { toc += xarFileXml(entry, 2, heapParts); }
    toc += ' </toc>\n</xar>';

    const tocBuffer = Buffer.from(toc, 'utf8');
    const compressedToc = await deflate(tocBuffer);
    const tocChecksum = crypto.createHash('sha1').update(compressedToc).digest();
    const header = Buffer.alloc(28);
    header.writeUInt32BE(0x78617221, 0); // xar!
    header.writeUInt16BE(28, 4);
    header.writeUInt16BE(1, 6);
    header.writeBigUInt64BE(BigInt(compressedToc.length), 8);
    header.writeBigUInt64BE(BigInt(tocBuffer.length), 16);
    header.writeUInt32BE(1, 24); // sha1
    return Buffer.concat([header, compressedToc, tocChecksum].concat(heapParts));
}

async function createMacOSInstaller(opts) {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'meshcentral-macos-pkg-'));
    try {
        const payloadRoot = path.join(tmpRoot, 'payload');
        const scriptsRoot = path.join(tmpRoot, 'scripts');
        const basePkg = path.join(tmpRoot, 'internal.pkg');
        const resourcesDir = path.join(tmpRoot, 'Resources');
        const installDir = path.join(payloadRoot, 'usr', 'local', 'mesh_services', opts.companyName, opts.serviceName);
        const launchDaemons = path.join(payloadRoot, 'Library', 'LaunchDaemons');
        const launchAgents = path.join(payloadRoot, 'Library', 'LaunchAgents');
        const tokens = { serviceName: opts.serviceName, companyName: opts.companyName, executableName: opts.executableName };

        await fsp.mkdir(installDir, { recursive: true });
        await fsp.mkdir(launchDaemons, { recursive: true });
        await fsp.mkdir(launchAgents, { recursive: true });
        await fsp.mkdir(basePkg, { recursive: true });
        await fsp.mkdir(scriptsRoot, { recursive: true });
        await fsp.mkdir(resourcesDir, { recursive: true });

        await fsp.copyFile(opts.agentPath, path.join(installDir, opts.executableName));
        await fsp.writeFile(path.join(installDir, opts.executableName + '.msh'), opts.meshSettings);
        await fsp.writeFile(path.join(launchDaemons, opts.serviceName + '.plist'), replaceTokens(LAUNCH_DAEMON_PLIST, tokens));
        await fsp.writeFile(path.join(launchAgents, opts.serviceName + '.plist'), replaceTokens(LAUNCH_AGENT_PLIST, tokens));
        await fsp.writeFile(path.join(scriptsRoot, 'postinstall'), replaceTokens(POSTINSTALL, tokens));

        await chmodIfExists(path.join(installDir, opts.executableName), 0o755);
        await chmodIfExists(path.join(scriptsRoot, 'postinstall'), 0o755);
        await chmodIfExists(path.join(installDir, opts.executableName + '.msh'), 0o644);
        await chmodIfExists(path.join(launchDaemons, opts.serviceName + '.plist'), 0o644);
        await chmodIfExists(path.join(launchAgents, opts.serviceName + '.plist'), 0o644);

        const payloadStats = await walk(payloadRoot);
        const installKBytes = Math.ceil(payloadStats.bytes / 1000);
        await createPayload(payloadRoot, path.join(basePkg, 'Payload'));
        await createPayload(scriptsRoot, path.join(basePkg, 'Scripts'));
        await createBom(payloadRoot, path.join(basePkg, 'Bom'));

        const packageInfo = '<pkg-info format-version="2" identifier="com.meshcentral.' + xmlEscape(pkgIdentifierSegment(opts.serviceName)) + '.pkg" version="1.0" install-location="/" relocatable="false" auth="root">\n'
            + '  <payload installKBytes="' + installKBytes + '" numberOfFiles="' + payloadStats.files + '"/>\n'
            + '  <scripts>\n'
            + '    <postinstall file="./postinstall"/>\n'
            + '  </scripts>\n'
            + '</pkg-info>\n';
        await fsp.writeFile(path.join(basePkg, 'PackageInfo'), packageInfo);

        const welcome = 'Welcome to the MeshCentral agent for MacOS\n\nThis installer will install the mesh agent for "' + opts.meshName + '" and allow the administrator to remotely monitor and control this computer over the internet. For more information, go to https://meshcentral.com.\n\nThis software is provided under Apache 2.0 license.\n';
        const distribution = '<?xml version="1.0" encoding="utf-8"?>\n'
            + '<installer-script minSpecVersion="1.000000">\n'
            + '    <title>' + xmlEscape(opts.displayName) + '</title>\n'
            + '    <options customize="never" allow-external-scripts="no" rootVolumeOnly="true"/>\n'
            + '    <welcome language="en-US" mime-type="text/plain"><![CDATA[' + welcome.split(']]>').join(']]]]><![CDATA[>') + ']]></welcome>\n'
            + '    <choices-outline>\n'
            + '        <line choice="choice65"/>\n'
            + '    </choices-outline>\n'
            + '    <choice id="choice65" title="' + xmlEscape(opts.displayName) + '">\n'
            + '        <pkg-ref id="internal.pkg"/>\n'
            + '    </choice>\n'
            + '    <pkg-ref id="internal.pkg" installKBytes="' + installKBytes + '" version="1.0" auth="Root">#internal.pkg</pkg-ref>\n'
            + '    <options hostArchitectures="arm64,x86_64"/>\n'
            + '</installer-script>\n';
        await fsp.writeFile(path.join(tmpRoot, 'Distribution'), distribution);

        const pkgBuffer = await createXarPackage([basePkg, resourcesDir, path.join(tmpRoot, 'Distribution')]);
        return {
            pkg: pkgBuffer,
            uninstall: replaceTokens(UNINSTALL, tokens)
        };
    } finally {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
}

module.exports = { createMacOSInstaller };
