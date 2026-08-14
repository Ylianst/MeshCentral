/**
* @description Software action permission checks
* @license Apache-2.0
*/

/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint esversion: 6 */
"use strict";

const MESHRIGHT_NOSOFTWARE = 0x00800000;
const MESHRIGHT_ADMIN = 0xFFFFFFFF;
const readActions = new Set(['installedapps', 'installedstoreapps']);
const changeActions = new Set(['uninstallapp', 'uninstallstoreapp']);

module.exports.getActionKind = function (action) {
    if (readActions.has(action)) return 'read';
    if (changeActions.has(action)) return 'change';
    return null;
};

module.exports.isActionAllowed = function (action, rights) {
    if (typeof rights != 'number') return false;
    const actionKind = module.exports.getActionKind(action);
    if (actionKind == null) return false;
    if (rights === MESHRIGHT_ADMIN) return true;
    if (actionKind === 'change') return false;
    return ((rights & MESHRIGHT_NOSOFTWARE) === 0);
};
