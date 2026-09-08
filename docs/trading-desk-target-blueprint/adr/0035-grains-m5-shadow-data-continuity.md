# ADR-0035 — Continuité M5 des stratégies grains en SHADOW

Date : 2026-09-08. Statut : accepté pour le périmètre explicitement autorisé par l'opérateur, activation après tests.

## Contexte

Les quatre familles du catalogue grains v1 calculent leurs candidats sur les bougies M5 clôturées. La qualité imposait pourtant un historique M1 complet. Le 8 septembre, des valeurs M1 figées ont bloqué les candidats alors que le M5 continuait à progresser. Le contexte de marché bornait également les prix à la plus ancienne clôture des quatre flux M1/M5.

## Décision

Le module market-data possède une politique pure publiée par `@tv-automation/desk-domain` : `M1_M5_STRICT` (défaut inchangé) ou `M5_FALLBACK`. L'adapter de configuration résout `DESK_US_GRAINS_M5_FALLBACK_ENABLED`, OFF par défaut. Les consommateurs sont la qualité grains, le runtime déterministe, le préfiltre du bus, la readiness et le contexte consultatif.

- Le repli admet uniquement un M5 de qualité READY : couverture, volume, plage de prix, absence de grands trous et de doublons, date et progression vérifiées au cutoff causal. M1 reste diagnostiqué honnêtement, jamais reconstruit ni déclaré sain par le repli.
- Le bus exige une identité du catalogue existant, l'une des quatre familles, un instrument ZC/ZW, timeframe M5 et origine SHADOW. Il vérifie encore la politique courante et les preuves M5. Une désactivation bloque les signaux de cette politique encore en attente, même si la préférence de contexte embarqué est désactivée.
- La readiness ne requiert M5 seul que si toutes les instances actives appartiennent aux huit identités SHADOW compatibles. Toute instance inconnue, PAPER/LIVE ou périmètre mixte conserve M1+M5 obligatoires. Les seuils de fraîcheur et la provenance durable ne sont pas élargis.
- Le bundle consultatif borne ses prix aux sources obligatoires M5 ; les sources M1 restent visibles et peuvent être STALE/UNAVAILABLE mais ne sont plus obligatoires. Calendrier et session restent obligatoires. Le hash de déduplication distingue la politique. Un ancien bundle de repli ne peut être exécuté après désactivation du flag.
- Les autres stratégies ne peuvent pas utiliser un snapshot M5 dégradé pour contourner leurs exigences : ce repli requiert un signal causal de la suite compatible.
- Aucun changement de Risk, expiration, Human Gate, kill switch, maximum de contrats ou autorité fournisseur. Aucun rejeu historique écrit et aucune promotion PAPER/LIVE.

## Contrats et compatibilité

Ajouts optionnels : `data_policy`, `data_mode`, `required_timeframes`, `optional_timeframes`, `blocking_issues`, `reason_codes` dans la qualité ; scope et diagnostic de readiness ; `dataPolicy` dans les bundles. Les payloads stricts existants restent acceptés. Les identifiants causaux des signaux sont inchangés : l'activation ne remplace pas les anciens signaux par des versions réinterprétées. Aucune migration SQL ni dépendance nouvelle.

## Alternatives écartées

Ignorer globalement la qualité, élargir les délais, synthétiser du M1 à partir de M5, supprimer les données anciennes, réémettre des signaux expirés et créer un moteur M5 parallèle : ces options masqueraient la panne ou changeraient les règles d'exécution.

## Déploiement, contrôle et retour arrière

Une release versionnée passe les tests avant activation. `Set-DeskGrainsDataPolicy.ps1` applique un changement audité avec comparaison de révision et sauvegarde protégée. Le redémarrage contrôlé des consommateurs recharge la politique. Le retour à `M1_M5_STRICT` par le même outil restaure la règle M1+M5 sans effacer les preuves ; le kit de rollback conserve aussi la release précédente. Le repli ne répare pas TradingView et ne supprime pas le délai de l'abonnement CBOT.

Tests attendus : politique OFF/ON, panne/récupération M1, défauts M5, invariance causale, scope SHADOW, rollback, calendrier/expiration, cutoff des bundles, SQL réel et chaîne bus → Risk → HumanGate sans commande fournisseur. Les preuves d'exécution et les limites sont consignées dans le rapport de livraison.
