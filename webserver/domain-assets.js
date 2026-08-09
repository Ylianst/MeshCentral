/**
* @description Registration of domain redirects, server image and well-known resources
* @license Apache-2.0
*/

'use strict';

module.exports.createDomainAssets = function (options) {
    const state = options.state;
    const parent = options.parent;
    const getDomain = options.getDomain;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkIpAddressEx = options.checkIpAddressEx;
    const setContentDispositionHeader = options.setContentDispositionHeader;
    const certificates = options.certificates;

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

    function sendConfiguredImage(res, domain, property) {
        const image = domain[property];
        if (!image) return false;
        if ((parent.configurationFiles != null) && (parent.configurationFiles[image] != null)) {
            res.set({ 'Content-Type': image.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' });
            res.send(parent.configurationFiles[image]);
            return true;
        }
        try { res.sendFile(state.common.joinPath(parent.datapath, image)); return true; } catch (ex) { return false; }
    }

    function handleLogo(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (sendConfiguredImage(res, domain, 'titlepicture')) return;

        const domainLogo = (domain.webpublicpath != null) ? state.path.join(domain.webpublicpath, 'images/logoback.png') : null;
        const overrideLogo = parent.webPublicOverridePath ? state.path.join(parent.webPublicOverridePath, 'images/logoback.png') : null;
        if ((domainLogo != null) && state.fs.existsSync(domainLogo)) { sendFile(res, domainLogo); return; }
        if ((overrideLogo != null) && state.fs.existsSync(overrideLogo)) { sendFile(res, overrideLogo); return; }
        sendFile(res, state.path.join(parent.webPublicPath, 'images/logoback.png'));
    }

    function handleLoginLogo(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (!sendConfiguredImage(res, domain, 'loginpicture')) res.sendStatus(404);
    }

    function handlePwaLogo(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (sendConfiguredImage(res, domain, 'pwalogo')) return;

        const domainLogo = (domain.webpublicpath != null) ? state.path.join(domain.webpublicpath, 'android-chrome-512x512.png') : null;
        const overrideLogo = parent.webPublicOverridePath ? state.path.join(parent.webPublicOverridePath, 'android-chrome-512x512.png') : null;
        if ((domainLogo != null) && state.fs.existsSync(domainLogo)) { sendFile(res, domainLogo); return; }
        if ((overrideLogo != null) && state.fs.existsSync(overrideLogo)) { sendFile(res, overrideLogo); return; }
        sendFile(res, state.path.join(parent.webPublicPath, 'android-chrome-512x512.png'));
    }

    function handleWelcomeImage(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if (sendConfiguredImage(res, domain, 'welcomepicture')) return;

        const imageFile = (domain.sitestyle >= 2) ? 'images/login/back.png' : 'images/mainwelcome.jpg';
        const defaultImage = state.path.join(parent.webPublicPath, imageFile);
        const customRoot = domain.webpublicpath || parent.webPublicOverridePath;
        if (customRoot == null) { sendFile(res, defaultImage); return; }
        const customImage = state.path.join(customRoot, imageFile);
        state.fs.exists(customImage, function (exists) { sendFile(res, exists ? customImage : defaultImage); });
    }

    function getRootCertBase64() {
        var rootCert = state.certificates.root.cert;
        var start = rootCert.indexOf('-----BEGIN CERTIFICATE-----\r\n');
        if (start >= 0) rootCert = rootCert.substring(start + 29);
        const end = rootCert.indexOf('-----END CERTIFICATE-----');
        if (end >= 0) rootCert = rootCert.substring(0, end);
        return Buffer.from(rootCert, 'base64').toString('base64');
    }

    function handleRootCertificate(req, res) {
        const domain = getDomain(req);
        if (domain == null) { parent.debug('web', 'handleRootCertRequest: no domain'); res.sendStatus(404); return; }
        if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) === -1)) { res.sendStatus(404); return; }
        if ((state.userAllowedIp != null) && (checkIpAddressEx(req, res, state.userAllowedIp, false) === false)) { parent.debug('web', 'handleRootCertRequest: invalid ip'); return; }
        parent.debug('web', 'handleRootCertRequest()');
        setContentDispositionHeader(res, 'application/octet-stream', certificates.RootName + '.cer', null, 'rootcert.cer');
        res.send(Buffer.from(getRootCertBase64(), 'base64'));
    }

    function handleManifest(req, res) {
        const domain = checkUserIpAddress(req);
        if (domain == null) { parent.debug('web', 'handleManifestRequest: no domain'); res.sendStatus(404); return; }
        parent.debug('web', 'handleManifestRequest()');
        const title = (domain.title != null) ? domain.title : 'MeshCentral';
        res.json({
            name: title,
            short_name: title,
            description: 'Open source web based, remote computer management.',
            scope: '.',
            start_url: '/',
            display: 'fullscreen',
            orientation: 'any',
            theme_color: '#ffffff',
            background_color: '#ffffff',
            icons: [{ src: 'pwalogo.png', sizes: '512x512', type: 'image/png' }]
        });
    }

    return {
        register: register,
        handleLogo: handleLogo,
        handleLoginLogo: handleLoginLogo,
        handlePwaLogo: handlePwaLogo,
        handleWelcomeImage: handleWelcomeImage,
        getRootCertBase64: getRootCertBase64,
        handleRootCertificate: handleRootCertificate,
        handleManifest: handleManifest
    };
};
