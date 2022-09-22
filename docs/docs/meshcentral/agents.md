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

For macOS 10.x including Catalina, Mojave, High Sierra, Sierra, El Capitan, Yosemite, Mavericks, Mountain Lion and earlier

## Mobile Device (Android)

## MeshCentral Assistant

See [Assistant](assistant.md)

## Apple MacOS Binary Installer
