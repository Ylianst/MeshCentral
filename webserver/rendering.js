/**
* @description MeshCentral web server template selection and rendering arguments
* @license Apache-2.0
*/

"use strict";

function generateCustomCSSTags(customFilesObject, currentTemplate) {
    var cssTags = '';
    cssTags += '<link keeplink=1 type="text/css" href="styles/custom.css" media="screen" rel="stylesheet" title="CSS" />\n    ';

    if (customFilesObject) {
        if (Array.isArray(customFilesObject)) {
            for (var i = 0; i < customFilesObject.length; i++) {
                var customFileConfig = customFilesObject[i];
                if (customFileConfig && customFileConfig.css && Array.isArray(customFileConfig.css)) {
                    if ((customFileConfig.scope && customFileConfig.scope.indexOf('all') !== -1) ||
                        (currentTemplate && customFileConfig.scope && customFileConfig.scope.indexOf(currentTemplate) !== -1)) {
                        for (var j = 0; j < customFileConfig.css.length; j++) {
                            cssTags += '<link keeplink=1 type="text/css" href="styles/' + customFileConfig.css[j] + '" media="screen" rel="stylesheet" title="CSS" />\n    ';
                        }
                    }
                }
            }
        } else if (customFilesObject.css && Array.isArray(customFilesObject.css)) {
            for (var i = 0; i < customFilesObject.css.length; i++) {
                cssTags += '<link keeplink=1 type="text/css" href="styles/' + customFilesObject.css[i] + '" media="screen" rel="stylesheet" title="CSS" />\n    ';
            }
        } else if (typeof customFilesObject === 'object') {
            for (var configName in customFilesObject) {
                var customFileConfig = customFilesObject[configName];
                if (customFileConfig && customFileConfig.css && Array.isArray(customFileConfig.css)) {
                    if ((customFileConfig.scope && customFileConfig.scope.indexOf('all') !== -1) ||
                        (currentTemplate && customFileConfig.scope && customFileConfig.scope.indexOf(currentTemplate) !== -1)) {
                        for (var j = 0; j < customFileConfig.css.length; j++) {
                            cssTags += '<link keeplink=1 type="text/css" href="styles/' + customFileConfig.css[j] + '" media="screen" rel="stylesheet" title="CSS" />\n    ';
                        }
                    }
                }
            }
        }
    }
    return cssTags.trim();
}

function generateCustomJSTags(customFilesObject, currentTemplate) {
    var jsTags = '';
    jsTags += '<script keeplink=1 type="text/javascript" src="scripts/custom.js"></script>\n    ';

    if (customFilesObject) {
        if (Array.isArray(customFilesObject)) {
            for (var i = 0; i < customFilesObject.length; i++) {
                var customFileConfig = customFilesObject[i];
                if (customFileConfig && customFileConfig.js && Array.isArray(customFileConfig.js)) {
                    if ((customFileConfig.scope && customFileConfig.scope.indexOf('all') !== -1) ||
                        (currentTemplate && customFileConfig.scope && customFileConfig.scope.indexOf(currentTemplate) !== -1)) {
                        for (var j = 0; j < customFileConfig.js.length; j++) {
                            jsTags += '<script keeplink=1 type="text/javascript" src="scripts/' + customFileConfig.js[j] + '"></script>\n    ';
                        }
                    }
                }
            }
        } else if (customFilesObject.js && Array.isArray(customFilesObject.js)) {
            for (var i = 0; i < customFilesObject.js.length; i++) {
                jsTags += '<script keeplink=1 type="text/javascript" src="scripts/' + customFilesObject.js[i] + '"></script>\n    ';
            }
        } else if (typeof customFilesObject === 'object') {
            for (var configName in customFilesObject) {
                var customFileConfig = customFilesObject[configName];
                if (customFileConfig && customFileConfig.js && Array.isArray(customFileConfig.js)) {
                    if ((customFileConfig.scope && customFileConfig.scope.indexOf('all') !== -1) ||
                        (currentTemplate && customFileConfig.scope && customFileConfig.scope.indexOf(currentTemplate) !== -1)) {
                        for (var j = 0; j < customFileConfig.js.length; j++) {
                            jsTags += '<script keeplink=1 type="text/javascript" src="scripts/' + customFileConfig.js[j] + '"></script>\n    ';
                        }
                    }
                }
            }
        }
    }
    return jsTags.trim();
}

module.exports.generateCustomCSSTags = generateCustomCSSTags;
module.exports.generateCustomJSTags = generateCustomJSTags;

