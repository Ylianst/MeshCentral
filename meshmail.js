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
    var accountCheckSubject = '[[[SERVERNAME]]] - Email Verification';
    var accountCheckMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting email verification, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to verify your e-mail address.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    var accountCheckMailText = '[[[SERVERNAME]]] - Verification\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is performing an e-mail verification. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Default account reset mail
    var accountResetSubject = '[[[SERVERNAME]]] - Account Reset';
    var accountResetMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting an account password reset, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to reset your account password.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    var accountResetMailText = '[[[SERVERNAME]]] - Account Reset\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting an account password reset. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Email Agent template
    var emailAgentSubject = '[[[SERVERNAME]]] - Remote Support Agent';
    var emailAgentCheckMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Remote Support Agent</b></td></tr></table><p>Hello [[[CLIENTNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting you to download the following software to start the remote control session.</p><p style="margin-left:30px"><a href="[[[AGENTURL]]]">Click here to begin remote session.</a></p>If you did not initiate this request, please ignore this mail.<br><br>Best regards,<br>[[[USERNAME]]]<br></div>';
    var emailAgentCheckMailText = '[[[SERVERNAME]]] - Remote Support Agent\r\n\r\nHello [[[CLIENTNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting you to download the following software to start the remote control session. Nagivate to the following link to complete the process: [[[AGENTURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n\rBest regards,\r\n[[[USERNAME]]]\r\n';

    // Perform email sfx agent e-mail substitution
    function mailAgentReplacements(text, domain, username, clientname, agenturl) {
        var url;
        if (domain.dns == null) {
            // Default domain or subdomain of the default.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + parent.certificates.CommonName + ':' + obj.parent.args.port + domain.url;
        } else {
            // Domain with a DNS name.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + domain.dns + ':' + obj.parent.args.port + domain.url;
        }
        if (agenturl != null) { text = text.split('[[[AGENTURL]]]').join(url + agenturl) }
        return text.split('[[[USERNAME]]]').join(username).split('[[[SERVERURL]]]').join(url).split('[[[SERVERNAME]]]').join(domain.title).split('[[[CLIENTNAME]]]').join(clientname);
    }    
 
    // Send email link to client/enduser to download mesh Sfx agent 
    obj.sendAgentMail = function (domain, clientemail, username, clientname, agenturl) {
        obj.pendingMails.push({ to: clientemail, from: parent.config.smtp.from, subject: mailAgentReplacements(emailAgentSubject, domain, username, clientname, agenturl ), text: mailAgentReplacements(emailAgentCheckMailText, domain, username, clientname, agenturl ), html: mailAgentReplacements(emailAgentCheckMailHtml, domain, username, clientname, agenturl ) });
        sendNextMail();
    }   
    
    // Setup mail server
    var options = { host: parent.config.smtp.host, secure: (parent.config.smtp.tls == true), tls: { rejectUnauthorized: false } };
    if (parent.config.smtp.port != null) { options.port = parent.config.smtp.port; }
    if ((parent.config.smtp.user != null) && (parent.config.smtp.pass != null)) { options.auth = { user: parent.config.smtp.user, pass: parent.config.smtp.pass }; }
    obj.smtpServer = nodemailer.createTransport(options);

    // Perform all e-mail substitution
    function mailReplacements(text, domain, username, email, cookie) {
        var url;
        if (domain.dns == null) {
            // Default domain or subdomain of the default.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + parent.certificates.CommonName + ':' + obj.parent.args.port + domain.url;
        } else {
            // Domain with a DNS name.
            url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + domain.dns + ':' + obj.parent.args.port + domain.url;
        }
        if (cookie != null) { text = text.split('[[[CALLBACKURL]]]').join(url + 'checkmail?c=' + cookie) }
        return text.split('[[[USERNAME]]]').join(username).split('[[[SERVERURL]]]').join(url).split('[[[SERVERNAME]]]').join(domain.title);
    }

    // Send a mail
    obj.sendMail = function (to, subject, text, html) {
        obj.pendingMails.push({ to: to, from: parent.config.smtp.from, subject: subject, text: text, html: html });
        sendNextMail();
    }

    // Send account check mail
    obj.sendAccountCheckMail = function (domain, username, email) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null)) return; // If the server name is not set, no reset possible.
        var cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 1 }, obj.mailCookieEncryptionKey);
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountCheckSubject, domain, username, email), text: mailReplacements(accountCheckMailText, domain, username, email, cookie), html: mailReplacements(accountCheckMailHtml, domain, username, email, cookie) });
        sendNextMail();
    }

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, email) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null)) return; // If the server name is not set, don't validate the email address.
        var cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 2 }, obj.mailCookieEncryptionKey);
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountResetSubject, domain, username, email), text: mailReplacements(accountResetMailText, domain, username, email, cookie), html: mailReplacements(accountResetMailHtml, domain, username, email, cookie) });
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