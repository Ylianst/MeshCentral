# This section will go into how to configure a local database as backend.

Following [the schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json) we make the following changes to our `config.json`.<br>
Some requires keys have been omitted to further the focus on database configuration. Don't remove these as well.

By default MeshCentral uses NeDB so therefor to change that to another database type, do the following:

---

### MeshCentral Cheatsheet:

Sqlite3:
```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment__": "Omitted these keys to focus on the database",
  "settings": {
    "sqlite3": {
        "name": "meshcentral-db"
    }
  },
  "domains": {
    "": {
      "__comment__": "Omitted these keys to focus on the database",
    }
  },
  "_letsencrypt": {
    "__comment__": "Omitted these keys to focus on the database",
  }
}
```

Acebase:
```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment__": "Omitted these keys to focus on the database",
  "settings": {
    "acebase": {
        "sponsor": false
    }
  },
  "domains": {
    "": {
      "__comment__": "Omitted these keys to focus on the database",
    }
  },
  "_letsencrypt": {
    "__comment__": "Omitted these keys to focus on the database",
  }
}
```