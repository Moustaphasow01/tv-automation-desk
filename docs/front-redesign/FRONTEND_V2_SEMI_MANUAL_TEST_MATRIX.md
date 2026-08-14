# Front V2 — Matrice de test semi-manuel

| ID | Scénario | État Front | Preuve attendue / dépendance |
| --- | --- | --- | --- |
| SM-01 | projection actuelle sans contrat Human Gate | PASS | Mode et actions `UNAVAILABLE`, aucune action réseau |
| SM-02 | champs post-Risk | PASS | aucun `input`, `select`, `textarea` ou mutation pour instrument/side/account/quantity/entry/stop/targets |
| SM-03 | absence de `allowedActions.CONFIRM` | PASS | confirmation impossible avec raison visible |
| SM-04 | action CONFIRM backend explicite | READY / BLOCKED | commande construite uniquement depuis l'action publiée ; attend CN-EXE-003 |
| SM-05 | permission step-up sans preuve | PASS | confirmation bloquée ; aucune simulation MFA |
| SM-06 | lifecycle | PASS | CONFIRMED, ACK, PARTIAL_FILL et FILL ont libellés/aides distincts |
| SM-07 | statut provider inconnu | PASS | fallback `UNKNOWN`, raw code dans l'inspecteur |
| SM-08 | reconciliation mismatch | READY / BLOCKED | divergence persistante ; attend CN-EXE-005 |
| SM-09 | provider déconnecté/stale | READY / BLOCKED | lecture seule et fraîcheur ; attend CN-EXE-006 |
| SM-10 | SSE sans séquence | PASS | aucune séquence inventée |
| SM-11 | SSE avec doublon/gap | PASS UNIT / BLOCKED E2E | doublon ignoré, gap signalé ; attend l'enveloppe CN-EXE-007 |
| SM-12 | Risk REJECT | READY / BLOCKED | aucune confirmation/commande ; attend CN-EXE-002/003 |
| SM-13 | commande acceptée | PASS | ACCEPTED/RUNNING n'est jamais rendu comme FILL |
| SM-14 | parcours réel | BLOCKED | dossier → Human Gate → provider → reconciliation ; attend TD2-417 |

Les scénarios SM-04, SM-08, SM-09, SM-11, SM-12 et SM-14 deviennent E2E bloquants dès que les contrats correspondants sont publiés par le BFF.
