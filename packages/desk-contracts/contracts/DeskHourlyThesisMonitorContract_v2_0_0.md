# DeskHourlyThesisMonitorContract — v2.0.0

## 1. Mission et cadence

Le Monitor V2 réévalue la thèse et le plan à chaque checkpoint GPT `M5`, tandis que le moteur déterministe évalue les conditions et la position en `M1`. Le nom historique « Hourly » est conservé pour compatibilité d’API; il ne définit plus la cadence.

Le schéma normatif est `schemas/entities/hourly-monitor-v2.schema.json`. V1 reste lisible et hash-locké pour les runs historiques.

## 2. Continuité

Le Monitor référence obligatoirement le Master, le `plan_id` backend-pinned, la thèse active, le Monitor précédent, le setup et la position éventuels. `links.plan_id`, `command.plan_id` et le plan actif doivent être identiques; `command.monitor_id` doit correspondre au Monitor courant. Ces égalités sont vérifiées par le backend. Il recopie le scope du travail réclamé et ne change ni session, ni run, ni date, ni cutoff.

Une incohérence de scope, contrat ou pack est hard et interdit la sauvegarde métier.

## 3. Catch-up latest-wins

La politique est `LATEST_SETTLED_CLOSED_M5`. Si plusieurs checkpoints sont en retard, le plus récent fermé est analysé avec une fenêtre cumulative incluant les données des checkpoints sautés. Les checkpoints superseded sont enregistrés mais ne créent pas d’analyses concurrentes.

## 4. Delta analytique

Le Monitor sépare :

- faits nouveaux depuis la fenêtre précédente ;
- interprétations ;
- évolution de la thèse ;
- nouveaux risques ;
- nouvelles opportunités.

Chaque condition structurée reçoit un état parmi `NOT_STARTED`, `PENDING`, `SATISFIED`, `FAILED`, `INVALIDATED`, `EXPIRED`, `UNKNOWN`, une heure d’observation et des preuves. GPT ne déclare pas un état futur.

Les états de condition sont des snapshots backend portant `authority=BACKEND_SNAPSHOT` et une version d’évaluateur. `observed_at_paris` peut être nul tant qu’une condition n’a pas été observée.

Le bloc `checks` préserve explicitement les capacités du Monitor V1 : attendu/réalisé, mise à jour macro, delta cross-asset, delta technique, signaux faibles, transformation de scénario, time decay et contrôle de position. `assessment` expose les chemins attendu, réalisé et d’échec ainsi que la causalité.

## 5. Santé de thèse

La santé est `STRONG`, `VALID`, `FRAGILE`, `VERY_FRAGILE` ou `NON_EXECUTABLE`, avec score courant, score précédent et facteurs. Elle n’autorise pas directement une entrée.

## 6. Commande

`command` est conforme à DeskMonitorCommandContract V1. Les transitions de thèse, setup, position et replan sont orthogonales. `ARM` signifie armer conditionnellement; seul le moteur peut exécuter `ENGINE_TRIGGER`.

Le Monitor ne peut jamais déclarer fill, position ouverte/fermée ou résultat en R. Une demande de gestion de position est `GPT_REQUEST_ONLY` et doit être validée par le backend.

## 7. Données dégradées

La qualité est `CANONICAL`, `DEGRADED` ou `UNUSABLE`. Une donnée contextuelle facultative manquante peut produire `DEGRADED` et une soft gate sans annuler un setup par défaut. Une donnée canonique nécessaire au trigger reste fail-closed à `ENTRY_TRIGGER`; un scope incohérent reste fail-closed à `PLAN_COMPILE`. Une gate d’une phase future ne supprime pas le candidat avant cette phase.

Le Monitor produit également une alerte structurée optionnelle et un `next_handoff` complet. Les gates de qualité restent identifiées par code, état, motif et preuves; une liste anonyme d’états est interdite.

## 8. Audit

Le Monitor prouve l’anti-lookahead, les versions Monitor V2 / Command V1 / Policy V4 / Catalog V1 et les références de source. Toute propriété inconnue est rejetée.
