# SQL migration standards

> Statut : normatif pour PostgreSQL local/VPS.

Le ticket `TD2-ARCH-008` rend les migrations vérifiables avant les gros
chantiers Strategy, Prompt Registry, Data Foundation et Agents.

## Commandes

```bash
npm run guard:sql-migrations
npm run guard:sql-migrations:test
```

La certification globale rejoue ces deux commandes via :

```bash
npm run certify:resilience
```

## Règles bloquantes

- Les fichiers `infra/postgres/init/*.sql` doivent être séquentiels :
  `001_...sql`, `002_...sql`, sans trou.
- Toute table créée doit avoir un propriétaire déduit de
  `docs/engineering/sql-migration-policy.json`.
- Toute table créée doit avoir une clé primaire.
- Les opérations destructives sont bloquées sauf allowlist explicite :
  `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`.

## Règles rapportées

Les tables sans index secondaire sont rapportées comme warning. Certaines tables
de référence ou configuration n'ont besoin que de leur clé primaire, mais les
parcours critiques doivent ajouter un index explicite.

## Nouvelle table

Avant d'ajouter une table :

1. choisir le bounded context propriétaire ;
2. ajouter ou réutiliser une règle owner dans `sql-migration-policy.json` ;
3. définir clé primaire, contraintes et index critiques ;
4. éviter JSONB pour les invariants métiers connus ;
5. prouver la migration avec `docker compose config --quiet` et le guard SQL.
