/** 
* @description Set of short commonly used methods for handling HTML elements
* @author Ylian Saint-Hilaire
* @version v0.0.1b
*/

// Add startsWith for IE browser
if (!String.prototype.startsWith) { String.prototype.startsWith = function (str) { return this.lastIndexOf(str, 0) === 0; }; }
if (!String.prototype.endsWith) { String.prototype.endsWith = function (str) { return this.indexOf(str, this.length - str.length) !== -1; }; }

// Quick UI functions, a bit of a replacement for jQuery
//function Q(x) { if (document.getElementById(x) == null) { console.log('Invalid element: ' + x); } return document.getElementById(x); }                            // "Q"
function Q(x) { return document.getElementById(x); }                            // "Q"
function QS(x) { try { return Q(x).style; } catch (x) { } }                     // "Q" style
function QE(x, y) { try { Q(x).disabled = !y; } catch (x) { } }                 // "Q" enable
function QV(x, y) { try { QS(x).display = (y ? '' : 'none'); } catch (x) { } }  // "Q" visible
function QA(x, y) { Q(x).innerHTML += y; }                                      // "Q" append
function QH(x, y) { Q(x).innerHTML = y; }                                       // "Q" html
function QC(x) { try { return Q(x).classList; } catch (x) { } }                 // "Q" class

// Move cursor to end of input box
function inputBoxFocus(x) { Q(x).focus(); var v = Q(x).value; Q(x).value = ''; Q(x).value = v; }

// Binary encoding and decoding functions
function ReadShort(v, p) { return (v.charCodeAt(p) << 8) + v.charCodeAt(p + 1); }
function ReadShortX(v, p) { return (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); }
function ReadInt(v, p) { return (v.charCodeAt(p) * 0x1000000) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); } // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
function ReadSInt(v, p) { return (v.charCodeAt(p) << 24) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); }
function ReadIntX(v, p) { return (v.charCodeAt(p + 3) * 0x1000000) + (v.charCodeAt(p + 2) << 16) + (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); }
function ShortToStr(v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); }
function ShortToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); }
function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
function IntToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }
function MakeToArray(v) { if (!v || v == null || typeof v == 'object') return v; return [v]; }
function SplitArray(v) { return v.split(','); }
function Clone(v) { return JSON.parse(JSON.stringify(v)); }
function EscapeHtml(x) { if (typeof x == 'string') return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); if (typeof x == 'boolean') return x; if (typeof x == 'number') return x; }
function EscapeHtmlBreaks(x) { if (typeof x == 'string') return x.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r/g, '<br />').replace(/\n/g, '').replace(/\t/g, '&nbsp;&nbsp;'); if (typeof x == 'boolean') return x; if (typeof x == 'number') return x; }

// Move an element from one position in an array to a new position
function ArrayElementMove(arr, from, to) { arr.splice(to, 0, arr.splice(from, 1)[0]); };

// Print object for HTML
function ObjectToStringEx(x, c) {
    var r = "";
    if (x != 0 && (!x || x == null)) return '(Null)';
    if (x instanceof Array) { for (var i in x) { r += '<br />' + gap(c) + 'Item #' + i + ": " + ObjectToStringEx(x[i], c + 1); } }
    else if (x instanceof Object) { for (var i in x) { r += '<br />' + gap(c) + i + ' = ' + ObjectToStringEx(x[i], c + 1); } }
    else { r += EscapeHtml(x); }
    return r;
}

// Print object for console
function ObjectToStringEx2(x, c) {
    var r = '';
    if (x != 0 && (!x || x == null)) return '(Null)';
    if (x instanceof Array) { for (var i in x) { r += '\r\n' + gap2(c) + 'Item #' + i + ': ' + ObjectToStringEx2(x[i], c + 1); } }
    else if (x instanceof Object) { for (var i in x) { r += '\r\n' + gap2(c) + i + ' = ' + ObjectToStringEx2(x[i], c + 1); } }
    else { r += EscapeHtml(x); }
    return r;
}

// Create an ident gap
function gap(c) { var x = ''; for (var i = 0; i < (c * 4) ; i++) { x += '&nbsp;'; } return x; }
function gap2(c) { var x = ''; for (var i = 0; i < (c * 4) ; i++) { x += ' '; } return x; }

// Print an object in html
function ObjectToString(x) { return ObjectToStringEx(x, 0); }
function ObjectToString2(x) { return ObjectToStringEx2(x, 0); }

