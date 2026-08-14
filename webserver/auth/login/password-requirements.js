/**
* @description Password-requirement serialization for web pages
* @license Apache-2.0
*/

'use strict';

module.exports.getEncodedPasswordRequirements = function (domain) {
    if (domain.passwordrequirements == null) { return null; }
    if (domain.passrequirementstr == null) {
        const requirements = {};
        if (typeof domain.passwordrequirements.min == 'number') { requirements.min = domain.passwordrequirements.min; }
        if (typeof domain.passwordrequirements.max == 'number') { requirements.max = domain.passwordrequirements.max; }
        if (typeof domain.passwordrequirements.upper == 'number') { requirements.upper = domain.passwordrequirements.upper; }
        if (typeof domain.passwordrequirements.lower == 'number') { requirements.lower = domain.passwordrequirements.lower; }
        if (typeof domain.passwordrequirements.numeric == 'number') { requirements.numeric = domain.passwordrequirements.numeric; }
        if (typeof domain.passwordrequirements.nonalpha == 'number') { requirements.nonalpha = domain.passwordrequirements.nonalpha; }
        domain.passrequirementstr = encodeURIComponent(JSON.stringify(requirements));
    }
    return domain.passrequirementstr;
};
