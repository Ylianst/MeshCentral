/**
* @description Setup of Passport authentication strategies for each domain
* @license Apache-2.0
*/

'use strict';

    const domainAuthStrategyConsts = {
        twitter: 1,
        google: 2,
        github: 4,
        reddit: 8, // Deprecated
        azure: 16,
        oidc: 32,
        saml: 64,
        intelSaml: 128,
        jumpCloudSaml: 256
    };

module.exports.constants = domainAuthStrategyConsts;
module.exports.isGroupConfiguration = function (value) { return (value != null) && (typeof value == 'object'); };
module.exports.shouldRevokeAdmin = function (groups) { return groups.revokeAdmin !== false; };
module.exports.createSsoStrategies = function (options) {
    const obj = options.state;
    const parent = options.parent;
    const args = options.args;
    const loadModule = options.require || require;

    async function setupDomainAuthStrategy(domain) {
        // Return binary flags representing all auth strategies that have been setup
        let authStrategyFlags = 0;

        // Setup auth strategies using passport if needed
        if (typeof domain.authstrategies != 'object') return authStrategyFlags;

        const url = domain.url
        const passport = domain.passport = loadModule('passport');
        passport.serializeUser(function (user, done) { done(null, user.sid); });
        passport.deserializeUser(function (sid, done) { done(null, { sid: sid }); });
        obj.app.use(passport.initialize());
        obj.app.use(loadModule('connect-flash')());

        // Twitter
        if ((typeof domain.authstrategies.twitter == 'object') && (typeof domain.authstrategies.twitter.clientid == 'string') && (typeof domain.authstrategies.twitter.clientsecret == 'string')) {
            const TwitterStrategy = loadModule('passport-twitter');
            let options = { consumerKey: domain.authstrategies.twitter.clientid, consumerSecret: domain.authstrategies.twitter.clientsecret };
            if (typeof domain.authstrategies.twitter.callbackurl == 'string') { options.callbackURL = domain.authstrategies.twitter.callbackurl; } else { options.callbackURL = url + 'auth-twitter-callback'; }
            parent.authLog('setupDomainAuthStrategy', 'Adding Twitter SSO with options: ' + JSON.stringify(options));
            passport.use('twitter-' + domain.id, new TwitterStrategy(options,
                function (token, tokenSecret, profile, cb) {
                    parent.authLog('setupDomainAuthStrategy', 'Twitter profile: ' + JSON.stringify(profile));
                    var user = { sid: '~twitter:' + profile.id, name: profile.displayName, strategy: 'twitter' };
                    if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string')) { user.email = profile.emails[0].value; }
                    return cb(null, user);
                }
            ));
            authStrategyFlags |= domainAuthStrategyConsts.twitter;
        }

        // Google
        if ((typeof domain.authstrategies.google == 'object') && (typeof domain.authstrategies.google.clientid == 'string') && (typeof domain.authstrategies.google.clientsecret == 'string')) {
            const GoogleStrategy = loadModule('passport-google-oauth20');
            let options = { clientID: domain.authstrategies.google.clientid, clientSecret: domain.authstrategies.google.clientsecret };
            if (typeof domain.authstrategies.google.callbackurl == 'string') { options.callbackURL = domain.authstrategies.google.callbackurl; } else { options.callbackURL = url + 'auth-google-callback'; }
            parent.authLog('setupDomainAuthStrategy', 'Adding Google SSO with options: ' + JSON.stringify(options));
            passport.use('google-' + domain.id, new GoogleStrategy(options,
                function (token, tokenSecret, profile, cb) {
                    parent.authLog('setupDomainAuthStrategy', 'Google profile: ' + JSON.stringify(profile));
                    var user = { sid: '~google:' + profile.id, name: profile.displayName, strategy: 'google' };
                    if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string') && (profile.emails[0].verified == true)) { user.email = profile.emails[0].value; }
                    return cb(null, user);
                }
            ));
            authStrategyFlags |= domainAuthStrategyConsts.google;
        }

        // Github
        if ((typeof domain.authstrategies.github == 'object') && (typeof domain.authstrategies.github.clientid == 'string') && (typeof domain.authstrategies.github.clientsecret == 'string')) {
            const GitHubStrategy = loadModule('passport-github2');
            let options = { clientID: domain.authstrategies.github.clientid, clientSecret: domain.authstrategies.github.clientsecret };
            if (typeof domain.authstrategies.github.callbackurl == 'string') { options.callbackURL = domain.authstrategies.github.callbackurl; } else { options.callbackURL = url + 'auth-github-callback'; }
            //override passport-github2 defaults that point to github.com with urls specified by user
            if (typeof domain.authstrategies.github.authorizationurl == 'string') { options.authorizationURL = domain.authstrategies.github.authorizationurl; }
            if (typeof domain.authstrategies.github.tokenurl == 'string') { options.tokenURL = domain.authstrategies.github.tokenurl; }
            if (typeof domain.authstrategies.github.userprofileurl == 'string') { options.userProfileURL = domain.authstrategies.github.userprofileurl; }
            if (typeof domain.authstrategies.github.useremailurl == 'string') { options.userEmailURL = domain.authstrategies.github.useremailurl; }
            parent.authLog('setupDomainAuthStrategy', 'Adding Github SSO with options: ' + JSON.stringify(options));
            passport.use('github-' + domain.id, new GitHubStrategy(options,
                function (token, tokenSecret, profile, cb) {
                    parent.authLog('setupDomainAuthStrategy', 'Github profile: ' + JSON.stringify(profile));
                    var user = { sid: '~github:' + profile.id, name: profile.displayName, strategy: 'github' };
                    if ((typeof profile.emails == 'object') && (profile.emails[0] != null) && (typeof profile.emails[0].value == 'string')) { user.email = profile.emails[0].value; }
                    return cb(null, user);
                }
            ));
            authStrategyFlags |= domainAuthStrategyConsts.github;
        }

        // Azure
        if ((typeof domain.authstrategies.azure == 'object') && (typeof domain.authstrategies.azure.clientid == 'string') && (typeof domain.authstrategies.azure.clientsecret == 'string')) {
            const AzureOAuth2Strategy = loadModule('passport-azure-oauth2');
            let options = { clientID: domain.authstrategies.azure.clientid, clientSecret: domain.authstrategies.azure.clientsecret, tenant: domain.authstrategies.azure.tenantid };
            if (typeof domain.authstrategies.azure.callbackurl == 'string') { options.callbackURL = domain.authstrategies.azure.callbackurl; } else { options.callbackURL = url + 'auth-azure-callback'; }
            parent.authLog('setupDomainAuthStrategy', 'Adding Azure SSO with options: ' + JSON.stringify(options));
            passport.use('azure-' + domain.id, new AzureOAuth2Strategy(options,
                function (accessToken, refreshtoken, params, profile, done) {
                    var userex = null;
                    try { userex = loadModule('jwt-simple').decode(params.id_token, '', true); } catch (ex) { }
                    parent.authLog('setupDomainAuthStrategy', 'Azure profile: ' + JSON.stringify(userex));
                    var user = null;
                    if (userex != null) {
                        var user = { sid: '~azure:' + userex.unique_name.toLowerCase(), name: userex.name, strategy: 'azure' };
                        if (typeof userex.email == 'string') { user.email = userex.email.toLowerCase(); }
                    }
                    return done(null, user);
                }
            ));
            authStrategyFlags |= domainAuthStrategyConsts.azure;
        }

        // Generic SAML
        if (typeof domain.authstrategies.saml == 'object') {
            if ((typeof domain.authstrategies.saml.cert != 'string') || (typeof domain.authstrategies.saml.idpurl != 'string')) {
                parent.debug('error', 'Missing SAML configuration.');
            } else {
                const certPath = obj.common.joinPath(obj.parent.datapath, domain.authstrategies.saml.cert);
                var cert = obj.fs.readFileSync(certPath);
                if (cert == null) {
                    parent.debug('error', 'Unable to read SAML IdP certificate: ' + domain.authstrategies.saml.cert);
                } else {
                    var options = { entryPoint: domain.authstrategies.saml.idpurl, issuer: 'meshcentral' };
                    if (typeof domain.authstrategies.saml.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.saml.callbackurl; } else { options.callbackUrl = url + 'auth-saml-callback'; }
                    if (domain.authstrategies.saml.disablerequestedauthncontext != null) { options.disableRequestedAuthnContext = domain.authstrategies.saml.disablerequestedauthncontext; }
                    if (typeof domain.authstrategies.saml.entityid == 'string') { options.issuer = domain.authstrategies.saml.entityid; }
                    if (typeof domain.authstrategies.saml.acceptedClockSkewMs == 'number') { options.acceptedClockSkewMs = domain.authstrategies.saml.acceptedClockSkewMs; }
                    if (typeof domain.authstrategies.saml.maxAssertionAgeMs == 'number') { options.maxAssertionAgeMs = domain.authstrategies.saml.maxAssertionAgeMs; }
                    parent.authLog('setupDomainAuthStrategy', 'Adding SAML SSO with options: ' + JSON.stringify(options));
                    options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                    const SamlStrategy = loadModule('passport-saml').Strategy;
                    passport.use('saml-' + domain.id, new SamlStrategy(options,
                        function (profile, done) {
                            parent.authLog('setupDomainAuthStrategy', 'SAML profile: ' + JSON.stringify(profile));
                            if (typeof profile.nameID != 'string') { return done(); }
                            var user = { sid: '~saml:' + profile.nameID, name: profile.nameID, strategy: 'saml' };
                            if (typeof profile.displayname == 'string') {
                                user.name = profile.displayname;
                            } else if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) {
                                user.name = profile.firstname + ' ' + profile.lastname;
                            }
                            if (typeof profile.email == 'string') { user.email = profile.email; }
                            return done(null, user);
                        }
                    ));
                    authStrategyFlags |= domainAuthStrategyConsts.saml
                }
            }
        }

        // Intel SAML
        if (typeof domain.authstrategies.intel == 'object') {
            if ((typeof domain.authstrategies.intel.cert != 'string') || (typeof domain.authstrategies.intel.idpurl != 'string')) {
                parent.debug('error', 'Missing Intel SAML configuration.');
            } else {
                var cert = obj.fs.readFileSync(obj.common.joinPath(obj.parent.datapath, domain.authstrategies.intel.cert));
                if (cert == null) {
                    parent.debug('error', 'Unable to read Intel SAML IdP certificate: ' + domain.authstrategies.intel.cert);
                } else {
                    var options = { entryPoint: domain.authstrategies.intel.idpurl, issuer: 'meshcentral' };
                    if (typeof domain.authstrategies.intel.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.intel.callbackurl; } else { options.callbackUrl = url + 'auth-intel-callback'; }
                    if (domain.authstrategies.intel.disablerequestedauthncontext != null) { options.disableRequestedAuthnContext = domain.authstrategies.intel.disablerequestedauthncontext; }
                    if (typeof domain.authstrategies.intel.entityid == 'string') { options.issuer = domain.authstrategies.intel.entityid; }
                    parent.authLog('setupDomainAuthStrategy', 'Adding Intel SSO with options: ' + JSON.stringify(options));
                    options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                    const SamlStrategy = loadModule('passport-saml').Strategy;
                    passport.use('isaml-' + domain.id, new SamlStrategy(options,
                        function (profile, done) {
                            parent.authLog('setupDomainAuthStrategy', 'Intel profile: ' + JSON.stringify(profile));
                            if (typeof profile.nameID != 'string') { return done(); }
                            var user = { sid: '~intel:' + profile.nameID, name: profile.nameID, strategy: 'intel' };
                            if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) { user.name = profile.firstname + ' ' + profile.lastname; }
                            else if ((typeof profile.FirstName == 'string') && (typeof profile.LastName == 'string')) { user.name = profile.FirstName + ' ' + profile.LastName; }
                            if (typeof profile.email == 'string') { user.email = profile.email; }
                            else if (typeof profile.EmailAddress == 'string') { user.email = profile.EmailAddress; }
                            return done(null, user);
                        }
                    ));
                    authStrategyFlags |= domainAuthStrategyConsts.intelSaml
                }
            }
        }

        // JumpCloud SAML
        if (typeof domain.authstrategies.jumpcloud == 'object') {
            if ((typeof domain.authstrategies.jumpcloud.cert != 'string') || (typeof domain.authstrategies.jumpcloud.idpurl != 'string')) {
                parent.debug('error', 'Missing JumpCloud SAML configuration.');
            } else {
                var cert = obj.fs.readFileSync(obj.common.joinPath(obj.parent.datapath, domain.authstrategies.jumpcloud.cert));
                if (cert == null) {
                    parent.debug('error', 'Unable to read JumpCloud IdP certificate: ' + domain.authstrategies.jumpcloud.cert);
                } else {
                    var options = { entryPoint: domain.authstrategies.jumpcloud.idpurl, issuer: 'meshcentral' };
                    if (typeof domain.authstrategies.jumpcloud.callbackurl == 'string') { options.callbackUrl = domain.authstrategies.jumpcloud.callbackurl; } else { options.callbackUrl = url + 'auth-jumpcloud-callback'; }
                    if (typeof domain.authstrategies.jumpcloud.entityid == 'string') { options.issuer = domain.authstrategies.jumpcloud.entityid; }
                    parent.authLog('setupDomainAuthStrategy', 'Adding JumpCloud SSO with options: ' + JSON.stringify(options));
                    options.cert = cert.toString().split('-----BEGIN CERTIFICATE-----').join('').split('-----END CERTIFICATE-----').join('');
                    const SamlStrategy = loadModule('passport-saml').Strategy;
                    passport.use('jumpcloud-' + domain.id, new SamlStrategy(options,
                        function (profile, done) {
                            parent.authLog('setupDomainAuthStrategy', 'JumpCloud profile: ' + JSON.stringify(profile));
                            if (typeof profile.nameID != 'string') { return done(); }
                            var user = { sid: '~jumpcloud:' + profile.nameID, name: profile.nameID, strategy: 'jumpcloud' };
                            if ((typeof profile.firstname == 'string') && (typeof profile.lastname == 'string')) { user.name = profile.firstname + ' ' + profile.lastname; }
                            if (typeof profile.email == 'string') { user.email = profile.email; }
                            return done(null, user);
                        }
                    ));
                    authStrategyFlags |= domainAuthStrategyConsts.jumpCloudSaml
                }
            }
        }

        // Setup OpenID Connect Authentication Strategy
        if (obj.common.validateObject(domain.authstrategies.oidc)) {
            parent.authLog('setupDomainAuthStrategy', `OIDC: Setting up strategy for domain: ${domain.id == null ? 'default' : domain.id}`);
            // Ensure required objects exist
            let initStrategy = domain.authstrategies.oidc
            if (typeof initStrategy.issuer == 'string') { initStrategy.issuer = { 'issuer': initStrategy.issuer } }
            let strategy = migrateOldConfigs(Object.assign({ 'client': {}, 'issuer': {}, 'options': {}, 'custom': {}, 'obj': { 'openidClient': loadModule('openid-client') } }, initStrategy))
            let preset = obj.common.validateString(strategy.custom.preset) ? strategy.custom.preset : null
            if (!preset) {
                if (typeof strategy.custom.tenant_id == 'string') { strategy.custom.preset = preset = 'azure' }
                if (strategy.custom.customer_id || strategy.custom.identitysource || strategy.client.client_id.split('.')[2] == 'googleusercontent') { strategy.custom.preset = preset = 'google' }
            }

            // Check issuer url
            let presetIssuer
            if (preset == 'azure') { presetIssuer = 'https://login.microsoftonline.com/' + strategy.custom.tenant_id + '/v2.0'; }
            if (preset == 'google') { presetIssuer = 'https://accounts.google.com'; }
            if (!obj.common.validateString(strategy.issuer.issuer)) {
                if (!preset) {
                    let error = new Error('OIDC: Missing issuer URI.');
                    parent.authLog('error', `${error.message} STRATEGY: ${JSON.stringify(strategy)}`);
                    throw error;
                } else {
                    strategy.issuer.issuer = presetIssuer
                    parent.authLog('setupDomainAuthStrategy', `OIDC: PRESET: ${preset.toUpperCase()}: Using preset issuer: ${presetIssuer}`);
                }
            } else if ((typeof strategy.issuer.issuer == 'string') && (typeof strategy.custom.preset == 'string')) {
                let error = new Error(`OIDC: PRESET: ${strategy.custom.preset.toUpperCase()}: PRESET OVERRIDDEN: CONFIG ISSUER: ${strategy.issuer.issuer} PRESET ISSUER: ${presetIssuer}`);
                parent.authLog('setupDomainAuthStrategy', error.message);
                console.warn(error)
            }

            // Setup Strategy Options
            strategy.custom.scope = obj.common.convertStrArray(strategy.custom.scope, ' ')
            if (strategy.custom.scope.length > 0) {
                strategy.options.params = Object.assign(strategy.options.params || {}, { 'scope': strategy.custom.scope });
            } else {
                strategy.options.params = Object.assign(strategy.options.params || {}, { 'scope': ['openid', 'profile', 'email'] });
            }
            if (module.exports.isGroupConfiguration(strategy.groups)) {
                strategy.custom.authorities = obj.common.convertStrArray(strategy.custom.authorities, ' ')
                // Check if authorities does not exist or includes groups
                if((Array.isArray(strategy.custom.authorities) && strategy.custom.authorities.filter(x => x.trim().length > 0).length > 0) == false || strategy.custom.authorities.includes('groups')) { 
                    let groupScope = strategy.groups.scope || null
                    if (groupScope == null) {
                        if (preset == 'azure') { groupScope = 'Group.Read.All' }
                        if (preset == 'google') { groupScope = 'https://www.googleapis.com/auth/cloud-identity.groups.readonly' }
                        if (typeof preset != 'string') { groupScope = 'groups' }
                    }
                    strategy.options.params.scope.push(groupScope)
					parent.authLog('setupDomainAuthStrategy', `OIDC: Groups sync enabled, added group scope to request: ${strategy.options.params.scope}`);
                }
            }
            strategy.options.params.scope = strategy.options.params.scope.join(' ')

            if (obj.httpsProxyAgent) {
                // process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // add using environment variables if needs be not here
                strategy.obj.openidClient.custom.setHttpOptionsDefaults({ agent: obj.httpsProxyAgent });
            }
            // Discover additional information if available, use endpoints from config if present
            let issuer;
            let attempts = 0;
            const maxAttempts = 3;
            while (attempts < maxAttempts) {
                try {
                    parent.authLog('setupDomainAuthStrategy', `OIDC: Discovering Issuer Endpoints: ${strategy.issuer.issuer} (Attempt ${attempts + 1}/${maxAttempts})`);
                    issuer = await strategy.obj.openidClient.Issuer.discover(strategy.issuer.issuer);
                    break; // Success!
                } catch (err) {
                    attempts++;
                    if (attempts < maxAttempts) {
                        parent.authLog('setupDomainAuthStrategy', `OIDC: Discovery failed. Retrying in 5 seconds... Error: ${err.message}`);
                        console.log(`OIDC: Discovery failed. Retrying in 5 seconds... Error: ${err.message}`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else {
                        parent.authLog('setupDomainAuthStrategy', `OIDC: Discovery failed after ${maxAttempts} attempts. OIDC will be disabled for this domain. Error: ${err.message} ISSUER_URI: ${strategy.issuer.issuer}`);
                        parent.addServerWarning(`OIDC: Discovery failed. OIDC has been disabled for this domain. Error: ${err.message}`);
                        return authStrategyFlags;
                    }
                }
            }
            if (Object.keys(strategy.issuer).length > 1) {
                parent.authLog('setupDomainAuthStrategy', `OIDC: Adding Issuer Metadata: ${JSON.stringify(strategy.issuer)}`);
                issuer = new strategy.obj.openidClient.Issuer(Object.assign(issuer?.metadata, strategy.issuer));
            }
            strategy.issuer = issuer?.metadata;
            strategy.obj.issuer = issuer;

            var httpport = ((args.aliasport != null) ? args.aliasport : args.port);
            var origin = 'https://' + (domain.dns ? domain.dns : parent.certificates.CommonName);
            if (httpport != 443) { origin += ':' + httpport; }

            // Make sure redirect_uri and post_logout_redirect_uri exist before continuing
            if (!strategy.client.redirect_uri) {
                strategy.client.redirect_uri = origin + url + 'auth-oidc-callback';
            }
            if (!strategy.client.post_logout_redirect_uri && strategy.client.post_logout_redirect_uri !== false) {
                strategy.client.post_logout_redirect_uri = origin + url + 'login';
            }

            // Create client and overwrite in options
            let client = new issuer.Client(strategy.client)
            strategy.options = Object.assign(strategy.options, { 'client': client, sessionKey: 'oidc-' + domain.id });
            strategy.client = client.metadata
            strategy.obj.client = client
            
            // Validate OIDC Icon Url once and null it if it fails validation
            if (obj.common.validateObject(strategy.custom) && obj.common.validateString(strategy.custom.buttoniconurl)) {
                if (obj.common.validateUrl(strategy.custom.buttoniconurl)){
                    if (await obj.common.validateRemoteImage(strategy.custom.buttoniconurl, { agent: obj.httpsProxyAgent })) {
                        parent.debug('verbose', 'OIDC: Validated Icon URL and Image: ' + strategy.custom.buttoniconurl);
                    } else {
                        parent.debug('warning', 'OIDC: Icon URL and Image validation failed: ' + strategy.custom.buttoniconurl);
                        strategy.custom.buttoniconurl = null;
                    }
                } else {
                    parent.debug('warning', 'OIDC: Invalid Icon URL: ' + strategy.custom.buttoniconurl);
                    strategy.custom.buttoniconurl = null;
                }
            }
            // Validate OIDC 2x Icon Url once and null it if it fails validation
            if (obj.common.validateObject(strategy.custom) && obj.common.validateString(strategy.custom.buttoniconurl2x)) {
                if (obj.common.validateUrl(strategy.custom.buttoniconurl2x)){
                    if (await obj.common.validateRemoteImage(strategy.custom.buttoniconurl2x, { agent: obj.httpsProxyAgent })) {
                        parent.debug('verbose', 'OIDC: Validated 2x Icon URL and Image: ' + strategy.custom.buttoniconurl2x);
                    } else {
                        parent.debug('warning', 'OIDC: 2x Icon URL and Image validation failed: ' + strategy.custom.buttoniconurl2x);
                        strategy.custom.buttoniconurl2x = null;
                    }
                } else {
                    parent.debug('warning', 'OIDC: Invalid 2x Icon URL: ' + strategy.custom.buttoniconurl2x);
                    strategy.custom.buttoniconurl2x = null;
                }
            }
            // Setup strategy and save configs for later
            passport.use('oidc-' + domain.id, new strategy.obj.openidClient.Strategy(strategy.options, oidcCallback));
            parent.config.domains[domain.id].authstrategies.oidc = strategy;
            parent.debug('verbose', 'OIDC: Saved Configuration: ' + JSON.stringify(strategy));
            if (preset) { parent.authLog('setupDomainAuthStrategy', 'OIDC: ' + preset.toUpperCase() + ': Setup Complete'); }
            else { parent.authLog('setupDomainAuthStrategy', 'OIDC: Setup Complete'); }

            authStrategyFlags |= domainAuthStrategyConsts.oidc

            function migrateOldConfigs(strategy) {
                let oldConfigs = {
                    'client': {
                        'clientid': 'client_id',
                        'clientsecret': 'client_secret',
                        'callbackurl': 'redirect_uri'
                    },
                    'issuer': {
                        'authorizationurl': 'authorization_endpoint',
                        'tokenurl': 'token_endpoint',
                        'userinfourl': 'userinfo_endpoint'
                    },
                    'custom': {
                        'tenantid': 'tenant_id',
                        'customerid': 'customer_id'
                    }
                }
                for (var type in oldConfigs) {
                    for (const [key, value] of Object.entries(oldConfigs[type])) {
                        if (Object.hasOwn(strategy, key)) {
                            if (strategy[type][value] && obj.common.validateString(strategy[type][value])) {
                                let error = new Error('OIDC: OLD CONFIG: Config conflict, new config overrides old config');
                                parent.authLog('migrateOldConfigs', `${JSON.stringify(error)} OLD CONFIG: ${key}: ${strategy[key]} NEW CONFIG: ${value}:${strategy[type][value]}`);
                            } else {
                                parent.authLog('migrateOldConfigs', `OIDC: OLD CONFIG: Moving old config to new location. strategy.${key} => strategy.${type}.${value}`);
                                strategy[type][value] = strategy[key];
                            }
                            delete strategy[key]
                        }
                    }
                }
                if (typeof strategy.scope == 'string') {
                    if (!strategy.custom.scope) {
                        strategy.custom.scope = strategy.scope;
                        strategy.options.params = { 'scope': strategy.scope };
                        parent.authLog('migrateOldConfigs', `OIDC: OLD CONFIG: Moving old config to new location. strategy.scope => strategy.custom.scope`);
                    } else {
                        let error = new Error('OIDC: OLD CONFIG: Config conflict, using new config values.');
                        parent.authLog('migrateOldConfigs', `${error.message} OLD CONFIG: strategy.scope: ${strategy.scope} NEW CONFIG: strategy.custom.scope:${strategy.custom.scope}`);
                        parent.debug('warning', error.message)
                    }
                    delete strategy.scope
                }
                if (strategy.groups && strategy.groups.sync && strategy.groups.sync.enabled && strategy.groups.sync.enabled === true) {
                    if (strategy.groups.sync.filter) {
                        delete strategy.groups.sync.enabled;
                    } else {
                        strategy.groups.sync = true;
                    }
                    parent.authLog('migrateOldConfigs', `OIDC: OLD CONFIG: Moving old config to new location. strategy.groups.sync.enabled => strategy.groups.sync`);
                }
                return strategy
            }

            // Callback function must be able to grab info from API's using the access token, would prefer to use the token here.
            function oidcCallback(tokenset, profile, done) {
                // Handle case where done might not be the third parameter
                if (typeof done !== 'function') {
                    // OpenID Connect strategy calls with (tokenset, done) instead of (tokenset, profile, done)
                    if (typeof profile === 'function') {
                        done = profile;
                        profile = null;
                    } else {
                        parent.debug('error', 'OIDC: Unable to find callback function in parameters');
                        return;
                    }
                }

                // If profile is null/undefined or roles are requested, extract user info from the tokenset
                if ((!profile || (Array.isArray(strategy.custom.authorities) && strategy.custom.authorities.includes('roles')) && !profile.roles) && tokenset && tokenset.id_token) {
                    try {
                        // Simple JWT decoder to extract user claims from id_token
                        const parts = tokenset.id_token.split('.');
                        if (parts.length === 3) {
                            const payload = parts[1];
                            const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
                            const decoded = JSON.parse(Buffer.from(paddedPayload, 'base64').toString());
                            if (decoded) {
                                if(!profile){
                                    profile = decoded;
                                } else {
                                    profile.roles = decoded.roles;
                                }
                            }
                        }
                    } catch (err) {
                        parent.debug('error', `OIDC: Failed to decode id_token: ${err.message}`);
                    }
                }

                // Initialize user object
                let user = { 'strategy': 'oidc' }
                let claims = obj.common.validateObject(strategy.custom.claims) ? strategy.custom.claims : null;
                
                user.sid = null;
                if (profile && obj.common.validateString(profile.sub)) {
                    user.sid = '~oidc:' + profile.sub;
                } else if (profile && obj.common.validateString(profile.oid)) {
                    user.sid = '~oidc:' + profile.oid;
                } else if (profile && obj.common.validateString(profile.email)) {
                    user.sid = '~oidc:' + profile.email;
                } else if (profile && obj.common.validateString(profile.upn)) {
                    user.sid = '~oidc:' + profile.upn;
                }
                
                user.name = profile && obj.common.validateString(profile.name) ? profile.name : null;
                user.email = profile && obj.common.validateString(profile.email) ? profile.email : null;
                if (claims != null) {
                    user.sid = obj.common.validateString(profile[claims.uuid]) ? '~oidc:' + profile[claims.uuid] : user.sid;
                    user.name = obj.common.validateString(profile[claims.name]) ? profile[claims.name] : user.name;
                    user.email = obj.common.validateString(profile[claims.email]) ? profile[claims.email] : user.email;
                }
                
                // Ensure we have a valid sid before proceeding
                if (!user.sid) {
                    parent.debug('error', `OIDC: No valid user identifier found in profile`);
                    return done(new Error('OIDC: No valid user identifier found in profile'));
                }
                
                user.emailVerified = profile && profile.email_verified ? profile.email_verified : obj.common.validateEmail(user.email);
                user.groups = profile && obj.common.validateStrArray(profile.groups, 1) ? profile.groups : null;
                user.roles = profile && obj.common.validateStrArray(profile.roles, 1) ? profile.roles : null;
                user.preset = obj.common.validateString(strategy.custom.preset) ? strategy.custom.preset : null;
                if (strategy.groups && obj.common.validateString(strategy.groups.claim)) {
                    user.groups = profile && obj.common.validateStrArray(profile[strategy.groups.claim], 1) ? profile[strategy.groups.claim] : null
                }

                // Setup end session endpoint
                try {
                    strategy.issuer.end_session_endpoint = strategy.obj.client.endSessionUrl({ 'id_token_hint': tokenset })
                    parent.authLog('oidcCallback', `OIDC: Discovered end_session_endpoint: ${strategy.issuer.end_session_endpoint}`);
                } catch (err) {
                    let error = new Error('OIDC: Discovering end_session_endpoint failed. Using Default.', { cause: err });
                    strategy.issuer.end_session_endpoint = strategy.issuer.issuer + '/logout';
                    parent.debug('error', `${error.message} end_session_endpoint: ${strategy.issuer.end_session_endpoint} post_logout_redirect_uri: ${strategy.client.post_logout_redirect_uri} TOKENSET: ${JSON.stringify(tokenset)}`);
                    parent.authLog('oidcCallback', error.message);
                }

                // Setup presets and groups, get groups from API if needed then return
                if (strategy.groups && typeof user.preset == 'string') {
                    if((Array.isArray(strategy.custom.authorities) && strategy.custom.authorities.filter(x => x.trim().length > 0).length > 0) == false || strategy.custom.authorities.includes('groups')) { 
                        getGroups(user.preset, tokenset).then((groups) => {
                            user = Object.assign(user, { 'groups': groups });
							if(strategy.custom.authorities && strategy.custom.authorities.includes('roles')){
                                // Check also for roles
		                        user.groups = (user.groups || []).concat(user.roles);
		                    }
		                    parent.authLog('oidcCallback',`OIDC: USER GROUPS/ROLES: ${JSON.stringify(user)}`);
		                    done(null, user);
                        }).catch((err) => {
                            let error = new Error('OIDC: GROUPS: No groups found due to error:', { cause: err });
                            parent.debug('error', `${JSON.stringify(error)}`);
                            parent.authLog('oidcCallback', error.message);
                            user.groups = [];
                            done(null, user);
                        });
                    
                    } else if (Array.isArray(strategy.custom.authorities) && strategy.custom.authorities.includes('roles')) {
                        // Only roles are requested
                        if (user.roles) {
                            user.groups = user.roles;
                        }
                        parent.authLog('OIDC: USER ROLES:', user);
                        done(null, user);
                    }  
                } else {
                    done(null, user);
                }

                async function getGroups(preset, tokenset) {
                    let url = '';
                    if (preset == 'azure') { url = strategy.groups.recursive == true ? 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$top=999' : 'https://graph.microsoft.com/v1.0/me/memberOf?$top=999'; }
                    if (preset == 'google') { url = strategy.custom.customer_id ? 'https://cloudidentity.googleapis.com/v1/groups?parent=customers/' + strategy.custom.customer_id : strategy.custom.identitysource ? 'https://cloudidentity.googleapis.com/v1/groups?parent=identitysources/' + strategy.custom.identitysource : null; }
                    return new Promise((resolve, reject) => {
                        const options = {
                            'headers': { authorization: 'Bearer ' + tokenset.access_token }
                        }
                        if (obj.httpsProxyAgent) { options.agent = obj.httpsProxyAgent; }
                        const req = loadModule('https').get(url, options, (res) => {
                            let data = []
                            res.on('data', (chunk) => {
                                data.push(chunk);
                            });
                            res.on('end', () => {
                                if (res.statusCode < 200 || res.statusCode >= 300) {
                                    let error = new Error('OIDC: GROUPS: Bad response code from API, statusCode: ' + res.statusCode);
                                    parent.authLog('getGroups', `ERROR: ${error.message} URL: ${url} OPTIONS: ${JSON.stringify(options)}`);
                                    console.error(error);
                                    reject(error);
                                }
                                if (data.length == 0) {
                                    let error = new Error('OIDC: GROUPS: Getting groups from API failed, request returned no data in response.');
                                    parent.authLog('getGroups', `ERROR: ${error.message} URL: ${url} OPTIONS: ${JSON.stringify(options)}`);
                                    console.error(error);
                                    reject(error);
                                }
                                try {
                                    if (Buffer.isBuffer(data[0])) {
                                        data = Buffer.concat(data);
                                        data = data.toString();
                                    } else { // else if (typeof data[0] == 'string')
                                        data = data.join();
                                    }
                                } catch (err) {
                                    let error = new Error('OIDC: GROUPS: Getting groups from API failed. Error joining response data.', { cause: err });
                                    parent.authLog('getGroups', `ERROR: ${error.message} URL: ${url} OPTIONS: ${JSON.stringify(options)}`);
                                    console.error(error);
                                    reject(error);
                                }
                                if (preset == 'azure') {
                                    data = JSON.parse(data);
                                    if (data.error) {
                                        let error = new Error('OIDC: GROUPS: Getting groups from API failed. Error joining response data.', { cause: data.error });
                                        parent.authLog('getGroups', `ERROR: ${error.message} URL: ${url} OPTIONS: ${JSON.stringify(options)}`);
                                        console.error(error);
                                        reject(error);
                                    }
                                    data = data.value;
                                }
                                if (preset == 'google') {
                                    data = data.split('\n');
                                    data = data.join('');
                                    data = JSON.parse(data);
                                    data = data.groups;
                                }
                                let groups = []
                                for (var i in data) {
                                    if (typeof data[i].displayName == 'string') {
                                        groups.push(data[i].displayName);
                                    }
                                }
                                if (groups.length == 0) {
                                    let warn = new Error('OIDC: GROUPS: No groups returned from API.');
                                    parent.authLog('getGroups', `WARN: ${warn.message} DATA: ${data}`);
                                    console.warn(warn);
                                    resolve(groups);
                                } else {
                                    resolve(groups);
                                }
                            });
                        });
                        req.on('error', (err) => {
                            let error = new Error('OIDC: GROUPS: Request error.', { cause: err });
                            parent.authLog('getGroups', `ERROR: ${error.message} URL: ${url} OPTIONS: ${JSON.stringify(options)}`);
                            console.error(error);
                            reject(error);
                        });
                        req.end();
                    });
                }
            }
        }
        return authStrategyFlags;
    }

    return setupDomainAuthStrategy;
};
