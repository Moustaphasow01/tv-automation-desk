import type { OrderDetailView } from "@/domains/front-api/viewModels";
import type { DataValue, ViewEnvelope, ViewMeta } from "@/shared/contracts";
import { known, unavailable } from "@/shared/contracts";
import type { AuthorityStage, OrderIntentDossier, ProviderTimelineEvent } from "@/features/order-intent/model";

const PLACEHOLDERS = new Set(["", "unavailable", "unknown", "none", "n/a", "not_available"]);

export function buildOrderIntentDossier(envelope: ViewEnvelope<OrderDetailView>): OrderIntentDossier {
  const { data, meta } = envelope;
  const source = "front-api/v1/views/order-detail";
  const terms = data.intent ?? data.order;
  const authority = data.authority ?? null;
  const backendHumanGate = data.humanGate ?? null;
  const backendReconciliation = data.reconciliation ?? null;
  const lifecycle = data.lifecycle.map((event): ProviderTimelineEvent => ({
    eventId: event.eventId,
    occurredAt: event.at,
    status: event.state,
    title: event.state,
    details: event.detail,
    source,
    actor: "BACKEND",
    entity: data.identity.orderId,
    correlationId: data.identity.correlationId,
  }));

  return {
    meta,
    degradedReadOnly: meta.stale || (meta.availability != null && meta.availability !== "AVAILABLE"),
    brokerSummary: data.summary,
    identity: {
      orderIntentId: textValue(data.identity.orderIntentId, meta, source, "OrderIntent canonique non publié"),
      orderId: textValue(data.identity.orderId, meta, source, "Order broker non publié"),
      brokerOrderId: textValue(data.identity.brokerOrderId, meta, source, "Identifiant broker non publié"),
      providerId: textValue(data.identity.providerId, meta, source, "Provider non publié"),
      correlationId: textValue(data.identity.correlationId, meta, source, "Corrélation non publiée"),
    },
    strategy: {
      strategyId: textValue(authority?.strategy?.strategyId, meta, source, "Strategy ID canonique absent de la projection actuelle"),
      strategyInstanceId: textValue(data.identity.strategyInstanceId, meta, source, "Instance stratégie non publiée"),
      strategyVersion: textValue(authority?.strategy?.strategyVersion, meta, source, "Version stratégie absente de la projection actuelle"),
    },
    signal: {
      signalId: textValue(data.identity.signalId, meta, source, "Signal non publié"),
      instrument: textValue(data.order.instrument, meta, source, "Instrument non publié"),
      side: textValue(data.order.side, meta, source, "Sens non publié"),
    },
    contextGate: backendStage(authority?.contextGate, meta, "Context Gate", "Décision Context Gate non exposée par le BFF"),
    portfolioArbitration: backendStage(authority?.portfolioArbitration, meta, "Arbitrage portefeuille", "Décision d'arbitrage non exposée par le BFF"),
    globalRisk: backendStage(authority?.globalRisk, meta, "Global Risk", "Décision, reason codes et policy Risk non exposés par le BFF"),
    targetPosition: {
      targetPositionId: textValue(authority?.targetPosition?.targetPositionId, meta, source, "TargetPosition ID absent de la projection actuelle"),
      account: textValue(authority?.targetPosition?.account ?? data.order.account, meta, source, "Compte non publié"),
      authorizedQuantity: numericValue(authority?.targetPosition?.authorizedQuantity, meta, source, "La quantité autorisée par Global Risk n'est pas publiée"),
    },
    executionPlan: {
      orderType: textValue(terms.type, meta, source, "Type d'ordre non publié"),
      timeInForce: textValue(terms.tif, meta, source, "Time in force non publié"),
      entry: numericValue(terms.limitPrice, meta, source, "Prix d'entrée officiel non publié"),
      stop: numericValue(terms.stopPrice, meta, source, "Stop officiel non publié"),
      targets: typeof terms.targetPrice === "number"
        ? [known(terms.targetPrice, { asOf: meta.asOf, source })]
        : [unavailable("Targets officiels non publiés", { source })],
      expectedR: unavailable("Expected R officiel non publié", { source }),
      expectedRevision: textValue(data.order.expectedVersion, meta, source, "Révision non publiée"),
      createdAt: data.intent
        ? textValue(data.intent.createdAt, meta, source, "Date de création non publiée")
        : unavailable("Date de création OrderIntent non publiée", { source }),
      expiresAt: unavailable("Expiration OrderIntent non publiée", { source }),
    },
    executionMode: textValue(data.executionMode ?? undefined, meta, source, "Mode d'exécution autoritaire absent de cette projection") as OrderIntentDossier["executionMode"],
    humanGate: {
      status: textValue(backendHumanGate?.status, meta, source, "Human Gate et allowedActions ne sont pas encore publiés par le BFF"),
      actions: backendHumanGate?.actions ?? [],
      unavailableReason: backendHumanGate?.unavailableReason || "Confirmation indisponible : le backend ne publie aucun allowedAction pour cette ressource.",
    },
    providerLifecycle: lifecycle,
    fills: data.fills.map((fill) => ({ fillId: fill.fillId, quantity: fill.quantity, price: fill.price, filledAt: fill.filledAt })),
    reconciliation: backendReconciliation
      ? {
          status: textValue(backendReconciliation.status, meta, source, "Réconciliation OrderIntent ↔ broker non publiée"),
          checkedAt: textValue(backendReconciliation.checkedAt, meta, source, "Dernier contrôle non publié"),
          expected: backendReconciliation.expected.map((item) => ({ label: item.label, value: known(item.value, { asOf: meta.asOf, source }) })),
          broker: backendReconciliation.broker.map((item) => ({ label: item.label, value: known(item.value, { asOf: meta.asOf, source }) })),
          mismatches: backendReconciliation.mismatches,
        }
      : {
          status: unavailable("Réconciliation OrderIntent ↔ broker non publiée", { source }),
          checkedAt: unavailable("Dernier contrôle non publié", { source }),
          expected: [],
          broker: [],
          mismatches: [],
        },
    relations: data.relations.filter((relation) => !isPlaceholder(relation.id)),
    technical: [
      { label: "schemaVersion", value: meta.schemaVersion },
      { label: "source", value: source },
      { label: "asOf", value: meta.asOf },
      { label: "generatedAt", value: meta.generatedAt },
      { label: "revision", value: data.order.expectedVersion || "UNAVAILABLE" },
      { label: "correlationId", value: data.identity.correlationId || meta.correlationId },
      { label: "rawStatus", value: data.summary.state },
      { label: "idempotencyKey", value: data.order.idempotencyKey },
    ],
  };
}

