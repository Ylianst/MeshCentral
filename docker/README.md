# Create folder-structure and files

# TO BE REWRITTEN - In progress, for questions: dselen@nerthus.nl or @DaanSelen.

```
| - meshcentral/        # this folder contains the persistent data
  | - data/             # MeshCentral data-files
  | - user_files/       # where file uploads for users live
  | - web/              # location for site customization files
  | - backup/           # location for the meshcentral-backups
| - .env                # environment file with initial variables
| - docker-compose.yml
```

# Templates

## .env
You can place the `config.json` file directly under `./meshcentral/data/`, or use the following `.env` file instead.

```ini
NODE_ENV = "production"
# Leave CONFIG_FILE as per default by using this, or removing it completely from the list. Otherwise if you know what you are doing, you can use this.
CONFIG_FILE = "/opt/meshcentral/meshcentral-data/config.json"
# DYNAMIC_CONFIG enables the config to be rechecked on every restart. If disabled then the container runtime will not change the config.json.
DYNAMIC_CONFIG = "true"

# Environment variables for the MeshCentral Config.json
ALLOWPLUGINS = "false"
ALLOW_NEW_ACCOUNTS = "false"
ALLOWED_ORIGIN = "false"
ARGS = ""
HOSTNAME = "localhost"
IFRAME = "false"
LOCALSESSIONRECORDING = "true"
MINIFY = "true"
REGENSESSIONKEY = "false"
REVERSE_PROXY = ""
REVERSE_PROXY_TLS_PORT = ""
WEBRTC = "false"

# MongoDB Variables
INCLUDE_MONGODB_TOOLS = "false"
USE_MONGODB = "false"
MONGO_HOST = ""
MONGO_PORT = "27017"
MONGO_USERNAME = ""
MONGO_PASS = ""
MONGO_URL = ""

# PostgreSQL Variables
INCLUDE_POSTGRESQL_TOOLS = "false"
USE_POSTGRESQL = "false"
PSQL_HOST = ""
PSQL_PORT = "5432"
PSQL_USER = ""
PSQL_PASS = ""
PSQL_DATABASE = ""

# MariaDB/MySQL Variables (Alpine Linux only provides MariaDB binaries)
INCLUDE_MARIADB_TOOLS = "false"
USE_MARIADB = "false"
MARIADB_HOST = ""
MARIADB_PORT = "3306"
MARIADB_USER = ""
MARIADB_PASS = ""
MARIADB_DATABASE = ""
```

## docker-compose.yml

```yaml
services:
  meshcentral:
    restart: always
    container_name: meshcentral
    # use the official meshcentral container
    image: ghcr.io/ylianst/meshcentral:latest
    ports:
      - 8086:443
    env_file:
      - .env
    volumes:
      # config.json and other important files live here. A must for data persistence
      - ./meshcentral/data:/opt/meshcentral/meshcentral-data
      # where file uploads for users live
      - ./meshcentral/user_files:/opt/meshcentral/meshcentral-files
      # location for the meshcentral-backups - this should be mounted to an external storage
      - ./meshcentral/backup:/opt/meshcentral/meshcentral-backups
      # location for site customization files
      - ./meshcentral/web:/opt/meshcentral/meshcentral-web
```

## docker-compose.yml mongodb

```yaml
version: '3'

networks:
  meshcentral-tier:
    driver: bridge

services:
  mongodb:
    restart: always
    container_name: mongodb
    image: mongo:latest
    env_file:
      - .env
    volumes:
      # mongodb data-directory - A must for data persistence
      - ./meshcentral/mongodb_data:/data/db
    networks:
      - meshcentral-tier

  meshcentral:
    restart: always
    container_name: meshcentral
    # use the official meshcentral container
    image: ghcr.io/ylianst/meshcentral:latest
    depends_on:
      - mongodb
    ports:
      # MeshCentral will moan and try everything not to use port 80, but you can also use it if you so desire, just change the config.json according to your needs
      - 8086:443
    env_file:
      - .env
    volumes:
      # config.json and other important files live here. A must for data persistence
      - ./meshcentral/data:/opt/meshcentral/meshcentral-data
      # where file uploads for users live
      - ./meshcentral/user_files:/opt/meshcentral/meshcentral-files
      # location for the meshcentral-backups - this should be mounted to an external storage
      - ./meshcentral/backup:/opt/meshcentral/meshcentral-backups
      # location for site customization files
      - ./meshcentral/web:/opt/meshcentral/meshcentral-web
    networks:
      - meshcentral-tier
```
