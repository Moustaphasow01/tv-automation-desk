# Runbook de déploiement et cutover — VPS Windows

Date : 2026-07-23
Mode initial obligatoire : shadow + NinjaTrader Sim101.

> **Archive opérationnelle du cutover initial.** Les références Autopilot V4,
> Master V4, Monitor V1 et connecteur GPT de ce document décrivent la bascule du
> 23 juillet et ne doivent pas servir à réactiver les workers actuels. Pour la
> pile V5.1/V2.1 et la propriété des lanes, utiliser
> `CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md` et
> `DESK_RESILIENCE_AND_DR_RUNBOOK.md`. Sous
> `ENGINE_V5_VALIDATION_HOLD`, aucune commande d'activation de ce document ne
> doit être exécutée.

Les exemples utilisent `desk.example.com`. Remplacer ce nom uniquement après
avoir obtenu le domaine. Toutes les commandes PowerShell sont exécutées depuis
un terminal administrateur, sauf la configuration interactive NinjaTrader.

## 1. Préparer localement une release

Depuis le dépôt préproduction propre :

```powershell
.\deploy\windows\Build-DeskRelease.ps1 -Version 2026.07.23.1
.\deploy\windows\Test-DeskRelease.ps1 -ReleaseRoot .\.local\releases\2026.07.23.1
```

Le résultat est un dossier versionné, un ZIP et un fichier `.sha256`. Ne
transférer vers le VPS que le ZIP et sa somme de contrôle par un canal sécurisé.
Une release marquée `dirty=true` est réservée aux répétitions locales.

Si le front a été construit et testé dans CI ou WSL, le builder Windows peut
emballer cet artefact sans réinstaller les dépendances frontend Windows :

```powershell
.\deploy\windows\Build-DeskRelease.ps1 `
  -Version 2026.07.23.1 `
  -UsePrebuiltFront
```

Ce mode refuse un `dist` absent, les source maps et la clé de développement
locale. Sans cette option, la compilation Windows complète reste le défaut.

## 2. Provisionner le VPS

1. appliquer toutes les mises à jour Windows ;
2. créer un compte administrateur d'exploitation distinct ;
3. activer RDP avec NLA et restreindre sa source au VPN ou aux IP d'administration ;
4. réserver au minimum les volumes système, données PostgreSQL et sauvegardes ;
5. créer l'enregistrement DNS `A` vers l'IPv4 fixe ;
6. ne publier aucun port applicatif ou PostgreSQL.

Installer les prérequis :

```powershell
.\deploy\windows\Install-DeskPrerequisites.ps1 -IncludePostgreSql -Apply
.\deploy\windows\Test-DeskPrerequisites.ps1
```

L'installation PostgreSQL demande le mot de passe superuser et le répertoire de
données. Les enregistrer dans le coffre de récupération chiffré.

## 3. Initialiser PostgreSQL natif

Dans le terminal courant, définir trois secrets distincts d'au moins 20
caractères sans les écrire dans Git :

```powershell
$env:DESK_DB_OWNER_PASSWORD = "<secret-owner>"
$env:DESK_DB_RUNTIME_PASSWORD = "<secret-runtime>"
$env:DESK_DB_BACKUP_PASSWORD = "<secret-backup>"
$env:DESK_DB_MIGRATION_URL = "postgresql://desk_owner:<secret-owner>@127.0.0.1:5432/desk"
$env:DESK_DB_RESTORE_URL = "postgresql://desk_owner:<secret-owner>@127.0.0.1:5432/desk_restore_check"

.\deploy\windows\database\Initialize-DeskPostgres.ps1 `
  -AdminDatabaseUrl "postgresql://postgres@127.0.0.1:5432/postgres"
```

Configurer `pg_hba.conf` pour n'accepter que loopback, redémarrer PostgreSQL puis
tester :

```powershell
.\deploy\windows\database\Test-DeskDatabase.ps1 `
  -DatabaseUrl "postgresql://desk_runtime:<secret-runtime>@127.0.0.1:5432/desk"
```

## 4. Exporter Docker et restaurer

Sur la machine locale, pendant une fenêtre où les écritures sont gelées :

```powershell
.\deploy\windows\database\Export-DeskDockerDatabase.ps1
```

Transférer le `.dump` et le `.sha256` vers le VPS. Sur le VPS :

```powershell
.\deploy\windows\database\Restore-DeskDatabase.ps1 `
  -DumpPath "D:\imports\desk-docker-YYYYMMDDTHHMMSSZ.dump" `
  -TargetDatabaseUrl "postgresql://desk_owner:<secret-owner>@127.0.0.1:5432/desk" `
  -CleanTarget -ConfirmRestore

.\deploy\windows\database\Invoke-DeskSchema.ps1 `
  -DatabaseUrl "postgresql://desk_owner:<secret-owner>@127.0.0.1:5432/desk" `
  -SchemaDirectory ".\infra\postgres\init" `
  -ReleaseVersion "2026.07.23.1"

.\deploy\windows\database\Test-DeskDatabase.ps1 `
  -DatabaseUrl "postgresql://desk_runtime:<secret-runtime>@127.0.0.1:5432/desk" `
  -RequireBrokerSchema
```

Avant la bascule, comparer la source encore accessible et la cible :

```powershell
.\deploy\windows\database\Compare-DeskDatabases.ps1 `
  -SourceDatabaseUrl "<source-url>" `
  -TargetDatabaseUrl "<target-url>"
```

Tout écart bloque le cutover.

## 5. Installer la release

