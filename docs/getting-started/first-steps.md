# First Steps

You've installed MeshCentral and logged in. Here are the first five things to do to get the most out of your setup.

---

## 1. Configure Your Server Domain

After the first launch, open `meshcentral-data/config.json` and customize the domain settings:

```json
{
  "settings": {
    "port": 443,
    "redirPort": 80,
    "sessionKey": "replace-with-a-long-random-string"
  },
  "domains": {
    "": {
      "title": "Acme IT",
      "title2": "Remote Management Portal",
      "newAccounts": false,
      "newAccountsEmailVerified": true
    }
  }
}
```

> **Security tip:** Set `"newAccounts": false` after creating your admin account to prevent unauthorized self-registration. Set `"sessionKey"` to a securely generated random string.

Restart MeshCentral after editing the config:

```bash
node meshcentral.js
```

---

## 2. Set Up TLS with Let's Encrypt

For production deployments with a public domain, enable automatic TLS certificates:

```json
{
  "settings": {
    "port": 443,
    "redirPort": 80
  },
  "letsencrypt": {
    "email": "admin@yourdomain.com",
    "production": true,
    "names": ["mesh.yourdomain.com"]
  }
}
```

**Requirements:**
- Port 80 must be publicly reachable for HTTP-01 challenge validation
- `mesh.yourdomain.com` must resolve to your server's public IP
- MeshCentral checks renewal every 24 hours and renews when fewer than 45 days remain

---

## 3. Create Device Groups and Enroll Devices

Device groups let you organize and manage permissions across your device fleet.

**Create a device group:**

1. Log in to the web interface at `https://your-server/`
2. Click **My Devices** in the left sidebar
3. Click **Add Device Group**
4. Choose **Managed using MeshAgent** (for full agent management)
5. Name the group (e.g., "Workstations", "Servers", "Client-Acme")

**Enroll a device:**

1. Click on the new device group
2. Click **Add Agent** → select the target operating system
3. Download the installer package
4. Run the installer on the remote device
5. The device will appear under the group within a few seconds

> **For Linux devices**, the installer is a shell script. Run it with elevated privileges:

```bash
sudo bash meshagent-linux.sh
```

---

## 4. Configure Multi-Factor Authentication

MeshCentral supports multiple MFA methods. Enable them in your account settings:

**TOTP (Time-based OTP):**

1. Click your username in the top right → **My Account**
2. Scroll to **Two-Factor Authentication**
3. Click **Enable** next to **Authenticator App (TOTP)**
4. Scan the QR code with Google Authenticator, Authy, or any TOTP app
5. Enter the 6-digit code to confirm

**WebAuthn / FIDO2 Hardware Key:**

1. Go to **My Account** → **Two-Factor Authentication**
2. Click **Enable** next to **Security Key**
3. Insert your hardware key and follow browser prompts (Chrome/Edge recommended)

> **Server-level enforcement:** To require MFA for all users, add `"require2factor": true` to the domain config block in `config.json`.

---

## 5. Explore Key Features

Once a device is enrolled, explore the core capabilities:

### Remote Desktop

Click any enrolled device → **Remote Desktop**. This opens a full browser-based KVM session using the noVNC (VNC/RFB) engine with:

- Hardware-accelerated canvas rendering
- Clipboard synchronization
- Dynamic desktop resizing
- Multi-encoding support (Raw, Tight, ZRLE, JPEG)

### Remote Terminal

Click any device → **Remote Terminal**. This launches a full Xterm.js terminal session with:

- ANSI/VT100 compatibility
- Inline image rendering (SIXEL / OSC 1337)
- Tab completion and scrollback
- Copy/paste support

### File Manager

Click any device → **Files**. Browse, upload, and download files directly on the remote device.

### Device Monitoring Dashboard

The **My Devices** view provides live connectivity status. Click any device to see:

- Hardware information (via SMBIOS)
- Network interfaces
- OS and platform details
- Power state (for Intel AMT devices)

---

## Key Configuration Reference

Here are the most common `config.json` options for initial setup:

```json
{
  "settings": {
    "port": 443,
    "redirPort": 80,
    "sessionKey": "your-random-session-key",
    "agentIdleTimeout": 300,
    "allowLoginToken": true
  },
  "domains": {
    "": {
      "title": "My MSP",
      "title2": "Remote Management",
      "newAccounts": false,
      "newAccountsEmailVerified": true,
      "newAccountsEmailDomain": "yourdomain.com",
      "require2factor": false,
      "agentInviteCodes": true,
      "sessionRecording": {
        "desktop": false,
        "terminal": false
      }
    }
  }
}
```

---

## Where to Get Help

- **OpenMSP Community (Slack):** [https://www.openmsp.ai/](https://www.openmsp.ai/)
- **Join Slack:** [https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)
- **Source code & issues:** [https://github.com/flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral)
- **Flamingo platform:** [https://flamingo.run](https://flamingo.run)

---

## Reference Documentation

For deeper technical details, the generated reference documentation covers all major subsystems:

- [Architecture Overview](../development/architecture/README.md)
- [Development Environment Setup](../development/setup/environment.md)
- [Security Best Practices](../development/security/README.md)
