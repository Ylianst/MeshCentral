# Quick Start Guide

## Basic Installation

Getting started is not a difficult process. Since MeshCentral is written in mostly JavaScript its platform agnostic therefor it can run almost everywhere!<br>
If you don't have it already, install NodeJS to get started.
> Possible installation instructions on how to do that in Linux [here](https://nodejs.org/en/download/package-manager/all).<br>
> Possible installation instructions on how to do that in Windows [here](https://nodejs.org/en).<br>

Then, create a directory where you want to install meshcentral such as `/opt/meshcentral`.<br>
Set your current directory to the desired directory and execute the following commands:

```sh
npm install meshcentral
node node_modules/meshcentral
```

That's it. MeshCentral will set itself up and start managing computers on your local network.<br>
By default it will be setup in LAN mode and agents you install will multicast on the local network to find the server, to setup the server so that agents use a well known DNS name and to start customizing your server, go in the "meshcentral-data" folder and edit the config.json file.<br>
The configuration file must be valid JSON, you can use this [web-based link](https://duckduckgo.com/?va=j&t=hc&q=json+lint&ia=answer) or [jq utility](https://jqlang.org/) to validate the file format.

For Windows users, you can download the MeshCentral Installer that will automate installation of NodeJS and provide basic configuration of the server. This option is not recommended for advanced users.

Download: [Windows MeshCentral Installer](https://meshcentral.com/tools/MeshCentralInstaller.exe)

By default, MeshCentral will use NeDB as this is the built-in database. For more advanced users, it's recommended to switch to using MongoDB. MeshCentral can be installed on a very small server. A [Raspberry Pi](https://www.raspberrypi.org/) or [AWS t3.nano running Amazon Linux 2 instance](https://aws.amazon.com/ec2/pricing/on-demand/) for 5$ a month will do just fine for managing up to a few hundred devices.

You can run the MeshCentral Server with --help to get options for background installation.

## Configuration

Once you get MeshCentral installed, the first user account that is created will be the server administrator. So, don't delay and navigate to the login page and create a new account. You can then start using your server right away. A lot of the fun with MeshCentral is the 100's of configuration options that are available in the config.json file. You can put your own branding on the web pages, setup a SMTP email server, SMS services and much more.

You can look at the sample configurations placed in the Github repository. They can be found with the following links:

- [Simple sample config](https://github.com/Ylianst/MeshCentral/blob/master/sample-config.json).
> - [Raw cURL-able link](https://raw.githubusercontent.com/Ylianst/MeshCentral/refs/heads/master/sample-config.json)
- [Advanced sample config](https://github.com/Ylianst/MeshCentral/blob/master/sample-config-advanced.json).
> - [Raw cURL-able link](https://raw.githubusercontent.com/Ylianst/MeshCentral/refs/heads/master/sample-config-advanced.json)
- [Full config schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json).
> - [Raw cURL-able link](https://raw.githubusercontent.com/Ylianst/MeshCentral/refs/heads/master/meshcentral-config-schema.json)

You can also take a look at the [YouTube Tutorial Videos](https://www.youtube.com/@MeshCentral/videos) for additional help.

## Video Walkthrough

<div class="video-wrapper">
  <iframe src="https://www.youtube.com/embed/LSiWuu71k_U" frameborder="0" allowfullscreen></iframe>
</div>