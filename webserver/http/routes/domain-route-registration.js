/**
* @description Per-domain HTTP route registration
* @license Apache-2.0
*/

'use strict';

module.exports.registerDomainRoutes = function (domains, routeGroups) {
    for (var domainId in domains) {
        const domain = domains[domainId];
        if ((domain.dns != null) || (domain.share != null)) { continue; }
        for (var index = 0; index < routeGroups.length; index++) { routeGroups[index].register(domain); }
    }
};
