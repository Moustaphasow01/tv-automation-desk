import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { JourneyBackLink, JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyFreshness, JourneyMessage, JourneyProvenance, useJourneySurface } from "@/features/trading-journey/JourneySurface";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";
import { LiveSignalDetailWorkspace } from "@/features/live-trading/LiveSignalDetailWorkspace";
import { resolveSignalTemporalState } from "@/features/live-trading/signalTemporalState";
import { operatorCode } from "@/design-system/operatorVocabulary";
import "@/features/live-trading/signal-detail.css";
import "@/features/live-trading/signal-journey.css";

type SignalAction = LiveSignalDetailView["commandActions"][number];

export function LiveSignalDetailPage() {
  const { signalId } = useParams();
  return <SignalDossierReading key={signalId} signalId={signalId} />;
}

function SignalDossierReading({ signalId }: { signalId: string | undefined }) {
  useJourneySurface();
  const query = useFrontView("live-signal-detail", { signalId });
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : confirmer la décision affichée par le backend.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const nowMs = useAnchoredClock(query.data?.meta.asOf ?? "");

  if (query.isLoading) return <LiveSignalLoading />;
  if (query.isError) return <LiveSignalError retry={() => void query.refetch()} />;
  if (!query.data) return <LiveSignalEmpty />;

  const { data, meta } = query.data;
  const temporal = resolveSignalTemporalState(data.signal, nowMs);
  const remainingSec = temporal.effectiveState === "EXPIRED"
    ? 0
    : Math.max(0, Math.floor((Date.parse(data.signal.expiresAt) - nowMs) / 1000));
  const requestedSignalId = signalId ?? data.identity.signalId;
  const idMismatch = requestedSignalId !== data.identity.signalId;

  const confirmAction = async (action: SignalAction) => {
    if (idMismatch) return;
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
    <div className="desk-journey live-signal-page signal-dossier-page">
      <JourneyBackLink />
      <header className="dj-header"><div><h1>{data.signal.symbol} · {operatorCode(data.signal.direction)}</h1><p>Dossier signal · données au {formatDateTime(data.featureSnapshot.cutoffAt)}</p></div><div className="dj-header-actions"><JourneyLink to={signalChartRoute(data)}>Voir le graphique</JourneyLink></div></header>
      <JourneyFreshness meta={meta} />
      {idMismatch ? <div className="signal-contract-warning" role="alert" title={`Demandé : ${requestedSignalId} · reçu : ${data.identity.signalId}`}><strong>Incohérence d’identité</strong><span>Le service du desk a retourné un autre signal que celui demandé. Aucune action n’est autorisée.</span></div> : null}
      {!idMismatch ? <LiveSignalDetailWorkspace
        data={data}
        temporal={temporal}
        remainingSec={remainingSec}
        reason={reason}
        command={command}
        commandError={commandError}
        submittingActionId={submittingActionId}
        onReason={setReason}
        onConfirm={(action) => { void confirmAction(action); }}
      /> : null}
      <JourneyProvenance meta={meta} />
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

function LiveSignalLoading() { return <div className="desk-journey"><JourneyBackLink /><div className="dj-loading" role="status">Chargement du signal…</div></div>; }
function LiveSignalError({ retry }: { retry(): void }) { return <div className="desk-journey"><JourneyBackLink /><JourneyMessage title="Signal indisponible" retry={retry}>Le desk n’a pas pu fournir le signal demandé. Revenez à votre séance ou réessayez.</JourneyMessage></div>; }
function LiveSignalEmpty() { return <div className="desk-journey"><JourneyBackLink /><JourneyMessage title="Signal non publié">Aucun dossier n’est disponible pour cet identifiant.</JourneyMessage></div>; }

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
