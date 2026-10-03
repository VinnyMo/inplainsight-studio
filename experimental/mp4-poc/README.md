# Visible-pixel MP4 proof of concept

Follow-up: see [DENSITY-COMPARISON.md](DENSITY-COMPARISON.md) for the versioned 4px carrier, stronger resource bounds and five fully verified presets. The best measured preset reduced expansion to 11.61x. The original measurements and profile-1 specification below remain the baseline history; the follow-up documents current limits.

Experimental Windows CLI/test code, isolated from InPlainSight Studio. Not integrated into the GUI, not a release format, and not a large-file support claim. It does not change the supported application carriers or their 16 MiB input caps.

## Historical measurements (generated artifacts excluded from Git)

`artifacts/synthetic-64k.mp4` is a real lossy H.264/yuv420p MP4 produced by the installed FFmpeg 9.0, software libx264, CRF 18, all-intra, 30 fps, 1280x720. It contains one video stream and no payload in metadata, audio, attachments, subtitles, or a required sidecar. All encrypted-envelope bytes and recovery framing are rendered as visible black/white 8x8 cells. The evidence JSON, preview, and original are QA artifacts; recovery uses only the MP4 and test password.

- Synthetic input: 65,536 bytes.
- MP4: 3,325,047 bytes; 282 frames; 9.4 seconds playback.
- Export including full decode/authentication/hash self-check: 2.930 s.
- Separate authenticated recovery to a real file: 1.147 s.
- Source and recovered SHA-256: `c88defe64c4d25613f1fe9ded2905e8e2b120171d7c2047044cb78aa1e0b9df9`.
- MP4 SHA-256: `c6746b11eaab4074d47b13cbe5211a439761252f49c5ff5051464408a9778ab9`.
- Node peak RSS from process.resourceUsage: 169,048 KiB (~165.1 MiB). Sampled Node RSS peaked at 163.4 MiB. FFmpeg encoder reported maxrss 57,316 KiB (~56.0 MiB). Decoder-child and simultaneous whole-system peaks were not measured. These are small-fixture observations, not constant-memory proof or a hard process cap.
- About 50.7x file expansion. This deliberately conservative transport is too inefficient for large-file product use as-is. Playback duration and processing time are different metrics.

The disposable demonstration password is `disposable-video-demo-password`. It protects synthetic data only. Do not use it for personal files.

## Code and execution

After installing the root project dependencies, run from this directory:

```powershell
node --test --test-concurrency=1 test.cjs
node demo.cjs
```

`demo.cjs` refuses to overwrite existing artifact filenames. Preserve/move the previous artifact set deliberately before rerunning it. The pipeline API exports `encode(input, output, password, options)` and `decode(...)`; passwords are not command-line arguments. `options.signal` supports cancellation and `options.progress` receives phase counters. Use synthetic inputs only during this prototype stage.

FFmpeg is resolved from an absolute IPS_FFMPEG path or absolute PATH entries, with ffprobe required beside it. The original measurements used a preinstalled Gyan FFmpeg 9.0 build. No dependency was installed, and no FFmpeg binary is included in the checkpoint. Existing libsodium-wrappers-sumo 0.8.4 is reused. This FFmpeg binary reports GPLv3-or-later; redistribution/licensing is unresolved and must be addressed before packaging any release.

## Crypto and publication

`crypto-stream.cjs` incrementally reads/writes the existing IPSSTUD1 v1 authenticated envelope, with the same 64 KiB chunk framing, Argon2id parameters (3 operations, 64 MiB) and libsodium secretstream construction. A compatibility test decrypts a streamed envelope through the unchanged application core. The test-only input cap is 64 KiB, so it does not demonstrate multi-gigabyte behavior; the streaming loops and chunk allocations are bounded independently of whole-file concatenation.

Export streams ciphertext to a private temporary spool, renders it one frame at a time into FFmpeg's stdin, and writes a staged MP4. It then decodes actual MP4 pixels back to a ciphertext spool, authenticates every crypto record, requires the FINAL tag and exact lengths/no trailing bytes, and compares recovered plaintext length/SHA-256 to the original bytes read. Only then does an exclusive filesystem hard link publish the MP4. No successful export can replace an existing file.

Recovery first reconstructs and authenticates ciphertext without creating any plaintext file. It then reauthenticates into a private staged plaintext file, compares both pass results and publishes exclusively. In this CLI, the caller already supplies the destination; there is no GUI Save handshake or persistent key storage. Raw source chunks and secretstream states/keys are cleared as far as the JS/WASM interfaces permit. Secure erase and Windows private ACL enforcement are not claimed.

