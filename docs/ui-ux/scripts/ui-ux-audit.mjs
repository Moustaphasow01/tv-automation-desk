#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log('Usage: node ui-ux-audit.mjs <file-or-directory> [--json <report.json>] [--no-fail]');
  process.exit(args.length === 0 ? 2 : 0);
}

const root = path.resolve(args[0]);
const jsonIndex = args.indexOf('--json');
const jsonPath = jsonIndex >= 0 ? path.resolve(args[jsonIndex + 1]) : null;
const noFail = args.includes('--no-fail');
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.sass', '.html', '.vue', '.svelte']);
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.angular', 'generated', 'vendor']);
const tokenFile = /(?:tokens?|theme|palette|variables|design-system|foundations?)[/_.-]/i;

function collect(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return extensions.has(path.extname(target)) ? [target] : [];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...collect(full));
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const findings = [];
function add(file, content, index, ruleId, priority, message) {
  const before = content.slice(0, index);
  const line = before.split(/\r?\n/).length;
  const lineText = content.split(/\r?\n/)[line - 1]?.trim().slice(0, 240) ?? '';
  findings.push({
    ruleId,
    priority,
    severity: priority === 'P0' ? 'ERROR' : 'WARNING',
    file: path.relative(process.cwd(), file),
    line,
    message,
    excerpt: lineText,
  });
}

function scanRegex(file, content, regex, ruleId, priority, message, predicate = () => true) {
  regex.lastIndex = 0;
  for (let match; (match = regex.exec(content)); ) {
    if (predicate(match, file, content)) add(file, content, match.index, ruleId, priority, message(match));
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
}

for (const file of collect(root)) {
  const content = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file);
  const cssLike = ['.css', '.scss', '.sass', '.vue', '.svelte'].includes(ext);
  const jsxLike = ['.tsx', '.jsx', '.vue', '.svelte'].includes(ext);
  const htmlLike = ['.html', '.tsx', '.jsx', '.vue', '.svelte'].includes(ext);

  if (cssLike) {
    scanRegex(file, content, /font-size\s*:\s*(\d*\.?\d+)px\b/gi, 'UXR-0161', 'P0',
      m => `Taille de texte fonctionnel potentiellement inférieure à 10 px (${m[1]} px).`,
      m => Number(m[1]) < 10);

    if (!tokenFile.test(file.replaceAll('\\', '/'))) {
      scanRegex(file, content, /(?:^|[\s:,(])(#(?:[0-9a-f]{3,8})\b|rgba?\s*\(|hsla?\s*\()/gim,
        'UXR-0185', 'P1', () => 'Couleur codée en dur hors fichier de tokens/thème.');
    }

    scanRegex(file, content, /outline\s*:\s*(?:none|0(?:\s+[^;]+)?)(?:;|$)/gi,
      'UXR-0283', 'P0', () => 'Suppression du focus visible sans remplacement vérifiable.');
    scanRegex(file, content, /transition\s*:\s*all\b/gi,
      'UXR-0246', 'P1', () => 'transition: all crée des animations imprévisibles et difficiles à contrôler.');
    scanRegex(file, content, /z-index\s*:\s*(\d+)/gi,
      'UXR-0391', 'P1', m => `z-index arbitraire élevé (${m[1]}) ; utiliser l’échelle de layers.`,
      m => Number(m[1]) > 1000);
    scanRegex(file, content, /!important\b/gi,
      'UXR-0957', 'P1', () => 'Usage de !important susceptible de contourner les tokens et contrats de composant.');
  }

  if (jsxLike) {
    scanRegex(file, content, /<(div|span)\b[^>]*\bonClick\s*=/gi,
      'UXR-0379', 'P0', m => `<${m[1]}> cliquable : utiliser button ou a natif.`);
    scanRegex(file, content, /<(div|span)\b[^>]*\brole\s*=\s*["']button["'][^>]*>/gi,
      'UXR-0379', 'P0', m => `<${m[1]}> avec role=button : préférer button natif.`);
    scanRegex(file, content, /\btabIndex\s*=\s*\{?\s*["']?([1-9]\d*)/gi,
      'UXR-0287', 'P0', m => `tabIndex positif (${m[1]}) perturbe l’ordre naturel du clavier.`);
  }

  if (htmlLike) {
    scanRegex(file, content, /<img\b[^>]*>/gi,
      'UXR-0221', 'P0', () => 'Image sans attribut alt explicite.',
      m => !/\balt\s*=/.test(m[0]));
    scanRegex(file, content, /<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/gi,
      'UXR-0963', 'P1', () => 'Lien target=_blank sans rel=noopener/noreferrer.',
      m => !/\brel\s*=\s*["'][^"']*(?:noopener|noreferrer)/i.test(m[0]));
    scanRegex(file, content, /<(?:button)\b(?![^>]*\btype\s*=)[^>]*>/gi,
      'UXR-0339', 'P1', () => 'Bouton sans type explicite ; risque de submit involontaire.',
      (_m, _file, all) => /<form\b/i.test(all));
  }

  scanRegex(file, content, /(?:user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?)/gi,
    'UXR-0587', 'P0', () => 'Le viewport désactive ou limite le zoom utilisateur.');
  scanRegex(file, content, /\b(?:Math\.random|crypto\.randomUUID|randomUUID)\s*\(/g,
    'UXR-0765', 'P0', () => 'Identifiant aléatoire potentiel dans la couche de lecture/UI ; exiger un ID canonique.');
  scanRegex(file, content, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/g,
    'UXR-0954', 'P1', () => 'Dialogue navigateur natif non intégré au contrat d’action et à l’accessibilité.');
  scanRegex(file, content, /\bdangerouslySetInnerHTML\b/g,
    'UXR-0645', 'P0', () => 'Injection HTML brute : validation, sanitation et justification de sécurité requises.');

  if (/[/\\](?:pages?|components?)[/\\]/i.test(file)) {
    scanRegex(file, content, /\b(?:fetch\s*\(|axios\s*\.|XMLHttpRequest\b)/g,
      'UXR-0748', 'P1', () => 'Accès HTTP direct depuis page/composant ; passer par data-access/query.');
  }
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
const summary = {
  scannedRoot: root,
  filesScanned: collect(root).length,
  findingCount: findings.length,
  errors: findings.filter(f => f.severity === 'ERROR').length,
  warnings: findings.filter(f => f.severity === 'WARNING').length,
};
const report = { version: '1.0.0', summary, findings };

console.log(`# UI/UX static audit\n`);
console.log(`Files: ${summary.filesScanned} · Errors: ${summary.errors} · Warnings: ${summary.warnings}\n`);
for (const item of findings) {
  console.log(`${item.severity} ${item.ruleId} ${item.file}:${item.line} — ${item.message}`);
  if (item.excerpt) console.log(`  ${item.excerpt}`);
}
if (findings.length === 0) console.log('No heuristic violation detected. Manual review remains required.');
console.log('\nNote: this dependency-free scanner covers only a small automatable subset of the 1,000 rules.');

if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
}
if (!noFail && summary.errors > 0) process.exit(1);
