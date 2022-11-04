/**
* @description MeshCentral Common Library
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Binary encoding and decoding functions
module.exports.ReadShort = function (v, p) { return (v.charCodeAt(p) << 8) + v.charCodeAt(p + 1); };
module.exports.ReadShortX = function (v, p) { return (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };
module.exports.ReadInt = function (v, p) { return (v.charCodeAt(p) * 0x1000000) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); }; // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
module.exports.ReadIntX = function (v, p) { return (v.charCodeAt(p + 3) * 0x1000000) + (v.charCodeAt(p + 2) << 16) + (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); };
module.exports.ShortToStr = function (v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); };
module.exports.ShortToStrX = function (v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); };
module.exports.IntToStr = function (v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); };
module.exports.IntToStrX = function (v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); };
module.exports.MakeToArray = function (v) { if (!v || v == null || typeof v == 'object') return v; return [v]; };
module.exports.SplitArray = function (v) { return v.split(','); };
module.exports.Clone = function (v) { return JSON.parse(JSON.stringify(v)); };
module.exports.IsFilenameValid = (function () { var x1 = /^[^\\/:\*\?"<>\|]+$/, x2 = /^\./, x3 = /^(nul|prn|con|lpt[0-9]|com[0-9])(\.|$)/i; return function isFilenameValid(fname) { return module.exports.validateString(fname, 1, 4096) && x1.test(fname) && !x2.test(fname) && !x3.test(fname) && (fname[0] != '.'); }; })();
module.exports.makeFilename = function (v) { return v.split('\\').join('').split('/').join('').split(':').join('').split('*').join('').split('?').join('').split('"').join('').split('<').join('').split('>').join('').split('|').join('').split(' ').join('').split('\'').join(''); }
module.exports.joinPath = function (base, path_) { return path.isAbsolute(path_) ? path_ : path.join(base, path_); }

// Move an element from one position in an array to a new position
module.exports.ArrayElementMove = function(arr, from, to) { arr.splice(to, 0, arr.splice(from, 1)[0]); };

// Format a string with arguments, "replaces {0} and {1}..."
module.exports.format = function (format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); };

// Print object for HTML
module.exports.ObjectToStringEx = function (x, c) {
    var r = '', i;
    if (x != 0 && (!x || x == null)) return "(Null)";
    if (x instanceof Array) { for (i in x) { r += '<br />' + gap(c) + "Item #" + i + ": " + module.exports.ObjectToStringEx(x[i], c + 1); } }
    else if (x instanceof Object) { for (i in x) { r += '<br />' + gap(c) + i + " = " + module.exports.ObjectToStringEx(x[i], c + 1); } }
    else { r += x; }
    return r;
};

// Print object for console
module.exports.ObjectToStringEx2 = function (x, c) {
    var r = '', i;
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

// Generate random numbers between 0 and max without bias.
module.exports.random = function (max) {
    const crypto = require('crypto');
    var maxmask = 1, r;
    while (maxmask < max) { maxmask = (maxmask << 1) + 1; }
    do { r = (crypto.randomBytes(4).readUInt32BE(0) & maxmask); } while (r > max);
    return r;
};

// Split a comma separated string, ignoring commas in quotes.
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
    var ha1 = crypto.createHash('md5').update(username + ":" + realm + ":" + password).digest('hex');
    var ha2 = crypto.createHash('md5').update(method + ":" + path).digest('hex');
    return crypto.createHash('md5').update(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2).digest("hex");
};

module.exports.toNumber = function (str) { var x = parseInt(str); if (x == str) return x; return str; };
module.exports.escapeHtml = function (string) { return String(string).replace(/[&<>"'`=\/]/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' }[s]; }); };
module.exports.escapeHtmlBreaks = function (string) { return String(string).replace(/[&<>"'`=\/]/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;', '\r': '<br />', '\n': '' }[s]; }); };
module.exports.zeroPad = function(num, c) { if (c == null) { c = 2; } var s = '000000' + num; return s.substr(s.length - c); }

// Lowercase all the names in a object recursively
// Allow for exception keys, child of exceptions will not get lower-cased.
// Exceptions is an array of "keyname" or "parent\keyname"
module.exports.objKeysToLower = function (obj, exceptions, parent) {
    for (var i in obj) {
        if ((typeof obj[i] == 'object') &&
            ((exceptions == null) || (exceptions.indexOf(i.toLowerCase()) == -1) && ((parent == null) || (exceptions.indexOf(parent.toLowerCase() + '/' + i.toLowerCase()) == -1)))
        ) {
            module.exports.objKeysToLower(obj[i], exceptions, i); // LowerCase all key names in the child object
        }
        if (i.toLowerCase() !== i) { obj[i.toLowerCase()] = obj[i]; delete obj[i]; } // LowerCase all key names
    }
    return obj;
};

// Escape and unescape feild names so there are no invalid characters for MongoDB
module.exports.escapeFieldName = function (name) { if ((name.indexOf('%') == -1) && (name.indexOf('.') == -1) && (name.indexOf('$') == -1)) return name; return name.split('%').join('%25').split('.').join('%2E').split('$').join('%24'); };
module.exports.unEscapeFieldName = function (name) { if (name.indexOf('%') == -1) return name; return name.split('%2E').join('.').split('%24').join('$').split('%25').join('%'); };

// Escape all links
module.exports.escapeLinksFieldNameEx = function (docx) { if (docx.links == null) { return docx; } var doc = Object.assign({}, docx); doc.links = Object.assign({}, doc.links); for (var i in doc.links) { var ue = module.exports.escapeFieldName(i); if (ue !== i) { doc.links[ue] = doc.links[i]; delete doc.links[i]; } } return doc; };
module.exports.escapeLinksFieldName = function (docx) { var doc = Object.assign({}, docx); if (doc.links != null) { doc.links = Object.assign({}, doc.links); for (var i in doc.links) { var ue = module.exports.escapeFieldName(i); if (ue !== i) { doc.links[ue] = doc.links[i]; delete doc.links[i]; } } } return doc; };
module.exports.unEscapeLinksFieldName = function (doc) { if (doc.links != null) { for (var j in doc.links) { var ue = module.exports.unEscapeFieldName(j); if (ue !== j) { doc.links[ue] = doc.links[j]; delete doc.links[j]; } } } return doc; };
//module.exports.escapeAllLinksFieldName = function (docs) { for (var i in docs) { module.exports.escapeLinksFieldName(docs[i]); } return docs; };
module.exports.unEscapeAllLinksFieldName = function (docs) { for (var i in docs) { docs[i] = module.exports.unEscapeLinksFieldName(docs[i]); } return docs; };

// Escape field names for aceBase
var aceEscFields = ['links', 'ssh', 'rdp', 'notify'];
module.exports.aceEscapeFieldNames = function (docx) { var doc = Object.assign({}, docx); for (var k in aceEscFields) { if (typeof doc[aceEscFields[k]] == 'object') { doc[aceEscFields[k]] = Object.assign({}, doc[aceEscFields[k]]); for (var i in doc[aceEscFields[k]]) { var ue = encodeURIComponent(i); if (ue !== i) { doc[aceEscFields[k]][ue] = doc[aceEscFields[k]][i]; delete doc[aceEscFields[k]][i]; } } } } return doc; };
module.exports.aceUnEscapeFieldNames = function (doc) { for (var k in aceEscFields) { if (typeof doc[aceEscFields[k]] == 'object') { for (var j in doc[aceEscFields[k]]) { var ue = decodeURIComponent(j); if (ue !== j) { doc[aceEscFields[k]][ue] = doc[aceEscFields[k]][j]; delete doc[aceEscFields[k]][j]; } } } } return doc; };
module.exports.aceUnEscapeAllFieldNames = function (docs) { for (var i in docs) { docs[i] = module.exports.aceUnEscapeFieldNames(docs[i]); } return docs; };

// Validation methods
module.exports.validateString = function (str, minlen, maxlen) { return ((str != null) && (typeof str == 'string') && ((minlen == null) || (str.length >= minlen)) && ((maxlen == null) || (str.length <= maxlen))); };
module.exports.validateInt = function (int, minval, maxval) { return ((int != null) && (typeof int == 'number') && ((minval == null) || (int >= minval)) && ((maxval == null) || (int <= maxval))); };
module.exports.validateArray = function (array, minlen, maxlen) { return ((array != null) && Array.isArray(array) && ((minlen == null) || (array.length >= minlen)) && ((maxlen == null) || (array.length <= maxlen))); };
module.exports.validateStrArray = function (array, minlen, maxlen) { if (((array != null) && Array.isArray(array)) == false) return false; for (var i in array) { if ( (typeof array[i] != 'string') || ((minlen != null) && (array[i].length < minlen)) || ((maxlen != null) && (array[i].length > maxlen))) return false; } return true; };
module.exports.validateObject = function (obj) { return ((obj != null) && (typeof obj == 'object')); };
module.exports.validateEmail = function (email, minlen, maxlen) { if (module.exports.validateString(email, minlen, maxlen) == false) return false; var emailReg = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/; return emailReg.test(email); };
module.exports.validateUsername = function (username, minlen, maxlen) { return (module.exports.validateString(username, minlen, maxlen) && (username.indexOf(' ') == -1) && (username.indexOf('"') == -1) && (username.indexOf(',') == -1)); };
module.exports.isAlphaNumeric = function (str) { return (str.match(/^[A-Za-z0-9]+$/) != null); };
module.exports.validateAlphaNumericArray = function (array, minlen, maxlen) { if (((array != null) && Array.isArray(array)) == false) return false; for (var i in array) { if ((typeof array[i] != 'string') || (module.exports.isAlphaNumeric(array[i]) == false) || ((minlen != null) && (array[i].length < minlen)) || ((maxlen != null) && (array[i].length > maxlen)) ) return false; } return true; };
module.exports.getEmailDomain = function(email) {
    if (!module.exports.validateEmail(email, 1, 1024)) {
        return '';
    }
    const i = email.indexOf('@');
    return email.substring(i + 1).toLowerCase();
}

module.exports.validateEmailDomain = function(email, allowedDomains) {
    // Check if this request is for an allows email domain
    if ((allowedDomains != null) && Array.isArray(allowedDomains)) {
        const emaildomain = module.exports.getEmailDomain(email);
        if (emaildomain === '') {
            return false;
        }
        var emailok = false;
        for (var i in allowedDomains) { if (emaildomain == allowedDomains[i].toLowerCase()) { emailok = true; } }
        return emailok;
    }

    return true;
}
// Check password requirements
module.exports.checkPasswordRequirements = function(password, requirements) {
    if ((requirements == null) || (requirements == '') || (typeof requirements != 'object')) return true;
    if (requirements.min) { if (password.length < requirements.min) return false; }
    if (requirements.max) { if (password.length > requirements.max) return false; }
    var numeric = 0, lower = 0, upper = 0, nonalpha = 0;
    for (var i = 0; i < password.length; i++) {
        if (/\d/.test(password[i])) { numeric++; }
        if (/[a-z]/.test(password[i])) { lower++; }
        if (/[A-Z]/.test(password[i])) { upper++; }
        if (/\W/.test(password[i])) { nonalpha++; }
    }
    if (requirements.numeric && (numeric < requirements.numeric)) return false;
    if (requirements.lower && (lower < requirements.lower)) return false;
    if (requirements.upper && (upper < requirements.upper)) return false;
    if (requirements.nonalpha && (nonalpha < requirements.nonalpha)) return false;
    return true;
}


// Limits the number of tasks running to a fixed limit placing the rest in a pending queue.
// This is useful to limit the number of agents upgrading at the same time, to not swamp 
// the network with traffic.
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

// Convert string translations to a standardized JSON we can use in GitHub
// Strings are sorder by english source and object keys are sorted
module.exports.translationsToJson = function(t) {
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

module.exports.copyFile = function(source, target, cb) {
    var cbCalled = false, rd = fs.createReadStream(source);
    rd.on('error', function (err) { done(err); });
    var wr = fs.createWriteStream(target);
    wr.on('error', function (err) { done(err); });
    wr.on('close', function (ex) { done(); });
    rd.pipe(wr);
    function done(err) { if (!cbCalled) { cb(err); cbCalled = true; } }
}

module.exports.meshServerRightsArrayToNumber = function (val) {
    if (val == null) return null;
    if (typeof val == 'number') return val;
    if (Array.isArray(val)) {
        var newAccRights = 0;
        for (var j in val) {
            var r = val[j].toLowerCase();
            if (r == 'fulladmin') { newAccRights = 4294967295; } // 0xFFFFFFFF
            if (r == 'serverbackup') { newAccRights |= 1; }
            if (r == 'manageusers') { newAccRights |= 2; }
            if (r == 'serverrestore') { newAccRights |= 4; }
            if (r == 'fileaccess') { newAccRights |= 8; }
            if (r == 'serverupdate') { newAccRights |= 16; }
            if (r == 'locked') { newAccRights |= 32; }
            if (r == 'nonewgroups') { newAccRights |= 64; }
            if (r == 'notools') { newAccRights |= 128; }
        }
        return newAccRights;
    }
    return null;
}

// Sort an object by key
module.exports.sortObj = function (obj) { return Object.keys(obj).sort().reduce(function (result, key) { result[key] = obj[key]; return result; }, {}); }

// Validate an object to make sure it can be stored in MongoDB
module.exports.validateObjectForMongo = function (obj, maxStrLen) {
    return validateObjectForMongoRec(obj, maxStrLen);
}

function validateObjectForMongoRec(obj, maxStrLen) {
    if (typeof obj != 'object') return false;
    for (var i in obj) {
        // Check the key name is not too long
        if (i.length > 100) return false;
        // Check if all chars are alpha-numeric or underscore.
        for (var j in i) { const c = i.charCodeAt(j); if ((c < 48) || ((c > 57) && (c < 65)) || ((c > 90) && (c < 97) && (c != 95)) || (c > 122)) return false; }
        // If the value is a string, check it's not too long
        if ((typeof obj[i] == 'string') && (obj[i].length > maxStrLen)) return false;
        // If the value is an object, check it.
        if ((typeof obj[i] == 'object') && (Array.isArray(obj[i]) == false) && (validateObjectForMongoRec(obj[i], maxStrLen) == false)) return false;
    }
    return true;
}

// Parse a version string of the type n.n.n.n
module.exports.parseVersion = function (verstr) {
    if (typeof verstr != 'string') return null;
    const r = [], verstrsplit = verstr.split('.');
    if (verstrsplit.length != 4) return null;
    for (var i in verstrsplit) {
        var n = parseInt(verstrsplit[i]);
        if (isNaN(n) || (n < 0) || (n > 65535)) return null;
        r.push(n);
    }
    return r;
}

// Move old files. If we are about to overwrite a file, we can move if first just in case the change needs to be reverted
module.exports.moveOldFiles = function (filelist) {
    // Fine an old extension that works for all files in the file list
    var oldFileExt, oldFileExtCount = 0, extOk;
    do {
        extOk = true;
        if (++oldFileExtCount == 1) { oldFileExt = '-old'; } else { oldFileExt = '-old' + oldFileExtCount; }
        for (var i in filelist) { if (fs.existsSync(filelist[i] + oldFileExt) == true) { extOk = false; } }
    } while (extOk == false);
    for (var i in filelist) { try { fs.renameSync(filelist[i], filelist[i] + oldFileExt); } catch (ex) { } }
}