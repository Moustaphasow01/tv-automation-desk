# Audit contrefactuel — Replay V5.1 du 11 juin 2026

## Périmètre et méthode

- Replay : `replay_2026-06-11_full_day_5m_2d1b5b62bfcf`
- Échantillon : 10 documents de setup générés jusqu'au Master de `08:00`.
- Source de prix : 1 305 bougies MNQ M1 canoniques du 11 juin.
- Prix d'entrée : règle conservatrice du contrat (`long_upper_bound`, `short_lower_bound` ou prix explicite).
- Après une validation fondée sur une clôture M1, le scénario causal exige une nouvelle bougie permettant réellement l'exécution.
- Les prix postérieurs aux cutoffs sont utilisés exclusivement pour cet audit après-coup. Ils n'ont pas été fournis aux analystes.

## Résultats agrégés

### Entrée aveugle sur chaque plan proposé

Cette mesure ignore volontairement toutes les conditions et entre au premier contact du prix d'entrée pendant la validité du setup.

- 9 entrées remplies ;
- 9 stops ;
- 0 objectif ;
- 1 setup jamais rempli ;
- résultat total : `-9 R`.

Ce score mesure la qualité brute des niveaux proposés, mais pas la stratégie complète puisque les setups sont contractuellement conditionnels.

### Stratégie conditionnelle avec causalité stricte

- 1 trade réellement validé et exécutable ;
- LONG à `28 472` après validation à `02:26` et nouveau contact à `02:27` ;
- objectif `28 632` atteint à `03:04` ;
- résultat total attendu : `+2 R`.

### Variante permissive avec exécution sur la bougie de confirmation

- SHORT confirmé à `01:59` : `-1 R` ;
- LONG confirmé à `02:26` : `+2 R` ;
- résultat : `+1 R`.

Cette variante n'est pas retenue comme référence, car elle utilise la clôture d'une bougie pour confirmer le signal tout en supposant une exécution à l'intérieur de cette même bougie.

## Détail des setups

| Validité | Direction | Conditions finales | Plan sans conditions | Résultat causal conforme |
|---|---:|---:|---:|---:|
| 00:15–02:00 | LONG | 0/4, invalidé | `-1 R` | Pas de trade |
| 00:15–02:00 | SHORT | 4/4 à 01:59 | `-1 R` | Pas de fill causal avant expiration ; `-1 R` seulement en same-candle |
| 02:00–05:00 | LONG | 2/4 stockées, séquence corrigée valide à 02:26 | `-1 R` si entrée prématurée | `+2 R` |
| 02:00–05:00 | SHORT | 1/4, retest échoué | `-1 R` | Pas de trade |
| 05:00–06:30 | LONG | 1/3 | Pas de fill | Pas de trade |
| 05:00–06:30 | SHORT | 0/3 | `-1 R` | Pas de trade |
| 06:30–08:00 | LONG | 0/3 | `-1 R` | Pas de trade |
| 06:30–08:00 | SHORT | 2/3 | `-1 R` | Pas de trade |
| 08:00–10:00 | LONG | 3/3 à 09:44 | `-1 R` depuis le contact prématuré de 08:53 | Pas de nouveau fill à `28 780` après confirmation |
| 08:00–10:00 | SHORT | 2/3 | `-1 R` | Pas de trade |

## Évaluation de l'analyste

1. Les niveaux bruts sont faibles lorsqu'ils sont pris sans conditions : neuf entrées sur neuf finissent au stop.
2. Les conditions apportent donc une valeur essentielle : elles évitent huit pertes et une entrée non remplie.
3. Le meilleur scénario analytique est le LONG de `02:00`, dont la cassure et le retest conduisent à un résultat causal robuste de `+2 R`.
4. L'analyste produit cependant beaucoup de scénarios opposés ou prématurés. Leur qualité dépend excessivement du filtrage déterministe.
5. Le LONG de `08:00` était analytiquement tardif : ses confirmations ne sont complètes qu'après que le prix a quitté la zone d'entrée.

## Évaluation du moteur

1. Le moteur a correctement empêché plusieurs plans perdants dont les conditions n'étaient pas complètes.
2. Il a en revanche manqué le seul trade causal confirmé et profitable, à cause de la désynchronisation des conditions du LONG de `02:26`.
3. Le résultat observé de `0 R / 0 position` doit donc être comparé à une référence conditionnelle actuelle de `+2 R / 1 trade`, et non au scénario aveugle de `-9 R`.
4. Les anomalies d'identité et les gates `UNKNOWN` restent à corriger, mais elles ne correspondent pas toutes à une position profitable effectivement manquée.

