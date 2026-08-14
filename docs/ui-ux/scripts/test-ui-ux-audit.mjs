#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-audit-'));
const report = path.join(temp, 'report.json');
fs.mkdirSync(path.join(temp, 'components'), { recursive: true });
fs.writeFileSync(path.join(temp, 'components', 'Bad.tsx'), `
export function Bad() {
  return <div onClick={() => alert('x')}><img src="x.png" />Bad</div>;
}
`);
fs.writeFileSync(path.join(temp, 'bad.css'), `
.bad { font-size: 8px; color: #ff0000; outline: none; transition: all .2s; }
`);
fs.writeFileSync(path.join(temp, 'index.html'), `
<meta name="viewport" content="width=device-width, maximum-scale=1, user-scalable=no">
`);

const result = spawnSync(process.execPath, [path.join(here, 'ui-ux-audit.mjs'), temp, '--json', report], { encoding: 'utf8' });
if (!fs.existsSync(report)) throw new Error(`Report missing\n${result.stdout}\n${result.stderr}`);
const parsed = JSON.parse(fs.readFileSync(report, 'utf8'));
const ids = new Set(parsed.findings.map(item => item.ruleId));
for (const expected of ['UXR-0161', 'UXR-0185', 'UXR-0283', 'UXR-0379', 'UXR-0587']) {
  if (!ids.has(expected)) throw new Error(`Expected ${expected}; got ${[...ids].join(', ')}`);
}
if (result.status !== 1) throw new Error(`Audit should fail on P0 findings, got ${result.status}`);
console.log(`ui-ux-audit self-test passed (${parsed.findings.length} findings).`);
fs.rmSync(temp, { recursive: true, force: true });
