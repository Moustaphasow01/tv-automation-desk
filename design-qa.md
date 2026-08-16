# Command Center VNext — Design QA

**Date :** 2026-08-15
**Route :** `/command-center`
**Référence normative :** `reports/visual-references/command-center-approved-1672x941.png`
**Nouvelle capture utilisateur vérifiée :** `codex-clipboard-b4358f2c-62c2-454b-9d6f-0b7d4d8ccfaf.png` — pixels RGB strictement identiques à la référence normative (`1536 × 864`, MAE `0.0`)
**Spécification :** « Spécification de reproduction — Command Center du Trading Desk »
**Implémentation :** `apps/desk-control-plane/src/features/command-center`

## Résultat

Le layout desktop du Command Center reproduit la géométrie normative à `1672 × 941` avec une tolérance maximale de 1 px. Le contenu affiché reste celui du BFF/PostgreSQL réel ; les différences de valeurs avec la maquette sont donc attendues et ne sont jamais comblées par des mocks.

## Checklist bloquante

| Contrôle | Résultat | Preuve |
| --- | --- | --- |
| Sidebar 164 px | PASS | mesure Playwright `164 × 941` |
| Header 57 px | PASS | mesure Playwright `1508 × 57` |
| Six KPI sur une ligne au golden viewport | PASS | 6 éléments, géométrie `x=178 y=66 w=1484 h=93` |
| Première rangée métier | PASS | `x=178 y=168 w=1484 h=288` |
| Deuxième rangée métier | PASS | `x=178 y=465 w=1484 h=214` |
| Troisième rangée métier | PASS | `x=178 y=688 w=1484 h=202` |
| Dix panneaux métier | PASS | 10/10 présents dans les cinq viewports |
| Overflow horizontal | PASS | aucun dans les cinq scénarios |
| Interactifs coupés | PASS | 0 dans les cinq scénarios |
| Cibles navigation mobile | PASS | 44 px minimum mesuré |
| Console navigateur | PASS | 0 erreur dans les cinq scénarios |
| Axe serious/critical | PASS | 2 audits Command Center, 0 blocker |
| Performance BFF | PASS | 5 lectures HTTP 200, P75 observé 164 ms (< 1 000 ms) |
| Données réelles / états honnêtes | PASS | BFF réel ; `UNKNOWN/UNAVAILABLE` si la source manque |
| Navigation/drill-down | PASS | KPI Research Workers ouvre `/research/agents` |

## Viewports vérifiés

- Golden master : `1672 × 941`.
- Desktop Full HD : `1920 × 1080`.
- Laptop : `1440 × 900`.
- Tablette : `1024 × 768`.
- Mobile : `390 × 844`.

Rapport machine : `reports/ui-ux/command-center/command-center-visual-qa.json`.

## Écarts de contenu justifiés

- La maquette illustre des données riches ; l'environnement local courant publie plusieurs sources `UNAVAILABLE` ou `PARTIAL`.
- Le frontend ne transforme pas ces absences en 0, `PASS`, `HEALTHY`, `AUTO` ou `FILL`.
- La projection d'exécution reste indisponible tant que `CN-EXE-009` (`SQLSTATE 42703`) n'est pas corrigé côté backend.
- La fraîcheur marché incohérente est suivie par `CN-DATA-001`; le frontend affiche le contrat backend sans recalculer la vérité métier.

## Dérogation tracée

La densité typographique sous 10 px imposée par la référence workstation est bornée par `OV-CC-001` dans `docs/ui-ux/PROJECT_OVERRIDES.md`. Le scanner n'est pas neutralisé et continue de signaler `UXR-0161`.

## Verdict

**PASS visuel et responsive pour le golden slice.**
**Intégration métier partielle et fail-closed** jusqu'à résolution des contrats backend `CN-EXE-009` et `CN-DATA-001`.
