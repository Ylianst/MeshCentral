/*
Copyright 2018 Intel Corporation

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

var toasters = {};

function Toaster()
{
    this._ObjectID = 'Toaster';
    this.Toast = function Toast(title, caption)
    {
        if (process.platform != 'win32') return;

        var retVal = {};
        var emitter = require('events').inherits(retVal);
        emitter.createEvent('Clicked');
        emitter.createEvent('Dismissed');

        var session = require('user-sessions').Current();
        for (var i in session)
        {
            console.log(session[i]);
        }
        try
        {
            console.log('Attempting Toast Mechanism 1');
            retVal._child = require('ScriptContainer').Create({ processIsolation: true, sessionId: session.connected[0].SessionId });
        }
        catch (e) {
            console.log(e);
            console.log('Attempting Toast Mechanism 2');
            retVal._child = require('ScriptContainer').Create({ processIsolation: true });
        }
        retVal._child.parent = retVal;

        retVal._child.on('exit', function (code) { this.parent.emit('Dismissed'); delete this.parent._child; });
        retVal._child.addModule('win-console', getJSModule('win-console'));
        retVal._child.addModule('win-messagepump', getJSModule('win-messagepump'));

        var str = "\
                    try{\
                    var toast = require('win-console');\
                    var balloon = toast.SetTrayIcon({ szInfo: '" + caption + "', szInfoTitle: '" + title + "', balloonOnly: true });\
                    balloon.on('ToastDismissed', function(){process.exit();});\
                    }\
                    catch(e)\
                    {\
                        require('ScriptContainer').send(e);\
                    }\
                        require('ScriptContainer').send('done');\
                    ";
        retVal._child.ExecuteString(str);
        toasters[retVal._hashCode()] = retVal;
        retVal.on('Dismissed', function () { delete toasters[this._hashCode()]; });
        console.log('Returning');
        return (retVal);
    };
}

module.exports = new Toaster();