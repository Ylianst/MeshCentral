---
name: Question
about: Create a question for community help
title: ''
labels: question
assignees: ''

---

**Describe your issue**
A clear and concise description of what your issue is.

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
