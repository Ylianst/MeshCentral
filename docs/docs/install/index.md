# Installation

Getting started is easy. If you don't have it already, install NodeJS. Then, create an empty folder and do this:

```bash
npm install meshcentral
node node_modules/meshcentral
```

That's it. MeshCentral will set itself up and start managing computers on your local network. By default it will be setup in LAN mode and agents you install will multicast on the local network to find the server. To setup the server so that agents use a well known DNS name and to start customizing your server, go in the "meshcentral-data" folder and edit the config.json file. The configuration file must be valid JSON, you can use this link to validate the file format.

For Windows users, you can download the MeshCentral Installer that will automate installation of NodeJS and provide basic configuration of the server. This option is not recommended for advanced users.

[Win32 MeshCentral Installer](https://meshcentral.com/info/tools/MeshCentralInstaller.exe)

By default, MeshCentral will use NeDB as this is the built-in database. For more advanced users, it's recommended to switch to using MongoDB. MeshCentral can be installed on a very small server. A [Raspberry Pi](https://www.raspberrypi.org/) or [AWS t3.nano running Amazon Linux 2 instance](https://aws.amazon.com/ec2/pricing/on-demand/) for 5$ a month will do just fine for managing up to a few hundred devices.

You can run the MeshCentral Server with --help to get options for background installation.

# Configuration

Once you get MeshCentral installed, the first user account that is created will be the server administrator. So, don't delay and navigate to the login page and create a new account. You can then start using your server right away. A lot of the fun with MeshCentral is the 100's of configuration options that are available in the config.json file. You can put your own branding on the web pages, setup a STMP email server, SMS services and much more.

You can look [here for simple config.json](https://raw.githubusercontent.com/Ylianst/MeshCentral/master/sample-config.json), [here for a more advanced configuration](https://raw.githubusercontent.com/Ylianst/MeshCentral/master/sample-config-advanced.json) and [here for all possible configuration options](https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json). You can also take a look at the [MeshCentral User's Guide](https://meshcentral.com/info/docs/MeshCentral2InstallGuide.pdf) and [tutorial videos](https://meshcentral.com/info/tutorials.html) for additional help.