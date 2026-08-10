/**
* @description Device record cleanup before database persistence
* @license Apache-2.0
*/

'use strict';

module.exports.createDeviceCleaner = function (state) {
    return function cleanDevice(device) {
        if (device.links != null) {
            for (var id in device.links) {
                if ((state.users[id] == null) && (state.userGroups[id] == null)) {
                    delete device.links[id];
                    if (Object.keys(device.links).length == 0) { delete device.links; }
                }
            }
        }
        return device;
    };
};
