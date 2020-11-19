/**
* @description MeshCentral e-mail server communication modules
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2020
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
    //obj.mailTemplates = {};
    const constants = (obj.parent.crypto.constants ? obj.parent.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.
    const nodemailer = require('nodemailer');

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    // Setup mail server
    var options = { host: parent.config.smtp.host, secure: (parent.config.smtp.tls == true), tls: { } };
    //var options = { host: parent.config.smtp.host, secure: (parent.config.smtp.tls == true), tls: { secureProtocol: 'SSLv23_method', ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false } };
    if (parent.config.smtp.port != null) { options.port = parent.config.smtp.port; }
    if (parent.config.smtp.tlscertcheck === false) { options.tls.rejectUnauthorized = false; }
    if (parent.config.smtp.tlsstrict === true) { options.tls.secureProtocol = 'SSLv23_method'; options.tls.ciphers = 'RSA+AES:!aNULL:!MD5:!DSS'; options.tls.secureOptions = constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE; }
    if ((parent.config.smtp.user != null) && (parent.config.smtp.pass != null)) { options.auth = { user: parent.config.smtp.user, pass: parent.config.smtp.pass }; }
    obj.smtpServer = nodemailer.createTransport(options);

    // Get the correct mail template object
    function getTemplate(name, domain, lang) {
        parent.debug('email', 'Getting mail template for: ' + name + ', lang: ' + lang);
        if (Array.isArray(lang)) { lang = lang[0]; } // TODO: For now, we only use the first language given.

        var r = {}, emailsPath = null;
        if ((domain != null) && (domain.webemailspath != null)) { emailsPath = domain.webemailspath; }
        else if (obj.parent.webEmailsOverridePath != null) { emailsPath = obj.parent.webEmailsOverridePath; }
        else if (obj.parent.webEmailsPath != null) { emailsPath = obj.parent.webEmailsPath; }
        if ((emailsPath == null) || (obj.parent.fs.existsSync(emailsPath) == false)) { return null }

        // Get the non-english email if needed
        var htmlfile = null, txtfile = null;
        if ((lang != null) && (lang != 'en')) {
            var translationsPath = obj.parent.path.join(emailsPath, 'translations');
            var translationsPathHtml = obj.parent.path.join(emailsPath, 'translations', name + '_' + lang + '.html');
            var translationsPathTxt = obj.parent.path.join(emailsPath, 'translations', name + '_' + lang + '.txt');
            if (obj.parent.fs.existsSync(translationsPath) && obj.parent.fs.existsSync(translationsPathHtml) && obj.parent.fs.existsSync(translationsPathTxt)) {
                htmlfile = obj.parent.fs.readFileSync(translationsPathHtml).toString();
                txtfile = obj.parent.fs.readFileSync(translationsPathTxt).toString();
            }
        }

        // Get the english email
        if ((htmlfile == null) || (txtfile == null)) {
            var pathHtml = obj.parent.path.join(emailsPath, name + '.html');
            var pathTxt = obj.parent.path.join(emailsPath, name + '.txt');
            if (obj.parent.fs.existsSync(pathHtml) && obj.parent.fs.existsSync(pathTxt)) {
                htmlfile = obj.parent.fs.readFileSync(pathHtml).toString();
                txtfile = obj.parent.fs.readFileSync(pathTxt).toString();
            }
        }

        // No email templates
        if ((htmlfile == null) || (txtfile == null)) { return null; }

        // Decode the HTML file
        htmlfile = htmlfile.split('<html>').join('').split('</html>').join('').split('<head>').join('').split('</head>').join('').split('<body>').join('').split('</body>').join('').split(' notrans="1"').join('');
        var lines = htmlfile.split('\r\n').join('\n').split('\n');
        r.htmlSubject = lines.shift();
        if (r.htmlSubject.startsWith('<div>')) { r.htmlSubject = r.htmlSubject.substring(5); }
        if (r.htmlSubject.endsWith('</div>')) { r.htmlSubject = r.htmlSubject.substring(0, r.htmlSubject.length - 6); }
        r.html = lines.join('\r\n');

        // Decode the TXT file
        lines = txtfile.split('\r\n').join('\n').split('\n');
        r.txtSubject = lines.shift();
        var txtbody = [];
        for (var i in lines) { var line = lines[i]; if ((line.length > 0) && (line[0] == '~')) { txtbody.push(line.substring(1)); } else { txtbody.push(line); } }
        r.txt = txtbody.join('\r\n');

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

    // Keep or remove all lines between two lines with markers
    function strZone(str, marker, keep) {
        var lines = str.split('\r\n'), linesEx = [], removing = false;
        const startMarker = '<area-' + marker + '>', endMarker = '</area-' + marker + '>';
        for (var i in lines) {
            var line = lines[i];
            if (removing) {
                if (line.indexOf(endMarker) >= 0) { removing = false; } else { if (keep) { linesEx.push(line); } }
            } else {
                if (line.indexOf(startMarker) >= 0) { removing = true; } else { linesEx.push(line); }
            }
        }
        return linesEx.join('\r\n');
    }

    // Perform all e-mail substitution
    function mailReplacements(text, domain, options) {
        var httpsport = (typeof obj.parent.args.aliasport == 'number') ? obj.parent.args.aliasport : obj.parent.args.port;
        if (domain.dns == null) {
            // Default domain or subdomain of the default.
            options.serverurl = 'https://' + obj.parent.certificates.CommonName + ':' + httpsport + domain.url;
        } else {
            // Domain with a DNS name.
            options.serverurl = 'https://' + domain.dns + ':' + httpsport + domain.url;
        }
        if (options.serverurl.endsWith('/')) { options.serverurl = options.serverurl.substring(0, options.serverurl.length - 1); } // Remove the ending / if present
        for (var i in options) {
            text = strZone(text, i.toLowerCase(), options[i]); // Adjust this text area
            text = text.split('[[[' + i.toUpperCase() + ']]]').join(options[i]); // Replace this value
        }
        return text;
    }

    // Send a generic email
    obj.sendMail = function (to, subject, text, html) {
        obj.pendingMails.push({ to: to, from: parent.config.smtp.from, subject: subject, text: text, html: html });
        sendNextMail();
    };

    // Send account login mail / 2 factor token
    obj.sendAccountLoginMail = function (domain, email, token, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending login token to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('account-login', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return; 
                }

                // Set all the options.
                var options = { email: email, servername: domain.title ? domain.title : 'MeshCentral', token: token };
                if (loginkey != null) { options.urlargs1 = '?key=' + loginkey; options.urlargs2 = '&key=' + loginkey; } else { options.urlargs1 = ''; options.urlargs2 = ''; }

                // Send the email
                obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send account invitation mail
    obj.sendAccountInviteMail = function (domain, username, accountname, email, password, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending account invitation to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('account-invite', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return;
                }

                // Set all the options.
                var options = { username: username, accountname: accountname, email: email, servername: domain.title ? domain.title : 'MeshCentral', password: password };
                if (loginkey != null) { options.urlargs1 = '?key=' + loginkey; options.urlargs2 = '&key=' + loginkey; } else { options.urlargs1 = ''; options.urlargs2 = ''; }

                // Send the email
                obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send account check mail
    obj.sendAccountCheckMail = function (domain, username, email, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending email verification to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('account-check', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return;
                }

                // Set all the options.
                var options = { username: username, email: email, servername: domain.title ? domain.title : 'MeshCentral' };
                if (loginkey != null) { options.urlargs1 = '?key=' + loginkey; options.urlargs2 = '&key=' + loginkey; } else { options.urlargs1 = ''; options.urlargs2 = ''; }
                options.cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username.toLowerCase(), e: email, a: 1 }, obj.mailCookieEncryptionKey);

                // Send the email
                obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, email, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending account password reset to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('account-reset', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return;
                }

                // Set all the options.
                var options = { username: username, email: email, servername: domain.title ? domain.title : 'MeshCentral' };
                if (loginkey != null) { options.urlargs1 = '?key=' + loginkey; options.urlargs2 = '&key=' + loginkey; } else { options.urlargs1 = ''; options.urlargs2 = ''; }
                options.cookie = obj.parent.encodeCookie({ u: domain.id + '/' + username, e: email, a: 2 }, obj.mailCookieEncryptionKey);

                // Send the email
                obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send agent invite mail
    obj.sendAgentInviteMail = function (domain, username, email, meshid, name, os, msg, flags, expirehours, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending agent install invitation to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('mesh-invite', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return;
                }

                // Set all the template replacement options and generate the final email text (both in txt and html formats).
                var options = { username: username, name: name, email: email, installflags: flags, msg: msg, meshid: meshid, meshidhex: meshid.split('/')[2], servername: domain.title ? domain.title : 'MeshCentral' };
                if (loginkey != null) { options.urlargs1 = '?key=' + loginkey; options.urlargs2 = '&key=' + loginkey; } else { options.urlargs1 = ''; options.urlargs2 = ''; }
                options.windows = ((os == 0) || (os == 1)) ? 1 : 0;
                options.linux = ((os == 0) || (os == 2)) ? 1 : 0;
                options.osx = ((os == 0) || (os == 3)) ? 1 : 0;
                options.link = (os == 4) ? 1 : 0;
                options.linkurl = createInviteLink(domain, meshid, flags, expirehours);

                // Send the email
                obj.pendingMails.push({ to: email, from: parent.config.smtp.from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send out the next mail in the pending list
    function sendNextMail() {
        if ((obj.sendingMail == true) || (obj.pendingMails.length == 0)) { return; }

        var mailToSend = obj.pendingMails[0];
        obj.sendingMail = true;
        parent.debug('email', 'SMTP sending mail to ' + mailToSend.to + '.');
        obj.smtpServer.sendMail(mailToSend, function (err, info) {
            parent.debug('email', 'SMTP response: ' + JSON.stringify(err) + ', ' + JSON.stringify(info));
            obj.sendingMail = false;
            if (err == null) {
                // Send the next mail
                obj.pendingMails.shift();
                obj.retry = 0;
                sendNextMail();
            } else {
                obj.retry++;
                parent.debug('email', 'SMTP server failed (Retry:' + obj.retry + '): ' + JSON.stringify(err));
                console.log('SMTP server failed (Retry:' + obj.retry + '/3): ' + JSON.stringify(err));
                // Wait and try again
                if (obj.retry < 3) {
                    setTimeout(sendNextMail, 10000);
                } else {
                    // Failed, send the next mail
                    parent.debug('email', 'SMTP server failed (Skipping): ' + JSON.stringify(err));
                    console.log('SMTP server failed (Skipping): ' + JSON.stringify(err));
                    obj.pendingMails.shift();
                    obj.retry = 0;
                    sendNextMail();
                }
            }
        });
    }

    // Send out the next mail in the pending list
    obj.verify = function () {
        obj.smtpServer.verify(function (err, info) {
            if (err == null) {
                console.log('SMTP mail server ' + parent.config.smtp.host + ' working as expected.');
            } else {
                // Remove all non-object types from error to avoid a JSON stringify error.
                var err2 = {};
                for (var i in err) { if (typeof (err[i]) != 'object') { err2[i] = err[i]; } }
                parent.debug('email', 'SMTP mail server ' + parent.config.smtp.host + ' failed: ' + JSON.stringify(err2));
                console.log('SMTP mail server ' + parent.config.smtp.host + ' failed: ' + JSON.stringify(err2));
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

    // Check the email domain DNS MX record.
    obj.approvedEmailDomains = {};
    obj.checkEmail = function (email, func) {
        if (parent.config.smtp.verifyemail === false) { func(true); return; }
        var emailSplit = email.split('@');
        if (emailSplit.length != 2) { func(false); return; }
        if (obj.approvedEmailDomains[emailSplit[1]] === true) { func(true); return; }
        require('dns').resolveMx(emailSplit[1], function (err, addresses) {
            parent.debug('email', "checkEmail: " + email + ", " + (err == null));
            if (err == null) { obj.approvedEmailDomains[emailSplit[1]] = true; }
            func(err == null);
        });
    }

    return obj;
};