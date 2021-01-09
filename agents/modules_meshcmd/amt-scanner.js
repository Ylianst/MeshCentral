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

/**
* @description Meshcentral Intel AMT Local Scanner
* @author Ylian Saint-Hilaire & Joko Sastriawan
* @version v0.0.1
*/

// Construct a Intel AMT Scanner object

function AMTScanner() {
    var emitterUtils = require('events').inherits(this);
    emitterUtils.createEvent('found');

    this.dgram = require('dgram');

    this.buildRmcpPing = function (tag) {
        var packet = Buffer.from('06000006000011BE80000000', 'hex');
        packet[9] = tag;
        return packet;
    };

    this.parseRmcpPacket = function (server, data, rinfo, func) {
        if (data == null || data.length < 20) return;
        var res = {};
        if (((data[12] == 0) || (data[13] != 0) || (data[14] != 1) || (data[15] != 0x57)) && (data[21] & 32)) {
            res.servertag = data[9];
            res.minorVersion = data[18] & 0x0F;
            res.majorVersion = (data[18] >> 4) & 0x0F;
            res.provisioningState = data[19] & 0x03; // Pre = 0, In = 1, Post = 2

            var openPort = (data[16] * 256) + data[17];
            var dualPorts = ((data[19] & 0x04) != 0) ? true : false;
            res.openPorts = [openPort];
            res.address = rinfo.address;
            if (dualPorts == true) { res.openPorts = [16992, 16993]; }
            if (func !== undefined) {
                func(server, res);
            }
        }
    }

    this.parseIPv4Range = function (range) {
        if (range == undefined || range == null) return null;
        var x = range.split('-');
        if (x.length == 2) { return { min: this.parseIpv4Addr(x[0]), max: this.parseIpv4Addr(x[1]) }; }
        x = range.split('/');
        if (x.length == 2) {
            var ip = this.parseIpv4Addr(x[0]), masknum = parseInt(x[1]), mask = 0;
            if (masknum <= 16 || masknum > 32) return null;
            masknum = 32 - masknum;
            for (var i = 0; i < masknum; i++) { mask = (mask << 1); mask++; }
            return { min: (ip & (0xFFFFFFFF - mask))+1, max: (ip & (0xFFFFFFFF - mask)) + mask -1 };//remove network and broadcast address to avoid irrecoverable socket error
        }
        x = this.parseIpv4Addr(range);
        if (x == null) return null;
        return { min: x, max: x };
    };

    // Parse IP address. Takes a 
    this.parseIpv4Addr = function (addr) {
        var x = addr.split('.');
        if (x.length == 4) { return (parseInt(x[0]) << 24) + (parseInt(x[1]) << 16) + (parseInt(x[2]) << 8) + (parseInt(x[3]) << 0); }
        return null;
    }

    // IP address number to string
    this.IPv4NumToStr = function (num) {
        return ((num >> 24) & 0xFF) + '.' + ((num >> 16) & 0xFF) + '.' + ((num >> 8) & 0xFF) + '.' + (num & 0xFF);
    }

    this.scan = function (rangestr, timeout, callback) {
        var iprange = this.parseIPv4Range(rangestr);
        var rmcp = this.buildRmcpPing(0);
        var server = this.dgram.createSocket({ type: 'udp4' });
        server.parent = this;
        server.scanResults = [];
        server.on('error', function (err) { console.log('Error:' + err); });
        server.on('message', function (msg, rinfo) { if (rinfo.size > 4) { this.parent.parseRmcpPacket(this, msg, rinfo, function (s, res) { s.scanResults.push(res); }) }; });
        server.on('listening', function () { for (var i = iprange.min; i <= iprange.max; i++) {             
            server.send(rmcp, 623, server.parent.IPv4NumToStr(i)); } });
        server.bind({ address: '0.0.0.0', port: 0, exclusive: true });
        var tmout = setTimeout(function cb() {
            //console.log("Server closed");
            server.close();
            if (callback) {
                callback(server.scanResults);
            }
            server.parent.emit('found', server.scanResults);
            delete server;
        }, timeout);
    };
}

module.exports = AMTScanner;
