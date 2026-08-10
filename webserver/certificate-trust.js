/**
* @description TLS certificate trust policy for web downloads and security headers
* @license Apache-2.0
*/

'use strict';

module.exports.createCertificateTrust = function (args, config, certificates) {
    return function isTrustedCert(domain) {
        if ((domain != null) && (typeof domain.trustedcert == 'boolean')) return domain.trustedcert;
        if (typeof args.trustedcert == 'boolean') return args.trustedcert;
        if (args.tlsoffload != null) return true;
        if (config.letsencrypt != null) return (config.letsencrypt.production === true);
        if ((typeof certificates.WebIssuer == 'string') && (certificates.WebIssuer.indexOf('MeshCentralRoot-') == 0)) return false;
        if (certificates.CommonName.indexOf('.') == -1) return false;
        return true;
    };
};
