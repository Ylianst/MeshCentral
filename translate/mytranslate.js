const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const esprima = require('esprima');
const { minify } = require('html-minifier-terser');
var translationTable = {};

// Source files to translate
var meshCentralSourceFiles = [
    "../views/agentinvite.handlebars",
    "../views/invite.handlebars",
    "../views/default.handlebars",
    "../views/default3.handlebars",
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
    "../views/sharing-mobile.handlebars",
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

const langFile = path.join(__dirname, 'translate.json');
const createSubDir = 'translations'; // Subdirectory to create for translated files
const directRun = (require.main === module);

// Check NodeJS version
const NodeJSVer = parseFloat(process.version.match(/^v(\d+\.\d+)/)[1]);
if (directRun && NodeJSVer < 12) {
    console.error("Translate.js requires Node v12 or above");
    process.exit(1);
}

if (directRun && isMainThread) {
    console.log("MeshCentral translation tool v0.1.0 (direct)");
    
    try {
        // 1. Load language file ONCE
        const langFileData = JSON.parse(fs.readFileSync(langFile));
        if (!langFileData?.strings) throw new Error("Invalid language file structure");

        // 2. Load all source files ONCE
        const sources = meshCentralSourceFiles.map(file => ({
            path: file,
            content: fs.readFileSync(file, 'utf8')
        }));

        // 3. Get target languages
        const languages = new Set();
        for (const entry of Object.values(langFileData.strings)) {
            for (const lang in entry) {
                if (!['en', 'xloc', '*'].includes(lang)) {
                    languages.add(lang.toLowerCase());
                }
            }
        }
        const langArray = Array.from(languages);
        
        console.log(`Processing ${langArray.length} languages: ${langArray.join(', ')}`);
        console.log(`Loaded ${sources.length} source files`);

        // 4. Worker management
        const MAX_WORKERS = 4;
        let activeWorkers = 0;
        let completed = 0;

        function startWorker() {
            if (langArray.length === 0 || activeWorkers >= MAX_WORKERS) return;

            const lang = langArray.pop();
            activeWorkers++;

            const worker = new Worker(__filename, {
                workerData: {
                    lang,
                    langData: langFileData,
                    sources
                }
            });

            worker.on('message', (msg) => {
                console.log(`[${lang}] ${msg}`);
            });

            worker.on('error', (err) => {
                console.error(`[${lang}] Worker error:`, err);
            });

            worker.on('exit', (code) => {
                activeWorkers--;
                completed++;
                console.log(`[${lang}] Completed (${completed}/${completed + langArray.length + activeWorkers})`);
                startWorker();
            });
        }

        // Start initial workers
        for (let i = 0; i < Math.min(MAX_WORKERS, langArray.length); i++) {
            startWorker();
        }

    } catch (err) {
        console.error("Initialization failed:", err);
        process.exit(1);
    }

} else if (!isMainThread) {
    // Worker thread logic
    const { lang, langData, sources } = workerData;
    
    try {
        parentPort.postMessage(`Starting translation of ${sources.length} files`);

        translationTable = {};
        for (var i in langData.strings) {
            var entry = langData.strings[i];
            if ((entry['en'] != null) && (entry[lang] != null)) { translationTable[entry['en']] = entry[lang]; }
        }

        for (var i = 0; i < sources.length; i++) {
            if (sources[i].path.endsWith('.html') || sources[i].path.endsWith('.htm') || sources[i].path.endsWith('.handlebars')) { 
                translateFromHtml(lang, sources[i], createSubDir, (file) => {
                    parentPort.postMessage(`Finished HTML/Handlebars file: ${file}`);
                });
            } else if (sources[i].path.endsWith('.txt')) {
                translateFromTxt(lang, sources[i], createSubDir, (file) => {
                    parentPort.postMessage(`Finished TXT file: ${file}`);
                });
            }
        }
    } catch (err) {
        parentPort.postMessage(`ERROR: ${err.message}`);
    }
}

function minifyFromHtml(lang, file, out, done) {
    parentPort.postMessage(`Minifying HTML/Handlebars file: ${file.path}`);
    if (file.path.endsWith('.handlebars') >= 0) { out = out.split('{{{pluginHandler}}}').join('"{{{pluginHandler}}}"'); }
    minify(out, {
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
    }).then((minifiedOut) => {
        if (minifiedOut == null) {
            parentPort.postMessage(`ERROR: Minification failed for ${file.path}`);
        } else {
            var outname = file.path;
            var outnamemin = null;
            if (createSubDir != null) {
                var outfolder = path.join(path.dirname(file.path), createSubDir);
                if (fs.existsSync(outfolder) == false) { fs.mkdirSync(outfolder); }
                outname = path.join(path.dirname(file.path), createSubDir, path.basename(file.path));
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
            if (outnamemin.endsWith('.handlebars') >= 0) { minifiedOut = minifiedOut.split('"{{{pluginHandler}}}"').join('{{{pluginHandler}}}'); }
            fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
            parentPort.postMessage(`Minified HTML/Handlebars file: ${file.path}`);
        }
        done(file.path);
    });
}

function translateFromHtml(lang, file, createSubDir, done) {
    parentPort.postMessage(`Translating HTML/Handlebars file: ${file.path}`);
    var data = file.content;
    if (file.path.endsWith('.js')) { data = '<html><head></head><body><script>' + file.content + '</script></body></html>'; }
    const dom = new JSDOM(data, { includeNodeLocations: true });
    translateStrings(path.basename(file.path), dom.window.document.querySelector('body'));
    var out = dom.serialize();
    out = out.split('<html lang="en"').join('<html lang="' + lang + '"');
    var outname = file.path;
    var outnamemin = null;
    if (createSubDir != null) {
        var outfolder = path.join(path.dirname(file.path), createSubDir);
        if (fs.existsSync(outfolder) == false) { fs.mkdirSync(outfolder); }
        outname = path.join(path.dirname(file.path), createSubDir, path.basename(file.path));
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
    parentPort.postMessage(`Translated HTML/Handlebars file: ${file.path}`);
    minifyFromHtml(lang, file, out, done);
}

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

function translateFromTxt(lang, file, createSubDir, done) {
    parentPort.postMessage(`Translating TXT file: ${file.path}`);
    var lines = file.content.toString().split(/\r?\n/), outlines = [];
    for (var i in lines) {
        var line = lines[i];
        if ((line.length > 1) && (line[0] != '~')) {
            if (translationTable[line] != null) { outlines.push(translationTable[line]); } else { outlines.push(line); }
        } else {
            outlines.push(line);
        }
    }

    var outname = file.path, out = outlines.join(os.EOL);
    if (createSubDir != null) {
        var outfolder = path.join(path.dirname(file.path), createSubDir);
        if (fs.existsSync(outfolder) == false) { fs.mkdirSync(outfolder); }
        outname = path.join(path.dirname(file.path), createSubDir, path.basename(file.path));
    }
    outname = (outname.substring(0, outname.length - 4) + '_' + lang + '.txt');
    fs.writeFileSync(outname, out, { flag: 'w+' });
    done(file.path); // Call the done callback to signal completion
}

function isNumber(x) { return (('' + parseInt(x)) === x) || (('' + parseFloat(x)) === x); }
function format(format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); };
