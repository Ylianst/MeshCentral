/**
* @description Browser and operating-system detection for web requests
* @license Apache-2.0
*/

'use strict';

module.exports.createUserAgent = function (options) {
    const parse = options.parse;
    const ClientHints = options.ClientHints;

    function getUserAgentInfo(req) {
        try {
            const info = parse((typeof req == 'string') ? req : req.headers['user-agent']);
            if (typeof req != 'string') {
                const hints = new ClientHints().setValuesFromHeaders(req.headers);
                Object.assign(info, hints);
            }
            if (info.browser && info.browser.name) { info.browserStr = info.browser.name; if (info.browser.version) info.browserStr += '/' + info.browser.version; }
            if (info.os && info.os.name) { info.osStr = info.os.name; if (info.os.version) info.osStr += '/' + info.os.version; }
            if (info.platform) {
                info.osStr = info.platform;
                if (info.platformVersion) {
                    if ((info.platform == 'Windows') && (parseInt(info.platformVersion) >= 13)) info.platformVersion = '11';
                    info.osStr += '/' + info.platformVersion;
                }
            }
            return info;
        } catch (ex) { return { browserStr: 'Unknown', osStr: 'Unknown' }; }
    }

    return { getUserAgentInfo: getUserAgentInfo };
};
