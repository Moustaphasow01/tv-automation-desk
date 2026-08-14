# Installation UI/UX Rulebook

## Emplacements retenus

- Référentiel, formats machine-readable, checklist, sources, templates et outils : `docs/ui-ux/`.
- Protocole d'exécution Codex : `docs/codex/CODEX_UI_UX_EXECUTION_PROTOCOL.md`.
- Instructions obligatoires : fusionnées dans l'unique `AGENTS.md` racine.
- Cible d'audit frontend par défaut : `apps/desk-control-plane/src`, application Front V2 canonique.
- Rapports CI régénérables : `reports/ui-ux/`.
- Preuves initiales versionnées : `docs/ui-ux/audits/` et `docs/ui-ux/selections/`.

Aucun dossier équivalent `docs/ui-ux/` ou `docs/codex/` n'existait. Le placement ne duplique donc pas une norme UI/UX locale.

## Fichiers installés ou fusionnés

Fichiers du paquet installés sans modification de leurs 1 000 règles :

- `docs/ui-ux/UI_UX_FRONTEND_PRODUCT_ENGINEERING_RULEBOOK.md` ;
- `docs/ui-ux/UI_UX_REVIEW_CHECKLIST.md` ;
- `docs/ui-ux/ui-ux-rules.json` ;
- `docs/ui-ux/ui-ux-rules.csv` ;
- `docs/ui-ux/SOURCES.md` ;
- `docs/ui-ux/README.md` ;
- `docs/ui-ux/SOURCE_MANIFEST.json` ;
- `docs/ui-ux/templates/UI_UX_SCREEN_REVIEW_TEMPLATE.md` ;
- les cinq scripts sous `docs/ui-ux/scripts/` ;
- `docs/codex/CODEX_UI_UX_EXECUTION_PROTOCOL.md`.

Fichiers d'intégration projet ajoutés :

- `docs/ui-ux/PROJECT_OVERRIDES.md` ;
- `docs/ui-ux/audits/2026-08-13-front-v2-static-audit.json` ;
- `docs/ui-ux/selections/2026-08-13-command-center-truth-safety.json` ;
- `docs/ui-ux/selections/2026-08-13-command-center-truth-safety.md` ;
- le présent rapport.

Le snippet fourni a été fusionné dans `AGENTS.md`, pas copié comme seconde source d'instructions. Le prompt d'installation du paquet n'a pas été copié : il est un véhicule de livraison, pas une norme runtime. Le protocole a uniquement reçu l'adaptation des chemins `docs/ui-ux/...` nécessaire à son exécution depuis la racine.

## Modifications AGENTS.md

Un chapitre obligatoire `UI/UX & Frontend Product Engineering` a été ajouté sans supprimer ni réordonner les instructions existantes. Il impose avant tout code frontend :

1. sources de vérité produit et architecture ;
2. Page Operating Contract et Screen Specification ;
3. Rulebook UI/UX ;
4. protocole Codex UI/UX.

Il impose aussi la sélection et la citation des règles `UXR-XXXX`, l'inspection des contrats API, Truth & Safety avant le polish, l'absence de boutons sans action réelle, la séparation des couches frontend, les contrôles applicables et le blocage de toute violation P0 sans dérogation approuvée et datée.

## Scripts et CI ajoutés

Scripts npm racine :

- `npm run rules:uiux -- "<description>" --priority P0,P1 --limit 80` ;
- `npm run validate:uiux-rulebook` ;
- `npm run test:uiux-selector` ;
- `npm run test:uiux-scanner` ;
- `npm run test:uiux-rules` ;
- `npm run audit:uiux` — mode strict, exit non nul sur détection P0 ;
- `npm run audit:uiux:report` — photographie informative JSON avec `--no-fail`.

