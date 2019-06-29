#!/usr/bin/env node

var settings = {};
const args = require('minimist')(process.argv.slice(2));
const possibleCommands = ['listusers','listgroups','serverinfo','userinfo'];
//console.log(args);

if (args['_'].length != 1) {
    console.log("MeshCtrl is a tool used to perform command line actions on a MeshCentral server.");
    console.log("No action specified, use MeshCtrl like this:\r\n\r\n  meshctrl [action] [arguments]\r\n");
    console.log("Supported actions:");
    console.log("  ServerInfo          - Show server information");
    console.log("  UserInfo            - Show user information");
    console.log("  ListUsers           - List user accounts");
    console.log("  ListGroups          - List device groups");
    console.log("\r\nSupported arguments:");
    console.log("  --json              - Show result as JSON");
    return;
} else {
    settings.cmd = args['_'][0].toLowerCase();
    if (possibleCommands.indexOf(settings.cmd) == -1) { console.log("Invalid command. Possible commands are: " + possibleCommands.join(', ') + '.'); return; }
    //console.log(settings.cmd);

    var ok = false;
    switch (settings.cmd) {
        case 'serverinfo': { ok = true; break; }
        case 'userinfo': { ok = true; break; }
        case 'listusers': { ok = true; break; }
        case 'listgroups': { ok = true; break; }
    }

    if (ok) serverConnect();
}

function serverConnect() {
    const WebSocket = require('ws');

    function onVerifyServer(clientName, certs) { console.log('onVerifyServer', clientName); }
    const ws = new WebSocket('wss://localhost/control.ashx', { rejectUnauthorized: false, checkServerIdentity: onVerifyServer });
    //console.log('Connecting...');

    ws.on('open', function open() {
        switch (settings.cmd) {
            case 'serverinfo': { break; }
            case 'userinfo': { break; }
            case 'listusers': { ws.send(JSON.stringify({ action: 'users' })); break; }
            case 'listgroups': { ws.send(JSON.stringify({ action: 'meshes' })); break; }
        }
    });

    ws.on('close', function close() { process.exit(); });

    ws.on('message', function incoming(rawdata) {
        var data = null;
        try { data = JSON.parse(rawdata); } catch (ex) { }
        if (data == null) { console.log('Unable to parse data: ' + rawdata); }
        switch (data.action) {
            case 'serverinfo': { // SERVERINFO
                if (settings.cmd == 'serverinfo') {
                    if (args.json) {
                        console.log(JSON.stringify(data.serverinfo, ' ', 2));
                    } else {
                        for (var i in data.serverinfo) { console.log(i + ':', data.serverinfo[i]); }
                    }
                    process.exit();
                }
                break;
            }
            case 'userinfo': { // USERINFO
                if (settings.cmd == 'userinfo') {
                    if (args.json) {
                        console.log(JSON.stringify(data.userinfo, ' ', 2));
                    } else {
                        for (var i in data.userinfo) { console.log(i + ':', data.userinfo[i]); }
                    }
                    process.exit();
                }
                break;
            }
            case 'users': { // LISTUSERS
                console.log('id, name, email\r\n---------------');
                if (args.json) {
                    console.log(JSON.stringify(data.users, ' ', 2));
                } else {
                    for (var i in data.users) {
                        const u = data.users[i];
                        var t = "\"" + u._id.split('/')[2] + "\", \"" + u.name + "\"";
                        if (u.email != null) { t += ", \"" + u.email + "\""; }
                        console.log(t);
                    }
                }
                process.exit();
                break;
            }
            case 'meshes': { // LISTGROUPS
                console.log('id, name\r\n---------------');
                if (args.json) {
                    console.log(JSON.stringify(data.meshes, ' ', 2));
                } else {
                    for (var i in data.meshes) {
                        const m = data.meshes[i];
                        var t = "\"" + m._id.split('/')[2] + "\", \"" + m.name + "\"";
                        console.log(t);
                    }
                }
                process.exit();
                break;
            }
            default: {
                console.log('Unknown action: ' + data.action);
                break;
            }
        }
        //console.log('Data', data);
        //setTimeout(function timeout() { ws.send(Date.now()); }, 500);
    });
}