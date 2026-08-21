import { Link } from "react-router-dom";
import { FaBolt, FaBroadcastTower, FaCheckCircle, FaClipboardCheck, FaPlug, FaShieldAlt, FaTimesCircle } from "react-icons/fa";
import { Card, KpiCard, StatusBadge } from "@/design-system/primitives";
import { presentFreshness } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView } from "@/domains/front-api/repositories";
import type { DemoPaperReadinessView } from "@/domains/front-api/viewModels";

type ActionItem = DemoPaperReadinessView["actionItems"][number];

export function DemoPaperReadinessPage() {
  const query = useFrontView("demo-paper-readiness");

  if (query.isLoading) {
    return <DemoPaperReadinessLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Préparation indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée readiness" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/demo-paper-readiness`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const ready = data.summary.status === "READY";

  return (
    <div className="operator-page demo-paper-readiness-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Préparation Démo/PAPIER"
        description={`${data.summary.tradingDate} · ${data.summary.session} · décision ${data.summary.finalDecision} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/live">Trading en direct</Link>
            <Link to="/execution/providers">Exécution</Link>
            <Link className="operator-primary-action" to="/events">Preuves</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs readiness démo paper">
        <KpiCard label="DÉCISION" value={ready ? "OUVRIR" : "FERMÉ"} delta={data.summary.finalDecision} tone={ready ? "success" : "danger"} />
        <KpiCard label="BLOCAGES" value={`${data.summary.blockersCount}`} delta={ready ? "aucun blocker" : "agents fermés/shadow"} tone={ready ? "success" : "danger"} />
        <KpiCard label="FLUX MARCHÉ" value={data.marketData.state.toUpperCase()} delta={`${data.marketData.coreAgeSeconds}s · durable=${String(data.marketData.sourceDurable)}`} tone={data.marketData.sourceDurable ? "success" : "danger"} />
        <KpiCard label="SIM101" value={data.broker.sim101Account ? "OK" : "BLOCK"} delta={`${data.broker.accountName} · ${data.broker.addonStatus}`} tone={data.broker.sim101Account && data.broker.commandEnabled ? "success" : "danger"} />
        <KpiCard label="ADDON" value={presentFreshness(data.broker.addonHeartbeatFresh ? "FRESH" : "STALE").label} delta={`connected=${String(data.broker.addonConnected)} · command=${String(data.broker.commandEnabled)}`} tone={data.broker.addonHeartbeatFresh && data.broker.commandEnabled ? "success" : "danger"} />
        <KpiCard label="GATE" value={data.summary.status} delta={formatTime(data.summary.checkedAt)} tone={ready ? "success" : "danger"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Gate et actions opérateur">
        <Card
          title={ready ? "Agents PAPER autorisés" : "Agents PAPER interdits"}
          eyebrow="Gate release global"
          tone={ready ? "success" : "danger"}
          density="compact"
          actions={<StatusBadge tone={ready ? "success" : "danger"}>{data.summary.status}</StatusBadge>}
        >
          <div className="readiness-decision">
            <div>
              <FaShieldAlt />
              <strong>{data.summary.finalDecision}</strong>
              <small>{data.summary.nextCheckCommand}</small>
            </div>
            <div className="readiness-components">
              {data.components.map((component) => (
                <article key={component.componentId}>
                  <StatusBadge tone={component.status === "READY" ? "success" : component.status === "BLOCKED" ? "danger" : "warning"}>{component.status}</StatusBadge>
                  <div>
                    <strong>{component.label}</strong>
                    <small>{component.blockers.length ? component.blockers.join(" · ") : component.componentId}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Actions à terminer" eyebrow="Checklist opérateur" density="compact" actions={<InlineAction>{data.actionItems.length} actions</InlineAction>}>
          {data.actionItems.length ? (
            <ol className="readiness-actions">
              {data.actionItems.map((action) => <ReadinessAction key={action.actionId} action={action} />)}
            </ol>
          ) : (
            <p className="empty-state">Aucune action bloquante. Le gate release peut ouvrir les agents PAPER.</p>
          )}
        </Card>

        <Card title="Commandes de vérification" eyebrow="Vérité CLI" density="compact">
          <div className="readiness-command-list">
            {Object.entries(data.commands).map(([key, command]) => (
              <article key={key}>
                <strong>{key}</strong>
                <code>{command}</code>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Preuves TradingView et NinjaTrader">
        <Card title="Flux TradingView core" actions={<InlineAction>{data.marketData.coreFeeds.length} feeds</InlineAction>} density="compact">
          <div className="readiness-feed-grid">
            {data.marketData.coreFeeds.map((feed) => (
              <article key={`${feed.instrument}_${feed.timeframe}`}>
                <header>
                  <FaBroadcastTower />
                  <strong>{feed.instrument} · {feed.timeframe}</strong>
                  <StatusBadge tone={feed.durable ? "success" : "danger"}>{feed.classification}</StatusBadge>
                </header>
                <small>{feed.latestTimestampUtc}</small>
                <small>{feed.source}</small>
                <small>reçu={feed.latestReceivedAtUtc}</small>
                <small>alert={feed.alertId}</small>
              </article>
            ))}
          </div>
        </Card>

        <Card title="NinjaTrader / AddOn" density="compact">
          <div className="readiness-broker-grid">
            <MetricBox label="Compte" value={data.broker.accountName} />
            <MetricBox label="Démarrage" value={data.broker.startupState} />
            <MetricBox label="Login requis" value={String(data.broker.loginRequired)} />
            <MetricBox label="Simulation prête" value={String(data.broker.connectionReady)} />
            <MetricBox label="Heartbeat" value={String(data.broker.addonHeartbeatFresh)} />
            <MetricBox label="Commandes" value={String(data.broker.commandEnabled)} />
            <MetricBox label="Autorité" value={data.broker.executionAuthorityMode} />
            <MetricBox label="Approbation entrée" value={String(data.broker.entryOperatorApprovalRequired)} />
          </div>
        </Card>

        <Card title="Zooms utiles" density="compact">
          <div className="readiness-links">
            {data.links.map((link) => (
              <Link key={link.route} to={link.route}>
                <FaClipboardCheck />
                <span><strong>{link.label}</strong><small>{link.reason}</small></span>
              </Link>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function ReadinessAction({ action }: { action: ActionItem }) {
  return (
    <li>
      <span>{action.domain === "broker" ? <FaPlug /> : action.domain === "market-data" ? <FaBroadcastTower /> : <FaBolt />}</span>
      <div>
        <strong>{action.title}</strong>
        <small>{action.blockerId} · {action.evidence}</small>
        <p>{action.operatorAction}</p>
        {action.command ? <code>{action.command}</code> : null}
      </div>
      <Link to={action.route}>Ouvrir</Link>
    </li>
  );
}

function DemoPaperReadinessLoading() {
  return (
    <div className="operator-page demo-paper-readiness-page">
      <OperatorPageHeader title="Préparation Démo/PAPIER" description="Chargement du gate release et des preuves opérateur." />
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <KpiCard key={index} label="LOADING" value="—" delta="projection en cours" />)}
      </section>
      <Card title="Chargement readiness" density="compact"><p>Lecture du BFF `/views/demo-paper-readiness`…</p></Card>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
