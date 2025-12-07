module.exports.privacy_screen = function (parent) {
    var obj = {};
    obj.parent = parent;

    obj.exports = ['sendPrivacyCommand'];

    obj.sendPrivacyCommand = function (args, rights, session, user) {
        if (!args || !args.nodeid) return;
        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        console.log('privacy_screen.sendPrivacyCommand', nodeid, state);

        parent.sendAgentCommand(nodeid, { type: 'privacyscreen', state: state });
    };

    obj.server_startup = function () {
        console.log('privacy_screen plugin: server_startup');
    };

    return obj;
};
