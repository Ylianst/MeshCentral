# Development Environment Setup

This guide covers setting up a productive development environment for working on MeshCentral.

---

## Required Tools

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Node.js | 16.0.0+ | [nodejs.org](https://nodejs.org/) |
| npm | 8.0.0+ | Bundled with Node.js |
| Git | 2.x+ | [git-scm.com](https://git-scm.com/) |

### Install Node.js (Recommended: via nvm)

Using **nvm** (Node Version Manager) is the recommended approach for managing Node.js versions on Linux/macOS:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js LTS
nvm install --lts
nvm use --lts

# Verify
node --version
npm --version
```

On **Windows**, use [nvm-windows](https://github.com/coreybutler/nvm-windows) or download the installer from [nodejs.org](https://nodejs.org/).

---

## Recommended IDE: Visual Studio Code

VS Code is the recommended editor for MeshCentral development due to strong Node.js support and the ecosystem of JavaScript extensions.

**Download:** [code.visualstudio.com](https://code.visualstudio.com/)

### Recommended Extensions

Install these extensions for the best experience:

| Extension | ID | Purpose |
|-----------|-----|---------|
| ESLint | `dbaeumer.vscode-eslint` | JavaScript linting |
| Prettier | `esbenp.prettier-vscode` | Code formatting |
| GitLens | `eamodio.gitlens` | Enhanced Git history |
| REST Client | `humao.rest-client` | Test HTTP/REST endpoints |
| Node.js Extension Pack | `waderyan.nodejs-extension-pack` | Node.js tooling bundle |
| Handlebars | `andrejunges.handlebars` | Template file syntax highlighting |
| DotENV | `mikestead.dotenv` | `.env` file support |

**Install all extensions at once:**

```bash
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension eamodio.gitlens
code --install-extension humao.rest-client
code --install-extension andrejunges.handlebars
code --install-extension mikestead.dotenv
```

---

## VS Code Workspace Settings

Create `.vscode/settings.json` in the repository root:

```json
{
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.formatOnSave": false,
  "files.eol": "\n",
  "files.encoding": "utf8",
  "javascript.suggest.autoImports": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[javascript]": {
    "editor.formatOnSave": false
  },
  "eslint.enable": true
}
```

---

## VS Code Debug Configuration

Create `.vscode/launch.json` to enable debug launches:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch MeshCentral",
      "program": "${workspaceFolder}/meshcentral.js",
      "args": [],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch MeshCentral (debug)",
      "program": "${workspaceFolder}/meshcentral.js",
      "args": ["--debug=1"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

Press **F5** in VS Code to start MeshCentral with the debugger attached.

---

## Alternative IDEs

### JetBrains WebStorm

WebStorm has excellent Node.js support out of the box:

1. Open the project directory
2. Go to **Preferences → Languages & Frameworks → Node.js**
3. Set the Node.js interpreter to your installed version
4. Run configurations are auto-detected from `package.json`

### Neovim / Vim

For terminal-based development, install:

```bash
# Node.js LSP support via nvim-lspconfig
# Uses typescript-language-server or vscode-js-debug

npm install -g typescript typescript-language-server
```

---

## Environment Variables for Development

Create a `.env` file at the repository root for local overrides (do **not** commit this file):

```bash
# Development environment variables

# Port overrides (avoids needing root for ports <1024)
MESHCENTRAL_PORT=8443
MESHCENTRAL_REDIRPORT=8080

# OpenFrame plugin settings
MESH_DIR=/opt/mesh
MESH_DEVICE_GROUP=dev-group

# Debug output level (0-5)
# Pass via CLI: node meshcentral.js --debug=3
```

> **Note:** MeshCentral reads environment variables prefixed with `MESHCENTRAL_` automatically and maps them to their corresponding CLI argument names (e.g., `MESHCENTRAL_PORT` sets `--port`).

---

## Running Without Root on Linux

MeshCentral defaults to ports 443 and 80, which require root privileges on Linux. For development, use higher ports:

```bash
# Using environment variables
MESHCENTRAL_PORT=8443 MESHCENTRAL_REDIRPORT=8080 node meshcentral.js

# Or pass as CLI arguments
node meshcentral.js --port 8443 --redirport 8080
```

Or grant Node.js the capability to bind low ports without root:

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

---

## Checking Your Setup

After completing the environment setup, verify everything works:

```bash
# In the cloned repository directory
node --version   # Should print v16.0.0 or higher
npm --version    # Should print 8.x or higher
npm install      # Should complete without errors
node meshcentral.js --help   # Should print MeshCentral usage info
```

Now continue to the [Local Development Guide](local-development.md) to run MeshCentral locally.
