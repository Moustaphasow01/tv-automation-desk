# Lot 019 — NinjaTrader retirement

Date: 2026-08-14

## Verdict

Statut final: PARTIEL / BLOQUÉ EXTERNE.

Le repository prouve maintenant qu'un retrait NinjaTrader ne peut pas être autorisé implicitement. En revanche, NinjaTrader ne doit pas être retiré tant qu'un provider alternatif réel n'a pas été certifié en SHADOW/PAPER, avec rollback prouvé et approbation opérateur explicite.

## Décision

- NinjaTrader reste le provider transitoire encapsulé.
- Aucun retrait runtime n'est réalisé dans ce lot.
- Aucun chemin LIVE/AUTO n'est activé.
- Le retrait futur doit passer par `ninjatrader_retirement_plan_v1`.

## Preuves code

- Plan de retrait: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:33`
- Conditions bloquantes obligatoires:
  - provider de remplacement non NinjaTrader: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:38`
  - certification provider ou cutover prêt: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:39`
  - approbation opérateur explicite `APPROVE_NINJATRADER_RETIREMENT`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:40`
  - zéro référence directe NinjaTrader restante: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:41`
  - rollback prouvé: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:42`
- Statuts explicites: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:6`
- Cutover provider avec rollback obligatoire si état unsafe: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/src/execution-provider-shadow-cutover-v1.js:56`
- Documentation engineering: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/execution-provider-shadow-cutover-v1.md:34`
- ADR de maintien transitoire NinjaTrader: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/trading-desk-target-blueprint/adr/0016-execution-gateway-wraps-existing-ninjatrader.md:1`

## Preuves tests

- Test de retrait bloqué sans certification/approval/rollback: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js:51`
- Test ajouté dans ce lot: retrait fail-closed si références directes ou rollback non prouvé: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js:70`
- Suite provider complète:

```text
node --test packages/desk-domain/test/execution-provider-port-v1.test.js packages/desk-domain/test/execution-provider-multi-provider-contract-v1.test.js packages/desk-domain/test/execution-provider-circuit-breaker-v1.test.js packages/desk-domain/test/execution-provider-shadow-cutover-v1.test.js packages/desk-domain/test/ninjatrader-provider-adapter-v1.test.js packages/desk-domain/test/pickmytrade-provider-adapter-v1.test.js
```

Résultat:

```text
28 pass / 0 fail
```

- Guard Jarvis / authority:

```text
npm run guard:jarvis-authority
```

Résultat:

```text
ok=true, matrixRows=123, violations=0
```

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Retirer NinjaTrader uniquement après certification du chemin alternatif | PARTIEL | Certification réelle provider externe absente | Plan de retrait fail-closed | Shadow cutover provider suite | Nécessite provider réel | BLOQUÉ EXTERNE |
| Remplacement provider avec rollback disponible | PARTIEL | Pas de rollback runtime prouvé en environnement provider réel | `evaluateExecutionProviderShadowCutoverV1` + circuit breaker | Provider suite | Nécessite PAPER/SHADOW réel | BLOQUÉ EXTERNE |
| Aucun retrait implicite de NinjaTrader | FAIT | Aucun gap local | `planNinjaTraderRetirementV1` exige certification, approval, zéro refs directes, rollback | 6 tests ciblés | N/A domaine pur | FAIT |
| Provider alternatif ajoutable sans réécrire Portfolio/Risk/Strategy | FAIT | Certification externe reste séparée | Execution provider port + adapters | Provider suite | N/A domaine pur | FAIT |

## Blockers externes

1. Credentials/provider paper réel pour Tradovate, Rithmic ou autre provider choisi.
2. Fenêtre SHADOW/PAPER réelle avec événements provider enregistrés et comparés.
3. Preuve de rollback runtime sur incident provider.
4. Approbation opérateur explicite `APPROVE_NINJATRADER_RETIREMENT`.

## Résultat de lot

- FAIT gagnés: retrait implicite NinjaTrader bloqué ; plan de retrait provider gouverné.
- PARTIEL restant: retrait physique effectif de NinjaTrader.
- NON FAIT: aucun nouveau.
- NON PROUVÉ: aucun nouveau côté repository.
- BLOQUÉ EXTERNE: certification provider alternatif réel + rollback + approbation.

## Prochain lot

LOT 020 — GPT-first / Legacy Runtime Retirement.

Objectif: inventorier les chemins GPT-first/MCP/legacy encore présents, distinguer rollback sécurisé vs bypass dangereux, puis empêcher tout chemin legacy d'émettre ou envoyer un ordre hors chaîne officielle.
