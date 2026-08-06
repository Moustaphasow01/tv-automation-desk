# Direction data visualization & graphiques — Design

Statut : validé par l'opérateur le 2026-08-06.

## 0. Contexte

Suite à une demande stratégique plus large ("le front n'est pas assez
cockpit, trop textuel, pas assez visuel pour un desk piloté par IA"), ce
document couvre le premier des thèmes identifiés : **graphiques et data
visualization**, sur Live Desk et Replay Lab. Les autres thèmes évoqués
(gestion des positions, expérience news, apprentissage IA dans le temps,
palette/système visuel transversal) sont volontairement hors périmètre —
chacun fera l'objet d'un brainstorming séparé.

Contrainte actée dès le départ : **aucune régression backend**, en
particulier vis-à-vis des prochains déploiements de release. Tout ce qui
suit est conçu pour ne consommer QUE des données déjà exposées par l'API —
aucun nouvel endpoint, aucune modification de la logique de trading.

## 1. Constat (inventaire réalisé avant conception)

Le problème n'est presque jamais un manque de données : le backend envoie
déjà de nombreux champs numériques et séries temporelles qui sont
aujourd'hui rendus en texte plat. Le vrai manque est un **vocabulaire
visuel** : il n'existe dans tout le code ni jauge, ni sparkline, ni
composant "tendance". `MetricCard` — la tuile de stat utilisée sur
pratiquement chaque page (Décision, Master, Monitors, Performance,
History, Observabilité, Console d'exécution) — n'a aucune capacité de
delta ou de mini-graphique.

Découvertes concrètes qui motivent ce document :

- `market[].series` (série OHLC réelle par instrument) existe dans
  `DeskSession` mais n'est **jamais lue nulle part** dans le code — l'onglet
  "Marché" du Live Desk affiche seulement prix/RSI/ATR en texte.
- `thesis.confidence`/`initialConfidence` et `thesis.health`/`initialHealth`
  forment des paires avant/après jamais visualisées comme delta.
- `claim.latencySeconds` vs `claim.latencyTargetSeconds` est une paire
  valeur-vs-seuil jamais visualisée.
- `ReplayComparisonItem`/`ReplayComparison.summary` portent `bestR`,
  `worstR`, `averageR`, `spreadR` — un écart naturel à représenter en barre
  de plage, actuellement en `MetricCard` texte.
- `ObservabilityOverview.daily` (volume/coût/tokens GPT par jour) existe
  côté backend et n'est affiché **nulle part**, pas même en tableau — donnée
  totalement morte côté front.
- Le graphique de prix Replay (`ReplayChart`/`DecisionChart`, seul
  vrai graphique de prix de toute l'app avec `PerformanceEquityChart`) a
  trois défauts techniques réels : axe Y qui se recalibre automatiquement
  sur la fenêtre visible (sans référence fixe, donc un micro-mouvement peut
  visuellement ressembler à un décrochage), rendu en simple ligne de
  clôtures (pas de vraies bougies OHLC), espacement horizontal des points
  par index plutôt que par temps réel écoulé (peut désaligner visuellement
  les marqueurs de décision par rapport au prix en cas de trou dans les
  données).
- Vocabulaire visuel réutilisable déjà existant (pas à réinventer) : des
  barres horizontales à largeur variable (`ResultBar`, `CoverageRail`), un
  petit graphique en barres par jour dans `ReplayLabPage.tsx`
  (`ReplayEvolution`), des rails de timeline à position fixe
  (`OperationalTimeline`, `SessionsTab`).

## 2. Nouveaux composants visuels

### 2.1 `TrendMetricCard`

Extension de `MetricCard` : valeur actuelle, flèche de delta colorée
(vert/orange selon le sens), barre de progression fine sous la valeur.
Remplace `MetricCard` uniquement là où une métrique a un avant/après ou un
seuil explicite dans les données déjà présentes — pas un remplacement
systématique de tout `MetricCard` partout.

### 2.2 Sparkline compacte pour les cartes Marché

Chaque carte instrument (`market-compact-card`) gagne une mini-ligne avec
zone remplie (pas des bougies) sous le prix, à partir de `market[].series`.
Reste un graphique de contexte compact dans la grille existante, pas un
graphique détaillé.

## 3. Application par zone

| Zone | Changement | Composant | Donnée (déjà existante) |
|---|---|---|---|
| Live Desk F1 Décision | Confiance, Santé, Risque setup, Checkpoint→claim passent en `TrendMetricCard` | 2.1 | `thesis.confidence`/`initialConfidence`, `thesis.health`/`initialHealth`, `claim.latencySeconds`/`latencyTargetSeconds` |
| Live Desk F2 Marché | Sparkline par carte instrument | 2.2 | `market[].series` |
| Replay — graphique détaillé | Correction des 3 défauts techniques (§1) : axe Y à référence fixe (ou bascule auto/fixe), vraies bougies OHLC, axe X en temps réel | Évolution de `ReplayChart`/`DecisionChart`, pas `MiniCandles` — reste un graphique grand format avec zoom/couches, pas une réutilisation directe du composant compact des cartes Marché | `PricePoint[]` déjà consommé |
| Replay — Comparaison | Meilleur/pire/moyenne en barre de plage au lieu de texte | Nouvelle variante range-bar, même famille visuelle que 2.1 | `ReplayComparison.summary.bestR/worstR/averageR/spreadR` |
| Observabilité | Petit graphique pour la série quotidienne GPT (volume/coût/tokens), actuellement invisible | Réutilise le pattern barres-par-jour déjà prouvé dans `ReplayEvolution` | `ObservabilityOverview.daily` |

## 4. Hors périmètre

- Gestion des positions, expérience news, apprentissage IA dans le temps —
  thèmes séparés, brainstormings à venir.
- Tout nouvel endpoint backend ou modification de logique de trading.
- Remplacement systématique de `MetricCard` là où il n'y a ni delta ni
  seuil naturel dans les données (rester sélectif, pas de sur-ingénierie).
- La direction esthétique globale (palette, densité) a déjà été validée
  séparément lors de ce même brainstorming : refléter le même traitement
  dans les deux thèmes clair/sombre existants, pas de rupture vers un
  système "Bloomberg noir".

## 5. Suite proposée

Ce document couvre la vision ; le découpage en chantiers d'implémentation
(probablement : 4a — `TrendMetricCard` + application Décision, 4b — mini
graphiques Marché, 4c — correctifs graphique Replay, 4d — Comparaison +
Observabilité) sera fait au moment de repartir sur l'implémentation, pas
maintenant.
