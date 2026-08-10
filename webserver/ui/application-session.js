/**
* @description Main web application session-state handling
* @license Apache-2.0
*/

'use strict';

module.exports.consumeNavigationState = function (request, domain) {
    var viewmode = 1;
    if (request.session.viewmode) {
        viewmode = request.session.viewmode;
        delete request.session.viewmode;
    } else if (request.query.viewmode) {
        viewmode = request.query.viewmode;
    }

    var currentNode = '';
    if (request.session.currentNode) {
        currentNode = request.session.currentNode;
        delete request.session.currentNode;
    } else if (request.query.node) {
        currentNode = 'node/' + domain.id + '/' + request.query.node;
    }
    return { viewmode: viewmode, currentNode: currentNode };
};

module.exports.clearU2fChallenge = function (session, decryptSessionData, encryptSessionData) {
    if (session.u2f) { delete session.u2f; }
    if (session.e) {
        const data = decryptSessionData(session.e);
        if (data.u2f != null) {
            delete data.u2f;
            session.e = encryptSessionData(data);
        }
    }
};
