/**
* @description Theme-pack and public static middleware for path-based domains
* @license Apache-2.0
*/

'use strict';

module.exports.createDomainStatic = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const startInterval = options.setInterval || setInterval;

    function register(domain) {
        const url = domain.url;
        state.app.use(url, function (req, res, next) {
            if (req.method !== 'GET') { next(); return; }
            const requestDomain = getDomain(req);
            if ((requestDomain == null) || !requestDomain.themepack) { next(); return; }
            const themeFilePath = state.path.join(parent.datapath, 'theme-pack', requestDomain.themepack, 'public', req.path);
            if (themeFilePath.indexOf('..') >= 0) { next(); return; }
            state.fs.stat(themeFilePath, function (err, stats) {
                if (err || !stats.isFile()) { next(); return; }
                res.sendFile(themeFilePath);
            });
        });
        state.app.use(url, function (req, res, next) {
            const requestDomain = getDomain(req);
            if (requestDomain.webpublicpath != null) {
                state.express.static(requestDomain.webpublicpath)(req, res, next);
            } else if (parent.webPublicOverridePath != null) {
                state.express.static(parent.webPublicOverridePath)(req, res, next);
            } else {
                next();
            }
        });
        state.app.use(url, state.express.static(parent.webPublicPath));
    }

    function startDisconnectionCleanup() {
        if (state.wsagentsDisconnectionsTimer != null) return state.wsagentsDisconnectionsTimer;
        state.wsagentsDisconnectionsTimer = startInterval(function () { state.wsagentsDisconnections = {}; }, 120000);
        return state.wsagentsDisconnectionsTimer;
    }

    return { register: register, startDisconnectionCleanup: startDisconnectionCleanup };
};
