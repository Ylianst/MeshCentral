/*
Copyright 2018-2019 Intel Corporation

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

/**
* @fileoverview Script Compiler / Decompiler / Runner
* @author Ylian Saint-Hilaire
* @version v0.1.0e
*/

// Core functions
script_functionTable1 = ['nop', 'jump', 'set', 'print', 'dialog', 'getitem', 'substr', 'indexof', 'split', 'join', 'length', 'jsonparse', 'jsonstr', 'add', 'substract', 'parseint', 'wsbatchenum', 'wsput', 'wscreate', 'wsdelete', 'wsexec', 'scriptspeed', 'wssubscribe', 'wsunsubscribe', 'readchar', 'signwithdummyca'];

// functions of type ARG1 = func(ARG2, ARG3, ARG4, ARG5, ARG6)
script_functionTable2 = ['encodeuri', 'decodeuri', 'passwordcheck', 'atob', 'btoa', 'hex2str', 'str2hex', 'random', 'md5', 'maketoarray', 'readshort', 'readshortx', 'readint', 'readsint', 'readintx', 'shorttostr', 'shorttostrx', 'inttostr', 'inttostrx'];

// functions of type ARG1 = func(ARG2, ARG3, ARG4, ARG5, ARG6)
script_functionTableX2 = [encodeURI, decodeURI, passwordcheck, atob, btoa, hex2rstr, rstr2hex, random, rstr_md5, MakeToArray, ReadShort, ReadShortX, ReadInt, ReadSInt, ReadIntX, ShortToStr, ShortToStrX, IntToStr, IntToStrX];


function MakeToArray(v) { if (!v || v == null || typeof v == 'object') return v; return [v]; }
function ReadShort(v, p) { return (v[p] << 8) + v[p + 1]; }
function ReadShortX(v, p) { return (v[p + 1] << 8) + v[p]; }
function ReadInt(v, p) { return (v[p] * 0x1000000) + (v[p + 1] << 16) + (v[p + 2] << 8) + v[p + 3]; } // We use "*0x1000000" instead of "<<24" because the shift converts the number to signed int32.
function ReadSInt(v, p) { return (v[p] << 24) + (v[p + 1] << 16) + (v[p + 2] << 8) + v[p + 3]; }
function ReadIntX(v, p) { return (v[p + 3] * 0x1000000) + (v[p + 2] << 16) + (v[p + 1] << 8) + v[p]; }
function ShortToStr(v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); } 
function ShortToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); }
function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
function IntToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }
//function ShortToStr(v) { var b = Buffer.alloc(2); b.writeInt16BE(v); return b; }
//function ShortToStrX(v) { var b = Buffer.alloc(2); b.writeInt16LE(v); return b; }
//function IntToStr(v) { var b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
//function IntToStrX(v) { var b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function btoa(x) { return Buffer.from(x).toString('base64');}
function atob(x) { var z = null; try { z = Buffer.from(x, 'base64').toString(); } catch (e) { console.log(e); } return z; }
function passwordcheck(p) { if (p.length < 8) return false; var upper = 0, lower = 0, number = 0, nonalpha = 0; for (var i in p) { var c = p.charCodeAt(i); if ((c > 64) && (c < 91)) { upper = 1; } else if ((c > 96) && (c < 123)) { lower = 1; } else if ((c > 47) && (c < 58)) { number = 1; } else { nonalpha = 1; } } return ((upper + lower + number + nonalpha) == 4); }
function hex2rstr(x) { Buffer.from(x, 'hex').toString(); }
function rstr2hex(x) { Buffer.from(x).toString('hex'); }
function random() { return Math.floor(Math.random()*max); }
function rstr_md5(str) { return hex2rstr(hex_md5(str)); }
function getItem(x, y, z) { for (var i in x) { if (x[i][y] == z) return x[i]; } return null; }

var httpErrorTable = {
    200: 'OK',
    401: 'Authentication Error',
    408: 'Timeout Error',
    601: 'WSMAN Parsing Error',
    602: 'Unable to parse HTTP response header',
    603: 'Unexpected HTTP enum response',
    604: 'Unexpected HTTP pull response',
    998: 'Invalid TLS certificate'
}

