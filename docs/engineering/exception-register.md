# Registre des dérogations aux standards du Trading Desk

| ID | Règle | Périmètre | Justification | Risque | Mesure compensatoire | Propriétaire | Expiration | ADR/Ticket |
|---|---|---|---|---|---|---|---|---|
| EXC-TD-001 | Fichier production ≤ 600 lignes | Fichiers backend listés dans `legacy-baseline-2026-08-08.md` | Dette historique antérieure au standard | God files, couplage et régressions | Zéro aggravation, tests de parité, extraction verticale | Platform | 2027-03-31 | TD2-ARCH-006 |
| EXC-TD-002 | Fichier front ≤ 600 lignes | `src/operationsTypes.ts`, `src/styles/v2.css` | Dette de la refonte Front V2 | Couplage et difficulté de maintenance | Aucun ajout transversal, découpage par feature/tokens | Front | 2026-12-31 | TD2-ARCH-010 |
| EXC-TD-003 | Noms de responsabilités précis | Services legacy listés dans la baseline | API interne historique largement consommée | Noms vagues et responsabilités mélangées | Pas de nouveau service vague, renommer pendant extraction | Platform | 2027-03-31 | TD2-ARCH-006 |

## Règles

- toute dérogation de blocage exige une approbation explicite ;
- expiration ou condition de suppression obligatoire ;
- aucune dérogation ne devient un précédent ;
- une règle CI n'est jamais désactivée globalement pour une exception locale ;
- toute nouvelle violation nécessite une ligne distincte et un ticket de suppression.
