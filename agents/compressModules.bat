@ECHO OFF
MD modules_meshcmd_min
MD modules_meshcore_min

node ..\translate\translate.js minify ..\agents\meshcore.js ..\agents\meshcore.min.js
node ..\translate\translate.js minify ..\agents\meshcmd.js ..\agents\meshcmd.min.js

node ..\translate\translate.js minifydir ..\agents\modules_meshcore ..\agents\modules_meshcore_min
node ..\translate\translate.js minifydir ..\agents\modules_meshcmd ..\agents\modules_meshcmd_min
