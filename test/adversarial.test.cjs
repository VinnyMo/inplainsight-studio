'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const sodium = require('libsodium-wrappers-sumo');
const crc = require('pngjs/lib/crc');
const c = require('../src/core.cjs');
const PASS = 'independent review test password';
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
async function crafted(meta, frames) {
  await sodium.ready;
  const salt = sodium.randombytes_buf(16), key = sodium.crypto_pwhash(32, PASS, salt, 3, 64*1024*1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const stream = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  try {
    const messages = [{data: Buffer.from(JSON.stringify(meta)), tag: 0}, ...frames];
    const total = 54 + messages.reduce((n, f) => n + f.data.length + 21, 0);
    const header = Buffer.concat([Buffer.from('IPSSTUD1'), Buffer.from([1,1]), u32(total), Buffer.from(salt), Buffer.from(stream.header)]);
    return Buffer.concat([header, ...messages.flatMap((f,i) => { const length=u32(f.data.length+17); return [length, Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(stream.state,f.data,Buffer.concat([header,u32(i),length]),f.tag))]; })]);
  } finally { const w=sodium.libsodium; w.HEAPU8.fill(0,stream.state,stream.state+w._crypto_secretstream_xchacha20poly1305_statebytes()); w._free(stream.state); sodium.memzero(key); }
}
function chunk(type, data) { const body=Buffer.concat([Buffer.from(type),data]), check=Buffer.alloc(4); check.writeInt32BE(crc.crc32(body)); return Buffer.concat([u32(data.length),body,check]); }
function replaceIdat(png, transform) { const size=png.readUInt32BE(33); return Buffer.concat([png.subarray(0,33),transform(png.subarray(41,41+size)),png.subarray(45+size)]); }
test('authenticated malformed metadata, frame lengths and final tags are rejected', async()=>{
  const one=Buffer.from('x');
  for (const [meta,frames] of [
    [{name:'x',size:1},[{data:one,tag:0}]],
    [{name:'x',size:1},[{data:one,tag:1}]],
    [{name:'x',size:2},[{data:one,tag:3}]],
    [{name:'x',size:-1},[{data:one,tag:3}]],
    [{name:'x',size:c.MAX_FILE_BYTES+1},[{data:one,tag:3}]],
    [{name:'x',size:0},[{data:Buffer.alloc(0),tag:3},{data:one,tag:3}]],
    [{name:'x'.repeat(201),size:1},[{data:one,tag:3}]],
  ]) await assert.rejects(c.decryptBytes(await crafted(meta,frames),PASS),c.FormatError);
});
test('PNG rejects IDAT floods, excess inflation and compressed trailing bytes with valid CRCs',async()=>{
  const p=c.envelopeToPng(await c.encryptBytes(Buffer.from('x'),PASS));
  const variants=[
    replaceIdat(p,d=>Buffer.concat([chunk('IDAT',Buffer.alloc(0)),chunk('IDAT',d)])),
    replaceIdat(p,d=>Buffer.concat([chunk('IDAT',d.subarray(0,1)),chunk('IDAT',d.subarray(1))])),
    replaceIdat(p,d=>chunk('IDAT',Buffer.concat([d,Buffer.from([0])]))),
    replaceIdat(p,d=>chunk('IDAT',zlib.deflateSync(Buffer.concat([zlib.inflateSync(d),Buffer.alloc(1000000)])))),
  ];
  for(const p of variants) assert.throws(()=>c.pngToEnvelope(p),c.FormatError);
});
test('failed plaintext writes and fsync leave no final or temporary file',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ips-adversarial-'));
  const realOpen=fs.open;
  try {
    const png=path.join(dir,'in.png'),out=path.join(dir,'out.bin');
    await fs.writeFile(png,c.envelopeToPng(await c.encryptBytes(Buffer.from('synthetic secret'),PASS)));
    for(const failure of ['writeFile','sync']) {
      fs.open=async function(file,...args) { const handle=await realOpen.call(fs,file,...args); if(path.basename(file)==='payload') { const original=handle[failure].bind(handle); handle[failure]=async(...params)=>{ if(failure==='writeFile') await handle.write(Buffer.from('partial')); else await original(...params); throw new Error('injected '+failure); }; } return handle; };
      try { await assert.rejects(c.decodeFile(png,PASS,out),new RegExp('injected '+failure)); } finally {fs.open=realOpen;}
      assert.deepEqual(await fs.readdir(dir),['in.png']);
    }
  } finally {fs.open=realOpen; await fs.rm(dir,{recursive:true,force:true});}
});

