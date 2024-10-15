# Using the OpenID Connect Strategy on MeshCentral

## Overview

### Introduction

There is a lot of information to go over, but first, why OpenID Connect?

Esentially its because its both based on a industry standard authorization protocol, and is becoming an industry standard authentication protocol. Put simply it's reliable and reusable, and we use OpenID Connect for exactly those reasons, almost every everyone does, and we want to be able to integrate with almost anyone. This strategy allows us to expand the potential of MeshCentral through the potential of OpenID Connect.

In this document, we will learn about the OpenID Connect specification at a high level, and then use that information to configure the OpenID Connect strategy for MeshCentral using a generic OpenID Connect compatible IdP. After that we will go over some advanced configurations and then continue by explaining how to use the new presets for popular IdPs, specifically Google or Azure. Then we will explore the configuration and usage of the groups feature.

> ATTENTION: As of MeshCentral `v1.1.22` there are multiple config options being depreciated. Using any of the old configs will only generate a warning in the authlog and will not stop you from using this strategy at this time. If there is information found in both the new and old config locations the new config location will be used. We will go over the specifics later, now lets jump in.

### Chart of Frequently Used Terms and Acronyms
| Term | AKA | Descriptions |
| --- | --- | --- |
| OAuth 2.0 | OAuth2 | OAuth 2.0 is the industry-standard protocol for user *authorization*. |
| OpenID Connect | OIDC | Identity layer built on top of OAuth2 for user *authentication*. |
| Identity Provider | IdP | The *service used* to provide authentication and authorization. |
| Preset Configs | Presets | Set of *pre-configured values* to allow some specific IdPs to connect correctly. |
| OAuth2 Scope | Scope | A flag *requesting access* to a specific resource or endpoint |
| OIDC Claim | Claim | A *returned property* in the user info provided by your IdP |
| User Authentication | AuthN | Checks if you *are who you say you are*. Example: Username and password authentication |
| User Authorization  | AuthZ | Check if you have the *permissions* required to access a specific resource or endpoint |

### OpenID Connect Technology Overview

OpenID Connect is a simple identity layer built on top of the OAuth2 protocol. It allows Clients to verify the identity of the End-User based on the authentication performed by an “Authorization Server”, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner.

OpenID Connect allows clients of all types, including Web-based, mobile, and JavaScript clients, to request and receive information about authenticated sessions and end-users. The specification suite is extensible, allowing participants to use optional features such as encryption of identity data, discovery of OpenID Providers, and logout, when it makes sense for them.

