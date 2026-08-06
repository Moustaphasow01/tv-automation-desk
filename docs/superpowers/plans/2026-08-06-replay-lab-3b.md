# Replay Lab — chantier 3b (fusion Run/Journée, hero + onglets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `ReplayRunPage.tsx` + `ReplayDayPage.tsx` + `ReplaySessionPage.tsx` (3 pages, 3 niveaux de navigation) par une seule page fusionnée à `/replay/runs/:runId/days/:date` : un hero (résumé journée) + une bande de sélection de session + 4 onglets (Sessions/Décisions/GPT/Prix) filtrés sur la session sélectionnée.

**Architecture:** `ReplayDayPage.tsx` est réécrit en un seul fichier (cohérent avec le style déjà établi de ce module — contrairement à `/live`, les pages Replay sont historiquement de gros fichiers avec des sous-composants locaux, pas des paires Tab/Container séparées). Deux requêtes réseau alimentent la page : `useReplayDay(runId, date)` (données journée entière — sessions, variantes ; alimente le hero et l'onglet Sessions) et `useReplaySession(runId, sessionExecutionId)` (données de la session sélectionnée — timeline, GPT, prix ; alimente les onglets Décisions/GPT/Prix). La sélection de session est un `useState` local à la page, pas dans l'URL.

**Tech Stack:** React 18, TypeScript, React Router v6, TanStack Query.

Référence : `docs/superpowers/specs/2026-08-06-replay-lab-3b-design.md`.

**Rappel technique acté dans le spec** : l'URL garde `runId` (`/replay/runs/:runId/days/:date`) — le backend exige les deux paramètres, il n'existe pas d'endpoint par date seule. Le détail process GPT (`/replay/runs/:runId/gpt/:processId`) ne bouge pas du tout.

---

### Task 1: Squelette de la page fusionnée — hero, bande de session, coquille d'onglets

**Files:**
- Modify: `src/pages/ReplayDayPage.tsx` (réécriture complète)

- [ ] **Step 1: Remplacer tout le contenu du fichier**

Remplacer l'intégralité de `src/pages/ReplayDayPage.tsx` par :

```typescript
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { useOperationsEvents, useReplayDay, useReplaySession } from "@/hooks/useOperations";
import type { OperationsEvent, ReplayDayDetail, WorkflowSummary } from "@/operationsTypes";

type ReplayDayTab = "sessions" | "decisions" | "gpt" | "prix";

const tabs: Array<{ id: ReplayDayTab; label: string }> = [
  { id: "sessions", label: "Sessions" },
  { id: "decisions", label: "Décisions" },
  { id: "gpt", label: "GPT" },
  { id: "prix", label: "Prix" },
];

export default function ReplayDayPage() {
  useOperationsEvents();
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  const [activeTab, setActiveTab] = useState<ReplayDayTab>("sessions");
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<OperationsEvent | null>(null);

  // `useReplaySession` must be called unconditionally, before any early
  // return, to respect the Rules of Hooks — even though its arguments
  // depend on `query.data`, which may not exist yet on the loading render.
  // `sessions` falls back to an empty array so `activeSession` is `null`
  // and `sessionQuery`'s own `enabled: Boolean(id && sessionId)` guard
  // (see `useReplaySession` in `src/hooks/useOperations.ts`) keeps it idle
  // until real data is available.
  const sessions = query.data?.sessions || [];
  const activeSession = sessions.find(item => sessionKey(item) === selectedSessionKey) || sessions[0] || null;
  const sessionQuery = useReplaySession(id, activeSession?.sessionExecutionId || activeSession?.sourceId || "");

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;

  const day = query.data;
  const certifiedResult = day.sessions.some((item) => item.resultEligible);
  const displayedResult = certifiedResult ? day.metrics.totalR : day.metrics.provisionalR;

  return <section className="view workspace-view replay-day-v3">
    <Breadcrumbs items={[{ label: "Journées de test", to: "/replay" }, { label: day.date }]}/>
    <PageHeading eyebrow="Journée de test détaillée" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes · données PostgreSQL`} backTo="/replay" actions={<StatusTag status={day.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={day.metrics.sessionCount}/>
      <MetricCard label="Variantes" value={day.variants.length}/>
      <MetricCard label="Progression moy." value={`${day.metrics.progress}%`}/>
      <MetricCard label={certifiedResult ? "Résultat certifié" : "Résultat provisoire"} value={displayedResult === null || displayedResult === undefined ? "En calcul" : `${displayedResult.toFixed(2)} R`} tone={displayedResult === null || displayedResult === undefined ? "neutral" : displayedResult >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={day.metrics.gptProcesses || 0} detail={`${day.metrics.gptWaiting || 0} attente`}/>
      <MetricCard label="Échecs" value={day.metrics.gptFailed || 0}/>
    </MetricStrip>

    <nav className="desk-function-bar replay-session-strip" aria-label="Sélection de session">
      {day.sessions.map(session => <button
        key={sessionKey(session)}
        className={activeSession && sessionKey(activeSession) === sessionKey(session) ? "active" : ""}
        aria-pressed={activeSession ? sessionKey(activeSession) === sessionKey(session) : false}
        onClick={() => setSelectedSessionKey(sessionKey(session))}
      >
        <span>{sessionTitle(session)}</span>
        <strong className={Number(session.metrics.totalR || 0) >= 0 ? "positive" : "negative"}>{formatSessionResult(session)}</strong>
      </button>)}
    </nav>

    <nav className="desk-function-bar replay-day-tab-bar" aria-label="Détail de la journée">
      {tabs.map(tab => <button
        key={tab.id}
        className={activeTab === tab.id ? "active" : ""}
        aria-pressed={activeTab === tab.id}
        onClick={() => setActiveTab(tab.id)}
      >{tab.label}</button>)}
    </nav>

    {activeTab === "sessions" && <ReplaySessionsTab day={day} activeSession={activeSession} onSelectSession={setSelectedSessionKey}/>}
    {activeTab === "decisions" && <ReplayDecisionsTab runId={id} query={sessionQuery} selectedEvent={selectedEvent} onSelectEvent={setSelectedEvent}/>}
    {activeTab === "gpt" && <ReplayGptTab runId={id} query={sessionQuery}/>}
    {activeTab === "prix" && <ReplayPrixTab runId={id} query={sessionQuery} selectedEvent={selectedEvent} onSelectEvent={setSelectedEvent}/>}
  </section>;
}

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

function ReplaySessionsTab({ day, activeSession, onSelectSession }: { day: ReplayDayDetail; activeSession: WorkflowSummary | null; onSelectSession: (key: string) => void }) {
  return <p>PLACEHOLDER_TASK_2</p>;
}

function ReplayDecisionsTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_3</p>;
}

function ReplayGptTab({ runId, query }: { runId: string; query: ReturnType<typeof useReplaySession> }) {
  return <p>PLACEHOLDER_TASK_4</p>;
}

function ReplayPrixTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_5</p>;
}
```

Les quatre fonctions `Replay*Tab` sont des coquilles temporaires (texte
`PLACEHOLDER_TASK_N`) — elles sont remplacées une par une dans les Tasks
2 à 5. Ce découpage permet de garder le fichier qui compile et se teste à
chaque étape, sans jamais avoir un fichier à moitié écrit.

**Note** : `MetricCard label="Échecs"` n'a volontairement pas de `tone`
conditionnel ici (contrairement à l'ancien code) car cette carte n'affichait
déjà rien de spécial en dehors du texte — vérifier lors de la revue que
cela correspond bien au rendu de l'ancien `ReplayDayPage.tsx` (ligne
`MetricCard label="Échecs / bloqués"` combinée) ; si un écart de contenu
est visible à la vérification manuelle (Task 6), le signaler mais ne pas
bloquer dessus, ce n'est pas un champ critique.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (les 4 fonctions `Replay*Tab` sont des composants valides,
même vides).

- [ ] **Step 3: Commit**

```bash
git add src/pages/ReplayDayPage.tsx
git commit -m "refactor: rebuild ReplayDayPage as merged Run+Day hero+tabs shell"
```

---

### Task 2: Onglet Sessions (lanes + matrice de variantes)

**Files:**
- Modify: `src/pages/ReplayDayPage.tsx`

- [ ] **Step 1: Remplacer la fonction `ReplaySessionsTab`**

Remplacer :

```typescript
function ReplaySessionsTab({ day, activeSession, onSelectSession }: { day: ReplayDayDetail; activeSession: WorkflowSummary | null; onSelectSession: (key: string) => void }) {
  return <p>PLACEHOLDER_TASK_2</p>;
}
```

par :

```typescript
function ReplaySessionsTab({ day, activeSession, onSelectSession }: { day: ReplayDayDetail; activeSession: WorkflowSummary | null; onSelectSession: (key: string) => void }) {
  const lanes = groupSessions(day.sessions);
  const variantStats = buildVariantStats(day.sessions);
  return <>
    <section className="replay-terminal-section replay-day-map-section">
      <header><div><p className="eyebrow">Carte des exécutions</p><h2>Sessions et tentatives</h2></div><span>{day.sessions.length} exécutions</span></header>
      <div className="replay-session-lanes" aria-label="Carte multi-sessions de la journée">
        {Object.entries(lanes).map(([session, items]) => <div className="replay-session-lane" key={session}>
          <div><strong>{sessionLabel(session)}</strong><small>{items.length} tentative{items.length > 1 ? "s" : ""}</small></div>
          <div className="replay-session-lane__track">{items.map(item => <button type="button" key={item.id} className={activeSession && sessionKey(activeSession) === sessionKey(item) ? "is-selected" : ""} data-status={item.status} onClick={() => onSelectSession(sessionKey(item))} title={`${item.sourceId} · ${item.status}`}>
            <span>#{item.attempt || 1}</span><i aria-hidden="true"/><small>{item.variantId || "default"}</small>
          </button>)}</div>
          <div className="replay-session-lane__result"><strong>{formatReplayLaneResult(items)}</strong><small>{Math.round(items.reduce((total, item) => total + item.progress, 0) / Math.max(1, items.length))}%</small></div>
        </div>)}
      </div>
    </section>
    <section className="replay-terminal-section replay-variant-matrix-section">
      <header><div><p className="eyebrow">Comparaison locale</p><h2>Variantes, tentatives et résultat</h2></div><span>{variantStats.length} variantes · calcul front depuis contrat backend</span></header>
      <div className="replay-variant-matrix">
        {variantStats.map(stat => <article key={stat.variantId}>
          <header><div><strong>{stat.variantId || "default"}</strong><small>{stat.sessions.length} tentative{stat.sessions.length > 1 ? "s" : ""}</small></div><span className={stat.totalR >= 0 ? "positive" : "negative"}>{stat.totalR.toFixed(2)} R</span></header>
          <div className="replay-variant-ruler"><i style={{ width: `${Math.max(4, Math.min(100, Math.abs(stat.totalR) * 40))}%` }} data-tone={stat.totalR >= 0 ? "positive" : "negative"}/></div>
          <footer>{stat.sessions.map(session => <button type="button" key={session.id} className={activeSession && sessionKey(activeSession) === sessionKey(session) ? "is-selected" : ""} data-status={session.status} onClick={() => onSelectSession(sessionKey(session))}>
            <span>#{session.attempt || 1}</span><i aria-hidden="true"/><strong>{Number(session.metrics.totalR || 0).toFixed(2)} R</strong><small>{shortReference(session.sourceId)}</small>
          </button>)}</footer>
        </article>)}
      </div>
    </section>
  </>;
}
```

- [ ] **Step 2: Ajouter les fonctions utilitaires et l'import manquant**

Ajouter à la fin de `src/pages/ReplayDayPage.tsx` :

```typescript

