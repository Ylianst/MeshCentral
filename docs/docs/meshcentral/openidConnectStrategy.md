# General Overview of the OpenID Connect

## Introducing OpenID Connect SSO on MeshCentral

There is a lot of information to go over, but first, why OpenID Connect?

Esentially its because its both based on a industry standard authorization protocol, and is becoming an industry standard authentication protocol. Put simply it's reliable and reusable, and we use OpenID Connect for exactly those reasons, almost every everyone does, and we want to be able to integrate with almost anyone. This strategy allows us to expand the potential of MeshCentral through the potential of OpenID Connect.

In this section, we will learn about the OpenID Connect specification at a high level, and then use that information to configure the OpenID Connect strategy for MeshCentral using a generic OpenID Connect compatible IdP. After that we will take a sneak peek at some advanced configurations. We will continue by explaining how to use the new presets for popular IdPs, such as Google or Azure. Then we will explore the configuration and usage of the groups feature, as well as check out some of the other advanced options you can setup. Finally, we will look at migrating some existing strategies to the OpenID Connect strategy on MeshCentral.

## Frequently Used Terms and Acronyms

### Chart of Frequently Used Terms and Acronyms
|Term|AKA|Descriptions|
|---|---|---|
|OAuth 2.0|OAuth2| OAuth 2.0 is the industry-standard protocol for user *authorization*.|
|OpenID Connect|OIDC| Identity layer built on top of OAuth2 for user *authentication*.|
|Identity Provider|IdP| The *service used* to provide authentication and authorization.|
|Preset Configs|Presets|Set of *pre-configured values* to allow some specific IdPs to connect correctly.|
|OAuth2 Scope|Scope|A flag *requesting access* to a specific resource or endpoint|
|OIDC Claim|Claim|A *returned property* in the user info provided by your IdP|
|User Authentication|Identity Verification|Checks if you *who you say you are*. Example: Username and password authentication|
|User Authorization|Permission Verification|Check if you have the *permissions* required to access a specific resource or endpoint|

## OpenID Connect Technology Overview

OpenID Connect is a simple identity layer built on top of the OAuth2 protocol. It allows Clients to verify the identity of the End-User based on the authentication performed by an “Authorization Server”, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner.

OpenID Connect allows clients of all types, including Web-based, mobile, and JavaScript clients, to request and receive information about authenticated sessions and end-users. The specification suite is extensible, allowing participants to use optional features such as encryption of identity data, discovery of OpenID Providers, and logout, when it makes sense for them.

