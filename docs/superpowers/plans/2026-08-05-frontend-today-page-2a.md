# Page "Aujourd'hui" — chantier 2a (infrastructure + onglet Lecture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full hero + always-visible Exécution (Setup & Position, avec le panneau de commandes opérateur complet) + mécanisme d'onglets routé, prouvé de bout en bout avec un seul onglet réel (Lecture/Thèse). Master/Monitors/News/Timeline/Sessions restent des pages autonomes inchangées jusqu'au chantier 2b.

**Architecture:** `LiveDeskScreen.tsx` reste un composant de présentation pure (aucun hook de données, aucun accès routeur), conformément à `src/screens/live/CLAUDE_DESIGN.md`. Tout le data-fetching (détail Setup, détail Thèse) est déplacé dans de petits conteneurs sous `src/pages/live/`, appelés depuis `LiveDeskPage.tsx` (la Page), qui passe le contenu déjà résolu à `LiveDeskScreen` via des props (`executionContent`, `activeTabContent`). Le routage utilise des routes plates sœurs (`/live` et `/live/:tab`), cohérent avec le seul autre exemple de route imbriquée du dépôt (`/operations/workflows/:workflowId`).

**Tech Stack:** React 18, TypeScript, React Router v6 (`HashRouter`), TanStack Query, Vitest.

Références :
- `docs/superpowers/specs/2026-08-05-frontend-today-page-design.md` (spec validée)
- `docs/superpowers/specs/2026-08-05-frontend-direction-navigation-design.md` (système visuel hérité)

**Correction technique actée dans la spec** : l'app utilise `HashRouter` (`src/main.tsx:25`). Aucune ancre de fragment (`#anchor`) n'est utilisée pour les redirections de ce plan — seulement des routes complètes.

---

### Task 1: Extraire `OperatorCommandPanel` dans un fichier partagé

**Files:**
- Create: `src/components/OperatorCommandPanel.tsx`
- Modify: `src/pages/SetupPage.tsx` (import seulement — le contenu de la page reste identique dans cette tâche)
- Modify: `src/test/operatorConfirmation.test.tsx:3`

- [ ] **Step 1: Créer le fichier partagé**

Créer `src/components/OperatorCommandPanel.tsx` :

```typescript
import { useState } from "react";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Card, Icon, StatusBadge } from "@/components/common";
import { useOverlay } from "@/context/OverlayContext";
import { useOperatorAuth, useOperatorCommand, useOperatorState } from "@/hooks/useOperator";
import type { DeskOperatorCapability, DeskOperatorCommandType, DeskSession } from "@/types";

const commandLabels: Record<DeskOperatorCommandType, string> = {
  cancel_setup: "Annuler le setup",
  confirm_trigger: "Confirmer le trigger",
  move_break_even: "Déplacer au break-even",
  take_partial: "Prendre un partiel",
  exit_position: "Sortir de la position",
  request_replan: "Demander un replan"
};

export function OperatorCommandPanel({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  const auth = useOperatorAuth();
  const stateQuery = useOperatorState(data);
  const command = useOperatorCommand(data);
  const [feedback, setFeedback] = useState<string | null>(null);
  const state = stateQuery.data;
  const canWrite = auth.status === "ready";

  const openConfirmation = (capability: DeskOperatorCapability) => {
    if (!state || !capability.enabled || !canWrite) return;
    overlay.openModal(commandLabels[capability.command], <OperatorConfirmation
      capability={capability}
      revision={state.revision}
      onCancel={overlay.closeModal}
      onConfirm={async values => {
        const result = await command.mutateAsync({
          command: capability.command,
          expectedRevision: state.revision,
          idempotencyKey: createIdempotencyKey(capability.command),
          confirmationPhrase: values.confirmationPhrase,
          targetId: capability.targetId || undefined,
          reason: values.reason,
          ...(capability.command === "take_partial" ? { partialFraction: values.partialFraction } : {})
        });
        setFeedback(`${commandLabels[capability.command]} enregistrée · révision ${result.command.revision} · audit ${result.command.auditId}`);
        overlay.closeModal();
      }}
    />);
  };

  return <Card className="operator-panel">
    <div className="operator-panel__head">
      <div><p className="eyebrow">Commandes opérateur</p><h3>État canonique uniquement</h3></div>
      <StatusBadge tone={canWrite ? "info" : auth.status === "loading" ? "warning" : "muted"}>
        {canWrite ? "AUTHENTIFIÉ" : auth.status === "loading" ? "CONNEXION" : "LECTURE SEULE"}
      </StatusBadge>
    </div>
    <p className="operator-panel__notice">Chaque action exige une confirmation textuelle, la révision courante et une clé d'idempotence. Aucun ordre broker n'est envoyé.</p>
    <div className="operator-panel__identity">
      <span>{auth.email || auth.message || "PIN opérateur requis pour écrire"}</span>
      {!canWrite && auth.status !== "loading" && auth.status !== "unavailable" && <button type="button" className="secondary-btn" onClick={() => void auth.signIn()}>Se connecter</button>}
      {canWrite && <button type="button" className="text-btn" onClick={() => void auth.signOut()}>Déconnexion</button>}
    </div>
    {stateQuery.isError && <p className="operator-feedback operator-feedback--error">{stateQuery.error.message}</p>}
    {feedback && <p className="operator-feedback"><Icon name="check" size={16}/>{feedback}</p>}
    <div className="operator-command-grid">
      {(state?.allowedCommands || []).map(capability => <button
        type="button"
        key={capability.command}
        className={`operator-command operator-command--${capability.dangerLevel}`}
        disabled={!canWrite || !capability.enabled || command.isPending}
        onClick={() => openConfirmation(capability)}
        title={capability.reason || commandLabels[capability.command]}
      >
        <strong>{commandLabels[capability.command]}</strong>
        <span>{capability.enabled ? capability.targetId || "Session active" : humanReason(capability.reason)}</span>
      </button>)}
    </div>
    {state && <div className="operator-panel__revision"><span>Révision opérateur</span><strong>{state.revision}</strong><span>Broker</span><strong>désactivé</strong></div>}
  </Card>;
}

export function OperatorConfirmation({
  capability,
  revision,
  onCancel,
  onConfirm
}: {
  capability: DeskOperatorCapability;
  revision: number;
  onCancel: () => void;
  onConfirm: (values: { confirmationPhrase: string; reason: string; partialFraction: number }) => Promise<void>;
}) {
  const [partialFraction, setPartialFraction] = useState(0.5);
  return <ConfirmActionForm
    target={capability.targetId || "Session active"}
    revision={revision}
    expectedPhrase={capability.confirmationPhrase}
    onCancel={onCancel}
    danger={capability.dangerLevel === "critical"}
    validateExtra={() => partialFraction > 0 && partialFraction < 1}
    onConfirm={({ confirmationPhrase, reason }) => onConfirm({ confirmationPhrase, reason, partialFraction })}
  >
    {capability.command === "take_partial" && <label>
      Fraction à sortir
      <select value={partialFraction} onChange={event => setPartialFraction(Number(event.target.value))}>
        <option value={0.25}>25 %</option><option value={0.5}>50 %</option><option value={0.75}>75 %</option>
      </select>
    </label>}
  </ConfirmActionForm>;
}

export function operatorConfirmationIsValid(confirmationPhrase: string, expectedPhrase: string, reason: string) {
  return confirmationPhrase === expectedPhrase && reason.trim().length >= 3;
}

function createIdempotencyKey(command: DeskOperatorCommandType) {
  const random = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `front:${command}:${random}`;
}

function humanReason(reason: string | null) {
  return ({
    canonical_setup_missing: "Aucun setup canonique",
    setup_terminal: "Setup déjà terminé",
    setup_already_triggered: "Trigger déjà confirmé",
    active_position_missing: "Aucune position active",
    position_not_active: "Position inactive",
    position_entry_missing: "Prix d'entrée manquant",
    active_thesis_missing: "Aucune thèse active"
  } as Record<string, string>)[reason || ""] || "Action indisponible";
}
```

