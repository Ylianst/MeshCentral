#!/bin/bash

setup_mesh_user() {
  echo "[meshcentral] Setting up MeshCentral user..."

  if [ -z "${MESH_USER}" ] || [ -z "${MESH_PASS}" ]; then
    echo "[meshcentral] Error: MESH_USER and MESH_PASS environment variables must be set"
    return 0
  fi

  local cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
    --datapath ${MESH_DIR}/meshcentral-data \
    --configfile ${MESH_DIR}/meshcentral-data/config.json \
    --loadconfigfromdb '${MESH_CONFIG_KEY}' \
    --user ${MESH_USER} \
    --pass ${MESH_PASS} \
    --createaccount ${MESH_USER} \
    --email ${MESH_USER}"

  eval "$cmd"
  sleep 2

  cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
    --datapath ${MESH_DIR}/meshcentral-data \
    --configfile ${MESH_DIR}/meshcentral-data/config.json \
    --loadconfigfromdb '${MESH_CONFIG_KEY}' \
    --user ${MESH_USER} \
    --pass ${MESH_PASS} \
    --adminaccount ${MESH_USER}"

  eval "$cmd"
  sleep 2
}

setup_mesh_device_group() {
  echo "[meshcentral] Setting up MeshCentral device group..."

  local max_attempts=5
  local attempt=1
  local delay=5

  while [ $attempt -le $max_attempts ]; do
    local cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshctrl.js \
      --url ${MESH_PROTOCOL}://${MESH_NGINX_HOST}:${MESH_EXTERNAL_PORT} \
      --loginuser ${MESH_USER} \
      --loginpass ${MESH_PASS} \
      ListDeviceGroups"

    GROUP_CHECK=$(eval "$cmd" 2>&1 | grep -c "${MESH_DEVICE_GROUP}" || true)

    if [ "$GROUP_CHECK" -gt 0 ]; then
      echo "[meshcentral] MeshCentral device group ${MESH_DEVICE_GROUP} already exists"
      DEVICE_GROUP_ID=$(eval "$cmd" 2>&1 | grep "${MESH_DEVICE_GROUP}" | head -n 1 | awk -F',' '{print $1}' | tr -d '"')
    else
      echo "[meshcentral] Creating device group: ${MESH_DEVICE_GROUP}"
      cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshctrl.js \
        --url ${MESH_PROTOCOL}://${MESH_NGINX_HOST}:${MESH_EXTERNAL_PORT} \
        --loginuser ${MESH_USER} \
        --loginpass ${MESH_PASS} \
        AddDeviceGroup \
        --name ${MESH_DEVICE_GROUP}"

      eval "$cmd"
      sleep 2

      cmd="node ${MESH_INSTALL_DIR}/meshcentral/meshctrl.js \
        --url ${MESH_PROTOCOL}://${MESH_NGINX_HOST}:${MESH_EXTERNAL_PORT} \
        --loginuser ${MESH_USER} \
        --loginpass ${MESH_PASS} \
        ListDeviceGroups"

      DEVICE_GROUP_ID=$(eval "$cmd" 2>&1 | grep "${MESH_DEVICE_GROUP}" | head -n 1 | awk -F',' '{print $1}' | tr -d '"')
    fi

    if [ ! -z "$DEVICE_GROUP_ID" ]; then
      echo "[meshcentral] Device Group ID: $DEVICE_GROUP_ID"
      echo "$DEVICE_GROUP_ID" >${MESH_DIR}/mesh_device_group_id

      # Convert device group ID to MeshID format
      STANDARD_BASE64=$(echo "$DEVICE_GROUP_ID" | tr '@$' '+/')
      MESH_ID="0x$(echo "$STANDARD_BASE64" | base64 -d | xxd -p | tr -d '\n' | tr '[:lower:]' '[:upper:]')"
      echo "[meshcentral] Mesh ID: $MESH_ID"
      echo "$MESH_ID" >"${MESH_DIR}/mesh_id"
      generate_msh_file
      return 0
    fi

    echo "[meshcentral] Retrying in ${delay} seconds..."
    sleep $delay
    attempt=$((attempt + 1))
  done

  echo "[meshcentral] ERROR: Failed to create MeshCentral device group after $max_attempts attempts"
  return 1
}

generate_msh_file() {
  echo "[meshcentral] Generating MSH file..."

  # Read the IDs from files
  local mesh_id=$(cat "${MESH_DIR}/mesh_id")
  local server_id=$(cat "${MESH_DIR}/mesh_server_id")

  # Determine the server URL based on openframe-mode
  local mesh_server_url
  if [ "${OPENFRAME_MODE}" = "true" ]; then
    echo "[meshcentral] OpenFrame mode enabled - using OpenFrame gateway URL"
    mesh_server_url="wss://${OPENFRAME_GATEWAY_URL}/ws/tools/agent/meshcentral-server/agent.ashx"
  else
    echo "[meshcentral] Standard mode - using direct MeshCentral URL"
    mesh_server_url="${MESH_PROTOCOL}://${MESH_NGINX_NAT_HOST}:${MESH_EXTERNAL_PORT}/agent.ashx"
  fi

  # Create the MSH file content with environment variable substitution
  cat >"${MESH_DIR}/meshagent.msh" <<EOL
MeshName=${MESH_DEVICE_GROUP}
MeshType=2
MeshID=${mesh_id}
ignoreProxyFile=1
ServerID=${server_id}
MeshServer=${mesh_server_url}
EOL

  chown node:node "${MESH_DIR}/meshagent.msh"
  chmod 644 "${MESH_DIR}/meshagent.msh"

  cp "${MESH_DIR}/meshagent.msh" "${MESH_DIR}/public/meshagent.msh"

  echo "[meshcentral] MSH file generated with server URL: ${mesh_server_url}"
}
