# Security Policy

## Supported versions

Security fixes are made on `main` and released in the next version. Only the latest release
receives fixes.

| Version | Supported |
|---|---|
| 1.0.x (latest) | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not report security issues in public issues, discussions or pull requests.**

Use GitHub's private reporting instead: open the repository's **Security** tab and choose
**Report a vulnerability**. Include what you found, how to reproduce it, and the impact you
expect. We aim to acknowledge a report within a week and will keep you updated until it is
resolved. Credit is given in the release notes unless you prefer otherwise.

## Deployment model

Knowing the intended model helps decide what counts as a vulnerability.

- **Desktop mode (default)** binds the API to `127.0.0.1` and does not authenticate requests: the
  only client is the local user's own interface. The server refuses to start on a non-loopback
  address unless server mode is enabled. Do not expose a desktop-mode port to a network.
- **Server mode** (`AVS_MODE=server`) requires a bearer token on every request except
  `GET /api/health`. Tokens carry scopes (`read`, `produce`, `publish`, `admin`), are stored as
  SHA-256 hashes and are minted only on the machine (`npm run token`). The API has no rate
  limiting; put it behind a VPN or a TLS-terminating reverse proxy rather than on the open
  internet. See [`docs/deploy/README.md`](docs/deploy/README.md).
- **Provider keys** (LLM, TTS, publishing) are stored in the local database inside the data
  directory and are masked in every API response. Protect that directory as you would any
  credential store.
- **Generated scene code** is produced by an LLM and executed in headless Chrome. It is linted before
  it runs, but treat model output as untrusted input when extending the renderer.

In scope: authentication or scope bypass in server mode, path traversal outside `data/` and the
registered channel folders, secret disclosure through the API, and code execution through crafted
input. Out of scope: issues that require an attacker who already controls the local machine or the
data directory.
