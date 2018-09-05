@echo off
cd /D "%ProgramFiles%\Mesh Agent\"
sc stop "Mesh Agent" >nul 2>&1
meshagent.exe -uninstall
sc delete "Mesh Agent" >nul 2>&1
reg delete "HKLM\System\CurrentControlSet\services\Mesh Agent" /f
reg delete "HKLM\System\ControlSet001\services\Mesh Agent" /f
reg delete HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\MeshAgent /f
if exist "C:\Program Files\Mesh Agent\" (goto) 2>nul & rmdir /Q /S "C:\Program Files\Mesh Agent\"
if exist "C:\Program Files (x86)\Mesh Agent\" (goto) 2>nul & rmdir /Q /S "C:\Program Files (x86)\Mesh Agent\"
(goto) 2>nul & del "%~f0"
