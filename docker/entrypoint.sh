#!/bin/bash

# Origin: https://github.com/Melo-Professional/MeshCentral-Stylish-UI
stylishui_base_url="https://github.com/Melo-Professional/MeshCentral-Stylish-UI/archive/refs"
stylishui_compat="https://raw.githubusercontent.com/Melo-Professional/MeshCentral-Stylish-UI/refs/heads/main/metadata/compat.json"

function graceful_shutdown() {
    echo "Received SIGTERM from the container host. Cleaning up..."
    kill -SIGINT $meshcentral_pid

    echo "MeshCentral process stopped. Exiting..."
    exit 0
}
trap graceful_shutdown SIGTERM

function test_url() {
    wget --spider $1 &> /dev/null
    if [[ $? -eq 0 ]]; then
        echo "is ok."
        return 0
    else
        echo "is NOT ok."
        return 1
    fi
}

function dynamic_config() {
    # BEGIN DATABASE CONFIGURATION FIELDS
    USE_MONGODB=${USE_MONGODB,,}
    if [[ $USE_MONGODB =~ ^(true|yes)$ ]]; then
        echo "Enabling MongoDB-connector..."

        if [[ -n "$MONGO_URL" ]]; then
            echo "MONGO_URL is set, using that..."
        else
            MONGO_URL="${MONGO_URL:-$MONGO_USERNAME:$MONGO_PASS@}$MONGO_HOST:$MONGO_PORT"
        fi

        #ESCAPED_MONGO_URL=$(echo "$MONGO_URL" | sed 's/[\/&?=:]/\\&/g')
        sed -i 's/"_mongoDb"/"mongoDb"/' "$CONFIG_FILE"
        jq --arg mongo_url "$MONGO_URL" \
            '.settings.mongoDb = $mongo_url' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Disabling MongoDB-connector..."
        sed -i 's/"mongoDb"/"_mongoDb"/' "$CONFIG_FILE"
    fi

    USE_POSTGRESQL=${USE_POSTGRESQL,,}
    if [[ $USE_POSTGRESQL =~ ^(true|yes)$ ]]; then
        echo "Enabling PostgreSQL-connector..."

        sed -i 's/"_postgres"/"postgres"/' "$CONFIG_FILE"
        jq --arg psql_host "$PSQL_HOST" \
            --arg psql_port "$PSQL_PORT" \
            --arg psql_user "$PSQL_USER" \
            --arg psql_pass "$PSQL_PASS" \
            --arg psql_db "$PSQL_DATABASE" \
            '.settings.postgres.host = $psql_host |
            .settings.postgres.port = $psql_port |
            .settings.postgres.user = $psql_user |
            .settings.postgres.password = $psql_pass |
            .settings.postgres.database = $psql_db' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Disabling PostgreSQL-connector..."
        sed -i 's/"postgres"/"_postgres"/' "$CONFIG_FILE"
    fi

    USE_MARIADB=${USE_MARIADB,,}
    if [[ $USE_MARIADB =~ ^(true|yes)$ ]]; then
        echo "Enabling MariaDB-connector..."
        sed -i 's/"_mariaDB"/"mariaDB"/' "$CONFIG_FILE"
        jq --arg mariadb_host "$MARIADB_HOST" \
            --arg mariadb_port "$MARIADB_PORT" \
            --arg mariadb_user "$MARIADB_USER" \
            --arg mariadb_pass "$MARIADB_PASS" \
            --arg mariadb_db "$MARIADB_DATABASE" \
            '.settings.mariaDB.host = $mariadb_host |
            .settings.mariaDB.port = $mariadb_port |
            .settings.mariaDB.user = $mariadb_user |
            .settings.mariaDB.password = $mariadb_pass |
            .settings.mariaDB.database = $mariadb_db' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Disabling MariaDB-connector..."
        sed -i 's/"mariaDB"/"_mariaDB"/' "$CONFIG_FILE"
    fi
    # END DATABASE CONFIGURATION FIELDS

    # Doing the bulk with JQ utility. Given the remaining variables an opportunity with Sed.
    # The way this works is if the environment variable is empty, it will add a _ in front of the variable, commenting it.
    # This will make the default value apply, as per: https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json

    echo "Compiling given environment variables..."
    echo "If defaults are going to get applied, refer to: https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json"

    # SESSIONKEY
    if [[ ${REGEN_SESSIONKEY,,} =~ ^(true|yes)$ ]]; then
        echo "Regenerating Session-Key because REGENSESSIONKEY is 'true' or 'yes'"
        SESSION_KEY=$(tr -dc 'A-Z0-9' < /dev/urandom | fold -w 96 | head -n 1)

        sed -i 's/"_sessionKey"/"sessionKey"/' "$CONFIG_FILE"
        jq --arg session_key "$SESSION_KEY" \
            '.settings.sessionKey = $session_key' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "REGENSESSIONKEY is not 'true' or 'yes', therefore it's being kept as is."
    fi

    # HOSTNAME
    if [[ -n $HOSTNAME ]]; then
        echo "Setting hostname (cert)... $HOSTNAME"

        jq --arg hostname "$HOSTNAME" \
            '.settings.cert = $hostname' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no hostname, defaulting to 'localhost', value given: $HOSTNAME"
        jq --arg hostname "localhost" \
            '.settings.cert = $hostname' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    fi

    # PORT
    if [[ -n $PORT ]]; then
        echo "Setting port... $PORT"

        jq --arg port "$PORT" \
            '.settings.port = $port' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no port, defaulting to '443', value given: $PORT"
        jq --arg port "443" \
            '.settings.port = $port' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    fi

    # REDIR_PORT
    if [[ -n $REDIR_PORT ]]; then
        echo "Setting redirport... $REDIR_PORT"

        jq --arg redirport "$REDIR_PORT" \
            '.settings.redirPort = $redirport' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no redirport, defaulting to '80', value given: $REDIR_PORT"
        jq --arg redirport "80" \
            '.settings.redirPort = $redirport' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    fi

    # ALLOWPLUGINS
    ALLOW_PLUGINS=${ALLOW_PLUGINS,,}
    if [[ $ALLOW_PLUGINS =~ ^(true|false)$ ]]; then
        echo "Setting plugins... $ALLOW_PLUGINS"

        sed -i 's/"_plugins"/"plugins"/' "$CONFIG_FILE"
        jq --argjson allow_plugins "$ALLOW_PLUGINS" \
            '.settings.plugins.enabled = $allow_plugins' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no ALLOWPLUGINS value given, commenting out so default applies... Value given: $ALLOW_PLUGINS"
        sed -i 's/"plugins":/"_plugins":/g' "$CONFIG_FILE"
    fi

    # WEBRTC
    WEBRTC=${WEBRTC,,}
    if [[ $WEBRTC =~ ^(true|false)$ ]]; then
        echo "Setting WebRTC... $WEBRTC"

        sed -i 's/"_WebRTC"/"WebRTC"/' "$CONFIG_FILE"
        jq --argjson webrtc "$WEBRTC" \
            '.settings.WebRTC = $webrtc' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
        #sed -i "s/\"WebRTC\": *[a-z]*/\"WebRTC\": $WEBRTC/" "$CONFIG_FILE"
    else
        echo "Invalid or no WEBRTC value given, commenting out so default applies... Value given: $WEBRTC"
        sed -i 's/"WebRTC":/"_WebRTC":/g' "$CONFIG_FILE"
    fi

    # IFRAME
    IFRAME=${IFRAME,,}
    if [[ $IFRAME =~ ^(true|false)$ ]]; then
        echo "Setting AllowFraming... $IFRAME"

        sed -i 's/"_AllowFraming"/"AllowFraming"/' "$CONFIG_FILE"
        jq --argjson allow_framing "$IFRAME" \
            '.settings.AllowFraming = $allow_framing' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no IFRAME value given, commenting out so default applies... Value given: $IFRAME"
        sed -i 's/"AllowFraming":/"_AllowFraming":/g' "$CONFIG_FILE"
    fi

    # trustedProxy
    if [[ -n $TRUSTED_PROXY ]]; then
        echo "Setting trustedProxy... - $TRUSTED_PROXY"

        if [[ $TRUSTED_PROXY == "all" ]] || [[ $TRUSTED_PROXY == "true" ]]; then
            sed -i 's/"_trustedProxy"/"trustedProxy"/' "$CONFIG_FILE"
            jq --argjson trusted_proxy "true" \
                '.settings.trustedProxy = $trusted_proxy' \
                "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
        else
            sed -i 's/"_trustedProxy"/"trustedProxy"/' "$CONFIG_FILE"
            jq --argjson trusted_proxy "$TRUSTED_PROXY" \
                '.settings.trustedProxy = $trusted_proxy' \
                "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
        fi
    else
        echo "Invalid or no REVERSE_PROXY and/or REVERSE_PROXY_TLS_PORT value given, commenting out so default applies... Value(s) given: $REVERSE_PROXY_STRING"
        sed -i 's/"certUrl":/"_certUrl":/g' "$CONFIG_FILE"
    fi

    # ALLOW_NEW_ACCOUNTS
    ALLOW_NEW_ACCOUNTS=${ALLOW_NEW_ACCOUNTS,,}
    if [[ $ALLOW_NEW_ACCOUNTS =~ ^(true|false)$ ]]; then
        echo "Setting NewAccounts... $ALLOW_NEW_ACCOUNTS"

        sed -i 's/"_NewAccounts"/"NewAccounts"/' "$CONFIG_FILE"
        jq --argjson new_accounts "$ALLOW_NEW_ACCOUNTS" \
            '.domains[""].NewAccounts = $new_accounts' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no ALLOW_NEW_ACCOUNTS value given, commenting out so default applies... Value given: $ALLOW_NEW_ACCOUNTS"
        sed -i 's/"NewAccounts":/"_NewAccounts":/g' "$CONFIG_FILE"
    fi

    # LOCALSESSIONRECORDING
    LOCAL_SESSION_RECORDING=${LOCAL_SESSION_RECORDING,,}
    if [[ $LOCAL_SESSION_RECORDING =~ ^(true|false)$ ]]; then
        echo "Setting localSessionRecording... $LOCAL_SESSION_RECORDING"

        sed -i 's/"_localSessionRecording"/"localSessionRecording"/' "$CONFIG_FILE"
        jq --argjson session_recording "$LOCAL_SESSION_RECORDING" \
            '.domains[""].localSessionRecording = $session_recording' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no LOCALSESSIONRECORDING value given, commenting out so default applies... Value given: $LOCAL_SESSION_RECORDING"
        sed -i 's/"localSessionRecording":/"_localSessionRecording":/g' "$CONFIG_FILE"
    fi

    # MINIFY
    MINIFY=${MINIFY,,}
    if [[ $MINIFY =~ ^(true|false)$ ]]; then
        echo "Setting minify... $MINIFY"

        sed -i 's/"_minify"/"minify"/' "$CONFIG_FILE"
        jq --argjson minify "$MINIFY" \
            '.domains[""].minify = $minify' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
        #sed -i "s/\"minify\": *[a-z]*/\"minify\": $MINIFY/" "$CONFIG_FILE"
    else
        echo "Invalid or no MINIFY value given, commenting out so default applies... Value given: $MINIFY"
        sed -i 's/"minify":/"_minify":/g' "$CONFIG_FILE"
    fi

    # ALLOWED_ORIGIN
    ALLOWED_ORIGIN=${ALLOWED_ORIGIN,,}
    if [[ $ALLOWED_ORIGIN =~ ^(true|false)$ ]]; then
        echo "Setting allowedOrigin... $ALLOWED_ORIGIN"

        sed -i 's/"_allowedOrigin"/"allowedOrigin"/' "$CONFIG_FILE"
        jq --argjson allowed_origin "$ALLOWED_ORIGIN" \
            '.domains[""].allowedOrigin = $allowed_origin' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
    else
        echo "Invalid or no ALLOWED_ORIGIN value given, commenting out so default applies... Value given: $ALLOWED_ORIGIN"
        sed -i 's/"allowedOrigin":/"_allowedOrigin":/g' "$CONFIG_FILE"
    fi

    # certUrl
    if [[ -n $REVERSE_PROXY ]] && [[ -n $REVERSE_PROXY_TLS_PORT ]]; then
        REVERSE_PROXY_STRING="${REVERSE_PROXY}:${REVERSE_PROXY_TLS_PORT}"

        echo "Setting certUrl... - $REVERSE_PROXY_STRING"
        sed -i 's/"_certUrl"/"certUrl"/' "$CONFIG_FILE"
        jq --arg cert_url "$REVERSE_PROXY_STRING" \
            '.domains[""].certUrl = $cert_url' \
            "$CONFIG_FILE" > temp_config.json && mv temp_config.json "$CONFIG_FILE"
        #sed -i "s/\"certUrl\": *[a-z]*/\"certUrl\": $REVERSE_PROXY_STRING/" "$CONFIG_FILE"
    else
        echo "Invalid or no REVERSE_PROXY and/or REVERSE_PROXY_TLS_PORT value given, commenting out so default applies... Value(s) given: $REVERSE_PROXY_STRING"
        sed -i 's/"certUrl":/"_certUrl":/g' "$CONFIG_FILE"
    fi

    cat "$CONFIG_FILE"
}

