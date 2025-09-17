# 🔒 Increased Security Installation

On Debian based Linux distributions like Ubuntu, a better and more secure way to install MeshCentral is to have it run within a user account this restricted privileges. When installed like this, the self-update capability of MeshCentral will not work. Instead of installing MeshCentral in the user’s home folder, we install it in /opt/meshcentral and we create a meshcentral user that does not have rights to login or change any of the MeshCentral files. To do this, start by creating a new user called `meshcentral`

```shell
sudo useradd -r -d /opt/meshcentral -s /sbin/nologin meshcentral
```

We can then create the installation folder, install and change permissions of the files so that the `meshcentral` account gets read-only access to the files.

```shell
sudo mkdir /opt/meshcentral
```
```shell
cd /opt/meshcentral
```
```shell
sudo npm install meshcentral
```
```shell
sudo -u meshcentral node ./node_modules/meshcentral
```

The last line will run MeshCentral manually and allow it to install any missing modules and create the MeshCentral data folders. Once it’s running, press CTRL-C and continue. The following two lines will change the ownership of files to the meshcentral user and restrict access to the files.

```shell
sudo chown -R meshcentral:meshcentral /opt/meshcentral
```
```shell
sudo chmod -R 755 /opt/meshcentral/meshcentral-*
```

To make this work, you will need to make MeshCentral work with MongoDB because the `/meshcentral-data` folder will be read-only. In addition, MeshCentral will not be able to update itself since the account does not have write access to the /node_modules files, so the update will have to be manual. First used systemctl to stop the MeshCentral server process, than use this:

```shell
cd /opt/meshcentral
```
```shell
sudo npm install meshcentral
```
```shell
sudo -u meshcentral node ./node_modules/meshcentral
```
```shell
sudo chown -R meshcentral:meshcentral /opt/meshcentral
```

This will perform the update to the latest server on NPM and re-set the permissions so that the meshcentral user account has read-only access again. You can then use systemctl to make the server run again.

MeshCentral allows users to upload and download files stores in the server’s `meshcentral-files` folder. In an increased security setup, we still want the server to be able to read and write files to this folder and we can allow this with:

```shell
sudo chmod -R 755 /opt/meshcentral/meshcentral-files
```

If you plan on using the increased security installation along with MeshCentral built-in Let’s Encrypt support you will need to type the following commands to make the `letsencrypt` folder in `meshcentral-data` writable.

```shell
sudo mkdir /opt/meshcentral/meshcentral-data
```
```shell
sudo mkdir /opt/meshcentral/meshcentral-data/letsencrypt
```
```shell
sudo chmod -R 755 /opt/meshcentral/meshcentral-data/letsencrypt
```

This will allow the server to get and periodically update its Let’s Encrypt certificate. If this is not done, the server will generate an `ACCES: permission denied` exception.