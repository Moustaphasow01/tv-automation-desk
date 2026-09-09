import { useContext, useMemo, useState } from "react";
import { JourneyLink as Link } from "@/features/trading-journey/JourneyNavigation";
import { routeDisplayName } from "@/app/routes";
import { FaFingerprint } from "react-icons/fa";
import { ReasonInput } from "@/design-system/actions";
import { operatorCode, operatorCopy, operatorReason, operatorStatusPresentation } from "@/design-system/operatorVocabulary";
import { StatusBadge } from "@/design-system/primitives";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { OrdersView } from "@/domains/front-api/viewModels";
import "@/features/orders-human-gate/orders-human-gate.css";

type ReviewItem = OrdersView["humanGateReview"]["items"][number];
type OrderAction = OrdersView["commandActions"][number];
type DecisionStatusFilter = "ACTIONABLE" | "ALL" | ReviewItem["status"];

const REVIEW_PAGE_SIZE = 15;

export function OrdersPage() {
  const realtime = useContext(RealtimeContext);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useFrontView("orders", selectedId ? { orderIntentId: selectedId } : {}, { preservePreviousData: true });
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Décision prise depuis l’écran des ordres proposés.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DecisionStatusFilter>("ACTIONABLE");
  const [instrumentFilter, setInstrumentFilter] = useState("ALL");
  const [reviewPage, setReviewPage] = useState(1);

  const data = query.data?.data ?? null;
  const review = data?.humanGateReview ?? null;
  const instrumentOptions = useMemo(
    () => review ? [...new Set(review.items.map((item) => item.instrument).filter(Boolean))].sort() : [],
    [review]
  );
  const filteredItems = useMemo(() => {
    if (!review) return [];
    return review.items.filter((item) => {
      const statusMatches = statusFilter === "ALL"
        || (statusFilter === "ACTIONABLE" && item.status === "AWAITING_MANUAL_CONFIRMATION")
        || item.status === statusFilter;
      return statusMatches && (instrumentFilter === "ALL" || item.instrument === instrumentFilter);
    });
  }, [instrumentFilter, review, statusFilter]);
  const totalReviewPages = Math.max(1, Math.ceil(filteredItems.length / REVIEW_PAGE_SIZE));
  const safeReviewPage = Math.min(reviewPage, totalReviewPages);
  const pagedItems = filteredItems.slice((safeReviewPage - 1) * REVIEW_PAGE_SIZE, safeReviewPage * REVIEW_PAGE_SIZE);
  const selected = useMemo(
    () => (review ? review.items.find((item) => item.orderIntentId === selectedId) ?? filteredItems[0] ?? null : null),
    [filteredItems, review, selectedId]
  );

  if (query.isLoading) return <OrdersLoading />;
  if (query.isError) return <div className="oh-page"><h1 className="sr-only">Ordres et validation</h1><div className="oh-workspace" role="region" aria-label="État des ordres et des validations" tabIndex={0}><p className="oh-empty">Les ordres proposés ne répondent pas. Aucune action n'est disponible.</p></div></div>;
  if (!data || !review) return <div className="oh-page"><h1 className="sr-only">Ordres et validation</h1><div className="oh-workspace" role="region" aria-label="État des ordres et des validations" tabIndex={0}><p className="oh-empty">Aucun ordre proposé n'est publié.</p></div></div>;

  const confirmOrderAction = async (action: OrderAction) => {
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
    <div className="oh-page" data-testid="orders-human-gate-golden-master">
      <header className="oh-header">
        <div className="oh-header__title">
          <h1>{routeDisplayName("orders")}</h1>
          <p>Ordres proposés et validation opérateur</p>
        </div>
        <div className="oh-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        {review.summary.pendingCount > 0 ? <span className="oh-header__pill">Autorité requise</span> : null}
      </header>

      <div className="oh-workspace">
        <section className="oh-kpi-strip" aria-label="Indicateurs des ordres et validations">
          <KpiCell label="En attente" value={String(review.summary.pendingCount)} />
          <KpiCell label="Approuvées (jour)" value={String(review.summary.approvedToday)} />
          <KpiCell label="Rejetées (jour)" value={String(review.summary.rejectedToday)} />
          <KpiCell label="Temps moyen" value={formatDuration(review.summary.avgDecisionSeconds)} />
          <KpiCell label="Ordres proposés actifs" value={String(data.summary.orderIntents)} />
          <KpiCell label="Ordres actifs" value={String(data.summary.activeOrders)} />
        </section>

        <div className="oh-row1">
          <section className="oh-panel" aria-label="Ordres proposés en revue">
            <header>
              <h2>Ordres proposés en revue</h2>
              <small>{filteredItems.length}/{review.items.length}</small>
              <div className="oh-decision-filters" aria-label="Filtres des décisions">
                <label>
                  <span className="sr-only">Statut</span>
                  <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as DecisionStatusFilter); setReviewPage(1); }}>
                    <option value="ACTIONABLE">À traiter</option>
                    <option value="ALL">Tous</option>
                    <option value="AWAITING_MANUAL_CONFIRMATION">En attente</option>
                    <option value="CONFIRMED">Confirmés</option>
                    <option value="REJECTED">Rejetés</option>
                    <option value="EXPIRED">Expirés</option>
                  </select>
                </label>
                <label>
                  <span className="sr-only">Instrument</span>
                  <select value={instrumentFilter} onChange={(event) => { setInstrumentFilter(event.target.value); setReviewPage(1); }}>
                    <option value="ALL">Tous instruments</option>
                    {instrumentOptions.map((instrument) => <option key={instrument} value={instrument}>{instrument}</option>)}
                  </select>
                </label>
              </div>
            </header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll" role="region" aria-label="Liste des ordres proposés en revue" tabIndex={0}>
                <table className="oh-table">
                  <thead><tr><th>Ordre proposé</th><th>Instrument</th><th>Sens</th><th>Quantité autorisée</th><th>Âge</th><th>État</th></tr></thead>
                  <tbody>
                    {pagedItems.map((item) => (
                      <tr key={item.orderIntentId} aria-selected={selected?.orderIntentId === item.orderIntentId} onClick={() => setSelectedId(item.orderIntentId)}>
                        <td><strong title={item.orderIntentId}>{item.instrument} · {operatorCode(item.side)} · {item.quantity}</strong></td>
                        <td>{item.instrument}</td>
                        <td><StatusBadge tone={item.side === "BUY" ? "success" : "danger"}>{operatorCode(item.side)}</StatusBadge></td>
                        <td>{item.quantity} ({item.authorizedQuantity})</td>
                        <td>{formatAge(item.ageSeconds)}</td>
                        <td><StatusBadge tone={gateTone(item.status)}>{operatorStatusPresentation(item.status).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!pagedItems.length ? <tr><td colSpan={6}><p className="oh-empty">Aucune décision ne correspond aux filtres.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
              {filteredItems.length > REVIEW_PAGE_SIZE ? (
                <nav className="oh-pagination" aria-label="Pagination des décisions">
                  <button type="button" disabled={safeReviewPage <= 1} onClick={() => setReviewPage((page) => Math.max(1, page - 1))}>Précédent</button>
                  <span>Page {safeReviewPage} sur {totalReviewPages}</span>
                  <button type="button" disabled={safeReviewPage >= totalReviewPages} onClick={() => setReviewPage((page) => Math.min(totalReviewPages, page + 1))}>Suivant</button>
                </nav>
              ) : null}
            </div>
          </section>

          <section className="oh-panel" aria-label="Détail de l’ordre proposé sélectionné">
            <header><h2>Détail</h2>{selected ? <Link to={selected.route}>Dossier complet</Link> : null}</header>
            <div className="oh-panel__body">
              {selected ? (
                <div className="oh-detail">
                  {review.selectedDossier ? <PipelineStepper lineage={review.selectedDossier.lineage} /> : null}
                  <div className="oh-detail-grid">
                    <div><small>Ordre proposé</small><strong title={selected.orderIntentId}>{selected.instrument} · {operatorCode(selected.side)} · {selected.quantity}</strong></div>
                    <div><small>État</small><strong>{operatorStatusPresentation(selected.status).label}</strong></div>
                    <div><small>Instrument</small><strong>{selected.instrument}</strong></div>
                    <div><small>Sens</small><strong>{operatorCode(selected.side)}</strong></div>
                    <div>
                      <small>Échéance</small>
                      <strong className={`text-${expiryTone(selected.expiresAt, realtime?.now)}`}>{formatExpiryCountdown(selected.expiresAt, realtime?.now)}</strong>
                      <span className="oh-detail__timestamp">{formatTime(selected.expiresAt)}</span>
                    </div>
                    <div><small>Décision du risque</small><strong>{review.selectedDossier?.lineage.riskDecision.decision ? operatorStatusPresentation(review.selectedDossier.lineage.riskDecision.decision).label : "Non publié"}</strong></div>
                  </div>
                  {review.selectedDossier ? (
                    <div className="oh-qty-compare">
                      <div><small>Demandé</small><strong>{formatPublishedNumber(review.selectedDossier.riskSnapshot.requestedQty)}</strong></div>
                      <div><small>Autorisé</small><strong>{formatPublishedNumber(review.selectedDossier.riskSnapshot.authorizedQty)}</strong></div>
                      <div><small>Delta</small><strong>{formatPublishedDelta(review.selectedDossier.riskSnapshot.authorizedQty, review.selectedDossier.riskSnapshot.requestedQty)}</strong></div>
                    </div>
                  ) : null}
                  {selected.status === "AWAITING_MANUAL_CONFIRMATION" ? (
                    <div className="oh-empty" role="status">
                      <strong>Votre validation est requise</strong>
                      <span>Ouvrez le dossier complet : seules les actions publiées par le système sont exécutables.</span>
                      <Link to={selected.route}>Ouvrir la validation</Link>
                    </div>
                  ) : <p className="oh-empty">Cette décision est déjà finalisée.</p>}
                </div>
              ) : <p className="oh-empty">Aucun ordre proposé sélectionné.</p>}
            </div>
          </section>
        </div>

        <div className="oh-row3">
          <section className="oh-panel" aria-label="Résumé des décisions">
            <header><h2>Décisions</h2></header>
            <div className="oh-panel__body">
              <DecisionDonut items={review.items} />
            </div>
          </section>

          <section className="oh-panel" aria-label="Codes de raison">
            <header><h2>Codes de raison</h2></header>
            <div className="oh-panel__body">
              <div className="oh-reason-list">
                {review.reasonCodes.map((item) => (
                  <div key={item.code} className="oh-reason-row"><span title={item.code}>{operatorReason(item.code)}</span><strong>{item.count}</strong></div>
                ))}
                {!review.reasonCodes.length ? <p className="oh-empty">Aucun code de raison publié.</p> : null}
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="En attente par stratégie">
            <header><h2>En attente par stratégie</h2></header>
            <div className="oh-panel__body">
              <div className="oh-pending-list">
                {review.pendingByStrategy.map((row) => (
                  <div key={row.strategyInstanceId} className="oh-pending-row">
                    <span title={row.strategyInstanceId}>Stratégie · {row.pending} en attente</span>
                    <strong>{row.pending}</strong>
                    <small>{formatAge(row.oldestAgeSeconds)}</small>
                  </div>
                ))}
                {!review.pendingByStrategy.length ? <p className="oh-empty">Aucune stratégie en attente.</p> : null}
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="Dernières décisions">
            <header><h2>Dernières décisions</h2></header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll" role="region" aria-label="Liste des dernières décisions" tabIndex={0}>
                <table className="oh-table">
                  <thead><tr><th>Instrument</th><th>Décision</th><th>Durée</th></tr></thead>
                  <tbody>
                    {review.recentDecisions.map((item) => (
                      <tr key={item.orderIntentId}>
                        <td>{item.instrument}</td>
                        <td><StatusBadge tone={item.decision === "APPROVED" ? "success" : "danger"}>{operatorStatusPresentation(item.decision).label}</StatusBadge></td>
                        <td>{formatDuration(item.decisionSeconds)}</td>
                      </tr>
                    ))}
                    {!review.recentDecisions.length ? <tr><td colSpan={3}><p className="oh-empty">Aucune décision récente publiée.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <div className="oh-row2">
          <section className="oh-panel" aria-label="Journal des refus opérateur">
            <header><h2>Journal des refus</h2><small>{(review.refusalJournal ?? []).length}</small></header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll" role="region" aria-label="Refus opérateur audités" tabIndex={0}>
                <table className="oh-table">
                  <thead><tr><th>Heure</th><th>Instrument</th><th>Motif</th><th>Opérateur</th></tr></thead>
                  <tbody>
                    {(review.refusalJournal ?? []).map((item) => (
                      <tr key={item.eventId || `${item.orderIntentId}-${item.at}`}>
                        <td><Link to={`/execution/orders/${encodeURIComponent(item.orderIntentId)}`}>{formatTime(item.at)}</Link></td>
                        <td>{item.instrument}</td>
                        <td title={item.reason}>{item.reason}</td>
                        <td>{shortId(item.operatorId)}</td>
                      </tr>
                    ))}
                    {!(review.refusalJournal ?? []).length ? <tr><td colSpan={4}><p className="oh-empty">Aucun refus opérateur audité.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="Analyse des refus et expirations">
            <header><h2>Analyse des décisions</h2><small>Votre validation</small></header>
            <div className="oh-panel__body oh-feedback-grid">
              <div>
                <h3>Motifs fréquents</h3>
                {(review.refusalReasons ?? []).map((item) => <div key={item.reason} className="oh-reason-row"><span>{item.reason}</span><strong>{item.count}</strong></div>)}
                {!(review.refusalReasons ?? []).length ? <p className="oh-empty">Aucun motif de refus publié.</p> : null}
              </div>
              <div>
                <h3>Expiration par stratégie</h3>
                {(review.expirationByStrategy ?? []).map((item) => <div key={item.strategyInstanceId} className="oh-reason-row"><span title={item.strategyInstanceId}>{shortId(item.strategyInstanceId)}</span><strong>{item.expirationPct}%</strong><small>{item.expired}/{item.total}</small></div>)}
                {!(review.expirationByStrategy ?? []).length ? <p className="oh-empty">Aucune expiration attribuable à une stratégie.</p> : null}
              </div>
            </div>
          </section>
        </div>

        <div className="oh-row2">
          <section className="oh-panel" aria-label="Résumé exécution">
            <header><h2>Exécution</h2></header>
            <div className="oh-panel__body">
              <div className="oh-detail-grid">
                <div><small>Remplissages récents</small><strong>{data.summary.recentFills}</strong></div>
                <div><small>Ordres partiels</small><strong>{data.summary.partialOrders}</strong></div>
                <div><small>Ordres rejetés</small><strong>{data.summary.rejectedOrders}</strong></div>
                <div><small>Ordres protégés (stop en place)</small><strong>{data.summary.protectedOrdersPct}%</strong></div>
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="Ordres actifs">
            <header><h2>Ordres actifs</h2><small>{data.activeOrders.length}</small></header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll" role="region" aria-label="Liste des ordres actifs" tabIndex={0}>
                <table className="oh-table">
                  <thead><tr><th>Ordre</th><th>Instrument</th><th>Côté</th><th>Qté</th><th>État</th></tr></thead>
                  <tbody>
                    {data.activeOrders.map((order) => (
                      <tr key={order.orderId}>
                        <td><Link to={`/execution/orders/${encodeURIComponent(order.orderId)}`} title={order.orderId}>{order.instrument} · {operatorCode(order.side)} · {order.quantity}</Link></td>
                        <td>{order.instrument}</td>
                        <td><StatusBadge tone={order.side === "BUY" ? "success" : "danger"}>{operatorCode(order.side)}</StatusBadge></td>
                        <td>{order.quantity}</td>
                        <td><StatusBadge tone={order.state === "FILLED" ? "success" : order.state === "REJECTED" || order.state === "CANCELLED" ? "danger" : "accent"}>{operatorStatusPresentation(order.state).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.activeOrders.length ? <tr><td colSpan={5}><p className="oh-empty">Aucun ordre actif.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <section className="oh-panel" aria-label="Actions ordres">
          <header><h2>Actions ordres</h2><small>Flux de commande</small></header>
          <div className="oh-panel__body">
            <div className="oh-command-result">
              <FaFingerprint />
              <div>
                <small>Dernière commande</small>
                <strong title={command?.commandId}>{command ? "Commande acceptée" : "Aucune commande confirmée"}</strong>
                {commandError ? <div style={{ color: "var(--oh-red)" }}>{commandError}</div> : null}
              </div>
            </div>
            <div className="oh-command-list">
              {data.commandActions.map((action) => (
                <article key={action.actionId}>
                  <FaFingerprint />
                  <div><strong>{operatorCopy(action.label)}</strong><small>{operatorCode(action.commandType)}</small></div>
                  <StatusBadge tone={action.permission === "ALLOWED" ? "success" : action.permission === "STEP_UP_REQUIRED" ? "warning" : "danger"}>{operatorStatusPresentation(action.permission).label}</StatusBadge>
                  <button
                    type="button"
                    disabled={action.permission !== "ALLOWED" || !reason.trim() || submittingActionId === action.actionId}
                    onClick={() => confirmOrderAction(action)}
                  >
                    {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                  </button>
                </article>
              ))}
              {!data.commandActions.length ? <p className="oh-empty">Aucune action commande publiée.</p> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function buildOrdersCommand(action: OrderAction, reason: string): SubmitDeskCommandInput {
  if (action.permission !== "ALLOWED") {
    throw Object.assign(new Error("ORDERS_ACTION_NOT_ALLOWED"), { code: "ORDERS_ACTION_NOT_ALLOWED" });
  }
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

type Lineage = NonNullable<OrdersView["humanGateReview"]["selectedDossier"]>["lineage"];

const STEPPER_STAGES: readonly { key: keyof Lineage; label: string }[] = [
  { key: "strategySignal", label: "Signal" },
  { key: "contextDecision", label: "Contexte" },
  { key: "portfolioDecision", label: "Portefeuille" },
  { key: "riskDecision", label: "Risque" },
  { key: "targetPosition", label: "Position cible" },
  { key: "orderIntent", label: "Ordre proposé" },
  { key: "humanGate", label: "Votre validation" },
];

function PipelineStepper({ lineage }: { lineage: Lineage }) {
  const providerReached = lineage.providerCommands.length > 0;
  return (
    <div className="oh-stepper" role="region" aria-label="Progression du pipeline d’exécution" tabIndex={0}>
      {STEPPER_STAGES.map((stage, index) => {
        const node = lineage[stage.key] as { id: string };
        const done = node.id !== "unavailable";
        return (
          <div key={stage.key} style={{ display: "contents" }}>
            <div className={`oh-stepper-node${done ? " is-done" : ""}${!done && index > 0 ? " is-current" : ""}`}>
              <span className="dot" />
              <small>{stage.label}</small>
            </div>
            {index < STEPPER_STAGES.length - 1 ? <div className="oh-stepper-line" /> : null}
          </div>
        );
      })}
      <div className="oh-stepper-line" />
      <div className={`oh-stepper-node${providerReached ? " is-done" : ""}`}><span className="dot" /><small>Commande fournisseur</small></div>
    </div>
  );
}

function DecisionDonut({ items }: { items: OrdersView["humanGateReview"]["items"] }) {
  const counts = {
    CONFIRMED: items.filter((item) => item.status === "CONFIRMED").length,
    REJECTED: items.filter((item) => item.status === "REJECTED").length,
    AWAITING_MANUAL_CONFIRMATION: items.filter((item) => item.status === "AWAITING_MANUAL_CONFIRMATION").length,
    EXPIRED: items.filter((item) => item.status === "EXPIRED").length,
  };
  const total = items.length || 1;
  const colors: Record<string, string> = { CONFIRMED: "var(--oh-green)", REJECTED: "var(--oh-red)", AWAITING_MANUAL_CONFIRMATION: "var(--oh-amber)", EXPIRED: "var(--oh-muted)" };
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <svg viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Répartition des décisions">
        <g transform="rotate(-90 50 50)">
          {Object.entries(counts).map(([key, value]) => {
            const fraction = value / total;
            const dash = fraction * circumference;
            const offset = cumulative * circumference;
            cumulative += fraction;
            return <circle key={key} cx="50" cy="50" r={radius} fill="none" stroke={colors[key]} strokeWidth="14" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
          })}
        </g>
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--oh-text)" fontWeight="700">{items.length}</text>
      </svg>
      <ul style={{ display: "grid", gap: 4, fontSize: 11, listStyle: "none", margin: 0, padding: 0 }}>
        {Object.entries(counts).map(([key, value]) => (
          <li key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors[key], display: "inline-block" }} />
            {operatorStatusPresentation(key).label} <strong>{value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <article className="oh-kpi-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function OrdersLoading() {
  return (
    <div className="oh-page">
      <h1 className="sr-only">Ordres et validation</h1>
      <div className="oh-workspace">
        <section className="oh-kpi-strip">
          {Array.from({ length: 6 }).map((_, index) => <article key={index} className="oh-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function formatPublishedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Non publié";
}

function formatPublishedDelta(authorized: unknown, requested: unknown) {
  if (typeof authorized !== "number" || !Number.isFinite(authorized) || typeof requested !== "number" || !Number.isFinite(requested)) {
    return "Non publié";
  }
  return String(authorized - requested);
}

function gateTone(status: ReviewItem["status"]) {
  if (status === "CONFIRMED") return "success" as const;
  if (status === "REJECTED" || status === "EXPIRED") return "danger" as const;
  if (status === "AWAITING_MANUAL_CONFIRMATION") return "warning" as const;
  return "accent" as const;
}

function shortId(value: string) {
  if (!value || ["unavailable", "undefined", "unknown", "none"].includes(value.trim().toLowerCase())) return "Non publié";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatExpiryCountdown(value: string | null, now: Date | undefined) {
  if (!value || !now) return "Échéance non publiée";
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return "Échéance non publiée";
  const remainingSeconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (remainingSeconds <= 0) return "Expiré";
  if (remainingSeconds < 60) return `Expire dans ${remainingSeconds}s`;
  if (remainingSeconds < 3600) return `Expire dans ${Math.ceil(remainingSeconds / 60)} min`;
  return `Expire dans ${Math.floor(remainingSeconds / 3600)} h ${Math.ceil((remainingSeconds % 3600) / 60)} min`;
}

function expiryTone(value: string | null, now: Date | undefined) {
  if (!value || !now) return "muted";
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return "muted";
  const remainingSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
  if (remainingSeconds <= 0) return "danger";
  if (remainingSeconds <= 120) return "warning";
  return "success";
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
