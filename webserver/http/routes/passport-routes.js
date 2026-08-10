/**
* @description Registration of Passport authentication routes for a domain
* @license Apache-2.0
*/

'use strict';

module.exports.createPassportRoutes = function (options) {
    const state = options.state;
    const parent = options.parent;
    const flags = options.flags;
    const getDomain = options.getDomain;
    const strategyLogin = options.strategyLogin;
    const urlencoded = options.urlencoded;

    function retryEmptySession(req, res) {
        if ((Object.keys(req.session).length != 0) || (req.query.nmr != null)) return false;
        let retryUrl = req.url;
        retryUrl += retryUrl.indexOf('?') >= 0 ? '&nmr=1' : '?nmr=1';
        res.set('Content-Type', 'text/html');
        res.end('<html><head><meta http-equiv="refresh" content=0;url="' + encodeURIComponent(retryUrl) + '"></head><body></body></html>');
        return true;
    }

    function getRequestDomain(req, next) {
        const domain = getDomain(req);
        if (domain.passport == null) { next(); return null; }
        return domain;
    }

    function register(domain) {
        if (typeof domain.authstrategies != 'object') return;
        const url = domain.url;
        const authFlags = domain.authstrategies.authStrategyFlags;
        parent.authLog('setupHTTPHandlers', `Setting up authentication strategies login and callback URLs for ${domain.id == '' ? 'root' : '"' + domain.id + '"'} domain.`);

        if ((authFlags & flags.twitter) != 0) {
            state.app.get(url + 'auth-twitter', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('twitter-' + requestDomain.id)(req, res, function (err) { console.log('c1', err, req.session); next(); });
            });
            state.app.get(url + 'auth-twitter-callback', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if ((requestDomain == null) || retryEmptySession(req, res)) return;
                requestDomain.passport.authenticate('twitter-' + requestDomain.id, { failureRedirect: requestDomain.url })(req, res, function (err) { if (err != null) console.log(err); next(); });
            }, strategyLogin);
        }

        if ((authFlags & flags.google) != 0) {
            state.app.get(url + 'auth-google', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('google-' + requestDomain.id, { scope: ['profile', 'email'] })(req, res, next);
            });
            state.app.get(url + 'auth-google-callback', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('google-' + requestDomain.id, { failureRedirect: requestDomain.url })(req, res, function (err) { if (err != null) console.log(err); next(); });
            }, strategyLogin);
        }

        if ((authFlags & flags.github) != 0) {
            state.app.get(url + 'auth-github', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('github-' + requestDomain.id, { scope: ['user:email'] })(req, res, next);
            });
            state.app.get(url + 'auth-github-callback', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('github-' + requestDomain.id, { failureRedirect: requestDomain.url })(req, res, next);
            }, strategyLogin);
        }

        if ((authFlags & flags.azure) != 0) {
            state.app.get(url + 'auth-azure', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate('azure-' + requestDomain.id, { state: parent.encodeCookie({ p: 'azure' }, parent.loginCookieEncryptionKey) })(req, res, next);
            });
            state.app.get(url + 'auth-azure-callback', function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if ((requestDomain == null) || retryEmptySession(req, res)) return;
                if (req.query.state != null) {
                    const cookie = parent.decodeCookie(req.query.state, parent.loginCookieEncryptionKey, 10);
                    if ((cookie != null) && (cookie.p == 'azure')) {
                        requestDomain.passport.authenticate('azure-' + requestDomain.id, { failureRedirect: requestDomain.url })(req, res, next);
                        return;
                    }
                }
                next();
            }, strategyLogin);
        }

        if ((authFlags & flags.oidc) != 0) {
            const authUrl = url + 'auth-oidc';
            parent.authLog('setupHTTPHandlers', `OIDC: Authorization URL: ${authUrl}`);
            state.app.get(authUrl, function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                requestDomain.passport.authenticate(`oidc-${requestDomain.id}`, { failureRedirect: requestDomain.url, failureFlash: true })(req, res, next);
            });
            let redirectPath;
            if (typeof domain.authstrategies.oidc.client.redirect_uri == 'string') redirectPath = (new URL(domain.authstrategies.oidc.client.redirect_uri)).pathname;
            else if (Array.isArray(domain.authstrategies.oidc.client.redirect_uris)) redirectPath = (new URL(domain.authstrategies.oidc.client.redirect_uris[0])).pathname;
            else redirectPath = url + 'auth-oidc-callback';
            parent.authLog('setupHTTPHandlers', `OIDC: Callback URL: ${redirectPath}`);
            state.app.get(redirectPath, urlencoded({ extended: false }), function (req, res, next) {
                const requestDomain = getRequestDomain(req, next);
                if (requestDomain == null) return;
                if (req.session && req.session.userid) { next(); return; }
                if (req.session && req.session['oidc-' + requestDomain.id]) {
                    requestDomain.passport.authenticate(`oidc-${requestDomain.id}`, { failureRedirect: requestDomain.url, failureFlash: true })(req, res, next);
                } else {
                    next();
                }
            }, strategyLogin);
        }

        registerSaml(domain, authFlags, flags.saml, 'saml', 'auth-saml', true);
        registerSaml(domain, authFlags, flags.intelSaml, 'isaml', 'auth-intel', false);
        registerSaml(domain, authFlags, flags.jumpCloudSaml, 'jumpcloud', 'auth-jumpcloud', false);
    }

    function registerSaml(domain, authFlags, flag, strategy, route, preserveRelayState) {
        if ((authFlags & flag) == 0) return;
        const url = domain.url;
        state.app.get(url + route, function (req, res, next) {
            const requestDomain = getRequestDomain(req, next);
            if (requestDomain == null) return;
            if (preserveRelayState && (Object.keys(req.query).length != 0)) {
                req.query.RelayState = encodeURIComponent(`${req.protocol}://${req.hostname}${req.originalUrl}`.replace('auth-saml/', ''));
            }
            requestDomain.passport.authenticate(strategy + '-' + requestDomain.id, { failureRedirect: requestDomain.url, failureFlash: true })(req, res, next);
        });
        state.app.post(url + route + '-callback', urlencoded({ extended: false }), function (req, res, next) {
            const requestDomain = getRequestDomain(req, next);
            if (requestDomain == null) return;
            requestDomain.passport.authenticate(strategy + '-' + requestDomain.id, { failureRedirect: requestDomain.url, failureFlash: true })(req, res, next);
        }, strategyLogin);
    }

    return { register: register };
};
