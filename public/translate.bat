@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js minifyall
REM %LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js translateall
REM %LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js extractall
DEL ..\emails\translations\*-min_*
Pause