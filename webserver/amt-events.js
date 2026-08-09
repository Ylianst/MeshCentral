/**
* @description Intel AMT event request helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasDatabaseFailure = function (error, nodes) {
    return (error != null) || !Array.isArray(nodes);
};
