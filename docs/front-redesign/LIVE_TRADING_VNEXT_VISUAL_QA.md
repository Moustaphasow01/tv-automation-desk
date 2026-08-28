# Live Trading VNext — Flight Director Visual QA

## Contrat de conception

- **Thèse :** Live Trading est un flight director, pas une mosaïque de cartes de poids égal.
- **Premier viewport :** contexte et sûreté en tête, lecture marché à gauche, graphique dominant au centre, chaîne de décision à droite, profondeur de session dans un dock inférieur.
- **Causalité :** `Signal → Contexte → Portefeuille/Risk → OrderIntent → Human Gate` reste lisible sans présenter des totaux non corrélés comme un funnel causal.
- **Autorité :** aucune capacité, décision Risk ou action Human Gate n'est déduite localement.
- **Typographie :** Aptos/Segoe UI Variable pour l'interface, Bahnschrift SemiCondensed pour les titres, Cascadia Mono pour les mesures. Le zoom workstation historique est neutralisé sur cette route uniquement.
- **Responsive :** sur mobile, le graphique reste la première surface métier, puis viennent la chaîne de décision, le contexte et la profondeur de session.

## Référence et méthode

- Référence historique : `reports/visual-references/live-trading-approved-1536x864.png`, SHA-256 `762453ab00342b3fdfbb7d0b924dfe0008be3bd73041d6a94f17ee7aa9c3d585`.
- Viewport normatif : `1672 × 941`, device scale factor `1`.
- Route testée : `http://127.0.0.1:8190/#/live`, branchée au BFF réel via proxy local.
- Script : `apps/desk-control-plane/scripts/audit-live-trading-visual.mjs`.

## Résultat

| Viewport | Overflow horizontal | Interactif coupé | Surfaces visibles | Voile noir | Police min. | Champ post-Risk éditable | Erreur console |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1672 × 941 | 0 | 0 | 4 | 0 | 11 px | 0 | 0 |
| 1440 × 900 | 0 | 0 | 4 | 0 | 11 px | 0 | 0 |
| 1280 × 800 | 0 | 0 | 4 | 0 | 11 px | 0 | 0 |
| 390 × 844 | 0 | 0 | 4 | 0 | 11 px | 0 | 0 |
| 430 × 932 | 0 | 0 | 4 | 0 | 11 px | 0 | 0 |

Ancres desktop mesurées à ±1 px : sidebar `96 × 941`, header `1576 × 64`, policy strip `1576 × 38`, flight bar `1576 × 76`, workspace `1576 × 763`.

Le script ouvre désormais les six onglets du dock et les cinq étages de décision sur chaque viewport avant de certifier la taille de texte, les débordements, le clipping horizontal et vertical, l'absence d'éléments masqués et les erreurs navigateur. Il rejette aussi tout libellé tronqué dans le rail de décision ainsi que tout chevauchement ou contenu non consultable dans le dock. Sur mobile, il vérifie par hit-test que la barre de politiques ne recouvre pas le sélecteur d'instrument. Le dialogue Human Gate n'est exercé que lorsqu'une action réellement autorisée par le backend est disponible ; l'état de données courant n'en publiait aucune lors de cette campagne.

Le contrôle exerce également le plein écran de l'Activité de session sur les cinq viewports : occupation d'au moins 80 % du viewport, fermeture par Échap et restitution du focus au déclencheur. La capture dédiée confirme que la profondeur de session reste lisible sans modifier l'état métier.

## Artefacts

- `reports/ui-ux/live-trading/golden-1672x941.png`
- `reports/ui-ux/live-trading/laptop-1440x900.png`
- `reports/ui-ux/live-trading/compact-1280x800.png`
- `reports/ui-ux/live-trading/mobile-390x844.png`
- `reports/ui-ux/live-trading/mobile-430x932.png`
- `reports/ui-ux/live-trading/golden-activity-fullscreen.png`
- `reports/ui-ux/live-trading/live-trading-visual-qa.json`

La référence historique n'est plus un golden master géométrique : le produit a explicitement demandé un nouveau cockpit depuis zéro. Le gate porte désormais sur la hiérarchie Flight Director, la lisibilité, la vérité des états, l'absence de calcul métier local, l'immutabilité post-Risk et le reflow responsive.

## Non-régression

- Frontend : `48/48` fichiers de test et `235/235` tests passent.
- Build de production : vert.
- Rulebook : `1 000` règles valides, sélecteur et scanner auto-testés.
- Audit statique : `0` erreur sur le slice Live Trading ; `11` erreurs historiques restent publiées dans d'autres écrans et ne sont pas masquées.
- Le Command Center gelé conserve sa propre matrice de non-régression après le slice Live Trading.
- Aucun nouveau `!important` n'a été ajouté : le compteur reste à `61`.

## Accessibilité

Le contrôle dynamique vérifie en plus l'absence de police sous `11 px`, de contrôle coupé ou masqué, de clipping vertical, de voile modal noir et de débordement horizontal. Le reflow mobile retire la sidebar desktop, conserve la navigation basse et maintient le graphique avant la décision et les informations secondaires. Axe couvre les états workstation et mobile de la page réellement chargée et ne relève aucune violation.
