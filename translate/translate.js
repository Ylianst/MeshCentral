/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2019-2021
* @license Apache-2.0
* @version v0.0.1
*/

const fs = require('fs');
const path = require('path');
//const zlib = require('zlib');
var performCheck = false;
var translationTable = null;
var sourceStrings = null;
var jsdom = null; //require('jsdom');
var esprima = null; //require('esprima'); // https://www.npmjs.com/package/esprima
var minifyLib = 2; // 0 = None, 1 = minify-js, 2 = HTMLMinifier
var minify = null;

var meshCentralSourceFiles = [
    "../views/agentinvite.handlebars",
    "../views/invite.handlebars",
    "../views/default.handlebars",
    "../views/default-mobile.handlebars",
    "../views/download.handlebars",
    "../views/download2.handlebars",
    "../views/error404.handlebars",
    "../views/error404-mobile.handlebars",
    "../views/login.handlebars",
    "../views/login2.handlebars",
    "../views/login-mobile.handlebars",
    "../views/terms.handlebars",
    "../views/terms-mobile.handlebars",
    "../views/xterm.handlebars",
    "../views/message.handlebars",
    "../views/message2.handlebars",
    "../views/messenger.handlebars",
    "../views/player.handlebars",
    "../views/sharing.handlebars",
    "../views/mstsc.handlebars",
    "../views/ssh.handlebars",
    "../emails/account-check.html",
    "../emails/account-invite.html",
    "../emails/account-login.html",
    "../emails/account-reset.html",
    "../emails/mesh-invite.html",
    "../emails/device-notify.html",
    "../emails/device-help.html",
    "../emails/account-check.txt",
    "../emails/account-invite.txt",
    "../emails/account-login.txt",
    "../emails/account-reset.txt",
    "../emails/mesh-invite.txt",
    "../emails/device-notify.txt",
    "../emails/device-help.txt",
    "../emails/sms-messages.txt",
    "../agents/agent-translations.json",
    "../agents/modules_meshcore/coretranslations.json"
];

var minifyMeshCentralSourceFiles = [
    "../views/agentinvite.handlebars",
    "../views/invite.handlebars",
    "../views/default.handlebars",
    "../views/default-mobile.handlebars",
    "../views/download.handlebars",
    "../views/download2.handlebars",
    "../views/error404.handlebars",
    "../views/error4042.handlebars",
    "../views/error404-mobile.handlebars",
    "../views/login.handlebars",
    "../views/login2.handlebars",
    "../views/login-mobile.handlebars",
    "../views/terms.handlebars",
    "../views/terms-mobile.handlebars",
    "../views/xterm.handlebars",
    "../views/message.handlebars",
    "../views/message2.handlebars",
    "../views/messenger.handlebars",
    "../views/player.handlebars",
    "../views/sharing.handlebars",
    "../views/sharing-mobile.handlebars",
    "../views/mstsc.handlebars",
    "../views/ssh.handlebars",
    "../public/scripts/agent-desktop-0.0.2.js",
    "../public/scripts/agent-rdp-0.0.1.js",
    "../public/scripts/agent-redir-rtc-0.1.0.js",
    "../public/scripts/agent-redir-ws-0.1.1.js",
    "../public/scripts/amt-0.2.0.js",
    "../public/scripts/amt-desktop-0.0.2.js",
    "../public/scripts/amt-ider-ws-0.0.1.js",
    "../public/scripts/amt-redir-ws-0.1.0.js",
    "../public/scripts/amt-script-0.2.0.js",
    "../public/scripts/amt-setupbin-0.1.0.js",
    "../public/scripts/amt-terminal-0.0.2.js",
    "../public/scripts/amt-wsman-0.2.0.js",
    "../public/scripts/amt-wsman-ws-0.2.0.js",
    "../public/scripts/charts.js",
    "../public/scripts/common-0.0.1.js",
    "../public/scripts/meshcentral.js",
    "../public/scripts/ol.js",
    "../public/scripts/ol3-contextmenu.js",
    "../public/scripts/u2f-api.js",
    "../public/scripts/xterm-addon-fit.js",
    "../public/scripts/xterm.js",
    "../public/scripts/zlib-adler32.js",
    "../public/scripts/zlib-crc32.js",
    "../public/scripts/zlib-inflate.js",
    "../public/scripts/zlib.js"
];

// True is this module is run directly using NodeJS
var directRun = (require.main === module);

// Check NodeJS version
const NodeJSVer = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
if (directRun && (NodeJSVer < 8)) { log("Translate.js requires Node v8 or above, current version is " + process.version + "."); return; }

// node translate.json CHECK ../meshcentral/views/default.handlebars
// node translate.json EXTRACT bob.json ../meshcentral/views/default.handlebars
// node translate.js TRANSLATE fr test2.json ../meshcentral/views/default.handlebars

var worker = null;
function log() {
    if (worker == null) {
        console.log(...arguments);
    } else {
        worker.parentPort.postMessage({ msg: arguments[0] })
    }
}

if (directRun && (NodeJSVer >= 12)) {
    const xworker = require('worker_threads');
    try {
        if (xworker.isMainThread == false) {
            // We are being called to do some work
            worker = xworker;
            const op = worker.workerData.op;
            const args = worker.workerData.args;

            // Get things setup
            jsdom = require('jsdom');
            esprima = require('esprima'); // https://www.npmjs.com/package/esprima
            if (minifyLib == 1) { minify = require('minify-js'); }
            if (minifyLib == 2) { minify = require('html-minifier').minify; } // https://www.npmjs.com/package/html-minifier

            switch (op) {
                case 'translate': {
                    translateSingleThreaded(args[0], args[1], args[2], args[3]);
                    break;
                }
            }
            return;
        }
    } catch (ex) { log(ex); }
}

if (directRun) { setup(); }

function setup() {
    var libs = ['jsdom', 'esprima', 'minify-js'];
    if (minifyLib == 1) { libs.push('minify-js'); }
    if (minifyLib == 2) { libs.push('html-minifier'); }
    InstallModules(libs, start);
}

function start() { startEx(process.argv); }

