'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sodium = require('libsodium-wrappers-sumo');
const { PNG } = require('pngjs');
const zlib = require('node:zlib');
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ENVELOPE = MAX_FILE_BYTES + 16384;
const MAX_PNG_BYTES = 24 * 1024 * 1024;
const CHUNK = 65536, WIDTH = 1024, HEADER = 54;
const MAGIC = Buffer.from('IPSSTUD1');
const MAX_PIXELS = WIDTH * Math.ceil((MAX_ENVELOPE + 4) / (WIDTH * 3));
class FormatError extends Error {}
function fail(message = 'Invalid, damaged, or unsupported encrypted PNG') { throw new FormatError(message); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function passwordBytes(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024)
    fail('Use a password of at least 12 characters and at most 1024 UTF-8 bytes');
  return Buffer.from(password, 'utf8');
}
function keyFor(password, salt) {
  const p = passwordBytes(password);
  try { return sodium.crypto_pwhash(32, p, salt, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13); }
  finally { p.fill(0); }
}
// The pinned JS wrapper allocates secretstream state outside GC. Keep this adapter covered on upgrades.
function disposeState(state) {
  if (Number.isSafeInteger(state) && state > 0) {
    const wasm = sodium.libsodium;
    wasm.HEAPU8.fill(0, state, state + wasm._crypto_secretstream_xchacha20poly1305_statebytes());
    wasm._free(state);
  }
}
function aad(header, index, length) { return Buffer.concat([header, u32(index), u32(length)]); }
async function encryptBytes(data, password, name = 'file.bin') {
  await sodium.ready;
  if (!Buffer.isBuffer(data) || data.length > MAX_FILE_BYTES) fail('Input exceeds the 16 MiB prototype limit');
  const safeName = path.basename(name).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 200) || 'file.bin';
  const meta = Buffer.from(JSON.stringify({ name: safeName, size: data.length }));
  const salt = sodium.randombytes_buf(16), key = keyFor(password, salt);
  let state;
  try {
    const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    state = stream.state;
    const count = Math.max(1, Math.ceil(data.length / CHUNK));
    const total = HEADER + 4 + meta.length + 17 + data.length + count * 21;
    const header = Buffer.concat([MAGIC, Buffer.from([1, 1]), u32(total), Buffer.from(salt), Buffer.from(stream.header)]);
    const pieces = [header];
    const push = (plain, index, tag) => {
      const length = plain.length + 17;
      pieces.push(u32(length), Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(stream.state, plain, aad(header, index, length), tag)));
    };
    push(meta, 0, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    for (let i = 0; i < count; i++) push(data.subarray(i * CHUNK, (i + 1) * CHUNK), i + 1,
      i === count - 1 ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    return Buffer.concat(pieces);
  } finally { disposeState(state); sodium.memzero(key); }
}
async function decryptBytes(envelope, password) {
  await sodium.ready;
  if (!Buffer.isBuffer(envelope) || envelope.length < HEADER + 42 || envelope.length > MAX_ENVELOPE) fail();
  const header = envelope.subarray(0, HEADER);
  if (!header.subarray(0, 8).equals(MAGIC) || header[8] !== 1 || header[9] !== 1 || header.readUInt32BE(10) !== envelope.length) fail();
  const key = keyFor(password, header.subarray(14, 30));
  let chunks = [], state;
  try {
    state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header.subarray(30, 54), key);
    let offset = HEADER;
    const pull = (index, maxLength, expectedTag) => {
      if (offset + 4 > envelope.length) fail();
      const length = envelope.readUInt32BE(offset); offset += 4;
      if (length < 17 || length > maxLength + 17 || offset + length > envelope.length) fail();
      let result;
      try { result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, envelope.subarray(offset, offset + length), aad(header, index, length)); }
      catch { fail('Wrong password or damaged encrypted PNG'); }
      try {
        if (!result || result.tag !== expectedTag) fail('Wrong password or damaged encrypted PNG');
        offset += length;
        return Buffer.from(result.message);
      } finally { if (result && result.message) sodium.memzero(result.message); }
    };
    const raw = pull(0, 1024, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    let meta;
    try { meta = JSON.parse(raw.toString('utf8')); } catch { fail(); } finally { raw.fill(0); }
    if (!meta || typeof meta.name !== 'string' || meta.name.length > 200 || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX_FILE_BYTES) fail();
    const count = Math.max(1, Math.ceil(meta.size / CHUNK));
    for (let i = 0; i < count; i++) {
      const part = pull(i + 1, CHUNK, i === count - 1 ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
      chunks.push(part);
      if (part.length !== Math.min(CHUNK, meta.size - i * CHUNK)) fail();
    }
    if (offset !== envelope.length) fail();
    return { data: Buffer.concat(chunks), name: meta.name };
  } finally { disposeState(state); sodium.memzero(key); for (const chunk of chunks) chunk.fill(0); }
}
function envelopeToPng(envelope) {
  if (!Buffer.isBuffer(envelope) || envelope.length > MAX_ENVELOPE) fail();
  const height = Math.ceil((envelope.length + 4) / (WIDTH * 3));
  const rgb = Buffer.alloc(WIDTH * height * 3);
  rgb.writeUInt32BE(envelope.length); envelope.copy(rgb, 4);
  return PNG.sync.write({ width: WIDTH, height, data: rgb }, { colorType: 2, inputColorType: 2, inputHasAlpha: false, bitDepth: 8 });
}
// Inspect dimensions and every chunk before invoking a decompressor. Only our narrow PNG profile is supported.
function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PNG_BYTES || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail();
  const compressed = [];
  let offset = 8, ihdr = false, idat = false, ended = false, width, height;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail();
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size > MAX_PNG_BYTES || offset + 12 + size > bytes.length) fail();
    if (!ihdr && type !== 'IHDR') fail();
    if (type === 'IHDR') {
      if (ihdr || size !== 13) fail();
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      if (width !== WIDTH || height < 1 || width * height > MAX_PIXELS || !bytes.subarray(offset + 16, offset + 21).equals(Buffer.from([8, 2, 0, 0, 0]))) fail();
      ihdr = true;
    } else if (type === 'IDAT') { if (!ihdr || ended || idat || size === 0) fail(); idat = true; compressed.push(bytes.subarray(offset + 8, offset + 8 + size)); }
    else if (type === 'IEND') { if (!idat || size !== 0 || offset + 12 !== bytes.length) fail(); ended = true; }
    else fail();
    offset += 12 + size;
  }
  if (!ended) fail();
  const packed = Buffer.concat(compressed), expected = (width * 3 + 1) * height;
  try {
    const result = zlib.inflateSync(packed, { maxOutputLength: expected, info: true });
    if (result.buffer.length !== expected || result.engine.bytesWritten !== packed.length) fail();
  } catch { fail(); }
  return { width, height };
}
function pngToEnvelope(bytes) {
  const { width, height } = inspectPng(bytes);
  let decoded;
  try { decoded = PNG.sync.read(bytes, { checkCRC: true }); } catch { fail(); }
  if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) fail();
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0, q = 0; p < decoded.data.length; p += 4) { rgb[q++] = decoded.data[p]; rgb[q++] = decoded.data[p + 1]; rgb[q++] = decoded.data[p + 2]; }
  const length = rgb.readUInt32BE(0);
  if (length < HEADER + 42 || length > MAX_ENVELOPE || length + 4 > rgb.length || Math.ceil((length + 4) / (WIDTH * 3)) !== height) fail();
  for (let i = length + 4; i < rgb.length; i++) if (rgb[i] !== 0) fail();
  return rgb.subarray(4, length + 4);
}
async function readBounded(file, limit) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) fail('Input exceeds the prototype limit or is not a regular file');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null); if (!bytesRead) fail('Input changed while reading'); offset += bytesRead; }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, null)).bytesRead) fail('Input changed while reading');
    return bytes;
  } finally { await handle.close(); }
}
async function writeNew(file, bytes) {
  // Publish only complete output. A private same-filesystem temporary is linked
  // into place atomically; link refuses existing files and symlinks.
  const directory = path.dirname(path.resolve(file));
  const temporary = await fs.mkdtemp(path.join(directory, '.ips-write-'));
  const staged = path.join(temporary, 'payload');
  let handle;
  try {
    handle = await fs.open(staged, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    await fs.link(staged, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function encodeFile(input, password, output) {
  const data = await readBounded(input, MAX_FILE_BYTES);
  try {
    const png = envelopeToPng(await encryptBytes(data, password, path.basename(input)));
    const verified = await decryptBytes(pngToEnvelope(png), password);
    try { if (!verified.data.equals(data)) fail('Internal export verification failed'); }
    finally { verified.data.fill(0); }
    await writeNew(output, png); return { bytes: data.length, verified: true };
  }
  finally { data.fill(0); }
}
async function decodeFile(input, password, output) {
  const { data } = await decryptBytes(pngToEnvelope(await readBounded(input, MAX_PNG_BYTES)), password);
  try { await writeNew(output, data); return { bytes: data.length }; }
  finally { data.fill(0); }
}
module.exports = { MAX_FILE_BYTES, MAX_PNG_BYTES, encryptBytes, decryptBytes, envelopeToPng, pngToEnvelope, encodeFile, decodeFile, FormatError };
