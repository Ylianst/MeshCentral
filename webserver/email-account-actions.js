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

    return { handlePasswordReset: handlePasswordReset };
};