function startEx(argv) {
    // Load dependencies
    jsdom = require('jsdom');
    esprima = require('esprima'); // https://www.npmjs.com/package/esprima
    if (minifyLib == 1) { minify = require('minify-js'); }
    if (minifyLib == 2) { minify = require('html-minifier').minify; } // https://www.npmjs.com/package/html-minifier

    var command = null;
    if (argv.length > 2) { command = argv[2].toLowerCase(); }
    if (['minify', 'check', 'extract', 'extractall', 'translate', 'translateall', 'minifyall', 'minifydir', 'merge', 'totext', 'fromtext', 'remove'].indexOf(command) == -1) { command = null; }

    if (directRun) { log('MeshCentral web site translator'); }
    if (command == null) {
        log('Usage "node translate.js [command] [options]');
        log('Possible commands:');
        log('');
        log('  CHECK [files]');
        log('    Check will pull string out of a web page and display a report.');
        log('');
        log('  EXTRACT [languagefile] [files]');
        log('    Extract strings from web pages and generate a language (.json) file.');
        log('');
        log('  EXTRACTALL (languagefile)');
        log('    Extract all MeshCentral strings from web pages and generate the languages.json file.');
        log('');
        log('  TRANSLATE [language] [languagefile] [files]');
        log('    Use a language (.json) file to translate web pages to a give language.');
        log('');
        log('  TRANSLATEALL (languagefile) (language code)');
        log('    Translate all MeshCentral strings using the languages.json file.');
        log('');
        log('  MINIFY [sourcefile]');
        log('    Minify a single file.');
        log('');
        log('  MINIFYDIR [sourcedir] [destinationdir]');
        log('    Minify all files in a directory.');
        log('');
        log('  MINIFYALL');
        log('    Minify the main MeshCentral english web pages.');
        log('');
        log('  MERGE [sourcefile] [targetfile] [language code]');
        log('    Merge a language from a translation file into another translation file.');
        log('');
        log('  TOTEXT [translationfile] [textfile] [language code]');
        log('    Save a text for with all strings of a given language.');
        log('');
        log('  FROMTEXT [translationfile] [textfile] [language code]');
        log('    Import raw text string as translations for a language code.');
        process.exit();
        return;
    }

    // Extract strings from web pages and display a report
    if (command == 'check') {
        var sources = [];
        for (var i = 3; i < argv.length; i++) { if (fs.existsSync(argv[i]) == false) { log('Missing file: ' + argv[i]); process.exit(); return; } sources.push(argv[i]); }
        if (sources.length == 0) { log('No source files specified.'); process.exit(); return; }
        performCheck = true;
        sourceStrings = {};
        for (var i = 0; i < sources.length; i++) { extractFromHtml(sources[i]); }
        var count = 0;
        for (var i in sourceStrings) { count++; }
        log('Extracted ' + count + ' strings.');
        process.exit();
        return;
    }

    // Extract strings from web pages
    if (command == 'extract') {
        if (argv.length < 4) { log('No language file specified.'); process.exit(); return; }
        var sources = [];
        for (var i = 4; i < argv.length; i++) { if (fs.existsSync(argv[i]) == false) { log('Missing file: ' + argv[i]); process.exit(); return; } sources.push(argv[i]); }
        if (sources.length == 0) { log('No source files specified.'); process.exit(); return; }
        extract(argv[3], sources);
    }

    // Save a text file with all the strings for a given language
    if (command == 'totext') {
        if ((argv.length == 6)) {
            if (fs.existsSync(argv[3]) == false) { log('Unable to find: ' + argv[3]); return; }
            totext(argv[3], argv[4], argv[5]);
        } else {
            log('Usage: TOTEXT [translationfile] [textfile] [language code]');
        }
        return;
    }

    // Read a text file and use it as translation for a given language
    if (command == 'fromtext') {
        if ((argv.length == 6)) {
            if (fs.existsSync(argv[3]) == false) { log('Unable to find: ' + argv[3]); return; }
            if (fs.existsSync(argv[4]) == false) { log('Unable to find: ' + argv[4]); return; }
            fromtext(argv[3], argv[4], argv[5]);
        } else {
            log('Usage: FROMTEXT [translationfile] [textfile] [language code]');
        }
        return;
    }

    // Merge one language from a language file into another language file.
    if (command == 'merge') {
        if ((argv.length == 6)) {
            if (fs.existsSync(argv[3]) == false) { log('Unable to find: ' + argv[3]); return; }
            if (fs.existsSync(argv[4]) == false) { log('Unable to find: ' + argv[4]); return; }
            merge(argv[3], argv[4], argv[5]);
        } else {
            log('Usage: MERGE [sourcefile] [tartgetfile] [language code]');
        }
        return;
    }

    // Extract or translate all MeshCentral strings
    if (command == 'extractall') {
        if (argv.length > 4) { lang = argv[4].toLowerCase(); }
        var translationFile = 'translate.json';
        if (argv.length > 3) {
            if (fs.existsSync(argv[3]) == false) { log('Unable to find: ' + argv[3]); return; } else { translationFile = argv[3]; }
        }
        extract(translationFile, meshCentralSourceFiles, translationFile);
    }

    // Remove a language from a translation file
    if (command == 'remove') {
        if (argv.length <= 3) { log('Usage: remove [language] (file)'); return; }
        lang = argv[3].toLowerCase();
        var translationFile = 'translate.json';
        if (argv.length > 4) {
            if (fs.existsSync(argv[4]) == false) { log('Unable to find: ' + argv[4]); return; } else { translationFile = argv[4]; }
        }
        sourceStrings = {};
        if (fs.existsSync(translationFile) == false) { log('Unable to find: ' + translationFile); return; }
        var langFileData = null;
        try { langFileData = JSON.parse(fs.readFileSync(translationFile)); } catch (ex) { }
        if ((langFileData == null) || (langFileData.strings == null)) { log("Invalid language file."); process.exit(); return; }
        for (var i in langFileData.strings) { delete langFileData.strings[i][lang]; }
        fs.writeFileSync(translationFile, translationsToJson({ strings: langFileData.strings }), { flag: 'w+' });
        log("Done.");
        return;
    }

    if (command == 'translateall') {
        if (fs.existsSync('../views/translations') == false) { fs.mkdirSync('../views/translations'); }
        //if (fs.existsSync('../public/translations') == false) { fs.mkdirSync('../public/translations'); }
        var lang = null;
        if (argv.length > 4) { lang = argv[4].toLowerCase(); }
        if (argv.length > 3) {
            if (fs.existsSync(argv[3]) == false) {
                log('Unable to find: ' + argv[3]);
            } else {
                translate(lang, argv[3], meshCentralSourceFiles, 'translations');
            }
        } else {
            if (fs.existsSync('translate.json') == false) {
                log('Unable to find translate.json.');
            } else {
                translate(lang, 'translate.json', meshCentralSourceFiles, 'translations');
            }
        }
        return;
    }

    // Translate web pages to a given language given a language file
    if (command == 'translate') {
        if (argv.length < 4) { log("No language specified."); process.exit(); return; }
        if (argv.length < 5) { log("No language file specified."); process.exit(); return; }
        var lang = argv[3].toLowerCase();
        var langFile = argv[4];
        if (fs.existsSync(langFile) == false) { log("Missing language file: " + langFile); process.exit(); return; }

        var sources = [], subdir = null;
        for (var i = 5; i < argv.length; i++) {
            if (argv[i].startsWith('--subdir:')) {
                subdir = argv[i].substring(9);
            } else {
                if (fs.existsSync(argv[i]) == false) { log("Missing file: " + argv[i]); process.exit(); return; } sources.push(argv[i]);
            }
        }
        if (sources.length == 0) { log("No source files specified."); process.exit(); return; }
        translate(lang, langFile, sources, subdir);
    }

    if (command == 'minifydir') {
        if (argv.length < 4) { log("Command source and/or destination folders missing."); process.exit(); return; }
        const sourceFiles = fs.readdirSync(argv[3]);
        for (var i in sourceFiles) {
            if (sourceFiles[i].endsWith('.js') || sourceFiles[i].endsWith('.json')) {
                console.log("Processing " + sourceFiles[i] + "...");
                const sourceFile = path.join(argv[3], sourceFiles[i]);
                if (sourceFiles[i].endsWith('.js')) {
                    // Minify the file .js file
                    const destinationFile = path.join(argv[4], sourceFiles[i].substring(0, sourceFiles[i].length - 3) + '.min.js');
                    if (minifyLib = 2) {
                        var inFile = fs.readFileSync(sourceFile).toString();

                        // Perform minification pre-processing
                        if (sourceFile.endsWith('.handlebars') >= 0) { inFile = inFile.split('{{{pluginHandler}}}').join('"{{{pluginHandler}}}"'); }
                        if (sourceFile.endsWith('.js')) { inFile = '<script>' + inFile + '</script>'; }

                        var minifiedOut = minify(inFile, {
                            collapseBooleanAttributes: true,
                            collapseInlineTagWhitespace: false, // This is not good.
                            collapseWhitespace: true,
                            minifyCSS: true,
                            minifyJS: true,
                            removeComments: true,
                            removeOptionalTags: true,
                            removeEmptyAttributes: true,
                            removeAttributeQuotes: true,
                            removeRedundantAttributes: true,
                            removeScriptTypeAttributes: true,
                            removeTagWhitespace: true,
                            preserveLineBreaks: false,
                            useShortDoctype: true
                        });

                        // Perform minification post-processing
                        if (sourceFile.endsWith('.js')) { minifiedOut = minifiedOut.substring(8, minifiedOut.length - 9); }
                        if (sourceFile.endsWith('.handlebars') >= 0) { minifiedOut = minifiedOut.split('"{{{pluginHandler}}}"').join('{{{pluginHandler}}}'); }
                        fs.writeFileSync(destinationFile, minifiedOut, { flag: 'w+' });
                    }
                } else if (sourceFiles[i].endsWith('.json')) {
                    // Minify the file .json file
                    const destinationFile = path.join(argv[4], sourceFiles[i]);
                    var inFile = JSON.parse(fs.readFileSync(sourceFile).toString());
                    fs.writeFileSync(destinationFile, JSON.stringify(inFile), { flag: 'w+' });
                }

            }
        }
    }

    if (command == 'minifyall') {
        for (var i in minifyMeshCentralSourceFiles) {
            var outname = minifyMeshCentralSourceFiles[i];
            var outnamemin = null;
            if (outname.endsWith('.handlebars')) {
                outnamemin = (outname.substring(0, outname.length - 11) + '-min.handlebars');
            } else if (outname.endsWith('.html')) {
                outnamemin = (outname.substring(0, outname.length - 5) + '-min.html');
            } else if (outname.endsWith('.htm')) {
                outnamemin = (outname.substring(0, outname.length - 4) + '-min.htm');
            } else if (outname.endsWith('.js')) {
                outnamemin = (outname.substring(0, outname.length - 3) + '-min.js');
            } else {
                outnamemin = (outname, outname + '.min');
            }
            log('Generating ' + outnamemin + '...');

            /*
            // Minify the file
            if (minifyLib == 1) {
                minify.file({
                    file: outname,
                    dist: outnamemin
                }, function (e, compress) {
                    if (e) { log('ERROR ', e); return done(); }
                    compress.run((e) => { e ? log('Minification fail', e) : log('Minification sucess'); minifyDone(); });
                }
                );
            }
            */

            // Minify the file
            if (minifyLib == 2) {
                var inFile = fs.readFileSync(outname).toString();

                // Perform minification pre-processing
                if (outname.endsWith('.handlebars') >= 0) { inFile = inFile.split('{{{pluginHandler}}}').join('"{{{pluginHandler}}}"'); }
                if (outname.endsWith('.js')) { inFile = '<script>' + inFile + '</script>'; }

                var minifiedOut = null;
                try {
                    minifiedOut = minify(inFile, {
                        collapseBooleanAttributes: true,
                        collapseInlineTagWhitespace: false, // This is not good.
                        collapseWhitespace: true,
                        minifyCSS: true,
                        minifyJS: true,
                        removeComments: true,
                        removeOptionalTags: true,
                        removeEmptyAttributes: true,
                        removeAttributeQuotes: true,
                        removeRedundantAttributes: true,
                        removeScriptTypeAttributes: true,
                        removeTagWhitespace: true,
                        preserveLineBreaks: false,
                        useShortDoctype: true
                    });
                } catch (ex) {
                    console.log(ex);
                }

                // Perform minification post-processing
                if (outname.endsWith('.js')) { minifiedOut = minifiedOut.substring(8, minifiedOut.length - 9); }
                if (outname.endsWith('.handlebars') >= 0) { minifiedOut = minifiedOut.split('"{{{pluginHandler}}}"').join('{{{pluginHandler}}}'); }

                fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });

                /*
                if (outname.endsWith('.js')) {
                    var compressHandler = function compressHandlerFunc(err, buffer, outnamemin2) {
                        if (err == null) {
                            console.log('GZIP', compressHandlerFunc.outname);
                            fs.writeFileSync(compressHandlerFunc.outname, buffer, { flag: 'w+' });
                        }
                    };
                    compressHandler.outname = outnamemin;
                    zlib.gzip(Buffer.from(minifiedOut), compressHandler);
                } else {
                    fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
                }
                */
            }
        }
    }

    if (command == 'minify') {
        var outname = argv[3];
        var outnamemin = null;
        if (outname.endsWith('.handlebars')) {
            outnamemin = (outname.substring(0, outname.length - 11) + '-min.handlebars');
        } else if (outname.endsWith('.html')) {
            outnamemin = (outname.substring(0, outname.length - 5) + '-min.html');
        } else if (outname.endsWith('.htm')) {
            outnamemin = (outname.substring(0, outname.length - 4) + '-min.htm');
        } else {
            outnamemin = (outname, outname + '.min');
        }
        log('Generating ' + path.basename(outnamemin) + '...');

        // Minify the file
        if (minifyLib = 2) {
            var inFile = fs.readFileSync(outname).toString()

            // Perform minification pre-processing
            if (outname.endsWith('.handlebars') >= 0) { inFile = inFile.split('{{{pluginHandler}}}').join('"{{{pluginHandler}}}"'); }
            if (outname.endsWith('.js')) { inFile = '<script>' + inFile + '</script>'; }

            var minifiedOut = minify(inFile, {
                collapseBooleanAttributes: true,
                collapseInlineTagWhitespace: false, // This is not good.
                collapseWhitespace: true,
                minifyCSS: true,
                minifyJS: true,
                removeComments: true,
                removeOptionalTags: true,
                removeEmptyAttributes: true,
                removeAttributeQuotes: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeTagWhitespace: true,
                preserveLineBreaks: false,
                useShortDoctype: true
            });

            // Perform minification post-processing
            if (outname.endsWith('.js')) { minifiedOut = minifiedOut.substring(8, minifiedOut.length - 9); }
            if (outname.endsWith('.handlebars') >= 0) { minifiedOut = minifiedOut.split('"{{{pluginHandler}}}"').join('{{{pluginHandler}}}'); }
            fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
        }
    }
}


