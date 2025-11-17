#!/bin/bash

if command -v docker > /dev/null; then
    docker build ../. -f Dockerfile -t meshcentral:debian-slim --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile -t meshcentral:debian-complete --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=true --build-arg=INCLUDE_POSTGRESQL_TOOLS=true --build-arg=INCLUDE_MARIADB_TOOLS=true
    docker build ../. -f Dockerfile -t meshcentral:debian-mongodb --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=true --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile -t meshcentral:debian-postgresql --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=true --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile -t meshcentral:debian-mysql --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=true

    docker build ../. -f Dockerfile-alpine -t meshcentral:alpine-slim --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile-alpine -t meshcentral:alpine-complete --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=true --build-arg=INCLUDE_POSTGRESQL_TOOLS=true --build-arg=INCLUDE_MARIADB_TOOLS=true
    docker build ../. -f Dockerfile-alpine -t meshcentral:alpine-mongodb --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=true --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile-alpine -t meshcentral:alpine-postgresql --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=true --build-arg=INCLUDE_MARIADB_TOOLS=false
    docker build ../. -f Dockerfile-alpine -t meshcentral:alpine-mysql --build-arg=PREINSTALL_LIBS=true --build-arg=INCLUDE_MONGODB_TOOLS=false --build-arg=INCLUDE_POSTGRESQL_TOOLS=false --build-arg=INCLUDE_MARIADB_TOOLS=true
fi
