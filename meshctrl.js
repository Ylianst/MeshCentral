#!/usr/bin/env node

/**
* @description MeshCentral command line tool
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
const possibleCommands = ['edituser', 'listusers', 'listusersessions', 'listdevicegroups', 'listdevices', 'listusersofdevicegroup', 'listevents', 'logintokens', 'serverinfo', 'userinfo', 'adduser', 'removeuser', 'adddevicegroup', 'removedevicegroup', 'editdevicegroup', 'broadcast', 'showevents', 'addusertodevicegroup', 'removeuserfromdevicegroup', 'addusertodevice', 'removeuserfromdevice', 'sendinviteemail', 'generateinvitelink', 'config', 'movetodevicegroup', 'deviceinfo', 'removedevice', 'editdevice', 'addusergroup', 'listusergroups', 'removeusergroup', 'runcommand', 'shell', 'upload', 'download', 'deviceopenurl', 'devicemessage', 'devicetoast', 'addtousergroup', 'removefromusergroup', 'removeallusersfromusergroup', 'devicesharing', 'devicepower', 'indexagenterrorlog', 'agentdownload', 'report'];
if (args.proxy != null) { try { require('https-proxy-agent'); } catch (ex) { console.log('Missing module "https-proxy-agent", type "npm install https-proxy-agent" to install it.'); return; } }

if (args['_'].length == 0) {
    console.log("MeshCtrl performs command line actions on a MeshCentral server.");
    console.log("Information at: https://meshcentral.com");
    console.log("No action specified, use MeshCtrl like this:\r\n\r\n  meshctrl [action] [arguments]\r\n");
    console.log("Supported actions:");
    console.log("  Help [action]               - Get help on an action.");
    console.log("  ServerInfo                  - Show server information.");
    console.log("  UserInfo                    - Show user information.");
    console.log("  ListUsers                   - List user accounts.");
    console.log("  ListUserSessions            - List online users.");
    console.log("  ListUserGroups              - List user groups.");
    console.log("  ListDevices                 - List devices.");
    console.log("  ListDeviceGroups            - List device groups.");
    console.log("  ListUsersOfDeviceGroup      - List the users in a device group.");
    console.log("  ListEvents                  - List server events.");
    console.log("  LoginTokens                 - List, create and remove login tokens.");
    console.log("  DeviceInfo                  - Show information about a device.");
    console.log("  EditDevice                  - Make changes to a device.");
    console.log("  RemoveDevice                - Delete a device.");
    console.log("  Config                      - Perform operation on config.json file.");
    console.log("  AddUser                     - Create a new user account.");
    console.log("  EditUser                    - Change a user account.");
    console.log("  RemoveUser                  - Delete a user account.");
    console.log("  AddUserGroup                - Create a new user group.");
    console.log("  RemoveUserGroup             - Delete a user group.");
    console.log("  AddToUserGroup              - Add a user, device or device group to a user group.");
    console.log("  RemoveFromUserGroup         - Remove a user, device or device group from a user group.");
    console.log("  RemoveAllUsersFromUserGroup - Remove all users from a user group.");
    console.log("  AddDeviceGroup              - Create a new device group.");
    console.log("  RemoveDeviceGroup           - Delete a device group.");
    console.log("  EditDeviceGroup             - Change a device group values.");
    console.log("  MoveToDeviceGroup           - Move a device to a different device group.");
    console.log("  AddUserToDeviceGroup        - Add a user to a device group.");
    console.log("  RemoveUserFromDeviceGroup   - Remove a user from a device group.");
    console.log("  AddUserToDevice             - Add a user to a device.");
    console.log("  RemoveUserFromDevice        - Remove a user from a device.");
    console.log("  SendInviteEmail             - Send an agent install invitation email.");
    console.log("  GenerateInviteLink          - Create an invitation link.");
    console.log("  Broadcast                   - Display a message to all online users.");
    console.log("  ShowEvents                  - Display real-time server events in JSON format.");
    console.log("  RunCommand                  - Run a shell command on a remote device.");
    console.log("  Shell                       - Access command shell of a remote device.");
    console.log("  Upload                      - Upload a file to a remote device.");
    console.log("  Download                    - Download a file from a remote device.");
    console.log("  DeviceOpenUrl               - Open a URL on a remote device.");
    console.log("  DeviceMessage               - Open a message box on a remote device.");
    console.log("  DeviceToast                 - Display a toast notification on a remote device.");
    console.log("  DevicePower                 - Perform wake/sleep/reset/off operations on remote devices.");
    console.log("  DeviceSharing               - View, add and remove sharing links for a given device.");
    console.log("  AgentDownload               - Download an agent of a specific type for a device group.");
    console.log("  Report                      - Create and show a CSV report.");
    console.log("\r\nSupported login arguments:");
    console.log("  --url [wss://server]        - Server url, wss://localhost:443 is default.");
    console.log("                              - Use wss://localhost:443?key=xxx if login key is required.");
    console.log("  --loginuser [username]      - Login username, admin is default.");
    console.log("  --loginpass [password]      - Login password.");
    console.log("  --token [number]            - 2nd factor authentication token.");
    console.log("  --loginkey [hex]            - Server login key in hex.");
    console.log("  --loginkeyfile [file]       - File containing server login key in hex.");
    console.log("  --logindomain [domainid]    - Domain id, default is empty, only used with loginkey.");
    console.log("  --proxy [http://proxy:123]  - Specify an HTTP proxy.");
    return;
} else {
    settings.cmd = args['_'][0].toLowerCase();
    if ((possibleCommands.indexOf(settings.cmd) == -1) && (settings.cmd != 'help')) { console.log("Invalid command. Possible commands are: " + possibleCommands.join(', ') + '.'); return; }
    //console.log(settings.cmd);

    var ok = false;
    switch (settings.cmd) {
        case 'config': { performConfigOperations(args); return; }
        case 'indexagenterrorlog': { indexAgentErrorLog(); return; }
        case 'serverinfo': { ok = true; break; }
        case 'userinfo': { ok = true; break; }
        case 'listusers': { ok = true; break; }
        case 'listusersessions': { ok = true; break; }
        case 'listusergroups': { ok = true; break; }
        case 'listdevicegroups': { ok = true; break; }
        case 'listdevices': { ok = true; break; }
        case 'listevents': { ok = true; break; }
        case 'logintokens': { ok = true; break; }
        case 'listusersofdevicegroup':
        case 'deviceinfo':
        case 'removedevice':
        case 'editdevice': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'addusertodevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log(winRemoveSingleQuotes("Device group identifier missing, use --id '[groupid]' or --group [groupname]")); }
            else if (args.userid == null) { console.log("Add user to group missing useid, use --userid [userid]"); }
            else { ok = true; }
            break;
        }
        case 'removeuserfromdevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log(winRemoveSingleQuotes("Device group identifier missing, use --id '[groupid]' or --group [groupname]")); }
            else if (args.userid == null) { console.log("Remove user from group missing useid, use --userid [userid]"); }
            else { ok = true; }
            break;
        }
        case 'addusertodevice': {
            if (args.userid == null) { console.log("Add user to device missing userid, use --userid [userid]"); }
            else if (args.id == null) { console.log(winRemoveSingleQuotes("Add user to device missing device id, use --id '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'removeuserfromdevice': {
            if (args.userid == null) { console.log("Remove user from device missing userid, use --userid [userid]"); }
            else if (args.id == null) { console.log(winRemoveSingleQuotes("Remove user from device missing device id, use --id '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'adddevicegroup': {
            if (args.name == null) { console.log("Message group name, use --name [name]"); }
            else { ok = true; }
            break;
        }
        case 'editdevicegroup':
        case 'removedevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log(winRemoveSingleQuotes("Device group identifier missing, use --id '[groupid]' or --group [groupname]")); }
            else { ok = true; }
            break;
        }
        case 'movetodevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log(winRemoveSingleQuotes("Device group identifier missing, use --id '[groupid]' or --group [groupname]")); }
            else if (args.devid == null) { console.log(winRemoveSingleQuotes("Device identifier missing, use --devid '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'broadcast': {
            if (args.msg == null) { console.log("Message missing, use --msg [message]"); }
            else { ok = true; }
            break;
        }
        case 'showevents': {
            ok = true;
            break;
        }
        case 'adduser': {
            if (args.user == null) { console.log("New account name missing, use --user [name]"); }
            else if ((args.pass == null) && (args.randompass == null)) { console.log("New account password missing, use --pass [password] or --randompass"); }
            else { ok = true; }
            break;
        }
        case 'edituser': {
            if (args.userid == null) { console.log("Edit account user missing, use --userid [id]"); }
            else { ok = true; }
            break;
        }
        case 'removeuser': {
            if (args.userid == null) { console.log("Remove account userid missing, use --userid [id]"); }
            else { ok = true; }
            break;
        }
        case 'addusergroup': {
            if (args.name == null) { console.log("New user group name missing, use --name [name]"); }
            else { ok = true; }
            break;
        }
        case 'removeusergroup': {
            if (args.groupid == null) { console.log(winRemoveSingleQuotes("Remove user group id missing, use --groupid '[id]'")); }
            else { ok = true; }
            break;
        }
        case 'addtousergroup': {
            if (args.groupid == null) { console.log(winRemoveSingleQuotes("Group id missing, use --groupid '[id]'")); }
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing identifier to add, use --id [id]")); }
            else { ok = true; }
            break;
        }
        case 'removefromusergroup': {
            if (args.groupid == null) { console.log(winRemoveSingleQuotes("Group id missing, use --groupid '[id]'")); }
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing identifier to remove, use --id [id]")); }
            else { ok = true; }
            break;
        }
        case 'removeallusersfromusergroup': {
            if (args.groupid == null) { console.log(winRemoveSingleQuotes("Group id missing, use --groupid '[id]'")); }
            else { ok = true; }
            break;
        }
        case 'sendinviteemail': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id '[groupid]' or --group [groupname]"); }
            else if (args.email == null) { console.log("Device email is missing, use --email [email]"); }
            else { ok = true; }
            break;
        }
        case 'generateinvitelink': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id '[groupid]' or --group [groupname]"); }
            else if (args.hours == null) { console.log("Invitation validity period missing, use --hours [hours]"); }
            else { ok = true; }
            break;
        }
        case 'runcommand': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.run == null) { console.log("Missing run, use --run \"command\""); }
            else { ok = true; }
            break;
        }
        case 'shell': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'devicepower': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else { ok = true; }
            break;
        }
        case 'devicesharing': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if ((args.daily != null) && (args.weekly != null)) { console.log(winRemoveSingleQuotes("Can't specify both --daily and --weekly at the same time.")); }
            else { ok = true; }
            break;
        }
        case 'agentdownload': {
            if (args.type == null) { console.log(winRemoveSingleQuotes("Missing device type, use --type [agenttype]")); }
            var at = parseInt(args.type);
            if ((at == null) || isNaN(at) || (at < 1) || (at > 11000)) { console.log(winRemoveSingleQuotes("Invalid agent type, must be a number.")); }
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[meshid]'")); }
            if ((typeof args.id != 'string') || (args.id.length != 64)) { console.log(winRemoveSingleQuotes("Invalid meshid.")); }
            else { ok = true; }
            break;
        }
        case 'upload': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.file == null) { console.log("Local file missing, use --file [file] specify the file to upload"); }
            else if (args.target == null) { console.log("Remote target path missing, use --target [path] to specify the remote location"); }
            else if (require('fs').existsSync(args.file) == false) { console.log("Local file does not exists, check --file"); }
            else { ok = true; }
            break;
        }
        case 'download': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.file == null) { console.log("Remote file missing, use --file [file] specify the remote file to download"); }
            else if (args.target == null) { console.log("Target path missing, use --target [path] to specify the local download location"); }
            else { ok = true; }
            break;
        }
        case 'deviceopenurl': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.openurl == null) { console.log("Remote URL, use --openurl [url] specify the link to open."); }
            else { ok = true; }
            break;
        }
        case 'devicemessage': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.msg == null) { console.log("Remote message, use --msg \"[message]\" specify a remote message."); }
            else { ok = true; }
            break;
        }
        case 'devicetoast': {
            if (args.id == null) { console.log(winRemoveSingleQuotes("Missing device id, use --id '[deviceid]'")); }
            else if (args.msg == null) { console.log("Remote message, use --msg \"[message]\" specify a remote message."); }
            else { ok = true; }
            break;
        }
        case 'report': {
            if (args.type == null) { console.log(winRemoveSingleQuotes("Missing report type, use --type '[reporttype]'")); }
            else { ok = true; }
            break;
        }
        case 'help': {
            if (args['_'].length < 2) {
                console.log("Get help on an action. Type:\r\n\r\n  help [action]\r\n\r\nPossible actions are: " + possibleCommands.join(', ') + '.');
            } else {
                switch (args['_'][1].toLowerCase()) {
                    case 'config': {
                        displayConfigHelp();
                        break;
                    }
                    case 'sendinviteemail': {
                        console.log("Send invitation email with instructions on how to install the mesh agent for a specific device group. Example usage:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl SendInviteEmail --id 'groupid' --message \"msg\" --email user@sample.com"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl SendInviteEmail --group \"My Computers\" --name \"Jack\" --email user@sample.com"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --email [email]        - Email address.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --name (name)          - Name of recipient to be included in the email.");
                        console.log("  --message (msg)        - Message to be included in the email.");
                        break;
                    }
                    case 'generateinvitelink': {
                        console.log("Generate a agent invitation URL for a given group. Example usage:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl GenerateInviteLink --id 'groupid' --hours 24"));
                        console.log("  MeshCtrl GenerateInviteLink --group \"My Computers\" --hours 0");
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --hours [hours]        - Validity period in hours or 0 for infinite.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --flags [mode]         - Mode flag for link type (0 = both, 1 = interactive only, 2 = background only)");
                        break;
                    }
                    case 'showevents': {
                        console.log("Show the server's event stream for this user account. Example usage:\r\n");
                        console.log("  MeshCtrl ShowEvents");
                        console.log("  MeshCtrl ShowEvents --filter nodeconnect");
                        console.log("  MeshCtrl ShowEvents --filter uicustomevent,changenode");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --filter [actions]    - Show only specified actions.");
                        break;
                    }
                    case 'serverinfo': {
                        console.log("Get information on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ServerInfo --loginuser myaccountname --loginpass mypassword");
                        console.log("  MeshCtrl ServerInfo --loginuser myaccountname --loginkeyfile key.txt");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'userinfo': {
                        console.log("Get account information for the login account, Example usages:\r\n");
                        console.log("  MeshCtrl UserInfo --loginuser myaccountname --loginpass mypassword");
                        console.log("  MeshCtrl UserInfo --loginuser myaccountname --loginkeyfile key.txt");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listusers': {
                        console.log("List the account on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ListUsers");
                        console.log("  MeshCtrl ListUsers --json");
                        console.log("  MeshCtrl ListUsers --nameexists \"bob\"");
                        console.log("  MeshCtrl ListUsers --filter 2fa");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --idexists [id]        - Return 1 if id exists, 0 if not.");
                        console.log("  --nameexists [name]    - Return id if name exists.");
                        console.log("  --filter [filter1,...] - Filter user names: 2FA, NO2FA.");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listusersessions': {
                        console.log("List active user sessions on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ListUserSessions");
                        console.log("  MeshCtrl ListUserSessions --json");
                        break;
                    }
                    case 'listusergroups': {
                        console.log("List user groups on the MeshCentral server, Example usages:\r\n");
                        console.log("  MeshCtrl ListUserGroups");
                        console.log("  MeshCtrl ListUserGroups --json");
                        break;
                    }
                    case 'listdevicegroups': {
                        console.log("List the device groups for this account. Example usages:\r\n");
                        console.log("  MeshCtrl ListDeviceGroups ");
                        console.log("  MeshCtrl ListDeviceGroups --json");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --idexists [id]        - Return 1 if id exists, 0 if not.");
                        console.log("  --nameexists [name]    - Return id if name exists.");
                        console.log("  --emailexists [email]  - Return id if email exists.");
                        console.log("  --hex                  - Display meshid in hex format.");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listdevices': {
                        console.log("List devices. Example usages:\r\n");
                        console.log("  MeshCtrl ListDevices");
                        console.log(winRemoveSingleQuotes("  MeshCtrl ListDevices -id '[groupid]' --json"));
                        console.log("\r\nOptional arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Filter by group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Filter by group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Filter by group name (or --id).");
                        console.log("  --count                - Only return the device count.");
                        console.log("  --json                 - Show result as JSON.");
                        console.log("  --csv                  - Show result as comma separated values.");
                        console.log("  --filter \"[filter]\"  - Filter devices using a filter string.");
                        console.log("     \"x\"                  - Devices with \"x\" in the name.");
                        console.log("     \"user:x or u:x\"      - Devices with \"x\" in the name of currently logged in user.");
                        console.log("     \"ip:x\"               - Devices \"x\" IP address.");
                        console.log("     \"group:x or g:x\"     - Devices with \"x\" in device group name.");
                        console.log("     \"tag:x or t:x\"       - Devices with \"x\" in device tag.");
                        console.log("     \"atag:x or a:x\"      - Devices with \"x\" in device agent tag.");
                        console.log("     \"os:x\"               - Devices with \"x\" in the device OS description.");
                        console.log("     \"amt:x\"              - Devices with Intel AMT provisioning state (0, 1, 2).");
                        console.log("     \"desc:x\"             - Devices with \"x\" in device description.");
                        console.log("     \"wsc:ok\"             - Devices with Windows Security Center ok.");
                        console.log("     \"wsc:noav\"           - Devices with Windows Security Center with anti-virus problem.");
                        console.log("     \"wsc:noupdate\"       - Devices with Windows Security Center with update problem.");
                        console.log("     \"wsc:nofirewall\"     - Devices with Windows Security Center with firewall problem.");
                        console.log("     \"wsc:any\"            - Devices with Windows Security Center with any problem.");
                        console.log("     \"a and b\"            - Match both conditions with precedence over OR. For example: \"lab and g:home\".");
                        console.log("     \"a or b\"             - Math one of the conditions, for example: \"lab or g:home\".");
                        console.log("  --filterid [id,id...]  - Show only results for devices with included id.");
                        console.log("  --details              - Show all device details.");
                        break;
                    }
                    case 'listusersofdevicegroup': {
                        console.log("List users that have permissions for a given device group. Example usage:\r\n");
                        console.log("  MeshCtrl ListUserOfDeviceGroup ");
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier.");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listevents': {
                        console.log("List server events optionally filtered by user or device. Example usage:\r\n");
                        console.log("  MeshCtrl ListEvents ");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --userid [name]        - User account identifier.");
                        console.log("  --id [deviceid]        - The device identifier.");
                        console.log("  --limit [number]       - Maximum number of events to list.");
                        console.log("  --raw                  - Output raw data in JSON format.");
                        console.log("  --json                 - Give results in JSON format.");
                        break;
                    }
                    case 'logintokens': {
                        console.log("List account login tokens and allow addition and removal. Example usage:\r\n");
                        console.log("  MeshCtrl LoginTokens ");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --remove [name]        - Remove a login token.");
                        console.log("  --add [name]           - Add a login token.");
                        console.log("  --expire [minutes]     - When adding a token, minutes until expire.");
                        console.log("  --json                 - Show login tokens in JSON format.");
                        break;
                    }
                    case 'adduser': {
                        console.log("Add a new user account. Example usages:\r\n");
                        console.log("  MeshCtrl AddUser --user newaccountname --pass newpassword");
                        console.log("  MeshCtrl AddUser --user newaccountname --randompass --rights full");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --user [name]               - New account name.");
                        console.log("  --pass [password]           - New account password.");
                        console.log("  --randompass                - Create account with a random password.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --domain [domain]           - Account domain, only for cross-domain admins.");
                        console.log("  --email [email]             - New account email address.");
                        console.log("  --emailverified             - New account email is verified.");
                        console.log("  --resetpass                 - Request password reset on next login.");
                        console.log("  --realname [name]           - Set the real name for this account.");
                        console.log("  --phone [number]            - Set the account phone number.");
                        console.log("  --rights [none|full|a,b,c]  - Comma separated list of server permissions. Possible values:");
                        console.log("     manageusers,backup,restore,update,fileaccess,locked,nonewgroups,notools,usergroups,recordings,locksettings,allevents");
                        break;
                    }
                    case 'edituser': {
                        console.log("Edit a user account, Example usages:\r\n");
                        console.log("  MeshCtrl EditUser --userid user --rights locked,locksettings");
                        console.log("  MeshCtrl EditUser --userid user --realname Jones");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --userid [name]             - User account identifier.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --domain [domain]           - Account domain, only for cross-domain admins.");
                        console.log("  --email [email]             - Account email address.");
                        console.log("  --emailverified             - Account email is verified.");
                        console.log("  --resetpass                 - Request password reset on next login.");
                        console.log("  --realname [name]           - Set the real name for this account.");
                        console.log("  --phone [number]            - Set the account phone number.");
                        console.log("  --rights [none|full|a,b,c]  - Comma separated list of server permissions. Possible values:");
                        console.log("     manageusers,backup,restore,update,fileaccess,locked,nonewgroups,notools,usergroups,recordings,locksettings,allevents");
                        break;
                    }
                    case 'removeuser': {
                        console.log("Delete a user account, Example usages:\r\n");
                        console.log("  MeshCtrl RemoveUser --userid accountid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --userid [id]          - Account identifier.");
                        break;
                    }
                    case 'addusergroup': {
                        console.log("Create a new user group, Example usages:\r\n");
                        console.log("  MeshCtrl AddUserGroup --name \"Test Group\"");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --name [name]          - Name of the user group.");
                        break;
                    }
                    case 'removeusergroup': {
                        console.log("Remove a user group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveUserGroup --groupid 'ugrp//abcdf'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --groupid [groupid]   - User group identifier.");
                        } else {
                            console.log("  --groupid '[groupid]' - User group identifier.");
                        }
                        break;
                    }
                    case 'addtousergroup': {
                        console.log("Add a user, device or device group to a user group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddToUserGroup --id 'user//abcdef' --groupid 'ugrp//abcdf'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddToUserGroup --id 'node//abcdef' --groupid 'ugrp//abcdf' --rights [rights]"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddToUserGroup --id 'mesh//abcdef' --groupid 'ugrp//abcdf' --rights [rights]"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [id]             - Identifier to add.");
                            console.log("  --groupid [groupid]   - User group identifier.");
                        } else {
                            console.log("  --id '[id]'           - Identifier to add.");
                            console.log("  --groupid '[groupid]' - User group identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --rights [number]     - Rights granted for adding device or device group.");
                        console.log("                        - 4294967295 for full admin or the sum of the following numbers.");
                        console.log("          1 = Edit Device Group                2 = Manage Users           ");
                        console.log("          4 = Manage Computers                 8 = Remote Control         ");
                        console.log("         16 = Agent Console                   32 = Server Files           ");
                        console.log("         64 = Wake Device                    128 = Set Notes              ");
                        console.log("        256 = Remote View Only               512 = No Terminal            ");
                        console.log("       1024 = No Files                      2048 = No Intel AMT           ");
                        console.log("       4096 = Desktop Limited Input         8192 = Limit Events           ");
                        console.log("      16384 = Chat / Notify                32768 = Uninstall Agent        ");
                        console.log("      65536 = No Remote Desktop           131072 = Remote Commands        ");
                        console.log("     262144 = Reset / Power off      ");
                        break;
                    }
                    case 'removefromusergroup': {
                        console.log("Remove a user, device or device group from a user group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveUserFromUserGroup --userid 'user//abcdef' --groupid 'ugrp//abcdf'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveUserFromUserGroup --userid 'node//abcdef' --groupid 'ugrp//abcdf'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveUserFromUserGroup --userid 'mesh//abcdef' --groupid 'ugrp//abcdf'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [userid]         - Identifier to remove.");
                            console.log("  --groupid [groupid]   - User group identifier.");
                        } else {
                            console.log("  --id '[userid]'       - Identifier to remove.");
                            console.log("  --groupid '[groupid]' - User group identifier.");
                        }
                        break;
                    }
                    case 'removeallusersfromusergroup': {
                        console.log("Remove all users from a user group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveAllUsersFromUserGroup --groupid 'ugrp//abcdf'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --groupid [groupid]   - User group identifier.");
                        } else {
                            console.log("  --groupid '[groupid]' - User group identifier.");
                        }
                        break;
                    }
                    case 'adddevicegroup': {
                        console.log("Add a device group, Example usages:\r\n");
                        console.log("  MeshCtrl AddDeviceGroup --name newgroupname");
                        console.log("  MeshCtrl AddDeviceGroup --name newgroupname --desc description --amtonly");
                        console.log("  MeshCtrl AddDeviceGroup --name newgroupname --features 1 --consent 7");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --name [name]          - Name of the new group.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --desc [description]   - New group description.");
                        console.log("  --amtonly              - New group is agent-less, Intel AMT only.");
                        console.log("  --agentless            - New group is agent-less only.");
                        console.log("  --features [number]    - Set device group features, sum of numbers below.");
                        console.log("     1 = Auto-Remove                 2 = Hostname Sync");
                        console.log("     4 = Record Sessions");
                        console.log("  --consent [number]     - Set device group user consent, sum of numbers below.");
                        console.log("     1 = Desktop notify user         2 = Terminal notify user   ");
                        console.log("     4 = Files notify user           8 = Desktop prompt user    ");
                        console.log("    16 = Terminal prompt user       32 = Files prompt user      ");
                        console.log("    64 = Desktop Toolbar        ");
                        break;
                    }
                    case 'removedevicegroup': {
                        console.log("Remove a device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveDeviceGroup --id 'groupid'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        break;
                    }
                    case 'editdevicegroup': {
                        console.log("Edit a device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl EditDeviceGroup --id 'groupid' --name \"New Name\""));
                        console.log(winRemoveSingleQuotes("  MeshCtrl EditDeviceGroup --id 'groupid' --desc \"Description\" --consent 63"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl EditDeviceGroup --id 'groupid' --invitecodes \"code1,code2\" --backgroundonly"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --name [name]          - Set new device group name.");
                        console.log("  --desc [description]   - Set new device group description, blank to clear.");
                        console.log("  --flags [number]       - Set device group flags, sum of the values below, 0 for none.");
                        console.log("     1 = Auto remove device on disconnect.");
                        console.log("     2 = Sync hostname.");
                        console.log("  --consent [number]     - Set device group consent options, sum of the values below, 0 for none.");
                        console.log("     1 = Desktop notify user.");
                        console.log("     2 = Terminal notify user.");
                        console.log("     4 = Files notify user.");
                        console.log("     8 = Desktop prompt for user consent.");
                        console.log("    16 = Terminal prompt for user consent.");
                        console.log("    32 = Files prompt for user consent.");
                        console.log("    64 = Desktop show connection toolbar.");
                        console.log("  --invitecodes [aa,bb]  - Comma separated list of invite codes, blank to clear.");
                        console.log("    --backgroundonly     - When used with invitecodes, set agent to only install in background.");
                        console.log("    --interactiveonly    - When used with invitecodes, set agent to only run on demand.");
                        break;
                    }
                    case 'movetodevicegroup': {
                        console.log("Move a device to a new device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl MoveToDeviceGroup --devid 'deviceid' --id 'groupid'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        if (process.platform == 'win32') {
                            console.log("  --devid [deviceid]     - Device identifier.");
                        } else {
                            console.log("  --devid '[deviceid]'   - Device identifier.");
                        }
                        break;
                    }
                    case 'addusertodevicegroup': {
                        console.log("Add a user to a device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddUserToDeviceGroup --id 'groupid' --userid userid --fullrights"));
                        console.log("  MeshCtrl AddUserToDeviceGroup --group groupname --userid userid --editgroup --manageusers");
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --userid [userid]      - The user identifier.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --fullrights           - Allow full rights over this device group.");
                        console.log("  --editgroup            - Allow the user to edit group information.");
                        console.log("  --manageusers          - Allow the user to add/remove users.");
                        console.log("  --managedevices        - Allow the user to edit device information.");
                        console.log("  --remotecontrol        - Allow device remote control operations.");
                        console.log("  --agentconsole         - Allow agent console operations.");
                        console.log("  --serverfiles          - Allow access to group server files.");
                        console.log("  --wakedevices          - Allow device wake operation.");
                        console.log("  --notes                - Allow editing of device notes.");
                        console.log("  --desktopviewonly      - Restrict user to view-only remote desktop.");
                        console.log("  --limiteddesktop       - Limit remote desktop keys.");
                        console.log("  --noterminal           - Hide the terminal tab from this user.");
                        console.log("  --nofiles              - Hide the files tab from this user.");
                        console.log("  --noamt                - Hide the Intel AMT tab from this user.");
                        console.log("  --limitedevents        - User can only see his own events.");
                        console.log("  --chatnotify           - Allow chat and notification options.");
                        console.log("  --uninstall            - Allow remote uninstall of the agent.");
                        if (args.limiteddesktop) { meshrights |= 4096; }
                        if (args.limitedevents) { meshrights |= 8192; }
                        if (args.chatnotify) { meshrights |= 16384; }
                        if (args.uninstall) { meshrights |= 32768; }

                        break;
                    }
                    case 'removeuserfromdevicegroup': {
                        console.log("Remove a user from a device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveuserFromDeviceGroup --id 'groupid' --userid userid"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]         - Device group identifier (or --group).");
                        } else {
                            console.log("  --id '[groupid]'       - Device group identifier (or --group).");
                        }
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --userid [userid]      - The user identifier.");
                        break;
                    }
                    case 'addusertodevice': {
                        console.log("Add a user to a device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddUserToDevice --id 'deviceid' --userid userid --fullrights"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl AddUserToDevice --id 'deviceid' --userid userid --remotecontrol"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --userid [userid]      - The user identifier.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --fullrights           - Allow full rights over this device.");
                        console.log("  --remotecontrol        - Allow device remote control operations.");
                        console.log("  --agentconsole         - Allow agent console operations.");
                        console.log("  --serverfiles          - Allow access to group server files.");
                        console.log("  --wakedevices          - Allow device wake operation.");
                        console.log("  --notes                - Allow editing of device notes.");
                        console.log("  --desktopviewonly      - Restrict user to view-only remote desktop.");
                        console.log("  --limiteddesktop       - Limit remote desktop keys.");
                        console.log("  --noterminal           - Hide the terminal tab from this user.");
                        console.log("  --nofiles              - Hide the files tab from this user.");
                        console.log("  --noamt                - Hide the Intel AMT tab from this user.");
                        console.log("  --limitedevents        - User can only see his own events.");
                        console.log("  --chatnotify           - Allow chat and notification options.");
                        console.log("  --uninstall            - Allow remote uninstall of the agent.");
                        break;
                    }
                    case 'removeuserfromdevice': {
                        console.log("Remove a user from a device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveuserFromDeviceGroup --id 'deviceid' --userid userid"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --userid [userid]      - The user identifier.");
                        break;
                    }
                    case 'broadcast': {
                        console.log("Display a message to one or all logged in users, Example usages:\r\n");
                        console.log("  MeshCtrl Broadcast --msg \"This is a test\"");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --msg [message]        - Message to display.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --user [userid]        - Send the message to the specified user.");
                        break;
                    }
                    case 'deviceinfo': {
                        console.log("Display information about a device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceInfo --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceInfo --id 'deviceid' --json"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --raw                  - Output raw data in JSON format.");
                        console.log("  --json                 - Give results in JSON format.");
                        break;
                    }
                    case 'removedevice': {
                        console.log("Delete a device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RemoveDevice --id 'deviceid'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        break;
                    }
                    case 'editdevice': {
                        console.log("Change information about a device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl EditDevice --id 'deviceid' --name 'device1'"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --name [name]          - Change device name.");
                            console.log("  --desc [description]   - Change device description.");
                            console.log("  --tags [tag1,tags2]    - Change device tags.");
                        } else {
                            console.log("  --name '[name]'        - Change device name.");
                            console.log("  --desc '[description]' - Change device description.");
                            console.log("  --tags '[tag1,tags2]'  - Change device tags.");
                        }
                        console.log("  --icon [number]        - Change the device icon (1 to 8).");
                        console.log("  --consent [flags]      - Sum of the following numbers:");
                        console.log("      1 = Desktop notify          2 = Terminal notify");
                        console.log("      4 = Files notify            8 = Desktop prompt");
                        console.log("     16 = Terminal prompt        32 = Files prompt");
                        console.log("     64 = Desktop privacy bar");
                        break;
                    }
                    case 'runcommand': {
                        console.log("Run a shell command on a remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl RunCommand --id 'deviceid' --run \"command\""));
                        console.log(winRemoveSingleQuotes("  MeshCtrl RunCommand --id 'deviceid' --run \"command\" --powershell"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --run \"[command]\"    - Shell command to execute on the remote device.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --powershell           - Run in Windows PowerShell.");
                        console.log("  --runasuser            - Attempt to run the command as logged in user.");
                        console.log("  --runasuseronly        - Only run the command as the logged in user.");
                        break;
                    }
                    case 'shell': {
                        console.log("Access a command shell on a remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl Shell --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl Shell --id 'deviceid' --powershell"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --powershell           - Run a Windows PowerShell.");
                        break;
                    }
                    case 'devicepower': {
                        console.log("Perform power operations on remote devices, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DevicePower --wake --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DevicePower --sleep --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DevicePower --reset --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DevicePower --off --id 'deviceid1,deviceid2'"));
                        console.log("\r\nNote that some power operations may take up to a minute to execute.\r\n");
                        console.log("Required arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid1,deviceid2]    - Device identifiers.");
                        } else {
                            console.log("  --id '[deviceid1,deviceid2]'  - Device identifiers.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --wake                        - Attempt to wake up the remote device.");
                        console.log("  --reset                       - Attempt to remote the remote device.");
                        console.log("  --sleep                       - Attempt to place the remote device in low power mode.");
                        console.log("  --off                         - Attempt to power off the remote device.");
                        console.log("  --amtoff                      - Attempt to power off the remote device using Intel AMT.");
                        console.log("  --amton                       - Attempt to power on the remote device using Intel AMT.");
                        console.log("  --amtreset                    - Attempt to reset the remote device using Intel AMT.");
                        break;
                    }
                    case 'devicesharing': {
                        var tzoffset = (new Date()).getTimezoneOffset() * 60000; // Offset in milliseconds
                        var localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -5);
                        console.log("List sharing links for a specified device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceSharing --id 'deviceid'"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceSharing --id 'deviceid' --remove abcdef"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceSharing --id 'deviceid' --add Guest --start " + localISOTime + " --duration 30"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceSharing --id 'deviceid' --add Guest --start " + localISOTime + " --duration 30 --daily"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceSharing --id 'deviceid' --add Guest --type desktop,terminal --consent prompt"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]                - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'              - The device identifier.");
                        }
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --remove [shareid]              - Remove a device sharing link.");
                        console.log("  --add [guestname]               - Add a device sharing link.");
                        console.log("  --type [desktop,terminal,files] - Type of sharing to add, can be combined. default is desktop.");
                        console.log("  --viewonly                      - Make desktop sharing view only.");
                        console.log("  --consent [notify,prompt]       - Consent flags, default is notify.");
                        console.log("  --start [yyyy-mm-ddThh:mm:ss]   - Start time, default is now.");
                        console.log("  --end [yyyy-mm-ddThh:mm:ss]     - End time.");
                        console.log("  --duration [minutes]            - Duration of the share, default is 60 minutes.");
                        console.log("  --daily                         - Add recurring daily device share.");
                        console.log("  --weekly                        - Add recurring weekly device share.");
                        break;
                    }
                    case 'agentdownload': {
                        console.log("Download an agent of a specific type for a given device group, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl AgentDownload --id 'groupid' --type 3"));
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --type [ArchitectureNumber]   - Agent architecture number.");
                        if (process.platform == 'win32') {
                            console.log("  --id [groupid]                - The device group identifier.");
                        } else {
                            console.log("  --id '[groupid]'              - The device group identifier.");
                        }
                        break;
                    }
                    case 'upload': {
                        console.log("Upload a local file to a remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl Upload --id 'deviceid' --file sample.txt --target c:\\"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl Upload --id 'deviceid' --file sample.txt --target /tmp"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --file [localfile]     - The local file to upload.");
                        console.log("  --target [remotepath]  - The remote path to upload the file to.");
                        break;
                    }
                    case 'download': {
                        console.log("Download a file from a remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl Download --id 'deviceid' --file C:\\sample.txt --target c:\\temp"));
                        console.log(winRemoveSingleQuotes("  MeshCtrl Download --id 'deviceid' --file /tmp/sample.txt --target /tmp"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --file [remotefile]    - The remote file to download.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --target [localpath]   - The local path to download the file to.");
                        break;
                    }
                    case 'deviceopenurl': {
                        console.log("Open a web page on a remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceOpenUrl --id 'deviceid' --openurl http://meshcentral.com"));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --openurl [url]        - Link to the web page.");
                        break;
                    }
                    case 'devicemessage': {
                        console.log("Display a message on the remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceMessage --id 'deviceid' --msg \"message\""));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceMessage --id 'deviceid' --msg \"message\" --title \"title\""));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --msg [message]        - The message to display.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --title [title]        - Messagebox title, default is \"MeshCentral\".");
                        break;
                    }
                    case 'devicetoast': {
                        console.log("Display a toast message on the remote device, Example usages:\r\n");
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceToast --id 'deviceid' --msg \"message\""));
                        console.log(winRemoveSingleQuotes("  MeshCtrl DeviceToast --id 'deviceid' --msg \"message\" --title \"title\""));
                        console.log("\r\nRequired arguments:\r\n");
                        if (process.platform == 'win32') {
                            console.log("  --id [deviceid]        - The device identifier.");
                        } else {
                            console.log("  --id '[deviceid]'      - The device identifier.");
                        }
                        console.log("  --msg [message]        - The message to display.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --title [title]        - Toast title, default is \"MeshCentral\".");
                        break;
                    }
                    case 'report': {
                        console.log("Generate a CSV report, Example usages:\r\n");
                        console.log("  MeshCtrl Report --type sessions --devicegroup mesh//...");
                        console.log("  MeshCtrl Report --type traffic --json");
                        console.log("  MeshCtrl Report --type logins --groupby day");
                        console.log("  MeshCtrl Report --type db");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --start [yyyy-mm-ddThh:mm:ss] - Filter the results starting at that date. Defaults to last 24h and last week when used with --groupby day. Usable with sessions, traffic and logins");
                        console.log("  --end [yyyy-mm-ddThh:mm:ss]   - Filter the results ending at that date. Defaults to now. Usable with sessions, traffic and logins");
                        console.log("  --groupby [name]              - How to group results. Options: user, day, device. Defaults to user. User and day usable in sessions and logins, device usable in sessions.");
                        console.log("  --devicegroup [devicegroupid] - Filter the results by device group. Usable in sessions");
                        console.log("  --showtraffic                 - Add traffic data in sessions report");
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

function displayConfigHelp() {
    console.log("Perform operations on the config.json file. Example usage:\r\n");
    console.log("  MeshCtrl config --show");
    console.log("\r\nOptional arguments:\r\n");
    console.log("  --show                        - Display the config.json file.");
    console.log("  --listdomains                 - Display non-default domains.");
    console.log("  --adddomain [domain]          - Add a domain.");
    console.log("  --removedomain [domain]       - Remove a domain.");
    console.log("  --settodomain [domain]        - Set values to the domain.");
    console.log("  --removefromdomain [domain]   - Remove values from the domain.");
    console.log("\r\nWith adddomain, removedomain, settodomain and removefromdomain you can add the key and value pair. For example:\r\n");
    console.log("  --adddomain \"MyDomain\" --title \"My Server Name\" --newAccounts false");
    console.log("  --settodomain \"MyDomain\" --title \"My Server Name\"");
    console.log("  --removefromdomain \"MyDomain\" --title");
}

function performConfigOperations(args) {
    var domainValues = ['title', 'title2', 'titlepicture', 'trustedcert', 'welcomepicture', 'welcometext', 'userquota', 'meshquota', 'newaccounts', 'usernameisemail', 'newaccountemaildomains', 'newaccountspass', 'newaccountsrights', 'geolocation', 'lockagentdownload', 'userconsentflags', 'Usersessionidletimeout', 'auth', 'ldapoptions', 'ldapusername', 'ldapuserbinarykey', 'ldapuseremail', 'footer', 'certurl', 'loginKey', 'userallowedip', 'agentallowedip', 'agentnoproxy', 'agentconfig', 'orphanagentuser', 'httpheaders', 'yubikey', 'passwordrequirements', 'limits', 'amtacmactivation', 'redirects', 'sessionrecording', 'hide'];
    var domainObjectValues = ['ldapoptions', 'httpheaders', 'yubikey', 'passwordrequirements', 'limits', 'amtacmactivation', 'redirects', 'sessionrecording'];
    var domainArrayValues = ['newaccountemaildomains', 'newaccountsrights', 'loginkey', 'agentconfig'];
    var configChange = false;
    var fs = require('fs');
    var path = require('path');
    var configFile = 'config.json';
    var didSomething = 0;
    if (fs.existsSync(configFile) == false) { configFile = path.join('meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, 'meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, '..', 'meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, '..', '..', 'meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { console.log("Unable to find config.json."); return; }
    var config = null;
    try { config = fs.readFileSync(configFile).toString('utf8'); } catch (ex) { console.log("Error: Unable to read config.json"); return; }
    try { config = require(configFile); } catch (e) { console.log('ERROR: Unable to parse ' + configFilePath + '.'); return null; }
    if (args.adddomain != null) {
        didSomething++;
        if (config.domains == null) { config.domains = {}; }
        if (config.domains[args.adddomain] != null) { console.log("Error: Domain \"" + args.adddomain + "\" already exists"); }
        else {
            configChange = true;
            config.domains[args.adddomain] = {};
            for (var i in args) {
                if (domainValues.indexOf(i.toLowerCase()) >= 0) {
                    if (args[i] == 'true') { args[i] = true; } else if (args[i] == 'false') { args[i] = false; } else if (parseInt(args[i]) == args[i]) { args[i] = parseInt(args[i]); }
                    config.domains[args.adddomain][i] = args[i];
                    configChange = true;
                }
            }
        }
    }
    if (args.removedomain != null) {
        didSomething++;
        if (config.domains == null) { config.domains = {}; }
        if (config.domains[args.removedomain] == null) { console.log("Error: Domain \"" + args.removedomain + "\" does not exist"); }
        else { delete config.domains[args.removedomain]; configChange = true; }
    }
    if (args.settodomain != null) {
        didSomething++;
        if (config.domains == null) { config.domains = {}; }
        if (args.settodomain == true) { args.settodomain = ''; }
        if (config.domains[args.settodomain] == null) { console.log("Error: Domain \"" + args.settodomain + "\" does not exist"); }
        else {
            for (var i in args) {
                if ((i == '_') || (i == 'settodomain')) continue;
                if (domainValues.indexOf(i.toLowerCase()) >= 0) {
                    var isObj = (domainObjectValues.indexOf(i.toLowerCase()) >= 0);
                    var isArr = (domainArrayValues.indexOf(i.toLowerCase()) >= 0);
                    if ((isObj == false) && (isArr == false)) {
                        // Simple value set
                        if (args[i] == '') { delete config.domains[args.settodomain][i]; configChange = true; } else {
                            if (args[i] == 'true') { args[i] = true; } else if (args[i] == 'false') { args[i] = false; } else if (parseInt(args[i]) == args[i]) { args[i] = parseInt(args[i]); }
                            config.domains[args.settodomain][i] = args[i];
                            configChange = true;
                        }
                    } else if (isObj || isArr) {
                        // Set an object/array value
                        if (args[i] == '') { delete config.domains[args.settodomain][i]; configChange = true; } else {
                            var x = null;
                            try { x = JSON.parse(args[i]); } catch (ex) { }
                            if ((x == null) || (typeof x != 'object')) { console.log("Unable to parse JSON for " + i + "."); } else {
                                if (isArr && Array.isArray(x) == false) {
                                    console.log("Value " + i + " must be an array.");
                                } else if (!isArr && Array.isArray(x) == true) {
                                    console.log("Value " + i + " must be an object.");
                                } else {
                                    config.domains[args.settodomain][i] = x;
                                    configChange = true;
                                }
                            }
                        }
                    }
                } else {
                    console.log('Invalid configuration value: ' + i);
                }
            }
        }
    }
    if (args.removefromdomain != null) {
        didSomething++;
        if (config.domains == null) { config.domains = {}; }
        if (config.domains[args.removefromdomain] == null) { console.log("Error: Domain \"" + args.removefromdomain + "\" does not exist"); }
        else { for (var i in args) { if (domainValues.indexOf(i.toLowerCase()) >= 0) { delete config.domains[args.removefromdomain][i]; configChange = true; } } }
    }
    if (configChange) {
        try { fs.writeFileSync(configFile, JSON.stringify(config, null, 2)); } catch (ex) { console.log("Error: Unable to read config.json"); return; }
    }
    if (args.show == 1) {
        console.log(JSON.stringify(config, null, 2)); return;
    } else if (args.listdomains == 1) {
        if (config.domains == null) {
            console.log('No domains found.'); return;
        } else {
            // Show the list of active domains, skip the default one.
            for (var i in config.domains) { if ((i != '') && (i[0] != '_')) { console.log(i); } } return;
        }
    } else {
        if (didSomething == 0) {
            displayConfigHelp();
        } else {
            console.log("Done.");
        }
    }
}

function onVerifyServer(clientName, certs) { return null; }

function serverConnect() {
    const WebSocket = require('ws');

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

    // TODO: checkServerIdentity does not work???
    var options = { rejectUnauthorized: false, checkServerIdentity: onVerifyServer }

    // Setup the HTTP proxy if needed
    if (args.proxy != null) {
        const HttpsProxyAgent = require('https-proxy-agent');
        options.agent = new HttpsProxyAgent(require('url').parse(args.proxy));
    }

    // Password authentication
    if (args.loginpass != null) {
        var username = 'admin';
        if (args.loginuser != null) { username = args.loginuser; }
        var token = '';
        if (args.token != null) { token = ',' + Buffer.from('' + args.token).toString('base64'); }
        options.headers = { 'x-meshauth': Buffer.from('' + username).toString('base64') + ',' + Buffer.from('' + args.loginpass).toString('base64') + token }
    }

    // Cookie authentication
    var ckey = null, loginCookie = null;
    if (args.loginkey != null) {
        // User key passed in as argument hex
        if (args.loginkey.length != 160) { loginCookie = args.loginkey; }
        ckey = Buffer.from(args.loginkey, 'hex');
        if (ckey.length != 80) { ckey = null; loginCookie = args.loginkey; }
    } else if (args.loginkeyfile != null) {
        // Load key from hex file
        var fs = require('fs');
        try {
            var keydata = fs.readFileSync(args.loginkeyfile, 'utf8').split(' ').join('').split('\r').join('').split('\n').join('');
            ckey = Buffer.from(keydata, 'hex');
            if (ckey.length != 80) { ckey = null; loginCookie = args.loginkey; }
        } catch (ex) { console.log(ex.message); process.exit(); return; }
    }

    settings.xxurl = url;
    if (ckey != null) {
        var domainid = '', username = 'admin';
        if (args.logindomain != null) { domainid = args.logindomain; }
        if (args.loginuser != null) { username = args.loginuser; }
        url += '?auth=' + encodeCookie({ userid: 'user/' + domainid + '/' + username, domainid: domainid }, ckey);
    } else {
        if (args.logindomain != null) { console.log("--logindomain can only be used along with --loginkey."); process.exit(); return; }
        if (loginCookie != null) { url += '?auth=' + loginCookie; }
    }

    const ws = new WebSocket(url, options);
    //console.log('Connecting to ' + url);

    ws.on('open', function open() {
        //console.log('Connected.');
        switch (settings.cmd) {
            case 'serverinfo': { break; }
            case 'userinfo': { break; }
            case 'listusers': { ws.send(JSON.stringify({ action: 'users', responseid: 'meshctrl' })); break; }
            case 'listusersessions': { ws.send(JSON.stringify({ action: 'wssessioncount', responseid: 'meshctrl' })); break; }
            case 'removeallusersfromusergroup':
            case 'listusergroups': { ws.send(JSON.stringify({ action: 'usergroups', responseid: 'meshctrl' })); break; }
            case 'listdevicegroups': { ws.send(JSON.stringify({ action: 'meshes', responseid: 'meshctrl' })); break; }
            case 'listusersofdevicegroup': { ws.send(JSON.stringify({ action: 'meshes', responseid: 'meshctrl' })); break; }
            case 'listdevices': {
                if (args.details) {
                    // Get list of devices with lots of details
                    ws.send(JSON.stringify({ action: 'getDeviceDetails', type: (args.csv) ? 'csv' : 'json' }));
                } else if (args.group) {
                    ws.send(JSON.stringify({ action: 'nodes', meshname: args.group, responseid: 'meshctrl' }));
                } else if (args.id) {
                    ws.send(JSON.stringify({ action: 'nodes', meshid: args.id, responseid: 'meshctrl' }));
                } else {
                    ws.send(JSON.stringify({ action: 'meshes' }));
                    ws.send(JSON.stringify({ action: 'nodes', responseid: 'meshctrl' }));
                }
                break;
            }
            case 'listevents': {
                limit = null;
                if (args.limit) { limit = parseInt(args.limit); }
                if ((typeof limit != 'number') || (limit < 1)) { limit = null; }

                var cmd = null;
                if (args.userid) {
                    cmd = { action: 'events', user: args.userid, responseid: 'meshctrl' };
                } else if (args.id) {
                    cmd = { action: 'events', nodeid: args.id, responseid: 'meshctrl' };
                } else {
                    cmd = { action: 'events', responseid: 'meshctrl' };
                }
                if (typeof limit == 'number') { cmd.limit = limit; }
                ws.send(JSON.stringify(cmd));
                break;
            }
            case 'logintokens': {
                if (args.add) {
                    var cmd = { action: 'createLoginToken', name: args.add, expire: 0, responseid: 'meshctrl' };
                    if (args.expire) { cmd.expire = parseInt(args.expire); }
                    ws.send(JSON.stringify(cmd));
                } else {
                    var cmd = { action: 'loginTokens', responseid: 'meshctrl' };
                    if (args.remove) { cmd.remove = [args.remove]; }
                    ws.send(JSON.stringify(cmd));
                }
                break;
            }
            case 'adduser': {
                var siteadmin = getSiteAdminRights(args);
                if (args.randompass) { args.pass = getRandomAmtPassword(); }
                var op = { action: 'adduser', username: args.user, pass: args.pass, responseid: 'meshctrl' };
                if (args.email) { op.email = args.email; if (args.emailverified) { op.emailVerified = true; } }
                if (args.resetpass) { op.resetNextLogin = true; }
                if (siteadmin != -1) { op.siteadmin = siteadmin; }
                if (args.domain) { op.domain = args.domain; }
                if (args.phone === true) { op.phone = ''; }
                if (typeof args.phone == 'string') { op.phone = args.phone; }
                if (typeof args.realname == 'string') { op.realname = args.realname; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'edituser': {
                var userid = args.userid;
                if ((args.domain != null) && (userid.indexOf('/') < 0)) { userid = 'user/' + args.domain + '/' + userid; }
                var siteadmin = getSiteAdminRights(args);
                var op = { action: 'edituser', userid: userid, responseid: 'meshctrl' };
                if (args.email) { op.email = args.email; if (args.emailverified) { op.emailVerified = true; } }
                if (args.resetpass) { op.resetNextLogin = true; }
                if (siteadmin != -1) { op.siteadmin = siteadmin; }
                if (args.domain) { op.domain = args.domain; }
                if (args.phone === true) { op.phone = ''; }
                if (typeof args.phone == 'string') { op.phone = args.phone; }
                if (typeof args.realname == 'string') { op.realname = args.realname; }
                if (args.realname === true) { op.realname = ''; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeuser': {
                var userid = args.userid;
                if ((args.domain != null) && (userid.indexOf('/') < 0)) { userid = 'user/' + args.domain + '/' + userid; }
                ws.send(JSON.stringify({ action: 'deleteuser', userid: userid, responseid: 'meshctrl' }));
                break;
            }
            case 'addusergroup': {
                var op = { action: 'createusergroup', name: args.name, desc: args.desc, responseid: 'meshctrl' };
                if (args.domain) { op.domain = args.domain; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeusergroup': {
                var ugrpid = args.groupid;
                if ((args.domain != null) && (userid.indexOf('/') < 0)) { ugrpid = 'ugrp/' + args.domain + '/' + ugrpid; }
                ws.send(JSON.stringify({ action: 'deleteusergroup', ugrpid: ugrpid, responseid: 'meshctrl' }));
                break;
            }
            case 'addtousergroup': {
                var ugrpid = args.groupid;
                if ((args.domain != null) && (userid.indexOf('/') < 0)) { ugrpid = 'ugrp/' + args.domain + '/' + ugrpid; }

                // Add a user to a user group
                if (args.userid != null) {
                    var userid = args.userid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { userid = 'user/' + args.domain + '/' + userid; }
                    ws.send(JSON.stringify({ action: 'addusertousergroup', ugrpid: ugrpid, usernames: [userid.split('/')[2]], responseid: 'meshctrl' }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('user/'))) {
                    ws.send(JSON.stringify({ action: 'addusertousergroup', ugrpid: ugrpid, usernames: [args.id.split('/')[2]], responseid: 'meshctrl' }));
                    break;
                }

                var rights = 0;
                if (args.rights != null) { rights = parseInt(args.rights); }

                // Add a device group to a user group
                if (args.meshid != null) {
                    var meshid = args.meshid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { meshid = 'mesh/' + args.domain + '/' + meshid; }
                    ws.send(JSON.stringify({ action: 'addmeshuser', meshid: meshid, userid: ugrpid, meshadmin: rights, responseid: 'meshctrl' }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('mesh/'))) {
                    ws.send(JSON.stringify({ action: 'addmeshuser', meshid: args.id, userid: ugrpid, meshadmin: rights, responseid: 'meshctrl' }));
                    break;
                }

                // Add a device to a user group
                if (args.nodeid != null) {
                    var nodeid = args.nodeid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { nodeid = 'node/' + args.domain + '/' + nodeid; }
                    ws.send(JSON.stringify({ action: 'adddeviceuser', nodeid: nodeid, userids: [ugrpid], rights: rights, responseid: 'meshctrl' }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('node/'))) {
                    ws.send(JSON.stringify({ action: 'adddeviceuser', nodeid: args.id, userids: [ugrpid], rights: rights, responseid: 'meshctrl' }));
                    break;
                }

                break;
            }
            case 'removefromusergroup': {
                var ugrpid = args.groupid;
                if ((args.domain != null) && (userid.indexOf('/') < 0)) { ugrpid = 'ugrp/' + args.domain + '/' + ugrpid; }

                // Remove a user from a user group
                if (args.userid != null) {
                    var userid = args.userid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { userid = 'user/' + args.domain + '/' + userid; }
                    ws.send(JSON.stringify({ action: 'removeuserfromusergroup', ugrpid: ugrpid, userid: userid, responseid: 'meshctrl' }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('user/'))) {
                    ws.send(JSON.stringify({ action: 'removeuserfromusergroup', ugrpid: ugrpid, userid: args.id, responseid: 'meshctrl' }));
                    break;
                }

                // Remove a device group from a user group
                if (args.meshid != null) {
                    var meshid = args.meshid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { meshid = 'mesh/' + args.domain + '/' + meshid; }
                    ws.send(JSON.stringify({ action: 'removemeshuser', meshid: meshid, userid: ugrpid, responseid: 'meshctrl' }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('mesh/'))) {
                    ws.send(JSON.stringify({ action: 'removemeshuser', meshid: args.id, userid: ugrpid, responseid: 'meshctrl' }));
                    break;
                }

                // Remove a device from a user group
                if (args.nodeid != null) {
                    var nodeid = args.nodeid;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { nodeid = 'node/' + args.domain + '/' + nodeid; }
                    ws.send(JSON.stringify({ action: 'adddeviceuser', nodeid: nodeid, userids: [ugrpid], rights: 0, responseid: 'meshctrl', remove: true }));
                    break;
                }

                if ((args.id != null) && (args.id.startsWith('node/'))) {
                    ws.send(JSON.stringify({ action: 'adddeviceuser', nodeid: args.id, userids: [ugrpid], rights: 0, responseid: 'meshctrl', remove: true }));
                    break;
                }

                break;
            }
            case 'adddevicegroup': {
                var op = { action: 'createmesh', meshname: args.name, meshtype: 2, responseid: 'meshctrl' };
                if (args.desc) { op.desc = args.desc; }
                if (args.amtonly) { op.meshtype = 1; }
                if (args.agentless) { op.meshtype = 3; }
                if (args.features) { op.flags = parseInt(args.features); }
                if (args.consent) { op.consent = parseInt(args.consent); }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removedevicegroup': {
                var op = { action: 'deletemesh', responseid: 'meshctrl' };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'editdevicegroup': {
                var op = { action: 'editmesh', responseid: 'meshctrl' };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshidname = args.group; }
                if ((typeof args.name == 'string') && (args.name != '')) { op.meshname = args.name; }
                if (args.desc === true) { op.desc = ""; } else if (typeof args.desc == 'string') { op.desc = args.desc; }
                if (args.invitecodes === true) { op.invite = "*"; } else if (typeof args.invitecodes == 'string') {
                    var invitecodes = args.invitecodes.split(','), invitecodes2 = [];
                    for (var i in invitecodes) { if (invitecodes[i].length > 0) { invitecodes2.push(invitecodes[i]); } }
                    if (invitecodes2.length > 0) {
                        op.invite = { codes: invitecodes2, flags: 0 };
                        if (args.backgroundonly === true) { op.invite.flags = 2; }
                        else if (args.interactiveonly === true) { op.invite.flags = 1; }
                    }
                }
                if (args.flags != null) {
                    var flags = parseInt(args.flags);
                    if (typeof flags == 'number') { op.flags = flags; }
                }
                if (args.consent != null) {
                    var consent = parseInt(args.consent);
                    if (typeof consent == 'number') { op.consent = consent; }
                }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'movetodevicegroup': {
                var op = { action: 'changeDeviceMesh', responseid: 'meshctrl', nodeids: [args.devid] };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'addusertodevicegroup': {
                var meshrights = 0;
                if (args.fullrights) { meshrights = 0xFFFFFFFF; }
                if (args.editgroup) { meshrights |= 1; }
                if (args.manageusers) { meshrights |= 2; }
                if (args.managedevices) { meshrights |= 4; }
                if (args.remotecontrol) { meshrights |= 8; }
                if (args.agentconsole) { meshrights |= 16; }
                if (args.serverfiles) { meshrights |= 32; }
                if (args.wakedevices) { meshrights |= 64; }
                if (args.notes) { meshrights |= 128; }
                if (args.desktopviewonly) { meshrights |= 256; }
                if (args.noterminal) { meshrights |= 512; }
                if (args.nofiles) { meshrights |= 1024; }
                if (args.noamt) { meshrights |= 2048; }
                if (args.limiteddesktop) { meshrights |= 4096; }
                if (args.limitedevents) { meshrights |= 8192; }
                if (args.chatnotify) { meshrights |= 16384; }
                if (args.uninstall) { meshrights |= 32768; }
                var op = { action: 'addmeshuser', usernames: [args.userid], meshadmin: meshrights, responseid: 'meshctrl' };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeuserfromdevicegroup': {
                var op = { action: 'removemeshuser', userid: args.userid, responseid: 'meshctrl' };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'addusertodevice': {
                var meshrights = 0;
                if (args.fullrights) { meshrights = (8 + 16 + 32 + 64 + 128 + 16384 + 32768); }
                if (args.remotecontrol) { meshrights |= 8; }
                if (args.agentconsole) { meshrights |= 16; }
                if (args.serverfiles) { meshrights |= 32; }
                if (args.wakedevices) { meshrights |= 64; }
                if (args.notes) { meshrights |= 128; }
                if (args.desktopviewonly) { meshrights |= 256; }
                if (args.noterminal) { meshrights |= 512; }
                if (args.nofiles) { meshrights |= 1024; }
                if (args.noamt) { meshrights |= 2048; }
                if (args.limiteddesktop) { meshrights |= 4096; }
                if (args.limitedevents) { meshrights |= 8192; }
                if (args.chatnotify) { meshrights |= 16384; }
                if (args.uninstall) { meshrights |= 32768; }
                var op = { action: 'adddeviceuser', nodeid: args.id, usernames: [args.userid], rights: meshrights, responseid: 'meshctrl' };
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeuserfromdevice': {
                var op = { action: 'adddeviceuser', nodeid: args.id, usernames: [args.userid], rights: 0, remove: true, responseid: 'meshctrl' };
                ws.send(JSON.stringify(op));
                break;
            }
            case 'sendinviteemail': {
                var op = { action: 'inviteAgent', email: args.email, name: '', os: '0', responseid: 'meshctrl' }
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                if (args.name) { op.name = args.name; }
                if (args.message) { op.msg = args.message; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'generateinvitelink': {
                var op = { action: 'createInviteLink', expire: args.hours, flags: 0, responseid: 'meshctrl' }
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                if (args.flags) { op.flags = args.flags; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'broadcast': {
                var op = { action: 'userbroadcast', msg: args.msg, responseid: 'meshctrl' };
                if (args.user) { op.userid = args.user; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'showevents': {
                console.log('Connected. Press ctrl-c to end.');
                break;
            }
            case 'deviceinfo': {
                settings.deviceinfocount = 4;
                ws.send(JSON.stringify({ action: 'nodes' }));
                ws.send(JSON.stringify({ action: 'getnetworkinfo', nodeid: args.id, responseid: 'meshctrl' }));
                ws.send(JSON.stringify({ action: 'lastconnect', nodeid: args.id, responseid: 'meshctrl' }));
                ws.send(JSON.stringify({ action: 'getsysinfo', nodeid: args.id, nodeinfo: true, responseid: 'meshctrl' }));
                break;
            }
            case 'removedevice': {
                var op = { action: 'removedevices', nodeids: [ args.id ], responseid: 'meshctrl' };
                ws.send(JSON.stringify(op));
                break;
            }
            case 'editdevice': {
                var op = { action: 'changedevice', nodeid: args.id, responseid: 'meshctrl' };
                if (typeof args.name == 'string') { op.name = args.name; }
                if (typeof args.name == 'number') { op.name = '' + args.name; }
                if (args.desc) { if (args.desc === true) { op.desc = ''; } else if (typeof args.desc == 'string') { op.desc = args.desc; } else if (typeof args.desc == 'number') { op.desc = '' + args.desc; } }
                if (args.tags) { if (args.tags === true) { op.tags = ''; } else if (typeof args.tags == 'string') { op.tags = args.tags.split(','); } else if (typeof args.tags == 'number') { op.tags = '' + args.tags; } }
                if (args.icon) { op.icon = parseInt(args.icon); if ((typeof op.icon != 'number') || isNaN(op.icon) || (op.icon < 1) || (op.icon > 8)) { console.log("Icon must be between 1 and 8."); process.exit(1); return; } }
                if (args.consent) { op.consent = parseInt(args.consent); if ((typeof op.consent != 'number') || isNaN(op.consent) || (op.consent < 1)) { console.log("Invalid consent flags."); process.exit(1); return; } }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'runcommand': {
                var runAsUser = 0;
                if (args.runasuser) { runAsUser = 1; } else if (args.runasuseronly) { runAsUser = 2; }
                ws.send(JSON.stringify({ action: 'runcommands', nodeids: [args.id], type: ((args.powershell) ? 2 : 0), cmds: args.run, responseid: 'meshctrl', runAsUser: runAsUser }));
                break;
            }
            case 'shell':
            case 'upload':
            case 'download': {
                ws.send("{\"action\":\"authcookie\"}");
                break;
            }
            case 'devicepower': {
                var nodes = args.id.split(',');
                if (args.wake) {
                    // Wake operation
                    ws.send(JSON.stringify({ action: 'wakedevices', nodeids: nodes, responseid: 'meshctrl' }));
                } else if (args.off) {
                    // Power off operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 2, responseid: 'meshctrl' }));
                } else if (args.reset) {
                    // Reset operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 3, responseid: 'meshctrl' }));
                } else if (args.sleep) {
                    // Sleep operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 4, responseid: 'meshctrl' }));
                } else if (args.amton) {
                    // Intel AMT Power on operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 302, responseid: 'meshctrl' }));
                } else if (args.amtoff) {
                    // Intel AMT Power off operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 308, responseid: 'meshctrl' }));
                } else if (args.amtreset) {
                    // Intel AMT Power reset operation
                    ws.send(JSON.stringify({ action: 'poweraction', nodeids: nodes, actiontype: 310, responseid: 'meshctrl' }));
                } else {
                    console.log('No power operation specified.');
                    process.exit(1);
                }
                break;
            }
            case 'agentdownload': {
                // Download an agent
                var u = settings.xxurl.replace('wss://', 'https://').replace('/control.ashx', '/meshagents');
                if (u.indexOf('?') > 0) { u += '&'; } else { u += '?'; }
                u += 'id=' + args.type + '&meshid=' + args.id;
                const options = { rejectUnauthorized: false, checkServerIdentity: onVerifyServer }
                const fs = require('fs');
                const https = require('https');
                var downloadSize = 0;
                const req = https.request(u, options, function (res) {
                    if (res.statusCode != 200) {
                        console.log('Download error, statusCode: ' + res.statusCode);
                        process.exit(1);
                    } else {
                        // Agent the agent filename
                        var agentFileName = 'meshagent';
                        if ((res.headers) && (res.headers['content-disposition'] != null)) {
                            var i = res.headers['content-disposition'].indexOf('filename=\"');
                            if (i >= 0) {
                                agentFileName = res.headers['content-disposition'].substring(i + 10);
                                i = agentFileName.indexOf('\"');
                                if (i >= 0) { agentFileName = agentFileName.substring(0, i); }
                            }
                        }
                        // Check if this file already exists
                        if (fs.existsSync(agentFileName)) { console.log('File \"' + agentFileName + '\" already exists.'); process.exit(1); }
                        var fd = fs.openSync(agentFileName, 'w'); // Open the file for writing
                        res.on('data', function (d) {
                            downloadSize += d.length;
                            fs.writeSync(fd, d); // Save to file
                        });
                        res.on('end', function (d) {
                            fs.closeSync(fd); // Close file
                            console.log('Downloaded ' + downloadSize + ' byte(s) to \"' + agentFileName + '\"');
                            process.exit(1);
                        });
                    }
                })
                req.on('error', function (error) { console.error(error); process.exit(1); })
                req.end()
                break;
            }
            case 'devicesharing': {
                if (args.add) {
                    if (args.add.length == 0) { console.log("Invalid guest name."); process.exit(1); }

                    // Sharing type, desktop or terminal
                    var p = 0;
                    if (args.type != null) {
                        var shareTypes = args.type.toLowerCase().split(',');
                        for (var i in shareTypes) { if ((shareTypes[i] != 'terminal') && (shareTypes[i] != 'desktop') && (shareTypes[i] != 'files')) { console.log("Unknown sharing type: " + shareTypes[i]); process.exit(1); } }
                        if (shareTypes.indexOf('terminal') >= 0) { p |= 1; }
                        if (shareTypes.indexOf('desktop') >= 0) { p |= 2; }
                        if (shareTypes.indexOf('files') >= 0) { p |= 4; }
                    }
                    if (p == 0) { p = 2; } // Desktop

                    // Sharing view only
                    var viewOnly = false;
                    if (args.viewonly) { viewOnly = true; }

                    // User consent
                    var consent = 0;
                    if (args.consent == null) {
                        if ((p & 1) != 0) { consent = 0x0002; } // Terminal notify
                        if ((p & 2) != 0) { consent = 0x0001; } // Desktop notify
                        if ((p & 4) != 0) { consent = 0x0004; } // Files notify
                    } else {
                        if (typeof args.consent == 'string') {
                            var flagStrs = args.consent.split(',');
                            for (var i in flagStrs) {
                                var flagStr = flagStrs[i].toLowerCase();
                                if (flagStr == 'none') { consent = 0; }
                                else if (flagStr == 'notify') {
                                    if ((p & 1) != 0) { consent |= 0x0002; } // Terminal notify
                                    if ((p & 2) != 0) { consent |= 0x0001; } // Desktop notify
                                    if ((p & 4) != 0) { consent |= 0x0004; } // Files notify
                                } else if (flagStr == 'prompt') {
                                    if ((p & 1) != 0) { consent |= 0x0010; } // Terminal prompt
                                    if ((p & 2) != 0) { consent |= 0x0008; } // Desktop prompt
                                    if ((p & 4) != 0) { consent |= 0x0020; } // Files prompt
                                } else if (flagStr == 'bar') {
                                    if ((p & 2) != 0) { consent |= 0x0040; } // Desktop toolbar
                                } else { console.log("Unknown consent type."); process.exit(1); return; }
                            }
                        }
                    }

                    // Start and end time
                    var start = null, end = null;
                    if (args.start) { start = Math.floor(Date.parse(args.start) / 1000); end = start + (60 * 60); }
                    if (args.end) { if (start == null) { start = Math.floor(Date.now() / 1000) } end = Math.floor(Date.parse(args.end) / 1000); if (end <= start) { console.log("End time must be ahead of start time."); process.exit(1); return; } }
                    if (args.duration) { if (start == null) { start = Math.floor(Date.now() / 1000) } end = start + parseInt(args.duration * 60); }

                    // Recurring
                    var recurring = 0;
                    if (args.daily) { recurring = 1; } else if (args.weekly) { recurring = 2; }
                    if (recurring > 0) {
                        if (args.end != null) { console.log("End time can't be specified for recurring shares, use --duration only."); process.exit(1); return; }
                        if (args.duration == null) { args.duration = 60; } else { args.duration = parseInt(args.duration); }
                        if (start == null) { start = Math.floor(Date.now() / 1000) }
                        if ((typeof args.duration != 'number') || (args.duration < 1)) { console.log("Invalid duration value."); process.exit(1); return; }

                        // Recurring sharing
                        ws.send(JSON.stringify({ action: 'createDeviceShareLink', nodeid: args.id, guestname: args.add, p: p, consent: consent, start: start, expire: args.duration, recurring: recurring, viewOnly: viewOnly, responseid: 'meshctrl' }));
                    } else {
                        if ((start == null) && (end == null)) {
                            // Unlimited sharing
                            ws.send(JSON.stringify({ action: 'createDeviceShareLink', nodeid: args.id, guestname: args.add, p: p, consent: consent, expire: 0, viewOnly: viewOnly, responseid: 'meshctrl' }));
                        } else {
                            // Time limited sharing
                            ws.send(JSON.stringify({ action: 'createDeviceShareLink', nodeid: args.id, guestname: args.add, p: p, consent: consent, start: start, end: end, viewOnly: viewOnly, responseid: 'meshctrl' }));
                        }
                    }
                } else if (args.remove) {
                    ws.send(JSON.stringify({ action: 'removeDeviceShare', nodeid: args.id, publicid: args.remove, responseid: 'meshctrl' }));
                } else {
                    ws.send(JSON.stringify({ action: 'deviceShares', nodeid: args.id, responseid: 'meshctrl' }));
                }
                break;
            }
            case 'deviceopenurl': {
                ws.send(JSON.stringify({ action: 'msg', type: 'openUrl', nodeid: args.id, url: args.openurl, responseid: 'meshctrl' }));
                break;
            }
            case 'devicemessage': {
                ws.send(JSON.stringify({ action: 'msg', type: 'messagebox', nodeid: args.id, title: args.title ? args.title : "MeshCentral", msg: args.msg, responseid: 'meshctrl' }));
                break;
            }
            case 'devicetoast': {
                ws.send(JSON.stringify({ action: 'toast', nodeids: [args.id], title: args.title ? args.title : "MeshCentral", msg: args.msg, responseid: 'meshctrl' }));
                break;
            }
            case 'report': {
                var reporttype = 1;
                switch(args.type) {
                    case 'traffic':
                        reporttype = 2;
                        break;
                    case 'logins':
                        reporttype = 3;
                        break;
                    case 'db':
                        reporttype = 4;
                        break;
                }
                
                var reportgroupby = 1;
                if(args.groupby){
                    reportgroupby = args.groupby === 'device' ? 2 : args.groupby === 'day' ? 3: 1;
                }
                
                var start = null, end = null;
                if (args.start) {
                    start = Math.floor(Date.parse(args.start) / 1000);
                } else {
                    start = reportgroupby === 3 ? Math.round(new Date().getTime() / 1000) - (168 * 3600) : Math.round(new Date().getTime() / 1000) - (24 * 3600);
                }
                if (args.end) {
                    end = Math.floor(Date.parse(args.end) / 1000);
                } else {
                    end = Math.round(new Date().getTime() / 1000);
                }                    
                if (end <= start) { console.log("End time must be ahead of start time."); process.exit(1); return; }
                
                ws.send(JSON.stringify({ action: 'report', type: reporttype, groupBy: reportgroupby, devGroup: args.devicegroup || null, start, end, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, tf: new Date().getTimezoneOffset(), showTraffic: args.hasOwnProperty('showtraffic'), l: 'en', responseid: 'meshctrl' }));
                break;
            }
        }
    });

    function getSiteAdminRights(args) {
        var siteadmin = -1;
        if (typeof args.rights == 'number') {
            siteadmin = args.rights;
        } else if (typeof args.rights == 'string') {
            siteadmin = 0;
            var srights = args.rights.toLowerCase().split(',');
            if (srights.indexOf('full') != -1) { siteadmin = 0xFFFFFFFF; }
            if (srights.indexOf('none') != -1) { siteadmin = 0x00000000; }
            if (srights.indexOf('backup') != -1) { siteadmin |= 0x00000001; }
            if (srights.indexOf('manageusers') != -1) { siteadmin |= 0x00000002; }
            if (srights.indexOf('restore') != -1) { siteadmin |= 0x00000004; }
            if (srights.indexOf('fileaccess') != -1) { siteadmin |= 0x00000008; }
            if (srights.indexOf('update') != -1) { siteadmin |= 0x00000010; }
            if (srights.indexOf('locked') != -1) { siteadmin |= 0x00000020; }
            if (srights.indexOf('nonewgroups') != -1) { siteadmin |= 0x00000040; }
            if (srights.indexOf('notools') != -1) { siteadmin |= 0x00000080; }
            if (srights.indexOf('usergroups') != -1) { siteadmin |= 0x00000100; }
            if (srights.indexOf('recordings') != -1) { siteadmin |= 0x00000200; }
            if (srights.indexOf('locksettings') != -1) { siteadmin |= 0x00000400; }
            if (srights.indexOf('allevents') != -1) { siteadmin |= 0x00000800; }
        }

        if (args.siteadmin) { siteadmin = 0xFFFFFFFF; }
        if (args.manageusers) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 2; }
        if (args.fileaccess) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 8; }
        if (args.serverupdate) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 16; }
        if (args.locked) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 32; }
        if (args.nonewgroups) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 64; }
        if (args.notools) { if (siteadmin == -1) { siteadmin = 0; } siteadmin |= 128; }
        return siteadmin;
    }

    ws.on('close', function () { process.exit(); });
    ws.on('error', function (err) {
        if (err.code == 'ENOTFOUND') { console.log('Unable to resolve ' + url); }
        else if (err.code == 'ECONNREFUSED') { console.log('Unable to connect to ' + url); }
        else { console.log('Unable to connect to ' + url); }
        process.exit();
    });

    ws.on('message', function incoming(rawdata) {
        var data = null;
        try { data = JSON.parse(rawdata); } catch (ex) { }
        if (data == null) { console.log('Unable to parse data: ' + rawdata); }
        if (settings.cmd == 'showevents') {
            if (args.filter == null) {
                // Display all events
                console.log(JSON.stringify(data, null, 2));
            } else {
                // Display select events
                var filters = args.filter.split(',');
                if (typeof data.event == 'object') {
                    if (filters.indexOf(data.event.action) >= 0) { console.log(JSON.stringify(data, null, 2) + '\r\n'); }
                } else {
                    if (filters.indexOf(data.action) >= 0) { console.log(JSON.stringify(data, null, 2) + '\r\n'); }
                }
            }
            return;
        }
        switch (data.action) {
            case 'serverinfo': { // SERVERINFO
                settings.currentDomain = data.serverinfo.domain;
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
            case 'events': {
                if (settings.cmd == 'listevents') {
                    if (args.raw) {
                        // RAW JSON
                        console.log(JSON.stringify(data.events));
                    } else if (args.json) {
                        // Formatted JSON
                        console.log(JSON.stringify(data.events, null, 2));
                    } else {
                        if ((args.id == null) && (args.userid == null)) {
                            // CSV format
                            console.log("time,type,action,nodeid,userid,msg");
                            for (var i in data.events) {
                                var x = [];
                                x.push(data.events[i].time);
                                x.push(data.events[i].etype);
                                x.push(data.events[i].action);
                                x.push(data.events[i].nodeid);
                                x.push(data.events[i].userid);
                                x.push(data.events[i].msg);
                                console.log(csvFormatArray(x));
                            }
                        } else if (args.id != null) {
                            // CSV format
                            console.log("time,type,action,userid,msg");
                            for (var i in data.events) {
                                var x = [];
                                x.push(data.events[i].time);
                                x.push(data.events[i].etype);
                                x.push(data.events[i].action);
                                x.push(data.events[i].userid);
                                x.push(data.events[i].msg);
                                console.log(csvFormatArray(x));
                            }
                        } else if (args.userid != null) {
                            // CSV format
                            console.log("time,type,action,nodeid,msg");
                            for (var i in data.events) {
                                var x = [];
                                x.push(data.events[i].time);
                                x.push(data.events[i].etype);
                                x.push(data.events[i].action);
                                x.push(data.events[i].nodeid);
                                x.push(data.events[i].msg);
                                console.log(csvFormatArray(x));
                            }
                        }
                    }
                    process.exit();
                }
                break;
            }
            case 'authcookie': { // SHELL, UPLOAD, DOWNLOAD
                if ((settings.cmd == 'shell') || (settings.cmd == 'upload') || (settings.cmd == 'download')) {
                    var protocol = 1; // Terminal
                    if ((settings.cmd == 'upload') || (settings.cmd == 'download')) { protocol = 5; } // Files
                    if ((args.id.split('/') != 3) && (settings.currentDomain != null)) { args.id = 'node/' + settings.currentDomain + '/' + args.id; }
                    var id = getRandomHex(6);
                    ws.send(JSON.stringify({ action: 'msg', nodeid: args.id, type: 'tunnel', usage: 1, value: '*/meshrelay.ashx?p=' + protocol + '&nodeid=' + args.id + '&id=' + id + '&rauth=' + data.rcookie, responseid: 'meshctrl' }));
                    connectTunnel(url.replace('/control.ashx', '/meshrelay.ashx?browser=1&p=' + protocol + '&nodeid=' + args.id + '&id=' + id + '&auth=' + data.cookie));
                }
                break;
            }
            case 'deviceShares': { // DEVICESHARING
                if (data.result != null) {
                    console.log(data.result);
                } else {
                    if ((data.deviceShares == null) || (data.deviceShares.length == 0)) {
                        console.log('No device sharing links for this device.');
                    } else {
                        if (args.json) {
                            console.log(data.deviceShares);
                        } else {
                            for (var i in data.deviceShares) {
                                var share = data.deviceShares[i];
                                var shareType = [];
                                if ((share.p & 1) != 0) { shareType.push("Terminal"); }
                                if ((share.p & 2) != 0) { if (share.viewOnly) { shareType.push("View Only Desktop"); } else { shareType.push("Desktop"); } }
                                if ((share.p & 4) != 0) { shareType.push("Files"); }
                                shareType = shareType.join(' + ');
                                if (shareType == '') { shareType = "Unknown"; }
                                var consent = [];
                                if ((share.consent & 0x0001) != 0) { consent.push("Desktop Notify"); }
                                if ((share.consent & 0x0008) != 0) { consent.push("Desktop Prompt"); }
                                if ((share.consent & 0x0040) != 0) { consent.push("Desktop Connection Toolbar"); }
                                if ((share.consent & 0x0002) != 0) { consent.push("Terminal Notify"); }
                                if ((share.consent & 0x0010) != 0) { consent.push("Terminal Prompt"); }
                                if ((share.consent & 0x0004) != 0) { consent.push("Files Notify"); }
                                if ((share.consent & 0x0020) != 0) { consent.push("Files Prompt"); }
                                console.log('----------');
                                console.log('Identifier:   ' + share.publicid);
                                console.log('Type:         ' + shareType);
                                console.log('UserId:       ' + share.userid);
                                console.log('Guest Name:   ' + share.guestName);
                                console.log('User Consent: ' + consent.join(', '));
                                if (share.startTime) { console.log('Start Time:   ' + new Date(share.startTime).toLocaleString()); }
                                if (share.expireTime) { console.log('Expire Time:  ' + new Date(share.expireTime).toLocaleString()); }
                                if (share.duration) { console.log('Duration:     ' + share.duration + ' minute' + ((share.duration > 1) ? 's' : '')); }
                                if (share.recurring == 1) { console.log('Recurring:    ' + 'Daily'); }
                                if (share.recurring == 2) { console.log('Recurring:    ' + 'Weekly'); }
                                console.log('URL:          ' + share.url);
                            }
                        }
                    }
                }
                process.exit();
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
            case 'getsysinfo': { // DEVICEINFO
                if (settings.cmd == 'deviceinfo') {
                    settings.sysinfo = (data.result) ? null : data;
                    if (--settings.deviceinfocount == 0) { displayDeviceInfo(settings.sysinfo, settings.lastconnect, settings.networking, settings.nodes); process.exit(); }
                }
                break;
            }
            case 'lastconnect': {
                if (settings.cmd == 'deviceinfo') {
                    settings.lastconnect = (data.result) ? null : data;
                    if (--settings.deviceinfocount == 0) { displayDeviceInfo(settings.sysinfo, settings.lastconnect, settings.networking, settings.nodes); process.exit(); }
                }
                break;
            }
            case 'getnetworkinfo': {
                if (settings.cmd == 'deviceinfo') {
                    settings.networking = (data.result) ? null : data;
                    if (--settings.deviceinfocount == 0) { displayDeviceInfo(settings.sysinfo, settings.lastconnect, settings.networking, settings.nodes); process.exit(); }
                }
                break;
            }
            case 'msg': // SHELL
            case 'toast': // TOAST
            case 'adduser': // ADDUSER
            case 'edituser': // EDITUSER
            case 'removedevices': // REMOVEDEVICE
            case 'changedevice': // EDITDEVICE
            case 'deleteuser': // REMOVEUSER
            case 'createmesh': // ADDDEVICEGROUP
            case 'deletemesh': // REMOVEDEVICEGROUP
            case 'editmesh': // EDITDEVICEGROUP
            case 'wakedevices':
            case 'changeDeviceMesh':
            case 'addmeshuser': //
            case 'removemeshuser': //
            case 'wakedevices': //
            case 'inviteAgent': //
            case 'adddeviceuser': //
            case 'createusergroup': //
            case 'deleteusergroup': //
            case 'runcommands':
            case 'poweraction':
            case 'addusertousergroup':
            case 'removeuserfromusergroup':
            case 'removeDeviceShare':
            case 'userbroadcast': { // BROADCAST
                if ((settings.cmd == 'shell') || (settings.cmd == 'upload') || (settings.cmd == 'download')) return;
                if ((settings.multiresponse != null) && (settings.multiresponse > 1)) { settings.multiresponse--; break; }
                if (data.responseid == 'meshctrl') {
                    if (data.meshid) { console.log(data.result, data.meshid); }
                    else if (data.userid) { console.log(data.result, data.userid); }
                    else console.log(data.result);
                    process.exit();
                }
                break;
            }
            case 'createDeviceShareLink':
                if (data.result == 'OK') {
                    if (data.publicid) { console.log('ID: ' + data.publicid); }
                    console.log('URL: ' + data.url);
                } else {
                    console.log(data.result);
                }
                process.exit();
                break;
            case 'createInviteLink':
                if (data.responseid == 'meshctrl') {
                    if (data.url) { console.log(data.url); }
                    else console.log(data.result);
                    process.exit();
                }
                break;
            case 'wssessioncount': { // LIST USER SESSIONS
                if (args.json) {
                    console.log(JSON.stringify(data.wssessions, ' ', 2));
                } else {
                    for (var i in data.wssessions) { console.log(i + ', ' + ((data.wssessions[i] > 1) ? (data.wssessions[i] + ' sessions.') : ("1 session."))); }
                }
                process.exit();
                break;
            }
            case 'usergroups': { // LIST USER GROUPS
                if (settings.cmd == 'listusergroups') {
                    if (args.json) {
                        console.log(JSON.stringify(data.ugroups, ' ', 2));
                    } else {
                        for (var i in data.ugroups) {
                            var x = i + ', ' + data.ugroups[i].name;
                            if (data.ugroups[i].desc && (data.ugroups[i].desc != '')) { x += ', ' + data.ugroups[i].desc; }
                            console.log(x);
                            var mesh = [], user = [], node = [];
                            if (data.ugroups[i].links != null) { for (var j in data.ugroups[i].links) { if (j.startsWith('mesh/')) { mesh.push(j); } if (j.startsWith('user/')) { user.push(j); } if (j.startsWith('node/')) { node.push(j); } } }
                            console.log('  Users:');
                            if (user.length > 0) { for (var j in user) { console.log('    ' + user[j]); } } else { console.log('    (None)'); }
                            console.log('  Device Groups:');
                            if (mesh.length > 0) { for (var j in mesh) { console.log('    ' + mesh[j] + ', ' + data.ugroups[i].links[mesh[j]].rights); } } else { console.log('    (None)'); }
                            console.log('  Devices:');
                            if (node.length > 0) { for (var j in node) { console.log('    ' + node[j] + ', ' + data.ugroups[i].links[node[j]].rights); } } else { console.log('    (None)'); }
                        }
                    }
                    process.exit();
                } else if (settings.cmd == 'removeallusersfromusergroup') {
                    var ugrpid = args.groupid, exit = false;
                    if ((args.domain != null) && (userid.indexOf('/') < 0)) { ugrpid = 'ugrp/' + args.domain + '/' + ugrpid; }
                    var ugroup = data.ugroups[ugrpid];
                    if (ugroup == null) {
                        console.log('User group not found.');
                        exit = true;
                    } else {
                        var usercount = 0;
                        if (ugroup.links) {
                            for (var i in ugroup.links) {
                                if (i.startsWith('user/')) {
                                    usercount++;
                                    ws.send(JSON.stringify({ action: 'removeuserfromusergroup', ugrpid: ugrpid, userid: i, responseid: 'meshctrl' }));
                                    console.log('Removing ' + i);
                                }
                            }
                        }
                        if (usercount == 0) { console.log('No users in this user group.'); exit = true; } else { settings.multiresponse = usercount; }
                    }
                    if (exit) { process.exit(); }
                }
                break;
            }
            case 'users': { // LISTUSERS
                if (data.result) { console.log(data.result); process.exit(); return; }
                if (args.filter) {
                    // Filter the list of users
                    var filters = args.filter.toLowerCase().split(',');
                    var filteredusers = [];
                    for (var i in data.users) {
                        var ok = false;
                        if ((filters.indexOf('2fa') >= 0) && ((data.users[i].otphkeys != null) || (data.users[i].otpkeys != null) || (data.users[i].otpsecret != null))) { ok = true; }
                        if ((filters.indexOf('no2fa') >= 0) && ((data.users[i].otphkeys == null) && (data.users[i].otpkeys == null) && (data.users[i].otpsecret == null))) { ok = true; }
                        if (ok == true) { filteredusers.push(data.users[i]); }
                    }
                    data.users = filteredusers;
                }
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
            case 'nodes': {
                if (settings.cmd == 'deviceinfo') {
                    settings.nodes = (data.result) ? null : data;
                    if (--settings.deviceinfocount == 0) { displayDeviceInfo(settings.sysinfo, settings.lastconnect, settings.networking, settings.nodes); process.exit(); }
                }
                if ((settings.cmd == 'listdevices') && (data.responseid == 'meshctrl')) {
                    if ((data.result != null) && (data.result != 'ok')) {
                        console.log(data.result);
                    } else {
                        // Filter devices based on device id.
                        if (args.filterid) {
                            var filteridSplit = args.filterid.split(','), filters = [];
                            for (var i in filteridSplit) {
                                var f = filteridSplit[i].trim();
                                var g = f.split('/'); // If there is any / in the id, just grab the last part.
                                if (g.length > 0) { f = g[g.length - 1]; }
                                if (f != '') { filters.push(f); }
                            }
                            if (filters.length > 0) {
                                for (var mid in data.nodes) {
                                    var filteredNodes = [];
                                    for (var nid in data.nodes[mid]) {
                                        var n = data.nodes[mid][nid], match = false;
                                        for (var f in filters) { if (n._id.indexOf(filters[f]) >= 0) { match = true; } }
                                        if (match) { filteredNodes.push(n); }
                                    }
                                    data.nodes[mid] = filteredNodes;
                                }
                            }
                        }

                        // Filter devices based on filter string
                        if (args.filter != null) {
                            for (var meshid in data.nodes) {
                                for (var d in data.nodes[meshid]) { data.nodes[meshid][d].meshid = meshid; }
                                data.nodes[meshid] = parseSearchOrInput(data.nodes[meshid], args.filter.toLowerCase());
                            }
                        }

                        if (args.csv) {
                            // Return a flat list
                            var nodecount = 0;
                            for (var i in data.nodes) {
                                var devicesInMesh = data.nodes[i];
                                for (var j in devicesInMesh) {
                                    var n = devicesInMesh[j];
                                    nodecount++;
                                    if (settings.xmeshes) {
                                        console.log('\"' + settings.xmeshes[i]._id.split('/')[2] + '\",\"' + settings.xmeshes[i].name.split('\"').join('') + '\",\"' + n._id.split('/')[2] + '\",\"' + n.name.split('\"').join('') + '\",' + (n.icon ? n.icon : 0) + ',' + (n.conn ? n.conn : 0) + ',' + (n.pwr ? n.pwr : 0));
                                    } else {
                                        console.log('\"' + n._id.split('/')[2] + '\",\"' + n.name.split('\"').join('') + '\",' + (n.icon ? n.icon : 0) + ',' + (n.conn ? n.conn : 0) + ',' + (n.pwr ? n.pwr : 0));
                                    }
                                }
                            }
                            if (nodecount == 0) { console.log('None'); }
                        } else if (args.count) {
                            // Return how many devices are in this group
                            var nodes = [];
                            for (var i in data.nodes) { var devicesInMesh = data.nodes[i]; for (var j in devicesInMesh) { nodes.push(devicesInMesh[j]); } }
                            console.log(nodes.length);
                        } else if (args.json) {
                            // Return all devices in JSON format
                            var nodes = [];

                            for (var i in data.nodes) {
                                const devicesInMesh = data.nodes[i];
                                for (var j in devicesInMesh) {
                                    devicesInMesh[j].meshid = i; // Add device group id
                                    if (settings.xmeshes && settings.xmeshes[i] && settings.xmeshes[i].name) { devicesInMesh[j].groupname = settings.xmeshes[i].name; } // Add device group name
                                    nodes.push(devicesInMesh[j]);
                                }
                            }
                            console.log(JSON.stringify(nodes, ' ', 2));
                        } else {
                            // Display the list of nodes in text format
                            var nodecount = 0;
                            for (var i in data.nodes) {
                                var devicesInMesh = data.nodes[i];
                                if (devicesInMesh.length > 0) {
                                    if (settings.xmeshes) { console.log('\r\nDevice group: \"' + settings.xmeshes[i].name.split('\"').join('') + '\"'); }
                                    console.log('id, name, icon, conn, pwr\r\n-------------------------');
                                    for (var j in devicesInMesh) {
                                        var n = devicesInMesh[j];
                                        nodecount++;
                                        console.log('\"' + n._id.split('/')[2] + '\", \"' + n.name.split('\"').join('') + '\", ' + (n.icon ? n.icon : 0) + ', ' + (n.conn ? n.conn : 0) + ', ' + (n.pwr ? n.pwr : 0));
                                    }
                                }
                            }
                            if (nodecount == 0) { console.log('None'); }
                        }
                    }
                    process.exit();
                }
                break;
            }
            case 'meshes': { // LISTDEVICEGROUPS
                if (settings.cmd == 'listdevices') {
                    // Store the list of device groups for later use
                    settings.xmeshes = {}
                    for (var i in data.meshes) { settings.xmeshes[data.meshes[i]._id] = data.meshes[i]; }
                } else if (settings.cmd == 'listdevicegroups') {
                    if (args.json) {
                        // If asked, add the MeshID hex encoding to the JSON.
                        if (args.hex) { for (var i in data.meshes) { data.meshes[i]._idhex = '0x' + Buffer.from(data.meshes[i]._id.split('/')[2].replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase(); } }
                        console.log(JSON.stringify(data.meshes, ' ', 2));
                    } else {
                        if (args.idexists) { for (var i in data.meshes) { const u = data.meshes[i]; if ((u._id == args.idexists) || (u._id.split('/')[2] == args.idexists)) { console.log('1'); process.exit(); return; } } console.log('0'); process.exit(); return; }
                        if (args.nameexists) { for (var i in data.meshes) { const u = data.meshes[i]; if (u.name == args.nameexists) { console.log(u._id); process.exit(); return; } } process.exit(); return; }

                        console.log('id, name\r\n---------------');
                        for (var i in data.meshes) {
                            const m = data.meshes[i];
                            var mid = m._id.split('/')[2];
                            if (args.hex) { mid = '0x' + Buffer.from(mid.replace(/\@/g, '+').replace(/\$/g, '/'), 'base64').toString('hex').toUpperCase(); }
                            var t = "\"" + mid + "\", \"" + m.name + "\"";
                            console.log(t);
                        }
                    }
                    process.exit();
                } else if (settings.cmd == 'listusersofdevicegroup') {
                    for (var i in data.meshes) {
                        const m = data.meshes[i];
                        var mid = m._id.split('/')[2];
                        if (mid == args.id) {
                            if (args.json) {
                                console.log(JSON.stringify(m.links, ' ', 2));
                            } else {
                                console.log('userid, rights\r\n---------------');
                                for (var l in m.links) {
                                    var rights = m.links[l].rights;
                                    var rightsstr = [];
                                    if (rights == 4294967295) { rightsstr = ['FullAdministrator']; } else {
                                        if (rights & 1) { rightsstr.push('EditMesh'); }
                                        if (rights & 2) { rightsstr.push('ManageUsers'); }
                                        if (rights & 4) { rightsstr.push('ManageComputers'); }
                                        if (rights & 8) { rightsstr.push('RemoteControl'); }
                                        if (rights & 16) { rightsstr.push('AgentConsole'); }
                                        if (rights & 32) { rightsstr.push('ServerFiles'); }
                                        if (rights & 64) { rightsstr.push('WakeDevice'); }
                                        if (rights & 128) { rightsstr.push('SetNotes'); }
                                        if (rights & 256) { rightsstr.push('RemoteViewOnly'); }
                                        if (rights & 512) { rightsstr.push('NoTerminal'); }
                                        if (rights & 1024) { rightsstr.push('NoFiles'); }
                                        if (rights & 2048) { rightsstr.push('NoAMT'); }
                                        if (rights & 4096) { rightsstr.push('DesktopLimitedInput'); }
                                    }
                                    console.log(l.split('/')[2] + ', ' + rightsstr.join(', '));
                                }
                            }
                            process.exit();
                            return;
                        }
                    }
                    console.log('Group id not found');
                    process.exit();
                }
                break;
            }
            case 'close': {
                if (data.cause == 'noauth') {
                    if (data.msg == 'tokenrequired') {
                        console.log('Authentication token required, use --token [number].');
                    } else {
                        if ((args.loginkeyfile != null) || (args.loginkey != null)) {
                            console.log('Invalid login, check the login key and that this computer has the correct time.');
                        } else {
                            console.log('Invalid login.');
                        }
                    }
                }
                process.exit();
                break;
            }
            case 'createLoginToken': {
                if (data.result != null) {
                    console.log(data.result);
                    process.exit();
                } else {
                    if (args.json) {
                        console.log(data);
                    } else {
                        console.log("New login token created.");
                        if (data.name) { console.log("Token name: " + data.name); }
                        if (data.created) { console.log("Created: " + new Date(data.created).toLocaleString()); }
                        if (data.expire) { console.log("Expire: " + new Date(data.expire).toLocaleString()); }
                        if (data.tokenUser) { console.log("Username: " + data.tokenUser); }
                        if (data.tokenPass) { console.log("Password: " + data.tokenPass); }
                    }
                }
                process.exit();
                break;
            }
            case 'loginTokens': {
                if (args.json) {
                    console.log(data.loginTokens);
                } else {
                    console.log("Name                        Username                    Expire");
                    console.log("-------------------------------------------------------------------------------------");
                    if (data.loginTokens.length == 0) {
                        console.log("No login tokens");
                    } else {
                        for (var i in data.loginTokens) {
                            var t = data.loginTokens[i];
                            var e = (t.expire == 0) ? "Unlimited" : new Date(t.expire).toLocaleString();
                            console.log(padString(t.name, 28) + padString(t.tokenUser, 28) + e);
                        }
                    }
                }
                process.exit();
                break;
            }
            case 'getDeviceDetails': {
                console.log(data.data);
                process.exit();
            }
            case 'report': {
                console.log('group,' + data.data.columns.flatMap(c => c.id).join(','));
                Object.keys(data.data.groups).forEach(gk => {
                    data.data.groups[gk].entries.forEach(e => {
                        console.log(gk + ',' + Object.values(e).join(','));
                    });
                });
                process.exit();
            }
            default: { break; }
        }
        //console.log('Data', data);
        //setTimeout(function timeout() { ws.send(Date.now()); }, 500);
    });
}

