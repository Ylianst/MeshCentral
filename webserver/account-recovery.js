/**
* @description Account recovery request handling
* @license Apache-2.0
*/

'use strict';

module.exports.createAccountRecovery = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkEmail = options.checkEmail;
    const getQueryPortion = options.getQueryPortion;
    const handleRootRequestEx = options.handleRootRequestEx;
    const checkUserOneTimePasswordRequired = options.checkUserOneTimePasswordRequired;
    const checkUserOneTimePassword = options.checkUserOneTimePassword;
    const getRandomSixDigitInteger = options.getRandomSixDigitInteger;
    const now = options.now || Date.now;
    const schedule = options.schedule || setTimeout;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { handleRootRequestEx(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function sendRecoveryMail(req, res, domain, user, index, direct) {
        if (domain.mailserver != null) {
            domain.mailserver.sendAccountResetMail(domain, user.name, user._id, user.email, state.getLanguageCodes(req), req.query.key);
            if (index == 0) {
                parent.debug('web', 'handleResetAccountRequest: Hold on, reset mail sent.');
                req.session.loginmode = 1;
                req.session.messageid = 1;
                completeRequest(req, res, domain, direct);
            }
        } else if (index == 0) {
            parent.debug('web', 'handleResetAccountRequest: Unable to sent email.');
            req.session.loginmode = 3;
            req.session.messageid = 109;
            completeRequest(req, res, domain, direct);
        }
    }

    function handleInvalidSecondFactor(req, res, domain, user, email, index, direct) {
        if (index != 0) { return; }
        if (state.checkAllow2Fa(req) == false) {
            schedule(function () {
                req.session.messageid = 114;
                completeRequest(req, res, domain, direct);
            }, 2000 + (state.crypto.randomBytes(2).readUInt16BE(0) % 4095));
            return;
        }

        parent.debug('web', 'handleResetAccountRequest: Invalid 2FA token, try again');
        if ((req.body.token != null) || (req.body.hwtoken != null)) {
            const sms2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.sms2factor != false)) && (parent.smsserver != null) && (user.phone != null));
            const msg2fa = (((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.msg2factor != false)) && (parent.msgserver != null) && (parent.msgserver.providers != 0) && (user.msghandle != null));
            if ((req.body.hwtoken == '**sms**') && sms2fa) {
                user.otpsms = { k: state.common.zeroPad(getRandomSixDigitInteger(), 6), d: now() };
                state.db.SetUser(user);
                parent.debug('web', 'Sending 2FA SMS for password recovery to: ' + user.phone);
                parent.smsserver.sendToken(domain, user.phone, user.otpsms.k, state.getLanguageCodes(req));
                req.session.messageid = 4;
            } else if ((req.body.hwtoken == '**msg**') && msg2fa) {
                user.otpmsg = { k: state.common.zeroPad(getRandomSixDigitInteger(), 6), d: now() };
                state.db.SetUser(user);
                parent.debug('web', 'Sending 2FA message for password recovery to: ' + user.msghandle);
                parent.msgserver.sendToken(domain, user.msghandle, user.otpmsg.k, state.getLanguageCodes(req));
                req.session.messageid = 6;
            } else {
                req.session.messageid = 108;
                const ua = state.getUserAgentInfo(req);
                state.parent.DispatchEvent(['*', 'server-users', user._id], state, { action: 'authfail', username: user.name, userid: user._id, domain: domain.id, msg: 'User login attempt with incorrect 2nd factor from ' + req.clientIp, msgid: 108, msgArgs: [req.clientIp, ua.browserStr, ua.osStr] });
                state.setbad2Fa(req);
            }
        }
        req.session.loginmode = 5;
        req.session.temail = email;
        completeRequest(req, res, domain, direct);
    }

    function handleResetAccountRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return; }
        const allowAccountReset = ((typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false));
        if ((allowAccountReset === false) || (domain.auth == 'sspi') || (domain.auth == 'ldap') || (state.args.lanonly == true) || (state.parent.certificates.CommonName == null) || (state.parent.certificates.CommonName.indexOf('.') == -1)) { parent.debug('web', 'handleResetAccountRequest: check failed'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        if (req.body.email) { req.body.email = req.body.email.toLowerCase(); }
        var email = req.body.email;
        if ((email == null) || (email == '')) { email = req.session.temail; }
        if (!email || (checkEmail(email) == false)) {
            parent.debug('web', 'handleResetAccountRequest: Invalid email');
            req.session.loginmode = 3;
            req.session.messageid = 106;
            completeRequest(req, res, domain, direct);
            return;
        }

        state.db.GetUserWithVerifiedEmail(domain.id, email, function (err, docs) {
            var cleanDocs = [];
            if ((err == null) && (docs.length > 0)) {
                for (var i in docs) {
                    const user = docs[i];
                    const locked = ((user.siteadmin != null) && (user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0));
                    const specialAccount = user._id.split('/')[2].startsWith('~');
                    if ((specialAccount == false) && (locked == false)) { cleanDocs.push(user); }
                }
            }
            docs = cleanDocs;

            if ((err != null) || (docs.length == 0)) {
                parent.debug('web', 'handleResetAccountRequest: Account not found');
                req.session.loginmode = 3;
                req.session.messageid = 1;
                completeRequest(req, res, domain, direct);
                return;
            }

            for (let i in docs) {
                const user = docs[i];
                if (checkUserOneTimePasswordRequired(domain, user, req) == true) {
                    checkUserOneTimePassword(req, domain, user, req.body.token, req.body.hwtoken, function (result) {
                        if (result == false) {
                            handleInvalidSecondFactor(req, res, domain, user, email, i, direct);
                        } else {
                            delete req.session.temail;
                            sendRecoveryMail(req, res, domain, user, i, direct);
                        }
                    });
                } else {
                    sendRecoveryMail(req, res, domain, user, i, direct);
                }
            }
        });
    }

    return { handleResetAccountRequest: handleResetAccountRequest, sendRecoveryMail: sendRecoveryMail, handleInvalidSecondFactor: handleInvalidSecondFactor };
};
