// meshcentral-data/plugins/privacy_screen/modules_meshcore/privacy_screen.js

try {
    if (typeof _plugin_privacy_screen === 'undefined') {
        _plugin_privacy_screen = true;

        // Беремо об'єкт агента
        var mesh = require('MeshAgent');

        // Простий логер у Console агента
        function dbg(msg) {
            try {
                if (typeof msg === 'object') { msg = JSON.stringify(msg); }
                require('MeshAgent').SendCommand({
                    action: 'msg',
                    type: 'console',
                    value: msg,
                    sessionid: null
                });
            } catch (e) { }
        }

        dbg('privacy_screen: meshcore module loaded');

        function enablePrivacy() {
            dbg('privacy_screen: ENABLE');
            // TODO: тут виклик твого exe "on"
            /*
            try {
                var child = require('child_process').execFile(
                    'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                    ['on'],
                    { type: 0 }
                );
                child.waitExit();
            } catch (ex) {
                dbg('privacy_screen error (enable): ' + ex);
            }
            */
        }

        function disablePrivacy() {
            dbg('privacy_screen: DISABLE');
            // TODO: тут виклик твого exe "off"
            /*
            try {
                var child = require('child_process').execFile(
                    'C:\\Program Files\\PrivacyScreen\\privacy-screen.exe',
                    ['off'],
                    { type: 0 }
                );
                child.waitExit();
            } catch (ex) {
                dbg('privacy_screen error (disable): ' + ex);
            }
            */
        }

        // Наш хендлер на всі server → agent повідомлення
        function privacyScreenCommandHandler(data) {
            try {
                // Сервер шле: { action:'msg', type:'privacyscreen', state, on }
                if (!data || data.action !== 'msg' || data.type !== 'privacyscreen') return;

                var on = (data.state === 1 || data.on === true);
                if (on) {
                    enablePrivacy();
                } else {
                    disablePrivacy();
                }
            } catch (e) {
                dbg('privacy_screen handler error: ' + e);
            }
        }

        // Реєструємо наш handler у MeshAgent
        if (mesh && typeof mesh.AddCommandHandler === 'function') {
            mesh.AddCommandHandler(privacyScreenCommandHandler);
            dbg('privacy_screen: command handler registered');
        } else {
            dbg('privacy_screen: mesh.AddCommandHandler NOT available');
        }
    }
} catch (ex) {
    try {
        require('MeshAgent').SendCommand({
            action: 'msg',
            type: 'console',
            value: 'privacy_screen init error: ' + ex,
            sessionid: null
        });
    } catch (_) { }
}
