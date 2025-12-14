// meshcentral-data/plugins/privacy_screen/modules_meshcore/privacy_screen.js

module.exports.consoleaction = function (args, rights, sessionid, mesh) {
    // args._ = ["privacy_screen", "on"|"off"|"toggle"?]
    try {
        sendConsoleText(
            'privacy_screen: consoleaction called, args._ = ' + JSON.stringify(args && args._),
            sessionid
        );
    } catch (e) { }

    function enablePrivacy() {
        try { sendConsoleText('privacy_screen: ENABLE', sessionid); } catch (e) { }
        // TODO: тут виклик "privacy-screen.exe on"
        /*
        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['on'],
                { type: 0 }
            );
            child.waitExit();
        } catch (ex) {
            try { sendConsoleText('privacy_screen error (enable): ' + ex, sessionid); } catch (_) {}
        }
        */
    }

    function disablePrivacy() {
        try { sendConsoleText('privacy_screen: DISABLE', sessionid); } catch (e) { }
        // TODO: тут виклик "privacy-screen.exe off"
        /*
        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['off'],
                { type: 0 }
            );
            child.waitExit();
        } catch (ex) {
            try { sendConsoleText('privacy_screen error (disable): ' + ex, sessionid); } catch (_) {}
        }
        */
    }

    var mode = 'toggle';
    if (args && args._ && args._.length > 1) {
        mode = String(args._[1]).toLowerCase();
    }

    if (mode === 'on') {
        enablePrivacy();
    } else if (mode === 'off') {
        disablePrivacy();
    } else if (mode === 'toggle') {
        // простий toggle на стороні агента
        mesh.privacy_screen_on = !mesh.privacy_screen_on;
        if (mesh.privacy_screen_on) enablePrivacy(); else disablePrivacy();
    } else {
        try { sendConsoleText('privacy_screen: unknown mode "' + mode + '"', sessionid); } catch (e) { }
    }

    return 'OK';
};
