import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/design-system/primitives";
import { OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";
import { LiveSignalDetailWorkspace } from "@/features/live-trading/LiveSignalDetailWorkspace";
import { resolveSignalTemporalState } from "@/features/live-trading/signalTemporalState";
import "@/features/live-trading/signal-detail.css";

type SignalAction = LiveSignalDetailView["commandActions"][number];

export function LiveSignalDetailPage() {
  const { signalId } = useParams();
  const query = useFrontView("live-signal-detail", { signalId });
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : confirmer la décision affichée par le backend.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const nowMs = useAnchoredClock(query.data?.meta.asOf ?? "2026-08-10T09:40:00.000Z");

  if (query.isLoading) return <LiveSignalLoading />;
  if (query.isError) return <LiveSignalError message={(query.error as Error).message} />;
  if (!query.data) return <LiveSignalEmpty />;

  const { data, meta } = query.data;
  const temporal = resolveSignalTemporalState(data.signal, nowMs);
  const remainingSec = temporal.effectiveState === "EXPIRED"
    ? 0
    : Math.max(0, Math.floor((Date.parse(data.signal.expiresAt) - nowMs) / 1000));
  const requestedSignalId = signalId ?? data.identity.signalId;
  const idMismatch = requestedSignalId !== data.identity.signalId;

  const confirmAction = async (action: SignalAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildLiveSignalCommand(action, data, reason));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "LIVE_SIGNAL_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page live-signal-page signal-dossier-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title={`Dossier signal · ${data.signal.symbol} ${data.signal.direction}`}
        description={`${data.identity.signalId} · source au ${formatDateTime(data.featureSnapshot.cutoffAt)} · projection ${meta.latencyMs} ms.`}
        actions={(
          <>
            <Link to={`/live?signalId=${encodeURIComponent(data.identity.signalId)}`}>Retour au Live</Link>
            <Link className="operator-primary-action" to={signalChartRoute(data)}>Voir le graphique</Link>
          </>
        )}
      />
      {idMismatch ? <div className="signal-contract-warning" role="alert"><strong>Incohérence d’identité</strong><span>La route demande {requestedSignalId}, mais le BFF a répondu pour {data.identity.signalId}.</span></div> : null}
      <LiveSignalDetailWorkspace
        data={data}
        temporal={temporal}
        remainingSec={remainingSec}
        reason={reason}
        command={command}
        commandError={commandError}
        submittingActionId={submittingActionId}
        onReason={setReason}
        onConfirm={(action) => { void confirmAction(action); }}
      />
    </div>
  );
}

export function buildLiveSignalCommand(action: SignalAction, data: LiveSignalDetailView, reason: string): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw Object.assign(new Error("LIVE_SIGNAL_REASON_REQUIRED"), { code: "LIVE_SIGNAL_REASON_REQUIRED" });
  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: data.identity.expectedVersion,
    reason: normalizedReason,
    payload: {
      signalId: data.identity.signalId,
      strategyId: data.identity.strategyId,
      strategyDefinitionId: data.identity.strategyDefinitionId,
      strategyVersionId: data.identity.strategyVersionId,
      strategyInstanceId: data.identity.strategyInstanceId,
      runtimeBundleId: data.identity.runtimeBundleId,
      sessionId: data.identity.sessionId,
      correlationId: data.identity.correlationId,
      featureSnapshotId: data.identity.featureSnapshotId,
      actionId: action.actionId,
      decision: action.decision,
      ...action.payload,
    },
  };
}

function LiveSignalLoading() { return <div className="operator-page signal-dossier-page" aria-busy="true" aria-live="polite"><div className="signal-dossier-skeleton" /><div className="signal-dossier-skeleton signal-dossier-skeleton--tall" /></div>; }
function LiveSignalError({ message }: { message: string }) { return <Card title="Signal indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact"><p>{message}</p></Card>; }
function LiveSignalEmpty() { return <Card title="Aucun signal" eyebrow="ÉTAT VIDE" state="empty" density="compact"><p>Le BFF ne retourne pas de projection pour cet identifiant.</p></Card>; }

function useAnchoredClock(anchorIso: string) {
  const anchorMs = Date.parse(anchorIso);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [anchorIso]);
  return (Number.isNaN(anchorMs) ? Date.now() : anchorMs) + elapsedMs;
}

function signalChartRoute(data: LiveSignalDetailView): string {
  const params = new URLSearchParams({ instrument: data.signal.symbol, signalId: data.identity.signalId, chartAt: data.featureSnapshot.cutoffAt || data.signal.generatedAt });
  return `/live?${params.toString()}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Non publié" : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
