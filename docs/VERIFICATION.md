# Prototype verification

Checked 2026-10-02 in the Linux development executor.

## Passed

- Automated core/adversarial tests: empty/binary/chunk boundaries; randomized encryption; wrong password; modified headers/ciphertext; truncation/reordering/duplication; authenticated malformed metadata, lengths, tags, finalization and trailing frames
- PNG dimensions/CRC/padding, IDAT flood, excess inflation, compressed trailing bytes
- No output after failed authentication; exclusive file/symlink protection; injected write/fsync failure cleanup
- WASM secretstream state zero-before-free and duplicate decrypted buffer cleanup
- Automatic export round-trip verification, including deliberately corrupted generated PNG refusal before output publication
- Separate full 16 MiB random data round-trip (16,793,413-byte PNG)
- Mocked-DOM renderer interaction tests (validation, busy/repeated submit, cancellation, mode/keyboard flow, password clearing, errors, text-only filename rendering); real worker integration round trip/auth failure/no-overwrite tests
- JavaScript syntax checks and whitespace diff check
- Dependency npm audit: zero reported advisories at check time (not a security audit)
- Independent second-agent code review of core and IPC boundaries; this is not an external security audit

## Not verified

- Native Linux GUI end-to-end: runtime installed, but shell executor has no X server/$DISPLAY; Electron exits at platform initialization. No sandbox bypass attempted
- Visual browser preview: Chromium launch blocked by executor socket restrictions; cloud browser disallows file:// URLs. No visual QA pass is claimed
- Windows/macOS GUI, installation, packaging or signing/notarization
- Native Ubuntu .deb installation, kernel AppArmor profile loading and real desktop launch (the package and its extracted payload have separate automated checks; see INSTALL-UBUNTU.md)
- Production resource profiling, fuzzing, side-channel analysis, secure erase, or adversarial external audit

A cross-platform GitHub Actions core/syntax test matrix is included; check the exact PR commit's CI before treating it as passed. These are source tests, not native desktop UI certification. The Ubuntu installer workflow builds a private experimental artifact. No signed releases or production certification are implied.
