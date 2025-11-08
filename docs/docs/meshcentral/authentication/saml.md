# Using the SAML Strategy on MeshCentral

## Overview

### Introduction

MeshCentral supports SAML 2.0 authentication through a modern, unified SAML strategy. This allows you to integrate with any SAML 2.0 compatible Identity Provider (IdP) such as Okta, Azure AD, JumpCloud, OneLogin, and many others.

The SAML strategy uses the industry-standard `@node-saml/passport-saml` library (v5.x+), which provides robust SAML 2.0 protocol support with modern security features.

> **IMPORTANT**: As of MeshCentral v1.1.48, the old separate SAML strategies (`intel`, `jumpcloud`) are **DEPRECATED**. Please migrate to the unified `saml` strategy with presets. See the [Migration Guide](#migration-from-deprecated-strategies) below.

### Chart of Frequently Used Terms

| Term | Description |
| --- | --- |
| **SAML** | Security Assertion Markup Language - XML-based standard for authentication |
| **IdP** | Identity Provider - The service that authenticates users (Okta, Azure AD, etc.) |
| **SP** | Service Provider - MeshCentral in this case |
| **Assertion** | XML document containing user authentication information |
| **Entity ID** | Unique identifier for the Service Provider (MeshCentral) |
| **SSO** | Single Sign-On - Authenticate once, access multiple services |
| **Preset** | Pre-configured settings for popular IdP providers |

## Quick Start

### Basic Configuration

Here's a minimal SAML configuration:

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "cert": "idp-certificate.pem",
          "idpurl": "https://idp.example.com/saml/sso",
          "entityid": "meshcentral",
          "callbackurl": "https://mesh.example.com/auth-saml-callback"
        }
      }
    }
  }
}
```

### Required Files

1. **IdP Certificate** - Place your IdP's public certificate in `meshcentral-data/`
   - File format: PEM (Base64 encoded X.509 certificate)
   - Example filename: `idp-certificate.pem`

## Using Presets

Presets provide optimized configurations for popular IdP providers.

### Available Presets

- `azure` - Azure AD / Microsoft Entra ID
- `okta` - Okta
- `onelogin` - OneLogin
- `jumpcloud` - JumpCloud
- `auth0` - Auth0 SAML
- `keycloak` - Keycloak / Red Hat SSO
- `adfs` - Active Directory Federation Services (Microsoft ADFS)
- `pingfederate` - Ping Identity PingFederate
- `google` - Google Workspace SAML
- `intel` - Intel SAML
- `generic` - (default) Standard SAML 2.0

### Azure AD Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "azure",
          "cert": "azure-saml-cert.pem",
          "idpurl": "https://login.microsoftonline.com/YOUR-TENANT-ID/saml2",
          "entityid": "meshcentral",
          "callbackurl": "https://mesh.example.com/auth-saml-callback"
        }
      }
    }
  }
}
```

**Azure preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`
- AuthN Response Signing: Disabled (Azure signs assertions instead)

### Okta Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "okta",
          "cert": "okta-cert.pem",
          "idpurl": "https://your-org.okta.com/app/YOUR-APP-ID/sso/saml",
          "entityid": "meshcentral",
          "callbackurl": "https://mesh.example.com/auth-saml-callback",
          "groups": {
            "enabled": true,
            "attribute": "groups",
            "required": ["MeshCentral-Users"],
            "siteadmin": ["MeshCentral-Admins"],
            "sync": true
          }
        }
      }
    }
  }
}
```

**Okta preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`

### OneLogin Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "onelogin",
          "cert": "onelogin-cert.pem",
          "idpurl": "https://company.onelogin.com/trust/saml2/http-post/sso/123456",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

**OneLogin preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`

### Auth0 SAML Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "auth0",
          "cert": "auth0-cert.pem",
          "idpurl": "https://company.auth0.com/samlp/YOUR-CLIENT-ID",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

**Auth0 preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`

### Keycloak Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "keycloak",
          "cert": "keycloak-cert.pem",
          "idpurl": "https://keycloak.company.com/realms/master/protocol/saml",
          "entityid": "meshcentral",
          "groups": {
            "attribute": "Role",
            "required": ["mesh-users"],
            "siteadmin": ["mesh-admins"],
            "sync": true
          }
        }
      }
    }
  }
}
```

