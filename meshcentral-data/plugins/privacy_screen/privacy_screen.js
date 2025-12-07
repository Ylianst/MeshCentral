module.exports = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent;

    obj.exports = ['sendPrivacyCommand'];

    obj.server_startup = function () {
        console.log('=== Privacy Screen plugin: server_startup ===');
    };

    obj.sendPrivacyCommand = function (args, rights, session, user) {
        if (!args || !args.nodeid) return;

        var nodeid = args.nodeid;
        var state = args.on ? 1 : 0;

        parent.sendAgentCommand(nodeid, { type: 'privacyscreen', state: state });
    };

    obj.hook_processAgentData = function (node, info, data) {
        if (data && data._plugin == 'privacy_screen') {
            console.log('Privacy Screen plugin got data from agent:', node._id);
        }
    };

    return obj;
};
