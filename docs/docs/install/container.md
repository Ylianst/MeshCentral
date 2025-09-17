# 🐳 Container (OCI-specification).

[Open Container Initiative](https://opencontainers.org/)

The following section explains possible ways to install MeshCentral locally with the use of Docker or Podman.
For the syntax, docker will be used as default. This is done because podman also supports this syntax.<br>

🔗 References:

- [Docker](https://www.docker.com/)  
- [Podman](https://podman.io/)

!!!warning
    Do not use the built-in MeshCentral update functionality.<br>
    Update the container the 'docker way', by updating the image itself.

### 🏷️ Available Tags:

| Tag-name | Explanation |
|--------|-----|
| `master` | This tag belongs to the image which is built on every new commit to the main branch, therefor it has the latest code. |
| `latest` | This tag takes the latest released version of MeshCentral  |
| `1.1.43` | You can also specify the specific MeshCentral release with its tag, for example:  `ghcr.io/ylianst/meshcentral:1.1.43` |

---
> **📌 Note:**
Refer to [this page](https://github.com/Ylianst/MeshCentral/pkgs/container/meshcentral) for more information on the container status.
---

## 🐋 Docker/Podman

For single-machine setups such as Docker and Podman.

### Pulling the image:

To pull the container image use the following container registry.

```sh
docker pull ghcr.io/ylianst/meshcentral:master
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
    restart: unless-stopped # always restart the container unless you stop it
    image: ghcr.io/ylianst/meshcentral:latest
    ports:
      - 80:80 # HTTP
      - 443:443 # HTTPS
      #- 4433:4433 # AMT (Optional)
    volumes:
      - data:/opt/meshcentral/meshcentral-data # config.json and other important files live here
      - user_files:/opt/meshcentral/meshcentral-files # where file uploads for users live
      - backup:/opt/meshcentral/meshcentral-backups # location for the meshcentral backups - this should be mounted to an external storage
      - web:/opt/meshcentral/meshcentral-web # location for site customization files
volumes:
  data:
  user_files:
  backup:
  web:
```

## ☸️ Kubernetes

###

> Using YAML deployment files.

## 📚 Extra sources

> [Github Docker Resources](https://github.com/Ylianst/MeshCentral/tree/master/docker)