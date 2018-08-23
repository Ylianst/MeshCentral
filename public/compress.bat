@ECHO OFF
REM *** default.handlebars
DEL ..\views\default-min.handlebars
COPY ..\views\default.handlebars index.html
..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe compress.wcc -c
COPY compress.htm ..\views\default-min.handlebars
DEL compress.htm
DEL index.html

REM *** default-mobile.handlebars
DEL ..\views\default-mobile-min.handlebars
COPY ..\views\default-mobile.handlebars index.html
..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe compress.wcc -c
COPY compress.htm ..\views\default-mobile-min.handlebars
DEL compress.htm
DEL index.html

REM *** login.handlebars
DEL ..\views\login-min.handlebars
COPY ..\views\login.handlebars index.html
..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe compress.wcc -c
COPY compress.htm ..\views\login-min.handlebars
DEL compress.htm
DEL index.html

REM *** login-mobile.handlebars
DEL ..\views\login-mobile-min.handlebars
COPY ..\views\login-mobile.handlebars index.html
..\..\WebSiteCompiler\bin\Debug\WebSiteCompiler.exe compress.wcc -c
COPY compress.htm ..\views\login-mobile-min.handlebars
DEL compress.htm
DEL index.html