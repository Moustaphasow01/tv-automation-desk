# Desk Futures — Release Windows VPS V5.1 strictement gelée

Date de préparation : 1er août 2026

Release nominale : `2026.08.01-engine-v5-1-hold.3`

## Objectif

Installer le moteur déterministe V5.1 et ses contrats sur le VPS Windows sans démarrer d'analyse LIVE, de Replay ou d'exécution broker. Le déploiement produit un environnement vérifiable, mais ne prépare ni ne publie aucun run. L’import r2 et la préparation du 11 juin restent deux étapes gelées, explicites et séparées.

Ce runbook ne contient aucun secret. Les URLs PostgreSQL et les clés restent dans les fichiers ACL-restreints sous `C:\ProgramData\DeskFutures\config`.

## Invariants non négociables

Après chaque étape de déploiement, de préparation ou de rollback :

- les lanes `live` et `replay` sont `PAUSED`, `enabled=false`, raison `ENGINE_V5_VALIDATION_HOLD` ;
- les services producteurs `DeskFuturesLiveRuntime`, `DeskFuturesReplayPreparation`, `DeskFuturesBrokerManagement`, `DeskFuturesCodexLive01`, `DeskFuturesCodexLive02` et `DeskFuturesCodexReplay01` sont `Stopped` et `Disabled` ;
- aucun work item n'est `READY` ou `CLAIMED` ;
- aucun curseur LIVE n'est `LEASED` ;
- aucune préparation Replay n'est `QUEUED`, `DATA_CHECK` ou `PACK_BUILDING` ;
- aucun run non terminal n'est activé ;
- aucune config Replay non terminale n'est activée ;
- le verrou broker global est actif ;
- aucun outbox broker d'exécution ou de gestion n'est actif ;
- les contrats persistés actifs sont Master 5.1.0, Monitor 2.1.0, Execution Plan 1.1.0, Monitor Command 1.1.0, Condition Catalog 1.1.0 et Execution Policy 4.1.0 ;
- le runtime Autopilot est `5.1.0`, le compilateur déterministe `1.1.0` et le moteur de conditions `1.1.0`.

Le mot `replay-v4` peut encore apparaître comme identifiant historique du groupe de file. Il ne désigne pas le moteur ou le contrat exécuté : la configuration préparée référence explicitement Autopilot 5.1.0, V5.1/V2.1/V4.1 et les composants V1.1.

## 1. Construction locale de l'artefact

Dans une console PowerShell locale ouverte à la racine de PREPROD :

```powershell
$ReleaseName = "2026.08.01-engine-v5-1-hold.3"
.\deploy\windows\Invoke-DeskV5FrozenRelease.ps1 `
  -Stage Build `
  -ReleaseName $ReleaseName
```

Cette commande régénère toujours les artefacts de contrats, revérifie leur codegen et leurs hashes même avec `-SkipTests`, puis exécute le typecheck, les tests front et backend, construit le front, installe les dépendances backend de production, crée le manifest et génère :

- `.local\releases\2026.08.01-engine-v5-1-hold.3\` ;
- `.local\releases\2026.08.01-engine-v5-1-hold.3.zip` ;
- `.local\releases\2026.08.01-engine-v5-1-hold.3.zip.sha256`.

Ne pas utiliser `-AllowDirty` pour un artefact candidat à la production. Ce flag est réservé aux répétitions explicitement jetables.

Contrôle local supplémentaire :

```powershell
.\deploy\windows\Test-DeskRelease.ps1 `
  -ReleaseRoot ".local\releases\2026.08.01-engine-v5-1-hold.3" `
  -RequireV5Frozen
```

## 2. Transfert vers le VPS

Copier le ZIP, son fichier `.sha256` et le dossier complet du package M1 r2 dans un répertoire d'arrivée non exposé par Caddy, par exemple :

```text
C:\DeskFutures\incoming\2026.08.01-engine-v5-1-hold.3.zip
C:\DeskFutures\incoming\2026.08.01-engine-v5-1-hold.3.zip.sha256
C:\DeskFutures\incoming\2026-06-11-v5-m1-r2\import-ready\tradingview_m1_backfill_manifest.json
```

Vérifier sur le VPS :

```powershell
$Zip = "C:\DeskFutures\incoming\2026.08.01-engine-v5-1-hold.3.zip"
$Expected = ((Get-Content "$Zip.sha256" -Raw).Trim() -split "\s+")[0]
$Actual = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLowerInvariant()
if ($Actual -ne $Expected.ToLowerInvariant()) { throw "Checksum mismatch" }
```

## 3. Préflight gelé sur le VPS

Exécuter en PowerShell administrateur :

```powershell
Get-Service DeskFuturesLiveRuntime,DeskFuturesReplayPreparation,DeskFuturesBrokerManagement,DeskFuturesCodexLive01,DeskFuturesCodexLive02,DeskFuturesCodexReplay01 |
  Select-Object Name,Status,StartType
