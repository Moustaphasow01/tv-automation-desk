# ADR-0027 — Prompt & Instruction Registry hybride Git/PostgreSQL

- **Statut** : accepté
- **Date** : 2026-08-08

## Contexte

Les prompts et instructions Live, Replay et futurs agents Research sont répartis entre code, contrats et documents. Le système stocke déjà nom, version et hash, mais ne possède pas de registre, composition, binding et rollback communs.

## Décision

Créer un registre composé de Prompt Definition, Prompt Version, Instruction Module, Composition, Agent Binding, Deployment et Evaluation. Les versions publiées sont immuables. Git contient les seeds revus ; PostgreSQL est le registre opérationnel. Chaque work item épingle la composition et ses hashes. Les secrets sont interdits.

## Alternatives écartées

- Prompt uniquement en fichier : affectation/rollback opérationnels difficiles.
- Prompt uniquement en base et éditable : perte de revue Git et risque de mutation silencieuse.
- Un gros texte par agent : duplication des règles et divergence Live/Replay.

## Conséquences

- migration par parité des prompts 2.4.0 existants ;
- canary et last-known-good ;
- UI d'administration après sécurisation des permissions ;
- futurs agents obligatoirement branchés sur le registry.
