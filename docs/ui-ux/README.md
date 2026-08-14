# UI/UX & Frontend Product Engineering Rulebook Pack

> **Intégration Trading Desk : active depuis le 13 août 2026.** Les instructions obligatoires sont fusionnées dans `AGENTS.md`, le protocole adapté est sous `docs/codex/`, les extensions projet sont dans `PROJECT_OVERRIDES.md` et les commandes racine `npm run rules:uiux`, `npm run test:uiux-rules`, `npm run audit:uiux` et `npm run audit:uiux:report` sont disponibles. `SOURCE_MANIFEST.json` conserve le manifeste exact du paquet d'origine ; le protocole installé ne lui est volontairement plus bit-à-bit identique car ses chemins ont été adaptés au repository.

Ce paquet fournit une norme de conception et d’ingénierie frontend directement exploitable par les humains et les agents LLM.

## Contenu

- `UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md` — 1 000 règles normatives, 50 chapitres.
- `ui-ux-rules.json` — représentation machine-readable.
- `ui-ux-rules.csv` — export tabulaire.
- `CODEX_UI_UX_EXECUTION_PROTOCOL.md` — processus obligatoire de Codex avant, pendant et après le code.
- `AGENTS_UI_UX_SNIPPET.md` — bloc prêt à intégrer dans `AGENTS.md`.
- `UI_UX_REVIEW_CHECKLIST.md` — 100 contrôles prioritaires pour review.
- `templates/UI_UX_SCREEN_REVIEW_TEMPLATE.md` — spécification/audit d’écran.
- `SOURCES.md` — bibliographie et méthode de consolidation.
- `scripts/select-ui-ux-rules.mjs` — sélection contextuelle des règles applicables à une tâche.
- `scripts/ui-ux-audit.mjs` — scanner statique sans dépendance, couvrant un sous-ensemble automatisable.
- `scripts/test-select-ui-ux-rules.mjs` — auto-test du sélecteur.
- `scripts/test-ui-ux-audit.mjs` — auto-test du scanner.
- `scripts/validate-rulebook.py` — validation de la structure et de la parité Markdown/JSON.
- `PROMPT_CODEX_INSTALL_UI_UX_RULEBOOK.md` — prompt d’installation prêt à transmettre.
- `MANIFEST.json` — inventaire et checksums SHA-256.

## Installation recommandée dans le dépôt

```text
docs/
├── ui-ux/
│   ├── UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md
│   ├── UI_UX_REVIEW_CHECKLIST.md
│   ├── SOURCES.md
│   ├── ui-ux-rules.json
│   ├── templates/
│   └── scripts/
└── codex/
    └── CODEX_UI_UX_EXECUTION_PROTOCOL.md
```

Ajouter ensuite le contenu de `AGENTS_UI_UX_SNIPPET.md` à l’`AGENTS.md` racine ou au fichier agent du frontend.

## Commandes

```bash
python docs/ui-ux/scripts/validate-rulebook.py
node docs/ui-ux/scripts/test-select-ui-ux-rules.mjs
node docs/ui-ux/scripts/test-ui-ux-audit.mjs
node docs/ui-ux/scripts/select-ui-ux-rules.mjs "live trading risk timeline" --priority P0,P1 --limit 60
node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src
node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src \
  --json reports/ui-ux-audit.json
```

Exemple `package.json` :

```json
{
  "scripts": {
    "rules:uiux": "node docs/ui-ux/scripts/select-ui-ux-rules.mjs",
    "audit:uiux": "node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src",
    "audit:uiux:json": "node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src --json reports/ui-ux-audit.json",
    "test:uiux-rules": "python docs/ui-ux/scripts/validate-rulebook.py && node docs/ui-ux/scripts/test-select-ui-ux-rules.mjs && node docs/ui-ux/scripts/test-ui-ux-audit.mjs"
  }
}
```

## Limite importante

Le scanner statique est volontairement sans dépendance et heuristique. Il détecte notamment certaines tailles de texte, couleurs hardcodées, suppressions de focus, éléments non sémantiques cliquables, images sans `alt`, zoom désactivé, accès HTTP dans les composants et identifiants aléatoires. Il ne peut pas valider seul la compréhension, la hiérarchie, les parcours, les permissions, les technologies d’assistance, les données réelles ou les 1 000 règles.

La conformité exige donc aussi : Page Operating Contract, revue design, clavier manuel, Storybook/Axe, Playwright, visual regression, tests backend-front, performance et preuve de release.

## Gouvernance

- Toute violation P0 bloque sans dérogation valide.
- Les identifiants `UXR-XXXX` sont stables et ne doivent jamais être réutilisés.
- Les maquettes servent de référence visuelle ; elles ne prouvent ni les données ni les actions.
- Les règles projet plus strictes priment sur les règles générales.
