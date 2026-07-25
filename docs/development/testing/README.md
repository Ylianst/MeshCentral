# Testing Guide

This guide covers the test infrastructure available in MeshCentral and how to write, run, and extend tests.

---

## Testing Overview

MeshCentral's primary test infrastructure is built around a standalone diagnostic test suite (`agents/testsuite.js`) that validates core utility functions, SHA256 hashing, and filesystem operations. The project uses a direct Node.js execution model rather than an integrated test framework like Jest or Mocha.

---

## Test Structure

```text
meshcentral/
├── agents/
│   └── testsuite.js       ← Primary diagnostic test suite
└── meshcentral.js          ← Integration testing (manual)
```

### The Test Suite (`agents/testsuite.js`)

The test suite is a standalone script that runs a series of numbered test cases:

| Test | What It Validates |
|------|-----------------|
| **Test 1** | SHA256 hashing via `SHA256Stream` — verifies hash of `"bob"` equals expected hex digest |
| **Test 2** (commented out) | `SimpleDataStore` database round-trip with SHA256 keying and compaction |
| **Test 3** | Filesystem operations: `mkdirSync`, `renameSync`, `unlinkSync` |

**Core utility functions tested:**

| Function | Purpose |
|----------|---------|
| `toNumberIfNumber(x)` | Converts numeric strings to integers |
| `char2hex(i)` / `rstr2hex(input)` | Decimal/raw string to hex conversion |
| `hex2rstr(d)` | Hex string to raw string |
| `buf2rstr(buf)` | Buffer to raw string |
| `objToString(x, p, ret)` | Recursive object serialization |
| `splitArgs(str)` / `parseArgs(argv)` | CLI argument parsing |
| `parseUrl(url)` | URL string to structured options object |

---

## Running Tests

### Run the Diagnostic Test Suite

```bash
node agents/testsuite.js
```

> **Note:** The test suite calls `process.exit(2)` after all tests complete. Exit code `2` is expected and indicates the suite ran to completion. A non-`2` exit code (e.g., `1`) indicates a test failure.

### Example Output

```text
Test 1: SHA256...PASS
Test 3: Filesystem...PASS
```

---

## Writing New Tests

Since MeshCentral does not use a formal test framework, new tests follow the established pattern in `testsuite.js`.

### Adding a Test Case

Open `agents/testsuite.js` and add a numbered test block:

```javascript
// Test 4 - Validate URL parser
var parsedUrl = parseUrl('wss://mesh.example.com:4433/control');
if (parsedUrl.hostname !== 'mesh.example.com') {
    console.log('Test 4 FAILED: hostname mismatch');
    process.exit(1);
}
if (parsedUrl.port !== 4433) {
    console.log('Test 4 FAILED: port mismatch');
    process.exit(1);
}
console.log('Test 4: URL parser...PASS');
```

### Test Writing Conventions

- Use a sequential test number for each new test case
- Log `"Test N: Description...PASS"` on success
- Call `process.exit(1)` immediately on failure with a descriptive message
- Each test should be self-contained and not depend on prior test state
- Clean up any temporary files or directories created during a test

### Testing Cryptographic Functions

For testing crypto components (used in RFB/VNC sessions), use Node's built-in `crypto` module:

```javascript
// Verify SHA384 hash of a known input
const crypto = require('crypto');
const hash = crypto.createHash('sha384').update('test-input').digest('hex');
const expected = 'your-known-hash-value';
if (hash !== expected) {
    console.log('Crypto test FAILED');
    process.exit(1);
}
console.log('Crypto hash test...PASS');
```

---

## Integration Testing (Manual)

For integration testing of the full server, MeshCentral requires a running server instance. The recommended approach for manual integration testing:

### Step 1: Start the Server in Debug Mode

```bash
node meshcentral.js --port 8443 --redirport 8080 --debug 3
```

### Step 2: Verify Key Endpoints

Use `curl` or a REST client to verify server health:

```bash
# Check HTTPS redirect
curl -v http://localhost:8080/

# Check main interface (skip TLS verification for dev)
curl -k https://localhost:8443/

# Check agent endpoint
curl -k https://localhost:8443/meshagents

# Check OpenFrame plugin endpoints
curl -k "https://localhost:8443/generate-msh?host=https://mesh.example.com"
curl -k "https://localhost:8443/api/deviceStatus?id=node/domain/nodeid"
```

### Step 3: Test Agent Connectivity

1. Download an agent installer from the web UI
2. Run the agent on a test device or VM
3. Verify the device appears in the dashboard
4. Test remote desktop, terminal, and file access

---

## Testing Specific Subsystems

### Database Layer

Test different database backends by setting the backend in `config.json`:

```json
{
  "settings": {
    "mongodb": "mongodb://localhost:27017/meshcentral"
  }
}
```

Then start the server and verify:

```bash
node meshcentral.js --port 8443 --redirport 8080
# Watch for: "Database: MongoDB"
```

### WebAuthn / FIDO2

WebAuthn requires a browser with hardware key access. Manual test flow:

1. Log in to the web UI
2. Go to **My Account** → **Two-Factor Authentication** → **Security Key**
3. Register a hardware key
4. Log out and log back in with the hardware key

### Let's Encrypt / ACME

Test ACME in staging mode (does not issue trusted certificates, avoids rate limits):

```json
{
  "letsencrypt": {
    "email": "test@yourdomain.com",
    "production": false,
    "names": ["mesh.yourdomain.com"]
  }
}
```

---

## Test Coverage Areas

The following areas should be covered by any new feature's tests:

| Area | What to Test |
|------|-------------|
| Utility functions | Edge cases: empty strings, null, undefined, oversized input |
| URL parsing | Valid URLs, URLs without ports, WebSocket schemes (`wss://`) |
| Argument parsing | Quoted strings, numeric conversion, missing values |
| File operations | Create, rename, delete; cleanup on failure |
| Crypto hashing | Known SHA256/SHA384 vectors |
| Database ops | CRUD operations, schema version checks |
| Agent commands | Command routing, binary protocol frames |
| Access control | Bitmask checks for all rights constants |

---

## Continuous Testing

MeshCentral does not currently have a CI/CD pipeline with automated test runs configured in this repository. To run tests as part of a local development workflow:

```bash
# Run the diagnostic suite before any commit
node agents/testsuite.js
echo "Exit code: $?"
# Expected: Exit code: 2 (test suite completed)
```

> Consider integrating this into a pre-commit hook:

```bash
# .git/hooks/pre-commit
#!/bin/bash
node agents/testsuite.js
EXIT=$?
if [ $EXIT -ne 2 ]; then
  echo "Test suite failed with exit code $EXIT"
  exit 1
fi
exit 0
```

---

## Community

Questions about testing approach or contributing new tests? Reach out on the OpenMSP Slack:

- [https://www.openmsp.ai/](https://www.openmsp.ai/)
- [Join Slack](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)
