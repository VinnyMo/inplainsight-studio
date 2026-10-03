# Prototype verification

Baseline checked 2026-10-03 in the Linux development executor; Windows follow-up below.

## Current Windows audio/source-first checkpoint (2026-10-03)

- Full sequential suite: 63 tests, 61 passed, 0 failed, 2 existing platform skips (Linux packaging and unavailable Windows file-symlink privilege), 86.10 seconds. Syntax checks passed before publication preparation.
- Tests cover PNG legacy/max-size compatibility, WAV envelope interoperability and full 16 MiB recovery, FLAC full 16 MiB recovery, wrong password, malformed/truncated/corrupt carriers, mandatory FINAL, size bounds, names/no-overwrite, native-dialog handlers with real workers, cancellation/child shutdown, injected publication failure and cleanup.
- Installed FFmpeg 9.0 identified/decoded FLAC and WAV as 48 kHz mono 16-bit audio. No audio was played. FLAC tests skip when its optional encoder dependency is unavailable; such skips do not establish FLAC support on that host.
- For an 8 MiB synthetic source: WAV 16,782,864 bytes; FLAC 8,956,230 bytes (46.6% smaller), byte-exact recovery. FLAC export plus verification 1.038 s; recovery 0.713 s. Node peak RSS 145.9 MiB excludes FFmpeg and full Electron. These are bounded fixture measurements, not a large-file or hard memory guarantee.
- Hidden Electron DOM/layout checks cover PNG/WAV/FLAC choice, revised estimate/duration/limit/warning order, missing-dependency/unsupported/oversize explanations, appearance, recovery and 200% zoom. Startup fits a 1044x821 viewport; populated content scrolls, with controls/footer reachable. Physical keyboard/touch, screen-reader output and native dialogs still need user QA; hidden focus handlers were dispatched explicitly.
- PNG core/artwork, WAV carrier, streaming envelope and startup bounds remained unchanged during FLAC integration. The isolated MP4 evidence and remaining limitations are recorded under experimental/mp4-poc; generated binaries are excluded.

## Earlier Windows follow-up: profile 3 and compact startup (2026-10-03)

- Native Windows Node 24.15.0 suite, sequential: 42 passed, 0 failed, 2 skipped (44 total), approximately 74 seconds. Skips: Linux packaging and file symlink creation requiring unavailable privilege. Syntax checks passed.
- New profile-3 tests cover independent nibble extraction, canonical boundaries, header/artwork/padding tampering, authenticated rewrap rejection, legacy recovery, deterministic golden pixels, bounded varied compositions and repeated-encryption variation. Full-size Plain/current Glitch round trips remain covered.
- Compared pre-change source against current source: byte-identical Plain/profile-1/profile-2 PNGs at 96/97/98/600,000-byte envelope sizes; new reader recovered all 12 baseline files. Older readers intentionally cannot decode profile 3.
- Five small synthetic encrypted profile-3 samples recovered byte-for-byte. Tile and smear samples were visually inspected; variation retains the muted texture, block faults and gray regions.
- Hidden Electron 44.5.1 layout measurement used this display's 1440x1000 work area. The previous initial page was 1,002 CSS pixels tall in a 795-pixel viewport. Updated initial content viewport is 1044x821; footer ends at 788 pixels and no scrollbar is needed. Initial screenshot inspected.
- Narrow sizes down to a test-only 360x480 viewport and 200% zoom retain document scrolling and a reachable footer. The normal window minimum remains 620 pixels wide when display space allows. Bounds tests include taskbars, small and secondary displays. Compact layout is not a promise of no scrolling at every display/zoom level or after long status messages.
- The Windows user subsequently reported that the revised Glitch/source-first interface and WAV recovery worked well. This is hands-on feedback, not an automated native-dialog matrix or independent audit.

## Linux baseline passes

