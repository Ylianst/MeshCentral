@echo off
reg Query "HKLM\Hardware\Description\System\CentralProcessor\0" | find /i "x86" > NUL && set OS_bit= || set OS_bit=64
rename MeshService%OS_bit%.exe meshagent.exe
meshagent.exe 
