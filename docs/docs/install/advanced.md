# 📦 NPM Installation for Advanced Users

![](images/2022-05-16-23-47-36.jpg)

For advanced users or administrators, MeshCentral can be installed with [NPM](https://www.npmjs.com/).<br>
NPM is a NodeJS package manager that can be used through the command line tool; `npm`. 

---
> **📌 Note:**
>
> As a prerequisite, NodeJS and NPM must be installed on host OS and HTTP/HTTPS proxy settings maybe required if server host resides behind a HTTP proxy server. 
---

**1. To begin, start a command line terminal (Windows cmd/powershell or Linux shell) and type the following to verify if nodeJS and npm has been installed correctly as shown below:**

> *a. To check on nodeJS installed version, type `node –v` and hit the `enter` key.*

> *b. To check on npm installed version, type `npm –v` and hit the `enter` key.*

**2. If MeshCentral installation is performed on a server host that resides behind a HTTP proxy, NPM’s proxy settings must be updated with respective proxy settings associated with the network environment.<br>**

Skip this step if not applicable, and see examples below:
    ```shell
    npm config set proxy http://proxy.com:88       # http proxy
    ```
    ```shell
    npm config set https-proxy http://proxy.com:88 # https proxy
    ```
**3. Create a new directory `MeshCentral`, recommended on Linux inside the `/opt` directory and run the NPM install command as shown below:**
!!!warning
    Do not use `sudo` in front of `npm install meshcentral`.
```shell
mkdir -p /opt/meshcentral
```
```shell
cd /opt/meshcentral
```
```shell
npm install meshcentral
```
---
> **📌 Note:**
>
> To run MeshCentral as a service, run it using `--install` argument. Once running, start a web browser and access MeshCentral application with respective URL.
---
**4. Upon download completion, the server can be started with the commands below:**
!!!warning
    Do not run MeshCentral by going into the `node_modules/meshcentral` (with cd for example) folder as this may cause auto-install and self-update features to fail.<br>
    Instead, go into the directory above `node_modules` and run `node node_modules/meshcentral`.

```shell
node node_modules/meshcentral [arguments]
```

![](images/2022-05-16-23-53-08.jpg)

---
> **📌 Note:**
>
>If MeshCentral is started without any arguments;
>default settings such as LAN-only mode will be in effect and user/administrator will only be able to manage computers that reside within the local network.
---
**5. To manage computers over the internet, the server needs to have static IP settings or a DNS record that resolves back to the right server.**

The mesh agents will be using this mechanism to call home to the MeshCentral server. For WAN or Hybrid mode, run one of the commands below.<br>

!!!warning
    It is recommeded to use a valid configuration file, not to use command-line parameters.

```shell
node node_modules/meshcentral --cert servername.domain.com
```
```shell
node node_modules/meshcentral --cert hostname.domain.com
```
```shell
node node_modules/meshcentral --cert 1.2.3.4
```
---
> **📌 Note:**
>
> On first attempt running on WAN or Hybrid Mode: <br>
>   - Certificates will be generated for the first time and this may take a few minutes to complete.
---

It is advised to create an `admin` account immediately by navigating to https://127.0.0.1 (or the public hostname) with a web browser. 
