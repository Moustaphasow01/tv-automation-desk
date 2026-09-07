# ADR 0034 — Résolution administrative d'un suivi théorique ambigu

## Statut

Accepté le 2026-09-08.

## Contexte

Un suivi théorique MNQ historique est resté ouvert après un événement
`exit_review_required`. Il possède une entrée strictement théorique, mais aucune
commande provider, aucun événement broker, aucune exécution manuelle et aucun
résultat canonique. L'opérateur atteste qu'aucun ordre ni aucune position réelle
correspondante ne reste ouvert.

Modifier le trade, fabriquer une sortie ou lui attribuer un R/PnL transformerait
une absence de preuve en résultat de marché. Le laisser dans l'exposition courante
immobiliserait en revanche un risque qui n'existe pas dans le monde réel.

## Décision

Nous ajoutons une résolution administrative append-only, limitée par manifeste à
l'identité exacte du trade et de son `PortfolioOrderIntent`.

La résolution :

- conserve le trade, ses fills théoriques, ses événements et son résultat
  indéterminé ;
- ne crée ni fill, ni prix de sortie, ni résultat R, ni PnL ;
- retire le trade des seules projections d'exposition courante à partir de
  `effective_at_utc`, et uniquement après que la résolution est connue ;
- expose explicitement `ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE` dans les vues
  d'audit ;
- exige une attestation opérateur structurée, un motif, un acteur, un hash de
  manifeste, le hash du lineage et l'état CAS du trade ;
- refuse l'opération si une preuve provider, broker, manuelle, physique ou un
  outcome existe ;
- interdit toute nouvelle preuve d'exécution pour ce trade ou ce lineage après
  résolution.

## Temporalité

Une requête `asOf` antérieure à `effective_at_utc`, ou antérieure au
`created_at_utc` de la résolution, continue à voir le trade dans l'exposition
historique. Cela empêche la connaissance future de réécrire un replay passé.

## Exploitation

L'outil d'application possède deux modes : `DRY_RUN` et `APPLY`. `APPLY` exige une
phrase de confirmation exacte et est idempotent. La migration, le manifeste,
l'attestation et les preuves pré/post-opération font partie de la release.

## Conséquences

Le risque et le cockpit ne sont plus pollués par une exposition réelle inexistante,
mais l'ambiguïté historique demeure visible et ne contribue jamais aux
performances. La solution n'est pas un mécanisme générique de clôture de trades :
un nouveau cas exige une nouvelle décision et un nouveau manifeste explicitement
autorisé.
