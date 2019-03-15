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


var SERVICE_WIN32 = 0x00000010 | 0x00000020;
var SERVICE_STATE = { STOPPED: 0x00000001, SERVICE_START_PENDING: 0x00000002, SERVICE_STOP_PENDING: 0x00000003, RUNNING: 0x00000004 };
var SERVICE_ACCEPT = { SERVICE_ACCEPT_STOP: 0x00000001, SERVICE_ACCEPT_SHUTDOWN: 0x00000004, SERVICE_ACCEPT_POWEREVENT: 0x00000040, SERVICE_ACCEPT_SESSIONCHANGE: 0x00000080 };

var SERVICE_CONTROL = { SERVICE_CONTROL_SHUTDOWN: 0x00000005, SERVICE_CONTROL_STOP: 0x00000001, SERVICE_CONTROL_POWEREVENT: 0x0000000D, SERVICE_CONTROL_SESSIONCHANGE: 0x0000000E};
var SESSION_CHANGE_TYPE =
{
    WTS_CONSOLE_CONNECT: 0x1,
    WTS_CONSOLE_DISCONNECT: 0x2,
    WTS_REMOTE_CONNECT: 0x3,
    WTS_REMOTE_DISCONNECT: 0x4,
    WTS_SESSION_LOGON: 0x5,
    WTS_SESSION_LOGOFF: 0x6,
    WTS_SESSION_LOCK: 0x7,
    WTS_SESSION_UNLOCK: 0x8,
    WTS_SESSION_REMOTE_CONTROL: 0x9,
    WTS_SESSION_CREATE: 0xa,
    WTS_SESSION_TERMINATE: 0xb
};


var NO_ERROR = 0;

var serviceManager = require('service-manager');