// String padding function

function padString(str, pad) {
    var xpad = '                                                                                                         ';
    if (str.length >= pad) return str; return str + xpad.substring(0, pad - str.length)
}

function parseSearchAndInput(nodes, x) {
    var s = x.split(' ' + "and" + ' '), r = null;
    for (var i in s) {
        var r2 = getDevicesThatMatchFilter(nodes, s[i]);
        if (r == null) { r = r2; } else { var r3 = []; for (var j in r2) { if (r.indexOf(r2[j]) >= 0) { r3.push(r2[j]); } } r = r3; }
    }
    return r;
}

function parseSearchOrInput(nodes, x) {
    var s = x.split(' ' + "or" + ' '), r = null;
    for (var i in s) { var r2 = parseSearchAndInput(nodes, s[i]); if (r == null) { r = r2; } else { for (var j in r2) { if (r.indexOf(r2[j] >= 0)) { r.push(r2[j]); } } } }
    return r;
}

function getDevicesThatMatchFilter(nodes, x) {
    var r = [];
    var userSearch = null, ipSearch = null, groupSearch = null, tagSearch = null, agentTagSearch = null, wscSearch = null, osSearch = null, amtSearch = null, descSearch = null;
    if (x.startsWith("user:".toLowerCase())) { userSearch = x.substring("user:".length); }
    else if (x.startsWith("u:".toLowerCase())) { userSearch = x.substring("u:".length); }
    else if (x.startsWith("ip:".toLowerCase())) { ipSearch = x.substring("ip:".length); }
    else if (x.startsWith("group:".toLowerCase())) { groupSearch = x.substring("group:".length); }
    else if (x.startsWith("g:".toLowerCase())) { groupSearch = x.substring("g:".length); }
    else if (x.startsWith("tag:".toLowerCase())) { tagSearch = x.substring("tag:".length); }
    else if (x.startsWith("t:".toLowerCase())) { tagSearch = x.substring("t:".length); }
    else if (x.startsWith("atag:".toLowerCase())) { agentTagSearch = x.substring("atag:".length); }
    else if (x.startsWith("a:".toLowerCase())) { agentTagSearch = x.substring("a:".length); }
    else if (x.startsWith("os:".toLowerCase())) { osSearch = x.substring("os:".length); }
    else if (x.startsWith("amt:".toLowerCase())) { amtSearch = x.substring("amt:".length); }
    else if (x.startsWith("desc:".toLowerCase())) { descSearch = x.substring("desc:".length); }
    else if (x == 'wsc:ok') { wscSearch = 1; }
    else if (x == 'wsc:noav') { wscSearch = 2; }
    else if (x == 'wsc:noupdate') { wscSearch = 3; }
    else if (x == 'wsc:nofirewall') { wscSearch = 4; }
    else if (x == 'wsc:any') { wscSearch = 5; }

    if (x == '') {
        // No search
        for (var d in nodes) { r.push(nodes[d]); }
    } else if (ipSearch != null) {
        // IP address search
        for (var d in nodes) { if ((nodes[d].ip != null) && (nodes[d].ip.indexOf(ipSearch) >= 0)) { r.push(nodes[d]); } }
    } else if (groupSearch != null) {
        // Group filter
        if (settings.xmeshes) { for (var d in nodes) { if (settings.xmeshes[nodes[d].meshid].name.toLowerCase().indexOf(groupSearch) >= 0) { r.push(nodes[d]); } } }
    } else if (tagSearch != null) {
        // Tag filter
        for (var d in nodes) {
            if ((nodes[d].tags == null) && (tagSearch == '')) { r.push(d); }
            else if (nodes[d].tags != null) { for (var j in nodes[d].tags) { if (nodes[d].tags[j].toLowerCase() == tagSearch) { r.push(d); break; } } }
        }
    } else if (agentTagSearch != null) {
        // Agent Tag filter
        for (var d in nodes) {
            if ((((nodes[d].agent != null) && (nodes[d].agent.tag == null)) && (agentTagSearch == '')) || ((nodes[d].agent != null) && (nodes[d].agent.tag != null) && (nodes[d].agent.tag.toLowerCase().indexOf(agentTagSearch) >= 0))) { r.push(nodes[d]); };
        }
    } else if (userSearch != null) {
        // User search
        for (var d in nodes) {
            if (nodes[d].users && nodes[d].users.length > 0) { for (var i in nodes[d].users) { if (nodes[d].users[i].toLowerCase().indexOf(userSearch) >= 0) { r.push(nodes[d]); } } }
        }
    } else if (osSearch != null) {
        // OS search
        for (var d in nodes) { if ((nodes[d].osdesc != null) && (nodes[d].osdesc.toLowerCase().indexOf(osSearch) >= 0)) { r.push(nodes[d]); }; }
    } else if (amtSearch != null) {
        // Intel AMT search
        for (var d in nodes) { if ((nodes[d].intelamt != null) && ((amtSearch == '') || (nodes[d].intelamt.state == amtSearch))) { r.push(nodes[d]); } }
    } else if (descSearch != null) {
        // Device description search
        for (var d in nodes) { if ((nodes[d].desc != null) && (nodes[d].desc != '') && ((descSearch == '') || (nodes[d].desc.toLowerCase().indexOf(descSearch) >= 0))) { r.push(nodes[d]); } }
    } else if (wscSearch != null) {
        // Windows Security Center
        for (var d in nodes) {
            if (nodes[d].wsc) {
                if ((wscSearch == 1) && (nodes[d].wsc.antiVirus == 'OK') && (nodes[d].wsc.autoUpdate == 'OK') && (nodes[d].wsc.firewall == 'OK')) { r.push(nodes[d]); }
                else if (((wscSearch == 2) || (wscSearch == 5)) && (nodes[d].wsc.antiVirus != 'OK')) { r.push(nodes[d]); }
                else if (((wscSearch == 3) || (wscSearch == 5)) && (nodes[d].wsc.autoUpdate != 'OK')) { r.push(nodes[d]); }
                else if (((wscSearch == 4) || (wscSearch == 5)) && (nodes[d].wsc.firewall != 'OK')) { r.push(nodes[d]); }
            }
        }
    } else if (x == '*') {
        // Star filter
        for (var d in nodes) { if (stars[nodes[d]._id] == 1) { r.push(nodes[d]); } }
    } else {
        // Device name search
        try {
            var rs = x.split(/\s+/).join('|'), rx = new RegExp(rs); // In some cases (like +), this can throw an exception.
            for (var d in nodes) {
                //if (showRealNames) {
                //if (nodes[d].rnamel != null && rx.test(nodes[d].rnamel.toLowerCase())) { r.push(nodes[d]); }
                //} else {
                if (rx.test(nodes[d].name.toLowerCase())) { r.push(nodes[d]); }
                //}
            }
        } catch (ex) { for (var d in nodes) { r.push(nodes[d]); } }
    }

    return r;
}


