#!/bin/sh
export PORT  
export REDIRPORT
export MPSPORT
export EMAIL
export HOST
export SMTP
export USER
export PASS
export DB
export MONGODB
export MONGODBCOL

su - meshserver
cd /home/meshserver/
npm install github:techno-express/MeshCentral

sed -i "s#: 443,#: $PORT,#" meshcentral-data/config.json
sed -i "s#: 80,#: $REDIRPORT,#" meshcentral-data/config.json
sed -i "s#: 4443,#: $MPSPORT,#" meshcentral-data/config.json

if [ "$EMAIL" != 'mail@' ]; then
    sed -i "s#\"email\": \"mail@\",#\"email\": \"$EMAIL\",#/g" meshcentral-data/config.json
else
    sed -i "s#\"email\": \"mail@\",#\"email\": \"support@$HOSTNAME\",#/g" meshcentral-data/config.json
fi

if [ "$HOST" != 'host.ltd' ] && [ "$SMTP" != 'smtp.host.ltd' ]; then
    sed -i "s#\"names\": \"host.ltd,smtp.host.ltd\",#\"names\": \"$HOST,$SMTP\",#" meshcentral-data/config.json
elif [ "$HOST" != 'host.ltd' ]
    sed -i "s#\"names\": \"host.ltd,smtp.host.ltd\",#\"names\": \"$HOST\",#" meshcentral-data/config.json
else
    sed -i "s#\"names\": \"host.ltd,smtp.host.ltd\",#\"names\": \"$HOSTNAME\",#" meshcentral-data/config.json
fi
 
if [ "$SMTP" != 'smtp.host.ltd' ]; then
    sed -i "s#\"host\": \"smtp.host.ltd\",#\"host\": \"$SMTP\",#" meshcentral-data/config.json
else
    sed -i "s#\"host\": \"smtp.host.ltd\",#\"host\": \"$HOSTNAME\",#" meshcentral-data/config.json    
fi

if [ "$USER" != 'smtp@user' ] || [ "$PASS" != 'smtppass!' ]; then
    sed -i "s#\"user\": \"smtp@user\",#\"user\": \"$USER\",#" meshcentral-data/config.json
    sed -i "s#\"pass\": \"smtppass!\",#\"pass\": \"$PASS\",#" meshcentral-data/config.json
else
    sed -i "s#\"user\": \"smtp@user\",#\"user\": \"\",#" meshcentral-data/config.json
    sed -i "s#\"pass\": \"smtppass!\",#\"pass\": \"\",#" meshcentral-data/config.json  
fi

if [ "$DB" != "netdb" ]; then
    if ! [ -f mongodbready ];then
        sed -i "s#\"settings\": {#\"settings\": {\n\t\"MongoDb\": \"$MONGODB\",\n\t\"MongoDbCol\": \"$MONGODBCOL\",#" meshcentral-data/config.json   
        node meshcentral --dbexport
        node meshcentral --mongodb mongodb://127.0.0.1:27017/meshcentral --dbimport
        touch mongodbready
    fi
    service mongod start
fi

if [ -f "/etc/letsencrypt/archive/$HOSTNAME/cert1.pem" ]; then
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/privkey1.pem" meshcentral-data/agentserver-cert-private.key  
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/cert1.pem" meshcentral-data/agentserver-cert-public.crt
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/privkey1.pem" meshcentral-data/root-cert-private.key   
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/cert1.pem" meshcentral-data/root-cert-public.crt     
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/privkey1.pem" meshcentral-data/webserver-cert-private.key   
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/cert1.pem" meshcentral-data/webserver-cert-public.crt
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/privkey1.pem" meshcentral-data/mpsserver-cert-private.key 
    ln -sf "/etc/letsencrypt/archive/$HOSTNAME/cert1.pem" meshcentral-data/mpsserver-cert-public.crt
fi

if ! [ -f meshcentral-data/agentserver-cert-private.key ]; then 
	node node_modules/meshcentral/meshcentral.js --cert $HOSTNAME
else 
	node node_modules/meshcentral/meshcentral.js
fi
