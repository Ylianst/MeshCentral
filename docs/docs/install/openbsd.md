# OpenBSD 6.4

In this section, we will look at installing MeshCentral on OpenBSD 6.4. This section was originally written by Daulton and placed here with this permission. The original instructions are located at: https://daulton.ca/meshcentral-server-on-openbsd/. The section will setup MeshCentral on non-standard ports HTTPS/3000 and HTTP/3001. Thank you to Daulton for his contribution.

## Installing MongoDB

Install the Mongodb package.

```
pkg_add mongodb
```

Start and enable Mongodb at boot.

```
rcctl start mongod
rcctl enable mongod
```

Temporary remount /usr with wxallowed while we compile the port. For Cloud VPS they usually only have a root partition instead of how OpenBSD splits it up by default, you will need to edit /etc/fstab and add wxallowed to the options for the root partition and then reboot. Assure to remove this from the fstab options after you are done.

```
mount -r -o wxallowed /usr/
```

## Installing NodeJS

Install NodeJS from ports as it is not available by a package.

```
$ cd /tmp
$ ftp https://cdn.openbsd.org/pub/OpenBSD/$(uname -r)/{ports.tar.gz,SHA256.sig}
# cd /usr
# tar xzf /tmp/ports.tar.gz
# cd /usr/ports/lang/node
# make install
# make clean
```

## Installing MeshCentral

Create the MeshCentral user. The parameters used here are important as we will not let this user login, it has no home directory, and its class is set to daemon. In line with the OpenBSD daemon user naming scheme, we preface the username with an underscore `_` to make it easily identifiable as a daemon user.

```
useradd -s /sbin/nologin -d /nonexistent -L daemon -u 446 _meshcentral
```

Let’s install MeshCentral and adjust the permissions.

```
mkdir -p /usr/local/meshcentral
cd /usr/local/meshcentral
npm install meshcentral
chown -R _meshcentral:_meshcentral /usr/local/meshcentral
```

Configuring for MongoDB and adjusting some other settings such as the network port. Open up the following config in an editor then, make the start of the file look like below. If the setting does not exist yet, just add it below one of the ones we are adjusting in the main settings block.

If you start with the default config.json created by MeshCentral, you will need to remove some underscore character in front of settings to enable the setting, such as mongodb and wanonly. You can also add an underscore to other values. For details on all of the config.json options, including the `WANonly` option, refer to the MeshCentral User’s Guide.

Before you can edit the configuration, start the Meshcentral briefly so it generates the default configurations and certificates. Once you see that it says "MeshCentral HTTPS server running...", Ctrl-C to exit then edit the configuration file next.

```
cd /usr/local/meshcentral/node_modules/meshcentral/ && doas -u _meshcentral /usr/local/bin/node /usr/local/meshcentral/node_modules/meshcentral/meshcentral.js --launch
```

Edit the MeshCentral config.json. For example using vi:

```
vi /usr/local/meshcentral/meshcentral-data/config.json
```

In the settings section, set the following key value pairs:

```json
{
"settings": {
"Cert": "meshcentral.example.com",
"MongoDb": "mongodb://127.0.0.1:27017/meshcentral",
"WANonly": true,
"Port": 3000,
"ExactPorts": true,
"RedirPort": 3001,
"allowLoginToken": true,
"allowFraming": true,
"NewAccounts": 0,
},
…
}
```

Add the following to the root crontab to start MeshCentral at boot. Edit the root crontab by doing the following command as root: crontab -e

```
@reboot cd /usr/local/meshcentral/node_modules/meshcentral/ && doas -u _meshcentral /usr/local/bin/node /usr/local/meshcentral/node_modules/meshcentral/meshcentral.js --launch
```

As root launch Meshcentral while it installs mongojs, once that finishes and Meshcentral launches close it by doing Ctrl-C. Adjust the permissions again as we ran Meshcentral and it generated new files we need to change the ownership of.

/usr/local/bin/node /usr/local/meshcentral/node_modules/meshcentral
```
chown -R _meshcentral:_meshcentral /usr/local/meshcentral
```

!!!Warning
    Do not keep this running or use this command in the future to start the Meshcentral server as it starts the server as root!

This is a reference /etc/pf.conf for you to keep your server secure. Add any locally connected networks which should have access and any public IP address of a network which will have client PCs connect from to target_whitelist table. Add your own home and/or business IP to my_own_IPs table.

```
ext_if = vio0
set reassemble yes
set block-policy return
set loginterface egress
set ruleset-optimization basic
set skip on lo

icmp_types = "{ 0, 8, 3, 4, 11, 30 }"

table <target_whitelist> const { 45.63.15.84, 10.18.5.0/24 }
table <my_own_IPs> const { 45.63.15.84 }
table <bruteforce>

match in all scrub (no-df max-mss 1440)
match out all scrub (no-df max-mss 1440)

block in quick log from urpf-failed label uRPF
block quick log from <fail2ban>

block in from no-route to any
block in from urpf-failed to any
block in quick on $ext_if from any to 255.255.255.255
block in log quick on $ext_if from { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 255.255.255.255/32 } to any antispoof for $ext_if
block log all

pass in quick inet proto icmp icmp-type $icmp_types
pass in quick inet6 proto icmp6

pass in quick proto tcp from <my_own_IPs> \
to (egress) port { 22 } \
flags S/SA modulate state \
(max-src-conn 5, max-src-conn-rate 5/5, overload <bruteforce> flush global)

pass in quick inet proto tcp from <target_whitelist> to port 3000
pass in quick inet6 proto tcp from <target_whitelist> to port 3000

block in quick log on egress all

pass out quick on egress proto tcp from any to any modulate state
pass out quick on egress proto udp from any to any keep state
pass out quick on egress proto icmp from any to any keep state
pass out quick on egress proto icmp6 from any to any keep state
```

After saving the configuration in /etc/pf.conf, reload the pf rules with:

```
pfctl -f /etc/pf.conf

```

To save rebooting and have MeshCentral launch then, launch it so you can begin using it. This time it is running as _meshcentral, now it is safe to keep running and you can use this command in the future.

```
cd /usr/local/meshcentral/node_modules/meshcentral/ && doas -u _meshcentral /usr/local/bin/node /usr/local/meshcentral/node_modules/meshcentral/meshcentral.js --launch
```

You can now access MeshCentral at https://youraddress:3000 or https://meshcentral.example.com:3000 if you named the machine meshcentral or create an A record named meshcentral. The first user you create will be the Administrator, there is no default user.