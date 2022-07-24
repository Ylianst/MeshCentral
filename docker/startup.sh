#!/bin/bash

if [ -f "meshcentral-data/${CONFIG_FILE}" ]
    then
        node meshcentral/meshcentral --configfile ${CONFIG_FILE}
    else
        cp config.json.template meshcentral-data/${CONFIG_FILE}
        if ! [ -z "$USE_MONGODB" ] && [ "$USE_MONGODB" == "true" ]; then
            sed -i "s/\"_mongoDb\": null/\"mongoDb\": \"mongodb:\/\/$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@mongodb:27017\"/" meshcentral-data/${CONFIG_FILE}
        fi
        sed -i "s/\"cert\": \"myserver.mydomain.com\"/\"cert\": \"$HOSTNAME\"/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"NewAccounts\": true/\"NewAccounts\": $ALLOW_NEW_ACCOUNTS/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"enabled\": false/\"enabled\": $ALLOWPLUGINS/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"localSessionRecording\": false/\"localSessionRecording\": $LOCALSESSIONRECORDING/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"minify\": true/\"minify\": $MINIFY/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"WebRTC\": false/\"WebRTC\": $WEBRTC/" meshcentral-data/${CONFIG_FILE}
        sed -i "s/\"AllowFraming\": false/\"AllowFraming\": $IFRAME/" meshcentral-data/${CONFIG_FILE}
        if [ -z "$SESSION_KEY" ]; then
            SESSION_KEY="$(cat /dev/urandom | tr -dc 'A-Za-z0-9!#$%&()*+,-./:;<=>?@[\]^_`{|}~' | fold -w 32 | head -n 1)";
        fi
        sed -i "s/\"_sessionKey\": \"MyReallySecretPassword1\"/\"sessionKey\": \"$SESSION_KEY\"/" meshcentral-data/${CONFIG_FILE}
        if [ "$REVERSE_PROXY" != "false" ]; then
            sed -i "s/\"_certUrl\": \"my\.reverse\.proxy\"/\"certUrl\": \"https:\/\/$REVERSE_PROXY:$REVERSE_PROXY_TLS_PORT\"/" meshcentral-data/${CONFIG_FILE}
            node meshcentral/meshcentral --configfile ${CONFIG_FILE}
            exit
        fi
        node meshcentral/meshcentral --configfile ${CONFIG_FILE} --cert "$HOSTNAME"
fi
