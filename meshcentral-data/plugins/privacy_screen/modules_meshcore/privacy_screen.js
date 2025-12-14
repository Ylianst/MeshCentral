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
        sendConsoleText('privacy_screen: ENABLE (calling exe)', sessionid);

        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['on'],
                { type: 0 }
            );
            // Можеш child.waitExit(); залишити закоментованим, щоб не блокувати агента
            // child.waitExit();
        } catch (ex) {
            sendConsoleText('privacy_screen error (enable): ' + ex, sessionid);
        }
    }

    function disablePrivacy() {
        sendConsoleText('privacy_screen: DISABLE (calling exe)', sessionid);

        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['off'],
                { type: 0 }
            );
            // child.waitExit();
        } catch (ex) {
            sendConsoleText('privacy_screen error (disable): ' + ex, sessionid);
        }
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
