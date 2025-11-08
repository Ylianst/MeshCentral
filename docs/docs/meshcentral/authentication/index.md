# Authentication Strategies

MeshCentral supports multiple authentication strategies for enterprise Single Sign-On (SSO) integration.

## Modern Strategies (Recommended)

### [OpenID Connect (OIDC)](oidc.md)
Modern authentication strategy supporting OAuth 2.0 and OpenID Connect providers.

**Supported Providers:**
- Azure AD / Microsoft Entra ID
- Google Workspace
- GitHub
- Twitter (OAuth 2.0)
- Any OIDC-compliant provider

**Features:**
- Group synchronization
- Automatic user provisioning
- Multi-provider support
- Pre-configured presets

[Read OIDC Documentation →](oidc.md)

### [SAML 2.0](saml.md)
Industry-standard SAML 2.0 authentication for enterprise identity providers.

**Supported Providers:**
- Okta
- Azure AD SAML
- JumpCloud
- OneLogin
- Any SAML 2.0 compliant IdP

**Features:**
- Group synchronization
- Multi-preset support
- Flexible attribute mapping
- Single logout

[Read SAML Documentation →](saml.md)

## Deprecated Strategies

> **⚠️ DEPRECATION NOTICE**: The following authentication strategies are deprecated and will be removed in a future version. Please migrate to the modern OIDC or SAML strategies above.

### Deprecated OAuth2 Strategies
- **Azure OAuth2** → Migrate to [OIDC with Azure preset](migration-guide.md#azure-oauth2-to-oidc)
- **Google OAuth2** → Migrate to [OIDC with Google preset](migration-guide.md#google-oauth2-to-oidc)
- **GitHub OAuth2** → Migrate to [OIDC with GitHub preset](migration-guide.md#github-oauth2-to-oidc)
- **Twitter OAuth** → Migrate to [OIDC with Twitter preset](migration-guide.md#twitter-oauth-to-oidc)

### Deprecated SAML Strategies
- **Intel SAML** → Migrate to [SAML with Intel preset](migration-guide.md#intel-saml-to-unified-saml)
- **JumpCloud SAML** → Migrate to [SAML with JumpCloud preset](migration-guide.md#jumpcloud-saml-to-unified-saml)

[View Migration Guide →](migration-guide.md)

## Comparison

| Feature | OIDC | SAML |
| --- | --- | --- |
| **Protocol** | OAuth 2.0 / OIDC | SAML 2.0 |
| **Format** | JSON (JWT) | XML |
| **Complexity** | Simpler | More complex |
| **Group Sync** | ✅ Yes | ✅ Yes |
| **Modern IdPs** | ✅ Best support | ✅ Good support |
| **Legacy IdPs** | ⚠️ Limited | ✅ Excellent |
| **Mobile-Friendly** | ✅ Yes | ⚠️ Limited |

## Quick Decision Guide

**Choose OIDC if:**
- Using modern cloud IdPs (Azure AD, Google, Okta)
- Want simpler configuration
- Need OAuth 2.0 API access
- Supporting mobile applications

**Choose SAML if:**
- Required by enterprise IdP
- Need mature, proven standard
- IdP only supports SAML
- Regulatory compliance requires SAML

## Other Authentication Methods

- **Local Accounts** - Built-in username/password
- **LDAP/Active Directory** - Direct directory integration
- **Two-Factor Authentication** - TOTP, Email, SMS
- **WebAuthn** - Hardware security keys

For more information on these methods, see the [MeshCentral Configuration Guide](../config.md).
