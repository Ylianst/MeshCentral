/**
* @description Intel AMT relay WebSocket helpers
* @license Apache-2.0
*/

'use strict';

module.exports.hasDatabaseFailure = function (error, documents) {
    return (error != null) || !Array.isArray(documents);
};

module.exports.isSelectedDeviceGroup = function (mesh) {
    return (mesh != null) && (mesh.flags != null) && ((mesh.flags & 4) != 0);
};
