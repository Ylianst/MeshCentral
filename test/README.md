# Tenant isolation tests

In OpenFrame mode every tenant runs its own MeshCentral server, but all of them share **one MongoDB
database** with shared collections, and tenants are separated only by the `domain` field on each
document (which is also embedded in the `_id`). Upstream MeshCentral is written for "one server owns
the whole database", so several of its queries and maintenance routines legitimately span everything
they can see — which here means every tenant.

These tests pin the places that were changed for that. Each one seeds two tenant domains into a
single database, drives `db.js` as tenant A, and asserts that tenant B is left alone.

## Running

```bash
test/run-tests.sh                       # against :latest
test/run-tests.sh ghcr.io/flamingo-stack/meshcentral/meshcentral:0.0.28
```

The script starts a throwaway MongoDB replica set and runs `node --test` inside the MeshCentral
image with this checkout mounted read-only at `/src`. Two reasons it is not a plain `npm test`:

- `mongodb` is not a `package.json` dependency of this repository — the driver lives in the image.
  `NODE_PATH` points module resolution there while the code under test comes from `/src`.
- The tests use a real replica set rather than a mock. What is being tested is the *shape of the
  queries* (does this find/delete carry a domain?), and a mock would only assert that the code calls
  the mock.

CI runs the same script (`test_isolation` job in `.github/workflows/test.yml`).

## What is covered

| Test | Guards against |
|---|---|
| `GetAllTypeForDomain` returns one tenant and keeps `type` | the boot cache loading the whole fleet; and the projection trap — `GetAllTypeNoTypeField` strips `type`, and a document saved back without it disappears from every type query |
| `cleanup()` deletes nothing | upstream's `deleteMany({meshid: {$nin: meshlist}})`, which deleted other tenants' devices and, with an empty `meshlist` after a read error, everything |
| `removeInactiveDevices` stays in its domain | the hourly maintenance pass reading device groups of other tenants out of the shared boot cache and deleting their devices |
| cross-tenant writes are blocked, own-domain writes pass | any missing domain check upstream of `Set`/`SetUser`/`Remove` reaching another tenant's documents |
| the write guard can be disabled | that `OPENFRAME_CROSS_TENANT_WRITES=allow` still works as a rollback switch |
| server stats are read per tenant | the "My Server" timeline showing the summed load of the whole fleet |
| config files are per tenant, with a legacy fallback | every pod overwriting the same `cfile/<name>` row, which gave all tenants identical server certificates — and therefore the identical ServerID agents pin |
| `deriveTenantDomain` picks the tenant | the domain resolution the rest depends on, including that a legacy single-domain install stays unscoped |

## What is not covered here

- Anything above the database layer: `getpluginpermissionlist` and `changeuserpass` are WebSocket
  commands and need a running server plus an authenticated session. They were verified manually
  against a two-domain database; a WS-level suite would be the next step.
- The gateway command allowlist, which lives in `openframe-oss-lib` and has its own unit tests.
- Agent connectivity, and the certificate sync (`autoSyncConfigFiles`) against real certificates.