function totext(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { console.log(ex); }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { log("Invalid source language file."); process.exit(); return; }

    log('Writing ' + lang + '...');

    // Generate raw text
    var output = [];
    var outputCharCount = 0; // Google has a 5000 character limit
    var splitOutput = [];
    var splitOutputPtr = 1;
    var count = 0;
    for (var i in sourceLangFileData.strings) {
        if ((sourceLangFileData.strings[i][lang] != null) && (sourceLangFileData.strings[i][lang].indexOf('\r') == -1) && (sourceLangFileData.strings[i][lang].indexOf('\n') == -1)) {
            output.push(sourceLangFileData.strings[i][lang]);
            outputCharCount += (sourceLangFileData.strings[i][lang].length + 2);
            if (outputCharCount > 4500) { outputCharCount = 0; splitOutputPtr++; }
            if (splitOutput[splitOutputPtr] == null) { splitOutput[splitOutputPtr] = []; }
            splitOutput[splitOutputPtr].push(sourceLangFileData.strings[i][lang]);
        } else {
            output.push('');
            outputCharCount += 2;
            if (outputCharCount > 4500) { outputCharCount = 0; splitOutputPtr++; }
            if (splitOutput[splitOutputPtr] == null) { splitOutput[splitOutputPtr] = []; }
            splitOutput[splitOutputPtr].push('');
        }
        count++;
    }

    if (splitOutputPtr == 1) {
        // Save the target back
        fs.writeFileSync(target + '-' + lang + '.txt', output.join('\r\n'), { flag: 'w+' });
        log('Done.');
    } else {
        // Save the text in 1000 string bunches
        for (var i in splitOutput) {
            log('Writing ' + target + '-' + lang + '-' + i + '.txt...');
            fs.writeFileSync(target + '-' + lang + '-' + i + '.txt', splitOutput[i].join('\r\n'), { flag: 'w+' });
        }
        log('Done.');
    }
}