That description was straight from [OpenID Connect Documentation](https://openid.net/connect/), but basically, OAuth2 is the foundation upon which OpenID Connect was built, allowing for wide ranging compatability and interconnection. OpenID Connect appends the secure user *authentication* OAuth2 is known for, with user *authorization* by allowing the request of additional *scopes* that provide additional *claims* or access to API's in an easily expandable way.

### Annotations

#### Own IDP, CA and Docker

If you operate your own identity provider, your own certification authority and MeshCentral via Docker, it is necessary to provide the complete certificate chain, otherwise NodeJS (in particular the openid-client module) will refuse the connection to the IDP server. 

The following errors can be found in the log file:
> OIDC: Discovery failed.

> UNABLE_TO_GET_ISSUER_CERT_LOCALLY

To solve this problem, the certificate chain in PEM format must be placed in the data directory and the following entry must be added to the docker-compose.yml file in the “environment” section:
```
    environment:
            - NODE_EXTRA_CA_CERTS=/opt/meshcentral/meshcentral-data/chain.pem
```

## Basic Config

### *Introduction*

Generally, if you are using an IdP that supports OIDC, you can use a very basic configuration to get started, and if needed, add more specific or advanced configurations later. Here is what your config file will look like with a basic, generic, configuration.

### *Basic Config File Example*

``` json
{
    "settings": {
        "cert": "mesh.your.domain",
        "port": 443,
        "sqlite3": true
    },
    "domains": {
        "": {
            "title": "MeshCentral",
            "title2": "Your sub-title",
            "authStrategies": {
                "oidc": {
                    "issuer": "https://sso.your.domain",
                    "clientid": "2d5685c5-0f32-4c1f-9f09-c60e0dbc948a",
                    "clientsecret": "7PiGSLSLL4e7NGi67KM229tfK7Z7TqzQ",
                    "newAccounts": true
                }
            }
        }
    }
}
```

As you can see, this is roughly the same as all the other OAuth2 based authentication strategies. These are the basics you need to get started, however, if you plan to take advantage of some of the more advanced features provided by this strategy, you'll need to keep reading.

In this most basic of setups, you only need the URL of the issuer, as well as a client ID and a client secret. Notice in this example that the callback URL (or client redirect uri) is not configured, thats because MeshCentral will use `https://mesh.your.domain/auth-oidc-callback` as the default. Once you've got your configuration saved, restart MeshCentral and you should see an OpenID Connect Single Sign-on button on the login screen.

> WARNING: The redirect endpoint must EXACTLY match the value provided to your IdP or your will deny the connection.

> ATTENTION: You are required to configure the cert property in the settings section for the default domain, and configure the dns property under each additional domain.

## Advanced Options

### Overview

There are plenty of options at your disposal if you need them. In fact, you can configure any property that node-openid-client supports. The openid-client module supports far more customization than I know what to do with, if you want to know more check out [node-openid-client on GitHub](https://github.com/panva/node-openid-client) for expert level configuration details. There are plenty of things you can configure with this strategy and there is a lot of decumentation behind the tools used to make this all happen. I strongly recommend you explore the [config schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json), and if you have a complicated config maybe check out the [openid-client readme](https://github.com/panva/node-openid-client/blob/main/docs/README.md). Theres a list of resources at the end if you want more information on any specific topics. In the meantime, let’s take a look at an example of what your config file could look with a slightly more complicated configuration, including multiple manually defined endpoints.

#### *Advanced Config File Example*

``` json
{
    "settings": {
        "cert": "mesh.your.domain",
        "port": 443,
        "redirPort": 80,
        "AgentPong": 300,
        "TLSOffload": "192.168.1.50",
        "SelfUpdate": false,
        "AllowFraming": false,
        "sqlite3": true,
        "WebRTC": true
    },
    "domains": {
        "": {
            "title": "Mesh",
            "title2": ".Your.Domain",
            "orphanAgentUser": "~oidc:e48f8ef3-a9cb-4c84-b6d1-fb7d294e963c",
            "authStrategies": {
                "oidc": {
                    "issuer": {
                        "issuer": "https://sso.your.domain",
                        "authorization_endpoint": "https://auth.your.domain/auth-endpoint",
                        "token_endpoint": "https://tokens.sso.your.domain/token-endpoint",
                        "end_session_endpoint": "https://sso.your.domain/logout",
                        "jwks_uri": "https://sso.your.domain/jwks-uri"
                    },
                    "client": {
                        "client_id": "110d5612-0822-4449-a057-8a0dbe26eca5",
                        "client_secret": "4TqST46K53o3Z2Q88p39YwR6YwJb7Cka",
                        "redirect_uri": "https://mesh.your.domain/auth-oidc-callback",
                        "post_logout_redirect_uri": "https://mesh.your.domain/login",
                        "token_endpoint_auth_method": "client_secret_post",
                        "response_types": "authorization_code"
                    },
                    "custom": {
                        "scope": [ "openid", "profile", "read.EmailAlias", "read.UserProfile" ],
                        "preset": null
                    },
                    "groups": {
                        "recursive": true,
                        "required": ["Group1", "Group2"],
                        "siteadmin": ["GroupA", "GroupB"],
                        "revokeAdmin": true,
                        "sync": { 
                            "filter": ["Group1", "GroupB", "OtherGroup"]
                        },
                        "claim": "GroupClaim",
                        "scope": "read.GroupMemberships"
                    },
                    "logouturl": "https://sso.your.domain/logout?r=https://mesh.your.domain/login",
                    "newAccounts": true
                },
                {...}
            }
        }
    }
}
```

### "Issuer" Options

#### *Introduction*

In the advanced example config above, did you notice that the issuer property has changed from a *string* to an *object* compared to the basic example? This not only allows for much a much smaller config footprint when advanced issuer options are not required, it successfully fools you in to a false sense of confidence early on in this document. If you are manually configuring the issuer endpoints, keep in mind that MeshCentral will still attempt to discover **ALL** issuer information. Obviously if you manually configure an endpoint, it will be used even if the discovered information is different from your config. 

> NOTE: If you are using a preset, you dont need to define an issuer. If you do, the predefined information will be ignored.

#### *Common Config Chart*

| Name | Description | Default | Example | Required |
| --- | --- | --- | --- | --- |
| `issuer` | The primary URI that represents your Identity Providers authentication endpoints. | N/A | `"issuer": "https://sso.your.domain"`<br/>`"issuer": { "issuer": "https://sso.your.domain" }` | Unless using preset. |

#### *Advanced Config Example*

``` json
"issuer": {
   "issuer": "https://sso.your.domain",
   "authorization_endpoint": "https://auth.your.domain/auth-endpoint",
   "token_endpoint": "https://tokens.sso.your.domain/token-endpoint",
   "end_session_endpoint": "https://sso.your.domain/logout",
   "jwks_uri": "https://sso.your.domain/jwks-uri"
},
```

#### *Required and Commonly Used Configs*

The `issuer` property in the `issuer` object is the only one required, and its only required if you aren't using a preset. Besides the issuer, these are mostly options related to the endpoints and their configuration. The schema below looks intimidating but it comes down to being able to support any IdP. Setting the issuer, and end_session_endpoint are the two main ones you want to setup.

#### *Schema*

``` json
"issuer": { 
    "type": ["string","object"],
    "format": "uri",
    "description": "Issuer options. Requires issuer URI (issuer.issuer) to discover missing information unless using preset",
    "properties": {
        "issuer": { "type": "string", "format": "uri", "description": "URI of the issuer." },
        "authorization_endpoint": { "type": "string", "format": "uri" },
        "token_endpoint": { "type": "string", "format": "uri" },
        "jwks_uri": { "type": "string", "format": "uri" },
        "userinfo_endpoint": { "type": "string", "format": "uri" },
        "revocation_endpoint": { "type": "string", "format": "uri" },
        "introspection_endpoint": { "type": "string", "format": "uri" },
        "end_session_endpoint": {
            "type": "string",
            "format": "uri",
            "description": "URI to direct users to when logging out of MeshCentral.",
            "default": "this.issuer/logout"
            },
        "registration_endpoint": { "type": "string", "format": "uri" },
        "token_endpoint_auth_methods_supported": { "type": "string" },
        "token_endpoint_auth_signing_alg_values_supported": { "type": "string" },
        "introspection_endpoint_auth_methods_supported": { "type": "string" },
        "introspection_endpoint_auth_signing_alg_values_supported": { "type": "string" },
        "revocation_endpoint_auth_methods_supported": { "type": "string" },
        "revocation_endpoint_auth_signing_alg_values_supported": { "type": "string" },
        "request_object_signing_alg_values_supported": { "type": "string" },
        "mtls_endpoint_aliases": {
            "type":"object",
            "properties": {
                "token_endpoint": { "type": "string", "format": "uri" },
                "userinfo_endpoint": { "type": "string", "format": "uri" },
                "revocation_endpoint": { "type": "string", "format": "uri" },
                "introspection_endpoint": { "type": "string", "format": "uri" }
            }
        }
    },
    "additionalProperties": false
},
```

### "Client" Options

#### *Introduction*

There are just about as many option as possible here since openid-client also provides a Client class, because of this you are able to manually configure the client how ever you need. This includes setting your redirect URI to any available path, for example, if I was using the "google" preset and wanted to have Google redirect me back to "https://mesh.your.domain/oauth2/oidc/redirect/givemebackgooglemusicyoujerks", MeshCentral will now fully support you in that. One of the other options is the post logout redirect URI, and it is exactly what it sounds like. After MeshCentral logs out a user using the IdPs end session endpoint, it send the post logout redirect URI to your IdP to forward the user back to MeshCentral or to an valid URI such as a homepage.

> NOTE: The client object is required, however an exception would be with using old configs, which will be discussed later.

#### *Common Configs*

| Name | Description | Default | Example | Required |
| --- | --- | --- | --- | --- |
| `client_id` | The client ID provided by your Identity Provider (IdP) | N/A | `bdd6aa4b-d2a2-4ceb-96d3-b3e23cd17678` | `true` |
| `client_secret` | The client secret provided by your Identity Provider (IdP) | N/A | `vUg82LJ322rp2bvdzuVRh3dPn3oVo29m` | `true` |
| `redirect_uri` | "URI your IdP sends you after successful authorization. | `https://mesh.your.domain/auth-oidc-callback` | `https://mesh.your.domain/oauth2/oidc/redirect` | `false` |
| `post_logout_redirect_uri` | URI for your IdP to send you after logging out of IdP via MeshCentral. | `https://mesh.your.domain/login` | `https://site.your.other.domain/login` | `false` |

#### *Advanced Config Example*

``` json
"client": {
    "client_id": "00b3875c-8d82-4238-a8ef-25303fa7f9f2",
    "client_secret": "7PP453H577xbFDCqG8nYEJg8M3u8GT8F",
    "redirect_uri": "https://mesh.your.domain/auth-oidc-callback",
    "post_logout_redirect_uri": "https://mesh.your.domain/login",
    "token_endpoint_auth_method": "client_secret_post",
    "response_types": "authorization_code"
},
```

#### *Required and Commonly Used Configs*

There are many available options you can configure but most of them go unused. Although there are a few *commonly used* properties. The first two properties, `client_id` and `client_secret` are required. The next one `redirect_uri` is used to setup a custom URI for the redirect back to MeshCentral after being authenicated by your IdP.  The `post_logout_redirect_uri` property is used to tell your IdP where to send you after being logged out. These work in conjunction with the issuers `end_session_url` to automatically fill in any blanks in the config.

#### *Schema*
``` json
"client": { 
    "type": "object",
    "description": "OIDC Client Options",
    "properties": {
        "client_id": { 
            "type": "string",
            "description": "REQUIRED: The client ID provided by your Identity Provider (IdP)"
        },
        "client_secret": {
            "type": "string",
            "description": "REQUIRED: The client secret provided by your Identity Provider (IdP)"
        },
        "redirect_uri": {
            "type": "string",
            "format": "uri",
            "description": "URI your IdP sends you after successful authorization. This must match what is listed with your IdP. (Default is https://[currentHost][currentPath]/auth-oidc-callback)"
        },
        "post_logout_redirect_uri": {
            "type": "string",
            "format": "uri",
            "description": "URI for your IdP to send you after logging out of IdP via MeshCentral.",
            "default": "https:[currentHost][currentPath]/login"
        },
        "id_token_signed_response_alg": { "type": "string", "default": "RS256" },
        "id_token_encrypted_response_alg": { "type": "string" },
        "id_token_encrypted_response_enc": { "type": "string" },
        "userinfo_signed_response_alg": { "type": "string" },
        "userinfo_encrypted_response_alg": { "type": "string" },
        "userinfo_encrypted_response_enc": { "type": "string" },
        "response_types": { "type": ["string", "array"], "default": ["code"] },
        "default_max_age": { "type": "number" },
        "require_auth_time": { "type": "boolean", "default": false }, 
        "request_object_signing_alg": { "type": "string" },
        "request_object_encryption_alg": { "type": "string" },
        "request_object_encryption_enc": { "type": "string" },
        "token_endpoint_auth_method": {
            "type": "string",
            "default": "client_secret_basic",
            "enum": [ "none", "client_secret_basic", "client_secret_post", "client_secret_jwt", "private_key_jwt" ]
        }, 
        "introspection_endpoint_auth_method": {
            "type": "string",
            "default": "client_secret_basic",
            "enum": [ "none", "client_secret_basic", "client_secret_post", "client_secret_jwt", "private_key_jwt" ]
        }, 
        "revocation_endpoint_auth_method": {
            "type": "string",
            "default": "client_secret_basic",
            "enum": [ "none", "client_secret_basic", "client_secret_post", "client_secret_jwt", "private_key_jwt" ]
        }, 
        "token_endpoint_auth_signing_alg": { "type": "string" },
        "introspection_endpoint_auth_signing_alg": { "type": "string" },
        "revocation_endpoint_auth_signing_alg": { "type": "string" },
        "tls_client_certificate_bound_access_tokens": { "type": "boolean" }
    },
    "required": [ "client_id", "client_secret" ],
    "additionalProperties": false
},
```

### "Custom" Options

#### *Introduction*

These are all the options that dont fit with the issuer or client, including the presets. The presets define more than just the issuer URL used in discovery, they also define API endpoints, and specific ways to assemble your data. You are able to manually override most of the effects of the preset, but not all. You are able to manually configure the *scope* of the authorization request though, as well as choose which claims to use if your IdP uses something other than the defaults.

> NOTE: The scope must be a string, an array of strings, or a space separated list of scopes as a single string.

#### *Common Config Chart*

| Name     | Description                                      | Default                                                   | Example                             | Required |
| -------- | ------------------------------------------------ | --------------------------------------------------------- | ----------------------------------- | -------- |
| `scope`  | A list of scopes to request from the issuer.     | `"openid profile email"`                                  | `["openid", "profile"]`             | `false`  |
| `claims` | A group of claims to use instead of the defaults | Defauts to name of property except that `uuid` used `sub` | `"claims": {"uuid": "unique_name"}` | `false`  |

#### *Advanced Config Example*

``` json
"custom": {
    "scope": [ "openid", "profile", "read.EmailAlias", "read.UserProfile" ],
    "preset": null,
    "claims": {
        "name": "nameOfUser",
        "email": "publicEmail"
    }
},
```

> NOTE: You can `preset` to null if you want to explicitly disable presets.

#### *Required and Commonly Used Configs*

As should be apparent by the name alone, the custom property does not need to be configured and is used for optional or advanced configurations. With that said, lets look at few common options  strategy will default to using the `openid`, `profile`, and `email` scopes to gather the required information about the user, if your IdP doesn't support or require all these, you can set up the scope manually. Combine that with the ability to set the group scope and you can end up with an entirely custom scope being sent to your IdP. Not to mention the claims property, which allows you to pick and choose what claims to use to gather your data in case you have issues with any of the default behaviors of OpenID Connect and your IdP. This is also where you would set the preset and any values required by the presets.

#### *Schema*
``` json
"custom": {
    "type": "object",
    "properties": {
        "scope": {
            "type": ["string", "array"],
            "description": "A list of scopes to request from the issuer.",
            "default": "openid profile email",
            "examples": ["openid", ["openid", "profile"], "openid profile email", "openid profile email groups"]
        },
        "claims": {
            "type": "object",
            "properties": {
                "email": { "type": "string" },
                "name": { "type": "string" },
                "uuid": { "type": "string" }
            }
        },
        "preset": { "type": "string", "enum": ["azure", "google"]},
        "tenant_id": { "type": "string", "description": "REQUIRED FOR AZURE PRESET: Tenantid for Azure"},
        "customer_id": { "type": "string", "description": "REQUIRED FOR GOOGLE PRESET IF USING GROUPS: Customer ID from Google, should start with 'C'."}
    },
    "additionalProperties": false
},
```

### "Groups" Options

#### *Introduction*

The groups option allows you to use the groups you already have with your IdP in MeshCentral in a few ways. First you can set a group that the authorized user must be in to sign in to MeshCentral. You can also allow users with the right memberships automatic admin privlidges, and there is even an option to revoke privlidges if the user is NOT in the admin group. Besides these filters, you can filter the sync property to mirror only certain groups as MeshCentral User Groups, dynamically created as the user logs in. You can of course simply enable sync and mirror all groups from your IdP as User Groups. Additionally you can define the scope and claim of the groups for a custom setup, again allowing for a wide range of IdPs to be used, even without a preset.

#### *Common Config Chart*

| Name | Description | Default | Example | Required |
| --- | --- | --- | --- | --- |
| `sync` | Allows you to mirror user groups from your IdP. | `false` | `"sync": { "filter": ["Group1", "Group2"] }`<br/>`"sync": true` | `false` |
| `required` | Access is only granted to users who are a member<br/>of at least one of the listed required groups. | `undefined` | `"required": ["Group1", "Group2"]` | `false` |
| `siteadmin` | Full site admin priviledges will be granted to users<br/>who are a member of at least one of the listed admin groups | `undefined` | `"siteadmin": ["Group1", "Group2"]` | `false` |
| `revokeAdmin` | If true, admin privileges will be revoked from users<br/>who arent a member of at least one of the listed admin groups. | `true` | `"revokeAdmin": false` | `false` |

#### *Advanced Config Example*

``` json
"groups": {
    "recursive": true,
    "required": ["Group1", "Group2"],
    "siteadmin": ["GroupA", "GroupB"],
    "revokeAdmin": false,
    "sync": { 
        "filter": ["Group1", "GroupB", "OtherGroup"]
    },
    "claim": "GroupClaim",
    "scope": "read.GroupMemberships"
},
```

#### *Required and Commonly Used Configs*

As you can see in the schema below, there aren't any required properties in the groups object, however there are some commonly used ones. The first, and maybe most commonly used one, is the sync property. The sync property mirrors IdP provided groups into MeshCentral as user groups. You can then configure access as required to those groups, and as users log in, they will be added to the now existing groups if they are a member. You also have other options like using a custom *scope* or *claim* to get your IdP communicating with MeshCentral properly, without the use of preset configs. You also can set the required property if you need to limit authorization to users that are a member of at least one of the groups you set.  or the siteadmin property to grant admin privilege, with the revokeAdmin property available to allow revoking admin rights also.

#### *Schema*

``` json
"groups": {
  "type": "object",
  "properties": {
    "recursive": {
      "type": "boolean",
      "default": false,
      "description": "When true, the group memberships will be scanned recursively."
    },
    "required": {
      "type": [ "string", "array" ],
      "description": "Access is only granted to users who are a member of at least one of the listed required groups."
    },
    "siteadmin": {
      "type": [ "string", "array" ],
      "description": "Full site admin priviledges will be granted to users who are a member of at least one of the listed admin groups."
    },
    "revokeAdmin": {
      "type": "boolean",
      "default": false,
      "description": "If true, admin privileges will be revoked from users who are NOT a member of at least one of the listed admin groups."
    },
    "sync": {
      "type": [ "boolean", "object" ],
      "default": false,
      "description": "If true, all groups found during user login are mirrored into MeshCentral user groups.",
      "properties": {
        "filter": {
          "type": [ "string", "array" ],
          "description": "Only groups listed here are mirrored into MeshCentral user groups."
        }
      }
    },
    "scope": { "type": "string", "default": "groups", "description": "Custom scope to use." },
    "claim": { "type": "string", "default": "groups", "description": "Custom claim to use." }
  },
  "additionalProperties": false
}
```

## Preset OpenID Connect Configurations

### Overview

#### *Introduction*

Google is a blah and is used by tons of blahs as its so great. Lets move on.

#### *Common Config Chart*

> NOTE: All settings directly related to presets are in the custom section of the config.

| Name | Description | Example | Required |
| --- | --- | --- | --- |
| `preset` | Manually enable the use of a preset. | `"preset": "google"`<br/>`"preset": "azure"` | `false` |
| `customer_id` | Customer ID of the Google Workspaces instace you<br/>plan to use with the groups feature.| `"customer_id": ["Group1", "Group2"]` | If `google` preset is used with `groups` feature |
| `tenant_id` | Tenant ID from Azure AD, this is required to use<br/>the `azure` preset as it is part of the issuer url. | `"siteadmin": ["Group1", "Group2"]` | `false` |

### Google Preset

#### *Prerequisites*

> Check out this [documentation](https://developers.google.com/identity/protocols/oauth2/openid-connect) to get ready before we start.

#### *Basic Config Example*

``` json
"oidc": {
    "client": {
        "client_id": "268438852161-r8xa7qxwf3rr0shp1xnpgmm70bnag21p.apps.googleusercontent.com",
        "client_secret": "ETFWBX-gFEaxfPXs1tWmAOkuWDFTgoL3nwh"
    }
}
```

#### *Specifics*

If you notice above I forgot to add any preset related configs, however because google tags the client ID we can detect that and automatically use the google preset. The above config is tested, the sentive data has been scrambled of course. That said, you would normally use this preset in more advaced setups, let take a look at an example.

#### *Advanced Example with Groups*

``` json
"oidc": {
    "client": {
        "client_id": "424555768625-k7ub3ovqs0yp7mfo0usvyyx51nfii61c.apps.googleusercontent.com",
        "client_secret": "QLBCQY-nRYmjnFWv3nKyHGmwQEGLokP6ldk"
    },
    "custom": {
        "preset": "google",
        "customer_id": "C46kyhmps"
    },
    "groups": {
        "siteadmin": ["GroupA", "GroupB"],
        "revokeAdmin": true,
        "sync": true
    },
    "callbackURL": "https://mesh.your.domain/auth-oidc-google-callback"
},
```

#### *Customer ID and Groups*

As always, the client ID and secret are required, the customer ID on the other hand is only required if you plan to take advantage of the groups function *and* the google preset. This also requires you have a customer ID, if you have do, it is available in the Google Workspace Admin Console under Profile->View. Groups work the same as they would with any other IdP but they are pulled from the Workspace groups. 

#### *Schema*

```json
"custom": {
    "type": "object",
    "properties": {
        "preset": { "type": "string", "enum": ["azure", "google"]},
        "customer_id": { "type": "string", "description": "Customer ID from Google, should start with 'C'."}
    },
    "additionalProperties": false
},
```

### Azure Preset

#### *Prerequisites*

To configure OIDC-based SSO, you need an Azure account with an active subscription. [Create an account](https://azure.microsoft.com/free/?WT.mc_id=A261C142F) for free. The account used for setup must be of the following roles: Global Administrator, Cloud Application Administrator, Application Administrator, or owner the service principal.

> Check this [documentation](https://learn.microsoft.com/en-us/azure/active-directory/manage-apps/add-application-portal-setup-oidc-sso) for more information.  

#### *Basic Config Example*

``` json
"oidc": {
    "client": {
        "client_id": "a1gkl04i-40g8-2h74-6v41-2jm2o2x0x27r",
        "client_secret": "AxT6U5K4QtcyS6gF48gndL7Ys22BL15BWJImuq1O"
    },
    "custom": {
        "preset": "azure",
        "tenant_id": "46a6022g-4h33-1451-h1rc-08102ga3b5e4"
    }
}
```

#### *Specifics*

As with all other types of configuration for the OIDC strategy, the Azure preset requires a client ID and secret.The tenant ID is used as part of the issuer URI to make even the most basic AuthN requests so it is also required for the azure preset. besides that groups are available to the Azure preset as well as the recursive feature of groups. This allows you to search user groups recursively for groups they have membership in through other groups.

> NOTE: The Azure AD preset uses the Tenant ID as part of the issuer URI:<br>`"https://login.microsoftonline.com/"` + `strategy`.custom.tenant_id + `"/v2.0"`

#### *Advanced Example with Groups*

``` json
"oidc": {
    "client": {
        "client_id": "a1gkl04i-40g8-2h74-6v41-2jm2o2x0x27r",
        "client_secret": "AxT6U5K4QtcyS6gF48gndL7Ys22BL15BWJImuq1O"
    },
    "custom": {
        "preset": "azure",
        "tenant_id": "46a6022g-4h33-1451-h1rc-08102ga3b5e4"
    },
    "groups": {
        "recursive": true,
        "siteadmin": ["GroupA", "GroupB"],
        "revokeAdmin": true,
        "sync": true
    },
    "callbackURL": "https://mesh.your.domain/auth-oidc-azure-callback"
},
```

#### *Schema*

```json
"custom": {
    "type": "object",
    "properties": {
        "preset": { "type": "string", "enum": ["azure", "google"]},
        "tenant_id": { "type": "string", "description": "Tenant ID from Azure AD."}
    },
    "additionalProperties": false
},
```

## Depreciated Properties

### Overview

#### Introduction

As of MeshCentral `v1.1.22` and the writing of this documentation, the node module that handles everything was changed from [passport-openid-connect](https://github.com/jaredhanson/passport-openidconnect) to [openid-client](https://github.com/panva/node-openid-client). As a result of this change, multiple properties in the config have been depcrecated; this means some options in the strategy arent being used anymore. These are often referred to as "old configs" by this documentation. 

#### *Migrating Old Configs*

We upgraded but what about all the existing users, we couldn't just invalidate every config pre `v1.1.22`. So in an effort to allow greater flexibility to all users of MeshCentral, and what futures scholars will all agree was an obvious move, all the depreciated configs will continue working as expected. Using any of the old options will just generate a warning in the authlog and will not stop you from using this the OIDC strategy with outdated configs, however if both the equivalent new and old config are set the new config will be used.

#### *Old Config Example*
```json
"oidc": {
    "newAccounts": true,
    "clientid": "421326444155-i1tt4bsmk3jm7dri6jldekl86rfpg07r.apps.googleusercontent.com",
    "clientsecret": "GNLXOL-kEDjufOCk6pIcTHtaHFOCgbT4hoi"
}
```

This example was chosen because I wanted to highlight an advantage of supporting these old configs long term, even in a depreciated status. That is, the ability to copy your existing config from one of the related strategies without making any changes to your config by using the presets. This allows you to test out the oidc strategy without commiting to anything, since the user is always appended with the strategy used to login. In this example, the config was originally a google auth strategy config, changing the `"google"` to `"oidc"` is all that was done to the above config, besides obsfuscation of course.

#### *Advcanced Old Config Example*

``` json
"oidc": {
    "authorizationURL": "https://sso.your.domain/api/oidc/authorization",
    "callbackURL": "https://mesh.your.domain/oauth2/oidc/callback",
    "clientid": "tZiPTMDNuSaQPapAQJtwDXVnYjjhQybc",
    "clientsecret": "vrQWspJxdVAxEFJdrxvxeQwWkooVcqdU",
    "issuer": "https://sso.your.domain",
    "tokenURL": "https://sso.your.domain/api/oidc/token",
    "userInfoURL": "https://sso.your.domain/api/oidc/userinfo",
    "logoutURL": "https://sso.your.domain/logout?rd=https://mesh.your.domain/login",
    "groups": {
        "recursive": true,
        "required": ["Group1", "Group2"],
        "siteadmin": ["GroupA", "GroupB"],
        "sync": { 
            "filter": ["Group1", "GroupB", "OtherGroup"]
        }
    },
    "newAccounts": true
},
```

#### *Upgrading to v1.1.22*

If you were already using a meticulusly configured oidc strategy, all of your configs will still be used. You will simply see a warning in the logs if any depreciated properties were used. If you check the authLog there are additional details about the old config and provide the new place to put that information. In this advanced config, even the groups will continue to work just as they did before without any user intervention when upgrading from a version of MeshCentral pre v1.1.22. There are no step to take and no action is needed, moving the configs to the new locations is completely optional at the moment.

# Links

https://cloud.google.com/identity/docs/reference/rest/v1/groups/list

https://www.onelogin.com/learn/authentication-vs-authorization

https://auth0.com/docs/authenticate/protocols/openid-connect-protocol

https://github.com/panva/node-openid-client

https://openid.net/connect/

> You just read `openidConnectStrategy.ms v1.0.1` by [@mstrhakr](https://github.com/mstrhakr)
