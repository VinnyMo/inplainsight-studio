# Threat model and limitations

Status: experimental prototype, not independently security-audited.

## Intended protection

An attacker with only the PNG should need the password to recover file content or encrypted filename. libsodium secretstream authenticates encrypted metadata/content, ordering, finalization, and the versioned header/framing as associated data. Random per-file salt and stream header ensure independent encryption. Argon2id imposes a fixed memory/time cost on password guesses. It cannot protect a weak password from offline guessing.

Parsers reject oversized files/dimensions, unsupported PNG profiles, excess decompressed data, invalid CRC, malformed framing, noncanonical padding, extra/truncated frames, and missing final tags. Error messages do not distinguish bad passwords from valid-profile authentication failures.

## Output and process boundaries

All plaintext is authenticated and validated before the recovery save dialog opens or output begins. The original encrypted filename becomes a sanitized basename suggestion only; the user chooses the destination. Plaintext stays in worker memory while the dialog is open, and is cleared best-effort on cancellation or failure. Cancellation creates no temporary output. Output is staged with mode 0600 in a new private directory beside the selected destination, fsynced, and published using an exclusive hard link. Existing files/symlinks are never overwritten. On unsupported filesystems, publication fails rather than falling back to unsafe overwrite. No original file is deleted. Disk-full/crash cleanup is best effort; a process crash may leave a private temporary plaintext file requiring manual cleanup. This is not secure deletion, and storage snapshots/backups can retain plaintext.

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

Plain v1 and Glitch v2 carry the same authenticated envelope in visible RGB channels. Glitch devotes the top two channel bits to canonical artwork and the lower six to ciphertext symbols, with a public SHA-256 corruption check. The checksum and styling are not authentication, secrecy or error correction. The 256-row minimum produces decorative padding for small inputs. Both carriers expose approximate size and encryption use and require an unchanged original PNG.
