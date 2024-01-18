# 14.1 Tokens

## User Tokens

![User Tokens 1](images/user_tokens1.png)

![User Tokens 2](images/user_tokens2.png)

## Software Integration Tokens

!!!note
    You can only generate a SINGLE loginTokenKey!
    So if you regenerate a loginTokenKey, the old one will be revoked/deleted!

You can generate the Login Token Key with the following:

```bash
node node_modules/meshcentral --loginTokenKey
```

You can then revoke/renew the Login Token Key with the following:

```bash
node node_modules/meshcentral --loginTokenKey --loginTokenGen
```
