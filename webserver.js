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
    const telemetryModule = require('./webserver/telemetry.js');
    const serialTunnelModule = require('./webserver/serial-tunnel.js');
    const websocketAuthModule = require('./webserver/websocket-auth.js');
    const passwordAuthenticationModule = require('./webserver/password-authentication.js');
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
    const getDomain = networkAccess.getDomain;
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
        checkUserIpAddress: checkUserIpAddress,
        decodeCookie: function (cookie, key, age) { return obj.parent.decodeCookie(cookie, key, age); },
        hashPassword: function (password, callback, iterations) { require('./pass').hash(password, callback, iterations); }
    });
    const handleCheckMailRequest = emailAccountActions.handleCheckMailRequest;
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

    // Clean up a device, used before saving it in the database
    obj.cleanDevice = function (device) {
        // Check device links, if a link points to an unknown user, remove it.
        if (device.links != null) {
            for (var j in device.links) {
                if ((obj.users[j] == null) && (obj.userGroups[j] == null)) {
                    delete device.links[j];
                    if (Object.keys(device.links).length == 0) { delete device.links; }
                }
            }
        }
        return device;
    }

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

    function handleLoginRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.body == null) { res.sendStatus(404); return; } // Post body is empty or can't be parsed
        if (req.session == null) { req.session = {}; }

        // Check if this is a banned ip address
        if (obj.checkAllowLogin(req) == false) {
            // Wait and redirect the user
            setTimeout(function () {
                req.session.messageid = 114; // IP address blocked, try again later.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        // Normally, use the body username/password. If this is a token, use the username/password in the session.
        var xusername = req.body.username, xpassword = req.body.password;
        if ((xusername == null) && (xpassword == null) && (req.body.token != null)) {
            const sec = parent.decryptSessionData(req.session.e);
            xusername = sec.tuser; xpassword = sec.tpass;
        }

        // Authenticate the user
        obj.authenticate(xusername, xpassword, domain, function (err, userid, passhint, loginOptions) {
            if (userid) {
                var user = obj.users[userid];

                // Check if we are in maintenance mode
                if ((parent.config.settings.maintenancemode != null) && (user.siteadmin != 4294967295)) {
                    req.session.messageid = 115; // Server under maintenance
                    req.session.loginmode = 1;
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.email != null) && (user.emailVerified == true) && (user.otpekey != null));
                var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                var push2fa = ((parent.firebase != null) && (user.otpdev != null));
                var duo2fa = ((((typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) || ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.duo2factor != false))) && (user.otpduo != null));

                // Check if two factor can be skipped
                const twoFactorSkip = checkUserOneTimePasswordSkip(domain, user, req, loginOptions);

                // Check if this user has 2-step login active
                if ((twoFactorSkip == null) && (req.session.loginmode != 6) && checkUserOneTimePasswordRequired(domain, user, req, loginOptions)) {
                    if ((req.body.hwtoken == '**timeout**')) {
                        delete req.session; // Clear the session
                        res.redirect(domain.url + getQueryPortion(req));
                        return;
                    }

                    if ((req.body.hwtoken == '**email**') && email2fa) {
                        user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                        obj.db.SetUser(user);
                        parent.debug('web', 'Sending 2FA email to: ' + user.email);
                        domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                        req.session.messageid = 2; // "Email sent" message
                        req.session.loginmode = 4;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    if ((req.body.hwtoken == '**sms**') && sms2fa) {
                        // Cause a token to be sent to the user's phone number
                        user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                        obj.db.SetUser(user);
                        parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                        parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                        // Ask for a login token & confirm sms was sent
                        req.session.messageid = 4; // "SMS sent" message
                        req.session.loginmode = 4;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    if ((req.body.hwtoken == '**msg**') && msg2fa) {
                        // Cause a token to be sent to the user's messenger account
                        user.otpmsg = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                        obj.db.SetUser(user);
                        parent.debug('web', 'Sending 2FA message to: ' + user.msghandle);
                        parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, obj.getLanguageCodes(req));
                        // Ask for a login token & confirm message was sent
                        req.session.messageid = 6; // "Message sent" message
                        req.session.loginmode = 4;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    if ((req.body.hwtoken == '**duo**') && duo2fa && (typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) {
                        // Redirect to duo here
                        const duo = require('@duosecurity/duo_universal');
                        const client = new duo.Client({
                            clientId: domain.duo2factor.integrationkey,
                            clientSecret: domain.duo2factor.secretkey,
                            apiHost: domain.duo2factor.apihostname,
                            redirectUrl: obj.generateBaseURL(domain, req) + 'auth-duo' + (domain.loginkey != null ? ('?key=' + domain.loginkey) : '')
                        });
                        // Decrypt any session data
                        const sec = parent.decryptSessionData(req.session.e);
                        sec.duostate = client.generateState();
                        req.session.e = parent.encryptSessionData(sec);
                        parent.debug('web', 'Redirecting user ' + user._id + ' to Duo');
                        res.redirect(client.createAuthUrl(user._id.split('/')[2], sec.duostate));
                        return;
                    }

                    // Handle device push notification 2FA request
                    // We create a browser cookie, send it back and when the browser connects it's web socket, it will trigger the push notification.
                    if ((req.body.hwtoken == '**push**') && push2fa && ((domain.passwordrequirements == null) || (domain.passwordrequirements.push2factor != false))) {
                        const logincodeb64 = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                        const sessioncode = obj.crypto.randomBytes(24).toString('base64');

                        // Create a browser cookie so the browser can connect using websocket and wait for device accept/reject.
                        const browserCookie = parent.encodeCookie({ a: 'waitAuth', c: logincodeb64, u: user._id, n: user.otpdev, s: sessioncode, d: domain.id });

                        // Get the HTTPS port
                        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port if specified

                        // Get the agent connection server name
                        var serverName = obj.getWebServerName(domain, req);
                        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

                        // Build the connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                        var xdomain = (domain.dns == null) ? domain.id : '';
                        if (xdomain != '') xdomain += '/';
                        var url = 'wss://' + serverName + ':' + httpsPort + '/' + xdomain + '2fahold.ashx?c=' + browserCookie;

                        // Request that the login page wait for device auth
                        req.session.messageid = 5; // "Sending notification..." message
                        req.session.passhint = url;
                        req.session.loginmode = 8;
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        return;
                    }

                    checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result, authData) {
                        if (result == false) {
                            var randomWaitTime = 0;

                            // Check if 2FA is allowed for this IP address
                            if (obj.checkAllow2Fa(req) == false) {
                                // Wait and redirect the user
                                setTimeout(function () {
                                    req.session.messageid = 114; // IP address blocked, try again later.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                                return;
                            }

                            // 2-step auth is required, but the token is not present or not valid.
                            if ((req.body.token != null) || (req.body.hwtoken != null)) {
                                randomWaitTime = 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095); // This is a fail, wait a random time. 2 to 6 seconds.
                                req.session.messageid = 108; // Invalid token, try again.
                                obj.parent.authLog('https', 'Failed 2FA for ' + xusername + ' from ' + cleanRemoteAddr(req.clientIp) + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'] });
                                parent.debug('web', 'handleLoginRequest: invalid 2FA token');
                                const ua = obj.getUserAgentInfo(req);
                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                                obj.setbad2Fa(req);
                            } else {
                                parent.debug('web', 'handleLoginRequest: 2FA token required');
                            }

                            // Wait and redirect the user
                            setTimeout(function () {
                                req.session.loginmode = 4;
                                if ((user.email != null) && (user.emailVerified == true) && (domain.mailserver != null) && (user.otpekey != null)) { req.session.temail = 1; } else { delete req.session.temail; }
                                if ((user.phone != null) && (parent.smsserver != null)) { req.session.tsms = 1; } else { delete req.session.tsms; }
                                if ((user.msghandle != null) && (parent.msgserver != null) && (parent.msgserver.providers != 0)) { req.session.tmsg = 1; } else { delete req.session.tmsg; }
                                if ((user.otpdev != null) && (parent.firebase != null)) { req.session.tpush = 1; } else { delete req.session.tpush; }
                                if ((user.otpduo != null)) { req.session.tduo = 1; } else { delete req.session.tduo; }
                                req.session.e = parent.encryptSessionData({ tuserid: userid, tuser: xusername, tpass: xpassword });
                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                            }, randomWaitTime);
                        } else {
                            // Check if we need to remember this device
                            if ((req.body.remembertoken === 'on') && ((domain.twofactorcookiedurationdays == null) || (domain.twofactorcookiedurationdays > 0))) {
                                var maxCookieAge = domain.twofactorcookiedurationdays;
                                if (typeof maxCookieAge != 'number') { maxCookieAge = 30; }
                                const twoFactorCookie = obj.parent.encodeCookie({ userid: user._id, expire: maxCookieAge * 24 * 60 /*, ip: req.clientIp*/ }, obj.parent.loginCookieEncryptionKey);
                                res.cookie('twofactor', twoFactorCookie, { maxAge: (maxCookieAge * 24 * 60 * 60 * 1000), httpOnly: true, sameSite: parent.config.settings.sessionsamesite, secure: true });
                            }

                            // Check if email address needs to be confirmed
                            const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))
                            if (emailcheck && (user.emailVerified !== true)) {
                                parent.debug('web', 'Redirecting using ' + user.name + ' to email check login page');
                                req.session.messageid = 3; // "Email verification required" message
                                req.session.loginmode = 7;
                                req.session.passhint = user.email;
                                req.session.cuserid = userid;
                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                return;
                            }

                            // Login successful
                            parent.debug('web', 'handleLoginRequest: successful 2FA login');
                            if (authData != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = authData.twoFactorType; }
                            completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions);
                        }
                    });
                    return;
                }

                // Check if email address needs to be confirmed
                const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))
                if (emailcheck && (user.emailVerified !== true)) {
                    parent.debug('web', 'Redirecting using ' + user.name + ' to email check login page');
                    req.session.messageid = 3; // "Email verification required" message
                    req.session.loginmode = 7;
                    req.session.passhint = user.email;
                    req.session.cuserid = userid;
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                // Login successful
                parent.debug('web', 'handleLoginRequest: successful login');
                if (twoFactorSkip != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = twoFactorSkip.twoFactorType; }
                completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions);
            } else {
                // Login failed, log the error
                obj.parent.authLog('https', 'Failed password for ' + xusername + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'] });

                // Wait a random delay
                setTimeout(function () {
                    // If the account is locked, display that.
                    if (typeof xusername == 'string') {
                        var xuserid = 'user/' + domain.id + '/' + xusername.toLowerCase();
                        if (err == 'locked') {
                            parent.debug('web', 'handleLoginRequest: login failed, locked account');
                            req.session.messageid = 110; // Account locked.
                            const ua = obj.getUserAgentInfo(req);
                            obj.parent.DispatchEvent(['*', 'server-users', xuserid], obj, { action: 'authfail', userid: xuserid, username: xusername, domain: domain.id, msg: 'User login attempt on locked account from ' + req.clientIp, msgid: 109, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                            obj.setbadLogin(req);
                        } else if (err == 'denied') {
                            parent.debug('web', 'handleLoginRequest: login failed, access denied');
                            req.session.messageid = 111; // Access denied.
                            const ua = obj.getUserAgentInfo(req);
                            obj.parent.DispatchEvent(['*', 'server-users', xuserid], obj, { action: 'authfail', userid: xuserid, username: xusername, domain: domain.id, msg: 'Denied user login from ' + req.clientIp, msgid: 155, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                            obj.setbadLogin(req);
                        } else {
                            parent.debug('web', 'handleLoginRequest: login failed, bad username and password');
                            req.session.messageid = 112; // Login failed, check username and password.
                            const ua = obj.getUserAgentInfo(req);
                            obj.parent.DispatchEvent(['*', 'server-users', xuserid], obj, { action: 'authfail', userid: xuserid, username: xusername, domain: domain.id, msg: 'Invalid user login attempt from ' + req.clientIp, msgid: 110, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                            obj.setbadLogin(req);
                        }
                    }

                    // Clean up login mode and display password hint if present.
                    delete req.session.loginmode;
                    if ((passhint != null) && (passhint.length > 0)) {
                        req.session.passhint = passhint;
                    } else {
                        delete req.session.passhint;
                    }

                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095)); // Wait for 2 to ~6 seconds.
            }
        });
    }

    function completeLoginRequest(req, res, domain, user, userid, xusername, xpassword, direct, loginOptions) {
        // Check if we need to change the password
        if ((typeof user.passchange == 'number') && ((user.passchange == -1) || ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.reset == 'number') && (user.passchange + (domain.passwordrequirements.reset * 86400) < Math.floor(Date.now() / 1000))))) {
            // Request a password change
            parent.debug('web', 'handleLoginRequest: login ok, password change requested');
            req.session.loginmode = 6;
            req.session.messageid = 113; // Password change requested.

            // Decrypt any session data
            const sec = parent.decryptSessionData(req.session.e);
            sec.rtuser = xusername;
            sec.rtpass = xpassword;
            sec.rtreset = true;
            req.session.e = parent.encryptSessionData(sec);

            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Save login time
        user.pastlogin = user.login;
        user.login = user.access = Math.floor(Date.now() / 1000);
        obj.db.SetUser(user);

        // Notify account login
        const targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
        const ua = obj.getUserAgentInfo(req);
        const loginEvent = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login from ' + req.clientIp + ', ' + ua.browserStr + ', ' + ua.osStr, domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'], rport: req.connection.remotePort };
        if (loginOptions != null) {
            if ((loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) { loginEvent.tokenName = loginOptions.tokenName; loginEvent.tokenUser = loginOptions.tokenUser; } // If a login token was used, add it to the event.
            if (loginOptions.twoFactorType != null) { loginEvent.twoFactorType = loginOptions.twoFactorType; }
        }
        obj.parent.DispatchEvent(targets, obj, loginEvent);

        // Regenerate session when signing in to prevent fixation
        //req.session.regenerate(function () {
        // Store the user's primary key in the session store to be retrieved, or in this case the entire user object
        delete req.session.e;
        delete req.session.u2f;
        delete req.session.loginmode;
        delete req.session.tuserid;
        delete req.session.tuser;
        delete req.session.tpass;
        delete req.session.temail;
        delete req.session.tsms;
        delete req.session.tmsg;
        delete req.session.tduo;
        delete req.session.tpush;
        delete req.session.messageid;
        delete req.session.passhint;
        delete req.session.cuserid;
        delete req.session.expire;
        delete req.session.currentNode;
        req.session.userid = userid;
        req.session.ip = req.clientIp;
        setSessionRandom(req);
        obj.parent.authLog('https', 'Accepted password for ' + (xusername ? xusername : userid) + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'], sessionid: req.session.x });

        // If a login token was used, add this information and expire time to the session.
        if ((loginOptions != null) && (loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) {
            req.session.loginToken = loginOptions.tokenUser;
            if (loginOptions.expire != null) { req.session.expire = loginOptions.expire; }
        }

        if (req.body.viewmode) { req.session.viewmode = req.body.viewmode; }
        if (req.body.host) {
            // TODO: This is a terrible search!!! FIX THIS.
            /*
            obj.db.GetAllType('node', function (err, docs) {
                for (var i = 0; i < docs.length; i++) {
                    if (docs[i].name == req.body.host) {
                        req.session.currentNode = docs[i]._id;
                        break;
                    }
                }
                console.log("CurrentNode: " + req.session.currentNode);
                // This redirect happens after finding node is completed
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            });
            */
            parent.debug('web', 'handleLoginRequest: login ok (1)');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); } // Temporary
        } else {
            parent.debug('web', 'handleLoginRequest: login ok (2)');
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        }
        //});
    }

    function handleCreateAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handleCreateAccountRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token
        if (req.body == null) { res.sendStatus(404); return; } // Post body is empty or can't be parsed

        // Check if we are in maintenance mode
        if (parent.config.settings.maintenancemode != null) {
            req.session.messageid = 115; // Server under maintenance
            req.session.loginmode = 1;
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Always lowercase the email address
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }

        // If the email is the username, set this here.
        if (domain.usernameisemail) { req.body.username = req.body.email; }

        // Check if there is domain.newAccountToken, check if supplied token is valid
        if ((domain.newaccountspass != null) && (domain.newaccountspass != '') && (req.body.newaccountspass != domain.newaccountspass)) {
            parent.debug('web', 'handleCreateAccountRequest: Invalid account creation token');
            req.session.loginmode = 2;
            req.session.messageid = 103; // Invalid account creation token.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // If needed, check the new account creation CAPTCHA
        if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
            const c = parent.decodeCookie(req.body.captchaargs, parent.loginCookieEncryptionKey, 10); // 10 minute timeout
            if ((c == null) || (c.type != 'newAccount') || (typeof c.captcha != 'string') || (c.captcha.length < 5) || (c.captcha != req.body.anewaccountcaptcha)) {
                req.session.loginmode = 2;
                req.session.messageid = 117; // Invalid security check
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        }

        // Accounts that start with ~ are not allowed
        if ((typeof req.body.username != 'string') || (req.body.username.length < 1) || (req.body.username[0] == '~')) {
            parent.debug('web', 'handleCreateAccountRequest: unable to create account (0)');
            req.session.loginmode = 2;
            req.session.messageid = 100; // Unable to create account.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Count the number of users in this domain
        var domainUserCount = 0;
        for (var i in obj.users) { if (obj.users[i].domain == domain.id) { domainUserCount++; } }

        // Check if we are allowed to create new users using the login screen
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true) && (domainUserCount > 0)) {
            parent.debug('web', 'handleCreateAccountRequest: domainUserCount > 1.');
            res.sendStatus(401);
            return;
        }

        // Check if this request is for an allows email domain
        if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains)) {
            var i = -1;
            if (typeof req.body.email == 'string') { i = req.body.email.indexOf('@'); }
            if (i == -1) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (1)');
                req.session.loginmode = 2;
                req.session.messageid = 100; // Unable to create account.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
            var emailok = false, emaildomain = req.body.email.substring(i + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emaildomain == domain.newaccountemaildomains[i].toLowerCase()) { emailok = true; } }
            if (emailok == false) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (2)');
                req.session.loginmode = 2;
                req.session.messageid = 100; // Unable to create account.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        }

        // Check if we exceed the maximum number of user accounts
        obj.db.isMaxType(domain.limits.maxuseraccounts, 'user', domain.id, function (maxExceed) {
            if (maxExceed) {
                parent.debug('web', 'handleCreateAccountRequest: account limit reached');
                req.session.loginmode = 2;
                req.session.messageid = 101; // Account limit reached.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            } else {
                if (!obj.common.validateUsername(req.body.username, 1, 64) || !obj.common.validateEmail(req.body.email, 1, 256) || !obj.common.validateString(req.body.password1, 1, 256) || !obj.common.validateString(req.body.password2, 1, 256) || (req.body.password1 != req.body.password2) || req.body.username == '~' || !obj.common.checkPasswordRequirements(req.body.password1, domain.passwordrequirements)) {
                    parent.debug('web', 'handleCreateAccountRequest: unable to create account (3)');
                    req.session.loginmode = 2;
                    req.session.messageid = 100; // Unable to create account.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                } else {
                    // Check if this email was already verified
                    obj.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (err, docs) {
                        if ((docs != null) && (docs.length > 0)) {
                            parent.debug('web', 'handleCreateAccountRequest: Existing account with this email address');
                            req.session.loginmode = 2;
                            req.session.messageid = 102; // Existing account with this email address.
                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        } else {
                            // Check if user exists
                            if (obj.users['user/' + domain.id + '/' + req.body.username.toLowerCase()]) {
                                parent.debug('web', 'handleCreateAccountRequest: Username already exists');
                                req.session.loginmode = 2;
                                req.session.messageid = 104; // Username already exists.
                            } else {
                                var user = { type: 'user', _id: 'user/' + domain.id + '/' + req.body.username.toLowerCase(), name: req.body.username, email: req.body.email, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                                if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                                if (obj.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                                if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) { hint = hint.substring(0, 250); } user.passhint = hint; }
                                if (domainUserCount == 0) { user.siteadmin = 4294967295; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.

                                // Auto-join any user groups
                                if (typeof domain.newaccountsusergroups == 'object') {
                                    for (var i in domain.newaccountsusergroups) {
                                        var ugrpid = domain.newaccountsusergroups[i];
                                        if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                                        var ugroup = obj.userGroups[ugrpid];
                                        if (ugroup != null) {
                                            // Add group to the user
                                            if (user.links == null) { user.links = {}; }
                                            user.links[ugroup._id] = { rights: 1 };

                                            // Add user to the group
                                            ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                            db.Set(ugroup);

                                            // Notify user group change
                                            var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                            if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                            parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                                        }
                                    }
                                }

                                obj.users[user._id] = user;
                                req.session.userid = user._id;
                                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                                setSessionRandom(req);
                                // Create a user, generate a salt and hash the password
                                require('./pass').hash(req.body.password1, function (err, salt, hash, tag) {
                                    if (err) throw err;
                                    user.salt = salt;
                                    user.hash = hash;
                                    delete user.passtype;
                                    obj.db.SetUser(user);

                                    // Send the verification email
                                    if ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (obj.common.validateEmail(user.email, 1, 256) == true)) { domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key); }
                                }, 0);
                                var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id };
                                if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                                obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                            }
                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                        }
                    });
                }
            }
        });
    }

    // Called to process an account password reset
    function handleResetPasswordRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token
        if (req.body == null) { res.sendStatus(404); return; } // Post body is empty or can't be parsed

        // Decrypt any session data
        const sec = parent.decryptSessionData(req.session.e);

        // Check everything is ok
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false) || (sec.rtreset === true));
        if ((allowAccountReset === false) || (domain == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.body.rpassword1 != 'string') || (typeof req.body.rpassword2 != 'string') || (req.body.rpassword1 != req.body.rpassword2) || (typeof req.body.rpasswordhint != 'string') || (req.session == null) || (typeof sec.rtuser != 'string') || (typeof sec.rtpass != 'string')) {
            parent.debug('web', 'handleResetPasswordRequest: checks failed');
            delete req.session.e;
            delete req.session.u2f;
            delete req.session.loginmode;
            delete req.session.tuserid;
            delete req.session.tuser;
            delete req.session.tpass;
            delete req.session.temail;
            delete req.session.tsms;
            delete req.session.tmsg;
            delete req.session.tpush;
            delete req.session.messageid;
            delete req.session.passhint;
            delete req.session.cuserid;
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        // Authenticate the user
        obj.authenticate(sec.rtuser, sec.rtpass, domain, function (err, userid, passhint, loginOptions) {
            if (userid) {
                // Login
                var user = obj.users[userid];

                // If we have password requirements, check this here.
                if (!obj.common.checkPasswordRequirements(req.body.rpassword1, domain.passwordrequirements)) {
                    parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (1)');
                    req.session.loginmode = 6;
                    req.session.messageid = 105; // Password rejected, use a different one.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    return;
                }

                // Check if the password is the same as a previous one
                obj.checkOldUserPasswords(domain, user, req.body.rpassword1, function (result) {
                    if (result != 0) {
                        // This is the same password as an older one, request a password change again
                        parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (2)');
                        req.session.loginmode = 6;
                        req.session.messageid = 105; // Password rejected, use a different one.
                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                    } else {
                        // Update the password, use a different salt.
                        require('./pass').hash(req.body.rpassword1, function (err, salt, hash, tag) {
                            const nowSeconds = Math.floor(Date.now() / 1000);
                            if (err) { parent.debug('web', 'handleResetPasswordRequest: hash error.'); throw err; }

                            if (domain.passwordrequirements != null) {
                                // Save password hint if this feature is enabled
                                if ((domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) { var hint = req.body.apasswordhint; if (hint.length > 250) hint = hint.substring(0, 250); user.passhint = hint; } else { delete user.passhint; }

                                // Save previous password if this feature is enabled
                                if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                    if (user.oldpasswords == null) { user.oldpasswords = []; }
                                    user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                    const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                    if (extraOldPasswords > 0) { user.oldpasswords.splice(0, extraOldPasswords); }
                                }
                            }

                            user.salt = salt;
                            user.hash = hash;
                            user.passchange = user.access = nowSeconds;
                            delete user.passtype;
                            obj.db.SetUser(user);

                            // Event the account change
                            var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'User password reset', domain: domain.id };
                            if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                            obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, event);

                            // Login successful
                            parent.debug('web', 'handleResetPasswordRequest: success');
                            req.session.userid = userid;
                            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                            setSessionRandom(req);
                            const sec = parent.decryptSessionData(req.session.e);
                            completeLoginRequest(req, res, domain, obj.users[userid], userid, sec.tuser, sec.tpass, direct, loginOptions);
                        }, 0);
                    }
                }, 0);
            } else {
                // Failed, error out.
                parent.debug('web', 'handleResetPasswordRequest: failed authenticate()');
                delete req.session.e;
                delete req.session.u2f;
                delete req.session.loginmode;
                delete req.session.tuserid;
                delete req.session.tuser;
                delete req.session.tpass;
                delete req.session.temail;
                delete req.session.tsms;
                delete req.session.tmsg;
                delete req.session.tpush;
                delete req.session.messageid;
                delete req.session.passhint;
                delete req.session.cuserid;
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        });
    }

    // Called to process an account reset request
    function handleResetAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        if ((allowAccountReset === false) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (obj.args.lanonly == true) || (obj.parent.certificates.CommonName == null) || (obj.parent.certificates.CommonName.indexOf('.') == -1)) { parent.debug('web', 'handleResetAccountRequest: check failed'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token
        if (req.body == null) { res.sendStatus(404); return; } // Post body is empty or can't be parsed

        // Always lowercase the email address
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }

        // Get the email from the body or session.
        var email = req.body.email;
        if ((email == null) || (email == '')) { email = req.session.temail; }

        // Check the email string format
        if (!email || checkEmail(email) == false) {
            parent.debug('web', 'handleResetAccountRequest: Invalid email');
            req.session.loginmode = 3;
            req.session.messageid = 106; // Invalid email.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        } else {
            obj.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
                // Remove all accounts that start with ~ since they are special accounts.
                var cleanDocs = [];
                if ((err == null) && (docs.length > 0)) {
                    for (var i in docs) {
                        const user = docs[i];
                        const locked = ((user.siteadmin != null) && (user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)); // No password recovery for locked accounts
                        const specialAccount = (user._id.split('/')[2].startsWith('~')); // No password recovery for special accounts
                        if ((specialAccount == false) && (locked == false)) { cleanDocs.push(user); }
                    }
                }
                docs = cleanDocs;

                // Check if we have any account that match this email address
                if ((err != null) || (docs.length == 0)) {
                    parent.debug('web', 'handleResetAccountRequest: Account not found');
                    req.session.loginmode = 3;
                    req.session.messageid = 1; // If valid, reset mail sent. Instead of "Account not found" (107), we send this hold on message so users can't know if this account exists or not.
                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                } else {
                    // If many accounts have the same validated e-mail, we are going to use the first one for display, but sent a reset email for all accounts.
                    var responseSent = false;
                    for (var i in docs) {
                        var user = docs[i];
                        if (checkUserOneTimePasswordRequired(domain, user, req) == true) {
                            // Second factor setup, request it now.
                            checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result, authData) {
                                if (result == false) {
                                    if (i == 0) {

                                        // Check if 2FA is allowed for this IP address
                                        if (obj.checkAllow2Fa(req) == false) {
                                            // Wait and redirect the user
                                            setTimeout(function () {
                                                req.session.messageid = 114; // IP address blocked, try again later.
                                                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                            }, 2000 + (obj.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                                            return;
                                        }

                                        // 2-step auth is required, but the token is not present or not valid.
                                        parent.debug('web', 'handleResetAccountRequest: Invalid 2FA token, try again');
                                        if ((req.body.token != null) || (req.body.hwtoken != null)) {
                                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                            var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                                            if ((req.body.hwtoken == '**sms**') && sms2fa) {
                                                // Cause a token to be sent to the user's phone number
                                                user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA SMS for password recovery to: ' + user.phone);
                                                parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                                req.session.messageid = 4; // SMS sent.
                                            } else if ((req.body.hwtoken == '**msg**') && msg2fa) {
                                                // Cause a token to be sent to the user's messager account
                                                user.otpmsg = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA message for password recovery to: ' + user.msghandle);
                                                parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, obj.getLanguageCodes(req));
                                                req.session.messageid = 6; // Message sent.
                                            } else {
                                                req.session.messageid = 108; // Invalid token, try again.
                                                const ua = obj.getUserAgentInfo(req);
                                                obj.parent.DispatchEvent(['*', 'server-users', user._id], obj, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                                                obj.setbad2Fa(req);
                                            }
                                        }
                                        req.session.loginmode = 5;
                                        req.session.temail = email;
                                        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                    }
                                } else {
                                    // Send email to perform recovery.
                                    delete req.session.temail;
                                    if (domain.mailserver != null) {
                                        domain.mailserver.sendAccountResetMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);
                                        if (i == 0) {
                                            parent.debug('web', 'handleResetAccountRequest: Hold on, reset mail sent.');
                                            req.session.loginmode = 1;
                                            req.session.messageid = 1; // If valid, reset mail sent.
                                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                        }
                                    } else {
                                        if (i == 0) {
                                            parent.debug('web', 'handleResetAccountRequest: Unable to sent email.');
                                            req.session.loginmode = 3;
                                            req.session.messageid = 109; // Unable to sent email.
                                            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                        }
                                    }
                                }
                            });
                        } else {
                            // No second factor, send email to perform recovery.
                            if (domain.mailserver != null) {
                                domain.mailserver.sendAccountResetMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);
                                if (i == 0) {
                                    parent.debug('web', 'handleResetAccountRequest: Hold on, reset mail sent.');
                                    req.session.loginmode = 1;
                                    req.session.messageid = 1; // If valid, reset mail sent.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }
                            } else {
                                if (i == 0) {
                                    parent.debug('web', 'handleResetAccountRequest: Unable to sent email.');
                                    req.session.loginmode = 3;
                                    req.session.messageid = 109; // Unable to sent email.
                                    if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Handle account email change and email verification request
    function handleCheckAccountEmailRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (!emailAccountUtils.hasAccountEmailRequest(req)) { parent.debug('web', 'handleCheckAccountEmailRequest: missing session or body.'); res.sendStatus(404); return; }
        var email = emailAccountUtils.resolveAccountEmail(req);
        if ((domain.mailserver == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.session.cuserid != 'string') || (obj.users[req.session.cuserid] == null) || (!obj.common.validateEmail(email, 1, 256))) { parent.debug('web', 'handleCheckAccountEmailRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if (req.session.loginToken != null) { res.sendStatus(404); return; } // Do not allow this command when logged in using a login token
        // Check if this request is for an allows email domain
        if ((domain.newaccountemaildomains != null) && Array.isArray(domain.newaccountemaildomains)) {
            var i = -1;
            if (typeof email == 'string') { i = email.indexOf('@'); }
            if (i == -1) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (1)');
                req.session.loginmode = 7;
                req.session.messageid = 106; // Invalid email.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
            var emailok = false, emaildomain = email.substring(i + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emaildomain == domain.newaccountemaildomains[i].toLowerCase()) { emailok = true; } }
            if (emailok == false) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (2)');
                req.session.loginmode = 7;
                req.session.messageid = 106; // Invalid email.
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
                return;
            }
        }

        // Check the email string format
        if (!email || checkEmail(email) == false) {
            parent.debug('web', 'handleCheckAccountEmailRequest: Invalid email');
            req.session.loginmode = 7;
            req.session.messageid = 106; // Invalid email.
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
        } else {
            // Check is email already exists
            obj.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
                if (emailAccountUtils.hasDatabaseFailure(err, docs) || emailAccountUtils.hasOtherVerifiedUser(docs, req.session.cuserid)) {
                    // Email already exists
                    req.session.messageid = 102; // Existing account with this email address.
                } else {
                    // Update the user and notify of user email address change
                    var user = emailAccountUtils.getActiveUser(obj.users, req.session.cuserid);
                    if (user == null) {
                        req.session.messageid = 100; // Unable to create account.
                    } else if (user.email != email) {
                        user.email = email;
                        db.SetUser(user);
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msg: 'Account changed: ' + user.name, domain: domain.id };
                        if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.DispatchEvent(targets, obj, event);
                    }

                    if (user != null) {
                        // Send the verification email
                        domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, obj.getLanguageCodes(req), req.query.key);

                        // Send the response
                        req.session.messageid = 2; // Email sent.
                    }
                }
                req.session.loginmode = 7;
                delete req.session.cuserid;
                if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            });
        }
    }

    Object.assign(obj, passwordHistoryModule.createPasswordHistory({ debug: function (source, message) { parent.debug(source, message); }, require: require }));

    // Indicates that any request to "/" should render "default" or "login" depending on login state
    function handleRootRequestEx(req, res, domain, direct) {
        var nologout = false, user = null;
        res.set({ 'Cache-Control': 'no-store' });

        // Check if we have an incomplete domain name in the path
        if ((domain.id != '') && (domain.dns == null) && (req.url.split('/').length == 2)) {
            parent.debug('web', 'handleRootRequestEx: incomplete domain name in the path.');
            res.redirect(domain.url + getQueryPortion(req)); // BAD***
            return;
        }

        if (obj.args.nousers == true) {
            // If in single user mode, setup things here.
            delete req.session.loginmode;
            req.session.userid = 'user/' + domain.id + '/~';
            delete req.session.currentNode;
            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
            setSessionRandom(req);
            if (obj.users[req.session.userid] == null) {
                // Create the dummy user ~ with impossible password
                parent.debug('web', 'handleRootRequestEx: created dummy user in nouser mode.');
                obj.users[req.session.userid] = { type: 'user', _id: req.session.userid, name: '~', email: '~', domain: domain.id, siteadmin: 4294967295 };
                obj.db.SetUser(obj.users[req.session.userid]);
            }
        } else if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
            // If a default user is active, setup the session here.
            parent.debug('web', 'handleRootRequestEx: auth using default user.');
            delete req.session.loginmode;
            req.session.userid = 'user/' + domain.id + '/' + obj.args.user.toLowerCase();
            delete req.session.currentNode;
            req.session.ip = req.clientIp; // Bind this session to the IP address of the request
            setSessionRandom(req);
        } else if (req.query.login && (obj.parent.loginCookieEncryptionKey != null)) {
            var loginCookie = obj.parent.decodeCookie(req.query.login, obj.parent.loginCookieEncryptionKey, 60); // 60 minute timeout
            //if ((loginCookie != null) && (loginCookie.ip != null) && !checkCookieIp(loginCookie.ip, req.clientIp)) { loginCookie = null; } // If the cookie is bound to an IP address, check here.
            if ((loginCookie != null) && (loginCookie.a == 3) && (loginCookie.u != null) && (loginCookie.u.split('/')[1] == domain.id)) {
                // If a login cookie was provided, setup the session here.
                parent.debug('web', 'handleRootRequestEx: cookie auth ok.');
                delete req.session.loginmode;
                req.session.userid = loginCookie.u;
                delete req.session.currentNode;
                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                setSessionRandom(req);
            } else {
                parent.debug('web', 'handleRootRequestEx: cookie auth failed.');
            }
        } else if (domain.sspi != null) {
            // SSPI login (Windows only)
            //console.log(req.connection.user, req.connection.userSid);
            if ((req.connection.user == null) || (req.connection.userSid == null)) {
                parent.debug('web', 'handleRootRequestEx: SSPI no user auth.');
                res.sendStatus(404); return;
            } else {
                nologout = true;
                req.session.userid = 'user/' + domain.id + '/' + req.connection.user.toLowerCase();
                req.session.usersid = req.connection.userSid;
                req.session.usersGroups = req.connection.userGroups;
                delete req.session.currentNode;
                req.session.ip = req.clientIp; // Bind this session to the IP address of the request
                setSessionRandom(req);
                obj.parent.authLog('https', 'Accepted SSPI-auth for ' + req.connection.user + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'], sessionid: req.session.x });

                // Check if this user exists, create it if not.
                user = obj.users[req.session.userid];
                if ((user == null) || (user.sid != req.session.usersid)) {
                    // Create the domain user
                    var usercount = 0, user2 = { type: 'user', _id: req.session.userid, name: req.connection.user, domain: domain.id, sid: req.session.usersid, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000) };
                    if (domain.newaccountsrights) { user2.siteadmin = domain.newaccountsrights; }
                    if (obj.common.validateStrArray(domain.newaccountrealms)) { user2.groups = domain.newaccountrealms; }
                    for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                    if (usercount == 0) { user2.siteadmin = 4294967295; } // If this is the first user, give the account site admin.

                    // Auto-join any user groups
                    if (typeof domain.newaccountsusergroups == 'object') {
                        for (var i in domain.newaccountsusergroups) {
                            var ugrpid = domain.newaccountsusergroups[i];
                            if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                            var ugroup = obj.userGroups[ugrpid];
                            if (ugroup != null) {
                                // Add group to the user
                                if (user2.links == null) { user2.links = {}; }
                                user2.links[ugroup._id] = { rights: 1 };

                                // Add user to the group
                                ugroup.links[user2._id] = { userid: user2._id, name: user2.name, rights: 1 };
                                db.Set(ugroup);

                                // Notify user group change
                                var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msg: 'Added user ' + user2.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                parent.DispatchEvent(['*', ugroup._id, user2._id], obj, event);
                            }
                        }
                    }

                    obj.users[req.session.userid] = user2;
                    obj.db.SetUser(user2);
                    var event = { etype: 'user', userid: req.session.userid, username: req.connection.user, account: obj.CloneSafeUser(user2), action: 'accountcreate', msg: 'Domain account created, user ' + req.connection.user, domain: domain.id };
                    if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                    parent.debug('web', 'handleRootRequestEx: SSPI new domain user.');
                }
            }
        }

        // Figure out the minimal password requirement
        var passRequirements = null;
        if (domain.passwordrequirements != null) {
            if (domain.passrequirementstr == null) {
                var passRequirements = {};
                if (typeof domain.passwordrequirements.min == 'number') { passRequirements.min = domain.passwordrequirements.min; }
                if (typeof domain.passwordrequirements.max == 'number') { passRequirements.max = domain.passwordrequirements.max; }
                if (typeof domain.passwordrequirements.upper == 'number') { passRequirements.upper = domain.passwordrequirements.upper; }
                if (typeof domain.passwordrequirements.lower == 'number') { passRequirements.lower = domain.passwordrequirements.lower; }
                if (typeof domain.passwordrequirements.numeric == 'number') { passRequirements.numeric = domain.passwordrequirements.numeric; }
                if (typeof domain.passwordrequirements.nonalpha == 'number') { passRequirements.nonalpha = domain.passwordrequirements.nonalpha; }
                domain.passwordrequirementsstr = encodeURIComponent(JSON.stringify(passRequirements));
            }
            passRequirements = domain.passwordrequirementsstr;
        }

        // If a user exists and is logged in, serve the default app, otherwise server the login app.
        if (req.session && req.session.userid && obj.users[req.session.userid]) {
            const user = obj.users[req.session.userid];

            // Check if we are in maintenance mode
            if ((parent.config.settings.maintenancemode != null) && (user.siteadmin != 4294967295)) {
                req.session.messageid = 115; // Server under maintenance
                req.session.loginmode = 1;
                res.redirect(domain.url);
                return;
            }

            // If the request has a "meshmessengerid", redirect to MeshMessenger
            // This situation happens when you get a push notification for a chat session, but are not logged in.
            if (req.query.meshmessengerid != null) {
                res.redirect(domain.url + 'messenger?id=' + encodeURIComponent(req.query.meshmessengerid) + ((req.query.key != null) ? ('&key=' + encodeURIComponent(req.query.key)) : ''));
                return;
            }

            const xdbGetFunc = function dbGetFunc(err, states) {
                if (dbGetFunc.req.session.userid.split('/')[1] != domain.id) { // Check if the session is for the correct domain
                    parent.debug('web', 'handleRootRequestEx: incorrect domain.');
                    dbGetFunc.req.session = null;
                    dbGetFunc.res.redirect(domain.url + getQueryPortion(dbGetFunc.req)); // BAD***
                    return;
                }

                // Check if this is a locked account
                if ((dbGetFunc.user.siteadmin != null) && ((dbGetFunc.user.siteadmin & 32) != 0) && (dbGetFunc.user.siteadmin != 0xFFFFFFFF)) {
                    // Locked account
                    parent.debug('web', 'handleRootRequestEx: locked account.');
                    delete dbGetFunc.req.session.userid;
                    delete dbGetFunc.req.session.currentNode;
                    delete dbGetFunc.req.session.passhint;
                    delete dbGetFunc.req.session.cuserid;
                    dbGetFunc.req.session.messageid = 110; // Account locked.
                    dbGetFunc.res.redirect(domain.url + getQueryPortion(dbGetFunc.req)); // BAD***
                    return;
                }

                var viewmode = 1;
                if (dbGetFunc.req.session.viewmode) {
                    viewmode = dbGetFunc.req.session.viewmode;
                    delete dbGetFunc.req.session.viewmode;
                } else if (dbGetFunc.req.query.viewmode) {
                    viewmode = dbGetFunc.req.query.viewmode;
                }
                var currentNode = '';
                if (dbGetFunc.req.session.currentNode) {
                    currentNode = dbGetFunc.req.session.currentNode;
                    delete dbGetFunc.req.session.currentNode;
                } else if (dbGetFunc.req.query.node) {
                    currentNode = 'node/' + domain.id + '/' + dbGetFunc.req.query.node;
                }
                var logoutcontrols = {};
                if (obj.args.nousers != true) { logoutcontrols.name = user.name; }

                // Give the web page a list of supported server features for this domain and user
                const allFeatures = obj.getDomainUserFeatures(domain, dbGetFunc.user, dbGetFunc.req);

                // Create a authentication cookie
                const authCookie = obj.parent.encodeCookie({ userid: dbGetFunc.user._id, domainid: domain.id, ip: req.clientIp }, obj.parent.loginCookieEncryptionKey);
                const authRelayCookie = obj.parent.encodeCookie({ ruserid: dbGetFunc.user._id, x: req.session.x }, obj.parent.loginCookieEncryptionKey);

                // Send the main web application
                var extras = (dbGetFunc.req.query.key != null) ? ('&key=' + dbGetFunc.req.query.key) : '';
                if ((!obj.args.user) && (obj.args.nousers != true) && (nologout == false)) { logoutcontrols.logoutUrl = (domain.url + 'logout?' + Math.random() + extras); } // If a default user is in use or no user mode, don't display the logout button
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified

                // Clean up the U2F challenge if needed
                if (dbGetFunc.req.session.u2f) { delete dbGetFunc.req.session.u2f; };
                if (dbGetFunc.req.session.e) {
                    const sec = parent.decryptSessionData(dbGetFunc.req.session.e);
                    if (sec.u2f != null) { delete sec.u2f; dbGetFunc.req.session.e = parent.encryptSessionData(sec); }
                }

                // Intel AMT Scanning options
                var amtscanoptions = '';
                if (typeof domain.amtscanoptions == 'string') { amtscanoptions = encodeURIComponent(domain.amtscanoptions); }
                else if (obj.common.validateStrArray(domain.amtscanoptions)) { domain.amtscanoptions = domain.amtscanoptions.join(','); amtscanoptions = encodeURIComponent(domain.amtscanoptions); }

                // Fetch the web state
                parent.debug('web', 'handleRootRequestEx: success.');

                var webstate = '{}';
                if ((err == null) && (states != null) && (Array.isArray(states)) && (states.length == 1) && (states[0].state != null)) { webstate = obj.filterUserWebState(states[0].state); }
                if ((webstate == '{}') && (typeof domain.defaultuserwebstate == 'object')) { webstate = JSON.stringify(domain.defaultuserwebstate); } // User has no web state, use defaults.
                if (typeof domain.forceduserwebstate == 'object') { // Forces initial user web state if present, use it.
                    var webstate2 = {};
                    try { if (webstate != '{}') { webstate2 = JSON.parse(webstate); } } catch (ex) { }
                    for (var i in domain.forceduserwebstate) { webstate2[i] = domain.forceduserwebstate[i]; }
                    webstate = JSON.stringify(webstate2);
                }

                // Custom user interface
                var customui = '';
                if (domain.customui != null) { customui = encodeURIComponent(JSON.stringify(domain.customui)); }

                // Custom files (CSS and JS)
                var customFiles = '';
                if (domain.customFiles != null) { 
                    customFiles = encodeURIComponent(JSON.stringify(domain.customFiles)); 
                } else if (domain.customfiles != null) {
                    customFiles = encodeURIComponent(JSON.stringify(domain.customfiles)); 
                }

                // Server features
                var serverFeatures = 255;
                if (domain.myserver === false) { serverFeatures = 0; } // 64 = Show "My Server" tab
                else if (typeof domain.myserver == 'object') {
                    if (domain.myserver.backup !== true) { serverFeatures -= 1; } // Disallow simple server backups
                    if (domain.myserver.restore !== true) { serverFeatures -= 2; } // Disallow simple server restore
                    if (domain.myserver.upgrade !== true) { serverFeatures -= 4; } // Disallow server upgrade
                    if (domain.myserver.errorlog !== true) { serverFeatures -= 8; } // Disallow show server crash log
                    if (domain.myserver.console !== true) { serverFeatures -= 16; } // Disallow server console
                    if (domain.myserver.trace !== true) { serverFeatures -= 32; } // Disallow server tracing
                    if (domain.myserver.config !== true) { serverFeatures -= 128; } // Disallow server configuration
                }
                if (obj.db.databaseType != 1) { // If not using NeDB, we can't backup using the simple system.
                    // backup function changed to support all types, only NeDB can be restored through the webinterface
                    // if ((serverFeatures & 1) != 0) { serverFeatures -= 1; } // Disallow server backups
                    if ((serverFeatures & 2) != 0) { serverFeatures -= 2; } // Disallow simple server restore
                }

                // Get WebRTC configuration
                var webRtcConfig = null;
                if (obj.parent.config.settings && obj.parent.config.settings.webrtcconfig && (typeof obj.parent.config.settings.webrtcconfig == 'object')) { webRtcConfig = encodeURIComponent(JSON.stringify(obj.parent.config.settings.webrtcconfig)).replace(/'/g, '%27'); }
                else if (args.webrtcconfig && (typeof args.webrtcconfig == 'object')) { webRtcConfig = encodeURIComponent(JSON.stringify(args.webrtcconfig)).replace(/'/g, '%27'); }

                // Load default page style or new modern ui
                var uiViewMode = 'default';
                var webstateJSON = JSON.parse(webstate);
                if (req.query.sitestyle != null) {
                    if (req.query.sitestyle == 3) { uiViewMode = 'default3'; }
                } else if (webstateJSON && webstateJSON.uiViewMode == 3) {
                    uiViewMode = 'default3';
                } else if (domain.sitestyle == 3) {
                    uiViewMode = 'default3';
                }
                // Refresh the session
                render(dbGetFunc.req, dbGetFunc.res, getRenderPage(uiViewMode, dbGetFunc.req, domain), getRenderArgs({
                    authCookie: authCookie,
                    authRelayCookie: authRelayCookie,
                    viewmode: viewmode,
                    currentNode: currentNode,
                    logoutControls: encodeURIComponent(JSON.stringify(logoutcontrols)).replace(/'/g, '%27'),
                    domain: domain.id,
                    debuglevel: parent.debugLevel,
                    serverDnsName: obj.getWebServerName(domain, req),
                    serverRedirPort: args.redirport,
                    serverPublicPort: httpsPort,
                    serverfeatures: serverFeatures,
                    features: allFeatures.features,
                    features2: allFeatures.features2,
                    features3: allFeatures.features3,
                    sessiontime: (args.sessiontime) ? args.sessiontime : 60,
                    mpspass: args.mpspass,
                    passRequirements: passRequirements,
                    customui: customui,
                    customFiles: customFiles,
                    webcerthash: Buffer.from(obj.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'),
                    footer: (domain.footer == null) ? '' : obj.common.replacePlaceholders(domain.footer, {
                        'serverversion': obj.parent.currentVer,
                        'servername': obj.getWebServerName(domain, req),
                        'agentsessions': Object.keys(parent.webserver.wsagents).length,
                        'connectedusers': Object.keys(parent.webserver.wssessions).length,
                        'userssessions': Object.keys(parent.webserver.wssessions2).length,
                        'relaysessions': parent.webserver.relaySessionCount,
                        'relaycount': Object.keys(parent.webserver.wsrelays).length
                    }),
                    webstate: encodeURIComponent(webstate).replace(/'/g, '%27'),
                    amtscanoptions: amtscanoptions,
                    pluginHandler: (parent.pluginHandler == null) ? 'null' : parent.pluginHandler.prepExports(),
                    webRelayPort: ((args.relaydns != null) ? ((typeof args.aliasport == 'number') ? args.aliasport : args.port) : ((parent.webrelayserver != null) ? ((typeof args.relayaliasport == 'number') ? args.relayaliasport : parent.webrelayserver.port) : 0)),
                    webRelayDns: ((args.relaydns != null) ? args.relaydns[0] : ''),
                    hidePowerTimeline: (domain.hidepowertimeline ? 'true' : 'false'),
                    showNotesPanel: (domain.shownotespanel ? 'true' : 'false'),
                    userSessionsSort: (domain.usersessionssort ? domain.usersessionssort : 'SessionId'),
                    webrtcconfig: webRtcConfig,
                    collapseGroups: (domain.collapsegroups ? 'true' : 'false')
                }, dbGetFunc.req, domain, uiViewMode), user);
            }
            xdbGetFunc.req = req;
            xdbGetFunc.res = res;
            xdbGetFunc.user = user;
            obj.db.Get('ws' + user._id, xdbGetFunc);
        } else {
            // Send back the login application
            // If this is a 2 factor auth request, look for a hardware key challenge.
            // Normal login 2 factor request
            if (req.session && (req.session.loginmode == 4)) {
                const sec = parent.decryptSessionData(req.session.e);
                if ((sec != null) && (typeof sec.tuserid == 'string')) {
                    const user = obj.users[sec.tuserid];
                    if (user != null) {
                        parent.debug('web', 'handleRootRequestEx: sending 2FA challenge.');
                        getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                        return;
                    }
                }
            }
            // Password recovery 2 factor request
            if (req.session && (req.session.loginmode == 5) && (req.session.temail)) {
                obj.db.GetUserWithVerifiedEmail(domain.id, req.session.temail, function (err, docs) {
                    if ((err != null) || (docs.length == 0)) {
                        parent.debug('web', 'handleRootRequestEx: password recover 2FA fail.');
                        req.session = null;
                        res.redirect(domain.url + getQueryPortion(req)); // BAD***
                    } else {
                        var user = obj.users[docs[0]._id];
                        if (user != null) {
                            parent.debug('web', 'handleRootRequestEx: password recover 2FA challenge.');
                            getHardwareKeyChallenge(req, domain, user, function (hwchallenge) { handleRootRequestLogin(req, res, domain, hwchallenge, passRequirements); });
                        } else {
                            parent.debug('web', 'handleRootRequestEx: password recover 2FA no user.');
                            req.session = null;
                            res.redirect(domain.url + getQueryPortion(req)); // BAD***
                        }
                    }
                });
                return;
            }
            handleRootRequestLogin(req, res, domain, '', passRequirements);
        }
    }

    // Return a list of server supported features for a given domain and user
    obj.getDomainUserFeatures = function (domain, user, req) {
        var features = 0;
        var features2 = 0;
        var features3 = 0;
        if (obj.args.wanonly == true) { features += 0x00000001; } // WAN-only mode
        if (obj.args.lanonly == true) { features += 0x00000002; } // LAN-only mode
        if (obj.args.nousers == true) { features += 0x00000004; } // Single user mode
        if (domain.userQuota == -1) { features += 0x00000008; } // No server files mode
        if (obj.args.mpstlsoffload) { features += 0x00000010; } // No mutual-auth CIRA
        if ((parent.config.settings.allowframing != null) || (domain.allowframing != null) || (parent.config.settings.allowedframingorigins != null) || (domain.allowedframingorigins != null)) { features += 0x00000020; } // Allow site within iframe
        if ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true)) { features += 0x00000040; } // Email invites
        if (obj.args.webrtc == true) { features += 0x00000080; } // Enable WebRTC (Default false for now)
        // 0x00000100 --> This feature flag is free for future use.
        if (obj.args.allowhighqualitydesktop !== false) { features += 0x00000200; } // Enable AllowHighQualityDesktop (Default true)
        if ((obj.args.lanonly == true) || (obj.args.mpsport == 0)) { features += 0x00000400; } // No CIRA
        if ((obj.parent.serverSelfWriteAllowed == true) && (user != null) && ((user.siteadmin & 0x00000010) != 0)) { features += 0x00000800; } // Server can self-write (Allows self-update)
        if ((parent.config.settings.no2factorauth !== true) && (domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (user._id.split('/')[2][0] != '~')) { features += 0x00001000; } // 2FA login supported
        if (domain.agentnoproxy === true) { features += 0x00002000; } // Indicates that agents should be installed without using a HTTP proxy
        if ((parent.config.settings.no2factorauth !== true) && domain.yubikey && domain.yubikey.id && domain.yubikey.secret && (user._id.split('/')[2][0] != '~')) { features += 0x00004000; } // Indicates Yubikey support
        if (domain.geolocation == true) { features += 0x00008000; } // Enable geo-location features
        if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true)) { features += 0x00010000; } // Enable password hints
        if (parent.config.settings.no2factorauth !== true) { features += 0x00020000; } // Enable WebAuthn/FIDO2 support
        if ((obj.args.nousers != true) && (domain.passwordrequirements != null) && (domain.passwordrequirements.force2factor === true) && (user._id.split('/')[2][0] != '~')) {
            // Check if we can skip 2nd factor auth because of the source IP address
            var skip2factor = false;
            if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
                for (var i in domain.passwordrequirements.skip2factor) {
                    if (require('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) { skip2factor = true; }
                }
            }
            if (skip2factor == false) { features += 0x00040000; } // Force 2-factor auth
        }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { features += 0x00080000; } // LDAP or SSPI in use, warn that users must login first before adding a user to a group.
        if (domain.amtacmactivation) { features += 0x00100000; } // Intel AMT ACM activation/upgrade is possible
        if (domain.usernameisemail) { features += 0x00200000; } // Username is email address
        if (parent.mqttbroker != null) { features += 0x00400000; } // This server supports MQTT channels
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null)) { features += 0x00800000; } // using email for 2FA is allowed
        if (domain.agentinvitecodes == true) { features += 0x01000000; } // Support for agent invite codes
        if (parent.smsserver != null) { features += 0x02000000; } // SMS messaging is supported
        if ((parent.smsserver != null) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false))) { features += 0x04000000; } // SMS 2FA is allowed
        if (domain.sessionrecording != null) { features += 0x08000000; } // Server recordings enabled
        if (domain.urlswitching === false) { features += 0x10000000; } // Disables the URL switching feature
        if (domain.novnc === false) { features += 0x20000000; } // Disables noVNC
        if (domain.mstsc === false) { features += 0x40000000; } // Disables MSTSC.js
        if (obj.isTrustedCert(domain) == false) { features += 0x80000000; } // Indicate we are not using a trusted certificate
        if (obj.parent.amtManager != null) { features2 += 0x00000001; } // Indicates that the Intel AMT manager is active
        if (obj.parent.firebase != null) { features2 += 0x00000002; } // Indicates the server supports Firebase push messaging
        if ((obj.parent.firebase != null) && (obj.parent.firebase.pushOnly != true)) { features2 += 0x00000004; } // Indicates the server supports Firebase two-way push messaging
        if (obj.parent.webpush != null) { features2 += 0x00000008; } // Indicates web push is enabled
        if (((obj.args.noagentupdate == 1) || (obj.args.noagentupdate == true))) { features2 += 0x00000010; } // No agent update
        if (parent.amtProvisioningServer != null) { features2 += 0x00000020; } // Intel AMT LAN provisioning server
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.push2factor != false)) && (obj.parent.firebase != null)) { features2 += 0x00000040; } // Indicates device push notification 2FA is enabled
        if ((typeof domain.passwordrequirements != 'object') || ((domain.passwordrequirements.logintokens !== false) && ((Array.isArray(domain.passwordrequirements.logintokens) == false) || ((domain.passwordrequirements.logintokens.indexOf(user._id) >= 0) || (user.links && Object.keys(user.links).some(key => domain.passwordrequirements.logintokens.indexOf(key) >= 0)) )))) { features2 += 0x00000080; } // Indicates login tokens are allowed
        if (req.session.loginToken != null) { features2 += 0x00000100; } // LoginToken mode, no account changes.
        if (domain.ssh == true) { features2 += 0x00000200; } // SSH is enabled
        if (domain.localsessionrecording === false) { features2 += 0x00000400; } // Disable local recording feature
        if (domain.clipboardget == false) { features2 += 0x00000800; } // Disable clipboard get
        if (domain.clipboardset == false) { features2 += 0x00001000; } // Disable clipboard set
        if ((typeof domain.desktop == 'object') && (domain.desktop.viewonly == true)) { features2 += 0x00002000; } // Indicates remote desktop is viewonly
        if (domain.mailserver != null) { features2 += 0x00004000; } // Indicates email server is active
        if (domain.devicesearchbarserverandclientname) { features2 += 0x00008000; } // Search bar will find both server name and client name
        if (domain.ipkvm) { features2 += 0x00010000; } // Indicates support for IP KVM device groups
        if ((domain.passwordrequirements) && (domain.passwordrequirements.otp2factor == false)) { features2 += 0x00020000; } // Indicates support for OTP 2FA is disabled
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.backupcode2factor === false)) { features2 += 0x00040000; } // Indicates 2FA backup codes are disabled
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.single2factorwarning === false)) { features2 += 0x00080000; } // Indicates no warning if a single 2FA is in use
        if (domain.nightmode === 1) { features2 += 0x00100000; } // Always night mode
        if (domain.nightmode === 2) { features2 += 0x00200000; } // Always day mode
        if (domain.allowsavingdevicecredentials == false) { features2 += 0x00400000; } // Do not allow device credentials to be saved on the server
        if ((typeof domain.files == 'object') && (domain.files.sftpconnect === false)) { features2 += 0x00800000; } // Remove the "SFTP Connect" button in the "Files" tab when the device is agent managed
        if ((typeof domain.terminal == 'object') && (domain.terminal.sshconnect === false)) { features2 += 0x01000000; } // Remove the "SSH Connect" button in the "Terminal" tab when the device is agent managed
        if ((parent.msgserver != null) && (parent.msgserver.providers != 0)) { features2 += 0x02000000; } // User messaging server is enabled
        if ((parent.msgserver != null) && (parent.msgserver.providers != 0) && ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false))) { features2 += 0x04000000; } // User messaging 2FA is allowed
        if (domain.scrolltotop == true) { features2 += 0x08000000; } // Show the "Scroll to top" button
        if (domain.devicesearchbargroupname === true) { features2 += 0x10000000; } // Search bar will find by group name too
        if (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.duo2factor != false)) && (typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) { features2 += 0x20000000; } // using Duo for 2FA is allowed
        if (domain.showmodernuitoggle == true) { features2 += 0x40000000; } // Indicates that the new UI should be shown
        if (domain.sitestyle === 3) { features2 |= 0x80000000; } // Indicates that Modern UI is forced (siteStyle = 3)
        if ((typeof domain.desktop == 'object') && (domain.desktop.disableconnectall == true)) { features3 += 0x00000001; } // Disable "Connect All" button when multiple sessions are active on a device
        if (domain.upninsteadofuser === true) { features3 += 0x00000002; } // Show UPN instead of username in General tab
        return { features: features, features2: features2, features3: features3 };
    }

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

        // Custom user interface
        var customui = '';
        if (domain.customui != null) { customui = encodeURIComponent(JSON.stringify(domain.customui)); }

        // Custom files (CSS and JS)
        var customFiles = '';
        if (domain.customFiles != null) { 
            customFiles = encodeURIComponent(JSON.stringify(domain.customFiles)); 
        } else if (domain.customfiles != null) {
            customFiles = encodeURIComponent(JSON.stringify(domain.customfiles)); 
        }

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

    // Handle a post request on the root
    // Return true if it looks like we are using a real TLS certificate.
    obj.isTrustedCert = function (domain) {
        if ((domain != null) && (typeof domain.trustedcert == 'boolean')) return domain.trustedcert; // If the status of the cert specified, use that.
        if (typeof obj.args.trustedcert == 'boolean') return obj.args.trustedcert; // If the status of the cert specified, use that.
        if (obj.args.tlsoffload != null) return true; // We are using TLS offload, a real cert is likely used.
        if (obj.parent.config.letsencrypt != null) return (obj.parent.config.letsencrypt.production === true); // We are using Let's Encrypt, real cert in use if production is set to true.
        if ((typeof obj.certificates.WebIssuer == 'string') && (obj.certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0)) return false; // Our cert is issued by self-signed cert.
        if (obj.certificates.CommonName.indexOf('.') == -1) return false; // Our cert is named with a fake name
        return true; // This is a guess
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
    function handleRelayWebSocket(ws, req, domain, user, cookie) {
        if (!(req.query.host)) { console.log('ERR: No host target specified'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
        parent.debug('web', 'Websocket relay connected from ' + user.name + ' for ' + req.query.host + '.');

        try { ws._socket.setKeepAlive(true, 240000); } catch (ex) { }   // Set TCP keep alive

        // Fetch information about the target
        obj.db.Get(req.query.host, function (err, docs) {
            if (docs.length == 0) { console.log('ERR: Node not found'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
            var xusername = '', xdevicename = '', xdevicename2 = null, node = null;
            node = docs[0]; xdevicename2 = node.name; xdevicename = '-' + parent.common.makeFilename(node.name); ws.id = getRandomPassword(); ws.time = Date.now();
            if (!node.intelamt) { console.log('ERR: Not AMT node'); try { ws.close(); } catch (e) { } return; } // Disconnect websocket
            var ciraconn = parent.mpsserver.GetConnectionToNode(req.query.host, null, false);

            // Check if this user has permission to manage this computer
            if ((obj.GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL) == 0) { console.log('ERR: Access denied (3)'); try { ws.close(); } catch (e) { } return; }

            // Check what connectivity is available for this node
            var state = parent.GetConnectivityState(req.query.host);
            var conn = 0;
            if (!state || state.connectivity == 0) { parent.debug('web', 'ERR: No routing possible (1)'); try { ws.close(); } catch (e) { } return; } else { conn = state.connectivity; }

            // Check what server needs to handle this connection
            if ((obj.parent.multiServer != null) && ((cookie == null) || (cookie.ps != 1))) { // If a cookie is provided and is from a peer server, don't allow the connection to jump again to a different server
                var server = obj.parent.GetRoutingServerId(req.query.host, 2); // Check for Intel CIRA connection
                if (server != null) {
                    if (server.serverid != obj.parent.serverId) {
                        // Do local Intel CIRA routing using a different server
                        parent.debug('web', 'Route Intel AMT CIRA connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                } else {
                    server = obj.parent.GetRoutingServerId(req.query.host, 4); // Check for local Intel AMT connection
                    if ((server != null) && (server.serverid != obj.parent.serverId)) {
                        // Do local Intel AMT routing using a different server
                        parent.debug('web', 'Route Intel AMT direct connection to peer server: ' + server.serverid);
                        obj.parent.multiServer.createPeerRelay(ws, req, server.serverid, user);
                        return;
                    }
                }
            }

            // Setup session recording if needed
            if (domain.sessionrecording == true || ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.protocols == null) || (domain.sessionrecording.protocols.indexOf((req.query.p == 2) ? 101 : 100) >= 0)))) { // TODO 100
                // Check again if we need to do recording
                var record = true;

                // Check user or device group recording
                if ((typeof domain.sessionrecording == 'object') && ((domain.sessionrecording.onlyselectedusers === true) || (domain.sessionrecording.onlyselecteddevicegroups === true))) {
                    record = false;

                    // Check device group recording
                    if (domain.sessionrecording.onlyselecteddevicegroups === true) {
                        var mesh = obj.meshes[node.meshid];
                        if ((mesh.flags != null) && ((mesh.flags & 4) != 0)) { record = true; } // Record the session
                    }

                    // Check user recording
                    if (domain.sessionrecording.onlyselectedusers === true) {
                        if ((user.flags != null) && ((user.flags & 2) != 0)) { record = true; } // Record the session
                    }
                }

                if (record == true) {
                    var now = new Date(Date.now());
                    // Get the username and make it acceptable as a filename
                    if (user._id) { xusername = '-' + parent.common.makeFilename(user._id.split('/')[2]); }
                    var xsessionid = ws.id;
                    var recFilename = 'relaysession' + ((domain.id == '') ? '' : '-') + domain.id + '-' + now.getUTCFullYear() + '-' + obj.common.zeroPad(now.getUTCMonth() + 1, 2) + '-' + obj.common.zeroPad(now.getUTCDate(), 2) + '-' + obj.common.zeroPad(now.getUTCHours(), 2) + '-' + obj.common.zeroPad(now.getUTCMinutes(), 2) + '-' + obj.common.zeroPad(now.getUTCSeconds(), 2) + xusername + xdevicename + '-' + xsessionid + '.mcrec';
                    var recFullFilename = null;
                    if (domain.sessionrecording.filepath) {
                        try { obj.fs.mkdirSync(domain.sessionrecording.filepath); } catch (e) { }
                        recFullFilename = obj.path.join(domain.sessionrecording.filepath, recFilename);
                    } else {
                        try { obj.fs.mkdirSync(parent.recordpath); } catch (e) { }
                        recFullFilename = obj.path.join(parent.recordpath, recFilename);
                    }
                    var fd = obj.fs.openSync(recFullFilename, 'w');
                    if (fd != null) {
                        // Write the recording file header
                        parent.debug('relay', 'Relay: Started recording to file: ' + recFullFilename);
                        var metadata = {
                            magic: 'MeshCentralRelaySession',
                            ver: 1,
                            userid: user._id,
                            username: user.name,
                            sessionid: ws.id,
                            ipaddr1: req.clientIp,
                            time: new Date().toLocaleString(),
                            protocol: (req.query.p == 2) ? 101 : 100,
                            nodeid: node._id,
                            intelamt: true
                        };
                        if (ciraconn != null) { metadata.ipaddr2 = ciraconn.remoteAddr; }
                        else if ((conn & 4) != 0) { metadata.ipaddr2 = node.host; }
                        if (xdevicename2 != null) { metadata.devicename = xdevicename2; }
                        var firstBlock = JSON.stringify(metadata)
                        ws.logfile = { fd: fd, lock: false, filename: recFullFilename, startTime: Date.now(), size: 0, text: 0, req: req };
                        obj.meshRelayHandler.recordingEntry(ws.logfile, 1, 0, firstBlock, function () { });
                        if (node != null) { ws.logfile.nodeid = node._id; ws.logfile.meshid = node.meshid; ws.logfile.name = node.name; ws.logfile.icon = node.icon; }
                        if (req.query.p == 2) { ws.send(Buffer.from(String.fromCharCode(0xF0), 'binary')); } // Intel AMT Redirection: Indicate the session is being recorded
                    }
                }
            }

            // If Intel AMT CIRA connection is available, use it
            if (ciraconn != null) {
                parent.debug('web', 'Opening relay CIRA channel connection to ' + req.query.host + '.');

                // TODO: If the CIRA connection is a relay or LMS connection, we can't detect the TLS state like this.
                // Compute target port, look at the CIRA port mappings, if non-TLS is allowed, use that, if not use TLS
                var port = 16993;
                //if (node.intelamt.tls == 0) port = 16992; // DEBUG: Allow TLS flag to set TLS mode within CIRA
                if (ciraconn.tag.boundPorts.indexOf(16992) >= 0) port = 16992; // RELEASE: Always use non-TLS mode if available within CIRA
                if (req.query.p == 2) port += 2;

                // Setup a new CIRA channel
                if ((port == 16993) || (port == 16995)) {
                    // Perform TLS
                    var ser = new SerialTunnel();
                    var chnl = parent.mpsserver.SetupChannel(ciraconn, port);

                    // Let's chain up the TLSSocket <-> SerialTunnel <-> CIRA APF (chnl)
                    // Anything that needs to be forwarded by SerialTunnel will be encapsulated by chnl write
                    ser.forwardwrite = function (data) { if (data.length > 0) { chnl.write(data); } }; // TLS ---> CIRA

                    // When APF tunnel return something, update SerialTunnel buffer
                    chnl.onData = function (ciraconn, data) { if (data.length > 0) { try { ser.updateBuffer(data); } catch (ex) { console.log(ex); } } }; // CIRA ---> TLS

                    // Handle CIRA tunnel state change
                    chnl.onStateChange = function (ciraconn, state) {
                        parent.debug('webrelay', 'Relay TLS CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                        if (state == 2) {
                            // TLSSocket to encapsulate TLS communication, which then tunneled via SerialTunnel an then wrapped through CIRA APF
                            const tlsoptions = { socket: ser, ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION, rejectUnauthorized: false };
                            if (req.query.tls1only == 1) {
                                tlsoptions.secureProtocol = 'TLSv1_method';
                            } else {
                                tlsoptions.minVersion = 'TLSv1';
                            }
                            var tlsock = obj.tls.connect(tlsoptions, function () { parent.debug('webrelay', "CIRA Secure TLS Connection"); ws._socket.resume(); });
                            tlsock.chnl = chnl;
                            tlsock.setEncoding('binary');
                            tlsock.on('error', function (err) { parent.debug('webrelay', "CIRA TLS Connection Error", err); });

                            // Decrypted tunnel from TLS communication to be forwarded to websocket
                            tlsock.on('data', function (data) {
                                // AMT/TLS ---> WS
                                if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                                try { ws.send(data); } catch (ex) { }
                            });

                            // If TLS is on, forward it through TLSSocket
                            ws.forwardclient = tlsock;
                            ws.forwardclient.xtls = 1;

                            ws.forwardclient.onStateChange = function (ciraconn, state) {
                                parent.debug('webrelay', 'Relay CIRA state change', state);
                                if (state == 0) { try { ws.close(); } catch (e) { } }
                            };

                            ws.forwardclient.onData = function (ciraconn, data) {
                                // Run data thru interceptor
                                if (ws.interceptor) { data = ws.interceptor.processAmtData(data); }

                                if (data.length > 0) {
                                    if (ws.logfile == null) {
                                        try { ws.send(data); } catch (e) { }
                                    } else {
                                        // Log to recording file
                                        obj.meshRelayHandler.recordingEntry(ws.logfile, 2, 0, data, function () { try { ws.send(data); } catch (ex) { console.log(ex); } }); // TODO: Add TLS support
                                    }
                                }
                            };

                            // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                            ws.forwardclient.onSendOk = function (ciraconn) { };
                        }
                    };
                } else {
                    // Without TLS
                    ws.forwardclient = parent.mpsserver.SetupChannel(ciraconn, port);
                    ws.forwardclient.xtls = 0;
                    ws._socket.resume();

                    ws.forwardclient.onStateChange = function (ciraconn, state) {
                        parent.debug('webrelay', 'Relay CIRA state change', state);
                        if (state == 0) { try { ws.close(); } catch (e) { } }
                    };

                    ws.forwardclient.onData = function (ciraconn, data) {
                        //parent.debug('webrelaydata', 'Relay CIRA data to WS', data.length);

                        // Run data thru interceptor
                        if (ws.interceptor) { data = ws.interceptor.processAmtData(data); }

                        //console.log('AMT --> WS', Buffer.from(data, 'binary').toString('hex'));
                        if (data.length > 0) {
                            if (ws.logfile == null) {
                                try { ws.send(data); } catch (e) { }
                            } else {
                                // Log to recording file
                                obj.meshRelayHandler.recordingEntry(ws.logfile, 2, 0, data, function () { try { ws.send(data); } catch (ex) { console.log(ex); } });
                            }
                        }
                    };

                    // TODO: Flow control? (Dont' really need it with AMT, but would be nice)
                    ws.forwardclient.onSendOk = function (ciraconn) { };
                }

                // When data is received from the web socket, forward the data into the associated CIRA channel.
                // If the CIRA connection is pending, the CIRA channel has built-in buffering, so we are ok sending anyway.
                ws.on('message', function (data) {
                    //parent.debug('webrelaydata', 'Relay WS data to CIRA', data.length);
                    if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }

                    // WS ---> AMT/TLS
                    if (ws.interceptor) { data = ws.interceptor.processBrowserData(data); } // Run data thru interceptor

                    // Log to recording file
                    if (ws.logfile == null) {
                        // Forward data to the associated TCP connection.
                        try { ws.forwardclient.write(data); } catch (ex) { }
                    } else {
                        // Log to recording file
                        obj.meshRelayHandler.recordingEntry(ws.logfile, 2, 2, data, function () { try { ws.forwardclient.write(data); } catch (ex) { } });
                    }
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('CIRA server websocket error from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
                    parent.debug('webrelay', 'Websocket relay closed on error.');

                    // Log the disconnection
                    if (ws.time) {
                        if (req.query.p == 2) { // Only log event if Intel Redirection, otherwise hundreds of logs for WSMAN are recorded
                            var msg = 'Ended relay session', msgid = 9, ip = ((ciraconn != null) ? ciraconn.remoteAddr : (((conn & 4) != 0) ? node.host : req.clientIp));
                            if (user) {
                                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [ws.id, req.clientIp, ip, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + ws.id + '\" from ' + req.clientIp + ' to ' + ip + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: 101, nodeid: node._id };
                                obj.parent.DispatchEvent(['*', user._id, node._id, node.meshid], obj, event);
                            }
                        }
                    }

                    // Websocket closed, close the CIRA channel and TLS session.
                    if (ws.forwardclient) {
                        if (ws.forwardclient.close) { ws.forwardclient.close(); }      // NonTLS, close the CIRA channel
                        if (ws.forwardclient.end) { ws.forwardclient.end(); }          // TLS, close the TLS session
                        if (ws.forwardclient.chnl) { ws.forwardclient.chnl.close(); }  // TLS, close the CIRA channel
                        delete ws.forwardclient;
                    }

                    // Close the recording file
                    if (ws.logfile != null) {
                        setTimeout(function(){ // wait 5 seconds before finishing file for some reason?
                            obj.meshRelayHandler.recordingEntry(ws.logfile, 3, 0, 'MeshCentralMCREC', function (logfile, ws) {
                                obj.fs.close(logfile.fd);
                                parent.debug('relay', 'Relay: Finished recording to file: ' + ws.logfile.filename);
                                // Compute session length
                                var sessionLength = null;
                                if (ws.logfile.startTime != null) { sessionLength = Math.round((Date.now() - ws.logfile.startTime) / 1000) - 5; }
                                // Add a event entry about this recording
                                var basefile = parent.path.basename(ws.logfile.filename);
                                var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: ws.logfile.nodeid, msg: "Finished recording session" + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: basefile, size: ws.logfile.size };
                                if (user) { event.userids = [user._id]; } else if (peer.user) { event.userids = [peer.user._id]; }
                                var xprotocol = (((ws.logfile.req == null) || (ws.logfile.req.query == null)) ? null : (ws.logfile.req.query.p == 2) ? 101 : 100);
                                if (xprotocol != null) { event.protocol = parseInt(xprotocol); }
                                var mesh = obj.meshes[ws.logfile.meshid];
                                if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
                                if (ws.logfile.startTime) { event.startTime = ws.logfile.startTime; event.lengthTime = sessionLength; }
                                if (ws.logfile.name) { event.name = ws.logfile.name; }
                                if (ws.logfile.icon) { event.icon = ws.logfile.icon; }
                                obj.parent.DispatchEvent(['*', 'recording', ws.logfile.nodeid, ws.logfile.meshid], obj, event);
                                delete ws.logfile;
                            }, ws);
                        }, 5000);
                    }
                });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function () {
                    parent.debug('webrelay', 'Websocket relay closed.');

                    // Log the disconnection
                    if (ws.time) {
                        if (req.query.p == 2) { // Only log event if Intel Redirection, otherwise hundreds of logs for WSMAN are recorded
                            var msg = 'Ended relay session', msgid = 9, ip = ((ciraconn != null) ? ciraconn.remoteAddr : (((conn & 4) != 0) ? node.host : req.clientIp));
                            var nodeid = node._id;
                            var meshid = node.meshid;
                            if (user) {
                                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [ws.id, req.clientIp, ip, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + ws.id + '\" from ' + req.clientIp + ' to ' + ip + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: ((req.query.p == 2) ? 101 : 100), nodeid: nodeid };
                                obj.parent.DispatchEvent(['*', user._id, nodeid, meshid], obj, event);
                            }
                        }
                    }

                    // Websocket closed, close the CIRA channel and TLS session.
                    if (ws.forwardclient) {
                        if (ws.forwardclient.close) { ws.forwardclient.close(); }      // NonTLS, close the CIRA channel
                        if (ws.forwardclient.end) { ws.forwardclient.end(); }          // TLS, close the TLS session
                        if (ws.forwardclient.chnl) { ws.forwardclient.chnl.close(); }  // TLS, close the CIRA channel
                        delete ws.forwardclient;
                    }

                    // Close the recording file
                    if (ws.logfile != null) {
                        setTimeout(function(){ // wait 5 seconds before finishing file for some reason?
                            obj.meshRelayHandler.recordingEntry(ws.logfile, 3, 0, 'MeshCentralMCREC', function (logfile, ws) {
                                obj.fs.close(logfile.fd);
                                parent.debug('relay', 'Relay: Finished recording to file: ' + ws.logfile.filename);
                                // Compute session length
                                var sessionLength = null;
                                if (ws.logfile.startTime != null) { sessionLength = Math.round((Date.now() - ws.logfile.startTime) / 1000) - 5; }
                                // Add a event entry about this recording
                                var basefile = parent.path.basename(ws.logfile.filename);
                                var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: ws.logfile.nodeid, msg: "Finished recording session" + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: basefile, size: ws.logfile.size };
                                if (user) { event.userids = [user._id]; }
                                var xprotocol = (((ws.logfile.req == null) || (ws.logfile.req.query == null)) ? null : (ws.logfile.req.query.p == 2) ? 101 : 100);
                                if (xprotocol != null) { event.protocol = parseInt(xprotocol); }
                                var mesh = obj.meshes[ws.logfile.meshid];
                                if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
                                if (ws.logfile.startTime) { event.startTime = ws.logfile.startTime; event.lengthTime = sessionLength; }
                                if (ws.logfile.name) { event.name = ws.logfile.name; }
                                if (ws.logfile.icon) { event.icon = ws.logfile.icon; }
                                obj.parent.DispatchEvent(['*', 'recording', ws.logfile.nodeid, ws.logfile.meshid], obj, event);
                                delete ws.logfile;
                            }, ws);
                        }, 5000);
                    }
                });

                // Note that here, req.query.p: 1 = WSMAN with server auth, 2 = REDIR with server auth, 3 = WSMAN without server auth, 4 = REDIR with server auth

                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) {
                    parent.debug('webrelaydata', 'INTERCEPTOR1', { host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                } else if (req.query.p == 2) {
                    parent.debug('webrelaydata', 'INTERCEPTOR2', { user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass });
                    ws.interceptor.blockAmtStorage = true;
                }
            } else if ((conn & 4) != 0) { // If Intel AMT direct connection is possible, option a direct socket
                // We got a new web socket connection, initiate a TCP connection to the target Intel AMT host/port.
                parent.debug('webrelay', 'Opening relay TCP socket connection to ' + req.query.host + '.');

                // When data is received from the web socket, forward the data into the associated TCP connection.
                ws.on('message', function (msg) {
                    //parent.debug('webrelaydata', 'TCP relay data to ' + node.host + ', ' + msg.length + ' bytes');

                    if (typeof msg == 'string') { msg = Buffer.from(msg, 'binary'); }
                    if (ws.interceptor) { msg = ws.interceptor.processBrowserData(msg); } // Run data thru interceptor

                    // Log to recording file
                    if (ws.logfile == null) {
                        // Forward data to the associated TCP connection.
                        try { ws.forwardclient.write(msg); } catch (ex) { }
                    } else {
                        // Log to recording file
                        obj.meshRelayHandler.recordingEntry(ws.logfile, 2, 2, msg, function () { try { ws.forwardclient.write(msg); } catch (ex) { } });
                    }
                });

                // If error, close the associated TCP connection.
                ws.on('error', function (err) {
                    console.log('Error with relay web socket connection from ' + req.clientIp + ', ' + err.toString().split('\r')[0] + '.');
                    parent.debug('webrelay', 'Error with relay web socket connection from ' + req.clientIp + '.');
                    // Log the disconnection
                    if (ws.time) {
                        if (req.query.p == 2) { // Only log event if Intel Redirection, otherwise hundreds of logs for WSMAN are recorded
                            var msg = 'Ended relay session', msgid = 9, ip = ((ciraconn != null) ? ciraconn.remoteAddr : (((conn & 4) != 0) ? node.host : req.clientIp));
                            if (user) {
                                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [ws.id, req.clientIp, ip, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + ws.id + '\" from ' + req.clientIp + ' to ' + ip + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: ((req.query.p == 2) ? 101 : 100), nodeid: node._id };
                                obj.parent.DispatchEvent(['*', user._id, node._id, node.meshid], obj, event);
                            }
                        }
                    }
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }

                    // Close the recording file
                    if (ws.logfile != null) {
                        setTimeout(function(){ // wait 5 seconds before finishing file for some reason?
                            obj.meshRelayHandler.recordingEntry(ws.logfile, 3, 0, 'MeshCentralMCREC', function (logfile, ws) {
                                obj.fs.close(logfile.fd);
                                parent.debug('relay', 'Relay: Finished recording to file: ' + ws.logfile.filename);
                                // Compute session length
                                var sessionLength = null;
                                if (ws.logfile.startTime != null) { sessionLength = Math.round((Date.now() - ws.logfile.startTime) / 1000); }
                                // Add a event entry about this recording
                                var basefile = parent.path.basename(ws.logfile.filename);
                                var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: ws.logfile.nodeid, msg: "Finished recording session" + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: basefile, size: ws.logfile.size };
                                if (user) { event.userids = [user._id]; } else if (peer.user) { event.userids = [peer.user._id]; }
                                var xprotocol = (((ws.logfile.req == null) || (ws.logfile.req.query == null)) ? null : (ws.logfile.req.query.p == 2) ? 101 : 100);
                                if (xprotocol != null) { event.protocol = parseInt(xprotocol); }
                                var mesh = obj.meshes[ws.logfile.meshid];
                                if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
                                if (ws.logfile.startTime) { event.startTime = ws.logfile.startTime; event.lengthTime = sessionLength; }
                                if (ws.logfile.name) { event.name = ws.logfile.name; }
                                if (ws.logfile.icon) { event.icon = ws.logfile.icon; }
                                obj.parent.DispatchEvent(['*', 'recording', ws.logfile.nodeid, ws.logfile.meshid], obj, event);
                                delete ws.logfile;
                            }, ws);
                        }, 5000);
                    }
                });

                // If the web socket is closed, close the associated TCP connection.
                ws.on('close', function () {
                    parent.debug('webrelay', 'Closing relay web socket connection to ' + req.query.host + '.');
                    // Log the disconnection
                    if (ws.time) {
                        if (req.query.p == 2) { // Only log event if Intel Redirection, otherwise hundreds of logs for WSMAN are recorded
                            var msg = 'Ended relay session', msgid = 9, ip = ((ciraconn != null) ? ciraconn.remoteAddr : (((conn & 4) != 0) ? node.host : req.clientIp));
                            if (user) {
                                var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [ws.id, req.clientIp, ip, Math.floor((Date.now() - ws.time) / 1000)], msg: msg + ' \"' + ws.id + '\" from ' + req.clientIp + ' to ' + ip + ', ' + Math.floor((Date.now() - ws.time) / 1000) + ' second(s)', protocol: ((req.query.p == 2) ? 101 : 100), nodeid: node._id };
                                obj.parent.DispatchEvent(['*', user._id, node._id, node.meshid], obj, event);
                            }
                        }
                    }
                    if (ws.forwardclient) { try { ws.forwardclient.destroy(); } catch (e) { } }

                    // Close the recording file
                    if (ws.logfile != null) {
                        setTimeout(function(){ // wait 5 seconds before finishing file for some reason?
                            obj.meshRelayHandler.recordingEntry(ws.logfile, 3, 0, 'MeshCentralMCREC', function (logfile, ws) {
                                obj.fs.close(logfile.fd);
                                parent.debug('relay', 'Relay: Finished recording to file: ' + ws.logfile.filename);
                                // Compute session length
                                var sessionLength = null;
                                if (ws.logfile.startTime != null) { sessionLength = Math.round((Date.now() - ws.logfile.startTime) / 1000); }
                                // Add a event entry about this recording
                                var basefile = parent.path.basename(ws.logfile.filename);
                                var event = { etype: 'relay', action: 'recording', domain: domain.id, nodeid: ws.logfile.nodeid, msg: "Finished recording session" + (sessionLength ? (', ' + sessionLength + ' second(s)') : ''), filename: basefile, size: ws.logfile.size };
                                if (user) { event.userids = [user._id]; } else if (peer.user) { event.userids = [peer.user._id]; }
                                var xprotocol = (((ws.logfile.req == null) || (ws.logfile.req.query == null)) ? null : (ws.logfile.req.query.p == 2) ? 101 : 100);
                                if (xprotocol != null) { event.protocol = parseInt(xprotocol); }
                                var mesh = obj.meshes[ws.logfile.meshid];
                                if (mesh != null) { event.meshname = mesh.name; event.meshid = mesh._id; }
                                if (ws.logfile.startTime) { event.startTime = ws.logfile.startTime; event.lengthTime = sessionLength; }
                                if (ws.logfile.name) { event.name = ws.logfile.name; }
                                if (ws.logfile.icon) { event.icon = ws.logfile.icon; }
                                obj.parent.DispatchEvent(['*', 'recording', ws.logfile.nodeid, ws.logfile.meshid], obj, event);
                                delete ws.logfile;
                            }, ws);
                        }, 5000);
                    }
                });

                // Compute target port
                var port = 16992;
                if (node.intelamt.tls > 0) port = 16993; // This is a direct connection, use TLS when possible
                if ((req.query.p == 2) || (req.query.p == 4)) port += 2;

                if (node.intelamt.tls == 0) {
                    // If this is TCP (without TLS) set a normal TCP socket
                    ws.forwardclient = new obj.net.Socket();
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                    ws._socket.resume();
                } else {
                    // If TLS is going to be used, setup a TLS socket
                    var tlsoptions = { ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION, rejectUnauthorized: false };
                    if (req.query.tls1only == 1) {
                        tlsoptions.secureProtocol = 'TLSv1_method';
                    } else {
                        tlsoptions.minVersion = 'TLSv1';
                    }
                    ws.forwardclient = obj.tls.connect(port, node.host, tlsoptions, function () {
                        // The TLS connection method is the same as TCP, but located a bit differently.
                        parent.debug('webrelay', user.name + ' - TLS connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws._socket.resume();
                    });
                    ws.forwardclient.setEncoding('binary');
                    ws.forwardclient.xstate = 0;
                    ws.forwardclient.forwardwsocket = ws;
                }

                // When we receive data on the TCP connection, forward it back into the web socket connection.
                ws.forwardclient.on('data', function (data) {
                    if (typeof data == 'string') { data = Buffer.from(data, 'binary'); }
                    if (obj.parent.debugLevel >= 1) { // DEBUG
                        parent.debug('webrelaydata', user.name + ' - TCP relay data from ' + node.host + ', ' + data.length + ' bytes.');
                        //if (obj.parent.debugLevel >= 4) { Debug(4, '  ' + Buffer.from(data, 'binary').toString('hex')); }
                    }
                    if (ws.interceptor) { data = ws.interceptor.processAmtData(data); } // Run data thru interceptor
                    if (ws.logfile == null) {
                        // No logging
                        try { ws.send(data); } catch (e) { }
                    } else {
                        // Log to recording file
                        obj.meshRelayHandler.recordingEntry(ws.logfile, 2, 0, data, function () { try { ws.send(data); } catch (e) { } });
                    }
                });

                // If the TCP connection closes, disconnect the associated web socket.
                ws.forwardclient.on('close', function () {
                    parent.debug('webrelay', user.name + ' - TCP relay disconnected from ' + node.host + ':' + port + '.');
                    try { ws.close(); } catch (e) { }
                });

                // If the TCP connection causes an error, disconnect the associated web socket.
                ws.forwardclient.on('error', function (err) {
                    parent.debug('webrelay', user.name + ' - TCP relay error from ' + node.host + ':' + port + ': ' + err);
                    try { ws.close(); } catch (e) { }
                });

                // Fetch Intel AMT credentials & Setup interceptor
                if (req.query.p == 1) { ws.interceptor = obj.interceptor.CreateHttpInterceptor({ host: node.host, port: port, user: node.intelamt.user, pass: node.intelamt.pass }); }
                else if (req.query.p == 2) { ws.interceptor = obj.interceptor.CreateRedirInterceptor({ user: node.intelamt.user, pass: node.intelamt.pass }); }

                if (node.intelamt.tls == 0) {
                    // A TCP connection to Intel AMT just connected, start forwarding.
                    ws.forwardclient.connect(port, node.host, function () {
                        parent.debug('webrelay', user.name + ' - TCP relay connected to ' + node.host + ':' + port + '.');
                        ws.forwardclient.xstate = 1;
                        ws._socket.resume();
                    });
                }
            }

            // Log the connection
            if (user != null) {
                if (req.query.p == 2) { // Only log event if Intel Redirection, otherwise hundreds of logs for WSMAN are recorded
                    var msg = 'Started relay session', msgid = 13, ip = ((ciraconn != null) ? ciraconn.remoteAddr : (((conn & 4) != 0) ? node.host : req.clientIp));
                    var event = { etype: 'relay', action: 'relaylog', domain: domain.id, userid: user._id, username: user.name, msgid: msgid, msgArgs: [ws.id, req.clientIp, ip], msg: msg + ' \"' + ws.id + '\" from ' + req.clientIp + ' to ' + ip, protocol: 101, nodeid: node._id };
                    obj.parent.DispatchEvent(['*', user._id], obj, event);
                }

                // Update user last access time
                if ((user != null)) {
                    const timeNow = Math.floor(Date.now() / 1000);
                    if (user.access < (timeNow - 300)) { // Only update user access time if longer than 5 minutes
                        user.access = timeNow;
                        obj.parent.db.SetUser(user);

                        // Event the change
                        var message = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', domain: domain.id, nolog: 1 };
                        if (parent.db.changeStream) { message.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
                        obj.parent.DispatchEvent(targets, obj, message);
                    }
                }
            }
        });
    }

    // Handle Intel AMT events
    // To subscribe, add "http://server:port/amtevents.ashx" to Intel AMT subscriptions.
    obj.handleAmtEventRequest = function (req, res) {
        const domain = getDomain(req);
        try {
            if (req.headers.authorization) {
                var authstr = req.headers.authorization;
                if (authstr.substring(0, 7) == 'Digest ') {
                    var auth = obj.common.parseNameValueList(obj.common.quoteSplit(authstr.substring(7)));
                    if ((req.url === auth.uri) && (obj.httpAuthRealm === auth.realm) && (auth.opaque === obj.crypto.createHmac('SHA384', obj.httpAuthRandom).update(auth.nonce).digest('hex'))) {

                        // Read the data, we need to get the arg field
                        var eventData = '';
                        req.on('data', function (chunk) { eventData += chunk; });
                        req.on('end', function () {

                            // Completed event read, let get the argument that must contain the nodeid
                            var i = eventData.indexOf('<m:arg xmlns:m="http://x.com">');
                            if (i > 0) {
                                var nodeid = eventData.substring(i + 30, i + 30 + 64);
                                if (nodeid.length == 64) {
                                    var nodekey = 'node/' + domain.id + '/' + nodeid;

                                    // See if this node exists in the database
                                    obj.db.Get(nodekey, function (err, nodes) {
                                        if (nodes.length == 1) {
                                            // Yes, the node exists, compute Intel AMT digest password
                                            var node = nodes[0];
                                            var amtpass = obj.crypto.createHash('sha384').update(auth.username.toLowerCase() + ':' + nodeid + ":" + obj.parent.dbconfig.amtWsEventSecret).digest('base64').substring(0, 12).split('/').join('x').split('\\').join('x');

                                            // Check the MD5 hash
                                            if (auth.response === obj.common.ComputeDigesthash(auth.username, amtpass, auth.realm, 'POST', auth.uri, auth.qop, auth.nonce, auth.nc, auth.cnonce)) {

                                                // This is an authenticated Intel AMT event, update the host address
                                                var amthost = req.clientIp;
                                                if (amthost.substring(0, 7) === '::ffff:') { amthost = amthost.substring(7); }
                                                if (node.host != amthost) {
                                                    // Get the mesh for this device
                                                    var mesh = obj.meshes[node.meshid];
                                                    if (mesh) {
                                                        // Update the database
                                                        var oldname = node.host;
                                                        node.host = amthost;
                                                        obj.db.Set(obj.cleanDevice(node));

                                                        // Event the node change
                                                        var event = { etype: 'node', action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Intel(R) AMT host change ' + node.name + ' from group ' + mesh.name + ': ' + oldname + ' to ' + amthost };

                                                        // Remove the Intel AMT password before eventing this.
                                                        event.node = node;
                                                        if (event.node.intelamt && event.node.intelamt.pass) {
                                                            event.node = Object.assign({}, event.node); // Shallow clone
                                                            event.node.intelamt = Object.assign({}, event.node.intelamt); // Shallow clone
                                                            delete event.node.intelamt.pass;
                                                        }

                                                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the node. Another event will come.
                                                        obj.parent.DispatchEvent(['*', node.meshid], obj, event);
                                                    }
                                                }

                                                if (parent.amtEventHandler) { parent.amtEventHandler.handleAmtEvent(eventData, nodeid, amthost); }
                                                //res.send('OK');

                                                return;
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            }
        } catch (e) { console.log(e); }

        // Send authentication response
        obj.crypto.randomBytes(48, function (err, buf) {
            var nonce = buf.toString('hex'), opaque = obj.crypto.createHmac('SHA384', obj.httpAuthRandom).update(nonce).digest('hex');
            res.set({ 'WWW-Authenticate': 'Digest realm="' + obj.httpAuthRealm + '", qop="auth,auth-int", nonce="' + nonce + '", opaque="' + opaque + '"' });
            res.sendStatus(401);
        });
    };

    // Handle a request to download a mesh agent
    obj.handleMeshAgentRequest = function (req, res) {
        var domain = getDomain(req, res);
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { res.sendStatus(401); return; }

        if ((req.query.meshinstall != null) && (req.query.id != null)) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send meshagent with included self installer for a specific platform back
            // Start by getting the .msh for this request
            var meshsettings = getMshFromRequest(req, res, domain);
            if (meshsettings == null) { try { res.sendStatus(401); } catch (ex) { } return; }

            // Get the interactive install script, this only works for non-Windows agents
            var agentid = parseInt(req.query.meshinstall);
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
            var scriptInfo = obj.parent.meshAgentInstallScripts[6];
            if ((argentInfo == null) || (scriptInfo == null) || (argentInfo.platform == 'win32')) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Change the .msh file into JSON format and merge it into the install script
            var tokens, msh = {}, meshsettingslines = meshsettings.split('\r').join('').split('\n');
            for (var i in meshsettingslines) { tokens = meshsettingslines[i].split('='); if (tokens.length == 2) { msh[tokens[0]] = tokens[1]; } }
            var js = scriptInfo.data.replace('var msh = {};', 'var msh = ' + JSON.stringify(msh) + ';');

            // Get the agent filename
            var meshagentFilename = 'meshagent';
            if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }

            setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename, null, 'meshagent');
            if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
            res.statusCode = 200;
            obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: Buffer.from(js, 'utf8'), peinfo: argentInfo.pe });
        } else if (req.query.id != null) {
            // Send a specific mesh agent back
            var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) { argentInfo = domain.meshAgentBinaries[req.query.id]; }
            if (argentInfo == null) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Download PDB debug files, only allowed for administrator or accounts with agent dump access
            if (req.query.pdb == 1) {
                if ((req.session == null) || (req.session.userid == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
                var user = obj.users[req.session.userid];
                if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                if ((user != null) && ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0)))) {
                    if (argentInfo.id == 3) {
                        setContentDispositionHeader(res, 'application/octet-stream', 'MeshService.pdb', null, 'MeshService.pdb');
                        if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                        try { res.sendFile(argentInfo.path.split('MeshService-signed.exe').join('MeshService.pdb')); } catch (ex) { }
                        return;
                    }
                    if (argentInfo.id == 4) {
                        setContentDispositionHeader(res, 'application/octet-stream', 'MeshService64.pdb', null, 'MeshService64.pdb');
                        if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                        try { res.sendFile(argentInfo.path.split('MeshService64-signed.exe').join('MeshService64.pdb')); } catch (ex) { }
                        return;
                    }
                }
                try { res.sendStatus(404); } catch (ex) { }
                return;
            }

            if ((req.query.meshid == null) || (argentInfo.platform != 'win32')) {
                // Get the agent filename
                var meshagentFilename = argentInfo.rname;
                if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }
                if (argentInfo.rname.endsWith('.apk') && !meshagentFilename.endsWith('.apk')) { meshagentFilename = meshagentFilename + '.apk'; }
                if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                if (req.query.zip == 1) { if (argentInfo.zdata != null) { setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename + '.zip', null, 'meshagent.zip'); res.send(argentInfo.zdata); } else { try { res.sendStatus(404); } catch (ex) { } } return; } // Send compressed agent
                setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename, null, 'meshagent');
                if (argentInfo.data == null) { res.sendFile(argentInfo.path); } else { res.send(argentInfo.data); }
                return;
            } else {
                // Check if the meshid is a time limited, encrypted cookie
                var meshcookie = obj.parent.decodeCookie(req.query.meshid, obj.parent.invitationLinkEncryptionKey);
                if ((meshcookie != null) && (meshcookie.m != null)) { req.query.meshid = meshcookie.m; }

                // We are going to embed the .msh file into the Windows executable (signed or not).
                // First, fetch the mesh object to build the .msh file
                var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
                if (mesh == null) { try { res.sendStatus(401); } catch (ex) { } return; }

                // If required, check if this user has rights to do this
                if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
                    if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { try { res.sendStatus(401); } catch (ex) { } return; }
                }

                var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port if specified
                if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
                if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.

                // Prepare a mesh agent file name using the device group name.
                var meshfilename = mesh.name
                meshfilename = meshfilename.split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split(' ').join('').split('\'').join('');
                if (argentInfo.rname.endsWith('.exe')) { meshfilename = argentInfo.rname.substring(0, argentInfo.rname.length - 4) + '-' + meshfilename + '.exe'; } else { meshfilename = argentInfo.rname + '-' + meshfilename; }

                // Customize the mesh agent file name
                if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) {
                    meshfilename = meshfilename.split('meshagent').join(domain.agentcustomization.filename).split('MeshAgent').join(domain.agentcustomization.filename);
                }

                // Get the agent connection server name
                var serverName = obj.getWebServerName(domain, req);
                if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

                // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
                var xdomain = (domain.dns == null) ? domain.id : '';
                if (xdomain != '') xdomain += '/';
                var meshsettings = '';
                if (req.query.ac != '4') { // If MeshCentral Assistant Monitor Mode, DONT INCLUDE SERVER DETAILS!
                    meshsettings += '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
                    if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
                        meshsettings += 'MeshServer=local\r\n';
                        if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
                    }
                    if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + encodeURIComponent(req.query.tag) + '\r\n'; }
                    if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
                }
                if (req.query.id == '10006') { // Assistant settings and customizations
                    if ((req.query.ac != null)) { meshsettings += 'AutoConnect=' + req.query.ac + '\r\n'; } // Set MeshCentral Assistant flags if needed. 0x01 = Always Connected, 0x02 = Not System Tray
                    if (obj.args.assistantconfig) { for (var i in obj.args.assistantconfig) { meshsettings += obj.args.assistantconfig[i] + '\r\n'; } }
                    if (domain.assistantconfig) { for (var i in domain.assistantconfig) { meshsettings += domain.assistantconfig[i] + '\r\n'; } }
                    if ((domain.assistantnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
                    if ((domain.assistantcustomization != null) && (typeof domain.assistantcustomization == 'object')) {
                        if (typeof domain.assistantcustomization.title == 'string') { meshsettings += 'Title=' + domain.assistantcustomization.title + '\r\n'; }
                        if (typeof domain.assistantcustomization.image == 'string') {
                            try { meshsettings += 'Image=' + Buffer.from(obj.fs.readFileSync(parent.getConfigFilePath(domain.assistantcustomization.image)), 'binary').toString('base64') + '\r\n'; } catch (ex) { console.log(ex); }
                        }
                        if (req.query.ac != '4') {
                            // Send with custom filename followed by device group name
                            if (typeof domain.assistantcustomization.filename == 'string') { meshfilename = meshfilename.split('MeshCentralAssistant').join(domain.assistantcustomization.filename); }
                        } else {
                            // Send with custom filename, no device group name
                            if (typeof domain.assistantcustomization.filename == 'string') { meshfilename = domain.assistantcustomization.filename + '.exe'; } else { meshfilename = 'MeshCentralAssistant.exe'; }
                        }
                    }
                } else { // Add agent customization, not for Assistant
                    if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
                    if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
                    if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
                    if (domain.agentcustomization != null) {
                        if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
                        if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
                        if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
                        if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
                        if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
                        if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
                        if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
                        if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
                    }
                    if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; } // Translation strings, not for MeshCentral Assistant
                }
                setContentDispositionHeader(res, 'application/octet-stream', meshfilename, null, argentInfo.rname);
                if (argentInfo.mtime != null) { res.setHeader('Last-Modified', argentInfo.mtime.toUTCString()); }
                if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) {
                    obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: domain.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: domain.meshAgentBinaries[req.query.id].pe });
                } else {
                    obj.parent.exeHandler.streamExeWithMeshPolicy({ platform: 'win32', sourceFileName: obj.parent.meshAgentBinaries[req.query.id].path, destinationStream: res, msh: meshsettings, peinfo: obj.parent.meshAgentBinaries[req.query.id].pe });
                }
                return;
            }
        } else if (req.query.script != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send a specific mesh install script back
            var scriptInfo = obj.parent.meshAgentInstallScripts[req.query.script];
            if (scriptInfo == null) { try { res.sendStatus(404); } catch (ex) { } return; }
            setContentDispositionHeader(res, 'application/octet-stream', scriptInfo.rname, null, 'script');
            var data = scriptInfo.data;
            var cmdoptions = { wgetoptionshttp: '', wgetoptionshttps: '', curloptionshttp: '-L ', curloptionshttps: '-L ' }
            if (obj.isTrustedCert(domain) != true) {
                cmdoptions.wgetoptionshttps += '--no-check-certificate ';
                cmdoptions.curloptionshttps += '-k ';
            }
            if (domain.agentnoproxy === true) {
                cmdoptions.wgetoptionshttp += '--no-proxy ';
                cmdoptions.wgetoptionshttps += '--no-proxy ';
                cmdoptions.curloptionshttp += '--noproxy \'*\' ';
                cmdoptions.curloptionshttps += '--noproxy \'*\' ';
            }
            for (var i in cmdoptions) { data = data.split('{{{' + i + '}}}').join(cmdoptions[i]); }
            res.send(data);
            return;
        } else if (req.query.meshcmd != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key

            // Send meshcmd for a specific platform back
            var agentid = parseInt(req.query.meshcmd);

            // If the agentid is 3 or 4, check if we have a signed MeshCmd.exe
            if ((agentid == 3) && (obj.parent.meshAgentBinaries[11000] != null)) { // Signed Windows MeshCmd.exe x86-32
                var stats = null, meshCmdPath = obj.parent.meshAgentBinaries[11000].path;
                try { stats = obj.fs.statSync(meshCmdPath); } catch (e) { }
                if ((stats != null)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd.exe', null, 'meshcmd');
                    res.sendFile(meshCmdPath); return;
                }
            } else if ((agentid == 4) && (obj.parent.meshAgentBinaries[11001] != null)) { // Signed Windows MeshCmd64.exe x86-64
                var stats = null, meshCmd64Path = obj.parent.meshAgentBinaries[11001].path;
                try { stats = obj.fs.statSync(meshCmd64Path); } catch (e) { }
                if ((stats != null)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd.exe', null, 'meshcmd');
                    res.sendFile(meshCmd64Path); return;
                }
            } else if ((agentid == 43) && (obj.parent.meshAgentBinaries[11002] != null)) { // Signed Windows MeshCmd64.exe ARM-64
                var stats = null, meshCmdAMR64Path = obj.parent.meshAgentBinaries[11002].path;
                try { stats = obj.fs.statSync(meshCmdAMR64Path); } catch (e) { }
                if ((stats != null)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd-arm64.exe', null, 'meshcmd');
                    res.sendFile(meshCmdAMR64Path); return;
                }
            }

            // No signed agents, we are going to merge a new MeshCmd.
            if (((agentid == 3) || (agentid == 4)) && (obj.parent.meshAgentBinaries[agentid + 10000] != null)) { agentid += 10000; } // Avoid merging javascript to a signed mesh agent.
            var argentInfo = obj.parent.meshAgentBinaries[agentid];
            if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
            if ((argentInfo == null) || (obj.parent.defaultMeshCmd == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
            setContentDispositionHeader(res, 'application/octet-stream', 'meshcmd' + ((req.query.meshcmd <= 4) ? '.exe' : ''), null, 'meshcmd');
            res.statusCode = 200;

            if (argentInfo.signedMeshCmdPath != null) {
                // If we have a pre-signed MeshCmd, send that.
                res.sendFile(argentInfo.signedMeshCmdPath);
            } else {
                // Merge JavaScript to a unsigned agent and send that.
                obj.parent.exeHandler.streamExeWithJavaScript({ platform: argentInfo.platform, sourceFileName: argentInfo.path, destinationStream: res, js: Buffer.from(obj.parent.defaultMeshCmd, 'utf8'), peinfo: argentInfo.pe });
            }
            return;
        } else if (req.query.meshaction != null) {
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key
            var user = obj.users[req.session.userid];
            if (user == null) {
                // Check if we have an authentication cookie
                var c = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey);
                if (c == null) { try { res.sendStatus(404); } catch (ex) { } return; }

                // Download tools using a cookie
                if (c.download == req.query.meshaction) {
                    if (req.query.meshaction == 'winrouter') {
                        var p = null;
                        if (obj.parent.meshToolsBinaries['MeshCentralRouter']) { p = obj.parent.meshToolsBinaries['MeshCentralRouter'].path; }
                        if ((p == null) || (!obj.fs.existsSync(p))) { p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.exe'); }
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.exe', null, 'MeshCentralRouter.exe');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    } else if (req.query.meshaction == 'winassistant') {
                        var p = null;
                        if (obj.parent.meshToolsBinaries['MeshCentralAssistant']) { p = obj.parent.meshToolsBinaries['MeshCentralAssistant'].path; }
                        if ((p == null) || (!obj.fs.existsSync(p))) { p = obj.path.join(__dirname, 'agents', 'MeshCentralAssistant.exe'); }
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralAssistant.exe', null, 'MeshCentralAssistant.exe');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    } else if (req.query.meshaction == 'macrouter') {
                        var p = null;
                        if (obj.parent.meshToolsBinaries['MeshCentralRouterMacOS']) { p = obj.parent.meshToolsBinaries['MeshCentralRouterMacOS'].path; }
                        if ((p == null) || (!obj.fs.existsSync(p))) { p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.dmg'); }
                        if (obj.fs.existsSync(p)) {
                            setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.dmg', null, 'MeshCentralRouter.dmg');
                            try { res.sendFile(p); } catch (ex) { }
                        } else { try { res.sendStatus(404); } catch (ex) { } }
                        return;
                    }
                    return;
                }

                // Check if the cookie authenticates a user
                if (c.userid == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                user = obj.users[c.userid];
                if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }
            }
            if ((req.query.meshaction == 'route') && (req.query.nodeid != null)) {
                var nodeIdSplit = req.query.nodeid.split('/');
                if ((nodeIdSplit[0] != 'node') || (nodeIdSplit[1] != domain.id)) { try { res.sendStatus(401); } catch (ex) { } return; }
                obj.db.Get(req.query.nodeid, function (err, nodes) {
                    if ((err != null) || (nodes.length != 1)) { try { res.sendStatus(401); } catch (ex) { } return; }
                    var node = nodes[0];

                    // Create the meshaction.txt file for meshcmd.exe
                    var meshaction = {
                        action: req.query.meshaction,
                        localPort: 1234,
                        remoteName: node.name,
                        remoteNodeId: node._id,
                        remoteTarget: null,
                        remotePort: 3389,
                        username: '',
                        password: '',
                        serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                        serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                        debugLevel: 0
                    };
                    if (user != null) { meshaction.username = user.name; }
                    if (req.query.key != null) { meshaction.loginKey = req.query.key; }
                    var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                    if (obj.args.lanonly != true) { meshaction.serverUrl = 'wss://' + obj.getWebServerName(domain, req) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : (domain.id + '/')) + 'meshrelay.ashx'; }

                    setContentDispositionHeader(res, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
                    res.send(JSON.stringify(meshaction, null, ' '));
                    return;
                });
            } else if (req.query.meshaction == 'generic') {
                var meshaction = {
                    username: user.name,
                    password: '',
                    serverId: obj.agentCertificateHashHex.toUpperCase(), // SHA384 of server HTTPS public key
                    serverHttpsHash: Buffer.from(obj.webCertificateHashs[domain.id], 'binary').toString('hex').toUpperCase(), // SHA384 of server HTTPS certificate
                    debugLevel: 0
                };
                if (user != null) { meshaction.username = user.name; }
                if (req.query.key != null) { meshaction.loginKey = req.query.key; }
                var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
                if (obj.args.lanonly != true) { meshaction.serverUrl = 'wss://' + obj.getWebServerName(domain, req) + ':' + httpsPort + '/' + ((domain.id == '') ? '' : ('/' + domain.id)) + 'meshrelay.ashx'; }
                setContentDispositionHeader(res, 'application/octet-stream', 'meshaction.txt', null, 'meshaction.txt');
                res.send(JSON.stringify(meshaction, null, ' '));
                return;
            } else if (req.query.meshaction == 'winrouter') {
                var p = null;
                if (parent.meshToolsBinaries['MeshCentralRouter']) { p = parent.meshToolsBinaries['MeshCentralRouter'].path; }
                if ((p == null) || !obj.fs.existsSync(p)) { p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.exe'); }
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.exe', null, 'MeshCentralRouter.exe');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else if (req.query.meshaction == 'winassistant') {
                var p = null;
                if (parent.meshToolsBinaries['MeshCentralAssistant']) { p = parent.meshToolsBinaries['MeshCentralAssistant'].path; }
                if ((p == null) || !obj.fs.existsSync(p)) { p = obj.path.join(__dirname, 'agents', 'MeshCentralAssistant.exe'); }
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralAssistant.exe', null, 'MeshCentralAssistant.exe');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else if (req.query.meshaction == 'macrouter') {
                var p = null;
                if (parent.meshToolsBinaries['MeshCentralRouterMacOS']) { p = parent.meshToolsBinaries['MeshCentralRouterMacOS'].path; }
                if ((p == null) || !obj.fs.existsSync(p)) { p = obj.path.join(__dirname, 'agents', 'MeshCentralRouter.dmg'); }
                if (obj.fs.existsSync(p)) {
                    setContentDispositionHeader(res, 'application/octet-stream', 'MeshCentralRouter.dmg', null, 'MeshCentralRouter.dmg');
                    try { res.sendFile(p); } catch (ex) { }
                } else { try { res.sendStatus(404); } catch (ex) { } }
                return;
            } else {
                try { res.sendStatus(401); } catch (ex) { }
                return;
            }
        } else {
            domain = checkUserIpAddress(req, res); // Recheck the domain to apply user IP filtering.
            if (domain == null) return;
            if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { try { res.sendStatus(404); } catch (ex) { } return; } // Check 3FA URL key
            if ((req.session == null) || (req.session.userid == null)) { try { res.sendStatus(404); } catch (ex) { } return; }
            var user = null, coreDumpsAllowed = false;
            if (typeof req.session.userid == 'string') { user = obj.users[req.session.userid]; }
            if (user == null) { try { res.sendStatus(404); } catch (ex) { } return; }

            // Check if this user has access to agent core dumps
            if ((obj.parent.config.settings.agentcoredump === true) && ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0)))) {
                coreDumpsAllowed = true;

                if ((req.query.dldump != null) && obj.common.IsFilenameValid(req.query.dldump)) {
                    // Download a dump file
                    var dumpFile = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', req.query.dldump);
                    if (obj.fs.existsSync(dumpFile)) {
                        setContentDispositionHeader(res, 'application/octet-stream', req.query.dldump, null, 'file.bin');
                        res.sendFile(dumpFile); return;
                    } else {
                        try { res.sendStatus(404); } catch (ex) { } return;
                    }
                }

                if ((req.query.deldump != null) && obj.common.IsFilenameValid(req.query.deldump)) {
                    // Delete a dump file
                    try { obj.fs.unlinkSync(obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', req.query.deldump)); } catch (ex) { console.log(ex); }
                }

                if ((req.query.dumps != null) || (req.query.deldump != null)) {
                    // Send list of agent core dumps
                    var response = '<html><head><title>Mesh Agents Core Dumps</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
                    response += '<tr style="background-color:lightgray"><th>ID</th><th>Upload Date</th><th>Description</th><th>Current</th><th>Dump</th><th>Size</th><th>Agent</th><th>Agent SHA384</th><th>NodeID</th><th></th></tr>';

                    var coreDumpPath = obj.path.join(parent.datapath, '..', 'meshcentral-coredumps');
                    if (obj.fs.existsSync(coreDumpPath)) {
                        var files = obj.fs.readdirSync(coreDumpPath);
                        var coredumps = [];
                        for (var i in files) {
                            var file = files[i];
                            if (file.endsWith('.dmp')) {
                                var fileSplit = file.substring(0, file.length - 4).split('-');
                                if (fileSplit.length == 3) {
                                    var agentid = parseInt(fileSplit[0]);
                                    if ((isNaN(agentid) == false) && (obj.parent.meshAgentBinaries[agentid] != null)) {
                                        var agentinfo = obj.parent.meshAgentBinaries[agentid];
                                        if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
                                        var filestats = obj.fs.statSync(obj.path.join(parent.datapath, '..', 'meshcentral-coredumps', file));
                                        coredumps.push({
                                            fileSplit: fileSplit,
                                            agentinfo: agentinfo,
                                            filestats: filestats,
                                            currentAgent: agentinfo.hashhex.startsWith(fileSplit[1].toLowerCase()),
                                            downloadUrl: req.originalUrl.split('?')[0] + '?dldump=' + file + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : ''),
                                            deleteUrl: req.originalUrl.split('?')[0] + '?deldump=' + file + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : ''),
                                            agentUrl: req.originalUrl.split('?')[0] + '?id=' + agentinfo.id + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : ''),
                                            time: new Date(filestats.ctime)
                                        });
                                    }
                                }
                            }
                        }
                        coredumps.sort(function (a, b) { if (a.time > b.time) return -1; if (a.time < b.time) return 1; return 0; });
                        for (var i in coredumps) {
                            var d = coredumps[i];
                            response += '<tr><td>' + d.agentinfo.id + '</td><td>' + d.time.toDateString().split(' ').join('&nbsp;') + '</td><td>' + d.agentinfo.desc.split(' ').join('&nbsp;') + '</td>';
                            response += '<td style=text-align:center>' + d.currentAgent + '</td><td><a download href="' + d.downloadUrl + '">Download</a></td><td style=text-align:right>' + d.filestats.size + '</td>';
                            if (d.currentAgent) { response += '<td><a download href="' + d.agentUrl + '">Download</a></td>'; } else { response += '<td></td>'; }
                            response += '<td>' + d.fileSplit[1].toLowerCase() + '</td><td>' + d.fileSplit[2] + '</td><td><a href="' + d.deleteUrl + '">Delete</a></td></tr>';
                        }
                    }
                    response += '</table><a href="' + req.originalUrl.split('?')[0] + (req.query.key ? ('?key=' + encodeURIComponent(req.query.key)) : '') + '">Mesh Agents</a></body></html>';
                    res.send(response);
                    return;
                }
            }

            if (req.query.cores != null) {
                // Send list of agent cores
                var response = '<html><head><title>Mesh Agents Cores</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
                response += '<tr style="background-color:lightgray"><th>Name</th><th>Size</th><th>Comp</th><th>Decompressed Hash SHA384</th></tr>';
                for (var i in parent.defaultMeshCores) {
                    response += '<tr><td>' + i.split(' ').join('&nbsp;') + '</td><td style="text-align:right"><a download href="/meshagents?dlcore=' + i + '">' + parent.defaultMeshCores[i].length + (req.query.key ? ('?key=' + encodeURIComponent(req.query.key)) : '') + '</a></td><td style="text-align:right"><a download href="/meshagents?dlccore=' + i + (req.query.key ? ('?key=' + encodeURIComponent(req.query.key)) : '') + '">' + parent.defaultMeshCoresDeflate[i].length + '</a></td><td>' + Buffer.from(parent.defaultMeshCoresHash[i], 'binary').toString('hex') + '</td></tr>';
                }
                response += '</table><a href="' + req.originalUrl.split('?')[0] + (req.query.key ? ('?key=' + encodeURIComponent(req.query.key)) : '') + '">Mesh Agents</a></body></html>';
                res.send(response);
                return;
            }

            if (req.query.dlcore != null) {
                // Download mesh core
                var bin = parent.defaultMeshCores[req.query.dlcore];
                if ((bin == null) || (bin.length < 5)) { try { res.sendStatus(404); } catch (ex) { } return; }
                setContentDispositionHeader(res, 'application/octet-stream', encodeURIComponent(req.query.dlcore) + '.js', null, 'meshcore.js');
                res.send(bin.slice(4));
                return;
            }

            if (req.query.dlccore != null) {
                // Download compressed mesh core
                var bin = parent.defaultMeshCoresDeflate[req.query.dlccore];
                if (bin == null) { try { res.sendStatus(404); } catch (ex) { } return; }
                setContentDispositionHeader(res, 'application/octet-stream', req.query.dlccore + '.js.deflate', null, 'meshcore.js.deflate');
                res.send(bin);
                return;
            }

            // Send a list of available mesh agents
            var response = '<html><head><title>Mesh Agents</title><style>table,th,td { border:1px solid black;border-collapse:collapse;padding:3px; }</style></head><body style=overflow:auto><table>';
            response += '<tr style="background-color:lightgray"><th>ID</th><th>Description</th><th>Link</th><th>Size</th><th>SHA384</th><th>MeshCmd</th></tr>';
            var originalUrl = req.originalUrl.split('?')[0];
            for (var agentid in obj.parent.meshAgentBinaries) {
                if ((agentid >= 10000) && (agentid != 10005)) continue;
                var agentinfo = obj.parent.meshAgentBinaries[agentid];
                if (domain.meshAgentBinaries && domain.meshAgentBinaries[agentid]) { argentInfo = domain.meshAgentBinaries[agentid]; }
                response += '<tr><td>' + agentinfo.id + '</td><td>' + agentinfo.desc.split(' ').join('&nbsp;') + '</td>';
                response += '<td><a download href="' + originalUrl + '?id=' + agentinfo.id + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">' + agentinfo.rname + '</a>';
                if ((user.siteadmin == 0xFFFFFFFF) || ((Array.isArray(obj.parent.config.settings.agentcoredumpusers)) && (obj.parent.config.settings.agentcoredumpusers.indexOf(user._id) >= 0))) {
                    if ((agentid == 3) || (agentid == 4)) { response += ', <a download href="' + originalUrl + '?id=' + agentinfo.id + '&pdb=1' + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">PDB</a>'; }
                }
                if (agentinfo.zdata != null) { response += ', <a download href="' + originalUrl + '?id=' + agentinfo.id + '&zip=1' + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">ZIP</a>'; }
                response += '</td>';
                response += '<td>' + agentinfo.size + '</td><td>' + agentinfo.hashhex + '</td>';
                response += '<td><a download href="' + originalUrl + '?meshcmd=' + agentinfo.id + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">' + agentinfo.rname.replace('agent', 'cmd') + '</a></td></tr>';
            }
            response += '</table>';
            response += '<a href="' + originalUrl + '?cores=1' + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">MeshCores</a> ';
            if (coreDumpsAllowed) { response += '<a href="' + originalUrl + '?dumps=1' + (req.query.key ? ('&key=' + encodeURIComponent(req.query.key)) : '') + '">MeshAgent Crash Dumps</a>'; }
            response += '</body></html>';
            res.send(response);
            return;
        }
    };

    // Create a OSX mesh agent installer
    obj.handleMeshOsxAgentRequest = function (req, res) {
        const domain = getDomain(req, res);
        if (domain == null) { parent.debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }
        if (req.query.id == null) { res.sendStatus(404); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { res.sendStatus(401); return; }

        // Send a specific mesh agent back
        var argentInfo = obj.parent.meshAgentBinaries[req.query.id];
        if (domain.meshAgentBinaries && domain.meshAgentBinaries[req.query.id]) { argentInfo = domain.meshAgentBinaries[req.query.id]; }
        if ((argentInfo == null) || (req.query.meshid == null)) { res.sendStatus(404); return; }

        // Check if the meshid is a time limited, encrypted cookie
        var meshcookie = obj.parent.decodeCookie(req.query.meshid, obj.parent.invitationLinkEncryptionKey);
        if ((meshcookie != null) && (meshcookie.m != null)) { req.query.meshid = meshcookie.m; }

        // We are going to embed the .msh file into the Windows executable (signed or not).
        // First, fetch the mesh object to build the .msh file
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.meshid];
        if (mesh == null) { res.sendStatus(401); return; }

        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
            if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { res.sendStatus(401); return; }
        }

        var meshidhex = Buffer.from(req.query.meshid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Get the agent connection server name
        var serverName = obj.getWebServerName(domain, req);
        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
        if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
        if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
            meshsettings += 'MeshServer=local\r\n';
            if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
        }
        if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + encodeURIComponent(req.query.tag) + '\r\n'; }
        if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
        if (domain.agentcustomization != null) { // Add agent customization
            if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; }

        // Setup the response output
        var archive = require('archiver')('zip', { level: 5 }); // Sets the compression method.
        archive.on('error', function (err) { throw err; });

        // Customize the mesh agent file name
        var meshfilename = 'MeshAgent-' + mesh.name + '.zip';
        var meshexecutablename = 'meshagent';
        var meshpkgname = 'MeshAgent.pkg';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) {
            meshfilename = meshfilename.split('MeshAgent').join(domain.agentcustomization.filename);
            meshexecutablename = meshexecutablename.split('meshagent').join(domain.agentcustomization.filename);
            meshpkgname = meshpkgname.split('MeshAgent').join(domain.agentcustomization.filename);
        }

        // Customise the mesh agent display name
        var meshdisplayname = 'Mesh Agent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.displayname == 'string')) {
            meshdisplayname = meshdisplayname.split('Mesh Agent').join(domain.agentcustomization.displayname);
        }

        // Customise the mesh agent service name
        var meshservicename = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.servicename == 'string')) {
            meshservicename = meshservicename.split('meshagent').join(domain.agentcustomization.servicename);
        }

        // Customise the mesh agent company name
        var meshcompanyname = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.companyname == 'string')) {
            meshcompanyname = meshcompanyname.split('meshagent').join(domain.agentcustomization.companyname);
        }

        // Set the agent download including the mesh name.
        setContentDispositionHeader(res, 'application/octet-stream', meshfilename, null, 'MeshAgent.zip');
        archive.pipe(res);

        // Create a flat XAR macOS installer package. Bundle .mpkg installers are rejected by recent macOS versions.
        const macosInstallerOpts = {
            agentPath: argentInfo.path,
            meshSettings: meshsettings,
            meshName: mesh.name.split(']').join('').split('[').join(''), // We can't have ']]' in the string since it will terminate the CDATA.
            executableName: meshexecutablename,
            packageName: meshpkgname,
            displayName: meshdisplayname,
            serviceName: meshservicename,
            companyName: meshcompanyname
        };

        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.macosinstallerimage == 'string')) {
            macosInstallerOpts.backgroundPath = parent.path.join(parent.datapath, domain.agentcustomization.macosinstallerimage);
        }

        require('./macosinstaller').createMacOSInstaller(macosInstallerOpts).then(function (installer) {
            archive.append(installer.pkg, { name: meshpkgname });
            archive.append(installer.uninstall, { name: 'Uninstall.command', mode: 493 });
            archive.finalize();
        }).catch(function (err) {
            parent.debug('web', 'Failed to build macOS MeshAgent package: ' + err);
            try { res.sendStatus(500); } catch (ex) { }
        });
    }

    // Return a .msh file from a given request, id is the device group identifier or encrypted cookie with the identifier.
    function getMshFromRequest(req, res, domain) {
        // If required, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true)) && (req.session.userid == null)) { return null; }

        // Check if the meshid is a time limited, encrypted cookie
        var meshcookie = obj.parent.decodeCookie(req.query.id, obj.parent.invitationLinkEncryptionKey);
        if ((meshcookie != null) && (meshcookie.m != null)) { req.query.id = meshcookie.m; }

        // Fetch the mesh object
        var mesh = obj.meshes['mesh/' + domain.id + '/' + req.query.id];
        if (mesh == null) { return null; }

        // If needed, check if this user has rights to do this
        if ((obj.parent.config.settings != null) && ((obj.parent.config.settings.lockagentdownload == true) || (domain.lockagentdownload == true))) {
            if ((domain.id != mesh.domain) || ((obj.GetMeshRights(req.session.userid, mesh) & 1) == 0)) { return null; }
        }

        var meshidhex = Buffer.from(req.query.id.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();
        var serveridhex = Buffer.from(obj.agentCertificateHashBase64.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase();

        // Get the agent connection server name
        var serverName = obj.getWebServerName(domain, req);
        if (typeof obj.args.agentaliasdns == 'string') { serverName = obj.args.agentaliasdns; }

        // Build the agent connection URL. If we are using a sub-domain or one with a DNS, we need to craft the URL correctly.
        var xdomain = (domain.dns == null) ? domain.id : '';
        if (xdomain != '') xdomain += '/';
        var meshsettings = '\r\nMeshName=' + mesh.name + '\r\nMeshType=' + mesh.mtype + '\r\nMeshID=0x' + meshidhex + '\r\nServerID=' + serveridhex + '\r\n';
        var httpsPort = ((obj.args.aliasport == null) ? obj.args.port : obj.args.aliasport); // Use HTTPS alias port is specified
        if (obj.args.agentport != null) { httpsPort = obj.args.agentport; } // If an agent only port is enabled, use that.
        if (obj.args.agentaliasport != null) { httpsPort = obj.args.agentaliasport; } // If an agent alias port is specified, use that.
        if (obj.args.lanonly != true) { meshsettings += 'MeshServer=wss://' + serverName + ':' + httpsPort + '/' + xdomain + 'agent.ashx\r\n'; } else {
            meshsettings += 'MeshServer=local\r\n';
            if ((obj.args.localdiscovery != null) && (typeof obj.args.localdiscovery.key == 'string') && (obj.args.localdiscovery.key.length > 0)) { meshsettings += 'DiscoveryKey=' + obj.args.localdiscovery.key + '\r\n'; }
        }
        if ((req.query.tag != null) && (typeof req.query.tag == 'string') && (obj.common.isAlphaNumeric(req.query.tag) == true)) { meshsettings += 'Tag=' + encodeURIComponent(req.query.tag) + '\r\n'; }
        if ((req.query.installflags != null) && (req.query.installflags != 0) && (parseInt(req.query.installflags) == req.query.installflags)) { meshsettings += 'InstallFlags=' + parseInt(req.query.installflags) + '\r\n'; }
        if ((domain.agentnoproxy === true) || (obj.args.lanonly == true)) { meshsettings += 'ignoreProxyFile=1\r\n'; }
        if (obj.args.agentconfig) { for (var i in obj.args.agentconfig) { meshsettings += obj.args.agentconfig[i] + '\r\n'; } }
        if (domain.agentconfig) { for (var i in domain.agentconfig) { meshsettings += domain.agentconfig[i] + '\r\n'; } }
        if (domain.agentcustomization != null) { // Add agent customization
            if (domain.agentcustomization.displayname != null) { meshsettings += 'displayName=' + domain.agentcustomization.displayname + '\r\n'; }
            if (domain.agentcustomization.description != null) { meshsettings += 'description=' + domain.agentcustomization.description + '\r\n'; }
            if (domain.agentcustomization.companyname != null) { meshsettings += 'companyName=' + domain.agentcustomization.companyname + '\r\n'; }
            if (domain.agentcustomization.servicename != null) { meshsettings += 'meshServiceName=' + domain.agentcustomization.servicename + '\r\n'; }
            if (domain.agentcustomization.filename != null) { meshsettings += 'fileName=' + domain.agentcustomization.filename + '\r\n'; }
            if (domain.agentcustomization.image != null) { meshsettings += 'image=' + domain.agentcustomization.image + '\r\n'; }
            if (domain.agentcustomization.foregroundcolor != null) { meshsettings += checkAgentColorString('foreground=', domain.agentcustomization.foregroundcolor); }
            if (domain.agentcustomization.backgroundcolor != null) { meshsettings += checkAgentColorString('background=', domain.agentcustomization.backgroundcolor); }
        }
        if (domain.agentTranslations != null) { meshsettings += 'translation=' + domain.agentTranslations + '\r\n'; }
        return meshsettings;
    }

    // Handle a request to download a mesh settings
    obj.handleMeshSettingsRequest = function (req, res) {
        const domain = getDomain(req);
        if (domain == null) { return; }
        //if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }

        var meshsettings = getMshFromRequest(req, res, domain);
        if (meshsettings == null) { res.sendStatus(401); return; }

        // Get the agent filename
        var meshagentFilename = 'meshagent';
        if ((domain.agentcustomization != null) && (typeof domain.agentcustomization.filename == 'string')) { meshagentFilename = domain.agentcustomization.filename; }

        setContentDispositionHeader(res, 'application/octet-stream', meshagentFilename + '.msh', null, 'meshagent.msh');
        res.send(meshsettings);
    };

    // Handle a request for power events
    obj.handleDevicePowerEvents = function (req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; } // Check 3FA URL key
        if ((domain.id !== '') || (!req.session) || (req.session == null) || (!req.session.userid) || (req.query.id == null) || (typeof req.query.id != 'string')) { res.sendStatus(401); return; }
        var x = req.query.id.split('/');
        var user = obj.users[req.session.userid];
        if ((x.length != 3) || (x[0] != 'node') || (x[1] != domain.id) || (user == null) || (user.links == null)) { res.sendStatus(401); return; }

        obj.db.Get(req.query.id, function (err, docs) {
            if (docs.length != 1) {
                res.sendStatus(401);
            } else {
                var node = docs[0];

                // Check if we have right to this node
                if (obj.GetNodeRights(user, node.meshid, node._id) == 0) { res.sendStatus(401); return; }

                // See how we will convert UTC time to local time
                var localTimeOffset = 0;
                var timeConversionSystem = 0;
                if ((req.query.l != null) && (req.query.tz != null)) {
                    timeConversionSystem = 1;
                } else if (req.query.tf != null) {
                    // Get local time offset (bad way)
                    timeConversionSystem = 2;
                    localTimeOffset = parseInt(req.query.tf);
                    if (isNaN(localTimeOffset)) { localTimeOffset = 0; }
                }

                // Get the list of power events and send them
                setContentDispositionHeader(res, 'application/octet-stream', 'powerevents.csv', null, 'powerevents.csv');
                obj.db.getPowerTimeline(node._id, function (err, docs) {
                    var xevents = ['UTC Time, Local Time, State, Previous State'], prevState = 0;
                    for (var i in docs) {
                        if (docs[i].power != prevState) {
                            var timedoc = docs[i].time;
                            if (typeof timedoc == 'string') {
                                timedoc = new Date(timedoc);
                            }
                            prevState = docs[i].power;
                            var localTime = '';
                            if (timeConversionSystem == 1) { // Good way
                                localTime = new Date(timedoc.getTime()).toLocaleString(req.query.l, { timeZone: req.query.tz })
                            } else if (timeConversionSystem == 2) { // Bad way
                                localTime = new Date(timedoc.getTime() + (localTimeOffset * 60000)).toISOString();
                                localTime = localTime.substring(0, localTime.length - 1);
                            }
                            if (docs[i].oldPower != null) {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power + ',' + docs[i].oldPower);
                            } else {
                                xevents.push('\"' + timedoc.toISOString() + '\",\"' + localTime + '\",' + docs[i].power);
                            }
                        }
                    }
                    res.send(xevents.join('\r\n'));
                });
            }
        });
    }

    if (parent.pluginHandler != null) {
        // Handle a plugin admin request
        obj.handlePluginAdminReq = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.handleAdminReq(req, res, user, obj);
        }

        obj.handlePluginAdminPostReq = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.handleAdminPostReq(req, res, user, obj);
        }

        obj.handlePluginJS = function (req, res) {
            const domain = checkUserIpAddress(req, res);
            if (domain == null) { return; }
            if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
            var user = obj.users[req.session.userid];
            if (user == null) { res.sendStatus(401); return; }

            parent.pluginHandler.refreshJS(req, res);
        }
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
                    devicePowerEvents: obj.handleDevicePowerEvents,
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
