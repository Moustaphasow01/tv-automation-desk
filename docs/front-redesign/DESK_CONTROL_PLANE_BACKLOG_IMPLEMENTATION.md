# Desk Control Plane — clôture du backlog consolidé

Date : 2026-08-29  
Branche : `codex/desk-control-plane-backlog`  
Baseline : `ff2c4a3` (`preprod-v2-live-continuity-20260829.1`)

## Résultat

Le backlog DESK-001 à DESK-037 est intégré dans le Control Plane VNext. Les corrections respectent les autorités existantes : le backend reste la source de vérité pour Risk, TargetPosition, OrderIntent, Human Gate et broker ; le frontend explique, navigue, copie et demande les actions publiées par `allowedActions`.

La proposition DESK-033 a été livrée sous la forme du dossier OrderIntent opérable déjà canonique. Le libellé « J’ai passé l’ordre » n’a volontairement pas remplacé `Confirm` : ce libellé prétendrait attester une exécution broker alors que le contrat actuel ne publie pas encore cette capability. `CONFIRM` reste donc distinct de `ACK`, `PARTIAL_FILL` et `FILL`.

## Tickets livrés

| Ticket | État | Preuve fonctionnelle |
|---|---|---|
| DESK-001 | Clos | Les entrées LIMIT nulles ou égales à zéro sont refusées comme prix ; le backend publie l’entrée canonique et le R attendu uniquement avec un plan complet. |
| DESK-002 | Clos | Résolution bidirectionnelle `ZC ↔ ZC1!` et `ZW ↔ ZW1!`, sans doublon dans le sélecteur et avec bougies canoniques. |
| DESK-003 | Clos | `BLOCKED`, `BREACH`, `CIRCUIT_OPEN` et états bloquants utilisent le ton danger centralisé. |
| DESK-004 | Clos | Command Center, Incidents et Jarvis partagent la même population canonique d’incidents ouverts. |
| DESK-005 | Clos | Le tunnel Live compose Signal, Contexte, Portfolio, Risk, TargetPosition, OrderIntent et Human Gate d’une même lignée ; les absences sont explicites et jamais fabriquées. |
| DESK-006 | Clos | Registre unique backend-code → libellé → ton → aide, réutilisé par les vues concernées. |
| DESK-007 | Clos | Navigation Signal ↔ OrderIntent, conséquences cliquables et IDs canoniques publiés. |
| DESK-008 | Clos | Copie de la ligne d’ordre complète et copie unitaire des paramètres avec retour visuel. |
| DESK-009 | Clos | Dernier prix, `asOf`, distance à l’entrée en points/R et sortie de zone publiés par le backend. |
| DESK-010 | Clos | Prédicats, critères, raison du signal et preuves affichés dans le dossier Signal. |
| DESK-011 | Clos | Positions : instrument, côté, quantité, prix moyen et provenance préservés par les projections. |
| DESK-012 | Clos | Ordres broker : identité instrument et source réelles, sans valeur `unavailable` fabriquée. |
| DESK-013 | Clos | Missions de recherche : datasets et ETA sémantiques ; absence rendue « Non publié ». |
| DESK-014 | Clos | Annulation de requête distinguée d’un timeout et d’une indisponibilité réseau. |
| DESK-015 | Clos | Timeline d’audit sans `undefined`, avec valeurs absentes explicitement qualifiées. |
| DESK-016 | Clos | Graphe causal remplacé par des relations lisibles et navigables. |
| DESK-017 | Clos | Libellés de routes et titres de pages issus du même registre. |
| DESK-018 | Clos | Raccourci plateforme adapté à Windows, sans symbole Mac imposé. |
| DESK-019 | Clos | Messages réseau et erreurs opérateur rendus en français clair. |
| DESK-020 | Clos | Limites Risk filtrables, seuil d’attention, état, recherche et vue complète. |
| DESK-021 | Clos | File de décisions paginée, filtrable, avec dossier sélectionné et échéance. |
| DESK-022 | Clos | Centre d’alertes SSE pour nouveau signal, Risk, OrderIntent, Human Gate, incident, échéance imminente et expiration ; préférence visuelle locale par poste. |
| DESK-023 | Clos | Déconnexion opérateur disponible dans le menu et reliée à l’auth backend. |
| DESK-024 | Clos | Replay ouvert sur le run terminé le plus récent plutôt que sur une session inutilisable. |
| DESK-025 | Clos | Le cockpit privilégie les instruments tradés et résout correctement les grains. |
| DESK-026 | Clos | Classement de la palette basé sur les routes et intentions métier. |
| DESK-027 | Clos | Recherche directe typée par identifiant : signal, ordre, stratégie, run, incident et position. |
| DESK-028 | Clos | Jeu de couleurs de statut partagé dans le Design System. |
| DESK-029 | Clos | Actions critiques portées à 44 px minimum et focus clavier visible. |
| DESK-030 | Clos | Libellés de navigation raccourcis sans perdre leur sens métier. |
| DESK-031 | Clos | Contrôle de densité `Compact / Confort` persistant, sans modifier les données. |
| DESK-032 | Clos | Rail Live compact conservé ; libellés courts et aides accessibles évitent les cassures. |
| DESK-033 | Clos avec garde-fou | Dossier d’exécution : ligne copiable, marché courant, distances, expiration, justification et actions backend. Aucune fausse déclaration de Fill n’est introduite. |
| DESK-034 | Clos | Command Center « aujourd’hui » agrège santé, recherche, instances, Human Gate, incidents et sécurité provider. |
| DESK-035 | Clos | Journal réel des refus, motifs fréquents et taux d’expiration par stratégie issus des événements Human Gate persistés. |
| DESK-036 | Clos | Export JSON et impression des rapports de performance. |
| DESK-037 | Clos | Aide globale `?` avec raccourcis et fermeture clavier. |

