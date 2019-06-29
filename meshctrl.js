#!/usr/bin/env node

var settings = {};
const args = require('minimist')(process.argv.slice(2));
const possibleCommands = ['listusers', 'listgroups', 'serverinfo', 'userinfo','adduser','removeuser'];
//console.log(args);

if ((args['_'].length != 1) && (args['_'][0].toLowerCase() != 'help')) {
    console.log("MeshCtrl perform command line actions on a MeshCentral server.");
    console.log("No action specified, use MeshCtrl like this:\r\n\r\n  meshctrl [action] [arguments]\r\n");
    console.log("Supported actions:");
    console.log("  Help [action]          - Get help on an action.");
    console.log("  ServerInfo             - Show server information.");
    console.log("  UserInfo               - Show user information.");
    console.log("  ListUsers              - List user accounts.");
    console.log("  ListGroups             - List device groups.");
    console.log("  AddUser                - Create a new user account.");
    console.log("  RemoveUser             - Delete a user account.");
    console.log("\r\nSupported login arguments:");
    console.log("  --url [wss://server]  - Server url, wss://localhost:443 is default.");
    console.log("  --loginuser [username] - Login username, admin is default.");
    console.log("  --loginpass [password] - Login password.");
    console.log("  --token [number]       - 2nd factor authentication token.");
    console.log("  --loginkey [hex]       - Server login key in hex.");
    console.log("  --loginkeyfile [file]  - File containing server login key in hex.");
    console.log("  --domain [domainid]    - Domain id, default is empty.");
    return;
} else {
    settings.cmd = args['_'][0].toLowerCase();
    if ((possibleCommands.indexOf(settings.cmd) == -1) && (settings.cmd != 'help')) { console.log("Invalid command. Possible commands are: " + possibleCommands.join(', ') + '.'); return; }
    //console.log(settings.cmd);

    var ok = false;
    switch (settings.cmd) {
        case 'serverinfo': { ok = true; break; }
        case 'userinfo': { ok = true; break; }
        case 'listusers': { ok = true; break; }
        case 'listgroups': { ok = true; break; }
        case 'adduser': {
            if (args.user == null) { console.log("New account name missing, use --user [name]"); }
            else if (args.pass == null) { console.log("New account password missing, use --pass [password]"); }
            else { ok = true; }
            break;
        }
        case 'removeuser': {
            if (args.userid == null) { console.log("Remove account userid missing, use --userid [id]"); }
            else { ok = true; }
            break;
        }
        case 'help': {
            if (args['_'].length < 2) {
                console.log("Get help on an action. Type:\r\n\r\n  help [action]\r\n\r\nPossible actions are: " + possibleCommands.join(', ') + '.');
            } else {
                switch (args['_'][1].toLowerCase()) {
                    case 'serverinfo': {
                        console.log("Get information on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ServerInfo --loginuser myaccountname --loginpass mypassword");
                        console.log("  MeshCtrl ServerInfo --loginuser myaccountname --loginkeyfile key.txt");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                - Show result as JSON.");
                        break;
                    }
                    case 'userinfo': {
                        console.log("Get account information for the login account, Example usages:\r\n");
                        console.log("  MeshCtrl UserInfo --loginuser myaccountname --loginpass mypassword");
                        console.log("  MeshCtrl UserInfo --loginuser myaccountname --loginkeyfile key.txt");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                - Show result as JSON.");
                        break;
                    }
                    case 'listusers': {
                        console.log("List the account on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ListUsers");
                        console.log("  MeshCtrl ListUsers --json");
                        console.log("  MeshCtrl ListUsers --nameexists \"bob\"");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --idexists [id]       - Return 1 if id exists, 0 if not.");
                        console.log("  --nameexists [name]   - Return id if name exists.");
                        console.log("  --json                - Show result as JSON.");
                        break;
                    }
                    case 'listgroups': {
                        console.log("List the device groups for this account, Example usages:\r\n");
                        console.log("  MeshCtrl ListGroups ");
                        console.log("  MeshCtrl ListGroups --json");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --idexists [id]       - Return 1 if id exists, 0 if not.");
                        console.log("  --nameexists [name]   - Return id if name exists.");
                        console.log("  --emailexists [email] - Return id if email exists.");
                        console.log("  --json                - Show result as JSON.");
                        break;
                    }
                    case 'adduser': {
                        console.log("Add a new user account, Example usages:\r\n");
                        console.log("  MeshCtrl AddUser --user newaccountname --pass newpassword");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --user [name]         - New account name.");
                        console.log("  --pass [password]     - New account password.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --email [email]       - New account email address.");
                        console.log("  --resetpass           - Request password reset on next login.");
                        break;
                    }
                    case 'removeuser': {
                        console.log("Delete a user account, Example usages:\r\n");
                        console.log("  MeshCtrl RemoveUser --userid accountid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --userid [id]         - Account identifier.");
                        break;
                    }
                    default: {
                        console.log("Get help on an action. Type:\r\n\r\n  help [action]\r\n\r\nPossible actions are: " + possibleCommands.join(', ') + '.');
                    }
                }
            }
            break;
        }
    }

    if (ok) { serverConnect(); }
}