- Automated core/adversarial tests: empty/binary/chunk boundaries; randomized encryption; wrong password; modified headers/ciphertext; truncation/reordering/duplication; authenticated malformed metadata, lengths, tags, finalization and trailing frames
- PNG dimensions/CRC/padding, IDAT flood, excess inflation, compressed trailing bytes
- No output after failed authentication; exclusive file/symlink protection; injected write/fsync failure cleanup
- WASM secretstream state zero-before-free and duplicate decrypted buffer cleanup
- Automatic export round-trip verification, including deliberately corrupted generated PNG refusal before output publication
- Full 16 MiB random payload round trips in both Plain and current Glitch carriers within the 36 MiB input/output bound; absolute 16,793,600-byte envelope ceiling and pre-inflation rejection above 1024 × 10944
- Glitch v2 profiles 1 and 2: independent visible-symbol/nibble extraction, legacy Plain compatibility, packing/row/minimum-height boundaries, canonical header/artwork/digest/tail/padding checks, ciphertext-rewrapping authentication failure, stable golden pixel vectors for both profiles
- Current real encrypted carrier images visually inspected for 128-byte, 1 MiB and 8 MiB synthetic inputs, plus an independently generated scan-smear seed: muted coherent abstract texture, stepped MCU fault origins, block repetition or scan smearing, local noisy blocks and gray tails. Large images use seed-varied 768-row panels. All sample payloads recovered byte-for-byte.
- Plain/Glitch renderer choice and busy/mode/cancel behavior; appearance passes through main and real worker, unsupported values rejected
- Mocked-DOM renderer interaction tests (validation, busy/repeated submit, cancellation, mode/keyboard flow, password clearing, errors, text-only filename rendering); real worker integration round trip/auth failure/no-overwrite tests
- Original-filename recovery: portable basename sanitization, extension retention, authentication before Save, user-selected rename, cancellation/dialog-failure buffer cleanup, repeated and busy IPC flows, and no-overwrite checks using the real worker with mocked native dialogs
- Optional output filename fields: blank/default names, separate mode state, input-change reset, canceled selection preservation, basename sanitization, PNG extension enforcement, Save As overrides, canceled/repeated/busy operations and extension-appended no-overwrite protection; Plain/v1 and Glitch/v2 recovery remain compatible
- JavaScript syntax checks and whitespace diff check
- Dependency npm audit: zero reported advisories at check time (not a security audit)
- Independent second-agent final code review of core, artwork and IPC boundaries; 36/36 aggregate tests, syntax and whitespace checks passed. Independent comparison against the prior revision confirmed byte-identical Plain/profile-1 encodings and compatible recovery for 96/97/98/600,000-byte envelopes. This is not an external security audit

## Development resource measurements

One Linux development run using the real file APIs encrypted a 16 MiB random file to a 19,878,790-byte PNG in 4.37 seconds (including export self-verification), then recovered it byte-exact in 1.93 seconds. Process peak RSS was 402,852 KiB (approximately 393 MiB). A separate sequential 128-byte/1 MiB/8 MiB/16 MiB sample run reached 444,248 KiB (approximately 434 MiB). These are development observations, not production memory guarantees or cross-platform benchmarks. The implementation remains whole-file buffered.

The 128-byte sample produced a 1,392,706-byte PNG; the 1 MiB sample produced 1,403,742 bytes; the 8 MiB sample produced 9,978,644 bytes. Exact sizes vary with randomized encryption and artwork seed. The 36 MiB hard file ceiling leaves room for worst-case PNG encoding; a 16 MiB input cap remains unchanged.

## Not verified

- Native Linux GUI end-to-end: runtime installed, but shell executor has no X server/$DISPLAY; Electron exits at platform initialization. No sandbox bypass attempted
- Visual browser preview: Chromium launch blocked by executor socket restrictions; cloud browser disallows file:// URLs. No visual QA pass is claimed
- Complete Windows native-dialog QA matrix; macOS GUI; Windows/macOS installation, packaging or signing/notarization
- Native Ubuntu .deb installation, kernel AppArmor profile loading and real desktop launch (the package and its extracted payload have separate automated checks; see INSTALL-UBUNTU.md)
- Production resource profiling, fuzzing, side-channel analysis, secure erase, or adversarial external audit

A cross-platform GitHub Actions core/syntax test matrix is included; check the exact PR commit's CI before treating it as passed. These are source tests, not native desktop UI certification. The Ubuntu installer workflow builds a private experimental artifact. No signed releases or production certification are implied.
