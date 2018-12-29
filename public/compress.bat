@ECHO OFF
CALL:CompressHandlebars default
CALL:CompressHandlebars default-mobile
CALL:CompressHandlebars login
CALL:CompressHandlebars login-mobile
CALL:CompressHandlebars messenger
PAUSE
GOTO:eof

:CompressHandlebars
ECHO COMPRESS ..\views\%~1.handlebars TO ..\views\%~1-min.handlebars
DEL ..\views\%~1-min.handlebars
COPY ..\views\%~1.handlebars index.html
..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe compress.wcc -c
COPY compress.htm ..\views\%~1-min.handlebars
DEL compress.htm
DEL index.html
GOTO:eof
