// Download a software package from the MeshCentral server to a local file and check its SHA384 hash.
// Used by the Software tab install features (win-msi, linux-software). Only the server the agent is
// connected to is trusted: the TLS certificate must be the control channel certificate, or the hash the
// server gave in the request.
//
// download({ url, hash, path, servertlshash }) resolves with path once the file is fully written and the hash matched.
// On any failure the partial file is removed and the promise is rejected.

var promise = require('promise');
var _requests = {}; // Keep references on active downloads
var _counter = 0;

function removeFile(path) { try { require('fs').unlinkSync(path); } catch (e) { } }

function download(options) {
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    if ((options == null) || (typeof options.url != 'string') || (typeof options.hash != 'string') || (typeof options.path != 'string')) { ret._rej(new Error('Invalid arguments')); return ret; }
    var id = ++_counter, finished = false;

    function finish(err) {
        if (finished) return;
        finished = true;
        delete _requests[id];
        if (err) { removeFile(options.path); ret._rej(err); } else { ret._res(options.path); }
    }

    try {
        var opts = require('http').parseUri(options.url);
        // MeshCentral servers usually have self-signed certificates, so CA validation can't be used. Instead the certificate
        // is pinned below: it must be the one the agent control channel already trusts, or match the hash sent by the server,
        // otherwise the connection fails. This is the same pattern meshcore.js uses for core updates and batch file uploads.
        opts.rejectUnauthorized = false;
        opts.checkServerIdentity = function checkServerIdentity(certs) {
            // Accept the server only if it presents the certificate used by the agent control channel
            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.digest == certs[0].digest) return; } catch (ex) { }
            try { if (require('MeshAgent').ServerInfo.ControlChannelCertificate.fingerprint == certs[0].fingerprint) return; } catch (ex) { }
            if ((typeof options.servertlshash == 'string') && (certs[0].digest != null) && (options.servertlshash.toLowerCase() == certs[0].digest.split(':').join('').toLowerCase())) return;
            throw new Error('BadCert');
        }
        var req = require('https').get(opts);
        _requests[id] = req;
        req.on('error', function (e) { finish(new Error('Download failed: ' + e)); });
        req.on('response', function (res) {
            if (res.statusCode != 200) { finish(new Error('Download failed, HTTP ' + res.statusCode)); return; }
            var hash = null, closed = false;
            var check = function () {
                if ((hash == null) || (closed == false) || finished) return;
                if (hash != options.hash.toLowerCase()) { finish(new Error('Downloaded package failed the hash check')); return; }
                finish(null);
            };
            try {
                var file = require('fs').createWriteStream(options.path, { flags: 'wb' });
                var hasher = require('SHA384Stream').create();
                hasher.on('hash', function (h) { hash = h.toString('hex').toLowerCase(); check(); });
                file.on('close', function () { closed = true; check(); });
                res.pipe(file);
                res.pipe(hasher);
            } catch (ex) { finish(ex); }
        });
    } catch (ex) { finish(ex); }
    return ret;
}

module.exports = { download: download, removeFile: removeFile };
