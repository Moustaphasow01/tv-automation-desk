# Reprise du Trading Desk depuis un poste neuf

## Objectif

Ce document permet de reprendre le développement et l'exploitation sans
dépendre de l'ancien PC. Git contient le code, les contrats, les migrations,
les scripts de déploiement et la documentation. PostgreSQL sur le VPS reste la
source de vérité des données opérationnelles. Les secrets ne sont jamais
stockés dans Git.

## Sources de vérité

| Élément | Source canonique |
|---|---|
| Code et documentation | `https://github.com/Moustaphasow01/tv-automation-desk.git` |
| Branche d'intégration | `main` |
| Baseline avant cette passation | `2ee9a722efdaa5e7d69bcbca13f475d53bce6738` |
| Release VPS certifiée | `portfolio-risk-truth-20260908.2` |
| Données métier | PostgreSQL 16 du VPS |
| Objets et preuves runtime | `C:\ProgramData\DeskFutures\objects` et sauvegardes VPS |
| Configuration productive | `C:\ProgramData\DeskFutures\config\desk.env` |
| Suivi projet | Jira, projet `TD2` |

La release VPS `.2` contient le correctif fonctionnel `eeeb530`. Le commit
`2ee9a72` ajoute sa preuve de certification. Les commits postérieurs purement
documentaires ne signifient pas qu'une nouvelle release a été déployée.

## Prérequis du nouveau poste

- Git ;
- Node.js 22 ou supérieur et npm 10 ;
- Python 3.12 pour les contrôles du dépôt ;
- Docker Desktop avec WSL 2 pour la pile locale ;
- PowerShell 7 pour construire ou déployer une release Windows ;
- accès GitHub au dépôt ;
- accès Jira si le poste doit maintenir le backlog.

Le VPS cible reste Windows Server avec PostgreSQL 16, Caddy et services WinSW,
conformément à l'ADR-0024.

## Récupération du code

```bash
git clone https://github.com/Moustaphasow01/tv-automation-desk.git
cd tv-automation-desk
git switch main
node --version
npm --version
```

`node --version` doit retourner au minimum Node 22. Avec `nvm` :

```bash
nvm install
nvm use
```

## Installation reproductible

Les trois racines npm possèdent leur lockfile. Ne copiez aucun `node_modules`
depuis l'ancien poste.

```bash
npm ci --ignore-scripts
npm --prefix apps/desk-control-plane ci --ignore-scripts
npm --prefix mcp_gpt_desk ci --ignore-scripts --install-links
```

## Validation minimale du checkout

```bash
npm run typecheck
npm run build
npm --prefix packages/desk-contracts run check:generated
npm run guard:strategy-contracts
npm run guard:windows-deployment
npm run guard:security-supply-chain
npm run guard:runtime-safety
npm --prefix mcp_gpt_desk test
docker compose config --quiet
```

La CI GitHub exécute la matrice canonique complète sous Node 22, Python 3.12 et
PostgreSQL 16. Une reprise n'est pas validée si le commit distant échoue en CI.

## Démarrage local sans secret productif

```bash
cp .env.preprod.example .env.preprod
```

Renseigner uniquement des secrets locaux différents de la production, puis :

```bash
docker compose --env-file .env.preprod up --build -d
docker compose --env-file .env.preprod run --rm api npm run seed:contracts
```

Points d'accès locaux :

- Front : `http://localhost:8080` ;
- API : `http://localhost:8787/status` ;
- MCP : `http://localhost:8787/mcp`.

## Éléments à transférer séparément et de manière chiffrée

Ces éléments sont nécessaires à l'exploitation distante mais sont interdits
dans Git :

1. clé SSH du VPS ou nouvelle clé provisionnée depuis la console OVH ;
2. secrets Telegram et identifiants de chat ;
3. secret webhook TradingView ;
4. PIN et secrets de session opérateur/OAuth ;
5. mots de passe/rôles PostgreSQL ;
6. configuration productive `desk.env` ;
7. accès GitHub et Jira.

Utiliser un coffre chiffré ou provisionner une nouvelle clé. Ne jamais envoyer
une clé privée dans un ticket, un commit, un message Telegram ou un rapport.
Si l'ancienne clé est perdue, ajouter une nouvelle clé publique via la console
OVH puis révoquer l'ancienne.

## Données et reprise du VPS

Les données du Desk ne dépendent pas du PC de développement. Elles résident sur
le VPS et doivent être protégées par les sauvegardes PostgreSQL et objets. Le
runbook canonique est
[`DESK_RESILIENCE_AND_DR_RUNBOOK.md`](DESK_RESILIENCE_AND_DR_RUNBOOK.md).

Après perte du VPS, utiliser uniquement le mécanisme contrôlé :

```powershell
.\deploy\windows\Invoke-DeskDisasterRecovery.ps1 `
  -DatabaseDump "D:\recovery\desk-native-....dump" `
  -ObjectArchive "D:\recovery\desk-objects-....tar.gz" `
  -TargetDatabaseUrl "<url-owner-base-cible>" `
  -TargetObjectRoot "C:\ProgramData\DeskFutures\objects" `
  -ConfirmRecovery
```

Les dumps, archives d'objets et leurs fichiers SHA-256 doivent être récupérés
depuis le stockage de sauvegarde, jamais depuis Git.

## Reprise d'un déploiement

1. Vérifier que le checkout est propre et que `main` correspond au commit
   distant.
2. Construire avec `deploy/windows/Build-DeskRelease.ps1` sous Node 22+.
3. Conserver AUTO et LIVE broker désactivés.
4. Déployer avec `deploy/windows/Update-Desk.ps1`, qui réalise sauvegarde,
   drain, migrations, canary, bascule et rollback automatique.
5. Vérifier :

```powershell
.\deploy\windows\Test-DeskLocalHealth.ps1
.\deploy\windows\Test-DeskDeployment.ps1 `
  -PublicBaseUrl "https://vps-6d6969db.vps.ovh.net"
```

Ne jamais remplacer ce pipeline par une copie manuelle de fichiers sur le VPS.

## État sûr attendu après reprise

- mode SHADOW / semi-manuel ;
- exécution broker physique OFF ;
- kill switch actif ;
- plafond de risque de 500 USD par position ;
- perte maximale de 2 000 USD par jour et 4 000 USD par semaine ;
- Human Gate obligatoire ;
- Telegram et calendrier grains vérifiés ;
- `/healthz` et `/readyz` au vert.

La reprise technique ne prouve pas la rentabilité d'une stratégie et ne doit
jamais activer implicitement LIVE ou AUTO.

## Contenu local volontairement exclu

`output/`, les logs, captures, bundles de release, bases locales,
`node_modules`, `.local/` et les fichiers `.env*` réels sont des artefacts de
poste ou des données sensibles. Ils ne sont pas nécessaires pour reconstruire
le produit depuis Git. Les preuves durables importantes doivent être résumées
dans `docs/` ou `reports/` avant commit.

## Checklist de passation

```text
[ ] Le nouveau poste peut cloner main.
[ ] Node 22+, npm 10, Python 3.12 et Docker sont installés.
[ ] Les trois npm ci réussissent sans vulnérabilité.
[ ] Typecheck, build et guards critiques passent.
[ ] Les secrets sont récupérés depuis un canal chiffré, jamais depuis Git.
[ ] Une clé SSH propre au nouveau poste permet l'accès VPS.
[ ] Les dernières sauvegardes DB/objets et leurs checksums sont accessibles.
[ ] healthz et readyz répondent après toute intervention.
[ ] AUTO/LIVE broker restent OFF jusqu'à autorisation explicite.
```
