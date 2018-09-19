var MemoryStream = require('MemoryStream');
var WindowsChildScript = 'var parent = require("ScriptContainer");var Wireless = require("wifi-scanner-windows");Wireless.on("Scan", function (ap) { parent.send(ap); });Wireless.Scan();';


function AccessPoint(_ssid, _bssid, _lq)
{
    this.ssid = _ssid;
    this.bssid = _bssid;
    this.lq = _lq;
}
AccessPoint.prototype.toString = function ()
{
    return ("[" + this.bssid + "]: " + this.ssid + " (" + this.lq + ")");
    //return (this.ssid + " [" + this.bssid + "]: " + this.lq);
}

function WiFiScanner()
{
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('accessPoint');

    this.hasWireless = function ()
    {
        var retVal = false;
        var interfaces = require('os').networkInterfaces();
        for (var name in interfaces)
        {
            if (interfaces[name][0].type == 'wireless') { retVal = true; break; }
        }
        return (retVal);
    };

    this.Scan = function ()
    {
        if (process.platform == 'win32')
        {
            this.master = require('ScriptContainer').Create(15, ContainerPermissions.DEFAULT);
            this.master.parent = this;
            this.master.on('data', function (j) { this.parent.emit('accessPoint', new AccessPoint(j.ssid, j.bssid, j.lq)); });

            this.master.addModule('wifi-scanner-windows', getJSModule('wifi-scanner-windows'));
            this.master.ExecuteString(WindowsChildScript);
        }
        else if (process.platform == 'linux')
        {
            // Need to get the wireless interface name
            var interfaces = require('os').networkInterfaces();
            var wlan = null;
            for (var i in interfaces)
            {
                if (interfaces[i][0].type == 'wireless')
                {
                    wlan = i;
                    break;
                }
            }
            if (wlan != null)
            {
                this.child = require('child_process').execFile('/sbin/iwlist', ['iwlist', wlan, 'scan']);
                this.child.parent = this;
                this.child.ms = new MemoryStream();
                this.child.ms.parent = this.child;
                this.child.stdout.on('data', function (buffer) { this.parent.ms.write(buffer); });
                this.child.on('exit', function () { this.ms.end(); });
                this.child.ms.on('end', function ()
                {
                    var str = this.buffer.toString();
                    tokens = str.split(' - Address: ');
                    for (var block in tokens)
                    {
                        if (block == 0) continue;
                        var ln = tokens[block].split('\n');
                        var _bssid = ln[0];
                        var _lq;
                        var _ssid;

                        for (var lnblock in ln)
                        {
                            lnblock = ln[lnblock].trim();
                            lnblock = lnblock.trim();
                            if (lnblock.startsWith('ESSID:'))
                            {
                                _ssid = lnblock.slice(7, lnblock.length - 1);
                                if (_ssid == '<hidden>') { _ssid = ''; }
                            }
                            if (lnblock.startsWith('Signal level='))
                            {
                                _lq = lnblock.slice(13,lnblock.length-4);
                            }
                            else if (lnblock.startsWith('Quality='))
                            {
                                _lq = lnblock.slice(8, 10);
                                var scale = lnblock.slice(11, 13);
                            }
                        }
                        this.parent.parent.emit('accessPoint', new AccessPoint(_ssid, _bssid, _lq));
                    }
                });
            }
        }
    }
}

module.exports = WiFiScanner;







