### STAGE 1 BUILDING.
FROM node:lts-alpine AS builder

ARG DISABLE_MINIFY=""
ARG DISABLE_TRANSLATE="yes"

RUN mkdir -p /opt/meshcentral/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Check if minify should be disabled on compilation.
RUN if ! [ -z "$DISABLE_MINIFY" ] \
    && [ "$DISABLE_MINIFY" != "yes" ] && [ "$DISABLE_MINIFY" != "YES" ] \
    && [ "$DISABLE_MINIFY" != "true" ] && [ "$DISABLE_MINIFY" != "TRUE" ]; then \
        echo "Invalid value for build argument DISABLE_MINIFY, possible values: 'yes' or 'true'"; \
        exit 1; \
    fi
# Check if translations should be compiled.
RUN if ! [ -z "$DISABLE_TRANSLATE" ] \
    && [ "$DISABLE_TRANSLATE" != "yes" ] && [ "$DISABLE_TRANSLATE" != "YES" ] \
    && [ "$DISABLE_TRANSLATE" != "true" ] && [ "$DISABLE_TRANSLATE" != "TRUE" ]; then \
        echo "Invalid value for build argument DISABLE_TRANSLATE, possible values: 'yes' or 'true'"; \
        exit 1; \
    fi

# Check the Docker build arguments and execute them accordingly.
RUN if [ -z "$DISABLE_MINIFY" ] || [ -z "$DISABLE_TRANSLATE" ]; then \
        cd meshcentral && \
        npm install html-minifier@4.0.0 jsdom@26.0.0 esprima@4.0.1 && \
\
        cd translate && \
        node translate.js extractall && \
\
        if [ -z "$DISABLE_MINIFY" ]; then \
            node translate.js minifyall; \
        fi; \
\
        if [ -z "$DISABLE_TRANSLATE" ]; then \
            node translate.js translateall; \
        fi \
    fi
# Possible more updated alternative? @minify-html/node@0.15.0 -> https://www.npmjs.com/package/@minify-html/node

# cleanup
RUN ls -l /opt/meshcentral/meshcentral
RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules

### STAGE 2 BUILDING.

FROM alpine:latest

ARG INCLUDE_MONGODBTOOLS=""
ARG PREINSTALL_LIBS="false"

# environment variables
ENV NODE_ENV="production"
ENV CONFIG_FILE="config.json"

# environment variables for initial configuration file
ENV USE_MONGODB="false"
ENV MONGO_INITDB_ROOT_USERNAME="root"
ENV MONGO_INITDB_ROOT_PASSWORD="pass"
ENV MONGO_URL=""
ENV HOSTNAME="localhost"
ENV ALLOW_NEW_ACCOUNTS="true"
ENV ALLOWPLUGINS="false"
ENV LOCALSESSIONRECORDING="true"
ENV MINIFY="false"
ENV WEBRTC="false"
ENV IFRAME="false"
ENV REVERSE_PROXY="false"
ENV REVERSE_PROXY_TLS_PORT=""
ENV ARGS=""
ENV ALLOWED_ORIGIN="false"

RUN mkdir -p /opt/meshcentral/meshcentral

# meshcentral installation
WORKDIR /opt/meshcentral

RUN apk update \
    && apk add --no-cache --update tzdata nodejs npm bash python3 postgresql-client make gcc g++ \
    && rm -rf /var/cache/apk/*
RUN npm install -g npm@latest

# NOTE: ALL MODULES MUST HAVE A VERSION NUMBER AND THE VERSION MUST MATCH THAT USED IN meshcentral.js mainStart()
RUN if ! [ -z "$INCLUDE_MONGODBTOOLS" ] \
    && [ "$INCLUDE_MONGODBTOOLS" != "yes" ] && [ "$INCLUDE_MONGODBTOOLS" != "YES" ] \
    && [ "$INCLUDE_MONGODBTOOLS" != "true" ] && [ "$INCLUDE_MONGODBTOOLS" != "TRUE" ]; then \
        echo -e "\e[0;31;49mInvalid value for build argument INCLUDE_MONGODBTOOLS, possible values: yes/true\e[;0m"; exit 1; \
    else \
        apk add --no-cache mongodb-tools; \
        cd meshcentral && npm install mongodb@6.15.0 saslprep@1.0.3; \
    fi

# copy files from builder-image
COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral
COPY ./docker/entrypoint.sh ./entrypoint.sh
COPY ./docker/config.json.template /opt/meshcentral/config.json.template

# install dependencies from package.json
RUN cd meshcentral && npm install

RUN if ! [ -z "$PREINSTALL_LIBS" ] \
    && [ "$PREINSTALL_LIBS" == "true" ]; then \
        cd meshcentral && npm install ssh2@1.16.0 semver@7.7.1 nodemailer@6.10.0 image-size@2.0.1 wildleek@2.0.0 otplib@12.0.1 yubikeyotp@0.2.0; \
    fi

EXPOSE 80 443 4433

# volumes
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backups

WORKDIR /opt/meshcentral
CMD ["bash", "/opt/meshcentral/entrypoint.sh"]