function fromtext(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { console.log(ex); }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { log("Invalid source language file."); process.exit(); return; }

    log('Updating ' + lang + '...');

    // Read raw text
    var rawText = fs.readFileSync(target).toString('utf8');
    var rawTextArray = rawText.split('\r\n');
    var rawTextPtr = 0;

    log('Translation file: ' + sourceLangFileData.strings.length + ' string(s)');
    log('Text file: ' + rawTextArray.length + ' string(s)');
    if (sourceLangFileData.strings.length != rawTextArray.length) { log('String count mismatch, unable to import.'); process.exit(1); return; }

    var output = [];
    var splitOutput = [];
    for (var i in sourceLangFileData.strings) {
        if ((sourceLangFileData.strings[i]['en'] != null) && (sourceLangFileData.strings[i]['en'].indexOf('\r') == -1) && (sourceLangFileData.strings[i]['en'].indexOf('\n') == -1)) {
            if (sourceLangFileData.strings[i][lang] == null) { sourceLangFileData.strings[i][lang] = rawTextArray[i]; }
        }
    }

    fs.writeFileSync(source + '-new', translationsToJson(sourceLangFileData), { flag: 'w+' });
    log('Done.');
}

function merge(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { console.log(ex); }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { log("Invalid source language file."); process.exit(); return; }

    // Load the target language file
    var targetLangFileData = null;
    try { targetLangFileData = JSON.parse(fs.readFileSync(target)); } catch (ex) { console.log(ex); }
    if ((targetLangFileData == null) || (targetLangFileData.strings == null)) { log("Invalid target language file."); process.exit(); return; }

    log('Merging ' + lang + '...');

    // Index the target file
    var index = {};
    for (var i in targetLangFileData.strings) { if (targetLangFileData.strings[i].en != null) { index[targetLangFileData.strings[i].en] = targetLangFileData.strings[i]; } }

    // Merge the translation
    for (var i in sourceLangFileData.strings) {
        if ((sourceLangFileData.strings[i].en != null) && (sourceLangFileData.strings[i][lang] != null) && (index[sourceLangFileData.strings[i].en] != null)) {
            //if (sourceLangFileData.strings[i][lang] == null) {
                index[sourceLangFileData.strings[i].en][lang] = sourceLangFileData.strings[i][lang];
            //}
        }
    }

    // Deindex the new target file
    var targetData = { strings: [] };
    for (var i in index) { targetData.strings.push(index[i]); }

    // Save the target back
    fs.writeFileSync(target, translationsToJson(targetData), { flag: 'w+' });
    log('Done.');
}

