/**
* @description Shared two-factor authentication checks and hardware-key challenges
* @license Apache-2.0
*/

'use strict';

module.exports.createTwoFactorAuthentication = function (options) {
    const obj = options.state;
    const parent = options.parent;
    const args = options.args;
    const checkCookieIp = options.checkCookieIp;
    const loadModule = options.require || require;

    function checkUserOneTimePasswordSkip(domain, user, req, loginOptions) {
        if (parent.config.settings.no2factorauth == true) return null;

        // If this login occurred using a login token, no 2FA needed.
        if ((loginOptions != null) && (typeof loginOptions.tokenName === 'string')) { return { twoFactorType: 'tokenlogin' }; }

        // Check if we can skip 2nd factor auth because of the source IP address
        if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
            for (var i in domain.passwordrequirements.skip2factor) { if (loadModule('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) { return { twoFactorType: 'ipaddr' }; } }
        }

        // Check if a 2nd factor cookie is present
        if (typeof req.headers.cookie == 'string') {
            const cookies = req.headers.cookie.split('; ');
            for (var i in cookies) {
                if (cookies[i].startsWith('twofactor=')) {
                    var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(cookies[i].substring(10)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire field, assume 30 day timeout.
                    if ((twoFactorCookie != null) && ((twoFactorCookie.ip == null) || checkCookieIp(twoFactorCookie.ip, req.clientIp)) && (twoFactorCookie.userid == user._id)) { return { twoFactorType: 'cookie' }; }
                }
            }
        }

        return null;
    }

    // Return true if this user has 2-step auth active
    function checkUserOneTimePasswordRequired(domain, user, req, loginOptions) {
        // If this login occurred using a login token, no 2FA needed.
        if ((loginOptions != null) && (typeof loginOptions.tokenName === 'string')) { return false; }

        // Check if we can skip 2nd factor auth because of the source IP address
        if ((req != null) && (req.clientIp != null) && (domain.passwordrequirements != null) && (domain.passwordrequirements.skip2factor != null)) {
            for (var i in domain.passwordrequirements.skip2factor) { if (loadModule('ipcheck').match(req.clientIp, domain.passwordrequirements.skip2factor[i]) === true) return false; }
        }

        // Check if a 2nd factor cookie is present
        if (typeof req.headers.cookie == 'string') {
            const cookies = req.headers.cookie.split('; ');
            for (var i in cookies) {
                if (cookies[i].startsWith('twofactor=')) {
                    var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(cookies[i].substring(10)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire field, assume 30 day timeout.
                    if ((twoFactorCookie != null) && ((twoFactorCookie.ip == null) || checkCookieIp(twoFactorCookie.ip, req.clientIp)) && (twoFactorCookie.userid == user._id)) { return false; }
                }
            }
        }

        // See if SMS 2FA is available
        var sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));

        // See if Messenger 2FA is available
        var msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));

        // Check if a 2nd factor is present
        return ((parent.config.settings.no2factorauth !== true) && (msg2fa || sms2fa || (user.otpsecret != null) || ((user.email != null) && (user.emailVerified == true) && (domain.mailserver != null) && (user.otpekey != null)) || (user.otpduo != null) || ((user.otphkeys != null) && (user.otphkeys.length > 0))));
    }

    // Check the 2-step auth token
    function checkUserOneTimePassword(req, domain, user, token, hwtoken, func) {
        parent.debug('web', 'checkUserOneTimePassword()');
        const twoStepLoginSupported = ((domain.auth != 'sspi') && (obj.parent.certificates.CommonName.indexOf('.') != -1) && (obj.args.nousers !== true) && (parent.config.settings.no2factorauth !== true));
        if (twoStepLoginSupported == false) { parent.debug('web', 'checkUserOneTimePassword: not supported.'); func(true); return; };

        // Check if we can use OTP tokens with email
        var otpemail = (domain.mailserver != null);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.email2factor == false)) { otpemail = false; }
        var otpsms = (parent.smsserver != null);
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.sms2factor == false)) { otpsms = false; }
        var otpmsg = ((parent.msgserver != null) && (parent.msgserver.providers != 0));
        if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.msg2factor == false)) { otpmsg = false; }

        // Check 2FA login cookie
        if ((token != null) && (token.startsWith('cookie='))) {
            var twoFactorCookie = obj.parent.decodeCookie(decodeURIComponent(token.substring(7)), obj.parent.loginCookieEncryptionKey, (30 * 24 * 60)); // If the cookies does not have an expire field, assume 30 day timeout.
            if ((twoFactorCookie != null) && ((twoFactorCookie.ip == null) || checkCookieIp(twoFactorCookie.ip, req.clientIp)) && (twoFactorCookie.userid == user._id)) { func(true, { twoFactorType: 'cookie' }); return; }
        }

        // Check email key
        if ((otpemail) && (user.otpekey != null) && (user.otpekey.d != null) && (user.otpekey.k === token)) {
            var deltaTime = (Date.now() - user.otpekey.d);
            if ((deltaTime > 0) && (deltaTime < 300000)) { // Allow 5 minutes to use the email token (10000 * 60 * 5).
                user.otpekey = {};
                obj.db.SetUser(user);
                parent.debug('web', 'checkUserOneTimePassword: success (email).');
                func(true, { twoFactorType: 'email' });
                return;
            }
        }

        // Check SMS key
        if ((otpsms) && (user.phone != null) && (user.otpsms != null) && (user.otpsms.d != null) && (user.otpsms.k === token)) {
            var deltaTime = (Date.now() - user.otpsms.d);
            if ((deltaTime > 0) && (deltaTime < 300000)) { // Allow 5 minutes to use the SMS token (10000 * 60 * 5).
                delete user.otpsms;
                obj.db.SetUser(user);
                parent.debug('web', 'checkUserOneTimePassword: success (SMS).');
                func(true, { twoFactorType: 'sms' });
                return;
            }
        }

        // Check messenger key
        if ((otpmsg) && (user.msghandle != null) && (user.otpmsg != null) && (user.otpmsg.d != null) && (user.otpmsg.k === token)) {
            var deltaTime = (Date.now() - user.otpmsg.d);
            if ((deltaTime > 0) && (deltaTime < 300000)) { // Allow 5 minutes to use the Messenger token (10000 * 60 * 5).
                delete user.otpmsg;
                obj.db.SetUser(user);
                parent.debug('web', 'checkUserOneTimePassword: success (Messenger).');
                func(true, { twoFactorType: 'messenger' });
                return;
            }
        }

        // Check hardware key
        if (user.otphkeys && (user.otphkeys.length > 0) && (typeof (hwtoken) == 'string') && (hwtoken.length > 0)) {
            var authResponse = null;
            try { authResponse = JSON.parse(hwtoken); } catch (ex) { }
            if ((authResponse != null) && (authResponse.clientDataJSON)) {
                // Get all WebAuthn keys
                var webAuthnKeys = [];
                for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type == 3) { webAuthnKeys.push(user.otphkeys[i]); } }
                if (webAuthnKeys.length > 0) {
                    // Decode authentication response
                    var clientAssertionResponse = { response: {} };
                    clientAssertionResponse.id = authResponse.id;
                    clientAssertionResponse.rawId = Buffer.from(authResponse.id, 'base64');
                    clientAssertionResponse.response.authenticatorData = Buffer.from(authResponse.authenticatorData, 'base64');
                    clientAssertionResponse.response.clientDataJSON = Buffer.from(authResponse.clientDataJSON, 'base64');
                    clientAssertionResponse.response.signature = Buffer.from(authResponse.signature, 'base64');
                    clientAssertionResponse.response.userHandle = Buffer.from(authResponse.userHandle, 'base64');

                    // Look for the key with clientAssertionResponse.id
                    var webAuthnKey = null;
                    for (var i = 0; i < webAuthnKeys.length; i++) { if (webAuthnKeys[i].keyId == clientAssertionResponse.id) { webAuthnKey = webAuthnKeys[i]; } }

                    // If we found a valid key to use, let's validate the response
                    if (webAuthnKey != null) {
                        // Figure out the origin
                        var httpport = ((args.aliasport != null) ? args.aliasport : args.port);
                        var origin = 'https://' + (domain.dns ? domain.dns : parent.certificates.CommonName);
                        if (httpport != 443) { origin += ':' + httpport; }

                        var u2fchallenge = null;
                        if ((req.session != null) && (req.session.e != null)) { const sec = parent.decryptSessionData(req.session.e); if (sec != null) { u2fchallenge = sec.u2f; } }
                        var assertionExpectations = {
                            challenge: u2fchallenge,
                            origin: origin,
                            factor: 'either',
                            fmt: 'fido-u2f',
                            publicKey: webAuthnKey.publicKey,
                            prevCounter: webAuthnKey.counter,
                            userHandle: Buffer.from(user._id, 'binary').toString('base64')
                        };

                        var webauthnResponse = null;
                        try { webauthnResponse = obj.webauthn.verifyAuthenticatorAssertionResponse(clientAssertionResponse.response, assertionExpectations); } catch (ex) { parent.debug('web', 'checkUserOneTimePassword: exception ' + ex); console.log(ex); }
                        if ((webauthnResponse != null) && (webauthnResponse.verified === true)) {
                            // Update the hardware key counter and accept the 2nd factor
                            webAuthnKey.counter = webauthnResponse.counter;
                            obj.db.SetUser(user);
                            parent.debug('web', 'checkUserOneTimePassword: success (hardware).');
                            func(true, { twoFactorType: 'fido' });
                        } else {
                            parent.debug('web', 'checkUserOneTimePassword: fail (hardware).');
                            func(false);
                        }
                        return;
                    }
                }
            }
        }

        // Check Google Authenticator
        if (user.otpsecret && (typeof (token) == 'string') && (token.length == 6)){
            const otplib = loadModule('otplib');
            const verified = otplib.verifySync({ 
                epochTolerance: 60, 
                token: token, 
                secret: user.otpsecret,
                guardrails: otplib.createGuardrails({
                    MIN_SECRET_BYTES: 10, // https://github.com/yeojz/otplib/issues/671#issuecomment-4368647105
                })
            });
            if (verified.valid === true) {
                parent.debug('web', 'checkUserOneTimePassword: success (authenticator).');
                func(true, { twoFactorType: 'otp' });
                return;
            }
        };

        // Check written down keys
        if ((user.otpkeys != null) && (user.otpkeys.keys != null) && (typeof (token) == 'string') && (token.length == 8)) {
            var tokenNumber = parseInt(token);
            for (var i = 0; i < user.otpkeys.keys.length; i++) {
                if ((tokenNumber === user.otpkeys.keys[i].p) && (user.otpkeys.keys[i].u === true)) {
                    parent.debug('web', 'checkUserOneTimePassword: success (one-time).');
                    user.otpkeys.keys[i].u = false; func(true, { twoFactorType: 'backup' }); return;
                }
            }
        }

        // Check OTP hardware key (Yubikey OTP)
        if ((domain.yubikey != null) && (domain.yubikey.id != null) && (domain.yubikey.secret != null) && (user.otphkeys != null) && (user.otphkeys.length > 0) && (typeof (token) == 'string') && (token.length == 44)) {
            var keyId = token.substring(0, 12);

            // Find a matching OTP key
            var match = false;
            for (var i = 0; i < user.otphkeys.length; i++) { if ((user.otphkeys[i].type === 2) && (user.otphkeys[i].keyid === keyId)) { match = true; } }

            // If we have a match, check the OTP
            if (match === true) {
                var yub = loadModule('yub');
                yub.init(domain.yubikey.id, domain.yubikey.secret);
                yub.verify(token, function (err, results) {
                    if ((results != null) && (results.status == 'OK')) {
                        parent.debug('web', 'checkUserOneTimePassword: success (Yubikey).');
                        func(true, { twoFactorType: 'hwotp' });
                    } else {
                        parent.debug('web', 'checkUserOneTimePassword: fail (Yubikey).');
                        func(false);
                    }
                });
                return;
            }
        }

        parent.debug('web', 'checkUserOneTimePassword: fail (2).');
        func(false);
    }

    // Return a U2F hardware key challenge
    function getHardwareKeyChallenge(req, domain, user, func) {
        var sec = {};
        if (req.session == null) { req.session = {}; } else { try { sec = parent.decryptSessionData(req.session.e); } catch (ex) { } }

        if (user.otphkeys && (user.otphkeys.length > 0)) {
            // Get all WebAuthn keys
            var webAuthnKeys = [];
            for (var i = 0; i < user.otphkeys.length; i++) { if (user.otphkeys[i].type == 3) { webAuthnKeys.push(user.otphkeys[i]); } }
            if (webAuthnKeys.length > 0) {
                // Generate a Webauthn challenge, this is really easy, no need to call any modules to do this.
                var authnOptions = { type: 'webAuthn', keyIds: [], timeout: 60000, challenge: obj.crypto.randomBytes(64).toString('base64') };
                // userVerification: 'preferred' use security pin if possible (default), 'required' always use security pin, 'discouraged' do not use security pin.
                authnOptions.userVerification = (domain.passwordrequirements && domain.passwordrequirements.fidopininput) ? domain.passwordrequirements.fidopininput : 'preferred'; // Use the domain setting if it exists, otherwise use 'preferred'.{
                for (var i = 0; i < webAuthnKeys.length; i++) { authnOptions.keyIds.push(webAuthnKeys[i].keyId); }
                sec.u2f = authnOptions.challenge;
                req.session.e = parent.encryptSessionData(sec);
                parent.debug('web', 'getHardwareKeyChallenge: success');
                func(JSON.stringify(authnOptions));
                return;
            }
        }

        // Remove the challenge if present
        if (sec.u2f != null) { delete sec.u2f; req.session.e = parent.encryptSessionData(sec); }

        parent.debug('web', 'getHardwareKeyChallenge: fail');
        func('');
    }

    return {
        checkUserOneTimePasswordSkip: checkUserOneTimePasswordSkip,
        checkUserOneTimePasswordRequired: checkUserOneTimePasswordRequired,
        checkUserOneTimePassword: checkUserOneTimePassword,
        getHardwareKeyChallenge: getHardwareKeyChallenge
    };
};
