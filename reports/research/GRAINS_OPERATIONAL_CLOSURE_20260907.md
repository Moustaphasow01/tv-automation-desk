# Clôture opérationnelle grains — lots 0 à 5

Statut : **EN COURS — non certifié, pas encore déployé**. Suivi Jira : TD2-426 / TD2-429.
Autorisation utilisateur du 7 septembre 2026 : calendrier automatique, corrections historiques,
plafonds 500/2 000/4 000 USD, chaîne théorique/Telegram/Focus, parité et robustesse,
déploiement et dépendances.

## Baseline et frontières

- Source : `codex/grains-week-integrity`, `592e0e4806ba49971a9df77070d8949e6e7c1430`.
- VPS contrôlé à 07:43:50 UTC : `grains-risk-integrity-20260906.1`, code `c1a72133d0b2db344c43c8b2d01a2c6d98d383d8`, migration 063, onze services démarrés.
- AUTO/physical broker OFF ; aucun ordre provider ni confirmation humaine de test autorisés.
- Plafonds approuvés, encore absents de la configuration VPS à cette baseline.
- Pas de modification des moteurs de stratégie pour optimiser les jours de recette.

## 0 — Calendrier automatique

Placement : `market-data`. Application `refresh-grains-calendar` avec ports collecte,
archives, publication canonique, verrou et statut. Adapters USDA/archives et ledger PostgreSQL.
Opérations : tâche Windows `DeskFutures-GrainsCalendarRefresh`, toutes les 30 minutes,
limite d'exécution cinq minutes, verrou PostgreSQL interprocessus, activation explicite.

Sources : NASS annuel ICS, dates WASDE officielles, calendrier FAS avec dates/heures
explicites. Aucun jeudi ou jour férié inventé. NASS/WASDE/FAS reçus et parsés en local ;
FAS refuse encore les requêtes depuis le VPS (HTTP 403), y compris dans Edge natif.
**Ce blocage externe n'est pas résolu.** L'utilisateur refuse un relais local : aucun
collecteur ni tâche planifiée sur son PC. Un alias Azure accessible a été écarté faute
de preuve officielle USDA ; l'API ESMIS consultée n'expose pas les prochaines publications ESR.

L'heure de connaissance est celle de fin de réception réelle, jamais le début de requête,
la date de l'événement ou une date historique choisie. Les documents bruts et reçus sont
archivés par empreinte avant publication. Une source incomplète n'est pas publiée comme
couverture valide. Un échec ne prolonge pas le dernier succès. Une version automatisée
expire après six heures ; le runtime passe alors en état périmé et n'admet pas de nouveaux
trades sur ce contexte. Les snapshots historiques qualifiés gardent leur sémantique figée.

Alternatives écartées : remplir la base avec un calendrier supposé ; antidater les
réceptions ; mettre à jour silencieusement la table événementielle historique ; allonger
une fraîcheur à chaque erreur ; appeler Internet pendant la transaction SQL d'append.

Tests locaux : 17 tests refresh réussis (publication, provenance, archives immuables,
échec partiel, horloge, fraîcheur, désactivation, secrets, idempotence et libération du verrou).
Validation PostgreSQL réelle : 8/8 tests ledger et runtime réussis, aucun skip. Le timeout
initial a été rejoué après désaturation de l'environnement ; les deux preuves sont conservées.

## 1 — Résultats et suivis anciens

Audit VPS en lecture seule : six outcomes finaux révision 1 ont `point_value=1`, alors
que le plan canonique autorisé porte 50. Correction attendue via révision, pas suppression
de l'ancienne valeur. ZC : total -1,25 USD enregistré, -62,50 USD après application de
l'économie canonique. ZW : deux résultats -137,50/+137,50 USD, total nul mais erreurs
individuelles bien présentes. Les R et mouvements de prix ne sont pas multipliés par 50.

