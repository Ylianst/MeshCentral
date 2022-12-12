---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Server Software (please complete the following information):**
 - OS: [e.g. Ubuntu]
 - Virtualization: [e.g. Docker]
 - Network: [e.g. LAN/WAN, reverse proxy, cloudflare, ssl offload, etc...]
 - Version: [e.g. 1.0.43]
 - Node: [e.g. 18.4.0]

**Client Device (please complete the following information):**
 - Device: [e.g. Laptop]
 - OS: [e.g. Ubuntu]
 - Network: [e.g. Local to Meshcentral, Remote over WAN]
 - Browser: [e.g. Google Chrome]
 - MeshCentralRouter Version: [if applicable]

**Remote Device (please complete the following information):**
 - Device: [e.g. Laptop]
 - OS: [e.g. Windows 10 21H2]
 - Network: [e.g. Local to Meshcentral, Remote over WAN]
 - Current Core Version (if known): [**HINT**: Go to a device then `console` Tab then type `info`]

**Additional context**
Add any other context about the problem here.

**Your config.json file**
```
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment1__": "This is a simple configuration file, all values and sections that start with underscore (_) are ignored. Edit a section and remove the _ in front of the name. Refer to the user's guide for details.",
  "__comment2__": "See node_modules/meshcentral/sample-config-advanced.json for a more advanced example.",
  "settings": {
    "_cert": "myserver.mydomain.com",
    "_WANonly": true,
    "_LANonly": true,
    "_sessionKey": "MyReallySecretPassword1",
    "_port": 443,
    "_aliasPort": 443,
    "_redirPort": 80,
    "_redirAliasPort": 80
  },
  "domains": {
    "": {
      "_title": "MyServer",
      "_title2": "Servername",
      "_minify": true,
      "_newAccounts": true,
      "_userNameIsEmail": true
    }
  },
  "_letsencrypt": {
    "__comment__": "Requires NodeJS 8.x or better, Go to https://letsdebug.net/ first before trying Let's Encrypt.",
    "email": "myemail@mydomain.com",
    "names": "myserver.mydomain.com",
    "production": false
  }
}
```
