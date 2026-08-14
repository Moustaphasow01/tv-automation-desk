import type {
  PortfolioRiskAccount,
  PortfolioRiskAction,
  PortfolioRiskControl,
  PortfolioRiskExposure,
  PortfolioRiskOrderIntent,
  PortfolioRiskOverview,
  PortfolioRiskReconciliation,
  PortfolioRiskStrategyConcentration,
} from "@/features/portfolio-risk/types";

export type PortfolioRiskTone = "neutral" | "positive" | "warning" | "critical" | "info";

export interface PortfolioRiskMetric {
  label: string;
  value: string | number;
  detail?: string;
  tone?: PortfolioRiskTone;
}

export interface PortfolioRiskViewModel {
  generatedAt: string;
  health: { label: string; tone: PortfolioRiskTone; detail: string };
  sourceLabel: string;
  sourceDetail: string;
  metrics: PortfolioRiskMetric[];
  accounts: PortfolioRiskAccountRow[];
  exposures: PortfolioRiskExposureRow[];
  controls: PortfolioRiskControlRow[];
  strategyRows: PortfolioRiskStrategyRow[];
  intentRows: PortfolioRiskIntentRow[];
  reconciliationRows: PortfolioRiskReconciliationRow[];
  actions: PortfolioRiskActionRow[];
  sections: PortfolioRiskSection[];
  warnings: string[];
}

export interface PortfolioRiskAccountRow {
  key: string;
  label: string;
  mode: string;
  status: string;
  tone: PortfolioRiskTone;
  capital: string;
  risk: string;
  controls: string;
  updated: string;
}

export interface PortfolioRiskExposureRow {
  key: string;
  instrument: string;
  account: string;
  status: string;
  tone: PortfolioRiskTone;
  net: string;
  pending: string;
  detail: string;
}

export interface PortfolioRiskControlRow {
  key: string;
  severity: string;
  tone: PortfolioRiskTone;
  label: string;
  code: string;
  detail: string;
}

export interface PortfolioRiskStrategyRow {
  key: string;
  instrument: string;
  mode: string;
  status: string;
  tone: PortfolioRiskTone;
  detail: string;
}

export interface PortfolioRiskIntentRow {
  key: string;
  instrument: string;
  account: string;
  status: string;
  side: string;
  quantity: string;
  expires: string;
}

export interface PortfolioRiskReconciliationRow {
  key: string;
  account: string;
  status: string;
  tone: PortfolioRiskTone;
  mismatches: number;
  completed: string;
}

export interface PortfolioRiskActionRow {
  key: string;
  label: string;
  status: string;
  href: string | null;
  enabled: boolean;
  reason: string;
}

export interface PortfolioRiskSection {
  id: "accounts" | "exposures" | "controls" | "strategy" | "intents" | "reconciliation";
  title: string;
  count: number;
  tone: PortfolioRiskTone;
  href: string;
  summary: string;
}

export function buildPortfolioRiskViewModel(data: PortfolioRiskOverview): PortfolioRiskViewModel {
  const accounts = data.accounts.map(accountRow);
  const exposures = data.exposures.map(exposureRow);
  const controls = data.controls.map(controlRow);
  const strategyRows = data.strategy_concentration.map(strategyRow);
  const intentRows = data.order_intents.map(intentRow);
  const reconciliationRows = data.reconciliation.map(reconciliationRow);
  return {
    generatedAt: formatDate(data.generatedAt),
    health: health(data),
    sourceLabel: sourceLabel(data.source.status),
    sourceDetail: sourceDetail(data),
    metrics: metrics(data),
    accounts,
    exposures,
    controls,
    strategyRows,
    intentRows,
    reconciliationRows,
    actions: data.actions.map(actionRow),
    sections: sections({ accounts, exposures, controls, strategyRows, intentRows, reconciliationRows }),
    warnings: warnings(data),
  };
}

export function portfolioRiskSection(view: PortfolioRiskViewModel, sectionId?: string | null) {
  return view.sections.find((section) => section.id === sectionId) || null;
}

