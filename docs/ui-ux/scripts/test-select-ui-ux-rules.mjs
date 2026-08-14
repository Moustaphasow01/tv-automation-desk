#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [
  path.join(here, 'select-ui-ux-rules.mjs'),
  'live trading risk command timeline',
  '--priority', 'P0,P1',
  '--limit', '25',
  '--json',
], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const payload = JSON.parse(result.stdout);
if (payload.rules.length === 0) throw new Error('No rules selected.');
if (!payload.rules.some(rule => [32, 35, 47, 50].includes(rule.chapter))) {
  throw new Error(`Expected high-stakes/live chapters, got ${payload.rules.map(r => r.chapter).join(',')}`);
}
if (!payload.rules.every(rule => ['P0', 'P1'].includes(rule.priority))) throw new Error('Priority filter failed.');
console.log(`rule selector self-test passed (${payload.rules.length} rules).`);
