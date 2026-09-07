# Release VPS — intégrité grains et risque

Date : 7 septembre 2026. Suivi : **TD2-429**.

## Résultat

**Code déployé et services redémarrés. Cela ne certifie pas encore un desk grains capable d'admettre de nouveaux ordres.** Le producteur du nouveau calendrier canonique reste manquant et les plafonds monétaires approuvés ne sont pas activés.

| Élément | Preuve |
| --- | --- |
| Ancienne release | `live-focus-dashboard-20260905.2`, `3ed9f242c640e6b0885f5523ba2349c3203ca94a` |
| Release servie | `grains-risk-integrity-20260906.1` |
| Source backend / frontend | `c1a72133d0b2db344c43c8b2d01a2c6d98d383d8` |
| Branche source | `codex/grains-week-integrity`, arbre suivi propre lors du build |
| Build | `2026-09-06T12:57:57.2925686Z` |
| Front JS | `index-SvKJspBQ.js` |
| Front CSS | `index-CNeeGDsH.css` |
| Migration appliquée | `063_grains_calendar_version_ledger` |
| Déploiement vérifié | `deploy-20260907T014110Z-1194b3f5` |
| Services | 11/11 `Running`, démarrage `Automatic` |
| API réelle | `/healthz`, `/readyz`, `/status`, `/front-api/v1/capabilities` : HTTP 200 |
| Readiness | `ok=true`, `ready=true`, nouvelle release retournée |
| Sécurité | AUTO et broker physique OFF, Ninja désactivé, kill switch actif, maximum physique 0 |
| Telegram | service démarré ; Telegram et notifications manuelles activés dans la configuration |
| Ordres provider | 0 avant et après ; aucun Human Gate confirmé pour les tests |

La branche n'a pas été fusionnée dans `main` pendant ce déploiement. Le push Git Windows n'a pas abouti dans cette session ; ne pas confondre le code effectivement déployé avec la publication de la branche distante. Le paquet a été construit depuis un checkout isolé et propre du commit exact, transféré par bundle Git.

## Paquet et contrôles

Build officiel complet, sans `SkipTests`, sans source sale et sans ancien frontend précompilé. Les 5 197 fichiers du paquet ont été vérifiés par `Test-DeskRelease.ps1`.

- Archive SHA256 : `086717e1deef7e4c6d8d3172b30e145ce65acd3e5e92f770b10a93f9b19cc4a8`.
- Empreinte manifeste : `d8ebe42a7bbae66b95b559d389f8a7b6905f36813605e8d746143969eba91fd3`.
- Migration 063 SHA256 : `aa9b19f851a0ed61fc59dede4e21b58f28565bfa4c515bcd01139cbd18807792`.
- Frontend VNext : **308/308** tests.
- Frontend historique : **75/75** tests.
- Backend : **1 439 réussis, 0 échec, 32 ignorés** sur 1 471 tests. Les tests ignorés ne sont pas des preuves positives.
- Typecheck, build frontend et contrôle des contrats : réussis.
- Canary sur port local 18787 : réussi avant bascule.
- Contrat SQL de lineage théorique 058 : revérifié, réussi.
- Contrôle local puis contrôle public de déploiement : réussis, y compris rejet d'un webhook sans secret.
- Les tests PostgreSQL ciblés 51/51 sont des preuves du lot précédent, documentées dans `GRAINS_RISK_CLOSURE_20260906.md`, pas un nouveau replay réalisé pendant ce déploiement.

Le premier build dans le workspace partagé a rencontré un module natif frontend verrouillé. Le build final a utilisé un checkout isolé sur le VPS et un runtime Python de build temporaire. Aucun processus de travail de l'autre agent n'a été arrêté, aucun test n'a été retiré pour obtenir un build vert.

## Incident de déploiement et reprise

1. Première tentative `deploy-20260906T131209Z-261b6e89` : sauvegardes réalisées, producteurs arrêtés, drain terminé à 13:13:03 UTC le 6 septembre. Pas de migration 063 ni de bascule.
2. Les événements PowerShell établissent l'échec de `Invoke-DeskSchema.ps1` sur les messages PostgreSQL français, `NativeCommandError` puis encodage UTF8 invalide `0xbd`. Ce défaut était déjà décrit dans `docs/SESSION_REPORT_FRONTEND_VNEXT_2026-08-20.md`.
3. Au contrôle du 7 septembre, seule l'ancienne API et Caddy étaient actifs ; neuf services étaient arrêtés. La reprise automatique n'avait pas rétabli les producteurs. Ne pas présenter cette période comme un fonctionnement continu réussi.
4. Rétablissement par `Invoke-DeskDrain -Action Fail`, `Start-DeskServices`, contrôle de santé, puis `Resume -CompletionStatus rolled_back`. L'ancien manifeste et les verrous de sécurité ont été contrôlés avant reprise.
5. Nouvelle tentative dans une tâche Windows ponctuelle indépendante de la session SSH. Contournement **limité au processus** : `PGOPTIONS=-c client_min_messages=warning`, encodage UTF8 explicite. Aucun changement global du serveur PostgreSQL ; avertissements et erreurs restent contrôlés.
6. Réutilisation des sauvegardes terminées après vérification SHA256 des fichiers réels ; `SkipBackup` évite uniquement leur recréation. Aucun contournement du drain, des migrations, du canary, du contrôle des fichiers ou des tests de santé.
7. Migration 063 appliquée, canary réussi, installation, reprise des onze services, contrôle public réussi et restauration des anciens contrôles de claims/exécution. Résultat de la tâche : 0. Marqueur final : `RELEASE_DEPLOYED_SAFETY_PRESERVED`.

