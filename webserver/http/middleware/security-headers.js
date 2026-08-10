/**
* @description Content security policy and HTTP security headers for web responses
* @license Apache-2.0
*/

'use strict';

module.exports.createSecurityHeaders = function (options) {
    const getSettings = options.getSettings;
    const getWebRelayServer = options.getWebRelayServer;
    const isTrustedCert = options.isTrustedCert;

    function build(domain, req, forwardedHost) {
        const settings = getSettings();
        const geoUrl = domain.geolocation ? ' *.openstreetmap.org' : '';
        var selfUrl = ' wss://' + req.headers.host;
        if ((forwardedHost != null) && (forwardedHost != req.headers.host)) selfUrl += ' wss://' + forwardedHost;
        const extraScriptSrc = (settings.extrascriptsrc != null) ? (' ' + settings.extrascriptsrc) : '';
        const extraImgSrc = (settings.extraimgsrc != null) ? (' ' + settings.extraimgsrc) : '';
        const allowedFramingOriginsValue = (domain.allowedframingorigins != null) ? domain.allowedframingorigins : settings.allowedframingorigins;
        const hasAllowedFramingOrigins = (allowedFramingOriginsValue != null);
        var framingOrigins = [];
        if (typeof allowedFramingOriginsValue === 'string') {
            framingOrigins = allowedFramingOriginsValue.split(/[,\s]+/).map(function (value) { return value.trim(); }).filter(function (value) { return value.length > 0; });
        } else if (Array.isArray(allowedFramingOriginsValue)) {
            framingOrigins = allowedFramingOriginsValue.filter(function (value) { return (typeof value === 'string') && (value.trim().length > 0); }).map(function (value) { return value.trim(); });
        }

        var extraFrameSrc = '';
        const webRelayServer = getWebRelayServer();
        if ((webRelayServer != null) && (webRelayServer.port != 0)) {
            extraFrameSrc = ' https://' + req.headers.host + ':' + webRelayServer.port;
            if ((forwardedHost != null) && (forwardedHost != req.headers.host)) extraFrameSrc += ' https://' + forwardedHost + ':' + webRelayServer.port;
        }

        var duoSrc = '';
        if ((typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.apihostname == 'string')) duoSrc = domain.duo2factor.apihostname;

        var contentSecurityPolicy = "default-src 'none'; font-src 'self' fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' " + extraScriptSrc + "; connect-src 'self'" + geoUrl + selfUrl + "; img-src 'self' blob: data:" + geoUrl + extraImgSrc + " data:; style-src 'self' 'unsafe-inline' fonts.googleapis.com; frame-src 'self' blob: mcrouter:" + extraFrameSrc + "; media-src 'self'; form-action 'self' " + duoSrc + "; manifest-src 'self'";
        if (hasAllowedFramingOrigins) {
            const frameAncestors = "'self'" + (framingOrigins.length > 0 ? ' ' + framingOrigins.join(' ') : '');
            contentSecurityPolicy += '; frame-ancestors ' + frameAncestors;
        }

        const headers = {
            'Referrer-Policy': 'no-referrer',
            'X-XSS-Protection': '1; mode=block',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': contentSecurityPolicy
        };
        if (req.headers['user-agent'] && (req.headers['user-agent'].indexOf('Chrome') >= 0)) headers['Permissions-Policy'] = 'interest-cohort=()';
        if (hasAllowedFramingOrigins) {
            if (framingOrigins.length === 0) headers['X-Frame-Options'] = 'sameorigin';
        } else if ((settings.allowframing !== true) && (typeof settings.allowframing !== 'string')) {
            headers['X-Frame-Options'] = 'sameorigin';
        }
        if ((settings.stricttransportsecurity === true) || ((settings.stricttransportsecurity !== false) && isTrustedCert(domain))) {
            headers['Strict-Transport-Security'] = (typeof settings.stricttransportsecurity == 'string') ? settings.stricttransportsecurity : 'max-age=63072000';
        }
        if ((domain != null) && (domain.httpheaders != null) && (typeof domain.httpheaders == 'object')) {
            for (var name in domain.httpheaders) { if (domain.httpheaders[name] === null) { delete headers[name]; } else { headers[name] = domain.httpheaders[name]; } }
        }
        return headers;
    }

    return { build: build };
};
