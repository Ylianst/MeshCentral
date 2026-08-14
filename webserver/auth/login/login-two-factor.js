/**
* @description Two-factor login challenge handling
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginTwoFactorHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getRandomEightDigitInteger = options.getRandomEightDigitInteger;
    const getRandomSixDigitInteger = options.getRandomSixDigitInteger;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const checkUserOneTimePasswordRequired = options.checkUserOneTimePasswordRequired;
    const checkUserOneTimePassword = options.checkUserOneTimePassword;
    const completeLoginRequest = options.completeLoginRequest;
    const cleanRemoteAddr = options.cleanRemoteAddr;
    const loadModule = options.require || require;
    const schedule = options.schedule || setTimeout;
    const now = options.now || Date.now;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    return function handleLoginTwoFactor(req, res, domain, user, userid, username, password, direct, loginOptions, twoFactorSkip) {
        if ((twoFactorSkip != null) || (req.session.loginmode == 6) || !checkUserOneTimePasswordRequired(domain, user, req, loginOptions)) { return false; }

        const email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.email != null) && (user.emailVerified == true) && (user.otpekey != null));
        const sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
        const msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
        const push2fa = ((parent.firebase != null) && (user.otpdev != null));
        const duo2fa = ((((typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) || ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.duo2factor != false))) && (user.otpduo != null));

        if (req.body.hwtoken == '**timeout**') {
            delete req.session;
            res.redirect(domain.url + getQueryPortion(req));
            return true;
        }
        if ((req.body.hwtoken == '**email**') && email2fa) {
            user.otpekey = { k: state.common.zeroPad(getRandomEightDigitInteger(), 8), d: now() };
            state.db.SetUser(user);
            parent.debug('web', 'Sending 2FA email to: ' + user.email);
            domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, state.getLanguageCodes(req), req.query.key);
            req.session.messageid = 2;
            req.session.loginmode = 4;
            completeRequest(req, res, domain, direct);
            return true;
        }
        if ((req.body.hwtoken == '**sms**') && sms2fa) {
            user.otpsms = { k: state.common.zeroPad(getRandomSixDigitInteger(), 6), d: now() };
            state.db.SetUser(user);
            parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
            parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, state.getLanguageCodes(req));
            req.session.messageid = 4;
            req.session.loginmode = 4;
            completeRequest(req, res, domain, direct);
            return true;
        }
        if ((req.body.hwtoken == '**msg**') && msg2fa) {
            user.otpmsg = { k: state.common.zeroPad(getRandomSixDigitInteger(), 6), d: now() };
            state.db.SetUser(user);
            parent.debug('web', 'Sending 2FA message to: ' + user.msghandle);
            parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, state.getLanguageCodes(req));
            req.session.messageid = 6;
            req.session.loginmode = 4;
            completeRequest(req, res, domain, direct);
            return true;
        }
        if ((req.body.hwtoken == '**duo**') && duo2fa && (typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') && (typeof domain.duo2factor.secretkey == 'string') && (typeof domain.duo2factor.apihostname == 'string')) {
            const duo = loadModule('@duosecurity/duo_universal');
            const client = new duo.Client({ clientId: domain.duo2factor.integrationkey, clientSecret: domain.duo2factor.secretkey, apiHost: domain.duo2factor.apihostname, redirectUrl: state.generateBaseURL(domain, req) + 'auth-duo' + (domain.loginkey != null ? ('?key=' + domain.loginkey) : '') });
            const sec = parent.decryptSessionData(req.session.e);
            sec.duostate = client.generateState();
            req.session.e = parent.encryptSessionData(sec);
            parent.debug('web', 'Redirecting user ' + user._id + ' to Duo');
            res.redirect(client.createAuthUrl(user._id.split('/')[2], sec.duostate));
            return true;
        }
        if ((req.body.hwtoken == '**push**') && push2fa && ((domain.passwordrequirements == null) || (domain.passwordrequirements.push2factor != false))) {
            const loginCode = Buffer.from(state.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
            const sessionCode = state.crypto.randomBytes(24).toString('base64');
            const browserCookie = parent.encodeCookie({ a: 'waitAuth', c: loginCode, u: user._id, n: user.otpdev, s: sessionCode, d: domain.id });
            const httpsPort = ((state.args.aliasport == null) ? state.args.port : state.args.aliasport);
            var serverName = state.getWebServerName(domain, req);
            if (typeof state.args.agentaliasdns == 'string') { serverName = state.args.agentaliasdns; }
            var domainPath = (domain.dns == null) ? domain.id : '';
            if (domainPath != '') { domainPath += '/'; }
            req.session.messageid = 5;
            req.session.passhint = 'wss://' + serverName + ':' + httpsPort + '/' + domainPath + '2fahold.ashx?c=' + browserCookie;
            req.session.loginmode = 8;
            completeRequest(req, res, domain, direct);
            return true;
        }

        checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result, authData) {
            if (result == false) {
                var randomWaitTime = 0;
                if (state.checkAllow2Fa(req) == false) {
                    schedule(function () { req.session.messageid = 114; completeRequest(req, res, domain, direct); }, 2000 + (state.crypto.randomBytes(2).readUInt16BE(0) % 4095));
                    return;
                }
                if ((req.body.token != null) || (req.body.hwtoken != null)) {
                    randomWaitTime = 2000 + (state.crypto.randomBytes(2).readUInt16BE(0) % 4095);
                    req.session.messageid = 108;
                    state.parent.authLog('https', 'Failed 2FA for ' + username + ' from ' + cleanRemoteAddr(req.clientIp) + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'] });
                    parent.debug('web', 'handleLoginRequest: invalid 2FA token');
                    const ua = state.getUserAgentInfo(req);
                    state.parent.DispatchEvent(['*', 'server-users', user._id], state, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                    state.setbad2Fa(req);
                } else {
                    parent.debug('web', 'handleLoginRequest: 2FA token required');
                }
                schedule(function () {
                    req.session.loginmode = 4;
                    if ((user.email != null) && (user.emailVerified == true) && (domain.mailserver != null) && (user.otpekey != null)) { req.session.temail = 1; } else { delete req.session.temail; }
                    if ((user.phone != null) && (parent.smsserver != null)) { req.session.tsms = 1; } else { delete req.session.tsms; }
                    if ((user.msghandle != null) && (parent.msgserver != null) && (parent.msgserver.providers != 0)) { req.session.tmsg = 1; } else { delete req.session.tmsg; }
                    if ((user.otpdev != null) && (parent.firebase != null)) { req.session.tpush = 1; } else { delete req.session.tpush; }
                    if (user.otpduo != null) { req.session.tduo = 1; } else { delete req.session.tduo; }
                    req.session.e = parent.encryptSessionData({ tuserid: userid, tuser: username, tpass: password });
                    completeRequest(req, res, domain, direct);
                }, randomWaitTime);
            } else {
                if ((req.body.remembertoken === 'on') && ((domain.twofactorcookiedurationdays == null) || (domain.twofactorcookiedurationdays > 0))) {
                    var maxCookieAge = domain.twofactorcookiedurationdays;
                    if (typeof maxCookieAge != 'number') { maxCookieAge = 30; }
                    const twoFactorCookie = state.parent.encodeCookie({ userid: user._id, expire: maxCookieAge * 24 * 60 }, state.parent.loginCookieEncryptionKey);
                    res.cookie('twofactor', twoFactorCookie, { maxAge: (maxCookieAge * 24 * 60 * 60 * 1000), httpOnly: true, sameSite: parent.config.settings.sessionsamesite, secure: true });
                }
                const emailCheck = ((domain.mailserver != null) && (state.parent.certificates.CommonName != null) && (state.parent.certificates.CommonName.indexOf('.') != -1) && (state.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'));
                if (emailCheck && (user.emailVerified !== true)) {
                    parent.debug('web', 'Redirecting using ' + user.name + ' to email check login page');
                    req.session.messageid = 3;
                    req.session.loginmode = 7;
                    req.session.passhint = user.email;
                    req.session.cuserid = userid;
                    completeRequest(req, res, domain, direct);
                    return;
                }
                parent.debug('web', 'handleLoginRequest: successful 2FA login');
                if (authData != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = authData.twoFactorType; }
                completeLoginRequest(req, res, domain, user, userid, username, password, direct, loginOptions);
            }
        });
        return true;
    };
};
