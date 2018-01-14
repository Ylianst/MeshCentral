FROM node:stretch
MAINTAINER Lawrence Stubbs <technoexpressnet@gmail.com>

COPY startmeshcentral.sh /
RUN apt-get update \
    && apt-get install -y p7zip-full \
    && wget -q http://www.7-zip.org/a/lzma1604.7z \
    && 7z x lzma1604.7z -olzma1604 \
    && cp lzma1604/bin/*.sfx /usr/lib/p7zip/ \
    && rm -f lzma1604.7z \
    && rm -rf lzma1604

#RUN apt-get install -y mongodb
	
RUN adduser --quiet meshserver \
    && chmod +x /startmeshcentral.sh \
	&& su - meshserver \
	&& cd /home/meshserver \
    && npm install github:techno-express/MeshCentral
    
ENV PORT 443  
ENV REDIRPORT 80  
ENV MPSPORT 4443  

EXPOSE 25 80 443 4443 27017 27018

ENTRYPOINT ["/startmeshcentral.sh"]
