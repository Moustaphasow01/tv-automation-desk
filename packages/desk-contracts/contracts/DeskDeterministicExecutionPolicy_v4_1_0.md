# DeskDeterministicExecutionPolicy — v4.1.0

## 1. Objet

Policy V4.1 définit la frontière entre analyse GPT et décisions déterministes pour LIVE et REPLAY. Elle s’applique à Master V5.1, Monitor V2.1, Execution Plan V1.1, Monitor Command V1.1 et Condition Catalog V1.1.

## 2. Chaîne canonique

1. GPT produit un document source strict et scoped.
2. Le save boundary valide le schéma et les contrats épinglés.
3. Un compilateur unique transforme l’intention en artefact canonique backend.
4. Le backend calcule diagnostics, transitions et hash; GPT ne les fournit pas.
5. Le moteur M1 évalue les prédicats, gates et machines d’état.
6. Le broker gateway valide quantité, idempotence, réconciliation et exécution.
7. Les fills produisent les positions; le moteur de résultat produit le R.

Une écriture partielle est interdite. La sortie source et l’artefact compilé sont conservés avec leurs versions, leur `plan_id` backend-pinned et leur lien d’audit.

## 3. Profil `OPPORTUNITY_SEEKING_CONTROLLED`

Le profil augmente la capacité à matérialiser des opportunités conditionnelles :

- seuil pondéré de confirmation contextuelle : `0.55` ;
- jusqu’à trois candidats distincts classés, sans qu’un candidat secondaire invalide annule automatiquement le principal ;
- soft gaps non canoniques : confirmation, information ou réduction du risque ;
- scénario long, short et WAIT tous étudiés ;
- preuve structurée obligatoire si aucune opportunité.

Cette tolérance ne modifie pas les garde-fous :

- risque maximal : `0.25 %` de la net equity ;
- RR minimum : `2` ;
- stop et cible obligatoires et orientés correctement ;
- anti-lookahead, scope, trigger data, broker safety et veto déterministes restent hard ;
- hard gate `FAIL` ou `UNKNOWN` bloque fail-closed la phase d’enforcement correspondante, pas les phases antérieures.

Le risque demandé reste `<= 0.25 %` de la net equity. Le broker dimensionne les futures en contrats entiers par arrondi supérieur, calcule le risque réel et bloque `BROKER_SUBMIT` si l’excédent dépasse son `max_rounding_excess_pct` configuré. Ce mécanisme explicite ne donne jamais à GPT l’autorité d’augmenter le risque demandé.

Les phases sont ordonnées : `PLAN_COMPILE` → `SETUP_ARM` → `ENTRY_TRIGGER` → `BROKER_SUBMIT`. `CANONICAL_TRIGGER_DATA_MISSING` et `MAJOR_EVENT_ENTRY_BLOCK` s’enforcent à `ENTRY_TRIGGER`; `BROKER_SAFETY_FAILED` à `BROKER_SUBMIT`. Ils n’interdisent donc pas la conservation d’un candidat ou pré-armement qui pourra être réévalué. Pour un code `*_FAILED`, `PASS` signifie que l’échec est absent.

## 4. Autorités

GPT est autorisé à proposer des setups, conditions et transitions analytiques. GPT n’est jamais autorisé à déclarer :

- `ENGINE_TRIGGER` ou `TRIGGERED` ;
- un fill ;
- un état de position résultant ;
- un résultat en R ;
- une mutation broker.

Le backend est l’unique autorité de trigger. Le broker gateway est l’unique autorité de fill. Le moteur d’outcome est l’unique autorité du résultat.

## 5. Machines d’état

Les machines thèse, setup, position et replan sont indépendantes, validées avant mutation et terminales lorsque leur définition l’impose. Une commande composite legacy est normalisée vers les quatre domaines; une sortie V2 doit déjà être orthogonale.

Un setup progresse au plus de candidat vers pré-armé puis armé conditionnel. Seul `ENGINE_TRIGGER`, émis par le moteur après satisfaction des conditions et gates, peut produire `TRIGGERED`.

## 6. Prédicats

Seuls les prédicats du Catalog V1.1 sont exécutables. Les paramètres sont lus dans `condition.parameters`; un fallback plat ne sert qu’à la compatibilité legacy. Une condition inconnue ne devient jamais vraie implicitement.

Les séquences stateful conservent leur mémoire. Une cassure sans retest, ou un retest sans cassure antérieure valide, reste `PENDING` ou `FAILED` selon sa fenêtre; jamais `SATISFIED`.

La prose n’est jamais exécutable. Seuls les enums, opérateurs et `parameters` du Catalog V1.1 alimentent le moteur. Une source requise absente vaut `UNKNOWN`; pour un événement obligatoire, cela bloque uniquement `ENTRY_TRIGGER`. Une confirmation ne peut déclencher une entrée que sur une bougie M1 fermée ultérieure, et une réacquisition doit être réévaluée après toute sortie de zone.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

Les effets de soft gate ne sont jamais des règles backend cachées. `REQUIRE_CONFIRMATION` devient exécutable uniquement si GPT ajoute au setup une condition explicite du Catalog V1 avec tous ses `parameters`, son poids et sa règle temporelle; sinon il reste audit/advisory. `REDUCE_RISK` devient exécutable uniquement si un Master ou replan abaisse explicitement `execution_plan.risk.risk_pct_requested` avant compilation, puis le setup compilé hérite de cette valeur. Un Monitor ne peut pas modifier silencieusement le risque du plan : sans nouveau plan, l’effet reste advisory; sur une position ouverte, `management_request.type=REDUCE_RISK` est une demande distincte `GPT_REQUEST_ONLY`. Aucun de ces effets ne devient un veto implicite.

## 7. LIVE / REPLAY

Les deux modes partagent contrats, compilateurs, politique, catalogue, moteurs d’état et règles de résultat. Le REPLAY reconstruit les données jusqu’au cutoff; le LIVE scelle les mêmes données à mesure du marché. Aucun fallback live n’est permis en replay.

## 8. Cadences

- construction/évaluation déterministe : `M1` ;
- analyse GPT : `M5` ;
- catch-up analytique : dernier checkpoint M5 fermé, fenêtre cumulative, checkpoints intermédiaires superseded.

## 9. Compatibilité

Les runs déjà épinglés V5.0/V2.0/V1.0/Policy V4.0, ainsi que V4/V1/Policy V3, restent lisibles via l’adaptateur legacy et ne sont jamais réinterprétés silencieusement avec V5.1/V2.1/V1.1/Policy V4.1. Toute nouvelle activation est versionnée et hash-lockée.

## 10. Rejet

Sont rejetés avant mutation : schéma invalide, propriété inconnue, scope/contrat incohérent, identifiant inventé, géométrie invalide, risque hors budget, RR insuffisant, hard gate bloquant, transition illégale, autorité GPT excessive ou anti-lookahead non prouvé.

Les invariants relationnels `plan_id`, appartenance du setup principal, unicité des setup IDs, ordre temporel, géométrie recalculée et identité différente lors de `REPLACE` sont contrôlés par le compilateur backend; ils ne sont pas présentés comme des garanties du JSON Schema seul.