## Visible carrier and bounded ECC

This proof of concept uses a small, fully tested Hamming SECDED implementation rather than installing Reed-Solomon. It is not the earlier proposed production RS transport.

- 160x90 visible cells, with a two-cell alternating black/white calibration border.
- Each data packet is exactly 768 bytes: 64 header bytes plus up to 704 ciphertext bytes, with zero padding.
- Each nibble becomes an extended Hamming(8,4) codeword. Parity bit positions are 1, 2, 4 and 8; data positions are 3, 5, 6 and 7, high data bit first. Every single-bit error is corrected; every two-bit error is detected. Higher error weights can miscorrect; the packet digest and secretstream authentication are separate rejection layers, not a claim of unlimited correction.
- Bit-plane interleaving spreads nearby raster errors across distinct codewords. Pixel sampling averages the central 4x4 region of each 8x8 cell, with threshold calibrated from the visible border.
- Each encoded frame is repeated exactly three times, giving a repetition (3,1) erasure code. A three-frame group can recover if one valid copy remains and every other valid copy agrees. Damaged packets become erasures. This does NOT handle dropped/inserted frames: grouping, physical frame count, packet order, total length and final packet are strict. Entirely damaged groups fail closed.
- The maximum recovered encrypted envelope is 67,584 bytes. No growing full-frame list is accumulated.

Header layout (all integers big-endian):

| Bytes | Meaning |
| --- | --- |
| 0–7 | ASCII `IPSV0001` |
| 8 | Experimental profile 1 |
| 9 | Repetition count 3 |
| 10 | Final packet flag, exactly 0 or 1 |
| 11 | Zero |
| 12–15 | Packet index |
| 16–19 | Total packet count |
| 20–23 | Exact encrypted-envelope byte length |
| 24–25 | Valid body byte count |
| 26–27 | Zero |
| 28–43 | First 16 bytes of SHA-256(encrypted envelope), public stream identity/check |
| 44–59 | First 16 bytes of SHA-256(header excluding these checksum bytes + padded body) |
| 60–63 | Zero |

Required bootstrap fields are therefore repeated, visibly encoded and SECDED-protected in every frame. These public checksums are not authentication. Only the inner secretstream accepts plaintext.

## Tests and limits

Final suite: **6 tests passed, 0 failures**, 5.56 seconds, sequential. Includes exhaustive all-nibble single/double-bit SECDED cases, independent hand-calculated vectors, visible-cell corruption, two damaged frame copies, all-damaged/dropped/extra-frame rejection, empty/1/4097/65535/65536-byte crypto boundaries, wrong password, truncation, trailing data, correctly authenticated MESSAGE-instead-of-FINAL rejection, real lossy MP4 round trip, no overwrite, cancellation during encode and decode, truncated MP4 rejection, output-size failure and injected publication failure. Failure cases leave no published output or job directory. The unmodified real MP4 needed zero corrected words; deliberate corruption tests operate on decoded raster buffers, not a claim of arbitrary real-world transcoding tolerance.

One FFmpeg child per operation; one raw frame and one packet group retained. Writes await completion, reads assemble one fixed frame, stderr/probe output are bounded, counters bound decoded frames/bytes, and media children have a 15-second timeout (5 seconds for probing), with a 30-second operation deadline. Video input/output cap is 16 MiB; output is polled during encoding and checked before publication, so transient polling overshoot is possible. `highWaterMark` is not used as a total-memory guarantee. Standard MP4 is acceptable for this <10-second fixture; fragmented MP4/index memory remains future work for long streams.

Cancellation kills only the tracked child and waits for closure, closes files and removes the job-owned staging directory. A minimal ownership marker contains only the prototype ID and PID. Crash/power-loss startup cleanup, cross-instance locking, robust Windows Job Object resource limits, per-destination disk preflight, broader filesystem support and untrusted-media security remain unfinished. FFprobe dimension checks cannot prevent every malicious codec allocation. Treat inputs as our synthetic prototype outputs for now.

This source checkpoint does not enable video in the GUI, raise input caps, bundle codecs or create a release. Generated artifacts and local logs are excluded; demo/compare scripts can regenerate disposable fixtures. Next slice should improve transport density/ECC and test a tightly bounded transcode/corruption matrix before considering larger input limits.
