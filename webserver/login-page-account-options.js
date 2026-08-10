/**
* @description Login-page account and server option calculation
* @license Apache-2.0
*/

'use strict';

module.exports.createLoginPageAccountOptions = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const captcha = options.captcha;

    return function getLoginPageAccountOptions(domain) {
        var features = 0;
        if ((parent.config != null) && (parent.config.settings != null) && ((parent.config.settings.allowframing == true) || (typeof parent.config.settings.allowframing == 'string') || (parent.config.settings.allowedframingorigins != null) || ((domain != null) && (domain.allowedframingorigins != null)))) { features += 32; }
        if (domain.usernameisemail) { features += 0x00200000; }

        const allowAccountReset = (typeof domain.passwordrequirements != 'object') || (domain.passwordrequirements.allowaccountreset !== false);
        const emailCheck = allowAccountReset && (domain.mailserver != null) && (parent.certificates.CommonName != null) && (parent.certificates.CommonName.indexOf('.') != -1) && (args.lanonly != true) && (domain.auth != 'sspi') && (domain.auth != 'ldap');

        var newAccountsAllowed = true;
        if ((domain.newaccounts !== 1) && (domain.newaccounts !== true)) {
            for (var userId in state.users) {
                if (state.users[userId].domain == domain.id) { newAccountsAllowed = false; break; }
            }
        }
        if (parent.config.settings.maintenancemode != null) { newAccountsAllowed = false; }

        var newAccountCaptcha = '';
        var newAccountCaptchaImage = '';
        if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
            newAccountCaptcha = captcha.createNewAccountCookie();
            newAccountCaptchaImage = 'newAccountCaptcha.ashx?x=' + newAccountCaptcha;
        }

        return {
            features: features,
            serverPublicPort: (args.aliasport == null) ? args.port : args.aliasport,
            emailCheck: emailCheck,
            newAccountsAllowed: newAccountsAllowed,
            newAccountCaptcha: newAccountCaptcha,
            newAccountCaptchaImage: newAccountCaptchaImage
        };
    };
};
