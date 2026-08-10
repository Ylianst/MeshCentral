/**
* @description WebSocket session and inner-server authentication flows
* @license Apache-2.0
*/

'use strict';

module.exports.createWebSocketAuth = function (options) {
    const obj = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const checkUserIpAddress = options.checkUserIpAddress;
    const SITERIGHT_NOMESHCMD = options.noMeshCommandRight;
    const cleanRemoteAddr = options.cleanRemoteAddr;
    const getRandomEightDigitInteger = options.getRandomEightDigitInteger;
    const getRandomSixDigitInteger = options.getRandomSixDigitInteger;
    const checkUserOneTimePasswordSkip = options.checkUserOneTimePasswordSkip;
    const checkUserOneTimePasswordRequired = options.checkUserOneTimePasswordRequired;
    const checkUserOneTimePassword = options.checkUserOneTimePassword;
    const setSessionRandom = options.setSessionRandom;

    function PerformWSSessionInnerAuth(ws, req, domain, func) {
        // When data is received from the web socket
        ws.on('message', function (data) {
            var command;
            try { command = JSON.parse(data.toString('utf8')); } catch (e) { return; }
            if (obj.common.validateString(command.action, 3, 32) == false) return; // Action must be a string between 3 and 32 chars

            switch (command.action) {
                case 'serverAuth': { // This command is used to perform server "inner" authentication.
                    // Check the client nonce and TLS hash
                    if ((obj.common.validateString(command.cnonce, 1, 256) == false) || (obj.common.validateString(command.tlshash, 1, 512) == false)) {
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'badargs' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                        break;
                    }

                    // Check that the TLS hash is an acceptable one.
                    var h = Buffer.from(command.tlshash, 'hex').toString('binary');
                    if ((obj.webCertificateHashs[domain.id] != h) && (obj.webCertificateFullHashs[domain.id] != h) && (obj.defaultWebCertificateHash != h) && (obj.defaultWebCertificateFullHash != h)) {
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'badtlscert' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                        return;
                    }

                    // TLS hash check is a success, sign the request.
                    // Perform the hash signature using the server agent certificate
                    var nonce = obj.crypto.randomBytes(48);
                    var signData = Buffer.from(command.cnonce, 'base64').toString('binary') + h + nonce.toString('binary'); // Client Nonce + TLS Hash + Server Nonce
                    parent.certificateOperations.acceleratorPerformSignature(0, signData, null, function (tag, signature) {
                        // Send back our certificate + nonce + signature
                        ws.send(JSON.stringify({ 'action': 'serverAuth', 'cert': Buffer.from(obj.agentCertificateAsn1, 'binary').toString('base64'), 'nonce': nonce.toString('base64'), 'signature': Buffer.from(signature, 'binary').toString('base64') }));
                    });
                    break;
                }
                case 'userAuth': { // This command is used to perform user authentication.
                    // Check username and password authentication
                    if ((typeof command.username == 'string') && (typeof command.password == 'string')) {
                        obj.authenticate(Buffer.from(command.username, 'base64').toString(), Buffer.from(command.password, 'base64').toString(), domain, function (err, userid, passhint, loginOptions) {
                            if ((err != null) || (userid == null)) {
                                // Invalid authentication
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); } catch (ex) { }
                                try { ws.close(); } catch (ex) { }
                            } else {
                                var user = obj.users[userid];
                                if ((err == null) && (user)) {
                                    // Check if a 2nd factor is needed
                                    const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

                                    // See if we support two-factor trusted cookies
                                    var twoFactorCookieDays = 30;
                                    if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                                    // Check if two factor can be skipped
                                    const twoFactorSkip = checkUserOneTimePasswordSkip(domain, user, req, loginOptions);

                                    if ((twoFactorSkip == null) && (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true)) {
                                        // Figure out if email 2FA is allowed
                                        var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                        var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                        var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                                        //var push2fa = ((parent.firebase != null) && (user.otpdev != null));
                                        if ((typeof command.token != 'string') || (command.token == '**email**') || (command.token == '**sms**')/* || (command.token == '**push**')*/) {
                                            if ((command.token == '**email**') && (email2fa == true)) {
                                                // Cause a token to be sent to the user's registered email
                                                user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                                domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                                // Ask for a login token & confirm email was sent
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                            } else if ((command.token == '**sms**') && (sms2fa == true)) {
                                                // Cause a token to be sent to the user's phone number
                                                user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                                parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                                // Ask for a login token & confirm sms was sent
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                            } else if ((command.token == '**msg**') && (msg2fa == true)) {
                                                // Cause a token to be sent to the user's messenger account
                                                user.otpmsg = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                                obj.db.SetUser(user);
                                                parent.debug('web', 'Sending 2FA message to: ' + user.phone);
                                                parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, obj.getLanguageCodes(req));
                                                // Ask for a login token & confirm sms was sent
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, msg2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                                /*
                                            } else if ((command.token == '**push**') && (push2fa == true)) {
                                                // Cause push notification to device
                                                const code = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                                                const authCookie = parent.encodeCookie({ a: 'checkAuth', c: code, u: user._id, n: user.otpdev });
                                                var payload = { notification: { title: "MeshCentral", body: user.name + " authentication" }, data: { url: '2fa://auth?code=' + code + '&c=' + authCookie } };
                                                var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
                                                parent.firebase.sendToDevice(user.otpdev, payload, options, function (id, err, errdesc) {
                                                    if (err == null) { parent.debug('email', 'Successfully auth check send push message to device'); } else { parent.debug('email', 'Failed auth check push message to device, error: ' + errdesc); }
                                                });
                                                */
                                            } else {
                                                // Ask for a login token
                                                parent.debug('web', 'Asking for login token');
                                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (ex) { console.log(ex); }
                                            }
                                        } else {
                                            checkUserOneTimePassword(req, domain, user, command.token, null, function (result, authData) {
                                                if (result == false) {
                                                    // Failed, ask for a login token again
                                                    parent.debug('web', 'Invalid login token, asking again');
                                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                                } else {
                                                    // We are authenticated with 2nd factor.
                                                    // Check email verification
                                                    if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                                        parent.debug('web', 'Invalid login, asking for email validation');
                                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                                    } else {
                                                        // We are authenticated
                                                        ws._socket.pause();
                                                        ws.removeAllListeners(['message', 'close', 'error']);
                                                        func(ws, req, domain, user, authData);
                                                    }
                                                }
                                            });
                                        }
                                    } else {
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                            var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                        } else {
                                            // We are authenticated
                                            ws._socket.pause();
                                            ws.removeAllListeners(['message', 'close', 'error']);
                                            func(ws, req, domain, user, twoFactorSkip);
                                        }
                                    }
                                }
                            }
                        });
                    } else {
                        // Invalid authentication
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); } catch (ex) { }
                        try { ws.close(); } catch (ex) { }
                    }
                    break;
                }
            }

        });

        // If error, do nothing
        ws.on('error', function (err) { try { ws.close(); } catch (e) { console.log(e); } });

        // If the web socket is closed
        ws.on('close', function (req) { try { ws.close(); } catch (e) { console.log(e); } });

        // Resume the socket to perform inner authentication
        try { ws._socket.resume(); } catch (ex) { }
    }

    // Authenticates a session and forwards
    function PerformWSSessionAuth(ws, req, noAuthOk, func) {
        // Check if the session expired
        if ((req.session != null) && (typeof req.session.expire == 'number') && (req.session.expire <= Date.now())) {
            parent.debug('web', 'WSERROR: Session expired.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'expired', msg: 'expired-1' })); ws.close(); } catch (e) { } return;
        }

        // Check if this is a banned ip address
        if (obj.checkAllowLogin(req) == false) { parent.debug('web', 'WSERROR: Banned connection.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'banned', msg: 'banned-1' })); ws.close(); } catch (e) { } return; }
        try {
            // Hold this websocket until we are ready.
            ws._socket.pause();

            // Check IP filtering and domain
            var domain = null;
            if (noAuthOk == true) {
                domain = getDomain(req);
                if (domain == null) { parent.debug('web', 'WSERROR: Got no domain, no auth ok.'); try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-1' })); ws.close(); return; } catch (e) { } return; }
            } else {
                // If authentication is required, enforce IP address filtering.
                domain = checkUserIpAddress(ws, req);
                if (domain == null) { parent.debug('web', 'WSERROR: Got no domain, user auth required.'); return; }
            }

            // Check if inner authentication is requested
            if (req.headers['x-meshauth'] === '*') { func(ws, req, domain, null); return; }

            const emailcheck = ((domain.mailserver != null) && (obj.parent.certificates.CommonName != null) && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap'))

            // A web socket session can be authenticated in many ways (Default user, session, user/pass and cookie). Check authentication here.
            if ((req.query.user != null) && (req.query.pass != null)) {
                // A user/pass is provided in URL arguments
                obj.authenticate(req.query.user, req.query.pass, domain, function (err, userid, passhint, loginOptions) {
                    var user = obj.users[userid];

                    // Check if user as the "notools" site right. If so, deny this connection as tools are not allowed to connect.
                    if ((user != null) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & SITERIGHT_NOMESHCMD)) {
                        // No tools allowed, close the websocket connection
                        parent.debug('web', 'ERR: Websocket no tools allowed');
                        try { ws.send(JSON.stringify({ action: 'close', cause: 'notools', msg: 'notools' })); ws.close(); } catch (e) { }
                        return;
                    }

                    // See if we support two-factor trusted cookies
                    var twoFactorCookieDays = 30;
                    if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                    if ((err == null) && (user)) {
                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true) {
                            // Figure out if email 2FA is allowed
                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                            var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                            //var push2fa = ((parent.firebase != null) && (user.otpdev != null));
                            if ((typeof req.query.token != 'string') || (req.query.token == '**email**') || (req.query.token == '**sms**')/* || (req.query.token == '**push**')*/) {
                                if ((req.query.token == '**email**') && (email2fa == true)) {
                                    // Cause a token to be sent to the user's registered email
                                    user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                    obj.db.SetUser(user);
                                    parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                    domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                    // Ask for a login token & confirm email was sent
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                } else if ((req.query.token == '**sms**') && (sms2fa == true)) {
                                    // Cause a token to be sent to the user's phone number
                                    user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                    obj.db.SetUser(user);
                                    parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                    parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                    // Ask for a login token & confirm sms was sent
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                } else if ((req.query.token == '**msg**') && (msg2fa == true)) {
                                    // Cause a token to be sent to the user's messenger account
                                    user.otpmsg = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                    obj.db.SetUser(user);
                                    parent.debug('web', 'Sending 2FA message to: ' + user.msghandle);
                                    parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, obj.getLanguageCodes(req));
                                    // Ask for a login token & confirm message was sent
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, msg2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                    /*
                                } else if ((command.token == '**push**') && (push2fa == true)) {
                                    // Cause push notification to device
                                    const code = Buffer.from(obj.common.zeroPad(getRandomSixDigitInteger(), 6)).toString('base64');
                                    const authCookie = parent.encodeCookie({ a: 'checkAuth', c: code, u: user._id, n: user.otpdev });
                                    var payload = { notification: { title: "MeshCentral", body: user.name + " authentication" }, data: { url: '2fa://auth?code=' + code + '&c=' + authCookie } };
                                    var options = { priority: 'High', timeToLive: 60 }; // TTL: 1 minute
                                    parent.firebase.sendToDevice(user.otpdev, payload, options, function (id, err, errdesc) {
                                        if (err == null) { parent.debug('email', 'Successfully auth check send push message to device'); } else { parent.debug('email', 'Failed auth check push message to device, error: ' + errdesc); }
                                    });
                                    */
                                } else {
                                    // Ask for a login token
                                    parent.debug('web', 'Asking for login token');
                                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                }
                            } else {
                                checkUserOneTimePassword(req, domain, user, req.query.token, null, function (result, authData) {
                                    if (result == false) {
                                        // Failed, ask for a login token again
                                        parent.debug('web', 'Invalid login token, asking again');
                                        try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true })); ws.close(); } catch (e) { }
                                        } else {
                                            req.session.userid = user._id;
                                            req.session.ip = req.clientIp;
                                            setSessionRandom(req);
                                            func(ws, req, domain, user, null, authData);
                                        }
                                    }
                                });
                            }
                        } else {
                            // Check email verification
                            if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                parent.debug('web', 'Invalid login, asking for email validation');
                                var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                                var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                                var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, email2fasent: true })); ws.close(); } catch (e) { }
                            } else {
                                // We are authenticated
                                req.session.userid = user._id;
                                req.session.ip = req.clientIp;
                                setSessionRandom(req);
                                func(ws, req, domain, user);
                            }
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            parent.debug('web', 'ERR: Websocket bad user/pass auth');
                            //obj.parent.DispatchEvent(['*', 'server-users', 'user/' + domain.id + '/' + obj.args.user.toLowerCase()], obj, { action: 'authfail', userid: 'user/' + domain.id + '/' + obj.args.user.toLowerCase(), username: obj.args.user, domain: domain.id, msg: 'Invalid user login attempt from ' + req.clientIp });
                            //obj.setbadLogin(req);
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2a' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            }

            if ((req.query.auth != null) && (req.query.auth != '')) {
                // This is a encrypted cookie authentication
                var cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey, 60); // Cookie with 1 hour timeout
                if ((cookie == null) && (obj.parent.multiServer != null)) { cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.serverKey, 60); } // Try the server key
                if ((cookie != null) && (cookie.ip != null) && !checkCookieIp(cookie.ip, req.clientIp)) { // If the cookie if binded to an IP address, check here.
                    parent.debug('web', 'ERR: Invalid cookie IP address, got \"' + cookie.ip + '\", expected \"' + cleanRemoteAddr(req.clientIp) + '\".');
                    cookie = null;
                }
                if ((cookie != null) && (cookie.userid != null) && (obj.users[cookie.userid]) && (cookie.domainid == domain.id) && (cookie.userid.split('/')[1] == domain.id)) {
                    // Valid cookie, we are authenticated. Cookie of format { userid: 'user//name', domain: '' }
                    func(ws, req, domain, obj.users[cookie.userid], cookie);
                    return;
                } else if ((cookie != null) && (cookie.a === 3) && (typeof cookie.u == 'string') && (obj.users[cookie.u]) && (cookie.u.split('/')[1] == domain.id)) {
                    // Valid cookie, we are authenticated. Cookie of format { u: 'user//name', a: 3 }
                    func(ws, req, domain, obj.users[cookie.u], cookie);
                    return;
                } else if ((cookie != null) && (cookie.nouser === 1)) {
                    // This is a valid cookie, but no user. This is used for agent self-sharing.
                    func(ws, req, domain, null, cookie);
                    return;
                } /*else {
                    // This is a bad cookie, keep going anyway, maybe we have a active session that will save us.
                    if ((cookie != null) && (cookie.domainid != domain.id)) { parent.debug('web', 'ERR: Invalid domain, got \"' + cookie.domainid + '\", expected \"' + domain.id + '\".'); }
                    parent.debug('web', 'ERR: Websocket bad cookie auth (Cookie:' + (cookie != null) + '): ' + req.query.auth);
                    try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2b' })); ws.close(); } catch (e) { }
                    return;
                }
                */
            }

            if (req.headers['x-meshauth'] != null) {
                // This is authentication using a custom HTTP header
                var s = req.headers['x-meshauth'].split(',');
                for (var i in s) { s[i] = Buffer.from(s[i], 'base64').toString(); }
                if ((s.length < 2) || (s.length > 3)) { try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2c' })); ws.close(); } catch (e) { } return; }
                obj.authenticate(s[0], s[1], domain, function (err, userid, passhint, loginOptions) {
                    var user = obj.users[userid];      
                    if ((err == null) && (user)) {
                        // Check if user as the "notools" site right. If so, deny this connection as tools are not allowed to connect.
                        if ((user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & SITERIGHT_NOMESHCMD)) {
                            // No tools allowed, close the websocket connection
                            parent.debug('web', 'ERR: Websocket no tools allowed');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'notools', msg: 'notools' })); ws.close(); } catch (e) { }
                            return;
                        }

                        // Check if a 2nd factor is needed
                        if (checkUserOneTimePasswordRequired(domain, user, req, loginOptions) == true) {

                            // See if we support two-factor trusted cookies
                            var twoFactorCookieDays = 30;
                            if (typeof domain.twofactorcookiedurationdays == 'number') { twoFactorCookieDays = domain.twofactorcookiedurationdays; }

                            // Figure out if email 2FA is allowed
                            var email2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.email2factor != false)) && (domain.mailserver != null) && (user.otpekey != null));
                            var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
                            var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
                            if (s.length != 3) {
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                            } else {
                                checkUserOneTimePassword(req, domain, user, s[2], null, function (result, authData) {
                                    if (result == false) {
                                        if ((s[2] == '**email**') && (email2fa == true)) {
                                            // Cause a token to be sent to the user's registered email
                                            user.otpekey = { k: obj.common.zeroPad(getRandomEightDigitInteger(), 8), d: Date.now() };
                                            obj.db.SetUser(user);
                                            parent.debug('web', 'Sending 2FA email to: ' + user.email);
                                            domain.mailserver.sendAccountLoginMail(domain, user.email, user.otpekey.k, obj.getLanguageCodes(req), req.query.key);
                                            // Ask for a login token & confirm email was sent
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else if ((s[2] == '**sms**') && (sms2fa == true)) {
                                            // Cause a token to be sent to the user's phone number
                                            user.otpsms = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                            obj.db.SetUser(user);
                                            parent.debug('web', 'Sending 2FA SMS to: ' + user.phone);
                                            parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, obj.getLanguageCodes(req));
                                            // Ask for a login token & confirm sms was sent
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', sms2fa: sms2fa, sms2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else if ((s[2] == '**msg**') && (msg2fa == true)) {
                                            // Cause a token to be sent to the user's phone number
                                            user.otpmsg = { k: obj.common.zeroPad(getRandomSixDigitInteger(), 6), d: Date.now() };
                                            obj.db.SetUser(user);
                                            parent.debug('web', 'Sending 2FA message to: ' + user.msghandle);
                                            parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, obj.getLanguageCodes(req));
                                            // Ask for a login token & confirm sms was sent
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', msg2fa: msg2fa, msg2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else {
                                            // Ask for a login token
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa: email2fa, sms2fa: sms2fa, msg2fa: msg2fa, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        }
                                    } else {
                                        // We are authenticated with 2nd factor.
                                        // Check email verification
                                        if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                            parent.debug('web', 'Invalid login, asking for email validation');
                                            try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, email2fasent: true, twoFactorCookieDays: twoFactorCookieDays })); ws.close(); } catch (e) { }
                                        } else {
                                            func(ws, req, domain, user, null, authData);
                                        }
                                    }
                                });
                            }
                        } else {
                            // We are authenticated
                            // Check email verification
                            if (emailcheck && (user.email != null) && (!(user._id.split('/')[2].startsWith('~'))) && (user.emailVerified !== true)) {
                                parent.debug('web', 'Invalid login, asking for email validation');
                                try { ws.send(JSON.stringify({ action: 'close', cause: 'emailvalidation', msg: 'emailvalidationrequired', email2fa: email2fa, email2fasent: true })); ws.close(); } catch (e) { }
                            } else {
                                req.session.userid = user._id;
                                req.session.ip = req.clientIp;
                                setSessionRandom(req);
                                func(ws, req, domain, user);
                            }
                        }
                    } else {
                        // Failed to authenticate, see if a default user is active
                        if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                            // A default user is active
                            func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                        } else {
                            // If not authenticated, close the websocket connection
                            parent.debug('web', 'ERR: Websocket bad user/pass auth');
                            try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-2d' })); ws.close(); } catch (e) { }
                        }
                    }
                });
                return;
            }

            if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) {
                // A default user is active
                func(ws, req, domain, obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]);
                return;
            }

            if (req.session && (req.session.userid != null) && (req.session.userid.split('/')[1] == domain.id) && (obj.users[req.session.userid])) {
                // This user is logged in using the ExpressJS session
                func(ws, req, domain, obj.users[req.session.userid]);
                return;
            }

            if (noAuthOk != true) {
                // If not authenticated, close the websocket connection
                parent.debug('web', 'ERR: Websocket no auth');
                try { ws.send(JSON.stringify({ action: 'close', cause: 'noauth', msg: 'noauth-4' })); ws.close(); } catch (e) { }
            } else {
                // Continue this session without user authentication,
                // this is expected if the agent is connecting for a tunnel.
                func(ws, req, domain, null);
            }
        } catch (e) { console.log(e); }
    }

    /*
        obj.wssessions = {};         // UserId --> Array Of Sessions
        obj.wssessions2 = {};        // "UserId + SessionRnd" --> Session  (Note that the SessionId is the UserId + / + SessionRnd)
        obj.wsPeerSessions = {};     // ServerId --> Array Of "UserId + SessionRnd"
        obj.wsPeerSessions2 = {};    // "UserId + SessionRnd" --> ServerId
        obj.wsPeerSessions3 = {};    // ServerId --> UserId --> [ SessionId ]
    */

    return { PerformWSSessionInnerAuth: PerformWSSessionInnerAuth, PerformWSSessionAuth: PerformWSSessionAuth };
};
