@ECHO OFF
MD modules_meshcmd_min
MD modules_meshcore_min
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" compressalljs "modules_meshcore" "modules_meshcore_min"
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" compressalljs "modules_meshcmd" "modules_meshcmd_min"
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" meshcore.js
"..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe" meshcmd.js
