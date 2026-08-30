import { useState, type ReactNode } from "react";
import { Card, StatusBadge } from "@/design-system/primitives";
import { DeskButton, ReasonInput, TrackedCommandReceipt } from "@/design-system/actions";
import { MetricBox } from "@/design-system/workspace";
import { presentDataAbsence } from "@/design-system/labels";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { DataValue } from "@/shared/contracts";
import type {
  AuthorityStage,
  HumanGate,
  HumanGateAction,
  OrderIntentDossier,
  ProviderTimelineEvent,
  ReconciliationComparison,
} from "@/features/order-intent/model";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";

export function ExecutionAuthorityPanel({ dossier }: { dossier: OrderIntentDossier }) {
  return (
    <Card title="Autorité d'exécution" eyebrow="POLITIQUE BACKEND" density="compact" state={dossier.degradedReadOnly ? "degraded" : "readonly"}>
      <div className="order-dossier__authority-pair">
        <DataMetric label="Mode d'exécution" value={dossier.executionMode} />
        <MetricBox label="Environnement" value="Non publié dans ce dossier" />
      </div>
      <p className="order-dossier__helper">Le mode d'exécution et l'environnement sont indépendants. Aucune valeur locale ne remplace la policy backend.</p>
    </Card>
  );
}

export function AuthorityStageCard({ stage }: { stage: AuthorityStage }) {
  return (
    <Card title={stage.label} eyebrow="AUTORITÉ BACKEND" density="compact" state={isKnown(stage.decision) ? "nominal" : "partial"}>
      <div className="order-dossier__authority-pair">
        <DataMetric label="Décision" value={stage.decision} />
        <DataMetric label="Version" value={stage.version} />
      </div>
      <DataValueLine label="Identifiant" value={stage.authorityId} />
      {stage.reasonCodes.length ? (
        <ul className="order-dossier__reason-list" aria-label={`Codes motif ${stage.label}`}>
          {stage.reasonCodes.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : <p className="order-dossier__helper">Aucun reason code publié.</p>}
    </Card>
  );
}

export function ReadonlyTradeTerms({ dossier }: { dossier: OrderIntentDossier }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTicket = async () => {
    try {
      await copyToClipboard(buildOrderTicketText(dossier));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <Card title="Position cible & plan d'exécution" eyebrow="LECTURE SEULE APRÈS RISQUE" density="compact" state="readonly" actions={<DeskButton variant="ghost" onClick={() => void copyTicket()}>{copyState === "copied" ? "Ticket copié" : copyState === "failed" ? "Copie indisponible" : "Copier le ticket"}</DeskButton>}>
      <div className="order-dossier__immutable-banner" role="note">
        Ces termes sont affichés uniquement. Toute modification exige le rejet puis un nouveau cycle Risk backend.
      </div>
      <dl className="order-dossier__terms" aria-label="Termes immuables de l'ordre">
        <ReadonlyTerm label="Instrument" value={dossier.signal.instrument} />
        <ReadonlyTerm label="Sens" value={dossier.signal.side} />
        <ReadonlyTerm label="Compte" value={dossier.targetPosition.account} />
        <ReadonlyTerm label="Quantité autorisée" value={dossier.targetPosition.authorizedQuantity} copyable />
        <ReadonlyTerm label="Type" value={dossier.executionPlan.orderType} />
        <ReadonlyTerm label="TIF" value={dossier.executionPlan.timeInForce} />
        <ReadonlyTerm label="Entrée" value={dossier.executionPlan.entry} format="price" copyable />
        <ReadonlyTerm label="Stop" value={dossier.executionPlan.stop} format="price" copyable />
        {dossier.executionPlan.targets.map((target, index) => <ReadonlyTerm key={index} label={`Cible ${index + 1}`} value={target} format="price" copyable />)}
        <ReadonlyTerm label="R attendu" value={dossier.executionPlan.expectedR} format="r" />
      </dl>
      <div className={`order-dossier__market-context${dossier.marketContext.outsideTradeZone === true ? " is-outside" : ""}`} role={dossier.marketContext.outsideTradeZone === true ? "alert" : "status"}>
        <div>
          <small>Dernier prix connu</small>
          <DataMetric label="Marché" value={dossier.marketContext.lastPrice} />
          <DataValueLine label="Cotation à" value={dossier.marketContext.asOf} />
        </div>
        <div>
          <small>Écart à l'entrée</small>
          <DataMetric label="Points" value={dossier.marketContext.distanceToEntryPoints} />
          <DataMetric label="R" value={dossier.marketContext.distanceToEntryR} />
        </div>
        <p>{marketContextSummary(dossier)}</p>
      </div>
    </Card>
  );
}

export function marketContextSummary(dossier: OrderIntentDossier): string {
  if (!["KNOWN", "STALE"].includes(dossier.marketContext.lastPrice.state)) {
    return "Enveloppe non évaluée : le backend ne publie pas de prix de marché exploitable.";
  }
  if (dossier.marketContext.outsideTradeZone === true) {
    return "Attention : le dernier prix connu se situe hors de la zone entrée–stop–cible.";
  }
  if (dossier.marketContext.outsideTradeZone === false) {
    return "Le dernier prix connu reste dans l’enveloppe du plan évaluée par le backend.";
  }
  return "Position du marché par rapport au plan non publiée par le backend.";
}

export function HumanExecutionGatePanel({
  gate,
  onSubmit,
  submittingActionId,
  command,
  error,
}: {
  gate: HumanGate;
  onSubmit: (action: HumanGateAction, reason: string) => Promise<void>;
  submittingActionId: string | null;
  command: CommandAccepted | null;
  error: string | null;
}) {
  const [pendingAction, setPendingAction] = useState<HumanGateAction | null>(null);
  const [reason, setReason] = useState("");
  const status = valueString(gate.status);
  const presentation = presentBackendStatus(status.raw);
  const confirm = gate.actions.find((action) => action.action === "CONFIRM");
  const reject = gate.actions.find((action) => action.action === "REJECT");
  const undo = gate.actions.find((action) => action.action === "UNDO");

  const requestAction = (action: HumanGateAction) => {
    if (action.permission !== "ALLOWED") return;
    if (action.requiresConfirmation) setPendingAction(action);
    else void onSubmit(action, reason);
  };

  return (
    <Card title="Human Execution Gate" eyebrow="DÉCISION OPÉRATEUR" density="compact" tone={presentation.tone} state={gate.actions.length ? "nominal" : "readonly"}>
      <div className="order-dossier__gate-status">
        <StatusBadge tone={presentation.tone}>{status.available ? presentation.label : "Action indisponible"}</StatusBadge>
        <p>{status.available ? presentation.helper : status.reason}</p>
      </div>
      <div className="order-dossier__gate-rule">
        <strong>Confirmer ≠ exécuter</strong>
        <span>Une confirmation autorise le runtime. ACK, partial fill, fill et réconciliation restent des preuves distinctes.</span>
      </div>

      {gate.actions.some((action) => action.requiresReason) ? <ReasonInput label="Motif opérateur" value={reason} onChange={setReason} /> : null}

      <div className="order-dossier__gate-actions">
        <ActionButton action={undo} fallbackLabel="Annuler la décision" variant="secondary" submittingActionId={submittingActionId} onClick={requestAction} />
        <ActionButton action={reject} fallbackLabel="Rejeter OrderIntent" variant="danger" submittingActionId={submittingActionId} onClick={requestAction} fallbackReason={gate.unavailableReason} />
        <ActionButton action={confirm} fallbackLabel="Confirmer OrderIntent" variant="primary" submittingActionId={submittingActionId} onClick={requestAction} fallbackReason={gate.unavailableReason} />
      </div>

      {pendingAction ? (
        <div className="order-dossier__impact-preview" role="alertdialog" aria-labelledby="human-gate-confirm-title">
          <strong id="human-gate-confirm-title">Confirmer la commande backend</strong>
          <p>{pendingAction.impactPreview || "Aucun impact preview n'a été publié."}</p>
          <small>Révision attendue : {pendingAction.expectedRevision}</small>
          <div className="order-dossier__gate-actions">
            <DeskButton variant="ghost" onClick={() => setPendingAction(null)}>Annuler</DeskButton>
            <DeskButton
              variant={pendingAction.action === "REJECT" ? "danger" : pendingAction.action === "UNDO" ? "secondary" : "primary"}
              disabled={submittingActionId === pendingAction.actionId || (pendingAction.requiresReason && !reason.trim())}
              onClick={() => void onSubmit(pendingAction, reason).then(() => setPendingAction(null))}
            >
              {submittingActionId === pendingAction.actionId ? "Envoi…" : "Confirmer la demande"}
            </DeskButton>
          </div>
        </div>
      ) : null}

      {error ? <p className="order-dossier__command-error" role="alert">{error}</p> : null}
      <TrackedCommandReceipt command={command} />
    </Card>
  );
}

function ActionButton({
  action,
  fallbackLabel,
  variant,
  submittingActionId,
  onClick,
  fallbackReason,
}: {
  action?: HumanGateAction;
  fallbackLabel: string;
  variant: "primary" | "secondary" | "danger";
  submittingActionId: string | null;
  onClick: (action: HumanGateAction) => void;
  fallbackReason?: string;
}) {
  const disabled = !action || action.permission !== "ALLOWED" || submittingActionId === action.actionId;
  const reason = !action ? fallbackReason : action.permission === "STEP_UP_REQUIRED" ? "Step-up backend requis" : action.permission === "DENIED" ? "Action refusée par le backend" : undefined;
  return (
    <span className="order-dossier__action-with-reason">
      <DeskButton variant={variant} disabled={disabled} onClick={() => action && onClick(action)}>
        {action?.label ?? fallbackLabel}
      </DeskButton>
      {reason ? <small>{reason}</small> : null}
    </span>
  );
}

export function ProviderLifecycleTimeline({ events }: { events: readonly ProviderTimelineEvent[] }) {
  if (!events.length) return <p className="empty-state">Aucun événement provider publié. Aucun ACK ou fill n'est supposé.</p>;
  return (
    <ol className="order-dossier__timeline" aria-label="Cycle de vie provider">
      {events.map((event) => {
        const status = presentBackendStatus(event.status);
        return (
          <li key={event.eventId} className="order-dossier__timeline-item">
            <time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time>
            <span className={`order-dossier__timeline-marker order-dossier__timeline-marker--${status.tone}`} aria-hidden="true" />
            <div>
              <span className="order-dossier__timeline-title"><strong>{status.label}</strong><StatusBadge tone={status.tone}>{status.code}</StatusBadge></span>
              <p>{event.details || status.helper}</p>
              <small>{event.source} · {event.actor} · {event.correlationId}</small>
              {!status.known ? <small>Code brut conservé : {event.status}</small> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ReconciliationPanel({ reconciliation }: { reconciliation: ReconciliationComparison }) {
  const statusValue = valueString(reconciliation.status);
  const status = presentBackendStatus(statusValue.raw);
  const hasMismatch = reconciliation.mismatches.length > 0;
  return (
    <Card title="Réconciliation" eyebrow="ATTENDU VS BROKER" density="compact" tone={hasMismatch ? "danger" : status.tone} state={statusValue.available ? "nominal" : "partial"}>
      <div className="order-dossier__reconciliation-heading" role={hasMismatch ? "alert" : undefined}>
        <StatusBadge tone={hasMismatch ? "danger" : status.tone}>{hasMismatch ? "ÉCART DE RÉCONCILIATION" : statusValue.available ? status.label : "NON PUBLIÉE"}</StatusBadge>
        <DataValueLine label="Dernier contrôle" value={reconciliation.checkedAt} />
      </div>
      {reconciliation.expected.length || reconciliation.broker.length ? (
        <div className="order-dossier__comparison">
          <ComparisonColumn title="État attendu" values={reconciliation.expected} />
          <ComparisonColumn title="État broker" values={reconciliation.broker} />
        </div>
      ) : <p className="empty-state">L'état attendu et l'état broker ne sont pas encore publiés pour cet OrderIntent.</p>}
      {hasMismatch ? (
        <ul className="order-dossier__mismatches">
          {reconciliation.mismatches.map((mismatch) => <li key={mismatch.field}><strong>{mismatch.field}</strong><span>{mismatch.expected} → {mismatch.actual}</span><small>{mismatch.reason}</small></li>)}
        </ul>
      ) : null}
    </Card>
  );
}

function ComparisonColumn({ title, values }: { title: string; values: ReconciliationComparison["expected"] }) {
  return <section><h3>{title}</h3>{values.map((item) => <DataValueLine key={item.label} label={item.label} value={item.value} />)}</section>;
}

export function TechnicalInspector({ dossier }: { dossier: OrderIntentDossier }) {
  return (
    <details className="order-dossier__technical">
      <summary>Inspecteur technique</summary>
      <div className="order-dossier__technical-grid">
        {dossier.technical.map((item) => <DataValueLine key={item.label} label={item.label} value={{ state: "KNOWN", value: item.value, asOf: dossier.meta.asOf, source: "projection" }} />)}
      </div>
    </details>
  );
}

export function DataMetric({ label, value }: { label: string; value: DataValue<string | number> }) {
  const display = valueString(value);
  return <MetricBox label={label} value={<span className={display.available ? undefined : "order-dossier__unavailable"}>{display.text}</span>} />;
}

function ReadonlyTerm({ label, value, format, copyable = false }: { label: string; value: DataValue<string | number>; format?: "price" | "r"; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const display = valueString(value, format);
  const copy = async () => {
    if (!display.available) return;
    await copyToClipboard(display.raw);
    setCopied(true);
  };
  return <div><dt>{label}</dt><dd className={display.available ? undefined : "order-dossier__unavailable"}>{copyable && display.available ? <button className="order-dossier__copy-value" type="button" title={`Copier ${label.toLowerCase()}`} onClick={() => void copy()}>{display.text}<span className="sr-only">{copied ? " copié" : ""}</span></button> : display.text}</dd></div>;
}

function DataValueLine({ label, value }: { label: string; value: DataValue<string | number> }) {
  const display = valueString(value);
  return <span className="order-dossier__data-line"><small>{label}</small><strong className={display.available ? undefined : "order-dossier__unavailable"}>{display.text}</strong></span>;
}

function valueString(value: DataValue<string | number>, format?: "price" | "r"): { text: string; raw: string; available: boolean; reason: string } {
  if (value.state === "KNOWN" || value.state === "STALE") {
    const raw = String(value.value);
    const text = typeof value.value === "number"
      ? format === "r" ? `${value.value.toFixed(2)} R` : format === "price" ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value.value) : new Intl.NumberFormat("fr-FR").format(value.value)
      : value.value;
    return { text, raw, available: true, reason: value.state === "STALE" ? value.reason : "" };
  }
  const reason = "reason" in value ? value.reason : "Valeur non publiée par le backend";
  return { text: presentDataAbsence("NOT_PUBLISHED").label, raw: "NOT_PUBLISHED", available: false, reason };
}

function isKnown(value: DataValue<unknown>): boolean {
  return value.state === "KNOWN" || value.state === "STALE";
}

export function buildOrderTicketText(dossier: OrderIntentDossier): string {
  const field = (value: DataValue<string | number>) => valueString(value).available ? valueString(value).raw : "NON PUBLIÉ";
  const targets = dossier.executionPlan.targets.map(field).join(",");
  return [
    field(dossier.signal.instrument),
    field(dossier.signal.side),
    field(dossier.targetPosition.authorizedQuantity),
    `${field(dossier.executionPlan.orderType)} ${field(dossier.executionPlan.entry)}`,
    `STOP ${field(dossier.executionPlan.stop)}`,
    `TARGET ${targets || "NON PUBLIÉ"}`,
    field(dossier.executionPlan.timeInForce),
  ].join(" | ");
}

async function copyToClipboard(value: string): Promise<void> {
  if (!globalThis.navigator?.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
  await globalThis.navigator.clipboard.writeText(value);
}

function formatTimestamp(value: string): ReactNode {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return presentDataAbsence("NOT_PUBLISHED").label;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
