@ECHO OFF
CD ..\translate
%LOCALAPPDATA%\..\Roaming\nvm\v22.11.0\node translate.js minifyall
DEL ..\emails\translations\*-min_*