function health(data: PortfolioRiskOverview) {
  const status = data.summary.status;
  const labels: Record<typeof status, string> = {
    CONTROLLED: "Contrôlé",
    ACTION_REQUIRED: "Action requise",
    BROKER_SUBMIT_BLOCKED: "Broker bloqué",
    DATA_UNAVAILABLE: "Source indisponible",
  };
  return {
    label: labels[status] || status,
    tone: status === "CONTROLLED" ? "positive" as const : status === "DATA_UNAVAILABLE" ? "critical" as const : "warning" as const,
    detail: `${data.summary.accounts} compte(s) · ${data.summary.openTrades} position(s) · ${data.summary.pendingIntents} intention(s)`,
  };
}

function sourceLabel(status: PortfolioRiskOverview["source"]["status"]) {
  if (status === "ready") return "POSTGRES + API";
  if (status === "partial") return "Sources partielles";
  return "Sources indisponibles";
}

function sourceDetail(data: PortfolioRiskOverview) {
  return data.source.reads
    .map((read) => `${read.source}:${read.status}${read.error_code ? `/${read.error_code}` : ""}`)
    .join(" · ");
}

function metrics(data: PortfolioRiskOverview): PortfolioRiskMetric[] {
  return [
    { label: "État global", value: health(data).label, detail: data.summary.portfolio_table_status, tone: health(data).tone },
    { label: "Comptes", value: data.summary.accounts, detail: `${data.accounts.filter((item) => item.status === "CONTROLLED").length} contrôlé(s)` },
    { label: "Positions", value: data.summary.openTrades, detail: `${data.summary.activeOrders} ordre(s) actif(s)`, tone: data.summary.openTrades ? "info" : "neutral" },
    { label: "Intentions", value: data.summary.pendingIntents, detail: "à arbitrer / exécuter", tone: data.summary.pendingIntents ? "warning" : "positive" },
    { label: "Divergences", value: data.summary.reconciliationDivergences, detail: `${data.summary.activeLocks} verrou(x)`, tone: data.summary.reconciliationDivergences || data.summary.activeLocks ? "critical" : "positive" },
    { label: "Instances", value: data.summary.liveInstances + data.summary.paperInstances, detail: `${data.summary.paperInstances} paper · ${data.summary.liveInstances} live`, tone: data.summary.liveInstances > 1 ? "warning" : "neutral" },
  ];
}

function accountRow(account: PortfolioRiskAccount): PortfolioRiskAccountRow {
  return {
    key: account.account_id,
    label: account.label || account.account_id,
    mode: account.mode,
    status: account.status,
    tone: accountTone(account.status),
    capital: account.capital === null ? "capital absent" : formatUsd(account.capital),
    risk: account.risk_percent === null ? "risque absent" : `${account.risk_percent.toFixed(2)} % · max ${account.max_contracts ?? "—"}`,
    controls: account.controls.length ? account.controls.join(", ") : "aucun contrôle bloquant",
    updated: formatDate(account.captured_at),
  };
}

function exposureRow(exposure: PortfolioRiskExposure): PortfolioRiskExposureRow {
  return {
    key: exposure.exposure_id,
    instrument: exposure.broker_symbol || exposure.instrument_code,
    account: exposure.account_id,
    status: exposure.status,
    tone: exposureTone(exposure.status),
    net: signed(exposure.net_open_quantity),
    pending: `achat ${exposure.pending_buy_quantity} · vente ${exposure.pending_sell_quantity}`,
    detail: exposure.detail,
  };
}

function controlRow(control: PortfolioRiskControl): PortfolioRiskControlRow {
  return {
    key: control.control_id,
    severity: control.severity,
    tone: control.severity === "critical" ? "critical" : control.severity === "warning" ? "warning" : "info",
    label: control.label,
    code: control.code,
    detail: control.detail,
  };
}

function strategyRow(row: PortfolioRiskStrategyConcentration): PortfolioRiskStrategyRow {
  return {
    key: row.key,
    instrument: row.instrument_code,
    mode: row.execution_mode,
    status: row.status,
    tone: row.status === "REVIEW_SIMILARITY" ? "warning" : "neutral",
    detail: row.detail,
  };
}

