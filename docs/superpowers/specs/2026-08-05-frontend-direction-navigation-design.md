# Direction générale & navigation — redesign front V2 (chantier 1/3)

Statut : validé par l'opérateur le 2026-08-05, corrigé le même jour après
vérification du code réel (voir §0).
Chantier : le premier des trois identifiés pour le redesign front pendant
l'indisponibilité de Codex (crédits épuisés jusqu'au 8 août). Les deux
suivants sont l'écran Live ("Aujourd'hui") et le parcours Replay ; ils
reprendront intégralement les décisions de ce document.

## 0. Correction post-brainstorming

La première version de cette spec supposait un état de départ plus pauvre
que la réalité. Après lecture de `src/navigation.ts`,
`src/components/layout.tsx`, `src/styles/v2.css` et `src/components/deskCards.tsx` :

- La navigation n'est **pas** une liste plate : 6 espaces existent déjà
  (`today`, `replay`, `performance`, `operations`, `execution`, `settings`)
  avec un switcher dans la sidebar et une sous-navigation contextuelle par
  espace. Le vrai problème est un **mauvais classement** de certains items,
  pas une absence de structure (détail en §5).
- Densité (compact/confort) et thème (clair/sombre) sont déjà des bascules
  fonctionnelles dans `AppShell`, persistées en `localStorage`. Il ne faut
  pas les figer sur un seul mode.
- Un système de tokens complet existe déjà dans `src/styles/v2.css`
  (`--surface-0..3`, `--text-primary/secondary/tertiary`,
  `--positive/negative/warning/info/accent`, échelle d'espacement, rayons,
  z-index, durées), avec support `data-theme` clair/sombre. Ce chantier
  réconcilie ses décisions avec ces tokens existants plutôt que d'en créer
  un jeu parallèle.
- La carte trade (Entrée/Stop/Objectif) existe déjà sous la forme de
  `SetupCard`/`PositionCard` (`src/components/deskCards.tsx`) avec un
  pattern `price-grid`/`price-box` qui couvre déjà Borne basse/haute, Prix
  d'exécution, Stop, **TP1, TP2, TP3** (trois objectifs, pas un seul) et
  RR. Le travail est de corriger sa hiérarchie visuelle, pas de créer un
  nouveau composant. Ce point relève du chantier 2 (page Aujourd'hui), pas
  de celui-ci.
- Un dictionnaire de traduction existe déjà (`deskCopy` /
  `humanDeskText` dans `deskCards.tsx`, 13 entrées) mais il est **isolé
  dans ce seul fichier** : `LiveDeskScreen.tsx` réimplémente ses propres
  fonctions locales (`qualityLabel`, `workflowLabel`, `deskLabel`,
  `sessionDisplayLabel`) au lieu de le réutiliser. Le travail est de
  centraliser l'existant dans un module partagé, pas d'en créer un de
  zéro. Aucun des états `TRIGGERED`/`UNKNOWN`/`MAJOR_EVENT_ENTRY_BLOCK`/
  `CANONICAL_TRIGGER_DATA_MISSING` cités en exemple pendant le
  brainstorming n'est aujourd'hui affiché tel quel dans le front vérifié —
  ces exemples viennent des documents d'anomalies backend, pas d'un bug
  frontend confirmé. Le principe (jamais d'état brut à l'écran, dictionnaire
  central unique) reste valable et vaut la peine d'être posé maintenant,
  mais ce n'est pas un correctif de bug urgent.

Les sections suivantes intègrent directement ces corrections.

## 1. Constat de départ

Le front fonctionnel est terminé (voir `docs/FRONT_SCREEN_STATUS_REVIEW.md`),
mais :

- au sein de l'espace de navigation qui devrait porter le Live, plusieurs
  facettes (Master, Monitors, Alertes, Sessions) sont classées ailleurs
  (voir §5) ;
- même correctement classées, ces facettes restent des pages séparées :
  reconstituer « où on en est, quel a été le dernier move, quel est le
  prochain, quel est le résultat actuel » demande de naviguer entre
  plusieurs écrans ;
- la traduction des états métier est fragmentée dans plusieurs fichiers au
  lieu d'un point central unique (voir §0) ;
- la hiérarchie visuelle de certains composants (ex. les niveaux de prix
  dans `SetupCard`) ne met pas en avant ce qui compte le plus (stop,
  objectif) — traité au chantier 2.

## 2. Vision

Un cockpit orienté résultats : on voit en un coup d'œil où en est le desk,
quel a été son dernier move, quel est le prochain, et quel est le résultat
actuel — sans devoir reconstituer l'histoire en sautant d'écran en écran.

## 3. Principes directeurs

1. **Usage perso en priorité.** Pas de vitrine commerciale pour l'instant ;
   optimiser pour le trading quotidien de l'opérateur, pas pour impressionner
   un client.
2. **Esprit terminal opérateur, pas dashboard SaaS.** Dense, sombre par
   défaut, les chiffres en avant. Référence : Bloomberg/TradingView, pas
   Linear/Vercel. Le mode clair et le mode confort existants sont conservés
   et héritent des mêmes principes de hiérarchie.
3. **Aucun état brut du backend ne s'affiche jamais tel quel.** Chaque état
   a une traduction française assumée, définie une seule fois dans un
   dictionnaire central partagé — jamais retraduite localement écran par
   écran.
4. **Les chiffres qui engagent de l'argent ou du risque gardent toujours le
   même poids visuel.** Entrée, stop, objectifs, R : jamais relégués en
   petite légende secondaire.
5. **Le vocabulaire métier existant est conservé.** Master, Monitor, Setup,
   Position, Checkpoint restent tels quels : c'est déjà la langue du desk,
   pas du jargon d'implémentation.

## 4. Système visuel

### 4.1 Couleurs — réconciliation avec `src/styles/v2.css`

Ce chantier ne crée pas de nouvelle palette. Il confirme le rôle des tokens
existants et ajoute uniquement ce qui manque.

| Rôle voulu | Token existant (`v2.css`) | Décision |
|---|---|---|
| Fond de page | `--surface-0` (`#05080c`) | Conservé tel quel — déjà quasi identique à l'intention terminal opérateur. |
| Surfaces (en-têtes, cellules) | `--surface-1` / `--surface-2` / `--surface-3` | Conservés tels quels. |
| Texte principal | `--text-primary` (`#e6edf3`) | Conservé. |
| Texte atténué (labels) | `--text-secondary` (`#9ba8b7`) | Conservé — le token existe déjà et est correct ; le vrai correctif est de **l'utiliser partout** au lieu d'une opacité ad hoc (constaté dans `LiveDeskScreen.tsx`). |
| Positif | `--positive` (`#3fb950`) + `--positive-soft` | Conservé. |
| Négatif | `--negative` (`#f85149`) + `--negative-soft` | Conservé. |
| Alerte | `--warning` (`#d29922`) + `--warning-soft` | Conservé. |
| Accent navigation | `--accent` (`#4c8dff`) | Conservé — déjà réservé à la sélection/navigation, distinct des couleurs de statut. |
| Neutre / conditionnel | `--neutral-status` (`#6c7a8a`) | Déjà présent — à utiliser pour le badge « Conditionnel » d'un setup théorique (chantier 2), pas de nouveau token à créer. |

Aucun nouveau token de couleur n'est ajouté dans ce chantier. Si le
chantier 2 constate en pratique qu'une couleur manque réellement (ex. pas
de variante assez saturée pour un badge de statut dense), ce sera décidé
et documenté à ce moment-là, contre le vrai rendu à l'écran plutôt que sur
hypothèse.

