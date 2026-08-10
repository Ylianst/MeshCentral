/**
* @description Main web application server-feature calculation
* @license Apache-2.0
*/

'use strict';

module.exports.getApplicationServerFeatures = function (domain, databaseType) {
    var serverFeatures = 255;
    if (domain.myserver === false) {
        serverFeatures = 0;
    } else if (typeof domain.myserver == 'object') {
        if (domain.myserver.backup !== true) { serverFeatures -= 1; }
        if (domain.myserver.restore !== true) { serverFeatures -= 2; }
        if (domain.myserver.upgrade !== true) { serverFeatures -= 4; }
        if (domain.myserver.errorlog !== true) { serverFeatures -= 8; }
        if (domain.myserver.console !== true) { serverFeatures -= 16; }
        if (domain.myserver.trace !== true) { serverFeatures -= 32; }
        if (domain.myserver.config !== true) { serverFeatures -= 128; }
    }
    if ((databaseType != 1) && ((serverFeatures & 2) != 0)) { serverFeatures -= 2; }
    return serverFeatures;
};
