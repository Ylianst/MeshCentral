/**
* @description Login-token, LDAP and local password authentication
* @license Apache-2.0
*/

'use strict';

module.exports.createPasswordAuthentication = function (options) {
    const obj = options.state;
    const parent = options.parent;
    const db = options.db;
    const assembleStringFromObject = options.assembleStringFromObject;
    const syncExternalUserGroups = options.syncExternalUserGroups;
    const loadModule = options.require || require;

    function authenticate (name, pass, domain, fn) {
        if ((typeof (name) != 'string') || (typeof (pass) != 'string') || (typeof (domain) != 'object')) { fn(new Error('invalid fields')); return; }
        if (name.startsWith('~t:')) {
            // Login token, try to fetch the token from the database
            obj.db.Get('logintoken-' + name, function (err, docs) {
                if (err != null) { fn(err); return; }
                if ((docs == null) || (docs.length != 1)) { fn(new Error('login token not found')); return; }
                const loginToken = docs[0];
                if ((loginToken.expire != 0) && (loginToken.expire < Date.now())) { fn(new Error('login token expired')); return; }

                // Default strong password hashing (pbkdf2 SHA384)
                loadModule('./pass').hash(pass, loginToken.salt, function (err, hash, tag) {
                    if (err) return fn(err);
                    if (hash == loginToken.hash) {
                        // Login username and password are valid.
                        var user = obj.users[loginToken.userid];
                        if (!user) { fn(new Error('cannot find user')); return; }
                        if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }

                        // Successful login token authentication
                        var loginOptions = { tokenName: loginToken.name, tokenUser: loginToken.tokenUser };
                        if (loginToken.expire != 0) { loginOptions.expire = loginToken.expire; }
                        return fn(null, user._id, null, loginOptions);
                    }
                    fn(new Error('invalid password'));
                }, 0);
            });
        } else if (domain.auth == 'ldap') {
            // This method will handle LDAP login
            const ldapHandler = function ldapHandlerFunc(err, xxuser) {
                if (err) { parent.debug('ldap', 'LDAP Error: ' + err); if (ldapHandlerFunc.ldapobj) { try { ldapHandlerFunc.ldapobj.close(); } catch (ex) { console.log(ex); } } fn(new Error('invalid password')); return; }

                // Save this LDAP user to file if needed
                if (typeof domain.ldapsaveusertofile == 'string') {
                    obj.fs.appendFile(domain.ldapsaveusertofile, JSON.stringify(xxuser) + '\r\n\r\n', function (err) { });
                }

                // Work on getting the userid for this LDAP user
                var shortname = null;
                var username = xxuser['displayName'];
                if (typeof domain.ldapusername == 'string') {
                    if (domain.ldapusername.indexOf('{{{') >= 0) { username = assembleStringFromObject(domain.ldapusername, xxuser); } else { username = xxuser[domain.ldapusername]; }
                } else { username = xxuser['displayName'] ? xxuser['displayName'] : xxuser['name']; }
                if (domain.ldapuserbinarykey) {
                    // Use a binary key as the userid
                    if (xxuser[domain.ldapuserbinarykey]) { shortname = Buffer.from(xxuser[domain.ldapuserbinarykey], 'binary').toString('hex').toLowerCase(); }
                } else if (domain.ldapuserkey) {
                    // Use a string key as the userid
                    if (xxuser[domain.ldapuserkey]) { shortname = xxuser[domain.ldapuserkey]; }
                } else {
                    // Use the default key as the userid
                    if (xxuser['objectSid']) { shortname = Buffer.from(xxuser['objectSid'], 'binary').toString('hex').toLowerCase(); }
                    else if (xxuser['objectGUID']) { shortname = Buffer.from(xxuser['objectGUID'], 'binary').toString('hex').toLowerCase(); }
                    else if (xxuser['name']) { shortname = xxuser['name']; }
                    else if (xxuser['cn']) { shortname = xxuser['cn']; }
                }
                if (shortname == null) { fn(new Error('no user identifier')); if (ldapHandlerFunc.ldapobj) { try { ldapHandlerFunc.ldapobj.close(); } catch (ex) { console.log(ex); } } return; }
                if (username == null) { username = shortname; }
                var userid = 'user/' + domain.id + '/' + shortname;

                // Get the list of groups this user is a member of.
                var userMemberships = xxuser[(typeof domain.ldapusergroups == 'string') ? domain.ldapusergroups : 'memberOf'];
                if (typeof userMemberships == 'string') { userMemberships = [userMemberships]; }
                if (Array.isArray(userMemberships) == false) { userMemberships = []; }

                // See if the user is required to be part of an LDAP user group in order to log into this server.
                if (typeof domain.ldapuserrequiredgroupmembership == 'string') { domain.ldapuserrequiredgroupmembership = [domain.ldapuserrequiredgroupmembership]; }
                if (Array.isArray(domain.ldapuserrequiredgroupmembership)) {
                    // Look for a matching LDAP user group
                    var userMembershipMatch = false;
                    for (var i in domain.ldapuserrequiredgroupmembership) { if (userMemberships.indexOf(domain.ldapuserrequiredgroupmembership[i]) >= 0) { userMembershipMatch = true; } }
                    if (userMembershipMatch === false) { parent.authLog('ldapHandler', 'LDAP denying login to a user that is not a member of a LDAP required group.'); fn('denied'); return; } // If there is no match, deny the login
                }

                // Check if user is in an site administrator group
                var siteAdminGroup = null;
                if (typeof domain.ldapsiteadmingroups == 'string') { domain.ldapsiteadmingroups = [domain.ldapsiteadmingroups]; }
                if (Array.isArray(domain.ldapsiteadmingroups)) {
                    siteAdminGroup = false;
                    for (var i in domain.ldapsiteadmingroups) {
                        if (userMemberships.indexOf(domain.ldapsiteadmingroups[i]) >= 0) { siteAdminGroup = domain.ldapsiteadmingroups[i]; }
                    }
                }

                // See if we need to sync LDAP user memberships with user groups
                if (domain.ldapsyncwithusergroups === true) { domain.ldapsyncwithusergroups = {}; }
                if (typeof domain.ldapsyncwithusergroups == 'object') {
                    // LDAP user memberships sync is enabled, see if there are any filters to apply
                    if (typeof domain.ldapsyncwithusergroups.filter == 'string') { domain.ldapsyncwithusergroups.filter = [domain.ldapsyncwithusergroups.filter]; }
                    if (Array.isArray(domain.ldapsyncwithusergroups.filter)) {
                        const g = [];
                        for (var i in userMemberships) {
                            var match = false;
                            for (var j in domain.ldapsyncwithusergroups.filter) {
                                if (userMemberships[i].indexOf(domain.ldapsyncwithusergroups.filter[j]) >= 0) { match = true; }
                            }
                            if (match) { g.push(userMemberships[i]); }
                        }
                        userMemberships = g;
                    }
                } else {
                    // LDAP user memberships sync is disabled, sync the user with empty membership
                    userMemberships = [];
                }

                // Get the email address for this LDAP user
                var email = null;
                if (domain.ldapuseremail) { email = xxuser[domain.ldapuseremail]; } else if (xxuser['mail']) { email = xxuser['mail']; } // Use given field name or default
                if (Array.isArray(email)) { email = email[0]; } // Mail may be multivalued in LDAP in which case, answer is an array. Use the 1st value.
                if (email) { email = email.toLowerCase(); } // it seems some code elsewhere also lowercase the emailaddress, so let's be consistent.

                // Get the real name for this LDAP user
                var realname = null;
                if (typeof domain.ldapuserrealname == 'string') {
                    if (domain.ldapuserrealname.indexOf('{{{') >= 0) { realname = assembleStringFromObject(domain.ldapuserrealname, xxuser); } else { realname = xxuser[domain.ldapuserrealname]; }
                }
                else { if (typeof xxuser['name'] == 'string') { realname = xxuser['name']; } }

                // Get the phone number for this LDAP user
                var phonenumber = null;
                if (domain.ldapuserphonenumber) { phonenumber = xxuser[domain.ldapuserphonenumber]; }
                else { if (typeof xxuser['telephoneNumber'] == 'string') { phonenumber = xxuser['telephoneNumber']; } }

                // Work on getting the image of this LDAP user
                var userimage = null, userImageBuffer = null;
                if (xxuser._raw) { // Using _raw allows us to get data directly as buffer.
                    if (domain.ldapuserimage && xxuser[domain.ldapuserimage]) { userImageBuffer = xxuser._raw[domain.ldapuserimage]; }
                    else if (xxuser['thumbnailPhoto']) { userImageBuffer = xxuser._raw['thumbnailPhoto']; }
                    else if (xxuser['jpegPhoto']) { userImageBuffer = xxuser._raw['jpegPhoto']; }
                    if (userImageBuffer != null) {
                        if ((userImageBuffer[0] == 0xFF) && (userImageBuffer[1] == 0xD8) && (userImageBuffer[2] == 0xFF) && (userImageBuffer[3] == 0xE0)) { userimage = 'data:image/jpeg;base64,' + userImageBuffer.toString('base64'); }
                        if ((userImageBuffer[0] == 0x89) && (userImageBuffer[1] == 0x50) && (userImageBuffer[2] == 0x4E) && (userImageBuffer[3] == 0x47)) { userimage = 'data:image/png;base64,' + userImageBuffer.toString('base64'); }
                    }
                }

                // Display user information extracted from LDAP data
                parent.authLog('ldapHandler', 'LDAP user login, id: ' + shortname + ', username: ' + username + ', email: ' + email + ', realname: ' + realname + ', phone: ' + phonenumber + ', image: ' + (userimage != null));

                // If there is a testing userid, use that
                if (ldapHandlerFunc.ldapShortName) {
                    shortname = ldapHandlerFunc.ldapShortName;
                    userid = 'user/' + domain.id + '/' + shortname;
                }

                // Save the user image
                if (userimage != null) { parent.db.Set({ _id: 'im' + userid, image: userimage }); } else { db.Remove('im' + userid); }

                // Close the LDAP object
                if (ldapHandlerFunc.ldapobj) { try { ldapHandlerFunc.ldapobj.close(); } catch (ex) { console.log(ex); } }

                // Check if the user already exists
                var user = obj.users[userid];
                if (user == null) {
                    // This user does not exist, create a new account.
                    var user = { type: 'user', _id: userid, name: username, creation: Math.floor(Date.now() / 1000), login: Math.floor(Date.now() / 1000), access: Math.floor(Date.now() / 1000), domain: domain.id };
                    if (email) { user['email'] = email; user['emailVerified'] = true; }
                    if (domain.newaccountsrights) { user.siteadmin = domain.newaccountsrights; }
                    if (obj.common.validateStrArray(domain.newaccountrealms)) { user.groups = domain.newaccountrealms; }
                    var usercount = 0;
                    for (var i in obj.users) { if (obj.users[i].domain == domain.id) { usercount++; } }
                    if (usercount == 0) { user.siteadmin = 4294967295; /*if (domain.newaccounts === 2) { delete domain.newaccounts; }*/ } // If this is the first user, give the account site admin.

                    // Auto-join any user groups
                    if (typeof domain.newaccountsusergroups == 'object') {
                        for (var i in domain.newaccountsusergroups) {
                            var ugrpid = domain.newaccountsusergroups[i];
                            if (ugrpid.indexOf('/') < 0) { ugrpid = 'ugrp/' + domain.id + '/' + ugrpid; }
                            var ugroup = obj.userGroups[ugrpid];
                            if (ugroup != null) {
                                // Add group to the user
                                if (user.links == null) { user.links = {}; }
                                user.links[ugroup._id] = { rights: 1 };

                                // Add user to the group
                                ugroup.links[user._id] = { userid: user._id, name: user.name, rights: 1 };
                                db.Set(ugroup);

                                // Notify user group change
                                var event = { etype: 'ugrp', ugrpid: ugroup._id, name: ugroup.name, desc: ugroup.desc, action: 'usergroupchange', links: ugroup.links, msgid: 71, msgArgs: [user.name, ugroup.name], msg: 'Added user ' + user.name + ' to user group ' + ugroup.name, addUserDomain: domain.id };
                                if (db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user group. Another event will come.
                                parent.DispatchEvent(['*', ugroup._id, user._id], obj, event);
                            }
                        }
                    }

                    // Check the user real name
                    if (realname) { user.realname = realname; }

                    // Check the user phone number
                    if (phonenumber) { user.phone = phonenumber; }

                    // Indicate that this user has a image
                    if (userimage != null) { user.flags = 1; }

                    // See if the user is a member of the site admin group.
                    if (typeof siteAdminGroup === 'string') {
                        parent.authLog('ldapHandler', `LDAP: Granting site admin privilages to new user "${user.name}" found in admin group: ${siteAdminGroup}`);
                        user.siteadmin = 0xFFFFFFFF;
                    }

                    // Sync the user with LDAP matching user groups
                    if (syncExternalUserGroups(domain, user, userMemberships, 'ldap') == true) { userChanged = true; }

                    obj.users[user._id] = user;
                    obj.db.SetUser(user);
                    var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountcreate', msgid: 128, msgArgs: [user.name], msg: 'Account created, name is ' + user.name, domain: domain.id };
                    if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to create the user. Another event will come.
                    obj.parent.DispatchEvent(['*', 'server-users'], obj, event);
                    return fn(null, user._id);
                } else {
                    var userChanged = false;

                    // This is an existing user
                    // If the display username has changes, update it.
                    if (user.name != username) { user.name = username; userChanged = true; }

                    // Check if user email has changed
                    if (user.email && !email) { // email unset in ldap => unset
                        delete user.email;
                        delete user.emailVerified;
                        userChanged = true;
                    } else if (user.email != email) { // update email
                        user['email'] = email;
                        user['emailVerified'] = true;
                        userChanged = true;
                    }

                    // Check the user real name
                    if (realname != user.realname) { user.realname = realname; userChanged = true; }

                    // Check the user phone number
                    if (phonenumber != user.phone) { user.phone = phonenumber; userChanged = true; }

                    // Check the user image flag
                    if ((userimage != null) && ((user.flags == null) || ((user.flags & 1) == 0))) { if (user.flags == null) { user.flags = 1; } else { user.flags += 1; } userChanged = true; }
                    if ((userimage == null) && (user.flags != null) && ((user.flags & 1) != 0)) { if (user.flags == 1) { delete user.flags; } else { user.flags -= 1; } userChanged = true; }

                    // See if the user is a member of the site admin group.
                    if ((typeof siteAdminGroup === 'string') && (user.siteadmin !== 0xFFFFFFFF)) {
                        parent.authLog('ldapHandler', `LDAP: Granting site admin privilages to user "${user.name}" found in administrator group: ${siteAdminGroup}`);
                        user.siteadmin = 0xFFFFFFFF;
                        userChanged = true;
                    } else if ((siteAdminGroup === false) && (user.siteadmin === 0xFFFFFFFF)) {
                        parent.authLog('ldapHandler', `LDAP: Revoking site admin privilages from user "${user.name}" since they are not found in any administrator groups.`);
                        delete user.siteadmin;
                        userChanged = true;
                    }

                    // Synd the user with LDAP matching user groups
                    if (syncExternalUserGroups(domain, user, userMemberships, 'ldap') == true) { userChanged = true; }

                    // If the user changed, save the changes to the database here
                    if (userChanged) {
                        obj.db.SetUser(user);
                        var event = { etype: 'user', userid: user._id, username: user.name, account: obj.CloneSafeUser(user), action: 'accountchange', msgid: 154, msg: 'Account changed to sync with LDAP data.', domain: domain.id };
                        if (obj.db.changeStream) { event.noact = 1; } // If DB change stream is active, don't use this event to change the user. Another event will come.
                        parent.DispatchEvent(['*', 'server-users', user._id], obj, event);
                    }

                    // If user is locker out, block here.
                    if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                    return fn(null, user._id);
                }
            }

            if (domain.ldapoptions.url == 'test') {
                // Test LDAP login
                var xxuser = domain.ldapoptions[name.toLowerCase()];
                if (xxuser == null) { fn(new Error('invalid password')); return; } else {
                    ldapHandler.ldapShortName = name.toLowerCase();
                    if (typeof xxuser == 'string') {
                        // The test LDAP user points to a JSON file where the user information is, load it.
                        ldapHandler(null, loadModule(xxuser));
                    } else {
                        // The test user information is in the config.json, use it.
                        ldapHandler(null, xxuser);
                    }
                }
            } else {
                // LDAP login
                var LdapAuth = loadModule('ldapauth-fork');
                if (domain.ldapoptions == null) { domain.ldapoptions = {}; }
                domain.ldapoptions.includeRaw = true; // This allows us to get data as buffers which is useful for images.
                var ldap = new LdapAuth(domain.ldapoptions);
                ldapHandler.ldapobj = ldap;
                ldap.on('error', function (err) { parent.debug('ldap', 'LDAP OnError: ' + err); try { ldap.close(); } catch (ex) { console.log(ex); } }); // Close the LDAP object
                ldap.authenticate(name, pass, ldapHandler);
            }
        } else {
            // Regular login
            var user = obj.users['user/' + domain.id + '/' + name.toLowerCase()];
            // Query the db for the given username
            if (!user) { fn(new Error('cannot find user')); return; }
            // Apply the same algorithm to the POSTed password, applying the hash against the pass / salt, if there is a match we found the user
            if (user.salt == null) {
                fn(new Error('invalid password'));
            } else {
                if (user.passtype != null) {
                    // IIS default clear or weak password hashing (SHA-1)
                    loadModule('./pass').iishash(user.passtype, pass, user.salt, function (err, hash) {
                        if (err) return fn(err);
                        if (hash == user.hash) {
                            // Update the password to the stronger format.
                            loadModule('./pass').hash(pass, function (err, salt, hash, tag) { if (err) throw err; user.salt = salt; user.hash = hash; delete user.passtype; obj.db.SetUser(user); }, 0);
                            if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                            return fn(null, user._id);
                        }
                        fn(new Error('invalid password'), null, user.passhint);
                    });
                } else {
                    // Default strong password hashing (pbkdf2 SHA384)
                    loadModule('./pass').hash(pass, user.salt, function (err, hash, tag) {
                        if (err) return fn(err);
                        if (hash == user.hash) {
                            if ((user.siteadmin) && (user.siteadmin != 0xFFFFFFFF) && (user.siteadmin & 32) != 0) { fn('locked'); return; }
                            return fn(null, user._id);
                        }
                        fn(new Error('invalid password'), null, user.passhint);
                    }, 0);
                }
            }
        }
    };

    return { authenticate: authenticate };
};
