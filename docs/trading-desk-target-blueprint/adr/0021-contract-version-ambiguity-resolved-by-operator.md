# ADR-0021 — Ambiguïté de version des contrats (5.4.0 vs 5.1.0) résolue par vérification opérateur, pas par supposition

- **Statut** : TRANCHÉE (résolue le 2026-08-07 — voir `operator-decisions.yaml`, OP-2)
- **Date** : 2026-08-07 (résolution)
- **Invariant/critère protégé** : méthode de `00-MASTER-INDEX.md` §4 (ne jamais inventer un comportement pour combler une zone inconnue)

## Contexte

Les contrats de `packages/desk-contracts` apparaissent référencés tantôt en version 5.4.0, tantôt en version 5.1.0 selon la source consultée pendant l'audit (`02` §3). Aucune des deux lectures n'a pu être établie comme définitivement correcte sans accès direct et interrogation de l'environnement de production, hors périmètre de cet audit en lecture seule.

## Décision (résolue)

**Version confirmée : 5.4.0.** L'opérateur a tranché directement (2026-08-07). Corroboré par lecture de `mcp_gpt_desk/scripts/verify_v5_frozen_state.mjs:14`, qui déclare `EXPECTED_CONTRACTS.master_contract = ["DeskMasterAnalysisContract_v5_4_0", "5.4.0"]` comme version canonique attendue par le code lui-même. La référence à 5.1.0 trouvée pendant l'audit initial est traitée comme une trace obsolète (probablement antérieure au cutover Deterministic Strategy V5.1 du 2026-08-01), pas comme une version concurrente encore active. Tout ticket référençant la version de contrat peut désormais utiliser `5.4.0` directement.

## Alternatives rejetées

- **Supposer 5.4.0 (la version la plus récente trouvée) par défaut** : rejetée — violerait directement la méthode « ne jamais inventer », un contrat de version erronée pourrait casser la compatibilité avec le moteur réellement déployé.
- **Ignorer l'ambiguïté et avancer sans la lever** : rejetée — la version des contrats conditionne potentiellement le format de données consommé par plusieurs composants cibles (Feature Engine, Strategy DSL) ; une erreur ici se propagerait silencieusement à travers plusieurs phases.

## Conséquences

- `operator-decisions.yaml`, entrée `OP-2`, bloque explicitement tout ticket dont la description mentionne une version de contrat figée tant que la confirmation opérateur n'est pas enregistrée.
- Cette ADR passera à `TRANCHÉE` dès que l'opérateur aura fourni la version confirmée, sans nécessiter de nouvelle exploration de code.

## Preuve AS-IS

Ambiguïté confirmée par consultation de sources multiples pendant l'audit du 2026-08-07 — consignée comme `INCERTAIN` en `02` §3, non résolue faute d'accès à un environnement de production réel dans le cadre de cet audit en lecture seule.
