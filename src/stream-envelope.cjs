'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const sodium = require('libsodium-wrappers-sumo');
const { safeFilename, FormatError } = require('./core.cjs');
const MAX_INPUT = 16 * 1024 * 1024, CHUNK = 65536, MAX_ENVELOPE = MAX_INPUT + 16384, HEADER = 54;
const fail = message => { throw new FormatError(message || 'Wrong password or damaged encrypted WAV.'); };
function check(signal) { if (signal?.aborted) throw Object.assign(new Error('Canceled'), { code: 'ABORT_ERR' }); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function aad(header, index, length) { return Buffer.concat([header, u32(index), u32(length)]); }
function keyFor(password, salt) {
  if (typeof password !== 'string' || password.length < 1 || Buffer.byteLength(password) > 1024) fail('Enter a password of at most 1,024 UTF-8 bytes');
  const p = Buffer.from(password);
  try { return sodium.crypto_pwhash(32, p, salt, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13); }
  finally { p.fill(0); }
}
function dispose(state) { if (Number.isSafeInteger(state) && state > 0) { const w = sodium.libsodium; w.HEAPU8.fill(0, state, state + w._crypto_secretstream_xchacha20poly1305_statebytes()); w._free(state); } }
async function readExact(handle, length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > CHUNK + 1041) fail('Read bound exceeded');
  const data = Buffer.alloc(length);
  try {
    for (let offset = 0; offset < length;) { const r = await handle.read(data, offset, length - offset, null); if (!r.bytesRead) fail('Truncated file'); offset += r.bytesRead; }
    return data;
  } catch (error) { data.fill(0); throw error; }
}
async function eof(handle) { const b = Buffer.alloc(1); if ((await handle.read(b, 0, 1, null)).bytesRead) fail('Unexpected trailing bytes'); }
async function writeAll(handle, bytes) { for (let p = 0; p < bytes.length;) { const r = await handle.write(bytes, p, bytes.length - p, null); if (!r.bytesWritten) fail('Short write'); p += r.bytesWritten; } }
async function encrypt(input, output, password, { signal, progress = () => {} } = {}) {
  await sodium.ready; check(signal);
  if (typeof password !== 'string' || password.length < 12) fail('Use a password with at least 12 characters.');
  const source = await fs.open(input, 'r'); let dest, key, state;
  try {
    const before = await source.stat(); if (!before.isFile() || before.size > MAX_INPUT) fail('WAV supports originals up to 16 MiB');
    const meta = Buffer.from(JSON.stringify({ name: safeFilename(path.basename(input)), size: before.size }));
    const salt = Buffer.from(sodium.randombytes_buf(16)); key = keyFor(password, salt); check(signal);
    const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key); state = stream.state;
    const count = Math.max(1, Math.ceil(before.size / CHUNK)), total = HEADER + 21 + meta.length + before.size + count * 21;
    const header = Buffer.concat([Buffer.from('IPSSTUD1'), Buffer.from([1, 1]), u32(total), salt, Buffer.from(stream.header)]);
    dest = await fs.open(output, 'wx', 0o600); await writeAll(dest, header);
    const push = async (plain, index, tag) => { check(signal); const length = plain.length + 17; const encrypted = Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(state, plain, aad(header, index, length), tag)); await writeAll(dest, u32(length)); await writeAll(dest, encrypted); };
    await push(meta, 0, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE); meta.fill(0);
    const hash = crypto.createHash('sha256');
    for (let i = 0; i < count; i++) {
      const plain = await readExact(source, Math.min(CHUNK, before.size - i * CHUNK));
      try { hash.update(plain); await push(plain, i + 1, i === count - 1 ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE); progress({ phase: 'encrypting', bytes: Math.min(before.size, (i + 1) * CHUNK), total: before.size }); }
      finally { plain.fill(0); }
    }
    check(signal); await eof(source); const after = await source.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('Input changed');
    await dest.sync(); return { bytes: before.size, envelopeBytes: total, sha256: hash.digest('hex') };
  } finally { dispose(state); if (key) sodium.memzero(key); await source.close(); if (dest) await dest.close(); }
}
async function decrypt(input, password, { signal, onChunk = async () => {}, progress = () => {} } = {}) {
  await sodium.ready; check(signal); const source = await fs.open(input, 'r'); let key, state;
  try {
    const stat = await source.stat(); if (!stat.isFile() || stat.size < 96 || stat.size > MAX_ENVELOPE) fail();
    const header = await readExact(source, HEADER);
    if (header.toString('ascii', 0, 8) !== 'IPSSTUD1' || header[8] !== 1 || header[9] !== 1 || header.readUInt32BE(10) !== stat.size) fail();
    key = keyFor(password, header.subarray(14, 30)); check(signal); state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header.subarray(30, 54), key);
    const pull = async (index, maximum, tag) => {
      check(signal); const length = (await readExact(source, 4)).readUInt32BE(); if (length < 17 || length > maximum + 17) fail();
      const cipher = await readExact(source, length); let decoded;
      try { decoded = sodium.crypto_secretstream_xchacha20poly1305_pull(state, cipher, aad(header, index, length)); if (!decoded || decoded.tag !== tag) fail(); return Buffer.from(decoded.message); }
      finally { if (decoded?.message) sodium.memzero(decoded.message); }
    };
    const raw = await pull(0, 1024, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE); let metadata;
    try { metadata = JSON.parse(raw.toString('utf8')); } finally { raw.fill(0); }
    if (!metadata || typeof metadata.name !== 'string' || metadata.name.length > 200 || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > MAX_INPUT) fail();
    const count = Math.max(1, Math.ceil(metadata.size / CHUNK)), hash = crypto.createHash('sha256'); let bytes = 0;
    for (let i = 0; i < count; i++) {
      const plain = await pull(i + 1, CHUNK, i === count - 1 ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
      try { if (plain.length !== Math.min(CHUNK, metadata.size - i * CHUNK)) fail(); hash.update(plain); await onChunk(plain); bytes += plain.length; progress({ phase: 'authenticating', bytes, total: metadata.size }); }
      finally { plain.fill(0); }
    }
    check(signal); await eof(source); return { bytes, sha256: hash.digest('hex'), name: safeFilename(metadata.name) };
  } finally { dispose(state); if (key) sodium.memzero(key); await source.close(); }
}
module.exports = { encrypt, decrypt, MAX_INPUT, MAX_ENVELOPE, readExact, writeAll, check };
