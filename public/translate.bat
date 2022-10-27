@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node64 translate.js minifyall
%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node64 translate.js translateall
%LOCALAPPDATA%\..\Roaming\nvm\v14.16.0\node64 translate.js extractall
DEL ..\emails\translations\*-min_*
Pause