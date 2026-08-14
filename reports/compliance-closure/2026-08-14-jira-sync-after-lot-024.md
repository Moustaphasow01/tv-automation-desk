# Jira Sync After Lot 024

Date: 2026-08-14
Project: `TD2` — Trading Desk Transformation V2
Cloud ID: `05299685-b351-4195-8efc-62d322636fd6`

## Status

**COMPLETE**

Jira was verified and updated after the Lot 024 repository closure.

Important correction: generic Rovo search still returns `INVALID_ARGUMENT`, but direct issue access by ARI/key works. Therefore the previous blocker "TD2-416/TD2-417 not readable" is no longer accurate for direct-key access.

## Tickets verified

### TD2-416

Title: `[FRONT-VNEXT] Expérience d’exécution semi-manuelle pilotée par le backend`
Previous status observed: `En cours`
Updated status: `Revue en cours`
Comment added: yes

Decision: not marked `Terminé` because VPS/UAT, operator PIN/step-up, Telegram, provider lifecycle and durable SSE runtime proof remain external.

### TD2-417

Title: `[BACKEND CONTRACT] Publier le dossier canonique OrderIntent et le Human Execution Gate`
Previous status observed: `À faire`
Updated status: `Revue en cours`
Comment added: yes

Decision: not marked `Terminé` because real VPS/provider/SSE durable proof remains external.

### TD2-139

Title: `[TD2-1105] Auditer et atteindre conformité architecturale complète`
Status observed: `En cours`
Updated status: unchanged
Comment added: yes

Decision: kept open because the final audit is `TECHNICALLY CLOSED — EXTERNAL ACTIONS REMAIN`, not full architectural closure.

### TD2-137

Title: `[TD2-1103] Retirer GPT-first et legacy après observation`
Status observed: `En cours`
Updated status: unchanged
Comment added: yes

Decision: kept open because GPT-first/legacy retirement is only partial until cutover observation, rollback and safe cleanup are proven.

### TD2-165

Title: `[FRONT-VNEXT] Trading Desk Control Plane — nouvelle application frontend from scratch`
Status observed: `En cours`
Updated status: unchanged
Comment added: yes

Decision: kept open because VNext is consumer-ready locally, but VPS UAT/cutover remains partial.

### TD2-150

Title: `[TD2-ARCH-016] Rebaseliner static-quality après les vertical slices Data Foundation`
Status observed: `Terminé`
Updated status: unchanged
Comment added: yes

Decision: status remains valid. Static-quality was revalidated with baseline, but structural debt remains measured rather than eliminated.

### TD2-125

Title: `[TD2-906] Retirer NinjaTrader après certification`
Status observed: `En cours`
Updated status: unchanged
Comment added: yes

Decision: kept open. `NinjaTrader = KEEP_TRANSITION` until an alternative provider is paper-certified with rollback proof and operator decision.

## Jira operations performed

Comments added:

- `TD2-416`
- `TD2-417`
- `TD2-139`
- `TD2-137`
- `TD2-165`
- `TD2-150`
- `TD2-125`

Transitions applied:

- `TD2-416` → `Revue en cours`
- `TD2-417` → `Revue en cours`

No ticket was moved to `Terminé` during this sync, because all candidates with remaining external proof were intentionally kept out of Done.

## Remaining Jira/tooling note

Generic Rovo search still fails with:

```text
INVALID_ARGUMENT
```

But direct access by ARI/key works and should be used for subsequent TD2 updates:

```text
ari:cloud:jira:05299685-b351-4195-8efc-62d322636fd6:issue/TD2-XXX
```
