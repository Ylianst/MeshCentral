/**
* @description Login-page external authentication strategy presentation
* @license Apache-2.0
*/

'use strict';

module.exports.getLoginStrategyOptions = function (domain, common) {
    const strategies = [];
    if (typeof domain.authstrategies == 'object') {
        if (typeof domain.authstrategies.twitter == 'object') { strategies.push('twitter'); }
        if (typeof domain.authstrategies.google == 'object') { strategies.push('google'); }
        if (typeof domain.authstrategies.github == 'object') { strategies.push('github'); }
        if (typeof domain.authstrategies.azure == 'object') { strategies.push('azure'); }
        if (typeof domain.authstrategies.oidc == 'object') {
            if (common.validateObject(domain.authstrategies.oidc.custom) && common.validateString(domain.authstrategies.oidc.custom.preset)) { strategies.push('oidc-' + domain.authstrategies.oidc.custom.preset); }
            else { strategies.push('oidc'); }
        }
        if (typeof domain.authstrategies.intel == 'object') { strategies.push('intel'); }
        if (typeof domain.authstrategies.jumpcloud == 'object') { strategies.push('jumpcloud'); }
        if (typeof domain.authstrategies.saml == 'object') { strategies.push('saml'); }
    }

    var buttonIcon = 'images/login/oidc32.png';
    var buttonIcon2x = 'images/login/oidc64.png 2x';
    var buttonText = '';
    if (common.validateObject(domain.authstrategies) && common.validateObject(domain.authstrategies.oidc) && common.validateObject(domain.authstrategies.oidc.custom)) {
        const custom = domain.authstrategies.oidc.custom;
        if (common.validateUrl(custom.buttoniconurl)) {
            buttonIcon = custom.buttoniconurl;
            buttonIcon2x = common.validateUrl(custom.buttoniconurl2x) ? (custom.buttoniconurl2x + ' 2x') : (custom.buttoniconurl + ' 2x');
        } else {
            switch (custom.preset) {
                case 'azure': buttonIcon = 'images/login/azure32.png'; buttonIcon2x = 'images/login/azure64.png 2x'; break;
                case 'google': buttonIcon = 'images/login/google32.png'; buttonIcon2x = 'images/login/google64.png 2x'; break;
            }
        }
        if (common.validateString(custom.buttontext, 1, 128)) { buttonText = custom.buttontext; }
    }

    return { strategies: strategies.join(','), oidcButtonText: buttonText, oidcButtonIcon: buttonIcon, oidcButtonIcon2x: buttonIcon2x };
};
