import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag, TechnicalDetails } from "@/components/operations";
import { operationsKeys, useNotifications, useTelegramStatus } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, shortReference, workflowLabel } from "@/lib/presentation";
import type { NotificationAction, NotificationActionInput, OperationsNotification, TelegramActionInput, TelegramStatus } from "@/operationsTypes";

const tabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

const actionLabels: Record<NotificationAction, string> = {
  mark_read: "Marquer lu",
  dismiss: "Masquer",
};

export default function NotificationsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState("active");
  const [level, setLevel] = useState("all");
  const [q, setQ] = useState("");
  const filters = useMemo(() => ({
    status: status === "all" ? null : status,
    level: level === "all" ? null : level,
    q: q.trim() || null,
  }), [level, q, status]);
  const query = useNotifications(filters);

  const sync = useMutation({
    mutationFn: () => operationsApi.syncNotifications({ autoClear: true, reason: "Synchronisation manuelle du centre de notifications" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.all }),
  });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Notifications indisponibles"} retry={() => query.refetch()}/>;

  const items = query.data.items;
  const summary = query.data.summary;
  const returnTo = "/operations/notifications";

  return <section className="view workspace-view notification-center-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Notifications" }]}/>
    <PageHeading
      eyebrow="Centre de notifications"
      title="Notifications & escalade"
      subtitle="File locale dédupliquée par incident, avec priorité, niveau d’escalade et actions opérateur."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}><Icon name="refresh" size={14}/>{sync.isPending ? "Synchronisation…" : "Synchroniser"}</button>}
      tabs={<PageTabs items={tabs}/>}
    />

    <div className="metric-grid metric-grid--compact notification-kpis">
      <Card className="metric-card" data-tone={summary.page ? "negative" : "positive"}><span>Page</span><strong>{summary.page}</strong><small>Escalade immédiate</small></Card>
      <Card className="metric-card" data-tone={summary.action ? "warning" : "neutral"}><span>Action</span><strong>{summary.action}</strong><small>{summary.pending} en attente</small></Card>
      <Card className="metric-card"><span>Surveillance</span><strong>{summary.watch}</strong><small>Surveillance active</small></Card>
      <Card className="metric-card"><span>Lues</span><strong>{summary.read}</strong><small>Acquittées localement</small></Card>
      <Card className="metric-card"><span>Clôturées</span><strong>{summary.cleared}</strong><small>Incidents résolus</small></Card>
    </div>

    <TelegramControl/>

    <div className="notification-center-layout notification-center-layout--ledger">
      <Card className="notification-ledger-panel">
        <header className="incident-command-toolbar notification-toolbar">
          <div>
            <p className="eyebrow">File locale</p>
            <h2>{items.length} notifications</h2>
          </div>
          <div>
            <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut notification"><option value="active">Actives</option><option value="pending">À lire</option><option value="read">Lues</option><option value="dismissed">Masquées</option><option value="cleared">Clôturées</option><option value="all">Toutes</option></select></label>
            <label>Niveau<select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Filtrer par niveau"><option value="all">Tous</option><option value="page">Page</option><option value="action">Action</option><option value="watch">Surveillance</option><option value="muted">Muettes</option><option value="cleared">Clôturées</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="incident, run, worker…" aria-label="Rechercher une notification"/></label>
          </div>
        </header>
        {!items.length ? <div className="workspace-empty incident-empty"><Icon name="bell"/><h3>File de notifications vide</h3><p>Lance la synchronisation pour matérialiser les notifications des incidents actifs.</p></div> : <div className="data-table-wrap notification-ledger-wrap">
          <table className="data-table notification-ledger-table">
            <thead><tr><th>Notification</th><th>Niveau</th><th>Incident</th><th>Contexte</th><th>État</th><th>Détail</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} data-level={item.escalationLevel}>
              <td data-label="Notification"><strong><i data-level={item.escalationLevel}/>{item.title}</strong><small>{item.reasonCodes.join(" · ") || shortReference(item.sourceId)}</small></td>
              <td data-label="Niveau"><span className="terminal-code">{levelLabel(item.escalationLevel)}</span><small>prio {item.priority}</small></td>
              <td data-label="Incident">{item.incidentKind || "incident"}<small>{shortReference(item.incidentSourceId || item.incidentId)}</small></td>
              <td data-label="Contexte">{item.runId ? replayLabel(item.runId) : item.workflow ? workflowLabel(item.workflow) : "Desk"}<small>{item.processId ? gptProcessLabel(item.processId) : item.worker ? "Worker attribué" : "Local"}</small></td>
              <td data-label="État"><StatusTag status={item.status}/><small>{formatDateTime(item.updatedAt)}</small></td>
              <td data-label="Détail"><Link className="row-link" to={`/operations/notifications/${encodeURIComponent(item.id)}`} state={{ returnTo }}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>
    </div>
  </section>;
}