**Keycloak preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`
- Wants AuthN Response Signed: true

### Microsoft ADFS Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "adfs",
          "cert": "adfs-cert.pem",
          "idpurl": "https://adfs.company.com/adfs/ls/",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

**ADFS preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`
- Wants AuthN Response Signed: false

### PingFederate Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "pingfederate",
          "cert": "pingfederate-cert.pem",
          "idpurl": "https://sso.company.com/idp/SSO.saml2",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

**PingFederate preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`
- Wants AuthN Response Signed: true

### Google Workspace SAML Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "google",
          "cert": "google-saml-cert.pem",
          "idpurl": "https://accounts.google.com/o/saml2/idp?idpid=YOUR-IDP-ID",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

**Google Workspace preset settings:**
- Identifier Format: `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`

### JumpCloud Example

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "saml": {
          "preset": "jumpcloud",
          "cert": "jumpcloud-cert.pem",
          "idpurl": "https://sso.jumpcloud.com/saml2/YOUR-ORG-ID",
          "entityid": "meshcentral"
        }
      }
    }
  }
}
```

## Advanced Configuration

### Complete Configuration Example

```json
{
  "domains": {
    "": {
      "title": "My Company Mesh",
      "authStrategies": {
        "saml": {
          "preset": "okta",
          "cert": "okta-saml-cert.pem",
          "idpurl": "https://company.okta.com/app/meshcentral/sso/saml",
          "entityid": "meshcentral-production",
          "callbackurl": "https://mesh.company.com/auth-saml-callback",
          "disablerequestedauthncontext": false,
          "newAccounts": true,
          "newAccountsUserGroups": ["default-users"],
          "newAccountsRights": ["nonewgroups", "notools"],
          "groups": {
            "attribute": "groups",
            "required": ["mesh-users"],
            "siteadmin": ["mesh-admins"],
            "sync": true,
            "revokeAdmin": true
          },
          "logouturl": "https://company.okta.com/login/signout"
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `preset` | string | No | Preset configuration: `azure`, `okta`, `jumpcloud`, `intel`, `generic` |
| `cert` | string | **Yes** | Path to IdP certificate file (relative to meshcentral-data/) |
| `idpurl` | string | **Yes** | IdP's SAML SSO endpoint URL |
| `entityid` | string | No | Service Provider entity ID (default: "meshcentral") |
| `callbackurl` | string | No | Callback URL (default: auto-generated) |
| `disablerequestedauthncontext` | boolean | No | Disable authentication context in requests |
| `newAccounts` | boolean | No | Allow creating new accounts on first login (default: true) |
| `newAccountsUserGroups` | array | No | Auto-add new users to these MeshCentral user groups |
| `newAccountsRights` | array | No | Set default permissions for new accounts |
| `logouturl` | string | No | IdP logout URL for single logout |

## Group Synchronization

### Overview

SAML group sync allows MeshCentral to automatically:
- Restrict access to users in specific groups
- Grant site admin privileges based on group membership
- Synchronize IdP groups to MeshCentral user groups

### Group Configuration

```json
{
  "saml": {
    "preset": "okta",
    "cert": "cert.pem",
    "idpurl": "https://idp.example.com/saml/sso",
    "groups": {
      "attribute": "groups",
      "required": ["mesh-users", "company-staff"],
      "siteadmin": ["mesh-admins", "it-team"],
      "sync": true,
      "revokeAdmin": true
    }
  }
}
```

### Group Options

| Option | Type | Description |
| --- | --- | --- |
| `attribute` | string | SAML assertion attribute containing groups (default: "groups") |
| `required` | array | User must be in at least ONE of these groups to log in |
| `siteadmin` | array | Users in these groups get site admin privileges |
| `sync` | boolean | Sync IdP groups to MeshCentral user groups |
| `revokeAdmin` | boolean | Remove admin if user leaves admin group (default: true) |

### IdP Configuration

#### Okta Group Attribute Setup

1. In Okta Admin Console, go to your SAML app
2. Navigate to **SAML Settings** → **Attribute Statements**
3. Add attribute:
   - **Name**: `groups`
   - **Name Format**: `Basic`
   - **Value**: `appuser.groups`
   - **Filter**: (optional) Regex like `^mesh-.*` to filter groups

#### Azure AD Group Claims

1. In Azure Portal, go to **App Registrations** → Your App
2. Navigate to **Token Configuration**
3. Click **Add groups claim**
4. Select **Security groups**
5. In **ID** section, choose **Group ID** or **sAMAccountName**
6. In your SAML config:
```json
{
  "groups": {
    "attribute": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
  }
}
```

## Setting Up Your IdP

### Okta Setup

1. **Create SAML App**
   - Admin Console → Applications → Create App Integration
   - Choose **SAML 2.0**

2. **General Settings**
   - App name: MeshCentral
   - App logo: (optional)

3. **SAML Settings**
   - **Single sign on URL**: `https://mesh.example.com/auth-saml-callback`
   - **Audience URI (SP Entity ID)**: `meshcentral`
   - **Name ID format**: `EmailAddress`
   - **Application username**: `Email`

