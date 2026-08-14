import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { executionApi } from "@/api/executionApi";
import { Card, DataSourceBadge, ErrorView, Icon, InlineStateCard, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { executionKeys, useExecutionOverview } from "@/hooks/useExecution";
import type { BrokerBridge, BrokerManagementIntent, ExecutionOverview, OrderIntent, TradeDecision, TradePolicy } from "@/executionTypes";

type PendingAction =
  | { kind: "approve"; intent: OrderIntent }
  | { kind: "reject"; intent: OrderIntent }
  | { kind: "approve_management"; intent: BrokerManagementIntent }
  | { kind: "reject_management"; intent: BrokerManagementIntent }
  | { kind: "lock"; locked: boolean }
  | { kind: "sizing"; policy: TradePolicy }
  | { kind: "execution_mode"; policy: TradePolicy; mode: "semi_auto" | "auto" }
  | { kind: "startup"; enabled: boolean; revision: number }
  | null;

type SizingDraft = { riskPercent: number; maxRoundingExcessPercent: number; maxDecisionAgeSeconds: number; fallbackCapitalEnabled: boolean; fallbackCapital: number };

const tabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Exécution", to: "/operations/execution" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

export default function ExecutionConsolePage() {
  const queryClient = useQueryClient();
  const query = useExecutionOverview();
  const [pending, setPending] = useState<PendingAction>(null);
  const [sizingDraft, setSizingDraft] = useState<SizingDraft>({ riskPercent: 0.25, maxRoundingExcessPercent: 0.25, maxDecisionAgeSeconds: 120, fallbackCapitalEnabled: false, fallbackCapital: 10_000 });
  const mutation = useMutation({
    mutationFn: executionApi.action,
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: executionKeys.all });
    },
  });
  if (query.isLoading) return <LoadingView title="Chargement de la console d’exécution" source="POSTGRES / BROKER GATEWAY"/>;
  if (query.isError || !query.data) return <ErrorView title="Console d’exécution indisponible" message={query.error?.message || "API indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const simAccount = data.accounts.find(account => account.broker_account_id === "ninjatrader_paper_local")
    || data.accounts.find(account => account.mode === "paper");
  const simSnapshot = data.accountSnapshots.find(snapshot => snapshot.broker_account_id === simAccount?.broker_account_id);
  const addonBridge = data.bridges.find(bridge => bridge.adapter_kind === "addon");
  const atiBridge = data.bridges.find(bridge => bridge.adapter_kind === "ati");
  const latestParity = data.adapterParityRuns[0];
  const snapshotFresh = isFreshAccountSnapshot(simSnapshot, data.generatedAt, data.safety.accountSnapshotMaxAgeSeconds);
  const capital = snapshotFresh ? brokerCapital(simSnapshot) : null;
  const sizingPolicy = data.policies.find(policy => policy.policy_profile_id === "ninjatrader_sim101_local") || data.policies[0];
  const launchBlockers = demoPaperLaunchBlockers(data, addonBridge);
  const launchReady = launchBlockers.length === 0;
  const effectiveCapital = capital ?? (data.safety.fallbackCapitalEnabled ? data.safety.fallbackCapital : null);
  const usingFallback = capital === null && data.safety.fallbackCapitalEnabled && data.safety.fallbackCapital !== null;
  const safetyTone = launchReady ? "positive" : data.safety.submissionPossible ? "warning" : "critical";
  const expectedPhrase = pending?.kind === "approve" ? "CONFIRM_SIM101_ORDER"
    : pending?.kind === "approve_management" ? "CONFIRM_SIM101_MANAGEMENT"
    : pending?.kind === "reject" || pending?.kind === "reject_management" ? "CONFIRM_REJECT"
    : pending?.kind === "sizing" ? "CONFIRM_SIM101_SIZING_POLICY"
    : pending?.kind === "execution_mode" ? "CONFIRM_SIM101_EXECUTION_MODE"
    : pending?.kind === "startup" ? "CONFIRM_NINJATRADER_AUTOSTART"
    : pending?.locked ? "ENGAGE_KILL_SWITCH" : "RELEASE_SIM101_KILL_SWITCH";
  const selectedTarget = pending?.kind === "sizing" ? `${pending.policy.display_name} · ${pending.policy.policy_profile_id}`
    : pending?.kind === "execution_mode" ? `Sim101 · ${pending.mode === "auto" ? "AUTO" : "SEMI-AUTO"}`
    : pending?.kind === "startup" ? `NinjaTrader · redémarrage automatique ${pending.enabled ? "activé" : "désactivé"}`
    : pending?.kind === "approve_management" || pending?.kind === "reject_management" ? `${pending.intent.instrument_code} · ${pending.intent.management_intent_id}`
    : pending && "intent" in pending ? `${pending.intent.instrument_code || "Contrat"} · ${pending.intent.order_intent_id}`
    : "verrou global d’exécution";
  const openSizingPolicy = () => {
    if (!sizingPolicy) return;
    setSizingDraft({
      riskPercent: Number(sizingPolicy.risk_per_trade_pct ?? data.safety.riskPercent),
      maxRoundingExcessPercent: Number(sizingPolicy.max_rounding_excess_pct ?? data.safety.maxRoundingExcessPercent ?? 0.25),
      maxDecisionAgeSeconds: Number(sizingPolicy.max_decision_age_seconds ?? data.safety.maxDecisionAgeSeconds ?? 120),
      fallbackCapitalEnabled: sizingPolicy.fallback_capital_enabled === true,
      fallbackCapital: Number(sizingPolicy.fallback_capital ?? data.safety.fallbackCapital ?? 10_000),
    });
    setPending({ kind: "sizing", policy: sizingPolicy });
  };

  return <section className="view workspace-view execution-console-view">
    <PageHeading eyebrow="Exécution contrôlée" title="NinjaTrader · Execution Console" actions={<><DataSourceBadge label="POSTGRES" detail="données broker réelles"/><button className="secondary-btn" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button></>} tabs={<PageTabs items={tabs}/>}/>

    <InlineStateCard tone={safetyTone} code={launchReady ? "DEMO_PAPER_READY" : "DEMO_PAPER_BLOCKED"} title={launchReady ? "Démo PAPER prête côté broker" : "Démo PAPER bloquée avant ordre"} text={launchReady ? `AUTO · Sim101 · max ${data.safety.maxContracts} contrat(s) · AddOn command-enabled` : launchBlockers.slice(0, 3).join(" · ")} action={<button className={data.safety.databaseLocked ? "secondary-btn" : "danger-btn"} onClick={() => setPending({ kind: "lock", locked: !data.safety.databaseLocked })}>{data.safety.databaseLocked ? "Préparer déverrouillage Sim101" : "Kill switch"}</button>}/>

    <MetricStrip className="metric-strip--six">
      <MetricCard label="Décisions" value={data.decisions.length} detail="paper matérialisées"/>
      <MetricCard label="À approuver" value={data.summary.pendingApproval + data.summary.pendingManagement} detail={`${data.summary.pendingManagement} gestion`} tone={(data.summary.pendingApproval + data.summary.pendingManagement) ? "warning" : "positive"}/>
      <MetricCard label="Outbox" value={data.summary.queued + data.summary.queuedManagement} detail={`${data.summary.queuedManagement} gestion`}/>
      <MetricCard label="Ordres actifs" value={data.summary.activeOrders} tone={data.summary.activeOrders ? "warning" : "positive"}/>
      <MetricCard label="Positions broker" value={data.summary.openTrades}/>
      <MetricCard label="Adaptateurs" value={data.summary.healthyBridges} detail={`ATI ${atiBridge?.status || "offline"} · AddOn ${addonBridge?.status || "offline"}`}/>
    </MetricStrip>

    <Card className="execution-startup-panel" data-testid="ninjatrader-startup-control">
      <header>
        <div><p className="eyebrow">Continuité Windows</p><h2>Redémarrage et connexion NinjaTrader</h2></div>
        <div className="execution-row-actions">
          <StatusTag status={data.ninjaTraderStartup.connectionReady ? "connected" : data.ninjaTraderStartup.state}/>
          <button
            data-testid="ninjatrader-autostart-toggle"
            className={data.ninjaTraderStartup.enabled ? "secondary-btn" : "primary-btn"}
            disabled={!data.ninjaTraderStartup.available || mutation.isPending}
            onClick={() => setPending({ kind: "startup", enabled: !data.ninjaTraderStartup.enabled, revision: data.ninjaTraderStartup.revision })}
          >
            {data.ninjaTraderStartup.enabled ? "Désactiver le redémarrage auto" : "Activer le redémarrage auto"}
          </button>
        </div>
      </header>
      <div className="execution-startup-grid">
        <div><span>Superviseur</span><strong>{data.ninjaTraderStartup.supervisorRunning ? "ACTIF" : data.ninjaTraderStartup.supervisorInstalled ? "INSTALLÉ" : "ABSENT"}</strong></div>
        <div><span>Processus</span><strong>{data.ninjaTraderStartup.processRunning ? "EN COURS" : "ARRÊTÉ"}</strong></div>
        <div><span>Session NinjaTrader</span><strong>{data.ninjaTraderStartup.loginRequired ? "AUTHENTIFICATION REQUISE" : data.ninjaTraderStartup.platformReady ? "OUVERTE" : "DÉMARRAGE"}</strong></div>
        <div><span>Connexion au démarrage</span><strong>{data.ninjaTraderStartup.autoConnectConfigured ? "AUTOMATIQUE" : "APRÈS LOGIN"}</strong></div>
        <div><span>Connexion effective</span><strong>{data.ninjaTraderStartup.connectionReady ? "SIM101 CONNECTÉ" : data.ninjaTraderStartup.loginRequired ? "EN ATTENTE DU LOGIN" : "EN ATTENTE ADDON"}</strong></div>
        <div><span>Connexion autorisée</span><strong title={`${data.ninjaTraderStartup.connectionProvider} · ${data.ninjaTraderStartup.connectionName}`}>{data.ninjaTraderStartup.connectionName}</strong></div>
        <div><span>Dernier lancement</span><strong>{data.ninjaTraderStartup.lastStartedAt ? formatDateTime(data.ninjaTraderStartup.lastStartedAt) : "—"}</strong></div>
      </div>
      {!launchReady && <div className="execution-startup-checklist" aria-label="Blocages demo PAPER">
        <strong>Checklist avant activation des agents</strong>
        <ul>{launchBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
        <code>npm run doctor:demo-paper</code>
      </div>}
      <p className="execution-startup-note">La désactivation empêche les prochains redémarrages sans arrêter le processus en cours. NinjaTrader 8.1 exige encore son authentification principale à chaque lancement ; après le login, lance la connexion de compte « Simulation ». L’AddOn et les reconnexions réseau restent automatiques. Les verrous d’exécution restent fermés.</p>
      {data.ninjaTraderStartup.lastError && <p className="operator-feedback operator-feedback--error" role="alert">{data.ninjaTraderStartup.lastError}</p>}
    </Card>

    {(mutation.isError) && <InlineStateCard tone="critical" code="EXECUTION_ACTION_BLOCKED" title="Action refusée par les garde-fous" text={mutation.error?.message || "Action non exécutée."}/>}

    <div className="execution-console-grid">
      <Card className="execution-status-panel">
        <header><div><p className="eyebrow">Connexion d’exécution</p><h2>NinjaTrader, compte et règles de risque</h2></div><div className="execution-row-actions"><StatusTag status={addonBridge?.status || atiBridge?.status || "offline"}/><button className="secondary-btn" onClick={openSizingPolicy} disabled={!sizingPolicy}>Configurer le risque</button></div></header>
        <div className="execution-authority-control" data-testid="execution-authority-control">
          <div>
            <span>Mode d’autorisation</span>
            <strong>{data.safety.executionAuthorityMode === "auto" ? "AUTO" : "SEMI-AUTO"}</strong>
            <small>{data.safety.executionAuthorityMode === "auto" ? "Entrées et gestion automatiques après les contrôles de risque." : "Validation humaine à l’entrée, gestion ensuite automatique."}</small>
          </div>
          <div className="execution-row-actions">
            <button className={data.safety.executionAuthorityMode === "semi_auto" ? "primary-btn" : "secondary-btn"} disabled={!sizingPolicy || mutation.isPending || data.safety.executionAuthorityMode === "semi_auto"} onClick={() => sizingPolicy && setPending({ kind: "execution_mode", policy: sizingPolicy, mode: "semi_auto" })}>Semi-auto</button>
            <button className={data.safety.executionAuthorityMode === "auto" ? "primary-btn" : "secondary-btn"} disabled={!sizingPolicy || mutation.isPending || data.safety.executionAuthorityMode === "auto"} onClick={() => sizingPolicy && setPending({ kind: "execution_mode", policy: sizingPolicy, mode: "auto" })}>Auto</button>
          </div>
        </div>
        <dl className="execution-facts">
          <div><dt>Connexion</dt><dd>{data.providers[0]?.enabled ? "ACTIVE" : "DÉSACTIVÉE"}</dd></div>
          <div><dt>Compte</dt><dd>{simAccount?.account_label || "Non configuré"}</dd></div>
          <div><dt>Droits</dt><dd>{simAccount?.read_only ? "LECTURE SEULE" : "ORDRES SIMULÉS"}</dd></div>
          <div><dt>Règles de risque</dt><dd>{data.policies[0]?.enabled ? "ACTIVES" : "DÉSACTIVÉES"}</dd></div>
          <div><dt>Contrats actifs</dt><dd>{data.contracts.filter(item => item.active).length}</dd></div>
          <div><dt>ATI secours</dt><dd>{atiBridge ? `${atiBridge.status.toUpperCase()} · ${formatDateTime(atiBridge.last_seen_at)}` : "NON CONNECTÉ"}</dd></div>
          <div><dt>AddOn</dt><dd>{addonBridge ? `${addonBridge.command_enabled ? "COMMANDES" : "SHADOW"} · ${formatDateTime(addonBridge.last_seen_at)}` : "NON CONNECTÉ"}</dd></div>
          <div><dt>Protocole AddOn</dt><dd>{addonBridge?.protocol_version || "desk_ninja_addon_v1"}</dd></div>
          <div><dt>Capital de calcul</dt><dd title={usingFallback ? "Capital net de secours configuré" : snapshotFresh ? "Capital net NinjaTrader à jour" : "Relevé NinjaTrader absent ou périmé"}>{effectiveCapital === null ? "RELEVÉ REQUIS" : `${formatUsd(effectiveCapital)}${usingFallback ? " · SECOURS" : " · NINJATRADER"}`}</dd></div>
          <div><dt>Risque / position</dt><dd>{data.safety.riskPercent.toFixed(2)} %</dd></div>
          <div><dt>Excédent arrondi max.</dt><dd>+{data.safety.maxRoundingExcessPercent.toFixed(2)} point</dd></div>
          <div><dt>Fraîcheur ordre max.</dt><dd>{data.safety.maxDecisionAgeSeconds} s</dd></div>
          <div><dt>Lots · révision</dt><dd>ARRONDI {data.safety.contractRoundingMode.toUpperCase()} · R{data.safety.sizingPolicyRevision}</dd></div>
        </dl>
      </Card>
      <Card className="execution-lock-panel">
        <header><div><p className="eyebrow">Sécurité par défaut</p><h2>Verrous actifs</h2></div><span>{data.locks.length}</span></header>
        {!data.locks.length ? <p className="empty-copy">Aucun verrou en base. Les protections de configuration restent indépendantes.</p> : <ul>{data.locks.map(lock => <li key={lock.execution_lock_id}><strong>{lock.scope_type}:{lock.scope_value}</strong><span>{lock.reason}</span><small>{lock.set_by} · {formatDateTime(lock.set_at)}</small></li>)}</ul>}
      </Card>
    </div>

    <DecisionLedger decisions={data.decisions} busy={mutation.isPending} onMaterialize={() => mutation.mutate({ action: "materialize" })} onEvaluate={(decision) => mutation.mutate({ action: "evaluate", decisionId: decision.trade_decision_id })}/>
    <IntentLedger intents={data.intents} executionMode={data.safety.executionAuthorityMode} onAction={(kind, intent) => setPending({ kind, intent })}/>
    <ManagementLedger intents={data.managementIntents} busy={mutation.isPending} onMaterialize={() => mutation.mutate({ action: "materialize_management" })} onAction={(kind, intent) => setPending({ kind, intent })}/>

    <div className="execution-console-grid">
      <Card className="execution-ledger-card"><header><div><p className="eyebrow">Registre des ordres</p><h2>Ordres NinjaTrader</h2></div><span>{data.orders.length}</span></header>{!data.orders.length ? <Empty code="NO_BROKER_ORDER" text="Aucun ordre n’a été soumis à NinjaTrader."/> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Référence</th><th>État</th><th>Type</th><th>Qté</th><th>Mise à jour</th></tr></thead><tbody>{data.orders.map(order => <tr key={order.broker_order_id}><td data-label="Référence"><strong>{order.broker_order_ref || order.broker_order_id}</strong></td><td data-label="État"><StatusTag status={order.status}/></td><td data-label="Type">{order.side} · {order.order_type}</td><td data-label="Qté">{order.quantity}</td><td data-label="Mise à jour">{formatDateTime(order.updated_at)}</td></tr>)}</tbody></table></div>}</Card>
      <Card className="execution-ledger-card"><header><div><p className="eyebrow">Comparaison ATI / AddOn</p><h2>Cohérence des connecteurs</h2></div><span>{data.adapterParityRuns.length}</span></header>{!latestParity ? <Empty code="PARITY_WAITING" text="Le premier relevé AddOn sera comparé au dernier relevé ATI disponible."/> : <div className="execution-parity-summary"><StatusTag status={latestParity.status}/><strong>{latestParity.status === "incomplete" ? "Relevé ATI requis" : `${latestParity.mismatch_count} écart(s)`}</strong><small>{latestParity.left_adapter.toUpperCase()} → {latestParity.right_adapter.toUpperCase()} · {formatDateTime(latestParity.compared_at)}</small><span>{data.summary.addonSnapshots} relevés · {data.summary.addonEvents} événements</span></div>}</Card>
    </div>

    <Card className="execution-ledger-card"><header><div><p className="eyebrow">Contrôle base / NinjaTrader</p><h2>Réconciliations</h2></div><span>{data.reconciliations.length}</span></header>{!data.reconciliations.length ? <Empty code="NO_RECONCILIATION" text="Aucune réconciliation nécessaire pour le moment."/> : <ol className="execution-reconciliation-list">{data.reconciliations.map(run => <li key={run.reconciliation_run_id}><StatusTag status={run.status}/><strong>{run.mismatch_count} écart(s)</strong><time>{formatDateTime(run.completed_at || run.started_at)}</time></li>)}</ol>}</Card>

    <Modal open={Boolean(pending)} title={pending?.kind === "approve" ? "Approuver l’intention Sim101" : pending?.kind === "approve_management" ? "Approuver la gestion de position" : pending?.kind === "reject" || pending?.kind === "reject_management" ? "Refuser l’intention" : pending?.kind === "sizing" ? "Configurer le risque et le capital de secours" : pending?.kind === "execution_mode" ? "Choisir le mode d’exécution Sim101" : pending?.kind === "startup" ? "Configurer le redémarrage NinjaTrader" : pending?.locked ? "Engager le kill switch" : "Préparer le déverrouillage Sim101"} onClose={() => !mutation.isPending && setPending(null)}>
      {pending && <ConfirmActionForm target={selectedTarget} revision={pending.kind === "sizing" || pending.kind === "execution_mode" ? pending.policy.revision : pending.kind === "startup" ? pending.revision : pending.kind === "approve_management" || pending.kind === "reject_management" ? pending.intent.expected_trade_revision : 0} expectedPhrase={expectedPhrase} confirmLabel={pending.kind === "approve" || pending.kind === "approve_management" ? "Approuver" : pending.kind === "reject" || pending.kind === "reject_management" ? "Refuser" : pending.kind === "sizing" ? "Enregistrer la policy" : pending.kind === "execution_mode" ? `Activer ${pending.mode === "auto" ? "AUTO" : "SEMI-AUTO"}` : pending.kind === "startup" ? pending.enabled ? "Activer le redémarrage" : "Désactiver le redémarrage" : pending.locked ? "Verrouiller" : "Déverrouiller en base"} validateExtra={() => pending.kind !== "sizing" || validSizingDraft(sizingDraft)} onCancel={() => setPending(null)} onConfirm={({ reason }) => {
        if (pending.kind === "approve") return mutation.mutateAsync({ action: "approve", intentId: pending.intent.order_intent_id, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_SIM101_ORDER", reason }).then(() => undefined);
        if (pending.kind === "reject") return mutation.mutateAsync({ action: "reject", intentId: pending.intent.order_intent_id, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_REJECT", reason }).then(() => undefined);
        if (pending.kind === "approve_management") return mutation.mutateAsync({ action: "approve_management", managementIntentId: pending.intent.management_intent_id, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_SIM101_MANAGEMENT", reason }).then(() => undefined);
        if (pending.kind === "reject_management") return mutation.mutateAsync({ action: "reject_management", managementIntentId: pending.intent.management_intent_id, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_REJECT", reason }).then(() => undefined);
        if (pending.kind === "sizing") return mutation.mutateAsync({ action: "configure_sizing", policyProfileId: pending.policy.policy_profile_id, expectedRevision: pending.policy.revision, riskPercent: sizingDraft.riskPercent, maxRoundingExcessPercent: sizingDraft.maxRoundingExcessPercent, maxDecisionAgeSeconds: sizingDraft.maxDecisionAgeSeconds, fallbackCapitalEnabled: sizingDraft.fallbackCapitalEnabled, fallbackCapital: sizingDraft.fallbackCapital, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY", reason }).then(() => undefined);
        if (pending.kind === "execution_mode") return mutation.mutateAsync({ action: "configure_execution_mode", policyProfileId: pending.policy.policy_profile_id, expectedRevision: pending.policy.revision, mode: pending.mode, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_SIM101_EXECUTION_MODE", reason }).then(() => undefined);
        if (pending.kind === "startup") return mutation.mutateAsync({ action: "configure_ninjatrader_startup", enabled: pending.enabled, expectedRevision: pending.revision, idempotencyKey: crypto.randomUUID(), confirmationPhrase: "CONFIRM_NINJATRADER_AUTOSTART", reason }).then(() => undefined);
        return mutation.mutateAsync({ action: "kill_switch", locked: pending.locked, confirmationPhrase: pending.locked ? "ENGAGE_KILL_SWITCH" : "RELEASE_SIM101_KILL_SWITCH", reason }).then(() => undefined);
      }}>
        {pending.kind === "sizing" && <div className="sizing-policy-form">
          <label>Risque par position (%)<input type="number" inputMode="decimal" min="0.01" max="0.25" step="0.01" value={sizingDraft.riskPercent} onChange={event => setSizingDraft(value => ({ ...value, riskPercent: Number(event.target.value) }))}/><small>Garde-fou V5 : entre 0,01 % et 0,25 % de l’equity net. RR minimum : 2.</small></label>
          <label>Tolérance d’arrondi (%)<input type="number" inputMode="decimal" min="0" max="0.25" step="0.01" value={sizingDraft.maxRoundingExcessPercent} onChange={event => setSizingDraft(value => ({ ...value, maxRoundingExcessPercent: Number(event.target.value) }))}/><small>Excédent maximal de risque dû à l’arrondi au contrat entier supérieur. Au-delà, l’ordre est bloqué.</small></label>
          <label>Fraîcheur maximale avant ordre (s)<input type="number" inputMode="numeric" min="5" max="3600" step="5" value={sizingDraft.maxDecisionAgeSeconds} onChange={event => setSizingDraft(value => ({ ...value, maxDecisionAgeSeconds: Number(event.target.value) }))}/><small>Par défaut 120 s. Un rattrapage plus ancien reste audité en paper, sans être envoyé à NinjaTrader.</small></label>
          <label className="sizing-policy-toggle"><input type="checkbox" checked={sizingDraft.fallbackCapitalEnabled} onChange={event => setSizingDraft(value => ({ ...value, fallbackCapitalEnabled: event.target.checked }))}/><span>Autoriser le capital net de secours</span></label>
          <label>Capital net de secours (USD)<input type="number" inputMode="decimal" min="100" max="100000000" step="100" disabled={!sizingDraft.fallbackCapitalEnabled} value={sizingDraft.fallbackCapital} onChange={event => setSizingDraft(value => ({ ...value, fallbackCapital: Number(event.target.value) }))}/><small>N’est utilisé que si le snapshot NinjaTrader est absent ou périmé.</small></label>
        </div>}
      </ConfirmActionForm>}
    </Modal>
  </section>;
}

function DecisionLedger({ decisions, busy, onMaterialize, onEvaluate }: { decisions: TradeDecision[]; busy: boolean; onMaterialize: () => void; onEvaluate: (decision: TradeDecision) => void }) {
  return <Card className="execution-ledger-card"><header><div><p className="eyebrow">Simulation vers décision</p><h2>Décisions candidates</h2></div><button className="secondary-btn" disabled={busy} onClick={onMaterialize}><Icon name="refresh" size={14}/>Récupérer les positions simulées</button></header>{!decisions.length ? <Empty code="NO_TRADE_DECISION" text="Aucune position simulée LIVE éligible. La stratégie V5 continue normalement."/> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Décision</th><th>Instrument</th><th>Plan</th><th>Source</th><th>État</th><th>Action</th></tr></thead><tbody>{decisions.map(decision => <tr key={decision.trade_decision_id}><td data-label="Décision"><strong>{decision.trade_decision_id}</strong><small>{decision.strategy_id} · {decision.session}</small></td><td data-label="Instrument"><strong>{decision.instrument_code}</strong><small>{decision.side}</small></td><td data-label="Plan"><strong>{String(decision.entry_plan.entry_price ?? "—")}</strong><small>SL {String(decision.risk_plan.stop_price ?? "—")} · TP {String(decision.risk_plan.target_price ?? "—")} · lots calculés selon les règles actives</small></td><td data-label="Source"><strong>{decision.source_document_id}</strong><small>{formatDateTime(decision.decided_at)}</small></td><td data-label="État"><StatusTag status={decision.status}/></td><td data-label="Action"><button className="secondary-btn" onClick={() => onEvaluate(decision)} disabled={busy || decision.status === "validated"}>Calculer les lots</button></td></tr>)}</tbody></table></div>}</Card>;
}

function IntentLedger({ intents, executionMode, onAction }: { intents: OrderIntent[]; executionMode: "semi_auto" | "auto"; onAction: (kind: "approve" | "reject", intent: OrderIntent) => void }) {
  return <Card className="execution-ledger-card"><header><div><p className="eyebrow">File de validation</p><h2>Intentions d’ordre</h2></div><span>{executionMode === "auto" ? "Mode automatique" : "Validation humaine"}</span></header>{!intents.length ? <Empty code="NO_ORDER_INTENT" text="Aucune intention : les contrôles de risque bloquent toute configuration incomplète."/> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Intention</th><th>Contrat</th><th>Ordre</th><th>État</th><th>Expire</th><th>Actions</th></tr></thead><tbody>{intents.map(intent => { const sizing = intent.raw?.position_sizing; return <tr key={intent.order_intent_id}><td data-label="Intention"><strong>{intent.order_intent_id}</strong><small>{intent.trade_decision_id}</small></td><td data-label="Contrat"><strong>{intent.broker_symbol || intent.instrument_code}</strong><small>{intent.strategy_id} · {intent.session}</small></td><td data-label="Ordre"><strong>{intent.side.toUpperCase()} {intent.quantity} contrat(s)</strong><small>{sizing ? `${formatUsd(sizing.actual_risk)} · ${sizing.actual_risk_percent.toFixed(3)} % · brut ${sizing.raw_contracts}` : `${intent.order_type} · ${intent.limit_price ?? "MKT"}`}</small></td><td data-label="État"><StatusTag status={intent.status}/><small>{intent.approval_status}</small></td><td data-label="Expire">{formatDateTime(intent.expires_at)}</td><td data-label="Actions"><div className="execution-row-actions"><button className="primary-btn" onClick={() => onAction("approve", intent)} disabled={intent.status !== "pending_approval"}>Approuver</button><button className="danger-btn" onClick={() => onAction("reject", intent)} disabled={!['pending_approval','approved','queued'].includes(intent.status)}>Refuser</button></div></td></tr>; })}</tbody></table></div>}</Card>;
}

function ManagementLedger({ intents, busy, onMaterialize, onAction }: { intents: BrokerManagementIntent[]; busy: boolean; onMaterialize: () => void; onAction: (kind: "approve_management" | "reject_management", intent: BrokerManagementIntent) => void }) {
  return <Card className="execution-ledger-card"><header><div><p className="eyebrow">Suivi vers exécution</p><h2>Gestion continue des positions</h2></div><button className="secondary-btn" disabled={busy} onClick={onMaterialize}><Icon name="refresh" size={14}/>Synchroniser les suivis</button></header>{!intents.length ? <Empty code="NO_MANAGEMENT_INTENT" text="Aucune action de suivi applicable à une position ouverte."/> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Action</th><th>Position</th><th>Instruction</th><th>Source</th><th>État</th><th>Actions</th></tr></thead><tbody>{intents.map(intent => <tr key={intent.management_intent_id}><td data-label="Action"><strong>{managementLabel(intent.action)}</strong><small>{intent.management_intent_id}</small></td><td data-label="Position"><strong>{intent.broker_symbol || intent.instrument_code} · {intent.trade_side}</strong><small>{intent.quantity_open} contrat(s) · trade R{intent.trade_revision}</small></td><td data-label="Instruction"><strong>{intent.requested_stop_price !== null ? `Stop ${intent.requested_stop_price}` : `${intent.requested_quantity || "—"} contrat(s)`}</strong><small>{intent.reason}</small></td><td data-label="Source"><strong>{intent.source_action}</strong><small>{intent.source_document_id}</small></td><td data-label="État"><StatusTag status={intent.status}/><small>{intent.guard_evidence?.violations?.map(item => item.code).join(", ") || intent.approval_status}</small></td><td data-label="Actions"><div className="execution-row-actions"><button className="primary-btn" disabled={busy || intent.status !== "pending_approval"} onClick={() => onAction("approve_management", intent)}>Approuver</button><button className="danger-btn" disabled={busy || !["pending_approval","approved","queued"].includes(intent.status)} onClick={() => onAction("reject_management", intent)}>Refuser</button></div></td></tr>)}</tbody></table></div>}</Card>;
}

function managementLabel(action: BrokerManagementIntent["action"]) { return ({ move_stop: "Stop à break-even", reduce_position: "Réduction", close_position: "Fermeture" })[action]; }

function demoPaperLaunchBlockers(data: ExecutionOverview, addonBridge?: BrokerBridge) {
  const blockers: string[] = [];
  if (!data.safety.executionEnabled) blockers.push("Broker execution désactivé");
  if (data.safety.bridgeMode !== "sim101_addon_approved_only") blockers.push(`Bridge mode ${data.safety.bridgeMode}`);
  if (data.safety.killSwitchEnv || data.safety.databaseLocked) blockers.push("Kill switch actif");
  if (data.safety.maxContracts <= 0) blockers.push("Max contrats non armé");
  if (data.safety.liveAccountAllowed) blockers.push("Compte live autorisé — interdit en démo");
  if (!data.safety.submissionPossible) blockers.push("Soumission broker fail-closed");
  if (data.safety.executionAuthorityMode !== "auto") blockers.push("Mode AUTO non activé");
  if (data.safety.entryOperatorApprovalRequired) blockers.push("Validation opérateur encore requise");
  if (!data.ninjaTraderStartup.processRunning) blockers.push("NinjaTrader arrêté");
  if (data.ninjaTraderStartup.loginRequired) blockers.push("Login NinjaTrader requis");
  if (!data.ninjaTraderStartup.connectionReady) blockers.push("Connexion Simulation/Sim101 non prête");
  if (!data.ninjaTraderStartup.addonHeartbeatFresh) blockers.push("Heartbeat AddOn non frais");
  if (!addonBridge) {
    blockers.push("AddOn DeskExecution absent");
  } else {
    if (addonBridge.status !== "armed") blockers.push(`AddOn ${addonBridge.status}`);
    if (!addonBridge.command_enabled) blockers.push("Commandes AddOn désactivées");
    if (!isSim101Account(addonBridge.account_name)) blockers.push(`Compte ${addonBridge.account_name || "inconnu"} ≠ Sim101`);
  }
  return Array.from(new Set(blockers));
}

function isSim101Account(accountName: string | null | undefined) {
  return /^Sim\d*$/i.test(String(accountName || "").trim());
}

function Empty({ code: _code, text }: { code: string; text: string }) { return <div className="terminal-empty-state terminal-empty-state--human"><span>{text}</span></div>; }
function brokerCapital(snapshot: { cash_value: number | null; payload: Record<string, unknown> } | undefined) {
  if (!snapshot) return null;
  for (const value of [snapshot.payload.net_liquidation_value, snapshot.payload.net_liquidation, snapshot.payload.NetLiquidation, snapshot.cash_value]) {
    const parsed = Number(value);
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
function isFreshAccountSnapshot(snapshot: { captured_at: string } | undefined, generatedAt: string, maxAgeSeconds: number) {
  const capturedAt = Date.parse(snapshot?.captured_at || "");
  const reference = Date.parse(generatedAt);
  return Number.isFinite(capturedAt) && Number.isFinite(reference) && reference >= capturedAt && reference - capturedAt <= maxAgeSeconds * 1000;
}
function formatUsd(value: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function validSizingDraft(value: SizingDraft) {
  return Number.isFinite(value.riskPercent) && value.riskPercent >= 0.01 && value.riskPercent <= 0.25
    && Number.isFinite(value.maxRoundingExcessPercent) && value.maxRoundingExcessPercent >= 0 && value.maxRoundingExcessPercent <= 0.25
    && Number.isInteger(value.maxDecisionAgeSeconds) && value.maxDecisionAgeSeconds >= 5 && value.maxDecisionAgeSeconds <= 3_600
    && Number.isFinite(value.fallbackCapital) && value.fallbackCapital >= 100 && value.fallbackCapital <= 100_000_000;
}
