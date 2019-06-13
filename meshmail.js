/**
* @description MeshCentral e-mail server communication modules
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
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

// TODO: Add NTML support with "nodemailer-ntlm-auth" https://github.com/nodemailer/nodemailer-ntlm-auth

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshMail = function (parent) {
    var obj = {};
    obj.pendingMails = [];
    obj.parent = parent;
    obj.retry = 0;
    obj.sendingMail = false;
    obj.mailCookieEncryptionKey = null;
    obj.mailTemplates = {};
    const nodemailer = require('nodemailer');

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    // Setup mail server
    var options = { host: parent.config.smtp.host, secure: (parent.config.smtp.tls == true), tls: { rejectUnauthorized: false } };
    if (parent.config.smtp.port != null) { options.port = parent.config.smtp.port; }
    if ((parent.config.smtp.user != null) && (parent.config.smtp.pass != null)) { options.auth = { user: parent.config.smtp.user, pass: parent.config.smtp.pass }; }
    obj.smtpServer = nodemailer.createTransport(options);

    // Set default mail templates
    // You can override these by placing a file with the same name in "meshcentral-data/mail"
    // If the server hash many domains, just add the domainid to the file like this: 'account-check-customer1.html', 'mesh-invite-customer1.txt'.
    obj.mailTemplates['account-check.html'] = '<title>[[[SERVERNAME]]] - Email Verification</title>\r\n<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting email verification, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[SERVERURL]]]/checkmail?c=[[[COOKIE]]]">Click here to verify your e-mail address.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    obj.mailTemplates['account-reset.html'] = '<title>[[[SERVERNAME]]] - Account Reset</title>\r\n<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Verification</b></td></tr></table><p>Hi [[[USERNAME]]], <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting an account password reset, click on the following link to complete the process.</p><p style="margin-left:30px"><a href="[[[SERVERURL]]]/checkmail?c=[[[COOKIE]]]">Click here to reset your account password.</a></p>If you did not initiate this request, please ignore this mail.</div>';
    obj.mailTemplates['mesh-invite.html'] = '<title>[[[SERVERNAME]]] - Invitation</title>\r\n<div style="font-family:Arial,Helvetica,sans-serif"><table style="background-color:#003366;color:lightgray;width:100%" cellpadding=8><tr><td><b style="font-size:20px;font-family:Arial,Helvetica,sans-serif">[[[SERVERNAME]]] - Agent Installation</b></td></tr></table>[[[AREA-NAME]]]<p>Hello [[[NAME]]],</p>[[[/AREA-NAME]]]<p>User [[[USERNAME]]] on server <a href="[[[SERVERURL]]]">[[[SERVERNAME]]]</a> is requesting you to install software to start a remote control session.</p>[[[AREA-MSG]]]<p>Message: <b>[[[MSG]]]</b></p>[[[/AREA-MSG]]][[[AREA-WINDOWS]]]<p style="margin-left:30px"><a href="[[[SERVERURL]]]/meshagents?id=3&meshid=[[[MESHIDHEX]]]&tag=mailto:[[[EMAIL]]]&installflags=[[[INSTALLFLAGS]]]">Click here to download the MeshAgent for Windows.</a></p>[[[/AREA-WINDOWS]]][[[AREA-OSX]]]<p style="margin-left:30px"><a href="[[[SERVERURL]]]/meshagents?id=16&meshid=[[[MESHIDHEX]]]&tag=mailto:[[[EMAIL]]]&installflags=[[[INSTALLFLAGS]]]">Click here to download the MeshAgent for Apple OSX.</a></p>[[[/AREA-OSX]]][[[AREA-LINUX]]]<p>For Linux, cut & paste the following in a terminal to install the agent:<br /><pre style="margin-left:30px">wget -q [[[SERVERURL]]]/meshagents?script=1 --no-check-certificate -O ./meshinstall.sh && chmod 755 ./meshinstall.sh && sudo ./meshinstall.sh [[[SERVERURL]]] [[[MESHIDHEX]]]</pre></p>[[[/AREA-LINUX]]][[[AREA-LINK]]]<p>To install the software, <a href="[[[SERVERURL]]][[[LINKURL]]]">click here</a> and follow the instructions.</p>[[[/AREA-LINK]]]<p>If you did not initiate this request, please ignore this mail.</p>Best regards,<br>[[[USERNAME]]]<br></div>';
    obj.mailTemplates['account-check.txt'] = '[[[SERVERNAME]]] - Email Verification\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is performing an e-mail verification. Nagivate to the following link to complete the process:\r\n\r\n[[[SERVERURL]]]/checkmail?c=[[[COOKIE]]]\r\n\r\nIf you did not initiate this request, please ignore this mail.\r\n';
    obj.mailTemplates['account-reset.txt'] = '[[[SERVERNAME]]] - Account Reset\r\nHi [[[USERNAME]]], [[[SERVERNAME]]] ([[[SERVERURL]]]) is requesting an account password reset. Nagivate to the following link to complete the process:\r\n\r\n[[[SERVERURL]]]/checkmail?c=[[[COOKIE]]]\r\n\r\nIf you did not initiate this request, please ignore this mail.';
    obj.mailTemplates['mesh-invite.txt'] = '[[[SERVERNAME]]] - Invitation\r\n[[[AREA-NAME]]]Hello [[[NAME]]],\r\n\r\n[[[/AREA-NAME]]]User [[[USERNAME]]] on server [[[SERVERNAME]]] ([[[SERVERURL]]]/) is requesting you install software to start the remote control session.[[[AREA-MSG]]]\r\n\r\nMessage: [[[MSG]]]\r\n\r\n[[[/AREA-MSG]]][[[AREA-WINDOWS]]]For Windows, nagivate to the following link to complete the process:\r\n\r\n[[[SERVERURL]]]/meshagents?id=3&meshid=[[[MESHIDHEX]]]&tag=mailto:[[[EMAIL]]]&installflags=[[[INSTALLFLAGS]]]\r\n\r\n[[[/AREA-WINDOWS]]][[[AREA-OSX]]]For Apple OSX, nagivate to the following link to complete the process:\r\n\r\n[[[SERVERURL]]]/meshagents?id=16&meshid=[[[MESHIDHEX]]]&tag=mailto:[[[EMAIL]]]&installflags=[[[INSTALLFLAGS]]]\r\n\r\n[[[/AREA-OSX]]][[[AREA-LINUX]]]For Linux, cut & paste the following in a terminal to install the agent:\r\n\r\nwget -q [[[SERVERURL]]]/meshagents?script=1 --no-check-certificate -O ./meshinstall.sh && chmod 755 ./meshinstall.sh && sudo ./meshinstall.sh [[[SERVERURL]]] [[[MESHIDHEX]]]\r\n\r\n[[[/AREA-LINUX]]][[[AREA-LINK]]]To install the software, navigate to [[[SERVERURL]]][[[LINKURL]]] and follow the instructions.\r\n\r\n[[[/AREA-LINK]]]If you did not initiate this request, please ignore this mail.\r\n\r\nBest regards,\r\n[[[USERNAME]]]';

    // Load all of the mail templates if present
    if (obj.parent.fs.existsSync(obj.parent.path.join(obj.parent.datapath, 'mail-templates'))) {
        var mailDir = null;
        try { mailDir = obj.parent.fs.readdirSync(obj.parent.path.join(obj.parent.datapath, 'mail-templates')); } catch (e) { }
        if (mailDir != null) {
            // Load all mail templates
            for (var i in mailDir) {
                var templateName = mailDir[i].toLowerCase();
                if (templateName.endsWith('.html') || templateName.endsWith('.txt')) { obj.mailTemplates[templateName] = obj.parent.fs.readFileSync(obj.parent.path.join(obj.parent.datapath, 'mail-templates', mailDir[i])).toString(); }
            }
        }
    } else {
        // Save the default templates
        try {
            obj.parent.fs.mkdirSync(obj.parent.path.join(obj.parent.datapath, 'mail-templates'));
            for (var i in obj.mailTemplates) { obj.parent.fs.writeFileSync(obj.parent.path.join(obj.parent.datapath, 'mail-templates', i), obj.mailTemplates[i], 'utf8'); }
        } catch (e) { console.error(e); }
    }

    // Get the correct mail template
    function getTemplate(name, domain, html) {
        if (domain != null) { var r = obj.mailTemplates[name + '-' + domain.id + (html ? '.html' : '.txt')]; if (r) return r; }
        return obj.mailTemplates[name + (html ? '.html' : '.txt')];
    }

    // Get the correct mail template object
    function getTemplateEx(name, domain) {
        var r = {}, txt = getTemplate(name, domain, 0), html = getTemplate(name, domain, 1);
        r.txtSubject = txt.split('\r\n')[0];
        r.htmlSubject = getStrBetween(html, '<title>', '</title>\r\n');
        r.txt = txt.substring(txt.indexOf('\r\n') + 2);
        r.html = html.substring(html.indexOf('\r\n') + 2);
        return r;
    }

    // Get the string between two markers
    function getStrBetween(str, start, end) {
        var si = str.indexOf(start), ei = str.indexOf(end);
        if ((si == -1) || (ei == -1) || (si > ei)) return null;
        return str.substring(si + start.length, ei);
    }

    // Remove the string between two markers
    function removeStrBetween(str, start, end) {
        var si = str.indexOf(start), ei = str.indexOf(end);
        if ((si == -1) || (ei == -1) || (si > ei)) return str;
        return str.substring(0, si) + str.substring(ei + end.length);
    }

    // Keep or remove the string between two markers
    function strZone(str, marker, keep) {
        marker = marker.toUpperCase();
        if (keep) { return str.split('[[[AREA-' + marker + ']]]').join('').split('[[[/AREA-' + marker + ']]]').join(''); }
        return removeStrBetween(str, '[[[AREA-' + marker + ']]]', '[[[/AREA-' + marker + ']]]');
    }

    // Perform all e-mail substitution
    function mailReplacements(text, domain, options) {
        var httpsport = (typeof obj.parent.args.aliasport == 'number') ? obj.parent.args.aliasport : obj.parent.args.port;
        if (domain.dns == null) {
            // Default domain or subdomain of the default.
            options.serverurl = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + obj.parent.certificates.CommonName + ':' + httpsport + domain.url;
        } else {
            // Domain with a DNS name.
            options.serverurl = 'http' + ((obj.parent.args.notls == null) ? 's' : '') + '://' + domain.dns + ':' + httpsport + domain.url;
        }
        if (options.serverurl.endsWith('/')) { options.serverurl = options.serverurl.substring(0, options.serverurl.length - 1); } // Remove the ending / if present
        for (var i in options) {
            text = strZone(text, i.toUpperCase(), options[i]); // Adjust this text area
            text = text.split('[[[' + i.toUpperCase() + ']]]').join(options[i]); // Replace this value
        }
        return text;
    }

    // Send a mail
    obj.sendMail = function (to, subject, text, html) {
        obj.pendingMails.push({ to: to, from: parent.config.smtp.from, subject: subject, text: text, html: html });
        sendNextMail();
    };

    // Send account check mail
    obj.sendAccountCheckMail = function (domain, username, email) {
        var template = getTemplateEx('account-check', domain);
        if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null) || (parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) return; // If the server name is not set, no reset possible.

        // Set all the options.
        var options = { username: username, email: email, servername: domain.title };
        options.cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username.toLowerCase(), e: email, a: 1 }, obj.mailCookieEncryptionKey);

        // Send the email
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
        sendNextMail();
    };

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, email) {
        var template = getTemplateEx('account-reset', domain);
        if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null) || (parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) return; // If the server name is not set, don't validate the email address.

        // Set all the options.
        var options = { username: username, email: email, servername: domain.title };
        options.cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 2 }, obj.mailCookieEncryptionKey);

        // Send the email
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
        sendNextMail();
    };

    // Send agent invite mail
    obj.sendAgentInviteMail = function (domain, username, email, meshid, name, os, msg, flags, expirehours) {
        var template = getTemplateEx('mesh-invite', domain);
        if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null) || (parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) return; // If the server name is not set, don't validate the email address.

        // Set all the template replacement options and generate the final email text (both in txt and html formats).
        var options = { username: username, name: name, email: email, installflags: flags, msg: msg, meshid: meshid, meshidhex: meshid.split('/')[2], servername: domain.title };
        options.windows = ((os == 0) || (os == 1)) ? 1 : 0;
        options.linux = ((os == 0) || (os == 2)) ? 1 : 0;
        options.osx = ((os == 0) || (os == 3)) ? 1 : 0;
        options.link = (os == 4) ? 1 : 0;
        options.linkurl = createInviteLink(domain, meshid, flags, expirehours);

        // Send the email
        obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
        sendNextMail();
    };

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
    obj.verify = function () {
        obj.smtpServer.verify(function (err, info) {
            if (err == null) {
                console.log('SMTP mail server ' + parent.config.smtp.host + ' working as expected.');
            } else {
                console.log('SMTP mail server ' + parent.config.smtp.host + ' failed: ' + JSON.stringify(err));
            }
        });
    };

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

    // Create a agent invitation link
    function createInviteLink(domain, meshid, flags, expirehours) {
        return '/agentinvite?c=' + parent.encodeCookie({ a: 4, mid: meshid, f: flags, expire: expirehours * 60 }, parent.invitationLinkEncryptionKey);
    }

    return obj;
};