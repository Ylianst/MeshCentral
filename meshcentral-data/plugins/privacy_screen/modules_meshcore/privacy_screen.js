// meshcentral-data/plugins/privacy_screen/modules_meshcore/privacy_screen.js

if (typeof _plugin_privacy_screen === 'undefined') {
    _plugin_privacy_screen = true;

    try { sendConsoleText('privacy_screen meshcore module loaded\n'); } catch (e) { }

    function enablePrivacy() {
        // TODO: реальний код гасіння локального екрану
        // наприклад: запустити privacy-screen.exe on
        try { sendConsoleText('Privacy screen ENABLED\n'); } catch (e) { }

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
        // TODO: реальний код повернення екрану
        // наприклад: privacy-screen.exe off
        try { sendConsoleText('Privacy screen DISABLED\n'); } catch (e) { }

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

    // handler for server commands
    function privacyScreenCommandHandler(data) {
        try {
            // Нас цікавлять лише наші пакети
            if (!data || data.type !== 'privacyscreen') return;

            // state: 1 = on, 0 = off
            var on = (data.state === 1 || data.on === true);

            if (on) {
                enablePrivacy();
            } else {
                disablePrivacy();
            }
        } catch (e) {
            try { sendConsoleText('privacy_screen handler error: ' + e + '\n'); } catch (_) { }
        }
    }

    // Register our handler in MeshAgent
    try {
        // В meshcore.js вже є global `mesh = require("MeshAgent")`
        // та використовується mesh.AddCommandHandler(handleServerCommand)
        // — ми просто додаємо ще один handler.
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
