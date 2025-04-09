### STAGE 1 BUILDING.
FROM node:lts-alpine3.21 AS builder

# Any value inside one of the disable ARGs will be accepted.
ARG DISABLE_MINIFY="yes" \
    DISABLE_TRANSLATE="yes"

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Check the Docker build arguments and if they are empty do the task.
RUN if [ -z "$DISABLE_MINIFY" ] || [ -z "$DISABLE_TRANSLATE" ]; then \
        cd meshcentral && \
        npm install html-minifier@4.0.0 jsdom@26.0.0 esprima@4.0.1 && \
        cd translate && \
        node translate.js extractall && \
        case "$DISABLE_MINIFY" in \
            false|no|FALSE|NO) \
                node translate.js minifyall;; \
            *) \
                echo "Setting MINIFY as disabled.";; \
        esac && \
        case "$DISABLE_TRANSLATE" in \
            false|no|FALSE|NO) \
                node translate.js translateall;; \
            *) \
                echo "Setting TRANSLATE as disabled.";; \
        esac \
    fi
# Possible more updated alternative? @minify-html/node@0.15.0 -> https://www.npmjs.com/package/@minify-html/node

# cleanup for inter-container copying.
RUN rm -rf /opt/meshcentral/meshcentral/docker
RUN rm -rf /opt/meshcentral/meshcentral/node_modules

### STAGE 2 BUILDING.

FROM alpine:latest

# environment variables
ENV NODE_ENV="production" \
    CONFIG_FILE="/opt/meshcentral/meshcentral-data/config.json" \
    DYNAMIC_CONFIG="true"

# environment variables for the above defined MeshCentral Config.json
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

# Preinstallation args
ARG PREINSTALL_LIBS="false" \
    INCLUDE_MONGODB_TOOLS="false" \
    INCLUDE_POSTGRESQL_TOOLS="false" \
    INCLUDE_MARIADB_TOOLS="false"

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

ENTRYPOINT  ["bash", "/opt/meshcentral/entrypoint.sh"]