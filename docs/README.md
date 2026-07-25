# MeshCentral Documentation

Welcome to the documentation for **MeshCentral** — an open-source, web-based remote device management platform, enhanced with [OpenFrame](https://openframe.ai) multi-tenant support and AI-driven MSP automation by [Flamingo](https://flamingo.run).

---

## 📚 Table of Contents

- [Getting Started](#-getting-started)
- [Development](#-development)
- [Reference Architecture](#-reference-architecture)
- [Architecture Diagrams](#-architecture-diagrams)
- [Quick Links](#-quick-links)

---

## 🚀 Getting Started

New to MeshCentral? Start here:

- [Introduction](./getting-started/introduction.md) — What MeshCentral is, key features, and the OpenFrame integration
- [Prerequisites](./getting-started/prerequisites.md) — System requirements, supported OS, ports, and database options
- [Quick Start Guide](./getting-started/quick-start.md) — Install and launch MeshCentral in under 5 minutes
- [First Steps](./getting-started/first-steps.md) — Configure your server, enroll devices, and explore core features

---

## 🛠 Development

Resources for contributors and developers extending MeshCentral:

- [Development Overview](./development/README.md) — Technology stack, repository structure, and documentation index
- [Environment Setup](./development/setup/environment.md) — IDE configuration, VS Code settings, and debug launch config
- [Local Development Guide](./development/setup/local-development.md) — Clone, install, run locally, debug, and nodemon workflow
- [Architecture Overview](./development/architecture/README.md) — System design, component map, agent communication flow, and design decisions
- [Security Guidelines](./development/security/README.md) — TLS, MFA, ACL bitmasks, crypto, secrets management, and security checklist
- [Testing Guide](./development/testing/README.md) — Running the diagnostic test suite, writing new tests, integration testing
- [Contributing Guidelines](./development/contributing/guidelines.md) — Code style, branch naming, commit format, PR process, and review checklist

---

## 📖 Reference Architecture

Auto-generated technical reference documentation for all major subsystems:

### Remote Desktop Stack
- [RFB and Display](./reference/architecture/rfb-and-display/rfb-and-display.md) — noVNC RFB protocol engine and HTML5 Canvas renderer
- [Decoders](./reference/architecture/decoders/decoders.md) — Framebuffer decoding (Raw, Tight, ZRLE, JPEG, Hextile, etc.)
- [Compression](./reference/architecture/compression/compression.md) — Zlib deflate/inflate via pako
- [Crypto Components](./reference/architecture/crypto-components/crypto-components.md) — AES-EAX, DES, RSA, Diffie-Hellman, LegacyCrypto
- [Input Handlers](./reference/architecture/input-handlers/input-handlers.md) — Keyboard normalization and gesture handling
- [Websock](./reference/architecture/websock/websock.md) — Buffered WebSocket abstraction layer
- [Utility](./reference/architecture/utility/utility.md) — Cursor management and event abstraction

### Terminal Stack
- [Xterm](./reference/architecture/xterm/xterm.md) — Xterm.js terminal engine (ANSI/VT100, addons, rendering)
- [Xterm Addon Image](./reference/architecture/xterm-addon-image/xterm-addon-image.md) — Inline image rendering (SIXEL, OSC 1337)

### UI Layer
- [Bootstrap Components](./reference/architecture/bootstrap-components/bootstrap-components.md) — Modal, Dropdown, Tooltip, Tabs, and UI primitives
- [UI Components](./reference/architecture/ui-components/ui-components.md) — ModernCard, ModernModal, IconUploadComponent
- [Charts](./reference/architecture/charts/charts.md) — Dashboard and analytics charting
- [Marked](./reference/architecture/marked/marked.md) — Markdown rendering pipeline
- [Localization](./reference/architecture/localization/localization.md) — i18n DOM translation engine

### RDP Protocol
- [Cliprdr](./reference/architecture/cliprdr/cliprdr.md) — RDP clipboard virtual channel (format negotiation, PDU handling)

---

## 🗂 Architecture Diagrams

Visual Mermaid diagrams for all subsystems are available in:

```text
docs/diagrams/architecture/
```

Key diagrams include:

- `docs/diagrams/architecture/README.mmd` — Top-level architecture overview
- `docs/diagrams/architecture/xterm.mmd` — Xterm terminal architecture
- `docs/diagrams/architecture/rfb-and-display.mmd` — RFB and display pipeline
- `docs/diagrams/architecture/charts.mmd` — Charts module structure
- `docs/diagrams/architecture/crypto-components.mmd` — Crypto layer
- `docs/diagrams/architecture/websock.mmd` — WebSocket abstraction
- `docs/diagrams/architecture/cliprdr.mmd` — RDP clipboard virtual channel
- `docs/diagrams/architecture/bootstrap-components.mmd` — Bootstrap UI components
- `docs/diagrams/architecture/decoders.mmd` — Framebuffer decoder pipeline
- `docs/diagrams/architecture/compression.mmd` — Compression module
- `docs/diagrams/architecture/localization.mmd` — Localization system
- `docs/diagrams/architecture/input-handlers.mmd` — Input handling layer

---

## 🔗 Quick Links

- [Project README](../README.md) — Main project overview and quick start
- [Contributing Guidelines](../CONTRIBUTING.md) — How to contribute
- [OpenMSP Community (Slack)](https://www.openmsp.ai/) — Questions, discussions, and support
- [Join Slack](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA) — Community invite link
- [Flamingo Platform](https://flamingo.run) — AI-powered MSP platform
- [OpenFrame](https://openframe.ai) — Unified AI-driven MSP interface
- [GitHub Repository](https://github.com/flamingo-stack/meshcentral) — Source code

---

*Documentation generated by [🦩 Flamingo AI Technical Writer](https://flamingo.run)*
