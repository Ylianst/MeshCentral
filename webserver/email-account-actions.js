/**
* @description Account actions initiated from email links
* @license Apache-2.0
*/

'use strict';

module.exports.createEmailAccountActions = function (options) {
    const state = options.state;
    const parent = options.parent;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const escapeHtml = options.escapeHtml;
    const createTemporaryPassword = options.createTemporaryPassword;
    const hashPassword = options.hashPassword;
    const now = options.now || Date.now;
    const hasDatabaseFailure = options.hasDatabaseFailure;
    const hasOtherVerifiedUser = options.hasOtherVerifiedUser;
    const getActiveUser = options.getActiveUser;
    const random = options.random || Math.random;

    function renderMessage(req, res, domain, args) {
        render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'message2' : 'message', req, domain), getRenderArgs(args, req, domain));
    }

    function handlePasswordReset(req, res, domain, user) {
        const domainurl = encodeURIComponent(domain.url).replace(/'/g, '%27');
        if (user.emailVerified != true) {
            parent.debug('web', 'handleCheckMailRequest: email not verified.');
            renderMessage(req, res, domain, { titleid: 1, msgid: 7, domainurl: domainurl, arg1: escapeHtml(user.email), arg2: escapeHtml(user.name) });
            return;
        }
        if (req.query.confirm != 1) {
            renderMessage(req, res, domain, { titleid: 1, msgid: 14, domainurl: domainurl });
            return;
        }

        createTemporaryPassword(state.crypto, hashPassword, function (error, temporaryPassword) {
            if (error != null) {
                parent.debug('web', 'handleCheckMailRequest: Unable to create temporary password: ' + error.message);
                renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl });
                return;
            }
            var userinfo = options.getActiveUser(state.users, user._id);
            if (userinfo == null) {
                parent.debug('web', 'handleCheckMailRequest: Account removed during password reset.');
                renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl });
                return;
            }
            userinfo.salt = temporaryPassword.salt;
            userinfo.hash = temporaryPassword.hash;
            delete userinfo.passtype;
            userinfo.passchange = userinfo.access = Math.floor(now() / 1000);
            delete userinfo.passhint;
            state.db.SetUser(userinfo);

            var event = { etype: 'user', userid: user._id, username: userinfo.name, account: state.CloneSafeUser(userinfo), action: 'accountchange', msg: 'Password reset for user ' + escapeHtml(user.name), domain: domain.id };
            if (state.db.changeStream) { event.noact = 1; }
            parent.DispatchEvent(['*', 'server-users', user._id], state, event);
            renderMessage(req, res, domain, { titleid: 1, msgid: 8, domainurl: domainurl, arg1: escapeHtml(user.name), arg2: escapeHtml(temporaryPassword.password) });
            parent.debug('web', 'handleCheckMailRequest: send temporary password.');
            parent.authLog('https', 'Performed account reset for user ' + user.name);
        });
    }

    function handleEmailVerification(req, res, domain, user) {
        const domainurl = encodeURIComponent(domain.url).replace(/'/g, '%27');
        if (user.emailVerified == true) {
            parent.debug('web', 'handleCheckMailRequest: email already verified.');
            renderMessage(req, res, domain, { titleid: 1, msgid: 4, domainurl: domainurl, arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') });
            return;
        }
        state.db.GetUserWithVerifiedEmail(domain.id, user.email, function (error, users) {
            if (hasDatabaseFailure(error, users)) {
                parent.debug('web', 'handleCheckMailRequest: Database error checking verified email.');
                renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl });
            } else if (hasOtherVerifiedUser(users, user._id)) {
                parent.debug('web', 'handleCheckMailRequest: email already in use.');
                renderMessage(req, res, domain, { titleid: 1, msgid: 5, domainurl: domainurl, arg1: encodeURIComponent(user.email).replace(/'/g, '%27') });
            } else {
                parent.debug('web', 'handleCheckMailRequest: email verification success.');
                var activeUser = getActiveUser(state.users, user._id);
                if (activeUser == null) {
                    parent.debug('web', 'handleCheckMailRequest: Account removed during email verification.');
                    renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl });
                    return;
                }
                activeUser.emailVerified = true;
                user.emailVerified = true;
                state.db.SetUser(user);
                var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', msg: 'Verified email of user ' + escapeHtml(user.name) + ' (' + escapeHtml(user.email) + ')', domain: domain.id };
                if (state.db.changeStream) { event.noact = 1; }
                parent.DispatchEvent(['*', 'server-users', user._id], state, event);
                renderMessage(req, res, domain, { titleid: 1, msgid: 6, domainurl: domainurl, arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') });
                parent.DispatchEvent([user._id], state, { action: 'notify', title: 'Email verified', value: user.email, nolog: 1, id: random() });
                parent.authLog('https', 'Verified email address ' + user.email + ' for user ' + user.name, { useragent: req.headers['user-agent'] });
            }
        });
    }

    return { handlePasswordReset: handlePasswordReset, handleEmailVerification: handleEmailVerification };
};
