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

    // Set the default values
    if (typeof config.userAgent != 'string') { config.userAgent = "CrowdSec Express-NodeJS bouncer/v0.0.1"; }
    if (typeof config.timeout != 'number') { config.timeout = 2000; }
    if ((typeof config.fallbackRemediation != 'string') || (["bypass", "captcha", "ban"].indexOf(config.fallbackRemediation) == -1)) { config.fallbackRemediation = BAN_REMEDIATION; }
    if (typeof config.maxRemediation != 'number') { config.maxRemediation = BAN_REMEDIATION; }
    if (typeof config.captchaGenerationCacheDuration != 'number') { config.captchaGenerationCacheDuration = 60 * 1000; }
    if (typeof config.captchaResolutionCacheDuration != 'number') { config.captchaResolutionCacheDuration = 30 * 60 * 1000; }
    if (typeof config.captchaTexts != 'object') { config.captchaTexts = {}; }
    if (typeof config.banTexts != 'object') { config.banTexts = {}; }
    if (typeof config.colors != 'object') { config.colors = {}; }
    if (typeof config.hideCrowdsecMentions != 'boolean') { config.hideCrowdsecMentions = false; }
    if (typeof config.customCss != 'string') { config.customCss = ''; }
    if (typeof config.bypass != 'boolean') { config.bypass = false; }
    if (typeof config.trustedRangesForIpForwarding != 'object') { config.trustedRangesForIpForwarding = []; }
    if (typeof config.customLogger != 'object') { config.customLogger = null; }
    if (typeof config.bypassConnectionTest != 'boolean') { config.bypassConnectionTest = false; }

    // Setup the logger
    var logger = config.customLogger ? config.customLogger : getLogger();

    // Configure the bouncer
    configure({
        url: config.url,
        apiKey: config.apiKey,
        userAgent: config.userAgent,
        timeout: config.timeout,
        fallbackRemediation: config.fallbackRemediation,
        maxRemediation: config.maxRemediation,
        captchaTexts: config.captchaTexts,
        banTexts: config.banTexts,
        colors: config.colors,
        hideCrowdsecMentions: config.hideCrowdsecMentions,
        customCss: config.customCss
    });

    // Test connectivity
    obj.testConnectivity = async function() { return (await testConnectionToCrowdSec())['success']; }

    // Process a web request
    obj.process = async function (domain, req, res, next) {
        try {
            var remediation = config.fallbackRemediation;
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
        await applyCaptchaEx(req.clientIp, req, res, next, config.captchaGenerationCacheDuration, config.captchaResolutionCacheDuration, logger);
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
