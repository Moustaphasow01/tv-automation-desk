# Replay Lab — chantier 3c (dé-jargonnage comparaison + détail GPT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le jargon d'ingénierie et les identifiants bruts par des libellés compréhensibles pour un opérateur de desk dans `ReplayComparePage.tsx` (`/replay/compare`) et `GptProcessPage.tsx` (détail d'un process GPT), sans toucher au routage, au calcul backend, ni au style visuel.

**Architecture:** Deux volets indépendants dans le même chantier. (1) Centraliser dans `src/lib/presentation.ts` le libellé d'identité de run "Session Asie · 15m · #1" (aujourd'hui dupliqué localement dans `ReplayDayPage.tsx`, et absent de `ReplayComparePage.tsx` qui affiche un ID brut à la place), puis l'utiliser dans les deux pages consommatrices. (2) Retirer de `GptProcessPage.tsx` les panneaux qui n'affichent que du JSON brut ou des identifiants internes sans valeur opérateur, et reformuler les libellés jargonneux des panneaux qui restent.

**Tech Stack:** React 18, TypeScript, Vitest (tests unitaires sur `presentation.ts`).

Référence : `docs/superpowers/specs/2026-08-06-replay-lab-3c-design.md`.

---

### Task 1 : Centraliser `sessionTitle` dans `presentation.ts`

**Files:**
- Modify: `src/lib/presentation.ts`
- Modify: `src/pages/ReplayDayPage.tsx`
- Modify: `src/test/navigationPresentation.test.ts`

`sessionLabel` existe déjà dans `presentation.ts` (traduit `asia_open`/`ny_open`/`full_day`/etc.), mais `ReplayDayPage.tsx` définit sa propre copie locale identique au lieu de l'importer, et une fonction `sessionTitle` (session + variante + tentative, ex. `"Session Asie · 15m · #1"`) n'existe qu'en local dans `ReplayDayPage.tsx`. Cette tâche déplace `sessionTitle` dans `presentation.ts` et fait pointer `ReplayDayPage.tsx` sur les deux fonctions partagées, en supprimant ses deux copies locales.

- [ ] **Step 1 : Ajouter `sessionTitle` à `presentation.ts`**

Dans `src/lib/presentation.ts`, remplacer la ligne d'import en tête de fichier :

```typescript
import type { ReplayDaySummary, ReplayList } from "@/operationsTypes";
```

par :

```typescript
import type { ReplayDaySummary, ReplayList, WorkflowSummary } from "@/operationsTypes";
```

Puis ajouter, juste après la fonction `sessionLabel` existante (donc avant le bloc `DATA_QUALITY_LABELS`) :

```typescript

export function sessionTitle(session: WorkflowSummary) {
  return `${sessionLabel(session.session || "globale")} · ${session.variantId || "default"} · #${session.attempt || 1}`;
}
```

- [ ] **Step 2 : Faire pointer `ReplayDayPage.tsx` sur les fonctions partagées**

Remplacer la ligne d'import :

```typescript
import { shortReference } from "@/lib/presentation";
```

par :

```typescript
import { sessionLabel, sessionTitle, shortReference } from "@/lib/presentation";
```

Puis supprimer les deux fonctions locales devenues redondantes, en bas du fichier. Remplacer :

```typescript
function sessionKey(session: WorkflowSummary) {
  return session.sessionExecutionId || session.sourceId || session.id;
}

function sessionTitle(session: WorkflowSummary) {
  return `${sessionLabel(session.session || "globale")} · ${session.variantId || "default"} · #${session.attempt || 1}`;
}

function formatSessionResult(session: WorkflowSummary) {
  const value = session.metrics.totalR;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "En calcul" : `${Number(value).toFixed(2)} R`;
}

function sessionLabel(value: string) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value.replaceAll("_", " ");
}
```

par :

```typescript
function sessionKey(session: WorkflowSummary) {
  return session.sessionExecutionId || session.sourceId || session.id;
}

