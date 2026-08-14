/**
* @description Authorized server backup and restore handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createServerBackups = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkCookieIp = options.checkCookieIp;
    const resolveSafeUploadTempPath = options.resolveSafeUploadTempPath;
    const multiparty = options.multiparty || require('multiparty');
    const now = options.now || Date.now;
    const wait = options.wait || function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); };

    async function handleBackupRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if ((req.session == null) || !req.session.userid) { res.sendStatus(401); return; }
        if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver.backup !== true))) { res.sendStatus(401); return; }
        const user = state.users[req.session.userid];
        if ((user == null) || ((user.siteadmin & 1) == 0)) { res.sendStatus(401); return; }
        if (parent.config.settings.autobackup.backupintervalhours == -1) { res.status(403).send('Backup disabled.'); return; }
        state.db.performBackup();
        const backupStart = now();
        while (state.db.performingBackup && ((now() - backupStart) < 120000)) await wait(2000);
        if (state.fs.existsSync(state.db.newAutoBackupFile) && (state.db.performingBackup == false)) {
            res.setHeader('Content-Type', 'application/x-zip-compressed');
            res.download(state.db.newAutoBackupFile);
        } else {
            parent.addServerWarning('handleBackupRequest: Backup error', true);
            res.status(500).send('Backup error.');
        }
    }

    function handleRestoreRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if ((domain.myserver === false) || ((domain.myserver != null) && (domain.myserver.restore !== true))) { res.sendStatus(401); return; }
        var userId = ((req.session != null) && (typeof req.session.userid == 'string')) ? req.session.userid : null;
        const form = new multiparty.Form();
        form.parse(req, function (err, fields, files) {
            if (err) { res.sendStatus(400); return; }
            if ((fields != null) && Array.isArray(fields.auth) && (fields.auth.length == 1) && (typeof fields.auth[0] == 'string')) {
                var loginCookie = parent.decodeCookie(fields.auth[0], parent.loginCookieEncryptionKey, 60);
                if ((loginCookie != null) && (loginCookie.ip != null) && !checkCookieIp(loginCookie.ip, req.clientIp)) loginCookie = null;
                if ((loginCookie != null) && (domain.id == loginCookie.domainid)) userId = loginCookie.userid;
            }
            if (userId == null) { res.sendStatus(401); return; }
            const user = state.users[userId];
            if ((user == null) || ((user.siteadmin & 4) == 0)) { res.sendStatus(401); return; }
            const restorePath = ((files != null) && Array.isArray(files.datafile) && (files.datafile.length == 1) && (files.datafile[0] != null)) ? resolveSafeUploadTempPath(files.datafile[0].path) : null;
            if (restorePath == null) { res.sendStatus(400); return; }
            res.set('Content-Type', 'text/html');
            const rootUrl = req.protocol + '://' + req.get('host') + (req.query.key ? '/?key=' + req.query.key : '/');
            res.end('<html><body><script>setTimeout(function(){window.location.replace("' + rootUrl + '");}, 10000);</script>Server will be restarted, <a href="' + domain.url + '">click here to login</a>.</body></html>');
            parent.Stop(restorePath);
        });
    }

    return { handleBackupRequest: handleBackupRequest, handleRestoreRequest: handleRestoreRequest };
};
