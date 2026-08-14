/**
* @description Administrative translation file HTTP handler
* @license Apache-2.0
*/

'use strict';

module.exports.createTranslations = function (options) {
    const state = options.state;
    const parent = options.parent;
    const serverRoot = options.serverRoot;
    const checkUserIpAddress = options.checkUserIpAddress;
    const checkIpAddressEx = options.checkIpAddressEx;
    const runtime = options.runtime || process;
    const spawn = options.spawn || require('child_process').spawn;
    const log = options.log || console.log;

    function getTranslationFile() {
        const customFile = state.path.join(parent.datapath, 'translate.json');
        if (state.fs.existsSync(customFile)) return customFile;
        const defaultFile = state.path.join(serverRoot, 'translate', 'translate.json');
        return state.fs.existsSync(defaultFile) ? defaultFile : null;
    }

    function handleRequest(req, res) {
        const domain = checkUserIpAddress(req, res);
        if (domain == null) return;
        if ((state.userAllowedIp != null) && (checkIpAddressEx(req, res, state.userAllowedIp, false) === false)) return;

        var user = null;
        if (state.args.user != null) {
            user = state.users['user/' + domain.id + '/' + state.args.user];
            if (!user) { parent.debug('web', 'handleTranslationsRequest: user not found.'); res.sendStatus(401); return; }
        } else {
            if (!req.session || !req.session.userid) { parent.debug('web', 'handleTranslationsRequest: failed checks (2).'); res.sendStatus(401); return; }
            user = state.users[req.session.userid];
            if (!user) { parent.debug('web', 'handleTranslationsRequest: user not found.'); res.sendStatus(401); return; }
            if (user.siteadmin !== 0xFFFFFFFF) { parent.debug('web', 'handleTranslationsRequest: user not site administrator.'); res.sendStatus(401); return; }
        }

        var requestData = '';
        req.setEncoding('utf8');
        req.on('data', function (chunk) { requestData += chunk; });
        req.on('end', function () {
            try { requestData = JSON.parse(requestData); } catch (ex) { requestData = null; }
            if (requestData == null) { res.sendStatus(404); return; }
            if (requestData.action === 'getTranslations') {
                const translationFile = getTranslationFile();
                if (translationFile == null) { res.sendStatus(404); return; }
                try { res.sendFile(translationFile); } catch (ex) { res.sendStatus(404); }
                return;
            }
            if (requestData.action === 'setTranslations') {
                state.fs.writeFile(state.path.join(parent.datapath, 'translate.json'), state.common.translationsToJson({ strings: requestData.strings }), function (err) {
                    res.send(JSON.stringify({ response: (err == null) ? 'ok' : err }));
                });
                return;
            }
            if (requestData.action !== 'translateServer') { res.sendStatus(404); return; }
            if (state.pendingTranslation === true) { res.send(JSON.stringify({ response: 'Server is already performing a translation.' })); return; }
            const versionMatch = runtime.version.match(/^v(\d+\.\d+)/);
            if ((versionMatch == null) || (Number(versionMatch[1]) < 8)) { res.send(JSON.stringify({ response: 'Server requires NodeJS 8.x or better.' })); return; }
            const translationFile = getTranslationFile();
            if (translationFile == null) { res.send(JSON.stringify({ response: 'Unable to find translate.js file on the server.' })); return; }

            res.send(JSON.stringify({ response: 'ok' }));
            log('Started server translation...');
            state.pendingTranslation = true;
            const child = spawn(runtime.argv[0], ['translate.js', 'translateall', translationFile], { timeout: 300000, cwd: state.path.join(serverRoot, 'translate') });
            var stdout = '', stderr = '';
            child.stdout.on('data', function (data) { stdout += data; });
            child.stderr.on('data', function (data) { stderr += data; });
            child.on('close', function (error) {
                delete state.pendingTranslation;
                if (error) log('Server translation error', error);
                if (stderr) log('Server translation stderr', stderr);
                log('Server translation completed.');
                stdout = null;
                stderr = null;
            });
        });
    }

    return { getTranslationFile: getTranslationFile, handleRequest: handleRequest };
};
