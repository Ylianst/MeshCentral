/**
* @description Registration of downloadable resources and optional domain HTTP routes
* @license Apache-2.0
*/

'use strict';

module.exports.createResourceRoutes = function (options) {
    const state = options.state;
    const handlers = options.handlers;
    const urlencoded = options.urlencoded;
    const hasPlugins = options.hasPlugins;
    const hasCrowdSec = options.hasCrowdSec;

    function post(path, handler) { state.app.post(path, urlencoded({ extended: false }), handler); }

    function register(domain) {
        const url = domain.url;
        state.app.get(url + 'devicefile.ashx', handlers.deviceFile);
        state.app.get(url + 'agentdownload.ashx', handlers.agentDownloadFile);
        state.app.get(url + 'logo.png', handlers.logoRequest);
        state.app.get(url + 'loginlogo.png', handlers.loginLogoRequest);
        state.app.get(url + 'pwalogo.png', handlers.pwaLogoRequest);
        post(url + 'translations', handlers.translationsRequest);
        state.app.get(url + 'welcome.jpg', handlers.welcomeImageRequest);
        state.app.get(url + 'welcome.png', handlers.welcomeImageRequest);
        state.app.get(url + 'recordings.ashx', handlers.getRecordings);
        state.app.ws(url + 'recordings.ashx', handlers.getRecordingsWebSocket);
        state.app.get(url + 'player.htm', handlers.playerRequest);
        state.app.get(url + 'player', handlers.playerRequest);
        state.app.get(url + 'sharing', handlers.sharingRequest);
        state.app.ws(url + 'agenttransfer.ashx', handlers.agentFileTransfer);
        state.app.get(url + 'invite', handlers.inviteRequest);
        post(url + 'invite', handlers.inviteRequest);

        if (hasPlugins) {
            state.app.get(url + 'pluginadmin.ashx', handlers.pluginAdminRequest);
            post(url + 'pluginadmin.ashx', handlers.pluginAdminPostRequest);
            state.app.get(url + 'pluginHandler.js', handlers.pluginScript);
        }
        if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
            state.app.get(url + 'newAccountCaptcha.ashx', handlers.newAccountCaptchaRequest);
        }
        if (hasCrowdSec) {
            state.app.get(url + 'captcha.ashx', handlers.captchaGetRequest);
            post(url + 'captcha.ashx', handlers.captchaPostRequest);
        }
    }

    return { register: register };
};
