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
    this._ObjectID = 'toaster';
    this.Toast = function Toast(title, caption)
    {
        var retVal = {};
        var emitter = require('events').inherits(retVal);
        emitter.createEvent('Dismissed');

        retVal.title = title;
        retVal.caption = caption;

        if (process.platform == 'win32')
        {
            emitter.createEvent('Clicked');

            var session = require('user-sessions').Current();
            for (var i in session) {
                console.log(session[i]);
            }
            try {
                console.log('Attempting Toast Mechanism 1');
                retVal._child = require('ScriptContainer').Create({ processIsolation: true, sessionId: session.Active[0].SessionId });
            }
            catch (e) {
                console.log(e);
                console.log('Attempting Toast Mechanism 2');
                retVal._child = require('ScriptContainer').Create({ processIsolation: true });
            }
            retVal._child.parent = retVal;

            retVal._child.on('exit', function (code) { this.parent.emit('Dismissed'); delete this.parent._child; });
            retVal._child.addModule('win-console', getJSModule('win-console'));
            retVal._child.addModule('win-message-pump', getJSModule('win-message-pump'));

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
        }
        else
        {
            if(!require('fs').existsSync('/usr/bin/notify-send'))
            {
                throw ('Toast not supported on this platform');
            }
            Object.defineProperty(retVal, '_sessions', {
                value: require('user-sessions').Current(function onCurrentSession(sessions)
                {
                    this._cchild = require('child_process').execFile('/usr/bin/whoami', ['whoami'], { type: require('child_process').SpawnTypes.TERM });
                    this._cchild.stdout.on('data', function (chunk)
                    {
                        if (chunk.toString().split('\r\n')[0] == 'root')
                        {
                            if (sessions[':0'].State != 'Connected' && sessions[':0'].State != 'Active')
                            {
                                // No logged in user owns the display
                                this.parent.parent.Parent.emit('Dismissed');
                                return;
                            }

                            // We root, so we need to direct to DISPLAY=:0
                            this.parent.parent._notify = require('child_process').execFile('/bin/sh', ['sh'], { type: require('child_process').SpawnTypes.TERM });
                            this.parent.parent._notify.stdin.write('su - ' + sessions[':0'].Username + ' -c "DISPLAY=:0 notify-send \'' + this.parent.parent.Parent.title + '\' \'' + this.parent.parent.Parent.caption + '\'"\n');
                            this.parent.parent._notify.stdin.write('exit\n');
                            this.parent.parent._notify.stdout.on('data', function (chunk) { });
                        }
                        else
                        {
                            // We ain't root, so that means we can just call send-notify directly
                            this.parent.parent._notify = require('child_process').execFile('/usr/bin/notify-send', ['notify-send', this.parent.parent.Parent.title, this.parent.parent.Parent.caption], { type: require('child_process').SpawnTypes.TERM });
                            this.parent.parent._notify.stdout.on('data', function (chunk) { });
                        }

                        // NOTIFY-SEND has a bug where timeouts don't work, so the default is 10 seconds
                        this.parent.parent.Parent._timeout = setTimeout(function onFakeDismissed(obj)
                        {
                            obj.emit('Dismissed');
                        }, 10000, this.parent.parent.Parent);
                    });
                    this._cchild.parent = this;
                })
            });
            retVal._sessions.Parent = retVal;

            toasters[retVal._hashCode()] = retVal;
            retVal.on('Dismissed', function () { delete toasters[this._hashCode()]; });

            return (retVal);
        }
    };
}

module.exports = new Toaster();