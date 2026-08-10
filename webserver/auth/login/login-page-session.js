/**
* @description Login-page transient session-state handling
* @license Apache-2.0
*/

'use strict';

module.exports.consumeLoginPageSession = function (request, domain, escapeHtml, uniqueArray) {
    var loginMode = 0;
    var passwordHint = null;
    var messageId = 0;
    if (request.session) {
        loginMode = request.session.loginmode;
        delete request.session.loginmode;
        messageId = request.session.messageid;
        if ((messageId == 5) || (loginMode == 7) || ((domain.passwordrequirements != null) && (domain.passwordrequirements.hint === true))) { passwordHint = escapeHtml(request.session.passhint); }
        delete request.session.messageid;
        delete request.session.passhint;
    }

    var flashErrors = [];
    if (request.session.flash && request.session.flash.error) {
        flashErrors = uniqueArray(request.session.flash.error);
        request.session.flash = null;
    }
    return { loginMode: loginMode, messageId: messageId, passwordHint: passwordHint, flashErrors: flashErrors };
};
