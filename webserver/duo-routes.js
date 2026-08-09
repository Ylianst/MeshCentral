/**
* @description Duo Universal two-factor authentication routes
* @license Apache-2.0
*/

'use strict';

module.exports.createDuoRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const getQueryPortion = options.getQueryPortion;
    const setSessionRandom = options.setSessionRandom;
    const loadDuo = options.loadDuo || function () { return require('@duosecurity/duo_universal'); };

    function createClient(domain, req, configuring) {
        const duo = loadDuo();
        return new duo.Client({
            clientId: domain.duo2factor.integrationkey,
            clientSecret: domain.duo2factor.secretkey,
            apiHost: domain.duo2factor.apihostname,
            redirectUrl: state.generateBaseURL(domain, req) + 'auth-duo' + (domain.loginkey != null ? ((configuring ? '&' : '?') + 'key=' + domain.loginkey) : '')
        });
    }

    function clearDuoState(req, fields) {
        const sec = parent.decryptSessionData(req.session.e);
        for (const field of fields) delete sec[field];
        req.session.e = parent.encryptSessionData(sec);
    }

    function redirectToReturnUrl(req, res, domain) {
        const url = req.session.duorurl;
        delete req.session.duorurl;
        res.redirect(url ? url : domain.url);
    }

    function register(domain) {
        if ((typeof domain.duo2factor != 'object') || (typeof domain.duo2factor.integrationkey != 'string') || (typeof domain.duo2factor.secretkey != 'string') || (typeof domain.duo2factor.apihostname != 'string')) return;
        const url = domain.url;

        state.app.get(url + 'auth-duo', function (req, res) {
            const requestDomain = getDomain(req);
            const sec = parent.decryptSessionData(req.session.e);
            if ((req.query.state !== sec.duostate) || (req.query.duo_code == null)) {
                parent.debug('web', 'handleRootRequest: Duo 2FA state failed.');
                req.session.loginmode = 1;
                req.session.messageid = 117;
                res.redirect(requestDomain.url + getQueryPortion(req));
                return;
            }
            const client = createClient(requestDomain, req, false);
            if (sec.duoconfig == 1) {
                configureUser(client, req, res, requestDomain, sec);
            } else {
                authenticateUser(client, req, res, requestDomain, sec);
            }
        });

        state.app.get(url + 'add-duo', function (req, res) {
            const requestDomain = getDomain(req);
            if (req.session.userid == null) { res.sendStatus(404); return; }
            const client = createClient(requestDomain, req, true);
            if (req.query.rurl) req.session.duorurl = req.query.rurl;
            const sec = parent.decryptSessionData(req.session.e);
            sec.duostate = client.generateState();
            sec.duoconfig = 1;
            req.session.e = parent.encryptSessionData(sec);
            parent.debug('web', 'Redirecting user ' + req.session.userid + ' to Duo for configuration');
            res.redirect(client.createAuthUrl(req.session.userid.split('/')[2], sec.duostate));
        });
    }

    function configureUser(client, req, res, domain, sec) {
        const userid = req.session.userid;
        client.exchangeAuthorizationCodeFor2FAResult(req.query.duo_code, userid.split('/')[2]).then(function () {
            parent.debug('web', 'handleRootRequest: Duo 2FA configuration success.');
            const user = state.users[userid];
            if (user.otpduo == null) {
                user.otpduo = {};
                state.db.SetUser(user);
                const targets = ['*', 'server-users', user._id];
                if (user.groups) for (const group in user.groups) targets.push('server-users:' + user.groups[group]);
                const event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', msgid: 160, msg: 'Enabled duo two-factor authentication.', domain: domain.id };
                if (state.db.changeStream) event.noact = 1;
                parent.DispatchEvent(targets, state, event);
            }
            delete sec.duostate;
            delete sec.duoconfig;
            req.session.e = parent.encryptSessionData(sec);
            redirectToReturnUrl(req, res, domain);
        }).catch(function () {
            parent.debug('web', 'handleRootRequest: Duo 2FA configuration failed.');
            clearDuoState(req, ['duostate', 'duoconfig']);
            redirectToReturnUrl(req, res, domain);
        });
    }

    function authenticateUser(client, req, res, domain, sec) {
        state.authenticate(sec.tuser, sec.tpass, domain, function (err, userid) {
            if ((userid == null) || (err != null)) {
                parent.debug('web', 'handleRootRequest: login authorization failed when returning from Duo 2FA.');
                req.session.loginmode = 1;
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }
            const user = state.users[userid];
            client.exchangeAuthorizationCodeFor2FAResult(req.query.duo_code, userid.split('/')[2]).then(function () {
                parent.debug('web', 'handleRootRequest: Duo 2FA authorization success.');
                req.session.userid = userid;
                delete req.session.currentNode;
                req.session.ip = req.clientIp;
                setSessionRandom(req);
                clearDuoState(req, ['duostate', 'tuser', 'tpass']);
                parent.authLog('https', 'Accepted Duo authentication for ' + userid + ' from ' + req.clientIp + ':' + req.connection.remotePort, { useragent: req.headers['user-agent'], sessionid: req.session.x });
                const targets = ['*', 'server-users', user._id];
                if (user.groups) for (const group in user.groups) targets.push('server-users:' + user.groups[group]);
                const ua = state.getUserAgentInfo(req);
                parent.DispatchEvent(targets, state, { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'login', msgid: 107, msgArgs: [req.clientIp, ua.browserStr, ua.osStr], msg: 'Account login', domain: domain.id, ip: req.clientIp, userAgent: req.headers['user-agent'], twoFactorType: 'duo' });
                res.redirect(domain.url + getQueryPortion(req));
            }).catch(function () {
                parent.debug('web', 'handleRootRequest: Duo 2FA authorization failed.');
                clearDuoState(req, ['duostate']);
                req.session.loginmode = 1;
                req.session.messageid = 117;
                const ua = state.getUserAgentInfo(req);
                parent.DispatchEvent(['*', 'server-users', user._id], state, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                state.setbad2Fa(req);
                res.redirect(domain.url + getQueryPortion(req));
            });
        });
    }

    return { register: register };
};