La CI `.github/workflows/local-ci.yml` installe Python 3.12, exécute le gate structurel `test:uiux-rules`, génère le rapport statique informatif et le publie comme artefact `ui-ux-static-audit`. Le mode informatif ne constitue pas une validation P0. Le mode strict reste obligatoire dans le protocole de toute tâche frontend et a été vérifié comme bloquant sur la baseline actuelle.

Le chemin généré `reports/ui-ux/` a été ajouté à `.gitignore` ; la preuve initiale immuable reste versionnée sous `docs/ui-ux/audits/`.

## Commandes exécutées et résultats

| Commande | Résultat vérifié |
| --- | --- |
| Vérification SHA-256 du paquet source contre `MANIFEST.json` | 15/15 fichiers conformes, 0 erreur. |
| `python3 docs/ui-ux/scripts/validate-rulebook.py` | PASS — 50 chapitres, 1 000 règles séquentielles, parité Markdown/JSON. |
| `node docs/ui-ux/scripts/test-select-ui-ux-rules.mjs` | PASS — 25 règles retournées par l'auto-test. |
| `node docs/ui-ux/scripts/test-ui-ux-audit.mjs` | PASS — 9 détections attendues dans la fixture et exit strict validé. |
| `npm run test:uiux-rules` | PASS — validateur, sélecteur et scanner accessibles par les scripts du dépôt. |
| `node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src --json docs/ui-ux/audits/2026-08-13-front-v2-static-audit.json --no-fail` | PASS informatif — rapport produit sur 84 fichiers. |
| `npm run audit:uiux:report` | PASS informatif — `reports/ui-ux/front-v2-static-audit.json` produit. |
| `npm run audit:uiux` | Blocage attendu, exit 1 — 167 signaux P0 détectés ; le contrôle strict n'est pas neutralisé. |
| Sélecteur P0/P1 du vertical slice Command Center Truth & Safety, limite 60 | PASS — 60 règles enregistrées aux formats JSON et Markdown. |
| `npm run --silent rules:uiux -- "Command Center Truth Safety états inconnus commandes audit permissions" --priority P0,P1 --limit 5 --json` | PASS — alias npm autonome, 5 règles retournées. |
| Parsing de `.github/workflows/local-ci.yml` avec PyYAML | PASS. |
| `git diff --check` sur les fichiers d'intégration suivis | PASS. |

## Résumé du premier audit statique

Le scanner a parcouru 84 fichiers et produit 230 signaux : 167 erreurs P0 et 63 avertissements P1.

| Règle | Nombre | Zone principale | Lecture initiale |
| --- | ---: | --- | --- |
| `UXR-0161` | 163 | `design-system/styles.css` | Tailles fonctionnelles de 6 à 9 px à examiner. |
| `UXR-0283` | 2 | `design-system/styles.css` | `outline: 0` ; un remplacement de focus doit être prouvé manuellement. |
| `UXR-0765` | 2 | `domains/realtime/commandRuntime.ts` | IDs aléatoires côté UI ; vérifier leur rôle exact face aux IDs canoniques/idempotence. |
| `UXR-0957` | 61 | `design-system/styles.css` | `!important` et contournement potentiel des contrats/tokens. |
| `UXR-0748` | 2 | `pages/AuthSessionPage.tsx` | Appels HTTP directs au lieu de la couche data-access/query. |

La feuille de styles concentre 226 des 230 signaux. Cette mission ne les corrige pas, conformément à l'interdiction de modifier l'application durant l'installation.

## Limites du scanner

Le scanner est sans dépendance et heuristique. Il ne prouve pas à lui seul :

- qu'un texte est réellement fonctionnel ou visible dans un viewport donné ;
- que `outline: 0` n'est pas compensé par un focus visible adjacent ;
- qu'un identifiant aléatoire représente illégitimement un objet métier plutôt qu'une clé technique éphémère ;
- la compréhension, la hiérarchie, la qualité des parcours et du contenu ;
- les permissions et capabilities backend réelles ;
- le clavier, les technologies d'assistance, les contrastes calculés et le zoom ;
- les données réelles, états dégradés, commandes terminales, performances ou régressions visuelles ;
- la conformité aux 1 000 règles.

