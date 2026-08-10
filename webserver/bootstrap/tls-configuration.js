/**
* @description TLS, SNI and session-resumption configuration for web listeners
* @license Apache-2.0
*/

'use strict';

const DEFAULT_CIPHERS = [
    'TLS_AES_256_GCM_SHA384', 'TLS_AES_128_GCM_SHA256', 'TLS_AES_128_CCM_8_SHA256', 'TLS_AES_128_CCM_SHA256',
    'TLS_CHACHA20_POLY1305_SHA256', 'ECDHE-RSA-AES256-GCM-SHA384', 'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-ECDSA-AES128-GCM-SHA256', 'DHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-CHACHA20-POLY1305', 'ECDHE-ARIA128-GCM-SHA256', 'ECDHE-ARIA256-GCM-SHA384',
    'ECDHE-RSA-AES128-SHA256', 'ECDHE-RSA-AES256-SHA384', '!aNULL', '!eNULL', '!EXPORT', '!DES', '!RC4',
    '!MD5', '!PSK', '!SRP', '!CAMELLIA'
].join(':');

module.exports.createTlsConfiguration = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const certificates = options.certificates;
    const tls = options.tls;
    const https = options.https;
    const expressWs = options.expressWs;
    const constants = options.constants;
    var sessionStore = {};
    var sessionStoreCount = 0;

    function setupSniCredentials() {
        var dnsCount = 0;
        state.tlsSniCredentials = {};
        const dnsCertificates = certificates.dns || {};
        for (var domainId in dnsCertificates) {
            const domain = parent.config.domains[domainId];
            if ((domain != null) && (domain.dns != null)) {
                state.dnsDomains[domain.dns.toLowerCase()] = domain;
                state.tlsSniCredentials[domain.dns] = tls.createSecureContext(dnsCertificates[domainId]).context;
                dnsCount++;
            }
        }
        if (dnsCount > 0) {
            state.tlsSniCredentials[''] = tls.createSecureContext({ cert: certificates.web.cert, key: certificates.web.key, ca: certificates.web.ca }).context;
        } else {
            state.tlsSniCredentials = null;
        }
    }

    function tlsSniCallback(name, callback) {
        const credentials = state.tlsSniCredentials[name];
        callback(null, (credentials != null) ? credentials : state.tlsSniCredentials['']);
    }

    function registerSessionHandlers(server) {
        server.on('newSession', function (id, data, callback) {
            if (sessionStoreCount > 1000) { sessionStoreCount = 0; sessionStore = {}; }
            sessionStore[id.toString('hex')] = data;
            sessionStoreCount++;
            callback();
        });
        server.on('resumeSession', function (id, callback) { callback(null, sessionStore[id.toString('hex')] || null); });
    }

    function secureOptions() {
        return constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1;
    }

    function setupServers() {
        if (state.args.tlsoffload) {
            state.expressWs = expressWs(state.app, null, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        } else {
            var ciphers = DEFAULT_CIPHERS;
            if (state.useNodeDefaultTLSCiphers) ciphers = tls.DEFAULT_CIPHERS;
            if (state.tlsCiphers) ciphers = Array.isArray(state.tlsCiphers) ? state.tlsCiphers.join(':') : state.tlsCiphers;
            const tlsOptions = { cert: certificates.web.cert, key: certificates.web.key, ca: certificates.web.ca, rejectUnauthorized: true, ciphers: ciphers, secureOptions: secureOptions() };
            if (state.tlsSniCredentials != null) tlsOptions.SNICallback = tlsSniCallback;
            state.tlsServer = https.createServer(tlsOptions, state.app);
            state.tlsServer.on('secureConnection', function () { });
            state.tlsServer.on('error', function (err) { console.log('tlsServer error', err); });
            registerSessionHandlers(state.tlsServer);
            state.expressWs = expressWs(state.app, state.tlsServer, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
        }

        if (state.args.agentport) {
            var agentPortTls = true;
            if ((state.args.tlsoffload != null) && (state.args.tlsoffload != false)) agentPortTls = false;
            if (typeof state.args.agentporttls == 'boolean') agentPortTls = state.args.agentporttls;
            if (certificates.webdefault == null) agentPortTls = false;
            if (agentPortTls == false) {
                state.expressWsAlt = expressWs(state.agentapp, null, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
            } else {
                const tlsOptions = { cert: certificates.webdefault.cert, key: certificates.webdefault.key, ca: certificates.webdefault.ca, rejectUnauthorized: true, ciphers: 'HIGH:TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_CCM_SHA256:TLS_CHACHA20_POLY1305_SHA256', secureOptions: secureOptions() };
                state.tlsAltServer = https.createServer(tlsOptions, state.agentapp);
                state.tlsAltServer.on('secureConnection', function () { });
                state.tlsAltServer.on('error', function (err) { console.log('tlsAltServer error', err); });
                registerSessionHandlers(state.tlsAltServer);
                state.expressWsAlt = expressWs(state.agentapp, state.tlsAltServer, { wsOptions: { perMessageDeflate: (args.wscompression === true) } });
            }
        }
    }

    setupSniCredentials();
    return { setupServers: setupServers, getSessionStoreSize: function () { return Object.keys(sessionStore).length; }, tlsSniCallback: tlsSniCallback };
};
