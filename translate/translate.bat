@ECHO OFF
node translate.js minifyall
node translate.js translateall
node translate.js extractall
pause