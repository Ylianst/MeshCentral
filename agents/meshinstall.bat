@echo off
reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS_bit= || set OS_bit=64
rename MeshService%OS_bit%.exe meshagent.exe
meshagent.exe -fullinstall
if exist "C:\Program Files\Mesh Agent\" copy /Y %cd%\meshuninstaller.bat "C:\Program Files\Mesh Agent\"
if exist "C:\Program Files (x86)\Mesh Agent\" copy /Y %cd%\meshuninstaller.bat "C:\Program Files (x86)\Mesh Agent\"
reg import meshagent%OS_bit%.reg
