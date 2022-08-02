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

