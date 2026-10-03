# Experimental PNG carriers and encrypted envelope v1

This is a provisional format, not a published security standard. All integers are unsigned big-endian. Numeric limits are checked before expensive derivation/decompression. Implementations must reject unknown versions/profiles rather than guess.

## Plain carrier v1

A non-interlaced 8-bit RGB PNG, width 1024. Only IHDR, one nonempty IDAT, and IEND chunks are accepted, with CRC validation and no trailing bytes. Dimensions are bounded before decompression. Native zlib enforces the exact expected scanline output length and complete compressed input consumption before pngjs pixel decoding. The decoded pixel byte sequence is:

1. 4-byte envelope length
2. That many envelope bytes
3. Zero padding to the end of the final row

Height must be the smallest positive height accommodating those bytes. Padding must be zero. The outer length equals the authenticated envelope length below. No payload is stored in metadata/ancillary chunks. Pixel-equivalent PNG rewrites with extra ancillary chunks are intentionally unsupported by this narrow prototype parser.

## Legacy Glitch carrier v2 (transform profile 1)

The PNG chunk/profile restrictions above also apply. Its decoded RGB channel bytes start with a 48-byte header: ASCII `IPSPNG02` at 0–7, carrier version 2 at 8, transform profile 1 at 9, zero reserved bytes at 10–11, envelope length at 12–15, and SHA-256 of the complete encrypted envelope at 16–47. This digest is a public corruption check, not keyed authentication. The inner envelope and its authenticated encryption remain v1.

After the header, each three envelope bytes a,b,c produce four six-bit symbols: `a >> 2`, `((a & 3) << 4) | (b >> 4)`, `((b & 15) << 2) | (c >> 6)`, `c & 63`. Missing bytes in the final triplet are zero. Symbols occupy the low six bits of successive RGB channels; high two bits carry deterministic artwork. All unused tail bits and remaining canvas low bits must be zero. Height is exactly `max(256, ceil((48 + 4 * ceil(length / 3)) / 3072))`. This adds approximately 33% payload pixels; minimum canvas and PNG compression mean final file-size overhead varies.

Artwork is defined by `artPixel`, `mix`, `PALETTE` and `applyArtwork` in `src/core.cjs`, with a regression golden vector in `test/glitch.test.cjs`. Treat these profile-1 constants and integer operations as wire-format constants. The first four digest bytes seed a public 32-bit mixer. Six quantized palettes, 16-pixel horizontal bands, displaced block boundaries, and thin dark lines determine the upper channel bits. Every high bit is validated during decoding. Changes to this generator require a new transform profile; it is not encryption or error correction.

Unknown profiles/versions, noncanonical dimensions/header/padding/artwork, digest mismatches and a mismatched inner envelope length are rejected. Recovery dispatches by the distinct pixel magic and still accepts Plain v1. Only the normal secretstream decryptor can authenticate and release plaintext; a recalculated checksum/artwork cannot bypass it.

## Legacy Glitch carrier v2 (transform profile 2)

Profile-2 exports use the same 48-byte header but set byte 9 to 2. Each envelope byte produces two symbols, high nibble first then low nibble, in successive RGB channels beginning at byte 48. The low four bits carry the encrypted envelope; the high four bits carry canonical artwork. Height is exactly `max(768, 16 * ceil((48 + 2 * length) / (3072 * 16)))`, width 1024. There are no partial symbols. Raw payload RGB storage is approximately twice the envelope size; the minimum canvas and PNG compression determine actual file overhead.

`src/glitch-art.cjs` is the normative integer-only profile-2 generator, including all constants, operation order, integer rounding and public mixers. Its regression golden pixel vector is in `test/glitch2.test.cjs`. The digest seeds coherent abstract grayscale texture, a few partial-row fault origins, whole-16×16-MCU displacement, muted chroma/DC offsets, localized noisy fault blocks, and neutral-gray decode tails. Seeded 768-row panels vary between repeated block columns and scanline smearing. The final panel may be partial. No recognizable source photograph or plaintext-derived artwork is used.

After `48 + 2 * length`, low nibbles are canonical public grain derived from the digest and pixel position, not zero padding and not additional payload. Every upper nibble and every padding nibble is verified after envelope extraction and digest checking. Header bytes remain exact visible RGB bytes, unaffected by artwork. A restyled or rewritten carrier is not accepted. Ciphertext resides only in RGB channel nibbles; no payload is carried in alpha, metadata, ancillary chunks or trailing bytes. This is an openly identifiable encrypted container, not an invisibility claim.