// Setup the script state
module.exports.setup = function(binary, startvars) {
    var obj = { startvars: startvars, onCompleted: null };
    if (binary.length < 6) { console.error('Invalid script length'); return null; } // Script must have at least 6 byte header
    if (ReadInt(binary, 0) != 0x247D2945) { console.error('Invalid binary script'); return null; } // Check the script magic header
    if (ReadShort(binary, 4) > 1) { console.error('Unsupported script version'); return null; } // Check the script version
    obj.script = binary.slice(6);

    // Reset the script to the start
    obj.reset = function (stepspeed) {
        obj.stop();
        obj.ip = 0;
        obj.variables = startvars;
        obj.state = 1;
    }

    // Start the script
    obj.start = function (stepspeed) {
        obj.stop();
        if (stepspeed == null) { obj.stepspeed = 10; } else { obj.stepspeed = stepspeed; }
        if (obj.stepspeed > 0) { obj.timer = setInterval(function () { obj.step() }, obj.stepspeed); }
    }

    // Stop the script
    obj.stop = function () {
        if (obj.timer != null) { clearInterval(obj.timer); }
        obj.timer = null;
        obj.stepspeed = 0;
    }

    // function used to load and store variable values
    obj.getVar = function (name) { if (name == undefined) return undefined; return obj.getVarEx(name.split('.'), obj.variables); }
    obj.getVarEx = function (name, val) { try { if (name == undefined) return undefined; if (name.length == 0) return val; return obj.getVarEx(name.slice(1), val[name[0]]); } catch (e) { return null; } }
    obj.setVar = function (name, val) { obj.setVarEx(name.split('.'), obj.variables, val); }
    obj.setVarEx = function (name, vars, val) { if (name.length == 1) { vars[name[0]] = val; } else { obj.setVarEx(name.slice(1), vars[name[0]], val); } }

    // Run the script one step forward
    obj.step = function () {
        if (obj.state != 1) return;
        if (obj.ip < obj.script.length) {
            var cmdid = ReadShort(obj.script, obj.ip);
            var cmdlen = ReadShort(obj.script, obj.ip + 2);
            var argcount = ReadShort(obj.script, obj.ip + 4);
            var argptr = obj.ip + 6;
            var args = [];

            // Clear all temp variables (This is optional)
            for (var i in obj.variables) { if (i.startsWith('__')) { delete obj.variables[i]; } }

            // Loop on each argument, moving forward by the argument length each time
            for (var i = 0; i < argcount; i++) {
                var arglen = ReadShort(obj.script, argptr);
                var argval = obj.script.slice(argptr + 2, argptr + 2 + arglen);
                var argtyp = argval[0];
                argval = argval.slice(1);
                if (argtyp < 2) {
                    // Get the value and replace all {var} with variable values
                    argval = argval.toString();
                    if (argval != null) { while (argval.split("{").length > 1) { var t = argval.split("{").pop().split("}").shift(); argval = argval.replace('{' + t + '}', obj.getVar(t)); } }
                    if (argtyp == 1) { obj.variables['__' + i] = decodeURI(argval); argval = '__' + i; } // If argtyp is 1, this is a literal. Store in temp variable.
                    args.push(argval);
                }
                if (argtyp == 2 || argtyp == 3) {
                    obj.variables['__' + i] = ReadSInt(argval, 0);
                    args.push('__' + i);
                }
                argptr += (2 + arglen);
            }

            // Move instruction pointer forward by command size
            obj.ip += cmdlen;

            // Get all variable values
            var argsval = [];
            for (var i = 0; i < 10; i++) { argsval.push(obj.getVar(args[i])); }
            var storeInArg0;
            try {
                if (cmdid < 10000) {
                    // Lets run the actual command
                    switch (cmdid) {
                        case 0: // nop
                            break;
                        case 1: // jump(label) or jump(label, a, compare, b)
                            if (argsval[2]) {
                                if (
                                    (argsval[2] == '<' && argsval[1] < argsval[3]) ||
                                    (argsval[2] == '<=' && argsval[1] <= argsval[3]) ||
                                    (argsval[2] == '!=' && argsval[1] != argsval[3]) ||
                                    (argsval[2] == '=' && argsval[1] == argsval[3]) ||
                                    (argsval[2] == '>=' && argsval[1] >= argsval[3]) ||
                                    (argsval[2] == '>' && argsval[1] > argsval[3])
                                ) {
                                    obj.ip = argsval[0];
                                }
                            } else {
                                obj.ip = argsval[0]; // Set the instruction pointer to the new location in the script
                            }
                            break;
                        case 2: // set(variable, value)
                            if (args[1] == undefined) delete obj.variables[args[0]]; else obj.setVar(args[0], argsval[1]);
                            break;
                        case 3: // print(message)
                            var v = obj.toString(argsval[0]);
                            if (v.indexOf('INFO: ') == 0) { v = v.substring(6); }
                            if (v.indexOf('SUCCESS: ') == 0) { v = v.substring(9); }
                            if (obj.onConsole) { obj.onConsole(v, obj); } else { console.log(v); }
                            //  Q(obj.consoleid).value += () + '\n'); Q(obj.console).scrollTop = Q(obj.console).scrollHeight;
                            break;
                        case 4: // dialog(title, content, buttons)
                            obj.state = 2;
                            obj.dialog = true;
                            setDialogMode(11, argsval[0], argsval[2], obj.xxStepDialogOk, argsval[1], obj);
                            break;
                        case 5: // getitem(a, b, c)
                            for (var i in argsval[1]) { if (argsval[1][i][argsval[2]] == argsval[3]) { storeInArg0 = i; } };
                            break;
                        case 6: // substr(variable_dest, variable_src, index, len)
                            storeInArg0 = argsval[1].substr(argsval[2], argsval[3]);
                            break;
                        case 7: // indexOf(variable_dest, variable_src, index, len)
                            storeInArg0 = argsval[1].indexOf(argsval[2]);
                            break;
                        case 8: // split(variable_dest, variable_src, separator)
                            storeInArg0 = argsval[1].split(argsval[2]);
                            break;
                        case 9: // join(variable_dest, variable_src, separator)
                            storeInArg0 = argsval[1].join(argsval[2]);
                            break;
                        case 10: // length(variable_dest, variable_src)
                            if (argsval[1] == null) { storeInArg0 = 0; } else { storeInArg0 = argsval[1].length; }
                            break;
                        case 11: // jsonparse(variable_dest, json)
                            storeInArg0 = JSON.parse(argsval[1]);
                            break;
                        case 12: // jsonstr(variable_dest, variable_src)
                            storeInArg0 = JSON.stringify(argsval[1]);
                            break;
                        case 13: // add(variable_dest, variable_src, value)
                            storeInArg0 = (argsval[1] + argsval[2]);
                            break;
                        case 14: // substract(variable_dest, variable_src, value)
                            storeInArg0 = (argsval[1] - argsval[2]);
                            break;
                        case 15: // parseInt(variable_dest, variable_src)
                            storeInArg0 = parseInt(argsval[1]);
                            break;
                        case 16: // wsbatchenum(name, objectList)
                            obj.state = 2;
                            obj.amtstack.BatchEnum(argsval[0], argsval[1], obj.xxWsmanReturn, obj);
                            break;
                        case 17: // wsput(name, args)
                            obj.state = 2;
                            obj.amtstack.Put(argsval[0], argsval[1], obj.xxWsmanReturn, obj);
                            break;
                        case 18: // wscreate(name, args)
                            obj.state = 2;
                            obj.amtstack.Create(argsval[0], argsval[1], obj.xxWsmanReturn, obj);
                            break;
                        case 19: // wsdelete(name, args)
                            obj.state = 2;
                            obj.amtstack.Delete(argsval[0], argsval[1], obj.xxWsmanReturn, obj);
                            break;
                        case 20: // wsexec(name, method, args, selectors)
                            obj.state = 2;
                            obj.amtstack.Exec(argsval[0], argsval[1], argsval[2], obj.xxWsmanReturn, obj, 0, argsval[3]);
                            break;
                        case 21: // Script Speed
                            obj.stepspeed = argsval[0];
                            if (obj.timer != null) { clearInterval(obj.timer); obj.timer = setInterval(function () { obj.step() }, obj.stepspeed); }
                            break;
                        case 22: // wssubscribe(name, delivery, url, selectors, opaque, user, pass)
                            obj.state = 2;
                            obj.amtstack.Subscribe(argsval[0], argsval[1], argsval[2], obj.xxWsmanReturn, obj, 0, argsval[3], argsval[4], argsval[5], argsval[6]);
                            break;
                        case 23: // wsunsubscribe(name, selectors)
                            obj.state = 2;
                            obj.amtstack.UnSubscribe(argsval[0], obj.xxWsmanReturn, obj, 0, argsval[1]);
                            break;
                        case 24: // readchar(str, pos)
                            console.log(argsval[1], argsval[2], argsval[1].charCodeAt(argsval[2]));
                            storeInArg0 = argsval[1].charCodeAt(argsval[2]);
                            break;
                        case 25: // signWithDummyCa
                            // Not supported
                            break;
                        default: {
                            obj.state = 9;
                            console.error("Script Error, unknown command: " + cmdid);
                        }
                    }
                } else {
                    if (cmdid < 20000) {
                        // functions of type ARG1 = func(ARG2, ARG3, ARG4, ARG5, ARG6)
                        storeInArg0 = script_functionTableX2[cmdid - 10000](argsval[1], argsval[2], argsval[3], argsval[4], argsval[5], argsval[6]);
                    } else {
                        // Optional functions of type ARG1 = func(ARG2, ARG3, ARG4, ARG5, ARG6)
                        //if (script_functionTableX3 && script_functionTableX3[cmdid - 20000]) {
                        //    storeInArg0 = script_functionTableX3[cmdid - 20000](obj, argsval[1], argsval[2], argsval[3], argsval[4], argsval[5], argsval[6]); // Note that optional calls start with "obj" as first argument.
                        //}
                    }
                }
                if (storeInArg0 != undefined) obj.setVar(args[0], storeInArg0);
            } catch (e) {
                if (typeof e == 'object') { e = e.message; }
                obj.setVar('_exception', e);
            }
        }

        if (obj.state == 1 && obj.ip >= obj.script.length) { obj.state = 0; obj.stop(); if (obj.onCompleted) { obj.onCompleted(); } }
        if (obj.onStep) obj.onStep(obj);
        return obj;
    }

    obj.xxStepDialogOk = function (button) {
        obj.variables['DialogSelect'] = button;
        obj.state = 1;
        obj.dialog = false;
        if (obj.onStep) obj.onStep(obj);
    }

    obj.xxWsmanReturn = function (stack, name, responses, status) {
        obj.setVar(name, responses);
        obj.setVar('wsman_result', status);
        obj.setVar('wsman_result_str', ((httpErrorTable[status]) ? (httpErrorTable[status]) : ('Error #' + status)));
        obj.state = 1;
        if (obj.onStep) obj.onStep(obj);
    }

    obj.toString = function (x) { if (typeof x == 'object') return JSON.stringify(x); return x; }

    obj.reset();
    return obj;
}

