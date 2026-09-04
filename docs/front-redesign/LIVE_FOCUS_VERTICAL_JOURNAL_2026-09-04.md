# Live Focus — journal vertical et accès sans dézoom

## Demande et périmètre

Correction de présentation à partir des quatre captures du 4 septembre : journal trop bas, tickets horizontaux, police trop grande, horaires tronqués, espace central inutilisé. Aucun changement de stratégie, de contrat BFF, de permission, de migration ou de donnée.

Base : `main` à `171283eb539fe4471a6ac2277da66eed417c4a5e` ; branche de travail : `codex/live-focus-vertical-journal`. Le répertoire `TV_Automation` historique n'est pas modifié.

## Décisions

| Constat | Correction | Effet attendu |
| --- | --- | --- |
| La longueur du brief détermine la hauteur de la ligne et repousse le journal | Trois colonnes indépendantes sur desktop : brief, opérateur/marché, journal | Les tickets commencent en haut, à droite |
| Le journal horizontal est comprimé, notamment sur écran peu haut | Liste verticale avec défilement propre ; suppression de la règle qui ramenait sa piste à 44 px | Dernier ticket et actions atteignables |
| Les valeurs sont trop grandes ou tronquées | Corps 14 px, informations secondaires 12–13 px, titres 18 px, prix 26 px ; retour à la ligne des valeurs | Lecture dense à 100 %, sans masquer le contenu |
| Les horaires répètent leurs libellés | Trois cellules : Signal, Échéance, Âge des données ; date et heure Paris | Valeurs directement comparables, détails complets dans « Parcours et sources » |
| Le calendrier est trop bas | Prochain catalyseur placé en tête du brief | Information accessible dès l'ouverture |
| Le mode Focus hérite de la colonne de navigation compacte | Isolation de la grille du shell pour le Focus sans sidebar | Plus de colonne minuscule avec grande zone noire à côté |
| Les informations opérateur s'empilent malgré une déclaration de colonnes | Rétablissement explicite de `display: grid` | Meilleure utilisation du centre |

À largeur < 1100 px : retour à une colonne avec défilement de page ; aucun verrouillage en hauteur. Sur desktop : hauteur de fenêtre, avec un minimum de 700 px et défilement de page si la fenêtre est plus basse, pour ne pas écraser les tickets. Brief, centre et tickets possèdent leur propre défilement. Les raccourcis fléchés ne capturent plus le défilement clavier de ces zones.

## Architecture et dette

Propriétaire : feature `live-trading`, couche présentation. `LiveFocusJournal.tsx` possède la liste, les filtres, l'export et le repli des détails. `focusJournalModel.ts` compose les lignes depuis la projection backend existante, sans accès réseau ni dépendance React. Consommateurs : Focus, dossier et tests de composants.

Sélection d'un ticket par `signalId` canonique, pas par son index après tri. Les dossiers terminaux restent consultables et non actionnables ; aucun recalcul de Risk, quantité ou résultat. Le journal reste présent avant le premier signal.

Alternatives écartées : zoom CSS global, taille fixe de page, suppression de données pour faire tenir l'écran, reconstruction du backend, duplication d'une nouvelle page Focus.

Réduction mesurée : `LiveFocusMode.tsx` passe de 1 075 à 686 lignes ; CSS de 2 316 à 2 026 lignes. Les nouveaux modules comptent respectivement 127 et 277 lignes. Le composant historique reste au-dessus du seuil cible de 600 lignes : sa dette restante est explicite, pas déclarée résolue.

Règles sélectionnées : UXR-0121, UXR-0129, UXR-0139, UXR-0141, UXR-0142, UXR-0151, UXR-0159, UXR-0160, UXR-0161, UXR-0170, UXR-0171, UXR-0281, UXR-0286, UXR-0683. La demande actuelle remplace la disposition horizontale de la spécification historique. Pas de nouvelle technologie ni d'ADR structurant.

## Vérification

Le navigateur utilise le frontend local et le vrai BFF VPS, sans injection de fixtures. Les tests unitaires restent isolés avec leurs données de test habituelles.

- Composants : `npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism src/test/liveCockpitComponents.test.tsx` dans `apps/desk-control-plane` : **16/16 passent**.
- Guard existant : `node scripts/quality/check_front_feature_architecture.mjs` : **passe**. Ce guard cible principalement le frontend historique ; il ne remplace pas les contrôles VNext.
- Rulebook : `node docs/ui-ux/scripts/ui-ux-audit.mjs apps/desk-control-plane/src --json /tmp/live-focus-uiux-audit.json` : **194 fichiers, 0 erreur, 879 avertissements**. La règle `!important` locale est nécessaire pour neutraliser la règle de sidebar historique déjà prioritaire ; pas de contrôle désactivé.
- `git diff --check` : **passe**.
- ESLint sur les quatre fichiers TypeScript/TSX modifiés (`LiveFocusMode`, `LiveFocusJournal`, `focusJournalModel`, `liveCockpitComponents.test`), avec `--max-warnings=0` : **passe**.
- Production : `npm run build` (TypeScript + Vite) puis régénération du bundle après déplacement du résumé dans la zone défilante : **passe**. Build local `live-focus-vertical-journal-20260904`, entrée `index-CtCu-FAd.js`, Live `LiveTradingPage-Diswz6Oh.js`, CSS Live `LiveTradingPage-F4I7XtlQ.css`.
- Navigateur réel : `node apps/desk-control-plane/scripts/audit-live-focus-layout.mjs` contre `http://127.0.0.1:8096/#/live?focus=1`, proxy vers le vrai BFF VPS : **10/10 formats passent** au `2026-09-04T02:51:49Z`. Résolutions : 1280×720, 1280×600, 1366×768, 1440×900, 1920×1080, 2560×1440, 1024×768, 960×540, 390×844, 320×640.
- Même passe : **29 tickets réels**, filtres/recherche/détails, résumé sans compression de liste, accès aux actions du dernier ticket, défilement clavier et accès au bas du marché vérifiés ; **0 erreur JavaScript, 0 erreur HTTP observée, 0 violation Axe** dans le périmètre Focus.
- La suite frontend complète a été lancée, puis interrompue faute de progression exploitable sur un poste saturé en mémoire. Elle n'est pas déclarée verte ; seuls les 16 tests ciblés sont certifiés ici.

Preuves : `output/playwright/live-focus-layout/live-focus-layout-audit.json`, captures par résolution, `live-focus-last-ticket.png` et `live-focus-market-scroll.png`. Le contrôle vérifie les limites des panneaux eux-mêmes : un `overflow: clip` qui cache un débordement ne suffit pas à le faire passer. Le résumé des KPI appartient maintenant à la même zone défilante que les tickets : le développer ne réduit pas la hauteur de cette zone.

## Livraison et limites

Les changements restent exclusivement frontend. Aucun Human Gate confirmé, aucun ordre envoyé, aucun service VPS redémarré dans cette correction. Le rendu actuel hors session n'est pas une certification des transitions de marché ou de l'exécution réelle.

Le VPS sert toujours la release préexistante `preprod-live-focus-operator-journal-20260904.2` vérifiée en début de tâche. Ce lot est validé **en local**, pas encore fusionné sur `main` ni déployé. Des 502 ponctuels ont été observés pendant des passes antérieures sur le BFF ; aucun sur la passe finale, sans correction backend dans ce lot.

Rollback : revenir au commit précédent de ce lot frontend ; aucune restauration de base nécessaire. L'audit UI/UX statique est heuristique et ne constitue pas une conformité globale aux 1 000 règles.
