/**
* @description Domain-aware not-found response rendering
* @license Apache-2.0
*/

'use strict';

module.exports.createNotFound = function (options) {
    const args = options.args;
    const crypto = options.crypto;
    const getDomain = options.getDomain;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;
    const debug = options.debug;

    function nice404(req, res) {
        debug('web', '404 Error ' + req.url);
        const domain = getDomain(req);
        if ((domain == null) || (domain.auth == 'sspi')) { res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (args.nice404 == false) { res.sendStatus(404); return; }
        const cspNonce = crypto.randomBytes(15).toString('base64');
        res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'nonce-" + cspNonce + "'; img-src 'self'; style-src 'self' 'nonce-" + cspNonce + "';" });
        res.status(404).render(getRenderPage((domain.sitestyle >= 2) ? 'error4042' : 'error404', req, domain), getRenderArgs({ cspNonce: cspNonce }, req, domain));
    }

    return { nice404: nice404 };
};