// Argument types: 0 = Variable, 1 = String, 2 = Integer, 3 = Label
module.exports.compile = function(script, onmsg) {
    var r = '', scriptlines = script.split('\n'), labels = {}, labelswap = [], swaps = [];
    // Go thru each script line and encode it
    for (var i in scriptlines) {
        var scriptline = scriptlines[i];
        if (scriptline.startsWith('##SWAP ')) { var x = scriptline.split(' '); if (x.length == 3) { swaps[x[1]] = x[2]; } } // Add a swap instance
        if (scriptline[0] == '#' || scriptline.length == 0) continue; // Skip comments & blank lines
        for (var x in swaps) { scriptline = scriptline.split(x).join(swaps[x]); } // Apply all swaps
        var keywords = scriptline.match(/"[^"]*"|[^\s"]+/g);
        if (keywords.length == 0) continue; // Skip blank lines
        if (scriptline[0] == ':') { labels[keywords[0].toUpperCase()] = r.length; continue; } // Mark a label position
        var funcIndex = script_functionTable1.indexOf(keywords[0].toLowerCase());
        if (funcIndex == -1) { funcIndex = script_functionTable2.indexOf(keywords[0].toLowerCase()); if (funcIndex >= 0) funcIndex += 10000; }
        if (funcIndex == -1) { if (onmsg) { onmsg("Unabled to compile, unknown command: " + keywords[0]); } return ''; }
        // Encode CommandId, CmdSize, ArgCount, Arg1Len, Arg1, Arg2Len, Arg2...
        var cmd = ShortToStr(keywords.length - 1);
        for (var j in keywords) {
            if (j == 0) continue;
            if (keywords[j][0] == ':') {
                labelswap.push([keywords[j], r.length + cmd.length + 7]); // Add a label swap
                cmd += ShortToStr(5) + String.fromCharCode(3) + IntToStr(0xFFFFFFFF); // Put an empty label
            } else {
                var argint = parseInt(keywords[j]);
                if (argint == keywords[j]) {
                    cmd += ShortToStr(5) + String.fromCharCode(2) + IntToStr(argint);
                } else {
                    if (keywords[j][0] == '"' && keywords[j][keywords[j].length - 1] == '"') {
                        cmd += ShortToStr(keywords[j].length - 1) + String.fromCharCode(1) + keywords[j].substring(1, keywords[j].length - 1);
                    } else {
                        cmd += ShortToStr(keywords[j].length + 1) + String.fromCharCode(0) + keywords[j];
                    }
                }
            }
        }
        cmd = ShortToStr(funcIndex) + ShortToStr(cmd.length + 4) + cmd;
        r += cmd;
    }
    // Perform all the needed label swaps
    for (i in labelswap) {
        var label = labelswap[i][0].toUpperCase(), position = labelswap[i][1], target = labels[label];
        if (target == undefined) { if (onmsg) { onmsg("Unabled to compile, unknown label: " + label); } return ''; }
        r = r.substr(0, position) + IntToStr(target) + r.substr(position + 4);
    }
    return IntToStr(0x247D2945) + ShortToStr(1) + r;
}

