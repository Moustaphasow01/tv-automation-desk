import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Adds verified actual pixels to an already isolated CLI transport, never to a URL-only prompt. */
export function attachResearchImages(adapter, images = []) {
  if (!images.length) return;
  if (images.length > 4) throw Object.assign(new Error('RESEARCH_VISUAL_LIMIT'), { code: 'RESEARCH_VISUAL_LIMIT' });
  const bytes = images.map(image => {
    const buffer = Buffer.from(image.data, 'base64');
    if (!buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || buffer.length > 12*1024*1024
      || createHash('sha256').update(buffer).digest('hex') !== image.source_sha256)
      throw Object.assign(new Error('RESEARCH_VISUAL_INPUT_INVALID'), { code: 'RESEARCH_VISUAL_INPUT_INVALID' });
    return buffer;
  });
  const create = adapter.createRunDirectory.bind(adapter), spawn = adapter.spawnProcess.bind(adapter);
  let paths;
  adapter.createRunDirectory = async () => {
    const root = await create(); paths = bytes.map((_,i) => path.join(root,`evidence-${i}.png`));
    try { await Promise.all(paths.map((file,i) => writeFile(file,bytes[i],{flag:'wx',mode:0o600}))); }
    catch(error) { await adapter.cleanupRunDirectory(root); throw error; }
    return root;
  };
  adapter.spawnProcess = input => {
    if (!input.args.includes('exec')) return spawn(input);
    if (!paths) throw new Error('RESEARCH_VISUAL_CONTEXT_NOT_PREPARED');
    const args = [...input.args], end = args.lastIndexOf('-');
    args.splice(end < 0 ? args.length : end,0,'--image',paths.join(','));
    return spawn({...input,args});
  };
}
