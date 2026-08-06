# Replay Lab — chantier 3a (carte "Pouls du Replay") — Design

Statut : validé par l'opérateur le 2026-08-06.

## 0. Contexte : découpage du chantier 3

Le Replay Lab actuel (`/replay`, `/replay/runs/:runId`, `/replay/runs/:runId/days/:date`,
`/replay/runs/:runId/days/:date/sessions/:sessionExecutionId`,
`/replay/runs/:runId/gpt/:processId`, `/replay/compare`) totalise plus de 1200
lignes réparties sur 5 pages — un chantier nettement plus large que 2a/2b. Il
est découpé en trois sous-chantiers, sur le modèle 2a/2b :

- **3a (ce document)** : ajouter une carte narrative en tête de la page
  d'atterrissage `/replay`, sans toucher au reste de la page.
- **3b** (plus tard) : fusionner Run et Journée en un seul niveau de route,
  restructurer le détail journée en hero + onglets (Sessions / Décisions /
  GPT / Prix), avec la session comme sélecteur dans un onglet plutôt qu'une
  route séparée.
- **3c** (plus tard, priorité basse) : dé-jargonner `/replay/compare` et
  `/replay/runs/:runId/gpt/:processId`, qui sont déjà fonctionnellement
  solides (scoreboard, delta, ranking) et n'ont besoin que d'un polish.

Décisions actées pour 3b (à ne pas rouvrir au moment de le brainstormer) :
Run et Journée fusionnent car la création d'un replay produit déjà un seul
run continu par journée ; la distinction n'a plus d'utilité opérationnelle.

## 1. Périmètre de 3a

Uniquement `src/pages/ReplayLabPage.tsx` : insertion d'une nouvelle carte
narrative entre le `PageHeading` et le `MetricStrip` existant. Rien d'autre
ne change : le `MetricStrip`, la barre de filtres, le tableau "Journées de
backtest" et le tableau "Runs, variantes et tentatives" restent identiques
(structure, colonnes, comportement). La fusion/simplification de ces
tableaux est explicitement hors périmètre, reportée à 3b.

## 2. La carte "Pouls du Replay"

Nouveau composant `ReplayPulseCard`, inséré juste après le `PageHeading` et
juste avant le `MetricStrip` actuel dans `ReplayLabPage.tsx`. Construite à
partir des données déjà chargées par `useReplays` (`query.data.summary` et
`query.data.days`) — aucun nouvel appel réseau.

### 2.1 Ligne principale (état, priorité descendante)

1. **S'il y a des blocages** (`summary.failed > 0 || summary.blocked > 0`) :
   *"{summary.failed} échec{s} · {summary.blocked} bloqué{s}"* (ne montrer
   que les segments non nuls ; si les deux sont nuls cette branche ne
   s'applique pas).
2. **Sinon, s'il y a des replays actifs** (`summary.active > 0`) :
   *"{summary.active} replay{s} actif{s} · aucun blocage"*.
3. **Sinon** (rien d'actif, rien de bloqué) : *"Aucun replay en cours"*.

### 2.2 Ligne secondaire (contexte : dernier résultat certifié)

Chercher dans `days` (trié par date décroissante) la première journée où
`resultEligibleSessions > 0`, et afficher :
*"Dernier résultat certifié : {totalR.toFixed(2)} R · {date}"*.
Si aucune journée n'a de résultat certifié : *"Aucun résultat certifié pour
l'instant"*.

### 2.3 Action directe (un seul bouton, contextuel)

- S'il y a au moins un replay actif : lien vers la journée active la plus
  avancée (même `parent`/`Link` que `ReplayEvolution` utilise déjà —
  `day.primaryRunId || day.sessions[0]?.sourceId`), libellé *"Voir le replay
  en cours →"*.
- Sinon, s'il existe une journée avec résultat certifié : lien vers cette
  journée, libellé *"Voir le dernier résultat →"*.
- Sinon (aucune donnée du tout) : pas de bouton.

### 2.4 Ton et style

Même palette/typographie que le reste de l'app (aucune nouveauté visuelle,
chantier 1 non rouvert). Structure calquée sur `DecisionCard` du Live Desk :
un titre d'état en gras, une ligne de contexte en dessous, une action à
droite ou en pied de carte — pas une grille de métriques froide.

## 3. Hors périmètre (3a)

- Toute modification du `MetricStrip`, de la barre de filtres, ou des deux
  tableaux existants.
- La fusion Run/Journée et toute la restructuration de
  `/replay/runs/:runId/days/:date` (→ 3b).
- `/replay/compare` et `/replay/runs/:runId/gpt/:processId` (→ 3c).
- Tout nouvel appel API : la carte consomme uniquement des champs déjà
  présents dans la réponse de `useReplays`.
