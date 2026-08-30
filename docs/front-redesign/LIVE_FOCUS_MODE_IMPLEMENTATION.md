# Live Trading — Mode Focus

## Statut

Implémentation verticale complète sur `codex/live-focus-cockpit` : projection backend, commandes auditées, state machine frontend, présentation plein cadre et tests.

## Autorités conservées

- Le frontend ne calcule ni le plan post-Risk, ni les capacités, ni le résultat final.
- `CONFIRM` autorise le dossier Human Gate mais ne signifie ni ordre placé, ni ACK, ni FILL.
- Les déclarations opérateur (`PLACED`, `FILLED`, `CLOSED`, `SKIPPED`, `MODIFIED`, note de stop) sont observationnelles et n'altèrent jamais le suivi théorique.
- Le R en direct est calculé par la projection backend à partir de l'entrée, du stop et de la dernière bougie publiée. Le frontend ne fait que l'afficher.

## États

| Code | État | Source de vérité |
|---|---|---|
| A | VEILLE | absence de dossier actif |
| B | EN ÉVALUATION | signal/contexte/risk présents, aucune action publiée |
| C | PRENABLE | `allowedActions` Human Gate ou déclaration manuelle publiée |
| D | ORDRE DÉCLARÉ | événement manuel `PLACED` |
| E | EN POSITION | événement manuel `FILLED` ou suivi théorique ouvert |
| F | CLÔTURÉ | cible, stop, expiration ou trade fermé publiés |

## Parcours opérateur

1. `F` ou bouton **Focus** depuis Live.
2. Lecture stable : brief, situation, ticket post-Risk.
3. Autorisation/rejet uniquement si le backend publie l'action.
4. Après autorisation, déclaration séparée de l'ordre réellement passé et de son prix.
5. Déclaration séparée du fill, du stop posé et de la clôture.
6. Suivi théorique backend continu, même si l'opérateur refuse ou ne prend pas l'ordre.
7. `Échap` restaure le cockpit, le scope instrument/timeframe et la position de lecture.

Le mode peut aussi s'ouvrir automatiquement lorsqu'une décision devient réellement
actionnable. Cette préférence est locale à l'opérateur, mais la condition d'ouverture
reste une `allowedAction` publiée par le backend : le frontend ne déduit jamais une
capacité à partir d'un statut.

## Perception opérateur

- Le pipeline permanent distingue Signal, Contexte, Risk, OrderIntent et Human Gate.
- Le décompte d'expiration et son niveau d'urgence sont alimentés par les timestamps backend.
- Le pied de page conserve les compteurs de séance, la fraîcheur, les raccourcis et le contrôle sonore.
- Les sons sont configurables globalement et par événement (décision, expiration, fill, stop), avec un mode ne pas déranger.
- `?` ouvre l'aide des raccourcis sans quitter le dossier actif.

## Commandes ajoutées

- `execution.order_intent.manual_placed`
- `execution.order_intent.manual_filled`
- `execution.order_intent.manual_closed`
- `execution.order_intent.manual_skipped`
- `execution.order_intent.manual_modified`
- `execution.order_intent.manual_note` (`STOP_PLACED`)

Toutes sont PAPER-only, idempotentes, auditables, fail-closed et vérifiées à nouveau côté backend contre le Human Gate et le cycle manuel courant.

## Dégradation

- Plan incomplet : déclaration d'ordre masquée, champs connus copiables, avertissement visible.
- Brief indisponible : faits structurés publiés par le backend, sans nombre inventé.
- R non calculable : `NON PUBLIÉ`, jamais `0`.
- Capability absente : aucune action locale de secours.
- Son bloqué par le navigateur : l'interface et les notifications visuelles restent fonctionnelles.

## Validation

- Frontend : 58 fichiers de tests, 279 tests verts.
- Backend ciblé : 51 tests verts, dont commandes manuelles, attribution et mark R backend.
- Build de production et garde d'architecture : verts.
- Rulebook statique : 187 fichiers, 0 erreur P0 ; les avertissements heuristiques existants restent informatifs.
- Axe Focus : 2 viewports, 0 violation serious/critical et 0 défaut de copie opérateur. Deux timeouts `502` du proxy VPS ont été classés comme dépendance runtime externe à l'interface.
- Recette navigateur : 1366 × 768 et 1440 × 900 à 100 %, aucune erreur console, plein cadre sans overflow, entrée/sortie `F` / `Échap` validées.
- Captures : `output/playwright/live-focus/live-focus-1366x768-final-v2.png`, `output/playwright/live-focus/live-focus-help-1366x768.png` et `output/playwright/live-focus/live-focus-1440x900.png`.

## Déploiement VPS

- Release installée : `preprod-v2-live-focus-20260830.1`.
- Commit Front/Back : `2c18a8dbde8ef552cc87bd33f89b5c32b0af7977`.
- Archive : SHA-256 `16e5bf0d9421ea6fd1ee8fbc71a62d3b079eb8ab288ff89ffab8e80ede021836`, 5 103 fichiers vérifiés.
- Sauvegarde PostgreSQL préalable : `desk-native-20260830T161541Z.dump`, SHA-256 `9c0c931e54d3ec97315ec3669624eea7a342dcab882c56ae98298a0bb44b1ef5`.
- Sauvegarde objets préalable : `desk-objects-20260830T162222Z.tar.gz`, SHA-256 `a26256bd33fd9ac76c24cc4d521374a45df149ff9a1d062252af33c5332d1e44`.
- Migration courante conservée : `059_human_gate_undo_window`; aucune nouvelle migration appliquée.
- Drain : aucun travail actif, canary loopback et smoke public réussis, puis contrôles de claim/exécution restaurés.
- Santé publique : `/healthz` et `/readyz` publient la nouvelle release avec `ok=true` et `ready=true`.
- Services : 11/11 en exécution et démarrage automatique.
- Recette publique : Focus chargé à 100 % en 1366 × 768, pipeline backend visible, aucune erreur console.
- Capture publique : `output/playwright/live-focus/vps-live-focus-1366x768.png`.
- Contexte de recette : marché fermé ; `SEMI-MANUAL`, `AUTO OFF`, aucune commande broker ni confirmation Human Gate envoyée.
