# DeskDeterministicExecutionPolicy — v4.3.0

## 1. Objet

Policy V4.3 définit la frontière entre analyse GPT et décisions déterministes pour LIVE et REPLAY. Elle s’applique à Master V5.4, Monitor V2.4, Execution Plan V1.4, Monitor Command V1.4 et Condition Catalog V1.2.

## 2. Chaîne canonique

1. GPT produit un document source strict, scoped et borné au cutoff.
2. Le save boundary valide le schéma et les contrats épinglés.
3. Le compilateur unique transforme l’intention en artefact canonique backend.
4. Le backend calcule diagnostics, transitions, identités et hash.
5. Le moteur M1 évalue prédicats, gates, expirations et machines d’état.
6. Le broker gateway valide quantité, idempotence, réconciliation et exécution.
7. Les fills produisent les positions; le moteur d’outcome produit le R.

Une écriture partielle est interdite. La sortie source et l’artefact compilé sont conservés avec leurs versions, leur `plan_id` backend-pinned et leur lien d’audit.

## 3. Profil `OPPORTUNITY_SEEKING_CONTROLLED`

Le profil autorise jusqu’à cinq candidats distincts classés et un seuil pondéré de `0.55`. Il exige l’étude des scénarios long, short et WAIT, sans imposer artificiellement cinq setups.

Les garde-fous restent stricts :

- risque demandé `<= 0.25 %` de la net equity ;
- RR minimum `2` ;
- stop et cible obligatoires ;
- anti-lookahead et scope hard ;
- données de trigger, broker safety et veto déterministes fail-closed à leur phase ;
- contrats futures entiers, risque réel recalculé et excédent d’arrondi contrôlé.

Les phases sont `PLAN_COMPILE` → `SETUP_ARM` → `ENTRY_TRIGGER` → `BROKER_SUBMIT`. Une gate future ne supprime pas un candidat avant sa phase d’enforcement.

## 4. Autorités

GPT propose thèse, scénarios, conditions et commandes analytiques. GPT ne déclare jamais `ENGINE_TRIGGER`, fill, position résultante, résultat en R ou mutation broker.

Le backend est l’unique autorité de trigger et de cycle de vie. Le broker gateway est l’unique autorité de fill. Le moteur d’outcome est l’unique autorité du résultat.

## 5. Portefeuille et cycle de vie

Le portefeuille persistant contient au maximum cinq setups actifs. À chaque cutoff, le backend applique dans cet ordre :

1. projection des expirations avec la règle exacte `expires_at_paris <= cutoff_paris` ;
2. validation et application atomique des remplacements ;
3. classement par rang puis priorité ;
4. fermeture explicite des candidats excédentaires ;
5. évaluation M1 des setups actifs restants.

Un setup terminal ne peut jamais être ressuscité par un Monitor. `REPLACE` exige un nouveau `setup_id` et un nouveau `setup_record_id`; l’ancien passe `REPLACED` dans la même mutation. Une erreur analytique terminale bloque le work item et le run avec son code structuré; le run ne reste pas faussement `WAITING_GPT`.

## 6. Prédicats

Seuls les prédicats du Catalog V1.2 sont exécutables. Les paramètres sont lus dans `condition.parameters`; une condition inconnue ou une source requise absente ne devient jamais vraie implicitement.

Les séquences stateful conservent leur mémoire. Une cassure sans retest, ou un retest sans cassure antérieure valide, reste `PENDING` ou `FAILED`. `BREAK_RETEST_SEQUENCE` absorbe ses preuves internes de cassure, zone, retest et rejet. Une condition de prix strictement redondante ne peut pas redevenir un second verrou mandatory : elle est normalisée en preuve advisory ou rejetée comme ambiguë.

Une confirmation ne permet une entrée qu’à partir de la bougie M1 fermée suivante. Toute réacquisition après sortie de zone impose une nouvelle confirmation machine.

`role=VETO` impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. `role=INVALIDATION` impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`.

## 7. LIVE / REPLAY

LIVE et REPLAY partagent contrats, compilateurs, policy, catalogue, moteur M1, machines d’état et règles de résultat. Le REPLAY reconstruit les données jusqu’au cutoff; le LIVE scelle les mêmes données à mesure du marché. Aucun fallback live n’est permis en replay.

## 8. Cadences

- construction et évaluation déterministes : `M1` ;
- analyse GPT planifiée : `M15` ;
- analyse GPT événementielle : dernier M1 fermé lors d’un événement critique de setup, position, replan ou intégrité ;
- catch-up analytique : dernier checkpoint M15 fermé, fenêtre cumulative, checkpoints intermédiaires superseded.

La cadence M15 réduit le coût et la latence sans retirer l’historique canonique. Le modèle peut approfondir le contexte au moyen des capacités de lecture bornées au cutoff.

## 9. Compatibilité

Les runs épinglés Master V5.3 / Monitor V2.3 / Plan V1.3 / Command V1.3 / Policy V4.2 et toutes les versions antérieures restent lisibles via l’adaptateur legacy. Ils ne sont jamais réinterprétés silencieusement avec V5.4 / V2.4 / V1.4 / Policy V4.3.

## 10. Rejet

Sont rejetés avant mutation : schéma invalide, propriété inconnue, scope ou contrat incohérent, identifiant inventé, identité de remplacement réutilisée, géométrie invalide, risque hors budget, RR insuffisant, transition illégale, autorité GPT excessive ou anti-lookahead non prouvé.

Les invariants relationnels, temporels et d’identité sont recalculés par le backend. Ils ne sont jamais déduits de la prose.