Profile 1's generator, height and zero-padding rules remain unchanged. The encoder's optional third argument can explicitly generate profile 1 or 2 for compatibility fixtures; the desktop's single Glitch choice now generates profile 3. Unknown profiles are rejected, never guessed. The inner authenticated envelope, KDF, and secretstream protocol remain v1.

## Current Glitch carrier v2 (transform profile 3)

Profile 3 sets header byte 9 to 3 and retains profile 2's nibble packing, canonical dimensions, 768-row minimum and resource bounds. The normative generator is `src/glitch-art3.cjs`; all constants, operation order and integer rounding are wire-format rules. The full 32-byte envelope digest and panel index derive a deterministic composition seed, separate from legacy generators. No additional random field or plaintext-derived artwork is introduced.

Each panel selects 2–5 ordered faults with varied locations, signed 3–23-block displacement and muted chroma offsets. Seed-derived parameters choose coarse texture scale/contrast, tile or smear treatment, repeat-strip placement/width/source/period, smear placement/height, and localized 3–15-block noisy bursts. Gray tails begin within block rows 29–46 with varied neutral intensity; one fifth of parameter choices omit the tail. The width, panel size and 16x16 block grid remain fixed. These choices diversify appearance but do not conceal the public container header or provide secrecy.

High channel nibbles and unused low-nibble grain are regenerated and checked exactly. Profile 1 and 2 generation and decoding remain unchanged; changing an existing file's profile byte cannot convert its artwork. Older readers reject profile 3 rather than recover it; new readers continue to accept Plain v1 and both older Glitch profiles. Future changes to canonical profile-3 artwork require another transform profile. The inner encrypted envelope, KDF and secretstream protocol remain v1.

## Shared resource limits

The pre-inflation ceiling is 11,206,656 pixels (1024 × 10944), or 33,630,912 scanline bytes. It derives from the maximum allowed envelope of 16,793,600 bytes and profile-2 height. Compressed input and output are limited to 36 MiB, with exact decompressed length and complete compressed input consumption required. Smaller per-profile canonical dimensions are checked after decoding. The ceiling is a parser bound, not a promise that memory use equals file size; synchronous PNG parsing and whole-file verification allocate multiple buffers. Plain and both Glitch profiles require the original unmodified lossless PNG.

## Envelope header (54 bytes)

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 8 | ASCII `IPSSTUD1` |
| 8 | 1 | format version: 1 |
| 9 | 1 | KDF/crypto profile: 1 |
| 10 | 4 | total envelope length including header |
| 14 | 16 | random Argon2id salt |
| 30 | 24 | libsodium secretstream header |

Profile 1 derives a 32-byte key using libsodium Argon2id13, opslimit 3, memlimit 67,108,864 bytes. Password is UTF-8, no Unicode normalization, at least 12 JavaScript UTF-16 code units and at most 1024 UTF-8 bytes. This minimum is a UI guard, not an entropy guarantee. Profile constants cannot be supplied by the PNG; unknown profiles are rejected before KDF work.

## Authenticated frames

Each frame is a 4-byte ciphertext length followed by ciphertext. Additional authenticated data for each secretstream message is the complete 54-byte envelope header, the 4-byte zero-based frame index, and that frame's 4-byte ciphertext length. Nonces/rekeying/order protection belong to libsodium secretstream.

Frame 0: encrypted UTF-8 JSON `{ "name": "...", "size": N }`, maximum 1024 plaintext bytes, TAG_MESSAGE. Names are at most 200 UTF-16 code units; size is an integer from 0 through 16,777,216. The name is descriptive only and must never choose an output path.

Following frames: file content, 65,536 plaintext bytes per frame except the last. Every non-final file frame has TAG_MESSAGE; the final frame has TAG_FINAL. An empty file has one zero-length final frame. Expected file-frame count is max(1, ceil(size/65536)). Exact per-frame plaintext size, exact tags, and exact envelope exhaustion are checked. There are no accepted trailing frames or optional final markers.

Maximum envelope length is 16,793,600 bytes. Ciphertext and decoded pixel dimensions reveal approximate file size. The header reveals format/profile; it does not reveal the filename. Changing the header, ordering, framing, ciphertext, or final marker cannot yield accepted plaintext without valid authentication.
