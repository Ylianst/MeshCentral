/**
* @description Login request orchestration
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginRequestHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const checkUserOneTimePasswordSkip = options.checkUserOneTimePasswordSkip;
    const handleLoginTwoFactor = options.handleLoginTwoFactor;
    const completeLoginRequest = options.completeLoginRequest;
    const handleLoginFailure = options.handleLoginFailure;
    const schedule = options.schedule || setTimeout;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    return function handleLoginRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }
        if (req.session == null) { req.session = {}; }

        if (state.checkAllowLogin(req) == false) {
            schedule(function () { req.session.messageid = 114; completeRequest(req, res, domain, direct); }, 2000 + (state.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        var username = req.body.username;
        var password = req.body.password;
        if ((username == null) && (password == null) && (req.body.token != null)) {
            const sec = parent.decryptSessionData(req.session.e);
            username = sec.tuser;
            password = sec.tpass;
        }

        state.authenticate(username, password, domain, function (error, userid, passhint, loginOptions) {
            const user = userid ? state.users[userid] : null;
            if (user == null) {
                handleLoginFailure(req, res, domain, username, error, passhint, direct);
                return;
            }
            if ((parent.config.settings.maintenancemode != null) && (user.siteadmin != 4294967295)) {
                req.session.messageid = 115;
                req.session.loginmode = 1;
                completeRequest(req, res, domain, direct);
                return;
            }

            const twoFactorSkip = checkUserOneTimePasswordSkip(domain, user, req, loginOptions);
            if (handleLoginTwoFactor(req, res, domain, user, userid, username, password, direct, loginOptions, twoFactorSkip)) { return; }

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

            parent.debug('web', 'handleLoginRequest: successful login');
            if (twoFactorSkip != null) { if (loginOptions == null) { loginOptions = {}; } loginOptions.twoFactorType = twoFactorSkip.twoFactorType; }
            completeLoginRequest(req, res, domain, user, userid, username, password, direct, loginOptions);
        });
    };
};