export function NotificationZoomPage() {
  const { notificationId = "" } = useParams();
  const location = useLocation();
  const id = decodeURIComponent(notificationId);
  const returnTo = ((location.state as { returnTo?: string } | null)?.returnTo) || "/operations/notifications";
  const query = useNotifications({ status: null, level: null, q: null });
  const client = useQueryClient();
  const [action, setAction] = useState<NotificationAction>("mark_read");
  const [commandOpen, setCommandOpen] = useState(false);
  const notification = query.data?.items.find(item => item.id === id || item.sourceId === id) || null;
  const command = useMutation({
    mutationFn: (input: NotificationActionInput) => operationsApi.executeNotificationAction(notification!.id, input),
    onSuccess: async () => {
      setCommandOpen(false);
      await client.invalidateQueries({ queryKey: operationsKeys.all });
    },
  });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Notification indisponible"} retry={() => query.refetch()}/>;
  if (!notification) return <section className="view workspace-view notification-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Notifications", to: returnTo }, { label: "Introuvable" }]}/>
    <PageHeading eyebrow="Notification détaillée" title="Notification introuvable" subtitle="Cette référence ne figure pas dans la fenêtre chargée." backTo={returnTo}/>
  </section>;

  const openCommand = (_notification: OperationsNotification, nextAction: NotificationAction) => {
    setAction(nextAction);
    setCommandOpen(true);
  };
  const expected = `CONFIRM_${action.toUpperCase()}`;

  return <section className="view workspace-view notification-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Notifications", to: returnTo }, { label: notification.title }]}/>
    <PageHeading
      eyebrow="Notification détaillée"
      title={notification.title}
      subtitle={notification.message || levelLabel(notification.escalationLevel)}
      backTo={returnTo}
      actions={<><Link className="secondary-btn" to={returnTo}>Retour à la liste</Link><StatusTag status={notification.status}/></>}
    />
    <Card className="notification-detail-panel notification-detail-panel--zoom">
      <NotificationDetail notification={notification} onCommand={openCommand}/>
    </Card>
    <Modal open={commandOpen} title={`${actionLabels[action]} · ${notification.title}`} onClose={() => !command.isPending && setCommandOpen(false)}>
      <>
        <label className="confirm-action__action">Action
          <select value={action} onChange={(event) => setAction(event.target.value as NotificationAction)}>
            {notification.allowedActions.includes("mark_read") && <option value="mark_read">Marquer lu</option>}
            {notification.allowedActions.includes("dismiss") && <option value="dismiss">Masquer</option>}
          </select>
        </label>
        <ConfirmActionForm
          key={`${notification.id}:${action}`}
          target={notification.title}
          revision={notification.revision}
          expectedPhrase={expected}
          onCancel={() => setCommandOpen(false)}
          confirmLabel={actionLabels[action]}
          onConfirm={({ confirmationPhrase, reason }) => command.mutateAsync({
            action,
            reason,
            confirmationPhrase,
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: notification.revision,
          }).then(() => undefined)}
        />
      </>
    </Modal>
  </section>;
}

