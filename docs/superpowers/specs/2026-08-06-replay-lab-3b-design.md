# Replay Lab — chantier 3b (fusion Run/Journée, hero + onglets) — Design

Statut : validé par l'opérateur le 2026-08-06.

## 0. Contexte

Suite de `docs/superpowers/specs/2026-08-06-replay-lab-3a-design.md` (chantier
3a, livré : carte "Pouls du Replay" sur `/replay`). Ce document couvre 3b :
la restructuration du détail journée, la partie la plus lourde du chantier 3
— celle qui supprime le plus de niveaux de navigation.

Décision déjà actée (spec 3a §0, reconfirmée ici) : Run et Journée
fusionnent, car la création d'un replay produit déjà un seul run continu par
journée ; la distinction n'a plus d'utilité opérationnelle.

## 1. Routage

**Correction technique actée après le premier passage de ce document** :
l'API backend (`getReplayDay(runId, date)`) exige à la fois le `runId` et la
`date` — il n'existe pas d'endpoint "par date seule". Le `runId` primaire
reste donc dans l'URL ; ce qui disparaît, c'est la page "Run" comme étape de
navigation séparée, pas le paramètre lui-même.

- **Route fusionnée** : `/replay/runs/:runId/days/:date` — URL inchangée,
  mais pointe désormais vers la nouvelle page fusionnée (hero + onglets) au
  lieu de l'actuel `ReplayDayPage`.
- **Détail process GPT** : `/replay/runs/:runId/gpt/:processId` — URL et
  contenu inchangés (le `runId` restant dans l'URL, aucun déplacement de
  route n'est nécessaire ici).
- **Redirection statique** (le paramètre nécessaire est déjà dans l'URL,
  pas d'appel réseau requis) :
  `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId` →
  `/replay/runs/:runId/days/:date` (la session redevient un état sélectionné
  dans la page, pas un segment d'URL).
- **Redirection résolue** : `/replay/runs/:runId` (sans date dans l'URL)
  devient une page "résolveur" — charge le run via l'API existante
  (`getReplay(runId)`), lit `data.run.tradingDate`, puis navigue vers
  `/replay/runs/:runId/days/:tradingDate`. Nécessaire car cette route est
  encore ciblée par d'anciens favoris/liens externes qui ne portent que le
  `runId`.
- **Liens internes déjà corrects, aucun changement requis** : le tableau
  "Journées de backtest" et le graphique d'évolution sur `/replay`
  (`ReplayLabPage.tsx`), le tableau de comparaison (`ReplayComparePage.tsx`)
  pointent déjà vers `/replay/runs/:parent/days/:date` (via
  `day.primaryRunId || day.sessions[0]?.sourceId`) — ces liens continuent de
  fonctionner tels quels puisque l'URL de la page fusionnée est identique à
  celle de l'ancien `ReplayDayPage`.

## 2. Hero

Reprend le contenu de l'actuel `ReplayDayPage` : date, statut, bandeau de
métriques (exécutions/sessions, progression moyenne, résultat certifié ou
provisoire, processus GPT, échecs/bloqués).

**Nouveau** : une bande de sélection de session juste sous le hero, sur le
modèle du F1-F5 du Live Desk — une puce cliquable par session de la journée
(ex. "Asie #1", "NY #1"), affichant un mini statut + résultat. La session
"primaire" (ou la plus avancée) est sélectionnée par défaut. Cette sélection
est un état de page partagé entre les quatre onglets ci-dessous (state React
dans le container, pas dans l'URL — cohérent avec le choix déjà fait sur
`/live` pour la navigation F1-F5 interne).

## 3. Onglets

| Onglet | Contenu | Filtré par session ? | Source (composants existants réutilisés) |
|---|---|---|---|
| **Sessions** | Carte multi-sessions de la journée (lanes) + matrice de comparaison des variantes | Non — vue d'ensemble de toute la journée ; cliquer une session ici met à jour la sélection globale | `ReplaySessionLanes`, `ReplayVariantMatrix` (actuellement dans `ReplayDayPage.tsx`) |
| **Décisions** | Event tape + ledger de décisions + timeline complète | Oui | `ReplayEventTape`, `ReplayDecisionLedger`, `EventTimeline` (actuellement dans `ReplaySessionPage.tsx`) |
| **GPT** | Liste des processus GPT + conclusions | Oui | Rail GPT + conclusions (actuellement dans `ReplaySessionPage.tsx`, panneaux équivalents dans `ReplayDayPage.tsx`) |
| **Prix** | Graphique de prix avec événements superposés | Oui | `ReplayChart` (actuellement dans `ReplayRunPage.tsx` / `ReplaySessionPage.tsx`) |

Onglet par défaut : **Sessions** (vue d'ensemble avant de creuser une
session précise — cohérent avec "Lecture" par défaut sur `/live`).

Relation entre la bande de sélection (§2) et l'onglet Sessions : la bande
est un raccourci rapide accessible depuis n'importe quel onglet (change la
session active sans changer d'onglet) ; l'onglet Sessions est la vue
d'exploration complète (lanes + comparaison de variantes) pour choisir en
connaissance de cause. Les deux pilotent le même état partagé — aucune
redondance de données, juste deux points d'entrée vers la même sélection.

Le clic sur un processus GPT (dans l'onglet GPT, dans le ledger de
décisions, ou dans le graphique) navigue vers
`/replay/runs/:runId/gpt/:processId`, strictement inchangé par rapport à
l'existant.

## 4. Sort des anciennes pages

- `ReplayRunPage.tsx` et `ReplayDayPage.tsx` sont remplacés par la nouvelle
  page fusionnée (nouveau fichier, nom à définir en plan — probablement
  `ReplayDayPage.tsx` réécrit, puisque le concept "jour" survit et pas
  "run").
- `ReplaySessionPage.tsx` disparaît en tant que page : son contenu
  (chart + ledger + GPT rail + timeline) se répartit dans les onglets
  Décisions/GPT/Prix de la nouvelle page, filtré sur la session
  sélectionnée.
- `GptProcessPage.tsx` ne change pas du tout (ni contenu, ni URL — le
  `runId` restant dans l'URL parente, aucune migration n'est nécessaire).

## 5. Hors périmètre

- `/replay/compare` (chantier 3c).
- Le contenu de `GptProcessPage.tsx` (chantier 3c — dé-jargonnage prévu ;
  cette page n'est touchée d'aucune façon par 3b, ni contenu ni URL).
- Toute nouveauté visuelle (palette, typographie) — chantier 1 non rouvert.
- La bande de sélection de session ne devient pas un F-key global comme sur
  `/live` (pas de raccourci clavier prévu) ; c'est une simple rangée de
  puces cliquables.
