/*
Copyright 2018-2021 Intel Corporation

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

var obj = { meshCoreInfo: 'TinyCore v1' };
var mesh = null;

// Replace a string with a number if the string is an exact number
function toNumberIfNumber(x) { if ((typeof x == 'string') && (+parseInt(x) === x)) { x = parseInt(x); } return x; }

// Split a string taking into account the quoats. Used for command line parsing
function splitArgs(str)
{
    var myArray = [], myRegexp = /[^\s"]+|"([^"]*)"/gi;
    do { var match = myRegexp.exec(str); if (match != null) { myArray.push(match[1] ? match[1] : match[0]); } } while (match != null);
    return myArray;
}
// Parse arguments string array into an object
function parseArgs(argv)
{
    var results = { '_': [] }, current = null;
    for (var i = 1, len = argv.length; i < len; i++)
    {
        var x = argv[i];
        if (x.length > 2 && x[0] == '-' && x[1] == '-')
        {
            if (current != null) { results[current] = true; }
            current = x.substring(2);
        } else
        {
            if (current != null) { results[current] = toNumberIfNumber(x); current = null; } else { results['_'].push(toNumberIfNumber(x)); }
        }
    }
    if (current != null) { results[current] = true; }
    return results;
}
function sendConsoleText(msg, sessionid)
{
    try
    {
        if (sessionid != null)
        {
            require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: msg, sessionid: sessionid });
        }
        else
        {
            require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: msg });
        }
    }
    catch(e)
    {
    }
}

function processConsoleCommand(cmd, args, rights, sessionid)
{
    try
    {
        var response = null;
        switch (cmd)
        {
            case 'help':
                response = "Available commands are: eval, osinfo, setdebug, versions.";
                break;
            case 'versions':
                response = JSON.stringify(process.versions, null, '  ');
                break;
            case 'eval':
                { // Eval JavaScript
                    if (args['_'].length < 1)
                    {
                        response = 'Proper usage: eval "JavaScript code"'; // Display correct command usage
                    } else
                    {
                        response = JSON.stringify(require('MeshAgent').eval(args['_'][0])); // This can only be run by trusted administrator.
                    }
                    break;
                }
            case 'setdebug':
                {
                    if (args['_'].length < 1) { response = 'Proper usage: setdebug (target), 0 = Disabled, 1 = StdOut, 2 = This Console, * = All Consoles, 4 = WebLog, 8 = Logfile'; } // Display usage
                    else { if (args['_'][0] == '*') { console.setDestination(2); } else { console.setDestination(parseInt(args['_'][0]), sessionid); } }
                    break;
                }
            case 'osinfo': { // Return the operating system information
                var i = 1;
                if (args['_'].length > 0) { i = parseInt(args['_'][0]); if (i > 8) { i = 8; } response = 'Calling ' + i + ' times.'; }
                for (var j = 0; j < i; j++)
                {
                    var pr = require('os').name();
                    pr.sessionid = sessionid;
                    pr.then(function (v)
                    {
                        sendConsoleText("OS: " + v, this.sessionid);
                    });
                }
                break;
            }
            default: { // This is an unknown command, return an error message
                response = 'Unknown command \"' + cmd + '\", type \"help\" for list of available commands.';
                break;
            }
        }
    } catch (e) { response = "Command returned an exception error: " + e; console.log(e); }
    if (response != null) { sendConsoleText(response, sessionid); }
}


// Handle a mesh agent command
function handleServerCommand(data)
{
    if ((typeof data == 'object') && (data.action == 'msg') && (data.type == 'console') && data.value && data.sessionid)
    {
        if (data.value && data.sessionid)
        {
            try
            {
                var args = splitArgs(data.value);
                processConsoleCommand(args[0].toLowerCase(), parseArgs(args), data.rights, data.sessionid);
            }
            catch(e)
            {
                sendConsoleText(e);
            }
        }
    }
    else
    {
        console.log(JSON.stringify(data, null, 1));
    }
}

// Called when the server connection state changes
function handleServerConnection(state)
{
    if (state == 1) { mesh.SendCommand({ "action": "coreinfo", "value": obj.meshCoreInfo }); } // Server connected, send mesh core information
}

obj.start = function ()
{
    // Hook up mesh agent events
    mesh.AddCommandHandler(handleServerCommand);
    mesh.AddConnectHandler(handleServerConnection);
    mesh.SendCommand({ action: 'coreinfo', value: "TinyCore", caps: 0 }); 
}

obj.stop = function ()
{
    mesh.AddCommandHandler(null);
    mesh.AddConnectHandler(null);
}


var xexports = null;
try { xexports = module.exports; } catch (e) { }

if (xexports != null)
{
    // If we are running within NodeJS, export the core
    module.exports.createMeshCore = function (agent) { mesh = agent.getMeshApi(); return (obj); };
}
else
{
    // If we are not running in NodeJS, launch the core
    sendConsoleText('TinyCore Started...');
    mesh = require('MeshAgent');
    obj.start();
}
