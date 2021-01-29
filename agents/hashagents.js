var fs = require('fs'), r = '';

var agents = {
    'MeshService-signed.exe': 3,
    'MeshService64-signed.exe': 4,
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

for (var i in agents) { r += hashAgent(i, agents[i]); }
console.log(r);
process.exit();

function hashAgent(filename, id) {
    if (fs.existsSync(filename) != true) return '';
    return id + ': ' + filename + '\r\n' + getSHA384FileHash(filename).toString('hex') + '\r\n';
}
