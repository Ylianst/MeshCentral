#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Creating directories"
mkdir -p ${MESH_DIR}/meshcentral-data
mkdir -p ${MESH_DIR}/logs
mkdir -p ${MESH_DIR}/public
mkdir -p ${MESH_DIR}/meshcentral-data/plugins/openframe

echo "[entrypoint] Installing OpenFrame plugin and migration script"
cp ${MESH_TEMP_DIR}/plugins/openframe/openframe.js ${MESH_DIR}/meshcentral-data/plugins/openframe/
cp ${MESH_TEMP_DIR}/plugins/openframe/migrate.js ${MESH_DIR}/meshcentral-data/plugins/openframe/

echo "[entrypoint] Copying config.json from mounted secret"
cp /tmp/config/config.json ${MESH_DIR}/meshcentral-data/config.json

# Pull existing certs from MongoDB (if any) to preserve server identity across restarts
# On first run: no certs in DB, prints "File not found." — harmless
# On subsequent runs: restores certs so MeshCentral keeps the same identity
echo "[entrypoint] Pulling config files from MongoDB..."
node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --dbpullconfigfiles ${MESH_DIR}/meshcentral-data \
  --configkey "${MESH_CONFIG_KEY}" \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json || echo "[entrypoint] dbpullconfigfiles failed (first run?), continuing..."

# Restore config.json (dbpullconfigfiles may have overwritten it with stale version)
cp /tmp/config/config.json ${MESH_DIR}/meshcentral-data/config.json

# First-run cert bootstrap: if no agent cert exists on disk, briefly start MeshCentral
# to let it generate certs, then stop and push them to MongoDB for future restarts.
# This branch only runs ONCE in the pod's entire lifetime (first ever deploy).
if [ ! -f "${MESH_DIR}/meshcentral-data/agentserver-cert-public.crt" ]; then
  echo "[entrypoint] First run: starting MeshCentral briefly to generate certificates..."
  node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
    --datapath ${MESH_DIR}/meshcentral-data \
    --configfile ${MESH_DIR}/meshcentral-data/config.json &
  MC_PID=$!

  # Wait up to 60s for cert generation
  for i in $(seq 1 60); do
    if [ -f "${MESH_DIR}/meshcentral-data/agentserver-cert-public.crt" ]; then
      echo "[entrypoint] Certificates generated"
      break
    fi
    sleep 1
  done

  kill $MC_PID 2>/dev/null || true
  wait $MC_PID 2>/dev/null || true

  echo "[entrypoint] Pushing generated certificates to MongoDB..."
  node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
    --dbpushconfigfiles \
    --configkey "${MESH_CONFIG_KEY}" \
    --datapath ${MESH_DIR}/meshcentral-data \
    --configfile ${MESH_DIR}/meshcentral-data/config.json || echo "[entrypoint] dbpushconfigfiles failed, continuing..."
fi

# Run the OpenFrame migration (creates admin user, device group, MSH files)
echo "[entrypoint] Running OpenFrame migration..."
node ${MESH_DIR}/meshcentral-data/plugins/openframe/migrate.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json

# Start MeshCentral in foreground (single real start)
echo "[entrypoint] Starting MeshCentral..."
exec node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json
