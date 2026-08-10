/**
* @description Login-page two-factor option calculation
* @license Apache-2.0
*/

'use strict';

module.exports.getLoginTwoFactorOptions = function (request, domain, hardwareKeyChallenge, loginMode, parent) {
    var hardwareState = null;
    if (hardwareKeyChallenge && request.session) {
        const data = parent.decryptSessionData(request.session.e);
        hardwareState = parent.encodeCookie({ u: data.tuser, p: data.tpass, c: data.u2f }, parent.loginCookieEncryptionKey);
    }

    var email = (loginMode != 5) && (domain.mailserver != null) && (request.session != null) && ((request.session.temail === 1) || (typeof request.session.temail == 'string'));
    if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.email2factor == false)) { email = false; }
    var duo = (request.session != null) && (request.session.tduo === 1);
    if (((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.duo2factor == false)) || (typeof domain.duo2factor != 'object')) { duo = false; }
    var sms = (parent.smsserver != null) && (request.session != null) && (request.session.tsms === 1);
    if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.sms2factor == false)) { sms = false; }
    var messaging = (parent.msgserver != null) && (request.session != null) && (request.session.tmsg === 1);
    if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.msg2factor == false)) { messaging = false; }
    var push = (parent.firebase != null) && (request.session != null) && (request.session.tpush === 1);
    if ((typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.push2factor == false)) { push = false; }

    var cookieDays = 30;
    if (typeof domain.twofactorcookiedurationdays == 'number') { cookieDays = domain.twofactorcookiedurationdays; }

    var timeout = 300000;
    if ((typeof domain.passwordrequirements == 'object') && (typeof domain.passwordrequirements.twofactortimeout == 'number')) { timeout = domain.passwordrequirements.twofactortimeout * 1000; }

    return {
        hardwareState: hardwareState,
        email: email,
        duo: duo,
        sms: sms,
        messaging: messaging,
        push: push,
        autoFido: (typeof domain.passwordrequirements == 'object') && (domain.passwordrequirements.autofido2fa == true),
        cookieDays: cookieDays,
        timeout: timeout
    };
};