function groupSessions(items: WorkflowSummary[]) {
  return items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.session || "globale";
    (output[key] ||= []).push(item);
    return output;
  }, {});
}

type VariantStat = {
  variantId: string;
  sessions: WorkflowSummary[];
  totalR: number;
};

function buildVariantStats(items: WorkflowSummary[]): VariantStat[] {
  const grouped = items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.variantId || "default";
    (output[key] ||= []).push(item);
    return output;
  }, {});
  return Object.entries(grouped).map(([variantId, sessions]) => ({
    variantId,
    sessions,
    totalR: sessions.reduce((total, item) => total + Number(item.metrics.totalR || 0), 0),
  })).sort((left, right) => right.totalR - left.totalR);
}

function formatReplayLaneResult(items: WorkflowSummary[]) {
  const values = items
    .map((item) => item.metrics.totalR)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  return values.length ? `${values.reduce((total, value) => total + value, 0).toFixed(2)} R` : "En calcul";
}
```

Ajouter cette nouvelle ligne d'import juste après la ligne
`import { useOperationsEvents, useReplayDay, useReplaySession } from "@/hooks/useOperations";` :

```typescript
import { shortReference } from "@/lib/presentation";
```

`shortReference` existe déjà dans `src/lib/presentation.ts` (utilisée par
l'ancien `ReplayDayPage.tsx`/`ReplaySessionPage.tsx`, aucune modification à
lui apporter). Note : `replayLabel` n'est délibérément plus importé nulle
part dans ce fichier — l'ancien usage (afficher le libellé du run dans le
fil d'Ariane) a été supprimé lors de la fusion, ce champ n'apparaît plus
dans la nouvelle page.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReplayDayPage.tsx
git commit -m "feat: add Sessions tab (lanes + variant matrix) to merged Replay day page"
```