test('existing symlink is unchanged',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ips-symlink-'));
  try {
    const png=path.join(dir,'in.png'),out=path.join(dir,'out.bin'),target=path.join(dir,'target');
    await fs.writeFile(target,'untouched');
    try { await fs.symlink(target,out); }
    catch(error) {
      if(process.platform==='win32' && error.code==='EPERM') {
        t.skip('Windows account lacks file-symlink privilege; no security settings changed');
        return;
      }
      throw error;
    }
    await fs.writeFile(png,c.envelopeToPng(await c.encryptBytes(Buffer.from('synthetic secret'),PASS)));
    await assert.rejects(c.decodeFile(png,PASS,out),{code:'EEXIST'});
    assert.equal(await fs.readFile(target,'utf8'),'untouched'); assert.equal(await fs.readlink(out),target);
    assert.deepEqual((await fs.readdir(dir)).sort(),['in.png','out.bin','target']);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('Windows case-insensitive destination collisions never overwrite existing data',{skip:process.platform!=='win32'},async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ips-case-collision-'));
  try {
    const png=path.join(dir,'in.png'),existing=path.join(dir,'Existing.txt'),alias=path.join(dir,'EXISTING.TXT');
    await fs.writeFile(existing,'untouched');
    try { await fs.stat(alias); }
    catch(error) {
      if(error.code==='ENOENT') { t.skip('Test directory uses a case-sensitive filesystem'); return; }
      throw error;
    }
    await fs.writeFile(png,c.envelopeToPng(await c.encryptBytes(Buffer.from('synthetic secret'),PASS)));
    await assert.rejects(c.decodeFile(png,PASS,alias),{code:'EEXIST'});
    assert.equal(await fs.readFile(existing,'utf8'),'untouched');
    assert.deepEqual((await fs.readdir(dir)).sort(),['Existing.txt','in.png']);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('secretstream state is zeroed before free and duplicate pull buffers are cleared',async()=>{
  await sodium.ready;
  const w=sodium.libsodium, originalFree=w._free, originalPush=sodium.crypto_secretstream_xchacha20poly1305_init_push, originalPull=sodium.crypto_secretstream_xchacha20poly1305_init_pull, originalRead=sodium.crypto_secretstream_xchacha20poly1305_pull;
  const pending=new Set(), messages=[]; let freed=0;
  w._free=function(address){if(pending.has(address)){assert.ok(w.HEAPU8.subarray(address,address+w._crypto_secretstream_xchacha20poly1305_statebytes()).every(b=>b===0));pending.delete(address);freed++;}return originalFree(address);};
  sodium.crypto_secretstream_xchacha20poly1305_init_push=function(...args){const s=originalPush(...args);pending.add(s.state);return s;};
  sodium.crypto_secretstream_xchacha20poly1305_init_pull=function(...args){const s=originalPull(...args);pending.add(s);return s;};
  sodium.crypto_secretstream_xchacha20poly1305_pull=function(...args){const r=originalRead(...args);if(r)messages.push(r.message);return r;};
  try {
    const e=await c.encryptBytes(Buffer.from('test-only secret'),PASS); await c.decryptBytes(e,PASS);
    await assert.rejects(c.decryptBytes(e,'wrong password but long enough'));
    assert.equal(pending.size,0); assert.equal(freed,3); assert.ok(messages.length>=2); assert.ok(messages.every(m=>m.every(b=>b===0)));
  } finally {w._free=originalFree;sodium.crypto_secretstream_xchacha20poly1305_init_push=originalPush;sodium.crypto_secretstream_xchacha20poly1305_init_pull=originalPull;sodium.crypto_secretstream_xchacha20poly1305_pull=originalRead;}
});

test('legacy v1 metadata paths are sanitized only as suggestions after full authentication', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-legacy-name-'));
  const png = path.join(dir, 'legacy.png');
  try {
    for (const [name, expected] of [['C:\\private\\CON.txt', '_CON.txt'], ['../../escape.txt', 'escape.txt'], ['', 'recovered-file.bin']]) {
      await fs.writeFile(png, c.envelopeToPng(await crafted({ name, size: 1 }, [{ data: Buffer.from('x'), tag: 3 }])));
      const result = await c.decodeFile(png, PASS, suggested => {
        assert.equal(suggested, expected);
        return null;
      });
      assert.equal(result.canceled, true);
      assert.deepEqual(await fs.readdir(dir), ['legacy.png']);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
