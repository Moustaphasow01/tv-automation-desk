# Grains — temps réel et horloge du journal

## Mandat et baseline

Lot autorisé par « go next chantier », 7 septembre 2026. Tickets **TD2-433**, **TD2-435**, et dépendance de sécurité découverte **TD2-437**. Ce rapport complète `GRAINS_CONTEXT_RESUMPTION_20260907.md` sans remplacer ses résultats historiques.

- Branche : `codex/grains-week-integrity`, HEAD initial `ed2f400f074c49cf944e1cc9eaec353993715bd0`.
- Worktree : `TV_Automation_LIVE_FOCUS_VNEXT`, aucun changement suivi initial ; `mcp_gpt_desk/nul` et `output/` non suivis préexistants conservés.
- VPS vérifié à **16:58:48 UTC** : `grains-context-resumption-20260907.2`, source `ba4e78730c1c885bfd59fa7fc065c7d87a98e434`, migration `067_portfolio_administrative_reservation_cancellation`.
- Onze services Running/Automatic. Calendrier AVAILABLE : 74 événements, trois sources, publication 16:39:19.671 UTC, échéance de fraîcheur 22:39:19.671 UTC, cadence 30 minutes autonome VPS.
- Risque inchangé : 500 USD/position, 2 000/jour, 4 000/semaine. AUTO/LIVE physiques OFF, aucun ordre ni confirmation Human Gate autorisés par cette recette. Analyste grains existant consultatif ; aucune activation d'un autre worker.
- Preuve : `output/research/grains-realtime-ledger-20260907/baseline-runtime-policy.json`.

## Slice, placement et alternatives

1. **Adaptateur de persistance audit/outbox** : comparer le curseur événementiel directement dans PostgreSQL, sans conversion intermédiaire vers une date JavaScript qui perd les microsecondes. Consommateur : BFF SSE. Pas de nouvel événement métier ni d'une autre machine d'état provider.
2. **Présentation temps réel/cache** : invalider les clés réellement utilisées, y compris Live Focus isolé ; dédupliquer avant les effets secondaires ; reprendre les lectures après déconnexion. Consommateurs : vues existantes. Pas de modification graphique, de calcul métier, de permissions ni de reload global.
3. **Persistance portfolio et projection d'exposition** : distinguer l'heure métier causale de l'heure technique d'enregistrement. Consommateurs : même runtime live et replay. Ne pas rendre les résultats reproductibles en masquant des différences significatives dans le comparateur.
4. **Admission des tâches pendant déploiement** : le claim Agent Runtime doit partager le verrou `producer_hold`, puis le drain doit attendre les tâches avant d'arrêter les services. Les contrôles legacy `live/replay=PAUSED` restent indépendants et inchangés. Le superviseur Research ACTIVE/NO_WORK préexistant n'est pas basculé arbitrairement en shadow.

Alternatives écartées : accélérer le polling pour cacher la panne SSE ; dédupliquer seulement l'affichage ; arrondir arbitrairement le curseur ; supprimer toutes les dates du replay ; recalibrer stratégie/risque sur vendredi.

## Contrat opérateur et traçabilité

Objectif : un nouveau brief publié doit devenir visible dans le panneau existant sans attendre le polling, déplacer la lecture ou faire passer une source ancienne pour fraîche. Le backend demeure l'autorité de toutes les valeurs et actions.

| Besoin | Source et chemin | État | Preuve attendue |
| --- | --- | --- | --- |
| Nouveau brief visible | Persistance contexte → outbox → SSE → cache scoped → vue BFF Focus → panneau | Publié, daté ; sans mutation optimiste | Même identifiant depuis événement jusqu'au rendu avant prochain polling |
| Éviter une boucle de rafraîchissements | Curseur DB natif + IDs reçus + reducer/cache | Doublon compté, pas de nouvelle commande/refetch | Microsecondes PostgreSQL, pagination, déduplication QueryClient |
| Reprendre une connexion | Curseur → snapshot canonique → queries réellement montées | Déconnecté/reconnexion/ancien état explicites | Coupure et reprise ; lecture sûre si panne persistante |
| Journal causal reproductible | Cutoff injecté → lineage/exposition → décision portfolio | Heure métier séparée de la persistance technique | Deux runs figés sous horloges différentes, comparaison des champs significatifs |

Sources lues : AGENTS, standards d'ingénierie, catalogue/glossaire, ADR 0009/0010/0024, Page Operating Contract Live, spécification Focus, protocole et extensions UI/UX, chapitres 25/35/40/46/47.

Règles applicables : **UXR-0481/0482/0486/0487/0489/0500**, **0681/0682/0683/0687/0688/0689/0697/0699/0700**, **0784/0785/0786/0793/0797/0798/0800**, **0903/0904/0908/0909/0914/0915/0920**. Sélection contextuelle exécutée avant code. Aucune dérogation P0 nouvelle ; le scanner seul ne certifie pas le respect du référentiel.

## Critères de validation et limites

- Tests ciblés puis régressions frontend/backend, vrais tests PostgreSQL et guards architecturaux.
- Même vendredi gelé : mêmes données, version de stratégie, politique et population. Les horodatages métier significatifs ne sont pas supprimés du comparatif.
- Recette navigateur et déploiement versionné avec sauvegarde/drain/canary si le lot est validé ; recontrôle des sécurités et de l'analyste après release.
- Le vendredi historique reste **conditionnel**, avec trous OHLC/provenance/calendrier connus. Ce lot ne certifie ni PIT historique ni rentabilité hors échantillon.
- L'ordre du curseur `(created_at_utc, id)` ne constitue pas un ordre de commit total : les transactions tardives doivent être distinguées de la correction de précision. Ne pas déclarer une livraison SSE exactement une fois.

