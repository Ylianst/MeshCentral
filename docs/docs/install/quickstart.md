## 🚀 Quick Start Guide: Basic NPM Installation

MeshCentral is platform-agnostic, running almost anywhere thanks to being primarily written in JavaScript. This guide covers the simplest way to get started using **NPM**.

### 🛠️ Basic Setup

The only prerequisites are **Node.js** and **npm**.

-----

#### 1\. Install Node.js

  * **Linux:** Find installation instructions for your distribution [here](https://nodejs.org/en/download/package-manager/all).
  * **Windows:** Download the installer from the official site [here](https://nodejs.org/en).

> 🪟 **Windows Users:** If you prefer an automated setup, you can skip the manual installation and download the **Windows MeshCentral Installer**. However, this is **not recommended for advanced users**.
> [Download Windows MeshCentral Installer](https://meshcentral.com/tools/MeshCentralInstaller.exe)

-----

#### 2\. Install and Start MeshCentral

Create a dedicated directory (e.g., `/opt/meshcentral`) and run the following commands in your terminal.

> ⚠️ **Do not** use `sudo` with the `npm install meshcentral` command.

```shell
# Example: Create and move into the directory
mkdir -p /opt/meshcentral
cd /opt/meshcentral

# Install the MeshCentral package
npm install meshcentral

# Start the server
node node_modules/meshcentral
```

That's it\! MeshCentral will now set itself up and begin managing computers on your **local network** that have the MeshAgent installed.

#### Running as a Service

To run MeshCentral as a persistent background service (recommended for production environments), use the --install argument when starting the server. Consult the MeshCentral documentation for OS-specific service setup details.

-----

### ⚙️ Configuration and Customization

#### Default Mode and Initial Access

By default, MeshCentral starts in **LAN-only mode**. Agents use local network multicasting to find the server.

  * The first user account you create upon accessing the server will automatically become the **server administrator**. Access the login page in your web browser and create your account right away.
  * Once installed, server settings are stored in the **`config.json`** file, which is located inside the **`meshcentral-data`** folder.

#### Advanced Configuration

The **`config.json`** file holds hundreds of options for deep customization, including:

  * Switching the server from LAN-only to **WAN/Hybrid mode** by setting a known DNS name.
  * Customizing the server with your own **branding**.
  * Setting up an **SMTP email server** or **SMS services**.

The configuration file must be valid **JSON**. You can use an online tool or utilities like `jq` to validate its format.

You can find sample configuration files on the GitHub repository for reference:

  * [Simple sample config](https://github.com/Ylianst/MeshCentral/blob/master/sample-config.json)
  * [Advanced sample config](https://github.com/Ylianst/MeshCentral/blob/master/sample-config-advanced.json)
  * [Full config schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json)

-----

### Database and Scaling Notes

  * **Database:** By default, MeshCentral uses **NeDB**, its built-in database. For advanced use cases and better performance, it's recommended to switch to **MongoDB** or an SQL-based solution like **Postgresql**.
  * **Hardware:** MeshCentral is very lightweight. You can run a server capable of managing a few hundred devices on a small platform like a **Raspberry Pi** or an **AWS t3.nano** instance running Linux.
  * **Service Mode:** To run the server as a background service, start it with the `--help` argument to view options for background installation.

For a visual guide, check out the official [YouTube Tutorial Videos](https://www.youtube.com/@MeshCentral/videos).

\<div class="video-wrapper"\>
  \<iframe src="[https://www.youtube.com/embed/LSiWuu71k\_U](https://www.youtube.com/embed/LSiWuu71k_U)" frameborder="0" allowfullscreen\>\</iframe\>
\</div\>

-----

Do you want to know more about configuring the server for WAN access or switching to a different database?