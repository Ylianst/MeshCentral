/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2019-2020
* @license Apache-2.0
* @version v0.0.1
*/

var fs = require('fs');
var path = require('path');
var performCheck = false;
var translationTable = null;
var sourceStrings = null;
var jsdom = null; //require('jsdom');
var esprima = null; //require('esprima'); // https://www.npmjs.com/package/esprima
var minifyLib = 2; // 0 = None, 1 = minify-js, 2 = HTMLMinifier
var minify = null;

var meshCentralSourceFiles = [
    "../views/agentinvite.handlebars",
    "../views/default.handlebars",
    "../views/default-mobile.handlebars",
    "../views/download.handlebars",
    "../views/error404.handlebars",
    "../views/error404-mobile.handlebars",
    "../views/login.handlebars",
    "../views/login-mobile.handlebars",
    "../views/terms.handlebars",
    "../views/terms-mobile.handlebars",
    "../views/message.handlebars",
    "../views/messenger.handlebars",
    "../public/player.htm"
];

// Check NodeJS version
if (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 8) { console.log("Translate.js requires Node v8 or above, current version is " + process.version + "."); return; }

// node translate.json CHECK ../meshcentral/views/default.handlebars
// node translate.json EXTRACT bob.json ../meshcentral/views/default.handlebars
// node translate.js TRANSLATE fr test2.json ../meshcentral/views/default.handlebars

var libs = ['jsdom', 'esprima', 'minify-js'];
if (minifyLib == 1) { libs.push('minify-js'); }
if (minifyLib == 2) { libs.push('html-minifier'); }
InstallModules(libs, start);

