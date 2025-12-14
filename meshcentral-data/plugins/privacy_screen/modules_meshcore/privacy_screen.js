if (typeof _plugin_privacy_screen === 'undefined') {
    _plugin_privacy_screen = true;

    sendConsoleText('privacy_screen: meshcore module loaded', null);

    function enablePrivacy() {
        sendConsoleText('privacy_screen: ENABLE', null);
    }

    function disablePrivacy() {
        sendConsoleText('privacy_screen: DISABLE', null);
    }

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
            sendConsoleText('privacy_screen handler error: ' + e, null);
        }
    }

    try {
        if (typeof mesh !== 'undefined' && typeof mesh.AddCommandHandler === 'function') {
            mesh.AddCommandHandler(privacyScreenCommandHandler);
            sendConsoleText('privacy_screen: command handler registered', null);
        } else {
            sendConsoleText('privacy_screen: mesh.AddCommandHandler NOT available', null);
        }
    } catch (e) {
        sendConsoleText('privacy_screen: failed to register handler: ' + e, null);
    }
}
