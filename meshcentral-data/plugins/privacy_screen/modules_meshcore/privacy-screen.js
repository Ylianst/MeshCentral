if (typeof _plugin_privacy_screen == 'undefined') {
    _plugin_privacy_screen = true;

    // Тест: повідомлення в Console агента
    try {
        sendConsoleText('Privacy Screen meshcore loaded on ' + process.platform + '\n');
    } catch (e) {
        // на всякий випадок, щоб не вбити агент
    }

    function handleServerCommand(msg) {
        if (!msg || msg.type !== 'privacyscreen') return;

        if (msg.state == 1) {
            enablePrivacy();
        } else {
            disablePrivacy();
        }
    }

    // TODO: тут треба реально підчепити handleServerCommand до dispatcher-а meshcore
}
