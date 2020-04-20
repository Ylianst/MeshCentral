#!/usr/bin/env node

// Make sure we have the dependency modules
try { require('minimist'); } catch (ex) { console.log('Missing module "minimist", type "npm install minimist" to install it.'); return; }
try { require('ws'); } catch (ex) { console.log('Missing module "ws", type "npm install ws" to install it.'); return; }

var settings = {};
const crypto = require('crypto');
const args = require('minimist')(process.argv.slice(2));
const possibleCommands = ['listusers', 'listdevicegroups', 'listdevices', 'listusersofdevicegroup', 'serverinfo', 'userinfo', 'adduser', 'removeuser', 'adddevicegroup', 'removedevicegroup', 'broadcast', 'showevents', 'addusertodevicegroup', 'removeuserfromdevicegroup', 'addusertodevice', 'removeuserfromdevice', 'sendinviteemail', 'generateinvitelink', 'config', 'movetodevicegroup'];
if (args.proxy != null) { try { require('https-proxy-agent'); } catch (ex) { console.log('Missing module "https-proxy-agent", type "npm install https-proxy-agent" to install it.'); return; } }

if (args['_'].length == 0) {
    console.log("MeshCtrl performs command line actions on a MeshCentral server.");
    console.log("Information at: https://meshcommander.com/meshcentral");
    console.log("No action specified, use MeshCtrl like this:\r\n\r\n  meshctrl [action] [arguments]\r\n");
    console.log("Supported actions:");
    console.log("  Help [action]             - Get help on an action.");
    console.log("  ServerInfo                - Show server information.");
    console.log("  UserInfo                  - Show user information.");
    console.log("  ListUsers                 - List user accounts.");
    console.log("  ListDevices               - List devices.");
    console.log("  ListDeviceGroups          - List device groups.");
    console.log("  ListUsersOfDeviceGroup    - List the users in a device group.");
    console.log("  Config                    - Perform operation on config.json file.");
    console.log("  AddUser                   - Create a new user account.");
    console.log("  RemoveUser                - Delete a user account.");
    console.log("  AddDeviceGroup            - Create a new device group.");
    console.log("  RemoveDeviceGroup         - Delete a device group.");
    console.log("  MoveToDeviceGroup         - Move a device to a different device group.");
    console.log("  AddUserToDeviceGroup      - Add a user to a device group.");
    console.log("  RemoveUserFromDeviceGroup - Remove a user from a device group.");
    console.log("  AddUserToDevice           - Add a user to a device.");
    console.log("  RemoveUserFromDevice      - Remove a user from a device.");
    console.log("  SendInviteEmail           - Send an agent install invitation email.");
    console.log("  GenerateInviteLink        - Create an invitation link.");
    console.log("  Broadcast                 - Display a message to all online users.");
    console.log("  ShowEvents                - Display real-time server events in JSON format.");
    console.log("\r\nSupported login arguments:");
    console.log("  --url [wss://server]      - Server url, wss://localhost:443 is default.");
    console.log("  --loginuser [username]    - Login username, admin is default.");
    console.log("  --loginpass [password]    - Login password.");
    console.log("  --token [number]          - 2nd factor authentication token.");
    console.log("  --loginkey [hex]          - Server login key in hex.");
    console.log("  --loginkeyfile [file]     - File containing server login key in hex.");
    console.log("  --domain [domainid]       - Domain id, default is empty, only used with loginkey.");
    console.log("  --proxy [http://proxy:1]  - Specify an HTTP proxy.");
    return;
} else {
    settings.cmd = args['_'][0].toLowerCase();
    if ((possibleCommands.indexOf(settings.cmd) == -1) && (settings.cmd != 'help')) { console.log("Invalid command. Possible commands are: " + possibleCommands.join(', ') + '.'); return; }
    //console.log(settings.cmd);

    var ok = false;
    switch (settings.cmd) {
        case 'config': { performConfigOperations(args); return; }
        case 'serverinfo': { ok = true; break; }
        case 'userinfo': { ok = true; break; }
        case 'listusers': { ok = true; break; }
        case 'listdevicegroups': { ok = true; break; }
        case 'listdevices': { ok = true; break; }
        case 'listusersofdevicegroup': {
            if (args.id == null) { console.log("Missing group id, use --id [groupid]"); }
            else { ok = true; }
            break;
        }
        case 'addusertodevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else if (args.userid == null) { console.log("Add user to group missing useid, use --userid [userid]"); }
            else { ok = true; }
            break;
        }
        case 'removeuserfromdevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else if (args.userid == null) { console.log("Remove user from group missing useid, use --userid [userid]"); }
            else { ok = true; }
            break;
        }
        case 'addusertodevice': {
            if (args.userid == null) { console.log("Add user to device missing useid, use --userid [userid]"); }
            else if (args.id == null) { console.log("Add user to device missing device id, use --id [deviceid]"); }
            else { ok = true; }
            break;
        }
        case 'removeuserfromdevice': {
            if (args.userid == null) { console.log("Remove user from device missing useid, use --userid [userid]"); }
            else if (args.id == null) { console.log("Remove user from device missing device id, use --id [deviceid]"); }
            else { ok = true; }
            break;
        }
        case 'adddevicegroup': {
            if (args.name == null) { console.log("Message group name, use --name [name]"); }
            else { ok = true; }
            break;
        }
        case 'removedevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else { ok = true; }
            break;
        }
        case 'movetodevicegroup': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else if (args.devid == null) { console.log("Device identifier missing, use --devid [deviceid]"); }
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
        case 'removeuser': {
            if (args.userid == null) { console.log("Remove account userid missing, use --userid [id]"); }
            else { ok = true; }
            break;
        }
        case 'sendinviteemail': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else if (args.email == null) { console.log("Device email is missing, use --email [email]"); }
			else { ok = true; }
            break;
        }
        case 'generateinvitelink': {
            if ((args.id == null) && (args.group == null)) { console.log("Device group identifier missing, use --id [groupid] or --group [groupname]"); }
            else if (args.hours == null) { console.log("Invitation validity period missing, use --hours [hours]"); }
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
                        console.log("  MeshCtrl SendInviteEmail --id devicegroupid --message \"msg\" --email user@sample.com");
                        console.log("  MeshCtrl SendInviteEmail --group \"My Computers\" --name \"Jack\" --email user@sample.com");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --email [email]        - Email address.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --name (name)          - Name of recipient to be included in the email.");
						console.log("  --message (msg)        - Message to be included in the email.");
                        break;
                    }
                    case 'generateinvitelink': {
                        console.log("Generate a agent invitation URL for a given group. Example usage:\r\n");
                        console.log("  MeshCtrl GenerateInviteLink --id devicegroupid --hours 24");
                        console.log("  MeshCtrl GenerateInviteLink --group \"My Computers\" --hours 0");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --hours [hours]        - Validity period in hours or 0 for infinit.");
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
                    case 'listdevicegroups': {
                        console.log("List the device groups for this account, Example usages:\r\n");
                        console.log("  MeshCtrl ListDeviceGroups ");
                        console.log("  MeshCtrl ListDeviceGroups --json");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --idexists [id]        - Return 1 if id exists, 0 if not.");
                        console.log("  --nameexists [name]    - Return id if name exists.");
                        console.log("  --emailexists [email]  - Return id if email exists.");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listdevices': {
                        console.log("List devices, Example usages:\r\n");
                        console.log("  MeshCtrl ListDevices");
                        console.log("  MeshCtrl ListDevices -id [groupid] --json");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --id [groupid]         - Filter by  group identifier (or --group).");
                        console.log("  --group [groupname]    - Filter by  group name (or --id).");
                        console.log("  --count                - Only return the device count.");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'listusersofdevicegroup': {
                        console.log("List users that have permissions for a given device group, Example usage:\r\n");
                        console.log("  MeshCtrl ListUserOfDeviceGroup ");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --json                 - Show result as JSON.");
                        break;
                    }
                    case 'adduser': {
                        console.log("Add a new user account, Example usages:\r\n");
                        console.log("  MeshCtrl AddUser --user newaccountname --pass newpassword");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --user [name]          - New account name.");
                        console.log("  --pass [password]      - New account password.");
                        console.log("  --randompass           - Create account with a random password.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --email [email]        - New account email address.");
                        console.log("  --emailverified        - New account email is verified.");
                        console.log("  --resetpass            - Request password reset on next login.");
                        console.log("  --siteadmin            - Create the account as full site administrator.");
                        console.log("  --manageusers          - Allow this account to manage server users.");
                        console.log("  --fileaccess           - Allow this account to store server files.");
                        console.log("  --serverupdate         - Allow this account to update the server.");
                        console.log("  --locked               - This account will be locked.");
                        console.log("  --nonewgroups          - Account will not be allowed to create device groups.");
                        console.log("  --notools              - Account not see MeshCMD download links.");
                        break;
                    }
                    case 'removeuser': {
                        console.log("Delete a user account, Example usages:\r\n");
                        console.log("  MeshCtrl RemoveUser --userid accountid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --userid [id]          - Account identifier.");
                        break;
                    }
                    case 'adddevicegroup': {
                        console.log("Add a device group, Example usages:\r\n");
                        console.log("  MeshCtrl AddDeviceGroup --name newgroupname");
                        console.log("  MeshCtrl AddDeviceGroup --name newgroupname --desc description --amtonly");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --name [name]          - Name of the new group.");
                        console.log("\r\nOptional arguments:\r\n");
                        console.log("  --desc [description]   - New group description.");
                        console.log("  --amtonly              - New group is agent-less, Intel AMT only.");
                        break;
                    }
                    case 'removedevicegroup': {
                        console.log("Remove a device group, Example usages:\r\n");
                        console.log("  MeshCtrl RemoveDeviceGroup --id groupid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        break;
                    }
                    case 'movetodevicegroup': {
                        console.log("Move a device to a new device group, Example usages:\r\n");
                        console.log("  MeshCtrl MoveToDeviceGroup --devid deviceid --id groupid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --devid [deviceid]     - Device identifier.");
                        break;
                    }
                    case 'addusertodevicegroup': {
                        console.log("Add a user to a device group, Example usages:\r\n");
                        console.log("  MeshCtrl AddUserToDeviceGroup --id groupid --userid userid --fullrights");
                        console.log("  MeshCtrl AddUserToDeviceGroup --group groupname --userid userid --editgroup --manageusers");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
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
                        console.log("  MeshCtrl RemoveuserFromDeviceGroup --id groupid --userid userid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [groupid]         - Device group identifier (or --group).");
                        console.log("  --group [groupname]    - Device group name (or --id).");
                        console.log("  --userid [userid]      - The user identifier.");
                        break;
                    }
                    case 'addusertodevice': {
                        console.log("Add a user to a device, Example usages:\r\n");
                        console.log("  MeshCtrl AddUserToDevice --id deviceid --userid userid --fullrights");
                        console.log("  MeshCtrl AddUserToDevice --id deviceid --userid userid --remotecontrol");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [deviceid]        - The device identifier.");
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
                        console.log("  MeshCtrl RemoveuserFromDeviceGroup --id deviceid --userid userid");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --id [deviceid]        - The device identifier.");
                        console.log("  --userid [userid]      - The user identifier.");
                        break;
                    }
                    case 'broadcast': {
                        console.log("Display a message to all logged in users, Example usages:\r\n");
                        console.log("  MeshCtrl Broadcast --msg \"This is a test\"");
                        console.log("\r\nRequired arguments:\r\n");
                        console.log("  --msg [message]        - Message to display.");
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
    var domainValues = ['title', 'title2', 'titlepicture', 'trustedcert', 'welcomepicture', 'welcometext', 'userquota', 'meshquota', 'newaccounts', 'usernameisemail', 'newaccountemaildomains', 'newaccountspass', 'newaccountsrights', 'geolocation', 'lockagentdownload', 'userconsentflags', 'Usersessionidletimeout', 'auth', 'ldapoptions', 'ldapusername', 'ldapuserbinarykey', 'ldapoptions', 'footer', 'certurl', 'loginKey', 'userallowedip', 'agentallowedip', 'agentnoproxy', 'agentconfig', 'orphanagentuser', 'httpheaders', 'yubikey', 'passwordrequirements', 'limits', 'amtacmactivation', 'redirects', 'sessionrecording', 'hide', 'loginkey'];
    var domainObjectValues = [ 'ldapoptions', 'httpheaders', 'yubikey', 'passwordrequirements', 'limits', 'amtacmactivation', 'redirects', 'sessionrecording' ];
    var domainArrayValues = [ 'newaccountemaildomains', 'newaccountsrights', 'loginkey', 'agentconfig' ];
    var configChange = false;
    var fs = require('fs');
    var path = require('path');
    var configFile = path.join(__dirname, 'config.json');
    var didSomething = 0;
    if (fs.existsSync(configFile) == false) { configFile = path.join('meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, 'meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { configFile = path.join(__dirname, '..', 'meshcentral-data', 'config.json'); }
    if (fs.existsSync(configFile) == false) { console.log("Unable to find config.json."); return; }
    var config = null;
    try { config = fs.readFileSync(configFile); } catch (ex) { console.log("Error: Unable to read config.json"); return; }
    try { config = JSON.parse(config); } catch (ex) { console.log("Error: Unable to parse config.json"); return; }
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
        if (url.endsWith('/') == false) { url += '/'; }
        url += 'control.ashx';
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
    } else {
        if (args.domain != null) { console.log("--domain can only be used along with --loginkey."); process.exit(); return; }
    }

    const ws = new WebSocket(url, options);
    //console.log('Connecting to ' + url);

    ws.on('open', function open() {
        //console.log('Connected.');
        switch (settings.cmd) {
            case 'serverinfo': { break; }
            case 'userinfo': { break; }
            case 'listusers': { ws.send(JSON.stringify({ action: 'users' })); break; }
            case 'listdevicegroups': { ws.send(JSON.stringify({ action: 'meshes' })); break; }
            case 'listusersofdevicegroup': { ws.send(JSON.stringify({ action: 'meshes' })); break; }
            case 'listdevices': {
                if (args.group) {
                    ws.send(JSON.stringify({ action: 'nodes', meshname: args.group, responseid: 'meshctrl' })); break;
                } else if (args.id) {
                    ws.send(JSON.stringify({ action: 'nodes', meshid: args.id, responseid: 'meshctrl' })); break;
                } else {
                    ws.send(JSON.stringify({ action: 'meshes' }));
                    ws.send(JSON.stringify({ action: 'nodes', responseid: 'meshctrl' })); break;
                }
            }
            case 'adduser': {
                var siteadmin = 0;
                if (args.siteadmin) { siteadmin = 0xFFFFFFFF; }
                if (args.manageusers) { siteadmin |= 2; }
                if (args.fileaccess) { siteadmin |= 8; }
                if (args.serverupdate) { siteadmin |= 16; }
                if (args.locked) { siteadmin |= 32; }
                if (args.nonewgroups) { siteadmin |= 64; }
                if (args.notools) { siteadmin |= 128; }
                if (args.randompass) { args.pass = getRandomAmtPassword(); }
                var op = { action: 'adduser', username: args.user, pass: args.pass, responseid: 'meshctrl' };
                if (args.email) { op.email = args.email; if (args.emailverified) { op.emailVerified = true; } }
                if (args.resetpass) { op.resetNextLogin = true; }
                if (siteadmin != 0) { op.siteadmin = siteadmin; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removeuser': {
                var op = { action: 'deleteuser', userid: args.userid, responseid: 'meshctrl' };
                ws.send(JSON.stringify(op));
                break;
            }
            case 'adddevicegroup': {
                var op = { action: 'createmesh', meshname: args.name, meshtype: 2, responseid: 'meshctrl' };
                if (args.desc) { op.desc = args.desc; }
                if (args.amtonly) { op.meshtype = 1; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'removedevicegroup': {
                var op = { action: 'deletemesh', responseid: 'meshctrl' };
                if (args.id) { op.meshid = args.id; } else if (args.group) { op.meshname = args.group; }
                ws.send(JSON.stringify(op));
                break;
            }
            case 'movetodevicegroup': {
                var op = { action: 'changeDeviceMesh', responseid: 'meshctrl', nodeids: [ args.devid ] };
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
                var op = { action: 'adddeviceuser', nodeid: args.id, usernames: [args.userid], rights: 0, responseid: 'meshctrl' };
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
                ws.send(JSON.stringify(op));
                break;
            }
            case 'broadcast': {
                var op = { action: 'userbroadcast', msg: args.msg, responseid: 'meshctrl' };
                ws.send(JSON.stringify(op));
                break;
            }
            case 'showevents': {
                console.log('Connected. Press ctrl-c to end.');
                break;
            }
        }
    });

    ws.on('close', function() { process.exit(); });
    ws.on('error', function (err) {
        if (err.code == 'ENOTFOUND') { console.log('Unable to resolve ' + url); }
        else if (err.code == 'ECONNREFUSED') { console.log('Unable to connect to ' + url); }
        else { console.log(err); }
        process.exit();
    });

    ws.on('message', function incoming(rawdata) {
        var data = null;
        try { data = JSON.parse(rawdata); } catch (ex) { }
        if (data == null) { console.log('Unable to parse data: ' + rawdata); }
        if (settings.cmd == 'showevents') {
            console.log(data);
            return;
        }
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
            case 'adduser': // ADDUSER
            case 'deleteuser': // REMOVEUSER
            case 'createmesh': // ADDDEVICEGROUP
            case 'deletemesh': // REMOVEDEVICEGROUP
            case 'changeDeviceMesh':
            case 'addmeshuser': //
            case 'removemeshuser': //
            case 'inviteAgent': //
            case 'adddeviceuser': //
            case 'userbroadcast': { // BROADCAST
                if (data.responseid == 'meshctrl') {
                    if (data.meshid) { console.log(data.result, data.meshid); }
                    else if (data.userid) { console.log(data.result, data.userid); }
                    else console.log(data.result);
                    process.exit();
                }
                break;
            }
            case 'createInviteLink':
                if (data.responseid == 'meshctrl') {
                    if (data.url) { console.log(data.url); }
                    else console.log(data.result);
                    process.exit();
                }
                break;
            case 'users': { // LISTUSERS
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
                if ((settings.cmd == 'listdevices') && (data.responseid == 'meshctrl')) {
                    if ((data.result != null) && (data.result != 'ok')) {
                        console.log(data.result);
                    } else {
                        if (args.count) {
                            // Return how many devices are in this group
                            var nodes = [];
                            for (var i in data.nodes) { var devicesInMesh = data.nodes[i]; for (var j in devicesInMesh) { nodes.push(devicesInMesh[j]); } }
                            console.log(nodes.length);
                        } else if (args.json) {
                            // Return all devices in JSON format
                            var nodes = [];
                            for (var i in data.nodes) { var devicesInMesh = data.nodes[i]; for (var j in devicesInMesh) { nodes.push(devicesInMesh[j]); } }
                            console.log(JSON.stringify(nodes, ' ', 2));
                        } else {
                            // Display the list of nodes in text format
                            var nodecount = 0;
                            for (var i in data.nodes) {
                                var devicesInMesh = data.nodes[i];
                                if (settings.xmeshes) { console.log('\r\nDevice group: \"' + settings.xmeshes[i].name + '\"'); }
                                console.log('id, name, icon, conn, pwr, ip\r\n-----------------------------');
                                for (var j in devicesInMesh) {
                                    var n = devicesInMesh[j];
                                    nodecount++;
                                    console.log(n._id.split('/')[2] + ', \"' + n.name + '\", ' + (n.icon ? n.icon : 0) + ', ' + (n.conn ? n.conn : 0) + ', ' + (n.pwr ? n.pwr : 0));
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
                        console.log('Invalid login.');
                    }
                }
                process.exit();
                break;
            }
            default: { break; }
        }
        //console.log('Data', data);
        //setTimeout(function timeout() { ws.send(Date.now()); }, 500);
    });
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