function unavailableStage(label: string, reason: string): AuthorityStage {
  return {
    label,
    decision: unavailable(reason, { source: "front-api/v1/views/order-detail" }),
    reasonCodes: [],
    authorityId: unavailable(`${label} ID non publié`, { source: "front-api/v1/views/order-detail" }),
    version: unavailable(`${label} version non publiée`, { source: "front-api/v1/views/order-detail" }),
  };
}

function backendStage(
  stage: NonNullable<NonNullable<OrderDetailView["authority"]>["contextGate"]> | undefined,
  meta: ViewMeta,
  label: string,
  reason: string
): AuthorityStage {
  if (!stage) return unavailableStage(label, reason);
  return {
    label,
    decision: textValue(stage.decision, meta, "front-api/v1/views/order-detail", reason),
    reasonCodes: stage.reasonCodes,
    authorityId: textValue(stage.authorityId, meta, "front-api/v1/views/order-detail", `${label} ID non publié`),
    version: textValue(stage.version, meta, "front-api/v1/views/order-detail", `${label} version non publiée`),
  };
}

function textValue(value: string | undefined, meta: ViewMeta, source: string, reason: string): DataValue<string> {
  return !isPlaceholder(value) ? known(value as string, { asOf: meta.asOf, source }) : unavailable(reason, { source });
}

function numericValue(value: number | undefined, meta: ViewMeta, source: string, reason: string): DataValue<number> {
  return typeof value === "number" && Number.isFinite(value) ? known(value, { asOf: meta.asOf, source }) : unavailable(reason, { source });
}

function isPlaceholder(value: string | undefined): boolean {
  return value == null || PLACEHOLDERS.has(value.trim().toLowerCase());
}
