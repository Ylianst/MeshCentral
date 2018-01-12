@echo off
cd /D %HOMEPATH%
reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS=x86 || set OS=x64
powershell (new-object System.Net.WebClient).DownloadFile('http://nodejs.org/dist/v9.3.0/node-v9.3.0-%OS%.msi','node-v9.3.0-%OS%.msi')
rem powershell (new-object System.Net.WebClient).DownloadFile('http://downloads.mongodb.org/win32/mongodb-win32-x86_64-2008plus-ssl-3.6.1-signed.msi','mongodb-win32-x86_64-2008plus-ssl-3.6.1-signed.msi')
msiexec /i node-v9.3.0-%OS%.msi /passive /norestart /qn
rem msiexec /i mongodb-win32-x86_64-2008plus-ssl-3.6.1-signed.msi /passive /norestart /qn
del node-v9.3.0-%OS%.msi
rem del mongodb-win32-x86_64-2008plus-ssl-3.6.1-signed.msi
npm install -g win-7zip rem -g letsencrypt-cli
powershell (new-object System.Net.WebClient).DownloadFile('http://www.7-zip.org/a/lzma1604.7z','lzma1604.7z')
7z x lzma1604.7z -olzma1604
copy /B /Y /V lzma1604\bin\*.sfx AppData\Roaming\npm\node_modules\win-7zip\7zip-lite\
del lzma1604.7z
rmdir /S /Q lzma1604
