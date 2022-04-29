node-rdpjs
==========

This folder contains a fork of the node-rdpjs2 package which is identical to [node-rdpjs](github.com/citronneur/node-rdpjs) v0.2.1 but just updated for
latest versions of Node along with more modifications to remove dependencies and more importantly, added support for Network Layer Authentication (NLA).

NLA support was ported from [RDP-RS](https://github.com/citronneur/rdp-rs) which is a Rust RDP solution by the same author as node-rdpjs.

The license for node-rdpjs is GPL 3.0 and is limited the the "rdp" folder. If this is a concern, you can delete the "rdp" folder and MeshCentral will
still work perfectly without RDP functionality.