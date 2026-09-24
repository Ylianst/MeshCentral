'use strict';

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

module.exports = { request: request, check: check, validate: validate };
