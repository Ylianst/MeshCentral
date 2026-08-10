/**
* @description Domain selection and source-address access control for the MeshCentral web server
* @license Apache-2.0
*/

'use strict';

module.exports.createNetworkAccess = function (options) {
    const config = options.config;
    const ipcheck = options.ipcheck;
    const getDnsDomains = options.getDnsDomains;
    const onBlockedUser = options.onBlockedUser;
    const onBlockedAgent = options.onBlockedAgent;
    const debug = options.debug;

    function checkIpAddressEx(req, res, ipList, closeIfThis, redirectUrl) {
        try {
            if (req.connection) {
                if (req.clientIp) {
                    for (var i = 0; i < ipList.length; i++) {
                        if (ipcheck.match(req.clientIp, ipList[i])) {
                            if (closeIfThis === true) { if (typeof redirectUrl == 'string') { res.redirect(redirectUrl); } else { res.sendStatus(401); } }
                            return true;
                        }
                    }
                }
                if (closeIfThis === false) { if (typeof redirectUrl == 'string') { res.redirect(redirectUrl); } else { res.sendStatus(401); } }
            } else {
                if (res.clientIp) {
                    for (var j = 0; j < ipList.length; j++) {
                        if (ipcheck.match(res.clientIp, ipList[j])) { if (closeIfThis === true) { try { req.close(); } catch (e) { } } return true; }
                    }
                }
                if (closeIfThis === false) { try { req.close(); } catch (e) { } }
            }
        } catch (e) { console.log(e); }
        return false;
    }

    function getDomain(req) {
        if (req.xdomain != null) return req.xdomain;
        if ((req.hostname == 'localhost') && (req.query.domainid != null)) { const domain = config.domains[req.query.domainid]; if (domain != null) return domain; }
        if (req.hostname != null) { const domain = getDnsDomains()[req.hostname.toLowerCase()]; if (domain != null) return domain; }
        const urlParts = req.url.split('/');
        if (urlParts.length < 2) return config.domains[''];
        const domain = config.domains[urlParts[1].toLowerCase()];
        if ((domain != null) && (domain.dns == null)) return domain;
        return config.domains[''];
    }

    function checkUserIpAddress(req, res) {
        if ((config.settings.userblockedip != null) && (checkIpAddressEx(req, res, config.settings.userblockedip, true, config.settings.ipblockeduserredirect) == true)) { onBlockedUser(); return null; }
        if ((config.settings.userallowedip != null) && (checkIpAddressEx(req, res, config.settings.userallowedip, false, config.settings.ipblockeduserredirect) == false)) { onBlockedUser(); return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if (domain == null) { debug('web', 'handleRootRequest: invalid domain.'); try { res.sendStatus(404); } catch (ex) { } return; }
        if ((domain.userblockedip != null) && (checkIpAddressEx(req, res, domain.userblockedip, true, domain.ipblockeduserredirect) == true)) { onBlockedUser(); return null; }
        if ((domain.userallowedip != null) && (checkIpAddressEx(req, res, domain.userallowedip, false, domain.ipblockeduserredirect) == false)) { onBlockedUser(); return null; }
        return domain;
    }

    function checkAgentIpAddress(req, res) {
        if ((config.settings.agentblockedip != null) && (checkIpAddressEx(req, res, config.settings.agentblockedip, null) == true)) { onBlockedAgent(); return null; }
        if ((config.settings.agentallowedip != null) && (checkIpAddressEx(req, res, config.settings.agentallowedip, null) == false)) { onBlockedAgent(); return null; }
        const domain = (req.url ? getDomain(req) : getDomain(res));
        if ((domain.agentblockedip != null) && (checkIpAddressEx(req, res, domain.agentblockedip, null) == true)) { onBlockedAgent(); return null; }
        if ((domain.agentallowedip != null) && (checkIpAddressEx(req, res, domain.agentallowedip, null) == false)) { onBlockedAgent(); return null; }
        return domain;
    }

    function parseAllowedFramingOrigins(value) {
        if (value == null) return [];
        var origins = [];
        if (Array.isArray(value)) { origins = value.slice(); } else if (typeof value == 'string') { origins = value.split(',').map(function (origin) { return origin.trim(); }).filter(function (origin) { return origin.length > 0; }); } else { return []; }
        var result = [];
        for (var i = 0; i < origins.length; i++) {
            var origin = origins[i].trim().replace(/\/+$/, '');
            if (origin.length === 0) continue;
            if (origin.indexOf('https://') === 0 || origin.indexOf('http://') === 0) result.push(origin);
        }
        return result;
    }

    return {
        checkIpAddressEx: checkIpAddressEx,
        checkUserIpAddress: checkUserIpAddress,
        checkAgentIpAddress: checkAgentIpAddress,
        getDomain: getDomain,
        parseAllowedFramingOrigins: parseAllowedFramingOrigins
    };
};
