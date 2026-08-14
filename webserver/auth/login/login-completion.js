/**
* @description Successful login completion and session initialization
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginCompletion = function (options) {
    const state = options.state;
    const parent = options.parent;
    const setSessionRandom = options.setSessionRandom;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const now = options.now || Date.now;

    return function completeLoginRequest(req, res, domain, user, userid, username, password, direct, loginOptions) {
        if ((typeof user.passchange == 'number') && ((user.passchange == -1) || ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.reset == 'number') && (user.passchange + (domain.passwordrequirements.reset * 86400) < Math.floor(now() / 1000))))) {
            parent.debug('web', 'handleLoginRequest: login ok, password change requested');
            req.session.loginmode = 6;
            req.session.messageid = 113;
            const sec = parent.decryptSessionData(req.session.e);
            sec.rtuser = username;
            sec.rtpass = password;
            sec.rtreset = true;
            req.session.e = parent.encryptSessionData(sec);
            if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
            return;
        }

        user.pastlogin = user.login;
        user.login = user.access = Math.floor(now() / 1000);
        state.db.SetUser(user);

        const targets = ['*', 'server-users', user._id];
        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
        const ua = state.getUserAgentInfo(req);
        const loginEvent = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login from ' + req.clientIp + ', ' + ua.browserStr + ', ' + ua.osStr, domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'], rport: req.connection.remotePort };
        if (loginOptions != null) {
            if ((loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) { loginEvent.tokenName = loginOptions.tokenName; loginEvent.tokenUser = loginOptions.tokenUser; }
            if (loginOptions.twoFactorType != null) { loginEvent.twoFactorType = loginOptions.twoFactorType; }
        }
        state.parent.DispatchEvent(targets, state, loginEvent);

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
        state.parent.authLog('https', 'Accepted password for ' + (username ? username : userid) + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'], sessionid: req.session.x });

        if ((loginOptions != null) && (loginOptions.tokenName != null) && (loginOptions.tokenUser != null)) {
            req.session.loginToken = loginOptions.tokenUser;
            if (loginOptions.expire != null) { req.session.expire = loginOptions.expire; }
        }
        if (req.body.viewmode) { req.session.viewmode = req.body.viewmode; }
        parent.debug('web', req.body.host ? 'handleLoginRequest: login ok (1)' : 'handleLoginRequest: login ok (2)');
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    };
};
