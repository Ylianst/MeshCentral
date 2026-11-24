@ECHO OFF
node translate.js extractall
node translate.js minifyall
node translate.js translateall
pause