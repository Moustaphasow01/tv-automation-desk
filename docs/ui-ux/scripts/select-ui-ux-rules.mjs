#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesFile = path.resolve(here, '..', 'ui-ux-rules.json');
const payload = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Usage:
  node select-ui-ux-rules.mjs "<task description>" [--priority P0,P1] [--chapter 14,15] [--limit 60] [--json]

Examples:
  node select-ui-ux-rules.mjs "live trading risk timeline commands"
  node select-ui-ux-rules.mjs "accessible modal form errors" --priority P0,P1 --limit 40
  node select-ui-ux-rules.mjs "" --chapter 31,32,47 --json`);
  process.exit(0);
}

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const query = (args[0] && !args[0].startsWith('--') ? args[0] : '').trim();
const priorityArg = option('--priority', 'P0,P1,P2,P3');
const chapterArg = option('--chapter', '');
const limit = Math.max(1, Math.min(1000, Number(option('--limit', '60')) || 60));
const jsonOutput = args.includes('--json');
const priorities = new Set(priorityArg.split(',').map(v => v.trim()).filter(Boolean));
const chapters = new Set(chapterArg.split(',').map(v => v.trim()).filter(Boolean).map(Number).filter(Number.isFinite));

const stopWords = new Set(['avec', 'dans', 'pour', 'sans', 'une', 'des', 'les', 'que', 'qui', 'sur', 'par', 'and', 'the', 'for', 'with', 'from', 'this']);
function tokens(text) {
  return [...new Set(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !stopWords.has(token)))];
}
const queryTokens = tokens(query);
const priorityWeight = { P0: 40, P1: 20, P2: 8, P3: 2 };

function score(rule) {
  const haystack = `${rule.chapter_title} ${rule.statement} ${rule.evidence}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let value = priorityWeight[rule.priority] ?? 0;
  if (chapters.has(rule.chapter)) value += 1000;
  for (const token of queryTokens) {
    const occurrences = haystack.split(token).length - 1;
    if (occurrences > 0) value += 12 + Math.min(occurrences, 3) * 3;
    if (rule.chapter_title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(token)) value += 18;
  }
  if (query && haystack.includes(query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) value += 50;
  return value;
}

let selected = payload.rules
  .filter(rule => priorities.has(rule.priority))
  .filter(rule => chapters.size === 0 || chapters.has(rule.chapter))
  .map(rule => ({ ...rule, relevance_score: score(rule) }))
  .filter(rule => chapters.size > 0 || queryTokens.length === 0 || rule.relevance_score > priorityWeight[rule.priority])
  .sort((a, b) => b.relevance_score - a.relevance_score || a.number - b.number)
  .slice(0, limit);

if (selected.length === 0 && queryTokens.length > 0 && chapters.size === 0) {
  selected = payload.rules
    .filter(rule => priorities.has(rule.priority))
    .sort((a, b) => (priorityWeight[b.priority] - priorityWeight[a.priority]) || a.number - b.number)
    .slice(0, Math.min(limit, 20))
    .map(rule => ({ ...rule, relevance_score: priorityWeight[rule.priority] }));
}

const result = {
  metadata: {
    rulebook_version: payload.metadata.version,
    query,
    priorities: [...priorities],
    chapters: [...chapters],
    limit,
    selected_count: selected.length,
  },
  rules: selected,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`# Applicable UI/UX rules\n`);
  console.log(`Query: ${query || '(none)'} · Priorities: ${[...priorities].join(', ')} · Rules: ${selected.length}\n`);
  for (const rule of selected) {
    console.log(`- **${rule.id} · Ch. ${rule.chapter} · ${rule.level} · ${rule.priority} · ${rule.automation}** — ${rule.statement}`);
    console.log(`  - Chapitre: ${rule.chapter_title}`);
    console.log(`  - Preuve: ${rule.evidence}`);
  }
  console.log('\nSelection is an aid, not a substitute for reading the relevant chapters and product contracts.');
}
