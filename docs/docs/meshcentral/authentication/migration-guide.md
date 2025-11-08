# Authentication Strategy Migration Guide

This guide helps you migrate from deprecated authentication strategies to the modern OIDC and SAML implementations.

## Why Migrate?

### Benefits of Modern Strategies

1. **Better Maintainability** - Single codebase for all OAuth2/OIDC and SAML providers
2. **More Features** - Group sync, better error handling, enhanced logging
3. **Active Development** - Modern libraries with security updates
4. **Consistent Configuration** - Same pattern for all providers
5. **Bug Fixes** - Resolves critical issues like Azure unique_name bug (#4531)

### Deprecation Timeline

- **v1.1.48+** - Deprecated strategies still work but log warnings
- **Future Release** - Deprecated strategies will be removed

## Azure OAuth2 → OIDC

### The Problem

**Critical Bug**: Azure OAuth2 strategy uses the `unique_name` claim which is **NOT STABLE**. When users change their email or UPN, they get a new account instead of logging into their existing one.

**OIDC Solution**: Uses the `oid` (Object ID) claim which is immutable and never changes.

### Migration Steps

#### 1. Old Configuration

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "azure": {
          "clientid": "abc-123-def-456",
          "clientsecret": "your-client-secret",
          "tenantid": "your-tenant-guid",
          "callbackurl": "https://mesh.example.com/auth-azure-callback",
          "newAccounts": true
        }
      }
    }
  }
}
```

#### 2. New Configuration

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "oidc": {
          "client": {
            "client_id": "abc-123-def-456",
            "client_secret": "your-client-secret",
            "redirect_uri": "https://mesh.example.com/auth-oidc-callback"
          },
          "custom": {
            "preset": "azure",
            "tenant_id": "your-tenant-guid"
          },
          "newAccounts": true
        }
      }
    }
  }
}
```

**OR** use simplified format (auto-migrates):

```json
{
  "domains": {
    "": {
      "authStrategies": {
        "oidc": {
          "clientid": "abc-123-def-456",
          "clientsecret": "your-client-secret",
          "tenantid": "your-tenant-guid",
          "newAccounts": true
        }
      }
    }
  }
}
```

#### 3. Update Azure App Registration

**Old Redirect URI:**
```
https://mesh.example.com/auth-azure-callback
```

**New Redirect URI:**
```
https://mesh.example.com/auth-oidc-callback
```

1. Go to Azure Portal → App Registrations → Your App
2. Navigate to **Authentication** → **Platform configurations** → **Web**
3. Add new redirect URI: `https://mesh.example.com/auth-oidc-callback`
4. Remove old redirect URI (after testing)

#### 4. User Account Migration

**User IDs will change:**
- Old: `user//~azure:john.doe@company.com`
- New: `user//~oidc:12345678-abcd-1234-abcd-123456789abc`

**Options:**

**A. Let Users Create New Accounts**
- Simplest approach
- Users log in and get new accounts
- Manually transfer device ownership if needed

**B. Database Migration (Advanced)**
- Update user IDs in database
- Requires database access
- Contact MeshCentral support for assistance

### Testing

1. Keep `azure` config temporarily
2. Add `oidc` config alongside it
3. Test OIDC login works
4. Verify groups sync correctly
5. Remove `azure` config after confirming

## Google OAuth2 → OIDC

### Migration Steps

#### 1. Old Configuration

```json
{
  "authStrategies": {
    "google": {
      "clientid": "123456789.apps.googleusercontent.com",
      "clientsecret": "your-client-secret",
      "callbackurl": "https://mesh.example.com/auth-google-callback"
    }
  }
}
```

#### 2. New Configuration

```json
{
  "authStrategies": {
    "oidc": {
      "client": {
        "client_id": "123456789.apps.googleusercontent.com",
        "client_secret": "your-client-secret",
        "redirect_uri": "https://mesh.example.com/auth-oidc-callback"
      },
      "custom": {
        "preset": "google"
      }
    }
  }
}
```

#### 3. Update Google OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services** → **Credentials**
3. Click your OAuth 2.0 Client ID
4. Under **Authorized redirect URIs**:
   - Add: `https://mesh.example.com/auth-oidc-callback`
   - Remove old URI after testing

#### 4. User Migration

**User IDs change:**
- Old: `user//~google:1234567890`
- New: `user//~oidc:1234567890` (same numeric ID)

