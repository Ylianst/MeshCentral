/**
* @description In-memory serialization for account creation by domain
* @license Apache-2.0
*/

'use strict';

module.exports.createAccountCreationReservations = function () {
    const pendingDomains = Object.create(null);

    function acquire(domainId) {
        if (pendingDomains[domainId] === true) { return false; }
        pendingDomains[domainId] = true;
        return true;
    }

    function release(domainId) {
        if (pendingDomains[domainId] !== true) { return false; }
        delete pendingDomains[domainId];
        return true;
    }

    function isPending(domainId) { return pendingDomains[domainId] === true; }

    return { acquire: acquire, release: release, isPending: isPending };
};
