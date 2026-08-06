### STAGE 1 PRECOMPILE DEPS MODULE

FROM alpine:3.24 AS dep-compiler

RUN apk add --no-cache --update \
        bash gcc g++ jq make nodejs npm python3 tzdata

COPY ./ /opt/meshcentral/meshcentral/
WORKDIR /opt/meshcentral/meshcentral

RUN jq '.dependencies += {"modern-syslog": "1.2.0", "telegram": "2.26.22", "mongodb": "4.17.2", "@mongodb-js/saslprep": "1.3.1"}' package.json > temp.json && mv temp.json package.json \
    && npm i --package-lock-only \
    && npm ci --omit=dev \
    && npm cache clean --force

### STAGE 2 OPENFRAME RUNTIME
# Use same alpine version as dep-compiler to ensure native module ABI compatibility
FROM alpine:3.24

ARG MESH_INSTALL_DIR=/opt/meshcentral
ARG MESH_DIR=/opt/mesh
# Not /tmp: an emptyDir mounted there would shadow the plugins baked into this layer.
ARG MESH_TEMP_DIR=/opt/openframe

ENV MESH_INSTALL_DIR=${MESH_INSTALL_DIR}
ENV MESH_DIR=${MESH_DIR}
ENV MESH_TEMP_DIR=${MESH_TEMP_DIR}

# bash is required by the chart's init container.
RUN apk upgrade --no-cache && \
    apk add --no-cache bash nodejs && \
    addgroup -g 1000 node && \
    adduser -D -u 1000 -G node node && \
    install -d -o node -g node ${MESH_INSTALL_DIR} ${MESH_DIR} ${MESH_TEMP_DIR}

# Copy built MeshCentral source + deps (including mongodb driver) from dep-compiler
COPY --from=dep-compiler --chown=node:node \
     /opt/meshcentral/meshcentral ${MESH_INSTALL_DIR}/meshcentral/

# OpenFrame plugins — chart's init container symlinks from here into the
# datapath emptyDir at pod start (read-only, runs from this image layer).
COPY --chown=node:node plugins/ ${MESH_TEMP_DIR}/plugins/openframe/

USER node

CMD ["node", "/opt/meshcentral/meshcentral/meshcentral.js", "--datapath", "/opt/mesh/meshcentral-data"]
