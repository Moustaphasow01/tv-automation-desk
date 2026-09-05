# TD2-430 — Live Focus refinement plan

Ce plan consolide les assessments A et B du 5 septembre 2026. Il réduit l’accumulation d’effets, badges et micro-labels sans redessiner le cockpit ni toucher aux règles métier.

Invariants : conserver la colonne droite de tickets comme file de travail, l’aperçu ordre / entry / SL / TP, et les droits/actions exclusivement publiés par le backend. Aucune action, permission, donnée de trading ou calcul frontend ne doit être inventé.

| Priorité | Correction ciblée | Modification concrète | Fichiers | Vérification visuelle requise |
| --- | --- | --- | --- | --- |
| P0 | Hiérarchie de la décision | Faire du ticket central la seule surface dominante; abaisser le brief en bande secondaire, sans déplacer ni masquer le rail droit. | `LiveFocusMode.tsx`, `live-focus.css` | 1366×768 et 1920×1080 : décision visible sans scroll, rail droit toujours lisible et sélection stable. |
| P1 | Effets décoratifs | Réduire halos radiaux, grille de fond, ombres et bordures concurrentes; réserver la couleur d’état au ticket sélectionné et au rail. | `live-focus.css` | 1366×768 et 1920×1080 : contraste des états conservé, aucun faux accent sur les cartes passives. |
| P1 | Rail de tickets terminal | Conserver le rail; donner au ticket sélectionné instrument/direction/expiration/prochaine action avant les KPIs, filtres et détails. Garder le plan ordre/entry/SL/TP accessible en niveau secondaire. | `LiveFocusJournal.tsx`, `live-focus.css` | Desktop : rail scrollable sans clipping; responsive : ticket sélectionné et plan atteignables sans perte de contexte. |
| P1 | Temps et badges | Regrouper maintenant, cutoff des données et échéance en une ligne temporelle; supprimer les répétitions, sans altérer les valeurs backend ni l’alerte stale. | `LiveFocusMode.tsx`, `FocusDashboard.tsx`, `live-focus.css` | 1366×768 : une seule lecture temporelle; 1920×1080 : aucune information fraîcheur/expiration perdue. |
| P2 | Action et pipeline | Montrer une action primaire backend autorisée; placer copie, refus et dossier au second niveau. Conserver une bande compacte Signal → Contexte → Portfolio/Risk → OrderIntent → Human Gate. | `LiveFocusMode.tsx`, `live-focus.css` | États sans ticket, ticket expiré et Human Gate : pas d’action trompeuse; clavier/focus revient à l’élément déclencheur. |

## Garde-fous techniques

- Les 16 `!important`, 44 règles `overflow` et 77 déclarations `font-size` recensés par assessment B sont des points de régression à réduire seulement avec preuve de cascade; ils ne justifient pas une simplification aveugle.
- Le détecteur ciblé n’a relevé aucun finding markup, mais il ne valide pas le rendu CSS.
- **Navigateur non validé dans cette consolidation** : aucune capture ni score de conformité ne sont revendiqués. Toute mise en œuvre exige une vérification réelle aux deux résolutions indiquées, incluant scroll général, rail, drawer et focus visible.
