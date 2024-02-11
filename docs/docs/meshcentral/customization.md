# Customization

Whitelabeling your MeshCentral installation to personalize it to your companies brand, as well as having your own terms of use is one of the first things many people do after installation.

<div class="video-wrapper">
  <iframe width="320" height="180" src="https://www.youtube.com/embed/xUZ1w9RSKpQ" frameborder="0" allowfullscreen></iframe>
</div>

## Web Branding

You can put you own logo on the top of the web page. To get started, get the file “logoback.png” from the folder “node_modules/meshcentral/public/images” and copy it to your “meshcentral-data” folder. In this example, we will change the name of the file “logoback.png” to “title-mycompany.png”. Then use any image editor to change the image and place your logo.

![](images/2022-05-19-00-38-51.png)

Once done, edit the config.json file and set one or all of the following values:

```json
"domains": {
  "": {
    "Title": "",
    "Title2": "",
    "TitlePicture": "title-sample.png",
    "loginPicture": "logintitle-sample.png",
    "welcomeText": "This is sample text",
    "welcomePicture": "mainwelcome-04.jpg",
    "welcomePictureFullScreen": true,
    "siteStyle": "1",
    "nightMode": "1",
    "meshMessengerTitle": "Mesh Chat",
    "meshMessengerPicture": "chatimage.png",
    "footer": "This is a HTML string displayed at the bottom of the web page when a user is logged in.",
    "loginfooter": "This is a HTML string displayed at the bottom of the web page when a user is not logged in."
  },
```

This will set the title and sub-title text to empty and set the background image to the new title picture file. You can now restart the serve and take a look at the web page. Both the desktop and mobile sites will change.

![](images/2022-05-19-00-39-35.png)

![](images/2022-05-19-00-39-42.png)

The title image must a PNG image of size 450 x 66.

You can also customize the server icon in the “My Server” tab. By default, it’s a picture of a desktop with a padlock.

![](images/2022-05-19-00-40-00.png)

If, for example, MeshCentral is running on a Raspberry Pi. You may want to put a different picture at this location. Just put a “server.jpg” file that is 200 x 200 pixels in the “meshcentral-data” folder. The time MeshCentral page is loaded, you will see the new image.

![](images/2022-05-19-00-40-13.png)

This is great to personalize the look of the server within the web site.

## Agent Branding

You can customize the Agent to add your own logo, change the title bar, install text, the service name, or even colors!

!!!note
	The Customization must be done FIRST and BEFORE you deploy your agents! Once the agents have been deployed, any customization made afterwards, will not sync! This is because the setup files are customized on the fly, then when you install the agents, the exe and .msh file with the customizations in are copied over to the required folder, so you will need to reinstall the agent for agent customizations to take effect.

![](images/2022-08-24-06-42-40.png)

```json
"domains": {
	"": {
		"agentCustomization": {
			"displayName": "MeshCentral Agent",
			"description": "Mesh Agent background service",
			"companyName": "Mesh Agent Company",
			"serviceName": "Mesh Agent Service",
			"installText": "Text string to show in the agent installation dialog box",
			"image": "mylogo.png",
			"fileName": "meshagent",
			"foregroundColor": "#FFA500",
			"backgroundColor": "#EE82EE"
		}
	}
}
```

![agent icon](images/agentico.png)

## Terms of use

You can change the terms of use of the web site by adding a “terms.txt” file in the “meshcentral-data” folder. The file can include HTML markup. Once set, the server does not need to be restarted, the updated terms.txt file will get used the next time it’s requested.

For example, placing this in “terms.txt”

```
<br />
This is a <b>test file</b>.
```

Will show this on the terms of use web page.
