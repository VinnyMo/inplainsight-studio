# Beyond the PNG prototype

Plain PNG v1 and reversible Glitch PNG v2 are implemented carriers. Video remains a design/benchmark discussion.

Potential carriers include lossless video for density and robust high-contrast symbol grids plus error correction for lossy video/JPEG. The encrypted envelope should remain separate from media modulation, sync, and error correction; real encrypted bytes must travel in pixels/frames, without sidecars. Carrier transforms do not replace authenticated encryption.

Priorities are reliable recovery and useful visual design before density/efficiency. Future presets and advanced radio/slider controls could trade capacity against robustness and appearance. They must never silently weaken password derivation or authenticated encryption. No disabled placeholder controls imply these formats currently work.

The PNG prototype verifies an in-memory export by decoding/decrypting its generated PNG and comparing the recovered bytes before publishing the new output. Future lossy carriers need empirical corruption/transport tests, clear capacity estimates, and verified export round-trips before claiming support.

Folder support is future work: preserve directory hierarchy and original filenames inside authenticated encryption, while requiring explicit recovery destinations and safe path validation. The current MVP encrypts one file at a time; it provides no plausible-deniability or stealth guarantee.
