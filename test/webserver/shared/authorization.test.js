/**
* @description Characterization tests for web server authorization
* @license Apache-2.0
*/

"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const createAuthorization = require('../../../webserver/shared/authorization.js').createAuthorization;

function createFixture() {
    const meshid = 'mesh/domain/one';
    const secondMeshid = 'mesh/domain/two';
    const deletedMeshid = 'mesh/domain/deleted';
    const nodeid = 'node/domain/one';
    const groupid = 'ugrp/domain/operators';
    const userid = 'user/domain/alice';
    const users = {};
    const meshes = {};
    const userGroups = {};

    users[userid] = {
        _id: userid,
        domain: 'domain',
        siteadmin: 0,
        links: {}
    };
    users[userid].links[meshid] = { rights: 1 };
    users[userid].links[nodeid] = { rights: 2 };
    users[userid].links[groupid] = { rights: 1 };

    meshes[meshid] = { _id: meshid, links: {} };
    meshes[meshid].links[groupid] = { rights: 4 };
    meshes[secondMeshid] = { _id: secondMeshid, links: {} };
    meshes[deletedMeshid] = { _id: deletedMeshid, links: {}, deleted: 1 };

    userGroups[groupid] = { _id: groupid, links: {} };
    userGroups[groupid].links[meshid] = { rights: 4 };
    userGroups[groupid].links[secondMeshid] = { rights: 4 };
    userGroups[groupid].links[nodeid] = { rights: 8 };

    const node = { _id: nodeid, domain: 'domain', meshid: meshid };
    const db = {
        Get: function (id, callback) {
            callback(null, id == nodeid ? [node] : []);
        }
    };
    const common = {
        validateString: function (value, min, max) {
            return (typeof value == 'string') && (value.length >= min) && (value.length <= max);
        }
    };
    const config = { settings: { managealldevicegroups: [] } };
    const authorization = createAuthorization({ db: db, common: common, config: config, users: users, meshes: meshes, userGroups: userGroups });

    return { authorization: authorization, config: config, users: users, meshes: meshes, userGroups: userGroups, user: users[userid], node: node, userid: userid, meshid: meshid, secondMeshid: secondMeshid, nodeid: nodeid, groupid: groupid };
}

test('GetMeshRights combines direct and user-group permissions', function () {
    const fixture = createFixture();

    assert.equal(fixture.authorization.GetMeshRights(fixture.user, fixture.meshid), 5);
    assert.equal(fixture.authorization.IsMeshViewable(fixture.userid, fixture.meshid), true);
    assert.equal(fixture.authorization.IsMeshViewable(fixture.userid, 'mesh/domain/missing'), false);
});

test('GetNodeWithRights combines mesh, node and user-group permissions', async function () {
    const fixture = createFixture();

    const result = await new Promise(function (resolve) {
        fixture.authorization.GetNodeWithRights({ id: 'domain' }, fixture.userid, fixture.nodeid, function (node, rights, visible) {
            resolve({ node: node, rights: rights, visible: visible });
        });
    });

    assert.equal(result.node, fixture.node);
    assert.equal(result.rights, 15);
    assert.equal(result.visible, true);
});

test('GetNodeRights caches results until explicitly invalidated', function () {
    const fixture = createFixture();

    assert.equal(fixture.authorization.GetNodeRights(fixture.user, fixture.meshid, fixture.nodeid), 15);
    fixture.user.links[fixture.nodeid].rights = 16;
    fixture.userGroups[fixture.groupid].links[fixture.nodeid].rights = 32;
    assert.equal(fixture.authorization.GetNodeRights(fixture.user, fixture.meshid, fixture.nodeid), 15);

    fixture.authorization.InvalidateNodeCache(fixture.user, fixture.meshid, fixture.nodeid);
    assert.equal(fixture.authorization.GetNodeRights(fixture.user, fixture.meshid, fixture.nodeid), 53);
});

test('account restrictions remove and add rights after aggregation', function () {
    const fixture = createFixture();
    fixture.user.removeRights = 0x00000008 | 0x00010000;

    const rights = fixture.authorization.GetNodeRights(fixture.user, fixture.meshid, fixture.nodeid);

    assert.equal((rights & 0x00000008), 0);
    assert.equal((rights & 0x00010000), 0x00010000);
    assert.equal((rights & 0x00000007), 0x00000007);
});

test('site administrators listed for all device groups can access their domain', function () {
    const fixture = createFixture();
    fixture.user.siteadmin = 0xFFFFFFFF;
    fixture.config.settings.managealldevicegroups.push(fixture.userid);

    assert.equal(fixture.authorization.GetMeshRights(fixture.user, fixture.secondMeshid), 0xFFFFFFFF);
    assert.deepEqual(fixture.authorization.GetAllMeshIdWithRights(fixture.user).sort(), [fixture.meshid, fixture.secondMeshid].sort());
    assert.equal(fixture.authorization.GetMeshRights(fixture.user, 'mesh/other/two'), 0);
});

test('mesh discovery and dispatch targets include inherited groups', function () {
    const fixture = createFixture();

    assert.deepEqual(fixture.authorization.GetAllMeshIdWithRights(fixture.user).sort(), [fixture.meshid, fixture.secondMeshid].sort());
    assert.deepEqual(fixture.authorization.CreateMeshDispatchTargets(fixture.meshid).sort(), ['*', fixture.meshid, fixture.groupid].sort());
    assert.deepEqual(fixture.authorization.CreateNodeDispatchTargets(fixture.meshid, fixture.nodeid).sort(), ['*', fixture.meshid, fixture.nodeid, fixture.groupid, fixture.groupid].sort());
});
