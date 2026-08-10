/**
* @description Automatic web authentication modes
* @license Apache-2.0
*/

'use strict';

module.exports.createAutomaticAuthentication = function (options) {
    const state = options.state;
    const parent = options.parent;
    const setSessionRandom = options.setSessionRandom;

    function initializeSession(request, userId) {
        delete request.session.loginmode;
        request.session.userid = userId;
        delete request.session.currentNode;
        request.session.ip = request.clientIp;
        setSessionRandom(request);
    }

    return function authenticateAutomatically(request, domain) {
        if (state.args.nousers == true) {
            const userId = 'user/' + domain.id + '/~';
            initializeSession(request, userId);
            if (state.users[userId] == null) {
                parent.debug('web', 'handleRootRequestEx: created dummy user in nouser mode.');
                state.users[userId] = { type: 'user', _id: userId, name: '~', email: '~', domain: domain.id, siteadmin: 4294967295 };
                state.db.SetUser(state.users[userId]);
            }
            return true;
        }

        const defaultUserId = state.args.user ? ('user/' + domain.id + '/' + state.args.user.toLowerCase()) : null;
        if ((defaultUserId != null) && state.users[defaultUserId]) {
            parent.debug('web', 'handleRootRequestEx: auth using default user.');
            initializeSession(request, defaultUserId);
            return true;
        }

        if (request.query.login && (parent.loginCookieEncryptionKey != null)) {
            const loginCookie = parent.decodeCookie(request.query.login, parent.loginCookieEncryptionKey, 60);
            if ((loginCookie != null) && (loginCookie.a == 3) && (loginCookie.u != null) && (loginCookie.u.split('/')[1] == domain.id)) {
                parent.debug('web', 'handleRootRequestEx: cookie auth ok.');
                initializeSession(request, loginCookie.u);
            } else {
                parent.debug('web', 'handleRootRequestEx: cookie auth failed.');
            }
            return true;
        }
        return false;
    };
};