module.exports.createRendering = function (options) {
    const path = options.path;
    const fs = options.fs;

    function getRenderPage(pagename, req, domain) {
        var mobile = options.isMobileBrowser(req), minify = (domain.minify == true), p;
        if (req.query.mobile == '1') { mobile = true; } else if (req.query.mobile == '0') { mobile = false; }
        if (req.query.minify == '1') { minify = true; } else if (req.query.minify == '0') { minify = false; }
        if ((domain != null) && (domain.mobilesite === false)) { mobile = false; }
        if (mobile) {
            if ((domain != null) && (domain.webviewspath != null)) {
                if (minify) {
                    p = path.join(domain.webviewspath, pagename + '-mobile-min');
                    if (fs.existsSync(p + '.handlebars')) { return p; }
                }
                p = path.join(domain.webviewspath, pagename + '-mobile');
                if (fs.existsSync(p + '.handlebars')) { return p; }
            }
            if (options.webViewsOverridePath != null) {
                if (minify) {
                    p = path.join(options.webViewsOverridePath, pagename + '-mobile-min');
                    if (fs.existsSync(p + '.handlebars')) { return p; }
                }
                p = path.join(options.webViewsOverridePath, pagename + '-mobile');
                if (fs.existsSync(p + '.handlebars')) { return p; }
            }
            if (minify) {
                p = path.join(options.webViewsPath, pagename + '-mobile-min');
                if (fs.existsSync(p + '.handlebars')) { return p; }
            }
            p = path.join(options.webViewsPath, pagename + '-mobile');
            if (fs.existsSync(p + '.handlebars')) { return p; }
        }
        if ((domain != null) && (domain.webviewspath != null)) {
            if (minify) {
                p = path.join(domain.webviewspath, pagename + '-min');
                if (fs.existsSync(p + '.handlebars')) { return p; }
            }
            p = path.join(domain.webviewspath, pagename);
            if (fs.existsSync(p + '.handlebars')) { return p; }
        }
        if (options.webViewsOverridePath != null) {
            if (minify) {
                p = path.join(options.webViewsOverridePath, pagename + '-min');
                if (fs.existsSync(p + '.handlebars')) { return p; }
            }
            p = path.join(options.webViewsOverridePath, pagename);
            if (fs.existsSync(p + '.handlebars')) { return p; }
        }
        if (minify) {
            p = path.join(options.webViewsPath, pagename + '-min');
            if (fs.existsSync(p + '.handlebars')) { return p; }
        }
        p = path.join(options.webViewsPath, pagename);
        if (fs.existsSync(p + '.handlebars')) { return p; }
        return null;
    }

    function generateThemePackCSSTags(domain, currentTemplate) {
        var cssTags = '';
        var isModernUI = (currentTemplate === 'default3') || (domain.sitestyle === 3);
        if (domain && domain.themepack && isModernUI) {
            var themePath = path.join(options.datapath, 'theme-pack', domain.themepack, 'public');
            if (fs.existsSync(path.join(themePath, 'styles', 'theme.css'))) {
                cssTags += '<link keeplink=1 type="text/css" href="styles/theme.css" media="screen" rel="stylesheet" title="CSS" />\n    ';
            }
        }
        return cssTags;
    }

    function generateThemePackJSTags(domain, currentTemplate) {
        var jsTags = '';
        var isModernUI = (currentTemplate === 'default3') || (domain.sitestyle === 3);
        if (domain && domain.themepack && isModernUI) {
            var themePath = path.join(options.datapath, 'theme-pack', domain.themepack, 'public');
            if (fs.existsSync(path.join(themePath, 'scripts', 'theme.js'))) {
                jsTags += '<script keeplink=1 type="text/javascript" src="scripts/theme.js"></script>\n    ';
            }
        }
        return jsTags;
    }

    function getRenderArgs(xargs, req, domain, page) {
        var minify = (domain.minify == true);
        if (req.query.minify == '1') { minify = true; } else if (req.query.minify == '0') { minify = false; }
        xargs.min = minify ? '-min' : '';
        xargs.titlehtml = domain.titlehtml;
        xargs.title = (domain.title != null) ? domain.title : 'MeshCentral';
        if (((page == 'login2') && (domain.loginpicture == null) && (domain.titlehtml == null)) || ((page != 'login2') && (domain.titlepicture == null) && (domain.titlehtml == null))) {
            if (domain.title == null) {
                xargs.title1 = 'MeshCentral';
                xargs.title2 = '';
            } else {
                xargs.title1 = domain.title;
                xargs.title2 = domain.title2 ? domain.title2 : '';
            }
        } else {
            xargs.title1 = domain.title1 ? domain.title1 : '';
            xargs.title2 = (domain.title1 && domain.title2) ? domain.title2 : '';
        }
        const serverStats = options.getServerStats();
        xargs.title2 = options.replacePlaceholders(xargs.title2, {
            'serverversion': options.getCurrentVersion(),
            'servername': options.getWebServerName(domain, req),
            'agentsessions': serverStats.agentsessions,
            'connectedusers': serverStats.connectedusers,
            'userssessions': serverStats.userssessions,
            'relaysessions': serverStats.relaysessions,
            'relaycount': serverStats.relaycount
        });
        xargs.extitle = encodeURIComponent(xargs.title).split('\'').join('\\\'');
        xargs.domainurl = domain.url;
        xargs.autocomplete = (domain.autocomplete === false) ? 'autocomplete=off x' : 'autocomplete';
        if (typeof domain.hide == 'number') { xargs.hide = domain.hide; }
        xargs.randomlength = options.isWebPageLengthRandomizationEnabled() ? options.randomBytes(options.randomBytes(1)[0]).toString('base64') : '';

        if (xargs.customFiles) {
            try {
                var customFiles = JSON.parse(decodeURIComponent(xargs.customFiles));
                xargs.customCSSTags = generateCustomCSSTags(customFiles, page);
                xargs.customJSTags = generateCustomJSTags(customFiles, page);
            } catch (ex) {
                xargs.customCSSTags = generateCustomCSSTags(null, page);
                xargs.customJSTags = generateCustomJSTags(null, page);
            }
        } else {
            xargs.customCSSTags = generateCustomCSSTags(null, page);
            xargs.customJSTags = generateCustomJSTags(null, page);
        }
        xargs.customCSSTags += generateThemePackCSSTags(domain, page);
        xargs.customJSTags += generateThemePackJSTags(domain, page);
        return xargs;
    }

    return {
        getRenderPage: getRenderPage,
        getRenderArgs: getRenderArgs,
        generateThemePackCSSTags: generateThemePackCSSTags,
        generateThemePackJSTags: generateThemePackJSTags
    };
};
