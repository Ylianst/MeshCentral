/**
* @description Public URL, hostname and origin checks for the MeshCentral web server
* @license Apache-2.0
*/

'use strict';

module.exports.createServerIdentity = function (options) {
    const args = options.args;
    const certificates = options.certificates;

    function getWebServerName(domain, req) {
        if (domain.dns != null) return domain.dns;
        if ((certificates.CommonName == 'un-configured') && (req != null) && (req.headers != null) && (typeof req.headers.host == 'string')) return req.headers.host.split(':')[0];
        return certificates.CommonName;
    }

    function generateBaseURL(domain, req) {
        const serverName = getWebServerName(domain, req);
        const httpsPort = ((args.aliasport == null) ? args.port : args.aliasport);
        var domainPath = (domain.dns == null) ? domain.id : '';
        if (domainPath != '') domainPath += '/';
        return 'https://' + serverName + ':' + httpsPort + '/' + domainPath;
    }

    function checkWebServerOriginName(domain, req) {
        if (domain.allowedorigin === true) return true;
        if (typeof req.headers.origin != 'string') return true;
        let originUrl;
        try { originUrl = new URL(req.headers.origin); } catch (ex) { return false; }
        if (!originUrl.hostname) return false;
        if (Array.isArray(domain.allowedorigin)) return (domain.allowedorigin.indexOf(originUrl.hostname) >= 0);
        if (domain.dns != null) return (domain.dns == originUrl.hostname);
        return (getWebServerName(domain, req) == originUrl.hostname);
    }

    return {
        generateBaseURL: generateBaseURL,
        getWebServerName: getWebServerName,
        CheckWebServerOriginName: checkWebServerOriginName
    };
};
