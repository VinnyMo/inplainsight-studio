# Threat model and limitations

Status: experimental prototype, not independently security-audited.

## Intended protection

An attacker with only a supported encrypted carrier should need the password to recover file content or encrypted filename. libsodium secretstream authenticates encrypted metadata/content, ordering, finalization, and the versioned header/framing as associated data. Random per-file salt and stream header ensure independent encryption. Argon2id imposes a fixed memory/time cost on password guesses. It cannot protect a weak password from offline guessing.

Parsers reject oversized files/dimensions, unsupported PNG profiles, excess decompressed data, invalid CRC, malformed framing, noncanonical padding, extra/truncated frames, and missing final tags. Error messages do not distinguish bad passwords from valid-profile authentication failures.

## Output and process boundaries

The entire envelope authenticates before the recovery save dialog opens or plaintext output begins. The encrypted filename becomes a sanitized basename suggestion only; the user chooses the destination. PNG holds authenticated plaintext in worker memory while the chooser is open. Audio recovery verifies a ciphertext spool first, then performs a second authenticated pass into staging and checks final length/name/hash before publication. Best-effort buffer clearing does not guarantee erasure of JavaScript/OS copies.

Owned stages use exclusive creation and restrictive modes where supported; Windows access follows inherited ACLs. Final publication uses a same-filesystem exclusive hard link, never replacing an existing file or symlink. Unsupported filesystems fail rather than falling back to overwrite. Normal cancellation/failure cleans owned stages; cancellation can create temporary staging before cleanup. A crash or power loss may leave encrypted or authenticated-plaintext stages requiring manual cleanup. No original file is deleted. This is not secure deletion, and storage snapshots/backups can retain plaintext.

FLAC invokes a separately installed native FFmpeg with a narrow codec profile, protocol allowlist, byte/sample/time bounds and tracked-child cleanup. These checks do not constitute a native-process sandbox, hard RSS cap, fuzzing result or independent security audit. PNG and WAV do not depend on FFmpeg. Keep original exported files; conversion compatibility is not generally verified. See WAV.md and FLAC.md for precise resource and publication limits.

The renderer is sandboxed, context-isolated, has no Node access, and uses a narrow preload bridge. Main retains input/output paths from native dialogs. No network is required at runtime. Background workers keep KDF/PNG work off the UI thread. Native dialogs still rely on the user's OS and filesystem security.

## Outside the threat model

- Malware, compromised OS/runtime/dependencies, screen capture, keyloggers, or a hostile logged-in user
- Guaranteed erasure of passwords/plaintext from JavaScript strings, GC copies, WASM, swap, hibernation, crash dumps, or SSDs
- Hiding the presence of encryption or exact transport-resistant steganography
- Lossy transforms, resizing, screenshots, online-service image rewriting, or lost passwords
- Denial of service beyond bounded input/KDF resources, including repeated attempts
- Robust cross-version migration, side-channel audit, signing/notarization, secure auto-update, and production deployment

Buffers/keys are cleared where practical, including manually allocated libsodium wrapper state. The state-disposal adapter uses pinned wrapper internals and must be reviewed with every dependency upgrade. Memory hygiene is best effort, not a guarantee.

There is no recipient key exchange, ML-KEM layer, recovery escrow, remote revocation, expiry, or server. Classical authenticated encryption is used without a sweeping post-quantum guarantee.

## Before production

Independent format/cryptography review; fuzz PNG/envelope/IPC parsers; instrument memory and resource ceilings; verify native Windows/macOS/Linux file permissions and sandboxing; test hard-link publication on target filesystems; audit dependencies; design packaging/signing/update processes; verify disaster recovery and backups; stabilize and version the format.

Primary design references: [libsodium secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream), [libsodium password hashing](https://doc.libsodium.org/password_hashing), [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).

## Carrier appearance

Plain v1 and all three Glitch v2 profiles carry the same authenticated envelope in RGB channels. Current Glitch/profile 3 (and legacy profile 2) devotes the high four channel bits to canonical artwork and the low four to ciphertext symbols. Its remaining low nibbles are validated public grain; its 768-row minimum creates substantial padding for small inputs. Legacy profile 1 retains its high-two/low-six packing and zero-padding rules. The public SHA-256 checksum and styling are not authentication, secrecy or error correction. All carriers expose approximate size and encryption use and require an unchanged original PNG. The 36 MiB file and 11,206,656-pixel pre-inflation ceilings bound parsing, while whole-file buffers can consume substantially more RAM; this remains a small-file prototype.
