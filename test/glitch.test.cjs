'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const c = require('../src/core.cjs');
const PASS = 'glitch carrier test password';
function rgbOf(png) { const d=PNG.sync.read(png), rgb=Buffer.alloc(d.width*d.height*3); for(let p=0,q=0;p<d.data.length;p+=4){rgb[q++]=d.data[p];rgb[q++]=d.data[p+1];rgb[q++]=d.data[p+2];} return {width:d.width,height:d.height,rgb}; }
function pngOf({width,height,rgb}) { return PNG.sync.write({width,height,data:rgb},{colorType:2,inputColorType:2,inputHasAlpha:false,bitDepth:8}); }
function legacy(envelope) { const height=Math.ceil((envelope.length+4)/3072),rgb=Buffer.alloc(height*3072);rgb.writeUInt32BE(envelope.length);envelope.copy(rgb,4);return pngOf({width:1024,height,rgb}); }
test('plain export is byte-identical legacy format and both carriers recover',async()=>{
  const e=await c.encryptBytes(Buffer.from('legacy-compatible payload'),PASS,'original.txt');
  assert.deepEqual(c.envelopeToPng(e,'plain'),legacy(e));
  for(const appearance of ['plain','glitch']) { const p=c.envelopeToPng(e,appearance);assert.deepEqual(c.pngToEnvelope(p),e);const d=await c.decryptBytes(c.pngToEnvelope(p),PASS);assert.equal(d.name,'original.txt');assert.equal(d.data.toString(),'legacy-compatible payload'); }
  assert.throws(()=>c.envelopeToPng(e,'unknown'),c.FormatError);
});
test('glitch packing is deterministic, has exact visible header, and independently unpacks',async()=>{
  const e=await c.encryptBytes(Buffer.from('pixels'),PASS);const p=c.envelopeToPng(e);assert.deepEqual(c.envelopeToPng(e),p);
  const {rgb,width,height}=rgbOf(p);assert.equal(width,1024);assert.equal(height,256);assert.equal(rgb.toString('ascii',0,8),'IPSPNG02');assert.deepEqual([...rgb.subarray(8,12)],[2,1,0,0]);assert.equal(rgb.readUInt32BE(12),e.length);assert.deepEqual(rgb.subarray(16,48),crypto.createHash('sha256').update(e).digest());
  // Independent bit-stream reconstruction, without the implementation's unpacker.
  const bits=[];for(let q=48;q<48+4*Math.ceil(e.length/3);q++)for(let b=5;b>=0;b--)bits.push((rgb[q]>>>b)&1);
  const recovered=Buffer.alloc(e.length);for(let i=0;i<e.length;i++)for(let b=0;b<8;b++)recovered[i]=(recovered[i]<<1)|bits[i*8+b];assert.deepEqual(recovered,e);
  const highColors=new Set();for(let q=48;q<rgb.length;q+=3)highColors.add(`${rgb[q]>>>6},${rgb[q+1]>>>6},${rgb[q+2]>>>6}`);assert.ok(highColors.size>=4);
});
test('all packing remainders, row boundaries and minimum-height transition round-trip',()=>{
  for(const size of [96,97,98,2267,2268,2269,589787,589788,589789,589824,600000]) {
    const e=crypto.randomBytes(size);Buffer.from('IPSSTUD1').copy(e);e[8]=1;e[9]=1;e.writeUInt32BE(size,10);
    const p=c.envelopeToPng(e);assert.deepEqual(c.pngToEnvelope(p),e);
    assert.equal(rgbOf(p).height,Math.max(256,Math.ceil((48+4*Math.ceil(size/3))/3072)));
  }
});
test('reject carrier fields, digest, payload, artwork, tail bits, padding and extra rows',()=>{
  for(const size of [97,98,99]) {
    const e=Buffer.alloc(size);Buffer.from('IPSSTUD1').copy(e);e[8]=1;e[9]=1;e.writeUInt32BE(size,10);const base=rgbOf(c.envelopeToPng(e));const end=48+4*Math.ceil(size/3);
    for(const [index,mask] of [[0,1],[8,1],[9,1],[10,1],[11,1],[12,128],[15,1],[16,1],[48,1],[48,64],[end,1],[base.rgb.length-1,64],...(size%3?[[end-1,1]]:[])]) {
      const rgb=Buffer.from(base.rgb);rgb[index]^=mask;assert.throws(()=>c.pngToEnvelope(pngOf({...base,rgb})),c.FormatError,`size ${size}, index ${index}, mask ${mask}`);
    }
    assert.throws(()=>c.pngToEnvelope(pngOf({...base,height:base.height+1,rgb:Buffer.concat([base.rgb,Buffer.alloc(3072)])})),c.FormatError);
  }
});
test('consistent rewrapping cannot bypass secretstream authentication',async()=>{
  const e=await c.encryptBytes(Buffer.from('authenticated original'),PASS);e[e.length-1]^=1;
  const p=c.envelopeToPng(e);assert.deepEqual(c.pngToEnvelope(p),e);await assert.rejects(c.decryptBytes(c.pngToEnvelope(p),PASS),c.FormatError);
});
test('maximum 16 MiB payload round-trips in both carriers within input bounds',async()=>{
  const original=crypto.randomBytes(c.MAX_FILE_BYTES);const e=await c.encryptBytes(original,PASS,'maximum.bin');
  for(const appearance of ['plain','glitch']) { const p=c.envelopeToPng(e,appearance);assert.ok(p.length<=c.MAX_PNG_BYTES);const d=await c.decryptBytes(c.pngToEnvelope(p),PASS);assert.deepEqual(d.data,original); }
});
test('transform profile 1 golden pixel vector stays stable',()=>{
  const e=Buffer.alloc(96);Buffer.from('IPSSTUD1').copy(e);e[8]=1;e[9]=1;e.writeUInt32BE(96,10);
  const pixels=PNG.sync.read(c.envelopeToPng(e)).data;
  assert.equal(crypto.createHash('sha256').update(pixels).digest('hex'),'52d41cf59e9188ebdabe402f3c014b5b7b118a7b6bcb8c7546fda18a8896c936');
});
