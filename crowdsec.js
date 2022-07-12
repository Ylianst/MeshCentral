module.exports.CreateCrowdSecBouncer = function (parent, config) {
    const obj = {};

    // Setup constants
    const { getLogger } = require('@crowdsec/express-bouncer/src/nodejs-bouncer/lib/logger');
    const { configure, renderBanWall, testConnectionToCrowdSec, getRemediationForIp } = require('@crowdsec/express-bouncer/src/nodejs-bouncer');
    const applyCaptcha = require('@crowdsec/express-bouncer/src/express-crowdsec-middleware/lib/captcha');
    const { BYPASS_REMEDIATION, CAPTCHA_REMEDIATION, BAN_REMEDIATION } = require('@crowdsec/express-bouncer/src/nodejs-bouncer/lib/constants'); // "bypass", "captcha", "ban";
    const svgCaptcha = require('svg-captcha');
    const { renderCaptchaWall } = require('@crowdsec/express-bouncer/src/nodejs-bouncer');

    // Current captcha state
    const currentCaptchaIpList = {};

    // Set the default values. "config" will come in with lowercase names with everything, so we need to correct some value names.
    if (typeof config.useragent != 'string') { config.useragent = 'CrowdSec Express-NodeJS bouncer/v0.0.1'; }
    if (typeof config.timeout != 'number') { config.timeout = 2000; }
    if ((typeof config.fallbackremediation != 'string') || (['bypass', 'captcha', 'ban'].indexOf(config.fallbackremediation) == -1)) { config.fallbackremediation = BAN_REMEDIATION; }
    if (typeof config.maxremediation != 'number') { config.maxremediation = BAN_REMEDIATION; }
    if (typeof config.captchagenerationcacheduration != 'number') { config.captchagenerationcacheduration = 60 * 1000; } // 60 seconds
    if (typeof config.captcharesolutioncacheduration != 'number') { config.captcharesolutioncacheduration = 30 * 60 * 1000; } // 30 minutes
    if (typeof config.captchatexts != 'object') { config.captchatexts = {}; } else {
        if (typeof config.captchatexts.tabtitle == 'string') { config.captchatexts.tabTitle = config.captchatexts.tabtitle; delete config.captchatexts.tabtitle; } // Fix "tabTitle" capitalization
    }
    if (typeof config.bantexts != 'object') { config.bantexts = {}; } else {
        if (typeof config.bantexts.tabtitle == 'string') { config.bantexts.tabTitle = config.bantexts.tabtitle; delete config.bantexts.tabtitle; } // Fix "tabTitle" capitalization
    }
    if (typeof config.colors != 'object') { config.colors = {}; } else {
        var colors = {};
        // All of the values in "text" and "background" sections happen to be lowercase, so, we can use the values as-is.
        if (typeof config.colors.text == 'object') { colors.text = config.colors.text; }
        if (typeof config.colors.background == 'object') { colors.background = config.colors.background; }
        config.colors = colors;
    }
    if (typeof config.hidecrowdsecmentions != 'boolean') { config.hidecrowdsecmentions = false; }
    if (typeof config.customcss != 'string') { delete config.customcss; }
    if (typeof config.bypass != 'boolean') { config.bypass = false; }
    if (typeof config.customlogger != 'object') { delete config.customlogger; }
    if (typeof config.bypassconnectiontest != 'boolean') { config.bypassconnectiontest = false; }

    // Setup the logger
    var logger = config.customLogger ? config.customLogger : getLogger();

    // Configure the bouncer
    configure({
        url: config.url,
        apiKey: config.apikey,
        userAgent: config.useragent,
        timeout: config.timeout,
        fallbackRemediation: config.fallbackremediation,
        maxRemediation: config.maxremediation,
        captchaTexts: config.captchatexts,
        banTexts: config.bantexts,
        colors: config.colors,
        hideCrowdsecMentions: config.hidecrowdsecmentions,
        customCss: config.customcss
    });

    // Test connectivity
    obj.testConnectivity = async function() { return (await testConnectionToCrowdSec())['success']; }

    // Process a web request
    obj.process = async function (domain, req, res, next) {
        try {
            var remediation = config.fallbackremediation;
            try { remediation = await getRemediationForIp(req.clientIp); } catch (ex) { }
            //console.log('CrowdSec', req.clientIp, remediation, req.url);
            switch (remediation) {
                case BAN_REMEDIATION:
                    const banWallTemplate = await renderBanWall();
                    res.status(403);
                    res.send(banWallTemplate);
                    return true;
                case CAPTCHA_REMEDIATION:
                    if ((currentCaptchaIpList[req.clientIp] == null) || (currentCaptchaIpList[req.clientIp].resolved !== true)) {
                        var domainCaptchaUrl = ((domain != null) && (domain.id != '') && (domain.dns == null)) ? ('/' + domain.id + '/captcha.ashx') : '/captcha.ashx';
                        if (req.url != domainCaptchaUrl) { res.redirect(domainCaptchaUrl); return true; }
                    }
                    break;
            }
        } catch (ex) { }
        return false;
    }

    // Process a captcha request
    obj.applyCaptcha = async function (req, res, next) {
        await applyCaptchaEx(req.clientIp, req, res, next, config.captchagenerationcacheduration, config.captcharesolutioncacheduration, logger);
    }

    // Process a captcha request
    async function applyCaptchaEx(ip, req, res, next, captchaGenerationCacheDuration, captchaResolutionCacheDuration, loggerInstance) {
        logger = loggerInstance;
        let error = false;

        if (currentCaptchaIpList[ip] == null) {
            generateCaptcha(ip, captchaGenerationCacheDuration);
        } else {
            if (currentCaptchaIpList[ip] && currentCaptchaIpList[ip].resolved) {
                logger.debug({ type: 'CAPTCHA_ALREADY_SOLVED', ip });
                next();
                return;
            } else {
                if (req.body && req.body.crowdsec_captcha) {
                    if (req.body.refresh === '1') { generateCaptcha(ip, captchaGenerationCacheDuration); }
                    if (req.body.phrase !== '') {
                        if (currentCaptchaIpList[ip].text === req.body.phrase) {
                            currentCaptchaIpList[ip].resolved = true;
                            setTimeout(function() { if (currentCaptchaIpList[ip]) { delete currentCaptchaIpList[ip]; } }, captchaResolutionCacheDuration);
                            res.redirect(req.originalUrl);
                            logger.info({ type: 'CAPTCHA_RESOLUTION', ip, result: true });
                            return;
                        } else {
                            logger.info({ type: 'CAPTCHA_RESOLUTION', ip, result: false });
                            error = true;
                        }
                    }
                }
            }
        }

        const captchaWallTemplate = await renderCaptchaWall({ captchaImageTag: currentCaptchaIpList[ip].data, captchaResolutionFormUrl: '', error });
        res.status(401);
        res.send(captchaWallTemplate);
    };

    // Generate a CAPTCHA
    function generateCaptcha(ip, captchaGenerationCacheDuration) {
        const captcha = svgCaptcha.create();
        currentCaptchaIpList[ip] = {
            data: captcha.data,
            text: captcha.text,
            resolved: false,
        };
        setTimeout(() => {
            if (currentCaptchaIpList[ip]) { delete currentCaptchaIpList[ip]; }
        }, captchaGenerationCacheDuration);
        logger.debug({ type: "GENERATE_CAPTCHA", ip });
    };

    return obj;
}
