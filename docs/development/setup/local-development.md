# Local Development Guide

This guide walks you through cloning MeshCentral, installing dependencies, and running the server locally for development.

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/flamingo-stack/meshcentral.git
cd meshcentral
```

---

## Step 2: Install Dependencies

```bash
npm install
```

This installs all runtime dependencies defined in `package.json`, including:

- `express` — HTTP/HTTPS server framework
- `ws` / `express-ws` — WebSocket support
- `@seald-io/nedb` — Embedded NeDB database
- `node-forge` — TLS certificate generation
- `otplib` — TOTP two-factor authentication
- `express-handlebars` — Handlebars template engine
- And others (see `package.json` for the full list)

---

## Step 3: Start the Development Server

MeshCentral does not have a dedicated development mode with hot-reloading (it is a long-running server process). The standard approach is to run the server directly with Node.js:

```bash
node meshcentral.js
```

### Using Higher Ports (Avoid Root on Linux)

```bash
node meshcentral.js --port 8443 --redirport 8080
```

Then access the server at `https://localhost:8443`.

### First Run

On first launch:

- Self-signed TLS certificates are auto-generated in `meshcentral-data/`
- The embedded NeDB database is initialized
- The server outputs startup messages:

```text
MeshCentral HTTP redirect server running on port 8080.
MeshCentral HTTPS server running on port 8443.
```

---

## Step 4: Accept the Self-Signed Certificate

When you navigate to `https://localhost:8443`, your browser will show a TLS warning. This is expected during development.

- **Chrome/Edge:** Click **Advanced** → **Proceed to localhost (unsafe)**
- **Firefox:** Click **Advanced** → **Accept the Risk and Continue**

> For development, you can also import the self-signed cert into your OS/browser trust store to eliminate the warning. The cert file is at `meshcentral-data/webserver-cert-public.crt`.

---

## Step 5: Create an Admin Account

On the first visit, create your admin account. This is a one-time step — after the first account is created, the registration form is only accessible if `"newAccounts": true` in `config.json`.

---

## Development Configuration

For development, create or edit `meshcentral-data/config.json`:

```json
{
  "settings": {
    "port": 8443,
    "redirPort": 8080,
    "sessionKey": "dev-only-not-for-production",
    "cert": "localhost"
  },
  "domains": {
    "": {
      "title": "MeshCentral Dev",
      "title2": "Local Development",
      "newAccounts": true,
      "agentInviteCodes": true
    }
  }
}
```

Restart the server after changing config:

```bash
node meshcentral.js --port 8443 --redirport 8080
```

---

## Watching for File Changes

MeshCentral does not have built-in watch mode, but you can use **nodemon** for automatic restart on file changes:

```bash
# Install nodemon globally
npm install -g nodemon

# Start with nodemon
nodemon meshcentral.js --port 8443 --redirport 8080
```

> **Note:** nodemon will restart the server on any `.js` file change in the root directory. The browser-side assets (in `public/`) are served as static files and update immediately on reload without a server restart.

---

## Debug Mode

MeshCentral supports debug output levels via the `--debug` flag:

```bash
# Level 1 — basic debug info
node meshcentral.js --debug 1 --port 8443 --redirport 8080

# Level 3 — verbose, includes agent messages
node meshcentral.js --debug 3 --port 8443 --redirport 8080
```

### VS Code Debugger

If you have the `launch.json` configured (see [Environment Setup](environment.md)), press **F5** to start the server with the VS Code debugger attached. You can then:

- Set breakpoints in any `.js` file
- Inspect variables in the **Variables** panel
- Step through code with **F10** (step over) and **F11** (step into)

---

## Connecting a Test Agent

To test agent connectivity locally:

1. In the web UI, create a device group
2. Download the agent installer for your platform
3. Run the agent with the local server URL:

```bash
# Linux agent (example)
sudo ./meshagent -selfupdate=0 https://localhost:8443/meshagents?id=0
```

> The agent will warn about the self-signed certificate. For development, you can configure the agent to skip certificate validation or import the dev cert into the system trust store.

---

## Understanding Key Source Files

When navigating the codebase, start with these core files:

| File | Purpose |
|------|---------|
| `meshcentral.js` | Main entry point — initializes all subsystems |
| `webserver.js` | Express server, routing, sessions, TLS |
| `meshagent.js` | WebSocket handler for agent connections |
| `meshrelay.js` | Client ↔ device relay sessions |
| `db.js` | Database abstraction layer |
| `amtmanager.js` | Intel AMT device lifecycle management |
| `webauthn.js` | FIDO2/WebAuthn registration and authentication |
| `letsencrypt.js` | ACME certificate automation |
| `plugins/openframe.js` | OpenFrame platform integration plugin |

---

## Useful Development URLs

When running on port 8443:

| URL | Description |
|-----|-------------|
| `https://localhost:8443/` | Main web interface |
| `https://localhost:8443/control.ashx` | WebSocket control endpoint |
| `https://localhost:8443/meshagents` | Agent download endpoint |
| `https://localhost:8443/api/deviceStatus` | OpenFrame device status API (plugin) |
| `https://localhost:8443/generate-msh` | OpenFrame MSH config generator (plugin) |

---

## Common Issues

### Port Already in Use

```text
Error: listen EADDRINUSE: address already in use :::443
```

**Solution:** Use `--port 8443 --redirport 8080` or stop the conflicting process.

### Certificate Errors

If MeshCentral fails to start due to certificate issues, delete the generated certificates and restart:

```bash
rm meshcentral-data/webserver-cert-*
node meshcentral.js --port 8443 --redirport 8080
```

New self-signed certificates will be regenerated automatically.

### Database Lock Errors (NeDB)

If you terminate MeshCentral ungracefully and see NeDB lock errors, delete the lock files:

```bash
find meshcentral-data -name "*.db~" -delete
```
