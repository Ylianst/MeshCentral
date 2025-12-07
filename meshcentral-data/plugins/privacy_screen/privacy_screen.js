// meshcentral-data/plugins/privacy_screen/privacy_screen.js

module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent;

    // Експорти, які підуть у браузер (pluginHandler.privacy_screen.*)
    obj.exports = [];

    // Лог при старті сервера — чисто для перевірки
    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    return obj;
};
