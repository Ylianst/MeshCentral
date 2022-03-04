
You can't use the MeshCentral Router (MCR) login dialog box to login to a server that uses SAML or OAuth. However, you can still use MCR

Download MCR and run it. In the first dialog box, there will be an "Install..." button to setup MeshCentral router with the "mcrouter://" protocol in your system registry. Once done, close MCR.

Now log into the web UI of your MeshCentral server. Go in the bottom of the "My Devices" tab, hit the "Router" link and hit "Launch MeshCentral Router".

This will launch the router and connect directly to your server using a login cookie.

The only drawback is you will have to manually load mappings saved in an .mcrouter file. When not using SAML, you can click on the .mcrouter file to load the mappings and MCR at the same time. 