function install_stylishui() {
    # Start by testing if we can determine compatibility
    printf "Testing compatibility schema URL..."
    if ! test_url $stylishui_compat; then
        echo "Compat URL failed."
        return 1
    fi

    if [[ ${STYLISHUI_FORCE_LATEST,,} =~ ^(true|yes)$ ]]; then
        echo "Overriding to main branch..."
        full_url="${stylishui_base_url}/heads/main.tar.gz"
    else
        # Retrieve the values we need to determine compatibility
        compat_data=$(curl -fsSL $stylishui_compat)
        meshcentral_version=$(jq -r '.version' /opt/meshcentral/meshcentral/package.json)
        # Target the StylishUI version we need for our present Meshcentral version
        compat_version=$(echo "$compat_data" | jq -r --arg mcv "$meshcentral_version" \
            '.compatibility[] | select(.meshcentral==$mcv) | .stylishui')
        echo "Data: MeshCentral: $meshcentral_version, matched StylishUI: $compat_version"

        # From the data gathered above, compile the whole URL.
        full_url="${stylishui_base_url}/tags/${compat_version}.tar.gz"
    fi

    # Test if we can reach the data/content URL on github
    printf "Testing content URL..."
    if ! test_url $full_url; then
        echo "StylishUI URL failed."
        return 1
    fi

    # Lets download and install the UI
    wget -O /tmp/stylishui.tar.gz $full_url > /dev/null
    tar -xzf /tmp/stylishui.tar.gz -C /tmp
    web_folder=$(find /tmp -name meshcentral-web)

    # Check if we have some integrity
    if [[ -z $web_folder ]]; then
        echo "Installation failed, cleaning..."
        rm /tmp/stylishui*
        return 1
    fi

    # Looks good!
    echo "Found extracted contents at: ${web_folder}"
    if [[ -d /opt/meshcentral/meshcentral-web/public ]]; then
        mkdir -p /tmp/web-backup
        find /opt/meshcentral/meshcentral-web/public -maxdepth 1 -type f -exec mv {} /tmp/web-backup/ \;
		rm -rf /opt/meshcentral/meshcentral-web/public
    fi

    echo "Merging!"
    mv "${web_folder}/"* /opt/meshcentral/meshcentral-web/
    if [[ -d /tmp/web-backup ]]; then
        mv /tmp/web-backup/* /opt/meshcentral/meshcentral-web/public/ 2>/dev/null || true
        rm -rf /tmp/web-backup
    fi
    return 0
}

### Start MeshCentral Docker Container.

### BEGIN MAIN CHAIN

# Make the start more cleared when restarted.
echo "-------------------------------------------------------------"
date
if [ -n "$CONFIG_FILE" ]; then
    echo "Config file: $CONFIG_FILE"
else
    exit 1
fi

# Failsafe to create a new config if the expected config is not there.
if [ -f "${CONFIG_FILE}" ]; then
    echo "Pre-existing config found, not recreating..."
else
    if [ ! -d $(dirname "$CONFIG_FILE") ]; then
        echo "Creating meshcentral-data directory..."
        mkdir -p /opt/meshcentral/meshcentral-data
    fi

    echo "Placing template into the relevant directory: $(dirname $CONFIG_FILE)"
    cp /opt/meshcentral/config.json.template "${CONFIG_FILE}"
fi

if [[ ${DYNAMIC_CONFIG,,} =~ ^(true|yes)$ ]]; then
    echo "-------------------------------------------------------------"
    echo "Using Dynamic Configuration values..."
    dynamic_config
    echo "-------------------------------------------------------------"
else
    echo "Leaving config as-is. Dynamic Configuration is off."
fi

if [[ ${INSTALL_STYLISHUI,,} =~ ^(true|yes)$ ]]; then
    echo "-------------------------------------------------------------"
    echo "Reached StylishUI install trigger, installing..."
    if ! install_stylishui; then
        echo "Something fatal happened in the StylishUI install. Skipping..."
    else
        echo "StylishUI has been installed!"
    fi
    echo "-------------------------------------------------------------"
fi

# Actually start MeshCentral.
node /opt/meshcentral/meshcentral/meshcentral --configfile "${CONFIG_FILE}" "${ARGS}" >> /proc/1/fd/1 &
meshcentral_pid=$!

wait "$meshcentral_pid"

### END MAIN CHAIN
