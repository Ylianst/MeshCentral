/**
* @description Root page request handling
* @license Apache-2.0
*/

'use strict';

module.exports.createRootRequests = function (options) {
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const isTrustedCert = options.isTrustedCert;

    function handleRootRedirect(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        res.redirect(domain.rootredirect + getQueryPortion(req));
    }

    function getRootCertLink(domain) {
        if (isTrustedCert(domain) == false) {
            var xdomain = (domain.dns == null) ? domain.id : '';
            if (xdomain != '') xdomain += '/';
            return '<a href=/' + xdomain + 'MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>';
        }
        return '';
    }

    return { handleRootRedirect: handleRootRedirect, getRootCertLink: getRootCertLink };
};
