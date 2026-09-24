'use strict';

const fs = require('fs');
const dns = require('dns');
const net = require('net');
const https = require('https');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
const global6 = new net.BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');
function publicAddress(address) {
    const family = net.isIP(address);
    return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && global6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
function parseUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a public HTTPS download URL.');
    let url;
    try { url = new URL(value); } catch (ex) { throw new Error('Enter a public HTTPS download URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('Use HTTPS on port 443 without a username, password or fragment.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !publicAddress(host)) throw new Error('Downloads from private or reserved addresses are not allowed.');
    return url;
}
function sourceUrl(value) {
    const url = parseUrl(value);
    url.search = '';
    return url.href;
}
exports.publicAddress = publicAddress;
exports.parseUrl = parseUrl;
exports.sourceUrl = sourceUrl;
exports.createClient = function (transport = https, lookup = dns.lookup) {
    async function response(value, options, redirects = 0, authenticated = true) {
        const url = parseUrl(value), hostname = url.hostname.replace(/^\[|\]$/g, '');
        const headers = { 'User-Agent': 'MeshCentral-AgentBuilds', Accept: options.json ? 'application/vnd.github+json' : 'application/octet-stream', 'Accept-Encoding': 'identity' };
        if (url.hostname === 'api.github.com') {
            headers['X-GitHub-Api-Version'] = '2022-11-28';
            if (/\/actions\/artifacts\/\d+\/zip$/.test(url.pathname)) headers.Accept = 'application/vnd.github+json';
            if (options.token && authenticated) headers.Authorization = 'Bearer ' + options.token;
        }
        const res = await new Promise((resolve, reject) => {
            let timer;
            const request = transport.get(url, { headers, agent: false, signal: options.signal, lookup: function (host, settings, callback) {
                lookup(host, { all: true, verbatim: true }, (err, addresses) => {
                    if (err || !addresses || !addresses.length) return callback(new Error('Unable to resolve the download host.'));
                    if (addresses.some(x => !publicAddress(x.address))) return callback(new Error('Downloads from private or reserved addresses are not allowed.'));
                    // Return the checked address to the socket so a second lookup cannot change the destination.
                    callback(null, settings.all ? [addresses[0]] : addresses[0].address, addresses[0].family);
                });
            } }, res => { clearTimeout(timer); resolve(res); });
            timer = setTimeout(() => request.destroy(new Error('Download timed out.')), 20000);
            request.setTimeout(20000, () => request.destroy(new Error('Download timed out.')));
            request.on('error', err => { clearTimeout(timer); reject(err.name === 'AbortError' ? new Error('Import cancelled or timed out.') : new Error(/private or reserved|resolve the download|timed out/.test(err.message) ? err.message : 'Unable to download from this host.')); });
        });
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.destroy();
            if (redirects >= 5 || options.json) throw new Error('Too many redirects or an unexpected API redirect.');
            const next = parseUrl(new URL(res.headers.location || '', url).href);
            return response(next.href, options, redirects + 1, authenticated && next.origin === url.origin);
        }
        if (res.statusCode !== 200) {
            res.destroy();
            if (res.statusCode === 401 || res.statusCode === 403) throw new Error('Download denied or API rate limit reached. Check the GitHub token and repository read permissions.');
            if (res.statusCode === 404) throw new Error('File or GitHub resource not found, or the token cannot access it.');
            if (res.statusCode === 410) throw new Error('This GitHub artifact has expired. Select a newer build.');
            throw new Error('Download failed (HTTP ' + res.statusCode + ').');
        }
        if ((res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length']) > options.limit) {
            res.destroy(); throw new Error('Download exceeds the size limit or uses unsupported HTTP compression.');
        }
        return { res, url: sourceUrl(url.href) };
    }
    async function download(url, filename, options) {
        const { res, url: finalUrl } = await response(url, options), hash = crypto.createHash('sha256');
        let size = 0;
        const meter = new Transform({ transform(chunk, encoding, callback) {
            size += chunk.length;
            if (size > options.limit) return callback(new Error('Download exceeds the size limit.'));
            hash.update(chunk);
            if (options.progress) options.progress(size, Number(res.headers['content-length']) || null);
            callback(null, chunk);
        } });
        await pipeline(res, meter, fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }), { signal: options.signal });
        const sha256 = hash.digest('hex');
        if (options.sha256 && sha256 !== options.sha256) throw new Error('The downloaded SHA256 does not match the expected digest.');
        return { url: sourceUrl(url), finalUrl, size, sha256, digestVerified: !!options.sha256 };
    }
    async function json(url, token, signal) {
        const { res } = await response(url, { json: true, token, signal, limit: 4 * 1024 * 1024 });
        const chunks = []; let length = 0;
        try {
            for await (const chunk of res) {
                length += chunk.length;
                if (length > 4 * 1024 * 1024) throw new Error('GitHub response exceeds the size limit.');
                chunks.push(chunk);
            }
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (ex) { res.destroy(); throw new Error('Unable to read the GitHub response.'); }
    }
    return { download, json };
};
