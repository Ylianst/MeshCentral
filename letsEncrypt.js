/**
* @description MeshCentral letsEncrypt module
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018
* @license Apache-2.0
* @version v0.0.1
*/

module.exports.CreateLetsEncrypt = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.webrootPath = obj.parent.path.join(obj.parent.datapath, 'acme-challenges');
    obj.workPath = obj.parent.path.join(obj.parent.datapath, 'acme-challenges', 'work');
    obj.logsPath = obj.parent.path.join(obj.parent.datapath, 'acme-challenges', 'logs');

    try { obj.parent.fs.mkdirSync(obj.webrootPath); } catch (e) { }
    try { obj.parent.fs.mkdirSync(obj.workPath); } catch (e) { }
    try { obj.parent.fs.mkdirSync(obj.logsPath); } catch (e) { }

    console.log('CreateLetsEncrypt-1', obj.webrootPath);
    console.log('CreateLetsEncrypt-1', obj.workPath);
    console.log('CreateLetsEncrypt-1', obj.logsPath);

    obj.lex = require('greenlock-express').create({
        // Set to https://acme-v01.api.letsencrypt.org/directory in production
        server: 'staging'

        // If you wish to replace the default plugins, you may do so here
        , challenges: {
            'http-01': require('le-challenge-fs').create({ webrootPath: obj.webrootPath })
        }
        , store: require('le-store-certbot').create({
            //configDir: '/etc/letsencrypt',
            //privkeyPath: ':configDir/live/:hostname/privkey.pem',
            //fullchainPath: ':configDir/live/:hostname/fullchain.pem',
            //certPath: ':configDir/live/:hostname/cert.pem',
            //chainPath: ':configDir/live/:hostname/chain.pem',
            workDir: obj.workPath,
            logsDir: obj.logsPath,
            webrootPath: obj.webrootPath,
            debug: false
        })
        , approveDomains: approveDomains
    });

    console.log('CreateLetsEncrypt-2');
    function approveDomains(opts, certs, func) {
        console.log('approveDomains', opts, certs);

        // This is where you check your database and associated
        // email addresses with domains and agreements and such


        // The domains being approved for the first time are listed in opts.domains
        // Certs being renewed are listed in certs.altnames
        if (certs) {
            opts.domains = ['example.com', 'yourdomain.com']
        } else {
            opts.email = 'john.doe@example.com';
            opts.agreeTos = true;
        }

        // NOTE: you can also change other options such as `challengeType` and `challenge`
        // opts.challengeType = 'http-01';
        // opts.challenge = require('le-challenge-fs').create({});

        func(null, { options: opts, certs: certs });
    }

    // Handles acme-challenge and redirects to https
    require('http').createServer(obj.lex.middleware(require('redirect-https')())).listen(81, function () { console.log("Listening for ACME http-01 challenges on", this.address()); });

    var app = require('express')();
    app.use('/', function (req, res) { res.end('Hello, World!'); });

    // Handles your app
    require('https').createServer(obj.lex.httpsOptions, obj.lex.middleware(app)).listen(443, function () { console.log("Listening for ACME tls-sni-01 challenges and serve app on", this.address()); });

    console.log('CreateLetsEncrypt-3');
    return obj;
}