function translate(lang, langFile, sources, createSubDir) {
    if (directRun && (NodeJSVer >= 12) && (lang == null)) {
        // Multi threaded translation
        log("Multi-threaded translation.");

        // Load the language file
        var langFileData = null;
        try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { console.log(ex); }
        if ((langFileData == null) || (langFileData.strings == null)) { log("Invalid language file."); process.exit(); return; }

        langs = {};
        for (var i in langFileData.strings) { var entry = langFileData.strings[i]; for (var j in entry) { if ((j != 'en') && (j != 'xloc') && (j != '*')) { langs[j.toLowerCase()] = true; } } }
        for (var i in langs) {
            const { Worker } = require('worker_threads')
            const worker = new Worker('./translate.js', { stdout: true, workerData: { op: 'translate', args: [i, langFile, sources, createSubDir] } });
            worker.stdout.on('data', function (msg) { console.log('wstdio:', msg.toString()); });
            worker.on('message', function (message) { console.log(message.msg); });
            worker.on('error', function (error) { console.log('error', error); });
            worker.on('exit', function (code) { /*console.log('exit', code);*/ })
        }
    } else {
        // Single threaded translation
        translateSingleThreaded(lang, langFile, sources, createSubDir);
    }

    // Translate any JSON files
    for (var i = 0; i < sources.length; i++) { if (sources[i].endsWith('.json')) { translateAllInJson(lang, langFile, sources[i]); } }
}

function translateSingleThreaded(lang, langFile, sources, createSubDir) {
    // Load the language file
    var langFileData = null;
    try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { }
    if ((langFileData == null) || (langFileData.strings == null)) { log("Invalid language file."); process.exit(); return; }

    if ((lang != null) && (lang != '*')) {
        // Translate a single language
        translateEx(lang, langFileData, sources, createSubDir);
    } else {
        // See that languages are in the translation file
        langs = {};
        for (var i in langFileData.strings) { var entry = langFileData.strings[i]; for (var j in entry) { if ((j != 'en') && (j != 'xloc') && (j != '*')) { langs[j.toLowerCase()] = true; } } }
        for (var i in langs) { translateEx(i, langFileData, sources, createSubDir); }
    }

    //process.exit();
    return;
}

function translateEx(lang, langFileData, sources, createSubDir) {
    // Build translation table, simple source->target for the given language.
    translationTable = {};
    for (var i in langFileData.strings) {
        var entry = langFileData.strings[i];
        if ((entry['en'] != null) && (entry[lang] != null)) { translationTable[entry['en']] = entry[lang]; }
    }
    // Translate the files
    for (var i = 0; i < sources.length; i++) {
        if (sources[i].endsWith('.html') || sources[i].endsWith('.htm') || sources[i].endsWith('.handlebars')) { translateFromHtml(lang, sources[i], createSubDir); }
        else if (sources[i].endsWith('.txt')) { translateFromTxt(lang, sources[i], createSubDir); }
    }
}

function extract(langFile, sources) {
    sourceStrings = {};
    if (fs.existsSync(langFile) == true) {
        var langFileData = null;
        try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { }
        if ((langFileData == null) || (langFileData.strings == null)) { log("Invalid language file."); process.exit(); return; }
        for (var i in langFileData.strings) {
            sourceStrings[langFileData.strings[i]['en']] = langFileData.strings[i];
            delete sourceStrings[langFileData.strings[i]['en']].xloc;
        }
    }
    for (var i = 0; i < sources.length; i++) {
        if (sources[i].endsWith('.html') || sources[i].endsWith('.htm') || sources[i].endsWith('.handlebars')) { extractFromHtml(sources[i]); } 
        else if (sources[i].endsWith('.txt')) { extractFromTxt(sources[i]); }
        else if (sources[i].endsWith('.json')) { extractFromJson(sources[i]); }
    }
    var count = 0, output = [];
    for (var i in sourceStrings) {
        count++;
        sourceStrings[i]['en'] = i;
        //if ((sourceStrings[i].xloc != null) && (sourceStrings[i].xloc.length > 0)) { output.push(sourceStrings[i]); } // Only save results that have a source location.
        output.push(sourceStrings[i]); // Save all results
    }
    fs.writeFileSync(langFile, translationsToJson({ strings: output }), { flag: 'w+' });
    log(format("{0} strings in output file.", count));
    //process.exit();
    return;
}

function extractFromTxt(file) {
    log("Processing TXT: " + path.basename(file));
    var lines = fs.readFileSync(file).toString().split('\r\n');
    var name = path.basename(file);
    for (var i in lines) {
        var line = lines[i];
        if ((line.length > 1) && (line[0] != '~')) {
            if (sourceStrings[line] == null) { sourceStrings[line] = { en: line, xloc: [name] }; } else { if (sourceStrings[line].xloc == null) { sourceStrings[line].xloc = []; } sourceStrings[line].xloc.push(name); }
        }
    }
}

function extractFromJson(file) {
    log("Processing JSON: " + path.basename(file));
    var json = JSON.parse(fs.readFileSync(file).toString());
    var name = path.basename(file);
    if (json.en == null) return;
    for (var i in json.en) {
        if (typeof json.en[i] == 'string') {
            const str = json.en[i]
            if (sourceStrings[str] == null) {
                sourceStrings[str] = { en: str, xloc: [name] };
            } else {
                if (sourceStrings[str].xloc == null) { sourceStrings[str].xloc = []; } sourceStrings[str].xloc.push(name);
            }
        } else if (Array.isArray(json.en[i])) {
            for (var k in json.en[i]) {
                if (typeof json.en[i][k] == 'string') {
                    const str = json.en[i][k];
                    if (sourceStrings[str] == null) { sourceStrings[str] = { en: str, xloc: [name] }; } else { if (sourceStrings[str].xloc == null) { sourceStrings[str].xloc = []; } sourceStrings[str].xloc.push(name); }
                }
            }
        }
    }
}

