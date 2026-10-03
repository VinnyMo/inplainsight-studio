'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const wav = require('./wav.cjs'), stream = require('./stream-envelope.cjs'), media = require('./media-tools.cjs');
const { FormatError } = require('./core.cjs');
const MAX_FLAC_BYTES = 36 * 1024 * 1024;
const fail = (message = 'Not an intact supported InPlainSight FLAC.') => { throw new FormatError(message); };
async function inspect(file) {
  const h = await fs.open(file, 'r');
  try {
    const stat = await h.stat(); if (!stat.isFile() || stat.size < 42 || stat.size > MAX_FLAC_BYTES) fail();
    const first = await stream.readExact(h, 42);
    if (first.toString('ascii', 0, 4) !== 'fLaC' || (first[4] & 127) !== 0 || first.readUIntBE(5, 3) !== 34) fail();
    const bits = first.readBigUInt64BE(18), rate = Number(bits >> 44n), channels = Number((bits >> 41n) & 7n) + 1;
    const depth = Number((bits >> 36n) & 31n) + 1, samples = Number(bits & 0xfffffffffn);
    if (rate !== 48000 || channels !== 1 || depth !== 16 || samples < 96 || samples > stream.MAX_ENVELOPE) fail();
    if (first.readUInt16BE(8) !== 4096 || first.readUInt16BE(10) !== 4096) fail();
    const md5 = first.subarray(26, 42); if (md5.every(b => b === 0)) fail();
    let last = Boolean(first[4] & 128), offset = 42, blocks = 1;
    while (!last) {
      if (++blocks > 8) fail();
      const bh = await stream.readExact(h, 4), type = bh[0] & 127, size = bh.readUIntBE(1, 3);
      if (![1, 4].includes(type) || size > 16384 || offset + 4 + size > 65536) fail();
      const data = await stream.readExact(h, size);
      if (type === 1 && data.some(b => b !== 0)) fail();
      offset += 4 + size; last = Boolean(bh[0] & 128);
    }
    if (offset >= stat.size) fail();
    return { samples, md5: md5.toString('hex'), bytes: stat.size, audioOffset: offset };
  } finally { await h.close(); }
}
async function copyBounded(input, output, limit, signal) {
  const source = await fs.open(input, 'r'); let dest;
  try {
    const before = await source.stat(); if (!before.isFile() || before.size > limit) fail('FLAC input exceeds the 36 MiB file limit.');
    dest = await fs.open(output, 'wx', 0o600); const buffer = Buffer.alloc(65536); let bytes = 0;
    for (;;) { stream.check(signal); const r = await source.read(buffer); if (!r.bytesRead) break; bytes += r.bytesRead; if (bytes > before.size || bytes > limit) fail(); await stream.writeAll(dest, buffer.subarray(0, r.bytesRead)); }
    const after = await source.stat(); if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('Input changed while reading.');
    await dest.sync();
  } finally { try { await source.close(); } finally { if (dest) await dest.close(); } }
}
async function decodeAudio(input, output, options = {}) {
  const info = await inspect(input), executable = options.ffmpeg || await media.resolveFfmpeg();
  let job, dest; const md5 = crypto.createHash('md5'); let bytes = 0;
  try {
    dest = await fs.open(output, 'wx', 0o600); await stream.writeAll(dest, wav.header(info.samples));
    job = media.launch(executable, ['-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-max_alloc', '16777216', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-err_detect', 'crccheck+explode', '-f', 'flac', '-i', path.resolve(input), '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_s16le', '-threads', '1', '-f', 's16le', 'pipe:1'], options);
    for await (const chunk of job.child.stdout) {
      stream.check(options.signal); bytes += chunk.length; if (bytes > info.samples * 2) fail('Decoded FLAC exceeds its declared sample limit.');
      md5.update(chunk); await stream.writeAll(dest, chunk); options.progress?.({ phase: 'decoding-flac', bytes, total: info.samples * 2 });
    }
    const stderr = await job.finish();
    if (stderr.trim() || bytes !== info.samples * 2 || md5.digest('hex') !== info.md5) fail();
    await dest.sync(); return info;
  } finally { try { if (job) await job.stop(); } finally { if (dest) await dest.close(); } }
}
async function encodeAudio(input, output, options = {}) {
  const executable = options.ffmpeg || await media.resolveFfmpeg(); let job, timer, oversized = false;
  try {
    job = media.launch(executable, ['-hide_banner', '-v', 'error', '-nostdin', '-max_alloc', '16777216', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-f', 'wav', '-i', path.resolve(input), '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-c:a', 'flac', '-compression_level', '5', '-frame_size', '4096', '-threads', '1', '-fs', String(MAX_FLAC_BYTES), '-f', 'flac', '-n', path.resolve(output)], options);
    job.child.stdout.resume();
    timer = setInterval(() => { fs.stat(output).then(s => { if (s.size > MAX_FLAC_BYTES) { oversized = true; job.child.kill(); } }).catch(() => {}); }, 50);
    const stderr = await job.finish(); if (oversized || stderr.trim() || (await fs.stat(output)).size > MAX_FLAC_BYTES) fail('FLAC output exceeds the supported limit or encoding failed.');
    options.progress?.({ phase: 'encoded-flac' }); return await inspect(output);
  } finally { clearInterval(timer); if (job) await job.stop(); }
}
async function hash(file) {
  const source = await fs.open(file, 'r'), h = crypto.createHash('sha256'), buffer = Buffer.alloc(65536);
  try { for (;;) { const r = await source.read(buffer); if (!r.bytesRead) break; h.update(buffer.subarray(0, r.bytesRead)); } return h.digest('hex'); } finally { await source.close(); }
}
async function temporary(parent) {
  const directory = await fs.mkdtemp(path.join(parent, '.ips-flac-'));
  try { await fs.chmod(directory, 0o700); return directory; } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
async function encodeFile(input, password, output, options = {}) {
  stream.check(options.signal);
  const ffmpeg = options.ffmpeg || await media.resolveFfmpeg(), directory = await temporary(path.dirname(path.resolve(output)));
  options = { ...options, ffmpeg };
  try {
    const audio = path.join(directory, 'verified.wav'), staged = path.join(directory, 'encoded.flac'), decoded = path.join(directory, 'decoded.wav');
    const source = await wav.encodeFile(input, password, audio, options);
    const info = await encodeAudio(audio, staged, options);
    await decodeAudio(staged, decoded, options);
    if (await hash(audio) !== await hash(decoded)) fail('FLAC changed the verified PCM payload.');
    stream.check(options.signal); await fs.link(staged, output);
    return { bytes: source.bytes, flacBytes: info.bytes, wavBytes: source.wavBytes, duration: source.duration, verified: true, sha256: source.sha256 };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function decodeFile(input, password, output, options = {}) {
  stream.check(options.signal);
  const ffmpeg = options.ffmpeg || await media.resolveFfmpeg(), directory = await temporary(options.tempRoot || os.tmpdir());
  options = { ...options, ffmpeg };
  try {
    const pinned = path.join(directory, 'input.flac'), audio = path.join(directory, 'decoded.wav');
    await copyBounded(input, pinned, MAX_FLAC_BYTES, options.signal);
    await decodeAudio(pinned, audio, options);
    return await wav.decodeFile(audio, password, output, options);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function detectCarrier(input) {
  const file = await fs.open(input, 'r'); let signature;
  try { const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 0); signature = bytes.toString('ascii'); } finally { await file.close(); }
  return signature === 'fLaC' ? 'flac' : wav.detectCarrier(input);
}
module.exports = { encodeFile, decodeFile, detectCarrier, inspect, encodeAudio, decodeAudio, MAX_FLAC_BYTES, MAX_INPUT: wav.MAX_INPUT };
