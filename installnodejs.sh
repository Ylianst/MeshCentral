#!/bin/bash
cd ~
sudo -s
if command -v apt-get &> /dev/null; then
    #source /etc/lsb-release
    #apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 2930ADAE8CAF5059EE73BB4B58712A2291FA4AD5
    #echo "deb http://repo.mongodb.org/apt/$DISTRIB_ID $DISTRIB_CODENAME/mongodb-org/3.6 main" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list
    #apt-get install -y mongodb-org
    apt-get install -y python-software-properties
    curl -sL https://deb.nodesource.com/setup_9.x | bash -
elif command -v rpm &> /dev/null; then
#    echo '[mongodb-org-3.6]
#name=MongoDB Repository
#baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/3.6/x86_64/
#gpgcheck=1
#enabled=1
#gpgkey=https://www.mongodb.org/static/pgp/server-3.6.asc
#' > /etc/yum.repos.d/mongodb-org-3.6.repo
    curl -sL https://rpm.nodesource.com/setup_9.x | bash -
    version=$(rpm -qa \*-release | grep -Ei "oracle|redhat|centos" | cut -d"-" -f3)
    rpm -Uvh https://dl.fedoraproject.org/pub/epel/epel-release-latest-$version.noarch.rpm
    if command -v dnf &> /dev/null; then
        #dnf install -y mongodb-org
        dnf install -y nodejs
    else
        #yum install -y mongodb-org
        yum install -y nodejs
    fi
fi

npm install -g forever
