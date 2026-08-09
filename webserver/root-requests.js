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
    const authLog = options.authLog;
    const getLoginCookieEncryptionKey = options.getLoginCookieEncryptionKey;
    const handleRootRequestEx = options.handleRootRequestEx;
    const authenticate = options.authenticate;
    const users = options.users;
    const checkUserOneTimePasswordRequired = options.checkUserOneTimePasswordRequired;
    const setSessionRandom = options.setSessionRandom;
    const database = options.database;

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

    function handleSspi(req, res, domain, direct) {
        if ((domain.sspi == null) || ((req.query.login != null) && (getLoginCookieEncryptionKey() != null))) { return false; }
        domain.sspi.authenticate(req, res, function (err) {
            if ((err != null) || (req.connection.user == null)) {
                authLog('https', 'Failed SSPI-auth for ' + req.connection.user + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'] });
                debug('web', 'handleRootRequest: SSPI auth required.');
                try { res.sendStatus(401); } catch (ex) { }
            } else {
                debug('web', 'handleRootRequest: SSPI auth ok.');
                handleRootRequestEx(req, res, domain, direct);
            }
        });
        return true;
    }

    function handleUrlCredentials(req, res, domain, direct) {
        if (!(req.query.user && req.query.pass)) { return false; }
        authenticate(req.query.user, req.query.pass, domain, function (err, userid, passhint, loginOptions) {
            var user = users[userid];
            if ((err == null) && checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true) {
                handleRootRequestEx(req, res, domain, direct);
            } else if ((userid != null) && (err == null)) {
                debug('web', 'handleRootRequest: user/pass in URL auth ok.');
                req.session.userid = userid;
                delete req.session.currentNode;
                req.session.ip = req.clientIp;
                setSessionRandom(req);
                authLog('https', 'Accepted password for ' + userid + ' from ' + req.clientIp + ' port ' + req.connection.remotePort, { useragent: req.headers['user-agent'], sessionid: req.session.x });
                handleRootRequestEx(req, res, domain, direct);
            } else {
                handleRootRequestEx(req, res, domain, direct);
            }
        });
        return true;
    }

    function handleLoginToken(req, res, domain, direct) {
        if ((req.session == null) || (typeof req.session.loginToken != 'string')) { return false; }
        database.Get('logintoken-' + req.session.loginToken, function (err, docs) {
            if ((err != null) || (docs == null) || (docs.length != 1) || (docs[0].tokenUser != req.session.loginToken)) { for (var i in req.session) { delete req.session[i]; } }
            handleRootRequestEx(req, res, domain, direct);
        });
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

    return { checkRootRequest: checkRootRequest, handleRootRedirect: handleRootRedirect, redirectUnknownUser: redirectUnknownUser, handleMaintenance: handleMaintenance, handleSspi: handleSspi, handleUrlCredentials: handleUrlCredentials, handleLoginToken: handleLoginToken, getRootCertLink: getRootCertLink };
};
