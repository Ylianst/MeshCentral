#!/bin/bash

graceful_shutdown() {
    echo "Received SIGTERM. Cleaning up..."
    node /opt/meshcentral/meshcentral/meshcentral --stop

    echo "MeshCentral process stopped. Exiting..."
    exit 0
}
trap graceful_shutdown SIGTERM

### Start MeshCentral Docker Container.

date
echo "Config file: $CONFIG_FILE"

# Failsafe to create a new config if the expected config is not there.
if [ -f "${CONFIG_FILE}" ]; then
    echo "Pre-existing config found, not recreating..."
else
    cp /opt/meshcentral/config.json.template "${CONFIG_FILE}"
fi

if [[ ${DYNAMIC_CONFIG,,} =~ ^(true|yes)$ ]]; then
    cat "$CONFIG_FILE"
    echo "Using Dynamic Configuration values..."

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

    echo -e "\n$(cat "$CONFIG_FILE")"
else
    echo "Leaving config as-is."
fi

# Actually start MeshCentral.
node /opt/meshcentral/meshcentral/meshcentral --configfile "${CONFIG_FILE}" "${ARGS}" >> /proc/1/fd/1 &
meshcentral_pid=$!

wait "$meshcentral_pid"