/**
* @description Mesh agent settings generation
* @license Apache-2.0
*/

'use strict';

module.exports.hasUserSession = function (request) {
    return (request != null) && (request.session != null) && (request.session.userid != null);
};
