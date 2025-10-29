# This section will go into how to configure PostgreSQL as a database backend.

Following [the schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json) we make the following changes to our `config.json`.<br>
Some requires keys have been omitted to further the focus on database configuration. Don't remove these as well.

---

### MeshCentral Cheatsheet:

The postgres installation inside `settings` is rather straightforward if you are familiar with it on MeshCentral its side.

```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment__": "Omitted these keys to focus on the database",
  "settings": {
    "postgres": {
        "host": "my-postgresql-hostname",
        "port": "5432",
        "user": "my-postgresql-user",
        "password": "my-postgresql-password",
        "database": "meshcentral-database"
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

> More options are available if needed. Refer to the schema above.

### Postgres Cheatsheet

```bash
# Log into the server
psql -U postgres
```

```sql

-- Create the database user
postgres=# CREATE USER meshcentral WITH PASSWORD 'your-very-strong-password';
CREATE ROLE

-- Create the database and set the above user as owner
postgres=# CREATE DATABASE meshcentral OWNER meshcentral;
CREATE DATABASE

-- Exit the database
postgres=# exit
```