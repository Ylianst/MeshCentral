# Quick Start Guide

Get MeshCentral running in under 5 minutes.

---

## TL;DR — Fastest Path to Running MeshCentral

### Step 1: Install via npm (Recommended)

MeshCentral is published as an npm package. Install it globally:

```bash
npm install -g meshcentral
```

Or install locally in a project directory:

```bash
mkdir meshcentral-server && cd meshcentral-server
npm install meshcentral
```

### Step 2: Start the Server

```bash
node node_modules/meshcentral
```

Or, if installed globally:

```bash
meshcentral
```

On first launch, MeshCentral will:

1. Generate self-signed TLS certificates
2. Initialize the embedded NeDB database
3. Create the default directory structure
4. Start listening on port 443 (HTTPS) and port 80 (HTTP redirect)

### Step 3: Open the Web Interface

Open your browser and navigate to:

```text
https://localhost/
```

> **Self-signed certificate warning:** Your browser will show a TLS warning on first launch because MeshCentral uses a self-signed certificate by default. Click "Advanced" and "Proceed" to continue. For production, configure Let's Encrypt (see configuration notes below).

### Step 4: Create the First Admin Account

On your first visit, MeshCentral will prompt you to create an administrator account. Fill in:

- **Username** — Your admin username
- **Password** — A strong password (at least 8 characters)
- **Email** — Your email address (used for 2FA and notifications)

Click **Create Account**. You will be logged in as the server administrator.

---

## Install from Source

If you want to run directly from the source code:

**Step 1: Clone the repository**

```bash
git clone https://github.com/flamingo-stack/meshcentral.git
cd meshcentral
```

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Start the server**

```bash
node meshcentral.js
```

---

## Data Directory Structure

After first launch, MeshCentral creates these directories:

```text
meshcentral-data/         ← Configuration and certificates
  config.json             ← Server configuration file
  webserver-cert-public.crt
  webserver-cert-private.key

meshcentral-files/        ← User file storage
  tmp/                    ← Temporary upload directory

meshcentral-backup/       ← Automated backup storage
meshcentral-recordings/   ← Session recordings
```

> The data directory location depends on how MeshCentral is launched. When installed via npm, it defaults to `~/meshcentral-data`. When run from source, it is relative to the working directory.

---

## Minimal Configuration Example

After the first run, edit `meshcentral-data/config.json` for basic customization:

```json
{
  "settings": {
    "port": 443,
    "redirPort": 80,
    "sessionKey": "CHANGE_THIS_TO_A_RANDOM_SECRET"
  },
  "domains": {
    "": {
      "title": "My MeshCentral",
      "title2": "Remote Management"
    }
  }
}
```

Restart the server after editing config:

```bash
node meshcentral.js
```

---

## Connect Your First Device

1. In the web interface, go to **My Devices** → **Add Device Group**
2. Create a device group (e.g., "Workstations")
3. Click on the group → **Add Agent** → select your OS
4. Download and run the agent installer on the remote device
5. The device will appear in your dashboard within seconds

---

## Expected Output on Startup

When MeshCentral starts successfully, you should see output similar to:

```text
MeshCentral HTTP redirect server running on port 80.
MeshCentral HTTPS server running on port 443.
MeshCentral Intel(R) AMT server running on port 4433.
```

If you see port binding errors, another process may be using those ports. Check with:

```bash
# Linux
ss -tlnp | grep -E '80|443|4433'

# Windows
netstat -an | findstr "80 443 4433"
```

---

## Running as a Service

### Linux (systemd)

Create a service file at `/etc/systemd/system/meshcentral.service`:

```text
[Unit]
Description=MeshCentral Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/meshcentral
ExecStart=/usr/bin/node /opt/meshcentral/meshcentral.js
Restart=on-failure
RestartSec=10
User=meshcentral

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl enable meshcentral
systemctl start meshcentral
systemctl status meshcentral
```

### Windows

MeshCentral includes built-in Windows service integration via `node-windows`. Run:

```bash
node meshcentral.js --install
```

---

## What's Next?

Once MeshCentral is running, explore what to do first in the [First Steps Guide](first-steps.md).
