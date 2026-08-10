/**
* @description User web-state resolution and interface style selection
* @license Apache-2.0
*/

'use strict';

module.exports.resolveUserWebState = function (filterUserWebState, error, states, domain) {
    var webstate = '{}';
    if ((error == null) && Array.isArray(states) && (states.length == 1) && (states[0].state != null)) {
        const filteredWebState = filterUserWebState(states[0].state);
        if (typeof filteredWebState == 'string') { webstate = filteredWebState; }
    }
    if ((webstate == '{}') && (typeof domain.defaultuserwebstate == 'object')) { webstate = JSON.stringify(domain.defaultuserwebstate); }
    if (typeof domain.forceduserwebstate == 'object') {
        var combinedState = {};
        try { if (webstate != '{}') { combinedState = JSON.parse(webstate); } } catch (ex) { }
        for (var key in domain.forceduserwebstate) { combinedState[key] = domain.forceduserwebstate[key]; }
        webstate = JSON.stringify(combinedState);
    }
    return webstate;
};

module.exports.getUiViewMode = function (request, domain, webstate) {
    var uiViewMode = 'default';
    var webstateObject = null;
    try { webstateObject = JSON.parse(webstate); } catch (ex) { }
    if (request.query.sitestyle != null) {
        if (request.query.sitestyle == 3) { uiViewMode = 'default3'; }
    } else if ((webstateObject != null) && (webstateObject.uiViewMode == 3)) {
        uiViewMode = 'default3';
    } else if (domain.sitestyle == 3) {
        uiViewMode = 'default3';
    }
    return uiViewMode;
};
