/**
* @description Current-password verification and password-history policy checks
* @license Apache-2.0
*/

'use strict';

module.exports.createPasswordHistory = function (options) {
    const debug = options.debug;
    const loadModule = options.require || require;

    function checkUserPassword(domain, user, password, callback) {
        if (user.passtype != null) {
            loadModule('./pass').iishash(user.passtype, password, user.salt, function (err, hash) {
                if (err) { debug('web', 'checkUserPassword: SHA-1 fail.'); callback(false); return; }
                if (hash == user.hash) {
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 32) != 0)) { debug('web', 'checkUserPassword: SHA-1 locked.'); callback(false); return; }
                    debug('web', 'checkUserPassword: SHA-1 ok.');
                    callback(true);
                    return;
                }
                callback(false);
            });
            return;
        }
        loadModule('./pass').hash(password, user.salt, function (err, hash) {
            if (err) { debug('web', 'checkUserPassword: pbkdf2 SHA384 fail.'); callback(false); return; }
            if (hash == user.hash) {
                if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 32) != 0)) { debug('web', 'checkUserPassword: pbkdf2 SHA384 locked.'); callback(false); return; }
                debug('web', 'checkUserPassword: pbkdf2 SHA384 ok.');
                callback(true);
                return;
            }
            callback(false);
        }, 0);
    }

    function checkOldUserPasswords(domain, user, password, callback) {
        if ((domain.passwordrequirements != null) && (typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
            if (user.oldpasswords != null) {
                const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                if (extraOldPasswords > 0) user.oldpasswords.splice(0, extraOldPasswords);
            }
        } else {
            delete user.oldpasswords;
        }
        let oldPasswordCount = 1;
        if (user.oldpasswords != null) oldPasswordCount += user.oldpasswords.length;
        const state = { response: 0, count: oldPasswordCount, user: user, func: callback };

        if ((domain.passwordrequirements != null) && (domain.passwordrequirements.bancommonpasswords == true)) {
            state.count++;
            loadModule('wildleek')(password).then(function (common) {
                if (common == true) state.response = 2;
                if (--state.count == 0) state.func(state.response);
            });
        }
        loadModule('./pass').hash(password, user.salt, function (err, hash, tag) {
            if ((err == null) && (hash == tag.user.hash)) tag.response = 1;
            if (--tag.count == 0) tag.func(tag.response);
        }, state);
        if (user.oldpasswords != null) {
            for (const oldPassword of user.oldpasswords) {
                loadModule('./pass').hash(password, oldPassword.salt, function (err, hash, tag) {
                    if ((err == null) && (hash == tag.oldPassword.hash)) tag.state.response = 1;
                    if (--tag.state.count == 0) tag.state.func(tag.state.response);
                }, { oldPassword: oldPassword, state: state });
            }
        }
    }

    return { checkUserPassword: checkUserPassword, checkOldUserPasswords: checkOldUserPasswords };
};
