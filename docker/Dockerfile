### STAGE 1 BUILDING.
FROM alpine:3.23 AS builder

# Any value inside one of the disable ARGs will be accepted.
ARG DISABLE_EXTRACT="yes"
ARG DISABLE_MINIFY="yes"
ARG DISABLE_TRANSLATE="yes"
#    NODE_OPTIONS="--max_old_space_size=4096"
# If your process gets OOM killed, perhaps the above will help.

RUN apk add --no-cache --update \
        nodejs npm; \
    mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Check the Docker build arguments and if they are empty do the task.
RUN if [ -n "$DISABLE_EXTRACT" ] || [ -n "$DISABLE_MINIFY" ] || [ -n "$DISABLE_TRANSLATE" ]; then \
        echo -e "----------\nPREPARING ENVIRONMENT...\n----------"; \
        cd meshcentral && \
        npm install html-minifier-terser@7.2.0 jsdom@26.0.0 esprima@4.0.1 && \
        cd translate && \
        case "$DISABLE_EXTRACT" in \
            false|no|FALSE|NO) \
                echo -e "----------\nSTARTING THE EXTRACTING PROCESS...\n----------"; \
                node translate.js extractall;; \
            *) \
                echo "Setting EXTRACT as disabled.";; \
        esac && \
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

RUN rm -rf /opt/meshcentral/meshcentral/docker /opt/meshcentral/meshcentral/node_modules /opt/meshcentral/meshcentral/docs

### STAGE 2 PRECOMPILE DEPS MODULE

FROM alpine:3.23 AS dep-compiler

RUN echo -e "----------\nINSTALLING ALPINE PACKAGES...\n----------"; \
    apk add --no-cache --update \
        bash gcc g++ jq make nodejs npm python3 tzdata

COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral/meshcentral

RUN jq '.dependencies += {"modern-syslog": "1.2.0", "telegram": "2.26.22", "mongodb": "4.17.2", "@mongodb-js/saslprep": "1.3.1"}' package.json > temp.json && mv temp.json package.json \
    && npm i --package-lock-only \
    && npm ci --omit=dev \
    && npm cache clean --force

### STAGE 3 OPENFRAME RUNTIME
# Use same alpine version as dep-compiler to ensure native module ABI compatibility

FROM alpine:3.23

ARG MESH_INSTALL_DIR=/opt/meshcentral
ARG MESH_DIR=/opt/mesh
ARG MESH_TEMP_DIR=/tmp/mesh

ENV MESH_INSTALL_DIR=${MESH_INSTALL_DIR}
ENV MESH_DIR=${MESH_DIR}
ENV MESH_TEMP_DIR=${MESH_TEMP_DIR}

RUN mkdir -p ${MESH_TEMP_DIR} ${MESH_DIR} ${MESH_INSTALL_DIR} \
    && apk add --no-cache bash xxd nodejs mongodb-tools \
    && addgroup -S node && adduser -S node -G node

# Copy built MeshCentral source + deps (including mongodb driver) from dep-compiler
COPY --from=dep-compiler /opt/meshcentral/meshcentral ${MESH_INSTALL_DIR}/meshcentral/

# OpenFrame plugins (MeshCentral expects: {datapath}/plugins/{name}/{name}.js)
COPY plugins/openframe.js ${MESH_DIR}/meshcentral-data/plugins/openframe/openframe.js

RUN chown -R node:node ${MESH_DIR} ${MESH_TEMP_DIR} ${MESH_INSTALL_DIR}

USER node

CMD ["node", "/opt/meshcentral/meshcentral/meshcentral.js", "--datapath", "/opt/mesh/meshcentral-data"]
