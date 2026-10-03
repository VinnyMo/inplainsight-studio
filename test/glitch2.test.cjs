'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PNG}=require('pngjs'); const c=require('../src/core.cjs');
function envelope(n){const e=crypto.randomBytes(n);Buffer.from('IPSSTUD1').copy(e);e[8]=1;e[9]=1;e.writeUInt32BE(n,10);return e;}
function pixels(p){const d=PNG.sync.read(p),rgb=Buffer.alloc(d.width*d.height*3);for(let p=0,q=0;p<d.data.length;p+=4){rgb[q++]=d.data[p];rgb[q++]=d.data[p+1];rgb[q++]=d.data[p+2];}return{width:d.width,height:d.height,rgb};}
function png(d){return PNG.sync.write({width:d.width,height:d.height,data:d.rgb},{colorType:2,inputColorType:2,inputHasAlpha:false,bitDepth:8});}
test('profile 2 header, deterministic pixels, independent nibble extraction and visible padding',()=>{
 const e=envelope(1003),p=c.envelopeToPng(e,'glitch',2),d=pixels(p);assert.deepEqual(c.envelopeToPng(e,'glitch',2),p);assert.equal(d.height,768);assert.deepEqual([...d.rgb.subarray(8,12)],[2,2,0,0]);
 const recovered=Buffer.alloc(e.length);for(let i=0;i<e.length;i++)recovered[i]=((d.rgb[48+2*i]&15)<<4)|(d.rgb[49+2*i]&15);assert.deepEqual(recovered,e);assert.deepEqual(c.pngToEnvelope(p),e);
 const levels=new Set();for(let i=48;i<d.rgb.length;i++)levels.add(d.rgb[i]>>>4);assert.ok(levels.size>10);assert.ok(d.rgb.subarray(48+2*e.length).some(v=>(v&15)!==0));
});
test('profile 2 size and block-row boundaries are canonical',()=>{
 for(const n of [96,97,98,1511,1512,1513,1179623,1179624,1179625,1204199,1204200,1204201]){const e=envelope(n),p=c.envelopeToPng(e,'glitch',2);assert.deepEqual(c.pngToEnvelope(p),e);assert.equal(pixels(p).height,Math.max(768,16*Math.ceil((48+2*n)/(3072*16))));}
 assert.throws(()=>c.envelopeToPng(envelope(96),'glitch',4),c.FormatError);
});
test('profile 2 rejects header, payload, artwork, canonical grain and dimensions tampering',()=>{
 const e=envelope(101),d=pixels(c.envelopeToPng(e,'glitch',2));
 for(const [index,mask] of [[0,1],[8,1],[9,1],[10,1],[11,1],[12,128],[15,1],[16,1],[48,1],[48,16],[49,128],[250,1],[d.rgb.length-1,1],[d.rgb.length-2,128]]){const rgb=Buffer.from(d.rgb);rgb[index]^=mask;assert.throws(()=>c.pngToEnvelope(png({...d,rgb})),c.FormatError,`index ${index} mask ${mask}`);}
 assert.throws(()=>c.pngToEnvelope(png({...d,height:d.height+16,rgb:Buffer.concat([d.rgb,Buffer.alloc(3072*16)])})),c.FormatError);
 const p=c.envelopeToPng(e,'glitch',2);p.writeUInt32BE(10945,20);assert.throws(()=>c.pngToEnvelope(p),c.FormatError);
});
test('profile 2 independently authenticated rewrap and legacy compatibility',async()=>{
 const password='new carrier compatibility password',e=await c.encryptBytes(Buffer.from('private exact bytes'),password,'name.bin');
 for(const profile of [1,2]){const p=c.envelopeToPng(e,'glitch',profile);const result=await c.decryptBytes(c.pngToEnvelope(p),password);assert.equal(result.name,'name.bin');assert.equal(result.data.toString(),'private exact bytes');}
 const e2=Buffer.from(e);e2[e2.length-1]^=1;const p=c.envelopeToPng(e2,'glitch',2);await assert.rejects(c.decryptBytes(c.pngToEnvelope(p),password),c.FormatError);
});
test('profile 2 integer artwork golden vector',()=>{
 const e=Buffer.alloc(96);Buffer.from('IPSSTUD1').copy(e);e[8]=1;e[9]=1;e.writeUInt32BE(96,10);
 assert.equal(crypto.createHash('sha256').update(PNG.sync.read(c.envelopeToPng(e,'glitch',2)).data).digest('hex'),'e3f136718f1a5f2c2b124615cce038ce0d2c921be35cc0a773450ddbdd181e1f');
});
test('profile 2 absolute envelope ceiling and resource rejection',()=>{
 const size=c.MAX_FILE_BYTES+16384,e=envelope(size),p=c.envelopeToPng(e,'glitch',2);assert.equal(p.readUInt32BE(20),10944);assert.ok(p.length<=36*1024*1024);assert.deepEqual(c.pngToEnvelope(p),e);
 assert.throws(()=>c.envelopeToPng(Buffer.alloc(size+1)),c.FormatError);
 assert.throws(()=>c.pngToEnvelope(Buffer.alloc(c.MAX_PNG_BYTES+1)),c.FormatError);
 const tooTall=Buffer.from(p);tooTall.writeUInt32BE(10945,20);const read=PNG.sync.read;let called=false;PNG.sync.read=(...a)=>{called=true;return read(...a);};try{assert.throws(()=>c.pngToEnvelope(tooTall),c.FormatError);assert.equal(called,false);}finally{PNG.sync.read=read;}
});
