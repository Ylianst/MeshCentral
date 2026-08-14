/**
* @description SSO login request orchestration
* @license Apache-2.0
*/

'use strict';

module.exports.createSsoLogin = function (options) {
    const users = options.users;
    const authLog = options.authLog;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const prepareSsoLoginGroups = options.prepareSsoLoginGroups;
    const ssoAccounts = options.ssoAccounts;
    const sendSsoLoginResponse = options.sendSsoLoginResponse;

    return function handleStrategyLogin(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((req.user != null) && (req.user.sid != null) && (req.user.strategy != null)) {
            const strategy = domain.authstrategies[req.user.strategy];
            authLog(req.user.strategy.toUpperCase(), `User Authorized: ${JSON.stringify(req.user)}`);
            const groups = prepareSsoLoginGroups(strategy, req.user);
            if (groups.loginDenied === true) {
                req.session.loginmode = 1;
                req.session.messageid = 111;
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }

            const userid = 'user/' + domain.id + '/' + req.user.sid;
            var user = users[userid];
            if (user == null) {
                const newAccountSettings = ssoAccounts.getNewAccountSettings(domain, strategy);
                if (newAccountSettings.allowed === true) {
                    user = ssoAccounts.createAccount(domain, strategy, req.user, groups, newAccountSettings);
                    ssoAccounts.completeSsoLogin(req, domain, user);
                } else {
                    authLog('handleStrategyLogin', `${req.user.strategy.toUpperCase()}: LOGIN FAILED: USER: "${req.user.sid}" New accounts are not allowed`);
                    req.session.loginmode = 1;
                    req.session.messageid = 100;
                    res.redirect(domain.url + getQueryPortion(req));
                    return;
                }
            } else {
                ssoAccounts.updateExistingAccount(domain, user, req.user, groups);
                ssoAccounts.completeSsoLogin(req, domain, user);
                authLog('handleStrategyLogin', `${req.user.strategy.toUpperCase()}: LOGIN SUCCESS: USER: "${req.user.sid}"`);
            }
        } else if (req.session && req.session.userid && users[req.session.userid]) {
            authLog('handleStrategyLogin', `User Already Authorised "${(req.session.passport && req.session.passport.user) ? req.session.passport.user : req.session.userid}"`);
        } else {
            authLog('handleStrategyLogin', 'LOGIN FAILED: REQUEST CONTAINS NO USER OR SID');
        }
        sendSsoLoginResponse(req, res, domain);
    };
};
