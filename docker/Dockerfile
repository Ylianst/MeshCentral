FROM alpine:latest AS base

#Add non-root user, add installation directories and assign proper permissions
RUN mkdir -p /opt/meshcentral/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral

RUN apk update \
    && apk add --no-cache --update nodejs npm bash \
    && rm -rf /var/cache/apk/*
RUN npm install -g npm@latest


FROM base AS builder

ARG DISABLE_MINIFY=""
ARG DISABLE_TRANSLATE=""

COPY ./ /opt/meshcentral/meshcentral/

RUN if ! [ -z "$DISABLE_MINIFY" ] && [ "$DISABLE_MINIFY" != "yes" ] && [ "$DISABLE_MINIFY" != "YES" ] \
    && [ "$DISABLE_MINIFY" != "true" ] && [ "$DISABLE_MINIFY" != "TRUE" ]; then \
        echo -e "\e[0;31;49mInvalid value for build argument DISABLE_MINIFY, possible values: yes/true\e[;0m"; exit 1; \
    fi
RUN if ! [ -z "$DISABLE_TRANSLATE" ] && [ "$DISABLE_TRANSLATE" != "yes" ] && [ "$DISABLE_TRANSLATE" != "YES" ] \
    && [ "$DISABLE_TRANSLATE" != "true" ] && [ "$DISABLE_TRANSLATE" != "TRUE" ]; then \
        echo -e "\e[0;31;49mInvalid value for build argument DISABLE_TRANSLATE, possible values: yes/true\e[;0m"; exit 1; \
    fi

# install translate/minify modules if need too
RUN if [ -z "$DISABLE_MINIFY" ] || [ -z "$DISABLE_TRANSLATE" ]; then cd meshcentral && npm install html-minifier jsdom minify-js; fi

# first extractall if need too
RUN if [ -z "$DISABLE_MINIFY" ] || [ -z "$DISABLE_TRANSLATE" ]; then cd meshcentral/translate && node translate.js extractall; fi

# minify files
RUN if [ -z "$DISABLE_MINIFY" ]; then cd meshcentral/translate && node translate.js minifyall; fi

# translate
RUN if [ -z "$DISABLE_TRANSLATE" ]; then cd meshcentral/translate && node translate.js translateall; fi

# cleanup
RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules


FROM base

ARG INCLUDE_MONGODBTOOLS=""
RUN if ! [ -z "$INCLUDE_MONGODBTOOLS" ] && [ "$INCLUDE_MONGODBTOOLS" != "yes" ] && [ "$INCLUDE_MONGODBTOOLS" != "YES" ] \
    && [ "$INCLUDE_MONGODBTOOLS" != "true" ] && [ "$INCLUDE_MONGODBTOOLS" != "TRUE" ]; then \
        echo -e "\e[0;31;49mInvalid value for build argument INCLUDE_MONGODBTOOLS, possible values: yes/true\e[;0m"; exit 1; \
    fi

RUN if ! [ -z "$INCLUDE_MONGODBTOOLS" ]; then apk add --no-cache mongodb-tools; fi

# copy files from builder-image
COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral
COPY ./docker/startup.sh ./startup.sh
COPY ./docker/config.json.template /opt/meshcentral/config.json.template

# install dependencies from package.json and nedb
RUN cd meshcentral && npm install && npm install nedb

EXPOSE 80 443 4433

# volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backup

CMD ["bash", "/opt/meshcentral/startup.sh"]
