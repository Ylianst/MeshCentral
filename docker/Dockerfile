# Filename: Dockerfile

FROM node:slim

#Add non-root user, add installation directories and assign proper permissions
RUN mkdir -p /opt/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral

# add mongodb repository to apt
RUN apt-get update && apt-get install -y gnupg2 wget
RUN wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | apt-key add -
RUN echo "deb http://repo.mongodb.org/apt/debian buster/mongodb-org/5.0 main" | tee /etc/apt/sources.list.d/mongodb-org-5.0.list

# install mongodb
RUN apt-get update \
    && apt-get install -y mongodb-org-tools \
    && rm -rf /var/lib/apt/lists/*

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

# volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backup

CMD ["bash", "/opt/meshcentral/startup.sh"]
