# Page "Aujourd'hui" — chantier 2b (les 5 onglets restants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les 5 onglets restants (Master, Monitors, Risque, Journal, Sessions) au panneau d'onglets de `/live`, en réutilisant exactement le patron prouvé au chantier 2a (composant de présentation + conteneur de données), consolider la nav interne F1-F6 en F1-F5, et rediriger les 5 anciennes pages autonomes.

**Architecture:** Identique au chantier 2a. `LiveDeskScreen.tsx` reste un composant de présentation pure (déjà générique : `tabs`/`activeTab`/`activeTabContent` ne changent pas de forme). Chaque onglet ajoute un composant de présentation sous `src/screens/live/tabs/` et, si l'onglet a besoin de données au-delà de la session de base, un conteneur sous `src/pages/live/`. `LiveDeskPage.tsx` choisit le contenu actif par un switch sur `activeTab`.

**Tech Stack:** React 18, TypeScript, React Router v6 (`HashRouter`), TanStack Query, Vitest.

Références :
- `docs/superpowers/specs/2026-08-05-frontend-today-page-2b-design.md` (spec validée)
- `docs/superpowers/plans/2026-08-05-frontend-today-page-2a.md` (patron déjà prouvé)

**Décisions de contenu actées dans la spec, rappel :**
- Onglet Timeline renommé **Journal** (pas "Activité", pour éviter la collision avec la zone toujours visible).
- `ActivityCard`/`AuditMini` restent une zone toujours visible séparée du panneau d'onglets (option B).
- Nav interne F1-F6 → F1-F5 (Risque n'a plus de section propre).
- `DecisionDeskStrip` n'est pas dupliqué dans les onglets Master/Monitors (déjà affiché une fois dans le héros Décision — ce chantier suit la même simplification déjà appliquée à `SetupExecutionContainer` au chantier 2a).
- Le tirage au clic sur un événement de la Timeline réutilise `actions.openTimelineEvent` déjà existant (même format de tiroir que celui utilisé ailleurs sur la page), au lieu du format légèrement différent de l'ancienne `TimelinePage.tsx` autonome.
- Le lien "Voir dans Live Desk →" de `SessionContextCard` est retiré (redondant, on est déjà sur `/live`).

---

### Task 1: Onglet Master

**Files:**
- Create: `src/screens/live/tabs/MasterTab.tsx`
- Create: `src/pages/live/MasterTabContainer.tsx`

- [ ] **Step 1: Créer le composant de présentation**

Créer `src/screens/live/tabs/MasterTab.tsx` :

```typescript
import { Card, Icon, StatusBadge } from "@/components/common";
import { DeskReading, LiveSectionHeading } from "@/components/deskCards";
import { TechnicalDetails } from "@/components/operations";
import type { DeskSession } from "@/types";

function StepList({ title, items, tone }: { title: string; items: string[]; tone: "critical" | "warning" | "info" }) {
  return <Card className="step-card"><div className="brief-card__header"><h3>{title}</h3><StatusBadge tone={tone}>{items.length}</StatusBadge></div>
    <ol className="step-list">{items.map((item, index) => <li key={index}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
  </Card>;
}

export function MasterTab({ data }: { data: DeskSession }) {
  return <>
    <LiveSectionHeading title="Master Analysis" subtitle={`Créé au cutoff · ${data.master.createdAt}`}/>
    <div className="master-document-grid">
      <article className="master-document-content">
        <Card className="master-hero-react">
          <div className="master-hero-react__top"><div><p className="eyebrow">Décision initiale</p><h1>{data.master.decision}</h1><p>{data.master.summary}</p></div><StatusBadge tone="warning">Confiance {data.master.confidence}%</StatusBadge></div>
          <div className="detail-pairs"><div><span>Instrument</span><strong>{data.master.instrument}</strong></div><div><span>Direction</span><strong>{data.master.direction}</strong></div><div><span>Régime</span><strong>{data.master.regime}</strong></div></div>
        </Card>
        <section className="master-prose-section"><h2>Lecture structurée du Desk</h2><DeskReading data={data}/></section>
        <section id="contexte" className="master-prose-section"><h2>Contexte & sélection</h2><div className="content-grid"><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Thèse macro</p><h3>Contexte fondamental</h3></div><span className="card-icon"><Icon name="globe"/></span></div><p>{data.master.macroThesis}</p></Card><Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Sélection d'actif</p><h3>Pourquoi {data.master.instrument}</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.master.assetSelection}</p></Card></div></section>
        {data.master.sections.map((section, index) => <section className="master-prose-section" id={`section-${index + 1}`} key={section.title}><p className="eyebrow">Chapitre {String(index + 1).padStart(2, "0")}</p><h2>{section.title}</h2><p>{section.content}</p></section>)}
        <TechnicalDetails items={[
          { label: "Analyse Master", value: data.master.id },
          { label: "Créée au cutoff", value: data.master.createdAt },
        ]}/>
      </article>
      <aside className="master-document-rail">
        <Card className="master-toc"><p className="eyebrow">Sommaire</p><nav aria-label="Sommaire du Master"><a href="#contexte">Contexte & sélection</a>{data.master.sections.map((section, index) => <a href={`#section-${index + 1}`} key={section.title}>{section.title}</a>)}</nav></Card>
        <Card className="workspace-panel"><h2>Niveaux saillants</h2><div className="master-levels">{data.levels.map(level => <div key={`${level.price}:${level.role}`}><strong>{level.price}</strong><span>{level.role}</span><small>{level.state}</small></div>)}</div></Card>
        <StepList title="Chemin attendu" items={data.master.expectedPath} tone="info"/>
        <StepList title="Chemin d'échec" items={data.master.failurePath} tone="critical"/>
        <StepList title="Playbook de monitoring" items={data.master.monitoringPlaybook} tone="info"/>
      </aside>
    </div>
  </>;
}
```

Contenu identique à l'ancien `src/pages/MasterPage.tsx`, sauf : `PageHeading` (en-tête de page complète) remplacé par `LiveSectionHeading` (section dans une page plus large, sans `eyebrow`), et `DecisionDeskStrip` retiré (déjà affiché une fois dans le héros Décision de `LiveDeskScreen.tsx` — même simplification que `SetupExecutionContainer` au chantier 2a).

- [ ] **Step 2: Créer le conteneur de données**

Créer `src/pages/live/MasterTabContainer.tsx` :

```typescript
import { deskDetailScope, useMasterDetail } from "@/hooks/useDesk";
import { MasterTab } from "@/screens/live/tabs/MasterTab";
import type { DeskSession } from "@/types";