```powershell
.\deploy\windows\Install-Desk.ps1 `
  -ReleasePath "D:\releases\desk-2026.07.23.1.zip" `
  -Domain "desk.example.com" `
  -TlsEmail "ops@example.com"
```

L'installateur :

- vérifie chaque fichier de la release ;
- crée `C:\DeskFutures\releases\<version>` et la jonction `current` ;
- crée les secrets initiaux et les ACL ;
- applique les migrations ;
- installe les quatre services WinSW ;
- installe les tâches de santé et de sauvegarde ;
- démarre le runtime.

`DESK_DB_RUNTIME_PASSWORD` doit rester identique au bootstrap. L'installateur ne
le régénère jamais. Les URL owner de migration/restauration sont fournies dans le
processus d'installation ; seule l'URL de restauration est conservée dans un
fichier de maintenance à ACL restreinte pour le contrôle planifié.

Déplacer immédiatement
`C:\ProgramData\DeskFutures\config\initial-secrets.txt` vers le coffre chiffré,
puis le supprimer du VPS.

## 6. Pare-feu, TLS et smoke test

Prévisualiser puis appliquer :

```powershell
.\deploy\windows\Set-DeskFirewall.ps1
.\deploy\windows\Set-DeskFirewall.ps1 -Apply
```

Contrôler que seules les interfaces loopback écoutent sur 5432 et 8787, et que
80/443 sont les seuls ports publics. Après émission TLS :

```powershell
.\deploy\windows\Test-DeskDeployment.ps1 `
  -PublicBaseUrl "https://desk.example.com"
```

Le test vérifie le frontend, la santé, les métadonnées OAuth et le refus d'un
webhook non authentifié.

## 7. NinjaTrader en Sim101

Installer NinjaTrader dans le compte Windows interactif dédié, se connecter au
compte de démonstration puis :

```powershell
.\deploy\windows\Install-DeskNinjaTrader.ps1
```

Importer et compiler la source copiée sous :

```text
C:\ProgramData\DeskFutures\ninjatrader\addon-source\DeskExecutionAddOn.cs
```

Configurer l'AddOn avec l'URL loopback et le secret stocké dans
`C:\ProgramData\DeskFutures\config\desk.env`. Vérifier dans le front :

- compte `Sim101` ;
- bridge désarmé ;
- kill switch actif ;
- zéro contrat maximum avant arming ;
- auto-redémarrage choisi explicitement ;
- heartbeat et snapshots reçus.

Le gestionnaire de positions doit être validé sur toute sa matrice Sim101 avant
toute discussion LIVE : entrée, rejet, cancel, stop initial, modification stop,
partials, target, fermeture, reconnexion, désynchronisation et kill switch.

## 8. Shadow et cutover

Ordre obligatoire :

1. API et frontend publics sans TradingView ni GPT ;
2. restauration et lectures PostgreSQL ;
3. TradingView vers la nouvelle URL, sans ordre broker ;
4. connecteur GPT vers `/mcp`, Autopilot V4 uniquement ;
5. LIVE V4 en shadow et continuité paper ;
6. NinjaTrader Sim101 ;
7. observation minimale de plusieurs sessions ;
8. bascule fonctionnelle seulement si toutes les gates sont vertes.

Ne jamais modifier les contrats Master V4 ou Monitor V1 pendant cette fenêtre.

## 9. Sauvegarde et restauration

Avant chaque update :

```powershell
.\deploy\windows\database\Backup-DeskDatabase.ps1 `
  -DatabaseUrl "<runtime-or-backup-url>" `
  -BackupDirectory "D:\DeskBackups" `
  -OffsiteDirectory "\\backup-host\DeskFutures" `
  -ReleaseVersion "2026.07.23.1"
```

Au moins une sauvegarde doit être hors VPS. La tâche hebdomadaire restaure la
dernière sauvegarde dans une base temporaire et valide le schéma. Une sauvegarde
non restaurée n'est pas considérée comme testée.

## 10. Mise à jour et rollback

Mise à jour atomique avec sauvegarde préalable :

```powershell
.\deploy\windows\Update-Desk.ps1 `
  -ReleasePath "D:\releases\desk-2026.07.24.1.zip" `
  -Domain "desk.example.com" `
  -TlsEmail "ops@example.com"
```

Rollback code :

```powershell
.\deploy\windows\Rollback-Desk.ps1 `
  -DataRoot "C:\ProgramData\DeskFutures"
```

Les migrations PostgreSQL sont forward-only et ne sont pas annulées par ce
rollback. Une restauration de base exige une décision opérateur distincte et
`Restore-DeskDatabase.ps1 -ConfirmRestore`.

Pour une répétition hors VPS, `Install-Desk.ps1 -Rehearsal` exige simultanément
`-SkipServices`, `-SkipMaintenanceTasks`, `-SkipDatabaseMigration` et
`-SkipStart`. `Update-Desk.ps1 -Rehearsal` exige `-SkipBackup`. Ces modes sont
destinés aux répertoires de test ; ils ne changent pas les défauts de production.

## 11. Critères d'arrêt

Arrêter ou revenir à la release précédente si :

- un contrôle de somme ou une comparaison DB échoue ;
- l'API ne passe pas `/readyz` ;
- le webhook n'est pas authentifié ou perd son idempotence ;
- deux schedulers ou workers sont actifs simultanément ;
- la projection LIVE diverge du Replay V4 ;
- l'AddOn signale un compte autre que Sim101 ;
- le kill switch ou la réconciliation ne fonctionne pas ;
- aucune sauvegarde hors VPS restaurable n'existe.
