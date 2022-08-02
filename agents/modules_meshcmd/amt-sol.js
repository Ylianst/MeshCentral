/** 
* @description Serial-over-LAN Handling Module
* @author Ylian Saint-Hilaire
*/

// meshservice meshcmd.js amtterm --host 192.168.2.186 --pass P@ssw0rd

// Construct a Intel AMT Serial-over-LAN object
module.exports = function CreateAmtRemoteSol() {
    var obj = {};
    obj.protocol = 1; // Serial-over-LAN
    obj.debug = false;
    obj.onData = null;
    obj.xxStateChange = function (newstate) { if (obj.debug) console.log('SOL-StateChange', newstate); if (newstate == 0) { obj.Stop(); } if (newstate == 3) { obj.Start(); } }
    obj.Start = function () { if (obj.debug) { console.log('SOL-Start'); } }
    obj.Stop = function () { if (obj.debug) { console.log('SOL-Stop'); } }
    obj.ProcessData = function (data) { if (obj.debug) { console.log('SOL-ProcessData', data); } if (obj.onData) { obj.onData(obj, data); } }
    obj.Send = function(text) { if (obj.debug) { console.log('SOL-Send', text); } obj.parent.Send(text); }
    return obj;
}