function extractFromHtml(file) {
    var data = fs.readFileSync(file);
    var { JSDOM } = jsdom;
    const dom = new JSDOM(data, { includeNodeLocations: true });
    log("Processing HTML: " + path.basename(file));
    getStringsHtml(path.basename(file), dom.window.document.querySelector('body'));
}

function getStringsHtml(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        var subnodeignore = false;
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodevalue = null, subnodeplaceholder = null, subnodetitle = null;
            for (var j in subnode.attributes) {
                if ((subnode.attributes[j].name == 'notrans') && (subnode.attributes[j].value == '1')) { subnodeignore = true; }
                if ((subnode.attributes[j].name == 'type') && (subnode.attributes[j].value == 'hidden')) { subnodeignore = true; }
                if (subnode.attributes[j].name == 'value') { subnodevalue = subnode.attributes[j].value; }
                if (subnode.attributes[j].name == 'placeholder') { subnodeplaceholder = subnode.attributes[j].value; }
                if (subnode.attributes[j].name == 'title') { subnodetitle = subnode.attributes[j].value; }
            }
            if ((subnodevalue != null) && isNumber(subnodevalue) == true) { subnodevalue = null; }
            if ((subnodeplaceholder != null) && isNumber(subnodeplaceholder) == true) { subnodeplaceholder = null; }
            if ((subnodetitle != null) && isNumber(subnodetitle) == true) { subnodetitle = null; }
            if ((subnodeignore == false) && (subnodevalue != null)) {
                // Add a new string to the list (value)
                if (sourceStrings[subnodevalue] == null) { sourceStrings[subnodevalue] = { en: subnodevalue, xloc: [name] }; } else { if (sourceStrings[subnodevalue].xloc == null) { sourceStrings[subnodevalue].xloc = []; } sourceStrings[subnodevalue].xloc.push(name); }
            }
            if (subnodeplaceholder != null) {
                // Add a new string to the list (placeholder)
                if (sourceStrings[subnodeplaceholder] == null) { sourceStrings[subnodeplaceholder] = { en: subnodeplaceholder, xloc: [name] }; } else { if (sourceStrings[subnodeplaceholder].xloc == null) { sourceStrings[subnodeplaceholder].xloc = []; } sourceStrings[subnodeplaceholder].xloc.push(name); }
            }
            if (subnodetitle != null) {
                // Add a new string to the list (title)
                if (sourceStrings[subnodetitle] == null) { sourceStrings[subnodetitle] = { en: subnodetitle, xloc: [name] }; } else { if (sourceStrings[subnodetitle].xloc == null) { sourceStrings[subnodetitle].xloc = []; } sourceStrings[subnodetitle].xloc.push(name); }
            }
        }

        if (subnodeignore == false) {
            // Check the content of the element
            var subname = subnode.id;
            if (subname == null || subname == '') { subname = i; }
            if (subnode.hasChildNodes()) {
                getStringsHtml(name + '->' + subname, subnode);
            } else {
                if (subnode.nodeValue == null) continue;
                var nodeValue = subnode.nodeValue.trim().split('\\r').join('').split('\\n').join('').trim();
                if ((nodeValue.length > 0) && (subnode.nodeType == 3)) {
                    if ((node.tagName != 'SCRIPT') && (node.tagName != 'STYLE') && (nodeValue.length < 8000) && (nodeValue.startsWith('{{{') == false) && (nodeValue != ' ')) {
                        if (performCheck) { log('  "' + nodeValue + '"'); }
                        // Add a new string to the list
                        if (sourceStrings[nodeValue] == null) { sourceStrings[nodeValue] = { en: nodeValue, xloc: [name] }; } else { if (sourceStrings[nodeValue].xloc == null) { sourceStrings[nodeValue].xloc = []; } sourceStrings[nodeValue].xloc.push(name); }
                    } else if (node.tagName == 'SCRIPT') {
                        // Parse JavaScript
                        getStringFromJavaScript(name, subnode.nodeValue);
                    }
                }
            }
        }
    }
}

function getStringFromJavaScript(name, script) {
    if (performCheck) { log(format('Processing JavaScript of {0} bytes: {1}', script.length, name)); }
    var tokenScript = esprima.tokenize(script), count = 0;
    for (var i in tokenScript) {
        var token = tokenScript[i];
        if ((token.type == 'String') && (token.value.length > 2) && (token.value[0] == '"')) {
            var str = token.value.substring(1, token.value.length - 1);
            //if (performCheck) { log('  ' + name + '->' + (++count), token.value); }
            if (performCheck) { log('  ' + token.value); }
            if (sourceStrings[str] == null) { sourceStrings[str] = { en: str, xloc: [name + '->' + (++count)] }; } else { if (sourceStrings[str].xloc == null) { sourceStrings[str].xloc = []; } sourceStrings[str].xloc.push(name + '->' + (++count)); }
        }
    }
}

function translateFromTxt(lang, file, createSubDir) {
    log("Translating TXT (" + lang + "): " + path.basename(file));
    var lines = fs.readFileSync(file).toString().split('\r\n'), outlines = [];
    for (var i in lines) {
        var line = lines[i];
        if ((line.length > 1) && (line[0] != '~')) {
            if (translationTable[line] != null) { outlines.push(translationTable[line]); } else { outlines.push(line); }
        } else {
            outlines.push(line);
        }
    }

    var outname = file, out = outlines.join('\r\n');
    if (createSubDir != null) {
        var outfolder = path.join(path.dirname(file), createSubDir);
        if (fs.existsSync(outfolder) == false) { fs.mkdirSync(outfolder); }
        outname = path.join(path.dirname(file), createSubDir, path.basename(file));
    }
    outname = (outname.substring(0, outname.length - 4) + '_' + lang + '.txt');
    fs.writeFileSync(outname, out, { flag: 'w+' });
}

