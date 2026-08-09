/**
* @description Authenticated account password management handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createAccountManagement = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const renderRoot = options.renderRoot;
    const hashPassword = options.hashPassword;
    const now = options.now || Date.now;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { renderRoot(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function handlePasswordChangeRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handlePasswordChangeRequest: failed checks (1).'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        if (!req.session || !req.session.userid || !req.body.apassword0 || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.userid.split('/')[1] != domain.id)) {
            parent.debug('web', 'handlePasswordChangeRequest: failed checks (2).');
            completeRequest(req, res, domain, direct);
            return;
        }

        const user = state.users[req.session.userid];
        if (!user) {
            parent.debug('web', 'handlePasswordChangeRequest: user not found.');
            completeRequest(req, res, domain, direct);
            return;
        }
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) {
            parent.debug('web', 'handlePasswordChangeRequest: account settings locked.');
            completeRequest(req, res, domain, direct);
            return;
        }

        state.checkUserPassword(domain, user, req.body.apassword0, function (result) {
            if (result != true) {
                parent.debug('web', 'handlePasswordChangeRequest: invalid current password.');
                completeRequest(req, res, domain, direct);
                return;
            }
            state.checkOldUserPasswords(domain, user, req.body.apassword1, function (passwordResult) {
                if (passwordResult == 1) {
                    parent.debug('web', 'handlePasswordChangeRequest: old password reuse attempt.');
                    completeRequest(req, res, domain, direct);
                } else if (passwordResult == 2) {
                    parent.debug('web', 'handlePasswordChangeRequest: commonly used password use attempt.');
                    completeRequest(req, res, domain, direct);
                } else {
                    hashPassword(req.body.apassword1, function (err, salt, hash) {
                        const nowSeconds = Math.floor(now() / 1000);
                        if (err) { parent.debug('web', 'handlePasswordChangeRequest: hash error.'); throw err; }
                        if (domain.passwordrequirements != null) {
                            if ((domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) {
                                var hint = req.body.apasswordhint;
                                if (hint.length > 250) hint = hint.substring(0, 250);
                                user.passhint = hint;
                            } else {
                                delete user.passhint;
                            }
                            if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                if (user.oldpasswords == null) user.oldpasswords = [];
                                user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                if (extraOldPasswords > 0) user.oldpasswords.splice(0, extraOldPasswords);
                            }
                        }
                        user.salt = salt;
                        user.hash = hash;
                        user.passchange = user.access = nowSeconds;
                        delete user.passtype;
                        state.db.SetUser(user);
                        req.session.viewmode = 2;
                        completeRequest(req, res, domain, direct);
                        parent.DispatchEvent(['*', 'server-users'], state, { etype: 'user', userid: user._id, username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id });
                    });
                }
            });
        });
    }

    return { handlePasswordChangeRequest: handlePasswordChangeRequest };
};
