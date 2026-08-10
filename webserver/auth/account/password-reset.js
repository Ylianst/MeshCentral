/**
* @description Password reset request handling after account recovery
* @license Apache-2.0
*/

'use strict';

module.exports.createPasswordReset = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const setSessionRandom = options.setSessionRandom;
    const completeLoginRequest = options.completeLoginRequest;
    const hashPassword = options.hashPassword;
    const updatePasswordHint = options.updatePasswordHint;
    const now = options.now || Date.now;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function clearRecoverySession(req) {
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
    }

    function handleResetPasswordRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        const sec = parent.decryptSessionData(req.session.e);
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false) || (sec.rtreset === true));
        if ((allowAccountReset === false) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.body.rpassword1 != 'string') || (typeof req.body.rpassword2 != 'string') || (req.body.rpassword1 != req.body.rpassword2) || (typeof req.body.rpasswordhint != 'string') || (typeof sec.rtuser != 'string') || (typeof sec.rtpass != 'string')) {
            parent.debug('web', 'handleResetPasswordRequest: checks failed');
            clearRecoverySession(req);
            completeRequest(req, res, domain, direct);
            return;
        }

        state.authenticate(sec.rtuser, sec.rtpass, domain, function (err, userid, passhint, loginOptions) {
            if (!userid) {
                parent.debug('web', 'handleResetPasswordRequest: failed authenticate()');
                clearRecoverySession(req);
                completeRequest(req, res, domain, direct);
                return;
            }

            var user = state.users[userid];
            if (!state.common.checkPasswordRequirements(req.body.rpassword1, domain.passwordrequirements)) {
                parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (1)');
                req.session.loginmode = 6;
                req.session.messageid = 105;
                completeRequest(req, res, domain, direct);
                return;
            }

            state.checkOldUserPasswords(domain, user, req.body.rpassword1, function (result) {
                if (result != 0) {
                    parent.debug('web', 'handleResetPasswordRequest: password rejected, use a different one (2)');
                    req.session.loginmode = 6;
                    req.session.messageid = 105;
                    completeRequest(req, res, domain, direct);
                    return;
                }

                hashPassword(req.body.rpassword1, function (hashError, salt, hash) {
                    const nowSeconds = Math.floor(now() / 1000);
                    if (hashError) { parent.debug('web', 'handleResetPasswordRequest: hash error.'); throw hashError; }
                    if (domain.passwordrequirements != null) {
                        updatePasswordHint(user, domain.passwordrequirements, req.body.rpasswordhint);
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
                    state.db.SetUser(user);

                    var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', msg: 'User password reset', domain: domain.id };
                    if (state.db.changeStream) { event.noact = 1; }
                    state.parent.DispatchEvent(['*', 'server-users', user._id], state, event);

                    parent.debug('web', 'handleResetPasswordRequest: success');
                    req.session.userid = userid;
                    req.session.ip = req.clientIp;
                    setSessionRandom(req);
                    const loginSession = parent.decryptSessionData(req.session.e);
                    completeLoginRequest(req, res, domain, state.users[userid], userid, loginSession.tuser, loginSession.tpass, direct, loginOptions);
                }, 0);
            }, 0);
        });
    }

    return { handleResetPasswordRequest: handleResetPasswordRequest, clearRecoverySession: clearRecoverySession };
};
