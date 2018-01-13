FROM node:stretch
MAINTAINER Lawrence Stubbs <technoexpressnet@gmail.com>

COPY startmeshcentral.sh /
RUN apt-get update \
    && apt-get install -y p7zip-full \
    && wget -q http://www.7-zip.org/a/lzma1604.7z \
    && 7z x lzma1604.7z -olzma1604 \
    && cp lzma1604/bin/*.sfx /usr/lib/p7zip/ \
    && rm -f lzma1604.7z \
    && rm -rf lzma1604 \
    && npm install -g forever

RUN npm install greenlock-cli \
    && chmod +x /startmeshcentral.sh \
    && adduser --quiet meshcentral

RUN su - meshcentral \
    && npm install meshcentral node-7z
    
ENV PORT 443  
ENV REDIRPORT 80  

EXPOSE 80 443 25 

ENTRYPOINT ["/startmeshcentral.sh"]
