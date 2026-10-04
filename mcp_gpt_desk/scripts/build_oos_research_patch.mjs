import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const git = process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git';
const revision = execFileSync(git, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync(git, ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'feature/oos-batch-mcp-v1') throw new Error('RESEARCH_PATCH_BRANCH_INVALID');
const candidates = execFileSync(git, ['diff', '--name-only', 'ddd60841110bcf24cb20fe88b3282af77f88792b', revision], { encoding: 'utf8' }).trim().split(/\r?\n/);
const files = candidates.filter(file => file.startsWith('packages/desk-oos-research/')
  || file === 'packages/desk-oos-batch/index.js'
  || /^infra\/postgres\/init\/07[56]_oos_research_[a-z_]+\.sql$/.test(file)
  || /^mcp_gpt_desk\/(package(-lock)?\.json|src\/oos-(research-[a-z-]+|mcp-server|http-server)\.js|scripts\/(serve_oos|[a-z_]+oos_research[a-z_]*)\.mjs|test\/oos_research_[a-z_]+\.test\.js)$/.test(file)
  || /^deploy\/windows\/(Update|Install)-OosResearch[a-zA-Z]*\.ps1$/.test(file));
function archivedBytes(file) {
  const bytes = execFileSync(git, ['show', `${revision}:${file}`]);
  // .gitattributes exports *.ps1 with eol=crlf; hash the transported bytes, not the LF blob.
  return file.endsWith('.ps1') ? Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n')) : bytes;
}
const manifest = { revision, branch, files: files.map(file => ({ path: file,
  sha256: createHash('sha256').update(archivedBytes(file)).digest('hex') })) };
const zip = path.resolve('output', `oos-research-${revision.slice(0, 7)}.zip`);
execFileSync(git, ['archive', '--format=zip', '-o', zip, revision, ...files]);
const metadata = zip.replace(/\.zip$/, '.json');
await writeFile(metadata, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ revision, branch, zip, metadata, files: files.length }));