function translateAllInJson(xlang, langFile, file) {
    log("Translating JSON (" + ((xlang == null)?'All':xlang) + "): " + path.basename(file));

    // Load the language file
    var langFileData = null;
    try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { console.log(ex); }
    if ((langFileData == null) || (langFileData.strings == null)) { log("Invalid language file."); process.exit(); return; }
    var languages = [];

    // Build translation table, simple source->target for the given language.
    var xtranslationTable = {};
    for (var i in langFileData.strings) {
        var entry = langFileData.strings[i];
        for (var lang in entry) {
            if ((lang == 'en') || (lang == 'xloc')) continue;
            if ((xlang != null) && (lang != xlang)) continue;
            if (languages.indexOf(lang) == -1) { languages.push(lang); xtranslationTable[lang] = {}; }
            if ((entry['en'] != null) && (entry[lang] != null)) { xtranslationTable[lang][entry['en']] = entry[lang]; }
        }
    }

    // Load and translate
    var json = JSON.parse(fs.readFileSync(file).toString());
    if (json.en != null) {
        for (var j in languages) {
            var lang = languages[j];
            for (var i in json.en) {
                if ((typeof json.en[i] == 'string') && (xtranslationTable[lang][json.en[i]] != null)) {
                    // Translate a string
                    if (json[lang] == null) { json[lang] = {}; }
                    json[lang][i] = xtranslationTable[lang][json.en[i]];
                } else if (Array.isArray(json.en[i])) {
                    // Translate an array of strings
                    var r = [], translateCount = 0;
                    for (var k in json.en[i]) {
                        var str = json.en[i][k];
                        if (xtranslationTable[lang][str] != null) { r.push(xtranslationTable[lang][str]); translateCount++; } else { r.push(str); }
                    }
                    if (translateCount > 0) { json[lang][i] = r; }
                }
            }
        }
    }

    // Save the results
    fs.writeFileSync(file, JSON.stringify(json, null, 2), { flag: 'w+' });
}

function translateFromHtml(lang, file, createSubDir) {
    var data = fs.readFileSync(file);
    if (file.endsWith('.js')) { data = '<html><head></head><body><script>' + data + '</script></body></html>'; }
    var { JSDOM } = jsdom;
    const dom = new JSDOM(data, { includeNodeLocations: true });
    log("Translating HTML (" + lang + "): " + path.basename(file));
    translateStrings(path.basename(file), dom.window.document.querySelector('body'));
    var out = dom.serialize();

    // Change the <html lang="en"> tag.
    out = out.split('<html lang="en"').join('<html lang="' + lang + '"');

    var outname = file;
    var outnamemin = null;
    if (createSubDir != null) {
        var outfolder = path.join(path.dirname(file), createSubDir);
        if (fs.existsSync(outfolder) == false) { fs.mkdirSync(outfolder); }
        outname = path.join(path.dirname(file), createSubDir, path.basename(file));
    }
    if (outname.endsWith('.handlebars')) {
        outnamemin = (outname.substring(0, outname.length - 11) + '-min_' + lang + '.handlebars');
        outname = (outname.substring(0, outname.length - 11) + '_' + lang + '.handlebars');
    } else if (outname.endsWith('.html')) {
        outnamemin = (outname.substring(0, outname.length - 5) + '-min_' + lang + '.html');
        outname = (outname.substring(0, outname.length - 5) + '_' + lang + '.html');
    } else if (outname.endsWith('.htm')) {
        outnamemin = (outname.substring(0, outname.length - 4) + '-min_' + lang + '.htm');
        outname = (outname.substring(0, outname.length - 4) + '_' + lang + '.htm');
    } else if (outname.endsWith('.js')) {
        if (out.startsWith('<html><head></head><body><script>')) { out = out.substring(33); }
        if (out.endsWith('</script></body></html>')) { out = out.substring(0, out.length - 23); }
        outnamemin = (outname.substring(0, outname.length - 3) + '-min_' + lang + '.js');
        outname = (outname.substring(0, outname.length - 3) + '_' + lang + '.js');
    } else {
        outnamemin = (outname + '_' + lang + '.min');
        outname = (outname + '_' + lang);
    }
    fs.writeFileSync(outname, out, { flag: 'w+' });

    // Minify the file
    if (minifyLib == 1) {
        minify.file({
            file: outname,
            dist: outnamemin
        }, function(e, compress) {
            if (e) { log('ERROR ', e); return done(); }
            compress.run((e) => { e ? log('Minification fail', e) : log('Minification sucess'); minifyDone(); });
        }
        );
    }

    // Minify the file
    if (minifyLib = 2) {
        if (outnamemin.endsWith('.handlebars') >= 0) { out = out.split('{{{pluginHandler}}}').join('"{{{pluginHandler}}}"'); }
        var minifiedOut = minify(out, {
            collapseBooleanAttributes: true,
            collapseInlineTagWhitespace: false, // This is not good.
            collapseWhitespace: true,
            minifyCSS: true,
            minifyJS: true,
            removeComments: true,
            removeOptionalTags: true,
            removeEmptyAttributes: true,
            removeAttributeQuotes: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeTagWhitespace: true,
            preserveLineBreaks: false,
            useShortDoctype: true
        });
        if (outnamemin.endsWith('.handlebars') >= 0) { minifiedOut = minifiedOut.split('"{{{pluginHandler}}}"').join('{{{pluginHandler}}}'); }
        fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
    }
}

function minifyDone() { log('Completed minification.'); }

