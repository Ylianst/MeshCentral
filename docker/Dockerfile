### STAGE 1 BUILDING.
FROM node:lts-alpine AS builder

# Any value inside one of the disable ARGs will be accepted.
ARG DISABLE_MINIFY="yes"
ARG DISABLE_TRANSLATE="yes"

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Check the Docker build arguments and if they are empty do the task.
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

# cleanup for inter-container copying.
RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules

### STAGE 2 BUILDING.

FROM alpine:latest

ARG PREINSTALL_LIBS="false"

# environment variables
ENV NODE_ENV="production"
ENV CONFIG_FILE="/opt/meshcentral/meshcentral-data/config.json"
ENV DYNAMIC_CONFIG="true"

# environment variables for the above defined MeshCentral Config.json
ENV ALLOWPLUGINS="false"
ENV ALLOW_NEW_ACCOUNTS="false"
ENV ALLOWED_ORIGIN="false"
ENV ARGS=""
ENV HOSTNAME="localhost"
ENV IFRAME="false"
ENV LOCALSESSIONRECORDING="true"
ENV MINIFY="true"
ENV REGENSESSIONKEY="false"
ENV REVERSE_PROXY=""
ENV REVERSE_PROXY_TLS_PORT=""
ENV WEBRTC="false"


# MongoDB Variables
ARG INCLUDE_MONGODB_TOOLS="false"

ENV USE_MONGODB="false"
ENV MONGO_HOST=""
ENV MONGO_PORT="27017"
ENV MONGO_USERNAME=""
ENV MONGO_PASS=""
# The following Mongo variable overwrites most previously declared variables.
ENV MONGO_URL=""

# PostgreSQL Variables
ARG INCLUDE_POSTGRESQL_TOOLS="false"

ENV USE_POSTGRESQL="false"
ENV PSQL_HOST=""
ENV PSQL_PORT="5432"
ENV PSQL_USER=""
ENV PSQL_PASS=""
ENV PSQL_DATABASE=""

# MariaDB/MySQL Variables, Alpine Linux only provides the actual MariaDB binaries.
ARG INCLUDE_MARIADB_TOOLS="false"

ENV USE_MARIADB="false"
ENV MARIADB_HOST=""
ENV MARIADB_PORT="3306"
ENV MARIADB_USER=""
ENV MARIADB_PASS=""
ENV MARIADB_DATABASE=""

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral

RUN apk update \
    && apk add --no-cache --update \
    bash gcc g++ jq make nodejs npm python3 tzdata \
    && rm -rf /var/cache/* \
        /tmp/* \
        /usr/share/man/ \
        /usr/share/doc/ \
        /var/log/* \
        /var/spool/* \
        /usr/lib/debug/
RUN npm install -g npm@latest

# NOTE: ALL MODULES MUST HAVE A VERSION NUMBER AND THE VERSION MUST MATCH THAT USED IN meshcentraljs mainStart()
RUN case "$INCLUDE_MONGODB_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache mongodb-tools && \
            cd meshcentral && npm install mongodb@6.15.0 saslprep@1.0.3 \
            ;; \
        false|no|FALSE|NO) \
            echo "Not including MongoDB Tools.";; \
        *) \
            echo "Invalid value for build argument INCLUDE_MONGODB_TOOLS, possible values: 'yes' or 'true'"; \
            exit 1;; \
    esac

RUN case "$INCLUDE_POSTGRESQL_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache postgresql-client && \
            cd meshcentral && npm install pg@8.14.1 \
            ;; \
        false|no|FALSE|NO) \
            echo "Not including PostgreSQL Tools.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_POSTGRESQL_TOOLS, possible values: 'yes' or 'true'"; \
            exit 1;; \
    esac

RUN case "$INCLUDE_MARIADB_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache mariadb-client && \
            cd meshcentral && npm install mariadb@3.4.0 \
            ;; \
        false|no|FALSE|NO) \
            echo "Not including MariaDB/MySQL Tools.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_MARIADB_TOOLS, possible values: 'yes' or 'true'"; \
            exit 1;; \
    esac

# copy files from builder-image
COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral

# install dependencies from package.json
RUN cd meshcentral && npm install

RUN case "$PREINSTALL_LIBS" in \
        true|yes|TRUE|YES) \
            cd meshcentral && \
            npm install ssh2@1.16.0 semver@7.7.1 nodemailer@6.10.0 image-size@2.0.1 wildleek@2.0.0 otplib@12.0.1 yubikeyotp@0.2.0;; \
        false|no|FALSE|NO) \
            echo "Not pre-installing libraries.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_POSTGRESQL_TOOLS, possible values: 'yes' or 'true'"; \
            exit 1;; \
    esac

# Expose only 443 by default to reduce attack surface. (Only encrypted ports).
EXPOSE 443

# These volumes will be created by default even without any declaration, this allows default persistence in Docker/Podman.
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backups

# Copy images from Git repo, place it before ending so recompilation can make good use of cache.
COPY ./docker/entrypoint.sh ./entrypoint.sh
COPY ./docker/config.json.template /opt/meshcentral/config.json.template

CMD ["bash", "/opt/meshcentral/entrypoint.sh"]