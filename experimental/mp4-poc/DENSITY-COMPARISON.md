# Bounded MP4 density comparison — 2026-10-03

Five presets, one 65,536-byte synthetic input, one shared encrypted envelope. Every accepted MP4 was decoded from its visible pixels, checked for packet/ECC consistency, fully authenticated with mandatory FINAL tag and exact lengths, and compared byte-for-byte with the original while hashing. All five passed, with zero corrected words and zero erased frames. This is one small-fixture comparison, not a robustness or large-file benchmark.

| Cells / H.264 setting | MP4 bytes | Expansion | Playback | Encode | Decode + verify |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8px / CRF18 / all-intra | 3,332,364 | 50.85x | 9.4 s | 2.00 s | 0.84 s |
| 8px / CRF24 / all-intra | 3,658,918 | 55.83x | 9.4 s | 1.95 s | 0.83 s |
| 4px / CRF18 / all-intra | 2,572,954 | 39.26x | 2.2 s | 0.62 s | 0.51 s |
| 4px / CRF24 / all-intra | 2,365,537 | 36.10x | 2.2 s | 0.56 s | 0.48 s |
| **4px / CRF24 / GOP30** | **760,925** | **11.61x** | **2.2 s** | **0.42 s** | **0.38 s** |

The shared encryption pass is excluded from per-case timings. Playback time is not encoding time. The newly encrypted control differs slightly from the previous 3,325,047-byte demo because encryption is randomized; all five rows here use the same ciphertext. CRF24 increased the 8px file size on this structured sample, so do not assume a monotonic size benefit or extrapolate from its label.

## Recommendation and limits

Use profile 2 / CRF24 / GOP30 as the next local original-file prototype preset:

```js
await pipeline.encode(input, output, password, {
  carrierProfile: 2,
  crf: 24,
  gop: 30,
});
```

It reduced file size by about 77.2% relative to this run's 8px control. A 30-frame maximum GOP allows inter-frame compression to exploit repetition. That introduces dependencies between frames: a compressed-stream error may affect multiple decoded frames, so the isolated raster-erasure result is not equivalent to a guarantee about damaged GOPs. Use profile 2 / CRF24 / all-intra as a less compact frame-independent comparison when investigating damage behavior.

Keep the 64 KiB experimental input cap. Even 11.6x expansion remains substantial. No arbitrary transcode, resizing, upload-service conversion, camera capture, dropped/inserted-frame recovery or large-file memory guarantee was established. No further presets were tried once this useful result existed. Default API settings remain the original profile 1 / CRF18 / all-intra; the recommendation is explicit and opt-in.

Recommended artifact: `comparison/4px-crf24-gop30.mp4`.

- Source and recovered SHA-256, all rows: `c88defe64c4d25613f1fe9ded2905e8e2b120171d7c2047044cb78aa1e0b9df9`.
- Recommended MP4 SHA-256: `05c27299497700f752671b49b114c8cb5f0217725bf228318579a28244d3a76e`.
- Recommended encoder reported peak RSS: 61,344 KiB (~59.9 MiB). Other encoder peaks: 55,040–56,716 KiB. Total app/Node/decoder simultaneous peak was not measured in this comparison.
- `comparison/results.json` records exact settings, timings, sizes, hashes and codec benchmarks; `comparison.log` records the run.

## Versioned transport

Experimental profile 1 and its `symbols.cjs` are unchanged. Profile 2 is defined in `symbols-dense.cjs`: header byte 8 equals 2; cells are 4x4, logical grid 320x180, packet size 3,072 bytes, encrypted-body capacity 3,008 bytes, and sampling uses the central 2x2 pixels. Width/height, Hamming SECDED construction, bit-plane interleaving, three-frame repetition, checksum fields and mandatory final marker remain as before. Required bootstrap is visibly encoded and repeated in every packet. No sidecar or hidden payload was added.

The decoder tries only the two fixed, bounded profiles during bootstrap and then locks to the identified profile. Profile-1 output remains supported. Quality/GOP changes affect the H.264 encoder, not the pixel framing version. Unknown profiles are rejected.

## Resource checks strengthened

- Validate profile, CRF, GOP and output-byte settings against explicit small allowlists/bounds before creating a job.
- Reject oversized encrypted input before hashing; bounded hashes detect byte-count changes rather than reading to arbitrary EOF.
- Add a 30-second whole-operation deadline to public encode/decode, 15-second child deadlines and a 5-second probe deadline. Cancellation waits for the tracked child and cleans owned staging. Timers are cooperative around synchronous crypto; this is not a hard real-time deadline.
- Add a 64 MiB per-allocation FFmpeg bound and a 921,600 decoded-pixel codec limit. These are NOT process-wide RSS limits or a complete native-parser sandbox.
- Require bounded integral reported frame counts and exactly 30 fps for this narrow flat-MP4 prototype; reject mismatched decoded counts and over-budget raw bytes before processing them. Fragmented MP4s without frame counts are intentionally outside this prototype's current input profile.
- Add the encoder's output-size option alongside existing polling and authoritative pre-publication stat checks. A codec packet/polling overshoot may occur in staging; oversized final exports are not published.
- Detect input size/mtime changes during recovery. This is not a filesystem snapshot guarantee.

Final regression suite: **8 passed, 0 failed**, 6.21 seconds, sequential. Existing failure cleanup/cancel/authentication tests remain, with added dense-cell correction, dense profile identification, invalid settings, hash-size and operation-deadline cleanup checks. These historical measurements did not modify the application or original profile-1 symbol module. This experiment remains isolated from the GUI.

Run `node --test --test-concurrency=1 test.cjs density-test.cjs` for regressions. `node compare.cjs` creates a new `comparison` directory and intentionally refuses to replace this saved run; preserve it deliberately before any rerun. The code uses root project dependencies and separately installed FFmpeg/ffprobe. Generated comparison media/logs are excluded from Git; this table preserves the measured evidence.
