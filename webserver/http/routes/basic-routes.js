/**
* @description Registration of basic HTTP and WebSocket routes shared by path-based domains
* @license Apache-2.0
*/

'use strict';

module.exports.createBasicRoutes = function (options) {
    const state = options.state;
    const handlers = options.handlers;
    const urlencoded = options.urlencoded;

    function post(path, handler) { state.app.post(path, urlencoded({ extended: false }), handler); }

    function register(domain) {
        const url = domain.url;
        if (typeof domain.rootredirect == 'string') {
            state.app.get(url, handlers.rootRedirect);
        } else {
            state.app.get(url, handlers.rootRequest);
            post(url, handlers.rootPostRequest);
        }
        state.app.get(url + 'refresh.ashx', handlers.refresh);
        if ((domain.myserver !== false) && ((domain.myserver == null) || (domain.myserver.backup === true))) state.app.get(url + 'backup.zip', handlers.backupRequest);
        if ((domain.myserver !== false) && ((domain.myserver == null) || (domain.myserver.restore === true))) post(url + 'restoreserver.ashx', handlers.restoreRequest);

        state.app.get(url + 'terms', handlers.termsRequest);
        state.app.get(url + 'xterm', handlers.xtermRequest);
        state.app.get(url + 'login', handlers.rootRequest);
        post(url + 'login', handlers.rootPostRequest);
        post(url + 'tokenlogin', handlers.loginRequest);
        state.app.get(url + 'logout', handlers.logoutRequest);
        state.app.get(url + 'MeshServerRootCert.cer', handlers.rootCertRequest);
        state.app.get(url + 'manifest.json', handlers.manifestRequest);
        post(url + 'changepassword', handlers.passwordChangeRequest);
        post(url + 'deleteaccount', handlers.deleteAccountRequest);
        post(url + 'createaccount', handlers.createAccountRequest);
        post(url + 'resetpassword', handlers.resetPasswordRequest);
        post(url + 'resetaccount', handlers.resetAccountRequest);
        state.app.get(url + 'checkmail', handlers.checkMailRequest);
        state.app.get(url + 'agentinvite', handlers.agentInviteRequest);
        state.app.get(url + 'userimage.ashx', handlers.userImageRequest);
        post(url + 'amtevents.ashx', handlers.amtEventRequest);
        state.app.get(url + 'meshagents', handlers.meshAgentRequest);
        state.app.get(url + 'messenger', handlers.messengerRequest);
        state.app.get(url + 'messenger.png', handlers.messengerImageRequest);
        state.app.get(url + 'meshosxagent', handlers.meshOsxAgentRequest);
        state.app.get(url + 'meshsettings', handlers.meshSettingsRequest);
        state.app.get(url + 'devicepowerevents.ashx', handlers.devicePowerEvents);
        state.app.get(url + 'downloadfile.ashx', handlers.downloadFile);
        state.app.get(url + 'commander.ashx', handlers.meshCommander);
        post(url + 'uploadfile.ashx', handlers.uploadFile);
        post(url + 'uploadfilebatch.ashx', handlers.uploadFileBatch);
        state.app.post(url + 'customiconupload.ashx', handlers.customIconUpload);
        post(url + 'customicondelete.ashx', handlers.customIconDelete);
        state.app.get(url + 'icons/custom/*', handlers.customIconDownload);
        post(url + 'uploadmeshcorefile.ashx', handlers.uploadMeshCoreFile);
        post(url + 'oneclickrecovery.ashx', handlers.oneClickRecoveryFile);
        state.app.get(url + 'userfiles/*', handlers.downloadUserFiles);
        state.app.ws(url + 'echo.ashx', handlers.echoWebSocket);
        state.app.ws(url + '2fahold.ashx', handlers.twoFactorHoldWebSocket);
        state.app.ws(url + 'apf.ashx', handlers.apfWebSocket);
        state.app.get(url + 'webrelay.ashx', handlers.websocketExpected);
        state.app.get(url + 'health.ashx', handlers.health);
    }

    return { register: register };
};
