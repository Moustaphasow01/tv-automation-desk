# Simulation Reproducibility Proof

> Ticket : `TD2-303`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

La preuve de reproductibilité vérifie qu’un run candidat rejoué depuis le même couple `Strategy Version + Dataset + paramètres + seed` produit les mêmes artifacts scellés que le run de référence.

Elle couvre deux invariants différents :

- **reproductibilité bit-à-bit** : mêmes hashes de dataset, moteur, métriques et résultat canonique ;
- **anti-lookahead** : les bougies postérieures au cutoff peuvent être présentes dans l’entrée brute, mais elles ne changent pas les métriques consommées par le moteur.

## Implémentation

- Modèle pur : `packages/desk-replay-engine/src/simulation-reproducibility-proof-v1.js`.
- Export package : `packages/desk-replay-engine/index.js`.
- Service applicatif : `mcp_gpt_desk/src/simulation-run-registry-service.js`, méthode `compareRunReproducibility`.
- Tests : `packages/desk-replay-engine/test/simulation-reproducibility-proof.test.js` et `mcp_gpt_desk/test/simulation_run_registry_service.test.js`.

## Contrat de preuve

La preuve retourne :

- `ok` ;
- `reasons` déterministes ;
- `baseline_run_id` et `candidate_run_id` ;
- `reproducibility_key` et son hash ;
- les booléens `metrics_hash_match`, `result_hash_match`, `dataset_hash_match`, `engine_version_match`.

Un run est refusé comme reproductible dès qu’une raison apparaît :

- `BASELINE_RUN_REQUIRED` ;
- `CANDIDATE_RUN_REQUIRED` ;
- `REPRODUCIBILITY_KEY_MISMATCH` ;
- `DATASET_HASH_MISMATCH` ;
- `ENGINE_VERSION_MISMATCH` ;
- `METRICS_HASH_MISMATCH` ;
- `RESULT_HASH_MISMATCH`.

## Anti-lookahead

Le moteur canonique filtre les rows par cutoff avant la boucle chaude. Le test TD2-303 ajoute une bougie future qui toucherait le target, puis vérifie que :

- `metrics_hash` reste identique ;
- `total_r` reste identique ;
- la position reste ouverte au cutoff ;
- aucun event `POSITION_CLOSED` n’est créé ;
- `ignored_post_cutoff_rows` signale la row ignorée.

Ce choix préserve la force analytique du desk sans compacter arbitrairement l’historique : on peut fournir une entrée large, mais le moteur n’a le droit de consommer que le passé disponible au cutoff.

## Limites

- La comparaison avancée Replay Lab est prévue par `TD2-304`.
- Les métriques segmentées et par régime de marché restent dans `TD2-306`.
- Le Robustness Engine utilisera cette preuve comme prérequis dans `TD2-307`.
