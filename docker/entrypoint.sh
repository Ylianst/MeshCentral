#!/bin/bash

graceful_shutdown() {
    echo "Received SIGTERM. Cleaning up..."
    node /opt/meshcentral/meshcentral/meshcentral --stop
    exit 0
}
trap cleanup SIGTERM

### Start MeshCentral Docker Container.

date
echo "Config file: $CONFIG_FILE"

# Failsafe to create a new config if the expected config is not there.
if [ -f "${CONFIG_FILE}" ]; then
    echo "Pre-existing config found, not recreating..."
else
    cp /opt/meshcentral/config.json.template "${CONFIG_FILE}"
fi

if [[ "$DYNAMIC_CONFIG" =~ ^(true|yes)$ ]]; then

    if [[ "$USE_MONGODB" =~ ^(true|yes)$ ]]; then
        if [[ -n  "$MONGO_URL" ]]; then
            echo "MONGO_URL is set, using that..."
        else
            MONGO_URL="${MONGO_URL:-$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@}$MONGO_HOST:$MONGO_PORT"
        fi
        sed -i "s/\"?_mongoDb\": \"\"/\"mongoDb\": \"$MONGO_URL\"/" "$CONFIG_FILE"
    else
        sed -i 's/"?_mongoDb": ""/"_mongoDb": "null"/' "$CONFIG_FILE"
    fi

    if [[ "$USE_POSTGRESQL" =~ ^(true|yes)$ ]]; then
        echo "So you wanna postgrsex"
    fi

    if [[ "$USE_MARIADB" =~ ^(true|yes)$ ]]; then
        echo "So you wanna Maria-Dick-Big"
    fi

    # Doing the bulk with JQ utility. Given the remaining variables an opportunity with Sed.
    # The way this works is if the environment variable is empty, it will add a _ in front of the variable, commenting it.
    # This will make the default value apply, as per: https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json

    echo "Compiling given environment variables..."
    echo "If defaults are going to get applied, refer to: https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json"

    # SESSIONKEY
    if [[ $REGENSESSIONKEY =~ ^(true|yes)$ ]]; then
        echo "Regenerating Session-Key because REGENSESSIONKEY is 'true' or 'yes'"
        SESSION_KEY=$(tr -dc 'A-Z0-9' < /dev/urandom | fold -w 60 | head -n 1)
        sed -i "s/\"sessionKey\": *\"[^\"]*\"/\"sessionKey\": \"$SESSION_KEY\"/" "$CONFIG_FILE"
    else
        echo "REGENSESSIONKEY is not 'true' or 'yes', therefore it's being kept as is."
    fi

    # HOSTNAME
    if [[ -n $HOSTNAME ]] && [[ $HOSTNAME =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$ ]]; then
        echo "Setting hostname (cert)... - $HOSTNAME"
        sed -i "s/\"cert\": *\"[^\"]*\"/\"cert\": \"$HOSTNAME\"/" "$CONFIG_FILE"
    else
        echo "Invalid hostname, commenting it out..."
        sed -i "s/\"cert\": *\"[^\"]*\"/\"cert\": \"localhost\"/" "$CONFIG_FILE"
    fi

    # ALLOW_NEW_ACCOUNTS
    if [[ -n $ALLOW_NEW_ACCOUNTS ]] && [[ $ALLOW_NEW_ACCOUNTS =~ ^(true|false)$ ]]; then
        echo "Setting NewAccounts... - $ALLOW_NEW_ACCOUNTS"
        sed -i "s/\"NewAccounts\": *[a-z]*/\"NewAccounts\": $ALLOW_NEW_ACCOUNTS/" "$CONFIG_FILE"
    else
        echo "Invalid ALLOW_NEW_ACCOUNTS value given, commenting out so default applies..."
        sed -i 's/"NewAccounts":/"_NewAccounts":/g' "$CONFIG_FILE"
    fi

    # ALLOWPLUGINS
    if [[ -n $ALLOWPLUGINS ]] && [[ $ALLOWPLUGINS =~ ^(true|false)$ ]]; then
        echo "Setting plugins... - $ALLOWPLUGINS"
        sed -i "s/\"plugins\": *{[^}]*}/\"plugins\": {\"enabled\": $ALLOWPLUGINS}/" "$CONFIG_FILE"
    else
        echo "Invalid ALLOWPLUGINS value given, commenting out so default applies..."
        sed -i 's/"plugins":/"_plugins":/g' "$CONFIG_FILE"
    fi

    # LOCALSESSIONRECORDING
    if [[ -n $LOCALSESSIONRECORDING ]] && [[ $LOCALSESSIONRECORDING =~ ^(true|false)$ ]]; then
        echo "Setting localSessionRecording... - $LOCALSESSIONRECORDING"
        sed -i "s/\"localSessionRecording\": *[a-z]*/\"localSessionRecording\": $LOCALSESSIONRECORDING/" "$CONFIG_FILE"
    else
        echo "Invalid LOCALSESSIONRECORDING value given, commenting out so default applies..."
        sed -i 's/"localSessionRecording":/"_localSessionRecording":/g' "$CONFIG_FILE"
    fi

    # MINIFY
    if [[ -n $MINIFY ]] && [[ $MINIFY =~ ^(true|false)$ ]]; then
        echo "Setting minify... - $MINIFY"
        sed -i "s/\"minify\": *[a-z]*/\"minify\": $MINIFY/" "$CONFIG_FILE"
    else
        echo "Invalid MINIFY value given, commenting out so default applies..."
        sed -i 's/"minify":/"_minify":/g' "$CONFIG_FILE"
    fi

    # WEBRTC
    if [[ -n $WEBRTC ]] && [[ $WEBRTC =~ ^(true|false)$ ]]; then
        echo "Setting WebRTC... - $WEBRTC"
        sed -i "s/\"WebRTC\": *[a-z]*/\"WebRTC\": $WEBRTC/" "$CONFIG_FILE"
    else
        echo "Invalid WEBRTC value given, commenting out so default applies..."
        sed -i 's/"WebRTC":/"_WebRTC":/g' "$CONFIG_FILE"
    fi

    # IFRAME
    if [[ -n $IFRAME ]] && [[ $IFRAME =~ ^(true|false)$ ]]; then
        echo "Setting AllowFraming... - $IFRAME"
        sed -i "s/\"AllowFraming\": *[a-z]*/\"AllowFraming\": $IFRAME/" "$CONFIG_FILE"
    else
        echo "Invalid IFRAME value given, commenting out so default applies..."
        sed -i 's/"AllowFraming":/"_AllowFraming":/g' "$CONFIG_FILE"
    fi

    # ALLOWED_ORIGIN
    if [[ -n $ALLOWED_ORIGIN ]] && [[ $ALLOWED_ORIGIN =~ ^(true|false)$ ]]; then
        echo "Setting allowedOrigin... - $ALLOWED_ORIGIN"
        sed -i "s/\"allowedOrigin\": *[a-z]*/\"allowedOrigin\": $ALLOWED_ORIGIN/" "$CONFIG_FILE"
    else
        echo "Invalid ALLOWED_ORIGIN value given, commenting out so default applies..."
        sed -i 's/"allowedOrigin":/"_allowedOrigin":/g' "$CONFIG_FILE"
    fi

    echo -e "\n$(cat "$CONFIG_FILE")"

    # TO DO CERTURL - POSTGRESQL - MONGO_INITDB_ROOT_PASSWORD="pass"

    #if [[ "$ALLOWED_ORIGIN" =~ ^\[.*\]|^true|^false ]]; then
    #    sed -i "s/\"allowedOrigin\": false/\"allowedOrigin\": $ALLOWED_ORIGIN/" meshcentral-data/"${CONFIG_FILE}"
    #else
    #    sed -i "s/\"allowedOrigin\": false/\"allowedOrigin\": \"$ALLOWED_ORIGIN\"/" meshcentral-data/"${CONFIG_FILE}"
    #fi
    #SESSION_KEY= # Session key should be random. Not passed in through arguments.
    #sed -i "s/\"_sessionKey\": \"MyReallySecretPassword1\"/\"sessionKey\": \"$SESSION_KEY\"/" meshcentral-data/"${CONFIG_FILE}"
else
    echo "Leaving config as-is."
fi

# Actually start MeshCentral.
node /opt/meshcentral/meshcentral/meshcentral --configfile "${CONFIG_FILE}" "${ARGS}" >> /proc/1/fd/1 &
meshcentral_pid=$!

wait "$meshcentral_pid"