# 🐳 Container (OCI-specification).

[Open Container Initiative](https://opencontainers.org/)

The following section explains possible ways to install MeshCentral locally with the use of Docker or Podman.
For the syntax, docker will be used as default. This is done because podman also supports this syntax.<br>

🔗 References:

- [Docker](https://www.docker.com/)  
- [Podman](https://podman.io/)

!!!warning
    Do not use the built-in MeshCentral update functionality (when using containers).<br>
    Update the container the 'docker way', by updating the image itself.

### 🏷️ Basic Tags:

| Tag-name | Explanation |
|--------|-----|
| `master` | This tag belongs to the image which is built on every new commit to the main branch, therefor it has the latest code. |
| `latest` | This tag takes the latest released version of MeshCentral.  |
| `1.1.51` | You can also specify the specific MeshCentral release with its tag, for example:  `ghcr.io/ylianst/meshcentral:1.1.43` |

### All Tags

All master tags below follow the master branch of MeshCentral, the latest and version numbered versions follow the releases.

| Tag-name | Explanation |
| -------- | ----------- |
| `master-slim` | Docker image with no database packages present, which makes it the most lean. Uses NeDB. |
| `master-mongodb` | Docker image with the MongoDB packages installed. |
| `master-postgresql` | Docker image with the PostgreSQL packages installed |
| `master-mysql` | Docker image with the MySQL packages installed |
| `1.1.51-slim` and `latest-slim` | Docker image with no database packages present, which makes it the most lean. Uses NeDB. |
| `1.1.51-mongodb` and `latest-mongodb` | Docker image with the MongoDB packages installed. |
| `1.1.51-postgresql` and `latest-postgresql` | Docker image with the PostgreSQL packages installed. |
| `1.1.51-mysql` and `latest-mysql` | Docker image with the MySQL packages installed. |

!!! note
    Refer to [this page](https://github.com/Ylianst/MeshCentral/pkgs/container/meshcentral) for more information on the container status.

## 🐋 Docker/Podman

For single-machine setups such as Docker and Podman.

### Pulling the image:

To pull the container image use the following container registry.

```sh
docker pull ghcr.io/ylianst/meshcentral:latest
```

### Docker CLI:

If you want to run the container from the Terminal, you can use the following command:

```sh linenums="1"
docker run -d \
  --name meshcentral \
  --restart unless-stopped \
  -p 80:80 \
  -p 443:443 \
  -v data:/opt/meshcentral/meshcentral-data \
  -v user_files:/opt/meshcentral/meshcentral-files \
  -v backup:/opt/meshcentral/meshcentral-backups \
  -v web:/opt/meshcentral/meshcentral-web \
  ghcr.io/ylianst/meshcentral:latest
```

### Docker Compose:

If you want to use a docker compose yaml file, please refer to the example below.

```yaml linenums="1"
services:
  meshcentral:
    image: ghcr.io/ylianst/meshcentral:latest
    environment:
      - DYNAMIC_CONFIG=false # Show the option but disable it by default, for safety.
    volumes:
      - meshcentral-data:/opt/meshcentral/meshcentral-data
      - meshcentral-files:/opt/meshcentral/meshcentral-files
      - meshcentral-web:/opt/meshcentral/meshcentral-web
      - meshcentral-backups:/opt/meshcentral/meshcentral-backups
    ports:
      - "80:80"
      - "443:443"
volumes:
  meshcentral-data:
  meshcentral-files:
  meshcentral-web:
  meshcentral-backups:
```

Refer to [the Dockerfile](https://github.com/Ylianst/MeshCentral/blob/5032755c2971955161105922e723461385a6c874/docker/Dockerfile#L70-L123) for its environment variables.

## ☸️ Kubernetes

###

> Using YAML deployment files.

## 📚 Extra sources

> [Github Docker Resources](https://github.com/Ylianst/MeshCentral/tree/master/docker)