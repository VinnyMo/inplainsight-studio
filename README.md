# InPlainSight Studio

Experimental, offline file-to-PNG encryption and recovery desktop prototype. **Not security-audited. Do not trust this early prototype as your only copy of important files.**

A file and password become a self-contained PNG. The actual encrypted bytes live in its RGB pixels. Recovery requires the original PNG and the password, not a database, account, server, sidecar, or expiry service. Choose Plain noise or colored Glitch bands: this is an encrypted image container, not covert steganography.

## Ubuntu installer

An experimental Ubuntu amd64 `.deb` bundles the app and Electron, with an applications-menu entry and normal package-manager removal. See [installing and testing on Ubuntu](docs/INSTALL-UBUNTU.md), including the app-specific AppArmor permission needed to keep Chromium sandboxing enabled. Native desktop installation/launch still needs hardware QA.

## Run from source

Requires Node.js 22+ and npm. Windows, macOS, and Linux are intended targets; native Windows/macOS packaging and signing are not yet verified.

```sh
npm ci
npm run setup:electron
npm test
npm run check
npm start
```

On Linux, Electron needs a graphical desktop and its system libraries. Do not disable Electron's sandbox to work around a host setup problem. The app makes no network requests; installation downloads dependencies.

Choose **Encrypt a file**, pick a file and a Plain or Glitch appearance, enter and confirm a strong password, and choose a new output filename. To recover, choose **Recover a file**, select the generated PNG, provide the password, and select a new output filename. Original files are not deleted or overwritten. After verifying the PNG and password, recovery suggests the original filename and extension. The suggestion is sanitized for safety; you can change the name and destination.

## Current boundaries

- 16 MiB input file limit, 24 MiB encoded PNG input limit
- Whole-file buffering and bounded PNG decoding; not a large-file streaming implementation
- Plain exports retain the v1 carrier; Glitch uses carrier v2 with about 33% more payload pixels and a 256-row minimum canvas. Recovery detects both automatically.
- Fixed 1024-pixel-wide RGB PNG profile; arbitrary image formats and PNG editors are unsupported
- Any file type can be encrypted; video carrier encoding is a separate future discussion
- No cloud service, password reset, telemetry, account, expiration, or remote access revocation
- No signed releases, independent security audit, or production-security claim

**Keep the PNG unchanged.** Resizing, screenshots, JPEG conversion, filters, or services that rewrite images may permanently destroy the data. Transfer it as an original file. Use a long unique passphrase; a lost password cannot be recovered. Keep backups of your original files.

## Security design

Pinned libsodium provides Argon2id password derivation and its authenticated XChaCha20-Poly1305 secretstream construction. The app does not invent cryptographic primitives or nonce management. File metadata is encrypted; version/profile/length and framing are authenticated. See [format specification](docs/FORMAT.md), [threat model](docs/SECURITY.md), and [verification status](docs/VERIFICATION.md).

No ML-KEM or recipient public-key mode is included. This prototype makes no claim of being “fully quantum-safe.”

## Development

```sh
npm test             # core + adversarial tests
npm run check        # JavaScript syntax checks
npm audit            # dependency advisory check (network required)
```

Source and tests are intentionally small enough to inspect. Production use needs independent cryptographic/application review, format stabilization, native platform QA, packaging, and secure release engineering.

No project license has been selected yet; no additional license grant is implied. Third-party dependencies retain their respective licenses.
