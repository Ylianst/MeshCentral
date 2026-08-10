/**
* @description Login-page rendering coordinator
* @license Apache-2.0
*/

'use strict';

const loginPageAccountOptions = require('./login-page-account-options.js');
const loginPageSession = require('./login-page-session.js');
const loginPageStrategies = require('./login-page-strategies.js');
const loginPageTwoFactor = require('./login-page-two-factor.js');
const pageOptions = require('./page-options.js');

module.exports.createLoginPageRenderer = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const getRootCertLink = options.getRootCertLink;
    const escapeHtml = options.escapeHtml;
    const getAccountOptions = loginPageAccountOptions.createLoginPageAccountOptions({ state: state, parent: parent, args: args, captcha: options.captcha });

    function getPlaceholderValues(request, domain) {
        return {
            serverversion: parent.currentVer,
            servername: state.getWebServerName(domain, request),
            agentsessions: Object.keys(parent.webserver.wsagents).length,
            connectedusers: Object.keys(parent.webserver.wssessions).length,
            userssessions: Object.keys(parent.webserver.wssessions2).length,
            relaysessions: parent.webserver.relaySessionCount,
            relaycount: Object.keys(parent.webserver.wsrelays).length
        };
    }

    return function renderLoginPage(request, response, domain, hardwareKeyChallenge, passRequirements) {
        parent.debug('web', 'handleRootRequestLogin()');
        const accountOptions = getAccountOptions(domain);
        const sessionState = loginPageSession.consumeLoginPageSession(request, domain, escapeHtml, state.common.uniqueArray);
        const twoFactorOptions = loginPageTwoFactor.getLoginTwoFactorOptions(request, domain, hardwareKeyChallenge, sessionState.loginMode, parent);
        const strategyOptions = loginPageStrategies.getLoginStrategyOptions(domain, state.common);
        const page = (domain.sitestyle >= 2) ? 'login2' : 'login';
        const placeholders = getPlaceholderValues(request, domain);

        render(request, response, getRenderPage(page, request, domain), getRenderArgs({
            loginmode: sessionState.loginMode,
            rootCertLink: getRootCertLink(domain),
            newAccount: accountOptions.newAccountsAllowed,
            newAccountPass: ((domain.newaccountspass == null) || (domain.newaccountspass == '')) ? 0 : 1,
            newAccountCaptcha: accountOptions.newAccountCaptcha,
            newAccountCaptchaImage: accountOptions.newAccountCaptchaImage,
            serverDnsName: state.getWebServerName(domain, request),
            serverPublicPort: accountOptions.serverPublicPort,
            passlogin: (typeof domain.showpasswordlogin == 'boolean') ? domain.showpasswordlogin : true,
            emailcheck: accountOptions.emailCheck,
            features: accountOptions.features,
            sessiontime: args.sessiontime ? args.sessiontime : 60,
            passRequirements: passRequirements,
            customui: pageOptions.encodeCustomUi(domain),
            customFiles: pageOptions.encodeCustomFiles(domain),
            footer: (domain.loginfooter == null) ? '' : state.common.replacePlaceholders(domain.loginfooter, placeholders),
            hkey: encodeURIComponent(hardwareKeyChallenge).replace(/'/g, '%27'),
            messageid: sessionState.messageId,
            flashErrors: JSON.stringify(sessionState.flashErrors).replace(/"/g, '\\"'),
            passhint: sessionState.passwordHint,
            welcometext: domain.welcometext ? encodeURIComponent(state.common.replacePlaceholders(domain.welcometext, placeholders)).split('\'').join('\\\'') : null,
            welcomePictureFullScreen: (typeof domain.welcomepicturefullscreen == 'boolean') ? domain.welcomepicturefullscreen : false,
            hwstate: twoFactorOptions.hardwareState,
            otpemail: twoFactorOptions.email,
            otpduo: twoFactorOptions.duo,
            otpsms: twoFactorOptions.sms,
            otpmsg: twoFactorOptions.messaging,
            otppush: twoFactorOptions.push,
            autofido: twoFactorOptions.autoFido,
            twoFactorCookieDays: twoFactorOptions.cookieDays,
            authStrategies: strategyOptions.strategies,
            oidcButtonText: strategyOptions.oidcButtonText,
            oidcButtonIcon: strategyOptions.oidcButtonIcon,
            oidcButtonIcon2x: strategyOptions.oidcButtonIcon2x,
            loginpicture: typeof domain.loginpicture == 'string',
            tokenTimeout: twoFactorOptions.timeout,
            renderLanguages: state.renderLanguages,
            showLanguageSelect: domain.showlanguageselect ? domain.showlanguageselect : false
        }, request, domain, page));
    };
};