4. **Attribute Statements** (optional)
   - `email`: `user.email`
   - `firstname`: `user.firstName`
   - `lastname`: `user.lastName`
   - `displayname`: `user.displayName`

5. **Group Attribute Statements** (optional)
   - Name: `groups`
   - Filter: `Matches regex: .*` (or filter as needed)
   - Value: `appuser.groups`

6. **Download Certificate**
   - View Setup Instructions → Download certificate
   - Save as `okta-cert.pem` in `meshcentral-data/`

7. **Get IdP URL**
   - Copy **Identity Provider Single Sign-On URL**
   - Use in `idpurl` config

### Azure AD Setup

1. **Create Enterprise Application**
   - Azure Portal → Enterprise Applications → New Application
   - Create your own application → **Integrate any other application**

2. **Set up Single Sign-On**
   - Select **SAML**

3. **Basic SAML Configuration**
   - **Identifier (Entity ID)**: `meshcentral`
   - **Reply URL**: `https://mesh.example.com/auth-saml-callback`

4. **User Attributes & Claims** (optional)
   - Add claims for email, firstname, lastname

5. **SAML Signing Certificate**
   - Download **Certificate (Base64)**
   - Save as `azure-saml-cert.pem` in `meshcentral-data/`

6. **Set up MeshCentral**
   - Copy **Login URL** → use as `idpurl`
   - Configure Tenant ID in URL

### JumpCloud Setup

1. **Create SSO Application**
   - JumpCloud Admin Portal → SSO → Add New Application
   - Choose **Custom SAML App**

2. **General Info**
   - Display Label: MeshCentral

3. **SSO Configuration**
   - **IdP Entity ID**: `https://sso.jumpcloud.com/saml2/YOUR-ORG`
   - **SP Entity ID**: `meshcentral`
   - **ACS URL**: `https://mesh.example.com/auth-saml-callback`
   - **Login URL**: (leave empty or use MeshCentral URL)

4. **User Attributes**
   - Service Provider Attribute: `email` → JumpCloud Attribute: `email`
   - Service Provider Attribute: `firstname` → JumpCloud Attribute: `firstname`
   - Service Provider Attribute: `lastname` → JumpCloud Attribute: `lastname`

5. **Group Attributes** (optional)
   - Service Provider Attribute: `groups`
   - Include group attribute: ✓

6. **Export Certificate**
   - Download certificate
   - Save as `jumpcloud-cert.pem` in `meshcentral-data/`

7. **Get SSO URL**
   - Copy **IDP URL**
   - Use in `idpurl` config

## Migration from Deprecated Strategies

### Intel SAML (Deprecated)

**Old Config:**
```json
{
  "authStrategies": {
    "intel": {
      "cert": "intel-cert.pem",
      "idpurl": "https://intel-idp.example.com/saml"
    }
  }
}
```

