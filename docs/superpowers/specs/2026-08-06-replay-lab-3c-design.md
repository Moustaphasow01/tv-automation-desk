# Replay Lab — chantier 3c (dé-jargonnage comparaison + détail GPT) — Design

Statut : validé par l'opérateur le 2026-08-06.

## 0. Contexte

Suite du chantier 3 (Replay Lab), après 3a (carte "Pouls du Replay") et 3b
(fusion Run/Journée en une page à onglets). Ce document couvre 3c : le
dé-jargonnage de `ReplayComparePage.tsx` et `GptProcessPage.tsx`, sur le
même principe que le chantier 1 (remplacement des codes/statuts bruts et
du jargon d'ingénierie par des libellés compréhensibles pour un opérateur
de desk, sans toucher à la logique ni aux données sous-jacentes).

Les deux pages sont traitées dans un seul chantier (pas de sous-découpage
3c/3d) — le jargon à traiter est de même nature sur les deux pages, un
seul passage cohérent est plus simple qu'une séparation artificielle.

## 1. `ReplayComparePage.tsx`

### 1.1 Identité des runs

Aujourd'hui, l'identité d'un run dans le scoreboard, la matrice
comparative et le panneau GPT/timeline est un ID technique tronqué
(`compactId(row.id, N)`, ex. `acceptance_replay_a1…`).

Remplacé par un libellé lisible, sur le modèle déjà établi en 3b pour
`sessionTitle()` (`"Session Asie · 15m · #1"` — session, variante,
tentative). L'ID technique reste affiché en secondaire (`title` HTML ou
petit texte), pour le support/debug.

Concrètement, dans `ReplayComparisonWorkbench`/`ReplayCompareRow`/
`ReplayCompareGptPanel`/`ReplayCompareTimelinePanel` : chaque occurrence
de `compactId(row.id, …)` comme texte principal devient le libellé
lisible construit depuis `row.run` (qui porte déjà `session`,
`variantId`, `attempt`) ; `compactId(row.id, …)` bascule dans un
attribut `title` ou un `<small>` secondaire.

### 1.2 Libellés de section

Reformulation du jargon, sans changement structurel :

| Avant | Après (direction) |
|---|---|
| "Station de comparaison" (eyebrow) | Un intitulé direct type "Comparaison de runs" |
| Colonne "Δ référence" | En-tête explicite type "Écart vs référence" |
| "Comparaison canonique" (eyebrow matrice) | Simplifié, ex. "Détail comparatif" |
| "Matrice comparative" (h2) | Cohérent avec l'eyebrow ci-dessus |

### 1.3 Ce qui ne change pas

La logique de sélection (checkboxes, "Top résultats", "Journée active"),
le calcul du backend (scoreboard, delta, risk flags — `riskLabel()` est
déjà correctement traduit), les métriques chiffrées (R, coût, tokens).

## 2. `GptProcessPage.tsx`

### 2.1 Suppression complète (bruit technique sans valeur opérateur)

- Le bloc `gpt-payload-grid` entier : les 3 panneaux `<details>` "Manifest
  du bundle", "Save target", "Prompt d'exécution" (JSON brut / texte brut
  non retraité).
- Le bloc `TechnicalDetails` listant Processus / Étape / Run / Worker /
  Révision / État source / Outil de sauvegarde / Jeton de lease / Bundle /
  Request ID (10 identifiants internes, juste après `gpt-payload-grid`).
- `GptContractPanel` (rendu de `TechnicalDetails title="Transmission
  technique GPT"` — état du lease, outil de sauvegarde, work item, worker
  payload, jeton de lease, handle, prompt, manifest, cible de
  sauvegarde) — composant et son appel supprimés entièrement.
- Le `TechnicalDetails` interne au panneau "Workflow parent" dans
  `GptOperationsCommandPanel` (Workflow id, Révision, Work item courant).

### 2.2 Gardé, reformulé

Information à valeur opérationnelle réelle (statut, progression,
actions, liens croisés), juste mal nommée aujourd'hui :

- Eyebrow "P9 · orchestration liée" et titre "Command Center GPT" →
  renommés sans le jargon interne ("P9" disparaît complètement) ; titre
  direction "Contexte d'exécution" ou équivalent.
- Panneau "Save / lease / payload" (cellules `HealthCell` en anglais :
  "Can save", "Lease", "Handle", "Target", "Prompt", "Manifest") →
  traduit. Certaines cellules deviennent redondantes une fois les
  panneaux bruts (§2.1) supprimés — probable réduction à 2-3 cellules
  utiles (état du lease, sauvegarde possible) plutôt que les 6 actuelles.
- "Sortie canonique sauvegardée" (eyebrow du panneau conclusion) →
  reformulé, ex. "Décision sauvegardée".
- "Audit du worker" (eyebrow de la section timeline d'événements) →
  reformulé, ex. "Historique du processus".
- Cycle de vie GPT (`GptLifecycle` : Work item → Claim → Exécution →
  Sauvegarde), section "Continuité du traitement", liens
  risques/incidents/runbooks/liens rapides → conservés tels quels
  structurellement ; vérifiés et reformulés au cas par cas si un
  libellé reste jargonneux (ex. "Prise en charge", "Save target"
  résiduel dans une `dd`).

### 2.3 Ce qui ne change pas

`MetricStrip` (tentative, durée, coût mesuré, tokens, modèle — info
opérationnelle utile pour suivre l'usage IA), les actions correctives
opérateur, les liens vers incidents/runbooks/workflow parent.

## 3. Centralisation

`sessionLabel()` existe aujourd'hui en copie identique dans
`ReplayDayPage.tsx` et `ReplayComparePage.tsx`. Puisque `3c` touche
`ReplayComparePage.tsx`, `sessionLabel` (et le format de libellé
lisible d'identité de run introduit en §1.1) est extrait dans
`src/lib/presentation.ts` comme fonction(s) pure(s) partagée(s),
réutilisée(s) par les deux pages. Cohérent avec la logique de
centralisation déjà posée au chantier 1.

## 4. Tests

Les nouvelles fonctions pures ajoutées à `presentation.ts` reçoivent des
tests unitaires dans `src/test/navigationPresentation.test.ts` (même
convention que 3a). Pas de nouveaux tests de page — aucune des pages
Replay n'en a aujourd'hui, ce chantier ne change pas cette convention.

## 5. Hors périmètre

- Toute nouveauté visuelle (palette, typographie) — chantier 1 non
  rouvert.
- La logique de calcul du backend (scoreboard, delta, risk flags,
  agrégation de comparaison) — inchangée, seule la présentation front
  change.
- Le routage — inchangé, aucune URL ne bouge (`/replay/compare`,
  `/replay/runs/:runId/gpt/:processId` restent identiques).
