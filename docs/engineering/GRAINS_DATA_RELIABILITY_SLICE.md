# TD2-426 — fiabilité des données, tranche hors marché

Date : 2026-09-05. Branche : `codex/grains-week-integrity`. Baseline : `fe6b79f17024f1dcfd3cf2278268b176cd1ae6f0`.

## Responsabilités et périmètre

Le pilote conserve les choix d'architecture, les critères d'acceptation et la revue d'intégration. Les tâches techniques déléguées sont séparées : diagnostic historique (Luna), ingestion PostgreSQL (Terra), projection de santé et diagnostic opérateur (Terra). Aucun agent ne modifie les alertes TradingView, le VPS ou les services dans cette tranche.

Le propriétaire est `market-data`. Le webhook est un adapter entrant ; les écritures restent dans l'adapter PostgreSQL existant. Le diagnostic opérateur consomme la projection existante de santé. Les agrégations historiques sont des diagnostics sans effet sur la stratégie, le Risk ou les résultats de positions.

Alternatives écartées : nouveau service de pull, nouvelle base ou message queue, deuxième moteur, modification des seuils pour obtenir un état vert, changement visuel préalable et réécriture de l'heure d'arrivée des données historiques.

## Contrat temporel

| Information | Autorité et sens | Limite |
|---|---|---|
| `timestamp_utc` / `source_bar_open_utc` | Ouverture de la bougie source | Ne prouve pas sa disponibilité |
| `source_bar_close_utc` | Ouverture + durée canonique du timeframe | Ce n'est pas l'heure de réception |
| `received_at_utc` / événement `received_at` | Horloge injectée côté réception backend | Jamais une valeur fournie par le client |
| `event_first_persisted_at_utc` | `tradingview_events.imported_at`, première insertion en base | Timestamp de transaction, pas preuve de visibilité après commit |
| Bougie `imported_at` | Première insertion de l'identité de bougie | Ne date pas la disponibilité d'une version corrigée |
| `event_id` dans la bougie courante | Relation vers le payload d'ingestion correspondant | Pas de rapprochement silencieux avec un autre payload |
| `timing_provenance_version` | Marqueur de la sémantique des nouvelles ingestions | Ne certifie jamais rétroactivement un événement legacy |

Les doublons d'un événement conservent sa première réception enregistrée. Une horloge ultérieure reculée ne doit pas réécrire cette preuve. Une correction OHLC ne doit pas hériter artificiellement de l'heure de disponibilité de l'ancienne valeur. Les anciennes données sans journal suffisant restent de provenance temporelle non certifiée.

Les délais sont séparés : clôture → réception, réception → première persistance du même événement, clôture → première insertion de bougie, puis calcul/publication lorsqu'un lien prouvé existe. Une durée absente reste absente ; une durée négative est une anomalie, pas un zéro sain.

## Santé et diagnostic

- Les lectures « dernière bougie clôturée » sont bornées à l'horloge d'observation et à la clôture réelle du timeframe.
- Les instruments/timeframes requis sont vérifiés par identité ; des feeds dupliqués ne remplacent pas un feed manquant.
- Tous les feeds obligatoires doivent satisfaire la date de marché, pas seulement celui dont la date est la plus récente.
- La fraîcheur de la bougie et la ponctualité de son arrivée sont distinctes. Les budgets métier existants ne sont pas modifiés dans cette tranche.
- Une fermeture de session est explicitement distinguée d'une panne ; elle ne transforme pas une source manquante ou inconnue en source saine.
- Le diagnostic suit le périmètre actif ZC/ZW et ne recommande pas de redémarrer/importer au seul motif qu'il n'y a pas de nouvelles bougies hors marché.

## Preuves attendues

1. Tests de contrat webhook : horloge fixe, champs temporels explicites, client non autoritaire, secrets absents des événements.
2. PostgreSQL isolé réellement migré : double réception, recul d'horloge, événement legacy, nouvelle version OHLC, timestamp DB et absence de mutation broker.
3. Santé/doctor : clôture M5 vs ouverture, futur, feed manquant masqué par doublon, dates mixtes, fermeture normale et données indisponibles.
4. Audit historique reproductible, empreinte du fichier d'entrée et cohortes distinctes : ensemble des M5 vs M5 liées aux signaux. Aucune prétention de reconstruire une réception non journalisée.
5. Contrôle M1/M5 : fenêtres complètes, incomplètes, limites de session et valeurs divergentes séparées, sans remplacement automatique d'une source.
6. Revue indépendante du diff, suite backend et guards applicables. Dette touchée mesurée ; les échecs préexistants ne sont pas masqués.

## Limites et suites

