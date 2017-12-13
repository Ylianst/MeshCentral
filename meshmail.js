/**
* @description Meshcentral MeshMail
* @author Ylian Saint-Hilaire
* @version v0.0.1
*/

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshMain = function (parent) {
    var obj = {};
    obj.pendingMails = [];
    obj.parent = parent;
    obj.retry = 0;
    obj.sendingMail = false;
    const nodemailer = require('nodemailer');

    // Default account email validation mail
    var accountCheckSubject = '[[[SERVERNAME]]] - Email Verification';
    var accountCheckMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting email verification, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to verify your e-mail address.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    var accountCheckMailText = '[[[SERVERNAME]]] - Verification\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is performing an e-mail verification. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Default account reset mail
    var accountResetSubject = '[[[SERVERNAME]]] - Account Reset';
    var accountResetMailHtml = '<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting an account password reset, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[CALLBACKURL]]]">Click here to reset your account password.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    var accountResetMailText = '[[[SERVERNAME]]] - Account Reset\r\n\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting an account password reset. Nagivate to the following link to complete the process: [[[CALLBACKURL]]]\r\nIf you did not initiate this request, please ignore this mail.\r\n';

    // Setup mail server
    var options = { host: parent.config.smtp.host, secure: false, tls: { rejectUnauthorized: false } };
    if (parent.config.smtp.port != null) { options.port = parent.config.smtp.port; }
    obj.smtpServer = nodemailer.createTransport(options);

    // Perform all e-mail substitution
    function mailReplacements(text, domain, username, email, cookie) {
        var url = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + parent.certificates.CommonName + ':' + obj.parent.args.port + domain.url;
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
        var cookie = obj.parent.webserver.encodeCookie({ u: domain.id + '/' + username, e: email, a: 1 });
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(accountCheckSubject, domain, username, email), text: mailReplacements(accountCheckMailText, domain, username, email, cookie), html: mailReplacements(accountCheckMailHtml, domain, username, email, cookie) });
        sendNextMail();
    }

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, email) {
        if ((parent.certificates == null) || (parent.certificates.CommonName == null)) return; // If the server name is not set, don't validate the email address.
        var cookie = obj.parent.webserver.encodeCookie({ u: domain.id + '/' + username, e: email, a: 2 });
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
                //console.log('SMTP server failed, will try again in a minute (' + obj.retry + ').');
                setTimeout(sendNextMail, 60000); // Wait and try again
            }
        });
    }

	return obj;
}