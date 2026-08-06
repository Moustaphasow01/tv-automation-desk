# Replay Lab — chantier 3a (carte "Pouls du Replay") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une carte narrative ("Pouls du Replay") en tête de `/replay`, entre le titre de page et la barre de métriques existante, sans toucher au reste de la page.

**Architecture:** Trois fonctions pures ajoutées à `src/lib/presentation.ts` (même convention que `replayLabel`/`sessionLabel` déjà présents) calculent l'état à afficher à partir des données déjà chargées par `useReplays`. Un nouveau composant local `ReplayPulseCard`, défini directement dans `src/pages/ReplayLabPage.tsx` (même convention que `ReplayEvolution`/`ReplayDayRow` déjà locaux à ce fichier), consomme ces fonctions et s'insère dans le JSX existant. Aucun nouvel appel réseau, aucune nouvelle route, aucune nouvelle classe CSS avec règles dédiées — uniquement des classes déjà utilisées ailleurs dans l'app (`eyebrow`, `primary-btn`).

**Tech Stack:** React 18, TypeScript, TanStack Query (déjà en place via `useReplays`), Vitest.

Référence : `docs/superpowers/specs/2026-08-06-replay-lab-3a-design.md`.

---

### Task 1: Fonctions pures de calcul du pouls

**Files:**
- Modify: `src/lib/presentation.ts`

- [ ] **Step 1: Ajouter l'import de types en tête du fichier**

`src/lib/presentation.ts` n'a aujourd'hui aucun import (toutes ses fonctions
prennent des primitives). Ajouter en toute première ligne du fichier :

```typescript
import type { ReplayDaySummary, ReplayList } from "@/operationsTypes";
```

- [ ] **Step 2: Ajouter les trois fonctions en fin de fichier**

Ajouter à la fin de `src/lib/presentation.ts` (après `deskStatusText`) :

```typescript

export function replayPulseHeadline(summary: ReplayList["summary"]) {
  if (summary.failed > 0 || summary.blocked > 0) {
    return [
      summary.failed > 0 ? `${summary.failed} échec${summary.failed > 1 ? "s" : ""}` : null,
      summary.blocked > 0 ? `${summary.blocked} bloqué${summary.blocked > 1 ? "s" : ""}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (summary.active > 0) {
    return `${summary.active} replay${summary.active > 1 ? "s" : ""} actif${summary.active > 1 ? "s" : ""} · aucun blocage`;
  }
  return "Aucun replay en cours";
}

export function findCertifiedReplayDay(days: ReplayDaySummary[]) {
  return [...days]
    .sort((left, right) => right.date.localeCompare(left.date))
    .find(day => Number(day.resultEligibleSessions || 0) > 0) || null;
}

export function findActiveReplayDay(days: ReplayDaySummary[]) {
  return [...days]
    .sort((left, right) => right.date.localeCompare(left.date))
    .find(day => !["completed", "cancelled"].includes(day.status)) || null;
}
```

Ces trois fonctions sont pures (aucun effet de bord, aucun accès réseau) et
suivent exactement la même convention que `replayLabel`/`sessionLabel` déjà
présentes dans ce fichier : logique de présentation centralisée, testable
en isolation si besoin, réutilisable par n'importe quelle page.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/presentation.ts
git commit -m "feat: add pure Replay pulse computation helpers to presentation.ts"
```

---

### Task 2: Composant `ReplayPulseCard` et intégration dans `ReplayLabPage.tsx`

**Files:**
- Modify: `src/pages/ReplayLabPage.tsx`

- [ ] **Step 1: Étendre l'import depuis `@/lib/presentation`**

Remplacer la ligne d'import existante :

```typescript
import { replayLabel } from "@/lib/presentation";
```

par :

```typescript
import { findActiveReplayDay, findCertifiedReplayDay, replayLabel, replayPulseHeadline } from "@/lib/presentation";
```

- [ ] **Step 2: Insérer la carte dans le JSX, avant le `MetricStrip`**

Dans le JSX de `ReplayLabPage` (le composant par défaut exporté), repérer le
bloc actuel :

```typescript
    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={summary.executions} detail={`${summary.days} journées · ${scopeLabel(filters.versionScope)}`}/>
```

