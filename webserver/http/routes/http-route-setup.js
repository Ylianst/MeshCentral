/**
* @description HTTP route family construction and setup
* @license Apache-2.0
*/

'use strict';

const defaultModules = {
    basicRoutes: require('./basic-routes.js'),
    resourceRoutes: require('./resource-routes.js'),
    applicationRoutes: require('./application-routes.js'),
    relayRoutes: require('./relay-routes.js'),
    passportRoutes: require('./passport-routes.js'),
    duoRoutes: require('./duo-routes.js'),
    agentRoutes: require('./agent-routes.js'),
    domainStatic: require('./domain-static.js'),
    routeFinalization: require('./http-route-finalization.js')
};

module.exports.createHttpRouteSetup = function (options) {
    const modules = options.modules || defaultModules;
    const state = options.state;
    const parent = options.parent;
    const handlers = options.handlers;

    return function setupHttpRoutes() {
        const basicRoutes = modules.basicRoutes.createBasicRoutes({
            state: state,
            urlencoded: state.bodyParser.urlencoded,
            handlers: {
                rootRedirect: handlers.rootRedirect, rootRequest: handlers.rootRequest, rootPostRequest: handlers.rootPostRequest,
                refresh: handlers.refresh, backupRequest: handlers.backupRequest, restoreRequest: handlers.restoreRequest, termsRequest: handlers.termsRequest,
                xtermRequest: handlers.xtermRequest, loginRequest: handlers.loginRequest, logoutRequest: handlers.logoutRequest, rootCertRequest: handlers.rootCertRequest,
                manifestRequest: handlers.manifestRequest, passwordChangeRequest: handlers.passwordChangeRequest, deleteAccountRequest: handlers.deleteAccountRequest,
                createAccountRequest: handlers.createAccountRequest, resetPasswordRequest: handlers.resetPasswordRequest, resetAccountRequest: handlers.resetAccountRequest,
                checkMailRequest: handlers.checkMailRequest, agentInviteRequest: handlers.agentInviteRequest, userImageRequest: handlers.userImageRequest,
                amtEventRequest: handlers.amtEventRequest, meshAgentRequest: handlers.meshAgentRequest, messengerRequest: handlers.messengerRequest,
                messengerImageRequest: handlers.messengerImageRequest, meshOsxAgentRequest: handlers.meshOsxAgentRequest, meshSettingsRequest: handlers.meshSettingsRequest,
                devicePowerEvents: handlers.devicePowerEvents, downloadFile: handlers.downloadFile, meshCommander: handlers.meshCommander, uploadFile: handlers.uploadFile,
                uploadFileBatch: handlers.uploadFileBatch, customIconUpload: handlers.customIconUpload, customIconDelete: handlers.customIconDelete,
                customIconDownload: handlers.customIconDownload, uploadMeshCoreFile: handlers.uploadMeshCoreFile, oneClickRecoveryFile: handlers.oneClickRecoveryFile,
                downloadUserFiles: handlers.downloadUserFiles, echoWebSocket: handlers.echoWebSocket, twoFactorHoldWebSocket: handlers.twoFactorHoldWebSocket,
                apfWebSocket: handlers.apfWebSocket, websocketExpected: handlers.websocketExpected, health: handlers.health
            }
        });
        const resourceRoutes = modules.resourceRoutes.createResourceRoutes({
            state: state, urlencoded: state.bodyParser.urlencoded, hasPlugins: parent.pluginHandler != null, hasCrowdSec: parent.crowdSecBounser != null,
            handlers: {
                deviceFile: handlers.deviceFile, agentDownloadFile: handlers.agentDownloadFile, logoRequest: handlers.logoRequest, loginLogoRequest: handlers.loginLogoRequest,
                pwaLogoRequest: handlers.pwaLogoRequest, translationsRequest: handlers.translationsRequest, welcomeImageRequest: handlers.welcomeImageRequest,
                getRecordings: handlers.getRecordings, getRecordingsWebSocket: handlers.getRecordingsWebSocket, playerRequest: handlers.playerRequest,
                sharingRequest: handlers.sharingRequest, agentFileTransfer: handlers.agentFileTransfer, inviteRequest: handlers.inviteRequest,
                pluginAdminRequest: state.handlePluginAdminReq, pluginAdminPostRequest: state.handlePluginAdminPostReq, pluginScript: state.handlePluginJS,
                newAccountCaptchaRequest: handlers.newAccountCaptchaRequest, captchaGetRequest: handlers.captchaGetRequest, captchaPostRequest: handlers.captchaPostRequest
            }
        });
        const applicationRoutes = modules.applicationRoutes.createApplicationRoutes({
            state: state, parent: parent, getDomain: options.getDomain, authorizeWebSocket: options.authorizeWebSocket, urlencoded: state.bodyParser.urlencoded,
            handlers: { mstscRequest: handlers.mstscRequest, firebasePushOnlyRelayRequest: handlers.firebasePushOnlyRelayRequest, firebaseRelayRequest: handlers.firebaseRelayRequest }
        });
        const relayRoutes = modules.relayRoutes.createRelayRoutes({
            state: state, parent: parent, getDomain: options.getDomain, getWebSocketArgs: options.getWebSocketArgs,
            authorizeWebSocket: options.authorizeWebSocket, authorizeInnerWebSocket: options.authorizeInnerWebSocket, relayWebSocket: options.relayWebSocket
        });
        const passportRoutes = modules.passportRoutes.createPassportRoutes({
            state: state, parent: parent, flags: options.authStrategyFlags, getDomain: options.getDomain, strategyLogin: options.strategyLogin, urlencoded: state.bodyParser.urlencoded
        });
        const duoRoutes = modules.duoRoutes.createDuoRoutes({ state: state, parent: parent, getDomain: options.getDomain, getQueryPortion: options.getQueryPortion, setSessionRandom: options.setSessionRandom });
        const agentRoutes = modules.agentRoutes.createAgentRoutes({
            state: state, parent: parent, checkAgentIpAddress: options.checkAgentIpAddress, authorizeWebSocket: options.authorizeWebSocket, createSerialTunnel: options.createSerialTunnel,
            handlers: { agentFileTransfer: handlers.agentFileTransfer, meshAgentRequest: handlers.meshAgentRequest, agentDownloadFile: handlers.agentDownloadFile }
        });
        const domainStatic = modules.domainStatic.createDomainStatic({ state: state, parent: parent, getDomain: options.getDomain });
        modules.routeFinalization.finalizeHttpRoutes({
            state: state, parent: parent, webRelay: options.webRelay,
            routeGroups: [basicRoutes, relayRoutes, resourceRoutes, applicationRoutes, passportRoutes, duoRoutes, options.domainAssets, agentRoutes, domainStatic],
            domainStatic: domainStatic
        });
    };
};
