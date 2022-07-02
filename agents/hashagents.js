var fs = require('fs');

var agents = {
    'MeshService.exe': 3,
    'MeshService64.exe': 4,
    'meshagent_x86': 5,
    'meshagent_x86-64': 6,
    'meshagent_arm': 9,
    'meshagent_mips': 7,
    'meshagent_pogo': 13,
    'meshagent_poky': 15,
    'meshagent_osx-x86-64': 16,
    'meshagent_poky64': 18,
    'meshagent_x86_nokvm': 19,
    'meshagent_x86-64_nokvm': 20, 
    'meshagent_arm-linaro': 24,
    'meshagent_armhf': 25,
    'meshagent_arm64': 26,
    'meshagent_armhf2': 27,
    'meshagent_mips24kc': 28,
    'meshagent_osx-arm-64': 29,
    'meshagent_freebsd_x86-64': 30,
    'meshagent_aarch64': 32,
    'meshagent_alpine-x86-64': 33,
    'meshagent_mipsel24kc': 40,
    'meshagent_aarch64-cortex-a53': 41,
    'meshagent_osx-universal-64': 10005
}

var agentinfo = {};
for (var i in agents) {
    var info = getAgentInfo(i, agents[i]);
    if (info != null) { agentinfo[agents[i]] = info; }
}
console.log(JSON.stringify(agentinfo, null, 2));
process.exit();

function getAgentInfo(filename, id) {
    if (fs.existsSync(filename) != true) return null;
    var stats = fs.statSync(filename);
    return { filename: filename, hash: getSHA384FileHash(filename).toString('hex'), size: stats.size, mtime: stats.mtime };
}