function formatSessionResult(session: WorkflowSummary) {
  const value = session.metrics.totalR;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "En calcul" : `${Number(value).toFixed(2)} R`;
}
```

Le comportement est inchangé : `presentation.ts::sessionLabel` gère en plus `"Asia Open"`/`"NY Open"`/`"full_day"`, mais pour les valeurs déjà utilisées ici (`asia_open`, `ny_open`, ou la chaîne `"globale"` en repli) le résultat est identique à l'ancienne copie locale.

- [ ] **Step 3 : Ajouter les tests unitaires**

Dans `src/test/navigationPresentation.test.ts`, remplacer la ligne d'import des fonctions :

```typescript
import {
  deskStatusText,
  dataQualityLabel,
  findActiveReplayDay,
  findCertifiedReplayDay,
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  replayPulseHeadline,
  sessionLabel,
  shortReference,
  workflowLabel,
} from "@/lib/presentation";
import type { ReplayDaySummary, ReplayList } from "@/operationsTypes";
```

par :

```typescript
import {
  deskStatusText,
  dataQualityLabel,
  findActiveReplayDay,
  findCertifiedReplayDay,
  gptProcessLabel,
  incidentLabel,
  replayLabel,
  replayPulseHeadline,
  sessionLabel,
  sessionTitle,
  shortReference,
  workflowLabel,
} from "@/lib/presentation";
import type { ReplayDaySummary, ReplayList, WorkflowSummary } from "@/operationsTypes";
```

Puis, dans le describe `"traduction des sessions, de la qualité et des statuts"`, ajouter deux tests juste après celui de `sessionLabel` (avant celui de `dataQualityLabel`) :

```typescript
  it("compose le libellé d'identité d'une session à partir de session, variante et tentative", () => {
    expect(sessionTitle(buildWorkflowSummary({ session: "asia_open", variantId: "15m", attempt: 1 }))).toBe("Session Asie · 15m · #1");
    expect(sessionTitle(buildWorkflowSummary({ session: "ny_open", variantId: "30m", attempt: 3 }))).toBe("Session New York · 30m · #3");
  });

  it("retombe sur des valeurs par défaut quand session, variante ou tentative sont absentes", () => {
    expect(sessionTitle(buildWorkflowSummary({ session: null, variantId: null, attempt: undefined }))).toBe("globale · default · #1");
  });
```

Enfin, ajouter la fonction utilitaire `buildWorkflowSummary` en bas du fichier, au même niveau que `buildReplaySummary`/`buildReplayDay` déjà présentes :

```typescript

function buildWorkflowSummary(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: "session-1",
    sourceId: "session-1",
    kind: "replay",
    name: "session-1",
    status: "completed",
    rawStatus: "COMPLETED",
    revision: 1,
    tradingDate: "2026-08-01",
    session: "asia_open",
    strategyId: "asia_open",
    variantId: "15m",
    progress: 100,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
    durationMs: null,
    error: null,
    metrics: {},
    currentStepId: null,
    currentWorkItemId: null,
    nextAction: null,
    automationEnabled: true,
    ...overrides,
  };
}
```

- [ ] **Step 4 : Lancer les tests**

Run: `npm run test:react`
Expected: PASS (tous les tests existants + les 2 nouveaux).

- [ ] **Step 5 : Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src/lib/presentation.ts src/pages/ReplayDayPage.tsx src/test/navigationPresentation.test.ts
git commit -m "refactor: centralize sessionTitle in presentation.ts, drop duplicate in ReplayDayPage"
```

---

### Task 2 : Identité lisible des runs dans `ReplayComparePage.tsx`

**Files:**
- Modify: `src/pages/ReplayComparePage.tsx`

Remplace l'ID technique tronqué (`compactId(row.id, N)`) comme texte principal par le libellé lisible `sessionTitle(row.run)` dans les 4 endroits où un run est identifié comme élément principal d'affichage (scoreboard, tableau, panneau GPT, panneau timeline). L'ID technique reste visible en secondaire (attribut `title`, déjà présent partout, conservé tel quel) ou en petit texte. Les pointeurs de type "référence" (ex. `réf. {compactId(...)}"` dans les MetricCard/en-têtes, qui désignent le run baseline plutôt que d'identifier une ligne) restent inchangés — ce ne sont pas des identités principales.

- [ ] **Step 1 : Importer les fonctions partagées, supprimer la copie locale de `sessionLabel`**

Remplacer la ligne d'import :

```typescript
import { operationsKeys, useReplays } from "@/hooks/useOperations";
import type { ReplayComparison, ReplayComparisonItem, WorkflowSummary } from "@/operationsTypes";
```

