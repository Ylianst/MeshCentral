/**
* @description MeshCentral MeshAgent
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2019
* @license Apache-2.0
* @version v0.0.1
*/

var fs = require('fs');
var path = require('path');
var performCheck = false;
var translationTable = null;
var sourceStrings = null;
const jsdom = require('jsdom');
const esprima = require('esprima'); // https://www.npmjs.com/package/esprima
const { JSDOM } = jsdom;

var meshCentralSourceFiles = [
    "../views/agentinvite.handlebars",
    "../views/default.handlebars",
    "../views/default-mobile.handlebars",
    "../views/download.handlebars",
    "../views/error404.handlebars",
    "../views/login.handlebars",
    "../views/login-mobile.handlebars",
    "../views/message.handlebars",
    "../views/messenger.handlebars",
    "../views/terms.handlebars",
    "../views/terms-mobile.handlebars",
    "../public/player.htm"
];

// node translate.json CHECK ../meshcentral/views/default.handlebars
// node translate.json EXTRACT bob.json ../meshcentral/views/default.handlebars
// node translate.js TRANSLATE fr test2.json ../meshcentral/views/default.handlebars

var command = null;
if (process.argv.length > 2) { command = process.argv[2].toLowerCase(); }
if (['check', 'extract', 'extractall', 'translate', 'translateall'].indexOf(command) == -1) { command = null; }

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
    console.log('  TRANSLATEALL');
    console.log('    Translate all MeshCentral strings using the languages.json file.');
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

// Extract or translate all MeshCentral strings
if (command == 'extractall') { extract("translate.json", meshCentralSourceFiles); }
if (command == 'translateall') {
    if (fs.existsSync("../views/translations") == false) { fs.mkdirSync("../views/translations"); }
    if (fs.existsSync("../public/translations") == false) { fs.mkdirSync("../public/translations"); }
    translate(null, "translate.json", meshCentralSourceFiles, "translations");
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
        for (var i in langFileData.strings) { var entry = langFileData.strings[i]; for (var j in entry) { if ((j != 'en') && (j != 'xloc') && (j != '*')) { langs[j] = true; } } }
        for (var i in langs) { translateEx(i, langFileData, sources, createSubDir); }
    }

    process.exit();
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
    for (var i in sourceStrings) { count++; sourceStrings[i]['en'] = i; output.push(sourceStrings[i]); }
    fs.writeFileSync(langFile, JSON.stringify({ 'strings': output }, null, '  '), { flag: 'w+' });
    console.log(format("{0} strings in output file.", count));
    process.exit();
    return;
}

function extractFromHtml(file) {
    var data = fs.readFileSync(file);
    const dom = new JSDOM(data, { includeNodeLocations: true });
    console.log("Processing HTML: " + path.basename(file));
    getStrings(path.basename(file), dom.window.document.querySelector('body'));
}

function getStrings(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodeignore = false;
            var subnodevalue = null;
            for (var j in subnode.attributes) {
                if ((subnode.attributes[j].name == 'type') && (subnode.attributes[j].value == 'hidden')) { subnodeignore = true; }
                if (subnode.attributes[j].name == 'value') { subnodevalue = subnode.attributes[j].value; }
            }
            if ((subnodevalue != null) && isNumber(subnodevalue) == true) { subnodeignore = true; }
            if ((subnodeignore == false) && (subnodevalue != null)) {
                // Add a new string to the list
                if (sourceStrings[subnodevalue] == null) { sourceStrings[subnodevalue] = { en: subnodevalue, xloc: [name] }; } else { if (sourceStrings[subnodevalue].xloc == null) { sourceStrings[subnodevalue].xloc = []; } sourceStrings[subnodevalue].xloc.push(name); }
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
    const dom = new JSDOM(data, { includeNodeLocations: true });
    console.log("Translating HTML: " + path.basename(file));
    translateStrings(path.basename(file), dom.window.document.querySelector('body'));
    var out = dom.serialize();

    var outname = file;
    if (createSubDir != null) { outname = path.join(path.dirname(file), createSubDir, path.basename(file)); }
    if (outname.endsWith('.handlebars')) { outname = (outname.substring(0, outname.length - 11) + '-' + lang + '.handlebars'); }
    else if (outname.endsWith('.html')) { outname = (outname.substring(0, outname.length - 5) + '-' + lang + '.html'); }
    else if (outname.endsWith('.htm')) { outname = (outname.substring(0, outname.length - 4) + '-' + lang + '.htm'); }
    else { outname = (outname + '-' + lang); }
    fs.writeFileSync(outname, out, { flag: 'w+' });
}

function translateStrings(name, node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        var subnode = node.childNodes[i];

        // Check if the "value" attribute exists and needs to be translated
        if ((subnode.attributes != null) && (subnode.attributes.length > 0)) {
            var subnodeignore = false, subnodevalue = null, subnodeindex = null;
            for (var j in subnode.attributes) {
                if ((subnode.attributes[j].name == 'type') && (subnode.attributes[j].value == 'hidden')) { subnodeignore = true; }
                if (subnode.attributes[j].name == 'value') { subnodevalue = subnode.attributes[j].value; subnodeindex = j; }
            }
            if ((subnodevalue != null) && isNumber(subnodevalue) == true) { subnodeignore = true; }
            if ((subnodeignore == false) && (subnodevalue != null)) {
                // Perform attribute translation
                if (translationTable[subnodevalue] != null) { subnode.attributes[subnodeindex].value = translationTable[subnodevalue]; }
            }
        }

        var subname = subnode.id;
        if (subname == null || subname == '') { subname = i; }
        if (subnode.hasChildNodes()) {
            translateStrings(name + '->' + subname, subnode);
        } else {
            if (subnode.nodeValue == null) continue;
            var nodeValue = subnode.nodeValue.trim().split('\\r').join('').split('\\n').join('').trim();
            if ((nodeValue.length > 0) && (subnode.nodeType == 3)) {
                if ((node.tagName != 'SCRIPT') && (node.tagName != 'STYLE') && (nodeValue.length < 8000) && (nodeValue.startsWith('{{{') == false) && (nodeValue != ' ')) {
                    // Check if we have a translation for this string
                    if (translationTable[nodeValue]) { subnode.nodeValue = translationTable[nodeValue]; }
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