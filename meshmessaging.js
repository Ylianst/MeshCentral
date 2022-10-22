/**
* @description MeshCentral user messaging communication module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2022
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
// For Telegram, add this in config.json
"messaging": {
    "telegram": {
        "apiid": 00000000,
        "apihash": "00000000000000000000000",
        "session": "aaaaaaaaaaaaaaaaaaaaaaa"
    }
}
*/

// Construct a messaging server object
module.exports.CreateServer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.providers = 0; // 1 = Telegram, 2 = Signal
    obj.telegramClient = null;

    // Messaging client setup
    if (parent.config.messaging.telegram) {
        // Validate Telegram configuration values
        var telegramOK = true;
        if (typeof parent.config.messaging.telegram.apiid != 'number') { console.log('Invalid or missing Telegram apiid.'); telegramOK = false; }
        if (typeof parent.config.messaging.telegram.apihash != 'string') { console.log('Invalid or missing Telegram apihash.'); telegramOK = false; }
        if (typeof parent.config.messaging.telegram.session != 'string') { console.log('Invalid or missing Telegram session.'); telegramOK = false; }

        if (telegramOK) {
            // Setup Telegram
            async function setupTelegram() {
                const { TelegramClient } = require('telegram');
                const { StringSession } = require('telegram/sessions');
                const input = require('input');
                const stringSession = new StringSession(parent.config.messaging.telegram.session);
                const client = new TelegramClient(stringSession, parent.config.messaging.telegram.apiid, parent.config.messaging.telegram.apihash, { connectionRetries: 5 });
                client.setLogLevel('none');
                await client.start({ onError: function (err) { console.log('Telegram error', err); } });
                obj.telegramClient = client;
                obj.providers += 1; // Enable Telegram messaging
                console.log("MeshCentral Telegram client is connected.");
            }
            setupTelegram();
        }
    }

    // Send an user message
    obj.sendMessage = function(to, msg, func) {
        // Telegram
        if ((to.startsWith('telegram:')) && (obj.telegramClient != null)) {
            async function sendTelegramMessage(to, msg, func) {
                if (obj.telegramClient == null) return;
                parent.debug('email', 'Sending Telegram message to: ' + to.substring(9) + ': ' + msg);
                try { await obj.telegramClient.sendMessage(to.substring(9), { message: msg }); if (func != null) { func(true); } } catch (ex) { if (func != null) { func(false, ex); } }
            }
            sendTelegramMessage(to, msg, func);
        } else {
            // No providers found
            func(false, "No messaging providers found for this message.");
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

    // Send messaging account verification
    obj.sendMessagingCheck = function (domain, to, verificationCode, language, func) {
        parent.debug('email', "Sending verification message to " + to);

        var sms = getTemplate(0, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the message
        obj.sendMessage(to, sms, func);
    };

    // Send 2FA verification
    obj.sendToken = function (domain, to, verificationCode, language, func) {
        parent.debug('email', "Sending login token message to " + to);

        var sms = getTemplate(1, domain, language);
        if (sms == null) { parent.debug('email', "Error: Failed to get SMS template"); return; } // No SMS template found

        // Setup the template
        sms = sms.split('[[0]]').join(domain.title ? domain.title : 'MeshCentral');
        sms = sms.split('[[1]]').join(verificationCode);

        // Send the message
        obj.sendMessage(to, sms, func);
    };

    return obj;
};

// Called to setup the Telegram session key
module.exports.SetupTelegram = async function (parent) {
    // If basic telegram values are not setup, instruct the user on how to get them.
    if ((typeof parent.config.messaging != 'object') || (typeof parent.config.messaging.telegram != 'object') || (typeof parent.config.messaging.telegram.apiid != 'number') || (typeof parent.config.messaging.telegram.apihash != 'string')) {
        console.log('Login to your Telegram account at this URL: https://my.telegram.org/.');
        console.log('Click "API development tools" and fill your application details (only app title and short name required).');
        console.log('Click "Create application"');
        console.log('Set this apiid and apihash values in the messaging section of the config.json like this:');
        console.log('{');
        console.log('  "messaging": {');
        console.log('    "telegram": {');
        console.log('      "apiid": 123456,');
        console.log('      "apihash": "123456abcdfg"');
        console.log('    }');
        console.log('  }');
        console.log('}');
        console.log('Then, run --setuptelegram again to continue.');
        process.exit();
        return;
    }

    // If the session value is missing, perform the process to get it
    if ((parent.config.messaging.telegram.session == null) || (parent.config.messaging.telegram.session == '') || (typeof parent.config.messaging.telegram.session != 'string')) {
        const { TelegramClient } = require('telegram');
        const { StringSession } = require('telegram/sessions');
        const input = require('input');
        const stringSession = new StringSession('');
        const client = new TelegramClient(stringSession, parent.config.messaging.telegram.apiid, parent.config.messaging.telegram.apihash, { connectionRetries: 5, logLevel: 'none' });
        client.setLogLevel('none');
        await client.start({
            phoneNumber: async function () { return await input.text("Please enter your number (+1-111-222-3333): "); },
            password: async function () { return await input.text("Please enter your password: "); },
            phoneCode: async function () { return await input.text("Please enter the code you received: "); },
            onError: function (err) { console.log('Telegram error', err); }
        });
        console.log('Set this session value in the messaging section of the config.json like this:');
        console.log('{');
        console.log('  "messaging": {');
        console.log('    "telegram": {');
        console.log('      "apiid": ' + parent.config.messaging.telegram.apiid + ',');
        console.log('      "apihash": "' + parent.config.messaging.telegram.apihash + '",');
        console.log('      "session": "' + client.session.save() + '"');
        console.log('    }');
        console.log('  }');
        console.log('}');
        process.exit();
    }

    // All Telegram values seem ok
    console.log('Telegram seems to be configured correctly in the config.json, no need to run --setuptelegram.');
    process.exit();
};
