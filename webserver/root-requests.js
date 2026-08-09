/**
* @description Root page request handling
* @license Apache-2.0
*/

'use strict';

module.exports.createRootRequests = function (options) {
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;

    function handleRootRedirect(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        res.redirect(domain.rootredirect + getQueryPortion(req));
    }

    return { handleRootRedirect: handleRootRedirect };
};