Les résultats doivent être triés par revue du code, Page Operating Contract, tests composants/Axe, Playwright, visual regression, E2E backend-front et validation humaine.

## Conflits avec les normes existantes

Le Rulebook recoupe les standards d'ingénierie existants sur la vérité des données, les frontières frontend, l'accessibilité, les états dégradés et les preuves de tests. Il les complète sans les remplacer.

Un conflit concret est exposé par la baseline : la référence visuelle compacte utilise de nombreuses tailles de 6 à 9 px, alors que `UXR-0161` les signale P0. La fidélité à une capture ne suffit pas à lever l'exigence de lisibilité/accessibilité. Aucun arbitrage silencieux n'a été appliqué.

Le protocole générique contenait aussi des chemins `scripts/...` incompatibles avec le placement retenu. Ils ont été adaptés à `docs/ui-ux/scripts/...` sans modifier le fond normatif.

## Dérogations ou décisions nécessaires

- Aucune dérogation UI/UX n'a été créée ou approuvée pendant l'installation.
- Les 167 signaux P0 ne sont pas déclarés conformes ni implicitement acceptés.
- Avant de coder le prochain slice, il faut trier les P0 en violations confirmées, faux positifs documentés et éventuelles demandes de dérogation datées.
- La tension densité Bloomberg / taille minimale lisible doit être résolue par design adaptatif et tests de zoom en priorité ; une dérogation ne doit être envisagée qu'avec preuve et approbation.
- Les IDs générés dans `commandRuntime.ts` doivent être qualifiés fonctionnellement avant toute correction : canon métier, correlation ID ou idempotency key n'ont pas la même autorité.

## Règles sélectionnées pour le prochain vertical slice

Vertical slice retenu d'après le plan directeur : **Phase 0 — Command Center Truth & Safety**, couvrant états honnêtes, données API réelles, capabilities/permissions, lifecycle terminal des commandes, audit receipt, drill-down paramétré, accessibilité, responsive et E2E.

Le sélecteur a retenu 60 règles P0/P1. Les chapitres dominants sont : actions/commandes/audit (20), tests UI/a11y/E2E (10), états de données (7), architecture frontend (7), protocole Codex (5), contrats API (3), permissions (2), drill-down (2), puis contrat de page, accessibilité, anti-patterns et Definition of Done.

Règles P0 centrales du slice :

- `UXR-0481` — distinguer loading, ready, empty, partial, stale, disconnected, forbidden et error ;
- `UXR-0602` — revalidation backend de toute permission ;
- `UXR-0621` — action dangereuse liée à une commande backend réelle ;
- `UXR-0625` — idempotence et version attendue ;
- `UXR-0626` — lifecycle SUBMITTED à TIMED_OUT ;
- `UXR-0627` — succès seulement après terminal et relecture ;
- `UXR-0628` — commande non implémentée absente, désactivée avec raison ou rejetée ;
- `UXR-0630` — audit receipt consultable ;
- `UXR-0830` et `UXR-0831` — E2E des états et des actions sensibles jusqu'au terminal backend ;
- `UXR-0840` et `UXR-0966` — écran non Done sans preuves complètes de ses états, interactions, responsive et accessibilité.

La sélection exhaustive et ses preuves sont disponibles dans `docs/ui-ux/selections/2026-08-13-command-center-truth-safety.md` et sa version JSON.

## Prochaine étape proposée

Ouvrir un ticket de triage P0 UI/UX lié à la Phase 0, qualifier les 167 signaux sans modifier les règles, puis exécuter le vertical slice Command Center Truth & Safety de bout en bout. La première implémentation devra commencer par les contrats de vérité et les capacités backend, non par le polish visuel, et produire les preuves exigées par le protocole.
