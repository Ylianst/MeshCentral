/**
* @description Shared web-page option encoding
* @license Apache-2.0
*/

'use strict';

module.exports.getAmtScanOptions = function (domain, validateStringArray) {
    if (typeof domain.amtscanoptions == 'string') { return encodeURIComponent(domain.amtscanoptions); }
    if (validateStringArray(domain.amtscanoptions)) {
        domain.amtscanoptions = domain.amtscanoptions.join(',');
        return encodeURIComponent(domain.amtscanoptions);
    }
    return '';
};

module.exports.encodeCustomUi = function (domain) {
    return (domain.customui == null) ? '' : encodeURIComponent(JSON.stringify(domain.customui));
};

module.exports.encodeCustomFiles = function (domain) {
    if (domain.customFiles != null) { return encodeURIComponent(JSON.stringify(domain.customFiles)); }
    if (domain.customfiles != null) { return encodeURIComponent(JSON.stringify(domain.customfiles)); }
    return '';
};

module.exports.getWebRtcConfig = function (settings, args) {
    var configuration = null;
    if (settings && settings.webrtcconfig && (typeof settings.webrtcconfig == 'object')) { configuration = settings.webrtcconfig; }
    else if (args.webrtcconfig && (typeof args.webrtcconfig == 'object')) { configuration = args.webrtcconfig; }
    return (configuration == null) ? null : encodeURIComponent(JSON.stringify(configuration)).replace(/'/g, '%27');
};