Le défaut structurel de reprise du script officiel reste à corriger et à tester durablement : un échec de journalisation SQL dans le `catch` ne doit pas empêcher le rétablissement sûr des services. Le contournement de cette session n'est pas cette correction définitive.

## Sauvegardes

Les sauvegardes quotidiennes et les objets du 5/6 septembre ont été copiés hors VPS dans un répertoire local privé, fichiers en lecture/écriture propriétaire uniquement, avec sommes SHA256 vérifiées. Le contrôle planifié de restauration isolée avait terminé avec résultat 0 le 6 septembre.

La reprise utilise :

- `desk-native-20260907T001502Z.dump` ;
- `desk-objects-20260906T130745Z.tar.gz`.

Leurs empreintes ont été vérifiées sur le VPS avant le nouveau drain. Les deux fichiers ont ensuite été copiés hors VPS et `sha256sum -c` a retourné **OK pour chacun**. Cette copie ponctuelle ne remplace pas une rotation externalisée automatisée. La tâche temporaire de reprise a été retirée après constat de son résultat 0 ; son journal est conservé.

## Configuration volontairement inchangée

Les montants approuvés sont **500 USD par position, 2 000 USD par jour, 4 000 USD par semaine**. Ils restent une cible autorisée, **pas une politique activée** sur le VPS.

Les paramètres suivants restent absents comme avant la release :

- `DESK_SHADOW_RISK_SIZING_MODE` ;
- `DESK_SHADOW_RISK_MAX_MONETARY_RISK` ;
- `DESK_SHADOW_RISK_CURRENCY` ;
- `DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY` ;
- `DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY` ;
- `DESK_SHADOW_PORTFOLIO_SELECTION_POLICY`.

Ni `MONETARY_RISK_BUDGET` ni `BEST_COMPLETE_PLAN_V1` n'ont été activés. Les anciens défauts de configuration restent ceux du runtime existant ; ne pas afficher « protection à 500 USD active ». Les montants sont des budgets de risque prévus, pas une garantie contre le glissement d'exécution.

## Prochains chantiers, dans l'ordre

| Priorité | Chantier | Critère de clôture |
| --- | --- | --- |
| P0 | Calendrier grains prospectif | Collecter les sources USDA nécessaires, qualifier leur couverture et leur date de connaissance, persister des versions canoniques, planifier le refresh, exposer fraîcheur/erreurs. Aucun historique de réception inventé. |
| P0 | Résultats et réserves historiques | Corriger avec révisions traçables les 6 résultats grains concernés par `point_value=1` au lieu de 50 ; qualifier les 8 intentions grains anciennes, y compris 4 terminalités matérialisées au redémarrage sans bougie source. Ne pas assimiler expiration à absence de fill. |
| P0 | Activation de la politique monétaire | Après assainissement prouvé, activer 500/2 000/4 000 USD et tester pertes, réservations, changements de jour/semaine, reprises et idempotence. |
| P0 | Résilience du déploiement | Préflight PostgreSQL/encodage, logs durables indépendants de SSH, reprise résiliente même si son audit SQL échoue, scénario d'échec testé sans ordre physique. |
| P1 | Recette réelle complète | À réception de données valides : moteur → contexte → portefeuille → risque → intention → validation humaine → suivi théorique → Telegram/Focus. Préserver LIMIT ≠ rempli et ACK ≠ FILL. |
| P1 | Parité et robustesse | Rejouer à données et règles identiques, comparer les signaux tradables et résultats théoriques ; puis période hors échantillon, coûts/glissement et concentration des gains. Aucune promesse de rentabilité. |
| P1 | Maintenance et dette | Corriger les dépendances vulnérables héritées `fast-uri`/`qs`, automatiser les sauvegardes externes/restaurations et réduire la dette statique existante sans abaisser les seuils. |

### Pourquoi le calendrier est bloquant

La migration crée un registre append-only mais aucune version initiale. Le runtime live appelle `loadGrainsCalendarVersionAt` ; une base vide ne fournit pas de calendrier ni de couverture valides. Les collecteurs/importeurs existants produisent des fichiers de qualification ou des entrées de replay, mais aucun producteur live planifié n'alimente ce registre. Le filtre contexte refuse donc l'admission en absence de preuve : c'est un **blocage de production de données**, pas un frontend à remplir artificiellement.

