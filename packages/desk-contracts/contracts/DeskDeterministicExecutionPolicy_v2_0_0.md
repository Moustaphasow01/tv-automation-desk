# Desk Deterministic Execution Policy v2.0.0

Statut : complément d’exécution partagé par le LIVE et le Replay.

Cette politique ne remplace ni ne modifie
`DeskMasterAnalysisContract_v4_0_0` ni
`DeskHourlyThesisMonitorContract_v1_0_0`. Elle précise la frontière entre
l’analyse GPT et le moteur déterministe. Les contrats analytiques restent la
source de la stratégie ; cette politique rend leur exécution vérifiable.

## 1. Autorité

- GPT propose, arme, maintient, invalide ou demande un replan.
- Le backend est seul autorisé à confirmer un trigger, créer une position,
  déplacer un stop, constater un objectif ou calculer le résultat en R.
- Un statut `TRIGGERED`, `CLOSED` ou un prix d’exécution fourni par GPT ne
  constitue jamais une preuve d’exécution.
- LIVE et Replay utilisent la même normalisation de setup et le même moteur de
  continuité de position.

## 2. Setup canonique exécutable

Un setup `ARMED_CONDITIONAL` doit contenir :

- `setup_id`, `instrument`, `direction` ;
- `entry_zone.lower` et `entry_zone.upper`, ou un `entry_price` unique ;
- `stop_loss` ;
- au moins un objectif, dont `take_profit_1` ;
- `valid_from_paris` et `expires_at_paris` ;
- au moins une condition structurée dans `conditions` ;
- `trigger_policy.min_score` ;
- `management_policy.break_even_at_r`.

Les bornes sont numériques, distinctes et ordonnées. Les contrats fractionnaires
ne sont pas admis pour la quantité. Une phrase libre peut expliquer une
condition, mais ne remplace jamais ses champs structurés.

## 3. Condition canonique

Chaque condition doit fournir :

- `condition_id` ;
- `instrument` ;
- `operator` ;
- `threshold` ;
- `importance` ;
- `required_for_trigger` ;
- éventuellement `sequence`, `tolerance_points` et `label`.

Opérateurs backend autorisés :

`CLOSE_ABOVE`, `CLOSE_BELOW`, `TOUCH_ABOVE`, `TOUCH_BELOW`,
`REJECT_ABOVE`, `REJECT_BELOW`, `REJECT_RESISTANCE`,
`REJECT_SUPPORT`.

Une liste de conditions vide bloque l’exécution. Le fallback « entrée seule »
est interdit sauf migration explicitement marquée
`trigger_policy.allow_entry_only=true`; il ne doit pas être émis par les
nouveaux Masters ou Monitors.

## 4. Temps et anti-lookahead

- Seules les bougies clôturées sont évaluées.
- Les intervalles sont disjoints : une bougie de frontière ne peut appartenir
  qu’à un intervalle.
- Une confirmation à la clôture ne peut pas produire rétroactivement une
  entrée dans cette même bougie. L’entrée est recherchée sur une bougie
  ultérieure, sauf règle explicite et auditée `allow_same_bar_entry=true`.
- `valid_from_paris` est inclusif ; `expires_at_paris` est exclusif.
- Une condition postérieure à l’expiration ne peut jamais réactiver le setup.

## 5. Prix et intrabar

- Le prix simulé doit appartenir à la plage réellement observée de la bougie.
- Un simple chevauchement avec une zone ne permet jamais d’enregistrer une
  borne non cotée comme prix d’exécution.
- Si une même bougie touche le stop et l’objectif sans donnée plus fine
  permettant d’établir leur ordre, la position passe en `REVIEW_REQUIRED` avec
  `AMBIGUOUS_INTRABAR_PATH`.
- Une position ambiguë est exclue des résultats et des agrégats.

## 6. Gestion déterministe

- Le moteur évalue la position sur chaque bougie M1 clôturée ; M5/M15 ne sont
  que des fallbacks explicitement signalés.
- Par défaut Autopilot V4, le stop passe au break-even après une excursion
  favorable de `+0.7R`, effective à partir de la bougie suivante.
- MFE et MAE sont cumulés sur toute la vie de la position.
- Une gestion partielle doit indiquer les quantités entières fermées et
  restantes ainsi que les fills correspondants.

## 7. Garde-fous de journée

Valeurs par défaut des nouveaux runs, configurables dans `risk_policy` :

- perte journalière maximale : `3R` ;
- pertes consécutives maximales : `3` ;
- cooldown après perte : `30` minutes ;
- intervalle minimal entre deux replans : `60` minutes.

Une `hard_invalidation=true` structurée peut contourner uniquement le debounce
de replan. Elle ne contourne jamais les limites de risque.

## 8. Certification

Un run terminé n’est éligible aux agrégats que si :

- aucune position n’est ouverte ;
- aucune position n’est `REVIEW_REQUIRED` ;
- chaque position terminale possède un résultat déterministe ;
- aucun prix futur n’a été utilisé ;
- chaque setup déclenché référence une position.

Le backend publie `CERTIFIED_ENGINE_V2` ou
`REJECTED_ENGINE_INTEGRITY`. `COMPLETED` décrit l’avancement du workflow, pas
la validité statistique du résultat.
