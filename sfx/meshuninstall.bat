@echo off
reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS_bit=x86 || set OS_bit=x64
if %OS_bit%=="x86" (
    rename MeshService.exe meshagent.exe
) else (
    rename MeshService64.exe meshagent.exe
)
meshagent.exe -fulluninstall
