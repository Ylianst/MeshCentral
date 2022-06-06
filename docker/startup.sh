#!/bin/bash

export NODE_ENV=production

export HOSTNAME
export REVERSE_PROXY
export REVERSE_PROXY_TLS_PORT
export IFRAME
export ALLOW_NEW_ACCOUNTS
export WEBRTC
export MONGO_INITDB_ROOT_USERNAME
export MONGO_INITDB_ROOT_PASSWORD
export USE_MONGODB

if [ -f "meshcentral-data/config.json" ]
    then
        node meshcentral/meshcentral 
    else
        cp config.json.template meshcentral-data/config.json
        if [ $USE_MONGODB == true ]; then
            sed -i "s/\"_mongoDb\": null/\"mongoDb\": \"mongodb:\/\/$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@mongodb:27017\"/" meshcentral-data/config.json
        fi
        sed -i "s/\"cert\": \"myserver.mydomain.com\"/\"cert\": \"$HOSTNAME\"/" meshcentral-data/config.json
        sed -i "s/\"NewAccounts\": true/\"NewAccounts\": \"$ALLOW_NEW_ACCOUNTS\"/" meshcentral-data/config.json
        sed -i "s/\"enabled\": false/\"enabled\": \"$ALLOWPLUGINS\"/" meshcentral-data/config.json
        sed -i "s/\"localSessionRecording\": false/\"localSessionRecording\": \"$LOCALSESSIONRECORDING\"/" meshcentral-data/config.json
        sed -i "s/\"minify\": true/\"minify\": \"$MINIFY\"/" meshcentral-data/config.json
        sed -i "s/\"WebRTC\": false/\"WebRTC\": \"$WEBRTC\"/" meshcentral-data/config.json
        sed -i "s/\"AllowFraming\": false/\"AllowFraming\": \"$IFRAME\"/" meshcentral-data/config.json
        if [ "$REVERSE_PROXY" != "false" ]; then
            sed -i "s/\"_certUrl\": \"my\.reverse\.proxy\"/\"certUrl\": \"https:\/\/$REVERSE_PROXY:$REVERSE_PROXY_TLS_PORT\"/" meshcentral-data/config.json
            node meshcentral/meshcentral
            exit
        fi
        node meshcentral/meshcentral --cert "$HOSTNAME"
fi