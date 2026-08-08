# ADR-0001 — `ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste un verrou singulier, orthogonal aux Strategy Instances

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-7 (`01-NORTH-STAR-AND-SUCCESS-CRITERIA.md` §3)

## Contexte

Une première version de ce travail d'audit recommandait de remplacer `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`) par « un ensemble de versions actives », en confondant ce verrou avec un futur mécanisme de sélection de stratégie métier. Une vérification ciblée par lecture directe intégrale du fichier a montré que cette interprétation était fausse.

## Décision

`ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste un objet **singulier et strict**, figeant la paire de versions (catalogue de conditions, moteur d'évaluation) que le système accepte d'exécuter. Il n'est **jamais** réutilisé, étendu, ou pluralisé pour porter la notion de « quelles stratégies métier sont actives ». Cette dernière notion est portée exclusivement par le nouveau modèle Strategy Definition / Strategy Version / Strategy Instance (`05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §2), qui vit à un niveau logique complètement séparé.

## Alternatives rejetées

- **Remplacer par un ensemble de versions actives** : rejetée — confond compatibilité schéma/moteur (une propriété du déploiement) avec pluralité de stratégies métier (une propriété du portefeuille). Aurait cassé la garantie que tout le système tourne sur une seule version de moteur cohérente à un instant donné.
- **Fusionner avec Strategy Version** : rejetée — un changement de moteur déterministe (rare, à fort impact, nécessite une revalidation complète) n'a pas le même cycle de vie qu'une nouvelle version de stratégie (fréquente, portée limitée à une stratégie).

## Conséquences

- Toute Strategy Version publiée doit déclarer, en lecture seule, la version du Runtime Contract Bundle avec laquelle elle a été validée en simulation — pas la définir elle-même.
- Un changement de `ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste un événement rare et gouverné (changement de moteur), indépendant du rythme de publication des stratégies.

## Preuve AS-IS

`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`, lu intégralement le 2026-08-07 — objet de versions singulier, sans structure de collection ni logique de sélection multi-stratégie. Voir `02-VERIFIED-AS-IS-SUMMARY.md` §7.
