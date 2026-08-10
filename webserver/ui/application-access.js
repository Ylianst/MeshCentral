/**
* @description Main web application session access validation
* @license Apache-2.0
*/

'use strict';

module.exports.validateApplicationAccess = function (request, response, domain, user, parent, getQueryPortion) {
    if (request.session.userid.split('/')[1] != domain.id) {
        parent.debug('web', 'handleRootRequestEx: incorrect domain.');
        request.session = null;
        response.redirect(domain.url + getQueryPortion(request));
        return false;
    }

    if ((user.siteadmin != null) && ((user.siteadmin & 32) != 0) && (user.siteadmin != 0xFFFFFFFF)) {
        parent.debug('web', 'handleRootRequestEx: locked account.');
        delete request.session.userid;
        delete request.session.currentNode;
        delete request.session.passhint;
        delete request.session.cuserid;
        request.session.messageid = 110;
        response.redirect(domain.url + getQueryPortion(request));
        return false;
    }
    return true;
};
