# Autopilot V4 — cible PREPROD locale

Date de gel : 2026-07-20.

## Invariants

- PostgreSQL est l'unique base opérationnelle.
- Les objets de packs sont immuables et disponibles dans le stockage local.
- Firestore et Google Cloud ne participent pas au runtime.
- Les contrats Master et Monitor, l'anti-lookahead, les gates, le RR et la
  machine de thèse restent inchangés.
- Le replay et le LIVE utilisent la même chaîne V4. Seule la source temporelle
  change.
- Les données importées de PROD sont historiques, en lecture seule et exclues
  des alertes opérationnelles PREPROD.

Le périmètre exécutable et les familles exclues sont définis dans
`config/autopilot-v4-scope.json`.

## Ordre d'exécution

1. Geler et sauvegarder PREPROD.
2. Définir le périmètre V4.
3. Capturer la journée golden du 1er juin 2026.
4. Compléter le schéma SQL.
5. Rendre toutes les sources nécessaires lisibles localement.
6. Installer le stockage immuable local et son catalogue.
7. Générer les packs depuis PostgreSQL.
8. Vérifier la parité des bundles Master et Monitor.
9. Valider les transitions transactionnelles PostgreSQL.
10. Exécuter un replay local complet.
11. Exposer le profil MCP V4.
12. Valider le parcours GPT-compatible du 1er juin.
13. Brancher LIVE sur la même préparation V4.
14. Isoler l'historique importé.
15. Retirer le legacy par lots, avec tests entre chaque lot.

Le déploiement VPS est explicitement hors de ce chantier.

## État d'exécution au 20 juillet 2026

Les étapes `1` à `15` sont terminées dans PREPROD. La phase `16` de
déploiement VPS n'a pas été commencée.

- sauvegarde PostgreSQL et stockage objet réalisées avant mutation ;
- scope exécutable V4 figé dans `config/autopilot-v4-scope.json` ;
- schéma SQL, catalogue d'objets et stockage immuable local installés ;
- pack builder PostgreSQL branché au replay et au LIVE ;
- preuve golden Master → Monitor réalisée ;
- transactions, leases et roll-forward LIVE non régressés ;
- profil MCP limité à Autopilot V4 ;
- historique importé isolé en lecture seule ;
- legacy retiré par lots et audit actif à zéro finding.

## Sauvegarde

La sauvegarde initiale a été créée avant toute modification :

- PostgreSQL :
  `/tmp/tv_automation_preprod_20260720T120523Z.dump`
- Objets :
  `/tmp/tv_automation_preprod_objects_20260720T120523Z.tar.gz`

Les sommes SHA-256 ont été consignées dans le journal d'exécution.

## Critères de sortie

- aucune référence `gs://` n'est requise pour exécuter la journée golden ;
- un pack local échoue fermé si un objet ou son intégrité manque ;
- Master, Monitor, setup et position suivent les mêmes contrats que PROD ;
- claim, heartbeat, complete et fail conservent leur garde de lease ;
- le profil MCP V4 masque les outils legacy ;
- les données importées ne créent plus d'incidents PREPROD ;
- les familles legacy retirées n'ont plus de référence runtime ;
- les tests replay, LIVE, contrats et persistance restent verts.

## Résultats de sortie

- backend MCP : `264/264` tests verts ;
- frontend React : `16/16` tests verts ;
- pile Docker réelle : `4/4` scénarios Playwright verts ;
- audit cleanup : `251` fichiers scannés, `0` finding actif,
  `0` script sans référence ;
- stack locale : PostgreSQL et API healthy, frontend servi sur la pile
  Docker PREPROD ;
- `desk_cross_asset_deltas` : `0` document ;
- objets immuables : `36/36` READY, vérifiés et immuables ;
- imports PROD : `36` replays et `7` curseurs LIVE classés
  `prod_import/history/read_only`.
