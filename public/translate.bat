@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js minifyall
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js translateall
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js extractall
DEL ..\emails\translations\*-min_*
