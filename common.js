/**
* @description MeshCentral Common Library
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2019
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

const fs = require("fs");
const crypto = require("crypto");

// Binary encoding and decoding functions
module.exports.ReadShort = function (v, p) { return (v.charCodeAt(p) << 8) + v.charCodeAt(p + 1); };
module.exports.ReadShortX = function (v, p) { return (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };
module.exports.ReadInt = function (v, p) { return (v.charCodeAt(p) * 0x1000000) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); }; // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
module.exports.ReadIntX = function (v, p) { return (v.charCodeAt(p + 3) * 0x1000000) + (v.charCodeAt(p + 2) << 16) + (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };
module.exports.ShortToStr = function (v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); };
module.exports.ShortToStrX = function (v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); };
module.exports.IntToStr = function (v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); };
module.exports.IntToStrX = function (v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); };
module.exports.MakeToArray = function (v) { if (!v || v == null || typeof v == "object") return v; return [v]; };
module.exports.SplitArray = function (v) { return v.split(","); };
module.exports.Clone = function (v) { return JSON.parse(JSON.stringify(v)); };
module.exports.IsFilenameValid = (function () { var x1 = /^[^\\/:\*\?"<>\|]+$/, x2 = /^\./, x3 = /^(nul|prn|con|lpt[0-9]|com[0-9])(\.|$)/i; return function isFilenameValid(fname) { return module.exports.validateString(fname, 1, 4096) && x1.test(fname) && !x2.test(fname) && !x3.test(fname) && (fname[0] != '.'); }; })();

// Move an element from one position in an array to a new position
module.exports.ArrayElementMove = function(arr, from, to) { arr.splice(to, 0, arr.splice(from, 1)[0]); };

// Print object for HTML
module.exports.ObjectToStringEx = function (x, c) {
    var r = "", i;
    if (x != 0 && (!x || x == null)) return "(Null)";
    if (x instanceof Array) { for (i in x) { r += '<br />' + gap(c) + "Item #" + i + ": " + module.exports.ObjectToStringEx(x[i], c + 1); } }
    else if (x instanceof Object) { for (i in x) { r += '<br />' + gap(c) + i + " = " + module.exports.ObjectToStringEx(x[i], c + 1); } }
    else { r += x; }
    return r;
};

// Print object for console
module.exports.ObjectToStringEx2 = function (x, c) {
    var r = "", i;
    if (x != 0 && (!x || x == null)) return "(Null)";
    if (x instanceof Array) { for (i in x) { r += '\r\n' + gap2(c) + "Item #" + i + ": " + module.exports.ObjectToStringEx2(x[i], c + 1); } }
    else if (x instanceof Object) { for (i in x) { r += '\r\n' + gap2(c) + i + " = " + module.exports.ObjectToStringEx2(x[i], c + 1); } }
    else { r += x; }
    return r;
};

// Create an ident gap
module.exports.gap = function (c) { var x = ''; for (var i = 0; i < (c * 4); i++) { x += '&nbsp;'; } return x; };
module.exports.gap2 = function (c) { var x = ''; for (var i = 0; i < (c * 4); i++) { x += ' '; } return x; };

// Print an object in html
module.exports.ObjectToString = function (x) { return module.exports.ObjectToStringEx(x, 0); };
module.exports.ObjectToString2 = function (x) { return module.exports.ObjectToStringEx2(x, 0); };

// Convert a hex string to a raw string
module.exports.hex2rstr = function (d) {
    var r = '', m = ('' + d).match(/../g), t;
    while (t = m.shift()) { r += String.fromCharCode('0x' + t); }
    return r;
};

// Convert decimal to hex
module.exports.char2hex = function (i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); };

// Convert a raw string to a hex string
module.exports.rstr2hex = function (input) {
    var r = '', i;
    for (i = 0; i < input.length; i++) { r += module.exports.char2hex(input.charCodeAt(i)); }
    return r;
};

// UTF-8 encoding & decoding functions
module.exports.encode_utf8 = function (s) { return unescape(encodeURIComponent(s)); };
module.exports.decode_utf8 = function (s) { return decodeURIComponent(escape(s)); };

// Convert a string into a blob
module.exports.data2blob = function (data) {
    var bytes = new Array(data.length);
    for (var i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
    var blob = new Blob([new Uint8Array(bytes)]);
    return blob;
};

// Generate random numbers
module.exports.random = function (max) { return Math.floor(Math.random() * max); };

// Split a comma seperated string, ignoring commas in quotes.
module.exports.quoteSplit = function (str) {
    var tmp = '', quote = 0, result = [];
    for (var i in str) { if (str[i] == '"') { quote = (quote + 1) % 2; } if ((str[i] == ',') && (quote == 0)) { tmp = tmp.trim(); result.push(tmp); tmp = ''; } else { tmp += str[i]; } }
    if (tmp.length > 0) result.push(tmp.trim());
    return result;
};

// Convert list of "name = value" into object
module.exports.parseNameValueList = function (list) {
    var result = [];
    for (var i in list) {
        var j = list[i].indexOf('=');
        if (j > 0) {
            var v = list[i].substring(j + 1).trim();
            if ((v[0] == '"') && (v[v.length - 1] == '"')) { v = v.substring(1, v.length - 1); }
            result[list[i].substring(0, j).trim()] = v;
        }
    }
    return result;
};

// Compute the MD5 digest hash for a set of values
module.exports.ComputeDigesthash = function (username, password, realm, method, path, qop, nonce, nc, cnonce) {
    var ha1 = crypto.createHash('md5').update(username + ":" + realm + ":" + password).digest("hex");
    var ha2 = crypto.createHash('md5').update(method + ":" + path).digest("hex");
    return crypto.createHash('md5').update(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2).digest("hex");
};

module.exports.toNumber = function (str) { var x = parseInt(str); if (x == str) return x; return str; };
module.exports.escapeHtml = function (string) { return String(string).replace(/[&<>"'`=\/]/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' }[s]; }); };
module.exports.escapeHtmlBreaks = function (string) { return String(string).replace(/[&<>"'`=\/]/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;', '\r': '<br />', '\n': '' }[s]; }); };

// Lowercase all the names in a object recursively
// Allow for exception keys, child of exceptions will not get lower-cased.
module.exports.objKeysToLower = function (obj, exceptions) {
    for (var i in obj) {
        if ((typeof obj[i] == 'object') && ((exceptions == null) || (exceptions.indexOf(i.toLowerCase()) == -1))) { module.exports.objKeysToLower(obj[i], exceptions); } // LowerCase all key names in the child object
        if (i.toLowerCase() !== i) { obj[i.toLowerCase()] = obj[i]; delete obj[i]; } // LowerCase all key names
    }
    return obj;
};

// Escape and unexcape feild names so there are no invalid characters for MongoDB
module.exports.escapeFieldName = function (name) { return name.split('%').join('%25').split('.').join('%2E').split('$').join('%24'); };
module.exports.unEscapeFieldName = function (name) { return name.split('%2E').join('.').split('%24').join('$').split('%25').join('%'); };

// Escape all links
module.exports.escapeLinksFieldName = function (docx) { var doc = module.exports.Clone(docx); if (doc.links != null) { for (var j in doc.links) { var ue = module.exports.escapeFieldName(j); if (ue !== j) { doc.links[ue] = doc.links[j]; delete doc.links[j]; } } } return doc; };
module.exports.unEscapeLinksFieldName = function (doc) { if (doc.links != null) { for (var j in doc.links) { var ue = module.exports.unEscapeFieldName(j); if (ue !== j) { doc.links[ue] = doc.links[j]; delete doc.links[j]; } } } return doc; };
//module.exports.escapeAllLinksFieldName = function (docs) { for (var i in docs) { module.exports.escapeLinksFieldName(docs[i]); } };
module.exports.unEscapeAllLinksFieldName = function (docs) { for (var i in docs) { docs[i] = module.exports.unEscapeLinksFieldName(docs[i]); } };

// Validation methods
module.exports.validateString = function (str, minlen, maxlen) { return ((str != null) && (typeof str == 'string') && ((minlen == null) || (str.length >= minlen)) && ((maxlen == null) || (str.length <= maxlen))); };
module.exports.validateInt = function (int, minval, maxval) { return ((int != null) && (typeof int == 'number') && ((minval == null) || (int >= minval)) && ((maxval == null) || (int <= maxval))); };
module.exports.validateArray = function (array, minlen, maxlen) { return ((array != null) && Array.isArray(array) && ((minlen == null) || (array.length >= minlen)) && ((maxlen == null) || (array.length <= maxlen))); };
module.exports.validateStrArray = function (array, minlen, maxlen) { if (((array != null) && Array.isArray(array)) == false) return false; for (var i in array) { if ((typeof array[i] != 'string') && ((minlen == null) || (array[i].length >= minlen)) && ((maxlen == null) || (array[i].length <= maxlen))) return false; } return true; };
module.exports.validateObject = function (obj) { return ((obj != null) && (typeof obj == 'object')); };
module.exports.validateEmail = function (email, minlen, maxlen) { if (module.exports.validateString(email, minlen, maxlen) == false) return false; var emailReg = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/; return emailReg.test(email); };
module.exports.validateUsername = function (username, minlen, maxlen) { return (module.exports.validateString(username, minlen, maxlen) && (username.indexOf(' ') == -1) && (username.indexOf('"') == -1) && (username.indexOf(',') == -1)); };

// Check password requirements
module.exports.checkPasswordRequirements = function(password, requirements) {
    if ((requirements == null) || (requirements == '') || (typeof requirements != 'object')) return true;
    if (requirements.min) { if (password.length < requirements.min) return false; }
    if (requirements.max) { if (password.length > requirements.max) return false; }
    var num = 0, lower = 0, upper = 0, nonalpha = 0;
    for (var i = 0; i < password.length; i++) {
        if (/\d/.test(password[i])) { num++; }
        if (/[a-z]/.test(password[i])) { lower++; }
        if (/[A-Z]/.test(password[i])) { upper++; }
        if (/\W/.test(password[i])) { nonalpha++; }
    }
    if (requirements.num && (num < requirements.num)) return false;
    if (requirements.lower && (lower < requirements.lower)) return false;
    if (requirements.upper && (upper < requirements.upper)) return false;
    if (requirements.nonalpha && (nonalpha < requirements.nonalpha)) return false;
    return true;
}


// Limits the number of tasks running to a fixed limit placing the rest in a pending queue.
// This is useful to limit the number of agents upgrading at the same time, to not swamp 
// the network with traffic.

// taskLimiterQueue.launch(somethingToDo, argument, priority);
//
// function somethingToDo(argument, taskid, taskLimiterQueue) {
//     setTimeout(function () { taskLimiterQueue.completed(taskid); }, Math.random() * 2000);
// }

module.exports.createTaskLimiterQueue = function (maxTasks, maxTaskTime, cleaningInterval) {
    var obj = { maxTasks: maxTasks, maxTaskTime: (maxTaskTime * 1000), nextTaskId: 0, currentCount: 0, current: {}, pending: [[], [], []], timer: null };

    // Add a task to the super queue
    // Priority: 0 = High, 1 = Medium, 2 = Low
    obj.launch = function (func, arg, pri) {
        if (typeof pri != 'number') { pri = 2; }
        if (obj.currentCount < obj.maxTasks) {
            // Run this task now
            const id = obj.nextTaskId++;
            obj.current[id] = Date.now() + obj.maxTaskTime;
            obj.currentCount++;
            //console.log('ImmidiateLaunch ' + id);
            func(arg, id, obj); // Start the task
            if (obj.timer == null) { obj.timer = setInterval(obj.clean, cleaningInterval * 1000); }
        } else {
            // Hold this task
            //console.log('Holding');
            obj.pending[pri].push({ func: func, arg: arg });
        }
    }

    // Called when a task is completed
    obj.completed = function (taskid) {
        //console.log('Completed ' + taskid);
        if (obj.current[taskid]) { delete obj.current[taskid]; obj.currentCount--; } else { return; }
        while ((obj.currentCount < obj.maxTasks) && ((obj.pending[0].length > 0) || (obj.pending[1].length > 0) || (obj.pending[2].length > 0))) {
            // Run this task now
            var t = null;
            if (obj.pending[0].length > 0) { t = obj.pending[0].shift(); }
            else if (obj.pending[1].length > 0) { t = obj.pending[1].shift(); }
            else if (obj.pending[2].length > 0) { t = obj.pending[2].shift(); }
            const id = obj.nextTaskId++;
            obj.current[id] = Date.now() + obj.maxTaskTime;
            obj.currentCount++;
            //console.log('PendingLaunch ' + id);
            t.func(t.arg, id, obj); // Start the task
        }
        if ((obj.currentCount == 0) && (obj.pending[0].length == 0) && (obj.pending[1].length == 0) && (obj.pending[2].length == 0) && (obj.timer != null)) {
            // All done, clear the timer
            clearInterval(obj.timer); obj.timer = null;
        }
    }

    // Look for long standing tasks and clean them up
    obj.clean = function () {
        const t = Date.now();
        for (var i in obj.current) { if (obj.current[i] < t) { obj.completed(parseInt(i)); } }
    }

    return obj;
}
