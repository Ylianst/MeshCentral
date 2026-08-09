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
    const checkUserIpAddress = options.checkUserIpAddress;
    const decodeCookie = options.decodeCookie;
    const hasEmailLinkCookie = options.hasEmailLinkCookie;
    const hasAccountEmailRequest = options.hasAccountEmailRequest;
    const resolveAccountEmail = options.resolveAccountEmail;
    const validateEmail = options.validateEmail;
    const checkEmail = options.checkEmail;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const getLanguageCodes = options.getLanguageCodes;

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

    function handleCheckMailRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap') || (domain.mailserver == null)) { parent.debug('web', 'handleCheckMailRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }

        const domainurl = encodeURIComponent(domain.url).replace(/'/g, '%27');
        if (!hasEmailLinkCookie(req.query)) { renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl }); return; }
        const cookie = decodeCookie(req.query.c, domain.mailserver.mailCookieEncryptionKey, 30);
        if ((cookie == null) || (cookie.u == null) || !cookie.u.startsWith('user/') || (cookie.e == null)) { renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl }); return; }

        const idsplit = cookie.u.split('/');
        if ((idsplit.length != 3) || (idsplit[1] != domain.id)) {
            parent.debug('web', 'handleCheckMailRequest: Invalid domain.');
            renderMessage(req, res, domain, { titleid: 1, msgid: 1, domainurl: domainurl });
            return;
        }
        state.db.Get(cookie.u, function (error, users) {
            if (hasDatabaseFailure(error, users)) {
                parent.debug('web', 'handleCheckMailRequest: Database error.');
                renderMessage(req, res, domain, { titleid: 1, msgid: 10, domainurl: domainurl });
            } else if (users.length == 0) {
                parent.debug('web', 'handleCheckMailRequest: Invalid username.');
                renderMessage(req, res, domain, { titleid: 1, msgid: 2, domainurl: domainurl, arg1: encodeURIComponent(idsplit[1]).replace(/'/g, '%27') });
            } else {
                const user = users[0];
                if (user.email != cookie.e) {
                    parent.debug('web', 'handleCheckMailRequest: Invalid e-mail.');
                    renderMessage(req, res, domain, { titleid: 1, msgid: 3, domainurl: domainurl, arg1: encodeURIComponent(user.email).replace(/'/g, '%27'), arg2: encodeURIComponent(user.name).replace(/'/g, '%27') });
                } else if (cookie.a == 1) {
                    handleEmailVerification(req, res, domain, user);
                } else if (cookie.a == 2) {
                    handlePasswordReset(req, res, domain, user);
                } else {
                    renderMessage(req, res, domain, { titleid: 1, msgid: 9, domainurl: domainurl });
                }
            }
        });
    }

    function finishAccountEmailRequest(req, res, domain, direct) {
        req.session.loginmode = 7;
        delete req.session.cuserid;
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function handleCheckAccountEmailRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if (!hasAccountEmailRequest(req)) { parent.debug('web', 'handleCheckAccountEmailRequest: missing session or body.'); res.sendStatus(404); return; }
        const email = resolveAccountEmail(req);
        if ((domain.mailserver == null) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (typeof req.session.cuserid != 'string') || (state.users[req.session.cuserid] == null) || !validateEmail(email, 1, 256)) { parent.debug('web', 'handleCheckAccountEmailRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }

        if (Array.isArray(domain.newaccountemaildomains)) {
            const separator = email.indexOf('@');
            const emailDomain = separator >= 0 ? email.substring(separator + 1).toLowerCase() : null;
            const emailAllowed = (emailDomain != null) && domain.newaccountemaildomains.some(function (allowedDomain) { return emailDomain == allowedDomain.toLowerCase(); });
            if (!emailAllowed) {
                parent.debug('web', 'handleCreateAccountRequest: unable to create account (email domain)');
                req.session.messageid = 106;
                finishAccountEmailRequest(req, res, domain, direct);
                return;
            }
        }

        if (!email || (checkEmail(email) == false)) {
            parent.debug('web', 'handleCheckAccountEmailRequest: Invalid email');
            req.session.messageid = 106;
            finishAccountEmailRequest(req, res, domain, direct);
            return;
        }

        state.db.GetUserWithVerifiedEmail(domain.id, email, function (error, users) {
            if (hasDatabaseFailure(error, users) || hasOtherVerifiedUser(users, req.session.cuserid)) {
                req.session.messageid = 102;
            } else {
                const user = getActiveUser(state.users, req.session.cuserid);
                if (user == null) {
                    req.session.messageid = 100;
                } else {
                    if (user.email != email) {
                        user.email = email;
                        state.db.SetUser(user);
                        var targets = ['*', 'server-users', user._id];
                        if (user.groups) { for (var i in user.groups) { targets.push('server-users:' + user.groups[i]); } }
                        var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountchange', msg: 'Account changed: ' + user.name, domain: domain.id };
                        if (state.db.changeStream) { event.noact = 1; }
                        parent.DispatchEvent(targets, state, event);
                    }
                    domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, getLanguageCodes(req), req.query.key);
                    req.session.messageid = 2;
                }
            }
            finishAccountEmailRequest(req, res, domain, direct);
        });
    }

    return { handleCheckMailRequest: handleCheckMailRequest, handleCheckAccountEmailRequest: handleCheckAccountEmailRequest, handlePasswordReset: handlePasswordReset, handleEmailVerification: handleEmailVerification };
};