par :

```typescript
import { operationsKeys, useReplays } from "@/hooks/useOperations";
import { sessionLabel, sessionTitle } from "@/lib/presentation";
import type { ReplayComparison, ReplayComparisonItem, WorkflowSummary } from "@/operationsTypes";
```

Puis supprimer la fonction locale devenue redondante, en bas du fichier :

```typescript
function sessionLabel(value: string) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value.replaceAll("_", " ");
}
```

(Les autres usages de `sessionLabel` dans ce fichier — `ReplaySelectionDock`, le picker de sélection — continuent de fonctionner à l'identique, ils appellent la même fonction, désormais importée au lieu d'être locale.)

- [ ] **Step 2 : Scoreboard — remplacer l'identité de run dans `ReplayComparisonWorkbench`**

Remplacer :

```typescript
        {rows.map(row => <article key={row.id} className={row.baseline ? "is-baseline" : ""} data-status={row.run.status}>
          <header><span>#{row.rank || "—"}</span><div><strong title={row.id}>{compactId(row.id, 34)}</strong><small>{row.run.tradingDate || "—"} · {sessionLabel(row.run.session || row.run.kind)}</small></div><StatusTag status={row.run.status}/></header>
```

par :

```typescript
        {rows.map(row => <article key={row.id} className={row.baseline ? "is-baseline" : ""} data-status={row.run.status}>
          <header><span>#{row.rank || "—"}</span><div><strong title={row.id}>{sessionTitle(row.run)}</strong><small>{row.run.tradingDate || "—"} · {compactId(row.id, 34)}</small></div><StatusTag status={row.run.status}/></header>
```

- [ ] **Step 3 : Tableau — remplacer l'identité de run dans `ReplayCompareRow`**

Remplacer :

```typescript
    <td data-label="Run"><div className="replay-compare-run-cell"><strong title={row.id}>{compactId(row.id, 46)}</strong><small>{row.run.tradingDate || "—"} · {row.run.variantId || "default"}</small><div className="replay-compare-inline-actions"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(row.id)}`}>Run <Icon name="arrow" size={13}/></Link></div></div></td>
```

par :

```typescript
    <td data-label="Run"><div className="replay-compare-run-cell"><strong title={row.id}>{sessionTitle(row.run)}</strong><small>{row.run.tradingDate || "—"} · {compactId(row.id, 46)}</small><div className="replay-compare-inline-actions"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(row.id)}`}>Run <Icon name="arrow" size={13}/></Link></div></div></td>
```

- [ ] **Step 4 : Panneau GPT — remplacer l'identité de run dans `ReplayCompareGptPanel`**

Remplacer :

```typescript
    <div>{rows.map(row => <section key={row.id}>
      <header><strong title={row.id}>{compactId(row.id, 48)}</strong><small>{row.conclusion?.conclusion || "Aucune conclusion persistée"}</small></header>
```

par :

```typescript
    <div>{rows.map(row => <section key={row.id}>
      <header><strong title={row.id}>{sessionTitle(row.run)}</strong><small>{row.conclusion?.conclusion || "Aucune conclusion persistée"}</small></header>
```

- [ ] **Step 5 : Panneau timeline — remplacer l'identité de run dans `ReplayCompareTimelinePanel`**

Remplacer :

```typescript
    <ol>{rows.flatMap(row => row.timelineSample.map(event => ({ row, event }))).sort((left, right) => String(right.event.at || "").localeCompare(String(left.event.at || ""))).map(({ row, event }) => <li key={`${row.id}:${event.id}`} data-layer={event.layer || "event"}>
      <time>{formatTime(event.at)}</time><i aria-hidden="true"/><div><strong title={row.id}>{compactId(row.id, 34)} · {event.title || event.type}</strong><p>{event.conclusion || event.decision || event.detail || event.status}</p></div>
    </li>)}</ol>
```

par :

```typescript
    <ol>{rows.flatMap(row => row.timelineSample.map(event => ({ row, event }))).sort((left, right) => String(right.event.at || "").localeCompare(String(left.event.at || ""))).map(({ row, event }) => <li key={`${row.id}:${event.id}`} data-layer={event.layer || "event"}>
      <time>{formatTime(event.at)}</time><i aria-hidden="true"/><div><strong title={row.id}>{sessionTitle(row.run)} · {event.title || event.type}</strong><p>{event.conclusion || event.decision || event.detail || event.status}</p></div>
    </li>)}</ol>
```