function serviceHost(serviceName)
{
    this._ObjectID = 'service-host';
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('serviceStart');
    emitterUtils.createEvent('serviceStop');
    emitterUtils.createEvent('normalStart');
    emitterUtils.createEvent('session');
    emitterUtils.createEvent('powerStateChange');

    if (process.platform == 'win32')
    {
        this.GM = require('_GenericMarshal');
        this.Advapi = this.GM.CreateNativeProxy('Advapi32.dll');
        this.Advapi.CreateMethod({ method: 'StartServiceCtrlDispatcherA', threadDispatch: 1 });
        this.Advapi.CreateMethod('RegisterServiceCtrlHandlerExA');
        this.Advapi.CreateMethod('SetServiceStatus');
        this.Kernel32 = this.GM.CreateNativeProxy('Kernel32.dll');
        this.Kernel32.CreateMethod('GetLastError');

        this.Ole32 = this.GM.CreateNativeProxy('Ole32.dll');
        this.Ole32.CreateMethod('CoInitializeEx');
        this.Ole32.CreateMethod('CoUninitialize');

        this._ServiceName = this.GM.CreateVariable(typeof (serviceName) == 'string' ? serviceName : serviceName.name);
        this._ServiceMain = this.GM.GetGenericGlobalCallback(2);
        this._ServiceMain.Parent = this;
        this._ServiceMain.GM = this.GM;
        this._ServiceMain.on('GlobalCallback', function onGlobalCallback(argc, argv)
        {
            //ToDo: Check to make sure this is for us

            this.Parent._ServiceStatus = this.GM.CreateVariable(28);
            //typedef struct _SERVICE_STATUS {
            //    DWORD   dwServiceType;
            //    DWORD   dwCurrentState;
            //    DWORD   dwControlsAccepted;
            //    DWORD   dwWin32ExitCode;
            //    DWORD   dwServiceSpecificExitCode;
            //    DWORD   dwCheckPoint;
            //    DWORD   dwWaitHint;
            //} SERVICE_STATUS, *LPSERVICE_STATUS;

            // Initialise service status
            this.Parent._ServiceStatus.toBuffer().writeUInt32LE(SERVICE_WIN32);
            this.Parent._ServiceStatus.toBuffer().writeUInt32LE(SERVICE_STATE.SERVICE_STOPPED, 4);
            this.Parent._ServiceStatusHandle = this.Parent.Advapi.RegisterServiceCtrlHandlerExA(this.Parent._ServiceName, this.Parent._ServiceControlHandler, this.Parent.GM.StashObject(this.Parent._ServiceControlHandler));
            if(this.Parent._ServiceStatusHandle.Val == 0)
            {
                process.exit(1);
            }

            // Service is starting
            this.Parent._ServiceStatus.toBuffer().writeUInt32LE(SERVICE_STATE.SERVICE_START_PENDING, 4);
            this.Parent.Advapi.SetServiceStatus(this.Parent._ServiceStatusHandle, this.Parent._ServiceStatus);

            // Service running
            this.Parent._ServiceStatus.toBuffer().writeUInt32LE(SERVICE_STATE.RUNNING, 4);
            this.Parent._ServiceStatus.toBuffer().writeUInt32LE(SERVICE_ACCEPT.SERVICE_ACCEPT_STOP | SERVICE_ACCEPT.SERVICE_ACCEPT_POWEREVENT | SERVICE_ACCEPT.SERVICE_ACCEPT_SESSIONCHANGE, 8);
            this.Parent.Advapi.SetServiceStatus(this.Parent._ServiceStatusHandle, this.Parent._ServiceStatus);

            this.Parent.Ole32.CoInitializeEx(0, 2);
            this.Parent.on('~', function OnServiceHostFinalizer()
            {            
                var GM = require('_GenericMarshal');
                var Advapi = GM.CreateNativeProxy('Advapi32.dll');
                Advapi.CreateMethod('SetServiceStatus');

                Kernel32 = this.GM.CreateNativeProxy('Kernel32.dll');
                Kernel32.CreateMethod('GetLastError');

                var status = GM.CreateVariable(28);

                // Service was stopped
                status.toBuffer().writeUInt32LE(SERVICE_WIN32);
                status.toBuffer().writeUInt32LE(0x00000001, 4);
                status.toBuffer().writeUInt32LE(0, 8);

                Advapi.SetServiceStatus(this._ServiceStatusHandle, status);

                this.Ole32.CoUninitialize();
            });

            this.Parent.emit('serviceStart');
        });
        this._ServiceControlHandler = this.GM.GetGenericGlobalCallback(4);
        this._ServiceControlHandler.Parent = this;
        this._ServiceControlHandler.GM = this.GM;
        this._ServiceControlHandler.on('GlobalCallback', function onServiceControlHandler(code, eventType, eventData, context)
        {
            var j = this.Parent.GM.UnstashObject(context);
            if (j != null && j == this)
            {
                switch (code.Val)
                {
                    case SERVICE_CONTROL.SERVICE_CONTROL_SHUTDOWN:
                    case SERVICE_CONTROL.SERVICE_CONTROL_STOP:
                        this.Parent.emit('serviceStop');
                        return;
                    case SERVICE_CONTROL.SERVICE_CONTROL_SESSIONCHANGE:
                        var sessionId = eventData.Deref(4, 4).toBuffer().readUInt32LE();
                        switch(eventType.Val)
                        {
                            case SESSION_CHANGE_TYPE.WTS_SESSION_LOGON:
                            case SESSION_CHANGE_TYPE.WTS_SESSION_LOGOFF:
                                require('user-sessions').emit('changed');
                                break;
                        }
                        break;
                    default:
                        break;
                }

                this.Parent.Advapi.SetServiceStatus(this.Parent._ServiceStatusHandle, this.Parent._ServiceStatus);
            }
        });
    }

    if (serviceName) { this._ServiceOptions = typeof (serviceName) == 'object' ? serviceName : { name: serviceName }; }
    else
    {
        throw ('Must specify either ServiceName or Options');
    }
    if (!this._ServiceOptions.servicePath)
    {
        this._ServiceOptions.servicePath = process.execPath;
    }
    
    this.run = function run()
    {
        var serviceOperation = 0;

        for(var i = 0; i<process.argv.length; ++i)
        {
            switch(process.argv[i])
            {
                case '-install':
                    if (!this._svcManager) { this._svcManager = new serviceManager(); }
                    try
                    {
                        this._svcManager.installService(this._ServiceOptions);
                    }
                    catch(e)
                    {
                        console.log(e);
                        process.exit();
                    }

                    console.log(this._ServiceOptions.name + ' installed');
                    process.exit();
                    break;
                case '-uninstall':
                    if (!this._svcManager) { this._svcManager = new serviceManager(); }
                    try
                    {
                        this._svcManager.uninstallService(this._ServiceOptions);
                    }
                    catch(e)
                    {
                        console.log(e);
                        process.exit();
                    }
                    if (process.platform == 'win32' || process.platform == 'darwin')
                    {
                        // Only do this on Windows/MacOS, becuase Linux is async... It'll complete later
                        console.log(this._ServiceOptions.name + ' uninstalled');
                        process.exit();
                    }
                    i = process.argv.length;
                    serviceOperation = 1;
                    break;
                case 'start':
                case '-d':
                    if (process.platform != 'win32') { break; }
                    if (!this._svcManager) { this._svcManager = new serviceManager(); }
                    this._svcManager.getService(this._ServiceOptions.name).start();
                    console.log(this._ServiceOptions.name + ' starting...');
                    process.exit();
                    break;
                case 'stop':
                case '-s':
                    if (process.platform != 'win32') { break; }
                    if (!this._svcManager) { this._svcManager = new serviceManager(); }
                    this._svcManager.getService(this._ServiceOptions.name).stop();
                    console.log(this._ServiceOptions.name + ' stopping...');
                    process.exit();
                    break;

            }
        }

        if (process.platform == 'win32')
        {
            var serviceTable = this.GM.CreateVariable(4 * this.GM.PointerSize);
            this._ServiceName.pointerBuffer().copy(serviceTable.toBuffer());
            this._ServiceMain.pointerBuffer().copy(serviceTable.toBuffer(), this.GM.PointerSize);
            this._sscd = this.Advapi.StartServiceCtrlDispatcherA(serviceTable);
            this._sscd.parent = this;
            this._sscd.on('done', function OnStartServiceCtrlDispatcherA(retVal) {
                if (retVal.Val == 0)
                {
                    this.parent.emit('normalStart');
                }
            });
            return;
        }
        else if (process.platform == 'linux')
        {
            var moduleName = this._ServiceOptions ? this._ServiceOptions.name : process.execPath.substring(1 + process.execPath.lastIndexOf('/'));

            for (var i = 0; i < process.argv.length; ++i) {
                switch (process.argv[i]) {
                    case 'start':
                    case '-d':
                        var child = require('child_process').execFile(process.execPath, [moduleName], { type: require('child_process').SpawnTypes.DETACHED });
                        var pstream = null;
                        try {
                            pstream = require('fs').createWriteStream('/var/run/' + moduleName + '.pid', { flags: 'w' });
                        }
                        catch (e) {
                        }
                        if (pstream == null) {
                            pstream = require('fs').createWriteStream('.' + moduleName + '.pid', { flags: 'w' });
                        }
                        pstream.end(child.pid.toString());

                        console.log(moduleName + ' started!');
                        process.exit();
                        break;
                    case 'stop':
                    case '-s':
                        var pid = null;
                        try {
                            pid = parseInt(require('fs').readFileSync('/var/run/' + moduleName + '.pid', { flags: 'r' }));
                            require('fs').unlinkSync('/var/run/' + moduleName + '.pid');
                        }
                        catch (e) {
                        }
                        if (pid == null) {
                            try {
                                pid = parseInt(require('fs').readFileSync('.' + moduleName + '.pid', { flags: 'r' }));
                                require('fs').unlinkSync('.' + moduleName + '.pid');
                            }
                            catch (e) {
                            }
                        }

                        if (pid) {
                            process.kill(pid);
                            console.log(moduleName + ' stopped');
                        }
                        else {
                            console.log(moduleName + ' not running');
                        }
                        process.exit();
                        break;
                }
            }

            if (serviceOperation == 0) {
                // This is non-windows, so we need to check how this binary was started to determine if this was a service start

                // Start by checking if we were started with start/stop
                var pid = null;
                try {
                    pid = parseInt(require('fs').readFileSync('/var/run/' + moduleName + '.pid', { flags: 'r' }));
                }
                catch (e) {
                }
                if (pid == null) {
                    try {
                        pid = parseInt(require('fs').readFileSync('.' + moduleName + '.pid', { flags: 'r' }));
                    }
                    catch (e) {
                    }
                }

                if (pid != null && pid == process.pid) {
                    this.emit('serviceStart');
                }
                else {
                    // Now we need to check if we were started with systemd
                    if (require('process-manager').getProcessInfo(1).Name == 'systemd') {
                        this._checkpid = require('child_process').execFile('/bin/sh', ['sh'], { type: require('child_process').SpawnTypes.TERM });
                        this._checkpid.result = '';
                        this._checkpid.parent = this;
                        this._checkpid.on('exit', function onCheckPIDExit() {
                            var lines = this.result.split('\r\n');
                            for (i in lines) {
                                if (lines[i].startsWith(' Main PID:')) {
                                    var tokens = lines[i].split(' ');
                                    if (parseInt(tokens[3]) == process.pid) {
                                        this.parent.emit('serviceStart');
                                    }
                                    else {
                                        this.parent.emit('normalStart');
                                    }
                                    delete this.parent._checkpid;
                                    return;
                                }
                            }
                            this.parent.emit('normalStart');
                            delete this.parent._checkpid;
                        });
                        this._checkpid.stdout.on('data', function (chunk) { this.parent.result += chunk.toString(); });
                        this._checkpid.stdin.write("systemctl status " + moduleName + " | grep 'Main PID:'\n");
                        this._checkpid.stdin.write('exit\n');
                    }
                    else {
                        // This isn't even a systemd platform, so this couldn't have been a service start
                        this.emit('normalStart');
                    }
                }
            }
        }
        else if(process.platform == 'darwin')
        {
            // First let's fetch all the PIDs of running services
            var child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write('launchctl list\nexit\n');
            child.waitExit();

            var lines = child.stdout.str.split('\n');
            var tokens, i;
            var p = {};
            for (i = 1; i < lines.length; ++i)
            {
                tokens = lines[i].split('\t');
                if (tokens[0] && tokens[0] != '-') { p[tokens[0]] = tokens[0]; }
            }

            if(p[process.pid.toString()])
            {
                // We are a service!
                this.emit('serviceStart');
            }
            else
            {
                this.emit('normalStart');
            }
        }
    };
}

module.exports = serviceHost;