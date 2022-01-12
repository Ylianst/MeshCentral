@ECHO OFF
MD modules_meshcmd_min
MD modules_meshcore_min
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" compressalljs "modules_meshcore" "modules_meshcore_min"
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" compressalljs "modules_meshcmd" "modules_meshcmd_min"
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" meshcore.js
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" meshcmd.js

REM del meshcore.min.js
REM %LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node ..\translate\translate.js minify meshcore.js
REM rename meshcore.js.min meshcore.min.js

REM del meshcmd.min.js
REM %LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node ..\translate\translate.js minify meshcmd.js
REM rename meshcmd.js.min meshcmd.min.js

REM Minify the translations
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node ..\translate\translate.js minify modules_meshcore\coretranslations.json
COPY modules_meshcore\coretranslations.json.min modules_meshcore_min\coretranslations.json
DEL modules_meshcore\coretranslations.json.min