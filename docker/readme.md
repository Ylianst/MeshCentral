
# How to create a docker image for meshcentral

```
> git clone https://github.com/Ylianst/MeshCentral.git
> cd MeshCentral

> docker build -f docker/Dockerfile --force-rm -t meshcentral .

# alternative, if you want to include the mongodb-tools (mongodump, ...), you can add the 'INCLUDE_MONGODBTOOLS=yes' build argument
> docker build -f docker/Dockerfile --force-rm --build-arg INCLUDE_MONGODBTOOLS=yes -t meshcentral .

# (optional) cleanup after docker build:
> cd ..
> rm -rf MeshCentral/
```

> | Argument             | Description                                        |
> | :---                 | :---                                               |
> | -f docker/Dockerfile | Path/Name of the Dockerfile                        |
> | --force-rm           | Always remove intermediate containers              |
> | -t meshcentral       | Name and optionally a tag in the 'name:tag' format |

### Optional build arguments
> | Argument                | Description                                         |
> | :---                    | :---                                                |
> | INCLUDE_MONGODBTOOLS=yes  | Includes mongodb-tools (mongodump, ...) in the image |
> | DISABLE_MINIFY=yes      | Disables the minification of files                  |
> | DISABLE_TRANSLATE=yes   | Disables the translation of files                   |

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

# Templates:
## .env:
```ini
NODE_ENV=production

# initial mongodb-variables
MONGO_INITDB_ROOT_USERNAME=mongodbadmin
MONGO_INITDB_ROOT_PASSWORD=mongodbpasswd

# initial meshcentral-variables
# the following options are only used if no config.json exists in the data-folder

# your hostname
HOSTNAME=my.domain.com
USE_MONGODB=false
# set to your reverse proxy IP if you want to put meshcentral behind a reverse proxy 
REVERSE_PROXY=false
REVERSE_PROXY_TLS_PORT=
# set to true if you wish to enable iframe support
IFRAME=false
# set to false if you want disable self-service creation of new accounts besides the first (admin)
ALLOW_NEW_ACCOUNTS=true
# set to true to enable WebRTC - per documentation it is not officially released with meshcentral, but is solid enough to work with. Use with caution
WEBRTC=false
# set to true to allow plugins
ALLOWPLUGINS=false
# set to true to allow session recording
LOCALSESSIONRECORDING=false
# set to enable or disable minification of json, reduces traffic
MINIFY=true
```

## docker-compose.yml:
```yaml
version: '3'

services:
  meshcentral:
    restart: always
    container_name: meshcentral
    image: meshcentral
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
      - ./meshcentral/backup:/opt/meshcentral/meshcentral-backup
      # location for site customization files
      - ./meshcentral/web:/opt/meshcentral/meshcentral-web
```

## docker-compose.yml mongodb:
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
    image: meshcentral
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
      - ./meshcentral/backup:/opt/meshcentral/meshcentral-backup
      # location for site customization files
      - ./meshcentral/web:/opt/meshcentral/meshcentral-web
    networks:
      - meshcentral-tier
```