## GitHub OAuth2 → OIDC

### Migration Steps

#### 1. Old Configuration

```json
{
  "authStrategies": {
    "github": {
      "clientid": "Iv1.abc123def456",
      "clientsecret": "github-secret",
      "callbackurl": "https://mesh.example.com/auth-github-callback"
    }
  }
}
```

#### 2. New Configuration

```json
{
  "authStrategies": {
    "oidc": {
      "client": {
        "client_id": "Iv1.abc123def456",
        "client_secret": "github-secret",
        "redirect_uri": "https://mesh.example.com/auth-oidc-callback"
      },
      "custom": {
        "preset": "github"
      }
    }
  }
}
```

#### 3. Update GitHub OAuth App

1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Click your application
3. Update **Authorization callback URL**:
   - Change to: `https://mesh.example.com/auth-oidc-callback`

#### 4. User Migration

**User IDs change:**
- Old: `user//~github:1234567`
- New: `user//~oidc:1234567` (same numeric ID)

## Twitter OAuth → OIDC

### Migration Steps

#### 1. Old Configuration

```json
{
  "authStrategies": {
    "twitter": {
      "clientid": "your-consumer-key",
      "clientsecret": "your-consumer-secret",
      "callbackurl": "https://mesh.example.com/auth-twitter-callback"
    }
  }
}
```

#### 2. New Configuration

```json
{
  "authStrategies": {
    "oidc": {
      "client": {
        "client_id": "your-oauth2-client-id",
        "client_secret": "your-oauth2-client-secret",
        "redirect_uri": "https://mesh.example.com/auth-oidc-callback"
      },
      "custom": {
        "preset": "twitter"
      }
    }
  }
}
```

#### 3. Upgrade to Twitter OAuth 2.0

> **Important**: Twitter's old OAuth 1.0a is deprecated. You need OAuth 2.0 credentials.

1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Select your app
3. Navigate to **Keys and tokens**
4. Under **OAuth 2.0 Client ID and Client Secret**:
   - Generate new credentials if you don't have them
5. Update callback URL to: `https://mesh.example.com/auth-oidc-callback`

#### 4. User Migration

**User IDs change:**
- Old: `user//~twitter:123456789`
- New: `user//~oidc:123456789` (same numeric ID)

## Intel SAML → Unified SAML

### Migration Steps

#### 1. Old Configuration

```json
{
  "authStrategies": {
    "intel": {
      "cert": "intel-saml-cert.pem",
      "idpurl": "https://intel-idp.example.com/saml/sso",
      "entityid": "meshcentral",
      "callbackurl": "https://mesh.example.com/auth-intel-callback"
    }
  }
}
```

#### 2. New Configuration

```json
{
  "authStrategies": {
    "saml": {
      "preset": "intel",
      "cert": "intel-saml-cert.pem",
      "idpurl": "https://intel-idp.example.com/saml/sso",
      "entityid": "meshcentral",
      "callbackurl": "https://mesh.example.com/auth-saml-callback"
    }
  }
}
```

#### 3. Update IdP Configuration

**Old Callback URL:**
```
https://mesh.example.com/auth-intel-callback
```

**New Callback URL:**
```
https://mesh.example.com/auth-saml-callback
```

Update your SAML IdP with the new callback URL.

#### 4. User Migration

**User IDs change:**
- Old: `user//~intel:user@example.com`
- New: `user//~saml:user@example.com`

## JumpCloud SAML → Unified SAML

### Migration Steps

#### 1. Old Configuration

```json
{
  "authStrategies": {
    "jumpcloud": {
      "cert": "jumpcloud-cert.pem",
      "idpurl": "https://sso.jumpcloud.com/saml2/org-id",
      "entityid": "meshcentral"
    }
  }
}
```

#### 2. New Configuration

```json
{
  "authStrategies": {
    "saml": {
      "preset": "jumpcloud",
      "cert": "jumpcloud-cert.pem",
      "idpurl": "https://sso.jumpcloud.com/saml2/org-id",
      "entityid": "meshcentral"
    }
  }
}
```

#### 3. Update JumpCloud SSO App

1. Go to JumpCloud Admin Portal
2. Navigate to **SSO** → Your MeshCentral App
3. Update **ACS URL**:
   - Change to: `https://mesh.example.com/auth-saml-callback`