function TelegramControl() {
  const client = useQueryClient();
  const query = useTelegramStatus();
  const [enabled, setEnabled] = useState(false);
  const [adminEnabled, setAdminEnabled] = useState(true);
  const [tradingEnabled, setTradingEnabled] = useState(true);
  const [commandsEnabled, setCommandsEnabled] = useState(true);

  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.config.enabled);
    setAdminEnabled(query.data.config.adminEnabled);
    setTradingEnabled(query.data.config.tradingEnabled);
    setCommandsEnabled(query.data.config.commandsEnabled);
  }, [query.data?.config.revision]);

  const mutation = useMutation({
    mutationFn: (input: TelegramActionInput) => operationsApi.executeTelegramAction(input),
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.telegram }),
  });

  if (query.isLoading) return <Card className="telegram-control"><LoadingView/></Card>;
  if (query.isError || !query.data) return <Card className="telegram-control"><ErrorView message={query.error?.message || "État Telegram indisponible"} retry={() => query.refetch()}/></Card>;
  const status = query.data;
  const invoke = (input: TelegramActionInput) => mutation.mutate(input);
  const common = { idempotencyKey: crypto.randomUUID(), reason: "Action opérateur depuis le centre de notifications" };

  return <Card className="telegram-control">
    <header className="telegram-control__head">
      <div>
        <p className="eyebrow">Canaux externes</p>
        <h2>Alerting Telegram</h2>
        <p>Deux canaux séparés : administration du desk et événements de trading Sim101.</p>
      </div>
      <StatusTag status={status.effective.enabled ? "healthy" : status.effective.muted ? "muted" : "disabled"}/>
    </header>
    <div className="telegram-control__grid">
      <TelegramBotCard profile="Administration" bot={status.bots.admin} ready={status.effective.adminReady}/>
      <TelegramBotCard profile="Trading" bot={status.bots.trading} ready={status.effective.tradingReady}/>
      <div className="telegram-worker-card">
        <span>Worker</span>
        <strong>{status.worker?.status || "ABSENT"}</strong>
        <small>Heartbeat {formatDateTime(status.worker?.heartbeatAt || null)}</small>
        <small>{status.outbox.counts.pending || 0} pending · {status.outbox.counts.failed || 0} échec(s)</small>
      </div>
    </div>
    <div className="telegram-control__settings">
      <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}/> Alerting actif</label>
      <label><input type="checkbox" checked={adminEnabled} onChange={(event) => setAdminEnabled(event.target.checked)}/> Bot administration</label>
      <label><input type="checkbox" checked={tradingEnabled} onChange={(event) => setTradingEnabled(event.target.checked)}/> Bot trading</label>
      <label><input type="checkbox" checked={commandsEnabled} onChange={(event) => setCommandsEnabled(event.target.checked)}/> Commandes lecture seule</label>
    </div>
    <div className="telegram-control__actions">
      <button className="primary-btn" disabled={mutation.isPending} onClick={() => invoke({
        action: "configure",
        expectedRevision: status.config.revision,
        enabled,
        adminEnabled,
        tradingEnabled,
        commandsEnabled,
        confirmationPhrase: "CONFIRM_TELEGRAM_CONFIGURATION",
        ...common,
      })}>Enregistrer</button>
      <button className="secondary-btn" disabled={mutation.isPending || !status.environment.adminConfigured} onClick={() => invoke({
        action: "test",
        profile: "admin",
        confirmationPhrase: "CONFIRM_TELEGRAM_TEST",
        ...common,
      })}>Tester administration</button>
      <button className="secondary-btn" disabled={mutation.isPending || !status.environment.tradingConfigured} onClick={() => invoke({
        action: "test",
        profile: "trading",
        confirmationPhrase: "CONFIRM_TELEGRAM_TEST",
        ...common,
      })}>Tester trading</button>
      {status.effective.muted
        ? <button className="secondary-btn" disabled={mutation.isPending} onClick={() => invoke({
            action: "resume",
            expectedRevision: status.config.revision,
            confirmationPhrase: "CONFIRM_TELEGRAM_RESUME",
            ...common,
          })}>Réactiver</button>
        : <button className="secondary-btn" disabled={mutation.isPending} onClick={() => invoke({
            action: "mute",
            expectedRevision: status.config.revision,
            minutes: 60,
            confirmationPhrase: "CONFIRM_TELEGRAM_MUTE",
            ...common,
          })}>Silence 1 h</button>}
    </div>
    {mutation.isError && <p className="field-error">{mutation.error.message}</p>}
    <div className="telegram-delivery-strip">
      {status.outbox.recent.slice(0, 6).map((delivery) => <div key={delivery.deliveryId}>
        <StatusTag status={delivery.status}/>
        <strong>{delivery.profile === "admin" ? "ADMIN" : "TRADING"} · {delivery.sourceKind}</strong>
        <span>{delivery.message.split("\n")[0]}</span>
        <time>{formatDateTime(delivery.sentAt || delivery.createdAt)}</time>
      </div>)}
      {!status.outbox.recent.length && <p className="empty-copy">Aucun envoi Telegram enregistré.</p>}
    </div>
  </Card>;
}

