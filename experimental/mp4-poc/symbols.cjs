'use strict';
const crypto = require('node:crypto');
const { MAX_ENVELOPE } = require('./crypto-stream.cjs');
const WIDTH = 1280, HEIGHT = 720, CELL = 8, COLS = 160, ROWS = 90;
const PACKET = 768, PAYLOAD = PACKET - 64, WORDS = PACKET * 2, COPIES = 3;
function encodeNibble(n) {
  const b = [0, 0, 0, (n >>> 3) & 1, 0, (n >>> 2) & 1, (n >>> 1) & 1, n & 1, 0];
  b[1] = b[3] ^ b[5] ^ b[7]; b[2] = b[3] ^ b[6] ^ b[7]; b[4] = b[5] ^ b[6] ^ b[7];
  for (let p = 1; p <= 7; p++) b[8] ^= b[p];
  let result = 0; for (let p = 1; p <= 8; p++) result |= b[p] << (p - 1); return result;
}
function decodeWord(word) {
  const b = p => (word >>> (p - 1)) & 1;
  const syndrome = (b(1) ^ b(3) ^ b(5) ^ b(7)) | ((b(2) ^ b(3) ^ b(6) ^ b(7)) << 1) | ((b(4) ^ b(5) ^ b(6) ^ b(7)) << 2);
  let parity = 0; for (let p = 1; p <= 8; p++) parity ^= b(p);
  if (syndrome && !parity) throw new Error('Uncorrectable symbol');
  if (parity) word ^= 1 << ((syndrome || 8) - 1);
  return { nibble: (b(3) << 3) | (b(5) << 2) | (b(6) << 1) | b(7), corrected: parity };
}
function checksum(packet) { return crypto.createHash('sha256').update(packet.subarray(0, 44)).update(packet.subarray(60)).digest().subarray(0, 16); }
function makePacket(data, index, total, streamId) {
  const count = Math.ceil(total / PAYLOAD), expected = Math.min(PAYLOAD, total - index * PAYLOAD);
  if (total < 96 || total > MAX_ENVELOPE || index < 0 || index >= count || data.length !== expected || streamId.length !== 16) throw new Error('Packet bounds');
  const packet = Buffer.alloc(PACKET); packet.write('IPSV0001'); packet[8] = 1; packet[9] = COPIES; packet[10] = index === count - 1 ? 1 : 0;
  packet.writeUInt32BE(index, 12); packet.writeUInt32BE(count, 16); packet.writeUInt32BE(total, 20); packet.writeUInt16BE(data.length, 24); streamId.copy(packet, 28); data.copy(packet, 64); checksum(packet).copy(packet, 44); return packet;
}
function parsePacket(packet) {
  if (packet.length !== PACKET || packet.toString('ascii', 0, 8) !== 'IPSV0001' || packet[8] !== 1 || packet[9] !== COPIES || packet[11] || packet[26] || packet[27] || packet.readUInt32BE(60) || !checksum(packet).equals(packet.subarray(44, 60))) throw new Error('Invalid frame packet');
  const index = packet.readUInt32BE(12), count = packet.readUInt32BE(16), total = packet.readUInt32BE(20), valid = packet.readUInt16BE(24);
  if (total < 96 || total > MAX_ENVELOPE || count !== Math.ceil(total / PAYLOAD) || index >= count || valid !== Math.min(PAYLOAD, total - index * PAYLOAD) || packet[10] !== (index === count - 1 ? 1 : 0) || packet.subarray(64 + valid).some(v => v)) throw new Error('Invalid packet lengths or final marker');
  return { index, count, total, streamId: packet.subarray(28, 44), data: packet.subarray(64, 64 + valid), packet };
}
function paintCell(frame, slot, value) {
  const x = 2 + slot % (COLS - 4), y = 2 + Math.floor(slot / (COLS - 4));
  for (let dy = 0; dy < CELL; dy++) frame.fill(value, (y * CELL + dy) * WIDTH + x * CELL, (y * CELL + dy) * WIDTH + (x + 1) * CELL);
}
function raster(packet) {
  const frame = Buffer.alloc(WIDTH * HEIGHT, 16);
  // Fixed alternating border provides visible black/white calibration, never payload metadata.
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x < 2 || y < 2 || x >= COLS - 2 || y >= ROWS - 2) {
    for (let dy = 0; dy < CELL; dy++) frame.fill((x + y) % 2 ? 235 : 16, (y * CELL + dy) * WIDTH + x * CELL, (y * CELL + dy) * WIDTH + (x + 1) * CELL);
  }
  // Bit-plane interleave: nearby cells belong to distinct SECDED words.
  for (let w = 0; w < WORDS; w++) { const word = encodeNibble(w & 1 ? packet[w >>> 1] & 15 : packet[w >>> 1] >>> 4); for (let bit = 0; bit < 8; bit++) paintCell(frame, bit * WORDS + w, (word >>> bit) & 1 ? 235 : 16); }
  return frame;
}
function cellMean(frame, x, y) { let total = 0; for (let dy = 2; dy < 6; dy++) for (let dx = 2; dx < 6; dx++) total += frame[(y * CELL + dy) * WIDTH + x * CELL + dx]; return total / 16; }
function unraster(frame) {
  if (frame.length !== WIDTH * HEIGHT) throw new Error('Frame size');
  let black = 0, white = 0; for (let x = 0; x < COLS; x++) { const v = cellMean(frame, x, 0); if (x & 1) white += v; else black += v; } black /= COLS / 2; white /= COLS / 2;
  if (white - black < 80) throw new Error('Calibration failed'); const threshold = (black + white) / 2;
  const packet = Buffer.alloc(PACKET); let corrections = 0;
  for (let w = 0; w < WORDS; w++) {
    let word = 0; for (let bit = 0; bit < 8; bit++) { const slot = bit * WORDS + w; if (cellMean(frame, 2 + slot % (COLS - 4), 2 + Math.floor(slot / (COLS - 4))) > threshold) word |= 1 << bit; }
    const decoded = decodeWord(word); corrections += decoded.corrected; packet[w >>> 1] |= decoded.nibble << (w & 1 ? 0 : 4);
  }
  return { ...parsePacket(packet), corrections };
}
module.exports = { WIDTH, HEIGHT, CELL, COLS, ROWS, PACKET, PAYLOAD, WORDS, COPIES, encodeNibble, decodeWord, makePacket, parsePacket, raster, unraster, paintCell };