function start() {
    // Load dependencies
    jsdom = require('jsdom');
    esprima = require('esprima'); // https://www.npmjs.com/package/esprima
    if (minifyLib == 1) { minify = require('minify-js'); }
    if (minifyLib == 2) { minify = require('html-minifier').minify; } // https://www.npmjs.com/package/html-minifier

    var command = null;
    if (process.argv.length > 2) { command = process.argv[2].toLowerCase(); }
    if (['check', 'extract', 'extractall', 'translate', 'translateall', 'minifyall', 'merge', 'totext', 'fromtext'].indexOf(command) == -1) { command = null; }

    console.log('MeshCentral web site translator');
    if (command == null) {
        console.log('Usage "node translate.js [command] [options]');
        console.log('Possible commands:');
        console.log('');
        console.log('  CHECK [files]');
        console.log('    Check will pull string out of a web page and display a report.');
        console.log('');
        console.log('  EXTRACT [languagefile] [files]');
        console.log('    Extract strings from web pages and generate a language (.json) file.');
        console.log('');
        console.log('  EXTRACTALL');
        console.log('    Extract all MeshCentral strings from web pages and generate the languages.json file.');
        console.log('');
        console.log('  TRANSLATE [language] [languagefile] [files]');
        console.log('    Use a language (.json) file to translate web pages to a give language.');
        console.log('');
        console.log('  TRANSLATEALL (languagefile) (language code)');
        console.log('    Translate all MeshCentral strings using the languages.json file.');
        console.log('');
        console.log('  MINIFYALL');
        console.log('    Minify the main MeshCentral english web pages.');
        console.log('');
        console.log('  MERGE [sourcefile] [targetfile] [language code]');
        console.log('    Merge a language from a translation file into another translation file.');
        console.log('');
        console.log('  TOTEXT [translationfile] [textfile] [language code]');
        console.log('    Save a text for with all strings of a given language.');
        console.log('');
        console.log('  FROMTEXT [translationfile] [textfile] [language code]');
        console.log('    Import raw text string as translations for a language code.');
        process.exit();
        return;
    }

    // Extract strings from web pages and display a report
    if (command == 'check') {
        var sources = [];
        for (var i = 3; i < process.argv.length; i++) { if (fs.existsSync(process.argv[i]) == false) { console.log('Missing file: ' + process.argv[i]); process.exit(); return; } sources.push(process.argv[i]); }
        if (sources.length == 0) { console.log('No source files specified.'); process.exit(); return; }
        performCheck = true;
        sourceStrings = {};
        for (var i = 0; i < sources.length; i++) { extractFromHtml(sources[i]); }
        var count = 0;
        for (var i in sourceStrings) { count++; }
        console.log('Extracted ' + count + ' strings.');
        process.exit();
        return;
    }

    // Extract strings from web pages
    if (command == 'extract') {
        if (process.argv.length < 4) { console.log('No language file specified.'); process.exit(); return; }
        var sources = [];
        for (var i = 4; i < process.argv.length; i++) { if (fs.existsSync(process.argv[i]) == false) { console.log('Missing file: ' + process.argv[i]); process.exit(); return; } sources.push(process.argv[i]); }
        if (sources.length == 0) { console.log('No source files specified.'); process.exit(); return; }
        extract(process.argv[3], sources);
    }

    // Save a text file with all the strings for a given language
    if (command == 'totext') {
        if ((process.argv.length == 6)) {
            if (fs.existsSync(process.argv[3]) == false) { console.log('Unable to find: ' + process.argv[3]); return; }
            totext(process.argv[3], process.argv[4], process.argv[5]);
        } else {
            console.log('Usage: TOTEXT [translationfile] [textfile] [language code]');
        }
        return;
    }

    // Read a text file and use it as translation for a given language
    if (command == 'fromtext') {
        if ((process.argv.length == 6)) {
            if (fs.existsSync(process.argv[3]) == false) { console.log('Unable to find: ' + process.argv[3]); return; }
            if (fs.existsSync(process.argv[4]) == false) { console.log('Unable to find: ' + process.argv[4]); return; }
            fromtext(process.argv[3], process.argv[4], process.argv[5]);
        } else {
            console.log('Usage: FROMTEXT [translationfile] [textfile] [language code]');
        }
        return;
    }

    // Merge one language from a language file into another language file.
    if (command == 'merge') {
        if ((process.argv.length == 6)) {
            if (fs.existsSync(process.argv[3]) == false) { console.log('Unable to find: ' + process.argv[3]); return; }
            if (fs.existsSync(process.argv[4]) == false) { console.log('Unable to find: ' + process.argv[4]); return; }
            merge(process.argv[3], process.argv[4], process.argv[5]);
        } else {
            console.log('Usage: MERGE [sourcefile] [tartgetfile] [language code]');
        }
        return;
    }

    // Extract or translate all MeshCentral strings
    if (command == 'extractall') { extract("translate.json", meshCentralSourceFiles); }
    if (command == 'translateall') {
        if (fs.existsSync('../views/translations') == false) { fs.mkdirSync('../views/translations'); }
        if (fs.existsSync('../public/translations') == false) { fs.mkdirSync('../public/translations'); }
        var lang = null;
        if (process.argv.length > 4) { lang = process.argv[4].toLowerCase(); }
        if (process.argv.length > 3) {
            if (fs.existsSync(process.argv[3]) == false) {
                console.log('Unable to find: ' + process.argv[3]);
            } else {
                translate(lang, process.argv[3], meshCentralSourceFiles, 'translations');
            }
        } else {
            if (fs.existsSync('translate.json') == false) {
                console.log('Unable to find translate.json.');
            } else {
                translate(lang, 'translate.json', meshCentralSourceFiles, 'translations');
            }
        }
        return;
    }

    // Translate web pages to a given language given a language file
    if (command == 'translate') {
        if (process.argv.length < 4) { console.log("No language specified."); process.exit(); return; }
        if (process.argv.length < 5) { console.log("No language file specified."); process.exit(); return; }
        var lang = process.argv[3].toLowerCase();
        var langFile = process.argv[4];
        if (fs.existsSync(langFile) == false) { console.log("Missing language file: " + langFile); process.exit(); return; }

        var sources = [];
        for (var i = 5; i < process.argv.length; i++) { if (fs.existsSync(process.argv[i]) == false) { console.log("Missing file: " + process.argv[i]); process.exit(); return; } sources.push(process.argv[i]); }
        if (sources.length == 0) { console.log("No source files specified."); process.exit(); return; }

        translate(lang, langFile, sources, false);
    }

    if (command == 'minifyall') {
        for (var i in meshCentralSourceFiles) {
            var outname = meshCentralSourceFiles[i];
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
            console.log('Generating ' + outnamemin + '...');

            // Minify the file
            if (minifyLib = 2) {
                var minifiedOut = minify(fs.readFileSync(outname).toString(), {
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
                fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
            }
        }
    }
}


function totext(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { console.log("Invalid source language file."); process.exit(); return; }

    console.log('Writing ' + lang + '...');

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
        console.log('Done.');
    } else {
        // Save the text in 1000 string bunches
        for (var i in splitOutput) {
            console.log('Writing ' + target + '-' + lang + '-' + i + '.txt...');
            fs.writeFileSync(target + '-' + lang + '-' + i + '.txt', splitOutput[i].join('\r\n'), { flag: 'w+' });
        }
        console.log('Done.');
    }
}

function fromtext(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { console.log("Invalid source language file."); process.exit(); return; }

    console.log('Updating ' + lang + '...');

    // Read raw text
    var rawText = fs.readFileSync(target).toString('utf8');
    var rawTextArray = rawText.split('\r\n');
    var rawTextPtr = 0;

    console.log('Translation file: ' + sourceLangFileData.strings.length + ' string(s)');
    console.log('Text file: ' + rawTextArray.length + ' string(s)');
    if (sourceLangFileData.strings.length != rawTextArray.length) { console.log('String count mismatch, unable to import.'); process.exit(1); return; }

    var output = [];
    var splitOutput = [];
    for (var i in sourceLangFileData.strings) {
        if ((sourceLangFileData.strings[i]['en'] != null) && (sourceLangFileData.strings[i]['en'].indexOf('\r') == -1) && (sourceLangFileData.strings[i]['en'].indexOf('\n') == -1)) {
            if (sourceLangFileData.strings[i][lang] == null) { sourceLangFileData.strings[i][lang] = rawTextArray[i]; }
        }
    }

    fs.writeFileSync(source + '-new', JSON.stringify(sourceLangFileData), { flag: 'w+' });
    console.log('Done.');
}

function merge(source, target, lang) {
    // Load the source language file
    var sourceLangFileData = null;
    try { sourceLangFileData = JSON.parse(fs.readFileSync(source)); } catch (ex) { }
    if ((sourceLangFileData == null) || (sourceLangFileData.strings == null)) { console.log("Invalid source language file."); process.exit(); return; }

    // Load the target language file
    var targetLangFileData = null;
    try { targetLangFileData = JSON.parse(fs.readFileSync(target)); } catch (ex) { }
    if ((targetLangFileData == null) || (targetLangFileData.strings == null)) { console.log("Invalid target language file."); process.exit(); return; }

    console.log('Merging ' + lang + '...');

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
    fs.writeFileSync(target, JSON.stringify(targetData, null, '  '), { flag: 'w+' });
    console.log('Done.');
}

function translate(lang, langFile, sources, createSubDir) {
    // Load the language file
    var langFileData = null;
    try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { }
    if ((langFileData == null) || (langFileData.strings == null)) { console.log("Invalid language file."); process.exit(); return; }

    if (lang != null) {
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
    for (var i = 0; i < sources.length; i++) { translateFromHtml(lang, sources[i], createSubDir); }
}


function extract(langFile, sources) {
    sourceStrings = {};
    if (fs.existsSync(langFile) == true) {
        var langFileData = null;
        try { langFileData = JSON.parse(fs.readFileSync(langFile)); } catch (ex) { }
        if ((langFileData == null) || (langFileData.strings == null)) { console.log("Invalid language file."); process.exit(); return; }
        for (var i in langFileData.strings) {
            sourceStrings[langFileData.strings[i]['en']] = langFileData.strings[i];
            delete sourceStrings[langFileData.strings[i]['en']].xloc;
        }
    }
    for (var i = 0; i < sources.length; i++) { extractFromHtml(sources[i]); }
    var count = 0, output = [];
    for (var i in sourceStrings) {
        count++;
        sourceStrings[i]['en'] = i;
        //if ((sourceStrings[i].xloc != null) && (sourceStrings[i].xloc.length > 0)) { output.push(sourceStrings[i]); } // Only save results that have a source location.
        output.push(sourceStrings[i]); // Save all results
    }
    fs.writeFileSync(langFile, JSON.stringify({ 'strings': output }, null, '  '), { flag: 'w+' });
    console.log(format("{0} strings in output file.", count));
    process.exit();
    return;
}

function extractFromHtml(file) {
    var data = fs.readFileSync(file);
    var { JSDOM } = jsdom;
    const dom = new JSDOM(data, { includeNodeLocations: true });
    console.log("Processing HTML: " + path.basename(file));
    getStrings(path.basename(file), dom.window.document.querySelector('body'));
}

function getStrings(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodeignore = false, subnodevalue = null, subnodeplaceholder = null, subnodetitle = null;
            for (var j in subnode.attributes) {
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

        // Check the content of the element
        var subname = subnode.id;
        if (subname == null || subname == '') { subname = i; }
        if (subnode.hasChildNodes()) {
            getStrings(name + '->' + subname, subnode);
        } else {
            if (subnode.nodeValue == null) continue;
            var nodeValue = subnode.nodeValue.trim().split('\\r').join('').split('\\n').join('').trim();
            if ((nodeValue.length > 0) && (subnode.nodeType == 3)) {
                if ((node.tagName != 'SCRIPT') && (node.tagName != 'STYLE') && (nodeValue.length < 8000) && (nodeValue.startsWith('{{{') == false) && (nodeValue != ' ')) {
                    if (performCheck) { console.log('  "' + nodeValue + '"'); }
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

function getStringFromJavaScript(name, script) {
    if (performCheck) { console.log(format('Processing JavaScript of {0} bytes: {1}', script.length, name)); }
    var tokenScript = esprima.tokenize(script), count = 0;
    for (var i in tokenScript) {
        var token = tokenScript[i];
        if ((token.type == 'String') && (token.value.length > 2) && (token.value[0] == '"')) {
            var str = token.value.substring(1, token.value.length - 1);
            //if (performCheck) { console.log('  ' + name + '->' + (++count), token.value); }
            if (performCheck) { console.log('  ' + token.value); }
            if (sourceStrings[str] == null) { sourceStrings[str] = { en: str, xloc: [name + '->' + (++count)] }; } else { if (sourceStrings[str].xloc == null) { sourceStrings[str].xloc = []; } sourceStrings[str].xloc.push(name + '->' + (++count)); }
        }
    }
}





function translateFromHtml(lang, file, createSubDir) {
    var data = fs.readFileSync(file);
    var { JSDOM } = jsdom;
    const dom = new JSDOM(data, { includeNodeLocations: true });
    console.log("Translating HTML: " + path.basename(file));
    translateStrings(path.basename(file), dom.window.document.querySelector('body'));
    var out = dom.serialize();

    var outname = file;
    var outnamemin = null;
    if (createSubDir != null) { outname = path.join(path.dirname(file), createSubDir, path.basename(file)); }
    if (outname.endsWith('.handlebars')) {
        outnamemin = (outname.substring(0, outname.length - 11) + '-min_' + lang + '.handlebars');
        outname = (outname.substring(0, outname.length - 11) + '_' + lang + '.handlebars');
    } else if (outname.endsWith('.html')) {
        outnamemin = (outname.substring(0, outname.length - 5) + '-min_' + lang + '.html');
        outname = (outname.substring(0, outname.length - 5) + '_' + lang + '.html');
    } else if (outname.endsWith('.htm')) {
        outnamemin = (outname.substring(0, outname.length - 4) + '-min_' + lang + '.htm');
        outname = (outname.substring(0, outname.length - 4) + '_' + lang + '.htm');
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
        }, (e, compress) => {
            if (e) { console.log('ERROR ', e); return done(); }
            compress.run((e) => { e ? console.log('Minification fail', e) : console.log('Minification sucess'); minifyDone(); });
        }
        );
    }

    // Minify the file
    if (minifyLib = 2) {
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
        fs.writeFileSync(outnamemin, minifiedOut, { flag: 'w+' });
    }
}

function minifyDone() { console.log('Completed minification.'); }

function translateStrings(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodeignore = false, subnodevalue = null, subnodeindex = null, subnodeplaceholder = null, subnodeplaceholderindex = null, subnodetitle = null, subnodetitleindex = null;
            for (var j in subnode.attributes) {
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

function translateStringsFromJavaScript(name, script) {
    if (performCheck) { console.log(format('Translating JavaScript of {0} bytes: {1}', script.length, name)); }
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
    console.log('Installing ' + modulename + '...');
    var child_process = require('child_process');
    var parentpath = __dirname;

    // Get the working directory
    if ((__dirname.endsWith('/node_modules/meshcentral')) || (__dirname.endsWith('\\node_modules\\meshcentral')) || (__dirname.endsWith('/node_modules/meshcentral/')) || (__dirname.endsWith('\\node_modules\\meshcentral\\'))) { parentpath = require('path').join(__dirname, '../..'); }

    // Looks like we need to keep a global reference to the child process object for this to work correctly.
    InstallModuleChildProcess = child_process.exec('npm install --no-optional --save ' + modulename, { maxBuffer: 512000, timeout: 120000, cwd: parentpath }, function (error, stdout, stderr) {
        InstallModuleChildProcess = null;
        if ((error != null) && (error != '')) {
            console.log('ERROR: Unable to install required module "' + modulename + '". May not have access to npm, or npm may not have suffisent rights to load the new module. Try "npm install ' + modulename + '" to manualy install this module.\r\n');
            process.exit();
            return;
        }
        previouslyInstalledModules[modulename] = true;
        func(tag1, tag2);
        return;
    });
}