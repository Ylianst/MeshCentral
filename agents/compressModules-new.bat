@ECHO OFF
MD modules_meshcmd_min
MD modules_meshcore_min

%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node ..\translate\translate.js minify meshcmd.js
RENAME meshcmd.js.min meshcmd.min.js
%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node ..\translate\translate.js minify meshcore.js
RENAME meshcore.js.min meshcore.min.js

%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node ..\translate\translate.js minifydir C:\Users\Default.DESKTOP-9CGK2DI\Desktop\AmtWebApp\meshcentral\agents\modules_meshcore C:\Users\Default.DESKTOP-9CGK2DI\Desktop\AmtWebApp\meshcentral\agents\modules_meshcore_min
%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node ..\translate\translate.js minifydir C:\Users\Default.DESKTOP-9CGK2DI\Desktop\AmtWebApp\meshcentral\agents\modules_meshcmd C:\Users\Default.DESKTOP-9CGK2DI\Desktop\AmtWebApp\meshcentral\agents\modules_meshcmd_min
