/**
* @description Registration of domain redirects, server image and well-known resources
* @license Apache-2.0
*/

'use strict';

module.exports.createDomainAssets = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;

    function register(domain) {
        const url = domain.url;
        if (domain.redirects) {
            for (const path in domain.redirects) {
                if (path[0] != '_') state.app.get(url + path, state.handleDomainRedirect);
            }
        }
        state.app.get(url + 'serverpic.ashx', handleServerPicture);
        const wellKnownPath = parent.path.join(parent.datapath, '.well-known' + (domain.id == '' ? '' : '-' + domain.id));
        if (parent.fs.existsSync(wellKnownPath)) state.app.use(url + '.well-known', state.express.static(wellKnownPath));
    }

    function handleServerPicture(req, res) {
        if ((parent.configurationFiles != null) && (parent.configurationFiles['server.png'] != null)) {
            res.set({ 'Content-Type': 'image/png' });
            res.send(parent.configurationFiles['server.png']);
            return;
        }
        const serverPicture = state.path.join(parent.datapath, 'server.png');
        if (state.fs.existsSync(serverPicture)) { sendFile(res, serverPicture); return; }
        const domain = getDomain(req);
        if ((domain != null) && (domain.webpublicpath != null)) {
            const domainPicture = state.path.join(domain.webpublicpath, 'images/server-256.png');
            if (state.fs.existsSync(domainPicture)) { sendFile(res, domainPicture); return; }
        }
        if (parent.webPublicOverridePath) {
            const overridePicture = state.path.join(parent.webPublicOverridePath, 'images/server-256.png');
            if (state.fs.existsSync(overridePicture)) { sendFile(res, overridePicture); return; }
        }
        sendFile(res, state.path.join(parent.webPublicPath, 'images/server-256.png'));
    }

    function sendFile(res, path) {
        try { res.sendFile(path); } catch (ex) { res.sendStatus(404); }
    }

    return { register: register };
};
