/**
* @description Authenticated HTTP handlers for MeshCentral plugins
* @license Apache-2.0
*/

'use strict';

module.exports.createPluginRequests = function (options) {
    const state = options.state;
    const pluginHandler = options.pluginHandler;
    const checkUserIpAddress = options.checkUserIpAddress;

    function getUser(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) { return null; }
        if ((req.session == null) || (req.session.userid == null)) { res.sendStatus(401); return null; }
        const user = state.users[req.session.userid];
        if (user == null) { res.sendStatus(401); return null; }
        return user;
    }

    function handleAdminRequest(req, res) {
        const user = getUser(req, res);
        if (user != null) { pluginHandler.handleAdminReq(req, res, user, state); }
    }

    function handleAdminPostRequest(req, res) {
        const user = getUser(req, res);
        if (user != null) { pluginHandler.handleAdminPostReq(req, res, user, state); }
    }

    function handleScript(req, res) {
        const user = getUser(req, res);
        if (user != null) { pluginHandler.refreshJS(req, res); }
    }

    return { handleAdminRequest: handleAdminRequest, handleAdminPostRequest: handleAdminPostRequest, handleScript: handleScript };
};