// Connect tunnel to a remote agent
function connectTunnel(url) {
    // Setup WebSocket options
    var options = { rejectUnauthorized: false, checkServerIdentity: onVerifyServer }

    // Setup the HTTP proxy if needed
    if (args.proxy != null) { const HttpsProxyAgent = require('https-proxy-agent'); options.agent = new HttpsProxyAgent(require('url').parse(args.proxy)); }

    // Connect the WebSocket
    console.log('Connecting...');
    const WebSocket = require('ws');
    settings.tunnelwsstate = 0;
    settings.tunnelws = new WebSocket(url, options);
    settings.tunnelws.on('open', function () { console.log('Waiting for Agent...'); }); // Wait for agent connection
    settings.tunnelws.on('close', function () { console.log('Connection Closed.'); process.exit(); });
    settings.tunnelws.on('error', function (err) { console.log(err); process.exit(); });

    if (settings.cmd == 'shell') {
        // This code does all of the work for a shell command
        settings.tunnelws.on('message', function (rawdata) {
            var data = rawdata.toString();
            if (settings.tunnelwsstate == 1) {
                // If the incoming text looks exactly like a control command, ignore it.
                if ((typeof data == 'string') && (data.startsWith('{"ctrlChannel":"102938","type":"'))) {
                    var ctrlCmd = null;
                    try { ctrlCmd = JSON.parse(data); } catch (ex) { }
                    if ((ctrlCmd != null) && (ctrlCmd.ctrlChannel == '102938') && (ctrlCmd.type != null)) return; // This is a control command, like ping/pong. Ignore it.
                }
                process.stdout.write(data);
            } else if (settings.tunnelwsstate == 0) {
                if (data == 'c') { console.log('Connected.'); } else if (data == 'cr') { console.log('Connected, session is being recorded.'); } else return;
                // Send terminal size
                var termSize = null;
                if (typeof process.stdout.getWindowSize == 'function') { termSize = process.stdout.getWindowSize(); }
                if (termSize != null) { settings.tunnelws.send(JSON.stringify({ ctrlChannel: '102938', type: 'options', cols: termSize[0], rows: termSize[1] })); }
                settings.tunnelwsstate = 1;
                settings.tunnelws.send('1'); // Terminal
                process.stdin.setEncoding('utf8');
                process.stdin.setRawMode(true);
                process.stdout.setEncoding('utf8');
                process.stdin.unpipe(process.stdout);
                process.stdout.unpipe(process.stdin);
                process.stdin.on('data', function (data) { settings.tunnelws.send(Buffer.from(data)); });
                //process.stdin.on('readable', function () { var chunk; while ((chunk = process.stdin.read()) !== null) { settings.tunnelws.send(Buffer.from(chunk)); } });
                process.stdin.on('end', function () { process.exit(); });
                process.stdout.on('resize', function () {
                    var termSize = null;
                    if (typeof process.stdout.getWindowSize == 'function') { termSize = process.stdout.getWindowSize(); }
                    if (termSize != null) { settings.tunnelws.send(JSON.stringify({ ctrlChannel: '102938', type: 'termsize', cols: termSize[0], rows: termSize[1] })); }
                });
            }
        });
    } else if (settings.cmd == 'upload') {
        // This code does all of the work for a file upload
        // node meshctrl upload --id oL4Y6Eg0qjnpHFrp1AxfxnBPenbDGnDSkC@HSOnAheIyd51pKhqSCUgJZakzwfKl --file readme.md --target c:\
        settings.tunnelws.on('message', function (rawdata) {
            if (settings.tunnelwsstate == 1) {
                var cmd = null;
                try { cmd = JSON.parse(rawdata.toString()); } catch (ex) { return; }
                if (cmd.reqid == 'up') {
                    if ((cmd.action == 'uploadack') || (cmd.action == 'uploadstart')) {
                        settings.inFlight--;
                        if (settings.uploadFile == null) { if (settings.inFlight == 0) { process.exit(); } return; } // If the file is closed and there is no more in-flight data, exit.
                        var loops = (cmd.action == 'uploadstart') ? 16 : 1; // If this is the first data to be sent, hot start now. We are going to have 16 blocks of data in-flight.
                        for (var i = 0; i < loops; i++) {
                            if (settings.uploadFile == null) continue;
                            var buf = Buffer.alloc(65565);
                            var len = require('fs').readSync(settings.uploadFile, buf, 1, 65564, settings.uploadPtr);
                            var start = 1;
                            settings.uploadPtr += len;
                            if (len > 0) {
                                if ((buf[1] == 0) || (buf[1] == 123)) { start = 0; buf[0] = 0; len++; } // If the buffer starts with 0 or 123, we must add an extra 0 at the start of the buffer
                                settings.inFlight++;
                                settings.tunnelws.send(buf.slice(start, start + len));
                            } else {
                                console.log('Upload done, ' + settings.uploadPtr + ' bytes sent.');
                                if (settings.uploadFile != null) { require('fs').closeSync(settings.uploadFile); delete settings.uploadFile; }
                                if (settings.inFlight == 0) { process.exit(); return; } // File is closed, if there is no more in-flight data, exit.
                            }
                        }

                    } else if (cmd.action == 'uploaderror') {
                        if (settings.uploadFile != null) { require('fs').closeSync(settings.uploadFile); }
                        console.log('Upload error.');
                        process.exit();
                    }
                }
            } else if (settings.tunnelwsstate == 0) {
                var data = rawdata.toString();
                if (data == 'c') { console.log('Connected.'); } else if (data == 'cr') { console.log('Connected, session is being recorded.'); } else return;
                settings.tunnelwsstate = 1;
                settings.tunnelws.send('5'); // Files
                settings.uploadSize = require('fs').statSync(args.file).size;
                settings.uploadFile = require('fs').openSync(args.file, 'r');
                settings.uploadPtr = 0;
                settings.inFlight = 1;
                console.log('Uploading...');
                settings.tunnelws.send(JSON.stringify({ action: 'upload', reqid: 'up', path: args.target, name: require('path').basename(args.file), size: settings.uploadSize }));
            }
        });
    } else if (settings.cmd == 'download') {
        // This code does all of the work for a file download
        // node meshctrl download --id oL4Y6Eg0qjnpHFrp1AxfxnBPenbDGnDSkC@HSOnAheIyd51pKhqSCUgJZakzwfKl --file c:\temp\MC-8Languages.png --target c:\temp\bob.png
        settings.tunnelws.on('message', function (rawdata) {
            if (settings.tunnelwsstate == 1) {
                if ((rawdata.length > 0) && (rawdata[0] != '{')) {
                    // This is binary data, this test is ok because 4 first bytes is a control value.
                    if ((rawdata.length > 4) && (settings.downloadFile != null)) { settings.downloadSize += (rawdata.length - 4); require('fs').writeSync(settings.downloadFile, rawdata, 4, rawdata.length - 4); }
                    if ((rawdata[3] & 1) != 0) { // Check end flag
                        // File is done, close everything.
                        if (settings.downloadFile != null) { require('fs').closeSync(settings.downloadFile); }
                        console.log('Download completed, ' + settings.downloadSize + ' bytes written.');
                        process.exit();
                    } else {
                        settings.tunnelws.send(JSON.stringify({ action: 'download', sub: 'ack', id: args.file })); // Send the ACK
                    }
                } else {
                    // This is text data
                    var cmd = null;
                    try { cmd = JSON.parse(rawdata.toString()); } catch (ex) { return; }
                    if (cmd.action == 'download') {
                        if (cmd.id != args.file) return;
                        if (cmd.sub == 'start') {
                            if ((args.target.endsWith('\\')) || (args.target.endsWith('/'))) { args.target += path.parse(args.file).name; }
                            try { settings.downloadFile = require('fs').openSync(args.target, 'w'); } catch (ex) { console.log("Unable to create file: " + args.target); process.exit(); return; }
                            settings.downloadSize = 0;
                            settings.tunnelws.send(JSON.stringify({ action: 'download', sub: 'startack', id: args.file }));
                            console.log('Download started: ' + args.target);
                        } else if (cmd.sub == 'cancel') {
                            if (settings.downloadFile != null) { require('fs').closeSync(settings.downloadFile); }
                            console.log('Download canceled.');
                            process.exit();
                        }
                    }
                }
            } else if (settings.tunnelwsstate == 0) {
                var data = rawdata.toString();
                if (data == 'c') { console.log('Connected.'); } else if (data == 'cr') { console.log('Connected, session is being recorded.'); } else return;
                settings.tunnelwsstate = 1;
                settings.tunnelws.send('5'); // Files
                settings.tunnelws.send(JSON.stringify({ action: 'download', sub: 'start', id: args.file, path: args.file }));
            }
        });
    }
}

