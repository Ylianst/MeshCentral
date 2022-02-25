/**
* @description MeshCentral e-mail server communication modules
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

// TODO: Add NTML support with "nodemailer-ntlm-auth" https://github.com/nodemailer/nodemailer-ntlm-auth

// Construct a MeshAgent object, called upon connection
module.exports.CreateMeshMail = function (parent, domain) {
    var obj = {};
    obj.pendingMails = [];
    obj.parent = parent;
    obj.retry = 0;
    obj.sendingMail = false;
    obj.mailCookieEncryptionKey = null;
    obj.verifyemail = false;
    obj.domain = domain;
    //obj.mailTemplates = {};
    const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const constants = (obj.parent.crypto.constants ? obj.parent.crypto.constants : require('constants')); // require('constants') is deprecated in Node 11.10, use require('crypto').constants instead.

    function EscapeHtml(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }
    //function EscapeHtmlBreaks(x) { if (typeof x == "string") return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == "boolean") return x; if (typeof x == "number") return x; }

    // Setup where we read our configuration from
    if (obj.domain == null) { obj.config = parent.config; } else { obj.config = domain; }

    if (obj.config.sendgrid != null) {
        // Setup SendGrid mail server
        obj.sendGridServer = require('@sendgrid/mail');
        obj.sendGridServer.setApiKey(obj.config.sendgrid.apikey);
        if (obj.config.sendgrid.verifyemail == true) { obj.verifyemail = true; }
    } else if (obj.config.smtp != null) {
        // Setup SMTP mail server
        const nodemailer = require('nodemailer');
        var options = { host: obj.config.smtp.host, secure: (obj.config.smtp.tls == true), tls: {} };
        //var options = { host: obj.config.smtp.host, secure: (obj.config.smtp.tls == true), tls: { secureProtocol: 'SSLv23_method', ciphers: 'RSA+AES:!aNULL:!MD5:!DSS', secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE, rejectUnauthorized: false } };
        if (obj.config.smtp.port != null) { options.port = obj.config.smtp.port; }
        if (obj.config.smtp.tlscertcheck === false) { options.tls.rejectUnauthorized = false; }
        if (obj.config.smtp.tlsstrict === true) { options.tls.secureProtocol = 'SSLv23_method'; options.tls.ciphers = 'RSA+AES:!aNULL:!MD5:!DSS'; options.tls.secureOptions = constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_COMPRESSION | constants.SSL_OP_CIPHER_SERVER_PREFERENCE; }
        if ((obj.config.smtp.user != null) && (obj.config.smtp.pass != null)) { options.auth = { user: obj.config.smtp.user, pass: obj.config.smtp.pass }; }
        if (obj.config.smtp.verifyemail == true) { obj.verifyemail = true; }
        obj.smtpServer = nodemailer.createTransport(options);
    } else if (obj.config.sendmail != null) {
        // Setup Sendmail
        const nodemailer = require('nodemailer');
        var options = { sendmail: true };
        if (typeof obj.config.sendmail.newline == 'string') { options.newline = obj.config.sendmail.newline; }
        if (typeof obj.config.sendmail.path == 'string') { options.path = obj.config.sendmail.path; }
        if (Array.isArray(obj.config.sendmail.args)) { options.args = obj.config.sendmail.args; }
        obj.smtpServer = nodemailer.createTransport(options);
    }

    // Get the correct mail template object
    function getTemplate(name, domain, lang) {
        parent.debug('email', 'Getting mail template for: ' + name + ', lang: ' + lang);
        if (Array.isArray(lang)) { lang = lang[0]; } // TODO: For now, we only use the first language given.
        if (lang != null) { lang = lang.split('-')[0]; } // Take the first part of the language, "xx-xx"

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
        if (obj.config.sendgrid != null) {
            obj.pendingMails.push({ to: to, from: obj.config.sendgrid.from, subject: subject, text: text, html: html });
        } else if (obj.config.smtp != null) {
            obj.pendingMails.push({ to: to, from: obj.config.smtp.from, subject: subject, text: text, html: html });
        }
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

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
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

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send account check mail
    obj.sendAccountCheckMail = function (domain, username, userid, email, language, loginkey) {
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
                options.cookie = obj.parent.encodeCookie({ u: userid, e: email, a: 1 }, obj.mailCookieEncryptionKey);

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send account reset mail
    obj.sendAccountResetMail = function (domain, username, userid, email, language, loginkey) {
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
                options.cookie = obj.parent.encodeCookie({ u: userid, e: email, a: 2 }, obj.mailCookieEncryptionKey);

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
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
                options.assistant = ((os == 0) || (os == 5)) ? 1 : 0;
                options.osx = ((os == 0) || (os == 3)) ? 1 : 0;
                options.link = (os == 4) ? 1 : 0;
                options.linkurl = createInviteLink(domain, meshid, flags, expirehours);

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, options), text: mailReplacements(template.txt, domain, options), html: mailReplacements(template.html, domain, options) });
                sendNextMail();
            }
        });
    };

    // Send device connect/disconnect notification mail
    obj.sendDeviceNotifyMail = function (domain, username, email, connections, disconnections, language, loginkey) {
        obj.checkEmail(email, function (checked) {
            if (checked) {
                parent.debug('email', "Sending device notification to " + email);

                if ((parent.certificates == null) || (parent.certificates.CommonName == null) || (parent.certificates.CommonName.indexOf('.') == -1)) {
                    parent.debug('email', "Error: Server name not set."); // If the server name is not set, email not possible.
                    return;
                }

                var template = getTemplate('device-notify', domain, language);
                if ((template == null) || (template.htmlSubject == null) || (template.txtSubject == null)) {
                    parent.debug('email', "Error: Failed to get mail template."); // No email template found
                    return;
                }

                // Set all the template replacement options and generate the final email text (both in txt and html formats).
                var optionsHtml = { username: username, email: email, servername: domain.title ? domain.title : 'MeshCentral', header: true, footer: false };
                var optionsTxt = { username: username, email: email, servername: domain.title ? domain.title : 'MeshCentral', header: true, footer: false };
                if ((connections == null) || (connections.length == 0)) {
                    optionsHtml.connections = false;
                    optionsTxt.connections = false;
                } else {
                    optionsHtml.connections = connections.join('<br />\r\n');
                    optionsTxt.connections = connections.join('\r\n');
                }
                if ((disconnections == null) || (disconnections.length == 0)) {
                    optionsHtml.disconnections = false;
                    optionsTxt.disconnections = false;
                } else {
                    optionsHtml.disconnections = disconnections.join('<br />\r\n');
                    optionsTxt.disconnections = disconnections.join('\r\n');
                }

                // Get from field
                var from = null;
                if (obj.config.sendgrid && (typeof obj.config.sendgrid.from == 'string')) { from = obj.config.sendgrid.from; }
                else if (obj.config.smtp && (typeof obj.config.smtp.from == 'string')) { from = obj.config.smtp.from; }

                // Send the email
                obj.pendingMails.push({ to: email, from: from, subject: mailReplacements(template.htmlSubject, domain, optionsTxt), text: mailReplacements(template.txt, domain, optionsTxt), html: mailReplacements(template.html, domain, optionsHtml) });
                sendNextMail();
            }
        });
    };

    // Send out the next mail in the pending list
    function sendNextMail() {
        if ((obj.sendingMail == true) || (obj.pendingMails.length == 0)) { return; }

        var mailToSend = obj.pendingMails[0];
        obj.sendingMail = true;

        if (obj.sendGridServer != null) {
            // SendGrid send
            parent.debug('email', 'SendGrid sending mail to ' + mailToSend.to + '.');
            obj.sendGridServer
                .send(mailToSend)
                .then(function () {
                    obj.sendingMail = false;
                    parent.debug('email', 'SendGrid sending success.');
                    obj.pendingMails.shift();
                    obj.retry = 0;
                    sendNextMail();
                }, function (error) {
                    obj.sendingMail = false;
                    parent.debug('email', 'SendGrid sending error: ' + JSON.stringify(error));
                    obj.retry++;
                    // Wait and try again
                    if (obj.retry < 3) {
                        setTimeout(sendNextMail, 10000);
                    } else {
                        // Failed, send the next mail
                        parent.debug('email', 'SendGrid server failed (Skipping): ' + JSON.stringify(err));
                        console.log('SendGrid server failed (Skipping): ' + JSON.stringify(err));
                        obj.pendingMails.shift();
                        obj.retry = 0;
                        sendNextMail();
                    }
                });
        } else if (obj.smtpServer != null) {
            // SMTP send
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
    }

    // Send out the next mail in the pending list
    obj.verify = function () {
        if (obj.smtpServer == null) return;
        obj.smtpServer.verify(function (err, info) {
            if (err == null) {
                console.log('SMTP mail server ' + obj.config.smtp.host + ' working as expected.');
            } else {
                // Remove all non-object types from error to avoid a JSON stringify error.
                var err2 = {};
                for (var i in err) { if (typeof (err[i]) != 'object') { err2[i] = err[i]; } }
                parent.debug('email', 'SMTP mail server ' + obj.config.smtp.host + ' failed: ' + JSON.stringify(err2));
                console.log('SMTP mail server ' + obj.config.smtp.host + ' failed: ' + JSON.stringify(err2));
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
        if (obj.verifyemail == false) { func(true); return; }
        var emailSplit = email.split('@');
        if (emailSplit.length != 2) { func(false); return; }
        if (obj.approvedEmailDomains[emailSplit[1]] === true) { func(true); return; }
        require('dns').resolveMx(emailSplit[1], function (err, addresses) {
            parent.debug('email', "checkEmail: " + email + ", " + (err == null));
            if (err == null) { obj.approvedEmailDomains[emailSplit[1]] = true; }
            func(err == null);
        });
    }

    //
    // Device connetion and disconnection notifications
    //

    obj.deviceNotifications = {}; // UserId --> { timer, nodes: nodeid --> connectType }

    // A device connected and a user needs to be notified about it.
    obj.notifyDeviceConnect = function (user, meshid, nodeid, connectTime, connectType, powerState, serverid, extraInfo) {
        const mesh = parent.webserver.meshes[meshid];
        if (mesh == null) return;

        // Add the user and start a timer
        if (obj.deviceNotifications[user._id] == null) {
            obj.deviceNotifications[user._id] = { nodes: {} };
            obj.deviceNotifications[user._id].timer = setTimeout(function () { sendDeviceNotifications(user._id); }, 5 * 60 * 1000); // 5 minute before email is sent
        }

        // Add the device
        if (obj.deviceNotifications[user._id].nodes[nodeid] == null) {
            obj.deviceNotifications[user._id].nodes[nodeid] = { c: connectType }; // This device connection need to be added
        } else {
            const info = obj.deviceNotifications[user._id].nodes[nodeid];
            if ((info.d != null) && ((info.d & connectType) != 0)) {
                info.d -= connectType; // This device disconnect cancels out a device connection
                if (((info.c == null) || (info.c == 0)) && ((info.d == null) || (info.d == 0))) {
                    // This device no longer needs a notification
                    delete obj.deviceNotifications[user._id].nodes[nodeid];
                    if (Object.keys(obj.deviceNotifications[user._id].nodes).length == 0) {
                        // This user no longer needs a notification
                        clearTimeout(obj.deviceNotifications[user._id].timer);
                        delete obj.deviceNotifications[user._id];
                    }
                    return;
                }
            } else {
                if (info.c != null) {
                    info.c |= connectType; // This device disconnect needs to be added
                } else {
                    info.c = connectType; // This device disconnect needs to be added
                }
            }
        }

        // Set the device group name
        if ((extraInfo != null) && (extraInfo.name != null)) { obj.deviceNotifications[user._id].nodes[nodeid].nn = extraInfo.name; }
        obj.deviceNotifications[user._id].nodes[nodeid].mn = mesh.name;
    }

    // Cancel a device disconnect notification
    obj.cancelNotifyDeviceDisconnect = function (user, meshid, nodeid, connectTime, connectType, powerState, serverid, extraInfo) {
        const mesh = parent.webserver.meshes[meshid];
        if (mesh == null) return;

        if ((obj.deviceNotifications[user._id] != null) && (obj.deviceNotifications[user._id].nodes[nodeid] != null)) {
            const info = obj.deviceNotifications[user._id].nodes[nodeid];
            if ((info.d != null) && ((info.d & connectType) != 0)) {
                info.d -= connectType; // This device disconnect cancels out a device connection
                if (((info.c == null) || (info.c == 0)) && ((info.d == null) || (info.d == 0))) {
                    // This device no longer needs a notification
                    delete obj.deviceNotifications[user._id].nodes[nodeid];
                    if (Object.keys(obj.deviceNotifications[user._id].nodes).length == 0) {
                        // This user no longer needs a notification
                        clearTimeout(obj.deviceNotifications[user._id].timer);
                        delete obj.deviceNotifications[user._id];
                    }
                }
            }
        }
    }

    // A device disconnected and a user needs to be notified about it.
    obj.notifyDeviceDisconnect = function (user, meshid, nodeid, connectTime, connectType, powerState, serverid, extraInfo) {
        const mesh = parent.webserver.meshes[meshid];
        if (mesh == null) return;

        // Add the user and start a timer
        if (obj.deviceNotifications[user._id] == null) {
            obj.deviceNotifications[user._id] = { nodes: {} };
            obj.deviceNotifications[user._id].timer = setTimeout(function () { sendDeviceNotifications(user._id); }, 5 * 60 * 1000); // 5 minute before email is sent
        }

        // Add the device
        if (obj.deviceNotifications[user._id].nodes[nodeid] == null) {
            obj.deviceNotifications[user._id].nodes[nodeid] = { d: connectType }; // This device disconnect need to be added
        } else {
            const info = obj.deviceNotifications[user._id].nodes[nodeid];
            if ((info.c != null) && ((info.c & connectType) != 0)) {
                info.c -= connectType; // This device disconnect cancels out a device connection
                if (((info.d == null) || (info.d == 0)) && ((info.c == null) || (info.c == 0))) {
                    // This device no longer needs a notification
                    delete obj.deviceNotifications[user._id].nodes[nodeid];
                    if (Object.keys(obj.deviceNotifications[user._id].nodes).length == 0) {
                        // This user no longer needs a notification
                        clearTimeout(obj.deviceNotifications[user._id].timer);
                        delete obj.deviceNotifications[user._id];
                    }
                    return;
                }
            } else {
                if (info.d != null) {
                    info.d |= connectType; // This device disconnect needs to be added
                } else {
                    info.d = connectType; // This device disconnect needs to be added
                }
            }
        }

        // Set the device group name
        if ((extraInfo != null) && (extraInfo.name != null)) { obj.deviceNotifications[user._id].nodes[nodeid].nn = extraInfo.name; }
        obj.deviceNotifications[user._id].nodes[nodeid].mn = mesh.name;
    }

    // Cancel a device connect notification
    obj.cancelNotifyDeviceConnect = function (user, meshid, nodeid, connectTime, connectType, powerState, serverid, extraInfo) {
        const mesh = parent.webserver.meshes[meshid];
        if (mesh == null) return;

        if ((obj.deviceNotifications[user._id] != null) && (obj.deviceNotifications[user._id].nodes[nodeid] != null)) {
            const info = obj.deviceNotifications[user._id].nodes[nodeid];
            if ((info.c != null) && ((info.c & connectType) != 0)) {
                info.c -= connectType; // This device disconnect cancels out a device connection
                if (((info.d == null) || (info.d == 0)) && ((info.c == null) || (info.c == 0))) {
                    // This device no longer needs a notification
                    delete obj.deviceNotifications[user._id].nodes[nodeid];
                    if (Object.keys(obj.deviceNotifications[user._id].nodes).length == 0) {
                        // This user no longer needs a notification
                        clearTimeout(obj.deviceNotifications[user._id].timer);
                        delete obj.deviceNotifications[user._id];
                    }
                }
            }
        }
    }

    // Send a notification about device connections and disconnections to a user
    function sendDeviceNotifications(userid) {
        if (obj.deviceNotifications[userid] == null) return;
        clearTimeout(obj.deviceNotifications[userid].timer);

        var connections = [];
        var disconnections = [];

        for (var nodeid in obj.deviceNotifications[userid].nodes) {
            var info = obj.deviceNotifications[userid].nodes[nodeid];
            if ((info.c != null) && (info.c > 0) && (info.nn != null) && (info.mn != null)) {
                var c = [];
                if (info.c & 1) { c.push("Agent"); }
                if (info.c & 2) { c.push("CIRA"); }
                if (info.c & 4) { c.push("AMT"); }
                if (info.c & 8) { c.push("AMT-Relay"); }
                if (info.c & 16) { c.push("MQTT"); }
                connections.push(info.mn + ', ' + info.nn + ': ' + c.join(', '));
            }
            if ((info.d != null) && (info.d > 0) && (info.nn != null) && (info.mn != null)) {
                var d = [];
                if (info.d & 1) { d.push("Agent"); }
                if (info.d & 2) { d.push("CIRA"); }
                if (info.d & 4) { d.push("AMT"); }
                if (info.d & 8) { d.push("AMT-Relay"); }
                if (info.d & 16) { d.push("MQTT"); }
                disconnections.push(info.mn + ', ' + info.nn + ': ' + d.join(', '));
            }
        }

        // Sort the notifications
        connections.sort(sortCollator.compare);
        disconnections.sort(sortCollator.compare);

        // Get the user and domain
        const user = parent.webserver.users[userid];
        if ((user == null) || (user.email == null) || (user.emailVerified !== true)) return;
        const domain = obj.parent.config.domains[user.domain];
        if (domain == null) return;

        // Send the email
        obj.sendDeviceNotifyMail(domain, user.name, user.email, connections, disconnections, user.llang, null);

        // Clean up
        delete obj.deviceNotifications[userid];
    }

    return obj;
};