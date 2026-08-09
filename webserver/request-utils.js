/**
* @description HTTP request, response, cookie and random-value helpers for the MeshCentral web server
* @license Apache-2.0
*/

'use strict';

const IPv4_PRIVATE_RANGES = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.0.0/29', '192.0.0.8/32', '192.0.0.9/32', '192.0.0.10/32', '192.0.0.170/32', '192.0.0.171/32', '192.0.2.0/24', '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16', '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '240.0.0.0/4', '255.255.255.255/32'];

module.exports.createRequestUtils = function (options) {
    const crypto = options.crypto;
    const ipcheck = options.ipcheck;
    const path = options.path;
    const getCookieIpCheck = options.getCookieIpCheck;

    function checkEmail(str) {
        var x = str.split('@');
        var ok = ((x.length == 2) && (x[0].length > 0) && (x[1].split('.').length > 1) && (x[1].length > 2));
        if (ok == true) { var y = x[1].split('.'); for (var i in y) { if (y[i].length == 0) { ok = false; } } }
        return ok;
    }

    function isMobileBrowser(req) {
        if (typeof req.headers['user-agent'] != 'string') return false;
        return (req.headers['user-agent'].toLowerCase().indexOf('mobile') >= 0);
    }

    function getQueryPortion(req) {
        var removeKeys = ['duo_code', 'state'];
        var s = req.url.indexOf('?');
        if (s == -1) {
            if (req.body && req.body.urlargs) { return req.body.urlargs; }
            return '';
        }
        var queryString = req.url.substring(s + 1);
        var params = queryString.split('&');
        var filteredParams = [];
        for (var i = 0; i < params.length; i++) {
            var key = params[i].split('=')[0];
            if (removeKeys.indexOf(key) === -1) { filteredParams.push(params[i]); }
        }
        return (filteredParams.length > 0 ? ('?' + filteredParams.join('&')) : '');
    }

    function checkAmtPassword(password) { return (password.length > 7) && (/\d/.test(password)) && (/[a-z]/.test(password)) && (/[A-Z]/.test(password)) && (/\W/.test(password)); }
    function getRandomAmtPassword() { var password; do { password = Buffer.from(crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(password) == false); return password; }
    function getRandomPassword() { return Buffer.from(crypto.randomBytes(9), 'binary').toString('base64').replace(/\+/g, '@').replace(/\//g, '$'); }
    function getRandomLowerCase(len) { var result = '', random = crypto.randomBytes(len); for (var i = 0; i < len; i++) { result += String.fromCharCode(97 + (random[i] % 26)); } return result; }
    function getRandomEightDigitInteger() { var bigInt; do { bigInt = crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 100000000; }
    function getRandomSixDigitInteger() { var bigInt; do { bigInt = crypto.randomBytes(4).readUInt32BE(0); } while (bigInt >= 4200000000); return bigInt % 1000000; }

    function cleanRemoteAddr(addr) { if (typeof addr != 'string') { return null; } if (addr.indexOf('::ffff:') == 0) { return addr.substring(7); } return addr; }

    function setContentDispositionHeader(res, type, name, size, altname) {
        name = path.basename(name).split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split('\'').join('');
        try {
            var headers = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + encodeURIComponent(name) + '"' };
            if (typeof size == 'number') { headers['Content-Length'] = size; }
            res.set(headers);
        } catch (ex) {
            var fallbackHeaders = { 'Cache-Control': 'no-store', 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + altname + '"' };
            if (typeof size == 'number') { fallbackHeaders['Content-Length'] = size; }
            res.set(fallbackHeaders);
        }
    }

    function isIPMatch(ip, matchList) {
        for (var i in matchList) { if (ipcheck.match(ip, matchList[i]) == true) return true; }
        return false;
    }

    function checkAgentColorString(header, value) {
        if ((typeof header !== 'string') || (typeof value !== 'string')) return '';
        if (value.startsWith('#') && (value.length == 7)) {
            value = parseInt(value.substring(1, 3), 16) + ',' + parseInt(value.substring(3, 5), 16) + ',' + parseInt(value.substring(5, 7), 16);
        } else {
            const valueSplit = value.split(',');
            if (valueSplit.length != 3) return '';
            const r = parseInt(valueSplit[0]), g = parseInt(valueSplit[1]), b = parseInt(valueSplit[2]);
            if (isNaN(r) || (r < 0) || (r > 255) || isNaN(g) || (g < 0) || (g > 255) || isNaN(b) || (b < 0) || (b > 255)) return '';
            value = r + ',' + g + ',' + b;
        }
        return header + value + '\r\n';
    }

    function isPrivateAddress(ipAddress) {
        if ((ipAddress == '127.0.0.1') || (ipAddress == '::1')) return true;
        for (var i in IPv4_PRIVATE_RANGES) { if (ipcheck.match(ipAddress, IPv4_PRIVATE_RANGES[i])) return true; }
        return /^::$/.test(ipAddress) ||
            /^::1$/.test(ipAddress) ||
            /^::f{4}:([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.test(ipAddress) ||
            /^::f{4}:0.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.test(ipAddress) ||
            /^64:ff9b::([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.test(ipAddress) ||
            /^100::([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4})$/.test(ipAddress) ||
            /^2001::([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4})$/.test(ipAddress) ||
            /^2001:2[0-9a-fA-F]:([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4})$/.test(ipAddress) ||
            /^2001:db8:([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4})$/.test(ipAddress) ||
            /^2002:([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4}):?([0-9a-fA-F]{0,4})$/.test(ipAddress) ||
            /^f[c-d]([0-9a-fA-F]{2,2}):/i.test(ipAddress) ||
            /^fe[8-9a-bA-B][0-9a-fA-F]:/i.test(ipAddress) ||
            /^ff([0-9a-fA-F]{2,2}):/i.test(ipAddress);
    }

    function checkCookieIp(cookieIp, ip) {
        const policy = getCookieIpCheck();
        if (policy == 'none') return true;
        if (policy == 'strict') return (cookieIp == ip);
        if (ipcheck.match(cookieIp, ip + '/24')) return true;
        return (isPrivateAddress(cookieIp) && isPrivateAddress(ip));
    }

    function assembleStringFromObject(format, values) {
        var result = '', i = format.indexOf('{{{');
        if (i > 0) { result = format.substring(0, i); format = format.substring(i); }
        const commands = format.split('{{{');
        for (var j in commands) { if (j == 0) continue; i = commands[j].indexOf('}}}'); result += values[commands[j].substring(0, i)] + commands[j].substring(i + 3); }
        return result;
    }

    function escapeHtml(value) {
        if (typeof value == 'string') return value.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        if ((typeof value == 'boolean') || (typeof value == 'number')) return value;
    }

    function calcDelta(oldData, newData) {
        const result = {};
        for (var key in newData) {
            if (typeof newData[key] == 'object') result[key] = calcDelta(oldData[key] ? oldData[key] : {}, newData[key]);
            if (typeof newData[key] == 'number') result[key] = (typeof oldData[key] == 'number') ? (newData[key] - oldData[key]) : newData[key];
        }
        return result;
    }

    return {
        checkEmail: checkEmail,
        isMobileBrowser: isMobileBrowser,
        getQueryPortion: getQueryPortion,
        getRandomAmtPassword: getRandomAmtPassword,
        getRandomPassword: getRandomPassword,
        getRandomLowerCase: getRandomLowerCase,
        getRandomEightDigitInteger: getRandomEightDigitInteger,
        getRandomSixDigitInteger: getRandomSixDigitInteger,
        cleanRemoteAddr: cleanRemoteAddr,
        setContentDispositionHeader: setContentDispositionHeader,
        isIPMatch: isIPMatch,
        checkAgentColorString: checkAgentColorString,
        isPrivateAddress: isPrivateAddress,
        checkCookieIp: checkCookieIp,
        assembleStringFromObject: assembleStringFromObject,
        escapeHtml: escapeHtml,
        calcDelta: calcDelta
    };
};
