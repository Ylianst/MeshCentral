#!/bin/sh
if [ "$1" == "" ] ; then
    PORT=444
else
    PORT=$1
fi

if [ "$2" == "" ]; then
    REDIRPORT=81
else
    REDIRPORT=$2
fi

su - meshcentral
cd /home/meshcentral/
npm install meshcentral

if ! [ -f node_modules/.meshcentral-data/agentserver-cert-private.key ] ;then 
	forever start node_modules/meshcentral/meshcentral.js --cert $HOSTNAME --port $PORT --redirport $REDIRPORT
elif [ -f ssl.key ]; then
    ln -sf ssl.key node_modules/.meshcentral-data/agentserver-cert-private.key  
    ln -sf ssl.cert node_modules/.meshcentral-data/agentserver-cert-public.crt
    ln -sf ssl.key node_modules/.meshcentral-data/root-cert-private.key   
    ln -sf ssl.cert node_modules/.meshcentral-data/root-cert-public.crt     
    ln -sf ssl.key node_modules/.meshcentral-data/webserver-cert-private.key   
    ln -sf ssl.cert node_modules/.meshcentral-data/webserver-cert-public.crt
    ln -sf ssl.key node_modules/.meshcentral-data/mpsserver-cert-private.key 
    ln -sf ssl.cert node_modules/.meshcentral-data/mpsserver-cert-public.crt	
	forever start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $REDIRPORT
else
	forever start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $REDIRPORT
fi
 