# Live/Replay Prompt Seed 2.4.0

TD2-PRM-005 migre les prompts de secours ChatGPT Live/Replay vers le Prompt & Instruction Registry sans changer leur contenu.

## Source de vérité

- Seed Git : `config/prompt-registry/live-replay-2.4.0-seed.v1.json`.
- Prompt LIVE source : `docs/CHATGPT_LIVE_WORKER_PROMPT.md`.
- Prompt REPLAY source : `docs/CHATGPT_REPLAY_WORKER_PROMPT.md`.
- Hydratation PostgreSQL : `scripts/prompt-registry/hydrate_prompt_seed_sql.mjs`.

Le seed utilise `parity_mode = BYTE_EXACT_SOURCE`. Chaque composition contient un seul item `PROMPT` qui pointe vers le fichier source exact. Le guard matérialise le rendu registry en concaténant les items par `ordinal`, puis compare `rendered_sha256` au SHA-256 du fichier legacy.

## Hashes figés

| Lane | Prompt key | Version | SHA-256 |
|---|---|---:|---|
| live | `CHATGPT_LIVE_WORKER_FALLBACK` | 2.4.0 | `sha256:58805173a2a0f7db96cfc4c8ed0ad213b4a2d74045990f9ee151255730fa4ffd` |
| replay | `CHATGPT_REPLAY_WORKER_FALLBACK` | 2.4.0 | `sha256:79b9648bd9b2388e55e759aa60e15b7ecd492907f98856a066cde52cfd1558f2` |

## Rollback

Les bindings seedés sont `ACTIVE` avec `last_known_good_composition_id` égal à la composition publiée. Un futur canary pourra utiliser TD2-PRM-004 pour revenir à cette composition sans modifier le texte prompt.

## Validation

- `npm run guard:prompt-registry`.
- `npm run guard:prompt-registry:test`.
- `node scripts/prompt-registry/hydrate_prompt_seed_sql.mjs --summary`.

## Limite assumée

Ce ticket prouve la parité binaire des prompts monolithiques 2.4.0. Le découpage fin en modules d'instruction réutilisables pourra arriver plus tard, après que les workers lisent réellement `prompt_render_snapshots`.
