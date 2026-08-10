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

// ExpressJS login sample
// https://github.com/expressjs/express/blob/master/examples/auth/index.js

// Polyfill startsWith/endsWith for older NodeJS
if (!String.prototype.startsWith) { String.prototype.startsWith = function (searchString, position) { position = position || 0; return this.substr(position, searchString.length) === searchString; }; }
if (!String.prototype.endsWith) { String.prototype.endsWith = function (searchString, position) { var subjectString = this.toString(); if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; } position -= searchString.length; var lastIndex = subjectString.lastIndexOf(searchString, position); return lastIndex !== -1 && lastIndex === position; }; }

// Construct a HTTP server object
module.exports.CreateWebServer = function (parent, db, args, certificates, doneFunc) {
    var obj = {}, i = 0;

    // Modules
    obj.fs = require('fs');
    obj.net = require('net');
    obj.tls = require('tls');
    obj.path = require('path');
    obj.os = require('os');
    obj.bodyParser = require('body-parser');
    obj.exphbs = require('express-handlebars');
    obj.crypto = require('crypto');
    obj.common = require('./common.js');
    obj.express = require('express');
    obj.meshAgentHandler = require('./meshagent.js');
    obj.meshRelayHandler = require('./meshrelay.js');
    obj.meshDeviceFileHandler = require('./meshdevicefile.js');
    obj.meshDesktopMultiplexHandler = require('./meshdesktopmultiplex.js');
    obj.meshIderHandler = require('./amt/amt-ider.js');
    obj.meshUserHandler = require('./meshuser.js');
    obj.interceptor = require('./interceptor');
    obj.uaparser = require('ua-parser-js');
    obj.uaclienthints = require('ua-client-hints-js');
    const sanitization = require('./webserver/sanitization.js');
    const authorizationModule = require('./webserver/authorization.js');
    const renderingModule = require('./webserver/rendering.js');
    const throttlingModule = require('./webserver/throttling.js');
    const requestUtilsModule = require('./webserver/request-utils.js');
    const networkAccessModule = require('./webserver/network-access.js');
    const customIconsModule = require('./webserver/custom-icons.js');
    const storageModule = require('./webserver/storage.js');
    const sessionsModule = require('./webserver/sessions.js');
    const externalGroupsModule = require('./webserver/external-groups.js');
    const serverIdentityModule = require('./webserver/server-identity.js');
    const sessionCountsModule = require('./webserver/session-counts.js');
    const agentRoutingModule = require('./webserver/agent-routing.js');
    const pushNotificationsModule = require('./webserver/push-notifications.js');
    const userAgentModule = require('./webserver/user-agent.js');
    const serverLifecycleModule = require('./webserver/server-lifecycle.js');
    const agentControlModule = require('./webserver/agent-control.js');
    const agentInvitationsModule = require('./webserver/agent-invitations.js');
    const accountManagementModule = require('./webserver/account-management.js');
    const remotePagesModule = require('./webserver/remote-pages.js');
    const serverBackupsModule = require('./webserver/server-backups.js');
    const agentFileTransferModule = require('./webserver/agent-file-transfer.js');
    const subscriptionsModule = require('./webserver/subscriptions.js');
    const tlsConfigurationModule = require('./webserver/tls-configuration.js');
    const coreMiddlewareModule = require('./webserver/core-middleware.js');
    const securityHeadersModule = require('./webserver/security-headers.js');
    const requestContextModule = require('./webserver/request-context.js');
    const requestMiddlewareModule = require('./webserver/request-middleware.js');
    const domainStartupModule = require('./webserver/domain-startup.js');
    const notFoundModule = require('./webserver/not-found.js');
    const basicRoutesModule = require('./webserver/basic-routes.js');
    const resourceRoutesModule = require('./webserver/resource-routes.js');
    const applicationRoutesModule = require('./webserver/application-routes.js');
    const relayRoutesModule = require('./webserver/relay-routes.js');
    const passportRoutesModule = require('./webserver/passport-routes.js');
    const duoRoutesModule = require('./webserver/duo-routes.js');
    const agentRoutesModule = require('./webserver/agent-routes.js');
    const domainAssetsModule = require('./webserver/domain-assets.js');
    const webRelayModule = require('./webserver/web-relay.js');
    const domainStaticModule = require('./webserver/domain-static.js');
    const ssoStrategiesModule = require('./webserver/sso-strategies.js');
    const ssoLoginGroupsModule = require('./webserver/sso-login-groups.js');
    const ssoLoginResponseModule = require('./webserver/sso-login-response.js');
    const ssoAccountsModule = require('./webserver/sso-accounts.js');
    const ssoLoginModule = require('./webserver/sso-login.js');
    const sessionLogoutModule = require('./webserver/session-logout.js');
    const rootRequestsModule = require('./webserver/root-requests.js');
    const emailAccountUtils = require('./webserver/email-account-utils.js');
    const emailAccountActionsModule = require('./webserver/email-account-actions.js');
const agentSettingsModule = require('./webserver/agent-settings.js');
const powerEventsModule = require('./webserver/power-events.js');
const pluginRequestsModule = require('./webserver/plugin-requests.js');
const deviceCleanupModule = require('./webserver/device-cleanup.js');
const amtEventsModule = require('./webserver/amt-events.js');
const agentDownloadsModule = require('./webserver/agent-downloads.js');
const macosAgentDownloadModule = require('./webserver/macos-agent-download.js');
const certificateTrustModule = require('./webserver/certificate-trust.js');
const domainUserFeaturesModule = require('./webserver/domain-user-features.js');
const relayWebSocketModule = require('./webserver/relay-websocket.js');
    const telemetryModule = require('./webserver/telemetry.js');
    const serialTunnelModule = require('./webserver/serial-tunnel.js');
    const websocketAuthModule = require('./webserver/websocket-auth.js');
    const passwordAuthenticationModule = require('./webserver/password-authentication.js');
    const loginCompletionModule = require('./webserver/login-completion.js');
    const loginFailureModule = require('./webserver/login-failure.js');
    const loginTwoFactorModule = require('./webserver/login-two-factor.js');
    const loginRequestModule = require('./webserver/login-request.js');
    const loginChallengeModule = require('./webserver/login-challenge.js');
    const automaticAuthenticationModule = require('./webserver/automatic-authentication.js');
    const sspiAuthenticationModule = require('./webserver/sspi-authentication.js');
    const applicationEntryModule = require('./webserver/application-entry.js');
    const applicationRenderModule = require('./webserver/application-render.js');
    const pageOptionsModule = require('./webserver/page-options.js');
    const passwordRequirementsModule = require('./webserver/password-requirements.js');
    const passwordResetModule = require('./webserver/password-reset.js');
    const accountRecoveryModule = require('./webserver/account-recovery.js');
    const accountCreationReservationsModule = require('./webserver/account-creation-reservations.js');
    const accountCreationModule = require('./webserver/account-creation.js');
    const twoFactorAuthenticationModule = require('./webserver/two-factor-authentication.js');
    const passwordHistoryModule = require('./webserver/password-history.js');
    const fileDownloadsModule = require('./webserver/file-downloads.js');
    const translationsModule = require('./webserver/translations.js');
    const captchaModule = require('./webserver/captcha.js');
    const termsModule = require('./webserver/terms.js');
    const recordingsModule = require('./webserver/recordings.js');
    const specialUploadsModule = require('./webserver/special-uploads.js');
    const auxiliaryWebSocketsModule = require('./webserver/auxiliary-websockets.js');
    const messengerModule = require('./webserver/messenger.js');
    const guestSharingModule = require('./webserver/guest-sharing.js');
    const uploadQuotaModule = require('./webserver/upload-quota.js');
    const fileUploadsModule = require('./webserver/file-uploads.js');
    const SerialTunnel = serialTunnelModule.createSerialTunnel;
    const constants = (obj.crypto.constants ? obj.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    // Public sanitization API. Keep these methods on the web server object for compatibility with existing callers.
    obj.CloneSafeUser = sanitization.cloneSafeUser;
    obj.CloneSafeNode = sanitization.cloneSafeNode;
    obj.CloneSafeMesh = sanitization.cloneSafeMesh;
    obj.filterUserWebState = sanitization.filterUserWebState;

    // Setup WebAuthn / FIDO2
    obj.webauthn = require('./webauthn.js').CreateWebAuthnModule();

    if (process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']) {
        obj.httpsProxyAgent = new (require('https-proxy-agent').HttpsProxyAgent)(process.env['HTTP_PROXY'] || process.env['HTTPS_PROXY'] || process.env['http_proxy'] || process.env['https_proxy']);
    }

    // Variables
    obj.args = args;
    obj.parent = parent;
    obj.filespath = parent.filespath;
    obj.db = db;
    obj.app = obj.express();
    if (obj.args.agentport) { obj.agentapp = obj.express(); }
    if (args.compression === true) {
        obj.app.use(require('compression')({ filter: function (req, res) {
            if (req.path == '/devicefile.ashx') return false; // Don't compress device file transfers to show file sizes
            if ((args.relaydns != null) && (obj.args.relaydns.indexOf(req.hostname) >= 0)) return false; // Don't compress DNS relay requests
            return require('compression').filter(req, res);
        }}));
    }
    obj.app.disable('x-powered-by');
    obj.tlsServer = null;
    obj.tcpServer = null;
    obj.certificates = certificates;
    obj.isTrustedCert = certificateTrustModule.createCertificateTrust(obj.args, parent.config, obj.certificates);
    obj.getDomainUserFeatures = domainUserFeaturesModule.createDomainUserFeatures({ state: obj, parent: parent, ipcheck: require('ipcheck') });
    obj.users = {};                             // UserID --> User
    obj.meshes = {};                            // MeshID --> Mesh (also called device group)
    obj.userGroups = {};                        // UGrpID --> User Group
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
    const agentSettings = agentSettingsModule.createAgentSettings({ state: obj, parent: parent, checkAgentColorString: checkAgentColorString, getDomain: getDomain, setContentDispositionHeader: setContentDispositionHeader });
    const getMshFromRequest = agentSettings.getMshFromRequest;
    obj.handleMeshSettingsRequest = agentSettings.handleMeshSettingsRequest;
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

    // Mesh Rights
    const MESHRIGHT_EDITMESH = 0x00000001;
    const MESHRIGHT_MANAGEUSERS = 0x00000002;
    const MESHRIGHT_MANAGECOMPUTERS = 0x00000004;
    const MESHRIGHT_REMOTECONTROL = 0x00000008;
    const MESHRIGHT_AGENTCONSOLE = 0x00000010;
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
    const MESHRIGHT_SERVERFILES = 0x00000020;
    const MESHRIGHT_WAKEDEVICE = 0x00000040;
    const MESHRIGHT_SETNOTES = 0x00000080;
    const MESHRIGHT_REMOTEVIEWONLY = 0x00000100;
    const MESHRIGHT_NOTERMINAL = 0x00000200;
    const MESHRIGHT_NOFILES = 0x00000400;
    const MESHRIGHT_NOAMT = 0x00000800;
    const MESHRIGHT_DESKLIMITEDINPUT = 0x00001000;
    const MESHRIGHT_LIMITEVENTS = 0x00002000;
    const MESHRIGHT_CHATNOTIFY = 0x00004000;
    const MESHRIGHT_UNINSTALL = 0x00008000;
    const MESHRIGHT_NODESKTOP = 0x00010000;
    const MESHRIGHT_REMOTECOMMAND = 0x00020000;
    const MESHRIGHT_RESETOFF = 0x00040000;
    const MESHRIGHT_GUESTSHARING = 0x00080000;
    const MESHRIGHT_DEVICEDETAILS = 0x00100000;
    const MESHRIGHT_RELAY = 0x00200000;
    const MESHRIGHT_NOREGISTRY = 0x00400000;
    const MESHRIGHT_NOSOFTWARE = 0x00800000;
    const MESHRIGHT_ADMIN = 0xFFFFFFFF;

    // Site rights
    const SITERIGHT_SERVERBACKUP = 0x00000001;
    const SITERIGHT_MANAGEUSERS = 0x00000002;
    const SITERIGHT_SERVERRESTORE = 0x00000004;
    const SITERIGHT_FILEACCESS = 0x00000008;
    const SITERIGHT_SERVERUPDATE = 0x00000010;
    const SITERIGHT_LOCKED = 0x00000020;
    const SITERIGHT_NONEWGROUPS = 0x00000040;
    const SITERIGHT_NOMESHCMD = 0x00000080;
    const SITERIGHT_USERGROUPS = 0x00000100;
    const SITERIGHT_RECORDINGS = 0x00000200;
    const SITERIGHT_LOCKSETTINGS = 0x00000400;
    const SITERIGHT_ALLEVENTS = 0x00000800;
    const SITERIGHT_NONEWDEVICES = 0x00001000;
    const SITERIGHT_ADMIN = 0xFFFFFFFF;

    // Setup SSPI authentication if needed
    if ((obj.parent.platform == 'win32') && (obj.args.nousers != true) && (obj.parent.config != null) && (obj.parent.config.domains != null)) {
        for (i in obj.parent.config.domains) { if (obj.parent.config.domains[i].auth == 'sspi') { var nodeSSPI = require('node-sspi'); obj.parent.config.domains[i].sspi = new nodeSSPI({ retrieveGroups: false, offerBasic: false }); } }
    }

    // Perform hash on web certificate and agent certificate
    obj.webCertificateHash = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.web.cert);
    obj.webCertificateHashs = { '': obj.webCertificateHash };
    obj.webCertificateHashBase64 = Buffer.from(obj.webCertificateHash, 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.webCertificateFullHash = parent.certificateOperations.getCertHashBinary(obj.certificates.web.cert);
    obj.webCertificateFullHashs = { '': obj.webCertificateFullHash };
    obj.webCertificateExpire = { '': parent.certificateOperations.getCertificateExpire(parent.certificates.web.cert) };
    obj.agentCertificateHashHex = parent.certificateOperations.getPublicKeyHash(obj.certificates.agent.cert);
    obj.agentCertificateHashBase64 = Buffer.from(obj.agentCertificateHashHex, 'hex').toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    obj.agentCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.agent.cert))).getBytes();
    obj.defaultWebCertificateHash = obj.certificates.webdefault ? parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.webdefault.cert) : null;
    obj.defaultWebCertificateFullHash = obj.certificates.webdefault ? parent.certificateOperations.getCertHashBinary(obj.certificates.webdefault.cert) : null;

    // Compute the hash of all of the web certificates for each domain
    for (var i in obj.parent.config.domains) {
        if (obj.parent.config.domains[i].certhash != null) {
            // If the web certificate hash is provided, use it.
            obj.webCertificateHashs[i] = obj.webCertificateFullHashs[i] = Buffer.from(obj.parent.config.domains[i].certhash, 'hex').toString('binary');
            if (obj.parent.config.domains[i].certkeyhash != null) { obj.webCertificateHashs[i] = Buffer.from(obj.parent.config.domains[i].certkeyhash, 'hex').toString('binary'); }
            delete obj.webCertificateExpire[i]; // Expire time is not provided
        } else if ((obj.parent.config.domains[i].dns != null) && (obj.parent.config.domains[i].certs != null)) {
            // If the domain has a different DNS name, use a different certificate hash.
            // Hash the full certificate
            obj.webCertificateFullHashs[i] = parent.certificateOperations.getCertHashBinary(obj.parent.config.domains[i].certs.cert);
            obj.webCertificateExpire[i] = Date.parse(parent.certificateOperations.forge.pki.certificateFromPem(obj.parent.config.domains[i].certs.cert).validity.notAfter);
            try {
                // Decode a RSA certificate and hash the public key.
                obj.webCertificateHashs[i] = parent.certificateOperations.getPublicKeyHashBinary(obj.parent.config.domains[i].certs.cert);
            } catch (ex) {
                // This may be a ECDSA certificate, hash the entire cert.
                obj.webCertificateHashs[i] = obj.webCertificateFullHashs[i];
            }
        } else if ((obj.parent.config.domains[i].dns != null) && (obj.certificates.dns[i] != null)) {
            // If this domain has a DNS and a matching DNS cert, use it. This case works for wildcard certs.
            obj.webCertificateFullHashs[i] = parent.certificateOperations.getCertHashBinary(obj.certificates.dns[i].cert);
            obj.webCertificateHashs[i] = parent.certificateOperations.getPublicKeyHashBinary(obj.certificates.dns[i].cert);
            obj.webCertificateExpire[i] = Date.parse(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.dns[i].cert).validity.notAfter);
        } else if (i != '') {
            // For any other domain, use the default cert.
            obj.webCertificateFullHashs[i] = obj.webCertificateFullHashs[''];
            obj.webCertificateHashs[i] = obj.webCertificateHashs[''];
            obj.webCertificateExpire[i] = obj.webCertificateExpire[''];
        }
    }

    // If we are running the legacy swarm server, compute the hash for that certificate
    if (parent.certificates.swarmserver != null) {
        obj.swarmCertificateAsn1 = parent.certificateOperations.forge.asn1.toDer(parent.certificateOperations.forge.pki.certificateToAsn1(parent.certificateOperations.forge.pki.certificateFromPem(parent.certificates.swarmserver.cert))).getBytes();
        obj.swarmCertificateHash384 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha384.create(), encoding: 'binary' });
        obj.swarmCertificateHash256 = parent.certificateOperations.forge.pki.getPublicKeyFingerprint(parent.certificateOperations.forge.pki.certificateFromPem(obj.certificates.swarmserver.cert).publicKey, { md: parent.certificateOperations.forge.md.sha256.create(), encoding: 'binary' });
    }

    // Main lists
    obj.wsagents = {};                // NodeId --> Agent
    obj.wsagentsWithBadWebCerts = {}; // NodeId --> Agent
    obj.wsagentsDisconnections = {};
    obj.wsagentsDisconnectionsTimer = null;
    obj.duplicateAgentsLog = {};
    obj.wssessions = {};              // UserId --> Array Of Sessions
    obj.wssessions2 = {};             // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
    obj.wsPeerSessions = {};          // ServerId --> Array Of "UserId + SessionRnd"
    obj.wsPeerSessions2 = {};         // "UserId + SessionRnd" --> ServerId
    obj.wsPeerSessions3 = {};         // ServerId --> UserId --> [ SessionId ]
    obj.sessionsCount = {};           // Merged session counters, used when doing server peering. UserId --> SessionCount
    obj.wsrelays = {};                // Id -> Relay
    obj.desktoprelays = {};           // Id -> Desktop Multiplexer Relay
    obj.wsPeerRelays = {};            // Id -> { ServerId, Time }
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

    // Setup randoms
    obj.crypto.randomBytes(48, function (err, buf) { obj.httpAuthRandom = buf; });
    obj.crypto.randomBytes(16, function (err, buf) { obj.httpAuthRealm = buf.toString('hex'); });
    obj.crypto.randomBytes(48, function (err, buf) { obj.relayRandom = buf; });

    // Get non-english web pages and emails
    getRenderList();
    getEmailLanguageList();

    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    // Fetch all users from the database, keep this in memory
    obj.db.GetAllType('user', function (err, docs) {
        obj.common.unEscapeAllLinksFieldName(docs);
        var domainUserCount = {}, i = 0;
        for (i in parent.config.domains) { domainUserCount[i] = 0; }
        for (i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
        for (i in parent.config.domains) {
            if ((parent.config.domains[i].share == null) && (domainUserCount[i] == 0)) {
                // If newaccounts is set to no new accounts, but no accounts exists, temporarily allow account creation.
                //if ((parent.config.domains[i].newaccounts === 0) || (parent.config.domains[i].newaccounts === false)) { parent.config.domains[i].newaccounts = 2; }
                console.log('Server ' + ((i == '') ? '' : (i + ' ')) + 'has no users, next new account will be site administrator.');
            }
        }

        // Fetch all device groups (meshes) from the database, keep this in memory
        // As we load things in memory, we will also be doing some cleaning up.
        // We will not save any clean up in the database right now, instead it will be saved next time there is a change.
        obj.db.GetAllType('mesh', function (err, docs) {
            obj.common.unEscapeAllLinksFieldName(docs);
            for (var i in docs) { obj.meshes[docs[i]._id] = docs[i]; } // Get all meshes, including deleted ones.

            // Fetch all user groups from the database, keep this in memory
            obj.db.GetAllType('ugrp', function (err, docs) {
                obj.common.unEscapeAllLinksFieldName(docs);

                // Perform user group link cleanup
                for (var i in docs) {
                    const ugrp = docs[i];
                    if (ugrp.links != null) {
                        for (var j in ugrp.links) {
                            if (j.startsWith('user/') && (obj.users[j] == null)) { delete ugrp.links[j]; } // User group has a link to a user that does not exist
                            else if (j.startsWith('mesh/') && ((obj.meshes[j] == null) || (obj.meshes[j].deleted != null))) { delete ugrp.links[j]; } // User has a link to a device group that does not exist
                        }
                    }
                    obj.userGroups[docs[i]._id] = docs[i]; // Get all user groups
                }

                // Mapping between users and groups
                for (var ugrpId in obj.userGroups) {
                    const ugrp = obj.userGroups[ugrpId];
                    if (ugrp.links != null) {
                        for (var userId in ugrp.links) {
                            if (userId.startsWith('user/') && (obj.users[userId] != null)) {
                                const user = obj.users[userId];
                                if (user.links == null) { user.links = {}; }
                                if (user.links[ugrpId] == null) {
                                    // Adding group link to user
                                    user.links[ugrpId] = { rights: ugrp.links[userId].rights || 1 };
                                }
                            }
                        }
                    }
                }

                // Perform device group link cleanup
                for (var i in obj.meshes) {
                    const mesh = obj.meshes[i];
                    if (mesh.links != null) {
                        for (var j in mesh.links) {
                            if (j.startsWith('ugrp/') && (obj.userGroups[j] == null)) { delete mesh.links[j]; } // Device group has a link to a user group that does not exist
                            else if (j.startsWith('user/') && (obj.users[j] == null)) { delete mesh.links[j]; } // Device group has a link to a user that does not exist
                        }
                    }
                }

                // Perform user link cleanup
                for (var i in obj.users) {
                    const user = obj.users[i];
                    if (user.links != null) {
                        for (var j in user.links) {
                            if (j.startsWith('ugrp/') && (obj.userGroups[j] == null)) { delete user.links[j]; } // User has a link to a user group that does not exist
                            else if (j.startsWith('mesh/') && ((obj.meshes[j] == null) || (obj.meshes[j].deleted != null))) { delete user.links[j]; } // User has a link to a device group that does not exist
                            //else if (j.startsWith('node/') && (obj.nodes[j] == null)) { delete user.links[j]; } // TODO
                        }
                        //if (Object.keys(user.links).length == 0) { delete user.links; }
                    }
                }

                // We loaded the users, device groups and user group state, start the server
                serverStart();
            });
        });
    });

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

    const handleLoginChallenge = loginChallengeModule.createLoginChallengeHandler({ state: obj, parent: parent, getQueryPortion: getQueryPortion, getHardwareKeyChallenge: getHardwareKeyChallenge, renderLogin: handleRootRequestLogin, hasDatabaseFailure: emailAccountUtils.hasDatabaseFailure });
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

    // Return a list of server supported features for a given domain and user
    function handleRootRequestLogin(req, res, domain, hardwareKeyChallenge, passRequirements) {
        parent.debug('web', 'handleRootRequestLogin()');
        var features = 0;
        if ((parent.config != null) && (parent.config.settings != null) && ((parent.config.settings.allowframing == true) || (typeof parent.config.settings.allowframing == 'string') || (parent.config.settings.allowedframingorigins != null) || (domain != null && domain.allowedframingorigins != null))) { features += 32; } // Allow site within iframe
        if (domain.usernameisemail) { features += 0x00200000; } // Username is email address
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        var loginmode = 0;
        if (req.session) { loginmode = req.session.loginmode; delete req.session.loginmode; } // Clear this state, if the user hits refresh, we want to go back to the login page.

        // Format an error message if needed
        var passhint = null, msgid = 0;
        if (req.session != null) {
            msgid = req.session.messageid;
            if ((msgid == 5) || (loginmode == 7) || ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true))) { passhint = EscapeHtml(req.session.passhint); }
            delete req.session.messageid;
            delete req.session.passhint;
        }
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        const emailcheck = (allowAccountReset && (domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

        // Check if we are allowed to create new users using the login screen
        var newAccountsAllowed = true;
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true)) { for (var i in obj.users) { if (obj.users[i].domain == domain.id) { newAccountsAllowed = false; break; } } }
        if (parent.config.settings.maintenancemode != null) { newAccountsAllowed = false; }

        // Encrypt the hardware key challenge state if needed
        var hwstate = null;
        if (hardwareKeyChallenge && req.session) {
            const sec = parent.decryptSessionData(req.session.e);
            hwstate = obj.parent.encodeCookie({ u: sec.tuser, p: sec.tpass, c: sec.u2f }, obj.parent.loginCookieEncryptionKey)
        }

        // Check if we can use OTP tokens with email. We can't use email for 2FA password recovery (loginmode 5).
        var otpemail = (loginmode != 5) && (domain.mailserver != null) && (req.session != null) && ((req.session.temail === 1) || (typeof req.session.temail == 'string'));
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.email2factor == false)) { otpemail = false; }
        var otpduo = (req.session != null) && (req.session.tduo === 1);
        if (((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.duo2factor == false)) || (typeof domain.duo2factor != 'object')) { otpduo = false; }
        var otpsms = (parent.smsserver != null) && (req.session != null) && (req.session.tsms === 1);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.sms2factor == false)) { otpsms = false; }
        var otpmsg = (parent.msgserver != null) && (req.session != null) && (req.session.tmsg === 1);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.msg2factor == false)) { otpmsg = false; }
        var otppush = (parent.firebase != null) && (req.session != null) && (req.session.tpush === 1);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.push2factor == false)) { otppush = false; }
        const autofido = ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.autofido2fa == true)); // See if FIDO should be automatically prompted if user account has it.

        // See if we support two-factor trusted cookies
        var twoFactorCookieDays = 30;
        if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

        // See what authentication strategies we have
        var authStrategies = [];
        if (typeof domain.authstrategies == 'object') {
            if (typeof domain.authstrategies.twitter == 'object') { authStrategies.push('twitter'); }
            if (typeof domain.authstrategies.google == 'object') { authStrategies.push('google'); }
            if (typeof domain.authstrategies.github == 'object') { authStrategies.push('github'); }
            if (typeof domain.authstrategies.azure == 'object') { authStrategies.push('azure'); }
            if (typeof domain.authstrategies.oidc == 'object') {
                if (obj.common.validateObject(domain.authstrategies.oidc.custom) && obj.common.validateString(domain.authstrategies.oidc.custom.preset)) {
                    authStrategies.push('oidc-' + domain.authstrategies.oidc.custom.preset);
                } else {
                    authStrategies.push('oidc');
                }
            }
            if (typeof domain.authstrategies.intel == 'object') { authStrategies.push('intel'); }
            if (typeof domain.authstrategies.jumpcloud == 'object') { authStrategies.push('jumpcloud'); }
            if (typeof domain.authstrategies.saml == 'object') { authStrategies.push('saml'); }
        }

        const customui = pageOptionsModule.encodeCustomUi(domain);

        const customFiles = pageOptionsModule.encodeCustomFiles(domain);

        // Get two-factor screen timeout
        var twoFactorTimeout = 300000; // Default is 5 minutes, 0 for no timeout.
        if ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.twofactortimeout == 'number')) {
            twoFactorTimeout = domain.passwordrequirements.twofactortimeout * 1000;
        }

        // Setup CAPTCHA if needed
        var newAccountCaptcha = '', newAccountCaptchaImage = '';
        if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
            newAccountCaptcha = captcha.createNewAccountCookie();
            newAccountCaptchaImage = 'newAccountCaptcha.ashx?x=' + newAccountCaptcha;
        }

        // Check for flash errors from passport.js and make the array unique
        var flashErrors = [];
        if (req.session.flash && req.session.flash.error) {
            flashErrors = obj.common.uniqueArray(req.session.flash.error);
            req.session.flash = null;
        }

        // Render the login page
        // Allow configurable OIDC login button text via domain.authstrategies.oidc.custom
        var oidcButtonIcon, oidcButtonIcon2x, oidcButtonText;
        if (obj.common.validateObject(domain.authstrategies) && obj.common.validateObject(domain.authstrategies.oidc) && obj.common.validateObject(domain.authstrategies.oidc.custom)) {
            if (obj.common.validateUrl(domain.authstrategies.oidc.custom.buttoniconurl)) {
                oidcButtonIcon = domain.authstrategies.oidc.custom.buttoniconurl;
                if (obj.common.validateUrl(domain.authstrategies.oidc.custom.buttoniconurl2x)) {
                    oidcButtonIcon2x = domain.authstrategies.oidc.custom.buttoniconurl2x + ' 2x';
                } else {
                    oidcButtonIcon2x = domain.authstrategies.oidc.custom.buttoniconurl + ' 2x';
                }
            } else {
                switch (domain.authstrategies.oidc.custom.preset) {
                    case 'azure':
                        oidcButtonIcon = "images/login/azure32.png";
                        oidcButtonIcon2x = "images/login/azure64.png 2x";
                        break;
                    case 'google':
                        oidcButtonIcon = "images/login/google32.png";
                        oidcButtonIcon2x = "images/login/google64.png 2x";
                        break;
                    default:
                        oidcButtonIcon = "images/login/oidc32.png";
                        oidcButtonIcon2x = "images/login/oidc64.png 2x";
                }
            }

            if (obj.common.validateString(domain.authstrategies.oidc.custom.buttontext, 1, 128)) {
                oidcButtonText = domain.authstrategies.oidc.custom.buttontext;
            }
        }
        render(req, res,
            getRenderPage((domain.sitestyle >= 2) ? 'login2' : 'login', req, domain),
            getRenderArgs({
                loginmode: loginmode,
                rootCertLink: getRootCertLink(domain),
                newAccount: newAccountsAllowed, // True if new accounts are allowed from the login page
                newAccountPass: (((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1), // 1 if new account creation requires password
                newAccountCaptcha: newAccountCaptcha, // If new account creation requires a CAPTCHA, this string will not be empty
                newAccountCaptchaImage: newAccountCaptchaImage, // Set to the URL of the CAPTCHA image
                serverDnsName: obj.getWebServerName(domain, req),
                serverPublicPort: httpsPort,
                passlogin: (typeof domain.showpasswordlogin == 'boolean') ? domain.showpasswordlogin : true,
                emailcheck: emailcheck,
                features: features,
                sessiontime: (args.sessiontime) ? args.sessiontime : 60, // Session time in minutes, 60 minutes is the default
                passRequirements: passRequirements,
                customui: customui,
                customFiles: customFiles,
                footer: (domain.loginfooter == null) ? '' : obj.common.replacePlaceholders(domain.loginfooter, { 
                    'serverversion': obj.parent.currentVer,
                    'servername': obj.getWebServerName(domain, req),
                    'agentsessions': Object.keys(parent.webserver.wsagents).length,
                    'connectedusers': Object.keys(parent.webserver.wssessions).length,
                    'userssessions': Object.keys(parent.webserver.wssessions2).length,
                    'relaysessions': parent.webserver.relaySessionCount,
                    'relaycount': Object.keys(parent.webserver.wsrelays).length
                }),
                hkey: encodeURIComponent(hardwareKeyChallenge).replace(/'/g, '%27'),
                messageid: msgid,
                flashErrors: JSON.stringify(flashErrors).replace(/"/g, '\\"'),
                passhint: passhint,

                welcometext: domain.welcometext ? encodeURIComponent(obj.common.replacePlaceholders(domain.welcometext, {
                    'serverversion': obj.parent.currentVer,
                    'servername': obj.getWebServerName(domain, req),
                    'agentsessions': Object.keys(parent.webserver.wsagents).length,
                    'connectedusers': Object.keys(parent.webserver.wssessions).length,
                    'userssessions': Object.keys(parent.webserver.wssessions2).length,
                    'relaysessions': parent.webserver.relaySessionCount,
                    'relaycount': Object.keys(parent.webserver.wsrelays).length
                })).split('\'').join('\\\'') : null,
                welcomePictureFullScreen: ((typeof domain.welcomepicturefullscreen == 'boolean') ? domain.welcomepicturefullscreen : false),
                hwstate: hwstate,
                otpemail: otpemail,
                otpduo: otpduo,
                otpsms: otpsms,
                otpmsg: otpmsg,
                otppush: otppush,
                autofido: autofido,
                twoFactorCookieDays: twoFactorCookieDays,
                authStrategies: authStrategies.join(','),
                oidcButtonText: oidcButtonText || '',
                oidcButtonIcon: oidcButtonIcon || 'images/login/oidc32.png',
                oidcButtonIcon2x: oidcButtonIcon2x || 'images/login/oidc64.png 2x',
                loginpicture: (typeof domain.loginpicture == 'string'),
                tokenTimeout: twoFactorTimeout, // Two-factor authentication screen timeout in milliseconds,
                renderLanguages: obj.renderLanguages,
                showLanguageSelect: domain.showlanguageselect ? domain.showlanguageselect : false,
            }, req, domain, (domain.sitestyle >= 2) ? 'login2' : 'login'));
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

        function setupHTTPHandlers() {
            // Setup all HTTP handlers
            const basicRoutes = basicRoutesModule.createBasicRoutes({
                state: obj,
                urlencoded: obj.bodyParser.urlencoded,
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
                    health: function (req, res) { res.send('ok'); }
                }
            });
            const resourceRoutes = resourceRoutesModule.createResourceRoutes({
                state: obj,
                urlencoded: obj.bodyParser.urlencoded,
                hasPlugins: parent.pluginHandler != null,
                hasCrowdSec: parent.crowdSecBounser != null,
                handlers: {
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
                    pluginAdminRequest: obj.handlePluginAdminReq,
                    pluginAdminPostRequest: obj.handlePluginAdminPostReq,
                    pluginScript: obj.handlePluginJS,
                    newAccountCaptchaRequest: handleNewAccountCaptchaRequest,
                    captchaGetRequest: handleCaptchaGetRequest,
                    captchaPostRequest: handleCaptchaPostRequest
                }
            });
            const applicationRoutes = applicationRoutesModule.createApplicationRoutes({
                state: obj,
                parent: parent,
                getDomain: getDomain,
                authorizeWebSocket: PerformWSSessionAuth,
                urlencoded: obj.bodyParser.urlencoded,
                handlers: {
                    mstscRequest: handleMSTSCRequest,
                    firebasePushOnlyRelayRequest: handleFirebasePushOnlyRelayRequest,
                    firebaseRelayRequest: handleFirebaseRelayRequest
                }
            });
            const relayRoutes = relayRoutesModule.createRelayRoutes({
                state: obj,
                parent: parent,
                getDomain: getDomain,
                getWebSocketArgs: getWebsocketArgs,
                authorizeWebSocket: PerformWSSessionAuth,
                authorizeInnerWebSocket: PerformWSSessionInnerAuth,
                relayWebSocket: handleRelayWebSocket
            });
            const passportRoutes = passportRoutesModule.createPassportRoutes({
                state: obj,
                parent: parent,
                flags: domainAuthStrategyConsts,
                getDomain: getDomain,
                strategyLogin: handleStrategyLogin,
                urlencoded: obj.bodyParser.urlencoded
            });
            const duoRoutes = duoRoutesModule.createDuoRoutes({
                state: obj,
                parent: parent,
                getDomain: getDomain,
                getQueryPortion: getQueryPortion,
                setSessionRandom: setSessionRandom
            });
            const agentRoutes = agentRoutesModule.createAgentRoutes({
                state: obj,
                parent: parent,
                checkAgentIpAddress: checkAgentIpAddress,
                authorizeWebSocket: PerformWSSessionAuth,
                createSerialTunnel: SerialTunnel,
                handlers: {
                    agentFileTransfer: handleAgentFileTransfer,
                    meshAgentRequest: obj.handleMeshAgentRequest,
                    agentDownloadFile: handleAgentDownloadFile
                }
            });
            const domainStatic = domainStaticModule.createDomainStatic({ state: obj, parent: parent, getDomain: getDomain });
            if (parent.pluginHandler != null) {
                parent.pluginHandler.callHook('hook_setupHttpHandlers', obj, parent);
            }
            if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req, obj.args.tlsoffload == null); }); }
            obj.webRelayRouter = webRelay.setupRouter();
            for (var i in parent.config.domains) {
                if ((parent.config.domains[i].dns != null) || (parent.config.domains[i].share != null)) { continue; } // This is a subdomain with a DNS name, no added HTTP bindings needed.
                var domain = parent.config.domains[i];
                var url = domain.url;
                basicRoutes.register(domain);
                relayRoutes.register(domain);
                resourceRoutes.register(domain);
                applicationRoutes.register(domain);

                passportRoutes.register(domain);

                duoRoutes.register(domain);
                domainAssets.register(domain);

                agentRoutes.register(domain);
                domainStatic.register(domain);
            }
            domainStatic.startDisconnectionCleanup();
        }
        function finalizeWebserver() {
            // Setup all HTTP handlers
            setupHTTPHandlers()

            // Handle 404 error
            if (obj.args.nice404 !== false) {
                obj.app.use(nice404);
            }

            // Start server on a free port.
            CheckListenPort(obj.args.port, obj.args.portbind, StartWebServer);

            // Start on a second agent-only alternative port if needed.
            if (obj.args.agentport) { CheckListenPort(obj.args.agentport, obj.args.agentportbind, StartAltWebServer); }

            // We are done starting the web server.
            if (doneFunc) doneFunc();
        }
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