- [ ] **Step 6 : Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add src/pages/ReplayComparePage.tsx
git commit -m "feat: show readable run identity instead of raw IDs in Replay comparison"
```

---

### Task 3 : Reformulation des libellés dans `ReplayComparePage.tsx`

**Files:**
- Modify: `src/pages/ReplayComparePage.tsx`

- [ ] **Step 1 : En-tête de page**

Remplacer :

```typescript
    <PageHeading eyebrow="Station de comparaison" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, calculées par le backend canonique." backTo="/replay" tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>
```

par :

```typescript
    <PageHeading eyebrow="Comparaison de runs" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, calculées par le backend canonique." backTo="/replay" tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>
```

- [ ] **Step 2 : En-tête de colonne "Δ référence"**

Remplacer :

```typescript
        <thead><tr><th>Run</th><th>Rang</th><th>État</th><th>Progression</th><th>Résultat</th><th>Δ référence</th><th>Étapes</th><th>GPT</th><th>Télémétrie</th><th>Timeline</th><th>Conclusion</th></tr></thead>
```

par :

```typescript
        <thead><tr><th>Run</th><th>Rang</th><th>État</th><th>Progression</th><th>Résultat</th><th>Écart vs référence</th><th>Étapes</th><th>GPT</th><th>Télémétrie</th><th>Timeline</th><th>Conclusion</th></tr></thead>
```

Puis, dans `ReplayCompareRow`, mettre à jour le `data-label` de la cellule correspondante pour rester cohérent avec le nouvel en-tête (utilisé par le mode tableau responsive sur petit écran). Remplacer :

```typescript
    <td data-label="Delta" className={row.metrics.deltaR >= 0 ? "positive" : "negative"}>{row.baseline ? "RÉF." : `${row.metrics.deltaR >= 0 ? "+" : ""}${row.metrics.deltaR.toFixed(2)} R`}</td>
```

par :

```typescript
    <td data-label="Écart vs référence" className={row.metrics.deltaR >= 0 ? "positive" : "negative"}>{row.baseline ? "RÉF." : `${row.metrics.deltaR >= 0 ? "+" : ""}${row.metrics.deltaR.toFixed(2)} R`}</td>
```

- [ ] **Step 3 : En-têtes de la section matrice**

Remplacer :

```typescript
      <header><div><p className="eyebrow">Comparaison canonique</p><h2>Matrice comparative</h2></div><span>Référence · première ligne sélectionnée</span></header>
```

par :

```typescript
      <header><div><p className="eyebrow">Détail comparatif</p><h2>Tableau comparatif</h2></div><span>Référence · première ligne sélectionnée</span></header>
```

- [ ] **Step 4 : Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/pages/ReplayComparePage.tsx
git commit -m "refactor: reword jargon section labels in Replay comparison page"
```

---

### Task 4 : Retirer les panneaux JSON bruts et détails techniques de `GptProcessPage.tsx`

**Files:**
- Modify: `src/pages/GptProcessPage.tsx`

Supprime tout ce qui n'affiche que du JSON brut ou des identifiants internes sans valeur pour un opérateur : le bloc `gpt-payload-grid` (3 panneaux `<details>`), le bloc `TechnicalDetails` listant 10 identifiants internes, le composant `GptContractPanel` ("Transmission technique GPT") et son appel, et le `TechnicalDetails` interne au panneau "Workflow parent". `LeaseBadge` (uniquement utilisé par `GptContractPanel`) devient du code mort et est supprimé avec lui.

- [ ] **Step 1 : Retirer l'appel à `GptContractPanel`**

Remplacer :

```typescript
    <GptLifecycle process={data.process}/>
    <ResearchProgressPanel progress={data.process.researchProgress || data.researchProgress}/>
    <GptContractPanel transport={data.transport}/>
    <GptOperationsCommandPanel context={data.operationsContext} process={data.process}/>
```

par :

```typescript
    <GptLifecycle process={data.process}/>
    <ResearchProgressPanel progress={data.process.researchProgress || data.researchProgress}/>
    <GptOperationsCommandPanel context={data.operationsContext} process={data.process}/>
```

