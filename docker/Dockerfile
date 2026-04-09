### STAGE 1 PRECOMPILE DEPS MODULE

FROM alpine:3.23 AS dep-compiler

RUN echo -e "----------\nINSTALLING ALPINE PACKAGES...\n----------"; \
    apk add --no-cache --update \
        bash gcc g++ jq make nodejs npm python3 tzdata

COPY ./ /opt/meshcentral/meshcentral/
WORKDIR /opt/meshcentral/meshcentral

RUN jq '.dependencies += {"modern-syslog": "1.2.0", "telegram": "2.26.22", "mongodb": "4.17.2", "@mongodb-js/saslprep": "1.3.1"}' package.json > temp.json && mv temp.json package.json \
    && npm i --package-lock-only \
    && npm ci --omit=dev \
    && npm cache clean --force

### STAGE 2 OPENFRAME RUNTIME
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

# OpenFrame plugins (entrypoint.sh copies from here into the datapath volume at runtime)
COPY plugins/openframe.js ${MESH_TEMP_DIR}/plugins/openframe/openframe.js
COPY plugins/migrate.js ${MESH_TEMP_DIR}/plugins/openframe/migrate.js

RUN chown -R node:node ${MESH_DIR} ${MESH_TEMP_DIR} ${MESH_INSTALL_DIR}

USER node

CMD ["node", "/opt/meshcentral/meshcentral/meshcentral.js", "--datapath", "/opt/mesh/meshcentral-data"]
