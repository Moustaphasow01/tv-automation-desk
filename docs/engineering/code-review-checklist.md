# Checklist de revue du Trading Desk

## Intention et placement

- [ ] Intention métier explicite, bounded context et couche corrects.
- [ ] Responsabilité cohérente et abstraction existante recherchée.
- [ ] Aucun nom vague ou deuxième vecteur de changement.
- [ ] Vertical slice complet lorsque le comportement est visible.

## Architecture et données

- [ ] Aucun import internal ou accès table cross-module.
- [ ] Domaine pur ; route/controller sans métier ; frontend sans KPI officiel.
- [ ] Transaction au use case ; outbox atomique ; provider hors transaction.
- [ ] Contraintes/index/migration additive et provenance mises à jour.
- [ ] JSONB justifié ; aucune nouvelle entité relationnelle dans `desk_documents`.

## Trading, IA et exécution

- [ ] Même sémantique Replay/SHADOW/PAPER/LIVE.
- [ ] Cutoff, timezone, anti-lookahead et horloge testés.
- [ ] Idempotence, expected revision, retry et concurrence traités.
- [ ] LLM incapable de produire un OrderIntent direct.
- [ ] Risk Engine garde son veto ; protection broker confirmée ; reconciliation/fallback sûrs.
- [ ] Prompt/model/contracts épinglés et hashés pour toute sortie IA.

## API, erreurs et sécurité

- [ ] Contrat OpenAPI/MCP/event versionné et DTO séparé du domaine.
- [ ] Codes d'erreur stables, Problem Details, aucun secret/stack/SQL exposé.
- [ ] Permissions serveur, rate limits et audit des mutations sensibles.
- [ ] Logs/métriques/traces corrélés sans secret ni payload inutile.

## Frontend

- [ ] Données backend réelles ; fixtures seulement dans tests unitaires.
- [ ] DTO mappé en ViewModel ; aucun calcul de risque/performance officiel.
- [ ] Loading/error/empty/forbidden/conflict/stale traités.
- [ ] Responsive, clavier, focus, contraste et accessibilité vérifiés.
- [ ] Aucun redesign ou changement de parcours silencieux.

## Qualité et exploitation

- [ ] Seuils taille/complexité respectés ou dette legacy réduite.
- [ ] Tests déterministes au bon niveau, cas d'échec compris.
- [ ] Health, timeout, rollback et runbook pour capacité critique.
- [ ] Documentation, ADR, dérogation et ticket Jira synchronisés.
- [ ] Commandes réellement exécutées et résultats communiqués.
