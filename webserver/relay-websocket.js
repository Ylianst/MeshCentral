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

module.exports.openRecordingFile = function (fileSystem, filename, onError) {
    try { return fileSystem.openSync(filename, 'w'); } catch (error) { onError(error); return null; }
};
