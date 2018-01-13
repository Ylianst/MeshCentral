#!/bin/sh
export PORT  
export REDIRPORT

if [ $1 != "" ] ; then
    PORT=$1
fi

if [ $2 != "" ]; then
    REDIRPORT=$2
fi

su - meshcentral
cd /home/meshcentral
npmbin=$(which node)
foreverbin=$(which forever)
$npmbin install meshcentral

if ! [ -f node_modules/.meshcentral-data/agentserver-cert-private.key ] ;then 
	$foreverbin start node_modules/meshcentral/meshcentral.js --cert $HOSTNAME
	sleep 10
	$foreverbin stop node_modules/meshcentral/meshcentral.js
fi

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

$foreverbin start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $REDIRPORT
 