#### 4. User Migration

**User IDs change:**
- Old: `user//~jumpcloud:user@example.com`
- New: `user//~saml:user@example.com`

## Advanced: Database User ID Migration

> **⚠️ WARNING**: Direct database manipulation can break your MeshCentral installation. Always backup first!

### Backup Database

```bash
# NeDB (default)
cp -r meshcentral-data/ meshcentral-data-backup/

# MongoDB
mongodump --db meshcentral --out backup/
```

### Migration Script Example

This script is for **reference only**. Adapt to your specific needs:

```javascript
// Example: Migrate Azure OAuth2 users to OIDC
// This is PSEUDOCODE - not production ready!

const oldPrefix = '~azure:';
const newPrefix = '~oidc:';

db.collection('users').find({ _id: { $regex: oldPrefix } }).forEach(user => {
  const oldId = user._id;
  const username = oldId.split(oldPrefix)[1];
  
  // You need to map old username to new OIDC 'sub' or 'oid' claim
  // This requires looking up the claim from Azure AD
  const newOid = lookupAzureOid(username); // You implement this
  const newId = oldId.replace(oldPrefix + username, newPrefix + newOid);
  
  // Update user document
  user._id = newId;
  db.collection('users').insert(user);
  db.collection('users').remove({ _id: oldId });
  
  // Update references in other collections (devices, groups, etc.)
  // ... more updates needed ...
});
```

### Professional Migration

For production systems with many users, consider:
1. Hiring a MeshCentral consultant
2. Contacting MeshCentral support
3. Planning maintenance window
4. Testing on staging environment first

## Gradual Migration Strategy

### Phase 1: Parallel Operation

Keep both old and new strategies:

```json
{
  "authStrategies": {
    "azure": { /* old config */ },
    "oidc": { /* new config */ }
  }
}
```

- Both login methods work simultaneously
- Test new OIDC method thoroughly
- Users can start migrating gradually

### Phase 2: Announcement

- Notify users of upcoming change
- Provide documentation
- Set migration deadline
- Offer support for issues

### Phase 3: Deprecation

Remove old configuration:

```json
{
  "authStrategies": {
    "oidc": { /* new config */ }
  }
}
```

## Troubleshooting

### Deprecation Warnings in Logs

You'll see warnings like:

```
DEPRECATION: ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPRECATION: ⚠️  Azure OAuth2 strategy is DEPRECATED
DEPRECATION: 📋 Migrate to OIDC with preset: "azure"
DEPRECATION: ⚠️  CRITICAL: Azure OAuth2 uses "unique_name" claim which is NOT STABLE
DEPRECATION: 📚 See documentation: AUTH_MIGRATION_GUIDE.md
DEPRECATION: ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Action**: Follow migration guide for your provider above.

### Users Can't Find Old Accounts

**Cause**: User ID format changed during migration

**Solutions**:
1. **Option A**: Let users create new accounts, manually transfer devices
2. **Option B**: Perform database migration (advanced)
3. **Option C**: Keep old strategy temporarily until ready

### Both Old and New Methods Don't Work

**Cause**: Callback URL mismatch

**Solution**:
- Verify IdP has BOTH callback URLs configured
- Check config.json has correct URLs
- Review server logs for specific errors

### Group Sync Not Working After Migration

**Cause**: Group configuration differences between strategies

**Solution**:
- OIDC and SAML both support groups
- Review [OIDC Groups](oidc.md#group-synchronization)
- Review [SAML Groups](saml.md#group-synchronization)
- Ensure IdP sends group claims/attributes

## Getting Help

- **Documentation**: [Authentication Strategies](index.md)
- **GitHub Issues**: [MeshCentral Issues](https://github.com/Ylianst/MeshCentral/issues)
- **Community Forum**: [MeshCentral Discord/Forum]
- **Logs**: Enable debug with `node meshcentral.js --debug auth`

## Summary Checklist

- [ ] Backup database and configuration
- [ ] Update IdP redirect/callback URLs
- [ ] Update config.json with new strategy
- [ ] Test login with new strategy
- [ ] Verify group sync works (if used)
- [ ] Notify users of change
- [ ] Monitor logs for errors
- [ ] Remove old strategy config after verification
- [ ] Document any custom changes

---

*Last updated: November 2025 for MeshCentral v1.1.48+*