```

Les six services doivent déjà être `Stopped/Disabled`. L'orchestrateur refuse le déploiement si ce prérequis n'est pas respecté.

Vérifier aussi que les fichiers protégés existent, sans afficher leur contenu :

```powershell
Test-Path "C:\ProgramData\DeskFutures\config\desk.env"
Test-Path "C:\ProgramData\DeskFutures\config\maintenance.env"
```

Le second fichier, ou l'environnement du processus, doit fournir `DESK_DB_MIGRATION_URL`. Ne jamais saisir cette URL directement dans l'historique de commandes.

## 4. Déploiement nommé, toujours gelé

```powershell
$ReleaseName = "2026.08.01-engine-v5-1-hold.3"
$Zip = "C:\DeskFutures\incoming\$ReleaseName.zip"
$ControlRoot = "C:\DeskFutures\incoming\control-$ReleaseName"
if (Test-Path -LiteralPath $ControlRoot) {
  throw "ControlRoot existe déjà ; vérifier ou supprimer explicitement ce staging avant de reprendre."
}
Expand-Archive -LiteralPath $Zip -DestinationPath $ControlRoot

& "$ControlRoot\deploy\windows\Invoke-DeskV5FrozenRelease.ps1" `
  -Stage DeployFrozen `
  -ReleaseName $ReleaseName `
  -ReleasePath $Zip `
  -Domain "vps-6d6969db.vps.ovh.net" `
  -TlsEmail "<adresse-tls>"
```

Le déploiement :

1. vérifie le manifest, ses checksums, les hashes des contrats et le codegen
   embarqué ;
2. sauvegarde PostgreSQL et le store d’objets ;
3. met en pause le drain, arrête tous les producteurs et désactive les six
   producteurs de la pile V5.1 ;
4. applique le hold transactionnel aux lanes, work items, cursors, configs,
   runs et broker ;
5. vérifie le gel strict et zéro travail actif **avant** toute migration ;
6. applique les migrations de façon idempotente ;
7. vérifie la canary de la release cible ;
8. bascule la jonction `current` ;
9. conserve les six producteurs Live/Replay/Broker/IA arrêtés et désactivés ;
10. garde les lanes en hold au lieu d’appeler le chemin normal `Resume` ;
11. seed atomiquement les contrats actifs V5.1/V2.1/V4.1 et V1.1, tout en
    conservant les versions antérieures comme legacy immuable ;
12. vérifie les contrats persistés et tous les invariants gelés ;
13. écrit un reçu sous `C:\ProgramData\DeskFutures\status`.


Le manifest de release V5.1 force automatiquement `KeepFrozen` même si l'opérateur oublie le switch interne correspondant.

## 5. Vérification indépendante

```powershell
C:\DeskFutures\current\deploy\windows\Invoke-DeskV5FrozenRelease.ps1 `
  -Stage VerifyFrozen `
  -ReleaseName "2026.08.01-engine-v5-1-hold.3"
```

Cette commande échoue si un seul invariant n'est plus vrai. Elle ne modifie aucune lane, aucun run et aucun service.

Vérifier le manifest installé :

```powershell
$Manifest = Get-Content "C:\DeskFutures\current\release-manifest.json" -Raw | ConvertFrom-Json
$Manifest | Select-Object version,release_profile,git_commit,dirty
```

Résultat attendu : `release_profile=deterministic_strategy_v5_frozen` et `dirty=False`.

## 6. Importer et vérifier le package M1 r2, sans préparer de Replay

Le package de marché reste externe à l’archive applicative. Copier le dossier
`import-ready` complet : le manifest, les deux CSV, la preuve de capture et le
rapport d’acquisition doivent rester côte à côte.

```powershell
$R2 = "C:\DeskFutures\incoming\2026-06-11-v5-m1-r2\import-ready"
C:\DeskFutures\current\deploy\windows\Invoke-DeskV5FrozenRelease.ps1 `
  -Stage ImportJune11R2 `
  -ReleaseName "2026.08.01-engine-v5-1-hold.3" `
  -June11R2PackagePath $R2