La cause amont du retard de dix minutes n'est pas encore attribuée. Les lectures VPS du 5 septembre retrouvent ce décalage dans les événements webhook M1 et M5 des 3–4 septembre, déjà au niveau de la réception enregistrée. Les durées HTTP disponibles ne l'expliquent pas. Les diagnostics et améliorations de preuve ne constituent pas à eux seuls sa résolution. Voir `reports/research/GRAINS_DATA_TIMING_AND_RUNTIME_SLICE_20260905.md` pour les populations, dates UTC, erreurs HTTP et limites des événements legacy.

Restent distincts : analyse/correction du contexte et des workers, moteur causal TD2-429, requalification des stratégies, déploiement et observation prospective d'une session ouverte. Aucune tâche Jira n'est passée Done avant ses preuves complètes.

## Budget et suivi

Le compteur partagé observé passe de 12 % au lancement à 21 % en fin de vérification, soit +9 points sur le compte. Ce n'est pas une mesure isolée de ce lot ni une économie Astra certifiée : d'autres tâches peuvent consommer simultanément, et le contrôle ne ventile pas par modèle. Les modèles délégués sont Terra et Luna ; le nombre de tâches simultanées dépend des périmètres réellement indépendants. Aucun crédit de réinitialisation n'a été utilisé.

## Validation réalisée

Commandes exécutées avec Node Windows (`node.exe`) dans ce worktree ; les scripts npm équivalents sont ajoutés au package racine :

| Contrôle | Résultat réel |
|---|---|
| Suite backend complète, `node.exe --test --test-concurrency=4 --test-reporter=spec mcp_gpt_desk/test/*.test.js` | 1 320 tests, 1 315 passent, 0 échec, 5 ignorés conditionnels ; pas une certification E2E VPS |
| `test:grains:data` : webhook, santé, diagnostic M1/M5 et doctor | 34/34 passent |
| `test:grains:runtime` : lanceur, publisher et bus | 13/13 passent après dernière extraction |
| `test:grains:postgres` : suivi théorique, réception, santé couplée et course pause/publication | 19/19 passent, 0 ignoré ; bases temporaires séparées, 62 migrations par base puis suppression |
| Audit du ledger figé | 17 044 lignes acceptées ; empreinte octets vérifiée, 14 divergences sur 520 fenêtres complètes pour la semaine |
| Architecture | PASS, 452 fichiers, pas d'exception ajoutée |
| `git diff --check` | PASS |
| Qualité statique globale | FAIL antérieur conservé ; fonctions longues 273 → 272, complexité 723 → 723, duplications 106 → 106, fichiers potentiellement morts 23 → 23. Budgets inchangés ; les dettes de fichiers legacy restent ouvertes |

Le processus Node Windows ne trouve pas `rg`. Une tentative de pont WSL a renvoyé une erreur d'exécution et un faux zéro, explicitement rejeté comme preuve. Le validateur est renforcé pour ne pas confondre un échec de recherche avec l'absence de violations. Aucun résultat « zéro usages d'horloge » issu de cette tentative n'est retenu.

Une exécution native WSL a ensuite été possible avec `/home/u01i003/.nvm/versions/node/v20.20.2/bin/node` : le vrai contrôle échoue sur **133 usages d'horloge implicite, budget 130 inchangé**. Sa suite comporte 4 tests réussis sur 5 ; l'assertion historique « current repository passes » échoue sur ce même dépassement. Les scénarios de SQL, horloge et erreur d'outil passent. Ce résultat rouge reste une dette à traiter avant certification globale, pas une réussite artificielle liée à un outil inexécuté.

Les 5 tests ignorés de la suite backend générale sont 4 suites PostgreSQL déclenchées séparément ci-dessus et un test de l'adapter Codex conditionné par la plateforme Windows. Aucun test existant n'a été supprimé ni désactivé.

### Tranche connexe TD2-429

Le lanceur grains extrait est testable sans invocation automatique. Son heartbeat ne change plus `runtime_state`, ni les dates d'arrêt/démarrage/échec. `--dry-run` et `--no-publish`, y compris la valeur textuelle `true`, sont normalisés avant création du store ; une valeur invalide est refusée. La factory conserve son comportement par défaut pour les autres scripts.

Le chemin grains interne exige une instance encore RUNNING sous verrou PostgreSQL lors d'une nouvelle publication. Une pause concurrente qui gagne ce verrou produit une non-publication motivée et n'empêche pas les autres signaux du batch. Une publication antérieure reste disponible après une pause, avec son idempotence. Ce garde n'est pas un champ contrôlable du signal HTTP.

Cette tranche ne supprime pas encore le filtrage historique via `accepted_signals`, le calcul de contexte sur une journée complète, ni tous les problèmes de disponibilité temporelle du calendrier et des bougies dans le runner. Elle ne doit donc pas être présentée comme la fin du moteur commun causal.