- [ ] **Step 2: Mettre à jour `src/pages/SetupPage.tsx`**

Remplacer le fichier entier par (contenu identique à aujourd'hui, sauf l'import et la suppression des fonctions désormais partagées) :

```typescript
import { Card, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { DecisionDeskStrip, PositionCard, SetupCard } from "@/components/deskCards";
import { OperatorCommandPanel } from "@/components/OperatorCommandPanel";
import { deskDetailScope, useSetupDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function SetupPage() {
  return <DeskPage>{data => <SetupWorkspace initialData={data}/>}</DeskPage>;
}

function SetupWorkspace({ initialData }: { initialData: DeskSession }) {
  const query = useSetupDetail(initialData.setup.id, deskDetailScope(initialData));
  const data = {
    ...initialData,
    setup: query.data?.setup || initialData.setup,
    levels: query.data?.levels || initialData.levels
  };
  return <section className="view setup-workspace-v2">
    <PageHeading eyebrow="Exécution" title="Setup & Position" subtitle="Plan théorique séparé de l'exécution canonique"/>
    <DecisionDeskStrip
      data={data}
      focusLabel="Sécurité opérateur"
      focusValue={data.position.active ? `Position ${data.position.status}` : data.setup.statusLabel}
      focusDetail={`Setup ${data.setup.status} · commandes idempotentes`}
    />
    <div className="setup-control-grid">
      <SetupCard data={data}/>
      <section id="position"><PositionCard data={data}/></section>
    </div>
    <OperatorCommandPanel data={data}/>
    <Card className="source-rules-react">
      <div className="brief-card__header"><div><p className="eyebrow">Priorité des sources</p><h3>Règle opérationnelle</h3></div><span className="card-icon"><Icon name="database"/></span></div>
      <div className="source-priority-list">
        <div><span>1</span><p><strong>Position et stop réels</strong><small>Backend d'exécution</small></p></div>
        <div><span>2</span><p><strong>Statut du setup</strong><small>desk_setups</small></p></div>
        <div><span>3</span><p><strong>Action recommandée</strong><small>Dernier Monitor valide</small></p></div>
        <div><span>4</span><p><strong>Plan initial</strong><small>Analyse Master</small></p></div>
      </div>
    </Card>
    <SectionTitle title="Niveaux liés"/>
    <div className="levels-react">{data.levels.map(level => <Card key={level.price} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : "info"}>{level.state}</StatusBadge></Card>)}</div>
  </section>;
}
```

- [ ] **Step 3: Mettre à jour le test**

Modifier la ligne 3 de `src/test/operatorConfirmation.test.tsx` :

```typescript
import { OperatorConfirmation, operatorConfirmationIsValid } from "@/components/OperatorCommandPanel";
```

- [ ] **Step 4: Vérifier qu'aucune autre référence ne casse**

