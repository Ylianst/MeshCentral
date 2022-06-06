# Filename: Dockerfile

FROM node:slim

#Add non-root user, add installation directories and assign proper permissions
RUN mkdir -p /opt/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral



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

EXPOSE 80 443

#volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files

CMD ["bash", "/opt/meshcentral/startup.sh"]
