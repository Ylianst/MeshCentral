## 🪟 Quick Start on Windows with the Installer

For Microsoft Windows users, the easiest way to install MeshCentral is by using the dedicated installer tool. This tool automates the setup, including checking for and installing **Node.js** if necessary.

You can download the MeshCentral installer from the official website or by clicking [this link](https://www.meshcommander.com/meshcentral2).

> **Recommendation:** We advise running the installer on a modern version of Windows (e.g., Windows 8.1, Windows 10, or Windows Server 2012 or newer).

### Installation Prompts Explained

The installer will guide you through a few key settings:

| Setting | Description |
| :--- | :--- |
| **Multi-user Server** | **Enabled (Checked):** The server is open to the public. Users can create accounts and manage their own devices. **Disabled (Unchecked):** The server is limited to a single-user mode, with no login screen, accessible only from the server host machine. |
| **Auto-update Server** | **Enabled:** The server automatically checks for new releases daily (typically between 00:00 and 01:00 local time) and performs an update. The server will be inaccessible during the update process. |
| **Server Mode** | Choose how agents find the server: |
| *LAN Mode* | Recommended for small, local networks. The server does not need a fixed IP or DNS name. |
| *WAN/Hybrid Mode* | Required for managing devices over the internet. You **must** enter the server's public **DNS name** or **static IP address** into the **Server Name** field. This name must be correct or agents will fail to connect. If unsure, start with **LAN Mode**. |

Once installed, MeshCentral runs as a **background Windows Service** and can be accessed via the web browser link provided by the installer.

### Updating and Maintenance

The installation tool can be run again at any time to:

* **Perform a Server Update:** The tool compares your installed version to the latest one on NPM.
* **Re-install** the server.
* **Un-install** the server.

---

## 🔒 Windows Defender Firewall Settings

The installer automatically configures the **Windows Defender Firewall** to allow MeshCentral to accept incoming connections.

By default, MeshCentral uses the following ports:
* **TCP Ports:** **80** (HTTP), **443** (HTTPS), and **4433** (Intel® AMT CIRA).
* **UDP Port:** **16990** (Added for server discovery in LAN or Hybrid mode).

If you performed an advanced NPM installation or need to change the default ports, you may need to manually modify these firewall rules.

### Accessing Firewall Settings

1.  Open **Control Panel**.
2.  Go to **System and Security**.
3.  Click **Windows Defender Firewall**.
4.  Click **Advanced Settings** on the left side.
5.  Select **Inbound Rules**.

If you used the installer, you should see rules named **`MeshCentral Server TCP ports`** and optionally **`MeshCentral Server UDP ports`**.

### 1. Editing Existing Rules

To change the allowed ports (e.g., if you changed the MeshCentral configuration):
1.  **Double-click** the existing rule (e.g., `MeshCentral Server TCP ports`).
2.  Go to the **Protocols and Ports** tab.
3.  Modify the **Local ports** field.

### 2. Adding New Rules

To create a new inbound firewall rule:
1.  Click **New Rule...** on the right side.
2.  Select **Port** and click **Next**.
3.  Choose either **TCP** or **UDP**.
4.  Select **Specific local ports** and enter the port numbers (e.g., `80, 443, 4433`). Click **Next**.
5.  Ensure **Allow the connection** is selected and click **Next**.
6.  Select the profiles (Domain, Private, Public) where the rule should apply and click **Next**.
7.  Enter a descriptive **Name** for the rule and click **Finish**.