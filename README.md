# InPlainSight Studio

Experimental, offline file-to-PNG/WAV/FLAC encryption and recovery desktop prototype. **Not security-audited. Do not trust this early prototype as your only copy of important files.**

A file and password become a self-contained PNG or lossless audio carrier. Encrypted bytes live in PNG pixels or audio samples, with no database, account, server or required sidecar. PNG offers Plain noise or reversible Glitch artwork. WAV and FLAC contain noise audio and are never played automatically. These are encrypted containers, not covert steganography.

The current development checkpoint adds editable output filenames, Glitch profile 3, a source-first format chooser, streaming WAV/FLAC recovery and clearer capacity summaries. See [development status and release gates](docs/DEVELOPMENT-STATUS.md). This source checkpoint is **not a new release**.

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

Choose **Encrypt a file**, select a source, then select PNG, WAV or available FLAC. Set a password and optional output filename before choosing a new destination. Recovery identifies the carrier from its contents and authenticates it before asking where to save the recovered file. Existing files are never overwritten. Filenames are sanitized; explicit recovery names may retain a user-selected extension.

FLAC in this development build requires a separately installed FFmpeg with an s16 FLAC encoder, discovered through an absolute `IPS_FFMPEG` path or absolute PATH entries. PNG and WAV do not require FFmpeg. This is a temporary development dependency: **a release must include appropriate codec support and work without users installing FFmpeg**. Codec redistribution/licensing and platform packaging are not resolved; no binary is bundled here.

## Current boundaries

- Original files: **16 MiB maximum** for PNG, WAV and FLAC. Larger design budgets are targets, not supported capacity.
- Encoded input/output ceilings: PNG 36 MiB; WAV 33,587,244 bytes; FLAC 36 MiB.
- PNG still uses whole-file buffering. Plain v1 and Glitch transform profiles 1, 2 and 3 recover; new Glitch exports use profile 3. Fixed 1024-pixel RGB profile.
- WAV uses bounded streaming around the existing authenticated envelope; FLAC compresses and verifies that same PCM carrier. See [WAV](docs/WAV.md) and [FLAC](docs/FLAC.md).
- Audio cancellation is cooperative, with owned staging cleanup and exclusive verified publication. Abrupt power loss/forced kill can leave stages, including authenticated plaintext during recovery writing; no crash sweeper or secure-erasure claim.
- JPEG is unsupported. The [MP4 proof of concept](experimental/mp4-poc/README.md) is isolated CLI/test code, capped at 64 KiB original and absent from the GUI. Generated media is not committed.
- No cloud service, password reset, telemetry, account, expiry or remote revocation. No signed release, independent audit or production-security claim.

**Keep the exported file unchanged so it can be recovered.** Image edits, resizing or screenshots can prevent recovery. Audio exports contain noise: avoid high playback volume. Studio never plays audio. Recovery after conversion is not generally verified. Transfer original files and keep backups; a lost password cannot be reset.

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
