/*
Copyright 2017-2021 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


// Polyfill String.endsWith
if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (searchString, position) {
        var subjectString = this.toString();
        if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) { position = subjectString.length; }
        position -= searchString.length;
        var lastIndex = subjectString.lastIndexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
}

// Replace a string with a number if the string is an exact number
function toNumberIfNumber(x) { if ((typeof x == 'string') && (+parseInt(x) == x)) { x = parseInt(x); } return x; }

// Convert decimal to hex
function char2hex(i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); }

// Convert a raw string to a hex string
function rstr2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += char2hex(input.charCodeAt(i)); } return r; }

// Convert a buffer into a string
function buf2rstr(buf) { var r = ''; for (var i = 0; i < buf.length; i++) { r += String.fromCharCode(buf[i]); } return r; }

// Convert a hex string to a raw string // TODO: Do this using Buffer(), will be MUCH faster
function hex2rstr(d) {
    if (typeof d != "string" || d.length == 0) return '';
    var r = '', m = ('' + d).match(/../g), t;
    while (t = m.shift()) r += String.fromCharCode('0x' + t);
    return r
}

// Convert an object to string with all functions
function objToString(x, p, ret) {
    if (ret == undefined) ret = '';
    if (p == undefined) p = 0;
    if (x == null) { return '[null]'; }
    if (p > 8) { return '[...]'; }
    if (x == undefined) { return '[undefined]'; }
    if (typeof x == 'string') { if (p == 0) return x; return '"' + x + '"'; }
    if (typeof x == 'buffer') { return '[buffer]'; }
    if (typeof x != 'object') { return x; }
    var r = '{' + (ret ? '\r\n' : ' ');
    for (var i in x) { r += (addPad(p + 2, ret) + i + ': ' + objToString(x[i], p + 2, ret) + (ret ? '\r\n' : ' ')); }
    return r + addPad(p, ret) + '}';
}

// Return p number of spaces 
function addPad(p, ret) { var r = ''; for (var i = 0; i < p; i++) { r += ret; } return r; }

// Split a string taking into account the quoats. Used for command line parsing
function splitArgs(str) {
    var myArray = [], myRegexp = /[^\s"]+|"([^"]*)"/gi;
    do { var match = myRegexp.exec(str); if (match != null) { myArray.push(match[1] ? match[1] : match[0]); } } while (match != null);
    return myArray;
}

// Parse arguments string array into an object
function parseArgs(argv) {
    var results = { '_': [] }, current = null;
    for (var i = 1, len = argv.length; i < len; i++) {
        var x = argv[i];
        if (x.length > 2 && x[0] == '-' && x[1] == '-') {
            if (current != null) { results[current] = true; }
            current = x.substring(2);
        } else {
            if (current != null) { results[current] = toNumberIfNumber(x); current = null; } else { results['_'].push(toNumberIfNumber(x)); }
        }
    }
    if (current != null) { results[current] = true; }
    return results;
}

// Parge a URL string into an options object
function parseUrl(url) {
    var x = url.split('/');
    if (x.length < 4) return null;
    var y = x[2].split(':');
    var options = {};
    var options = { protocol: x[0], hostname: y[0], path: '/' + x.splice(3).join('/') };
    if (y.length == 1) { options.port = ((x[0] == 'https:') || (x[0] == 'wss:')) ? 443 : 80; } else { options.port = parseInt(y[1]); }
    if (isNaN(options.port) == true) return null;
    return options;
}

//console.log(objToString(db2, 2, ' '));

{
    // TODO: Fix this to use the event emitor
    // TODO: Add SHA256 sync
    console.log('--- Test 1: SHA256 hashing ---');
    var sha256 = require('SHA256Stream');
    sha256.hashString = function (x) { if (x == '81B637D8FCD2C6DA6359E6963113A1170DE795E4B725B84D1E0B4CFD9EC58CE9') { console.log('Test 1 - OK: ' + x); } else { console.log('Test 1 - FAIL: ' + x); } };
    sha256.write('bob');
    sha256.end();
}
{
    // FAIL!!!!!!!!!
    var sha256x = require('SHA256Stream');
    sha256x.hashString = function (x) { if (x == '81B637D8FCD2C6DA6359E6963113A1170DE795E4B725B84D1E0B4CFD9EC58CE9') { console.log('Test 1 - OK: ' + x); } else { console.log('Test 1 - FAIL: ' + x); } };
    sha256x.write('bob');
    sha256x.end();
}

/*
{
    console.log('--- Test 2: Database ---');
    var db = require('SimpleDataStore').Create('TestSuite.db');
    var sha256 = require('SHA256Stream');

    // Write a pile of hashes to the DB
    sha256.hashString = function (x) { db.Put(x.substring(0, 16), x.substring(16)); console.log('ADD: ' + x.substring(0, 16) + ': ' + x.substring(16)); };
    for (var i = 0; i < 10; i++) { console.log(i); sha256.write('A' + i); sha256.end(); }

    // Compact plenty of times
    for (var i = 0; i < 10; i++) { console.log(i); db.Compact(); }

    // Check all the hashes
    sha256.hashString = function (x) {
        var r = db.Get(x.substring(0, 16));
        console.log('GET: ' + x.substring(0, 16) + ': ' + r);
        if (r != x.substring(16)) { console.log('FAILED ' + x.substring(0, 16) + ': ' + x.substring(16) + ' != ' + r); }
        //db.Put(x.substring(0, 16), '');
    };
    for (var i = 0; i < 10; i++) { console.log(i); sha256.write('A' + i); sha256.end(); }
    console.log('Test 2 - Completed.');
}
*/

{
    console.log('--- Test 3: Files ---');
    var r, fs = require('fs');
    //console.log(objToString(fs, 2, ' '));
    r = fs.mkdirSync('TestSuite-123');
    r = fs.renameSync('TestSuite-123', 'TestSuite-1234');
    console.log(r);
    r = fs.unlinkSync('TestSuite-1234');
}

console.log('--- Tests Completed ---');
process.exit(2);