### 4.2 Typographie

- `v2.css` définit déjà `--font-sans: Inter, ...` et
  `--font-mono: "JetBrains Mono", ...` : conservés tels quels, pas de
  nouvelle police introduite.
- Règle confirmée : chiffres et données (prix, R, pourcentages,
  timestamps) en police monospace avec `font-variant-numeric: tabular-nums` ;
  labels et texte courant en police sans-serif.

### 4.3 Densité et thème

Les bascules **compact/confort** et **clair/sombre** existantes
(`AppShell`, `src/components/layout.tsx:42-44`) sont conservées telles
quelles. Ce chantier ne choisit pas un mode unique : il s'assure que les
décisions de hiérarchie (§4.1, §4.4) fonctionnent dans les deux densités
et les deux thèmes, puisque `v2.css` fournit déjà les overrides
`data-theme`.

### 4.4 Patterns de composants — rappel, détail au chantier 2

Le détail d'implémentation de la carte trade (`SetupCard`/`PositionCard`,
niveaux Entrée/Stop/TP1-2-3) et des lignes de statut appartient au
chantier 2 (page Aujourd'hui), puisque c'est là que ces composants sont
réellement modifiés. Ce chantier-ci pose seulement le principe validé
avec l'opérateur : même poids visuel pour tous les niveaux de prix, stop
en `--negative`, objectifs en `--positive`, entrée neutre en
`--text-primary`, et un traitement visuellement distinct (bordure/texte
`--neutral-status` + badge « Conditionnel ») pour un setup pas encore
déclenché.

### 4.5 Règle de contenu (copie)

- Le desk est en français : tout le texte visible par l'opérateur est en
  français, y compris les statuts.
- Aucun enum ou état brut du backend n'apparaît jamais à l'écran. Chaque
  état affiché doit passer par un dictionnaire central unique (voir §6,
  tâche de centralisation de `deskCopy`/`humanDeskText`).
- Vocabulaire métier conservé tel quel : Master, Monitor, Setup, Position,
  Checkpoint, Thèse, Replay.

## 5. Navigation

### 5.1 Constat réel

`src/navigation.ts` groupe déjà les 27 routes en 6 espaces (`today`,
`replay`, `performance`, `operations`, `execution`, `settings`), affichés
via un switcher d'espaces + sous-navigation contextuelle dans
`src/components/layout.tsx`. Ce n'est donc pas une liste plate à
regrouper depuis zéro. Deux problèmes réels :

1. **Mauvais classement.** `settingsItems` contient aujourd'hui `/master`
   (Analyse initiale), `/monitors` (Suivis), `/alerts` (Alertes de
   session) et `/sessions` (Phases de marché) — ce sont des facettes
   vivantes du Live, pas des réglages. `replayItems` contient `/history`
   (Archives) — c'est la mémoire de vraies séances passées, pas un test
   hypothétique ; elle a plus sa place avec Performance.
2. **Duplication.** `navigationCatalog` (utilisé par la recherche globale)
   ajoute un groupe séparé « Documents de session » qui reliste Master,
   Monitors, Sessions, Alerts, Audit déjà présents dans `settingsItems` —
   une redondance à supprimer plutôt qu'un système à reconstruire.

Le fait que ces items soient déjà groupés par espace ne suffit pas : même
bien classées, ce sont des pages séparées à visiter une par une pour
reconstituer l'état du Live. Le Live a déjà résolu ce problème en interne
avec sa propre nav de sections (Décision/Marché/Lecture/Exécution/Risque/
Activité) ; les autres facettes n'en profitent pas encore.

### 5.2 Changements ciblés

1. Déplacer `/master`, `/monitors`, `/alerts`, `/sessions` de
   `settingsItems` vers `todayItems` dans `src/navigation.ts`.
2. Déplacer `/history` de `replayItems` vers `performanceItems`.
3. `settingsItems` ne garde alors que la gouvernance réelle : Stratégie
   & contrats, Qualité des données (Audit).
4. Supprimer le groupe dupliqué « Documents de session » dans
   `navigationCatalog` ; dériver le catalogue de recherche directement de
   `navigationSpaces` pour n'avoir qu'une seule source.
5. Les espaces `today`, `replay`, `performance`, `operations`,
   `execution`, `settings` restent au nombre de 6 — l'architecture actuelle
   est saine, elle n'est pas remplacée.
6. La fusion visuelle des facettes de `today` en une seule page à sections
   ancrées (au lieu de pages séparées) est le sujet du chantier 2, pas de
   celui-ci : ce chantier ne fait que corriger le classement et la
   duplication dans `navigation.ts`.

### 5.3 Contraintes respectées

- Les 27 routes restent des routes valides dans `src/App.tsx` — aucune
  route n'est supprimée ni redirigée dans ce chantier. Seul leur
  regroupement dans la sidebar et le catalogue de recherche change.
- Aucune URL ne casse : un lien externe ou un favori existant vers
  `/master`, `/monitors`, `/alerts` ou `/sessions` continue de fonctionner
  à l'identique.

## 6. Tâches de fond identifiées pour ce chantier

- Centraliser `deskCopy`/`humanDeskText` (aujourd'hui dans
  `src/components/deskCards.tsx`) dans un module partagé (ex.
  `src/lib/deskCopy.ts`), et migrer vers lui les fonctions locales
  équivalentes de `src/screens/live/LiveDeskScreen.tsx`
  (`qualityLabel`, `workflowLabel`, `deskLabel`, `sessionDisplayLabel`)
  pour éliminer la duplication. Détail exact des fonctions à fusionner
  dans le plan d'implémentation.

## 7. Décisions prises par hypothèse raisonnable

- Traitement visuel identique (même taille de chiffres) entre setup
  théorique et position réelle, seule la couleur/le badge changent — validé
  implicitement par l'approbation du principe 4.
- Aucun nouveau token de couleur : réutilisation stricte de l'existant
  (§4.1). Si un manque réel apparaît au chantier 2, il sera documenté à ce
  moment contre le rendu réel, pas anticipé ici.

## 8. Hors périmètre de ce chantier

- Le détail complet de la page « Aujourd'hui » (fusion des facettes en
  sections ancrées, contenu de chaque section, responsive
  320/768/1280/1600px, états vides/erreur/chargement, hiérarchie de
  `SetupCard`/`PositionCard`) : chantier 2.
- Le parcours Replay (journée, session, timeline zoomable, comparaison) :
  chantier 3.
- Operations, Performance, Stratégies : reverront leur habillage visuel
  plus tard, en réutilisant ce système sans le remettre en question.
- Le passage en production sur le VPS : décision de déploiement séparée,
  hors sujet de cette spec.

## 9. Suite

Ce document sert de fondation aux chantiers suivants :

1. Page « Aujourd'hui » (redesign complet de `src/screens/live/`, fusion
   des facettes déplacées en §5.2).
2. Parcours Replay.

Chaque chantier suivant reprend telle quelle la réconciliation de tokens,
la règle de contenu et le classement de navigation définis ici, et n'a pas
à les rouvrir sauf découverte d'un cas non couvert.