// Decompile the script, intended for debugging only
module.exports.decompile = function(binary, onecmd) {
    var r = '', ptr = 6, labelcount = 0, labels = {};
    if (onecmd >= 0) {
        ptr = onecmd; // If we are decompiling just one command, set the ptr to that command.
    } else {
        if (binary.length < 6) { return '# Invalid script length'; }
        var magic = ReadInt(binary, 0);
        var version = ReadShort(binary, 4);
        if (magic != 0x247D2945) { return '# Invalid binary script: ' + magic; }
        if (version != 1) { return '# Invalid script version'; }
    }
    // Loop on each command, moving forward by the command length each time.
    while (ptr < binary.length) {
        var cmdid = ReadShort(binary, ptr);
        var cmdlen = ReadShort(binary, ptr + 2);
        var argcount = ReadShort(binary, ptr + 4);
        var argptr = ptr + 6;
        var argstr = '';
        if (!(onecmd >= 0)) r += ":label" + (ptr - 6) + "\n";
        // Loop on each argument, moving forward by the argument length each time
        for (var i = 0; i < argcount; i++) {
            var arglen = ReadShort(binary, argptr);
            var argval = binary.substring(argptr + 2, argptr + 2 + arglen);
            var argtyp = argval.charCodeAt(0);
            if (argtyp == 0) { argstr += ' ' + argval.substring(1); } // Variable
            else if (argtyp == 1) { argstr += ' \"' + argval.substring(1) + '\"'; } // String
            else if (argtyp == 2) { argstr += ' ' + ReadInt(argval, 1); } // Integer
            else if (argtyp == 3) { // Label
                var target = ReadInt(argval, 1);
                var label = labels[target];
                if (!label) { label = ":label" + target; labels[label] = target; }
                argstr += ' ' + label;
            }
            argptr += (2 + arglen);
        }
        // Go in the script function table to decode the function
        if (cmdid < 10000) {
            r += script_functionTable1[cmdid] + argstr + "\n";
        } else {
            if ((cmdid >= 10000) && (cmdid < 10000)) { r += script_functionTable2[cmdid - 10000] + argstr + "\n"; }
        }
        ptr += cmdlen;
        if (onecmd >= 0) return r; // If we are decompiling just one command, exit now
    }
    // Remove all unused labels
    var scriptlines = r.split('\n');
    r = '';
    for (var i in scriptlines) {
        var line = scriptlines[i];
        if (line[0] != ':') { r += line + '\n'; } else { if (labels[line]) { r += line + '\n'; } }
    }
    return r;
}