## Résultats intermédiaires vérifiés

| Contrôle | Résultat | Preuve locale |
| --- | --- | --- |
| Frontend Windows Vitest complet | 323/323, 64 fichiers, après test de réponses lentes | `output/research/grains-realtime-ledger-20260907/frontend-validation.md` |
| Cache/SSE ciblé + vrai montage React | 22/22 ciblés, montage 1/1 ; TypeScript et ESLint ciblé verts | Même relevé ; commandes exactes et limites |
| Curseur PostgreSQL + frontière HTTP SSE réelle | 2/2, microsecondes et retour aux heartbeats après quatre publications | `outbox-http-final-postgres-tests.log` dans le même dossier de preuves |
| Outbox/BFF unitaires | 57/57 | `outbox-bff-unit-tests.log` |
| Première régression backend complète | 1 547 réussis, 48 skips, 0 échec / 1 595 tests | `backend-regression.log` |
| Admission Agent Runtime | 28/28 unitaires et 2/2 PostgreSQL réels ; deux sens du verrou claim/pause | `deployment-validation.md` |
| Déploiement Windows natif | 109 fichiers, drain/tâches/reprise verts ; première bascule avec `RequireEmptyAgentQueue` après sauvegardes | `deployment-validation.md`, `windows-guard-direct.log` |
| Architecture backend/frontend et compatibilité API | Verts | `architecture-guard.log`, `front-architecture-guard.log`, `api-compatibility.log` |
| Isolation legacy et mode données réelles | Verts | `front-legacy-isolation.log`, `front-data-mode.log` |
| Rulebook | 1 000 règles valides, tests sélecteur/scanner verts | `uiux-rulebook-tests.log` |
| Scanner heuristique initial du lot | 0 erreur, 883 avertissements / 202 fichiers ; pas une certification exhaustive | `uiux-audit.json` |
| Contrôle qualité statique global | Rouge préexistant, mêmes écarts sur HEAD initial exporté sans modifications | `static-quality.log` et `static-quality-baseline.log` |

Le contrôle global signale : `packages/desk-domain/index.js` 601 lignes pour 600 ; 271 fonctions surdimensionnées pour 250 ; 722 complexités élevées pour 650 ; 97 duplications pour 72. Aucun seuil n'est abaissé. Dette ciblée supprimée : huit branches de clés de cache écrites directement dans RealtimeProvider → zéro, politique centralisée testée. Les horloges d'ingestion demeurent auditables ; elles ne sont plus utilisées comme dates métier dans les réservations concernées.

### Contre-revues intégrées

- Une rafale d'événements distincts pouvait annuler indéfiniment des lectures lentes. Le correctif attend la lecture en vol, accumule les vues concernées et effectue une relecture de rattrapage, sans annulations successives. Test différé : huit invalidations, zéro abandon, un rattrapage et dernière donnée affichée.
- L'état courant provider ne peut être qualifié par n'importe quel ancien événement : preuve de transition compatible au lifecycle, timestamps causaux claim/dispatch et statut de commande concordant requis. Un état BLOCKED silencieux ou un LEASED ancien sans preuve reste PARTIAL. Les millisecondes des Date PostgreSQL sont conservées.
- La première suite PostgreSQL a révélé une fixture incohérente : cible/gate reculés au 1er septembre, mais demande toujours au 4. Le helper recale désormais aussi la demande ; l'attendu KNOWN est conservé et le test ciblé repasse. Aucune donnée métier réelle n'a été changée pour faire passer le test.
- La première bascule depuis `ba4e787` exige la file Agent Runtime entièrement vide après Pause, pas seulement un ancien préflight avant sauvegardes. Le flag transitoire compte cinq états non terminaux et conserve DRAIN en cas d'échec. Les futures releases gardées peuvent conserver leurs tâches READY en attente. Aucune création opérateur/externe n'est autorisée pendant cette fenêtre ; il ne s'agit pas d'une barrière contre un administrateur écrivant hors protocole.

## Observations VPS avant livraison

- Navigateur réel 17:04–17:06 UTC : 65 événements reçus pour 28 IDs distincts. Les quatre événements de publication contexte ont chacun été reçus trois fois. Le brief a fini par apparaître via les lectures BFF, ce qui ne prouvait pas son rafraîchissement SSE.
- Un appel Focus 503 transitoire a été observé ; lectures suivantes 200. Ne pas déclarer une baseline réseau sans erreur.
- À 17:20:56 UTC : aucun Agent Runtime READY/PENDING/CLAIMED/RUNNING en attente ; uniquement anciennes erreurs terminales. `producer_hold=OPEN`, zéro commande provider et zéro confirmation humaine pendant le lot. Preuve `agent-drain-preflight.json`.
- **TD2-436, backlog distinct non corrigé ici** : plusieurs réveils contextuels sur un même choc ZW et des bougies arrêtées au 4 septembre, alors que la session du 7 est fériée. Les briefs reconnaissent la fermeture ; aucun ordre n'en résulte. Réveils observés 16:45 et 17:00 ; suppression des réveils redondants à traiter séparément sans modifier la détection des setups.

## Avancement et non-certifications

Source locale encore en validation ; release active demeure `grains-context-resumption-20260907.2` tant qu'une preuve de bascule n'est pas ajoutée ci-dessous. Régressions backend, drain, double replay et recette post-déploiement restent à terminer. Aucune clôture Jira ni certification de rentabilité ne découle des seuls tests ci-dessus.
