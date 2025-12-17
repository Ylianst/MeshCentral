# Secure

## 🔒 Increased Security Installation on Debian/Ubuntu

For enhanced security on Debian-based Linux distributions (like Ubuntu), it's best practice to run **MeshCentral** under a dedicated, low-privilege user account. This prevents the server from making unauthorized changes to the system.

> ⚠️ **Important:** Running with restricted privileges disables MeshCentral's **self-update capability**. Updates must be performed manually. Additionally, this setup **requires using an external database (like MongoDB)** because the primary data folder will be read-only.

-----

### 1\. Create a Low-Privilege User

Start by creating a system user named `meshcentral`. This user will be restricted from logging in and changing files outside its designated directory.

```shell
sudo useradd -r -d /opt/meshcentral -s /sbin/nologin meshcentral
```

### 2\. Install MeshCentral

Next, create the installation directory and install the package using NPM.

```shell
# Create the installation folder
sudo mkdir /opt/meshcentral

# Change to the installation directory
cd /opt/meshcentral

# Install MeshCentral (as the created user)
sudo -u meshcentral npm install meshcentral
```

### 3\. Initialize Data Folders

Run the server once under the new low-privilege user to generate the necessary data folders and install any initial dependencies.

```shell
# Run once as the meshcentral user
sudo -u meshcentral node ./node_modules/meshcentral
```

Once the server is running and the folders have been created, press **CTRL-C** to stop the process.

### 4\. Restrict Permissions

Now, set the ownership and permissions to ensure the `meshcentral` user has **read-only access** to the application code, enhancing security.

```shell
# Change ownership of all files to the meshcentral user and group
sudo chown -R meshcentral:meshcentral /opt/meshcentral

# Set read/execute permissions for the meshcentral user on data folders
# Note: meshcentral-* refers to meshcentral-data, meshcentral-files, etc.
sudo chmod -R 755 /opt/meshcentral/
```

### 5\. Adjust Write Permissions for Functionality (Optional)

In a restricted environment, you need to explicitly grant write access to specific subfolders the server needs to modify during operation.

#### A. File Upload/Download

If you plan to use MeshCentral's file transfer features, the server needs to read and write to the `meshcentral-files` folder:

```shell
sudo chmod -R 755 /opt/meshcentral/meshcentral-files
```

#### B. Let's Encrypt Support

If you plan to use MeshCentral's built-in **Let's Encrypt** support, you must make its certificate folder writable to avoid `ACCES: permission denied` exceptions:

```shell
# Create the necessary sub-folders if they don't exist
sudo mkdir -p /opt/meshcentral/meshcentral-data/letsencrypt

# Grant write access to the letsencrypt folder
sudo chmod -R 775 /opt/meshcentral/meshcentral-data/letsencrypt
```

### 6\. Manual Server Update

Because the `meshcentral` user lacks write access to the `/node_modules` directory, the server cannot update itself. To perform a manual update:

1.  Use `systemctl` (or your service manager) to **stop** the MeshCentral server process.
2.  Run the following commands:

<!-- end list -->

```shell
cd /opt/meshcentral

# Update the MeshCentral package via NPM (requires sudo/root privileges)
sudo npm install meshcentral

# Re-set ownership to the meshcentral user
sudo chown -R meshcentral:meshcentral /opt/meshcentral
```

3.  Use `systemctl` to **restart** the MeshCentral server.

This process updates the server to the latest version on NPM and reapplies the strict permissions.