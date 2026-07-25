# Contributing to MeshCentral

Thank you for contributing to [flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral)! This guide covers code style conventions, the pull request process, commit message format, and the review checklist.

---

## Community First

All development discussion, questions, and coordination happen on the **OpenMSP Slack**, not GitHub Issues or Discussions.

- **OpenMSP Community:** [https://www.openmsp.ai/](https://www.openmsp.ai/)
- **Join Slack:** [https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)

Before starting work on a significant feature or bug fix, **discuss it on Slack first** to avoid duplicated effort and to align with the project roadmap.

---

## Getting Started

1. Fork the repository: [https://github.com/flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral)

2. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/meshcentral.git
cd meshcentral
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/flamingo-stack/meshcentral.git
```

4. Install dependencies:

```bash
npm install
```

5. Create a feature branch (see branch naming below)

---

## Branch Naming

Use the following naming conventions for branches:

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/short-description` | `feature/webauthn-passkeys` |
| Bug fix | `fix/short-description` | `fix/relay-session-timeout` |
| Refactor | `refactor/short-description` | `refactor/db-abstraction` |
| Documentation | `docs/short-description` | `docs/amt-setup-guide` |
| Security | `security/short-description` | `security/path-traversal-fix` |

**Rules:**
- Use lowercase letters and hyphens only (no underscores, no spaces)
- Keep descriptions short and meaningful (3–5 words)
- Never commit directly to `main`

---

## Code Style and Conventions

MeshCentral is written in vanilla JavaScript (Node.js, CommonJS modules). There is no transpilation step.

### General Rules

| Rule | Detail |
|------|--------|
| **Indentation** | 4 spaces (no tabs) |
| **Line endings** | LF (`\n`) — not CRLF |
| **Quotes** | Single quotes for strings |
| **Semicolons** | Always use semicolons |
| **`'use strict'`** | Required at the top of every module |
| **`var` vs `const`/`let`** | Use `const`/`let` for new code; `var` in existing modules for consistency |
| **Max line length** | 256 characters (matches existing codebase) |

### Module Pattern

Follow the factory function pattern used throughout the codebase:

```javascript
'use strict';

/**
 * @description Brief description of the module
 * @param {Object} parent - MeshCentral parent server object
 */
function CreateMyModule(parent) {
    const obj = {};

    obj.someMethod = function () {
        // Implementation
    };

    return obj;
}

module.exports = { CreateMyModule };
```

### File Headers

Add a JSDoc file header to new server-side modules:

```javascript
/**
 * @description What this module does
 * @author Your Name
 * @license Apache-2.0
 */
'use strict';
```

### Comments

- Use `//` for single-line comments
- Use `/* ... */` for block comments
- Document public functions and non-obvious logic
- Avoid comments that merely restate the code

---

## Commit Message Format

```text
type(scope): short summary in present tense

Optional body paragraph explaining the WHY, not the WHAT.
Wrap at 72 characters.

Optional footer:
Refs: #issue-number (if applicable)
```

### Commit Types

| Type | When to Use |
|------|------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `security` | Security fix |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only changes |
| `test` | Adding or updating tests |
| `chore` | Build system, dependency updates |
| `perf` | Performance improvement |

### Scope Examples

- `webserver` — Changes to `webserver.js`
- `meshagent` — Changes to `meshagent.js`
- `db` — Changes to `db.js`
- `rfb` — Changes to noVNC RFB stack
- `xterm` — Changes to Xterm terminal
- `plugin` — Changes to plugin system
- `amt` — Changes to Intel AMT modules
- `openframe` — Changes to OpenFrame plugin

### Examples

```text
feat(openframe): add deviceStatus endpoint with tenant isolation

fix(meshrelay): prevent relay session leak on abrupt disconnect

security(webserver): validate upload temp path against allowed roots

docs(webauthn): document replay attack counter validation
```

---

## Pull Request Process

### Before Submitting

1. Sync with upstream `main`:

```bash
git fetch upstream
git rebase upstream/main
```

2. Run the test suite:

```bash
node agents/testsuite.js
# Expected exit code: 2
```

3. Manually test your changes against a local running server:

```bash
node meshcentral.js --port 8443 --redirport 8080 --debug 2
```

4. Review your diff for unintended changes:

```bash
git diff upstream/main
```

### Submitting the PR

1. Push your branch:

```bash
git push origin feature/your-branch-name
```

2. Open a Pull Request at: [https://github.com/flamingo-stack/meshcentral/pulls](https://github.com/flamingo-stack/meshcentral/pulls)

3. Fill in the PR template:

```text
## Summary
Brief description of what this PR does.

## Changes
- List of specific changes made

## Testing
How was this tested? (manual, test suite, specific scenarios)

## Security Considerations
Any security implications? (new auth, file access, crypto, etc.)

## Related Discussion
Slack thread or discussion link (if applicable)
```

---

## Code Review Checklist

Ensure your PR passes all of the following before requesting review:

### Correctness
- [ ] Logic is correct and handles edge cases
- [ ] No regressions to existing functionality
- [ ] Error handling is present for all failure paths

### Security
- [ ] No hardcoded secrets, passwords, or API keys
- [ ] File path operations use safe path resolution
- [ ] Multi-tenant isolation enforced where applicable
- [ ] CORS headers explicitly set on new HTTP routes
- [ ] WebAuthn counter validated and updated after assertion
- [ ] User input validated before use in DB queries or filesystem ops

### Code Quality
- [ ] Follows 4-space indentation convention
- [ ] `'use strict'` present in all new `.js` files
- [ ] Factory function pattern used for new server modules
- [ ] No unnecessary `console.log()` left in production paths
- [ ] New public functions documented with comments

### Testing
- [ ] Diagnostic test suite passes (`node agents/testsuite.js` exits with code `2`)
- [ ] Manual testing completed against a running local server
- [ ] New functionality manually verified end-to-end

### Compatibility
- [ ] Compatible with Node.js 16+ (no Node.js 18+ exclusive APIs without fallback)
- [ ] No breaking changes to the `config.json` format without migration notes
- [ ] Plugin hooks not broken for existing plugins
- [ ] Database operations work with the default NeDB backend

---

## Running Tests

MeshCentral's primary test infrastructure is a standalone diagnostic suite:

```bash
node agents/testsuite.js
```

> **Note:** Exit code `2` is expected and indicates the suite ran to completion. A non-`2` exit code indicates a test failure.

For integration testing, run the server locally and verify endpoints manually:

```bash
node meshcentral.js --port 8443 --redirport 8080 --debug 3
```

---

## Plugin Development

If you are contributing a new plugin, follow the OpenFrame plugin (`plugins/openframe.js`) as a reference:

1. Place plugin files under `plugins/`
2. Use `hook_setupHttpHandlers` to register Express routes
3. Apply CORS headers to all responses
4. Implement tenant domain isolation using `deriveTenantDomain`
5. Return `404` (not `403`) for cross-tenant resource access

---

## Security Issues

Security issues should be reported via the OpenMSP Slack community rather than as GitHub Pull Requests or Issues.

- **OpenMSP Slack:** [https://www.openmsp.ai/](https://www.openmsp.ai/)
- **Join Slack:** [https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)

---

## License

MeshCentral is licensed under the **Apache-2.0** License. By contributing, you agree that your contributions will be licensed under the same license.

All new files must include the license header:

```javascript
/**
 * @description Module description here
 * @license Apache-2.0
 */
```

---

<div align="center">
  Built with 💛 by the <a href="https://www.flamingo.run/about"><b>Flamingo</b></a> team
</div>
