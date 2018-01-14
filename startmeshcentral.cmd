@echo off
if "%1"=="" (
 set PORT=443 
) else (
 if not "%1"=="install" set PORT=%1 
)

if "%2"=="" (
 set RPORT=80
) else (
 set RPORT=%2
)

cd /D %HOMEPATH%
if "%1"=="install" node node_modules/meshcentral/meshcentral.js --install --cert %USERDOMAIN%
if exist meshcentral-data/webserver-cert-private.key if not "%1"=="install" node node_modules/meshcentral/meshcentral.js --port %PORT% --redirport %RPORT%
if not exist meshcentral-data/webserver-cert-private.key if not "%1"=="install"  node node_modules/meshcentral/meshcentral.js --cert %USERDOMAIN% --port %PORT% --redirport %RPORT%