function TelegramBotCard({
  profile,
  bot,
  ready,
}: {
  profile: string;
  bot: TelegramStatus["bots"]["admin"];
  ready: boolean;
}) {
  return <div className="telegram-bot-card" data-ready={ready}>
    <span>{profile}</span>
    <strong>{bot.username ? `@${bot.username}` : "Non configuré"}</strong>
    <small>{bot.displayName || (bot.configured ? "Identité en attente" : "Secret absent")}</small>
  </div>;
}

function NotificationDetail({ notification, onCommand }: { notification: OperationsNotification; onCommand: (notification: OperationsNotification, action: NotificationAction) => void }) {
  const timeline = notification.timeline || [];
  return <>
    <header className="incident-detail-head notification-detail-head">
      <div>
        <p className="eyebrow">{levelLabel(notification.escalationLevel)} · rev {notification.revision}</p>
        <h2>{notification.title}</h2>
        <p>{notification.message || "Aucun message détaillé."}</p>
      </div>
      <StatusTag status={notification.status}/>
    </header>
    <div className="incident-action-strip">
      {notification.allowedActions.includes("mark_read") && <button className="secondary-btn" onClick={() => onCommand(notification, "mark_read")}>Marquer lu</button>}
      {notification.allowedActions.includes("dismiss") && <button className="danger-btn" onClick={() => onCommand(notification, "dismiss")}>Masquer</button>}
      {notification.incidentId && <Link className="secondary-btn" to={`/operations/incidents?incident=${encodeURIComponent(notification.incidentId)}`}>Ouvrir incident</Link>}
    </div>
    <dl className="incident-evidence-grid notification-evidence-grid">
      <div><dt>Niveau</dt><dd>{levelLabel(notification.escalationLevel)}</dd></div>
      <div><dt>Priorité</dt><dd>{notification.priority}</dd></div>
      <div><dt>Responsable</dt><dd>{notification.owner || "Non assigné"}</dd></div>
      <div><dt>Canal</dt><dd>{notification.channel}</dd></div>
      <div><dt>Replay</dt><dd>{notification.runId ? replayLabel(notification.runId) : "N/D"}</dd></div>
      <div><dt>Analyse GPT</dt><dd>{notification.processId ? gptProcessLabel(notification.processId) : "N/D"}</dd></div>
      <div><dt>Automatisation</dt><dd>{notification.workflow ? workflowLabel(notification.workflow) : "N/D"}</dd></div>
      <div><dt>Déduplication</dt><dd>{notification.dedupeKey ? "Active" : "N/D"}</dd></div>
    </dl>
    <TechnicalDetails items={[
      { label: "Notification", value: notification.id },
      { label: "Source", value: notification.sourceId },
      { label: "Incident", value: notification.incidentId },
      { label: "Run", value: notification.runId },
      { label: "Processus", value: notification.processId },
      { label: "Workflow", value: notification.workflow },
      { label: "Clé de déduplication", value: notification.dedupeKey },
      { label: "Empreinte", value: notification.fingerprint },
    ]}/>
    <section className="incident-policy-evidence notification-policy-evidence">
      <header><p className="eyebrow">Éléments de preuve</p><span>{notification.fingerprint?.slice(0, 12) || "Sans empreinte"}</span></header>
      <pre>{JSON.stringify(notification.evidence || {}, null, 2)}</pre>
    </section>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Historique d’envoi</p><span>{timeline.length} événements</span></header>
      {!timeline.length ? <p className="empty-copy">Aucun événement matérialisé.</p> : <ol className="incident-timeline">
        {timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function levelLabel(level: string) {
  if (level === "page") return "PAGE";
  if (level === "action") return "ACTION";
  if (level === "muted") return "MUTED";
  if (level === "cleared") return "CLEARED";
  return "WATCH";
}
