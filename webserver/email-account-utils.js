/**
* @description Account email validation helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasOtherVerifiedUser = function (users, userId) {
    return Array.isArray(users) && users.some(function (user) { return user._id !== userId; });
};

module.exports.hasDatabaseFailure = function (error, users) {
    return (error != null) || !Array.isArray(users);
};

module.exports.getActiveUser = function (users, userId) {
    return ((users != null) && (users[userId] != null)) ? users[userId] : null;
};

module.exports.hasEmailLinkCookie = function (query) {
    return (query != null) && (query.c != null);
};

module.exports.createTemporaryPassword = function (crypto, hashPassword, callback) {
    crypto.randomBytes(16, function (error, buffer) {
        if ((error != null) || (buffer == null)) { callback(error || new Error('Unable to generate a temporary password.')); return; }
        const password = buffer.toString('base64').split('=').join('').split('/').join('').split('+').join('');
        hashPassword(password, function (hashError, salt, hash) {
            if (hashError != null) { callback(hashError); return; }
            callback(null, { password: password, salt: salt, hash: hash });
        }, 0);
    });
};
