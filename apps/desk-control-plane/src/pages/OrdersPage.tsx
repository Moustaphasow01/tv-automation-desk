import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBan,
  FaBroadcastTower,
  FaCheckCircle,
  FaExchangeAlt,
  FaFingerprint,
  FaHistory,
  FaLayerGroup,
  FaReceipt,
  FaShieldAlt,
  FaStream,
  FaSyncAlt,
  FaTimesCircle
} from "react-icons/fa";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { OrdersView } from "@/domains/front-api/viewModels";

type OrderAction = OrdersView["commandActions"][number];

export function OrdersPage() {
  const query = useFrontView("orders");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : action exécution validée depuis Orders cockpit.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <OrdersLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Ordres indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucun ordre" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/orders`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const confirmAction = async (action: OrderAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildOrdersCommand(action, reason));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "ORDERS_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page orders-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Ordres"
        description={`Order Intents, provider orders, fills et protections · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/live">Trading en direct</Link>
            <Link to="/events">Timeline</Link>
            <Link className="operator-primary-action" to="/execution/providers">Fournisseurs</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Ordres">
        <KpiCard label="INTENTIONS D'ORDRE" value={`${data.summary.orderIntents}`} delta={`${data.orderIntents.length} visibles`} tone="info" />
        <KpiCard label="ORDRES ACTIFS" value={`${data.summary.activeOrders}`} delta={`${data.activeOrders.filter((order) => order.state === "ACKED").length} ACKED`} tone="success" />
        <KpiCard label="FILLS RÉCENTS" value={`${data.summary.recentFills}`} delta={`${formatSignedR(totalSlippage(data.fills))} slip`} tone="success" />
        <KpiCard label="PARTIELS" value={`${data.summary.partialOrders}`} delta="surveillance provider" tone="warning" />
        <KpiCard label="REJETÉS" value={`${data.summary.rejectedOrders}`} delta="DLQ opérable" tone="danger" />
        <KpiCard label="PROTECTION" value={`${data.summary.protectedOrdersPct}%`} delta="protections/trailing" detail={<ProgressBar value={data.summary.protectedOrdersPct} tone="success" />} tone="success" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Intents, ordres actifs et protections">
        <Card title="Intentions d'ordre" actions={<InlineAction>INTENTIONS</InlineAction>} density="compact">
          <div className="orders-intent-list">
            {data.orderIntents.map((intent) => (
              <article key={intent.orderIntentId}>
                <FaLayerGroup />
                <div><strong>{intent.instrument} {intent.side} {intent.quantity} · {intent.type}</strong><small>{intent.orderIntentId} · {intent.idempotencyKey}</small></div>
                <span>{intent.limitPrice ? formatPrice(intent.limitPrice) : "MKT"}</span>
                <StatusBadge tone={intent.state === "ACKED" || intent.state === "FILLED" ? "success" : intent.state === "REJECTED" ? "danger" : "warning"}>{intent.state}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Ordres actifs provider/broker" actions={<InlineAction>Actifs</InlineAction>} density="compact">
          <div className="orders-active-list">
            {data.activeOrders.map((order) => (
              <article key={order.orderId}>
                <FaReceipt />
                <div>
                  <strong><Link to={`/execution/orders/${encodeURIComponent(order.orderId)}`}>{order.instrument} · {order.brokerOrderId}</Link></strong>
                  <small>{order.orderId} · {order.strategyInstanceId}</small>
                </div>
                <div className="orders-price-stack">
                  <span>{order.limitPrice ? formatPrice(order.limitPrice) : "MKT"}</span>
                  <small>stop {order.stopPrice ? formatPrice(order.stopPrice) : "—"}</small>
                </div>
                <StatusBadge tone={orderStateTone(order.state)}>{order.state}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="orders-id-grid">
            {data.activeOrders.slice(0, 2).map((order) => (
              <MetricBox key={order.orderId} label={compactId(order.orderId)} value={compactId(order.correlationId)} />
            ))}
          </div>
        </Card>

        <Card title="Protection & machine à états" actions={<InlineAction>Protection</InlineAction>} density="compact">
          <div className="orders-protection-list">
            {data.protections.map((protection) => (
              <article key={protection.protectionId}>
                <FaShieldAlt />
                <div><strong>{protection.orderId}</strong><small>{protection.trailingModel} · {protection.reasonCode}</small></div>
                <span>{protection.stopPrice ? formatPrice(protection.stopPrice) : "—"}</span>
                <StatusBadge tone={protection.state === "ATTACHED" ? "success" : protection.state === "FAILED" ? "danger" : "warning"}>{protection.state}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="orders-state-machine">
            {data.stateMachine.map((state) => (
              <article key={state.state}>
                <div><strong>{state.state}</strong><small>{state.description}</small></div>
                <b>{state.count}</b>
                <StatusBadge tone={state.tone === "OK" ? "success" : state.tone === "BLOCK" ? "danger" : "warning"}>{state.tone}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Fills, providers, historique et commandes">
        <Card title="Fills, commissions et slippage" actions={<InlineAction>Fills</InlineAction>} density="compact">
          <div className="orders-fill-list">
            {data.fills.map((fill) => (
              <article key={fill.fillId}>
                <FaCheckCircle />
                <div><strong>{fill.instrument} · {fill.quantity} @ {formatPrice(fill.price)}</strong><small>{fill.fillId} · {fill.brokerExecutionId}</small></div>
                <span>{formatMoney(fill.commission)}</span>
                <b className={fill.slippageR <= 0 ? "text-success" : "text-warning"}>{formatSignedR(fill.slippageR)}</b>
              </article>
            ))}
          </div>
          <div className="orders-provider-list">
            {data.providers.map((provider) => (
              <article key={provider.providerId}>
                <FaBroadcastTower />
                <div><strong>{provider.label}</strong><small>{provider.mode} · heartbeat {formatTime(provider.lastHeartbeatAt)}</small></div>
                <span>{provider.lastAckLatencyMs} ms</span>
                <StatusBadge tone={provider.status === "OK" ? "success" : provider.status === "DEGRADED" ? "warning" : "danger"}>{provider.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Historique d'exécution" actions={<InlineAction>Événements</InlineAction>} density="compact">
          <ol className="orders-history-list">
            {data.history.map((event) => (
              <li key={event.eventId}>
                <span><FaHistory />{formatTime(event.at)}</span>
                <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                <Link to={event.route}>{compactId(event.eventId)}</Link>
              </li>
            ))}
          </ol>
          <div className="orders-runtime-proof">
            <FaStream />
            <span>Les IDs order/fill/provider sont ceux du Trading en direct, de l'Explorateur d'événements et de la projection Détail signal live.</span>
          </div>
        </Card>

        <Card title="Actions Ordres" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="orders-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande orders</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
              <TrackedCommandReceipt command={command} />
            </div>
          </div>
          <label className="orders-reason">
            <span>Motif obligatoire</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="orders-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{actionIcon(action.commandType)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {compactId(action.expectedVersion)}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{action.permission}</StatusBadge>
                <DeskButton
                  variant="primary"
                  disabled={action.permission !== "ALLOWED" || reason.trim().length === 0 || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildOrdersCommand(action: OrderAction, reason: string): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("ORDERS_REASON_REQUIRED"), { code: "ORDERS_REASON_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      targetOrderId: action.targetOrderId ?? "",
      targetProviderId: action.targetProviderId ?? "",
      criticality: action.criticality,
      ...action.payload
    }
  };
}

function OrdersLoading() {
  return (
    <div className="operator-page orders-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function actionIcon(commandType: string) {
  if (commandType.includes("cancel")) return <FaBan />;
  if (commandType.includes("replace")) return <FaExchangeAlt />;
  if (commandType.includes("reconcile")) return <FaSyncAlt />;
  if (commandType.includes("close")) return <FaTimesCircle />;
  return <FaReceipt />;
}

function permissionTone(permission: OrderAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function orderStateTone(state: OrdersView["activeOrders"][number]["state"]) {
  if (state === "ACKED" || state === "FILLED") return "success";
  if (state === "REJECTED" || state === "CANCELLED") return "danger";
  if (state === "PARTIAL" || state === "SENT" || state === "INTENT") return "warning";
  return "accent";
}

function totalSlippage(fills: OrdersView["fills"]) {
  return fills.reduce((total, fill) => total + fill.slippageR, 0);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function compactId(value: string) {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
