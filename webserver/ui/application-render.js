/**
* @description Main authenticated web application rendering
* @license Apache-2.0
*/

'use strict';

const applicationAccess = require('./application-access.js');
const applicationSession = require('./application-session.js');
const applicationServerFeatures = require('./application-server-features.js');
const pageOptions = require('./page-options.js');
const userWebState = require('./user-web-state.js');

module.exports.createApplicationRenderer = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const getQueryPortion = options.getQueryPortion;

    return function renderApplication(request, response, domain, user, noLogout, passRequirements) {
        state.db.Get('ws' + user._id, function (error, states) {
            if (!applicationAccess.validateApplicationAccess(request, response, domain, user, parent, getQueryPortion)) { return; }

            const navigationState = applicationSession.consumeNavigationState(request, domain);
            const logoutControls = {};
            if (args.nousers != true) { logoutControls.name = user.name; }
            const allFeatures = state.getDomainUserFeatures(domain, user, request);
            const authCookie = parent.encodeCookie({ userid: user._id, domainid: domain.id, ip: request.clientIp }, parent.loginCookieEncryptionKey);
            const authRelayCookie = parent.encodeCookie({ ruserid: user._id, x: request.session.x }, parent.loginCookieEncryptionKey);

            const extras = (request.query.key != null) ? ('&key=' + request.query.key) : '';
            if ((!args.user) && (args.nousers != true) && (noLogout == false)) { logoutControls.logoutUrl = domain.url + 'logout?' + Math.random() + extras; }
            const httpsPort = (args.aliasport == null) ? args.port : args.aliasport;

            applicationSession.clearU2fChallenge(request.session, parent.decryptSessionData, parent.encryptSessionData);
            const amtScanOptions = pageOptions.getAmtScanOptions(domain, state.common.validateStrArray);

            parent.debug('web', 'handleRootRequestEx: success.');
            const webState = userWebState.resolveUserWebState(state.filterUserWebState, error, states, domain);
            const customUi = pageOptions.encodeCustomUi(domain);
            const customFiles = pageOptions.encodeCustomFiles(domain);
            const serverFeatures = applicationServerFeatures.getApplicationServerFeatures(domain, state.db.databaseType);
            const webRtcConfig = pageOptions.getWebRtcConfig(parent.config.settings, args);
            const uiViewMode = userWebState.getUiViewMode(request, domain, webState);

            render(request, response, getRenderPage(uiViewMode, request, domain), getRenderArgs({
                authCookie: authCookie,
                authRelayCookie: authRelayCookie,
                viewmode: navigationState.viewmode,
                currentNode: navigationState.currentNode,
                logoutControls: encodeURIComponent(JSON.stringify(logoutControls)).replace(/'/g, '%27'),
                domain: domain.id,
                debuglevel: parent.debugLevel,
                serverDnsName: state.getWebServerName(domain, request),
                serverRedirPort: args.redirport,
                serverPublicPort: httpsPort,
                serverfeatures: serverFeatures,
                features: allFeatures.features,
                features2: allFeatures.features2,
                features3: allFeatures.features3,
                sessiontime: args.sessiontime ? args.sessiontime : 60,
                mpspass: args.mpspass,
                passRequirements: passRequirements,
                customui: customUi,
                customFiles: customFiles,
                webcerthash: Buffer.from(state.webCertificateFullHashs[domain.id], 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'),
                footer: (domain.footer == null) ? '' : state.common.replacePlaceholders(domain.footer, {
                    serverversion: parent.currentVer,
                    servername: state.getWebServerName(domain, request),
                    agentsessions: Object.keys(parent.webserver.wsagents).length,
                    connectedusers: Object.keys(parent.webserver.wssessions).length,
                    userssessions: Object.keys(parent.webserver.wssessions2).length,
                    relaysessions: parent.webserver.relaySessionCount,
                    relaycount: Object.keys(parent.webserver.wsrelays).length
                }),
                webstate: encodeURIComponent(webState).replace(/'/g, '%27'),
                amtscanoptions: amtScanOptions,
                pluginHandler: (parent.pluginHandler == null) ? 'null' : parent.pluginHandler.prepExports(),
                webRelayPort: (args.relaydns != null) ? ((typeof args.aliasport == 'number') ? args.aliasport : args.port) : ((parent.webrelayserver != null) ? ((typeof args.relayaliasport == 'number') ? args.relayaliasport : parent.webrelayserver.port) : 0),
                webRelayDns: (args.relaydns != null) ? args.relaydns[0] : '',
                hidePowerTimeline: domain.hidepowertimeline ? 'true' : 'false',
                showNotesPanel: domain.shownotespanel ? 'true' : 'false',
                userSessionsSort: domain.usersessionssort ? domain.usersessionssort : 'SessionId',
                webrtcconfig: webRtcConfig,
                collapseGroups: domain.collapsegroups ? 'true' : 'false'
            }, request, domain, uiViewMode), user);
        });
    };
};
