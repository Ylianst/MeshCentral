#!/bin/bash

start_meshcentral() {
  echo "[meshcentral] Starting MeshCentral"
  node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
    --datapath ${MESH_DIR}/meshcentral-data \
    --configfile ${MESH_DIR}/config.json \
    --loadconfigfromdb "${MESH_CONFIG_KEY}"
}

stop_meshcentral() {
  echo "[meshcentral] Stopping MeshCentral"
  pkill -f "node.*meshcentral"
}

wait_for_meshcentral_to_start() {
  echo "[meshcentral] Starting MeshCentral readiness check..."

  local max_attempts=10
  local attempt=1
  local delay=10

  while [ $attempt -le $max_attempts ]; do
    echo "[meshcentral] Attempt $attempt of $max_attempts: Checking MeshCentral WebSocket readiness..."

    local cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshctrl.js \
      --url ${MESH_PROTOCOL}://${MESH_NGINX_HOST}:${MESH_EXTERNAL_PORT} \
      --loginuser ${MESH_USER} \
      --loginpass ${MESH_PASS} \
      ServerInfo"

    RESPONSE=$(eval "$cmd" 2>&1)

    # Extract and save ServerID from agentCertHash
    if echo "$RESPONSE" | grep -q "agentCertHash"; then
      AGENT_CERT_HASH=$(echo "$RESPONSE" | grep "agentCertHash" | awk -F': ' '{print $2}')
      if [ ! -z "$AGENT_CERT_HASH" ]; then
        SERVER_ID=$(echo "$AGENT_CERT_HASH" | tr '@$' '+/' | base64 -d | xxd -p | tr -d '\n' | tr '[:lower:]' '[:upper:]')
        echo "[meshcentral] Server ID: $SERVER_ID"
        echo "$SERVER_ID" >"${MESH_DIR}/mesh_server_id"
      fi
    fi

    # Check if mesh_server_id file was successfully created
    if [ -f "${MESH_DIR}/mesh_server_id" ]; then
      echo "[meshcentral] Level 1 passed: MeshCentral API is responsive and server ID created!"
      break
    fi

    echo "[meshcentral] MeshCentral WebSocket not ready yet!"
    echo "[meshcentral] Waiting ${delay} seconds before retrying..."
    sleep $delay
    attempt=$((attempt + 1))
  done

  if [ $attempt -gt $max_attempts ]; then
    echo "[meshcentral] ERROR: MeshCentral WebSocket failed to become ready after $((max_attempts * delay)) seconds"
    return 1
  fi

  return 0
}

wait_for_meshcentral_to_stop() {
  echo "[meshcentral] Waiting for MeshCentral to stop..."
  while pgrep -f "node.*meshcentral" >/dev/null; do
    sleep 2
  done
  echo "[meshcentral] MeshCentral has stopped"
}
