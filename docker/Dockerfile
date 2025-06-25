### STAGE 1 BUILDING.
FROM node:lts-alpine3.21 AS builder

# Any value inside one of the disable ARGs will be accepted.
ARG DISABLE_MINIFY="yes"
ARG DISABLE_TRANSLATE="yes"
#    NODE_OPTIONS="--max_old_space_size=4096"
# If your process gets OOM killed, perhaps the above will help.

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Check the Docker build arguments and if they are empty do the task.
RUN if [ -n "$DISABLE_MINIFY" ] || [ -n "$DISABLE_TRANSLATE" ]; then \
        echo -e "----------\nPREPARING ENVIRONMENT...\n----------"; \
        cd meshcentral && \
        npm install html-minifier-terser@7.2.0 jsdom@26.0.0 esprima@4.0.1 && \
        cd translate && \
        echo -e "----------\nSTARTING THE EXTRACTING PROCESS...\n----------"; \
        node translate.js extractall && \
        case "$DISABLE_MINIFY" in \
            false|no|FALSE|NO) \
                echo -e "----------\nSTARTING THE MINIFYING PROCESS...\n----------"; \
                node translate.js minifyall;; \
            *) \
                echo "Setting MINIFY as disabled.";; \
        esac && \
        case "$DISABLE_TRANSLATE" in \
            false|no|FALSE|NO) \
                echo -e "----------\nSTARTING THE TRANSLATING PROCESS...\n----------"; \
                node translate.js translateall;; \
            *) \
                echo "Setting TRANSLATE as disabled.";; \
        esac; \
        npm uninstall html-minifier-terser jsdom esprima; \
    fi
# Possible more updated alternative? @minify-html/node@0.15.0 -> https://www.npmjs.com/package/@minify-html/node

RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules

### STAGE 2 BUILDING.

FROM alpine:3.21

# copy files from builder-image
COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral

# environment variables
ENV NODE_ENV="production" \
    CONFIG_FILE="/opt/meshcentral/meshcentral-data/config.json" \
    DYNAMIC_CONFIG="false"

# environment variables for the above defined MeshCentral Config.json. Can be done like that following: https://docs.docker.com/reference/dockerfile/#env
ENV ALLOW_PLUGINS="false" \
    ALLOW_NEW_ACCOUNTS="false" \
    ALLOWED_ORIGIN="false" \
    IFRAME="false" \
    REGEN_SESSIONKEY="false" \
    WEBRTC="false" \
    LOCAL_SESSION_RECORDING="true" \
    MINIFY="true" \
    HOSTNAME="localhost" \
    REVERSE_PROXY="" \
    REVERSE_PROXY_TLS_PORT="443" \
    TRUSTED_PROXY="" \
    ARGS=""

# Database
# Multi-variable declaration to reduce layers.
ENV USE_MONGODB="false" \
    USE_POSTGRESQL="false" \
    USE_MARIADB="false"

# Preinstallation args one per line due to: https://docs.docker.com/reference/dockerfile/#arg
ARG PREINSTALL_LIBS="false"
ARG INCLUDE_MONGODB_TOOLS="false"
ARG INCLUDE_POSTGRESQL_TOOLS="false"
ARG INCLUDE_MARIADB_TOOLS="false"

# MongoDB Variables
# The following MONGO_URL variable overwrites most other mongoDb related varialbes.
ENV MONGO_HOST="" \
    MONGO_PORT="27017" \
    MONGO_USERNAME="" \
    MONGO_PASS="" \
    MONGO_URL=""

# PostgreSQL Variables
ENV PSQL_HOST="" \
    PSQL_PORT="5432" \
    PSQL_USER="" \
    PSQL_PASS="" \
    PSQL_DATABASE=""

# MariaDB/MySQL Variables, Alpine Linux only provides the actual MariaDB binaries.
ENV MARIADB_HOST="" \
    MARIADB_PORT="3306" \
    MARIADB_USER="" \
    MARIADB_PASS="" \
    MARIADB_DATABASE=""

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral

RUN apk update && \
    echo -e "----------\nINSTALLING ALPINE PACKAGES...\n----------"; \
    apk add --no-cache --update \
        bash gcc g++ jq make nodejs npm python3 tzdata && \
    rm -rf /var/cache/* \
        /tmp/* \
        /usr/share/man/ \
        /usr/share/doc/ \
        /var/log/* \
        /var/spool/* \
        /usr/lib/debug/ && \
    npm install -g npm@latest

RUN case "$PREINSTALL_LIBS" in \
        true|yes|TRUE|YES) \
            cd meshcentral && \
            echo -e "----------\nPREINSTALLING LIBRARIES...\n----------"; \
            npm install ssh2@1.16.0 nodemailer@6.10.0 image-size@2.0.1 wildleek@2.0.0 otplib@12.0.1 yubikeyotp@0.2.0;; \
        false|no|FALSE|NO) \
            echo "Not pre-installing libraries.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_POSTGRESQL_TOOLS, possible values: 'yes', 'true', 'no' or 'false'"; \
            exit 1;; \
    esac

# NOTE: ALL MODULES MUST HAVE A VERSION NUMBER AND THE VERSION MUST MATCH THAT USED IN meshcentraljs mainStart()
RUN case "$INCLUDE_MONGODB_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache mongodb-tools && \
            cd meshcentral && \
            echo -e "----------\nPREINSTALLING MONGODB LIBRARIES...\n----------"; \
            npm install mongodb@4.17.2;; \
        false|no|FALSE|NO) \
            echo "Not including MongoDB Tools.";; \
        *) \
            echo "Invalid value for build argument INCLUDE_MONGODB_TOOLS, possible values: 'yes', 'true', 'no' or 'false'"; \
            exit 1;; \
    esac

RUN case "$INCLUDE_POSTGRESQL_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache postgresql-client && \
            cd meshcentral && \
            echo -e "----------\nPREINSTALLING POSTGRESQL LIBRARIES...\n----------"; \
            npm install pg@8.14.1;; \
        false|no|FALSE|NO) \
            echo "Not including PostgreSQL Tools.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_POSTGRESQL_TOOLS, possible values: 'yes', 'true', 'no' or 'false'"; \
            exit 1;; \
    esac

RUN case "$INCLUDE_MARIADB_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache mariadb-client && \
            cd meshcentral && \
            echo -e "----------\nPREINSTALLING MARIADB/MYSQL LIBRARIES...\n----------"; \
            npm install mariadb@3.4.0 mysql2@3.11.4;; \
        false|no|FALSE|NO) \
            echo "Not including MariaDB/MySQL Tools.";; \
        *) \
            echo -e "Invalid value for build argument INCLUDE_MARIADB_TOOLS, possible values: 'yes', 'true', 'no' or 'false'"; \
            exit 1;; \
    esac

# install dependencies from package.json
RUN cd meshcentral && \
    npm install && \
    npm cache clean --force && \
    rm -rf /root/ /tmp/

# Expose needed ports
EXPOSE 80 443

# These volumes will be created by default even without any declaration, this allows default persistence in Docker/Podman.
VOLUME /opt/meshcentral/meshcentral-data
VOLUME /opt/meshcentral/meshcentral-files
VOLUME /opt/meshcentral/meshcentral-web
VOLUME /opt/meshcentral/meshcentral-backups

# Copy images from Git repo, place it before ending so recompilation can make good use of cache.
COPY ./docker/entrypoint.sh ./entrypoint.sh
COPY ./docker/config.json.template /opt/meshcentral/config.json.template

ENTRYPOINT  ["bash", "/opt/meshcentral/entrypoint.sh"]
