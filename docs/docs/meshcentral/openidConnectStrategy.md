# General Overview of the OpenID Connect

## Introducing OpenID Connect SSO on MeshCentral

There is a lot of information to go over, but first, why OpenID Connect?

Esentially its because its both based on a industry standard authorization protocol, and is becoming an industry standard authentication protocol. Put simply it's reliable and reusable, and we use OpenID Connect for exactly those reasons, almost every everyone does, and we want to be able to integrate with almost anyone. This strategy allows us to expand the potential of MeshCentral through the potential of OpenID Connect.

In this section, we will learn about the OpenID Connect specification at a high level, and then use that information to configure the OpenID Connect strategy for MeshCentral using a generic OpenID Connect compatible IdP. After that we will take a sneak peek at some advanced configurations. We will continue by explaining how to use the new presets for popular IdPs, such as Google or Azure. Then we will explore the configuration and usage of the groups feature, as well as check out some of the other advanced options you can setup. Finally, we will look at migrating some existing strategies to the OpenID Connect strategy on MeshCentral.

## Frequently Used Terms and Acronyms

> ### Chart of Frequently Used Terms and Acronyms
> | Term / Acronym            | Descriptions                                                                          |
> |---------------------------|---------------------------------------------------------------------------------------|
> | OAuth 2.0 (OAuth2)        | OAuth 2.0 is the industry-standard protocol for user *authorization*.                 |
> | OpenID Connect (OIDC)     | Identity layer built on top of OAuth2 for user *authentication*.                      |
> | Identity Provider (IdP)   | The *service used* to provide authentication and authorization.                       |
> | Preset                    | Set of *pre-configured values* to allow some specific IdPs to connect correctly.      |
> | Scope                     | A set flag *requesting access* to a specific resource or endpoint                     |
> | Claim                     | A *returned property* in the user info provided by your IdP                           |
> | User Authentication       | Checks if you *who you say you are*. Example: Username and password authentication    |
> | User Authorization        | Check if you have the *permissions* required to access a specific resource or endpoint|

## OpenID Connect Technology Overview

OpenID Connect is a simple identity layer built on top of the OAuth2 protocol. It allows Clients to verify the identity of the End-User based on the authentication performed by an “Authorization Server”, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner.

OpenID Connect allows clients of all types, including Web-based, mobile, and JavaScript clients, to request and receive information about authenticated sessions and end-users. The specification suite is extensible, allowing participants to use optional features such as encryption of identity data, discovery of OpenID Providers, and logout, when it makes sense for them.

That description was straigt from [OpenID Connect Documentation](https://openid.net/connect/), but basically, OAuth2 is the foundation upon which OpenID Connect was built, allowing for wide ranging compatability and interconnection. OpenID Connect appends the secure user *authentication* OAuth2 is known for, with user *authorization* by allowing the request of additional *scopes* that provide additional *claims* or access to API's in an easily expandable way.

# MeshCentral Configuration Options for OpenID Connect Strategy

## Basic Configuration

Generally, if you are using an IdP that supports OIDC, you can use a very basic configuration to get started, and if needed, add more specific or advanced configurations later. Here is what your config file will look like with a basic, generic, configuration.

> ### Basic Config File Example
> ``` json
> {
>	"settings": {
>		"cert": "mesh.your.domain",
>		"port": 443,
>		"sqlite3": true
>	},
>	"domains": {
>		"": {
>			"title": "Mesh",
>			"title2": ".Your.Domain",
>			"authStrategies": {
>				"oidc": {
>					"issuer": "https://sso.your.domain",
>					"clientid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
>					"clientsecret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
>					"newAccounts": true
>				}
>			}
>		}
>	}
> }
> ```

As you can see, this is roughly the same as all the other OAuth2 based authentication strategies. These are the basics you need to get started, however, if you plan to take advantage of some of the more advanced features provided by this strategy, you'll need to keep reading.

In this most basic of setups, you only need the URL of the issuer, as well as a client ID and a client secret. Notice in this example that the callback URL (or client redirect uri) is not configured, thats because MeshCentral will use `https://mesh.your.domain/auth-oidc-callback` as the default. Once you've got your configuration saved, restart MeshCentral and you should see an OpenID Connect Single Sign-on button on the login screen.

> WARNING: The redirect endpoint must EXACTLY match the value provided to your IdP or your will deny the connection.

> ATTENTION: You are required to configure the cert property in the settings section for the default domain, and configure the dns property under each additional domain.

## Advanced Configuration

There are plenty of options at your disposal if you need them. In fact, you can configure any property that node-openid-client supports. The openid-client module supports far more customization than I know what to do with, check out [node-openid-client on GitHub]() for expert level configuration details. Let’s take a look at an advanced OpenID Connect configuration example.

>### Advanced Config File Example
>``` json
>{
>	"settings": {
>		"cert": "mesh.your.domain",
>		"port": 443,
>		"redirPort": 80,
>		"AgentPong": 300,
>        "TLSOffload": "192.168.1.50",
>		"SelfUpdate": false,
>		"AllowFraming": false,
>		"sqlite3": true,
>		"WebRTC": true
>	},
>	"domains": {
>		"": {
>			"title": "Mesh",
>			"title2": ".Your.Domain",
>			"orphanAgentUser": "~oidc:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
>			"authStrategies": {
>				"oidc": {
>					"issuer": {
>						"issuer": "https://sso.your.domain",
>                        "authorization_endpoint": "https://sso.your.domain/auth-endpoint",
>                        "token_endpoint": "https://sso.your.domain/token-endpoint",
>                        "userinfo_endpoint": "https://sso.your.domain/userinfo-endpoint",
>                        "endsession_endpoint": "https://sso.your.domain/logout",
>                        "jwks_uri": "https://sso.your.domain/jwks-uri"
>					},
>					"client": {
>						"client_id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
>						"client_secret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
>                        "redirect_uri": "https://mesh.your.domain/oauth2/oidc/redirect",
>                        "post_logout_redirect_uri": "https://mesh.your.domain/login",
>                        "token_endpoint_auth_method": "client_secret_post",
>                        "response_types": "authorization_code"
>					},
>					"groups": {
>                        "recursive": true,
>						"required": ["Group1", "Group2"],
>						"siteadmin": ["GroupA", "GroupB"],
>						"sync": { 
>                            "filter": ["Group1", "GroupB", "OtherGroup"]
>                        },
>                        "claim": "GroupClaim",
>                        "scope": "GroupScope"
>					},
>					"logouturl": "https://sso.your.domain/logout?r=https://mesh.your.domain/login",
>					"newAccounts": true
>				},
>                {...}
>			}
>		}
>	}
>}
>```

First notice the issuer property has changed from a string to an object, this allows for much simpler configs when advanced issuer options are not required. If you are manually configuring the issuer endpoints, keep in mind that MeshCentral will still attempt to discover ALL issuer information, then simply overwrite any discovered information with your configured values. 

With this authentication strategy, you are able to manually configure a number of client options, including the ability to set your redirect URI to any unused path, although this value still must EXACTLY match the redirect URI provided to your IdP. One of the other options is the post logout redirect URI, and it is exactly what it sounds like. After MeshCentral logs out a user using the IdPs end session endpoint, it send the post logout redirect URI to your IdP to forward the user back to MeshCentral or to an valid URI such as a homepage.

You are also able to manually configure the scope of the authorization request as well, this allows you to tell your IdP what kind of information you require to be authenticated by MeshCentral. The scope must explicitly be either an array of strings, or a space separated list of scopes as a single string.

# Preset OpenID Connect Configurations

# Migration of Depreciated Strategy Setting