// Encode an object as a cookie using a key using AES-GCM. (key must be 32 bytes or more)
function encodeCookie(o, key) {
    try {
        if (key == null) { return null; }
        o.time = Math.floor(Date.now() / 1000); // Add the cookie creation time
        const iv = Buffer.from(crypto.randomBytes(12), 'binary'), cipher = crypto.createCipheriv('aes-256-gcm', key.slice(0, 32), iv);
        const crypted = Buffer.concat([cipher.update(JSON.stringify(o), 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), crypted]).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    } catch (e) { return null; }
}

// Generate a random Intel AMT password
function checkAmtPassword(p) { return (p.length > 7) && (/\d/.test(p)) && (/[a-z]/.test(p)) && (/[A-Z]/.test(p)) && (/\W/.test(p)); }
function getRandomAmtPassword() { var p; do { p = Buffer.from(crypto.randomBytes(9), 'binary').toString('base64').split('/').join('@'); } while (checkAmtPassword(p) == false); return p; }
function getRandomHex(count) { return Buffer.from(crypto.randomBytes(count), 'binary').toString('hex'); }
function format(format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); };
function winRemoveSingleQuotes(str) { if (process.platform != 'win32') return str; else return str.split('\'').join(''); }

function csvFormatArray(x) {
    var y = [];
    for (var i in x) { if ((x[i] == null) || (x[i] == '')) { y.push(''); } else { y.push('"' + x[i].split('"').join('') + '"'); } }
    return y.join(',');
}