// Convert a hex string to a raw string
function hex2rstr(d) {
    if (typeof d != 'string' || d.length == 0) return '';
    var r = '', m = ('' + d).match(/../g), t;
    while (t = m.shift()) r += String.fromCharCode('0x' + t);
    return r
}

// Convert decimal to hex
function char2hex(i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); }

// Convert a raw string to a hex string
function rstr2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += char2hex(input.charCodeAt(i)); } return r; }

// UTF-8 encoding & decoding functions
function encode_utf8(s) { return unescape(encodeURIComponent(s)); }
function decode_utf8(s) { return decodeURIComponent(escape(s)); }

// Convert a string into a blob
function data2blob(data) {
    var bytes = new Array(data.length);
    for (var i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
    return new Blob([new Uint8Array(bytes)]);
}

// Convert a UTF8 string into a blob
function utf2blob(str) {
    var bytes = [], utf8 = unescape(encodeURIComponent(str));
    for (var i = 0; i < utf8.length; i++) { bytes.push(utf8.charCodeAt(i)); }
    return new Blob([new Uint8Array(bytes)]);
}

// Generate random numbers
function random(max) { return Math.floor(Math.random() * max); }

// Trademarks
function trademarks(x) { return x.replace(/\(R\)/g, '&reg;').replace(/\(TM\)/g, '&trade;'); }

// Pad a number with zeros on the left
function zeroPad(num, c) { if (c == null) { c = 2; } var s = '00000000' + num; return s.substr(s.length - c); }

// String validation
function isAlphaNumeric(str) { if (typeof str == 'number') { return true; } return (str.match(/^[A-Za-z0-9]+$/) != null); };
function isSafeString(str) { return ((typeof str == 'string') && (str.indexOf('<') == -1) && (str.indexOf('>') == -1) && (str.indexOf('&') == -1) && (str.indexOf('"') == -1) && (str.indexOf('\'') == -1) && (str.indexOf('+') == -1) && (str.indexOf('(') == -1) && (str.indexOf(')') == -1) && (str.indexOf('#') == -1) && (str.indexOf('%') == -1) && (str.indexOf(':') == -1)) };
function isSafeString2(str) { return ((typeof str == 'string') && (str.indexOf('<') == -1) && (str.indexOf('>') == -1) && (str.indexOf('&') == -1) && (str.indexOf('"') == -1) && (str.indexOf('\'') == -1) && (str.indexOf('+') == -1) && (str.indexOf('(') == -1) && (str.indexOf(')') == -1) && (str.indexOf('#') == -1) && (str.indexOf('%') == -1)) };

// Parse URL arguments, only keep safe values
function parseUriArgs(decodeUrl) {
    var href = window.document.location.href;
    if (href.endsWith('#')) { href = href.substring(0, href.length - 1); }
    var name, r = {}, parsedUri = href.split(/[\?&|]/);
    parsedUri.splice(0, 1);
    for (var j in parsedUri) {
        var arg = parsedUri[j], i = arg.indexOf('=');
        name = arg.substring(0, i);
        r[name] = arg.substring(i + 1);
        if (decodeUrl) { r[name] = decodeURIComponent(arg.substring(i + 1)); }
        if (!isSafeString(r[name])) { delete r[name]; } else { var x = parseInt(r[name]); if (x == r[name]) { r[name] = x; } }
    }
    return r;
}

// check_webp_feature:
//   'feature' can be one of 'lossy', 'lossless', 'alpha' or 'animation'.
//   'callback(feature, isSupported)' will be passed back the detection result (in an asynchronous way!)
// From: https://stackoverflow.com/questions/5573096/detecting-webp-support
function check_webp_feature(feature, callback) {
    var kTestImages = {
        lossy: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'//,
        //lossless: 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
        //alpha: 'UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==',
        //animation: 'UklGRlIAAABXRUJQVlA4WAoAAAASAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GJgAAAAAAAAAAAAAAAAAAAGQAAABWUDhMDQAAAC8AAAAQBxAREYiI/gcA'
    };
    var img = new Image();
    img.onload = function () {
        var result = (img.width > 0) && (img.height > 0);
        callback(feature, result);
    };
    img.onerror = function () {
        callback(feature, false);
    };
    img.src = 'data:image/webp;base64,' + kTestImages[feature];
}