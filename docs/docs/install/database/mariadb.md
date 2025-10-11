# This section will go into how to configure MySQL/MariaDB as a database backend.

Following [the schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json) we make the following changes to our `config.json`.<br>
Some requires keys have been omitted to further the focus on database configuration. Don't remove these as well.

---

### MeshCentral Cheatsheet:

Database specific:

MariaDB:
```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment__": "Omitted these keys to focus on the database",
  "settings": {
    "mariaDB": {
        "host": "my-mariadb-hostname",
        "port": "3306",
        "user": "my-mariadb-user",
        "password": "my-mariadb-password",
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

Mysql:
```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "__comment__": "Omitted these keys to focus on the database",
  "settings": {
    "mySQL": {
        "host": "my-mysql-hostname",
        "port": "3306",
        "user": "my-mysql-user",
        "password": "my-mysql-password",
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

### MariaDB/MySQL Cheatsheet:

```bash
mariadb -u root -p
```
or
```bash
mysql -u root -p
```

```sql
-- Create the database
CREATE DATABASE meshcentral;

-- Create the user (restricting login to localhost)
CREATE USER 'meshcentral'@'localhost' IDENTIFIED BY 'my-very-secure-password';

-- Grant privileges
GRANT ALL PRIVILEGES ON meshcentral.* TO 'meshcentral'@'localhost';

-- Apply changes
FLUSH PRIVILEGES;
```