That description was straigt from [OpenID Connect Documentation](https://openid.net/connect/), but basically, OAuth2 is the foundation upon which OpenID Connect was built, allowing for wide ranging compatability and interconnection. OpenID Connect appends the secure user *authentication* OAuth2 is known for, with user *authorization* by allowing the request of additional *scopes* that provide additional *claims* or access to API's in an easily expandable way.

# Configuring OpenID Connect SSO on MeshCentral

## **Quick Start**

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
                    "clientid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
                    "clientsecret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
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

## **Advanced Options**

### *Introduction*

There are plenty of options at your disposal if you need them. In fact, you can configure any property that node-openid-client supports. The openid-client module supports far more customization than I know what to do with, if you want to know more check out [node-openid-client on GitHub]() for expert level configuration details. There are plenty of things you can configure with this strategy and there is a lot of decumentation behind the tools used to make this all happen. I strongly recommend you explore the [config schema](), and if you have a complicated config maybe check out the [openid-client readme](). Theres a list of resources at the end if you want more information on any specific topics. In the meantime, let’s take a look at an example of what your config file could look with a slightly more complicated configuration, including multiple manually defined endpoints.


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
            "orphanAgentUser": "~oidc:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
            "authStrategies": {
                "oidc": {
                    "issuer": {
                        "issuer": "https://sso.your.domain",
                        "authorization_endpoint": "https://auth.your.domain/auth-endpoint",
                        "token_endpoint": "https://tokens.sso.your.domain/token-endpoint",
                        "endsession_endpoint": "https://sso.your.domain/logout",
                        "jwks_uri": "https://sso.your.domain/jwks-uri"
                    },
                    "client": {
                        "client_id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
                        "client_secret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
                        "redirect_uri": "https://mesh.your.domain/oauth2/oidc/redirect",
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


### *"Issuer" Options*

#### *Introduction*

Compared to the basic example, did you notice that the issuer property has changed from a *string* to an *object* in this example? This not only allows for much a much smaller config footprint when advanced issuer options are not required, it successfully fools you in to a false sense of confidence early on in this document. If you are manually configuring the issuer endpoints, keep in mind that MeshCentral will still attempt to discover **ALL** issuer information, then simply use your configs to fill in the blanks. Obviously if you manually configure an endpoint, it will be used even if the discovered information is different from your config. 

> NOTE: If you are using a preset, you dont need to define an issuer. If you do, the predefined information will be ignored.

#### *Advanced Config Example*

``` json
"issuer": {
   "issuer": "https://sso.your.domain",
   "authorization_endpoint": "https://auth.your.domain/auth-endpoint",
   "token_endpoint": "https://tokens.sso.your.domain/token-endpoint",
   "endsession_endpoint": "https://sso.your.domain/logout",
   "jwks_uri": "https://sso.your.domain/jwks-uri"
},
```

#### *Required and Commonly Used Configs*

The `issuer` property in the `issuer` object is the only one required, and its only required if you aren't using a preset. Besides the issuer, these are mostly options related to the endpoints and their configuration. 

#### *Common Config Chart*

|Name|Description|Default|Example|Required|
|---|---|---|---|---|
|`issuer`|The primary URI that represents your Identity Providers authentication endpoints.|N/A|`"https://sso.your.domain"`|Unless using preset.|

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

### *"Client" Options*

#### *Introduction*

There are just about as many option as possible here since openid-client also provides a Client class, because of this you are able to manually configure the client how ever you need. This includes setting your redirect URI to any available path, for example, if I was using the "google" preset and wanted to have Google redirect me back to "https://mesh.your.domain/oauth2/oidc/redirect/givemebackgooglemusicyoujerks", MeshCentral will now fully support you in that. One of the other options is the post logout redirect URI, and it is exactly what it sounds like. After MeshCentral logs out a user using the IdPs end session endpoint, it send the post logout redirect URI to your IdP to forward the user back to MeshCentral or to an valid URI such as a homepage.

> NOTE: The client object is required, however an exception would be with using old configs, which will be discussed later.

#### *Advanced Config Example*

``` json
"client": {
    "client_id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "client_secret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "redirect_uri": "https://mesh.your.domain/oauth2/oidc/redirect",
    "post_logout_redirect_uri": "https://mesh.your.domain/login",
    "token_endpoint_auth_method": "client_secret_post",
    "response_types": "authorization_code"
},
```

#### *Required and Commonly Used Configs*

Below is the full client object straight from the [MeshCentral config schema](https://github.com/Ylianst/MeshCentral/blob/21d94a87b065706ab4536226df84311b0207fafe/meshcentral-config-schema.json) The more commonly used properties are on top. The first two properties, `client_id` and `client_secret` are required. The next one `redirect_uri` is used to setup a custom URI for the redirect back to MeshCentral after being authenicated by your IdP.  The `post_logout_redirect_uri` property is used to tell your IdP where to send you after being logged out. These work in conjunction with the issuers `end_session_url` to automatically fill in any blanks in the config.

#### *Common Config Chart*

|Name|Description|Default|Example|Required|
|---|---|---|---|---|
|`client_id`|The client ID provided by your Identity Provider (IdP)|N/A|`XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`|`true`|
|`client_secret`|The client secret provided by your Identity Provider (IdP)|N/A|`XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`|`true`|
|`redirect_uri`|"URI your IdP sends you after successful authorization.|`https://mesh.your.domain/auth-oidc-callback`|`https://mesh.your.domain/oauth2/oidc/redirect`|`false`|
|`post_logout_redirect_uri`|URI for your IdP to send you after logging out of IdP via MeshCentral.|`https://mesh.your.domain/login`|`https://mesh.your.domain/login`|`false`|

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

### *"Custom"*

#### *Introduction*

These are all the options that dont fit with the issuer or client, including the presets. The presets define more than just the issuer URL used in discovery, they also define API endpoints, and specific ways to assemble your data. You are able to manually override most of the effects of the preset, but not all. You are able to manually configure the *scope* of the authorization request though, as well as choose which claims to use if your IdP uses something other than the defaults.

> NOTE: The scope must be a string, an array of strings, or a space separated list of scopes as a single string.

#### *Advanced Config Example*

``` json
"custom": {
    "scope": [ "openid", "profile", "read.EmailAlias", "read.UserProfile" ],
    "preset": null
},
```

> NOTE: You can `preset` to null if you want to explicitly disable them

#### *Required and Commonly Used Configs*

As should be apparent by the name alone, the custom property does not need to exist and is entirely optional. With that said, lets look at few common ones anyway. This strategy will default to using the `openid`, `profile`, and `email` scopes to gather the required information about the user, if your IdP doesn't support or require all these, you can set up the scope manually. Combine that with the ability to set the group scope and you can end up with an entirely custom scope being sent to your IdP. Not to mention the claims property, which allows you to pick and choose what claims to use to gather your data in case you have issues with any of the default behaviors of OpenID Connect and your IdP. This is also where you would set the preset and any values required by the presets.

#### *Common Config Chart*

|Name|Description|Default|Example|Required|
|---|---|---|---|---|
|`scope`|A list of scopes to request from the issuer.|`"openid profile email"`|`["openid", "profile"]`|`false`|
|`claims`|A group of claims to use instead of the defaults|Defauts to name of property except that `uuid` used `sub`|`"claims": {"uuid": "unique_name"}`|`false`|

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

### *"Groups" Options*

#### *Introduction*

The groups option allows you to use the groups you already have with your IdP in MeshCentral in a few ways. First you can set a group that the authorized user must be in to sign in to MeshCentral. You can also allow users with the right memberships automatic admin privlidges, and there is even an option to revoke privlidges if the user is NOT in the admin group. Besides these filters, you can filter the sync property to mirror only certain groups as MeshCentral User Groups, dynamically created as the user logs in. You can of course simply enable sync and mirror all groups from your IdP as User Groups. Additionally you can define the scope and claim of the groups for a custom setup, again allowing for a wide range of IdPs to be used, even without a preset.

#### *Advanced Config Example*

``` json
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
```

#### *Required and Commonly Used Configs*

As you can see in the schema below, there aren't any required properties in the groups object, however there are some commonly used ones. The first, and maybe most commonly used one, is the sync property. The sync property mirrors IdP provided groups into MeshCentral as user groups. You can then configure access as required to those groups, and as users log in, they will be added to the now existing groups if they are a member. You also have other options like using a custom *scope* or *claim* to get your IdP communicating with MeshCentral properly, without the use of preset configs. You also can set the required property if you need to limit authorization to users that are a member of at least one of the groups you set.  or the siteadmin property to grant admin privilege, with the revokeAdmin property available to allow revoking admin rights also.

#### *Schema*

``` json
"groups": {
    "type": "object",
    "properties": {
        "recursive": { "type": "boolean", "default": false, "description": "When true, the group memberships will be scanned recursively." },
        "required": { "type": [ "string", "array" ], "description": "Access is only granted to users who are a member of at least one of the listed required groups." },
        "siteadmin": { "type": [ "string", "array" ], "description": "Full site admin priviledges will be granted to users who are a member of at least one of the listed admin groups." },
        "revokeAdmin" { "type": "boolean", "description": "If true, admin privileges will be revoked from users who are NOT a member of at least one of the listed admin groups."},
        "sync": {
            "type": [ "boolean", "object" ],
            "default": false,
            "description": "If true, all groups found during user login are mirrored into MeshCentral user groups.",
            "properties": {
                "filter": { "type": [ "string", "array" ], "description": "Only groups listed here are mirrored into MeshCentral user groups." }
            }
        },
        "scope": { "type": "string", "default": "groups", "description": "Custom scope to use." },
        "claim": { "type": "string", "default": "groups", "description": "Custom claim to use." }
    },
    "additionalProperties": false
}
```


# Preset OpenID Connect Configurations

# Migration of Depreciated Strategy Setting