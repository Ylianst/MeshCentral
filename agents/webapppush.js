/*
Copyright 2017 Intel Corporation

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

// Read a entire file into a buffer
function readFileToBuffer(filePath) {
    try {
        var fs = require('fs');
        var stats = fs.statSync(filePath);
        if (stats == null) { return null; }
        var fileData = new Buffer(stats.size);
        var fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, fileData, 0, stats.size, 0);
        fs.closeSync(fd);
        return fileData;
    } catch (e) { return null; }
}

// Performs an HTTP get on a URL and return the data back
function makeHttpGetRequest(url, func) {
    var http = require('http');
    var request = http.get(url, function (res) {
        var htmlData = '';
        res.on('data', function (d) { htmlData += d; });
        res.on('end', function (d) { func(res.statusCode, htmlData); });
    }).on('error', function (e) { func(0, null); });
}

// Performs an HTTP get on a URL and return the data back (Alternative implementation)
function makeHttpGetRequest2(url, func) {
    var http = require('http');
    var options = http.parseUri(url);
    options.username = 'admin';
    options.password = 'P@ssw0rd';
    var request = http.request(options, function (res) {
        var htmlData = '';
        res.on('data', function (d) { htmlData += d; });
        res.on('end', function () { func(res.statusCode, htmlData); });
    });
    request.on('error', function (e) { func(0, null); });
    request.end();
}

// Performs an HTTP get on a URL and return the data back (Alternative implementation)
function intelAmtSetStorage(url, buffer, func) {
    var http = require('http');
    var options = http.parseUri(url);
    options.user = 'admin'; // TODO: Does not support HTTP digest auth yet!!!!!!!!!!!!!!!!
    options.pass = 'P@ssw0rd';
    var request = http.request(options, function (res) {
        var htmlData = '';
        res.on('data', function (d) { htmlData += d; });
        res.on('end', function () { func(res.statusCode, htmlData); });
    });
    request.on('error', function (e) { func(0, null); });
    request.end();
}

//console.log(objToString(db2, 2, ' '));

console.log('--- Start ---');

var fileData = readFileToBuffer('MeshCommander-Small.gz');
if (fileData != null) {
    makeHttpGetRequest2('http://192.168.2.105:16992/index.htm', function (status, htmlData) { console.log(status, htmlData); });

    /*
    intelAmtSetStorage('http://192.168.2.105:16992/amt-storage/index.htm', fileData, function (status, htmlData) {
        console.log('intelAmtSetStorage', status, htmlData);
    });
    */
}

console.log('--- End ---');
//process.exit(2);