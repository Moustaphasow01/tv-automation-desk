# Live Focus — assessment B technique

Date: 2026-09-05. Portée lue: `apps/desk-control-plane/src/features/live-trading/LiveFocusMode.tsx`, `LiveFocusJournal.tsx`, `FocusDashboard.tsx` et `live-focus.css`. Aucun fichier produit n'a été modifié.

## Méthode et preuves

- Détecteur Impeccable ciblé, sans télémétrie: `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 node /mnt/c/Users/CES/.codex/skills/impeccable/scripts/detect.mjs --json apps/desk-control-plane/src/features/live-trading/LiveFocusMode.tsx` → `[]` (zéro finding).
- Inspection mécanique: 77 déclarations `font-size`, 44 règles `overflow`, 16 `!important` dans `live-focus.css`; 182 occurrences combinées de titres/typographie/cascade/overflow sur les trois surfaces examinées.
- Hiérarchie de titres vérifiée dans le markup: H1 « Brief opérationnel », H2 pour action/journal/dashboard/drawers, H3 pour sous-sections. Les titres de dialogue sont associés par `aria-labelledby`.

## Résultats vérifiables

1. La cascade globalement agressive est intentionnellement localisée sous `body.desk-live-focus-document`; elle rétablit document-scroll et neutralise la grille/sidebar du shell. Les 16 `!important` sont un risque de régression de cascade, mais pas un défaut confirmé: la documentation Live Focus les explique comme neutralisation du shell historique.
2. Le CSS utilise `overflow-x: clip` sur le document et la surface, avec panneaux/drawers à examiner visuellement. Les règles de 2026-09-05 documentent déjà un audit sur dix viewports; aucune preuve nouvelle de clipping n'est produite ici.
3. Les tailles sont tokenisées au niveau Focus (`--focus-type-*`) mais 77 déclarations `font-size` signalent une dette de typographie/cascade à surveiller. Ce nombre inclut les variantes responsive et les contrôles de données; il ne prouve pas 77 styles incompatibles.
4. Le markup présente une hiérarchie de contenu substantielle (brief, action, situation, marché, journal, flux, tableaux de bord et drawers). Les données affichées viennent des view models et vocabulaire opérateur; aucun calcul de trading n'a été observé dans cette surface.

## Faux positifs et limites

- Le détecteur renvoie zéro finding sur le markup TSX: il ne certifie ni le rendu CSS ni l'accessibilité complète.
- Les comptages CSS sont heuristiques; `overflow` comprend des cas légitimes de scroll, drawers et protections de débordement.
- Le navigateur in-app n'était pas accessible dans cette session (aucun runtime Node REPL exposé); aucune capture réelle 1366×768 ou 1920×1080 n'a donc été produite. Les captures et résultats existants cités dans `docs/front-redesign/LIVE_FOCUS_RESPONSIVE_RESULTS_2026-09-05.md` restent les seules preuves visuelles disponibles ici.
- Aucun login, injection, helper live, hook ou requête de mutation n'a été utilisé.

## Conclusion

Le contrôle mécanique ciblé ne bloque pas la surface. La priorité de vérification suivante est un passage navigateur réel sur 1366×768 et 1920×1080 pour confirmer que les règles globales de scroll/clip et les drawers ne masquent aucune action ou information sous données réelles.