---

### Task 3: Onglet Décisions (event tape + ledger + timeline)

**Files:**
- Modify: `src/pages/ReplayDayPage.tsx`

- [ ] **Step 1: Remplacer la fonction `ReplayDecisionsTab`**

Remplacer :

```typescript
function ReplayDecisionsTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_3</p>;
}
```

par :

```typescript
function ReplayDecisionsTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  const activeEvent = selectedEvent && data.timeline.some(event => event.id === selectedEvent.id) ? selectedEvent : data.timeline.at(-1) || null;
  const decisionEvents = data.timeline.filter(isDecisionRelevantEvent);
  const gptById = new Map(data.gptProcesses.map(process => [process.id, process]));
  return <>
    <Card className="replay-event-tape" aria-label="Timeline compacte des décisions replay">
      <header><div><p className="eyebrow">Event tape</p><h2>Décisions, étapes et GPT</h2></div><span>{data.timeline.length} points</span></header>
      <div className="replay-event-tape__track">
        {data.timeline.map((event, index) => <button type="button" key={event.id} className={activeEvent?.id === event.id ? "is-selected" : ""} data-layer={event.layer || "event"} data-status={event.status} onClick={() => onSelectEvent(event)}>
          <i aria-hidden="true"/><span>{String(index + 1).padStart(2, "0")} · {formatTime(event.at)}</span><strong>{event.title || event.type}</strong><small>{event.decision || event.conclusion || event.status}</small>
        </button>)}
      </div>
    </Card>
    <section className="replay-terminal-section replay-decision-ledger">
      <header><div><p className="eyebrow">Ledger synchronisé</p><h2>Décisions, GPT et conclusions</h2></div><span>{decisionEvents.length} lignes reliées au graphe</span></header>
      {!decisionEvents.length ? <Card><div className="terminal-empty-state"><span>NO_DECISION_EVENT</span><small>Aucune décision exploitable pour cette session.</small></div></Card> : <div className="data-table-wrap"><table className="data-table replay-decision-table">
        <thead><tr><th>Focus</th><th>Couche</th><th>Décision</th><th>Prix</th><th>Processus GPT</th><th>Conclusion</th></tr></thead>
        <tbody>{decisionEvents.map(event => {
          const process = event.processId ? gptById.get(event.processId) || null : null;
          return <tr key={event.id} className={activeEvent?.id === event.id ? "is-selected" : ""}>
            <td data-label="Focus"><button type="button" className="ledger-focus-btn" onClick={() => onSelectEvent(event)}>{formatTime(event.at)}</button><small>{formatDateTime(event.at)}</small></td>
            <td data-label="Couche"><span className="terminal-code">{event.layer || event.type}</span><StatusTag status={event.status}/></td>
            <td data-label="Décision"><strong>{event.decision || event.title || "—"}</strong><small>{event.detail || event.type}</small></td>
            <td data-label="Prix" className="mono">{event.price ?? "—"}</td>
            <td data-label="Processus GPT">{process ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(process.id)}`}>{process.workflow}<Icon name="arrow" size={13}/></Link> : "—"}<small>{process ? `${process.worker || "worker —"} · tentative ${process.attempt}/${process.maxAttempts || "—"}` : "Aucun process lié"}</small></td>
            <td data-label="Conclusion"><span>{event.conclusion || process?.conclusion || process?.decision || "—"}</span></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
    <section id="timeline-events" className="replay-terminal-section">
      <header><div><p className="eyebrow">Journal synchronisé</p><h2>Décisions horodatées</h2></div><span>{data.timeline.length} événements · prix, étapes et GPT</span></header>
      <EventTimeline events={data.timeline} runId={runId} selectedId={activeEvent?.id} onSelect={onSelectEvent}/>
    </section>
  </>;
}

