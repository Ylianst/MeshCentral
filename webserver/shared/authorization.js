/**
* @description MeshCentral web server authorization helpers
* @license Apache-2.0
*/

"use strict";

module.exports.createAuthorization = function (options) {
    const api = {};
    const db = options.db;
    const common = options.common;
    const config = options.config;
    const users = options.users;
    const meshes = options.meshes;
    const userGroups = options.userGroups;

    function isManageAllDeviceGroupsUser(user) {
        const manageAllDeviceGroups = config.settings.managealldevicegroups;
        return (user.siteadmin == 0xFFFFFFFF) && ((manageAllDeviceGroups.indexOf(user._id) >= 0) || (user.links && Object.keys(user.links).some(function (key) { return manageAllDeviceGroups.indexOf(key) >= 0; })));
    }

    // Apply account-level restrictions to the rights granted by devices and groups.
    function removeUserRights(rights, user) {
        if (user.removeRights == null) return rights;
        var add = 0, substract = 0;
        if ((user.removeRights & 0x00000008) != 0) { substract += 0x00000008; } // No Remote Control
        if ((user.removeRights & 0x00010000) != 0) { add += 0x00010000; } // No Desktop
        if ((user.removeRights & 0x00000100) != 0) { add += 0x00000100; } // Desktop View Only
        if ((user.removeRights & 0x00000200) != 0) { add += 0x00000200; } // No Terminal
        if ((user.removeRights & 0x00000400) != 0) { add += 0x00000400; } // No Files
        if ((user.removeRights & 0x00400000) != 0) { add += 0x00400000; } // No Registry
        if ((user.removeRights & 0x00800000) != 0) { add += 0x00800000; } // No Software
        if ((user.removeRights & 0x00000010) != 0) { substract += 0x00000010; } // No Console
        if ((user.removeRights & 0x00008000) != 0) { substract += 0x00008000; } // No Uninstall
        if ((user.removeRights & 0x00020000) != 0) { substract += 0x00020000; } // No Remote Command
        if ((user.removeRights & 0x00000040) != 0) { substract += 0x00000040; } // No Wake
        if ((user.removeRights & 0x00040000) != 0) { substract += 0x00040000; } // No Reset/Off
        if (rights != 0xFFFFFFFF) {
            rights |= add;
            rights &= (0xFFFFFFFF - substract);
        } else {
            rights = 1 + 2 + 4 + 8 + 32 + 64 + 128 + 16384 + 32768 + 131072 + 262144 + 524288 + 1048576;
            rights |= add;
            rights &= (0xFFFFFFFF - substract);
        }
        return rights;
    }

    api.GetNodesWithRights = function (domain, user, nodeids, func) {
        var rc = nodeids.length, r = {};
        for (var i in nodeids) {
            api.GetNodeWithRights(domain, user, nodeids[i], function (node, rights, visible) {
                if ((node != null) && (visible == true)) { r[node._id] = { node: node, rights: rights }; if (--rc == 0) { func(r); } }
            });
        }
    };

    api.GetNodeWithRights = function (domain, user, nodeid, func) {
        if ((user == null) || (nodeid == null)) { func(null, 0, false); return; }
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { func(null, 0, false); return; }

        if (common.validateString(nodeid, 0, 128) == false) { func(null, 0, false); return; }
        const snode = nodeid.split('/');
        if ((snode.length != 3) || (snode[0] != 'node')) { func(null, 0, false); return; }
        if ((domain != null) && (snode[1] != domain.id)) { func(null, 0, false); return; }

        db.Get(nodeid, function (err, nodes) {
            if ((nodes == null) || (nodes.length != 1)) { func(null, 0, false); return; }
            if (isManageAllDeviceGroupsUser(user) && (nodes[0].domain == user.domain)) {
                func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return;
            }
            if (user.links == null) { func(null, 0, false); return; }

            var rights = 0, visible = false, r = user.links[nodeid];
            if (r != null) {
                if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; }
                rights |= r.rights;
                visible = true;
            }

            r = user.links[nodes[0].meshid];
            if (r != null) {
                if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; }
                rights |= r.rights;
                visible = true;
            }

            for (var i in user.links) {
                if (i.startsWith('ugrp/')) {
                    const g = userGroups[i];
                    if (g && (g.links != null)) {
                        r = g.links[nodes[0].meshid];
                        if (r != null) {
                            if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; }
                            rights |= r.rights;
                            visible = true;
                        }
                        r = g.links[nodeid];
                        if (r != null) {
                            if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; }
                            rights |= r.rights;
                            visible = true;
                        }
                    }
                }
            }

            rights = removeUserRights(rights, user);
            func(nodes[0], rights, visible);
        });
    };

    api.GetAllMeshWithRights = function (user, rights) {
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return []; }

        var r = [];
        if (isManageAllDeviceGroupsUser(user)) {
            var meshStartStr = 'mesh/' + user.domain + '/';
            for (var i in meshes) { if ((meshes[i]._id.startsWith(meshStartStr)) && (meshes[i].deleted == null)) { r.push(meshes[i]); } }
            return r;
        }
        if (user.links == null) { return []; }
        for (var i in user.links) {
            if (i.startsWith('mesh/')) {
                const m = meshes[i];
                if ((m) && (r.indexOf(m) == -1) && (m.deleted == null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) { r.push(m); }
            } else if (i.startsWith('ugrp/')) {
                const g = userGroups[i];
                for (var j in g.links) {
                    if (j.startsWith('mesh/') && ((rights == null) || ((g.links[j].rights != null) && (g.links[j].rights & rights) != 0))) {
                        const m = meshes[j];
                        if ((m) && (m.deleted == null) && (r.indexOf(m) == -1)) { r.push(m); }
                    }
                }
            }
        }
        return r;
    };

    api.GetAllMeshIdWithRights = function (user, rights) {
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return []; }
        var r = [];
        if (isManageAllDeviceGroupsUser(user)) {
            var meshStartStr = 'mesh/' + user.domain + '/';
            for (var i in meshes) { if ((meshes[i]._id.startsWith(meshStartStr)) && (meshes[i].deleted == null)) { r.push(meshes[i]._id); } }
            return r;
        }
        if (user.links == null) { return []; }
        for (var i in user.links) {
            if (i.startsWith('mesh/')) {
                const m = meshes[i];
                if ((m) && (m.deleted == null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) {
                    if (r.indexOf(m._id) == -1) { r.push(m._id); }
                }
            } else if (i.startsWith('ugrp/')) {
                const g = userGroups[i];
                if (g && (g.links != null) && ((rights == null) || ((user.links[i].rights & rights) != 0))) {
                    for (var j in g.links) {
                        if (j.startsWith('mesh/')) {
                            const m = meshes[j];
                            if ((m) && (m.deleted == null) && (r.indexOf(m._id) == -1)) { r.push(m._id); }
                        }
                    }
                }
            }
        }
        return r;
    };

    api.GetMeshRights = function (user, mesh) {
        if ((user == null) || (mesh == null)) { return 0; }
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return 0; }
        var r, meshid;
        if (typeof mesh == 'string') {
            meshid = mesh;
        } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) {
            meshid = mesh._id;
        } else return 0;

        if (isManageAllDeviceGroupsUser(user) && (meshid.startsWith('mesh/' + user.domain + '/'))) { return removeUserRights(0xFFFFFFFF, user); }
        if (user.links == null) return 0;
        var rights = 0;
        r = user.links[meshid];
        if (r != null) {
            rights = r.rights;
            if (rights == 0xFFFFFFFF) { return removeUserRights(rights, user); }
        }

        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = userGroups[i];
                if (g) {
                    r = g.links[meshid];
                    if (r != null) {
                        if (r.rights == 0xFFFFFFFF) {
                            return removeUserRights(r.rights, user);
                        } else {
                            rights |= r.rights;
                        }
                    }
                }
            }
        }
        return removeUserRights(rights, user);
    };

    api.IsMeshViewable = function (user, mesh) {
        if ((user == null) || (mesh == null)) { return false; }
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return false; }
        var meshid;
        if (typeof mesh == 'string') {
            meshid = mesh;
        } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) {
            meshid = mesh._id;
        } else return false;

        if (isManageAllDeviceGroupsUser(user) && (meshid.startsWith('mesh/' + user.domain + '/'))) { return true; }
        if (user.links == null) { return false; }
        if (user.links[meshid] != null) { return true; }
        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = userGroups[i];
                if (g && (g.links[meshid] != null)) { return true; }
            }
        }
        return false;
    };

    var getNodeRightsCache = {};
    var getNodeRightsCacheCount = 0;

    api.GetNodeRights = function (user, mesh, nodeid) {
        if ((user == null) || (mesh == null) || (nodeid == null)) { return 0; }
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return 0; }
        var meshid;
        if (typeof mesh == 'string') { meshid = mesh; } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) { meshid = mesh._id; } else return 0;

        const cache = ((getNodeRightsCache[user._id] || {})[meshid] || {})[nodeid];
        if (cache != null) { if (cache.t > Date.now()) { return cache.o; } else { getNodeRightsCacheCount--; } }
        if (getNodeRightsCacheCount > 2000) { api.FlushGetNodeRightsCache(); }

        var r = api.GetMeshRights(user, mesh);
        if (r == 0xFFFFFFFF) {
            const out = removeUserRights(r, user);
            cacheNodeRights(user._id, meshid, nodeid, out);
            return out;
        }

        if ((user.links != null) && (user.links[nodeid] != null)) { r |= user.links[nodeid].rights; }
        if (r == 0xFFFFFFFF) {
            const out = removeUserRights(r, user);
            cacheNodeRights(user._id, meshid, nodeid, out);
            return out;
        }

        for (var i in user.links) {
            if (i.startsWith('ugrp')) {
                const g = userGroups[i];
                if (g && (g.links[nodeid] != null)) { r |= g.links[nodeid].rights; }
            }
        }

        const out = removeUserRights(r, user);
        cacheNodeRights(user._id, meshid, nodeid, out);
        return out;
    };

    function cacheNodeRights(userid, meshid, nodeid, rights) {
        getNodeRightsCache[userid] = getNodeRightsCache[userid] || {};
        getNodeRightsCache[userid][meshid] = getNodeRightsCache[userid][meshid] || {};
        getNodeRightsCache[userid][meshid][nodeid] = { t: Date.now() + 10000, o: rights };
        getNodeRightsCacheCount++;
    }

    api.InvalidateNodeCache = function (user, mesh, nodeid) {
        if (user == null) { return; }
        if (typeof user == 'string') { user = users[user]; }
        if (user == null) { return 0; }
        var meshid;
        if (typeof mesh == 'string') { meshid = mesh; } else if ((typeof mesh == 'object') && (typeof mesh._id == 'string')) { meshid = mesh._id; }

        if (mesh == null) {
            for (const val of Object.values(getNodeRightsCache[user._id] || {})) { getNodeRightsCacheCount -= Object.keys(val).length; }
            delete getNodeRightsCache[user._id];
            return;
        }
        if (nodeid == null) {
            const cacheReduction = Object.keys((getNodeRightsCache[user._id] || {})[meshid] || {}).length;
            delete (getNodeRightsCache[user._id] || {})[meshid];
            getNodeRightsCacheCount -= cacheReduction;
            return;
        }
        if (((getNodeRightsCache[user._id] || {})[meshid] || {})[nodeid]) {
            delete ((getNodeRightsCache[user._id] || {})[meshid] || {})[nodeid];
            getNodeRightsCacheCount--;
        }
    };

    api.FlushGetNodeRightsCache = function () {
        getNodeRightsCache = {};
        getNodeRightsCacheCount = 0;
    };

    api.CreateMeshDispatchTargets = function (mesh, addedTargets) {
        var targets = (addedTargets != null) ? addedTargets : [];
        if (targets.indexOf('*') == -1) { targets.push('*'); }
        if (typeof mesh == 'string') { mesh = meshes[mesh]; }
        if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
        return targets;
    };

    api.CreateNodeDispatchTargets = function (mesh, nodeid, addedTargets) {
        var targets = (addedTargets != null) ? addedTargets : [];
        targets.push(nodeid);
        if (targets.indexOf('*') == -1) { targets.push('*'); }
        if (typeof mesh == 'string') { mesh = meshes[mesh]; }
        if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
        for (var i in userGroups) { const g = userGroups[i]; if ((g != null) && (g.links != null) && (g.links[nodeid] != null)) { targets.push(i); } }
        return targets;
    };

    return api;
};