```

Le stage refuse tout manifest différent du SHA-256
`0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054`.
Il utilise `DESK_DB_MIGRATION_URL` depuis l’environnement protégé ou
`maintenance.env`, sans l’afficher ni le passer en argument :

1. contrôle le gel strict et les six services ;
2. exécute un import `--dry-run` obligatoirement rollbacké ;
3. importe transactionnellement le package exact ;
4. réexécute le même import et exige `ALREADY_IMPORTED` ;
5. vérifie le reçu PostgreSQL, les 2 640 lignes M1, leurs hashes/proofs/policy
   et les 528 buckets M5 exacts ;
6. revérifie le gel et écrit un reçu local.

Cette commande est idempotente. Elle ne crée ni préparation, ni config, ni run,
ni work item. `-PrepareJune11AfterDeploy` est interdit : l’import doit rester
une décision opérateur explicite et observable.

## 7. Préparer le Replay V5.1 du 11 juin, sans le lancer

Cette étape ne doit être exécutée qu’après le succès de `ImportJune11R2` :

```powershell
C:\DeskFutures\current\deploy\windows\Invoke-DeskV5FrozenRelease.ps1 `
  -Stage PrepareJune11 `
  -ReleaseName "2026.08.01-engine-v5-1-hold.3"
```

Le script :

- refuse de travailler si le gel strict n’est pas intact ;
- refuse tout reçu r2 absent ou divergent avant de construire le pack ;
- crée ou réutilise une préparation `full_day` M5 pour le `2026-06-11` ;
- rejette un ancien pack qui ne scelle pas l’import, le manifest, la preuve, la
  policy et les hashes des sources MNQ/MES ;
- scelle cette preuve dans le pack, la config et le reçu de préparation ;
- crée ou met à jour une config V5.1 avec `enabled=false` et `status=PAUSED` ;
- refuse de publier la préparation ou de continuer si un run associé existe ;
- revérifie qu’aucun run n’a été créé et que le desk reste gelé.

La commande est idempotente : une seconde exécution réutilise la même
préparation et la même configuration.

## 8. Rollback conservant le gel

Le rollback du code ne doit jamais rouvrir les lanes ni démarrer les workers :

```powershell
C:\DeskFutures\current\deploy\windows\Invoke-DeskV5FrozenRelease.ps1 `
  -Stage RollbackFrozen `
  -ReleaseName "2026.08.01-engine-v5-1-hold.3"
```

Le rollback :

- crée un nouveau drain ;
- attend zéro travail actif ;
- restaure la jonction vers la release précédente ;
- exécute le seed de contrats de la release précédente ;
- termine par `CompleteFrozen`, jamais par `Resume` ;
- utilise le vérificateur de la release de contrôle pour prouver le gel même si
  l’ancienne release ne contient pas encore ce vérificateur.

Les migrations PostgreSQL sont forward-only. Un rollback applicatif ne supprime
donc aucune colonne ni aucune donnée V5.1 ; il restaure le code et l’activation
des contrats compatibles, tout en conservant le desk arrêté.

## 9. Ce qui n'est volontairement pas fait

Ce chantier ne :

- contacte pas le VPS pendant la préparation locale ;
- ne redémarre aucun service maintenant ;
- ne démarre aucun worker GPT/Codex ;
- n'active aucune lane ;
- ne publie aucun Replay ;
- n'autorise aucun ordre NinjaTrader ;
- ne déverrouille pas le broker ;
- ne bascule pas le compte Sim101 en mode exécution.

L'activation de validation sera un changement opérateur séparé, après revue des contrats, du pack du 11 juin et des résultats du contrôle gelé. Elle doit disposer de son propre runbook, de ses propres critères stop/go et d'un rollback immédiat.

## 10. Preuves à conserver

Archiver avec le numéro de release :

- le ZIP et son SHA256 ;
- `release-manifest.json` ;
- les sorties de `Build`, `DeployFrozen`, `VerifyFrozen`, `ImportJune11R2` et `PrepareJune11` ;
- le reçu `v5-frozen-release-*.json` ;
- le reçu `health.json` ;
- l'identifiant du drain et les sauvegardes créées avant bascule ;
- le JSON sûr produit par `prepare_v5_frozen_replay.mjs` (sans secret).

Critère de succès final : la V5.1 est installée, les contrats et l’import r2 exact sont persistés et vérifiés, le Replay du 11 juin est préparé mais désactivé, et zéro processus analytique ou broker n'est capable de démarrer sans une décision opérateur ultérieure explicite.
