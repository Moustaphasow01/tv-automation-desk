# DeskHourlyThesisMonitorContract — v2.4.0

## 1. Mission et cadence

Le Monitor V2.4 réévalue la thèse et le plan à chaque checkpoint GPT `M15`, tandis que le moteur déterministe évalue les conditions et la position en `M1`. Le nom historique « Hourly » est conservé pour compatibilité d’API; il ne définit plus la cadence.

Le schéma normatif est `schemas/entities/hourly-monitor-v2-4.schema.json`. V2.3, V2.2, V2.1, V2.0 et V1 restent lisibles et hash-lockés pour les runs historiques.

Un Monitor peut aussi être déclenché entre deux checkpoints planifiés lorsqu’un événement déterministe critique est matérialisé. Son cutoff est alors le dernier M1 fermé, sans lookahead. Le prochain checkpoint planifié reste aligné sur la grille M15.

## 2. Continuité

Le Monitor référence obligatoirement le Master, le `plan_id` backend-pinned, la thèse active, le Monitor précédent, le setup et la position éventuels. `links.plan_id`, `command.plan_id` et le plan actif doivent être identiques; `command.monitor_id` doit correspondre au Monitor courant. Ces égalités sont vérifiées par le backend. Il recopie le scope du travail réclamé et ne change ni session, ni run, ni date, ni cutoff.

Une incohérence de scope, contrat ou pack est hard et interdit la sauvegarde métier.

## 3. Catch-up latest-wins

La politique est `LATEST_SETTLED_CLOSED_M15`. Si plusieurs checkpoints sont en retard, le plus récent fermé est analysé avec une fenêtre cumulative incluant les données des checkpoints sautés. Les checkpoints superseded sont enregistrés mais ne créent pas d’analyses concurrentes.

## 4. Delta analytique

Le Monitor sépare :

- faits nouveaux depuis la fenêtre précédente ;
- interprétations ;
- évolution de la thèse ;
- nouveaux risques ;
- nouvelles opportunités.

Chaque condition structurée reçoit un état parmi `NOT_STARTED`, `PENDING`, `SATISFIED`, `FAILED`, `INVALIDATED`, `EXPIRED`, `UNKNOWN`, une heure d’observation et des preuves. GPT ne déclare pas un état futur.

Les états de condition sont des snapshots backend portant `authority=BACKEND_SNAPSHOT` et une version d’évaluateur. `observed_at_paris` peut être nul tant qu’une condition n’a pas été observée.

Le Monitor ne transforme jamais un texte libre en règle exécutable. Les intentions utilisent uniquement les enums du Command V1.4 et, pour tout setup créé ou remplacé, les prédicats et `parameters` typés du Catalog V1.2. Il peut maintenir, remplacer ou compléter un portefeuille comportant jusqu’à cinq scénarios, sans forcer un nombre minimal artificiel. Une confirmation de bougie ne permet une entrée qu’à partir de la bougie M1 fermée suivante selon `entry_mode`. Toute réacquisition après sortie puis retour dans une zone doit être confirmée par une nouvelle évaluation machine; elle ne peut pas être présumée par GPT.

Avant d’appliquer la commande, le backend projette chaque setup au cutoff. Tout setup expiré devient terminal avant sélection. Un `REPLACE` exige une nouvelle identité logique et physique; le setup remplacé devient `REPLACED` dans la même mutation. Le backend plafonne ensuite le portefeuille à cinq actifs par rang puis priorité et ferme explicitement tout excédent.

Le bloc `checks` préserve explicitement les capacités du Monitor V1 : attendu/réalisé, mise à jour macro, delta cross-asset, delta technique, signaux faibles, transformation de scénario, time decay et contrôle de position. `assessment` expose les chemins attendu, réalisé et d’échec ainsi que la causalité.

## 5. Santé de thèse

La santé est `STRONG`, `VALID`, `FRAGILE`, `VERY_FRAGILE` ou `NON_EXECUTABLE`, avec score courant, score précédent et facteurs. Elle n’autorise pas directement une entrée.

## 6. Commande

`command` est conforme à DeskMonitorCommandContract V1.4. Les transitions de thèse, setup, position et replan sont orthogonales. `ARM` signifie armer conditionnellement; seul le moteur peut exécuter `ENGINE_TRIGGER`.

Le Monitor ne peut jamais déclarer fill, position ouverte/fermée ou résultat en R. Une demande de gestion de position est `GPT_REQUEST_ONLY` et doit être validée par le backend.

`command_id`, `plan_id`, `monitor_id` et `expected_revision` sont épinglés par le backend et recopiés exactement. `expected_revision` est un compare-and-swap : une révision obsolète provoque un conflit déterministe et n’est jamais écrasée. `setup_transition.setup`, lorsqu’il est requis, contient la géométrie complète, toutes les conditions, toutes les cibles/actions, la gestion et la validité; une décision en prose seule est rejetée.

## 7. Données dégradées

La qualité est `CANONICAL`, `DEGRADED` ou `UNUSABLE`. Une donnée contextuelle facultative manquante peut produire `DEGRADED` et une soft gate sans annuler un setup par défaut. Une donnée canonique nécessaire au trigger reste fail-closed à `ENTRY_TRIGGER`; un scope incohérent reste fail-closed à `PLAN_COMPILE`. Une gate d’une phase future ne supprime pas le candidat avant cette phase.

Une référence `EVENT_BLACKOUT` requise dont les données sont absentes ou indécidables reste `UNKNOWN` et bloque fail-closed uniquement à `ENTRY_TRIGGER`. Les autres lacunes contextuelles facultatives ne deviennent pas des veto implicites. Le profil reste `OPPORTUNITY_SEEKING_CONTROLLED` : seuil pondéré `0.55`, jusqu’à cinq candidats classés hérités du plan, risque demandé `<= 0.25 %` de la net equity, stop obligatoire et RR `>= 2`.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

Les effets de soft gate ne sont jamais des règles backend cachées. `REQUIRE_CONFIRMATION` devient exécutable uniquement si GPT ajoute au setup une condition explicite du Catalog V1 avec tous ses `parameters`, son poids et sa règle temporelle; sinon il reste audit/advisory. `REDUCE_RISK` devient exécutable uniquement si un Master ou replan abaisse explicitement `execution_plan.risk.risk_pct_requested` avant compilation, puis le setup compilé hérite de cette valeur. Un Monitor ne peut pas modifier silencieusement le risque du plan : sans nouveau plan, l’effet reste advisory; sur une position ouverte, `management_request.type=REDUCE_RISK` est une demande distincte `GPT_REQUEST_ONLY`. Aucun de ces effets ne devient un veto implicite.

Le Monitor produit également une alerte structurée optionnelle et un `next_handoff` complet. Les gates de qualité restent identifiées par code, état, motif et preuves; une liste anonyme d’états est interdite.

## 8. Audit

Le Monitor prouve l’anti-lookahead, les versions Monitor V2.4 / Command V1.4 / Policy V4.3 / Catalog V1.2 et les références de source. Toute propriété inconnue est rejetée.

LIVE et REPLAY appliquent ce même contrat, le même compilateur et les mêmes machines d’état. Seule l’acquisition temporelle du bundle diffère : scellement progressif en LIVE, reconstruction bornée au cutoff en REPLAY.
