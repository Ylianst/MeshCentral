# Development Documentation

Welcome to the MeshCentral development documentation. This section covers everything you need to contribute to, extend, and run MeshCentral in a development environment.

---

## Overview

MeshCentral is a Node.js application using Express as its HTTP framework. The codebase is organized into:

- **Server-side modules** — Express web server, database abstraction, agent handler, relay, AMT management, certificate operations, and plugin system
- **Client-side assets** — noVNC (RFB/VNC), Xterm.js terminal, RDP virtual channels, Bootstrap UI, and custom JavaScript components
- **Agent runtime** — MeshCore.js and companion modules that run on managed devices

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Environment Setup](setup/environment.md) | IDE configuration, development tools, and editor extensions |
| [Local Development](setup/local-development.md) | Cloning, running locally, debugging |
| [Architecture Overview](architecture/README.md) | System design, component map, data flow |
| [Security Guidelines](security/README.md) | Authentication, encryption, secrets management |
| [Testing Guide](testing/README.md) | Running tests, test structure, coverage |
| [Contributing Guidelines](contributing/guidelines.md) | Code style, PR process, commit conventions |

---

## Technology Stack

MeshCentral uses the following core technologies:

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 16+ |
| HTTP Framework | Express 4.x |
| WebSockets | `ws` (server), `express-ws` (integration) |
| Template Engine | Express Handlebars |
| Default Database | NeDB (`@seald-io/nedb`) |
| Cryptography | `node-forge`, `otplib`, native `crypto` module |
| Remote Desktop (browser) | noVNC (RFB protocol, custom fork) |
| Terminal (browser) | Xterm.js |
| UI Framework | Bootstrap (bundled) |
| Body Parsing | `body-parser`, `multiparty` |
| Compression | `compression` (gzip middleware) |
| Session Management | `cookie-session` |

---

## Quick Navigation

**New to the codebase?** Start here:

1. Read the [Architecture Overview](architecture/README.md) to understand the system design
2. Set up your [Development Environment](setup/environment.md)
3. Follow the [Local Development Guide](setup/local-development.md) to run the server locally
4. Review [Security Guidelines](security/README.md) before making changes
5. Check the [Contributing Guidelines](contributing/guidelines.md) before submitting a PR

---

## Repository Structure

```text
meshcentral/
├── meshcentral.js           ← Main server entry point
├── webserver.js             ← Express HTTP/HTTPS server
├── meshagent.js             ← Agent WebSocket handler
├── meshrelay.js             ← Client-device relay sessions
├── db.js                    ← Database abstraction layer
├── amtmanager.js            ← Intel AMT device manager
├── webauthn.js              ← FIDO2/WebAuthn module
├── letsencrypt.js           ← ACME/Let's Encrypt integration
├── certoperations.js        ← TLS/AMT certificate operations
├── package.json             ← Dependencies and entry point
├── agents/                  ← Agent-side runtime modules
│   ├── meshcore.js          ← Primary agent core
│   ├── meshcmd.js           ← MeshCMD command-line tool
│   └── modules_meshcore/    ← Agent extension modules
├── amt/                     ← Intel AMT protocol modules
├── rdp/                     ← RDP protocol implementation
├── public/                  ← Browser-side assets
│   ├── novnc/               ← noVNC (RFB/VNC client)
│   ├── scripts/             ← Bundled JS libraries
│   └── mstsc/               ← Microsoft RDP client assets
├── plugins/                 ← Plugin system and OpenFrame plugin
├── views/                   ← Handlebars templates
└── translate/               ← i18n localization engine
```

---

## Community

Development questions and discussions happen in the OpenMSP Slack community:

- **OpenMSP Community:** [https://www.openmsp.ai/](https://www.openmsp.ai/)
- **Join Slack:** [https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)
- **GitHub:** [https://github.com/flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral)