- [ ] **Step 2 : Retirer le bloc `TechnicalDetails` bare et `gpt-payload-grid`**

Remplacer :

```typescript
    <TechnicalDetails items={[
      { label: "Processus", value: data.process.id },
      { label: "Étape", value: data.process.stepId },
      { label: "Run", value: data.process.runId || parent },
      { label: "Worker", value: data.process.worker },
      { label: "Révision", value: data.process.revision },
      { label: "État source", value: data.process.rawStatus },
      { label: "Outil de sauvegarde", value: data.transport.saveTool },
      { label: "Jeton de lease", value: data.transport.leaseProtected ? "Protégé côté serveur" : "Absent" },
      { label: "Bundle", value: data.process.bundle?.bundleId },
      { label: "Request ID", value: data.process.telemetry.requestId },
    ]}/>

    <div className="gpt-payload-grid">
      <details className="raw-inspector"><summary>Manifest du bundle</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Save target</summary><pre>{JSON.stringify(data.saveTarget, null, 2)}</pre></details>
      <details className="raw-inspector"><summary>Prompt d’exécution</summary><pre>{data.prompt || "Non exposé"}</pre></details>
    </div>

    <section className="replay-terminal-section">
```

par :

```typescript
    <section className="replay-terminal-section">
```

- [ ] **Step 3 : Retirer le `TechnicalDetails` du panneau "Workflow parent"**

Dans `GptOperationsCommandPanel`, remplacer :

```typescript
      <section className="gpt-parent-workflow-panel">
        <p className="eyebrow">Workflow parent</p>
        <h3>{workflow?.name || "Workflow non retrouvé"}</h3>
        <dl>
          <span><dt>État</dt><dd>{workflow ? statusLabel(workflow.status) : "Non retrouvé"}</dd></span>
          <span><dt>Progression</dt><dd>{workflow ? `${workflow.progress}%` : "—"}</dd></span>
          <span><dt>Session</dt><dd>{workflow ? `${workflow.tradingDate || "—"} · ${workflow.session || workflow.kind}` : process.runId || "—"}</dd></span>
          <span><dt>Prochaine action</dt><dd>{workflow?.nextAction || "—"}</dd></span>
        </dl>
        <TechnicalDetails items={[
          { label: "Workflow", value: workflow?.id },
          { label: "Révision", value: workflow?.revision },
          { label: "Work item courant", value: workflow?.currentWorkItemId || process.id },
        ]}/>
      </section>
```

par :

```typescript
      <section className="gpt-parent-workflow-panel">
        <p className="eyebrow">Workflow parent</p>
        <h3>{workflow?.name || "Workflow non retrouvé"}</h3>
        <dl>
          <span><dt>État</dt><dd>{workflow ? statusLabel(workflow.status) : "Non retrouvé"}</dd></span>
          <span><dt>Progression</dt><dd>{workflow ? `${workflow.progress}%` : "—"}</dd></span>
          <span><dt>Session</dt><dd>{workflow ? `${workflow.tradingDate || "—"} · ${workflow.session || workflow.kind}` : process.runId || "—"}</dd></span>
          <span><dt>Prochaine action</dt><dd>{workflow?.nextAction || "—"}</dd></span>
        </dl>
      </section>
```

- [ ] **Step 4 : Supprimer `GptContractPanel` et `LeaseBadge`**

Remplacer :

```typescript
function GptContractPanel({ transport }: { transport: GptTransportContract }) {
  return <TechnicalDetails title="Transmission technique GPT" items={[
    { label: "État du lease", value: <LeaseBadge state={transport.lease.state}/> },
    { label: "Outil de sauvegarde", value: transport.saveTool },
    { label: "Work item", value: transport.workItemId },
    { label: "Worker payload", value: transport.workerId },
    { label: "Jeton de lease", value: transport.leaseProtected ? "Protégé côté serveur" : "Absent" },
    { label: "Handle", value: transport.hasLeaseHandle ? "Complet" : "Incomplet" },
    { label: "Prompt", value: transport.promptAvailable ? "Exposé" : "Absent" },
    { label: "Manifest", value: transport.manifestAvailable ? "Présent" : "Absent" },
    { label: "Cible de sauvegarde", value: transport.saveTargetAvailable ? "Présente" : "Absente" },
  ]}/>;
}

function LeaseBadge({ state }: { state: GptTransportContract["lease"]["state"] }) {
  return <span className="lease-badge" data-state={state}>{state === "active" ? "ACTIVE" : state === "expiring" ? "EXPIRING" : state === "expired" ? "EXPIRED" : "NO LEASE"}</span>;
}

function GptLifecycle({ process }: { process: GptProcess }) {
```

