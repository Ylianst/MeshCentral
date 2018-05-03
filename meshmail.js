/**
* @description MeshCentral e-mail server communication modules
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshMain = function (parent) {
    var obj = {};
    obj.pendingMails = [];
    obj.parent = parent;
    obj.retry = 0;
    obj.sendingMail = false;
    obj.mailCookieEncryptionKey = null;
    const nodemailer = require('nodemailer');

    // Default account email validation mail
    const accountCheckSubject = '[[[SERVERNAME]]] - Email Verification';
    const accountCheckMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting email verification, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to verify your e-mail address.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    const accountCheckMailText = '[[[SERVERNAME]]] - Verification\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is performing an e-mail verification. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Default account reset mail
    const accountResetSubject = '[[[SERVERNAME]]] - Account Reset';
    const accountResetMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting an account password reset, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to reset your account password.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    const accountResetMailText = '[[[SERVERNAME]]] - Account Reset\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting an account password reset. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Default account invite mail
    const accountInviteSubject = '[[[SERVERNAME]]] - Agent Installation Invitation';
    const accountInviteMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Agent Installation</b></td></tr></table><p>User [[[USERNAME]]] on server <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting that you install a remote management agent. WARNING: this will allow the requester to <u>take control of your computer</u>. If you wish to do this, click on the following link to download the agent.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to download the MeshAgent for Windows.</a></p>If you did not know about this request, please ignore this mail.</div>';
    const accountInviteMailText = '[[[SERVERNAME]]] - Agent Installation Invitation\r\n\r\nUser [[[USERNAME]]] on server [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting you install a remote management agent. WARNING: This will allow the requester to take control of your computer. If you wish to do this, click on the following link to download the agent: [[[CALLBACKURL]]]\r\nIf you do not know about this request, please ignore this mail.\r\n';

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    // Setup mail server
    var options = { host: parent.config.smtp.host, secure: (parent.config.smtp.tls == true), tls: { rejectUnauthorized: false } };
    if (parent.config.smtp.port != null) { options.port = parent.config.smtp.port; }
    if ((parent.config.smtp.user != null) && (parent.config.smtp.pass != null)) { options.auth = { user: parent.config.smtp.user, pass: parent.config.smtp.pass }; }
    obj.smtpServer = nodemailer.createTransport(options);

    // Perform all e-mail substitution
    function mailReplacements(text, domain, username, email, options) {
        var url;
        if (domain.dns == null) {
            // Default domain or subdomain of the default.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + parent.certificates.CommonName + ':' + obj.parent.args.port + domain.url;
        } else {
            // Domain with a DNS name.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + domain.dns + ':' + obj.parent.args.port + domain.url;
        }
        if (options) {
            if (options.cookie != null) { text = text.split('[[[CALLBACKURL]]]').join(url + 'checkmail?c=' + options.cookie) }
            if (options.meshid != null) { text = text.split('[[[CALLBACKURL]]]').join(url + 'meshagents?id=3&meshid=' + options.meshid.split('/')[2] + '&tag=mailto:' + EscapeHtml(email)) }
        }
        return text.split('[[[USERNAME]]]').join(username).split('[[[SERVERURL]]]').join(url).split('[[[SERVERNAME]]]').join(domain.title);
    }

    // Send a mail
    obj.sendMail = function (to, subject, text, html) {
        obj.pendingMails.push({ to: to, from: parent.config.smtp.from, subject: subject, text: text, html: html });
        sendNextMail();
    }

    // Send account check mail
    obj.sendAccountCheckMail = function (domain, username, email) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName == 'un-configured')) return; // If the server name is not set, no reset possible.
        var cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 1 }, obj.mailCookieEncryptionKey);
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountCheckSubject, domain, username, email), text: mailReplacements(accountCheckMailText, domain, username, email, { cookie: cookie }), html: mailReplacements(accountCheckMailHtml, domain, username, email, { cookie: cookie }) });
        sendNextMail();
    }

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, email) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName == 'un-configured')) return; // If the server name is not set, don't validate the email address.
        var cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 2 }, obj.mailCookieEncryptionKey);
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountResetSubject, domain, username, email), text: mailReplacements(accountResetMailText, domain, username, email, { cookie: cookie }), html: mailReplacements(accountResetMailHtml, domain, username, email, { cookie: cookie }) });
        sendNextMail();
    }

    // Send agent invite mail
    obj.sendAgentInviteMail = function (domain, username, email, meshid) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName == 'un-configured')) return; // If the server name is not set, can't do this.
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountInviteSubject, domain, username, email), text: mailReplacements(accountInviteMailText, domain, username, email, { meshid: meshid }), html: mailReplacements(accountInviteMailHtml, domain, username, email, { meshid: meshid }) });
        sendNextMail();
    }

    // Send out the next mail in the pending list
    function sendNextMail() {
        if ((obj.sendingMail == true) || (obj.pendingMails.length == 0)) { return; }

        var mailToSend = obj.pendingMails[0];
        obj.sendingMail = true;
        //console.log('SMTP sending mail to ' + mailToSend.to + '.');
        obj.smtpServer.sendMail(mailToSend, function (err, info) {
            //console.log(JSON.stringify(err), JSON.stringify(info));
            obj.sendingMail = false;
            if (err == null) {
                obj.pendingMails.shift();
                obj.retry = 0;
                sendNextMail(); // Send the next mail
            } else {
                obj.retry++;
                console.log('SMTP server failed: ' + JSON.stringify(err));
                if (obj.retry < 6) { setTimeout(sendNextMail, 60000); } // Wait and try again
            }
        });
    }

    // Send out the next mail in the pending list
    obj.verify = function() {
        obj.smtpServer.verify(function (err, info) {
            if (err == null) {
                console.log('SMTP mail server ' + parent.config.smtp.host + ' working as expected.');
            } else {
                console.log('SMTP mail server ' + parent.config.smtp.host + ' failed: ' + JSON.stringify(err));
            }
        });
    }

    // Load the cookie encryption key from the database
    obj.parent.db.Get('MailCookieEncryptionKey', function (err, docs) {
        if ((docs.length > 0) && (docs[0].key != null) && (obj.parent.mailtokengen == null)) {
            // Key is present, use it.
            obj.mailCookieEncryptionKey = Buffer.from(docs[0].key, 'hex');
        } else {
            // Key is not present, generate one.
            obj.mailCookieEncryptionKey = obj.parent.generateCookieKey();
            obj.parent.db.Set({ _id: 'MailCookieEncryptionKey', key: obj.mailCookieEncryptionKey.toString('hex'), time: Date.now() });
        }
    });

	return obj;
}