/**
* @description Root page request handling
* @license Apache-2.0
*/

'use strict';

module.exports.createRootRequests = function (options) {
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const isTrustedCert = options.isTrustedCert;
    const state = options.state;
    const debug = options.debug;
    const now = options.now || Date.now;
    const getMaintenanceMode = options.getMaintenanceMode;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;

    function checkRootRequest(req, res, domain) {
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return false; }
        if (!state.args) { debug('web', 'handleRootRequest: no obj.args.'); res.sendStatus(500); return false; }
        if (domain.userrequiredhttpheader && (typeof domain.userrequiredhttpheader == 'object')) {
            var ok = false;
            for (var i in req.headers) { if (domain.userrequiredhttpheader[i.toLowerCase()] == req.headers[i]) { ok = true; } }
            if (ok == false) { res.sendStatus(404); return false; }
        }
        if ((req.session != null) && (typeof req.session.expire == 'number') && ((req.session.expire - now()) <= 0)) { for (var i in req.session) { delete req.session[i]; } }
        return true;
    }

    function handleRootRedirect(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        res.redirect(domain.rootredirect + getQueryPortion(req));
    }

    function redirectUnknownUser(req, res, domain) {
        if ((typeof domain.unknownuserrootredirect != 'string') || ((req.session != null) && (req.session.userid != null))) { return false; }
        const requestUrl = new URL(req.url, 'http://localhost');
        if (requestUrl.pathname.endsWith('/login')) { return false; }
        res.redirect(domain.unknownuserrootredirect + getQueryPortion(req));
        return true;
    }

    function handleMaintenance(req, res, domain) {
        if ((getMaintenanceMode() == null) || (req.query.loginscreen === '1')) { return false; }
        debug('web', 'handleLoginRequest: Server under maintenance.');
        render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
        return true;
    }

    function getRootCertLink(domain) {
        if (isTrustedCert(domain) == false) {
            var xdomain = (domain.dns == null) ? domain.id : '';
            if (xdomain != '') xdomain += '/';
            return '<a href=/' + xdomain + 'MeshServerRootCert.cer title="Download the root certificate for this server">Root Certificate</a>';
        }
        return '';
    }

    return { checkRootRequest: checkRootRequest, handleRootRedirect: handleRootRedirect, redirectUnknownUser: redirectUnknownUser, handleMaintenance: handleMaintenance, getRootCertLink: getRootCertLink };
};