Le remplacer par (ajout d'une ligne juste avant, contenu du `MetricStrip`
inchangé) :

```typescript
    <ReplayPulseCard summary={summary} days={days}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={summary.executions} detail={`${summary.days} journées · ${scopeLabel(filters.versionScope)}`}/>
```

- [ ] **Step 3: Ajouter le composant `ReplayPulseCard`**

Ajouter cette fonction dans `src/pages/ReplayLabPage.tsx`, juste avant la
fonction `ReplayEvolution` déjà présente dans le fichier :

```typescript
function ReplayPulseCard({ summary, days }: { summary: ReplayList["summary"]; days: ReplayDaySummary[] }) {
  const headline = replayPulseHeadline(summary);
  const certifiedDay = findCertifiedReplayDay(days);
  const activeDay = findActiveReplayDay(days);
  const context = certifiedDay
    ? `Dernier résultat certifié : ${certifiedDay.totalR.toFixed(2)} R · ${certifiedDay.date}`
    : "Aucun résultat certifié pour l’instant";

  const actionTarget = activeDay || certifiedDay;
  const actionParent = actionTarget ? (actionTarget.primaryRunId || actionTarget.sessions[0]?.sourceId || "") : "";
  const actionHref = !actionTarget ? null
    : activeDay
      ? `/replay/runs/${encodeURIComponent(actionParent)}`
      : `/replay/runs/${encodeURIComponent(actionParent)}/days/${actionTarget.date}`;
  const actionLabel = activeDay ? "Voir le replay en cours →" : "Voir le dernier résultat →";

  return <Card className="replay-pulse-card">
    <p className="eyebrow">Pouls du Replay</p>
    <h2>{headline}</h2>
    <p>{context}</p>
    {actionHref && <Link className="primary-btn" to={actionHref}>{actionLabel}</Link>}
  </Card>;
}
```

Cette fonction n'a besoin d'aucun nouvel import : `Card` et `Link` sont déjà
importés en tête de `ReplayLabPage.tsx` ; `ReplayList` doit être ajouté au
bloc `import type` existant.

- [ ] **Step 4: Ajouter le type `ReplayList` à l'import existant**

Remplacer :

```typescript
import type { ReplayDaySummary, WorkflowSummary } from "@/operationsTypes";
```

par :

```typescript
import type { ReplayDaySummary, ReplayList, WorkflowSummary } from "@/operationsTypes";
```

- [ ] **Step 5: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS (aucun test existant ne couvre `ReplayLabPage.tsx` aujourd'hui — ce changement ne doit rien casser dans la suite actuelle).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReplayLabPage.tsx
git commit -m "feat: add Pouls du Replay narrative card to Replay Lab landing page"
```

---

### Task 3: Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1: Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Vérification visuelle manuelle**

Démarrer un serveur de dev ou utiliser le mock e2e existant pour visualiser
`/replay` avec des données réelles (actives, bloquées, et vides) et
confirmer :
- La carte "Pouls du Replay" s'affiche entre le titre de page et la barre
  de métriques, sans décaler ni casser le reste de la mise en page.
- Le message principal change correctement selon l'état : blocage/échec en
  premier si présent, sinon replays actifs, sinon "Aucun replay en cours".
- Le contexte affiche bien le dernier résultat certifié quand il existe, ou
  le message de repli sinon.
- Le bouton d'action pointe vers `/replay/runs/:runId` quand un replay est
  actif, ou vers `/replay/runs/:runId/days/:date` quand seul un résultat
  certifié historique existe, et disparaît si aucune des deux données
  n'existe.
- Aucun débordement horizontal à 320 px.
- Le `MetricStrip`, la barre de filtres et les deux tableaux existants sont
  strictement inchangés.

- [ ] **Step 3: Commit final si des ajustements manuels ont eu lieu**

Si la vérification n'a rien changé, aucune action. Sinon, committer
séparément avec un message précis.

---

## Notes de suivi (hors plan)

Ce chantier ouvre la voie à 3b (fusion Run/Journée, détail journée en
hero+onglets) et 3c (dé-jargonnage de la comparaison et du détail process
GPT), tous deux hors périmètre ici.
