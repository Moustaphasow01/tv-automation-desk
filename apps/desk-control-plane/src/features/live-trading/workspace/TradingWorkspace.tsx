import { useCallback, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import type { ViewMeta } from "@/shared/contracts";
import { isFocusDashboardContract } from "@/domains/front-api/focusDashboardContract";
import type { LiveTradingModel } from "../model";
import type { LiveFocusDashboardPeriod } from "../focusDashboardModel";
import type { FocusQueueItem } from "../focusJournalModel";
import { tradePlanOverlayFromTheoretical } from "../chart/tradePlanOverlay";
import { MarketBoard } from "./MarketBoard";
import { TicketBlotter } from "./TicketBlotter";
import { TicketInspector } from "./TicketInspector";
import { WorkspaceChrome, CommandReceipt } from "./WorkspaceChrome";
import { WorkspaceReview, SessionBrief } from "./WorkspaceReview";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { readOnlyReason } from "./commandPolicy";
import { useWorkspaceCommand } from "./useWorkspaceCommand";
import { selectWorkspaceTicket, workspaceTickets, type WorkspacePanel } from "./workspaceModel";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { useWorkspacePreferences } from "./useWorkspacePreferences";
import { workspacePreferenceKey } from "./workspacePreferences";
import { useWorkspaceFilter } from "./useWorkspaceFilter";
import { strategyTitle } from "./workspaceSources";
import { chartEvents } from "./chartAnnotations";
import { WorkspaceNow, WorkspaceSources } from "./WorkspaceNow";
import { WorkspaceTracking } from "./WorkspaceTracking";
import { WorkspaceJournal } from "./WorkspaceJournal";
import { WorkspaceAlerts } from "./WorkspaceAlerts";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { useWorkspaceAlerts, useWorkspaceAlertSound } from "./useWorkspaceAlerts";
import { useFrontView } from "@/domains/front-api/repositories";
import { WorkspaceSafetyNotice } from "./WorkspaceSafetyNotice";
import { useWorkspaceViewport } from "./useWorkspaceViewport";
import { useTicketPriority } from "./useTicketPriority";
import { TicketPriorityBar } from "./TicketPriorityBar";
import { useObservedMarketCatalog } from "./useObservedMarketCatalog";
import "./workspace.tokens.css";
import "./workspace.css";
import "./workspace.extensions.css";
import "./workspace.mobile.css";

type Props = {
  model: LiveTradingModel; focus: LiveFocusView; focusMeta: ViewMeta; projectionError: boolean; refreshing: boolean;
  dashboardPeriod: LiveFocusDashboardPeriod; onExit(): void;
  onScopeChange(scope: { instrument?: string; timeframe?: string }): void;
  onDashboardPeriodChange(period: LiveFocusDashboardPeriod): void;
};

export default function TradingWorkspace(props: Props) {
  const { session } = useOperatorSession();
  return <WorkspaceSession key={workspacePreferenceKey(session) ?? "anonymous"} {...props} />;
}

function WorkspaceSession(props: Props) {
  const state = useWorkspaceState(props);
  const settings = useWorkspacePreferences();
  const [dialog, setDialog] = useState<"brief" | "sources" | "alerts" | "settings" | null>(null);
  const { model, focus } = props;
  const observedMarkets = useObservedMarketCatalog(model.marketSeries);
  const health = { connected: state.realtime?.connectionStatus === "OPEN" && !state.realtime.resyncing, paused: state.paused.length > 0, failed: props.projectionError, meta: props.focusMeta };
  const readOnly = readOnlyReason(health, state.realtime?.now.getTime() ?? Date.now());
  const command = useWorkspaceCommand(health, state.selected?.key ?? null, state.refresh);
  const suspended = state.inspect || command.busy || dialog !== null || state.panel !== "markets" || state.paused.length > 0;
  const priorityAvailable = !readOnlyReason({ ...health, paused: false }, state.realtime?.now.getTime() ?? Date.now());
  const priority = useTicketPriority({ tickets: state.tickets, now: state.realtime?.now.getTime() ?? Date.now(), available: priorityAvailable,
    suspended, automatic: settings.preferences.followTickets, supported: model.marketSeries.supportedInstruments, instrument: state.instrument, onFocus: state.focusTicket });
  const notifications = useWorkspaceAlerts(state.tickets, state.realtime?.now.getTime() ?? Date.now());
  const sound = useWorkspaceAlertSound(notifications.unread, settings.preferences.sound);
  const theoretical = model.selectedTheoreticalExecution;
  const preferred = useMemo(() => (isFocusDashboardContract(focus.dashboard) ? focus.dashboard.scope.instruments : [...new Set(focus.tradeCards.map((card) => card.instrument))]).filter((symbol) => model.marketSeries.supportedInstruments.includes(symbol)), [focus, model.marketSeries.supportedInstruments]);
  const overlay = useMemo(() => state.selected && !state.selected.terminal && theoretical?.portfolioOrderIntentId === state.selected.card?.orderIntentId ? tradePlanOverlayFromTheoretical(theoretical) : null, [state.selected, theoretical]);
  const events = useMemo(() => chartEvents(focus, state.selected, model.theoreticalExecution?.rows ?? []), [focus, state.selected, model.theoreticalExecution]);
  const openTicket = (item: FocusQueueItem) => { setDialog(null); state.setPanel("tickets"); state.select(item); };
  const inspector = <TicketInspector item={state.selected} model={model} embedded={state.mobile} readOnly={readOnly} command={command} onClose={state.deselect} onShowMarket={(instrument) => { props.onScopeChange({ instrument }); state.setPanel("markets"); state.setInspect(false); }} />;
  return <div className="trading-workspace" data-testid="trading-workspace" data-panel={state.panel} data-mobile={state.mobile} data-density={settings.preferences.density} style={{ "--tw-inspector-width": settings.preferences.inspectorWidth + "px" } as CSSProperties}>
    <WorkspaceChrome focus={focus} realtime={state.realtime} panel={state.panel} decisionCount={state.tickets.filter((item) => item.actionable).length} alertCount={notifications.unread} readOnly={readOnly} refreshing={props.refreshing} onExit={props.onExit} onLegacy={state.legacy} onRefresh={state.refresh} onPanel={state.setPanel} onBrief={() => setDialog("brief")} onAlerts={() => setDialog("alerts")} onSettings={() => setDialog("settings")} />
    <WorkspaceSafetyNotice model={model} />
    <WorkspaceNow focus={focus} model={model} tickets={state.tickets} realtime={state.realtime} compact={state.mobile} onSelect={openTicket} onSources={() => setDialog("sources")} />
    <CommandReceipt command={command} />
    <TicketPriorityBar priority={priority} automatic={settings.preferences.followTickets} suspended={suspended} available={priorityAvailable} selected={state.selected} onAutomatic={() => settings.update({ followTickets: !settings.preferences.followTickets })} onInspect={state.select} onReturn={(instrument) => props.onScopeChange({ instrument })} />
    {state.panel === "review" ? <WorkspaceReview focus={focus} period={props.dashboardPeriod} onPeriodChange={props.onDashboardPeriodChange}><WorkspaceJournal items={state.tickets} model={model} onSelect={openTicket} /></WorkspaceReview> : null}
    <div className="tw-workspace-grid" hidden={state.panel === "review"} data-has-ticket={Boolean(state.selected)}>
      <div className="tw-workspace-main">
        <div className="tw-market-region" hidden={state.panel === "tracking"}><MarketBoard model={model} catalog={observedMarkets} preferred={preferred} instrument={state.instrument} timeframe={state.timeframe} overlay={overlay} settings={settings} events={events} pausedSlots={state.paused} onScopeChange={props.onScopeChange} onPauseChange={state.onPauseChange} /></div>
        {state.panel === "tracking" ? <WorkspaceTracking items={state.tickets} model={model} onSelect={openTicket} /> : null}
        <div className="tw-ticket-region" hidden={state.panel === "tracking"}><TicketBlotter items={state.tickets} selectedId={state.selected?.key ?? null} onSelect={state.select} /></div>
      </div>
      {!state.mobile && state.selected ? inspector : null}
    </div>
    <footer className="tw-footer"><span>Poste de séance · nouvelle version</span><span>Données du desk · prix, décisions et exécutions restent distincts</span></footer>
    {dialog ? <WorkspaceDialog title={{ brief: "Lecture de la séance", sources: "État des données et calendrier", alerts: "Alertes de séance", settings: "Configurer mon poste" }[dialog]} onClose={() => setDialog(null)}>
      {dialog === "brief" ? <SessionBrief focus={focus} /> : dialog === "sources" ? <WorkspaceSources focus={focus} model={model} realtime={state.realtime} /> : dialog === "settings" ? <WorkspaceSettings settings={settings} sound={sound} /> : <WorkspaceAlerts alerts={notifications.alerts} tickets={state.tickets} model={model} readOnly={readOnly} onRead={notifications.markRead} onSelect={openTicket} />}
    </WorkspaceDialog> : null}
    {state.mobile && state.inspect && state.selected ? <WorkspaceDialog title={`${state.selected.instrument} · ticket`} onClose={() => state.setInspect(false)}>{inspector}</WorkspaceDialog> : null}
  </div>;
}

function useWorkspaceState(props: Props) {
  const [search, setSearch] = useSearchParams();
  const realtime = useContext(RealtimeContext);
  const client = useQueryClient();
  const strategyCatalog = useFrontView("strategy-center", undefined, { refetchInterval: 300_000 });
  const mobile = useWorkspaceDocument();
  const [panelValue, setPanelValue] = useWorkspaceFilter("panel", "markets", ["markets", "tickets", "tracking", "review"]);
  const panel = panelValue as WorkspacePanel;
  const setPanel = (value: WorkspacePanel) => setPanelValue(value);
  const [inspect, setInspect] = useState(() => Boolean(search.get("ticketId") && search.get("ticketId") !== "none"));
  const [paused, setPaused] = useState<string[]>([]);
  const tickets = useMemo(() => workspaceTickets(props.focus).map((item) => {
    const title = strategyTitle(item, props.model.strategyInstances, strategyCatalog.data?.meta.availability === "AVAILABLE" && !strategyCatalog.data.meta.stale ? strategyCatalog.data.data.strategies : []);
    return { ...item, title, searchText: item.searchText + " " + title };
  }), [props.focus, props.model.strategyInstances, strategyCatalog.data]);
  const selected = selectWorkspaceTicket(tickets, search.get("ticketId"));
  const series = props.model.marketSeries;
  const instrument = search.get("instrument") || series.instrument || series.supportedInstruments[0] || "";
  const timeframe = search.get("timeframe") || series.timeframe || series.supportedTimeframes[0] || "5";
  const refresh = useCallback(() => { void client.invalidateQueries({ predicate: (query) => ["front-view", "front-view-scope"].includes(String(query.queryKey[0])) && ["live-focus", "live-trading", "order-detail"].includes(String(query.queryKey[1])) }); }, [client]);
  const onPauseChange = useCallback((symbol: string, frozen: boolean) => setPaused((current) => {
    if (current.includes(symbol) === frozen) return current;
    return frozen ? [...current, symbol] : current.filter((value) => value !== symbol);
  }), []);
  const select = (item: FocusQueueItem) => {
    setSearch((current) => { const next = new URLSearchParams(current); next.set("ticketId", item.key); if (item.signalId) next.set("signalId", item.signalId); else next.delete("signalId"); return next; }, { replace: true });
    setInspect(true);
  };
  const focusTicket = useCallback((item: FocusQueueItem) => {
    setSearch((current) => {
      const next = new URLSearchParams(current);
      next.set("ticketId", item.key); next.set("instrument", item.instrument); next.set("panel", "markets"); next.delete("chartAt");
      if (item.signalId) next.set("signalId", item.signalId); else next.delete("signalId");
      return next;
    }, { replace: true });
  }, [setSearch]);
  const deselect = () => { setSearch((current) => { const next = new URLSearchParams(current); next.set("ticketId", "none"); next.delete("signalId"); return next; }, { replace: true }); setInspect(false); };
  const legacy = () => { setSearch((current) => { const next = new URLSearchParams(current); next.set("workspace", "classic"); next.delete("ticketId"); return next; }, { replace: true }); };
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector("dialog[open]") || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]"))) return;
      const target = ({ "1": "markets", "2": "tickets", "3": "tracking", "4": "review" } as const)[event.key as "1"];
      if (target) { event.preventDefault(); setPanelValue(target); }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [setPanelValue]);
  useEffect(() => {
    if (search.has("ticketId") || !selected) return;
    setSearch((current) => { const next = new URLSearchParams(current); next.set("ticketId", selected.key); if (selected.signalId) next.set("signalId", selected.signalId); return next; }, { replace: true });
  }, [search, selected, setSearch]);
  return { realtime, mobile, panel, setPanel, inspect, setInspect, paused, tickets, selected, instrument, timeframe, refresh, onPauseChange, select, focusTicket, deselect, legacy };
}

function useWorkspaceDocument() {
  const mobile = useWorkspaceViewport();
  useEffect(() => {
    document.documentElement.classList.add("tw-document"); document.body.classList.add("tw-document");
    return () => { document.documentElement.classList.remove("tw-document"); document.body.classList.remove("tw-document"); };
  }, []);
  return mobile;
}
