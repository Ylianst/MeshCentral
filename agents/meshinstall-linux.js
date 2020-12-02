/*
Copyright 2020 Intel Corporation

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



// The folloing line just below with 'msh=' needs to stay exactly like this since MeshCentral will replace it with the correct settings.
var msh = {};
var displayName = msh.displayName ? msh.displayName : 'MeshCentral Agent';
var s = null, buttons = ['Cancel'], skip = false;
var serviceName = msh.meshServiceName ? msh.meshServiceName : 'meshagent';

try { s = require('service-manager').manager.getService(serviceName); } catch (e) { }

var connectArgs = [process.execPath.split('/').pop(), '--no-embedded=1', '--disableUpdate=1'];
connectArgs.push('--MeshName="' + msh.MeshName + '"');
connectArgs.push('--MeshType="' + msh.MeshType + '"');
connectArgs.push('--MeshID="' + msh.MeshID + '"');
connectArgs.push('--ServerID="' + msh.ServerID + '"');
connectArgs.push('--MeshServer="' + msh.MeshServer + '"');
connectArgs.push('--AgentCapabilities="0x00000020"');
if (msh.displayName) { connectArgs.push('--displayName="' + msh.displayName + '"'); }
if (msh.agentName) { connectArgs.push('--agentName="' + msh.agentName + '"'); }

function _install(parms)
{
    var mstr = require('fs').createWriteStream(process.execPath + '.msh', { flags: 'wb' });
    mstr.write('MeshName=' + msh.MeshName + '\n');
    mstr.write('MeshType=' + msh.MeshType + '\n');
    mstr.write('MeshID=' + msh.MeshID + '\n');
    mstr.write('ServerID=' + msh.ServerID + '\n');
    mstr.write('MeshServer=' + msh.MeshServer + '\n');
    if (msh.agentName) { mstr.write('agentName=' + msh.agentName + '\n'); }
    if (msh.meshServiceName) { mstr.write('meshServiceName=' + msh.meshServiceName + '\n'); }
    mstr.end();

    if (parms == null) { parms = []; }
    if (msh.companyName) { parms.unshift('--companyName="' + msh.companyName + '"'); }
    if (msh.displayName) { parms.unshift('--displayName="' + msh.displayName + '"'); }
    if (msh.meshServiceName) { parms.unshift('--meshServiceName="' + msh.meshServiceName + '"'); }
    parms.unshift('--copy-msh=1');
    parms.unshift('--no-embedded=1');
    parms.unshift('-fullinstall');
    parms.unshift(process.execPath.split('/').pop());

    global._child = require('child_process').execFile(process.execPath, parms);
    global._child.stdout.on('data', function (c) { process.stdout.write(c.toString()); });
    global._child.stderr.on('data', function (c) { process.stdout.write(c.toString()); });
    global._child.waitExit();
}

function _uninstall()
{
    global._child = require('child_process').execFile(process.execPath,
            [process.execPath.split('/').pop(), '-fulluninstall', '--no-embedded=1', '--meshServiceName="' + serviceName + '"']);

    global._child.stdout.on('data', function (c) { process.stdout.write(c.toString()); });
    global._child.stderr.on('data', function (c) { process.stdout.write(c.toString()); });
    global._child.waitExit();
}

if (msh.InstallFlags == null)
{
    msh.InstallFlags = 3;
} else
{
    msh.InstallFlags = parseInt(msh.InstallFlags.toString());
}

if (process.argv.includes('-mesh'))
{
    console.log(JSON.stringify(msh, null, 2));
    process.exit();
}

if (process.argv.includes('-help'))
{
    console.log("\nYou can run the text version from the command line with the following command(s): ");
    if ((msh.InstallFlags & 1) == 1)
    {
        console.log('./' + process.execPath.split('/').pop() + ' -connect');
    }
    if ((msh.InstallFlags & 2) == 2)
    {
        if (s)
        {
            console.log('./' + process.execPath.split('/').pop() + ' -update');
            console.log('./' + process.execPath.split('/').pop() + ' -uninstall');
        }
        else
        {
            console.log('./' + process.execPath.split('/').pop() + ' -install');
            console.log('./' + process.execPath.split('/').pop() + ' -install --installPath="/alternate/path"');
        }
    }
    console.log('');
    process.exit();
}

if ((msh.InstallFlags & 1) == 1)
{
    buttons.unshift('Connect');
    if (process.argv.includes('-connect'))
    {
        global._child = require('child_process').execFile(process.execPath, connectArgs);
        global._child.stdout.on('data', function (c) { });
        global._child.stderr.on('data', function (c) { });
        global._child.on('exit', function (code) { process.exit(code); });

        console.log("\nConnecting to: " + msh.MeshServer);
        console.log("Device Group: " + msh.MeshName);
        console.log('\nPress Ctrl-C to exit\n');
        skip = true;
    }
}

if ((!skip) && ((msh.InstallFlags & 2) == 2))
{
    if (!require('user-sessions').isRoot())
    {
        console.log('\n' + "Elevated permissions is required to install/uninstall the agent.");
        console.log("Please try again with sudo.");
        process.exit();
    }
    if (s)
    {
        if ((process.platform == 'darwin') || require('message-box').kdialog)
        {
            buttons.unshift("Setup");
        } else
        {
            buttons.unshift("Uninstall");
            buttons.unshift("Update");
        }
    } else
    {
        buttons.unshift("Install");
    }
}

if (!skip)
{
    if (process.platform != 'darwin')
    {
        if (process.argv.includes('-install') || process.argv.includes('-update'))
        {
            var p = [];
            for (var i = 0; i < process.argv.length; ++i)
            {
                if (process.argv[i].startsWith('--installPath='))
                {
                    p.push('--installPath="' + process.argv[i].split('=').pop() + '"');
                }
            }
            _install(p);
            process.exit();
        }
        else if (process.argv.includes('-uninstall'))
        {
            _uninstall();
            process.exit();
        }
        else
        {
            if (!require('message-box').kdialog && ((require('message-box').zenity == null) || (!require('message-box').zenity.extra)))
            {
                console.log('\n' + "The graphical version of this installer cannot run on this system.");
                console.log("Try installing/updating Zenity, and run again." + '\n');
                console.log("You can also run the text version from the command line with the following command(s): ");
                if ((msh.InstallFlags & 1) == 1)
                {
                    console.log('./' + process.execPath.split('/').pop() + ' -connect');
                }
                if ((msh.InstallFlags & 2) == 2)
                {
                    if (s)
                    {
                        console.log('./' + process.execPath.split('/').pop() + ' -update');
                        console.log('./' + process.execPath.split('/').pop() + ' -uninstall');
                    }
                    else
                    {
                        console.log('./' + process.execPath.split('/').pop() + ' -install');
                        console.log('./' + process.execPath.split('/').pop() + ' -install --installPath="/alternate/path"');
                    }
                }
                console.log('');
                process.exit();
            }
        }
    }
    else
    {
        if (!require('user-sessions').isRoot()) { console.log('\n' + "This utility requires elevated permissions. Please try again with sudo."); process.exit(); }
    }
}


if (!skip)
{
    if (!s)
    {
        msg = "Agent: " + "NOT INSTALLED" + '\n';
    } else
    {
        msg = "Agent: " + (s.isRunning() ? "RUNNING" : "NOT RUNNING") + '\n';
    }

    msg += ("Device Group: " + msh.MeshName + '\n');
    msg += ("Server URL: " + msh.MeshServer + '\n');

    var p = require('message-box').create(displayName + " Setup", msg, 99999, buttons);
    p.then(function (v)
    {
        switch (v)
        {
            case "Cancel":
                process.exit();
                break;
            case 'Setup':
                var d = require('message-box').create(displayName, msg, 99999, ['Update', 'Uninstall', 'Cancel']);
                d.then(function (v)
                {
                    switch (v)
                    {
                        case 'Update':
                        case 'Install':
                            _install();
                            break;
                        case 'Uninstall':
                            _uninstall();
                            break;
                        default:
                            break;
                    }
                    process.exit();
                }).catch(function (v) { process.exit(); });
                break;
            case "Connect":
                global._child = require('child_process').execFile(process.execPath, connectArgs);
                global._child.stdout.on('data', function (c) { });
                global._child.stderr.on('data', function (c) { });
                global._child.on('exit', function (code) { process.exit(code); });

                msg = ("Device Group: " + msh.MeshName + '\n');
                msg += ("Server URL: " + msh.MeshServer + '\n');

                if (process.platform != 'darwin')
                {
                    if (!require('message-box').zenity && require('message-box').kdialog)
                    {
                        msg += ('\nPress OK to Disconnect');
                    }
                }

                var d = require('message-box').create(displayName, msg, 99999, ['Disconnect']);
                d.then(function (v) { process.exit(); }).catch(function (v) { process.exit(); });
                break;
            case "Uninstall":
                _uninstall();
                process.exit();
                break;
            case "Install":
            case "Update":
                _install();
                process.exit();
                break;
            default:
                console.log(v);
                process.exit();
                break;
        }
    }).catch(function (e)
    {
        console.log(e);
        process.exit();
    });
}