import { useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ReasonInput } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { OrdersView } from "@/domains/front-api/viewModels";
import "@/features/orders-human-gate/orders-human-gate.css";

type ReviewItem = OrdersView["humanGateReview"]["items"][number];

export function OrdersPage() {
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("orders");
  const repository = useFrontViewRepository();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("Contrôle opérateur : décision Human Gate depuis Orders & Human Gate.");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const data = query.data?.data ?? null;
  const review = data?.humanGateReview ?? null;
  const selected = useMemo(
    () => (review ? review.items.find((item) => item.orderIntentId === selectedId) ?? review.items[0] ?? null : null),
    [review, selectedId]
  );

  if (query.isLoading) return <OrdersLoading />;
  if (query.isError) return <div className="oh-page"><div className="oh-workspace"><p className="oh-empty">Orders &amp; Human Gate indisponible : {(query.error as Error).message}</p></div></div>;
  if (!data || !review) return <div className="oh-page"><div className="oh-workspace"><p className="oh-empty">Le BFF ne retourne pas encore la projection `/views/orders`.</p></div></div>;

  const decide = async (action: "confirm" | "reject") => {
    if (!selected) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const command: SubmitDeskCommandInput = {
        commandType: action === "confirm" ? "execution.order_intent.confirm" : "execution.order_intent.reject",
        environment: "PAPER",
        expectedVersion: "unavailable",
        reason,
        payload: { portfolioOrderIntentId: selected.orderIntentId },
      };
      const accepted = await repository.submitCommand(command);
      setFeedback(`Commande ${accepted.status} · ${accepted.commandId}`);
      void query.refetch();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "HUMAN_GATE_COMMAND_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="oh-page" data-testid="orders-human-gate-golden-master">
      <header className="oh-header">
        <div className="oh-header__title">
          <h1>Orders &amp; Human Gate</h1>
          <p>Revue des OrderIntents &amp; approbation opérateur</p>
        </div>
        <div className="oh-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        {review.summary.pendingCount > 0 ? <span className="oh-header__pill">Autorité requise</span> : null}
      </header>

      <div className="oh-workspace">
        <section className="oh-kpi-strip" aria-label="Indicateurs Orders & Human Gate">
          <KpiCell label="En attente" value={String(review.summary.pendingCount)} />
          <KpiCell label="Approuvées (jour)" value={String(review.summary.approvedToday)} />
          <KpiCell label="Rejetées (jour)" value={String(review.summary.rejectedToday)} />
          <KpiCell label="Temps moyen" value={formatDuration(review.summary.avgDecisionSeconds)} />
          <KpiCell label="OrderIntents actifs" value={String(data.summary.orderIntents)} />
          <KpiCell label="Ordres actifs" value={String(data.summary.activeOrders)} />
        </section>

        <div className="oh-row1">
          <section className="oh-panel" aria-label="OrderIntents en revue">
            <header><h2>OrderIntents en revue</h2><small>{review.items.length}</small></header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll">
                <table className="oh-table">
                  <thead><tr><th>OrderIntent</th><th>Instrument</th><th>Côté</th><th>Qté (aut.)</th><th>Âge</th><th>Statut</th></tr></thead>
                  <tbody>
                    {review.items.map((item) => (
                      <tr key={item.orderIntentId} aria-selected={selected?.orderIntentId === item.orderIntentId} onClick={() => setSelectedId(item.orderIntentId)}>
                        <td><strong>{shortId(item.orderIntentId)}</strong></td>
                        <td>{item.instrument}</td>
                        <td><StatusBadge tone={item.side === "BUY" ? "success" : "danger"}>{item.side}</StatusBadge></td>
                        <td>{item.quantity} ({item.authorizedQuantity})</td>
                        <td>{formatAge(item.ageSeconds)}</td>
                        <td><StatusBadge tone={gateTone(item.status)}>{item.status}</StatusBadge></td>
                      </tr>
                    ))}
                    {!review.items.length ? <tr><td colSpan={6}><p className="oh-empty">Aucun OrderIntent avec Human Gate publié.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="Détail OrderIntent sélectionné">
            <header><h2>Détail</h2>{selected ? <Link to={selected.route}>Dossier complet</Link> : null}</header>
            <div className="oh-panel__body">
              {selected ? (
                <div className="oh-detail">
                  <div className="oh-detail-grid">
                    <div><small>OrderIntent</small><strong>{shortId(selected.orderIntentId)}</strong></div>
                    <div><small>Statut</small><strong>{selected.status}</strong></div>
                    <div><small>Instrument</small><strong>{selected.instrument}</strong></div>
                    <div><small>Côté</small><strong>{selected.side}</strong></div>
                    <div><small>Qté demandée</small><strong>{selected.quantity}</strong></div>
                    <div><small>Qté autorisée</small><strong>{selected.authorizedQuantity}</strong></div>
                    <div><small>Risque autorisé</small><strong>{selected.riskPct != null ? `${(selected.riskPct * 100).toFixed(2)}%` : "Non publié"}</strong></div>
                    <div><small>Expire</small><strong>{formatTime(selected.expiresAt)}</strong></div>
                  </div>
                  {selected.status === "AWAITING_MANUAL_CONFIRMATION" ? (
                    <>
                      <ReasonInput label="Justification opérateur" value={reason} onChange={setReason} />
                      <div className="oh-action-row">
                        <button type="button" className="reject" disabled={submitting || !reason.trim()} onClick={() => decide("reject")}>Rejeter</button>
                        <button type="button" className="approve" disabled={submitting || !reason.trim()} onClick={() => decide("confirm")}>Confirmer</button>
                      </div>
                    </>
                  ) : <p className="oh-empty">Cette décision est déjà finalisée.</p>}
                  {feedback ? <p className="oh-empty">{feedback}</p> : null}
                </div>
              ) : <p className="oh-empty">Aucun OrderIntent sélectionné.</p>}
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
                <div><small>Protection (%)</small><strong>{data.summary.protectedOrdersPct}%</strong></div>
              </div>
            </div>
          </section>

          <section className="oh-panel" aria-label="Ordres actifs">
            <header><h2>Ordres actifs</h2><small>{data.activeOrders.length}</small></header>
            <div className="oh-panel__body" style={{ padding: 0 }}>
              <div className="oh-table-scroll">
                <table className="oh-table">
                  <thead><tr><th>Ordre</th><th>Instrument</th><th>Côté</th><th>Qté</th><th>État</th></tr></thead>
                  <tbody>
                    {data.activeOrders.map((order) => (
                      <tr key={order.orderId}>
                        <td><Link to={`/execution/orders/${encodeURIComponent(order.orderId)}`}>{shortId(order.orderId)}</Link></td>
                        <td>{order.instrument}</td>
                        <td><StatusBadge tone={order.side === "BUY" ? "success" : "danger"}>{order.side}</StatusBadge></td>
                        <td>{order.quantity}</td>
                        <td><StatusBadge tone={order.state === "FILLED" ? "success" : order.state === "REJECTED" || order.state === "CANCELLED" ? "danger" : "accent"}>{order.state}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.activeOrders.length ? <tr><td colSpan={5}><p className="oh-empty">Aucun ordre actif.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
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
      <div className="oh-workspace">
        <section className="oh-kpi-strip">
          {Array.from({ length: 6 }).map((_, index) => <article key={index} className="oh-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function gateTone(status: ReviewItem["status"]) {
  if (status === "CONFIRMED") return "success" as const;
  if (status === "REJECTED" || status === "EXPIRED") return "danger" as const;
  if (status === "AWAITING_MANUAL_CONFIRMATION") return "warning" as const;
  return "accent" as const;
}

function shortId(value: string) {
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

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
