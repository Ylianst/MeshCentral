/**
* @description Mesh agent and companion tool download helpers
* @license Apache-2.0
*/

'use strict';

module.exports.getSessionUser = function (users, request) {
    if ((request == null) || (request.session == null) || (request.session.userid == null)) { return null; }
    return users[request.session.userid] || null;
};

module.exports.hasDatabaseFailure = function (error, documents) {
    return (error != null) || !Array.isArray(documents);
};
