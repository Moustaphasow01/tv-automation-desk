# Prompt Renderer V1

> Ticket : `TD2-PRM-003`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Prompt Renderer V1` transforme une composition versionnée en snapshot exact envoyé au modèle.

Il est volontairement pur :

- aucune dépendance provider ;
- aucune lecture base ;
- aucun accès secret ;
- aucun comportement dynamique `latest`.

## Implémentation

- Module : `packages/desk-domain/src/prompt-renderer-v1.js`.
- Export public : `packages/desk-domain/index.js` et `index.d.ts`.
- Tests : `packages/desk-domain/test/prompt-renderer-v1.test.js`.

## Contrat

Le rendu produit :

- `schema_version = prompt_render_snapshot_v1` ;
- `renderer_version = 1.0.0` ;
- `rendered_prompt` ;
- `rendered_sha256` ;
- `variables_sha256` ;
- `variables_redacted` ;
- `composition_hash`.

## Invariants

- Les items sont triés par `ordinal`.
- Les fins de ligne sont normalisées en `LF`.
- Les espaces de fin de ligne sont supprimés.
- Les variables `{{name}}` et `{{nested.path}}` sont résolues avant exécution.
- Une variable requise manquante bloque le rendu.
- Un type de variable incompatible bloque le rendu.
- Les champs sensibles (`secret`, `token`, `password`, `api_key`, `pin`) sont redacted dans le snapshot.
- Un item avec `content_sha256` divergent est rejeté avant rendu.

## Suite

Les tickets suivants branchent ce renderer sur les bindings, les seeds Live/Replay, les évaluations et le guard anti-contournement.
