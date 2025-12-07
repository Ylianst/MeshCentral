// meshcentral-data/plugins/privacy_screen/modules_meshcore/privacy_screen.js
if (typeof _plugin_privacy_screen === 'undefined') {
    _plugin_privacy_screen = true;

    try { sendConsoleText('privacy_screen: meshcore module loaded\n'); } catch (e) { }

    function enablePrivacy() {
        try { sendConsoleText('privacy_screen: ENABLE\n'); } catch (e) { }

        // TODO: виклик твого exe, наприклад:
        /*
        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['on'],
                { type: 0 }
            );
            child.waitExit();
        } catch (ex) {
            try { sendConsoleText('privacy_screen error (enable): ' + ex + '\n'); } catch (_) {}
        }
        */
    }

    function disablePrivacy() {
        try { sendConsoleText('privacy_screen: DISABLE\n'); } catch (e) { }

        // TODO: виклик exe 'off'
        /*
        try {
            var child = require('child_process').execFile(
                'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                ['off'],
                { type: 0 }
            );
            child.waitExit();
        } catch (ex) {
            try { sendConsoleText('privacy_screen error (disable): ' + ex + '\n'); } catch (_) {}
        }
        */
    }

    function privacyScreenCommandHandler(data) {
        try {
            // Ми шлемо { action:'msg', type:'privacyscreen', state, on }
            if (!data || data.action !== 'msg' || data.type !== 'privacyscreen') return;

            var on = (data.state === 1 || data.on === true);
            if (on) enablePrivacy();
            else disablePrivacy();
        } catch (e) {
            try { sendConsoleText('privacy_screen handler error: ' + e + '\n'); } catch (_) {}
        }
    }

    try {
        if (typeof mesh !== 'undefined' && typeof mesh.AddCommandHandler === 'function') {
            mesh.AddCommandHandler(privacyScreenCommandHandler);
            try { sendConsoleText('privacy_screen: command handler registered\n'); } catch (e) { }
        } else {
            try { sendConsoleText('privacy_screen: mesh.AddCommandHandler NOT available\n'); } catch (e) { }
        }
    } catch (e) {
        try { sendConsoleText('privacy_screen: failed to register handler: ' + e + '\n'); } catch (_) { }
    }
}
