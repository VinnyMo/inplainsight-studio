# Experimental PNG container v1

This is a provisional format, not a published security standard. All integers are unsigned big-endian. Numeric limits are checked before expensive derivation/decompression. Implementations must reject unknown versions/profiles rather than guess.

## Carrier

A non-interlaced 8-bit RGB PNG, width 1024. Only IHDR, one nonempty IDAT, and IEND chunks are accepted, with CRC validation and no trailing bytes. Dimensions are bounded before decompression. Native zlib enforces the exact expected scanline output length and complete compressed input consumption before pngjs pixel decoding. The decoded pixel byte sequence is:

1. 4-byte envelope length
2. That many envelope bytes
3. Zero padding to the end of the final row

Height must be the smallest positive height accommodating those bytes. Padding must be zero. The outer length equals the authenticated envelope length below. No payload is stored in metadata/ancillary chunks. Pixel-equivalent PNG rewrites with extra ancillary chunks are intentionally unsupported by this narrow prototype parser.

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
