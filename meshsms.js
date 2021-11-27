/**
* @description MeshCentral SMS gateway communication module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

/*
// For Twilio, add this in config.json
"sms": {
    "provider": "twilio",
    "sid": "ACxxxxxxxxx",
    "auth": "xxxxxxx",
    "from": "+15555555555"
},

// For Plivo, add this in config.json
"sms": {
    "provider": "plivo",
    "id": "xxxxxxx",
    "token": "xxxxxxx",
    "from": "15555555555"
}

// For Telnyx, add this in config.json
"sms": {
    "provider": "telnyx",
    "apikey": "xxxxxxx",
    "from": "15555555555"
}
*/

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshSMS = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.provider = null;

    // SMS gateway provider setup
    switch (parent.config.sms.provider) {
        case 'twilio': {
            // Validate Twilio configuration values
            if (typeof parent.config.sms.sid != 'string') { console.log('Invalid or missing SMS gateway provider sid.'); return null; }
            if (typeof parent.config.sms.auth != 'string') { console.log('Invalid or missing SMS gateway provider auth.'); return null; }
            if (typeof parent.config.sms.from != 'string') { console.log('Invalid or missing SMS gateway provider from.'); return null; }

            // Setup Twilio
            var Twilio = require('twilio');
            obj.provider = new Twilio(parent.config.sms.sid, parent.config.sms.auth);
            break;
        }
        case 'plivo': {
            // Validate Plivo configuration values
            if (typeof parent.config.sms.id != 'string') { console.log('Invalid or missing SMS gateway provider id.'); return null; }
            if (typeof parent.config.sms.token != 'string') { console.log('Invalid or missing SMS gateway provider token.'); return null; }
            if (typeof parent.config.sms.from != 'string') { console.log('Invalid or missing SMS gateway provider from.'); return null; }

            // Setup Plivo
            var plivo = require('plivo');
            obj.provider = new plivo.Client(parent.config.sms.id, parent.config.sms.token);
            break;
        }
        case 'telnyx': {
            // Validate Telnyx configuration values
            if (typeof parent.config.sms.apikey != 'string') { console.log('Invalid or missing SMS gateway provider apikey.'); return null; }
            if (typeof parent.config.sms.from != 'string') { console.log('Invalid or missing SMS gateway provider from.'); return null; }

            // Setup Telnyx
            obj.provider = require('telnyx')(parent.config.sms.apikey);
            break;
        }
        default: {
            // Unknown SMS gateway provider
            console.log('Unknown SMS gateway provider: ' + parent.config.sms.provider);
            return null;
        }
    }

    // Send an SMS message
    obj.sendSMS = function (to, msg, func) {
        parent.debug('email', 'Sending SMS to: ' + to + ': ' + msg);
        if (parent.config.sms.provider == 'twilio') { // Twilio
            obj.provider.messages.create({
                from: parent.config.sms.from,
                to: to,
                body: msg
            }, function (err, result) {
                if (err != null) { parent.debug('email', 'SMS error: ' + err.message); } else { parent.debug('email', 'SMS result: ' + JSON.stringify(result)); }
                if (func != null) { func((err == null) && (result.status == 'queued'), err ? err.message : null, result); }
            });
        } else if (parent.config.sms.provider == 'plivo') { // Plivo
            if (to.split('-').join('').split(' ').join('').split('+').join('').length == 10) { to = '1' + to; } // If we only have 10 digits, add a 1 in front.
            obj.provider.messages.create(
                parent.config.sms.from,
                to,
                msg
            ).then(function (result) {
                parent.debug('email', 'SMS result: ' + JSON.stringify(result));
                if (func != null) { func((result != null) && (result.messageUuid != null), null, result); }
            }
            ).catch(function (err) {
                var msg = null;
                if ((err != null) && err.message) { msg = JSON.parse(err.message).error; }
                parent.debug('email', 'SMS error: ' + msg);
                if (func != null) { func(false, msg, null); }
            }
            );
        } else if (parent.config.sms.provider == 'telnyx') { // Telnyx
            obj.provider.messages.create({
                from: parent.config.sms.from,
                to: to,
                text: msg
            }, function (err, result) {
                if (err != null) { parent.debug('email', 'SMS error: ' + err.type); } else { parent.debug('email', 'SMS result: ' + JSON.stringify(result)); }
                if (func != null) { func((err == null), err ? err.type : null, result); }
            });
        }
    }

    // Get the correct SMS template
    function getTemplate(templateNumber, domain, lang) {
        parent.debug('email', 'Getting SMS template #' + templateNumber + ', lang: ' + lang);
        if (Array.isArray(lang)) { lang = lang[0]; } // TODO: For now, we only use the first language given.

        var r = {}, emailsPath = null;
        if ((domain != null) && (domain.webemailspath != null)) { emailsPath = domain.webemailspath; }
        else if (obj.parent.webEmailsOverridePath != null) { emailsPath = obj.parent.webEmailsOverridePath; }
        else if (obj.parent.webEmailsPath != null) { emailsPath = obj.parent.webEmailsPath; }
        if ((emailsPath == null) || (obj.parent.fs.existsSync(emailsPath) == false)) { return null }

        // Get the non-english email if needed
        var txtfile = null;
        if ((lang != null) && (lang != 'en')) {
            var translationsPath = obj.parent.path.join(emailsPath, 'translations');
            var translationsPathTxt = obj.parent.path.join(emailsPath, 'translations', 'sms-messages_' + lang + '.txt');
            if (obj.parent.fs.existsSync(translationsPath) && obj.parent.fs.existsSync(translationsPathTxt)) {
                txtfile = obj.parent.fs.readFileSync(translationsPathTxt).toString();
            }
        }

        // Get the english email
        if (txtfile == null) {
            var pathTxt = obj.parent.path.join(emailsPath, 'sms-messages.txt');
            if (obj.parent.fs.existsSync(pathTxt)) {
                txtfile = obj.parent.fs.readFileSync(pathTxt).toString();
            }
        }

        // No email templates
        if (txtfile == null) { return null; }

        // Decode the TXT file
        var lines = txtfile.split('\r\n').join('\n').split('\n')
        if (lines.length <= templateNumber) return null;

        return lines[templateNumber];
    }

    // Send phone number verification SMS
    obj.sendPhoneCheck = function (domain, phoneNumber, verificationCode, language, func) {
        parent.debug('email', "Sending verification SMS to " + phoneNumber);

        var sms = getTemplate(0, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the SMS
        obj.sendSMS(phoneNumber, sms, func);
    };

    // Send phone number verification SMS
    obj.sendToken = function (domain, phoneNumber, verificationCode, language, func) {
        parent.debug('email', "Sending login token SMS to " + phoneNumber);

        var sms = getTemplate(1, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the SMS
        obj.sendSMS(phoneNumber, sms, func);
    };

    return obj;
};
