FROM node:current-alpine AS base

#Add non-root user, add installation directories and assign proper permissions
RUN mkdir -p /opt/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral

RUN apk add --no-cache bash


FROM base AS builder

RUN mkdir /opt/meshcentral/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# minify files - first try throws Error: Cannot find module 'jsdom'
RUN cd meshcentral/translate && node translate.js minifyall; exit 0
RUN cd meshcentral/translate && node translate.js minifyall

# translate
RUN cd meshcentral/translate && node translate.js translateall
RUN cd meshcentral/translate && node translate.js extractall


FROM base

ARG INCLUDE_MONGODBTOOLS=""
RUN if [ "$INCLUDE_MONGODBTOOLS" == "yes" ] || [ "$INCLUDE_MONGODBTOOLS" == "YES" ]; then apk add --no-cache mongodb-tools; fi

# copy files from builder-image
COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral
COPY --from=builder /opt/meshcentral/meshcentral/docker/startup.sh ./startup.sh
COPY --from=builder /opt/meshcentral/meshcentral/docker/config.json.template /opt/meshcentral/config.json.template

# cleanup
RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules

# install dependencies from package.json
RUN cd meshcentral && npm install

# install dependencies for plugins
RUN cd meshcentral && npm install nedb

EXPOSE 80 443 4433

# volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backup

CMD ["bash", "/opt/meshcentral/startup.sh"]
