@ECHO OFF
DEL meshcmd.min.js
DEL meshcore.min.js
DEL modules_meshcmd_min\*.min.js
DEL modules_meshcore_min\*.min.js
DEL modules_meshcore_min\*.json
RD modules_meshcmd_min
RD modules_meshcore_min