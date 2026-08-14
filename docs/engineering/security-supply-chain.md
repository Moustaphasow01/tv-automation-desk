# Security and supply-chain guard

> Statut : normatif pour la préproduction locale.

Le ticket `TD2-ARCH-011` ajoute un garde local pour empêcher les erreurs les
plus dangereuses avant même la CI distante : secret commité, licence interdite,
lockfile absent, image Docker non traçable ou SBOM absent.

## Commandes

```bash
npm run guard:security-supply-chain
npm run guard:security-supply-chain:test
```

La certification globale rejoue ces deux commandes via :

```bash
npm run certify:resilience
```

## Contrôles bloquants

- scan secrets sans affichage des valeurs ;
- `package-lock.json` requis pour chaque package npm actif ;
- licences copyleft/incompatibles bloquées : `AGPL-*`, `GPL-*`, `LGPL-*`,
  `SSPL-*`, `BUSL-*`, `Commons-Clause` ;
- images Docker `latest` interdites ;
- images Docker sans tag ni digest interdites ;
- SBOM local généré dans `.local/security/`.

## Contrôles rapportés

Les dépendances sans licence explicite et les intégrités absentes dans un
lockfile historique sont listées dans le rapport généré, mais ne bloquent pas
encore la préproduction. Cette dette doit être résorbée module par module lors
des prochains tickets qui touchent les dépendances concernées.

## Audit vulnérabilités réseau

Le guard obligatoire reste offline. Pour un audit réseau ponctuel :

```bash
npm audit --omit=dev --audit-level=high
npm --prefix mcp_gpt_desk audit --omit=dev --audit-level=high
```

Si l'audit réseau retourne une vulnérabilité exploitable, créer un ticket TD2
lié au module propriétaire avant de passer le chantier métier suivant en Done.

## Résultat ponctuel TD2-003 — 2026-08-08

- `mcp_gpt_desk` : vulnérabilités `ip-address` high et `hono` moderate corrigées par overrides ciblés, audit production revenu à 0 vulnérabilité.
- Front racine : vulnérabilités modérées React Router isolées dans Jira `TD2-140` car la correction nécessite une migration majeure vers React Router v7.
