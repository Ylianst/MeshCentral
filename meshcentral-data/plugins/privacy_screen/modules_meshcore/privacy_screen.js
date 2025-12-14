module.exports.consoleaction = function (args, rights, sessionid, mesh) {
    sendConsoleText('privacy_screen: consoleaction called, args._ = ' + JSON.stringify(args && args._), sessionid);
    return 'OK';
};