function displayDeviceInfo(sysinfo, lastconnect, network, nodes) {
    //console.log('displayDeviceInfo', sysinfo, lastconnect, network, nodes);

    // Fetch the node information
    var node = null;;
    if (sysinfo != null && (sysinfo.node != null)) {
        // Node information came with system information
        node = sysinfo.node;
    } else {
        // This device does not have system information, get node information from the nodes list.
        for (var m in nodes.nodes) {
            for (var n in nodes.nodes[m]) {
                if (nodes.nodes[m][n]._id.indexOf(args.id) >= 0) { node = nodes.nodes[m][n]; }
            }
        }
    }
    if (node == null) {
        console.log("Invalid device id");
        process.exit(); return;
    }

    var info = {};

    //if (network != null) { sysinfo.netif = network.netif; }
    if (lastconnect != null) { node.lastconnect = lastconnect.time; node.lastaddr = lastconnect.addr; }
    if (args.raw) { console.log(JSON.stringify(sysinfo, ' ', 2)); return; }

    // General
    var output = {}, outputCount = 0;
    if (node.name) { output["Server Name"] = node.name; outputCount++; }
    if (node.rname) { output["Computer Name"] = node.rname; outputCount++; }
    if (node.host != null) { output["Hostname"] = node.host; outputCount++; }
    if (node.ip != null) { output["IP Address"] = node.ip; outputCount++; }
    if (node.desc != null) { output["Description"] = node.desc; outputCount++; }
    if (node.icon != null) { output["Icon"] = node.icon; outputCount++; }
    if (node.tags) { output["Tags"] = node.tags; outputCount++; }
    if (node.av) {
        var av = [];
        for (var i in node.av) {
            if (typeof node.av[i]['product'] == 'string') {
                var n = node.av[i]['product'];
                if (node.av[i]['updated'] === true) { n += ', updated'; }
                if (node.av[i]['updated'] === false) { n += ', not updated'; }
                if (node.av[i]['enabled'] === true) { n += ', enabled'; }
                if (node.av[i]['enabled'] === false) { n += ', disabled'; }
                av.push(n);
            }
        }
        output["AntiVirus"] = av; outputCount++;
    }
    if (typeof node.wsc == 'object') {
        output["WindowsSecurityCenter"] = node.wsc; outputCount++;
    }
    if (outputCount > 0) { info["General"] = output; }

    // Operating System
    var hardware = null;
    if ((sysinfo != null) && (sysinfo.hardware != null)) { hardware = sysinfo.hardware; }
    if ((hardware && hardware.windows && hardware.windows.osinfo) || node.osdesc) {
        var output = {}, outputCount = 0;
        if (node.rname) { output["Name"] = node.rname; outputCount++; }
        if (node.osdesc) { output["Version"] = node.osdesc; outputCount++; }
        if (hardware && hardware.windows && hardware.windows.osinfo) { var m = hardware.windows.osinfo; if (m.OSArchitecture) { output["Architecture"] = m.OSArchitecture; outputCount++; } }
        if (outputCount > 0) { info["Operating System"] = output; }
    }

    // MeshAgent
    if (node.agent) {
        var output = {}, outputCount = 0;
        var agentsStr = ["Unknown", "Windows 32bit console", "Windows 64bit console", "Windows 32bit service", "Windows 64bit service", "Linux 32bit", "Linux 64bit", "MIPS", "XENx86", "Android", "Linux ARM", "macOS x86-32bit", "Android x86", "PogoPlug ARM", "Android", "Linux Poky x86-32bit", "macOS x86-64bit", "ChromeOS", "Linux Poky x86-64bit", "Linux NoKVM x86-32bit", "Linux NoKVM x86-64bit", "Windows MinCore console", "Windows MinCore service", "NodeJS", "ARM-Linaro", "ARMv6l / ARMv7l", "ARMv8 64bit", "ARMv6l / ARMv7l / NoKVM", "MIPS24KC (OpenWRT)", "Apple Silicon", "FreeBSD x86-64", "Unknown", "Linux ARM 64 bit (glibc/2.24 NOKVM)", "Alpine Linux x86 64 Bit (MUSL)", "Assistant (Windows)", "Armada370 - ARM32/HF (libc/2.26)", "OpenWRT x86-64", "OpenBSD x86-64", "Unknown", "Unknown", "MIPSEL24KC (OpenWRT)", "ARMADA/CORTEX-A53/MUSL (OpenWRT)", "Windows ARM 64bit console", "Windows ARM 64bit service"];
        if ((node.agent != null) && (node.agent.id != null) && (node.agent.ver != null)) {
            var str = '';
            if (node.agent.id <= agentsStr.length) { str = agentsStr[node.agent.id]; } else { str = agentsStr[0]; }
            if (node.agent.ver != 0) { str += ' v' + node.agent.ver; }
            output["Mesh Agent"] = str; outputCount++;
        }
        if ((node.conn & 1) != 0) {
            output["Last agent connection"] = "Connected now"; outputCount++;
        } else {
            if (node.lastconnect) { output["Last agent connection"] = new Date(node.lastconnect).toLocaleString(); outputCount++; }
        }
        if (node.lastaddr) {
            var splitip = node.lastaddr.split(':');
            if (splitip.length > 2) {
                output["Last agent address"] = node.lastaddr; outputCount++; // IPv6
            } else {
                output["Last agent address"] = splitip[0]; outputCount++; // IPv4
            }
        }
        if ((node.agent != null) && (node.agent.tag != null)) {
            output["Tag"] = node.agent.tag; outputCount++;
        }
        if (outputCount > 0) { info["Mesh Agent"] = output; }
    }

    // Networking
    if (network.netif != null) {
        var output = {}, outputCount = 0, minfo = {};
        for (var i in network.netif) {
            var m = network.netif[i], moutput = {}, moutputCount = 0;
            if (m.desc) { moutput["Description"] = m.desc; moutputCount++; }
            if (m.mac) {
                if (m.gatewaymac) {
                    moutput["MAC Layer"] = format("MAC: {0}, Gateway: {1}", m.mac, m.gatewaymac); moutputCount++;
                } else {
                    moutput["MAC Layer"] = format("MAC: {0}", m.mac); moutputCount++;
                }
            }
            if (m.v4addr && (m.v4addr != '0.0.0.0')) {
                if (m.v4gateway && m.v4mask) {
                    moutput["IPv4 Layer"] = format("IP: {0}, Mask: {1}, Gateway: {2}", m.v4addr, m.v4mask, m.v4gateway); moutputCount++;
                } else {
                    moutput["IPv4 Layer"] = format("IP: {0}", m.v4addr); moutputCount++;
                }
            }
            if (moutputCount > 0) { minfo[m.name + (m.dnssuffix ? (', ' + m.dnssuffix) : '')] = moutput; info["Networking"] = minfo; }
        }
    }

    if (network.netif2 != null) {
        var minfo = {};
        for (var i in network.netif2) {
            var m = network.netif2[i], moutput = {}, moutputCount = 0;

            if (Array.isArray(m) == false ||
                m.length < 1 ||
                m[0] == null ||
                ((typeof m[0].mac == 'string') && (m[0].mac.startsWith('00:00:00:00')))
            )
                continue;

            var ifTitle = '' + i;
            if (m[0].fqdn != null && m[0].fqdn != '') ifTitle += ', ' + m[0].fqdn;

            if (typeof m[0].mac == 'string') {
                if (m[0].gatewaymac) {
                    moutput['MAC Layer'] = format("MAC: {0}, Gateway: {1}", m[0].mac, m[0].gatewaymac);
                } else {
                    moutput['MAC Layer'] = format("MAC: {0}", m[0].mac);
                }
                moutputCount++;
            }

            moutput['IPv4 Layer'] = '';
            moutput['IPv6 Layer'] = '';
            for (var j = 0; j < m.length; j++) {
                var iplayer = m[j];
                if (iplayer.family == 'IPv4' || iplayer.family == 'IPv6') {
                    if (iplayer.gateway && iplayer.netmask) {
                        moutput[iplayer.family + ' Layer'] += format("IP: {0}, Mask: {1}, Gateway: {2}  ", iplayer.address, iplayer.netmask, iplayer.gateway);
                        moutputCount++;
                    } else {
                        if (iplayer.address) {
                            moutput[iplayer.family + ' Layer'] += format("IP: {0}  ", iplayer.address);
                            moutputCount++;
                        }
                    }
                }
            }
            if (moutput['IPv4 Layer'] == '') delete moutput['IPv4 Layer'];
            if (moutput['IPv6 Layer'] == '') delete moutput['IPv6 Layer'];
            if (moutputCount > 0) {
                minfo[ifTitle] = moutput;
                info["Networking"] = minfo;
            }
        }
    }

    // Intel AMT
    if (node.intelamt != null) {
        var output = {}, outputCount = 0;
        output["Version"] = (node.intelamt.ver) ? ('v' + node.intelamt.ver) : ('<i>' + "Unknown" + '</i>'); outputCount++;
        var provisioningStates = { 0: "Not Activated (Pre)", 1: "Not Activated (In)", 2: "Activated" };
        var provisioningMode = '';
        if ((node.intelamt.state == 2) && node.intelamt.flags) { if (node.intelamt.flags & 2) { provisioningMode = (', ' + "Client Control Mode (CCM)"); } else if (node.intelamt.flags & 4) { provisioningMode = (', ' + "Admin Control Mode (ACM)"); } }
        output["Provisioning State"] = ((node.intelamt.state) ? (provisioningStates[node.intelamt.state]) : ('<i>' + "Unknown" + '</i>')) + provisioningMode; outputCount++;
        output["Security"] = (node.intelamt.tls == 1) ? "Secured using TLS" : "TLS is not setup"; outputCount++;
        output["Admin Credentials"] = (node.intelamt.user == null || node.intelamt.user == '') ? "Not Known" : "Known"; outputCount++;
        if (outputCount > 0) { info["Intel Active Management Technology (Intel AMT)"] = output; }
    }

    if (hardware != null) {
        if (hardware.identifiers) {
            var output = {}, outputCount = 0, ident = hardware.identifiers;
            // BIOS
            if (ident.bios_vendor) { output["Vendor"] = ident.bios_vendor; outputCount++; }
            if (ident.bios_version) { output["Version"] = ident.bios_version; outputCount++; }
            if (outputCount > 0) { info["BIOS"] = output; }
            output = {}, outputCount = 0;

            // Motherboard
            if (ident.board_vendor) { output["Vendor"] = ident.board_vendor; outputCount++; }
            if (ident.board_name) { output["Name"] = ident.board_name; outputCount++; }
            if (ident.board_serial && (ident.board_serial != '')) { output["Serial"] = ident.board_serial; outputCount++; }
            if (ident.board_version) { output["Version"] = ident.board_version; }
            if (ident.product_uuid) { output["Identifier"] = ident.product_uuid; }
            if (ident.cpu_name) { output["CPU"] = ident.cpu_name; }
            if (ident.gpu_name) { for (var i in ident.gpu_name) { output["GPU" + (parseInt(i) + 1)] = ident.gpu_name[i]; } }
            if (outputCount > 0) { info["Motherboard"] = output; }
        }

        // Memory
        if (hardware.windows) {
            if (hardware.windows.memory) {
                var output = {}, outputCount = 0, minfo = {};
                hardware.windows.memory.sort(function (a, b) { if (a.BankLabel > b.BankLabel) return 1; if (a.BankLabel < b.BankLabel) return -1; return 0; });
                for (var i in hardware.windows.memory) {
                    var m = hardware.windows.memory[i], moutput = {}, moutputCount = 0;
                    if (m.Capacity) { moutput["Capacity/Speed"] = (m.Capacity / 1024 / 1024) + " Mb, " + m.Speed + " Mhz"; moutputCount++; }
                    if (m.PartNumber) { moutput["Part Number"] = ((m.Manufacturer && m.Manufacturer != 'Undefined') ? (m.Manufacturer + ', ') : '') + m.PartNumber; moutputCount++; }
                    if (moutputCount > 0) { minfo[m.BankLabel] = moutput; info["Memory"] = minfo; }
                }
            }
        }

        // Storage
        if (hardware.identifiers && ident.storage_devices) {
            var output = {}, outputCount = 0, minfo = {};
            // Sort Storage
            ident.storage_devices.sort(function (a, b) { if (a.Caption > b.Caption) return 1; if (a.Caption < b.Caption) return -1; return 0; });
            for (var i in ident.storage_devices) {
                var m = ident.storage_devices[i], moutput = {};
                if (m.Size) {
                    if (m.Model && (m.Model != m.Caption)) { moutput["Model"] = m.Model; outputCount++; }
                    if ((typeof m.Size == 'string') && (parseInt(m.Size) == m.Size)) { m.Size = parseInt(m.Size); }
                    if (typeof m.Size == 'number') { moutput["Capacity"] = Math.floor(m.Size / 1024 / 1024) + 'Mb'; outputCount++; }
                    if (typeof m.Size == 'string') { moutput["Capacity"] = m.Size; outputCount++; }
                    if (moutputCount > 0) { minfo[m.Caption] = moutput; info["Storage"] = minfo; }
                }
            }
        }
    }

    // Display everything
    if (args.json) {
        console.log(JSON.stringify(info, ' ', 2));
    } else {
        for (var i in info) {
            console.log('--- ' + i + ' ---');
            for (var j in info[i]) {
                if ((typeof info[i][j] == 'string') || (typeof info[i][j] == 'number')) {
                    console.log('  ' + j + ': ' + info[i][j]);
                } else {
                    console.log('  ' + j + ':');
                    for (var k in info[i][j]) {
                        console.log('    ' + k + ': ' + info[i][j][k]);
                    }
                }
            }
        }
    }
}

