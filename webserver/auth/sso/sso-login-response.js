/**
* @description Final browser response after an SSO login attempt
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoLoginResponse = function (options) {
    const getWebServerName = options.getWebServerName;
    const safeDecodeURIComponent = options.safeDecodeURIComponent;

    return function sendSsoLoginResponse(req, res, domain) {
        res.set('Content-Type', 'text/html');
        let url = domain.url;
        if (Object.keys(req.query).length > 0) { url += '?' + Object.keys(req.query).map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(req.query[key]); }).join('&'); }

        if (req.body && req.body.RelayState !== undefined) {
            var relayState = safeDecodeURIComponent(req.body.RelayState);
            var serverName = getWebServerName(domain, req).replaceAll('.', '\\.');
            var regexstr = `(?<=https:\\/\\/(?:.+?\\.)?${serverName}\\/?)` +
                `.*((?<=([\\?&])gotodevicename=(.{64})|` +
                `gotonode=(.{64})|` +
                `gotodeviceip=(((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4})|` +
                `gotodeviceip=(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:)` +
                `lang=(.{5})|` +
                `sitestyle=(\\d+)|` +
                `user=(.{64})|` +
                `pass=(.{256})|` +
                `key=|` +
                `locale=|` +
                `gotomesh=(.{64})|` +
                `gotouser=(.{0,64})|` +
                `gotougrp=(.{64})|` +
                `debug=|` +
                `filter=|` +
                `webrtc=|` +
                `hide=|` +
                `viewmode=(\\d+)(?=[\\&]|\\b)))`;
            var regex = new RegExp(regexstr);
            if ((relayState != null) && regex.test(relayState)) { url = relayState; }
        }

        res.end('<html><head><meta http-equiv="refresh" content=0;url="' + url + '"></head><body></body></html>');
    };
};
