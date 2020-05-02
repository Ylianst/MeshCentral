@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v12.13.0\node translate.js minifyall
DEL ..\emails\translations\*-min_*