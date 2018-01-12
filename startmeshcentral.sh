#!/bin/sh
if [ $1 == "" ] ; then
    PORT=444
else
    PORT=$1
fi

if [ $2 == "" ]; then
    RPORT=81
else
    RPORT=$2
fi

cd ~
npmbin=$(which node)
$npmbin install meshcentral
foreverbin=$(which forever)
$foreverbin start node_modules/meshcentral/meshcentral.js --cert $HOSTNAME
sleep 10
$foreverbin stop node_modules/meshcentral/meshcentral.js
if [ -f ssl.key ]; then
    ln -sf ssl.key node_modules/.meshcentral-data/agentserver-cert-private.key  
    ln -sf ssl.cert node_modules/.meshcentral-data/agentserver-cert-public.crt
    ln -sf ssl.key node_modules/.meshcentral-data/root-cert-private.key   
    ln -sf ssl.cert node_modules/.meshcentral-data/root-cert-public.crt     
    ln -sf ssl.key node_modules/.meshcentral-data/webserver-cert-private.key   
    ln -sf ssl.cert node_modules/.meshcentral-data/webserver-cert-public.crt
    ln -sf ssl.key node_modules/.meshcentral-data/mpsserver-cert-private.key 
    ln -sf ssl.cert node_modules/.meshcentral-data/mpsserver-cert-public.crt
fi
$foreverbin start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $RPORT
 