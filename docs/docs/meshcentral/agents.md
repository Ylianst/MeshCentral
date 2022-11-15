# Mesh Agents

## Windows

Default Install Path: `c:\Program Files\Mesh Agent`

Application Path: `c:\Program Files\Mesh Agent\meshagent.exe`

Application database Path: `c:\Program Files\Mesh Agent\meshagent.db`

Application Log Path: `c:\Program Files\Mesh Agent\meshagent.log`

xxx Path: `c:\Program Files\Mesh Agent\meshagent.msh`

=== ":material-console-line: Status"

    - Start: `net start "mesh agent"`
    - Stop: `net stop "mesh agent"`
    - Restart: `net restart "mesh agent"`
    - Status: Needs info

=== ":material-console-line: Troubleshooting"

    Troubleshooting steps: Needs info

## Linux / BSD

Uninstall: `sudo /usr/local/mesh_services/meshagent/[agent-name]/meshagent -fulluninstall`

## Apple macOS Binary Installer

Default Install Path: `/usr/local/mesh_services/meshagent/meshagent`

Launches from `/Library/LaunchAgents/meshagent.plist`

Controlling agent

```bash
launchctl stop meshagent
launchctl start meshagent
```

Install: 

Uninstall: `sudo /usr/local/mesh_services/meshagent/[agent-name]/meshagent -fulluninstall`

## Apple macOS Universal

For OSx 11+ including Big Sur, Monterey and later

## Apple macOS

For macOS 10.x including Catalina, Mojave, High Sierra, Sierra, El Capitan, Yosemite, Mavericks, Mountain Lion and earlier.

## Mobile Device (Android)

## MeshCentral Assistant

See [Assistant](assistant.md)

## Apple MacOS Binary Installer

## Agent Commands

**agentmsg** 
: Add/Remove badged messages to the device's web ui
```
  agentmsg add "[message]" [iconIndex]
  agentmsg remove [index]
  agentmsg list
```
**agentsize**
: Returns the binary size of the agent

**agentupdate**
: Manually trigger an agent self-update

**alert**
: Display an alert dialog on the logged in session
```
alert TITLE, CAPTION [, TIMEOUT]
```

**amt**

**amtconfig**

**amtevents**

**apf**

**args**

**av**
: Displays Antivirus State

**coredump**

**coreinfo**

**cpuinfo**

**cs**
: Display Windows Connected Standby State

**dbcompact**
: Compacts the agent database

**dbget**

**dbkeys**

**dbset**

**dnsinfo**
: Display DNS server info

**domain**
: Display domain metadata

**errorlog**

**eval**
: executes javascript on the agent
```
eval [code]
```

**fdcount**
: Returns the number of active descriptors in the event loop

**fdsnapshot**
: Returns detailed descriptor/handle/timer metadata

**getclip**
: Fetches clipboard data from agent

**getscript**

**help**
: Returns the list of supported console commands

**httpget**

**info**
: Returns general information about the agent, such as connected state, loaded modules, LMS state, etc

**kill**
: Sends a SIGKILL signal to the specified PID
```
kill [pid]
```

**kvmmode**
: Displays the KVM Message Format

**location**
: Displays saves location information about the connected agent

**lock**

**log**
: Writes a message to the logfile
```
log [message]
```

**ls**
: Enumerates the files in the agent's install folder

**mousetrails**
: Enables/Disables Mouse Trails Accessibility on Windows. To change setting, specify a positive integer representing the number of latent cursors, where 0 is disable
```
mousetrails [n]
```

**msh**
: Displays the loaded msh settings file

**netinfo**
: Displays network interface information

**notify**
: Display a notification on the web interface

**openurl**

**osinfo**
: Displays OS information

**parseuri**
: Parses the specified URI, and displays the parsed output
``` 
parseuri [uri]
```

**plugin**
: Invokes a plugin
```
plugin [pluginName] [args]
```

**power**
: Performs the specified power action
```
power [action]
  LOGOFF = 1
  SHUTDOWN = 2
  REBOOT = 3
  SLEEP = 4
  HIBERNATE = 5
  DISPLAYON = 6
  KEEPAWAKE = 7
  BEEP = 8
  CTRLALTDEL = 9
  VIBRATE = 13
  FLASH = 14
```

**print**

**privacybar**
: Sets/Gets the default pinned state of the Privacy Bar on windows
```
privacybar [PINNED|UNPINNED]
```

**ps**
: Enumerates processes on the agent

**rawsmbios**
: Fetches the raw smbios table

**safemode**
: Sets/Gets the SAFEMODE configuration of the agent, as well as the next boot state.
```
safemode (ON|OFF|STATUS)
```

**scanwifi**
: Scans the available Wifi access points, and displays the SSID and Signal Strength

**service**
: Shortcut to be able to restart the agent service
```
service status|restart
```

**setclip**
: Sets clipboard data to the agent
```
setclip [text]
```

**setdebug**
: Sets the location target for debug messages
```
setdebug [target]
0 = Disabled
1 = StdOut
2 = This Console
* = All Consoles
4 = WebLog
8 = Logfile
```

**smbios**
: Displays the parsed SMBIOS metadata

**startupoptions**
: Displays the command-line options that the agent was started with

**sysinfo**
: Collects and displays telemetry on the platform

**task**

**taskbar**
: Hides or shows the Windows System task bar, optionally on the specified Terminal Server Session ID
```
taskbar HIDE|SHOW [TSID]
```

**timerinfo**
: Displays metadata about any configured timers on the event loop

**toast**
: Displays a toast message on the logged in user's session
```
toast [message]
```

**translations**
: Shows the currently configured translations

**type**
```
type (filepath) [maxlength]
```

**uac**
: Get/Sets the Windows UAC mode
```
uac [get|interactive|secure]
```

**unzip**
```
unzip input, destination
```
: Unzips the specified file

**users**
: Enumerates the logged in users on the system

**versions**
: Displays version information about the agent

**vm**
: Detects if the system is a Virtual Machine

**volumes**
: Displays volume information reported by the OS

**wakeonlan**
: Sends wake-on-lan packets to the specified MAC address
```
wakeonlan [mac]
```

**wallpaper**
: Gets/Toggles the logged in user's desktop background image
```
wallpaper (GET|TOGGLE)
```

**wpfhwacceleration**
: Enable/Disable WPF HW Acceleration on Windows
```
wpfhwacceleration (ON|OFF|STATUS)
```

**wsclose**

**wsconnect**

**wslist**

**wssend**

**zip**
```
zip (output file name), input1 [, input n]
```
