#!/usr/bin/env node

/**
* @description MeshCentral bot sample code
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/

// Make sure we have the dependency modules
try { require('minimist'); } catch (ex) { console.log('Missing module "minimist", type "npm install minimist" to install it.'); return; }
try { require('ws'); } catch (ex) { console.log('Missing module "ws", type "npm install ws" to install it.'); return; }

var settings = {};
const crypto = require('crypto');
const args = require('minimist')(process.argv.slice(2));
const path = require('path');
if (args.proxy != null) { try { require('https-proxy-agent'); } catch (ex) { console.log('Missing module "https-proxy-agent", type "npm install https-proxy-agent" to install it.'); return; } }

if (args['_'].length == 0) {
    console.log("MeshBot is a bot that connects to MeshCentral and perform various tasks.");
    console.log("Information at: https://meshcentral.com");
    console.log("No action specified, use MeshBot like this:\r\n\r\n  meshbot [action] [arguments]\r\n");
    console.log("Supported actions:");
    console.log("  run                         - Run the bot.");
    console.log("\r\nSupported login arguments:");
    console.log("  --url [wss://server]        - Server url, wss://localhost:443 is default.");
    console.log("                              - Use wss://localhost:443?key=xxx if login key is required.");
    console.log("  --loginuser [username]      - Login username, admin is default.");
    console.log("  --loginpass [password]      - Login password.");
    console.log("  --token [number]            - 2nd factor authentication token.");
    console.log("  --loginkey [key]            - Server login key.");
    console.log("  --nocertcheck               - Ignore server certificate warning.");
    console.log("  --proxy [http://proxy:123]  - Specify an HTTP proxy.");
    return;
} else {
    settings.cmd = args['_'][0].toLowerCase();
    if (settings.cmd != 'run') { console.log("Invalid command. \"run\" command will start the bot."); return; } else { serverConnect(); }
}

function serverConnect() {
    const WebSocket = require('ws'), options = {}
    
    // URL setup
    var url = 'wss://localhost/control.ashx';
    if (args.url) {
        url = args.url;
        if (url.length < 5) { console.log("Invalid url."); process.exit(); return; }
        if ((url.startsWith('wss://') == false) && (url.startsWith('ws://') == false)) { console.log("Invalid url."); process.exit(); return; }
        var i = url.indexOf('?key='), loginKey = null;
        if (i >= 0) { loginKey = url.substring(i + 5); url = url.substring(0, i); }
        if (url.endsWith('/') == false) { url += '/'; }
        url += 'control.ashx';
        if (loginKey != null) { url += '?key=' + loginKey; }
    }
    
    // Certificate checking
    if (args.nocertcheck) { options.rejectUnauthorized = false; }

    // Setup the HTTP proxy if needed
    if (args.proxy != null) {
        const HttpsProxyAgent = require('https-proxy-agent');
        options.agent = new HttpsProxyAgent(require('url').parse(args.proxy));
    }
    
    // Authentication setup
    if (args.loginkey != null) { url += '?auth=' + args.loginkey; } // Cookie authentication
    else if (args.loginpass != null) { // Password authentication
        var username = 'admin';
        if (args.loginuser != null) { username = args.loginuser; }
        var token = '';
        if (args.token != null) { token = ',' + Buffer.from('' + args.token).toString('base64'); }
        options.headers = { 'x-meshauth': Buffer.from('' + username).toString('base64') + ',' + Buffer.from('' + args.loginpass).toString('base64') + token }
    }
    
    // Connect to the server
    const ws = new WebSocket(url, options);
    console.log('MeshBot, press CTRl-C to stop.');
    console.log('Connecting to ' + url);
    ws.on('open', function open() {
        //console.log('Connected.');
        switch (settings.cmd) {
            // ws.send(JSON.stringify({ action: 'users', responseid: 'meshctrl' })); // Ask for list of users
            // ws.send(JSON.stringify({ action: 'meshes' })); // Ask for list of device groups
            // ws.send(JSON.stringify({ action: 'nodes', responseid: 'meshctrl' })); // Ask for list of devices
        }
    });
    ws.on('close', function () {
        console.log('Reconnecting in 10 seconds...');
        setTimeout(serverConnect, 10000);
    });
    ws.on('error', function (err) {
        if (err.code == 'ENOTFOUND') { console.log('Unable to resolve ' + url); }
        else if (err.code == 'ECONNREFUSED') { console.log('Unable to connect to ' + url); }
        else { console.log(err); }
    });
    ws.on('message', function incoming(rawdata) {
        var data = null;
        try { data = JSON.parse(rawdata); } catch (ex) { }
        if (data == null) { console.log('Unable to parse data: ' + rawdata); }
        
        //console.log("Got command: " + data.action);

        switch (data.action) {
            case 'serverinfo': { console.log('Connected to server: ' + data.serverinfo.name); break; }
            case 'userinfo': {
                console.log('Connected at user: ' + data.userinfo.name);
                if ((args.targetuser != null) || (args.targetsession != null)) {
                    console.log('Sending interuser message...');
                    ws.send(JSON.stringify({ action: 'interuser', userid: args.targetuser, sessionid: args.targetsession, data: 'Hello!!!' })); // Send a hello message
                }
                break;
            }
            case 'interuser': {
                console.log('Got InterUser Message', data);
                if ((args.targetuser == null) && (args.targetsession == null) && (typeof data.data == 'string')) { // For testing, echo back the original message.
                    console.log('Sending interuser echo...');
                    ws.send(JSON.stringify({ action: 'interuser', sessionid: data.sessionid, data: 'ECHO: ' + data.data }));
                }
                break;
            }
        }
    });
}
