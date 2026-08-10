/**
* @description Login-screen account creation requests
* @license Apache-2.0
*/

'use strict';

module.exports.createAccountCreation = function (options) {
    const state = options.state;
    const parent = options.parent;
    const reservations = options.reservations;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const setSessionRandom = options.setSessionRandom;
    const hashPassword = options.hashPassword;
    const hasDatabaseFailure = options.hasDatabaseFailure;
    const now = options.now || Date.now;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function rejectRequest(req, res, domain, direct, messageId, debugMessage) {
        if (debugMessage != null) { parent.debug('web', debugMessage); }
        req.session.loginmode = 2;
        req.session.messageid = messageId;
        completeRequest(req, res, domain, direct);
    }

    function handleCreateAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handleCreateAccountRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        if (parent.config.settings.maintenancemode != null) {
            req.session.messageid = 115;
            req.session.loginmode = 1;
            completeRequest(req, res, domain, direct);
            return;
        }
        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }
        if (domain.usernameisemail) { req.body.username = req.body.email; }

        if ((domain.newaccountspass != null) && (domain.newaccountspass != '') && (req.body.newaccountspass != domain.newaccountspass)) {
            rejectRequest(req, res, domain, direct, 103, 'handleCreateAccountRequest: Invalid account creation token');
            return;
        }
        if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
            const captcha = parent.decodeCookie(req.body.captchaargs, parent.loginCookieEncryptionKey, 10);
            if ((captcha == null) || (captcha.type != 'newAccount') || (typeof captcha.captcha != 'string') || (captcha.captcha.length < 5) || (captcha.captcha != req.body.anewaccountcaptcha)) {
                rejectRequest(req, res, domain, direct, 117);
                return;
            }
        }
        if ((typeof req.body.username != 'string') || (req.body.username.length < 1) || (req.body.username[0] == '~')) {
            rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: unable to create account (0)');
            return;
        }
        if (!reservations.acquire(domain.id)) {
            rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: account creation already pending');
            return;
        }
        const releaseReservation = function () { reservations.release(domain.id); };

        var domainUserCount = 0;
        for (var userId in state.users) { if (state.users[userId].domain == domain.id) { domainUserCount++; } }
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true) && (domainUserCount > 0)) {
            releaseReservation();
            parent.debug('web', 'handleCreateAccountRequest: domainUserCount > 1.');
            res.sendStatus(401);
            return;
        }

        if (Array.isArray(domain.newaccountemaildomains)) {
            var separator = -1;
            if (typeof req.body.email == 'string') { separator = req.body.email.indexOf('@'); }
            if (separator == -1) {
                releaseReservation();
                rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: unable to create account (1)');
                return;
            }
            var emailAllowed = false;
            const emailDomain = req.body.email.substring(separator + 1).toLowerCase();
            for (var i in domain.newaccountemaildomains) { if (emailDomain == domain.newaccountemaildomains[i].toLowerCase()) { emailAllowed = true; } }
            if (!emailAllowed) {
                releaseReservation();
                rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: unable to create account (2)');
                return;
            }
        }

        state.db.isMaxType(domain.limits.maxuseraccounts, 'user', domain.id, function (maxExceeded) {
            if (maxExceeded) {
                releaseReservation();
                rejectRequest(req, res, domain, direct, 101, 'handleCreateAccountRequest: account limit reached');
                return;
            }
            if (!state.common.validateUsername(req.body.username, 1, 64) || !state.common.validateEmail(req.body.email, 1, 256) || !state.common.validateString(req.body.password1, 1, 256) || !state.common.validateString(req.body.password2, 1, 256) || (req.body.password1 != req.body.password2) || req.body.username == '~' || !state.common.checkPasswordRequirements(req.body.password1, domain.passwordrequirements)) {
                releaseReservation();
                rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: unable to create account (3)');
                return;
            }

            state.db.GetUserWithVerifiedEmail(domain.id, req.body.email, function (error, users) {
                if (hasDatabaseFailure(error, users)) {
                    releaseReservation();
                    rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: database error checking email address');
                    return;
                }
                if (users.length > 0) {
                    releaseReservation();
                    rejectRequest(req, res, domain, direct, 102, 'handleCreateAccountRequest: Existing account with this email address');
                    return;
                }

                const userId = 'user/' + domain.id + '/' + req.body.username.toLowerCase();
                if (state.users[userId] != null) {
                    releaseReservation();
                    rejectRequest(req, res, domain, direct, 104, 'handleCreateAccountRequest: Username already exists');
                    return;
                }

                const user = { type: 'user', _id: userId, name: req.body.username, email: req.body.email, creation: Math.floor(now() / 1000), login: Math.floor(now() / 1000), access: Math.floor(now() / 1000), domain: domain.id };
                if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                if (state.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                if ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true) && req.body.apasswordhint) { user.passhint = req.body.apasswordhint.substring(0, 250); }
                if (domainUserCount == 0) { user.siteadmin = 4294967295; }

                hashPassword(req.body.password1, function (hashError, salt, hash) {
                    if (hashError) {
                        releaseReservation();
                        rejectRequest(req, res, domain, direct, 100, 'handleCreateAccountRequest: password hash failed');
                        return;
                    }
                    if (state.users[user._id] != null) {
                        releaseReservation();
                        rejectRequest(req, res, domain, direct, 104, 'handleCreateAccountRequest: Username already exists after password hash');
                        return;
                    }
                    user.salt = salt;
                    user.hash = hash;
                    delete user.passtype;

                    if (typeof domain.newaccountsusergroups == 'object') {
                        for (var i in domain.newaccountsusergroups) {
                            var userGroupId = domain.newaccountsusergroups[i];
                            if (userGroupId.indexOf('/') < 0) { userGroupId = 'ugrp/' + domain.id + '/' + userGroupId; }
                            const userGroup = state.userGroups[userGroupId];
                            if (userGroup != null) {
                                if (user.links == null) { user.links = {}; }
                                user.links[userGroup._id] = { rights: 1 };
                                userGroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                state.db.Set(userGroup);
                                var groupEvent = { etype: 'ugrp', ugrpid: userGroup._id, name: userGroup.name, desc: userGroup.desc, action: 'usergroupchange', links: userGroup.links, msg: 'Added user ' + user.name + ' to user group ' + userGroup.name, addUserDomain: domain.id };
                                if (state.db.changeStream) { groupEvent.noact = 1; }
                                parent.DispatchEvent(['*', userGroup._id, user._id], state, groupEvent);
                            }
                        }
                    }

                    state.users[user._id] = user;
                    releaseReservation();
                    state.db.SetUser(user);
                    req.session.userid = user._id;
                    req.session.ip = req.clientIp;
                    setSessionRandom(req);
                    if ((domain.mailserver != null) && (domain.auth != 'sspi') && (domain.auth != 'ldap') && (state.common.validateEmail(user.email, 1, 256) == true)) { domain.mailserver.sendAccountCheckMail(domain, user.name, user._id, user.email, state.getLanguageCodes(req), req.query.key); }
                    var event = { etype: 'user', userid: user._id, username: user.name, account: state.CloneSafeUser(user), action: 'accountcreate', msg: 'Account created, email is ' + req.body.email, domain: domain.id };
                    if (state.db.changeStream) { event.noact = 1; }
                    state.parent.DispatchEvent(['*', 'server-users'], state, event);
                    completeRequest(req, res, domain, direct);
                }, 0);
            });
        });
    }

    return { handleCreateAccountRequest: handleCreateAccountRequest };
};
