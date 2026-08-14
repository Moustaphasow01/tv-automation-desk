# Jira backlog sync guard

Le ticket `TD2-004` fixe Git comme source de vérité du backlog et Jira comme surface de suivi opérateur.

## Source canonique

```text
docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml
```

Le YAML porte :

- le statut de connexion Jira ;
- le projet cible `TD2` ;
- les epics et tickets attendus ;
- les identifiants stables `TD2-*` ;
- les clés Jira connues lorsque nécessaires pour les tickets opérés.

## Idempotence

L'import Jira est idempotent par préfixe de résumé :

```text
[TD2-004] Connecter Jira et importer le backlog de façon idempotente
```

Avant de créer un ticket, l'agent doit chercher ce préfixe stable. S'il existe, il met à jour ou commente le ticket existant ; il ne crée pas un doublon.

## Guard local

```bash
npm run guard:jira-backlog-sync
```

Le guard vérifie :

- Jira connecté au projet `TD2` ;
- au moins 15 epics et 120 tickets dans le backlog source ;
- absence de doublon d'epic ou d'`external_id` ;
- dépendances vers des IDs connus ;
- statuts valides ;
- `jira_key` conforme au format `TD2-123` ;
- absence de blocage `jira_connector` une fois Jira connecté.

La certification globale rejoue ce guard via :

```bash
npm run certify:resilience
```
