# InPlainSight Studio

Experimental, offline file-to-PNG encryption and recovery desktop prototype. **Not security-audited. Do not trust this early prototype as your only copy of important files.**

A file and password become a self-contained PNG. The actual encrypted bytes live in its RGB pixels. Recovery requires the original PNG and the password, not a database, account, server, sidecar, or expiry service. The PNG looks like noise: this is an encrypted image container, not covert steganography.

## Run from source

Requires Node.js 22+ and npm. Windows, macOS, and Linux are intended targets; native Windows/macOS packaging and signing are not yet verified.

```sh
npm ci
npm test
npm run check
npm start
```

On Linux, Electron needs a graphical desktop and its system libraries. Do not disable Electron's sandbox to work around a host setup problem. The app makes no network requests; installation downloads dependencies.

Choose **Create PNG**, pick a file, enter and confirm a strong password, and choose a new output filename. To recover, choose **Recover file**, select the generated PNG, provide the password, and select a new output filename. Original files are not deleted or overwritten. Recovery deliberately ignores the stored filename when choosing a destination.

## Current boundaries

- 16 MiB input file limit, 24 MiB encoded PNG input limit
- Whole-file buffering and bounded PNG decoding; not a large-file streaming implementation
- Fixed 1024-pixel-wide RGB PNG profile; arbitrary image formats and PNG editors are unsupported
- Any file type can be encrypted; video carrier encoding is a separate future discussion
- No cloud service, password reset, telemetry, account, expiration, or remote access revocation
- No releases, installers, code signing, independent security audit, or production-security claim

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
