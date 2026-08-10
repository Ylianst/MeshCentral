/**
* @description Startup database result validation
* @license Apache-2.0
*/

'use strict';

module.exports.hasStartupDatabaseFailure = function (error, documents, collection, debug) {
    if ((error == null) && Array.isArray(documents)) { return false; }
    debug('web', 'Unable to load initial ' + collection + ' data: ' + ((error != null) ? error : 'invalid database result'));
    return true;
};
