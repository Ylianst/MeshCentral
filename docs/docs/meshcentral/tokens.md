# 14.1 Tokens

## User Tokens

![User Tokens 1](images/user_tokens1.png)

![User Tokens 2](images/user_tokens2.png)

## Software Integration Tokens

!!!warning
    You can only have a SINGLE loginTokenKey for your meshcentral server!<br>
    So if you regenerate a loginTokenKey, the old one will be revoked/deleted!

You can create/view the Login Token Key with the following:

```bash
node node_modules/meshcentral --loginTokenKey
```

You can then reset/revoke/renew the Login Token Key with the following to create a new one:

```bash
node node_modules/meshcentral --loginTokenKey --loginTokenGen
```
