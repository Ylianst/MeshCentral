# Prerequisites

Before installing and running MeshCentral, ensure your environment meets the following requirements.

---

## Required Software

| Software | Minimum Version | Notes |
|----------|----------------|-------|
| **Node.js** | 16.0.0+ | LTS releases recommended (18.x, 20.x, 22.x) |
| **npm** | Bundled with Node.js | Used for installing dependencies |
| **Git** | Any recent version | For cloning the repository |

> **Why Node.js 16+?** MeshCentral uses ES6 features, `async/await`, and WebSocket APIs that require Node.js 16 or later. The `package.json` `engines` field enforces this constraint.

---

## System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2+ cores |
| RAM | 512 MB | 1 GB+ |
| Disk | 1 GB free | 5 GB+ (for recordings and uploads) |
| OS | Linux, Windows, macOS | Linux (Ubuntu 20.04+ / Debian 11+) |
| Network | Outbound TCP/UDP | Open ports 80, 443, 4433 (AMT CIRA) |

### Supported Operating Systems

- **Linux:** Ubuntu 20.04+, Debian 11+, CentOS/RHEL 8+, Alpine Linux
- **Windows:** Windows Server 2016+, Windows 10+
- **macOS:** macOS 12+ (Monterey or later)

---

## Network Requirements

MeshCentral listens on several ports by default:

| Port | Protocol | Purpose |
|------|----------|---------|
| `443` | HTTPS/WSS | Main web interface and agent WebSocket connections |
| `80` | HTTP | Let's Encrypt HTTP-01 challenge redirect |
| `4433` | TLS | Intel AMT CIRA (Management Presence Server) |

> **Firewall:** Ensure port 443 is accessible from agent machines and port 80 is accessible if you plan to use Let's Encrypt for automatic TLS certificates.

---

## Optional Software

| Software | Purpose |
|----------|---------|
| **MongoDB** | Production-grade database (replaces default NeDB) |
| **PostgreSQL / MariaDB / MySQL** | Alternative relational database backends |
| **SQLite3** | Lightweight alternative to NeDB for small deployments |
| **OpenSSL** | For manual TLS certificate management |

---

## Database Backend Options

MeshCentral ships with **NeDB** as the default embedded database (no additional installation needed). For production deployments, you may configure:

| Backend | Package Required | Best For |
|---------|-----------------|---------|
| NeDB | None (bundled via `@seald-io/nedb`) | Development, small deployments |
| MongoDB | `mongodb` npm package | Production, large device fleets |
| MariaDB | `mariadb` npm package | Production, SQL preference |
| MySQL | `mysql2` npm package | Production, SQL preference |
| PostgreSQL | `pg` npm package | Production, enterprise SQL |
| SQLite | `better-sqlite3` or `sqlite3` npm package | Medium-scale deployments |
| AceBase | `acebase` npm package | Alternative NoSQL |

---

## Environment Variables

MeshCentral supports overriding configuration values via environment variables prefixed with `MESHCENTRAL_`:

| Variable | Description |
|----------|-------------|
| `MESHCENTRAL_PORT` | Override the HTTPS listening port |
| `MESHCENTRAL_REDIRPORT` | Override the HTTP redirect port |
| `MESHCENTRAL_SESSIONKEY` | Override the session encryption key |
| `MESHCENTRAL_MONGODBURL` | Override the MongoDB connection URL |

For the OpenFrame plugin specifically:

| Variable | Default | Description |
|----------|---------|-------------|
| `MESH_DIR` | `/opt/mesh` | Directory containing `mesh_id` and `mesh_server_id` files |
| `MESH_DEVICE_GROUP` | _(empty)_ | Device group name written into generated `.msh` files |

---

## Verification Commands

Run these commands to verify your environment is ready:

**Check Node.js version:**

```bash
node --version
# Expected: v16.0.0 or higher (e.g., v20.11.0)
```

**Check npm version:**

```bash
npm --version
# Expected: 8.0.0 or higher
```

**Check Git:**

```bash
git --version
# Expected: git version 2.x.x
```

**Verify port availability (Linux):**

```bash
ss -tlnp | grep -E '80|443|4433'
# Should return nothing if ports are free
```

**Verify port availability (Windows):**

```bash
netstat -an | findstr "80 443 4433"
```

---

## TLS Certificate Options

MeshCentral can manage TLS certificates in three ways:

| Method | Configuration | Best For |
|--------|-------------|---------|
| Self-signed (auto) | None required (default) | Development and internal use |
| Let's Encrypt (auto) | `letsencrypt` config block in `config.json` | Public-facing deployments |
| Custom certificate | `certificate` paths in `config.json` | Enterprise PKI environments |

> **For Let's Encrypt:** Port 80 must be publicly accessible for HTTP-01 challenge validation. The domain must have a valid public DNS record pointing to your server.

---

## What's Next?

Once your environment meets these requirements, proceed to the [Quick Start Guide](quick-start.md) to install and launch your MeshCentral server.
