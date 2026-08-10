/**
* @description Client address resolution and HTTP traffic accounting
* @license Apache-2.0
*/

'use strict';

module.exports.createRequestContext = function (options) {
    const state = options.state;
    const isIPMatch = options.isIPMatch;

    function accountTraffic(req) {
        if (req.headers.upgrade == 'websocket') { state.trafficStats.httpWebSocketCount++; return; }
        state.trafficStats.httpRequestCount++;
        if (typeof req.socket.xbytesRead != 'number') {
            req.socket.xbytesRead = 0;
            req.socket.xbytesWritten = 0;
            req.socket.on('close', function () {
                state.trafficStats.httpIn += this.bytesRead - this.xbytesRead;
                state.trafficStats.httpOut += this.bytesWritten - this.xbytesWritten;
                this.xbytesRead = this.bytesRead;
                this.xbytesWritten = this.bytesWritten;
            });
        } else {
            state.trafficStats.httpIn += req.socket.bytesRead - req.socket.xbytesRead;
            state.trafficStats.httpOut += req.socket.bytesWritten - req.socket.xbytesWritten;
            req.socket.xbytesRead = req.socket.bytesRead;
            req.socket.xbytesWritten = req.socket.bytesWritten;
        }
    }

    function resolveClientAddress(req, includeForwardedHost, stripIpv4Port) {
        var remoteIp = '0.0.0.0';
        var forwardedHost = req.headers.host;
        if (typeof req.connection.remoteAddress == 'string') remoteIp = req.connection.remoteAddress.startsWith('::ffff:') ? req.connection.remoteAddress.substring(7) : req.connection.remoteAddress;
        const trusted = (state.args.trustedproxy === true) || (state.args.tlsoffload === true) ||
            ((typeof state.args.trustedproxy == 'object') && isIPMatch(remoteIp, state.args.trustedproxy)) ||
            ((typeof state.args.tlsoffload == 'object') && isIPMatch(remoteIp, state.args.tlsoffload));
        if (trusted) {
            if (req.headers['cf-connecting-ip']) { req.clientIp = req.headers['cf-connecting-ip'].split(',')[0].trim(); }
            else if (req.headers['x-forwarded-for']) { req.clientIp = req.headers['x-forwarded-for'].split(',')[0].trim(); }
            else if (req.headers['x-real-ip']) { req.clientIp = req.headers['x-real-ip'].split(',')[0].trim(); }
            else { req.clientIp = remoteIp; }
            if (stripIpv4Port === true) {
                const parts = req.clientIp.split(':');
                if (parts.length == 2) req.clientIp = parts[0];
            }
            if ((includeForwardedHost === true) && req.headers['x-forwarded-host']) forwardedHost = req.headers['x-forwarded-host'].split(',')[0];
        } else {
            req.clientIp = remoteIp;
        }
        return forwardedHost;
    }

    return { accountTraffic: accountTraffic, resolveClientAddress: resolveClientAddress };
};