// Read the Mesh Agent error log and index it.
function indexAgentErrorLog() {
    // Index the messages
    const lines = require('fs').readFileSync('../meshcentral-data/agenterrorlogs.txt', { encoding: 'utf8', flag: 'r' }).split('\r\n');
    var errorIndex = {}; // "msg" --> [ { lineNumber, elemenetNumber } ]
    for (var i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 88) {
            var nodeid = line.substring(0, 70);
            var fetchTime = parseInt(line.substring(72, 85));
            var data = JSON.parse(line.substring(87));
            if ((data != null) && (data.action == 'errorlog') && (Array.isArray(data.log))) {
                for (var j = 0; j < data.log.length; j++) {
                    var entry = data.log[j];
                    if ((entry != null) && (typeof entry.t == 'number') && (typeof entry.m == 'string')) {
                        const msg = entry.m;
                        if (errorIndex[msg] == null) { errorIndex[msg] = []; }
                        errorIndex[msg].push({ l: i, e: j });
                    }
                }
            }
        }
    }

    // Sort the messages by frequency
    var errorIndexCount = []; // [ { m: "msg", c: count } ]
    for (var i in errorIndex) { errorIndexCount.push({ m: i, c: errorIndex[i].length }); }
    errorIndexCount = errorIndexCount.sort(function (a, b) { return b.c - a.c })

    // Display the results
    for (var i = 0; i < errorIndexCount.length; i++) {
        const m = errorIndexCount[i].m;
        if ((m.indexOf('STUCK') >= 0) || (m.indexOf('FATAL') >= 0)) { console.log(errorIndexCount[i].c, m); }
    }
}
