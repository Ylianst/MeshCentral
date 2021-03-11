/**
* @description MeshCentral Intel AMT Hello server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2021
* @license Apache-2.0
* @version v0.0.1
*/

/*xjslint node: true */
/*xjslint plusplus: true */
/*xjslint maxlen: 256 */
/*jshint node: true */
/*jshint strict: false */
/*jshint esversion: 6 */
"use strict";

// Construct the Intel AMT hello server. This is used for Intel AMT bare-metal activation on the local LAN.
// This server can receive a notification from Intel AMT and attempt activation.
module.exports.CreateAmtHelloServer = function (parent, config) {
    var obj = {};

    var port = 9971;
    if (typeof config.port == 'number') { port = config.port; }
    const net = require('net');
    obj.server = net.createServer(function (socket) {
        socket.ra = socket.remoteAddress;
        socket.data = null;
        socket.on('error', function (err) { })
        socket.on('close', function () { if (this.data != null) { parseHelloData(this.data, this.ra); } delete this.ra; this.removeAllListeners(); })
        socket.on('data', function (data) {
            if (this.data == null) { this.data = data; } else { Buffer.concat([this.data, data]); }
            var str = this.data.toString();
            if (str.startsWith('GET ') && (str.indexOf('\r\n\r\n') >= 0)) {
                this.data = null;
                var content = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Intel&reg; AMT Hello Server</title></head><body>Intel AMT hello server.<br />Intel&reg; AMT devices should send notification to this port for activation.</body></html>";
                try { socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ' + content.length + '\r\nConnection: close\r\n\r\n' + content); } catch (ex) {}
            } else if (this.data.length > 16000) {
                try { this.end(); } catch (ex) { };
            }
        })
    });
    obj.server.listen(port);
    console.log('MeshCentral Intel AMT hello server running on port ' + port + '.');

    function parseHelloData(data, addr) {
        if (addr.startsWith('::ffff:')) { addr = addr.substring(7); }
        console.log('parseHelloData', data.length);
        console.log('Address', addr);
        console.log('HEX', data.toString('hex'));
    }

    return obj;
};



/*
[Serializable]
public class AmtHello
{
    public byte[] Data;
    public string Pid;
    public byte[][] CertHash;
    public DateTime ReceivedTime;
    public IPEndPoint RemoteEndPoint;
    public int Version;

    public AmtHello(byte[] buf, IPEndPoint ep)
    {
        Data = buf;
        ReceivedTime = DateTime.Now;
        RemoteEndPoint = ep;
        Version = buf[2];
        if (buf.Length == 32) // One Touch PID
        {
            byte[] b = new byte[8];
            Array.Copy(buf,24,b,0,8);
            Pid = UTF8Encoding.UTF8.GetString(b);
            if (Pid.Length == 8) Pid = Pid.Substring(0, 4) + "-" + Pid.Substring(4, 4);
        }
        if (Version == 3) // Zero-Touch Key Hash
        {
            int hashCount = buf[24];
            CertHash = new byte[hashCount][];
            int ptr = 26;
            for (int i = 0; i < hashCount; i++)
            {
                CertHash[i] = new byte[buf[ptr]];
                Array.Copy(buf, ptr + 1, CertHash[i], 0, buf[ptr]);
                ptr += (buf[ptr] + 2);
            }
        }
    }

    public bool NetworkPasswordChanged
    {
        get {return BitConverter.ToInt16(Data, 0) != 0;}
    }

    public Guid GetGuid()
    {
        if (Data.Length < 24) return Guid.Empty;
        byte[] b = new byte[16];
        Array.Copy(Data, 8, b, 0, 16);
        return new Guid(b);
    }

    public float GetVersion()
    {
        if (Data.Length < 4) return 0;
        return (float)BitConverter.ToInt16(Data, 2);
    }
}
*/