**New Config:**
```json
{
  "authStrategies": {
    "saml": {
      "preset": "intel",
      "cert": "intel-cert.pem",
      "idpurl": "https://intel-idp.example.com/saml"
    }
  }
}
```

### JumpCloud SAML (Deprecated)

**Old Config:**
```json
{
  "authStrategies": {
    "jumpcloud": {
      "cert": "jumpcloud-cert.pem",
      "idpurl": "https://sso.jumpcloud.com/saml2/ORG-ID",
      "entityid": "meshcentral"
    }
  }
}
```

**New Config:**
```json
{
  "authStrategies": {
    "saml": {
      "preset": "jumpcloud",
      "cert": "jumpcloud-cert.pem",
      "idpurl": "https://sso.jumpcloud.com/saml2/ORG-ID",
      "entityid": "meshcentral"
    }
  }
}
```

### User Account Migration

**Important**: User IDs will change when migrating:
- Old Intel: `~intel:user@example.com`
- Old JumpCloud: `~jumpcloud:user@example.com`
- New SAML: `~saml:user@example.com`

Users will need to create new accounts or you'll need to manually update user IDs in the database.

## Troubleshooting

### Enable Debug Logging

```bash
node meshcentral.js --debug auth,web
```

### Common Issues

#### Certificate Errors

**Problem**: `Unable to read SAML IdP certificate`

**Solution**:
- Verify certificate file exists in `meshcentral-data/`
- Ensure file has correct permissions
- Certificate must be PEM format (Base64 encoded)
- Remove any extra whitespace or headers

#### Discovery Issues with Self-Signed Certificates

**Problem**: `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`

**Solution** (Docker):
```yaml
environment:
  - NODE_EXTRA_CA_CERTS=/opt/meshcentral/meshcentral-data/chain.pem
```

**Solution** (Node.js):
```bash
export NODE_EXTRA_CA_CERTS=/path/to/meshcentral-data/chain.pem
node meshcentral.js
```

#### No Groups in Assertion

**Problem**: Groups not syncing, users can't log in

**Solution**:
- Verify IdP is configured to include group attribute
- Check `groups.attribute` matches your IdP's attribute name
- Common names: `groups`, `memberOf`, `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`
- Enable debug logging to see SAML assertion contents

#### User Creation Fails

**Problem**: New accounts not being created

**Solution**:
- Ensure `newAccounts: true` in config
- Check MeshCentral logs for errors
- Verify user has required group membership

## Security Best Practices

1. **Certificate Security**
   - Store IdP certificates securely
   - Rotate certificates regularly
   - Verify certificate expiration dates

2. **Entity ID**
   - Use unique entity IDs per environment
   - Example: `meshcentral-production`, `meshcentral-staging`

3. **Group-Based Access**
   - Always configure `required` groups
   - Limit site admin groups to minimal set
   - Use `revokeAdmin: true` to auto-revoke admin access

4. **HTTPS Only**
   - Never use SAML over HTTP
   - Ensure proper SSL/TLS certificates

5. **Single Logout**
   - Configure `logouturl` for proper session termination
   - Users should be logged out of both MeshCentral and IdP

## Reference

### SAML Assertion Attributes

MeshCentral recognizes these attributes in SAML assertions:

| Attribute | Maps To | Example |
| --- | --- | --- |
| `nameID` | User ID (required) | `user@example.com` |
| `email` | User email | `user@example.com` |
| `displayname` | User display name | `John Doe` |
| `firstname` | First name | `John` |
| `lastname` | Last name | `Doe` |
| `groups` (configurable) | Group memberships | `["admins", "users"]` |

### User ID Format

SAML users are stored with the prefix `~saml:`:
- Format: `user/{domain}/~saml:{nameID}`
- Example: `user//~saml:john.doe@example.com`

### Links

- [SAML 2.0 Specification](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html)
- [@node-saml/passport-saml Documentation](https://github.com/node-saml/passport-saml)
- [Okta SAML Documentation](https://developer.okta.com/docs/guides/build-sso-integration/saml2/overview/)
- [Azure AD SAML Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/single-sign-on-saml-protocol)
