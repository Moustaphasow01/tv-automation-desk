# Front V2 — Exécution semi-manuelle

## Rulebook sélectionné pour ce vertical slice

Sélection exécutée avec `select-ui-ux-rules` sur les priorités P0/P1. Les règles bloquantes appliquées sont : `UXR-0501`, `UXR-0502`, `UXR-0520`, `UXR-0491`, `UXR-0604`, `UXR-0621` à `UXR-0624`, `UXR-0664`, `UXR-0762`, `UXR-0924`, `UXR-0925`, `UXR-0927`, `UXR-0963`, `UXR-0981` à `UXR-0985`, `UXR-0989`, `UXR-0992`, `UXR-0995`, `UXR-0999` et `UXR-1000`. Elles imposent notamment le fail-closed, le preview d'impact, l'idempotence, la preuve terminale et l'absence de capability inventée.

## Objet

Le Front explique et orchestre l'expérience opérateur. Le backend reste l'unique autorité pour le Risk, le sizing, `TargetPosition`, `OrderIntent`, les actions permises, l'exécution provider et la réconciliation.

## Parcours canonique

```text
Signal → Context Gate → Arbitrage portefeuille → Global Risk
       → TargetPosition → OrderIntent → Human Gate
       → Provider command → Broker events → Réconciliation → Audit
```

Le dossier d'exécution présente ce parcours par niveaux : décision et termes en premier, preuves et lineage ensuite, identifiants techniques dans l'inspecteur. L'environnement et le mode d'exécution sont deux informations distinctes.

## Invariants Front

- `instrument`, `side`, `account`, `quantity`, `entry`, `stop` et `targets` sont rendus en lecture seule après Risk ;
- aucune permission n'est déduite d'un statut, d'un rôle ou d'une valeur locale ;
- `CONFIRM` et `REJECT` n'existent que si `resource.allowedActions` les publie ;
- `CONFIRMED`, `ACK`, `PARTIAL_FILL` et `FILL` restent des états distincts ;
- un code backend inconnu devient `UNKNOWN`, sans masquer sa valeur brute ;
- une donnée indisponible, partielle, stale ou déconnectée garde cet état à l'écran ;
- `AUTO` et `LIVE` ne sont jamais des préférences locales ;
- aucune API provider ou broker n'est appelée par le navigateur.

## État de la première tranche

Le dossier est construit sur la projection réelle `order-detail` déjà disponible. Les sections non encore publiées par le BFF sont visibles comme indisponibles. Le Human Gate reste non actionnable jusqu'à livraison des capacités et commandes backend décrites dans `FRONTEND_V2_BACKEND_CONTRACT_NEEDS.md`.
