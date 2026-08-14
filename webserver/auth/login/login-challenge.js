/**
* @description Login-page two-factor challenge selection
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginChallengeHandler = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getQueryPortion = options.getQueryPortion;
    const getHardwareKeyChallenge = options.getHardwareKeyChallenge;
    const renderLogin = options.renderLogin;
    const hasDatabaseFailure = options.hasDatabaseFailure;

    return function handleLoginChallenge(req, res, domain, passRequirements) {
        if (req.session && (req.session.loginmode == 4)) {
            const sec = parent.decryptSessionData(req.session.e);
            if ((sec != null) && (typeof sec.tuserid == 'string')) {
                const user = state.users[sec.tuserid];
                if (user != null) {
                    parent.debug('web', 'handleRootRequestEx: sending 2FA challenge.');
                    getHardwareKeyChallenge(req, domain, user, function (hardwareKeyChallenge) { renderLogin(req, res, domain, hardwareKeyChallenge, passRequirements); });
                    return;
                }
            }
        }

        if (req.session && (req.session.loginmode == 5) && req.session.temail) {
            state.db.GetUserWithVerifiedEmail(domain.id, req.session.temail, function (error, users) {
                if (hasDatabaseFailure(error, users) || (users.length == 0)) {
                    parent.debug('web', 'handleRootRequestEx: password recover 2FA fail.');
                    req.session = null;
                    res.redirect(domain.url + getQueryPortion(req));
                    return;
                }

                const user = state.users[users[0]._id];
                if (user != null) {
                    parent.debug('web', 'handleRootRequestEx: password recover 2FA challenge.');
                    getHardwareKeyChallenge(req, domain, user, function (hardwareKeyChallenge) { renderLogin(req, res, domain, hardwareKeyChallenge, passRequirements); });
                } else {
                    parent.debug('web', 'handleRootRequestEx: password recover 2FA no user.');
                    req.session = null;
                    res.redirect(domain.url + getQueryPortion(req));
                }
            });
            return;
        }

        renderLogin(req, res, domain, '', passRequirements);
    };
};