function translateStrings(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        var subnodeignore = false;
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodevalue = null, subnodeindex = null, subnodeplaceholder = null, subnodeplaceholderindex = null, subnodetitle = null, subnodetitleindex = null;
            for (var j in subnode.attributes) {
                if ((subnode.attributes[j].name == 'notrans') && (subnode.attributes[j].value == '1')) { subnodeignore = true; }
                if ((subnode.attributes[j].name == 'type') && (subnode.attributes[j].value == 'hidden')) { subnodeignore = true; }
                if (subnode.attributes[j].name == 'value') { subnodevalue = subnode.attributes[j].value; subnodeindex = j; }
                if (subnode.attributes[j].name == 'placeholder') { subnodeplaceholder = subnode.attributes[j].value; subnodeplaceholderindex = j; }
                if (subnode.attributes[j].name == 'title') { subnodetitle = subnode.attributes[j].value; subnodetitleindex = j; }
            }
            if ((subnodevalue != null) && isNumber(subnodevalue) == true) { subnodevalue = null; }
            if ((subnodeplaceholder != null) && isNumber(subnodeplaceholder) == true) { subnodeplaceholder = null; }
            if ((subnodetitle != null) && isNumber(subnodetitle) == true) { subnodetitle = null; }
            if ((subnodeignore == false) && (subnodevalue != null)) {
                // Perform attribute translation for value
                if (translationTable[subnodevalue] != null) { subnode.attributes[subnodeindex].value = translationTable[subnodevalue]; }
            }
            if (subnodeplaceholder != null) {
                // Perform attribute translation for placeholder
                if (translationTable[subnodeplaceholder] != null) { subnode.attributes[subnodeplaceholderindex].value = translationTable[subnodeplaceholder]; }
            }
            if (subnodetitle != null) {
                // Perform attribute translation for title
                if (translationTable[subnodetitle] != null) { subnode.attributes[subnodetitleindex].value = translationTable[subnodetitle]; }
            }
        }

        if (subnodeignore == false) {
            var subname = subnode.id;
            if (subname == null || subname == '') { subname = i; }
            if (subnode.hasChildNodes()) {
                translateStrings(name + '->' + subname, subnode);
            } else {
                if (subnode.nodeValue == null) continue;
                var nodeValue = subnode.nodeValue.trim().split('\\r').join('').split('\\n').join('').trim();

                // Look for the front trim
                var frontTrim = '', backTrim = '';;
                var x1 = subnode.nodeValue.indexOf(nodeValue);
                if (x1 > 0) { frontTrim = subnode.nodeValue.substring(0, x1); }
                if (x1 != -1) { backTrim = subnode.nodeValue.substring(x1 + nodeValue.length); }

                if ((nodeValue.length > 0) && (subnode.nodeType == 3)) {
                    if ((node.tagName != 'SCRIPT') && (node.tagName != 'STYLE') && (nodeValue.length < 8000) && (nodeValue.startsWith('{{{') == false) && (nodeValue != ' ')) {
                        // Check if we have a translation for this string
                        if (translationTable[nodeValue]) { subnode.nodeValue = (frontTrim + translationTable[nodeValue] + backTrim); }
                    } else if (node.tagName == 'SCRIPT') {
                        // Translate JavaScript
                        subnode.nodeValue = translateStringsFromJavaScript(name, subnode.nodeValue);
                    }
                }
            }
        }
    }
}

function translateStringsFromJavaScript(name, script) {
    if (performCheck) { log(format('Translating JavaScript of {0} bytes: {1}', script.length, name)); }
    var tokenScript = esprima.tokenize(script, { range: true }), count = 0;
    var output = [], ptr = 0;
    for (var i in tokenScript) {
        var token = tokenScript[i];
        if ((token.type == 'String') && (token.value.length > 2) && (token.value[0] == '"')) {
            var str = token.value.substring(1, token.value.length - 1);
            if (translationTable[str]) {
                output.push(script.substring(ptr, token.range[0]));
                output.push('"' + translationTable[str] + '"');
                ptr = token.range[1];
            }
        }
    }
    output.push(script.substring(ptr));
    return output.join('');
}

function isNumber(x) { return (('' + parseInt(x)) === x) || (('' + parseFloat(x)) === x); }
function format(format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); };



// Check if a list of modules are present and install any missing ones
var InstallModuleChildProcess = null;
var previouslyInstalledModules = {};
function InstallModules(modules, func) {
    var missingModules = [];
    if (previouslyInstalledModules == null) { previouslyInstalledModules = {}; }
    if (modules.length > 0) {
        for (var i in modules) {
            try {
                var xxmodule = require(modules[i]);
            } catch (e) {
                if (previouslyInstalledModules[modules[i]] !== true) { missingModules.push(modules[i]); }
            }
        }
        if (missingModules.length > 0) { InstallModule(missingModules.shift(), InstallModules, modules, func); } else { func(); }
    }
}

// Check if a module is present and install it if missing
function InstallModule(modulename, func, tag1, tag2) {
    log('Installing ' + modulename + '...');
    var child_process = require('child_process');
    var parentpath = __dirname;

    // Get the working directory
    if ((__dirname.endsWith('/node_modules/meshcentral')) || (__dirname.endsWith('\\node_modules\\meshcentral')) || (__dirname.endsWith('/node_modules/meshcentral/')) || (__dirname.endsWith('\\node_modules\\meshcentral\\'))) { parentpath = require('path').join(__dirname, '../..'); }

    // Looks like we need to keep a global reference to the child process object for this to work correctly.
    InstallModuleChildProcess = child_process.exec('npm install --no-optional ' + modulename, { maxBuffer: 512000, timeout: 120000, cwd: parentpath }, function (error, stdout, stderr) {
        InstallModuleChildProcess = null;
        if ((error != null) && (error != '')) {
            log('ERROR: Unable to install required module "' + modulename + '". May not have access to npm, or npm may not have suffisent rights to load the new module. Try "npm install ' + modulename + '" to manualy install this module.\r\n');
            process.exit();
            return;
        }
        previouslyInstalledModules[modulename] = true;
        func(tag1, tag2);
        return;
    });
}

// Convert the translations to a standardized JSON we can use in GitHub
// Strings are sorder by english source and object keys are sorted
function translationsToJson(t) {
    var arr2 = [], arr = t.strings;
    for (var i in arr) {
        var names = [], el = arr[i], el2 = {};
        for (var j in el) { names.push(j); }
        names.sort(function (a, b) { if (a == b) { return 0; } if (a == 'xloc') { return 1; } if (b == 'xloc') { return -1; } return a - b });
        for (var j in names) { el2[names[j]] = el[names[j]]; }
        if (el2.xloc != null) { el2.xloc.sort(); }
        arr2.push(el2);
    }
    arr2.sort(function (a, b) { if (a.en > b.en) return 1; if (a.en < b.en) return -1; return 0; });
    return JSON.stringify({ strings: arr2 }, null, '  ');
}

// Export table
module.exports.startEx = startEx;