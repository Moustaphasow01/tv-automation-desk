# Environment baseline — local + VPS

> Statut : procédure P0 pour `TD2-001`.

Ce document fixe la manière de capturer l'état exact de la préprod locale et du
VPS Windows avant de lancer un chantier destructurant. La capture est volontairement
read-only : pas de dump d'environnement, pas de secret, pas de mutation de base,
pas de redémarrage de service.

## Commande locale

```bash
npm run baseline:environment
```

La commande écrit un rapport JSON dans `.local/baseline/` avec :

- OS, CPU, mémoire et host local ;
- versions Node, npm, git, Docker/Compose ;
- branche, révision Git et nombre d'entrées dirty ;
- disponibilité des scripts opérateur critiques ;
- inventaire SQL statique depuis `infra/postgres/init` : migrations, tables,
  index, enums.

## Capture VPS read-only

```bash
DESK_BASELINE_VPS_TARGET="Administrator@145.239.73.250" \
DESK_BASELINE_VPS_KEY="/home/u01i003/.ssh/tv-desk-ovh-2026" \
npm run baseline:environment -- --include-vps
```

Le bloc VPS collecte uniquement :

- Windows build, PowerShell, CPU, RAM, disques ;
- versions Node, npm, git, psql, Docker si disponibles ;
- services pertinents PostgreSQL / nginx / OpenSSH / Desk / WinSW / Ninja ;
- ports en écoute sur `22`, `80`, `443`, `5432`, `8080`, `8787` ;
- si une URL PostgreSQL runtime est disponible sur la machine distante :
  compteurs `desk_documents`, collections, cursors live, work items, locks
  broker et outbox broker.

## Règles

- Ne jamais collecter les variables d'environnement complètes.
- Ne jamais écrire le contenu d'une clé privée ou d'un token dans le rapport.
- Une capture VPS indisponible doit être documentée, pas contournée.
- Avant cutover, joindre le chemin du rapport `.local/baseline/*.json` au ticket Jira.
