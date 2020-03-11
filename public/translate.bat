@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node64 translate.js minifyall
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node64 translate.js translateall
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node64 translate.js extractall
