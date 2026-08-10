/**
* @description Authenticated account password management handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createAccountManagement = function (options) {
    const state = options.state;
    const parent = options.parent;
    const checkUserIpAddress = options.checkUserIpAddress;
    const getQueryPortion = options.getQueryPortion;
    const renderRoot = options.renderRoot;
    const hashPassword = options.hashPassword;
    const now = options.now || Date.now;

    function completeRequest(req, res, domain, direct) {
        if (direct === true) { renderRoot(req, res, domain); } else { res.redirect(domain.url + getQueryPortion(req)); }
    }

    function handlePasswordChangeRequest(req, res, direct) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handlePasswordChangeRequest: failed checks (1).'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        if (!req.session || !req.session.userid || !req.body.apassword0 || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.userid.split('/')[1] != domain.id)) {
            parent.debug('web', 'handlePasswordChangeRequest: failed checks (2).');
            completeRequest(req, res, domain, direct);
            return;
        }

        const user = state.users[req.session.userid];
        if (!user) {
            parent.debug('web', 'handlePasswordChangeRequest: user not found.');
            completeRequest(req, res, domain, direct);
            return;
        }
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) {
            parent.debug('web', 'handlePasswordChangeRequest: account settings locked.');
            completeRequest(req, res, domain, direct);
            return;
        }

        state.checkUserPassword(domain, user, req.body.apassword0, function (result) {
            if (result != true) {
                parent.debug('web', 'handlePasswordChangeRequest: invalid current password.');
                completeRequest(req, res, domain, direct);
                return;
            }
            state.checkOldUserPasswords(domain, user, req.body.apassword1, function (passwordResult) {
                if (passwordResult == 1) {
                    parent.debug('web', 'handlePasswordChangeRequest: old password reuse attempt.');
                    completeRequest(req, res, domain, direct);
                } else if (passwordResult == 2) {
                    parent.debug('web', 'handlePasswordChangeRequest: commonly used password use attempt.');
                    completeRequest(req, res, domain, direct);
                } else {
                    hashPassword(req.body.apassword1, function (err, salt, hash) {
                        const nowSeconds = Math.floor(now() / 1000);
                        if (err) { parent.debug('web', 'handlePasswordChangeRequest: hash error.'); throw err; }
                        if (domain.passwordrequirements != null) {
                            if ((domain.passwordrequirements.hint === true) && (req.body.apasswordhint)) {
                                var hint = req.body.apasswordhint;
                                if (hint.length > 250) hint = hint.substring(0, 250);
                                user.passhint = hint;
                            } else {
                                delete user.passhint;
                            }
                            if ((typeof domain.passwordrequirements.oldpasswordban == 'number') && (domain.passwordrequirements.oldpasswordban > 0)) {
                                if (user.oldpasswords == null) user.oldpasswords = [];
                                user.oldpasswords.push({ salt: user.salt, hash: user.hash, start: user.passchange, end: nowSeconds });
                                const extraOldPasswords = user.oldpasswords.length - domain.passwordrequirements.oldpasswordban;
                                if (extraOldPasswords > 0) user.oldpasswords.splice(0, extraOldPasswords);
                            }
                        }
                        user.salt = salt;
                        user.hash = hash;
                        user.passchange = user.access = nowSeconds;
                        delete user.passtype;
                        state.db.SetUser(user);
                        req.session.viewmode = 2;
                        completeRequest(req, res, domain, direct);
                        parent.DispatchEvent(['*', 'server-users'], state, { etype: 'user', userid: user._id, username: user.name, action: 'passchange', msg: 'Account password changed: ' + user.name, domain: domain.id });
                    });
                }
            });
        });
    }

    function handleDeleteAccountRequest(req, res, direct) {
        parent.debug('web', 'handleDeleteAccountRequest()');
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((domain.auth == 'sspi') || (domain.auth == 'ldap')) { parent.debug('web', 'handleDeleteAccountRequest: failed checks.'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
        if (req.session.loginToken != null) { res.sendStatus(404); return; }
        if (req.body == null) { res.sendStatus(404); return; }

        var user = null;
        if (req.body.authcookie) {
            const loginCookie = parent.decodeCookie(req.body.authcookie, parent.loginCookieEncryptionKey, 60);
            if ((loginCookie != null) && (domain.id == loginCookie.domainid)) user = state.users[loginCookie.userid];
        } else {
            if (!req.session || !req.session.userid || !req.body.apassword1 || (req.body.apassword1 != req.body.apassword2) || (req.session.userid.split('/')[1] != domain.id)) {
                parent.debug('web', 'handleDeleteAccountRequest: required parameters not present.');
                completeRequest(req, res, domain, direct);
                return;
            }
            user = state.users[req.session.userid];
        }
        if (!user) { parent.debug('web', 'handleDeleteAccountRequest: user not found.'); res.sendStatus(404); return; }
        if ((user.siteadmin != 0xFFFFFFFF) && ((user.siteadmin & 1024) != 0)) { parent.debug('web', 'handleDeleteAccountRequest: account settings locked.'); res.sendStatus(404); return; }

        state.authenticate(user._id.split('/')[2], req.body.apassword1, domain, function (err, userId) {
            const deletedUser = state.users[userId];
            if ((userId == null) || (deletedUser == null)) {
                parent.debug('web', 'handleDeleteAccountRequest: auth failed.');
                completeRequest(req, res, domain, direct);
                return;
            }

            if (deletedUser.links != null) {
                for (var linkId in deletedUser.links) {
                    if (linkId.startsWith('mesh/')) {
                        const mesh = state.meshes[linkId];
                        if (mesh) {
                            if (mesh.links[deletedUser._id] != null) { delete mesh.links[deletedUser._id]; parent.db.Set(mesh); }
                            const event = { etype: 'mesh', userid: user._id, username: user.name, meshid: mesh._id, name: mesh.name, mtype: mesh.mtype, desc: mesh.desc, action: 'meshchange', links: mesh.links, msg: 'Removed user ' + deletedUser.name + ' from group ' + mesh.name, domain: domain.id, invite: mesh.invite };
                            if (state.db.changeStream) event.noact = 1;
                            parent.DispatchEvent(['*', mesh._id, deletedUser._id, user._id], state, event);
                        }
                    } else if (linkId.startsWith('node/')) {
                        state.GetNodeWithRights(domain, deletedUser, linkId, function (node) {
                            if ((node == null) || (node.links == null) || (node.links[deletedUser._id] == null)) return;
                            delete node.links[deletedUser._id];
                            if (Object.keys(node.links).length == 0) delete node.links;
                            state.db.Set(state.cleanDevice(node));
                            const event = { etype: 'node', userid: user._id, username: user.name, action: 'changenode', nodeid: node._id, domain: domain.id, msg: 'Removed user device rights for ' + node.name, node: state.CloneSafeNode(node) };
                            if (state.db.changeStream) event.noact = 1;
                            parent.DispatchEvent(['*', node.meshid, node._id], state, event);
                        });
                    } else if (linkId.startsWith('ugrp/')) {
                        const userGroup = state.userGroups[linkId];
                        if (userGroup) {
                            if (userGroup.links[deletedUser._id] != null) { delete userGroup.links[deletedUser._id]; parent.db.Set(userGroup); }
                            const event = { etype: 'ugrp', userid: user._id, username: user.name, ugrpid: userGroup._id, name: userGroup.name, desc: userGroup.desc, action: 'usergroupchange', links: userGroup.links, msg: 'Removed user ' + deletedUser.name + ' from user group ' + userGroup.name, addUserDomain: domain.id };
                            if (state.db.changeStream) event.noact = 1;
                            parent.DispatchEvent(['*', userGroup._id, user._id, deletedUser._id], state, event);
                        }
                    }
                }
            }

            state.db.Remove('ws' + deletedUser._id);
            state.db.Remove('nt' + deletedUser._id);
            state.db.Remove('ntp' + deletedUser._id);
            state.db.Remove('im' + deletedUser._id);
            parent.db.GetAllTypeNodeFiltered(['logintoken-' + deletedUser._id], domain.id, 'logintoken', null, function (tokenError, docs) {
                if ((tokenError == null) && (docs != null)) { for (var i = 0; i < docs.length; i++) parent.db.Remove(docs[i]._id, function () { }); }
            });
            try {
                const userPath = state.getServerRootFilePath(deletedUser);
                if (userPath != null) state.deleteFolderRec(userPath);
            } catch (ex) { }
            state.db.Remove(deletedUser._id);
            delete state.users[deletedUser._id];
            req.session = null;
            completeRequest(req, res, domain, direct);
            parent.DispatchEvent(['*', 'server-users'], state, { etype: 'user', userid: deletedUser._id, username: deletedUser.name, action: 'accountremove', msg: 'Account removed', domain: domain.id });
            parent.debug('web', 'handleDeleteAccountRequest: removed user.');
        });
    }

    return { handlePasswordChangeRequest: handlePasswordChangeRequest, handleDeleteAccountRequest: handleDeleteAccountRequest };
};