par :

```typescript
function GptLifecycle({ process }: { process: GptProcess }) {
```

- [ ] **Step 5 : Nettoyer les imports devenus inutiles**

`TechnicalDetails` (plus aucun usage dans le fichier après les steps 2-4) et `GptTransportContract` (uniquement utilisé par `GptContractPanel`/`LeaseBadge`, tous deux supprimés) doivent être retirés des imports.

Remplacer :

```typescript
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, statusLabel, StatusTag, TechnicalDetails } from "@/components/operations";
```

par :

```typescript
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, statusLabel, StatusTag } from "@/components/operations";
```

Remplacer :

```typescript
import type { GptOperationsContext, GptProcess, GptTransportContract } from "@/operationsTypes";
```

par :

```typescript
import type { GptOperationsContext, GptProcess } from "@/operationsTypes";
```

- [ ] **Step 6 : Typecheck**

Run: `npm run typecheck`
Expected: PASS (confirme qu'aucun import ni symbole restant ne référence encore `TechnicalDetails`, `GptTransportContract` ou `LeaseBadge`).

- [ ] **Step 7 : Commit**

```bash
git add src/pages/GptProcessPage.tsx
git commit -m "refactor: remove raw JSON and internal-ID panels from GPT process detail"
```

---

### Task 5 : Reformuler les libellés restants de `GptProcessPage.tsx`

**Files:**
- Modify: `src/pages/GptProcessPage.tsx`

- [ ] **Step 1 : "P9 · orchestration liée" / "Command Center GPT"**

Dans `GptOperationsCommandPanel`, remplacer :

```typescript
  return <Card className="gpt-command-center" aria-label="Command Center GPT">
    <header>
      <div><p className="eyebrow">P9 · orchestration liée</p><h2>Command Center GPT</h2></div>
      <StatusTag status={workflow?.status || process.status}/>
    </header>
```

par :

```typescript
  return <Card className="gpt-command-center" aria-label="Contexte d’exécution du processus GPT">
    <header>
      <div><p className="eyebrow">Orchestration liée</p><h2>Contexte d’exécution</h2></div>
      <StatusTag status={workflow?.status || process.status}/>
    </header>
```

- [ ] **Step 2 : Panneau "Save / lease / payload" — traduction et réduction aux cellules utiles**

Toujours dans `GptOperationsCommandPanel`, remplacer :

```typescript
      <section className="gpt-save-health-panel">
        <p className="eyebrow">Save / lease / payload</p>
        <h3>{healthLabel(health?.state)}</h3>
        <div className="gpt-health-grid">
          <HealthCell label="Can save" value={health?.canSave ? "oui" : "non"} ok={Boolean(health?.canSave)}/>
          <HealthCell label="Lease" value={health?.leaseState || "none"} ok={health?.leaseState === "active" || health?.state === "saved"}/>
          <HealthCell label="Handle" value={health?.hasLeaseHandle ? "complet" : "incomplet"} ok={Boolean(health?.hasLeaseHandle)}/>
          <HealthCell label="Target" value={health?.saveReady ? "présent" : "absent"} ok={Boolean(health?.saveReady)}/>
          <HealthCell label="Prompt" value={health?.promptReady ? "exposé" : "absent"} ok={Boolean(health?.promptReady)}/>
          <HealthCell label="Manifest" value={health?.manifestReady ? "présent" : "absent"} ok={Boolean(health?.manifestReady)}/>
        </div>
        <small>{health?.leaseExpiresAt ? `Lease expire ${formatDateTime(health.leaseExpiresAt)} · ${health.leaseRemainingMs === null ? "durée N/D" : formatDuration(Math.abs(health.leaseRemainingMs))}` : "Aucun lease matérialisé"}</small>
      </section>
```

par :

```typescript
      <section className="gpt-save-health-panel">
        <p className="eyebrow">État de sauvegarde</p>
        <h3>{healthLabel(health?.state)}</h3>
        <div className="gpt-health-grid">
          <HealthCell label="Sauvegarde possible" value={health?.canSave ? "oui" : "non"} ok={Boolean(health?.canSave)}/>
          <HealthCell label="État du lease" value={health?.leaseState || "aucun"} ok={health?.leaseState === "active" || health?.state === "saved"}/>
        </div>
        <small>{health?.leaseExpiresAt ? `Lease expire ${formatDateTime(health.leaseExpiresAt)} · ${health.leaseRemainingMs === null ? "durée N/D" : formatDuration(Math.abs(health.leaseRemainingMs))}` : "Aucun lease matérialisé"}</small>
      </section>
```

(Les cellules "Handle"/"Target"/"Prompt"/"Manifest" décrivaient la disponibilité des panneaux JSON bruts retirés en Task 4 — elles n'ont plus de sens une fois ces panneaux supprimés. `HealthCell` elle-même reste utilisée par les deux cellules restantes, aucun changement à lui apporter.)

- [ ] **Step 3 : "Sortie canonique sauvegardée"**

Remplacer :

```typescript
        <header><div><p className="eyebrow">Sortie canonique sauvegardée</p><h2>{data.process.decision || "Décision GPT en attente"}</h2></div><StatusTag status={data.process.conclusion ? "completed" : data.process.status}/></header>
```

par :

```typescript
        <header><div><p className="eyebrow">Décision sauvegardée</p><h2>{data.process.decision || "Décision GPT en attente"}</h2></div><StatusTag status={data.process.conclusion ? "completed" : data.process.status}/></header>
```

- [ ] **Step 4 : "Audit du worker"**

Remplacer :

```typescript
      <header><div><p className="eyebrow">Audit du worker</p><h2>Cycle de vie GPT</h2></div><span>{data.process.events.length} événements persistés</span></header>
```

par :

```typescript
      <header><div><p className="eyebrow">Historique du processus</p><h2>Cycle de vie GPT</h2></div><span>{data.process.events.length} événements persistés</span></header>
```

- [ ] **Step 5 : Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src/pages/GptProcessPage.tsx
git commit -m "refactor: reword remaining jargon labels in GPT process detail page"
```

---

### Task 6 : Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1 : Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2 : Vérification visuelle manuelle**

Démarrer un serveur de dev ou utiliser un mock e2e pour visualiser :

`/replay/compare`, avec au moins deux runs sélectionnés (pour déclencher le scoreboard et la matrice), et confirmer :
- L'eyebrow affiche "Comparaison de runs".
- Dans le scoreboard, la matrice et le panneau GPT/timeline, chaque run affiche un libellé lisible (ex. "Session Asie · 15m · #1") comme identité principale, plus l'ID technique en secondaire ou en tooltip — plus aucun ID brut tronqué en texte principal dans ces trois vues.
- La colonne de la matrice affiche "Écart vs référence" (plus "Δ référence").
- Les en-têtes de section affichent "Détail comparatif" / "Tableau comparatif" (plus "Comparaison canonique" / "Matrice comparative").

`/replay/runs/:runId/gpt/:processId` (détail d'un process GPT), et confirmer :
- Aucun panneau JSON brut visible ("Manifest du bundle", "Save target", "Prompt d'exécution" ont disparu), aucun bloc listant Processus/Étape/Run/Worker/Révision/État source/Bundle/Request ID, aucun panneau "Transmission technique GPT".
- Le panneau anciennement "Command Center GPT" affiche "Orchestration liée" / "Contexte d'exécution", sans "P9".
- Le panneau de sauvegarde n'affiche plus que 2 cellules ("Sauvegarde possible", "État du lease"), plus plus "Can save"/"Handle"/"Target"/"Prompt"/"Manifest" en anglais.
- "Décision sauvegardée" et "Historique du processus" remplacent "Sortie canonique sauvegardée" et "Audit du worker".
- Le cycle de vie GPT, les liens incidents/runbooks/risques et les actions correctives sont toujours présents et fonctionnels.

Aucun débordement horizontal à 320 px sur les deux pages.

- [ ] **Step 3 : Commit final si des ajustements manuels ont eu lieu**

Si la vérification n'a rien changé, aucune action. Sinon, committer séparément avec un message précis.
