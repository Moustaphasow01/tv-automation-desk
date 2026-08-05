# Desk Futures — résilience, déploiement et reprise

## Principes non négociables

- PostgreSQL est l’autorité transactionnelle ; le stockage d’objets contient les packs immuables.
- Les files GPT LIVE et Replay sont indépendantes et sont toutes deux fermées pendant une bascule.
- Le verrou broker global est activé avant l’arrêt des producteurs.
- Une release n’est rouverte qu’après canary loopback, santé locale et smoke test HTTPS.
- Les migrations sont additives et forward-only. Le rollback automatique concerne le code.
- Les contrats et packs déjà épinglés ne sont jamais supprimés par la rétention.
- Une lane analytique n'a qu'un propriétaire à la fois : services Codex Windows
  ou tâches ChatGPT MCP de secours, jamais les deux.
- Une montée de version contractuelle ne réécrit aucun work item en cours : les
  runs historiques gardent leurs contrats épinglés et les nouveaux runs
  utilisent la nouvelle pile après réouverture explicite.

## Migration de la pile analytique V5.1/V2.1

La pile cible des nouveaux travaux est Autopilot 5.1.0, Master 5.1.0, Plan 1.1.0,
Monitor 2.1.0, Command 1.1.0, Policy 4.1.0, Catalog 1.1.0, compilateur 1.1.0 et
moteur de conditions 1.1.0. V5.0/V2.0 et V4/V1 restent des artefacts historiques
hash-lockés et en lecture seule. Une migration suit obligatoirement cet ordre :

1. fermer les lanes LIVE et Replay ;
2. arrêter ou passer en `shadow` les services Codex et désactiver les tâches
   ChatGPT de secours ;
3. attendre la fin ou l'expiration de tous les leases ;
4. déployer les schémas, contrats, compilateurs et moteur sans rouvrir les
   claims ;
5. vérifier les IDs épinglés, la compilation LIVE/Replay, le moteur M1, le
   risque `<= 0.25 %` de `NET_EQUITY` et le RR `>= 2` ;
6. exécuter le canary structuré puis le replay comparatif ;
7. rouvrir une seule lane et un seul worker après accord opérateur.

Sous `ENGINE_V5_VALIDATION_HOLD`, un déploiement peut mettre à jour le code et
les contrats, mais il ne doit restaurer ni les claims ni les services IA en
mode `active`.

## Mise à jour normale

`Update-Desk.ps1` exécute automatiquement :

1. sauvegarde PostgreSQL et objets immuables ;
2. vérification de la release et migrations additives ;
3. canary isolé sur loopback ;
4. pause des lanes LIVE/Replay et verrouillage broker ;
5. arrêt des producteurs puis attente des leases/outbox actifs ;
6. bascule atomique de la jonction `current` ;
7. santé locale et smoke test public ;
8. restauration exacte des contrôles antérieurs.

Si la nouvelle release échoue après la bascule, le code précédent est restauré.
Si le rollback ne peut pas être vérifié, les claims et l’exécution restent
verrouillés : il ne faut jamais les rouvrir manuellement sans diagnostic.

Lors d'un rollback V5.1/V2.1, ne convertir ni réépingler aucun document vers
V5.0/V2.0 ou V4/V1. Le code
précédent peut être restauré, mais toute lane reste fermée si elle contient un
work item épinglé sur une pile que ce code ne sait pas valider. La reprise se
fait avec une release compatible ou par décision opérateur documentée, jamais
par modification des hashes ou du payload stocké.

## Sauvegardes

- PostgreSQL : quotidien, format custom, SHA-256, rétention 14 jours.
- Objets immuables : hebdomadaire, archive `tar.gz`, SHA-256, rétention 28 jours.
- Une copie hors VPS est obligatoire.
- La vérification hebdomadaire restaure réellement PostgreSQL dans une base
  isolée et lit l’archive des objets.

## Reprise après perte du VPS

Sur une machine neuve, avec PostgreSQL et les prérequis installés :

```powershell
.\deploy\windows\Invoke-DeskDisasterRecovery.ps1 `
  -DatabaseDump "D:\recovery\desk-native-....dump" `
  -ObjectArchive "D:\recovery\desk-objects-....tar.gz" `
  -TargetDatabaseUrl "<url-owner-base-cible>" `
  -TargetObjectRoot "C:\ProgramData\DeskFutures\objects" `
  -ConfirmRecovery
```

Ensuite installer la même release que celle du catalogue de sauvegarde, garder
NinjaTrader en Sim101 et le kill switch actif, puis exécuter :

```powershell
.\deploy\windows\Test-DeskLocalHealth.ps1
.\deploy\windows\Test-DeskDeployment.ps1 -PublicBaseUrl "https://<domaine>"
```

La reprise est refusée si une somme diffère, si le répertoire objet cible n’est
pas vide, si le schéma broker manque ou si la santé publique échoue.

## Objectifs

- RPO base : 24 h maximum ; plus faible si le dossier hors site est synchronisé.
- RPO packs : 7 jours maximum, les objets étant immuables et reconstructibles.
- RTO visé : 2 h après disponibilité d’un Windows VPS propre.