function serverConnect() {
    const WebSocket = require('ws');

    function onVerifyServer(clientName, certs) { console.log('onVerifyServer', clientName); }
    var url = 'wss://localhost/control.ashx';
    if (args.url) {
        url = args.url;
        if (url.length < 5) { console.log("Invalid url."); process.exit(); return; }
        if ((url.startsWith('wss://') == false) && (url.startsWith('ws://') == false)) { console.log("Invalid url."); process.exit(); return; }
        if (url.endsWith('/') == false) { url += '/'; }
        url += 'control.ashx';
    }

    var options = { rejectUnauthorized: false, checkServerIdentity: onVerifyServer }

    // Password authentication
    if (args.loginpass != null) {
        var username = 'admin';
        if (args.user != null) { username = args.user; }
        var token = '';
        if (args.token != null) { token = ',' + Buffer.from('' + args.token).toString('base64'); }
        options.headers = { 'x-meshauth': Buffer.from(username).toString('base64') + ',' + Buffer.from(args.loginpass).toString('base64') + token }
    }

    // Cookie authentication
    var ckey = null;
    if (args.loginkey != null) {
        // User key passed in a argument hex
        if (args.loginkey.length != 160) { console.log("Invalid login key."); process.exit(); return; }
        ckey = Buffer.from(args.loginkey, 'hex');
        if (ckey != 80) { console.log("Invalid login key."); process.exit(); return; }
    } else if (args.loginkeyfile != null) {
        // Load key from hex file
        var fs = require('fs');
        try {
            var keydata = fs.readFileSync(args.loginkeyfile, 'utf8').split(' ').join('').split('\r').join('').split('\n').join('');
            ckey = Buffer.from(keydata, 'hex');
            if (ckey.length != 80) { console.log("Invalid login key file."); process.exit(); return; }
        } catch (ex) { console.log(ex); process.exit(); return; }
    }

    if (ckey != null) {
        var domainid = '', username = 'admin';
        if (args.domain != null) { domainid = args.domain; }
        if (args.loginuser != null) { username = args.loginuser; }
        url += '?auth=' + encodeCookie({ userid: 'user/' + domainid + '/' + username, domainid: domainid }, ckey);
    }

    const ws = new WebSocket(url, options);
    //console.log('Connecting...');

    ws.on('open', function open() {
        //console.log('Connected.');
        switch (settings.cmd) {
            case 'serverinfo': { break; }
            case 'userinfo': { break; }
            case 'listusers': { ws.send(JSON.stringify({ action: 'users' })); break; }
            case 'listgroups': { ws.send(JSON.stringify({ action: 'meshes' })); break; }
            case 'adduser': {
                var op = { action: 'adduser', username: args.user, pass: args.pass };
                if (args.email) { op.email = args.email; }
                if (args.resetpass) { op.resetNextLogin = true; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeuser': {
                var op = { action: 'deleteuser', userid: args.userid };
                ws.send(JSON.stringify(op));
                break;
            }
        }
    });

    ws.on('close', function close() { process.exit(); });

    ws.on('message', function incoming(rawdata) {
        //console.log(rawdata);
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
                if (args.json) {
                    console.log(JSON.stringify(data.users, ' ', 2));
                } else {
                    if (args.idexists) { for (var i in data.users) { const u = data.users[i]; if ((u._id == args.idexists) || (u._id.split('/')[2] == args.idexists)) { console.log('1'); process.exit(); return; } } console.log('0'); process.exit(); return; }
                    if (args.nameexists) { for (var i in data.users) { const u = data.users[i]; if (u.name == args.nameexists) { console.log(u._id); process.exit(); return; } } process.exit(); return; }

                    console.log('id, name, email\r\n---------------');
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
                if (args.json) {
                    console.log(JSON.stringify(data.meshes, ' ', 2));
                } else {
                    if (args.idexists) { for (var i in data.meshes) { const u = data.meshes[i]; if ((u._id == args.idexists) || (u._id.split('/')[2] == args.idexists)) { console.log('1'); process.exit(); return; } } console.log('0'); process.exit(); return; }
                    if (args.nameexists) { for (var i in data.meshes) { const u = data.meshes[i]; if (u.name == args.nameexists) { console.log(u._id); process.exit(); return; } } process.exit(); return; }

                    console.log('id, name\r\n---------------');
                    for (var i in data.meshes) {
                        const m = data.meshes[i];
                        var t = "\"" + m._id.split('/')[2] + "\", \"" + m.name + "\"";
                        console.log(t);
                    }
                }
                process.exit();
                break;
            }
            case 'close': {
                if (data.cause == 'noauth') {
                    if (data.msg == 'tokenrequired') {
                        console.log('Authentication token required, use --token [number].');
                    } else {
                        console.log('Invalid login.');
                    }
                }
                process.exit();
                break;
            }
            case 'event': {
                switch (data.event.action) {
                    case 'accountcreate': {
                        if ((settings.cmd == 'adduser') && (data.event.account.name == args.user)) {
                            console.log('Account created, id: ' + data.event.account._id);
                            process.exit();
                        }
                        break;
                    }
                    case 'accountremove': {
                        if ((settings.cmd == 'removeuser') && (data.event.userid == args.userid)) {
                            console.log('Account removed');
                            process.exit();
                        }
                        break;
                    }
                }
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

// Encode an object as a cookie using a key using AES-GCM. (key must be 32 bytes or more)
function encodeCookie(o, key) {
    var crypto = require('crypto');
    try {
        if (key == null) { return null; }
        o.time = Math.floor(Date.now() / 1000); // Add the cookie creation time
        const iv = Buffer.from(crypto.randomBytes(12), 'binary'), cipher = crypto.createCipheriv('aes-256-gcm', key.slice(0, 32), iv);
        const crypted = Buffer.concat([cipher.update(JSON.stringify(o), 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), crypted]).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    } catch (e) { return null; }
}
