# Experimental PNG carriers and encrypted envelope v1

This is a provisional format, not a published security standard. All integers are unsigned big-endian. Numeric limits are checked before expensive derivation/decompression. Implementations must reject unknown versions/profiles rather than guess.

## Plain carrier v1

A non-interlaced 8-bit RGB PNG, width 1024. Only IHDR, one nonempty IDAT, and IEND chunks are accepted, with CRC validation and no trailing bytes. Dimensions are bounded before decompression. Native zlib enforces the exact expected scanline output length and complete compressed input consumption before pngjs pixel decoding. The decoded pixel byte sequence is:

1. 4-byte envelope length
2. That many envelope bytes
3. Zero padding to the end of the final row

Height must be the smallest positive height accommodating those bytes. Padding must be zero. The outer length equals the authenticated envelope length below. No payload is stored in metadata/ancillary chunks. Pixel-equivalent PNG rewrites with extra ancillary chunks are intentionally unsupported by this narrow prototype parser.

## Glitch carrier v2 (transform profile 1)

The PNG chunk/profile restrictions above also apply. Its decoded RGB channel bytes start with a 48-byte header: ASCII `IPSPNG02` at 0–7, carrier version 2 at 8, transform profile 1 at 9, zero reserved bytes at 10–11, envelope length at 12–15, and SHA-256 of the complete encrypted envelope at 16–47. This digest is a public corruption check, not keyed authentication. The inner envelope and its authenticated encryption remain v1.

After the header, each three envelope bytes a,b,c produce four six-bit symbols: `a >> 2`, `((a & 3) << 4) | (b >> 4)`, `((b & 15) << 2) | (c >> 6)`, `c & 63`. Missing bytes in the final triplet are zero. Symbols occupy the low six bits of successive RGB channels; high two bits carry deterministic artwork. All unused tail bits and remaining canvas low bits must be zero. Height is exactly `max(256, ceil((48 + 4 * ceil(length / 3)) / 3072))`. This adds approximately 33% payload pixels; minimum canvas and PNG compression mean final file-size overhead varies.

Artwork is defined by `artPixel`, `mix`, `PALETTE` and `applyArtwork` in `src/core.cjs`, with a regression golden vector in `test/glitch.test.cjs`. Treat these profile-1 constants and integer operations as wire-format constants. The first four digest bytes seed a public 32-bit mixer. Six quantized palettes, 16-pixel horizontal bands, displaced block boundaries, and thin dark lines determine the upper channel bits. Every high bit is validated during decoding. Changes to this generator require a new transform profile; it is not encryption or error correction.

Unknown profiles/versions, noncanonical dimensions/header/padding/artwork, digest mismatches and a mismatched inner envelope length are rejected. Recovery dispatches by the distinct pixel magic and still accepts Plain v1. Only the normal secretstream decryptor can authenticate and release plaintext; a recalculated checksum/artwork cannot bypass it.

The shared pre-inflation ceiling is 7,463,936 pixels (1024 × 7289), or 22,399,097 scanline bytes. Compressed input and output remain limited to 24 MiB. No encrypted data is carried in PNG ancillary metadata or alpha channels. Plain and Glitch both require the original unmodified lossless PNG.

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