function intentRow(intent: PortfolioRiskOrderIntent): PortfolioRiskIntentRow {
  return {
    key: intent.order_intent_id,
    instrument: intent.instrument_code || "instrument à compléter",
    account: intent.account_id || "compte à compléter",
    status: `${intent.status} · ${intent.approval_status}`,
    side: intent.side,
    quantity: intent.quantity === null ? "—" : String(intent.quantity),
    expires: formatDate(intent.expires_at),
  };
}

function reconciliationRow(row: PortfolioRiskReconciliation): PortfolioRiskReconciliationRow {
  return {
    key: row.reconciliation_run_id,
    account: row.account_id || "compte global",
    status: row.status,
    tone: row.status === "diverged" ? "critical" : row.status === "failed" ? "warning" : "positive",
    mismatches: row.mismatch_count,
    completed: formatDate(row.completed_at),
  };
}

function actionRow(action: PortfolioRiskAction): PortfolioRiskActionRow {
  return { key: action.action_id, label: action.label, status: action.status, href: action.href, enabled: action.enabled, reason: action.reason };
}

function sections(input: {
  accounts: unknown[]; exposures: unknown[]; controls: PortfolioRiskControlRow[]; strategyRows: PortfolioRiskStrategyRow[]; intentRows: unknown[]; reconciliationRows: PortfolioRiskReconciliationRow[];
}): PortfolioRiskSection[] {
  return [
    section("accounts", "Comptes & budgets", input.accounts.length, "info", "Capital, politique de risque et droits d’exécution"),
    section("exposures", "Exposition nette", input.exposures.length, "info", "Positions ouvertes, intentions et ordres actifs"),
    section("controls", "Contrôles", input.controls.length, input.controls.some((item) => item.tone === "critical") ? "critical" : "warning", "Verrous, sources et divergences"),
    section("strategy", "Concentration stratégie", input.strategyRows.length, input.strategyRows.some((item) => item.tone === "warning") ? "warning" : "neutral", "Instances par instrument et mode"),
    section("intents", "Intentions d’ordre", input.intentRows.length, "warning", "File provider-neutral avant exécution"),
    section("reconciliation", "Réconciliation broker", input.reconciliationRows.length, input.reconciliationRows.some((item) => item.tone === "critical") ? "critical" : "positive", "Écarts broker/PostgreSQL"),
  ];
}

function section(id: PortfolioRiskSection["id"], title: string, count: number, tone: PortfolioRiskTone, summary: string): PortfolioRiskSection {
  return { id, title, count, tone, summary, href: `/operations/portfolio-risk/${id}` };
}

function warnings(data: PortfolioRiskOverview) {
  return [
    ...(data.source.status !== "ready" ? ["Une ou plusieurs sources ne répondent pas ; la projection reste partielle."] : []),
    ...(data.summary.portfolio_table_status === "execution_projection" ? ["Les tables cibles Portfolio Risk ne sont pas encore le ledger transactionnel ; la vue lit l’exécution réelle disponible."] : []),
    ...(data.summary.liveInstances > 1 ? ["Plusieurs instances LIVE visibles : le verrou ADR-0008 doit rester actif tant que l’arbitrage n’est pas transactionnel."] : []),
  ];
}

function accountTone(status: string): PortfolioRiskTone {
  if (status === "CONTROLLED") return "positive";
  if (status === "CAPITAL_MISSING" || status === "POLICY_DISABLED") return "warning";
  return "neutral";
}

function exposureTone(status: string): PortfolioRiskTone {
  if (status === "CONTRACT_MAPPING_REQUIRED") return "critical";
  if (status === "ORDER_ACTIVE" || status === "INTENT_PENDING") return "warning";
  if (status === "EXPOSED") return "info";
  return "neutral";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(date);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function signed(value: number) {
  if (!value) return "0";
  return value > 0 ? `+${value}` : String(value);
}