Les huit anciens plans et signaux sources ne possèdent pas d'entrée exploitable
(`entry.price=null`, économie indisponible). Une zone de setup ne permet pas de reconstruire
un prix officiel après coup. Quatre expirations ont été matérialisées au redémarrage sans
bougie source ; elles ne prouvent pas l'absence de fill historique. Une qualification
administrative append-only `INVALID_ORIGIN_PLAN / UNQUALIFIABLE` est implémentée.
Cette qualification ne fabrique pas un cycle d'exécution et ne libère pas les réserves.
Les expirations sans bougie ne peuvent plus être considérées comme preuve suffisante
de libération par la projection de risque. L'application VPS reste à faire.

## 2 — Plafonds

Activation conditionnée à l'intégrité des résultats et réserves. Budget prévu :
500 USD/position, 2 000 USD/jour, 4 000 USD/semaine. Aucune garantie contre le slippage.
Le suivi théorique et l'autorisation physique restent distincts.

## 3 et 4 — Chaîne et résultats

Frontend VNext : 308/308 tests, typecheck et build réussis. Front historique : 75/75 tests,
typecheck et build réussis avec le lockfile corrigé. Backend final : 1 470 réussis,
zéro échec, 34 tests PostgreSQL conditionnels non exécutés dans ce lancement.
PG historique final : 10/10 tests réels, zéro skip (correction, qualification et moteur).
Ils s'ajoutent aux huit tests PG calendrier/runtime cités plus haut.
Telegram trading : message de test non-ordre livré à 08:57:42 UTC, message 2580.
Configuration inchangée, aucun ordre ni confirmation Human Gate créés.

À effectuer après intégration finale : autres tests PostgreSQL de bout en bout,
recette visuelle du Focus, puis replay figé avec gates complets,
comparaison live et période hors échantillon. Aucun résultat brut de signal ne sera présenté
comme résultat de trade admis. Coûts, qualité M1/M5, dates de connaissance du calendrier et
concentration des gains doivent figurer dans le rapport final.
Le premier replay de ce lot a été invalidé par la protection d'empreinte du code pendant
la fin de synchronisation : aucun résultat retenu. Nouvelle exécution sur 621 fichiers figés.

Limite OOS : aucune fenêtre historique complète NASS/WASDE/FAS n'est actuellement
qualifiable sous la politique stricte de dates FAS explicites. La semaine du 31/08 au
04/09 contient une date ESR dérivée d'une règle de 2019 ; son replay peut servir à la
non-régression conditionnelle, pas à certifier une rentabilité hors échantillon. Les 42
événements legacy sans heure de connaissance ne sont pas promus en preuve historique.

## 5 — Déploiement et dépendances

Correctif Windows testé localement et sur le VPS en répertoire isolé : capture native
UTF-8, codes de sortie bloquants, reprise
de services indépendante d'une journalisation SQL défaillante, reprise de claims uniquement
après rollback compatible et santé vérifiée. Rollback sans redémarrage imbriqué,
respect de `KeepFrozen`. Aucun `SkipTests` prévu. La santé Windows expose désormais
séparément les dégradations du calendrier (dernier échec, cadence >60 min, expiration,
configuration invalide). Un FAS 403 ne déclenche pas à lui seul un rollback logiciel.

Audits npm complets, dépendances de build incluses : zéro vulnérabilité connue dans
les trois racines (racine historique, backend et VNext). Correctifs épinglés sans
changement majeur : `fast-uri` 3.1.6, `qs` 6.16.0, `nanoid` 3.3.18, `postcss` 8.5.23,
`undici` 7.29.0. La seule analyse production aurait manqué trois alertes du build.
Références : [fast-uri](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
[qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).

Contrôles architecture, migrations, runtime safety, compatibilité API, gouvernance PR,
exceptions et kit Windows réussis. Dette préexistante : qualité statique et scorecard
rouges déjà sur la source déployée. Mesure avant/après : fonctions longues 270/270,
complexité 720/719, duplications 95/95 ; aucun plafond augmenté pour obtenir du vert.

## Preuves

`output/research/grains-closure-20260907/` contient la nouvelle baseline VPS et l'audit
des dépendances. Les preuves précédentes restent dans `grains-risk-closure-20260906/`.
Aucun secret, PIN, cookie, URL de connexion ou donnée fictive n'est une preuve livrable.
