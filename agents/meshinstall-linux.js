/*
Copyright 2020-2021 Intel Corporation

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

Object.defineProperty(Array.prototype, 'getParameterEx',
        {
            value: function (name, defaultValue)
            {
                var i, ret;
                for (i = 0; i < this.length; ++i)
                {
                    if (this[i] == name) { return (null); }
                    if (this[i].startsWith(name + '='))
                    {
                        ret = this[i].substring(name.length + 1);
                        if (ret.startsWith('"')) { ret = ret.substring(1, ret.length - 1); }
                        return (ret);
                    }
                }
                return (defaultValue);
            }
        });
Object.defineProperty(Array.prototype, 'getParameter',
    {
        value: function (name, defaultValue)
        {
            return (this.getParameterEx('-' + name, defaultValue));
        }
    });

// The following line just below with 'msh=' needs to stay exactly like this since MeshCentral will replace it with the correct settings.
var msh = {};
var translation = JSON.parse(msh.translation);

var lang = require('util-language').current;
if (lang == null) { lang = 'en'; }
if (lang == "C"){
    lang = 'en';
    console.log("Langauge envronment variable was not set (process.env.LANG).  Defaulting to English ('en').\nSee the agent-translations.json file for a list of current languages that are implemented\nUsage: meshcentral -lang=en\n");    
}
if (process.argv.getParameter('lang', lang) == null)
{
    console.log('\nCurrent Language: ' + lang + '\n');
    process.exit();
}
else
{
    lang = process.argv.getParameter('lang', lang).toLowerCase();
    lang = lang.split('_').join('-');
    if (translation[lang] == null)
    {
        if (translation[lang.split('-')[0]] == null)
        {
            console.log('Language: ' + lang + ' is not translated.');
            console.log("try: './"+ process.execPath.split('/').pop() + " -lang=en' for English");
            console.log("See the agent-translations.json file for a list of current languages that are implemented.")
            process.exit();
        }
        else
        {
            lang = lang.split('-')[0];
        }
    }
}

if (lang != 'en')
{
    for (var i in translation['en'])
    {
        // If translated entries are missing, substitute the english translation
        if (translation[lang][i] == null) { translation[lang][i] = translation['en'][i]; }
    }
}


var displayName = msh.displayName ? msh.displayName : 'MeshCentral Agent';
var s = null, buttons = [translation[lang].cancel], skip = false;
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
    var i;
    var mstr = require('fs').createWriteStream(process.execPath + '.msh', { flags: 'wb' });

    for (i in msh)
    {
        mstr.write(i + '=' + msh[i] + '\n');
    }
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
if (process.argv.includes('-translations'))
{
    console.log(JSON.stringify(translation));
    process.exit();
}
if (process.argv.includes('-help') || (process.platform == 'linux' && process.env['XAUTHORITY'] == null && process.env['DISPLAY'] == null && process.argv.length == 1))
{
    console.log("\n" + translation[lang].commands + ": ");
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
    buttons.unshift(translation[lang].connect);
    if (process.argv.includes('-connect'))
    {
        global._child = require('child_process').execFile(process.execPath, connectArgs);
        global._child.stdout.on('data', function (c) { });
        global._child.stderr.on('data', function (c) { });
        global._child.on('exit', function (code) { process.exit(code); });

        console.log("\n" + translation[lang].url + ": " + msh.MeshServer);
        console.log(translation[lang].group + ": " + msh.MeshName);
        console.log('\n' + translation[lang].ctrlc + '\n');
        skip = true;
    }
}

if ((!skip) && ((msh.InstallFlags & 2) == 2))
{
    if (!require('user-sessions').isRoot())
    {
        console.log('\n' + translation[lang].elevation);
        console.log(translation[lang].sudo);
        process.exit();
    }
    if (s)
    {
        if ((process.platform == 'darwin') || require('message-box').kdialog)
        {
            buttons.unshift(translation[lang].setup);
        } else
        {
            buttons.unshift(translation[lang].uninstall);
            buttons.unshift(translation[lang].update);
        }
    } else
    {
        buttons.unshift(translation[lang].install);
    }
}

    if (!skip)
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
                else if(process.argv[i].startsWith('--'))
                {
                    p.push(process.argv[i]);
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
                console.log('\n' + translation[lang].graphicalerror + '.');
                console.log(translation[lang].zenity + ".\n");
                console.log(translation[lang].commands + ": ");
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
        if (process.platform == 'darwin')
        {
            if (!require('user-sessions').isRoot()) { console.log('\n' + translation[lang].elevation); process.exit(); }
        }
    }


if (!skip)
{
    if (!s)
    {
        msg = translation[lang].agent + ": " + translation[lang].status[0] + '\n';
    } else
    {
        msg = translation[lang].agent + ": " + (s.isRunning() ? translation[lang].status[1] : translation[lang].status[2]) + '\n';
    }

    msg += (translation[lang].group + ": " + msh.MeshName + '\n');
    msg += (translation[lang].url + ": " + msh.MeshServer + '\n');

    var p = require('message-box').create(displayName + " " + translation[lang].setup, msg, 99999, buttons);
    p.then(function (v)
    {
        switch (v)
        {
            case translation[lang].cancel:
                process.exit();
                break;
            case translation[lang].setup:
                var d = require('message-box').create(displayName, msg, 99999, [translation[lang].update, translation[lang].uninstall, translation[lang].cancel]);
                d.then(function (v)
                {
                    switch (v)
                    {
                        case translation[lang].update:
                        case translation[lang].install:
                            _install();
                            break;
                        case translation[lang].uninstall:
                            _uninstall();
                            break;
                        default:
                            break;
                    }
                    process.exit();
                }).catch(function (v) { process.exit(); });
                break;
            case translation[lang].connect:
                global._child = require('child_process').execFile(process.execPath, connectArgs);
                global._child.stdout.on('data', function (c) { });
                global._child.stderr.on('data', function (c) { });
                global._child.on('exit', function (code) { process.exit(code); });

                msg = (translation[lang].group + ": " + msh.MeshName + '\n');
                msg += (translation[lang].url + ": " + msh.MeshServer + '\n');

                if (process.platform != 'darwin')
                {
                    if (!require('message-box').zenity && require('message-box').kdialog)
                    {
                        msg += ('\n' + translation[lang].pressok);
                    }
                }

                var d = require('message-box').create(displayName, msg, 99999, [translation[lang].disconnect]);
                d.then(function (v) { process.exit(); }).catch(function (v) { process.exit(); });
                break;
            case translation[lang].uninstall:
                _uninstall();
                process.exit();
                break;
            case translation[lang].install:
            case translation[lang].update:
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
