#!/bin/sh
if [ "$1" == "" ] ; then
    PORT=443
else
    PORT=$1
fi

if [ "$2" == "" ]; then
    REDIRPORT=80
else
    REDIRPORT=$2
fi

if [ "$3" == "" ]; then
    MPSPORT=4443
else
    MPSPORT=$3
fi

su - meshserver
cd /home/meshserver/
npm install meshcentral

if [ -f ssl.key ]; then
    ln -sf ssl.key meshcentral-data/agentserver-cert-private.key  
    ln -sf ssl.cert meshcentral-data/agentserver-cert-public.crt
    ln -sf ssl.key meshcentral-data/root-cert-private.key   
    ln -sf ssl.cert meshcentral-data/root-cert-public.crt     
    ln -sf ssl.key meshcentral-data/webserver-cert-private.key   
    ln -sf ssl.cert meshcentral-data/webserver-cert-public.crt
    ln -sf ssl.key meshcentral-data/mpsserver-cert-private.key 
    ln -sf ssl.cert meshcentral-data/mpsserver-cert-public.crt
	forever start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $REDIRPORT --mpsport $MPSPORT
elif ! [ -f meshcentral-data/agentserver-cert-private.key ] ;then 
	forever start node_modules/meshcentral/meshcentral.js --cert $HOSTNAME --port $PORT --redirport $REDIRPORT --mpsport $MPSPORT
else
	forever start node_modules/meshcentral/meshcentral.js --port $PORT --redirport $REDIRPORT --mpsport $MPSPORT
fi
 