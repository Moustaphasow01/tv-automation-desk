# Certification — résolution administrative du suivi théorique ambigu

Date de certification : 2026-09-08 00:15 UTC  
Ticket : TD2-439  
Release VPS : `theoretical-review-resolution-20260908.1`  
Commit déployé : `513aa6a97f3ab044fc94d06418ecc2c157e73ad2`  
Migration : `069_theoretical_trade_administrative_resolution`

## Résultat

Le suivi théorique `trade_portfolio_order_intent_a056d3b3696a71192b2a6484` a été résolu administrativement après attestation opérateur qu'aucun ordre ni aucune position réelle correspondant ne restait ouvert.

- exposition courante : libérée ;
- effet sur le marché : aucun ;
- résultat historique : indéterminé et conservé ;
- prix de sortie, PnL et R : non inventés ;
- historique d'entrée et événement de revue : conservés ;
- réexécution théorique tardive : bloquée par garde base et application.

## Preuves avant application

- statut brut : `open` ;
- quantité ouverte : `2` ;
- entrée : `29331` ;
- sortie, PnL, R : `null` ;
- fills : `1` entrée théorique ;
- événements théoriques : `2` ;
- outcomes : `0` ;
- commandes provider : `0` ;
- cause : `AMBIGUOUS_INTRABAR_STOP_AND_TARGET` ;
- dry-run : `DRY_RUN_VERIFIED`, exactement un dossier.

## Preuves après application

- ligne de résolution append-only : `1` ;
- statut : `ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE` ;
- disposition exposition : `ADMINISTRATIVELY_RELEASED` ;
- disposition historique : `UNDETERMINED_PRESERVED` ;
- ligne `trades` inchangée : `open`, quantité `2`, entrée `29331`, sortie/PnL/R `null`, révision `0` ;
- compteurs de preuve inchangés : `1` fill, `2` événements, `0` outcome, `0` commande provider ;
- visibilité temporelle avant la résolution : conservée ;
- visibilité courante comme exposition : supprimée ;
- BFF `/api/v1/execution/overview` : `openTrades=0`, `activeOrders=0`, `pendingApproval=0` ;
- le même dossier reste retourné avec ses trois champs de résolution administrative.

## Certification de release et runtime

- construction isolée et archive : vérifiées ;
- sauvegarde PostgreSQL et sauvegarde objets : réussies avant bascule ;
- migration 069 : appliquée ;
- canary : réussi ;
- santé locale et smoke public : réussis ;
- `/healthz` : 200, release correcte ;
- `/readyz` : 200 et `ready=true` ;
- `/status` : 200 ;
- `/front-api/v1/capabilities` : 200 ;
- services Windows : 11/11 `Running` ;
- tâche grains : dernière exécution `0`, état `Ready` ;
- tâche calendrier : dernière exécution `0`, état `Ready` ;
- Telegram : actif et sain ;
- moteur grains : `HEALTHY_IDLE` pendant fermeture marché ;
- prochain instant éligible publié : `2026-09-08T13:30:00Z`.

## Sécurité et risque

- exécution automatique : `false` ;
- exécution physique live : `false` ;
- passerelle NinjaTrader : `disabled` ;
- kill switch : `true` ;
- maximum de contrats broker : `0` ;
- risque monétaire : `500 USD` par position, `2 000 USD` par jour, `4 000 USD` par semaine ;
- calendrier grains : actif, politique `GRAINS_CALENDAR_SOURCE_POLICY_V2_DORMAN_FAS403`.

## Tests

- tests ciblés domaine/application/projections : 27/27 ;
- test PostgreSQL isolé de résolution : 1/1 ;
- suite PostgreSQL grains : 70/70 ;
- runtime grains : 17/17 ;
- Telegram : 34/34 ;
- frontend : 327/327 ;
- audit dépendances frontend : 0 vulnérabilité ;
- build frontend : réussi ;
- gardes de déploiement Windows : réussies.

La garde statique globale conserve trois dépassements déjà présents avant ce lot (taille, complexité et duplication). Les compteurs n'ont pas augmenté avec TD2-439 ; ils restent une dette distincte et ne constituent pas une régression de ce correctif.

## Limite temporelle restante

Le comportement au premier flux réel ZC/ZW ne peut être certifié pendant la fermeture CBOT. La release et les producteurs sont prêts ; la preuve finale de journée live exige l'arrivée des premières bougies fermées après `2026-09-08T13:30:00Z`.
