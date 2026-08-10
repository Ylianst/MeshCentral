/**
* @description Initial user, device-group and user-group data loading
* @license Apache-2.0
*/

'use strict';

const startupDataValidation = require('./startup-data-validation.js');

module.exports.createStartupDataLoader = function (options) {
    const state = options.state;
    const parent = options.parent;
    const onReady = options.onReady;
    const log = options.log || console.log;
    const debug = function (source, message) { parent.debug(source, message); };

    function loadUserGroups() {
        state.db.GetAllType('ugrp', function (error, documents) {
            if (startupDataValidation.hasStartupDatabaseFailure(error, documents, 'user groups', debug)) { return; }
            state.common.unEscapeAllLinksFieldName(documents);

            for (var index in documents) {
                const userGroup = documents[index];
                if (userGroup.links != null) {
                    for (var linkId in userGroup.links) {
                        if (linkId.startsWith('user/') && (state.users[linkId] == null)) { delete userGroup.links[linkId]; }
                        else if (linkId.startsWith('mesh/') && ((state.meshes[linkId] == null) || (state.meshes[linkId].deleted != null))) { delete userGroup.links[linkId]; }
                    }
                }
                state.userGroups[userGroup._id] = userGroup;
            }

            for (var userGroupId in state.userGroups) {
                const userGroup = state.userGroups[userGroupId];
                if (userGroup.links != null) {
                    for (var userId in userGroup.links) {
                        if (userId.startsWith('user/') && (state.users[userId] != null)) {
                            const user = state.users[userId];
                            if (user.links == null) { user.links = {}; }
                            if (user.links[userGroupId] == null) { user.links[userGroupId] = { rights: userGroup.links[userId].rights || 1 }; }
                        }
                    }
                }
            }

            for (var meshId in state.meshes) {
                const mesh = state.meshes[meshId];
                if (mesh.links != null) {
                    for (var meshLinkId in mesh.links) {
                        if (meshLinkId.startsWith('ugrp/') && (state.userGroups[meshLinkId] == null)) { delete mesh.links[meshLinkId]; }
                        else if (meshLinkId.startsWith('user/') && (state.users[meshLinkId] == null)) { delete mesh.links[meshLinkId]; }
                    }
                }
            }

            for (var loadedUserId in state.users) {
                const loadedUser = state.users[loadedUserId];
                if (loadedUser.links != null) {
                    for (var userLinkId in loadedUser.links) {
                        if (userLinkId.startsWith('ugrp/') && (state.userGroups[userLinkId] == null)) { delete loadedUser.links[userLinkId]; }
                        else if (userLinkId.startsWith('mesh/') && ((state.meshes[userLinkId] == null) || (state.meshes[userLinkId].deleted != null))) { delete loadedUser.links[userLinkId]; }
                    }
                }
            }
            onReady();
        });
    }

    function loadMeshes() {
        state.db.GetAllType('mesh', function (error, documents) {
            if (startupDataValidation.hasStartupDatabaseFailure(error, documents, 'meshes', debug)) { return; }
            state.common.unEscapeAllLinksFieldName(documents);
            for (var index in documents) { state.meshes[documents[index]._id] = documents[index]; }
            loadUserGroups();
        });
    }

    function load() {
        state.db.GetAllType('user', function (error, documents) {
            if (startupDataValidation.hasStartupDatabaseFailure(error, documents, 'users', debug)) { return; }
            state.common.unEscapeAllLinksFieldName(documents);
            const domainUserCount = {};
            for (var domainId in parent.config.domains) { domainUserCount[domainId] = 0; }
            for (var index in documents) {
                const user = state.users[documents[index]._id] = documents[index];
                domainUserCount[user.domain]++;
            }
            for (var configuredDomainId in parent.config.domains) {
                if ((parent.config.domains[configuredDomainId].share == null) && (domainUserCount[configuredDomainId] == 0)) {
                    log('Server ' + ((configuredDomainId == '') ? '' : (configuredDomainId + ' ')) + 'has no users, next new account will be site administrator.');
                }
            }
            loadMeshes();
        });
    }

    return { load: load };
};