## Compléments Live Trading

- Activité de session utilisable en plein écran, fermeture `Échap` et restitution du focus.
- Inbox Signal globale, indépendante de l’instrument affiché sur le graphique.
- Trois destinations explicites : décision, graphique contextualisé et dossier complet.
- Le graphique se centre sur la bougie la plus proche de `chartAt` et ne dessine aucun plan dont le côté ou les prix ne sont pas canoniques.
- Le détail Signal distingue état effectif, état brut, validité, expiration, cutoff et données liées.
- Un signal `NEW` dont l’échéance est passée est présenté `EXPIRÉ`, sans réécrire son état brut d’audit.
- Contexte, Portfolio, Risk, OrderIntent, positions théoriques, ordres broker et timeline restent séparés par autorité.
- Les données sensibles post-Risk sont en lecture seule.

## Qualité vérifiée

| Contrôle | Résultat |
|---|---|
| Tests frontend | 256/256 |
| Build TypeScript/Vite | Réussi |
| Tests backend complets | 1 199/1 199 réussis, 1 test plateforme ignoré |
| Rulebook | 50 chapitres, 1 000 règles, parité Markdown/JSON |
| Sélecteur de règles | 60 règles P0/P1 sélectionnées pour ce slice |
| Scanner statique UI/UX | 169 fichiers, 0 erreur P0, 656 avertissements historiques |
| Live Trading visual QA | 5/5 : 1672×941, 1440×900, 1280×800, 390×844, 430×932 |
| Command Center visual QA | 5/5 : 1672×941, 1920×1080, 1440×900, 1024×768, 390×844 |
| Console navigateur | 0 erreur sur les scénarios visuels |
| Sécurité d’exécution | AUTO OFF, LIVE OFF, aucune action broker déclenchée |

Les avertissements statiques restants concernent principalement les couleurs et `!important` historiques des feuilles CSS existantes. Ils ne sont pas masqués et ne sont pas présentés comme une conformité totale ; aucune règle P0 n’a été désactivée.

## Artefacts

- `reports/ui-ux/desk-backlog-static-audit.json` — rapport statique local (ignoré par Git).
- `reports/ui-ux/desk-backlog-rule-selection.md` — sélection des règles du slice (ignorée par Git).
- `reports/ui-ux/live-trading/live-trading-visual-qa.json` — mesures et captures Live (ignorées par Git).
- `reports/ui-ux/command-center/command-center-visual-qa.json` — mesures et captures Command Center (ignorées par Git).

## Condition de déploiement

La branche est prête à être revue et fusionnée. Le déploiement VPS doit rester une étape séparée : release versionnée, sauvegarde, drain contrôlé des producteurs, canary frontend/BFF puis rollback automatique en cas d’échec. Aucun déploiement VPS n’est revendiqué par ce document.
