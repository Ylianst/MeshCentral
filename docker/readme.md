# Create folder-structure and files

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
NODE_ENV=production

USE_MONGODB=false
# set already exist mongo connection string url here
MONGO_URL=
# or set following init params for new mongodb, use it with docker-compose file with mongodb version
MONGO_INITDB_ROOT_USERNAME=mongodbadmin
MONGO_INITDB_ROOT_PASSWORD=mongodbpasswd

# initial meshcentral-variables
# the following options are only used if no config.json exists in the data-folder

# your hostname
HOSTNAME=my.domain.com
# set to your reverse proxy IP if you want to put meshcentral behind a reverse proxy
REVERSE_PROXY=false
REVERSE_PROXY_TLS_PORT=
# set to true if you wish to enable iframe support
IFRAME=false
# set to false if you want disable self-service creation of new accounts besides the first (admin)
ALLOW_NEW_ACCOUNTS=true
# set to true to enable WebRTC - per documentation it is not officially released with meshcentral and currently experimental. Use with caution
WEBRTC=false
# set to true to allow plugins
ALLOWPLUGINS=false
# set to true to allow session recording
LOCALSESSIONRECORDING=false
# set to enable or disable minification of json, reduces traffic
MINIFY=true
```

## docker-compose.yml

```yaml
version: '3'

services:
  meshcentral:
    restart: always
    container_name: meshcentral
    # use the official meshcentral container
    image: ghcr.io/ylianst/meshcentral:latest
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
