/**
* @description Terms-of-service rendering handler
* @license Apache-2.0
*/

'use strict';

module.exports.createTerms = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;

    function renderTerms(req, res, domain, terms) {
        res.set({ 'Cache-Control': 'no-store' });
        var logoutControls = {};
        if (req.session && req.session.userid) {
            const user = state.users[req.session.userid];
            if ((req.session.userid.split('/')[1] !== domain.id) || (user == null)) {
                req.session = null;
                res.redirect(domain.url + getQueryPortion(req));
                return;
            }
            logoutControls.name = user.name;
            const extras = (req.query.key != null) ? ('&key=' + encodeURIComponent(req.query.key)) : '';
            if ((domain.ldap == null) && (domain.sspi == null) && (state.args.user == null) && (state.args.nousers !== true)) logoutControls.logoutUrl = domain.url + 'logout?' + Math.random() + extras;
        }
        const args = { logoutControls: encodeURIComponent(JSON.stringify(logoutControls)).replace(/'/g, '%27') };
        if (terms != null) args.terms = encodeURIComponent(terms.toString()).split("'").join("\\'");
        render(req, res, getRenderPage('terms', req, domain), getRenderArgs(args, req, domain));
    }

    function handleRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) === -1)) { res.sendStatus(404); return; }

        if ((parent.configurationFiles != null) && (parent.configurationFiles['terms.txt'] != null)) {
            renderTerms(req, res, domain, parent.configurationFiles['terms.txt']);
            return;
        }
        const termsPath = state.path.join(parent.datapath, 'terms.txt');
        if (state.fs.existsSync(termsPath)) {
            state.fs.readFile(termsPath, 'utf8', function (err, data) {
                if (err != null) { parent.debug('web', 'handleTermsRequest: no terms.txt'); res.sendStatus(404); return; }
                renderTerms(req, res, domain, data);
            });
            return;
        }
        parent.debug('web', 'handleTermsRequest: sending default terms');
        renderTerms(req, res, domain, null);
    }

    return { renderTerms: renderTerms, handleRequest: handleRequest };
};
