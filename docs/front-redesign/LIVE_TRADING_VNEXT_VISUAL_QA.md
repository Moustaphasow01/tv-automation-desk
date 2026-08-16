# Live Trading VNext — Visual QA

## Référence et méthode

- Référence reçue : `reports/visual-references/live-trading-approved-1536x864.png`, SHA-256 `762453ab00342b3fdfbb7d0b924dfe0008be3bd73041d6a94f17ee7aa9c3d585`.
- Viewport normatif : `1672 × 941`, device scale factor `1`.
- Route réelle : `http://127.0.0.1:8190/#/live`, proxy BFF `http://127.0.0.1:8790`.
- Script : `apps/desk-control-plane/scripts/audit-live-trading-visual.mjs`.

## Résultat

| Viewport | Overflow horizontal | Interactif coupé | Panneaux | Champ post-Risk éditable | Erreur console |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1672 × 941 | 0 | 0 | 13 | 0 | 0 |
| 1440 × 900 | 0 | 0 | 13 | 0 | 0 |
| 1280 × 800 | 0 | 0 | 13 | 0 | 0 |
| 390 × 844 | 0 | 0 | 13 | 0 | 0 |
| 430 × 932 | 0 | 0 | 13 | 0 | 0 |

Ancres desktop mesurées à ±1 px : sidebar `96 × 941`, header `1576 × 52`, policy strip `1576 × 32`, grille `1576 × 857`.

## Artefacts

- `reports/ui-ux/live-trading/golden-1672x941.png`
- `reports/ui-ux/live-trading/laptop-1440x900.png`
- `reports/ui-ux/live-trading/compact-1280x800.png`
- `reports/ui-ux/live-trading/mobile-390x844.png`
- `reports/ui-ux/live-trading/mobile-430x932.png`
- `reports/ui-ux/live-trading/side-by-side-1672x941.png`
- `reports/ui-ux/live-trading/diff-1672x941.png`
- `reports/ui-ux/live-trading/live-trading-visual-qa.json`

La référence 1536 × 864 est redimensionnée uniquement pour produire l'overlay diagnostic au viewport normatif. Le diff mesure `MAE 14,25`, `RMSE 25,77`, `33,82 %` de pixels avec delta maximal supérieur à 10. Ces valeurs incluent volontairement des contenus différents : la maquette montre des trades illustratifs, tandis que le rendu affiche la vérité BFF réelle `UNAVAILABLE/STALE`. Elles ne constituent donc pas un gate de données. La géométrie, la composition, la hiérarchie et les états de sécurité constituent le gate bloquant.

## Non-régression

Le Command Center gelé passe sa propre matrice `5/5` après le slice Live Trading. Aucun nouveau `!important` n'a été ajouté : le compteur reste à `61`.

## Accessibilité

Axe couvre workstation et mobile : `2 audits`, `0 serious`, `0 critical`. Le reflow mobile retire la sidebar desktop, conserve la navigation basse et ne compresse aucune table au-delà du viewport.
