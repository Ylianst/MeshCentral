# FAQ

## json config files

Any item in the config.json file starting with an underscore character are ignored.

Ignored

```json
"_title": "MyServer"
```

Valid setting

```json
"title": "MyServer"
```

json requires correct formatting, if in doubt copy/paste your json config into a web based format checker to make sure you have it right: <https://duckduckgo.com/?va=j&t=hc&q=json+lint&ia=answer>

## Help! I've been hacked there are weird agents appearing in my MeshCentral Console

No, you haven't.

1. Your agent installer was scanned by an antivirus.

2. It didn't recognize the exe.

3. You have the option enabled to submit unknown applications for analysis.

    ![AV Option1](images/faq_av_option1.png)

4. They ran it against their virtualization testing cluster.

5. You allow anyone to connect to your server (you should look into techniques to hide your server from the internet).

6. Here are some examples of what that looks like.

## Can't login on server after first setup

You're sure you're typing in everything right, giving it 2FA code and can't login

[TOTP](https://en.wikipedia.org/wiki/Time-based_one-time_password) is time sensitive, check your time/NTP and make sure it's right (on server and TOTP app device)! :)

![](images/2022-08-04-18-19-19.png)

## Branding and Customization

You can brand and customize MeshCentral almost as much as you like without delving into the code, a few changes in the config.json file and uploading images can change the way your system looks. Read more [here](https://ylianst.github.io/MeshCentral/meshcentral/#branding-terms-of-use)

!!!note
    You will need to reinstall the agent for agent customizations to take effect.

## Mac Clients

You have to manually grant Mac permissions outside of the agent install process due to the MacOS security system under Security & Privacy > Privacy

To see the screen (otherwise you just see the menu bar, and otherwise blank)

![](images/2023-11-29-12-57-15.png)

To be able to transfer files

![](images/2023-11-29-12-58-05.png)

To be able to control keyboard and mouse

![](images/2023-11-29-12-58-36.png)

## I'm using CloudFlare and I'm getting a black screen but the mouse moves?

If you are using CloudFlare for your DNS hosting and your remote screen is black, DONT PANIC!

Unfortunately, MeshCentral doesn't always work with CloudFlare's Proxy DNS Mode.  

The fix is to simply set the 'Proxy Status' to OFF inside your DNS A Record, within the CloudFlare control panel.

Simply follow the steps [here](https://developers.cloudflare.com/fundamentals/setup/manage-domains/pause-cloudflare/#disable-proxy-on-dns-records)

Once done, open your firewall for the `port` and `agentPort` ports of where your meshcentral is hosted, then restart your MeshCentral Server

There is currently a PINNED GitHub issue about this [here](https://github.com/Ylianst/MeshCentral/issues/5302)

