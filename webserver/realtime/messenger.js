/**
* @description MeshMessenger page and image handlers
* @license Apache-2.0
*/

'use strict';

module.exports.createMessenger = function (options) {
    const state = options.state;
    const parent = options.parent;
    const args = options.args;
    const getDomain = options.getDomain;
    const render = options.render;
    const getRenderPage = options.getRenderPage;
    const getRenderArgs = options.getRenderArgs;

    function handlePage(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMessengerRequest: no domain'); res.sendStatus(404); return; }
        parent.debug('web', 'handleMessengerRequest()');
        if (parent.config.settings.maintenancemode != null) {
            render(req, res, getRenderPage((domain.sitestyle >= 2) ? 'message2' : 'message', req, domain), getRenderArgs({ titleid: 3, msgid: 13, domainurl: encodeURIComponent(domain.url).replace(/'/g, '%27') }, req, domain));
            return;
        }

        if (req.query.id == null) { res.sendStatus(404); return; }
        const idSplit = decodeURIComponent(req.query.id).split('/');
        if ((idSplit.length !== 7) || (idSplit[0] !== 'meshmessenger')) { res.sendStatus(404); return; }
        if ((idSplit[1] === 'user') && (idSplit[4] === 'user')) {
            const user1 = idSplit[1] + '/' + idSplit[2] + '/' + idSplit[3];
            const user2 = idSplit[4] + '/' + idSplit[5] + '/' + idSplit[6];
            if (!req.session || !req.session.userid) {
                const key = (req.query.key != null) ? ('key=' + encodeURIComponent(req.query.key) + '&') : '';
                res.redirect(domain.url + '?' + key + 'meshmessengerid=' + encodeURIComponent(req.query.id));
                return;
            }
            if ((req.session.userid !== user1) && (req.session.userid !== user2)) { res.sendStatus(404); return; }
        }

        var webRtcConfig = null;
        if (parent.config.settings && parent.config.settings.webrtcconfig && (typeof parent.config.settings.webrtcconfig === 'object')) webRtcConfig = encodeURIComponent(JSON.stringify(parent.config.settings.webrtcconfig)).replace(/'/g, '%27');
        else if (args.webrtcconfig && (typeof args.webrtcconfig === 'object')) webRtcConfig = encodeURIComponent(JSON.stringify(args.webrtcconfig)).replace(/'/g, '%27');
        const renderOptions = { webrtcconfig: webRtcConfig, meshMessengerTitle: (typeof domain.meshmessengertitle === 'string') ? domain.meshmessengertitle : '!' };

        if ((domain.meshmessengertitle != null) && req.query.id.startsWith('meshmessenger/node')) {
            const user = state.users[idSplit[4] + '/' + idSplit[5] + '/' + idSplit[6]];
            if (user != null) {
                if (domain.meshmessengertitle.indexOf('{0}') >= 0) renderOptions.username = encodeURIComponent(user.realname || user.name).replace(/'/g, '%27');
                if (domain.meshmessengertitle.indexOf('{1}') >= 0) renderOptions.userid = encodeURIComponent(user.name).replace(/'/g, '%27');
            }
        }

        res.set({ 'Cache-Control': 'no-store' });
        render(req, res, getRenderPage('messenger', req, domain), getRenderArgs(renderOptions, req, domain));
    }

    function sendFile(res, file) { try { res.sendFile(file); } catch (ex) { res.sendStatus(404); } }

    function handleImage(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleMessengerImageRequest: no domain'); res.sendStatus(404); return; }
        parent.debug('web', 'handleMessengerImageRequest()');
        if (parent.config.settings.maintenancemode != null) { res.sendStatus(404); return; }
        if (domain.meshmessengerpicture) {
            try { res.sendFile(state.common.joinPath(parent.datapath, domain.meshmessengerpicture)); return; } catch (ex) { }
        }

        const imageFile = 'images/messenger.png';
        const defaultImage = state.path.join(parent.webPublicPath, imageFile);
        const customRoot = domain.webpublicpath || parent.webPublicOverridePath;
        if (customRoot == null) { sendFile(res, defaultImage); return; }
        const customImage = state.path.join(customRoot, imageFile);
        state.fs.exists(customImage, function (exists) { sendFile(res, exists ? customImage : defaultImage); });
    }

    return { handlePage: handlePage, handleImage: handleImage };
};
