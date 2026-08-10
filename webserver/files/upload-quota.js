/**
* @description Per-request cumulative upload quota reservations
* @license Apache-2.0
*/

'use strict';

module.exports.createUploadQuota = function (initialSize, quota) {
    var reservedSize = initialSize;

    function tryReserve(size) {
        if ((typeof size !== 'number') || !Number.isFinite(size) || (size < 0)) return false;
        if ((quota != null) && ((reservedSize + size) >= quota)) return false;
        reservedSize += size;
        return true;
    }

    return {
        tryReserve: tryReserve,
        getReservedSize: function () { return reservedSize; }
    };
};
