# MeshCentral Codebase Navigation Guide

## Table of Contents
1. [File Manager Implementation](#file-manager-implementation)
2. [Key Pages and UI Components](#key-pages-and-ui-components)
3. [Server-Side Handlers](#server-side-handlers)
4. [Agent-Side Implementation](#agent-side-implementation)
5. [Function Call Patterns](#function-call-patterns)
6. [How to Identify Components](#how-to-identify-components)
7. [Commenting Conventions](#commenting-conventions)

---

## File Manager Implementation

### Client-Side UI
**Location:** `views/default.handlebars` (19,464 lines)

#### HTML Structure
- **Line 855-927:** Files tab (p13) HTML markup
  - Line 855: `<div id=p13 style="display:none">`
  - Line 888: Upload button with `onclick="p13uploadFile()"`
  - Line 889: Download button with `onclick="p13downloadButton()"`
  - Line 890: Zip button with `onclick="p13zipFiles()"`
  - Line 891: Unzip button with `onclick="p13unzipFiles()"`
  - Line 904: File tree display area `<div id=p13filetable>`

#### JavaScript Functions
- **Line 11178:** `CreateRemoteFiles()` - Initializes file transfer protocol
- **Line 11191:** `connectFiles()` - Establishes agent connection
- **Line 11229:** `p13gotFiles()` - Processes directory listings
- **Line 11285:** `p13setActions()` - Manages toolbar button states
- **Line 11335:** `p13folderUp()` - Navigate to parent directory
- **Line 11352:** `p13openfile()` - Open/navigate into folders
- **Line 11394:** `p13createFolderButton()` - Create new directory
- **Line 11424:** `p13deleteButton()` - Delete selected files/folders
- **Line 11467:** `p13renameButton()` - Rename files/folders
- **Line 11619:** `p13zipFiles()` - Create zip archive
- **Line 11660:** `p13unzipFiles()` - Extract zip archive
- **Line 11709:** `p13downloadfile()` - Download single file
- **Line 11760:** `p13downloadButton()` - Download button handler
- **Line 11729:** `p13gotDownloadBinaryData()` - Receive file chunks
- **Line 11811:** `p13uploadFile()` - Upload file to agent
- **Line 11955:** `p13uploadNextPart()` - Send file chunks

### Intel AMT File Manager
**Location:** `public/commander.htm` (minified, 1,452 lines)

- **Line 1267:** `p24downloadfile()` - AMT file download
- **Line 1258:** `p24uploadFile()` - AMT file upload
- **Line 941:** Embedded via iframe in default.handlebars

---

## Key Pages and UI Components

### Main Application Page
**File:** `views/default.handlebars`

#### Page Sections (identified by `<div id=pXX>`)
- **p0:** Welcome page (line ~600)
- **p1:** My Account page (line ~650)
- **p2:** New Account page
- **p3:** User management (line ~700)
- **p10:** Device details (line ~800)
- **p11:** Desktop remote control (line ~820)
- **p12:** Terminal console (line ~840)
- **p13:** File manager (line 855-927)
- **p14:** AMT desktop
- **p15:** Events page
- **p16:** Plugin management

#### How to Identify:
```javascript
// Pattern: setCurrentNode(node, panel)
QV('p13', meshrights & 8); // Show Files tab if REMOTECONTROL right
go(13); // Navigate to files page (p13)
```

### View Mode Query Parameter
- **Line 11191:** `if (urlargs.viewmode) { go(parseInt(urlargs.viewmode)); }`
- URL format: `?viewmode=13&gotonode=<nodeid>`
- Mapping: viewmode=13 → Files page (p13)

---

## Server-Side Handlers

### Main Web Server
**File:** `webserver.js` (10,349 lines)

#### Key Endpoints
- **Line 7007-7008:** `devicefile.ashx` - File download relay
  ```javascript
  app.ws(url + 'devicefile.ashx', handleDeviceFile);
  app.get(url + 'devicefile.ashx', handleDeviceFile);
  ```
- **Line 7022:** `meshrelay.ashx` - Main agent relay
- **Line 7103:** `sshfilesrelay.ashx` - SFTP file relay
- **Line 3927-3954:** `handleDeviceFile()` - Authentication and setup

### File Download Relay Module
**File:** `meshdevicefile.js` (313 lines)

- **Line 16:** `CreateMeshDeviceFile()` - Main relay handler
- **Line 36-46:** Mesh rights constants
  ```javascript
  const MESHRIGHT_REMOTECONTROL = 8; // Required for file access
  const MESHRIGHT_NOFILES = 1024;    // Blocks file access
  ```
- **Line 158:** Sends protocol 10 (FileTransfer) to agent
- **Line 214-232:** Binary data streaming between peers
- **Line 296-307:** Content-Disposition headers for downloads

#### How to Identify File Operations:
```javascript
// URL pattern:
devicefile.ashx?c=<authCookie>&m=<meshid>&n=<nodeid>&f=<filepath>

// Protocol sent to agent:
Buffer.from(String.fromCharCode(0x0A)) // 0x0A = 10 = FileTransfer
```

### User Session Handler
**File:** `meshuser.js` (8,391 lines)

- Handles WebSocket commands from authenticated users
- Routes file operation requests to agents
- Lines contain JSON command handlers

---

## Agent-Side Implementation

### Core Agent Module
**File:** `agents/meshcore.js` (6,183 lines)

#### Protocol Handler
- **Line 3278-3375:** Protocol 5 (Files) entry point
- **Line 3284:** Rights check
  ```javascript
  if ((this.httprequest.protocol == 5) && (((tunnelUserCount.present > 0) ?
      this.httprequest.consent : 0) & 0x08) == 0) { ... }
  ```

#### File Operations
- **Line 3399-3425:** `case 'ls':` - Directory listing
  ```javascript
  this.write(Buffer.from(JSON.stringify({ action: 'pathinfo',
      path: this.httprequest.currentFile, ... })));
  ```
- **Line 3427-3431:** `case 'mkdir':` - Create directory
- **Line 3433-3448:** `case 'rm':` - Delete files/folders
- **Line 3477-3483:** `case 'rename':` - Rename files
- **Line 3526-3575:** `case 'upload':` - Upload handler
- **Line 3576-3584:** `case 'copy':` - Copy files
- **Line 3586-3594:** `case 'move':` - Move files
- **Line 3596-3624:** `case 'zip':` - Create zip archive
- **Line 3625-3642:** `case 'unzip':` - Extract zip archive

#### Directory Info Function
- **Line 1989-2028:** `function getDirectoryInfo(path)`
  - Returns file metadata: name, type, size, date
  - Types: 1=Drive, 2=Directory, 3=File

#### Zip/Unzip Implementation
```javascript
// Line 3596-3624: Zip creation
require('zip-writer').write({ files: p, basePath: cmd.path })

// Line 3625-3642: Unzip extraction
require('zip-reader').read(cmd.input).then(...)
```

### Helper Modules
**Files in:** `agents/modules_meshcore/`

- `zip-reader.min.js` - Zip extraction
- `zip-writer.min.js` - Zip creation
- Platform-specific utilities

---

## Function Call Patterns

### Client → Server Communication

#### WebSocket Message Pattern
```javascript
// Location: views/default.handlebars
files.sendText({ action: '<action>', sub: '<subaction>', ... });

// Examples:
files.sendText({ action: 'ls', path: '/home/user' });
files.sendText({ action: 'download', sub: 'start', id: id, path: path });
files.sendText({ action: 'upload', reqid: reqid, path: path, name: name });
files.sendText({ action: 'zip', path: path, files: [...], output: 'archive.zip' });
```

#### Handler Registration
```javascript
// Line 11178: CreateRemoteFiles()
files = CreateAgentRedirect(meshserver, module, ... , protocol);
files.onControlMsg = p13gotCommand;        // Control messages
files.onMessage = p13gotMessage;           // JSON messages
files.onBinaryData = p13gotDownloadBinaryData; // File data
```

### Server → Agent Communication

#### Relay Pattern
```javascript
// File: meshdevicefile.js, Line 158
ws.send(Buffer.from(String.fromCharCode(0x0A))); // Protocol 10

// meshrelay.js handles bidirectional data relay
// No message parsing - pure binary tunnel
```

### Agent Response Patterns

#### JSON Response
```javascript
// agents/meshcore.js
this.write(Buffer.from(JSON.stringify({
    action: 'pathinfo',
    path: path,
    files: fileList
})));
```

#### Binary Data (Downloads)
```javascript
// Line 2984-2996: Binary chunk format
// 4-byte header: [flags, 0, 0, 0]
// Remaining bytes: file data
// flags & 1: End-of-file marker
```

---

## How to Identify Components

### 1. **Finding UI Elements**

#### By ID Pattern
```bash
# File manager elements start with 'p13'
grep "id=p13" views/default.handlebars
grep "Q\('p13" views/default.handlebars

# Buttons and inputs:
# p13Connect, p13Upload, p13Download, p13Zip, etc.
```

#### By Function Name Pattern
```bash
# File manager functions start with 'p13'
grep "function p13" views/default.handlebars

# Examples:
# p13downloadButton, p13uploadFile, p13zipFiles, etc.
```

### 2. **Finding Server Handlers**

#### By Endpoint Pattern
```bash
# Search for .ashx endpoints
grep "\.ashx" webserver.js

# WebSocket handlers:
app.ws(url + 'endpoint.ashx', handlerFunction)

# HTTP handlers:
app.get(url + 'endpoint.ashx', handlerFunction)
```

#### By Module Exports
```bash
# Server modules export CreateXxx functions
grep "module.exports.Create" *.js

# Examples:
# CreateMeshDeviceFile, CreateMeshRelay, CreateMeshUser, etc.
```

### 3. **Finding Agent Operations**

#### By Case Statement Pattern
```bash
# All agent commands use switch/case
grep "case '" agents/meshcore.js | grep -A2 "action"

# File operations are in Protocol 5 handler (line 3278+)
# Format: case 'commandname':
```

#### By Protocol Number
```bash
# Protocol definitions
grep "PROTOCOL_" apprelays.js
grep "this.httprequest.protocol ==" agents/meshcore.js

# Protocol 5 = Files UI
# Protocol 10 = FileTransfer (direct download)
```

### 4. **Finding Communication Flow**

#### Tracing a Download Operation
```javascript
// 1. User clicks download (client)
p13downloadButton()                    // Line 11760, default.handlebars
  ↓
// 2. Opens devicefile.ashx URL
link = 'devicefile.ashx?c=...'        // Line 11765, default.handlebars
  ↓
// 3. Server authenticates and relays
handleDeviceFile()                     // Line 3927, webserver.js
CreateMeshDeviceFile()                 // Line 16, meshdevicefile.js
  ↓
// 4. Agent receives Protocol 10
this.httprequest.protocol = 10         // Line 2958, meshcore.js
  ↓
// 5. Binary data flows back through relay
ws.on('message', ...)                  // Line 214, meshdevicefile.js
  ↓
// 6. Browser receives file
p13gotDownloadBinaryData()            // Line 11729, default.handlebars
saveAs(data2blob(data), filename)     // Line 11753, default.handlebars
```

#### Tracing a Zip Operation
```javascript
// 1. User selects files and clicks Zip
p13zipFiles()                          // Line 11619, default.handlebars
  ↓
// 2. Send zip command via WebSocket
files.sendText({ action: 'zip', ... }) // Line 11627, default.handlebars
  ↓
// 3. Server routes to agent via meshrelay
// (No parsing, pure relay)
  ↓
// 4. Agent processes zip command
case 'zip':                            // Line 3596, meshcore.js
require('zip-writer').write(...)       // Line 3620, meshcore.js
  ↓
// 5. Progress updates sent back
action: 'dialogmessage'                // Line 3622, meshcore.js
  ↓
// 6. Completion triggers UI refresh
action: 'refresh'                      // Line 3614, meshcore.js
p13gotCommand()                        // Processes response
```

---

## Commenting Conventions

### 1. **File Headers (Universal)**
```javascript
/**
* @description Brief module description
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/
```

**Pattern:** Every `.js` file starts with this JSDoc header

### 2. **Section Dividers**
```javascript
//
// MAJOR SECTION NAME
//

// Subsection name
```

**Usage:** Organizes code into logical blocks

**Examples:**
- `// FILES DOWNLOAD` (line 11702, default.handlebars)
- `// Mesh Rights` (line 36, meshdevicefile.js)
- `// Protocol Numbers` (line 17, apprelays.js)

### 3. **Inline Comments**
```javascript
obj.webserver = null;       // HTTPS main web server, typically on port 443
obj.mpsserver = null;       // Intel AMT CIRA server, typically on port 4433

const MESHRIGHT_REMOTECONTROL = 8;  // Required for file operations
```

**Pattern:** End-of-line comments for variable/constant explanations

### 4. **Function Documentation**
```javascript
// Called by the html page to start a download, arguments are: path, file name and file size.
function p13downloadfile(x, y, z, tag) { ... }

// Move an element from one position in an array to a new position
obj.ArrayElementMove = function(arr, from, to) { ... }
```

**Pattern:** Single-line comment immediately before function declaration

### 5. **Constants with Hex Values**
```javascript
const MESHRIGHT_EDITMESH            = 0x00000001; // 1
const MESHRIGHT_MANAGEUSERS         = 0x00000002; // 2
const MESHRIGHT_REMOTECONTROL       = 0x00000008; // 8
const MESHRIGHT_NOFILES             = 0x00000400; // 1024
```

**Pattern:** Hex value with decimal equivalent in comment

### 6. **JSLint/JSHint Directives**
```javascript
/*jslint node: true */
/*jshint node: true */
/*jshint strict:false */
/*jshint esversion: 6 */
```

**Pattern:** Top of every file after header

### 7. **TODO Comments**
```javascript
// TODO: Return a list of disk images for the user to select.
// TODO: Start IDER Session
```

**Pattern:** Rare but present for future work

### 8. **Protocol Documentation**
```javascript
// Protocol numbers
PROTOCOL_TERMINAL = 1
PROTOCOL_DESKTOP = 2
PROTOCOL_FILES = 5        // Files UI
PROTOCOL_FILETRANSFER = 10 // Single file transfer
```

**Pattern:** Inline comments explain protocol purpose

---

## Key Identifiers Summary

### Naming Conventions

| Component | Pattern | Example |
|-----------|---------|---------|
| **UI Elements** | `pXX` + identifier | `p13filetable`, `p13Upload` |
| **JS Functions** | `pXX` + camelCase | `p13downloadButton()`, `p13zipFiles()` |
| **Server Modules** | `Create` + PascalCase | `CreateMeshDeviceFile()` |
| **Constants** | UPPER_SNAKE_CASE | `MESHRIGHT_REMOTECONTROL` |
| **Endpoints** | lowercase + `.ashx` | `devicefile.ashx`, `meshrelay.ashx` |
| **Agent Cases** | lowercase string | `case 'zip':`, `case 'download':` |

### Search Patterns

```bash
# Find all file manager UI code:
grep -n "p13" views/default.handlebars

# Find all server endpoints:
grep -n "app\.\(ws\|get\|post\)" webserver.js | grep "\.ashx"

# Find all agent file operations:
grep -n "case '" agents/meshcore.js | grep -B5 -A10 "action.*file\|ls\|zip\|upload"

# Find all protocol handlers:
grep -n "this.httprequest.protocol ==" agents/meshcore.js

# Find all mesh rights checks:
grep -n "MESHRIGHT" webserver.js meshuser.js meshdevicefile.js

# Find all JSON command senders:
grep -n "sendText({" views/default.handlebars
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                       │
│  views/default.handlebars                               │
│                                                          │
│  ┌─────────────┐                                        │
│  │ p13 UI      │  File Manager Interface                │
│  │ - Buttons   │  Lines 855-927                         │
│  │ - File list │                                        │
│  │ - Dialogs   │                                        │
│  └─────┬───────┘                                        │
│        │                                                 │
│  ┌─────▼───────────────┐                               │
│  │ p13 Functions       │  JavaScript                    │
│  │ - p13downloadButton │  Lines 11178-11971            │
│  │ - p13zipFiles       │                               │
│  │ - p13uploadFile     │                               │
│  └─────┬───────────────┘                               │
│        │                                                 │
│  ┌─────▼──────────────────┐                            │
│  │ agent-redir-ws.js      │  WebSocket Transport       │
│  │ - sendText()           │  public/scripts/           │
│  │ - onMessage            │                            │
│  └─────┬──────────────────┘                            │
└────────┼──────────────────────────────────────────────┘
         │ WebSocket
         │ wss://server/meshrelay.ashx
         ▼
┌─────────────────────────────────────────────────────────┐
│  SERVER (MeshCentral)                                   │
│  webserver.js, meshrelay.js, meshdevicefile.js         │
│                                                          │
│  ┌─────────────────┐                                    │
│  │ WebSocket       │  Authentication & Routing          │
│  │ Endpoint        │  webserver.js:7007-7022           │
│  └─────┬───────────┘                                    │
│        │                                                 │
│  ┌─────▼───────────────┐                               │
│  │ Relay Handler       │  Binary Tunnel                 │
│  │ - meshrelay.js      │  No message parsing           │
│  │ - meshdevicefile.js │  Lines 214-232                │
│  └─────┬───────────────┘                               │
└────────┼──────────────────────────────────────────────┘
         │ Agent Tunnel
         │ Protocol 5 (Files) or 10 (FileTransfer)
         ▼
┌─────────────────────────────────────────────────────────┐
│  AGENT (Remote Device)                                  │
│  agents/meshcore.js                                     │
│                                                          │
│  ┌─────────────────┐                                    │
│  │ Protocol Router │  Lines 2955-2972                   │
│  │ - Protocol 5    │  Interactive file manager          │
│  │ - Protocol 10   │  Direct file download              │
│  └─────┬───────────┘                                    │
│        │                                                 │
│  ┌─────▼──────────────────┐                            │
│  │ File Operations        │                             │
│  │ - ls (3399)            │  Directory listing         │
│  │ - zip (3596)           │  Create archive            │
│  │ - unzip (3625)         │  Extract archive           │
│  │ - upload (3526)        │  Receive files             │
│  │ - download (2984)      │  Send files                │
│  │ - rm/copy/move/rename  │  File management           │
│  └─────┬──────────────────┘                            │
│        │                                                 │
│  ┌─────▼──────────┐                                     │
│  │ Native Modules │                                     │
│  │ - fs           │  File system operations            │
│  │ - zip-writer   │  Compression                       │
│  │ - zip-reader   │  Extraction                        │
│  └────────────────┘                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference: Common Tasks

### Adding a New File Operation

1. **Client (default.handlebars):**
   - Add button to HTML (line ~855-927)
   - Create `p13yourOperation()` function (~line 11000+)
   - Send command: `files.sendText({ action: 'yourOp', ... })`

2. **Agent (meshcore.js):**
   - Add case in Protocol 5 handler (~line 3280+)
   - Implement operation logic
   - Send response: `this.write(Buffer.from(JSON.stringify({...})))`

3. **Client Response Handler:**
   - Add handler in `p13gotCommand()` or `p13gotMessage()`
   - Update UI accordingly

### Debugging File Operations

```javascript
// Enable console logging:
// Client side (default.handlebars):
console.log('p13command', cmd);

// Agent side (meshcore.js):
sendConsoleText('Debug: ' + JSON.stringify(data));

// Server side (meshdevicefile.js):
parent.parent.debug('relay', 'Message: ' + msg);
```

### Testing File Manager

1. Navigate to: `https://yourserver/?viewmode=13&gotonode=<nodeid>`
2. Open browser console (F12)
3. Monitor WebSocket traffic in Network tab
4. Check `files` object: `console.log(files)`

---

## Summary

### File Manager Core Files
1. **`views/default.handlebars`** - Client UI and logic (lines 855-927, 11178-11971)
2. **`agents/meshcore.js`** - Agent file operations (lines 3278-3642)
3. **`meshdevicefile.js`** - File download relay (313 lines)
4. **`webserver.js`** - Server endpoints and routing (lines 3927-3954, 7007-7022)

### Key Concepts
- **Protocol 5:** Interactive file manager with full UI
- **Protocol 10:** Direct file download (devicefile.ashx)
- **Relay architecture:** Server is transparent tunnel
- **Zip support:** Already implemented agent-side (zip-writer/zip-reader)

### Developer Practices
- **Consistent naming:** `pXX` prefix for UI components
- **JSDoc headers:** All files start with standard header
- **Inline comments:** Preferred over formal @param documentation
- **Rights-based access:** MESHRIGHT_REMOTECONTROL required for files

---

**Generated:** 2025-12-02
**MeshCentral Version:** Based on commit d2677dc
**Documentation Author:** Claude Code Analysis