Run: `grep -rn "from \"@/pages/SetupPage\"" src/`
Expected: aucune sortie autre que d'éventuels tests déjà migrés à l'étape 3 (aucune sortie du tout attendue après l'étape 3).

- [ ] **Step 5: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS — en particulier `src/test/operatorConfirmation.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/OperatorCommandPanel.tsx src/pages/SetupPage.tsx src/test/operatorConfirmation.test.tsx
git commit -m "refactor: extract OperatorCommandPanel into a shared component"
```

---

### Task 2: Créer le conteneur d'exécution partagé

**Files:**
- Create: `src/pages/live/SetupExecutionContainer.tsx`

- [ ] **Step 1: Créer le conteneur**

Ce conteneur fait le data-fetching (`useSetupDetail`) que `LiveDeskScreen.tsx` ne doit pas faire lui-même (c'est un composant de présentation pure, voir `src/screens/live/CLAUDE_DESIGN.md`). Il sera utilisé à la fois par `LiveDeskPage.tsx` (Task 6) pour la zone Exécution toujours visible.

Créer `src/pages/live/SetupExecutionContainer.tsx` :

```typescript
import { PositionCard, SetupCard } from "@/components/deskCards";
import { OperatorCommandPanel } from "@/components/OperatorCommandPanel";
import { deskDetailScope, useSetupDetail } from "@/hooks/useDesk";
import type { DeskSession } from "@/types";

export function SetupExecutionContainer({ data: initialData }: { data: DeskSession }) {
  const query = useSetupDetail(initialData.setup.id, deskDetailScope(initialData));
  const data = {
    ...initialData,
    setup: query.data?.setup || initialData.setup,
    levels: query.data?.levels || initialData.levels
  };
  return <>
    <div className="content-grid">
      <SetupCard data={data}/>
      <section id="position"><PositionCard data={data}/></section>
    </div>
    <OperatorCommandPanel data={data}/>
  </>;
}
```

Note : `SetupCard`/`PositionCard` reçoivent ici `data` sans `onOpenSetup`/`onOpenPosition` (ces props sont optionnelles) — il n'y a plus de page séparée vers laquelle naviguer, le détail est déjà affiché en entier ici.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (ce fichier n'est pas encore importé nulle part, donc aucun test ne l'exerce à cette étape — le typecheck seul valide sa correction syntaxique/de types).

- [ ] **Step 3: Commit**

```bash
git add src/pages/live/SetupExecutionContainer.tsx
git commit -m "feat: add SetupExecutionContainer for the always-visible Exécution zone"
```

---

### Task 3: Créer l'onglet Lecture (présentation pure)

**Files:**
- Create: `src/screens/live/tabs/ThesisTab.tsx`

- [ ] **Step 1: Créer le composant de présentation**

Créer `src/screens/live/tabs/ThesisTab.tsx` :

```typescript
import { Card, Icon, StatusBadge } from "@/components/common";
import { MetricCard, MetricStrip } from "@/components/operations";
import { Conditions, LiveSectionHeading } from "@/components/deskCards";
import type { DeskSession } from "@/types";

export interface ThesisTabConditions {
  monitorId?: string;
  go: string[];
  invalidations: string[];
}

export function ThesisTab({ data, conditions }: { data: DeskSession; conditions: ThesisTabConditions }) {
  return <>
    <LiveSectionHeading title="Thèse active" subtitle="État vivant mis à jour par les Monitors"/>
    <Card className="thesis-page-hero">
      <div className="thesis-page-hero__copy">
        <div className="instrument-title"><span className="instrument-badge">{data.thesis.instrument}</span><div><p className="eyebrow">{data.thesis.direction}</p><h1>{data.thesis.status}</h1></div></div>
        <p>{data.thesis.dominantScenario}</p>
        <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.previousStatus} → {data.thesis.status}</StatusBadge>
      </div>
      <MetricStrip className="thesis-health-strip">
        <MetricCard label="Santé" value={`${data.thesis.health}/100`} tone={data.thesis.health < 40 ? "negative" : data.thesis.health < 70 ? "warning" : "neutral"}/>
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Valide jusqu'à" value={data.thesis.validUntil}/>
      </MetricStrip>
    </Card>
    <div className="content-grid">
      <Card className="score-drivers-react positive"><h3><Icon name="trendUp"/> Facteurs positifs</h3>{data.thesis.scoreDriversPositive.length ? <ul>{data.thesis.scoreDriversPositive.map(x => <li key={x}>{x}</li>)}</ul> : <p>Aucun facteur positif dominant.</p>}</Card>
      <Card className="score-drivers-react negative"><h3><Icon name="trendDown"/> Facteurs négatifs</h3><ul>{data.thesis.scoreDriversNegative.map(x => <li key={x}>{x}</li>)}</ul></Card>
    </div>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Scénario secondaire</p><h3>Transformation possible</h3></div><span className="card-icon"><Icon name="change"/></span></div><p>{data.thesis.secondaryScenario}</p></Card>
    <Card className="brief-card"><div className="brief-card__header"><div><p className="eyebrow">Prochain focus</p><h3>Ce que le prochain monitor doit vérifier</h3></div><span className="card-icon"><Icon name="target"/></span></div><p>{data.thesis.nextFocus}</p><div className="brief-card__verdict">Valide jusqu'à {data.thesis.validUntil}</div></Card>

    <LiveSectionHeading title="Niveaux de la thèse"/>
    <div className="levels-react">
      {data.levels.map(level => <Card key={`${level.price}-${level.role}`} className="level-react"><strong>{level.price}</strong><span>{level.role}</span><StatusBadge tone={level.state === "consumed" ? "critical" : level.state === "tested" ? "warning" : "info"}>{level.state}</StatusBadge></Card>)}
    </div>
    <LiveSectionHeading title="Conditions courantes" subtitle={`Dernier Monitor · ${conditions.monitorId || "indisponible"}`}/>
    <div className="content-grid">
      <Conditions title="Conditions WAIT → GO" items={conditions.go}/>
      <Conditions title="Invalidations" items={conditions.invalidations}/>
    </div>
  </>;
}
```

Note : `PageHeading` (utilisé par l'ancienne `ThesisPage.tsx` pour son titre de page complet) est remplacé par `LiveSectionHeading` — ce composant est désormais une section dans une page plus large, pas une page à part entière avec son propre en-tête. Les deux `SectionTitle` de l'ancienne page deviennent aussi `LiveSectionHeading` pour rester cohérent avec le reste de `LiveDeskScreen`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/screens/live/tabs/ThesisTab.tsx
git commit -m "feat: add ThesisTab presentation component for the Lecture tab"
```

---

### Task 4: Créer le conteneur de données de l'onglet Lecture

**Files:**
- Create: `src/pages/live/ThesisTabContainer.tsx`

- [ ] **Step 1: Créer le conteneur**

Créer `src/pages/live/ThesisTabContainer.tsx` :

```typescript
import { deskDetailScope, useThesisConditionsDetail, useThesisDetail } from "@/hooks/useDesk";
import { ThesisTab } from "@/screens/live/tabs/ThesisTab";
import type { DeskSession } from "@/types";

export function ThesisTabContainer({ data: initialData }: { data: DeskSession }) {
  const scope = deskDetailScope(initialData);
  const thesisQuery = useThesisDetail(initialData.thesis.id, scope);
  const conditionsQuery = useThesisConditionsDetail(initialData.thesis.id, scope);
  const data = {
    ...initialData,
    thesis: thesisQuery.data?.thesis || initialData.thesis,
    levels: thesisQuery.data?.levels || initialData.levels
  };
  return <ThesisTab
    data={data}
    conditions={{
      monitorId: conditionsQuery.data?.monitorId,
      go: conditionsQuery.data?.go || initialData.monitors.at(-1)?.goConditions || [],
      invalidations: conditionsQuery.data?.invalidations || initialData.monitors.at(-1)?.invalidationConditions || []
    }}
  />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/live/ThesisTabContainer.tsx
git commit -m "feat: add ThesisTabContainer for lazy-loaded thesis detail fetching"
```

---

### Task 5: Mettre à jour les types et réécrire `LiveDeskScreen.tsx`

**Files:**
- Modify: `src/screens/live/LiveDeskScreen.types.ts`
- Modify: `src/screens/live/LiveDeskScreen.tsx`

- [ ] **Step 1: Mettre à jour les types**

Remplacer le contenu entier de `src/screens/live/LiveDeskScreen.types.ts` par :

```typescript
import type { ReactNode } from "react";
import type { DeskSession, TimelineEvent } from "@/types";

export interface LiveTabDefinition {
  id: string;
  label: string;
}

export interface LiveDeskScreenActions {
  openJournal: () => void;
  openSetup: () => void;
  openThesis: () => void;
  openAudit: () => void;
  openNews: () => void;
  openTimelineEvent: (event: TimelineEvent) => void;
  onChangeTab: (tabId: string) => void;
}

export interface LiveDeskScreenProps {
  data: DeskSession;
  phaseLabel: string;
  refreshing: boolean;
  dataUpdatedAt: number;
  onRefresh: () => void;
  actions: LiveDeskScreenActions;
  tabs: LiveTabDefinition[];
  activeTab: string;
  activeTabContent: ReactNode;
  executionContent: ReactNode;
}
```

- [ ] **Step 2: Réécrire `LiveDeskScreen.tsx`**

Remplacer le contenu entier de `src/screens/live/LiveDeskScreen.tsx` par :

```typescript
import { useState } from "react";
import { DataSourceBadge, Icon } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import {
  ActivityCard,
  AuditMini,
  DecisionCard,
  DecisionDeskStrip,
  LiveSectionHeading,
  MacroNewsCard,
  MarketTable,
  OperationalTimeline,
  StatusRibbon,
  ThesisSummary,
  Timeline
} from "@/components/deskCards";
import type { LiveDeskScreenProps } from "./LiveDeskScreen.types";
import { dataQualityLabel, sessionLabel } from "@/lib/presentation";
import type { DeskSession } from "@/types";
import "./liveDeskScreen.css";

const liveSections = [
  { id: "live-decision", key: "F1", label: "Décision" },
  { id: "live-market", key: "F2", label: "Marché" },
  { id: "live-thesis", key: "F3", label: "Lecture" },
  { id: "live-execution", key: "F4", label: "Exécution" },
  { id: "live-risk", key: "F5", label: "Risque" },
  { id: "live-activity", key: "F6", label: "Activité" }
] as const;

type LiveSectionId = (typeof liveSections)[number]["id"];

export function LiveDeskScreen({
  data,
  phaseLabel,
  refreshing,
  dataUpdatedAt,
  onRefresh,
  actions,
  tabs,
  activeTab,
  activeTabContent,
  executionContent
}: LiveDeskScreenProps) {
  const [activeSection, setActiveSection] = useState<LiveSectionId>("live-decision");
  const upcomingMacro = data.macro.find(event => event.isNext);

  const jumpTo = (id: LiveSectionId) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <section className="view live-desk-v2 live-screen" data-screen="live-desk">
    <PageHeading
      eyebrow={`Session automatique · ${phaseLabel}`}
      title="Live Desk"
      subtitle={`${sessionLabel(data.label)} · ${data.date} · ${sessionLabel(data.strategyId)}`}
      actions={<>
        <DataSourceBadge label="SOURCE LIVE" detail={dataQualityLabel(data.dataQuality.status)}/>
        <button className={`live-sync-indicator ${refreshing ? "is-refreshing" : ""}`} onClick={onRefresh}>
          <span className="live-sync-indicator__gear"><Icon name="settings" size={14}/></span>
          <span><strong>{refreshing ? "Synchronisation…" : "Desk actif"}</strong><small>mis à jour {formatUpdatedAt(dataUpdatedAt)}</small></span>
        </button>
        <button className="text-btn" onClick={actions.openJournal}>Ouvrir le journal</button>
        <button className="secondary-btn" onClick={actions.openSetup}>Setup & Position</button>
      </>}
    />
    <DecisionDeskStrip data={data}/>
    <nav className="desk-function-bar live-screen__section-nav" aria-label="Sections du Live Desk">
      {liveSections.map(item => <button
        key={item.id}
        className={activeSection === item.id ? "active" : ""}
        aria-pressed={activeSection === item.id}
        onClick={() => jumpTo(item.id)}
      >
        <kbd>{item.key}</kbd><span>{item.label}</span>
      </button>)}
    </nav>

    <div id="live-decision" className="live-module live-module--decision live-screen__module">
      <StatusRibbon data={data}/>
      <div className="live-decision-grid">
        <DecisionCard data={data} onOpenSetup={actions.openSetup}/>
        <ThesisSummary data={data} onOpenThesis={actions.openThesis}/>
      </div>
      <LiveProcessPulse data={data} refreshing={refreshing}/>
      <MetricStrip className="live-metric-strip metric-strip--ten">
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Santé" value={`${data.thesis.health}/100`}/>
        <MetricCard label="Risque setup" value={data.setup.risk == null ? "—" : `${fmtLive(data.setup.risk)}%`}/>
        <MetricCard
          label="R non réalisé"
          value={data.position.unrealizedR == null ? "—" : `${data.position.unrealizedR.toFixed(2)} R`}
          tone={data.position.unrealizedR == null ? "neutral" : data.position.unrealizedR >= 0 ? "positive" : "negative"}
        />
        <MetricCard label="Dernier monitor" value={data.lastMonitorAt}/>
        <MetricCard
          label="Dernier claim"
          value={data.claim.lastClaimAt}
          detail={data.claim.workerId || "Aucun worker"}
        />
        <MetricCard
          label="Checkpoint à traiter"
          value={data.claim.nextTaskStatusLabel}
          detail={`${data.claim.nextTaskLabel} · ${data.claim.dueCheckpoint || data.claim.nextTaskCheckpoint}`}
          tone={taskStatusTone(data.claim.nextTaskStatus)}
        />
        <MetricCard
          label="Checkpoint suivant"
          value={data.nextCheckpointAt || data.claim.followingTaskCheckpoint || data.nextMonitorAt}
          detail={workflowLabel(data.claim.followingTaskWorkflow)}
        />
        <MetricCard
          label="Checkpoint → claim"
          value={claimLatencyLabel(data.claim.latencySeconds)}
          detail={`dû ${data.claim.readyAt} · bundle → claim ${claimLatencyLabel(data.claim.bundleClaimLatencySeconds)} · cible < ${Math.round((data.claim.latencyTargetSeconds || 120) / 60)} min`}
          tone={data.claim.latencyStatus === "late" ? "negative" : data.claim.latencyStatus === "on_target" ? "positive" : "neutral"}
        />
        <MetricCard label="Prochain macro" value={upcomingMacro ? `${upcomingMacro.time} · ${upcomingMacro.title}` : "Aucun à venir"}/>
      </MetricStrip>
      <article className="card operational-timeline-card">
        <LiveSectionHeading title="Déroulé planifié / réel" subtitle="Chaque jalon ouvre son contexte et son délai observé"/>
        <OperationalTimeline data={data} onSelect={actions.openTimelineEvent}/>
      </article>
    </div>

    <div id="live-market" className="live-module live-screen__module">
      <LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR"/>
      <MarketTable data={data}/>
    </div>

    <div id="live-execution" className="live-module live-screen__module">
      <LiveSectionHeading title="Plan & exécution" subtitle="Setup théorique et position canonique restent distincts"/>
      {executionContent}
    </div>

    <div id="live-thesis" className="live-module live-screen__module">
      <nav className="desk-function-bar live-tab-bar" aria-label="Détail de la session">
        {tabs.map(tab => <button
          key={tab.id}
          className={activeTab === tab.id ? "active" : ""}
          aria-pressed={activeTab === tab.id}
          onClick={() => actions.onChangeTab(tab.id)}
        >{tab.label}</button>)}
      </nav>
      {activeTabContent}
    </div>

    <div id="live-risk" className="live-module live-screen__module">
      <LiveSectionHeading title="Risque temporel & agenda"/>
      <div className="live-risk-grid">
        <MacroNewsCard data={data} onOpenNews={actions.openNews}/>
      </div>
    </div>

    <div id="live-activity" className="live-module live-screen__module">
      <LiveSectionHeading
        title="Activité & journal"
        subtitle="Traçabilité des décisions et des workers"
        action={<button className="text-btn" onClick={actions.openJournal}>Tout voir <Icon name="arrow" size={15}/></button>}
      />
      <div className="content-grid">
        <ActivityCard data={data}/>
        <article className="card timeline-card">
          <Timeline data={data} compact onSelect={actions.openTimelineEvent}/>
        </article>
      </div>
      <details className="live-quality-disclosure">
        <summary><span>Qualité des données & audit</span><strong>{data.dataQuality.label}</strong></summary>
        <AuditMini data={data} onOpenAudit={actions.openAudit}/>
      </details>
    </div>
  </section>;
}

function fmtLive(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function taskStatusTone(status: DeskSession["claim"]["nextTaskStatus"]) {
  if (status === "executed") return "positive";
  if (status === "late") return "negative";
  if (status === "waiting") return "warning";
  return "neutral";
}

function formatUpdatedAt(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function claimLatencyLabel(value: number | null) {
  if (value == null) return "À mesurer";
  if (value < 60) return `${value} s`;
  return `${Math.floor(value / 60)} min ${value % 60} s`;
}

function workflowLabel(value: string | null) {
  if (value === "LIVE_MASTER") return "Master";
  if (value === "LIVE_M15_MONITOR") return "Monitor GPT M15";
  return "Planification backend";
}

function LiveProcessPulse({ data, refreshing }: { data: DeskSession; refreshing: boolean }) {
  const stages = [
    { label: "Données", detail: data.lastDataAt, state: data.lastDataAt === "—" ? "waiting" : "done" },
    { label: "Bundle", detail: data.claim.readyAt, state: data.claim.readyAt === "—" ? "waiting" : "done" },
    { label: "Claim", detail: data.claim.lastClaimAt, state: data.claim.nextTaskStatus === "in_progress" ? "active" : data.claim.lastClaimAt === "—" ? "waiting" : "done" },
    { label: data.claim.nextTaskLabel, detail: data.claim.dueCheckpoint, state: refreshing ? "active" : data.claim.nextTaskStatus },
  ];
  return <div className="live-process-pulse" aria-label="Processus live">
    <span className="live-process-pulse__label" title="Gestion déterministe des prix sur chaque clôture M1 ; analyse stratégique GPT toutes les 15 minutes et sur événement critique."><i className={refreshing ? "is-spinning" : ""}><Icon name="settings" size={14}/></i> Moteur M1 · GPT M15 + événements</span>
    <div>{stages.map((stage, index) => <span key={stage.label} data-state={stage.state}>
      <i/><strong>{stage.label}</strong><small>{stage.detail || "—"}</small>{index < stages.length - 1 && <em>→</em>}
    </span>)}</div>
  </div>;
}
```

Changements par rapport à l'ancien fichier :
- Imports retirés (plus utilisés dans ce fichier) : `BriefCard`, `DeskReading`, `DeltaCard` (contenu de l'ancienne section Lecture, remplacé par les onglets), `PositionCard`, `SetupCard` (déplacés dans `SetupExecutionContainer`).
- Section `#live-execution` : ne rend plus `<SetupCard/>`/`<PositionCard/>` directement avec la donnée légère — rend `{executionContent}` (prop, résolu par la Page).
- Section `#live-thesis` (le F3 "Lecture" de la nav interne, id inchangé pour que la nav de section continue de fonctionner sans modification) : ne rend plus `BriefCard`/`DeskReading`/`DeltaCard` — rend la barre d'onglets + `{activeTabContent}`.
- Sections `#live-risk` et `#live-activity` : **inchangées** dans ce chantier (elles deviendront des onglets au chantier 2b).
- Nouvelle prop `tabs`/`activeTab`/`activeTabContent`/`executionContent`, nouvelle action `onChangeTab` — aucun hook de données, aucun accès routeur ajouté dans ce fichier.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL à ce stade — `LiveDeskPage.tsx` (Task 6) ne fournit pas encore les nouvelles props. C'est attendu : passer à la tâche suivante avant de re-vérifier.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live/LiveDeskScreen.types.ts src/screens/live/LiveDeskScreen.tsx
git commit -m "refactor: LiveDeskScreen renders execution/tab content via props instead of fetching its own light data"
```

---

### Task 6: Router `/live/:tab` et brancher `LiveDeskPage.tsx`

**Files:**
- Modify: `src/App.tsx:74`
- Modify: `src/pages/LiveDeskPage.tsx`

- [ ] **Step 1: Ajouter la route paramétrée et rediriger `/live`**

Dans `src/App.tsx`, remplacer la ligne 74 :

```typescript
      <Route path="/live" element={routeElement(LiveDeskPage)}/>
```

par ces deux lignes :

```typescript
      <Route path="/live" element={<Navigate to="/live/thesis" replace/>}/>
      <Route path="/live/:tab" element={routeElement(LiveDeskPage)}/>
```

- [ ] **Step 2: Réécrire `LiveDeskPage.tsx`**

Remplacer le contenu entier de `src/pages/LiveDeskPage.tsx` par :

```typescript
import { useNavigate, useParams } from "react-router-dom";
import { useOverlay } from "@/context/OverlayContext";
import { useDeskContext } from "@/context/DeskContext";
import { DeskPage } from "@/pages/pageState";
import { SetupExecutionContainer } from "@/pages/live/SetupExecutionContainer";
import { ThesisTabContainer } from "@/pages/live/ThesisTabContainer";
import { LiveDeskScreen } from "@/screens/live";
import type { LiveTabDefinition } from "@/screens/live/LiveDeskScreen.types";
import type { TimelineEvent } from "@/types";

const liveTabs: LiveTabDefinition[] = [
  { id: "thesis", label: "Lecture" }
];

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
    activeTabContent={<ThesisTabContainer data={data}/>}
    executionContent={<SetupExecutionContainer data={data}/>}
    actions={{
      openJournal: () => navigate("/timeline"),
      openSetup: () => navigate("/live"),
      openThesis: () => navigate("/live/thesis"),
      openAudit: () => navigate("/audit"),
      openNews: () => navigate("/news"),
      openTimelineEvent,
      onChangeTab: id => navigate(`/live/${id}`)
    }}
  />}</DeskPage>;
}
```

Changements par rapport à l'ancien fichier : ajout de `useParams`, du tableau `liveTabs` (une seule entrée pour ce chantier — le chantier 2b en ajoutera cinq), des props `tabs`/`activeTab`/`activeTabContent`/`executionContent`, de l'action `onChangeTab`. `openSetup` pointe maintenant vers `/live` (au lieu de `/setup`, qui redirige de toute façon vers `/live` — Task 8) et `openThesis` pointe directement vers `/live/thesis` (au lieu de `/thesis`) pour éviter un aller-retour de redirection inutile depuis l'intérieur de l'app. `openNews`/`openJournal`/`openAudit` restent inchangés : News, Timeline et Audit ne sont pas encore migrés (chantier 2b pour Timeline/News ; Audit reste hors périmètre).

- [ ] **Step 3: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/LiveDeskPage.tsx
git commit -m "feat: route /live/:tab, wire LiveDeskPage to the new tab and execution containers"
```

---

### Task 7: Rediriger les anciennes pages Thèse et Setup

**Files:**
- Modify: `src/pages/ThesisPage.tsx`
- Modify: `src/pages/SetupPage.tsx`

- [ ] **Step 1: Remplacer `ThesisPage.tsx`**

Remplacer le contenu entier de `src/pages/ThesisPage.tsx` par :

```typescript
import { Navigate } from "react-router-dom";

export default function ThesisPage() {
  return <Navigate to="/live/thesis" replace/>;
}
```

- [ ] **Step 2: Remplacer `SetupPage.tsx`**

Remplacer le contenu entier de `src/pages/SetupPage.tsx` (celui de la Task 1, qui rendait encore la page complète) par :

```typescript
import { Navigate } from "react-router-dom";

export default function SetupPage() {
  return <Navigate to="/live" replace/>;
}
```

- [ ] **Step 3: Vérifier qu'aucune autre référence n'est cassée**

Run: `grep -rn "SetupWorkspace\|from \"@/pages/ThesisPage\"\|from \"@/pages/SetupPage\"" src/`
Expected: aucune sortie (les deux anciennes implémentations et leurs exports internes ont disparu, et rien d'autre ne les importait).

- [ ] **Step 4: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ThesisPage.tsx src/pages/SetupPage.tsx
git commit -m "refactor: /thesis and /setup become redirects to the merged /live page"
```

---

### Task 8: Corriger `src/navigation.ts` pour le nouveau routage

**Files:**
- Modify: `src/navigation.ts`
- Test: `src/test/navigationPresentation.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter au bloc `describe("information architecture V3", ...)` de `src/test/navigationPresentation.test.ts` :

```typescript

  it("pointe directement vers les nouvelles routes /live/* sans passer par une redirection", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;
    const thesisItem = today.items.find(item => item.label === "Plan actif");
    expect(thesisItem?.to).toBe("/live/thesis");
    expect(today.items.some(item => item.to === "/setup")).toBe(false);
  });

  it("garde l'espace Aujourd'hui actif sur n'importe quel onglet /live/*", () => {
    expect(activeNavigationSpace("/live/thesis").id).toBe("today");
    expect(activeNavigationSpace("/live/master").id).toBe("today");
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `npm run test:react -- navigationPresentation`
Expected: FAIL — les deux nouveaux tests échouent contre le classement actuel.

- [ ] **Step 3: Mettre à jour `todayItems`**

Dans `src/navigation.ts`, retirer l'entrée `/setup` et changer `/thesis` en `/live/thesis` :

```typescript
const todayItems: NavigationItem[] = [
  item("/dashboard", "Vue d'ensemble", "Santé, session et priorités", "chart"),
  item("/live", "Session en direct", "Décision courante et marché", "live"),
  item("/master", "Analyse initiale", "Document Master de la session", "master"),
  item("/monitors", "Suivis", "Évolutions du plan actif", "monitor"),
  item("/live/thesis", "Plan actif", "Thèse et invalidations", "brain"),
  item("/timeline", "Journal", "Décisions dans l'ordre", "timeline"),
  item("/news", "Agenda & actualités", "Macro, événements et risques", "news"),
  item("/alerts", "Alertes de session", "Historique des alertes LIVE", "bell"),
  item("/sessions", "Phases de marché", "Découpage horaire de la journée", "clock"),
];
```

Note : l'entrée « Position » (`/setup`) est supprimée, pas déplacée — Setup n'est plus une destination séparée, c'est un contenu toujours visible de `/live` lui-même (la première entrée de la liste). Garder deux entrées différentes pointant vers la même URL serait une navigation redondante et confuse.

- [ ] **Step 4: Corriger le prédicat `matches` de l'espace `today`**

Modifier la définition de l'espace `today` :

```typescript
  space("today", "/live", "Aujourd'hui", "Piloter la session courante", "live", todayItems, pathname =>
    pathname.startsWith("/live/") || ["/", "/dashboard", "/live", "/sessions", "/master", "/monitors", "/timeline", "/news", "/alerts"].some(path => pathname === path)),
```

(`/thesis` et `/setup` sont retirés de la liste de correspondance exacte — ces chemins ne se stabilisent plus jamais sur le pathname affiché, ils redirigent immédiatement vers `/live` ou `/live/thesis`. `pathname.startsWith("/live/")` couvre `/live/thesis` maintenant et les futurs onglets du chantier 2b sans modification supplémentaire de ce prédicat.)

- [ ] **Step 5: Lancer les tests pour vérifier le succès**

Run: `npm run test:react -- navigationPresentation`
Expected: PASS.

- [ ] **Step 6: Typecheck complet**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/navigation.ts src/test/navigationPresentation.test.ts
git commit -m "fix: point today-space nav items at /live/* directly, drop redundant Setup entry"
```

---

### Task 9: Fil d'Ariane pour `/live/:tab`

**Files:**
- Modify: `src/components/OperatorNavigationTrail.tsx`

- [ ] **Step 1: Ajouter une branche de correspondance**

Dans `src/components/OperatorNavigationTrail.tsx`, ajouter le bloc suivant dans `describeLocation`, juste avant le bloc `if (parts[0] === "strategies" && parts[1])` (autour de la ligne 121, avant la constante `staticLabels`) :

```typescript
  if (parts[0] === "live" && parts[1]) {
    const liveTabLabels: Record<string, string> = {
      thesis: "Plan actif",
    };
    return detail(liveTabLabels[parts[1]] || "Session en direct", [{ label: "Session en direct", to: "/live" }]);
  }
```

Note : `liveTabLabels` n'a qu'une entrée dans ce chantier (`thesis`) ; le chantier 2b y ajoutera `master`, `monitors`, `news`, `timeline`, `sessions` au fur et à mesure que chaque onglet est construit. Les entrées existantes `/thesis` et `/setup` dans `staticLabels` (plus bas dans le fichier) restent inchangées — elles ne sont plus jamais atteintes en pratique (redirections immédiates), les laisser ne casse rien.

- [ ] **Step 2: Typecheck et tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/OperatorNavigationTrail.tsx
git commit -m "feat: breadcrumb support for /live/:tab routes"
```

---

### Task 10: Validation complète et vérification manuelle

**Files:** aucun fichier modifié — validation uniquement.

- [ ] **Step 1: Suite de validation complète**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:react`
Expected: PASS — l'ensemble de la suite, pas seulement les fichiers touchés.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Vérification visuelle manuelle**

Démarrer un serveur de dev (`npm run dev`) et vérifier dans le navigateur :
- `/live` redirige vers `/live/thesis`, qui affiche le héros, Marché, Exécution (Setup + Position + panneau de commandes opérateur complet), la barre d'onglets avec un seul onglet « Lecture » actif, puis Risque et Activité inchangés.
- `/thesis` redirige vers `/live/thesis`. `/setup` redirige vers `/live` (qui redirige lui-même vers `/live/thesis`).
- La sidebar met en surbrillance « Aujourd'hui » sur `/live/thesis`, et le sous-menu affiche « Plan actif » pointant vers `/live/thesis` sans entrée « Position » redondante.
- Le fil d'Ariane sur `/live/thesis` affiche « Session en direct › Plan actif ».
- Les boutons « Setup & Position » et « Voir la thèse » depuis la section Décision fonctionnent (restent sur `/live`, respectivement sans changement puisque déjà visible, et vers l'onglet Lecture).
- `/master`, `/monitors`, `/news`, `/timeline`, `/sessions`, `/alerts` continuent de fonctionner exactement comme avant (pages autonomes inchangées).
- Aucun débordement horizontal à 320 px sur `/live/thesis`.

- [ ] **Step 3: Commit final si des ajustements manuels ont eu lieu**

Si la vérification n'a rien changé, aucune action. Sinon, committer séparément avec un message précis.

---

## Notes de suivi (chantier 2b)

Le chantier 2b ajoutera, en réutilisant exactement ce même mécanisme (conteneur de données + composant de présentation + entrée dans `liveTabs` + entrée dans `liveTabLabels` + item de navigation mis à jour) :

- `MasterTab`/`MasterTabContainer` (depuis `MasterPage.tsx`).
- `MonitorsTab`/`MonitorsTabContainer` (depuis `MonitorsPage.tsx`, avec son sélecteur de monitors).
- `NewsTab`/`NewsTabContainer` (depuis `NewsPage.tsx`), remplaçant la section Risque actuelle.
- `TimelineTab`/`TimelineTabContainer` (depuis `TimelinePage.tsx`), remplaçant la section Activité actuelle (le composant `Timeline` compact et `ActivityCard`/`AuditMini` devront être réconciliés avec le contenu complet du journal).
- `SessionsTab`/`SessionsTabContainer` (depuis `SessionsPage.tsx`).

Chaque ajout suit le même patron que la Task 3/4/6/8/9 de ce plan : composant de présentation dans `src/screens/live/tabs/`, conteneur de données dans `src/pages/live/`, entrée dans `liveTabs` (`LiveDeskPage.tsx`), route `/live/:tab` déjà générique (aucune modification de `App.tsx` nécessaire), redirection de l'ancienne page, entrée dans `liveTabLabels` (fil d'Ariane), mise à jour de `navigation.ts`.