function isDecisionRelevantEvent(event: OperationsEvent) {
  return event.layer === "decision" || Boolean(event.decision || event.conclusion || event.processId || event.price != null);
}
```

- [ ] **Step 2: Étendre les imports**

Remplacer la ligne d'import des composants `operations` :

```typescript
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
```

par :

```typescript
import { Breadcrumbs, EventTimeline, formatDateTime, formatTime, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
```

Remplacer la ligne d'import des composants `common` :

```typescript
import { Card, ErrorView, LoadingView } from "@/components/common";
```

par :

```typescript
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReplayDayPage.tsx
git commit -m "feat: add Décisions tab (event tape + ledger + timeline) to merged Replay day page"
```

---

### Task 4: Onglet GPT (processus + conclusions)

**Files:**
- Modify: `src/pages/ReplayDayPage.tsx`

- [ ] **Step 1: Remplacer la fonction `ReplayGptTab`**

Remplacer :

```typescript
function ReplayGptTab({ runId, query }: { runId: string; query: ReturnType<typeof useReplaySession> }) {
  return <p>PLACEHOLDER_TASK_4</p>;
}
```

par :

```typescript
function ReplayGptTab({ runId, query }: { runId: string; query: ReturnType<typeof useReplaySession> }) {
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <>
    <Card className="replay-gpt-rail">
      <header><div><p className="eyebrow">Orchestration IA</p><h2>Processus GPT de la session</h2></div><span className="terminal-counter">{data.gptProcesses.length}</span></header>
      {!data.gptProcesses.length ? <div className="terminal-empty-state"><span>NO_GPT_PROCESS</span><small>Aucun processus GPT lié à cette session.</small></div> : <div className="replay-gpt-process-list">{data.gptProcesses.map(process => <Link key={process.id} to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(process.id)}`}>
        <span className="replay-gpt-process-list__index">{String(process.attempt).padStart(2, "0")}</span>
        <div><strong>{process.workflow}</strong><small>{processSummary(process)}</small></div>
        <StatusTag status={process.status}/>
      </Link>)}</div>}
    </Card>
    <Card className="replay-conclusion-rail">
      <header><p className="eyebrow">Conclusions matérialisées</p><span className="terminal-counter">{data.conclusions.length}</span></header>
      {!data.conclusions.length ? <p className="muted-copy">Aucune conclusion enregistrée.</p> : data.conclusions.map(item => <blockquote key={item.processId}><span>{formatTime(item.at)}</span>{item.conclusion}</blockquote>)}
    </Card>
  </>;
}

function processSummary(process: GptProcess) {
  const telemetry = process.telemetry?.available
    ? `${process.telemetry.model || "model"} · ${process.telemetry.totalTokens ?? "—"} tok`
    : "télémétrie absente";
  const lease = process.leaseExpiresAt ? `lease ${formatTime(process.leaseExpiresAt)}` : "sans lease";
  return `${process.decision || process.conclusion || process.rawStatus} · ${lease} · ${telemetry}`;
}
```

- [ ] **Step 2: Ajouter l'import du type `GptProcess`**

Remplacer la ligne d'import de types existante :

```typescript
import type { OperationsEvent, ReplayDayDetail, WorkflowSummary } from "@/operationsTypes";
```

par :

```typescript
import type { GptProcess, OperationsEvent, ReplayDayDetail, WorkflowSummary } from "@/operationsTypes";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReplayDayPage.tsx
git commit -m "feat: add GPT tab (processes + conclusions) to merged Replay day page"
```

---

### Task 5: Onglet Prix (graphique)

**Files:**
- Modify: `src/pages/ReplayDayPage.tsx`

- [ ] **Step 1: Remplacer la fonction `ReplayPrixTab`**

Remplacer :

```typescript
function ReplayPrixTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_5</p>;
}
```

par :

```typescript
function ReplayPrixTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <div className="replay-session-workbench">
    <ReplayChart prices={data.priceSeries} events={data.timeline} runId={runId} selectedId={selectedEvent?.id} onSelect={event => event && onSelectEvent(event)}/>
  </div>;
}
```

- [ ] **Step 2: Ajouter l'import du composant `ReplayChart`**

Remplacer la ligne d'import (déjà étendue en Task 3) :

```typescript
import { Breadcrumbs, EventTimeline, formatDateTime, formatTime, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
```

par :

```typescript
import { Breadcrumbs, EventTimeline, formatDateTime, formatTime, MetricCard, MetricStrip, PageHeading, ReplayChart, StatusTag } from "@/components/operations";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReplayDayPage.tsx
git commit -m "feat: add Prix tab (price chart) to merged Replay day page"
```

---

### Task 6: Routage — résolveur Run, redirection Session, suppression des anciennes pages

**Files:**
- Modify: `src/pages/ReplayRunPage.tsx` (réécriture complète, devient un résolveur)
- Modify: `src/pages/ReplaySessionPage.tsx` (réécriture complète, devient une redirection)
- Modify: `src/App.tsx`

- [ ] **Step 1: Réécrire `ReplayRunPage.tsx` en résolveur**

Remplacer l'intégralité de `src/pages/ReplayRunPage.tsx` par :

```typescript
import { Navigate, useParams } from "react-router-dom";
import { ErrorView, LoadingView } from "@/components/common";
import { useReplay } from "@/hooks/useOperations";

export default function ReplayRunPage() {
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const date = query.data.run.tradingDate;
  if (!date) return <ErrorView message="Ce replay n’a pas de journée associée."/>;
  return <Navigate to={`/replay/runs/${encodeURIComponent(id)}/days/${date}`} replace/>;
}
```

Cette page ne s'affiche que pour d'anciens favoris/liens pointant vers
`/replay/runs/:runId` sans date. Elle résout la date via l'API existante
(`useReplay`) puis redirige vers la page fusionnée. Plus aucun lien interne
ne pointe vers cette route après ce chantier (vérifié en Task 7).

- [ ] **Step 2: Réécrire `ReplaySessionPage.tsx` en redirection statique**

Remplacer l'intégralité de `src/pages/ReplaySessionPage.tsx` par :

```typescript
import { Navigate, useParams } from "react-router-dom";

export default function ReplaySessionPage() {
  const { runId = "", date = "" } = useParams();
  return <Navigate to={`/replay/runs/${runId}/days/${date}`} replace/>;
}
```

La session redevient un état sélectionné dans la page fusionnée (bande de
sélection), pas un segment d'URL — cette redirection couvre les anciens
liens `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId`.

- [ ] **Step 3: Confirmer qu'`App.tsx` n'a besoin d'aucune modification**

Les routes existantes dans `src/App.tsx` sont déjà exactement celles dont
cette page fusionnée a besoin — aucune modification requise :

```typescript
<Route path="/replay/runs/:runId" element={routeElement(ReplayRunPage)}/>
<Route path="/replay/runs/:runId/days/:date" element={routeElement(ReplayDayPage)}/>
<Route path="/replay/runs/:runId/days/:date/sessions/:sessionExecutionId" element={routeElement(ReplaySessionPage)}/>
<Route path="/replay/runs/:runId/gpt/:processId" element={routeElement(GptProcessPage)}/>
```

`ReplayDayPage` (réécrit en Tasks 1-5) prend maintenant en charge le rendu
complet fusionné pour la route `/replay/runs/:runId/days/:date` ; les trois
autres routes ci-dessus routent déjà vers les bons composants (résolveur,
redirection, détail GPT inchangé).

- [ ] **Step 4: Vérifier qu'aucun lien interne ne pointe encore vers les anciennes routes**

Run: `grep -rn 'to={\`/replay/runs/\${encodeURIComponent([a-zA-Z]*)}/gpt' src/pages/ReplayDayPage.tsx`
Expected: une seule correspondance (le lien vers le détail process GPT dans
l'onglet Décisions/GPT, qui doit rester tel quel — cette route ne bouge
pas).

Run: `grep -rln "ReplaySessionPage\|useReplaySession" src/pages/ReplayDayPage.tsx src/pages/ReplayComparePage.tsx`
Expected: seul `src/pages/ReplayDayPage.tsx` apparaît (utilise
`useReplaySession`, c'est attendu) ; `ReplayComparePage.tsx` ne doit pas
apparaître (ses liens vers `/replay/runs/${id}/days/${tradingDate}` restent
inchangés, cf. spec §1 — ils pointent déjà vers la bonne URL).

- [ ] **Step 5: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReplayRunPage.tsx src/pages/ReplaySessionPage.tsx
git commit -m "refactor: ReplayRunPage becomes a date resolver, ReplaySessionPage becomes a redirect"
```

---

### Task 7: Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1: Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Vérification visuelle manuelle**

Démarrer un serveur de dev ou utiliser le mock e2e existant (ou une donnée
réelle si disponible) pour visualiser `/replay/runs/:runId/days/:date` avec
une journée ayant plusieurs sessions/variantes, et confirmer :

- Le hero affiche la date, le statut et les métriques de la journée
  (inchangés par rapport à l'ancien `ReplayDayPage`).
- La bande de sélection de session liste toutes les sessions de la journée,
  la session par défaut est présélectionnée, cliquer une puce change la
  sélection active (surlignage `active`).
- Les 4 onglets (Sessions/Décisions/GPT/Prix) sont accessibles et affichent
  bien le contenu attendu (lanes+matrice / event tape+ledger+timeline /
  liste GPT+conclusions / graphique de prix).
- Changer la session sélectionnée (via la bande OU en cliquant une session
  dans l'onglet Sessions) met bien à jour le contenu des onglets
  Décisions/GPT/Prix sans changer d'onglet actif.
- Cliquer un processus GPT (dans l'onglet Décisions ou GPT) navigue vers
  `/replay/runs/:runId/gpt/:processId` et affiche bien le détail (page
  `GptProcessPage.tsx`, inchangée).
- Visiter `/replay/runs/:runId` (sans date) redirige automatiquement vers
  `/replay/runs/:runId/days/:date` de ce run.
- Visiter une ancienne URL `/replay/runs/:runId/days/:date/sessions/:id`
  redirige vers `/replay/runs/:runId/days/:date`.
- Depuis `/replay`, cliquer "Explorer" sur une journée ou "Ouvrir" sur un
  run atterrit directement sur la page fusionnée, sans étape intermédiaire.
- Aucun débordement horizontal à 320 px.

- [ ] **Step 3: Commit final si des ajustements manuels ont eu lieu**

Si la vérification n'a rien changé, aucune action. Sinon, committer
séparément avec un message précis.

---

## Notes de suivi (hors plan)

Ce chantier clôt la restructuration principale du Replay Lab. Reste
chantier 3c (dé-jargonnage de `/replay/compare` et de
`GptProcessPage.tsx`), non commencé, priorité basse.
