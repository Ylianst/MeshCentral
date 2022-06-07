FROM node:current-alpine

ARG INCLUDE_MONGODBTOOLS=""

#Add non-root user, add installation directories and assign proper permissions
RUN mkdir -p /opt/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral

RUN apk add --no-cache bash
RUN if [ "$INCLUDE_MONGODBTOOLS" == "yes" ] || [ "$INCLUDE_MONGODBTOOLS" == "YES" ]; then apk add --no-cache mongodb-tools; fi

RUN mkdir /opt/meshcentral/meshcentral
COPY ./ /opt/meshcentral/meshcentral/
COPY ./docker/config.json.template /opt/meshcentral/config.json.template
COPY ./docker/startup.sh startup.sh
RUN rm -rf ./docker

# install dependencies from package.json
RUN cd meshcentral && npm install

# install dependencies for plugins
RUN cd meshcentral && npm install nedb

# minify files - first try throws Error: Cannot find module 'jsdom'
RUN cd meshcentral/translate && node translate.js minifyall; exit 0
RUN cd meshcentral/translate && node translate.js minifyall

# translate
RUN cd meshcentral/translate && node translate.js translateall
RUN cd meshcentral/translate && node translate.js extractall

EXPOSE 80 443 4433

# volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backup

CMD ["bash", "/opt/meshcentral/startup.sh"]
