# 14 — Events, APIs and MCP Surface

- **Titre** : Événements, API, et surface d'outils MCP
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `01`, `02` §4, `03` §14, ADR-0012
- **Documents supersédés** : aucun
- **Dernière vérification code** : LISTEN/NOTIFY et outbox confirmés par lecture directe, voir `02` §4
- **Portée** : architecture cible transverse (introduite progressivement à partir de la Phase 5, consolidée pleinement en Phase 9). Arborescence indicative, non engagée.

---

## 1. Rôle dans l'architecture cible

Fournit la structure d'événement uniforme qui rend possible la traçabilité de bout en bout exigée par SC-7 de `01`, et documente la surface d'API/MCP exposée à l'opérateur et aux outils externes.

## 2. Event Envelope — contrat cible

- **CIBLE REQUISE**, champs minimaux (`05` §4.6) : `id`, `type`, `correlation_id`, `causation_id` (nullable pour un événement racine), `payload`, `emitted_at`, `emitted_by`.
- **RECOMMANDATION D'ARCHITECTURE** (ADR-0012) : porté par les mécanismes de transport déjà en production — `pg_notify`/table de tâches durable pour les événements internes au backend, outbox à bail pour les événements liés à l'exécution broker. Aucun nouveau système de transport introduit.
- **CIBLE REQUISE** : tout événement produit par un composant nouveau de ce dossier (Research Lab, Live Strategy Runtime, Arbitrage, Execution Gateway) porte cette enveloppe dès sa création — pas de migration a posteriori des événements existants avant qu'un besoin de traçabilité rétroactive ne le justifie explicitement (voir `21`, si applicable au cutover).

## 3. Reconstruction de chaîne causale (SC-7)

- **CIBLE REQUISE** : à partir d'un `Order Intent` donné, il doit être possible de reconstruire, via les `causation_id` chaînés, la séquence complète : `Signal` d'origine → `Candidate Allocation` → `Risk Decision` → `Target Position` → `Order Intent` → (si applicable) `AI Context Advisory` consultées en cours de route.
- Requête de vérification de ce critère détaillée dans `18-TEST-AND-VALIDATION-STRATEGY.md`.

## 4. Surface API front

- **CONFIRMÉ, réutilisé** : le frontend React/Vite/TS (`src/`) consomme déjà une API front exposée par `mcp_gpt_desk` (`front-api-openapi.js`, `front-api-resources.js`, `front-operations-api.js`, `front-operations-service.js`, `front-session-projection.js` — fichiers confirmés présents dans l'inventaire AS-IS).
- **RECOMMANDATION D'ARCHITECTURE** : les nouveaux domaines (Live Strategy Runtime, Arbitrage, Simulation) exposent leurs propres endpoints de lecture selon le même style d'API déjà établi, plutôt que d'introduire un nouveau style ou protocole (ex. pas de migration vers GraphQL sans décision opérateur distincte, hors scope de ce dossier).

## 5. Surface d'outils MCP

- **CONFIRMÉ** : un inventaire des outils MCP existants a été établi pendant l'audit (`01-CARTOGRAPHIE-ET-FLUX.md` de `docs/audit-2026-08-07/`, section dédiée). Ces outils MCP restent la surface d'intégration pour Codex CLI et pour tout futur agent externe.
- **CIBLE REQUISE** : tout nouvel outil MCP introduit pour exposer un composant de ce dossier (ex. lancer un `Run` de simulation depuis un agent) suit le même schéma de scoping et de sandboxing déjà en place pour les outils MCP existants (`CODEX_SESSION_SCOPE_MISMATCH`, `02` §4).

## 6. Arborescence indicative (non engagée)

```
packages/desk-events/
  src/
    envelope/            # structure Event Envelope, helpers de corrélation
    transport-adapters/
      listen-notify/       # pont vers le mécanisme pg_notify existant, inchangé
      outbox/               # pont vers le pattern outbox existant, inchangé
  test/
    causal-chain.test.js   # preuve de reconstruction de chaîne (SC-7)
```

## 7. Critères de sortie (transverse, vérifié à partir de la Phase 5)

- Un scénario de test de bout en bout (signal → décision → ordre) permet de reconstruire la chaîne causale complète via les `correlation_id`/`causation_id` uniquement, sans accès direct aux tables internes de chaque sous-système.

## 8. Ce que ce chantier ne fait PAS

- Il n'introduit aucun nouveau système de message queue ou de bus d'événement externe (ADR-0012, cohérent avec ADR-0024).
- Il ne modifie pas le format d'API front existant pour les endpoints déjà en production — seuls les nouveaux endpoints suivent la convention de l'Event Envelope pour leur traçabilité interne.
