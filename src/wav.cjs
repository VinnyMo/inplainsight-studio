'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const stream = require('./stream-envelope.cjs');
const { FormatError } = require('./core.cjs');
const MAX_WAV_BYTES = 44 + 2 * stream.MAX_ENVELOPE;
const SAMPLE_RATE = 48000;
const fail = () => { throw new FormatError('Not an intact InPlainSight WAV, or the file exceeds its supported limit.'); };
function header(length) {
  if (!Number.isSafeInteger(length) || length < 96 || length > stream.MAX_ENVELOPE) fail();
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + length * 2, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(length * 2, 40);
  return h;
}
async function convert(input, output, unpack, { signal, progress = () => {} } = {}) {
  stream.check(signal);
  const source = await fs.open(input, 'r'); let dest;
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size > (unpack ? MAX_WAV_BYTES : stream.MAX_ENVELOPE)) fail();
    let remaining = before.size;
    if (unpack) {
      const h = await stream.readExact(source, 44);
      remaining = (before.size - 44) / 2;
      if (!h.equals(header(remaining))) fail();
    } else header(remaining);
    dest = await fs.open(output, 'wx', 0o600);
    if (!unpack) await stream.writeAll(dest, header(remaining));
    const total = remaining;
    while (remaining > 0) {
      stream.check(signal);
      const count = Math.min(32768, remaining);
      const bytes = await stream.readExact(source, count * (unpack ? 2 : 1));
      const converted = Buffer.alloc(count * (unpack ? 1 : 2));
      for (let i = 0; i < count; i++) {
        if (unpack) {
          const sample = bytes.readInt16LE(i * 2);
          if (sample % 16 || sample < -2048 || sample > 2032) fail();
          converted[i] = sample / 16 + 128;
        } else converted.writeInt16LE((bytes[i] - 128) * 16, i * 2);
      }
      await stream.writeAll(dest, converted); remaining -= count;
      progress({ phase: unpack ? 'reading-audio' : 'writing-audio', bytes: total - remaining, total });
    }
    const tail = Buffer.alloc(1);
    if ((await source.read(tail, 0, 1, null)).bytesRead) fail();
    const after = await source.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail();
    stream.check(signal); await dest.sync();
    return { envelopeBytes: total, wavBytes: 44 + total * 2, duration: total / SAMPLE_RATE };
  } finally { await source.close(); if (dest) await dest.close(); }
}
function optionsWithDeadline(options) {
  let until = Date.now() + 120000;
  return { ...options, resetDeadline: () => { until = Date.now() + 120000; }, signal: { get aborted() { return options.signal?.aborted || Date.now() > until; } } };
}
async function temporary(directory) {
  const result = await fs.mkdtemp(path.join(directory, '.ips-wav-'));
  try { await fs.chmod(result, 0o700); } catch (error) { await fs.rm(result, { recursive: true, force: true }); throw error; }
  return result;
}
async function encodeFile(input, password, output, options = {}) {
  options = optionsWithDeadline(options);
  stream.check(options.signal);
  const directory = await temporary(path.dirname(path.resolve(output)));
  try {
    const encrypted = path.join(directory, 'encrypted'), staged = path.join(directory, 'audio.wav'), verify = path.join(directory, 'verified');
    const original = await stream.encrypt(input, encrypted, password, options);
    const result = await convert(encrypted, staged, false, options);
    await convert(staged, verify, true, options);
    const recovered = await stream.decrypt(verify, password, options);
    if (recovered.bytes !== original.bytes || recovered.sha256 !== original.sha256) fail();
    stream.check(options.signal);
    await fs.link(staged, output); // Atomic no-overwrite publication, same filesystem.
    return { ...result, bytes: original.bytes, verified: true, sha256: original.sha256 };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function decodeFile(input, password, output, options = {}) {
  options = optionsWithDeadline(options);
  stream.check(options.signal);
  const directory = await temporary(options.tempRoot || os.tmpdir());
  let destinationDirectory, dest;
  try {
    const encrypted = path.join(directory, 'encrypted');
    await convert(input, encrypted, true, options);
    // Authenticate FINAL, lengths and EOF before asking for a destination or writing plaintext.
    const authenticated = await stream.decrypt(encrypted, password, options);
    stream.check(options.signal);
    const destination = typeof output === 'function' ? await output(authenticated.name) : output;
    if (!destination) return { canceled: true };
    options.resetDeadline(); // User time in the native Save dialog is not processing time.
    stream.check(options.signal);
    destinationDirectory = await temporary(path.dirname(path.resolve(destination)));
    const staged = path.join(destinationDirectory, 'recovered');
    dest = await fs.open(staged, 'wx', 0o600);
    const written = await stream.decrypt(encrypted, password, { ...options, onChunk: async bytes => { stream.check(options.signal); await stream.writeAll(dest, bytes); } });
    if (written.sha256 !== authenticated.sha256 || written.bytes !== authenticated.bytes || written.name !== authenticated.name) fail();
    await dest.sync(); await dest.close(); dest = null;
    stream.check(options.signal); await fs.link(staged, destination);
    return { bytes: written.bytes, name: written.name, sha256: written.sha256 };
  } finally {
    try { if (dest) await dest.close(); } finally {
    try { if (destinationDirectory) await fs.rm(destinationDirectory, { recursive: true, force: true }); }
    finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
  }
}
async function detectCarrier(input) {
  const file = await fs.open(input, 'r');
  try {
    const bytes = Buffer.alloc(12), { bytesRead } = await file.read(bytes, 0, 12, 0);
    return bytesRead === 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' ? 'wav' : 'png';
  } finally { await file.close(); }
}
module.exports = { encodeFile, decodeFile, detectCarrier, convert, header, MAX_WAV_BYTES, MAX_INPUT: stream.MAX_INPUT };
