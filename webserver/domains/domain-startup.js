/**
* @description Shared-domain mounts and authentication-strategy startup
* @license Apache-2.0
*/

'use strict';

module.exports.createDomainStartup = function (options) {
    const domains = options.domains;
    const app = options.app;
    const staticMiddleware = options.staticMiddleware;
    const setupDomainAuthStrategy = options.setupDomainAuthStrategy;
    const finalizeWebserver = options.finalizeWebserver;

    async function setupAllDomainAuthStrategies() {
        for (var domainId in domains) {
            const domain = domains[domainId];
            if (domain.dns != null) {
                if (typeof domains[''].authstrategies != 'object') domains[''].authstrategies = { authStrategyFlags: 0 };
                domains[''].authstrategies.authStrategyFlags |= await setupDomainAuthStrategy(domain);
            } else {
                if (typeof domain.authstrategies != 'object') domain.authstrategies = { authStrategyFlags: 0 };
                domain.authstrategies.authStrategyFlags |= await setupDomainAuthStrategy(domain);
            }
        }
    }

    function setup() {
        var setupSso = false;
        for (var domainId in domains) {
            const domain = domains[domainId];
            if ((domain.dns == null) && (domain.share != null)) app.use(domain.url, staticMiddleware(domain.share));
            if (typeof domain.authstrategies == 'object') setupSso = true;
        }
        if (setupSso) return setupAllDomainAuthStrategies().then(function () { finalizeWebserver(); });
        finalizeWebserver();
    }

    return { setup: setup, setupAllDomainAuthStrategies: setupAllDomainAuthStrategies };
};
