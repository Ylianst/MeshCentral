/**
* @description MeshCentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint -W097 */
/*jshint esversion: 6 */
'use strict';

const baseStateModule = require('./webserver/bootstrap/base-state.js');

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Polyfill startsWith/endsWith for older NodeJS
if (!String.prototype.startsWith) { String.prototype.startsWith = function (searchString, position) { position = position || 0; return this.substr(position, searchString.length) === searchString; }; }
if (!String.prototype.endsWith) { String.prototype.endsWith = function (searchString, position) { var subjectString = this.toString(); if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; } position -= searchString.length; var lastIndex = subjectString.lastIndexOf(searchString, position); return lastIndex !== -1 && lastIndex === position; }; }

// Construct a HTTP server object
module.exports.CreateWebServer = function (parent, db, args, certificates, doneFunc) {
    var obj = baseStateModule.createBaseState(parent, db, args, certificates, require, process.env), i = 0;

    // Modules
    const sanitization = require('./webserver/shared/sanitization.js');
    const authorizationModule = require('./webserver/shared/authorization.js');
    const renderingModule = require('./webserver/ui/rendering.js');
    const throttlingModule = require('./webserver/http/middleware/throttling.js');
    const requestUtilsModule = require('./webserver/shared/request-utils.js');
    const networkAccessModule = require('./webserver/http/middleware/network-access.js');
    const customIconsModule = require('./webserver/ui/custom-icons.js');
    const storageModule = require('./webserver/files/storage.js');
    const sessionsModule = require('./webserver/auth/login/sessions.js');
    const externalGroupsModule = require('./webserver/domains/external-groups.js');
    const serverIdentityModule = require('./webserver/bootstrap/server-identity.js');
    const sessionCountsModule = require('./webserver/services/session-counts.js');
    const agentRoutingModule = require('./webserver/agents/agent-routing.js');
    const pushNotificationsModule = require('./webserver/realtime/push-notifications.js');
    const userAgentModule = require('./webserver/shared/user-agent.js');
    const serverLifecycleModule = require('./webserver/bootstrap/server-lifecycle.js');
    const agentControlModule = require('./webserver/agents/agent-control.js');
    const agentInvitationsModule = require('./webserver/agents/agent-invitations.js');
    const accountManagementModule = require('./webserver/auth/account/account-management.js');
    const remotePagesModule = require('./webserver/ui/remote-pages.js');
    const serverBackupsModule = require('./webserver/bootstrap/server-backups.js');
    const agentFileTransferModule = require('./webserver/agents/agent-file-transfer.js');
    const subscriptionsModule = require('./webserver/realtime/subscriptions.js');
    const tlsConfigurationModule = require('./webserver/bootstrap/tls-configuration.js');
    const coreMiddlewareModule = require('./webserver/http/middleware/core-middleware.js');
    const securityHeadersModule = require('./webserver/http/middleware/security-headers.js');
    const requestContextModule = require('./webserver/http/middleware/request-context.js');
    const requestMiddlewareModule = require('./webserver/http/middleware/request-middleware.js');
    const domainStartupModule = require('./webserver/domains/domain-startup.js');
    const notFoundModule = require('./webserver/http/middleware/not-found.js');
    const httpRouteSetupModule = require('./webserver/http/routes/http-route-setup.js');
    const domainAssetsModule = require('./webserver/domains/domain-assets.js');
    const webRelayModule = require('./webserver/realtime/web-relay.js');
    const serverFinalizationModule = require('./webserver/bootstrap/server-finalization.js');
    const startupDataModule = require('./webserver/bootstrap/startup-data.js');
    const runtimeInitializationModule = require('./webserver/bootstrap/runtime-initialization.js');
    const rights = require('./webserver/shared/rights.js');
    const MESHRIGHT_REMOTECONTROL = rights.mesh.remoteControl;
    const MESHRIGHT_AGENTCONSOLE = rights.mesh.agentConsole;
    const SITERIGHT_NOMESHCMD = rights.site.noMeshCommand;
    const ssoStrategiesModule = require('./webserver/auth/sso/sso-strategies.js');
    const ssoLoginGroupsModule = require('./webserver/auth/sso/sso-login-groups.js');
    const ssoLoginResponseModule = require('./webserver/auth/sso/sso-login-response.js');
    const ssoAccountsModule = require('./webserver/auth/sso/sso-accounts.js');
    const ssoLoginModule = require('./webserver/auth/sso/sso-login.js');
    const sessionLogoutModule = require('./webserver/auth/login/session-logout.js');
    const rootRequestsModule = require('./webserver/ui/root-requests.js');
    const emailAccountUtils = require('./webserver/auth/account/email-account-utils.js');
    const emailAccountActionsModule = require('./webserver/auth/account/email-account-actions.js');
    const agentSettingsModule = require('./webserver/agents/agent-settings.js');
    const powerEventsModule = require('./webserver/agents/power-events.js');
    const pluginRequestsModule = require('./webserver/services/plugin-requests.js');
    const deviceCleanupModule = require('./webserver/agents/device-cleanup.js');
    const amtEventsModule = require('./webserver/agents/amt-events.js');
    const agentDownloadsModule = require('./webserver/agents/agent-downloads.js');
    const macosAgentDownloadModule = require('./webserver/agents/macos-agent-download.js');
    const certificateTrustModule = require('./webserver/agents/certificate-trust.js');
    const certificateHashesModule = require('./webserver/agents/certificate-hashes.js');
    const domainUserFeaturesModule = require('./webserver/domains/domain-user-features.js');
    const relayWebSocketModule = require('./webserver/realtime/relay-websocket.js');
    const telemetryModule = require('./webserver/services/telemetry.js');
    const serialTunnelModule = require('./webserver/realtime/serial-tunnel.js');
    const websocketAuthModule = require('./webserver/realtime/websocket-auth.js');
    const passwordAuthenticationModule = require('./webserver/auth/login/password-authentication.js');
    const loginCompletionModule = require('./webserver/auth/login/login-completion.js');
    const loginFailureModule = require('./webserver/auth/login/login-failure.js');
    const loginTwoFactorModule = require('./webserver/auth/login/login-two-factor.js');
    const loginRequestModule = require('./webserver/auth/login/login-request.js');
    const loginChallengeModule = require('./webserver/auth/login/login-challenge.js');
    const loginPageRenderModule = require('./webserver/auth/login/login-page-render.js');
    const automaticAuthenticationModule = require('./webserver/auth/login/automatic-authentication.js');
    const sspiAuthenticationModule = require('./webserver/auth/sso/sspi-authentication.js');
    const applicationEntryModule = require('./webserver/ui/application-entry.js');
    const applicationRenderModule = require('./webserver/ui/application-render.js');
    const passwordRequirementsModule = require('./webserver/auth/login/password-requirements.js');
    const passwordResetModule = require('./webserver/auth/account/password-reset.js');
    const accountRecoveryModule = require('./webserver/auth/account/account-recovery.js');
    const accountCreationReservationsModule = require('./webserver/auth/account/account-creation-reservations.js');
    const accountCreationModule = require('./webserver/auth/account/account-creation.js');
    const twoFactorAuthenticationModule = require('./webserver/auth/login/two-factor-authentication.js');
    const passwordHistoryModule = require('./webserver/auth/login/password-history.js');
    const fileDownloadsModule = require('./webserver/files/file-downloads.js');
    const translationsModule = require('./webserver/ui/translations.js');
    const captchaModule = require('./webserver/auth/account/captcha.js');
    const termsModule = require('./webserver/ui/terms.js');
    const recordingsModule = require('./webserver/files/recordings.js');
    const specialUploadsModule = require('./webserver/files/special-uploads.js');
    const auxiliaryWebSocketsModule = require('./webserver/realtime/auxiliary-websockets.js');
    const messengerModule = require('./webserver/realtime/messenger.js');
    const guestSharingModule = require('./webserver/realtime/guest-sharing.js');
    const uploadQuotaModule = require('./webserver/files/upload-quota.js');
    const fileUploadsModule = require('./webserver/files/file-uploads.js');
    const SerialTunnel = serialTunnelModule.createSerialTunnel;
    const constants = (obj.crypto.constants ? obj.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Public sanitization API. Keep these methods on the web server object for compatibility with existing callers.
    obj.CloneSafeUser = sanitization.cloneSafeUser;
    obj.CloneSafeNode = sanitization.cloneSafeNode;
    obj.CloneSafeMesh = sanitization.cloneSafeMesh;
    obj.filterUserWebState = sanitization.filterUserWebState;

    // Setup WebAuthn / FIDO2
    obj.webauthn = require('./webauthn.js').CreateWebAuthnModule();

    obj.isTrustedCert = certificateTrustModule.createCertificateTrust(obj.args, parent.config, obj.certificates);
    obj.getDomainUserFeatures = domainUserFeaturesModule.createDomainUserFeatures({ state: obj, parent: parent, ipcheck: require('ipcheck') });
    const requestUtils = requestUtilsModule.createRequestUtils({
        crypto: obj.crypto,
        ipcheck: require('ipcheck'),
        path: obj.path,
        getCookieIpCheck: function () { return obj.args.cookieipcheck; }
    });
    const checkEmail = requestUtils.checkEmail;
    const isMobileBrowser = requestUtils.isMobileBrowser;
    const getQueryPortion = requestUtils.getQueryPortion;
    const getRandomAmtPassword = requestUtils.getRandomAmtPassword;
    const getRandomPassword = requestUtils.getRandomPassword;
    const getRandomLowerCase = requestUtils.getRandomLowerCase;
    const getRandomEightDigitInteger = requestUtils.getRandomEightDigitInteger;
    const getRandomSixDigitInteger = requestUtils.getRandomSixDigitInteger;
    const cleanRemoteAddr = requestUtils.cleanRemoteAddr;
    const setContentDispositionHeader = requestUtils.setContentDispositionHeader;
    const isIPMatch = requestUtils.isIPMatch;
    const checkAgentColorString = requestUtils.checkAgentColorString;
    const checkCookieIp = requestUtils.checkCookieIp;
    const assembleStringFromObject = requestUtils.assembleStringFromObject;
    const EscapeHtml = requestUtils.escapeHtml;
    const calcDelta = requestUtils.calcDelta;
    const networkAccess = networkAccessModule.createNetworkAccess({
        config: parent.config,
        ipcheck: require('ipcheck'),
        getDnsDomains: function () { return obj.dnsDomains; },
        onBlockedUser: function () { obj.blockedUsers++; },
        onBlockedAgent: function () { obj.blockedAgents++; },
        debug: function (source, message) { parent.debug(source, message); }
    });
    const checkIpAddressEx = networkAccess.checkIpAddressEx;
    const checkUserIpAddress = networkAccess.checkUserIpAddress;
    const checkAgentIpAddress = networkAccess.checkAgentIpAddress;
    const handleDevicePowerEvents = powerEventsModule.createPowerEventsHandler({ state: obj, checkUserIpAddress: checkUserIpAddress, setContentDispositionHeader: setContentDispositionHeader });
    obj.handleDevicePowerEvents = handleDevicePowerEvents;
    const getDomain = networkAccess.getDomain;
    const agentSettings = agentSettingsModule.createAgentSettings({ state: obj, parent: parent, checkAgentColorString: checkAgentColorString, getDomain: getDomain, setContentDispositionHeader: setContentDispositionHeader });
    const getMshFromRequest = agentSettings.getMshFromRequest;
    obj.handleMeshSettingsRequest = agentSettings.handleMeshSettingsRequest;
    obj.handleAmtEventRequest = amtEventsModule.createAmtEventHandler({ state: obj, parent: parent, getDomain: getDomain });
    obj.handleMeshAgentRequest = agentDownloadsModule.createAgentDownloadHandler({ state: obj, parent: parent, rootDirectory: __dirname, getDomain: getDomain, checkUserIpAddress: checkUserIpAddress, getMshFromRequest: getMshFromRequest, checkAgentColorString: checkAgentColorString, setContentDispositionHeader: setContentDispositionHeader, isAgentDownloadLocked: agentSettingsModule.isAgentDownloadLocked, hasUserSession: agentSettingsModule.hasUserSession });
    obj.handleMeshOsxAgentRequest = macosAgentDownloadModule.createMacOsAgentHandler({ state: obj, parent: parent, getDomain: getDomain, getMshFromRequest: getMshFromRequest, setContentDispositionHeader: setContentDispositionHeader, isAgentDownloadLocked: agentSettingsModule.isAgentDownloadLocked, hasUserSession: agentSettingsModule.hasUserSession, createArchive: function () { return require('archiver')('zip', { level: 5 }); }, createInstaller: function (installerOptions) { return require('./macosinstaller').createMacOSInstaller(installerOptions); } });
    const parseAllowedFramingOrigins = networkAccess.parseAllowedFramingOrigins;
    const captcha = captchaModule.createCaptcha({ parent: parent, checkUserIpAddress: checkUserIpAddress });
    const handleNewAccountCaptchaRequest = captcha.handleNewAccount;
    const handleCaptchaGetRequest = captcha.handleGet;
    const handleCaptchaPostRequest = captcha.handlePost;
    const auxiliaryWebSockets = auxiliaryWebSocketsModule.createAuxiliaryWebSockets({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress });
    const handleEchoWebSocket = auxiliaryWebSockets.echo;
    const handle2faHoldWebSocket = auxiliaryWebSockets.twoFactorHold;
    const domainAssets = domainAssetsModule.createDomainAssets({
        state: obj,
        parent: parent,
        common: obj.common,
        certificates: certificates,
        getDomain: getDomain,
        checkUserIpAddress: checkUserIpAddress,
        checkIpAddressEx: checkIpAddressEx,
        setContentDispositionHeader: setContentDispositionHeader,
        getQueryPortion: getQueryPortion
    });
    const handleLogoRequest = domainAssets.handleLogo;
    const handleLoginLogoRequest = domainAssets.handleLoginLogo;
    const handlePWALogoRequest = domainAssets.handlePwaLogo;
    const handleWelcomeImageRequest = domainAssets.handleWelcomeImage;
    const handleRootCertRequest = domainAssets.handleRootCertificate;
    const handleManifestRequest = domainAssets.handleManifest;
    const handleUserImageRequest = domainAssets.handleUserImage;
    Object.assign(obj, authorizationModule.createAuthorization({
        db: db,
        common: obj.common,
        config: parent.config,
        users: obj.users,
        meshes: obj.meshes,
        userGroups: obj.userGroups
    }));
    const storage = storageModule.createStorage({
        fs: obj.fs,
        path: obj.path,
        filespath: obj.filespath,
        common: obj.common,
        users: obj.users,
        meshes: obj.meshes,
        os: obj.os,
        getMeshRights: function (user, meshId) { return obj.GetMeshRights(user, meshId); }
    });
    Object.assign(obj, storage);
    const readTotalFileSize = storage.readTotalFileSize;
    const resolveSafeUploadTempPath = storage.resolveSafeUploadTempPath;
    const customIcons = customIconsModule.createCustomIcons({ crypto: obj.crypto, path: obj.path, fs: obj.fs, datapath: parent.datapath });
    const customIconHandlers = customIconsModule.createCustomIconHandlers({
        state: obj,
        parent: parent,
        customIcons: customIcons,
        checkUserIpAddress: checkUserIpAddress,
        getDomain: getDomain,
        resolveSafeUploadTempPath: resolveSafeUploadTempPath
    });
    const handleCustomIconUpload = customIconHandlers.upload;
    const handleCustomIconDelete = customIconHandlers.remove;
    const handleCustomIconDownload = customIconHandlers.download;
    const specialUploads = specialUploadsModule.createSpecialUploads({
        state: obj,
        parent: parent,
        checkUserIpAddress: checkUserIpAddress,
        checkCookieIp: checkCookieIp,
        resolveSafeUploadTempPath: resolveSafeUploadTempPath
    });
    const handleUploadMeshCoreFile = specialUploads.uploadMeshCore;
    const handleOneClickRecoveryFile = specialUploads.uploadOneClickRecovery;
    const fileUploads = fileUploadsModule.createFileUploads({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress, checkCookieIp: checkCookieIp, resolveSafeUploadTempPath: resolveSafeUploadTempPath, readTotalFileSize: readTotalFileSize, createUploadQuota: uploadQuotaModule.createUploadQuota, getRandomPassword: getRandomPassword, remoteControlRight: MESHRIGHT_REMOTECONTROL });
    const handleUploadFile = fileUploads.handleUpload;
    const handleUploadFileBatch = fileUploads.handleBatchUpload;
    const serverBackups = serverBackupsModule.createServerBackups({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress, checkCookieIp: checkCookieIp, resolveSafeUploadTempPath: resolveSafeUploadTempPath });
    const handleBackupRequest = serverBackups.handleBackupRequest;
    const handleRestoreRequest = serverBackups.handleRestoreRequest;
    const agentFileTransfer = agentFileTransferModule.createAgentFileTransfer({ state: obj, parent: parent, checkAgentIpAddress: checkAgentIpAddress });
    const handleAgentFileTransfer = agentFileTransfer.handleAgentFileTransfer;
    const rendering = renderingModule.createRendering({
        path: obj.path,
        fs: obj.fs,
        datapath: parent.datapath,
        serverRoot: __dirname,
        webViewsPath: parent.webViewsPath,
        webViewsOverridePath: parent.webViewsOverridePath,
        webEmailsOverridePath: parent.webEmailsOverridePath,
        domains: parent.config.domains,
        users: obj.users,
        db: obj.db,
        isMobileBrowser: isMobileBrowser,
        isWebPageLengthRandomizationEnabled: function () { return args.webpagelengthrandomization !== false; },
        getDomain: getDomain,
        replacePlaceholders: obj.common.replacePlaceholders,
        randomBytes: function (size) { return parent.crypto.randomBytes(size); },
        getCurrentVersion: function () { return parent.currentVer; },
        getWebServerName: function (domain, req) { return obj.getWebServerName(domain, req); },
        getServerStats: function () {
            return {
                agentsessions: Object.keys(obj.wsagents).length,
                connectedusers: Object.keys(obj.wssessions).length,
                userssessions: Object.keys(obj.wssessions2).length,
                relaysessions: obj.relaySessionCount,
                relaycount: Object.keys(obj.wsrelays).length
            };
        },
        setRenderState: function (pages, languages) { obj.renderPages = pages; obj.renderLanguages = languages; },
        setEmailLanguages: function (languages) { obj.emailLanguages = languages; }
    });
    const getRenderPage = rendering.getRenderPage;
    const getRenderArgs = rendering.getRenderArgs;
    const render = rendering.render;
    const emailAccountActions = emailAccountActionsModule.createEmailAccountActions({
        state: obj,
        parent: parent,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        escapeHtml: EscapeHtml,
        createTemporaryPassword: emailAccountUtils.createTemporaryPassword,
        getActiveUser: emailAccountUtils.getActiveUser,
        hasDatabaseFailure: emailAccountUtils.hasDatabaseFailure,
        hasOtherVerifiedUser: emailAccountUtils.hasOtherVerifiedUser,
        hasEmailLinkCookie: emailAccountUtils.hasEmailLinkCookie,
        hasAccountEmailRequest: emailAccountUtils.hasAccountEmailRequest,
        resolveAccountEmail: emailAccountUtils.resolveAccountEmail,
        validateEmail: function (email, min, max) { return obj.common.validateEmail(email, min, max); },
        checkEmail: checkEmail,
        getQueryPortion: getQueryPortion,
        handleRootRequestEx: handleRootRequestEx,
        getLanguageCodes: function (req) { return obj.getLanguageCodes(req); },
        checkUserIpAddress: checkUserIpAddress,
        decodeCookie: function (cookie, key, age) { return obj.parent.decodeCookie(cookie, key, age); },
        hashPassword: function (password, callback, iterations) { require('./pass').hash(password, callback, iterations); }
    });
    const handleCheckMailRequest = emailAccountActions.handleCheckMailRequest;
    const handleCheckAccountEmailRequest = emailAccountActions.handleCheckAccountEmailRequest;
    const getRenderList = rendering.getRenderList;
    const getEmailLanguageList = rendering.getEmailLanguageList;
    const remotePages = remotePagesModule.createRemotePages({
        state: obj,
        parent: parent,
        args: args,
        getDomain: getDomain,
        checkUserIpAddress: checkUserIpAddress,
        getQueryPortion: getQueryPortion,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        escapeHtml: EscapeHtml,
        remoteControlRight: MESHRIGHT_REMOTECONTROL,
        noTerminalRight: 512
    });
    const handleXTermRequest = remotePages.handleXTermRequest;
    const handleMSTSCRequest = remotePages.handleMSTSCRequest;
    const terms = termsModule.createTerms({
        state: obj,
        parent: parent,
        checkUserIpAddress: checkUserIpAddress,
        getQueryPortion: getQueryPortion,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs
    });
    const handleTermsRequest = terms.handleRequest;
    const recordings = recordingsModule.createRecordings({
        state: obj,
        parent: parent,
        checkUserIpAddress: checkUserIpAddress,
        checkAgentIpAddress: checkAgentIpAddress,
        setContentDispositionHeader: setContentDispositionHeader,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        recordingRight: 512
    });
    const handleGetRecordings = recordings.download;
    const handleGetRecordingsWebSocket = recordings.stream;
    const handlePlayerRequest = recordings.player;
    const messenger = messengerModule.createMessenger({ state: obj, parent: parent, args: args, getDomain: getDomain, render: render, getRenderPage: getRenderPage, getRenderArgs: getRenderArgs });
    const handleMessengerRequest = messenger.handlePage;
    const handleMessengerImageRequest = messenger.handleImage;
    const guestSharing = guestSharingModule.createGuestSharing({ state: obj, parent: parent, args: args, getDomain: getDomain, render: render, getRenderPage: getRenderPage, getRenderArgs: getRenderArgs });
    const handleSharingRequest = guestSharing.handleRequest;
    obj.getLanguageCodes = rendering.getLanguageCodes;
    obj.useNodeDefaultTLSCiphers = args.usenodedefaulttlsciphers; // Use TLS ciphers provided by node
    obj.tlsCiphers = args.tlsciphers;           // List of TLS ciphers to use
    obj.userAllowedIp = args.userallowedip;     // List of allowed IP addresses for users
    obj.agentAllowedIp = args.agentallowedip;   // List of allowed IP addresses for agents
    obj.agentBlockedIp = args.agentblockedip;   // List of blocked IP addresses for agents
    obj.tlsSniCredentials = null;
    obj.dnsDomains = {};
    obj.relaySessionCount = 0;
    obj.relaySessionErrorCount = 0;
    obj.blockedUsers = 0;
    obj.blockedAgents = 0;
    obj.renderPages = null;
    obj.renderLanguages = [];
    obj.destroyedSessions = {};                 // userid/req.session.x --> destroyed session time
    const sessions = sessionsModule.createSessions({ crypto: obj.crypto, destroyedSessions: obj.destroyedSessions, checkCookieIp: checkCookieIp });
    const getWebsocketArgs = sessions.getWebsocketArgs;
    const setSessionRandom = sessions.setSessionRandom;
    const clearDestroyedSessions = sessions.clearDestroyedSessions;
    const handleLogoutRequest = sessionLogoutModule.createSessionLogout({
        state: obj,
        parent: parent,
        checkUserIpAddress: checkUserIpAddress,
        clearDestroyedSessions: clearDestroyedSessions
    });
    const externalGroups = externalGroupsModule.createExternalGroups({
        crypto: obj.crypto,
        userGroups: obj.userGroups,
        db: db,
        dispatchEvent: function (targets, source, event) { parent.DispatchEvent(targets, source, event); },
        authLog: function (source, message) { parent.authLog(source, message); },
        cloneSafeUser: obj.CloneSafeUser,
        eventSource: obj
    });
    const syncExternalUserGroups = externalGroups.syncExternalUserGroups;
    const prepareSsoLoginGroups = ssoLoginGroupsModule.createSsoLoginGroups({
        common: obj.common,
        authLog: function (source, message) { parent.authLog(source, message); },
        isGroupConfiguration: ssoStrategiesModule.isGroupConfiguration,
        shouldRevokeAdmin: ssoStrategiesModule.shouldRevokeAdmin
    });
    const sendSsoLoginResponse = ssoLoginResponseModule.createSsoLoginResponse({
        getWebServerName: function (domain, req) { return obj.getWebServerName(domain, req); },
        safeDecodeURIComponent: requestUtils.safeDecodeURIComponent
    });
    const ssoAccounts = ssoAccountsModule.createSsoAccounts({
        state: obj,
        parent: parent,
        setSessionRandom: setSessionRandom,
        syncExternalUserGroups: syncExternalUserGroups,
        isEmailVerified: ssoStrategiesModule.isEmailVerified
    });
    const handleStrategyLogin = ssoLoginModule.createSsoLogin({
        users: obj.users,
        authLog: function (source, message) { parent.authLog(source, message); },
        checkUserIpAddress: checkUserIpAddress,
        getQueryPortion: getQueryPortion,
        prepareSsoLoginGroups: prepareSsoLoginGroups,
        ssoAccounts: ssoAccounts,
        sendSsoLoginResponse: sendSsoLoginResponse
    });
    Object.assign(obj, serverIdentityModule.createServerIdentity({ args: obj.args, certificates: obj.certificates }));
    Object.assign(obj, sessionCountsModule.createSessionCounts({
        state: obj,
        dispatchEvent: function (targets, source, event) { parent.DispatchEvent(targets, source, event); }
    }));
    Object.assign(obj, agentRoutingModule.createAgentRouting({
        state: obj,
        getNodeRights: function (userId, meshId, nodeId) { return obj.GetNodeRights(userId, meshId, nodeId); },
        getMultiServer: function () { return parent.multiServer; }
    }));
    const pushNotifications = pushNotificationsModule.createPushNotifications({
        parent: parent,
        db: db,
        getWebPush: function () { return parent.webpush; },
        dispatchEvent: function (targets, source, event) { parent.DispatchEvent(targets, source, event); },
        cloneSafeUser: obj.CloneSafeUser,
        cloneSafeNode: obj.CloneSafeNode,
        eventSource: obj
    });
    Object.assign(obj, pushNotifications);
    const handleFirebasePushOnlyRelayRequest = pushNotifications.handleFirebasePushOnlyRelayRequest;
    const handleFirebaseRelayRequest = pushNotifications.handleFirebaseRelayRequest;
    Object.assign(obj, userAgentModule.createUserAgent({ parse: obj.uaparser, ClientHints: obj.uaclienthints.UAClientHints }));
    const serverLifecycle = serverLifecycleModule.createServerLifecycle({ state: obj, parent: parent, args: args, certificates: certificates, os: obj.os });
    const CheckListenPort = serverLifecycle.CheckListenPort;
    const StartWebServer = serverLifecycle.StartWebServer;
    const StartAltWebServer = serverLifecycle.StartAltWebServer;

    const webRelay = webRelayModule.createWebRelay({ state: obj, parent: parent, createRouter: function () { return require('express').Router(); } });

    // Monitor web relay session removals
    parent.AddEventDispatch(['server-shareremove'], obj);
    obj.HandleEvent = webRelay.handleEvent;

    const fileDownloads = fileDownloadsModule.createFileDownloads({
        state: obj,
        parent: parent,
        serverRoot: __dirname,
        checkUserIpAddress: checkUserIpAddress,
        getDomain: getDomain,
        checkAgentIpAddress: checkAgentIpAddress,
        getRandomLowerCase: getRandomLowerCase,
        setContentDispositionHeader: setContentDispositionHeader,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        getRootCertLink: getRootCertLink,
        remoteControlRight: MESHRIGHT_REMOTECONTROL,
        getLanguageCodes: obj.getLanguageCodes
    });
    const handleDownloadUserFiles = fileDownloads.downloadUserFile;
    const handleDeviceFile = fileDownloads.downloadDeviceFile;
    const handleAgentDownloadFile = fileDownloads.downloadAgentFile;
    const handleDownloadFile = fileDownloads.downloadServerFile;
    const handleMeshCommander = fileDownloads.meshCommander;
    const translations = translationsModule.createTranslations({
        state: obj,
        parent: parent,
        serverRoot: __dirname,
        checkUserIpAddress: checkUserIpAddress,
        checkIpAddressEx: checkIpAddressEx
    });
    const handleTranslationsRequest = translations.handleRequest;
    Object.assign(obj, agentControlModule.createAgentControl({
        state: obj,
        common: obj.common,
        crypto: obj.crypto,
        getMeshRights: function (user, meshId) { return obj.GetMeshRights(user, meshId); },
        agentConsoleRight: MESHRIGHT_AGENTCONSOLE
    }));
    Object.assign(obj, subscriptionsModule.createSubscriptions({
        users: obj.users,
        removeAllEventDispatch: function (target) { parent.RemoveAllEventDispatch(target); },
        addEventDispatch: function (subscriptions, target) { parent.AddEventDispatch(subscriptions, target); }
    }));
    runtimeInitializationModule.configureSspiDomains(obj, parent, require);

    certificateHashesModule.initializeCertificateHashes(obj, parent);

    runtimeInitializationModule.initializeRuntimeCollections(obj);
    const tlsConfiguration = tlsConfigurationModule.createTlsConfiguration({
        state: obj,
        parent: parent,
        args: args,
        certificates: certificates,
        tls: obj.tls,
        https: require('https'),
        expressWs: require('express-ws'),
        constants: constants
    });
    const coreMiddleware = coreMiddlewareModule.createCoreMiddleware({
        state: obj,
        parent: parent,
        keygrip: require('keygrip'),
        cookieSession: require('cookie-session'),
        dnsLookup: require('dns').lookup,
        handleWebRelayWebSocket: webRelay.handleWebSocket
    });
    const securityHeaders = securityHeadersModule.createSecurityHeaders({
        getSettings: function () { return parent.config.settings; },
        getWebRelayServer: function () { return parent.webrelayserver; },
        isTrustedCert: function (domain) { return obj.isTrustedCert(domain); }
    });
    const requestContext = requestContextModule.createRequestContext({ state: obj, isIPMatch: isIPMatch });
    const requestMiddleware = requestMiddlewareModule.createRequestMiddleware({
        state: obj,
        parent: parent,
        sessions: sessions,
        requestContext: requestContext,
        getDomain: getDomain,
        securityHeaders: securityHeaders
    });
    const nice404 = notFoundModule.createNotFound({
        args: obj.args,
        crypto: obj.crypto,
        getDomain: getDomain,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        debug: function (source, message) { parent.debug(source, message); }
    }).nice404;
    const agentInvitations = agentInvitationsModule.createAgentInvitations({
        state: obj,
        parent: parent,
        args: args,
        getDomain: getDomain,
        nice404: nice404,
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs
    });
    const handleInviteRequest = agentInvitations.handleInviteRequest;
    const handleAgentInviteRequest = agentInvitations.handleAgentInviteRequest;
    const accountManagement = accountManagementModule.createAccountManagement({
        state: obj,
        parent: parent,
        checkUserIpAddress: checkUserIpAddress,
        getQueryPortion: getQueryPortion,
        renderRoot: function (req, res, domain) { handleRootRequestEx(req, res, domain); },
        hashPassword: function (password, callback) { require('./pass').hash(password, callback, 0); }
    });
    const handlePasswordChangeRequest = accountManagement.handlePasswordChangeRequest;
    const handleDeleteAccountRequest = accountManagement.handleDeleteAccountRequest;

    runtimeInitializationModule.initializeRuntimeRandoms(obj);

    // Get non-english web pages and emails
    getRenderList();
    getEmailLanguageList();

    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    startupDataModule.createStartupDataLoader({ state: obj, parent: parent, onReady: serverStart }).load();

    obj.cleanDevice = deviceCleanupModule.createDeviceCleaner(obj);

    Object.assign(obj, telemetryModule.createTelemetry({ state: obj, tlsConfiguration: tlsConfiguration, calcDelta: calcDelta }));

    obj.authenticate = passwordAuthenticationModule.createPasswordAuthentication({
        state: obj,
        parent: parent,
        db: db,
        assembleStringFromObject: assembleStringFromObject,
        syncExternalUserGroups: syncExternalUserGroups,
        require: require
    }).authenticate;

    /*
    obj.restrict = function (req, res, next) {
        console.log('restrict', req.url);
        var domain = getDomain(req);
        if (req.session.userid) {
            next();
        } else {
            req.session.messageid = 111; // Access denied.
            res.redirect(domain.url + 'login');
        }
    };
    */

    const twoFactorAuthentication = twoFactorAuthenticationModule.createTwoFactorAuthentication({ state: obj, parent: parent, args: args, checkCookieIp: checkCookieIp, require: require });
    const checkUserOneTimePasswordSkip = twoFactorAuthentication.checkUserOneTimePasswordSkip;
    const checkUserOneTimePasswordRequired = twoFactorAuthentication.checkUserOneTimePasswordRequired;
    const checkUserOneTimePassword = twoFactorAuthentication.checkUserOneTimePassword;
    const getHardwareKeyChallenge = twoFactorAuthentication.getHardwareKeyChallenge;
    const completeLoginRequest = loginCompletionModule.createLoginCompletion({ state: obj, parent: parent, setSessionRandom: setSessionRandom, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx });
    const handleLoginFailure = loginFailureModule.createLoginFailureHandler({ state: obj, parent: parent, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx });
    const handleLoginTwoFactor = loginTwoFactorModule.createLoginTwoFactorHandler({ state: obj, parent: parent, getRandomEightDigitInteger: getRandomEightDigitInteger, getRandomSixDigitInteger: getRandomSixDigitInteger, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx, checkUserOneTimePasswordRequired: checkUserOneTimePasswordRequired, checkUserOneTimePassword: checkUserOneTimePassword, completeLoginRequest: completeLoginRequest, cleanRemoteAddr: cleanRemoteAddr, require: require });

    const handleLoginRequest = loginRequestModule.createLoginRequestHandler({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx, checkUserOneTimePasswordSkip: checkUserOneTimePasswordSkip, handleLoginTwoFactor: handleLoginTwoFactor, completeLoginRequest: completeLoginRequest, handleLoginFailure: handleLoginFailure });

    const accountCreationReservations = accountCreationReservationsModule.createAccountCreationReservations();

    const handleCreateAccountRequest = accountCreationModule.createAccountCreation({ state: obj, parent: parent, reservations: accountCreationReservations, checkUserIpAddress: checkUserIpAddress, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx, setSessionRandom: setSessionRandom, hashPassword: require('./pass').hash, hasDatabaseFailure: emailAccountUtils.hasDatabaseFailure }).handleCreateAccountRequest;

    const handleResetPasswordRequest = passwordResetModule.createPasswordReset({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx, setSessionRandom: setSessionRandom, completeLoginRequest: completeLoginRequest, hashPassword: require('./pass').hash, updatePasswordHint: passwordHistoryModule.updatePasswordHint }).handleResetPasswordRequest;

    const handleResetAccountRequest = accountRecoveryModule.createAccountRecovery({ state: obj, parent: parent, checkUserIpAddress: checkUserIpAddress, checkEmail: checkEmail, getQueryPortion: getQueryPortion, handleRootRequestEx: handleRootRequestEx, checkUserOneTimePasswordRequired: checkUserOneTimePasswordRequired, checkUserOneTimePassword: checkUserOneTimePassword, getRandomSixDigitInteger: getRandomSixDigitInteger }).handleResetAccountRequest;

    const renderApplication = applicationRenderModule.createApplicationRenderer({ state: obj, parent: parent, args: args, render: render, getRenderPage: getRenderPage, getRenderArgs: getRenderArgs, getQueryPortion: getQueryPortion });
    const authenticateSspi = sspiAuthenticationModule.createSspiAuthentication({ state: obj, parent: parent, database: db, setSessionRandom: setSessionRandom });
    const authenticateAutomatically = automaticAuthenticationModule.createAutomaticAuthentication({ state: obj, parent: parent, setSessionRandom: setSessionRandom });

    // Handle account email change and email verification request
    function handleRootRequestEx(req, res, domain, direct) {
        var nologout = false;
        res.set({ 'Cache-Control': 'no-store' });

        if (rootRequests.redirectIncompleteDomainPath(req, res, domain)) { return; }

        const automaticAuthentication = authenticateAutomatically(req, domain);
        if (!automaticAuthentication && (domain.sspi != null)) {
            if (!authenticateSspi(req, res, domain)) { return; }
            nologout = true;
        }

        const passRequirements = passwordRequirementsModule.getEncodedPasswordRequirements(domain);

        // If a user exists and is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid && obj.users[req.session.userid]) {
            const user = obj.users[req.session.userid];

            if (applicationEntryModule.handleApplicationEntry(req, res, domain, user, parent.config.settings.maintenancemode)) { return; }
            renderApplication(req, res, domain, user, nologout, passRequirements);
        } else {
            handleLoginChallenge(req, res, domain, passRequirements);
        }
    }

    const rootRequests = rootRequestsModule.createRootRequests({
        state: obj,
        debug: function (source, message) { parent.debug(source, message); },
        checkUserIpAddress: checkUserIpAddress,
        getQueryPortion: getQueryPortion,
        isTrustedCert: obj.isTrustedCert,
        authLog: function (source, message, details) { parent.authLog(source, message, details); },
        getLoginCookieEncryptionKey: function () { return obj.parent.loginCookieEncryptionKey; },
        handleRootRequestEx: handleRootRequestEx,
        authenticate: function (username, password, domain, callback) { obj.authenticate(username, password, domain, callback); },
        users: obj.users,
        checkUserOneTimePasswordRequired: checkUserOneTimePasswordRequired,
        setSessionRandom: setSessionRandom,
        database: obj.db,
        decodeCookie: function (cookie, key, age) { return obj.parent.decodeCookie(cookie, key, age); },
        encodeCookie: function (cookie, key) { return obj.parent.encodeCookie(cookie, key); },
        getSessionSameSite: function () { return parent.config.settings.sessionsamesite; },
        dispatchEvent: function (targets, source, event) { obj.parent.DispatchEvent(targets, source, event); },
        encryptSessionData: function (data) { return parent.encryptSessionData(data); },
        postHandlers: {
            login: handleLoginRequest,
            changePassword: handlePasswordChangeRequest,
            deleteAccount: handleDeleteAccountRequest,
            createAccount: handleCreateAccountRequest,
            resetPassword: handleResetPasswordRequest,
            resetAccount: handleResetAccountRequest,
            checkEmail: handleCheckAccountEmailRequest
        },
        getMaintenanceMode: function () { return parent.config.settings.maintenancemode; },
        render: render,
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs
    });
    const handleRootRequest = rootRequests.handleRootRequest;
    const handleRootPostRequest = rootRequests.handleRootPostRequest;
    const handleRootRedirect = rootRequests.handleRootRedirect;
    const getRootCertLink = rootRequests.getRootCertLink;
    const renderLoginPage = loginPageRenderModule.createLoginPageRenderer({ state: obj, parent: parent, args: args, captcha: captcha, render: render, getRenderPage: getRenderPage, getRenderArgs: getRenderArgs, getRootCertLink: getRootCertLink, escapeHtml: EscapeHtml });
    const handleLoginChallenge = loginChallengeModule.createLoginChallengeHandler({ state: obj, parent: parent, getQueryPortion: getQueryPortion, getHardwareKeyChallenge: getHardwareKeyChallenge, renderLogin: renderLoginPage, hasDatabaseFailure: emailAccountUtils.hasDatabaseFailure });

    // Handle a web socket relay request
    const handleRelayWebSocket = relayWebSocketModule.createRelayWebSocketHandler({ state: obj, parent: parent, remoteControlRight: MESHRIGHT_REMOTECONTROL, getRandomPassword: getRandomPassword, tlsConstants: constants, createSerialTunnel: SerialTunnel });

    // Handle a request to download a mesh agent
    // Create a OSX mesh agent installer
    if (parent.pluginHandler != null) {
        const pluginRequests = pluginRequestsModule.createPluginRequests({ state: obj, pluginHandler: parent.pluginHandler, checkUserIpAddress: checkUserIpAddress });
        obj.handlePluginAdminReq = pluginRequests.handleAdminRequest;
        obj.handlePluginAdminPostReq = pluginRequests.handleAdminPostRequest;
        obj.handlePluginJS = pluginRequests.handleScript;
    }

    // Starts the HTTPS server, this should be called after the user/mesh tables are loaded
    function serverStart() {
        const finalizeWebserver = serverFinalizationModule.createServerFinalization({ setupHttpHandlers: setupHttpRoutes, args: obj.args, app: obj.app, nice404: nice404, checkListenPort: CheckListenPort, startWebServer: StartWebServer, startAltWebServer: StartAltWebServer, done: doneFunc });
        tlsConfiguration.setupServers();

        coreMiddleware.setupCoreMiddleware();

        requestMiddleware.setup();

        domainStartupModule.createDomainStartup({
            domains: parent.config.domains,
            app: obj.app,
            staticMiddleware: obj.express.static,
            setupDomainAuthStrategy: setupDomainAuthStrategy,
            finalizeWebserver: finalizeWebserver
        }).setup();

    }

    const domainAuthStrategyConsts = ssoStrategiesModule.constants;
    const setupDomainAuthStrategy = ssoStrategiesModule.createSsoStrategies({ state: obj, parent: parent, args: args });

    const websocketAuth = websocketAuthModule.createWebSocketAuth({
        state: obj,
        parent: parent,
        getDomain: getDomain,
        checkUserIpAddress: checkUserIpAddress,
        noMeshCommandRight: SITERIGHT_NOMESHCMD,
        cleanRemoteAddr: cleanRemoteAddr,
        getRandomEightDigitInteger: getRandomEightDigitInteger,
        getRandomSixDigitInteger: getRandomSixDigitInteger,
        checkUserOneTimePasswordSkip: checkUserOneTimePasswordSkip,
        checkUserOneTimePasswordRequired: checkUserOneTimePasswordRequired,
        checkUserOneTimePassword: checkUserOneTimePassword,
        setSessionRandom: setSessionRandom
    });
    const PerformWSSessionInnerAuth = websocketAuth.PerformWSSessionInnerAuth;
    const PerformWSSessionAuth = websocketAuth.PerformWSSessionAuth;

    const setupHttpRoutes = httpRouteSetupModule.createHttpRouteSetup({
        state: obj,
        parent: parent,
        domainAssets: domainAssets,
        webRelay: webRelay,
        getDomain: getDomain,
        getWebSocketArgs: getWebsocketArgs,
        authorizeWebSocket: PerformWSSessionAuth,
        authorizeInnerWebSocket: PerformWSSessionInnerAuth,
        relayWebSocket: handleRelayWebSocket,
        authStrategyFlags: domainAuthStrategyConsts,
        strategyLogin: handleStrategyLogin,
        getQueryPortion: getQueryPortion,
        setSessionRandom: setSessionRandom,
        checkAgentIpAddress: checkAgentIpAddress,
        createSerialTunnel: SerialTunnel,
        handlers: {
            rootRedirect: handleRootRedirect,
            rootRequest: handleRootRequest,
            rootPostRequest: handleRootPostRequest,
            refresh: function (req, res) { res.sendStatus(200); },
            backupRequest: handleBackupRequest,
            restoreRequest: handleRestoreRequest,
            termsRequest: handleTermsRequest,
            xtermRequest: handleXTermRequest,
            loginRequest: handleLoginRequest,
            logoutRequest: handleLogoutRequest,
            rootCertRequest: handleRootCertRequest,
            manifestRequest: handleManifestRequest,
            passwordChangeRequest: handlePasswordChangeRequest,
            deleteAccountRequest: handleDeleteAccountRequest,
            createAccountRequest: handleCreateAccountRequest,
            resetPasswordRequest: handleResetPasswordRequest,
            resetAccountRequest: handleResetAccountRequest,
            checkMailRequest: handleCheckMailRequest,
            agentInviteRequest: handleAgentInviteRequest,
            userImageRequest: handleUserImageRequest,
            amtEventRequest: obj.handleAmtEventRequest,
            meshAgentRequest: obj.handleMeshAgentRequest,
            messengerRequest: handleMessengerRequest,
            messengerImageRequest: handleMessengerImageRequest,
            meshOsxAgentRequest: obj.handleMeshOsxAgentRequest,
            meshSettingsRequest: obj.handleMeshSettingsRequest,
            devicePowerEvents: handleDevicePowerEvents,
            downloadFile: handleDownloadFile,
            meshCommander: handleMeshCommander,
            uploadFile: handleUploadFile,
            uploadFileBatch: handleUploadFileBatch,
            customIconUpload: handleCustomIconUpload,
            customIconDelete: handleCustomIconDelete,
            customIconDownload: handleCustomIconDownload,
            uploadMeshCoreFile: handleUploadMeshCoreFile,
            oneClickRecoveryFile: handleOneClickRecoveryFile,
            downloadUserFiles: handleDownloadUserFiles,
            echoWebSocket: handleEchoWebSocket,
            twoFactorHoldWebSocket: handle2faHoldWebSocket,
            apfWebSocket: function (ws, req) { obj.parent.mpsserver.onWebSocketConnection(ws, req); },
            websocketExpected: function (req, res) { res.send('Websocket connection expected'); },
            health: function (req, res) { res.send('ok'); },
            deviceFile: handleDeviceFile,
            agentDownloadFile: handleAgentDownloadFile,
            logoRequest: handleLogoRequest,
            loginLogoRequest: handleLoginLogoRequest,
            pwaLogoRequest: handlePWALogoRequest,
            translationsRequest: handleTranslationsRequest,
            welcomeImageRequest: handleWelcomeImageRequest,
            getRecordings: handleGetRecordings,
            getRecordingsWebSocket: handleGetRecordingsWebSocket,
            playerRequest: handlePlayerRequest,
            sharingRequest: handleSharingRequest,
            agentFileTransfer: handleAgentFileTransfer,
            inviteRequest: handleInviteRequest,
            newAccountCaptchaRequest: handleNewAccountCaptchaRequest,
            captchaGetRequest: handleCaptchaGetRequest,
            captchaPostRequest: handleCaptchaPostRequest,
            mstscRequest: handleMSTSCRequest,
            firebasePushOnlyRelayRequest: handleFirebasePushOnlyRelayRequest,
            firebaseRelayRequest: handleFirebaseRelayRequest
        }
    });

    if (parent.config.settings == null) { parent.config.settings = {}; }
    const throttling = throttlingModule.createThrottling(parent.config.settings, require('ipcheck'));
    Object.assign(obj, throttling);
    Object.defineProperties(obj, {
        badLoginTableLastClean: { configurable: true, get: function () { return throttling.badLoginTableLastClean; }, set: function (value) { throttling.badLoginTableLastClean = value; } },
        bad2faTableLastClean: { configurable: true, get: function () { return throttling.bad2faTableLastClean; }, set: function (value) { throttling.bad2faTableLastClean = value; } }
    });

    // Sync an account with an external user group.
    // Return true if the user was changed
    return obj;
};
