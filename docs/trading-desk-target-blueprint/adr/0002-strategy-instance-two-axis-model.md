# ADR-0002 — Strategy Instance modélisée sur deux axes indépendants

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-4 (`01` §5), errata de sûreté reçu avant intervention Codex

## Contexte

Une modélisation naïve d'une Strategy Instance utiliserait un unique champ `status` mélangeant l'état opérationnel (tourne / en pause / arrêtée) et le mode d'exécution (SHADOW / PAPER / LIVE). Ce mélange rendrait impossible, par construction, de distinguer « une instance LIVE en pause » d'« une instance arrêtée qui était en LIVE », ce qui est une distinction opérationnelle critique (une instance LIVE en pause peut avoir des positions ouvertes à gérer ; une instance arrêtée ne devrait plus en avoir).

## Décision

Strategy Instance porte deux axes de state machine strictement indépendants : l'état runtime (`CREATED/STARTING/RUNNING/PAUSED/STOPPING/STOPPED/FAILED_TO_START/ERRORED`) et le mode d'exécution (`SHADOW/PAPER/LIVE`). Voir `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §2.3 pour les diagrammes complets. Une transition sur un axe ne modifie jamais implicitement l'autre.

## Alternatives rejetées

- **Champ `status` unique combinant les deux** : rejetée — combinatoire non exhaustive et ambiguë (que signifie « PAUSED_LIVE » vs « LIVE_PAUSED » ?), impossible à auditer proprement.
- **Mode d'exécution comme attribut de Strategy Version plutôt que d'Instance** : rejetée — la même Strategy Version doit pouvoir tourner simultanément en PAPER sur une instance et en LIVE sur une autre (ex. validation continue en parallèle de l'exploitation réelle).

## Conséquences

- Toute requête ou dashboard opérateur doit afficher les deux axes séparément.
- Les gardes de sécurité (ex. INV-5, ADR-0007) s'accrochent spécifiquement aux transitions de l'axe mode d'exécution, jamais à l'axe runtime.

## Preuve AS-IS

Aucune entité équivalente n'existe actuellement (`03-AS-IS-TO-TARGET-GAP-MAP.md` §10, écart `ABSENT`) — décision de conception pure, pas de contrainte héritée du code existant.
