/**
* @description MeshCentral web server data sanitization helpers
* @license Apache-2.0
*/

"use strict";

// Clone a safe version of a user object, removing secrets and reducing
// authentication configuration to feature-presence indicators.
module.exports.cloneSafeUser = function (user) {
    if (typeof user != 'object') { return user; }
    var user2 = Object.assign({}, user); // Shallow clone
    delete user2.hash;
    delete user2.passhint;
    delete user2.salt;
    delete user2.type;
    delete user2.domain;
    delete user2.subscriptions;
    delete user2.passtype;
    delete user2.otpsms;
    delete user2.otpmsg;
    if ((typeof user2.otpekey == 'object') && (user2.otpekey != null)) { user2.otpekey = 1; } // Indicates that email 2FA is enabled.
    if ((typeof user2.otpduo == 'object') && (user2.otpduo != null)) { user2.otpduo = 1; } // Indicates that duo 2FA is enabled.
    if ((typeof user2.otpsecret == 'string') && (user2.otpsecret != null)) { user2.otpsecret = 1; } // Indicates a time secret is present.
    if ((typeof user2.otpkeys == 'object') && (user2.otpkeys != null)) { user2.otpkeys = 0; if (user.otpkeys != null) { for (var i = 0; i < user.otpkeys.keys.length; i++) { if (user.otpkeys.keys[i].u == true) { user2.otpkeys = 1; } } } } // Indicates whether one time backup codes are active.
    if ((typeof user2.otphkeys == 'object') && (user2.otphkeys != null)) { user2.otphkeys = user2.otphkeys.length; } // Indicates the number of hardware keys setup
    if ((typeof user2.otpdev == 'string') && (user2.otpdev != null)) { user2.otpdev = 1; } // Indicates device for 2FA push notification
    if ((typeof user2.webpush == 'object') && (user2.webpush != null)) { user2.webpush = user2.webpush.length; } // Indicates the number of web push sessions we have
    return user2;
};

// Clone a safe version of a node object, removing stored credentials.
module.exports.cloneSafeNode = function (node) {
    if (typeof node != 'object') { return node; }
    var r = node;
    if ((r.pmt != null) || (r.ssh != null) || (r.rdp != null) || ((r.intelamt != null) && ((r.intelamt.pass != null) || (r.intelamt.mpspass != null)))) {
        r = Object.assign({}, r); // Shallow clone
        if (r.pmt != null) { r.pmt = 1; }
        if (r.ssh != null) {
            var n = {};
            for (var i in r.ssh) {
                if (i.startsWith('user/')) {
                    if (r.ssh[i].p) { n[i] = 1; } // Username and password
                    else if (r.ssh[i].k && r.ssh[i].kp) { n[i] = 2; } // Username, key and password
                    else if (r.ssh[i].k) { n[i] = 3; } // Username and key. No password.
                }
            }
            r.ssh = n;
        }
        if (r.rdp != null) { var n = {}; for (var i in r.rdp) { if (i.startsWith('user/')) { n[i] = 1; } } r.rdp = n; }
        if ((r.intelamt != null) && ((r.intelamt.pass != null) || (r.intelamt.mpspass != null))) {
            r.intelamt = Object.assign({}, r.intelamt); // Shallow clone
            if (r.intelamt.pass != null) { r.intelamt.pass = 1; } // Remove the Intel AMT administrator password from the node
            if (r.intelamt.mpspass != null) { r.intelamt.mpspass = 1; } // Remove the Intel AMT MPS password from the node
        }
    }
    return r;
};

// Clone a safe version of a mesh object, removing policy credentials.
module.exports.cloneSafeMesh = function (mesh) {
    if (typeof mesh != 'object') { return mesh; }
    var r = mesh;
    if (((r.amt != null) && (r.amt.password != null)) || ((r.kvm != null) && (r.kvm.pass != null))) {
        r = Object.assign({}, r); // Shallow clone
        if ((r.amt != null) && (r.amt.password != null)) {
            r.amt = Object.assign({}, r.amt); // Shallow clone
            if ((r.amt.password != null) && (r.amt.password != '')) { r.amt.password = 1; } // Remove the Intel AMT password from the policy
        }
        if ((r.kvm != null) && (r.kvm.pass != null)) {
            r.kvm = Object.assign({}, r.kvm); // Shallow clone
            if ((r.kvm.pass != null) && (r.kvm.pass != '')) { r.kvm.pass = 1; } // Remove the IP KVM device password
        }
    }
    return r;
};

const acceptableUserWebStateStrings = ['webPageStackMenu', 'notifications', 'deviceView', 'nightMode', 'webPageFullScreen', 'search', 'showRealNames', 'sort', 'deskAspectRatio', 'viewsize', 'DeskControl', 'uiMode', 'footerBar', 'loctag', 'theme', 'lastThemes', 'uiViewMode'];
const acceptableUserWebStateDesktopStrings = [
    'encoding', 'showfocus', 'showmouse', 'quality', 'scaling', 'framerate', 'agentencoding', 'swapmouse',
    'rmw', 'remotekeymap', 'autoclipboard', 'autolock', 'localkeymap', 'kvmrmw', 'rdpsize', 'rdpsmb',
    'rdprmw', 'rdpautoclipboard', 'rdpflags'
];

// Keep only the supported, size-bounded browser preferences.
module.exports.filterUserWebState = function (state) {
    if (typeof state == 'string') { try { state = JSON.parse(state); } catch (ex) { return null; } }
    if ((state == null) || (typeof state != 'object')) { return null; }
    var out = {};
    for (var i in acceptableUserWebStateStrings) {
        var n = acceptableUserWebStateStrings[i];
        if ((state[n] != null) && ((typeof state[n] == 'number') || (typeof state[n] == 'boolean') || ((typeof state[n] == 'string') && (state[n].length < 64)))) { out[n] = state[n]; }
    }
    if ((typeof state.stars == 'string') && (state.stars.length < 2048)) { out.stars = state.stars; }
    if (typeof state.desktopsettings == 'string') { try { state.desktopsettings = JSON.parse(state.desktopsettings); } catch (ex) { delete state.desktopsettings; } }
    if (state.desktopsettings != null) {
        out.desktopsettings = {};
        for (var i in acceptableUserWebStateDesktopStrings) {
            var n = acceptableUserWebStateDesktopStrings[i];
            if ((state.desktopsettings[n] != null) && ((typeof state.desktopsettings[n] == 'number') || (typeof state.desktopsettings[n] == 'boolean') || ((typeof state.desktopsettings[n] == 'string') && (state.desktopsettings[n].length < 32)))) { out.desktopsettings[n] = state.desktopsettings[n]; }
        }
        out.desktopsettings = JSON.stringify(out.desktopsettings);
    }
    if ((typeof state.deskKeyShortcuts == 'string') && (state.deskKeyShortcuts.length < 2048)) { out.deskKeyShortcuts = state.deskKeyShortcuts; }
    if ((typeof state.deskStrings == 'string') && (state.deskStrings.length < 10000)) { out.deskStrings = state.deskStrings; }
    if ((typeof state.runopt == 'string') && (state.runopt.length < 30000)) { out.runopt = state.runopt; }
    return JSON.stringify(out);
};