Les moteurs déterministes restent chargés de détecter leurs signaux. Ne pas les arrêter ni modifier leurs conditions pour compenser ce blocage ; la décision d'admission reste en aval.

Contrôle indépendant post-migration entre 01:52 et 01:54 UTC, en transaction read-only : **0 version, 0 source, 0 événement** dans les trois nouvelles tables. Preuves de câblage :

- `infra/postgres/init/063_grains_calendar_version_ledger.sql:5` : DDL sans seed ;
- `mcp_gpt_desk/src/persistence/postgres-grains-runtime-inputs.js:25` : lecture du ledger ;
- `mcp_gpt_desk/src/persistence/postgres-grains-calendar-ledger.js:37` : retour vide sans version ;
- `mcp_gpt_desk/src/us-grains-causal-context.js:93` : admission soumise à couverture causale ;
- `deploy/windows/Run-UsGrainsShadowRuntime.ps1:30` : suite et pipeline, aucun collecteur calendrier ;
- `scripts/collect_usda_grains_calendar.mjs:38` et `scripts/import_grains_calendar_evidence.mjs:23` : sorties fichiers, pas de producteur live.

Après reprise, les six résultats erronés restent inchangés : quatre ZC totalisant -1,25 USD enregistrés, deux ZW totalisant 0 USD, malgré une valeur de point canonique de 50 au lieu de 1. Un total ZW nul n'établit pas la validité des résultats individuels. Les huit anciennes intentions gardent une économie indisponible. Quatre événements `entry_expired` ont été matérialisés par le moteur à **01:45:27 UTC le 7 septembre**, avec date économique au 27 août et `source_candle_timestamp_utc=null`. Ils réduisent le décompte courant à `pending=48`, `monetary_gap_count=4`. **Ce ne sont pas quatre historiques certifiés** : il reste à revoir leurs payloads et leur provenance, notamment l'absence de preuve de bougie. La matérialisation d'une fin au redémarrage ne prouve pas rétroactivement l'absence d'un fill antérieur.

L'exclusion de réserve s'appuie sur cet événement dans `mcp_gpt_desk/src/portfolio-theoretical-exposure-repository.js:74` ; la terminalité est persistée par `recordTheoreticalEntryExpired` dans `mcp_gpt_desk/src/broker-theoretical-execution-repository.js:266`. Ces automatismes du runtime redémarré sont distingués d'une correction manuelle : aucune campagne de nettoyage ni réécriture d'outcomes n'a été lancée pendant la release.

## Portée de la vérification utilisateur

La disponibilité technique de l'API n'est pas une certification de calendrier complet, d'admission de trades, de livraison Telegram d'un nouveau signal ou de rentabilité. Aucun ordre physique, aucune confirmation Human Gate ni nouvelle recherche n'a été lancé pour valider cette release.

Contrôle dans Chromium réel, nouvelle session opérateur backend :

- connexion obligatoire avant accès ; authentification backend réelle, aucun mock ;
- page Live chargée, titre `Live · Desk Control Plane`, sections marché, chart ZW/M5, pipeline et activité présentes dans le snapshot DOM ;
- JS `index-SvKJspBQ.js` et CSS `index-CNeeGDsH.css` réellement téléchargés avec HTTP 200 ;
- vues BFF `auth-session`, `live-trading`, `live-trading?instrument=ZW`, `orders`, `execution-incidents` reçues en HTTP 200 ;
- console observée : **0 erreur, 0 avertissement** ;
- plusieurs requêtes de polling `live-trading` annulées côté navigateur (`ERR_ABORTED`) observées, sans réponse 4xx/5xx dans la capture. Leur cause détaillée n'a pas été certifiée dans ce smoke test.

**Limite visuelle :** les captures d'écran ont expiré, même avec 60 secondes de délai. L'environnement local était saturé (environ 158 Mo disponibles, swap 2 Go utilisé et charge >50). Les snapshots DOM et le réseau sont enregistrés, mais cela ne constitue ni une recette visuelle complète Live/Focus ni un nouveau test responsive/axe/performance. Aucune capture inexistante n'est livrée comme preuve.

## Preuves locales

Répertoire : `output/research/grains-risk-closure-20260906/`.

- `release-manifest.json`, `build-release-vps.log` ;
- `deploy-before.json`, `deploy-after.json`, `vps-health-after.json` ;
- `recover-and-deploy-vps.log`, `recover-and-deploy.ps1` ;
- contrôles de dépendances et guards du lot ;
- `output/playwright/grains-release/live-after-snapshot.txt`, `requests-after.txt` ;
- rapport de clôture métier : `reports/research/GRAINS_RISK_CLOSURE_20260906.md`.

Les secrets, PIN, cookies opérateur et URL PostgreSQL ne font pas partie de ce rapport.
