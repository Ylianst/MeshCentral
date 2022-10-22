/**
* @description MeshCentral Telegram communication module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
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
  "telegram": {
    "apiid": 0000000,
    "apihash": "hexvalue",
    "session": "base64value"
  }
*/

// Construct a Telegram server object
module.exports.CreateServer = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Check that we have the correct values
    if (typeof parent.config.telegram != 'object') return null;
    if (typeof parent.config.telegram.apiid != 'number') return null;
    if (typeof parent.config.telegram.apihash != 'string') return null;
    if (typeof parent.config.telegram.session != 'string') return null;

    // Connect to the telegram server
    async function connect() {
        const { TelegramClient } = require('telegram');
        const { StringSession } = require('telegram/sessions');
        const input = require('input');

        const stringSession = new StringSession(parent.config.telegram.session);
        const client = new TelegramClient(stringSession, parent.config.telegram.apiid, parent.config.telegram.apihash, { connectionRetries: 5 });
        await client.start({
            phoneNumber: async function () { await input.text("Please enter your number: "); },
            password: async function () { await input.text("Please enter your password: "); },
            phoneCode: async function () { await input.text("Please enter the code you received: "); },
            onError: function (err) { console.log('Telegram error', err); },
        });
        console.log("MeshCentral Telegram session is connected.");
        obj.client = client;
        //console.log(client.session.save()); // Save this string to avoid logging in again
    }

    // Send an Telegram message
    obj.sendMessage = async function (to, msg, func) {
        if (obj.client == null) return;
        parent.debug('email', 'Sending Telegram to: ' + to + ': ' + msg);
        await client.sendMessage(to, { message: msg });
        func(true);
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

    // Send telegram user verification message
    obj.sendPhoneCheck = function (domain, to, verificationCode, language, func) {
        parent.debug('email', "Sending verification Telegram to " + to);

        var sms = getTemplate(0, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the SMS
        obj.sendMessage(to, sms, func);
    };

    // Send login token verification message
    obj.sendToken = function (domain, to, verificationCode, language, func) {
        parent.debug('email', "Sending login token Telegram to " + to);

        var sms = getTemplate(1, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the SMS
        obj.sendMessage(to, sms, func);
    };

    // Connect the Telegram session
    connect();

    return obj;
};
