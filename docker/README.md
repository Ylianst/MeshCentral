# MeshCentral Docker Configuration Guide

> [!NOTE]
> Out of precaution, DYNAMIC_CONFIG has been disabled by default.<br>
> The reason why is because when its enabled and a working config without corresponding environment variables gives,<br>
> Then the container will overwrite it to a incorrect, but working state - perhaps non-working for your environment.

## Overview
This document provides a comprehensive guide to setting up and configuring MeshCentral in a Docker environment. It includes available options, security measures, and deployment instructions.

## Environment Variables
Below is a breakdown of environment variables used in this setup.

### General MeshCentral Configuration
| Variable | Default Value | Description |
|----------|--------------|-------------|
| NODE_ENV | production | Specifies the Node.js environment. |
| CONFIG_FILE | /opt/meshcentral/meshcentral-data/config.json | Path to the configuration file. |
| DYNAMIC_CONFIG | false | Enables/disables dynamic configuration. This means config is being rechecked every container restart. False if you want to use your own `config.json` |
| ALLOW_PLUGINS | false | Enables/disables plugins. |
| ALLOW_NEW_ACCOUNTS | false | Enables/disables new account creation. |
| ALLOWED_ORIGIN | false | Enables/disables allowed origin policy. |
| ARGS | "" | Additional arguments for MeshCentral. |
| HOSTNAME | localhost | Specifies the hostname. |
| IFRAME | false | Enables/disables embedding in an iframe. |
| LOCAL_SESSION_RECORDING | true | Enables session recording. |
| MINIFY | true | Minifies the JavaScript and HTML output. |
| REGEN_SESSIONKEY | false | Regenerates the session key on each restart of the container. |
| REVERSE_PROXY | "" | Configures reverse proxy support through `certUrl`. |
| REVERSE_PROXY_TLS_PORT | "443" | Configures reverse proxy TLS port, will be combined with: `REVERSE_PROXY`. |
| WEBRTC | false | Enables/disables WebRTC support. |

### Database Configuration

#### MeshCentral Database Settings
| Variable | Default Value | Description |
|----------|--------------|-------------|
| USE_MONGODB | false | Enables MongoDB usage. |
| USE_POSTGRESQL | false | Enables PostgreSQL usage. |
| USE_MARIADB | false | Enables MariaDB usage. |

#### MongoDB Configuration
| Variable | Default Value | Description |
|----------|--------------|-------------|
| MONGO_HOST | "" | MongoDB server hostname. |
| MONGO_PORT | 27017 | MongoDB server port. |
| MONGO_USERNAME | "" | MongoDB username. |
| MONGO_PASS | "" | MongoDB password. |
| MONGO_URL | "" | Overrides other MongoDB connection settings. |

#### PostgreSQL Configuration
| Variable | Default Value | Description |
|----------|--------------|-------------|
| PSQL_HOST | "" | PostgreSQL server hostname. |
| PSQL_PORT | 5432 | PostgreSQL server port. |
| PSQL_USER | "" | PostgreSQL username. |
| PSQL_PASS | "" | PostgreSQL password. |
| PSQL_DATABASE | "" | PostgreSQL database name. |

#### MariaDB Configuration
| Variable | Default Value | Description |
|----------|--------------|-------------|
| MARIADB_HOST | "" | MariaDB server hostname. |
| MARIADB_PORT | 3306 | MariaDB server port. |
| MARIADB_USER | "" | MariaDB username. |
| MARIADB_PASS | "" | MariaDB password. |
| MARIADB_DATABASE | "" | MariaDB database name. |

## Deployment Instructions

### Running with Docker CLI
```sh
docker run -d \
  -e HOSTNAME=myserver.domain.com \
  -e ALLOW_NEW_ACCOUNTS=true \
  -e USE_MONGODB=true \
  -e MONGO_URL=mongodb://username:password@mongodb:27017/meshcentral \
  -v meshcentral-data:/opt/meshcentral/meshcentral-data \
  -p 443:443 \
  ghcr.io/ylianst/meshcentral:<tag>
```

### Running with Docker Compose
```yaml
services:
  meshcentral:
    image: ghcr.io/ylianst/meshcentral:<tag>
    environment:
      - HOSTNAME=myserver.domain.com
      - ALLOW_NEW_ACCOUNTS=false
      - USE_MONGODB=true
      - MONGO_URL=mongodb://username:password@mongodb:27017/meshcentral
    volumes:
      - meshcentral-data:/opt/meshcentral/meshcentral-data
      - meshcentral-files:/opt/meshcentral/meshcentral-files
      - meshcentral-web:/opt/meshcentral/meshcentral-web
      - meshcentral-backups:/opt/meshcentral/meshcentral-backups
    ports:
      - "443:443"
volumes:
  meshcentral-data:
  meshcentral-files:
  meshcentral-web:
  meshcentral-backups:
```

### Using an `.env` File
Create a `.env` file:
```ini
# Environment variables
NODE_ENV=production
CONFIG_FILE=/opt/meshcentral/meshcentral-data/config.json
DYNAMIC_CONFIG=true

# MeshCentral Configuration
ALLOW_PLUGINS=false
ALLOW_NEW_ACCOUNTS=false
ALLOWED_ORIGIN=false
ARGS=
HOSTNAME=localhost
IFRAME=false
LOCAL_SESSION_RECORDING=true
MINIFY=true
REGEN_SESSIONKEY=false
REVERSE_PROXY=
REVERSE_PROXY_TLS_PORT=
WEBRTC=false

# MongoDB Configuration
USE_MONGODB=false
MONGO_HOST=
MONGO_PORT=27017
MONGO_USERNAME=
MONGO_PASS=
MONGO_URL=

# PostgreSQL Configuration
USE_POSTGRESQL=false
PSQL_HOST=
PSQL_PORT=5432
PSQL_USER=
PSQL_PASS=
PSQL_DATABASE=

# MariaDB/MySQL Configuration
USE_MARIADB=false
MARIADB_HOST=
MARIADB_PORT=3306
MARIADB_USER=
MARIADB_PASS=
MARIADB_DATABASE=

# Build options
INCLUDE_MONGODB_TOOLS=false
INCLUDE_POSTGRESQL_TOOLS=false
INCLUDE_MARIADB_TOOLS=false
PREINSTALL_LIBS=false
```
Then run Docker Compose:
```sh
docker-compose --env-file .env up -d
```

# MeshCentral Docker Build Process

This document explains the build process for the MeshCentral Docker image, along with details on various build arguments and how to use them.

## Build Arguments

The following build arguments are available for customizing the build process:

- **DISABLE_MINIFY**: Disable HTML/JS minification during the build.
- **DISABLE_TRANSLATE**: Disable translation of strings in MeshCentral.
- **INCLUDE_MONGODB_TOOLS**: Include MongoDB client and related tools.
- **INCLUDE_POSTGRESQL_TOOLS**: Include PostgreSQL client tools.
- **INCLUDE_MARIADB_TOOLS**: Include MariaDB/MySQL client tools.
- **PREINSTALL_LIBS**: Pre-install specific libraries like `ssh2`, `nodemailer`, etc.

### Build Commands with Arguments

Here are the shell commands to build the Docker image with different configurations.

#### 1. Build with Minify and Translate Disabled
If you want to disable both HTML/JS minification and translation during the build process, use the following command:
> While in the root git location.

```sh
docker build -f docker/Dockerfile --build-arg DISABLE_MINIFY=no --build-arg DISABLE_TRANSLATE=no -t meshcentral .
```
