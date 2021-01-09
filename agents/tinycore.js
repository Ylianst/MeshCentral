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

function createMeshCore(agent) {
    var obj = {};
    
    // MeshAgent JavaScript Core Module. This code is sent to and running on the mesh agent.
    obj.meshCoreInfo = "TinyCore v1";
    
    if (agent == null) {
        // If we are running in Duktape, agent will be null
        var mesh = require('MeshAgent');
    } else {
        // Running in nodejs
        var mesh = agent.getMeshApi();
    }

    // Handle a mesh agent command
    function handleServerCommand(data) {
        if ((typeof data == 'object') && (data.action == 'msg') && (data.type == 'console') && data.value && data.sessionid) {
            mesh.SendCommand({ "action": "msg", "type": "console", "value": "Tiny core: " + data.value, "sessionid": data.sessionid });
        }
    }
    
    // Called when the server connection state changes
    function handleServerConnection(state) {
        if (state == 1) { mesh.SendCommand({ "action": "coreinfo", "value": obj.meshCoreInfo }); } // Server connected, send mesh core information
    }
    
    obj.start = function() {
        // Hook up mesh agent events
        mesh.AddCommandHandler(handleServerCommand);
        mesh.AddConnectHandler(handleServerConnection);
        mesh.SendCommand({ "action": "coreinfo", "value": obj.meshCoreInfo }); // TODO: Check if connected before sending
    }
    
    obj.stop = function() {
        mesh.AddCommandHandler(null);
        mesh.AddConnectHandler(null);
    }

    return obj;
}

var xexports = null;
try { xexports = module.exports; } catch (e) { }

if (xexports != null) {
    // If we are running within NodeJS, export the core
    module.exports.createMeshCore = createMeshCore;
} else {
    // If we are not running in NodeJS, launch the core
    createMeshCore().start(null);
}
