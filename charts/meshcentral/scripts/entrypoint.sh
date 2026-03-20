#!/usr/bin/env bash
set -euo pipefail

source /scripts/setup-mesh.sh
source /scripts/manage-service.sh

echo "Creating data directory"
mkdir -p ${MESH_DIR}/meshcentral-data

echo "Creating log directory"
mkdir -p ${MESH_DIR}/logs

# Install OpenFrame plugin
mkdir -p ${MESH_DIR}/meshcentral-data/plugins/openframe
cp ${MESH_TEMP_DIR}/plugins/openframe/openframe.js ${MESH_DIR}/meshcentral-data/plugins/openframe/

# Create public directory for static MSH serving
mkdir -p ${MESH_DIR}/public

echo "Copying config.json from mounted secret"
cp /tmp/config/config.json ${MESH_DIR}/meshcentral-data/config.json

# Setup mesh components
setup_mesh_user

# Start MeshCentral temporarily to setup device group
start_meshcentral &
wait_for_meshcentral_to_start
setup_mesh_device_group

# Push certificate files to MongoDB for persistence across restarts
# On first run: pushes newly generated certs to DB
# On subsequent runs: certs loaded from DB are unchanged, push is idempotent
echo "[meshcentral] Pushing config files to MongoDB..."
node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --dbpushconfigfiles \
  --configkey "${MESH_CONFIG_KEY}" \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json || echo "[meshcentral] Warning: dbpushconfigfiles failed, continuing..."

stop_meshcentral
wait_for_meshcentral_to_stop

# Start MeshCentral in foreground
start_meshcentral