export function MasterTabContainer({ data: initialData }: { data: DeskSession }) {
  const query = useMasterDetail(initialData.master.id, deskDetailScope(initialData));
  const data = { ...initialData, master: query.data?.master || initialData.master };
  return <MasterTab data={data}/>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live/tabs/MasterTab.tsx src/pages/live/MasterTabContainer.tsx
git commit -m "feat: add Master tab presentation component and data container"
```

---

### Task 2: Onglet Monitors

**Files:**
- Create: `src/screens/live/tabs/MonitorsTab.tsx`
- Create: `src/pages/live/MonitorsTabContainer.tsx`

- [ ] **Step 1: Créer le composant de présentation**

Créer `src/screens/live/tabs/MonitorsTab.tsx` :

```typescript
import { Card, SectionTitle, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip } from "@/components/operations";
import { Conditions, ExpectedRealized, LiveSectionHeading } from "@/components/deskCards";
import type { MonitorItem } from "@/types";

function MonitorDetail({ monitor }: { monitor: MonitorItem }) {
  return <>
    <Card className="monitor-hero-react">
      <div><p className="eyebrow">Monitor #{monitor.sequence} · {monitor.time}</p><h1>{monitor.decision}</h1><p>{monitor.summary}</p></div>
      <MetricStrip className="monitor-health-strip">
        <MetricCard label="Santé avant" value={monitor.healthBefore}/>
        <MetricCard label="Santé après" value={monitor.healthAfter} tone={monitor.healthAfter < 40 ? "negative" : monitor.healthAfter < 70 ? "warning" : "neutral"}/>
      </MetricStrip>
    </Card>
    <Card className="brief-card">
      <div className="brief-card__header"><h3>Pourquoi cette décision ?</h3><StatusBadge tone={monitor.severity === "critical" ? "critical" : "warning"}>{monitor.statusAfter}</StatusBadge></div>
      <p>{monitor.detailedReason}</p>
      <div className="monitor-actions-react"><div><span>Action</span><strong>{monitor.nextAction}</strong></div><div><span>Prochain focus</span><strong>{monitor.nextFocus}</strong></div></div>
    </Card>
    <SectionTitle title="Attendu vs réalisé"/>
    <ExpectedRealized monitor={monitor}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={monitor.goConditions}/>
      <Conditions title="Invalidations" items={monitor.invalidationConditions}/>
    </div>
    <Card className="weak-signals-react"><h3>Signaux faibles</h3><div className="tag-list">{monitor.weakSignals.map(item => <span key={item}>{item}</span>)}</div></Card>
  </>;
}

export function MonitorsTab({
  monitors,
  selected,
  onSelectMonitor
}: {
  monitors: MonitorItem[];
  selected: MonitorItem | undefined;
  onSelectMonitor: (id: string) => void;
}) {
  return <>
    <LiveSectionHeading title="Monitors" subtitle="Contrôle dynamique de la thèse active"/>
    {monitors.length > 1 && <div className="monitor-selector-react" aria-label="Choisir un monitor">
      {monitors.map(m => <button key={m.id} className={selected?.id === m.id ? "active" : ""} onClick={() => onSelectMonitor(m.id)}>
        <span>{m.time}</span><strong>{m.decision}</strong><small>{m.statusBefore} → {m.statusAfter}</small>
      </button>)}
    </div>}
    {selected ? <MonitorDetail monitor={selected}/> : <Card><p>Aucun monitor disponible.</p></Card>}
  </>;
}
```

Contenu identique à l'ancien `src/pages/MonitorsPage.tsx` (`MonitorDetail` copié tel quel), sauf : `PageHeading`→`LiveSectionHeading`, `DecisionDeskStrip` retiré. La sélection du monitor actif (`useState` dans l'ancienne page) devient une prop contrôlée (`selected`/`onSelectMonitor`) car son changement déclenche un nouvel appel réseau (`useMonitorDetail`) — cette logique reste dans le conteneur, pas dans la présentation.

- [ ] **Step 2: Créer le conteneur de données**

Créer `src/pages/live/MonitorsTabContainer.tsx` :

```typescript
import { useState } from "react";
import { deskDetailScope, useMonitorDetail } from "@/hooks/useDesk";
import { MonitorsTab } from "@/screens/live/tabs/MonitorsTab";
import type { DeskSession } from "@/types";

export function MonitorsTabContainer({ data }: { data: DeskSession }) {
  const [selectedId, setSelectedId] = useState(data.monitors.at(-1)?.id ?? "");
  const selectedBase = data.monitors.find(m => m.id === selectedId) ?? data.monitors[0];
  const query = useMonitorDetail(selectedBase?.id || "", deskDetailScope(data));
  const selected = query.data?.monitor || selectedBase;
  return <MonitorsTab monitors={data.monitors} selected={selected} onSelectMonitor={setSelectedId}/>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live/tabs/MonitorsTab.tsx src/pages/live/MonitorsTabContainer.tsx
git commit -m "feat: add Monitors tab presentation component and data container"
```

---

### Task 3: Onglet Risque (News)

**Files:**
- Create: `src/screens/live/tabs/NewsTab.tsx`

- [ ] **Step 1: Créer le composant**

`NewsPage.tsx` ne fait aucun appel de détail au-delà de la session de base
(`data`) — pas de hook `useXDetail` à isoler. Ce composant n'a donc pas
besoin de conteneur séparé : il reçoit directement `data: DeskSession`,
comme un composant de présentation classique qui n'a rien à faire fetcher.

Créer `src/screens/live/tabs/NewsTab.tsx` :

```typescript
import { useEffect, useRef } from "react";
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { LiveSectionHeading } from "@/components/deskCards";
import type { DeskSession } from "@/types";

export function NewsTab({ data }: { data: DeskSession }) {
  const nextEventRef = useRef<HTMLElement | null>(null);
  const editorialHeadlines = data.news.headlines.filter(headline => headline.source !== "Calendrier macro");
  const nowMs = Date.now();
  const pastCount = data.macro.filter(event => {
    const timestamp = Date.parse(event.scheduledAt || "");
    return Number.isFinite(timestamp) && timestamp < nowMs;
  }).length;
  const upcomingCount = data.macro.filter(event => {
    const timestamp = Date.parse(event.scheduledAt || "");
    return Number.isFinite(timestamp) && timestamp >= nowMs;
  }).length;

  useEffect(() => {
    if (!nextEventRef.current) return;
    const timer = window.setTimeout(() => {
      nextEventRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [data.date, data.macro]);

  return <>
    <LiveSectionHeading title="Macro & News" subtitle={"Calendrier ±48 h autour du " + data.date + " · actualités éditoriales des 48 dernières heures"}/>
    <div className="news-feed-status">
      <StatusBadge tone={data.news.status === "ready" ? "positive" : "warning"}>
        {(data.news.provider || "Flux news").toUpperCase()} · {data.news.freshness?.status || data.news.status}
      </StatusBadge>
      <span>{data.news.freshness?.ageMinutes == null ? "Actualisation en attente" : `Actualisé il y a ${data.news.freshness.ageMinutes} min`}</span>
    </div>
    <Card className="digest-react digest-react--compact">
      <div className="brief-card__header"><div><p className="eyebrow">Point quotidien · {data.news.digestUpdatedAt}</p><h3>Synthèse macro</h3></div><span className="card-icon"><Icon name="news"/></span></div>
      <p>{data.news.digest}</p>
    </Card>

    <div className="news-day-heading"><div><h2>Calendrier opérationnel</h2><p>{data.macro.length} publication{data.macro.length > 1 ? "s" : ""} · {pastCount} passée{pastCount > 1 ? "s" : ""} · {upcomingCount} à venir</p></div><span>Paris · défilement vertical</span></div>
    <div className="macro-list-react macro-list-react--compact macro-list-react--window">
      {data.macro.length ? data.macro.map(event => <article
        key={(event.scheduledAt || event.time) + "-" + event.title}
        className={"macro-event-react macro-event-react--compact " + (event.isNext ? "is-next" : "")}
        ref={event.isNext ? nextEventRef : undefined}
      >
        <div className="macro-event-react__time"><time>{event.time}</time><small>{macroDateLabel(event.date, data.date)}</small><small>{event.currency || "—"}</small></div>
        <div className="macro-event-react__content">
          <div className="macro-event-react__title"><h3>{event.title}</h3>{event.isNext && <span className="next-event-badge">PROCHAIN</span>}</div>
          <div className="macro-values">
            <div><span>Préc.</span><strong>{event.previous || "—"}</strong></div>
            <div><span>Prévu</span><strong>{event.forecast || "—"}</strong></div>
            <div className="macro-value--actual"><span>Réel</span><strong>{event.actual || "—"}</strong></div>
          </div>
        </div>
        <StatusBadge tone={macroImportanceTone(event.importance)}>{event.importance}</StatusBadge>
      </article>) : <Card className="macro-window-empty"><strong>Aucun événement dans la fenêtre disponible</strong><p>Le backend continuera de rechercher les dernières publications et les événements des prochaines 48 heures.</p></Card>}
    </div>

    <SectionTitle title={`Headlines · ${editorialHeadlines.length}`} subtitle="Dernières news éditoriales réellement collectées sur 48 h"/>
    {editorialHeadlines.length > 0 ? <div className="headline-list-react headline-list-react--window">
        {editorialHeadlines.map((headline, i) => <Card key={`${headline.publishedAt || headline.scheduledAt || headline.time}-${headline.title}-${i}`} className="headline-react">
          <time><strong>{headline.time}</strong><span>{headline.date && headline.date !== data.date ? shortDate(headline.date) : "AUJ."}</span></time>
          <div>
            <div className="headline-react__title">
              <h3>{headline.url
                ? <a href={headline.url} target="_blank" rel="noreferrer">{headline.title}</a>
                : headline.title}</h3>
              <StatusBadge tone={macroImportanceTone(headline.importance || "low")}>{headline.importance || "LOW"}</StatusBadge>
            </div>
            <small>{headline.source} · {headline.provider || "provider éditorial"}</small>
            <p>{headline.impact}</p>
            {(headline.assets?.length || headline.topics?.length) ? <div className="headline-react__tags">
              {(headline.assets || []).slice(0, 6).map(asset => <span key={asset}>{asset}</span>)}
              {(headline.topics || []).slice(0, 2).map(topic => <span key={topic}>{topic.replaceAll("_", " ")}</span>)}
            </div> : null}
          </div>
        </Card>)}
      </div>
      : <Card className="headline-window-empty"><strong>Aucun flux éditorial matérialisé</strong><p>Le calendrier macro ci-dessus sert de fallback réel : il reste visible le week-end et couvre les 48 heures passées et à venir.</p></Card>}
    <Card className="source-rules-react"><p><strong>Sources :</strong> calendrier backend autonome et collecte éditoriale GDELT DOC 2.0. Chaque article conserve son URL et son domaine d'origine. Les news sont filtrées au cutoff avant d'entrer dans les packs LIVE ou Replay.</p></Card>
  </>;
}

function macroDateLabel(date: string | undefined, deskDate: string) {
  if (!date) return "—";
  if (date === deskDate) return "AUJ.";
  return shortDate(date);
}

function shortDate(date: string) {
  const [, month = "", day = ""] = date.split("-");
  return `${day}/${month}`;
}

function macroImportanceTone(importance: string) {
  const normalized = importance.toLowerCase();
  if (["high", "critical", "red"].includes(normalized)) return "critical";
  if (["medium", "orange"].includes(normalized)) return "warning";
  return "muted";
}
```

Contenu identique à `src/pages/NewsPage.tsx`, sauf `PageHeading`→`LiveSectionHeading` (sans `eyebrow`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/screens/live/tabs/NewsTab.tsx
git commit -m "feat: add News (Risque) tab presentation component"
```

---

### Task 4: Onglet Journal (Timeline)

**Files:**
- Create: `src/screens/live/tabs/TimelineTab.tsx`
- Create: `src/pages/live/TimelineTabContainer.tsx`

- [ ] **Step 1: Créer le composant de présentation**

Créer `src/screens/live/tabs/TimelineTab.tsx` :

```typescript
import { useMemo, useState } from "react";
import { Card, Icon } from "@/components/common";
import { LiveSectionHeading, Timeline } from "@/components/deskCards";
import type { DeskSession, TimelineEvent } from "@/types";

export function TimelineTab({
  data: initialData,
  sourceTimeline,
  onRefetch,
  onSelect
}: {
  data: DeskSession;
  sourceTimeline: DeskSession["timeline"];
  onRefetch: () => void;
  onSelect: (event: TimelineEvent) => void;
}) {
  const [search, setSearch] = useState("");
  const [depth, setDepth] = useState(80);
  const filteredTimeline = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sourceTimeline.filter(event => [event.title, event.summary, event.detail, event.type, event.status, event.sourceType].filter(Boolean).join(" ").toLowerCase().includes(q)) : sourceTimeline;
    return filtered.slice(-depth);
  }, [sourceTimeline, search, depth]);
  const data = { ...initialData, timeline: filteredTimeline };

  return <>
    <LiveSectionHeading title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
    <Card className="timeline-command-bar">
      <label><span>Recherche timeline</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Décision, source, statut…"/></label>
      <label><span>Zoom historique</span><input type="range" min="20" max="300" step="20" value={depth} onChange={event => setDepth(Number(event.target.value))}/></label>
      <strong>{filteredTimeline.length}/{sourceTimeline.length} événements</strong>
      <button className="secondary-btn" type="button" onClick={onRefetch}><Icon name="refresh" size={14}/>Actualiser</button>
    </Card>
    <Card className="timeline-page-card">
      <Timeline data={data} onSelect={onSelect}/>
    </Card>
  </>;
}
```

Contenu identique à `src/pages/TimelinePage.tsx`, sauf : `PageHeading`→`LiveSectionHeading` ; `onRefetch`/`onSelect` deviennent des props (le conteneur possède la requête et l'action de tiroir) ; la recherche/le zoom historique restent un état local du composant de présentation (ce sont des filtres client purs, sans nouvel appel réseau — cohérent avec le fait que `LiveDeskScreen.tsx` lui-même garde un `useState` local pour sa nav de sections).

- [ ] **Step 2: Créer le conteneur de données**

Créer `src/pages/live/TimelineTabContainer.tsx` :

```typescript
import { deskDetailScope, useTimelineDetail } from "@/hooks/useDesk";
import { TimelineTab } from "@/screens/live/tabs/TimelineTab";
import type { DeskSession, TimelineEvent } from "@/types";

export function TimelineTabContainer({ data: initialData, onSelect }: { data: DeskSession; onSelect: (event: TimelineEvent) => void }) {
  const query = useTimelineDetail(deskDetailScope(initialData));
  const sourceTimeline = query.data?.timeline || initialData.timeline;
  return <TimelineTab data={initialData} sourceTimeline={sourceTimeline} onRefetch={() => query.refetch()} onSelect={onSelect}/>;
}
```

Note : `onSelect` reçu en prop vient de `actions.openTimelineEvent` déjà défini dans `LiveDeskPage.tsx` (Task 7) — le même tiroir que celui déjà utilisé par la section Décision, pas le format légèrement différent de l'ancienne `TimelinePage.tsx` autonome (décision actée dans la spec §4).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live/tabs/TimelineTab.tsx src/pages/live/TimelineTabContainer.tsx
git commit -m "feat: add Journal (Timeline) tab presentation component and data container"
```

---

### Task 5: Onglet Sessions

**Files:**
- Create: `src/screens/live/tabs/SessionsTab.tsx`
- Create: `src/pages/live/SessionsTabContainer.tsx`

- [ ] **Step 1: Créer le composant de présentation**

Créer `src/screens/live/tabs/SessionsTab.tsx` :

```typescript
import { Card, StatusBadge } from "@/components/common";
import { LiveSectionHeading } from "@/components/deskCards";
import type { DeskSession } from "@/types";

const phases = [
  { id: "asia", label: "Asia", start: 0, end: 8, hours: "00:00–08:00" },
  { id: "london", label: "London", start: 8, end: 15.5, hours: "08:00–15:30" },
  { id: "ny", label: "New York", start: 15.5, end: 24, hours: "15:30–00:00" }
] as const;

export function SessionsTab({
  phase,
  phaseLabel,
  nextPhaseAt,
  asiaData,
  asiaLoading,
  nyData,
  nyLoading
}: {
  phase: string;
  phaseLabel: string;
  nextPhaseAt: string;
  asiaData?: DeskSession;
  asiaLoading: boolean;
  nyData?: DeskSession;
  nyLoading: boolean;
}) {
  const now = parisHour();
  return <>
    <LiveSectionHeading title="Sessions" subtitle={`${phaseLabel} active · prochaine transition à ${nextPhaseAt}`}/>
    <Card className="session-day-timeline">
      <header><div><p className="eyebrow">Journée Europe/Paris</p><h2>Chronologie des phases</h2></div><StatusBadge tone="info">AUTOMATIQUE</StatusBadge></header>
      <div className="session-day-timeline__track" aria-label={`Phase active ${phaseLabel} ; prochaine transition à ${nextPhaseAt}`}>
        {phases.map(item => <div key={item.id} className={phase === item.id ? "active" : ""} style={{ width: `${((item.end - item.start) / 24) * 100}%` }}><strong>{item.label}</strong><span>{item.hours}</span></div>)}
        <i className="session-now" style={{ left: `${(now / 24) * 100}%` }}><span>Maintenant</span></i>
      </div>
      <p>La session est choisie par l'heure de Paris. Cette chronologie est indicative et ne permet aucune sélection manuelle.</p>
    </Card>
    <div className="session-context-grid">
      <SessionContextCard title="Contexte Asia" data={asiaData} loading={asiaLoading} active={phase === "asia" || phase === "london"}/>
      <SessionContextCard title="Contexte New York" data={nyData} loading={nyLoading} active={phase === "ny"}/>
    </div>
  </>;
}

function SessionContextCard({ title, data, loading, active }: { title: string; data?: DeskSession; loading: boolean; active: boolean }) {
  return <Card className={`session-context-detail ${active ? "active" : ""}`}>
    <header><div><p className="eyebrow">{title}</p><h2>{data?.label || (loading ? "Chargement…" : "Non disponible")}</h2></div><StatusBadge tone={active ? "info" : "muted"}>{active ? "CONTEXTE ACTIF" : "EN ATTENTE"}</StatusBadge></header>
    {data ? <dl className="definition-grid"><dt>Stratégie</dt><dd>{data.strategyId}</dd><dt>Mode</dt><dd>{data.mode}</dd><dt>État</dt><dd>{data.status}</dd><dt>Prochain monitor</dt><dd>{data.nextMonitorAt}</dd></dl> : !loading && <p className="muted-copy">Le contexte n'est pas matérialisé par le backend.</p>}
  </Card>;
}

function parisHour() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour")?.value || 0) + Number(parts.find(part => part.type === "minute")?.value || 0) / 60;
}
```

Contenu identique à `src/pages/SessionsPage.tsx`, sauf : `PageHeading`→`LiveSectionHeading` ; `phase`/`phaseLabel`/`nextPhaseAt`/les données Asia/NY deviennent des props (le conteneur possède `useDeskContext`/`useDeskSessionBase`) ; le lien `<Link to="/live">Voir dans Live Desk →</Link>` de `SessionContextCard` est retiré (redondant, décision actée dans la spec §4).

- [ ] **Step 2: Créer le conteneur de données**

Créer `src/pages/live/SessionsTabContainer.tsx` :

```typescript
import { useDeskContext } from "@/context/DeskContext";
import { useDeskSessionBase } from "@/hooks/useDesk";
import { SessionsTab } from "@/screens/live/tabs/SessionsTab";

export function SessionsTabContainer() {
  const { phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const asia = useDeskSessionBase("asia_open", { refetchInterval: 120_000 });
  const ny = useDeskSessionBase("ny_open", { refetchInterval: 120_000 });
  return <SessionsTab
    phase={phase}
    phaseLabel={phaseLabel}
    nextPhaseAt={nextPhaseAt}
    asiaData={asia.data}
    asiaLoading={asia.isLoading}
    nyData={ny.data}
    nyLoading={ny.isLoading}
  />;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live/tabs/SessionsTab.tsx src/pages/live/SessionsTabContainer.tsx
git commit -m "feat: add Sessions tab presentation component and data container"
```

---

### Task 6: Consolider la nav interne F1-F6 → F1-F5 et réduire la zone Activité

**Files:**
- Modify: `src/screens/live/LiveDeskScreen.tsx`

- [ ] **Step 1: Mettre à jour les imports**

Remplacer les lignes 4-16 (le bloc d'import depuis `@/components/deskCards`) par :

```typescript
import {
  ActivityCard,
  AuditMini,
  DecisionCard,
  DecisionDeskStrip,
  LiveSectionHeading,
  MarketTable,
  OperationalTimeline,
  StatusRibbon,
  ThesisSummary
} from "@/components/deskCards";
```

(`MacroNewsCard` et `Timeline` retirés — plus utilisés dans ce fichier après les étapes suivantes.)

- [ ] **Step 2: Consolider `liveSections` en F1-F5**

Remplacer les lignes 22-29 :

```typescript
const liveSections = [
  { id: "live-decision", key: "F1", label: "Décision" },
  { id: "live-market", key: "F2", label: "Marché" },
  { id: "live-execution", key: "F3", label: "Exécution" },
  { id: "live-thesis", key: "F4", label: "Analyse" },
  { id: "live-activity", key: "F5", label: "Activité" }
] as const;
```

- [ ] **Step 3: Supprimer la section `#live-risk`**

Supprimer entièrement le bloc :

```typescript
    <div id="live-risk" className="live-module live-screen__module">
      <LiveSectionHeading title="Risque temporel & agenda"/>
      <div className="live-risk-grid">
        <MacroNewsCard data={data} onOpenNews={actions.openNews}/>
      </div>
    </div>
```

- [ ] **Step 4: Réduire la section `#live-activity`**

Remplacer le bloc `#live-activity` entier par :

```typescript
    <div id="live-activity" className="live-module live-screen__module">
      <LiveSectionHeading
        title="Activité"
        subtitle="Traçabilité des workers et qualité des données"
        action={<button className="text-btn" onClick={actions.openJournal}>Voir le journal <Icon name="arrow" size={15}/></button>}
      />
      <ActivityCard data={data}/>
      <details className="live-quality-disclosure">
        <summary><span>Qualité des données & audit</span><strong>{data.dataQuality.label}</strong></summary>
        <AuditMini data={data} onOpenAudit={actions.openAudit}/>
      </details>
    </div>
```

(Le `content-grid` avec `Timeline` compact est retiré — le journal complet vit maintenant dans l'onglet Journal. `ActivityCard` et `AuditMini` restent, conformément à la décision de la spec §1.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — ce fichier ne change pas la forme de `LiveDeskScreenProps`/`LiveDeskScreenActions`, seulement son propre JSX interne.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/live/LiveDeskScreen.tsx
git commit -m "refactor: consolidate F1-F6 quick-jump nav to F1-F5, shrink Activité to workers+audit only"
```

---

### Task 7: Brancher les 6 onglets dans `LiveDeskPage.tsx`

**Files:**
- Modify: `src/pages/LiveDeskPage.tsx`

- [ ] **Step 1: Réécrire le fichier entier**

Remplacer le contenu entier de `src/pages/LiveDeskPage.tsx` par :

```typescript
import { useNavigate, useParams } from "react-router-dom";
import { useOverlay } from "@/context/OverlayContext";
import { useDeskContext } from "@/context/DeskContext";
import { DeskPage } from "@/pages/pageState";
import { MasterTabContainer } from "@/pages/live/MasterTabContainer";
import { MonitorsTabContainer } from "@/pages/live/MonitorsTabContainer";
import { SessionsTabContainer } from "@/pages/live/SessionsTabContainer";
import { SetupExecutionContainer } from "@/pages/live/SetupExecutionContainer";
import { ThesisTabContainer } from "@/pages/live/ThesisTabContainer";
import { TimelineTabContainer } from "@/pages/live/TimelineTabContainer";
import { NewsTab } from "@/screens/live/tabs/NewsTab";
import { LiveDeskScreen } from "@/screens/live";
import type { LiveTabDefinition } from "@/screens/live/LiveDeskScreen.types";
import type { DeskSession, TimelineEvent } from "@/types";

const liveTabs: LiveTabDefinition[] = [
  { id: "thesis", label: "Lecture" },
  { id: "master", label: "Master" },
  { id: "monitors", label: "Monitors" },
  { id: "news", label: "Risque" },
  { id: "timeline", label: "Journal" },
  { id: "sessions", label: "Sessions" }
];

function activeTabContentFor(activeTab: string, data: DeskSession, onSelectTimelineEvent: (event: TimelineEvent) => void) {
  if (activeTab === "master") return <MasterTabContainer data={data}/>;
  if (activeTab === "monitors") return <MonitorsTabContainer data={data}/>;
  if (activeTab === "news") return <NewsTab data={data}/>;
  if (activeTab === "timeline") return <TimelineTabContainer data={data} onSelect={onSelectTimelineEvent}/>;
  if (activeTab === "sessions") return <SessionsTabContainer/>;
  return <ThesisTabContainer data={data}/>;
}

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const { phaseLabel } = useDeskContext();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = tab || "thesis";

  const openTimelineEvent = (event: TimelineEvent) => {
    overlay.openModal(event.title, <div>
      <section className="drawer-section">
        <p>{event.summary}</p>
        <div className="detail-pairs">
          <div><span>Heure</span><strong>{event.time}</strong></div>
          <div><span>Type</span><strong>{event.type}</strong></div>
          <div><span>Statut</span><strong>{event.status}</strong></div>
        </div>
      </section>
      <section className="drawer-section"><h3>Détail</h3><p>{event.detail}</p></section>
    </div>);
  };

  return <DeskPage>{(data, meta) => <LiveDeskScreen
    data={data}
    phaseLabel={phaseLabel}
    refreshing={meta.isFetching}
    dataUpdatedAt={meta.dataUpdatedAt}
    onRefresh={() => void meta.refetch()}
    tabs={liveTabs}
    activeTab={activeTab}
    activeTabContent={activeTabContentFor(activeTab, data, openTimelineEvent)}
    executionContent={<SetupExecutionContainer data={data}/>}
    actions={{
      openJournal: () => navigate("/live/timeline"),
      openSetup: () => document.getElementById("live-execution")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      openThesis: () => navigate("/live/thesis"),
      openAudit: () => navigate("/audit"),
      openNews: () => navigate("/live/news"),
      openTimelineEvent,
      onChangeTab: id => navigate(`/live/${id}`)
    }}
  />}</DeskPage>;
}
```

Changements par rapport au fichier du chantier 2a : `liveTabs` passe de 1 à 6 entrées ; nouvelle fonction `activeTabContentFor` qui choisit le bon conteneur/composant selon `activeTab` (au lieu de toujours rendre `ThesisTabContainer`) ; `openJournal` pointe maintenant vers `/live/timeline` (au lieu de `/timeline`) et `openNews` vers `/live/news` (au lieu de `/news`), pour éviter un aller-retour de redirection inutile depuis l'intérieur de l'app, sur le même principe que `openThesis` au chantier 2a.

- [ ] **Step 2: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/LiveDeskPage.tsx
git commit -m "feat: wire all 6 tabs into LiveDeskPage"
```

---

### Task 8: Rediriger les 5 anciennes pages autonomes

**Files:**
- Modify: `src/pages/MasterPage.tsx`
- Modify: `src/pages/MonitorsPage.tsx`
- Modify: `src/pages/NewsPage.tsx`
- Modify: `src/pages/TimelinePage.tsx`
- Modify: `src/pages/SessionsPage.tsx`

- [ ] **Step 1: Remplacer chaque fichier par une redirection pure**

Remplacer le contenu entier de `src/pages/MasterPage.tsx` :

```typescript
import { Navigate } from "react-router-dom";

export default function MasterPage() {
  return <Navigate to="/live/master" replace/>;
}
```

Remplacer le contenu entier de `src/pages/MonitorsPage.tsx` :

```typescript
import { Navigate } from "react-router-dom";

export default function MonitorsPage() {
  return <Navigate to="/live/monitors" replace/>;
}
```

Remplacer le contenu entier de `src/pages/NewsPage.tsx` :

```typescript
import { Navigate } from "react-router-dom";

export default function NewsPage() {
  return <Navigate to="/live/news" replace/>;
}
```

Remplacer le contenu entier de `src/pages/TimelinePage.tsx` :

```typescript
import { Navigate } from "react-router-dom";

export default function TimelinePage() {
  return <Navigate to="/live/timeline" replace/>;
}
```

Remplacer le contenu entier de `src/pages/SessionsPage.tsx` :

```typescript
import { Navigate } from "react-router-dom";

export default function SessionsPage() {
  return <Navigate to="/live/sessions" replace/>;
}
```

- [ ] **Step 2: Vérifier qu'aucune autre référence ne casse**

Run: `grep -rln "MasterWorkspace\|MonitorWorkspace\|NewsContent\|TimelineWorkspace\|SessionContextCard" src/pages`
Expected: aucune sortie (les implémentations internes de ces 5 pages ont disparu).

Run: `grep -rn 'from "@/pages/MasterPage"\|from "@/pages/MonitorsPage"\|from "@/pages/NewsPage"\|from "@/pages/TimelinePage"\|from "@/pages/SessionsPage"' src/`
Expected: aucune sortie.

- [ ] **Step 3: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MasterPage.tsx src/pages/MonitorsPage.tsx src/pages/NewsPage.tsx src/pages/TimelinePage.tsx src/pages/SessionsPage.tsx
git commit -m "refactor: /master, /monitors, /news, /timeline, /sessions become redirects to /live/*"
```

---

### Task 9: Corriger `src/navigation.ts`

**Files:**
- Modify: `src/navigation.ts`
- Test: `src/test/navigationPresentation.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter au bloc `describe("information architecture V3", ...)` :

```typescript

  it("pointe les 5 onglets restants directement vers /live/* sans redirection", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const expected: Record<string, string> = {
      "Analyse initiale": "/live/master",
      "Suivis": "/live/monitors",
      "Agenda & actualités": "/live/news",
      "Journal": "/live/timeline",
      "Phases de marché": "/live/sessions",
    };
    for (const [label, to] of Object.entries(expected)) {
      expect(today.items.find(item => item.label === label)?.to).toBe(to);
    }
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `npm run test:react -- navigationPresentation`
Expected: FAIL.

- [ ] **Step 3: Mettre à jour `todayItems`**

Remplacer entièrement `todayItems` dans `src/navigation.ts` :

```typescript
const todayItems: NavigationItem[] = [
  item("/dashboard", "Vue d’ensemble", "Santé, session et priorités", "chart"),
  item("/live", "Session en direct", "Décision courante et marché", "live"),
  item("/live/master", "Analyse initiale", "Document Master de la session", "master"),
  item("/live/monitors", "Suivis", "Évolutions du plan actif", "monitor"),
  item("/live/thesis", "Plan actif", "Thèse et invalidations", "brain"),
  item("/live/timeline", "Journal", "Décisions dans l’ordre", "timeline"),
  item("/live/news", "Agenda & actualités", "Macro, événements et risques", "news"),
  item("/alerts", "Alertes de session", "Historique des alertes LIVE", "bell"),
  item("/live/sessions", "Phases de marché", "Découpage horaire de la journée", "clock"),
];
```

(Seul `/alerts` reste hors `/live/*` — décision actée, hors périmètre.)

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run: `npm run test:react -- navigationPresentation`
Expected: PASS.

- [ ] **Step 5: Typecheck complet**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/navigation.ts src/test/navigationPresentation.test.ts
git commit -m "fix: point remaining today-space nav items at /live/* directly"
```

---

### Task 10: Fil d'Ariane pour les 5 onglets restants

**Files:**
- Modify: `src/components/OperatorNavigationTrail.tsx`

- [ ] **Step 1: Étendre `liveTabLabels`**

Remplacer le bloc :

```typescript
  if (parts[0] === "live" && parts[1]) {
    const liveTabLabels: Record<string, string> = {
      thesis: "Plan actif",
    };
    return detail(liveTabLabels[parts[1]] || "Session en direct", [{ label: "Session en direct", to: "/live" }]);
  }
```

par :

```typescript
  if (parts[0] === "live" && parts[1]) {
    const liveTabLabels: Record<string, string> = {
      thesis: "Plan actif",
      master: "Analyse initiale",
      monitors: "Suivis",
      news: "Agenda & actualités",
      timeline: "Journal",
      sessions: "Phases de marché",
    };
    return detail(liveTabLabels[parts[1]] || "Session en direct", [{ label: "Session en direct", to: "/live" }]);
  }
```

- [ ] **Step 2: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/OperatorNavigationTrail.tsx
git commit -m "feat: breadcrumb support for the 5 remaining /live/:tab routes"
```

---

### Task 11: Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1: Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

Run: `npm run test:e2e` (Playwright — sur Windows, forcer `npm_config_script_shell` vers Git Bash si besoin : `npm_config_script_shell="C:\Program Files\Git\bin\bash.exe" npm run test:e2e`)
Expected: PASS. Vérifier en particulier que le test « 36 routes restent directement accessibles » (`e2e/new-front-lifecycle.spec.ts`) passe toujours pour `/master`, `/monitors`, `/news`, `/timeline`, `/sessions` (désormais des redirections).

- [ ] **Step 2: Vérification visuelle manuelle**

Démarrer un serveur de dev (`npm run dev`) et vérifier dans le navigateur :
- La barre d'onglets sur `/live/thesis` affiche 6 boutons : Lecture, Master, Monitors, Risque, Journal, Sessions.
- Cliquer sur chaque onglet affiche le bon contenu et met à jour l'URL (`/live/master`, `/live/monitors`, etc.).
- La nav interne F1-F5 (plus F6) fonctionne et défile vers les bonnes sections.
- La zone Activité (en bas de page) montre `ActivityCard` et le repli qualité des données, sans le journal complet.
- Le bouton « Voir le journal » de la zone Activité et le bouton « Ouvrir le journal » de l'en-tête amènent tous les deux sur l'onglet Journal (`/live/timeline`).
- `/master`, `/monitors`, `/news`, `/timeline`, `/sessions` redirigent chacun vers leur onglet correspondant.
- La sidebar « Aujourd'hui » pointe chaque item directement vers `/live/<onglet>`, sans entrée redondante.
- Le fil d'Ariane affiche le bon libellé pour chaque onglet visité directement par URL.
- Aucun débordement horizontal à 320 px sur les 6 onglets.

- [ ] **Step 3: Commit final si des ajustements manuels ont eu lieu**

Si la vérification n'a rien changé, aucune action. Sinon, committer séparément avec un message précis.

---

## Notes de suivi (hors plan)

Après ce chantier, les 7 pages d'origine (Master, Monitors, Thèse, Setup,
Timeline, News, Sessions) sont toutes fusionnées dans `/live`. Restent hors
périmètre, à traiter séparément si besoin : un onglet dédié pour `/alerts`
(à réévaluer après usage réel), et les duplicatas de `sessionLabel` déjà
identifiés dans `HistorySessionPage.tsx`/`ReplaySessionPage.tsx`/
`ReplayComparePage.tsx`/`ReplayDayPage.tsx` (hors périmètre de ce chantier,
signalé séparément). Le chantier 3 (Replay) peut alors commencer.
