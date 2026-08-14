/**
* @description Main web application entry redirects
* @license Apache-2.0
*/

'use strict';

module.exports.handleApplicationEntry = function (request, response, domain, user, maintenanceMode) {
    if ((maintenanceMode != null) && (user.siteadmin != 4294967295)) {
        request.session.messageid = 115;
        request.session.loginmode = 1;
        response.redirect(domain.url);
        return true;
    }

    if (request.query.meshmessengerid != null) {
        response.redirect(domain.url + 'messenger?id=' + encodeURIComponent(request.query.meshmessengerid) + ((request.query.key != null) ? ('&key=' + encodeURIComponent(request.query.key)) : ''));
        return true;
    }
    return false;
};
