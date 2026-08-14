/**
* @description Mesh and site permission bit masks
* @license Apache-2.0
*/

'use strict';

module.exports.mesh = Object.freeze({
    editMesh: 0x00000001,
    manageUsers: 0x00000002,
    manageComputers: 0x00000004,
    remoteControl: 0x00000008,
    agentConsole: 0x00000010,
    serverFiles: 0x00000020,
    wakeDevice: 0x00000040,
    setNotes: 0x00000080,
    remoteViewOnly: 0x00000100,
    noTerminal: 0x00000200,
    noFiles: 0x00000400,
    noAmt: 0x00000800,
    desktopLimitedInput: 0x00001000,
    limitEvents: 0x00002000,
    chatNotify: 0x00004000,
    uninstall: 0x00008000,
    noDesktop: 0x00010000,
    remoteCommand: 0x00020000,
    resetOff: 0x00040000,
    guestSharing: 0x00080000,
    deviceDetails: 0x00100000,
    relay: 0x00200000,
    noRegistry: 0x00400000,
    noSoftware: 0x00800000,
    admin: 0xFFFFFFFF
});

module.exports.site = Object.freeze({
    serverBackup: 0x00000001,
    manageUsers: 0x00000002,
    serverRestore: 0x00000004,
    fileAccess: 0x00000008,
    serverUpdate: 0x00000010,
    locked: 0x00000020,
    noNewGroups: 0x00000040,
    noMeshCommand: 0x00000080,
    userGroups: 0x00000100,
    recordings: 0x00000200,
    lockSettings: 0x00000400,
    allEvents: 0x00000800,
    noNewDevices: 0x00001000,
    admin: 0xFFFFFFFF
});
