'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const c = require('../src/core.cjs');
const PASS = 'four unusual words and more';
function frames(b) { let off = 54, a = []; while (off < b.length) { let n = b.readUInt32BE(off); a.push(b.subarray(off, off + n + 4)); off += n + 4; } return a; }
test('round-trip empty, binary, and multiframe files through actual PNG pixels', async () => {
  for (const size of [0, 1, 65536, 65537, 200000]) {
    const data = crypto.randomBytes(size), envelope = await c.encryptBytes(data, PASS, 'hello.bin');
    const png = c.envelopeToPng(envelope), result = await c.decryptBytes(c.pngToEnvelope(png), PASS);
    assert.deepEqual(result.data, data); assert.equal(result.name, 'hello.bin');
  }
});
test('randomized ciphertext and no visible filename', async () => {
  const a = await c.encryptBytes(Buffer.from('private'), PASS, 'secret-name.pdf');
  const b = await c.encryptBytes(Buffer.from('private'), PASS, 'secret-name.pdf');
  assert.notDeepEqual(a, b); assert.equal(a.includes(Buffer.from('secret-name.pdf')), false);
});
test('wrong passwords, modified headers/ciphertext and all truncation positions fail', async () => {
  const e = await c.encryptBytes(Buffer.from('payload'), PASS);
  await assert.rejects(c.decryptBytes(e, 'a different long password'));
  for (const position of [0, 8, 9, 10, 14, 30, 54, 58, e.length - 1]) { const changed = Buffer.from(e); changed[position] ^= 1; await assert.rejects(c.decryptBytes(changed, PASS)); }
  for (let n = 0; n < e.length; n++) await assert.rejects(c.decryptBytes(e.subarray(0, n), PASS));
});
test('reordering, duplication, missing final, appended bytes, changed length fail', async () => {
  const e = await c.encryptBytes(crypto.randomBytes(150000), PASS), f = frames(e);
  for (const changed of [Buffer.concat([e, Buffer.from([0])]), Buffer.concat([e.subarray(0,54),f[0],f[2],f[1],f[3]]), Buffer.concat([e.subarray(0,54),f[0],f[1],f[1],f[3]]), e.subarray(0,e.length-f[3].length)]) await assert.rejects(c.decryptBytes(changed,PASS));
});
test('PNG refuses malformed dimensions, CRC, trailing bytes, noncanonical padding', async () => {
  const e = await c.encryptBytes(Buffer.from('payload'), PASS), p = c.envelopeToPng(e);
  for (const changed of [Buffer.concat([p,Buffer.from([0])]),p.subarray(0,p.length-1)]) assert.throws(()=>c.pngToEnvelope(changed));
  const huge = Buffer.from(p); huge.writeUInt32BE(0xffffffff,16); assert.throws(()=>c.pngToEnvelope(huge));
  const crc = Buffer.from(p); crc[crc.length-1]^=1; assert.throws(()=>c.pngToEnvelope(crc));
  const decoded=PNG.sync.read(p); decoded.data[decoded.data.length-4]=1;
  const padding=PNG.sync.write(decoded,{colorType:2}); assert.throws(()=>c.pngToEnvelope(padding));
});
test('reject oversized input and weak/mis-sized password', async()=>{
  await assert.rejects(c.encryptBytes(Buffer.alloc(c.MAX_FILE_BYTES+1),PASS));
  await assert.rejects(c.encryptBytes(Buffer.alloc(0),'short'));
  await assert.rejects(c.encryptBytes(Buffer.alloc(0),'x'.repeat(1025)));
});
test('file API never overwrites, creates no output on auth failure, ignores metadata paths',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ips-test-'));
  try {
    const input=path.join(dir,'input.bin'), png=path.join(dir,'encoded.png'), out=path.join(dir,'out.bin');
    await fs.writeFile(input,crypto.randomBytes(1000)); await c.encodeFile(input,PASS,png);
    await assert.rejects(c.decodeFile(png,'not the correct password',out)); await assert.rejects(fs.access(out));
    await c.decodeFile(png,PASS,out); assert.deepEqual(await fs.readFile(out),await fs.readFile(input));
    await assert.rejects(c.decodeFile(png,PASS,out),{code:'EEXIST'});
    await assert.rejects(c.encodeFile(input,PASS,input),{code:'EEXIST'});
    const crafted=c.envelopeToPng(await c.encryptBytes(Buffer.from('safe'),PASS,'../../escape.txt')); await fs.writeFile(png,crafted);
    const chosen=path.join(dir,'chosen.bin'); await c.decodeFile(png,PASS,chosen); assert.equal((await fs.readFile(chosen)).toString(),'safe');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('export verification rejects corrupted generated PNG before publication',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ips-verify-'));
  const original=PNG.sync.write;
  try {
    const input=path.join(dir,'in.bin'), output=path.join(dir,'out.png');
    await fs.writeFile(input,'original');
    PNG.sync.write=(...args)=>{ const bytes=original(...args); bytes[bytes.length-1]^=1; return bytes; };
    await assert.rejects(c.encodeFile(input,PASS,output));
    await assert.rejects(fs.access(output));
    assert.equal((await fs.readFile(input)).toString(),'original');
  } finally { PNG.sync.write=original; await fs.rm(dir,{recursive:true,force:true}); }
});
