import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { attachResearchImages } from '../src/oos-research-visual-input.js';

test('verified pixels are placed in private local-image CLI inputs, not merely text references',async()=>{
  const png=Buffer.from('89504e470d0a1a0a','hex'),root=await mkdtemp(path.join(os.tmpdir(),'oos-visual-test-'));
  let observed;
  const adapter={createRunDirectory:async()=>root,cleanupRunDirectory:async()=>rm(root,{recursive:true,force:true}),spawnProcess:async input=>{observed=input;}};
  try {
    attachResearchImages(adapter,[{data:png.toString('base64'),source_sha256:createHash('sha256').update(png).digest('hex')}]);
    await adapter.createRunDirectory();await adapter.spawnProcess({args:['exec','--json','-']});
    const file=observed.args[observed.args.indexOf('--image')+1];assert.deepEqual(await readFile(file),png);
    await adapter.spawnProcess({args:['login','status']});assert.equal(observed.args.includes('--image'),false);
  }finally{await adapter.cleanupRunDirectory(root);}
});
test('changed source pixels fail hash verification before any provider call',()=>{
  assert.throws(()=>attachResearchImages({},[{data:'AAAA',source_sha256:'a'.repeat(64)}]),/VISUAL_INPUT_INVALID/);
});
