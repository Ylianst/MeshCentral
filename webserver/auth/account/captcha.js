/**
* @description New-account and CrowdSec CAPTCHA handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createCaptcha = function (options) {
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    let svgCaptcha = options.svgCaptcha;

    function getSvgCaptcha() {
        if (svgCaptcha == null) { svgCaptcha = require('svg-captcha'); }
        return svgCaptcha;
    }

    function createNewAccountCookie() {
        return parent.encodeCookie({ type: 'newAccount', captcha: getSvgCaptcha().randomText(5) }, parent.loginCookieEncryptionKey);
    }

    function handleNewAccount(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.newaccountscaptcha == null) || (domain.newaccountscaptcha === false) || (req.query.x == null)) { res.sendStatus(404); return; }
        const cookie = parent.decodeCookie(req.query.x, parent.loginCookieEncryptionKey);
        if ((cookie == null) || (cookie.type !== 'newAccount') || (typeof cookie.captcha !== 'string')) { res.sendStatus(404); return; }
        res.type('svg');
        res.status(200).end(getSvgCaptcha()(cookie.captcha, {}));
    }

    function getRedirectPath(domain) {
        return ((domain.id === '') && (domain.dns == null)) ? '/' : ('/' + domain.id);
    }

    function handleGet(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (parent.crowdSecBounser == null) { res.sendStatus(404); return; }
        parent.crowdSecBounser.applyCaptcha(req, res, function () { res.redirect(getRedirectPath(domain)); });
    }

    function handlePost(req, res) {
        if (parent.crowdSecBounser == null) { res.sendStatus(404); return; }
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        req.originalUrl = getRedirectPath(domain);
        parent.crowdSecBounser.applyCaptcha(req, res, function () { res.redirect(req.originalUrl); });
    }

    return { createNewAccountCookie: createNewAccountCookie, handleNewAccount: handleNewAccount, handleGet: handleGet, handlePost: handlePost };
};
