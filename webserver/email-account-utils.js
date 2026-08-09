/**
* @description Account email validation helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasOtherVerifiedUser = function (users, userId) {
    return Array.isArray(users) && users.some(function (user) { return user._id !== userId; });
};
