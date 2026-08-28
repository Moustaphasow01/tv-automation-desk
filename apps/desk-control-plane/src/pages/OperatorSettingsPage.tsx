import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBell,
  FaDesktop,
  FaFingerprint,
  FaKeyboard,
  FaMicrophone,
  FaMobileAlt,
  FaMoon,
  FaRedoAlt,
  FaShieldAlt,
  FaSlidersH,
  FaSyncAlt,
  FaTabletAlt,
  FaVolumeUp
} from "react-icons/fa";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import {
  presentAvailability,
  presentDeviceState,
  presentNotificationSeverity,
  presentPermission,
  presentQueueStatus
} from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { OperatorSettingsView } from "@/domains/front-api/viewModels";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";

type SettingsPreference = OperatorSettingsView["cockpitPreferences"][number];
type SettingsAction = OperatorSettingsView["commandActions"][number];
type SettingsDevice = OperatorSettingsView["devices"][number];

export function OperatorSettingsPage() {
  const query = useFrontView("operator-settings");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : modification de préférence non critique via le flux de commande BFF.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <SettingsLoading />;
  }

  if (query.isError) {
    return (
      <div className="operator-page operator-settings-page">
        <h1 className="sr-only">Réglages opérateur</h1>
        <Card title="Réglages indisponibles" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
          <p>{(query.error as Error).message}</p>
        </Card>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="operator-page operator-settings-page">
        <h1 className="sr-only">Réglages opérateur</h1>
        <Card title="Aucun réglage" eyebrow="EMPTY" state="empty" density="compact">
          <p>Le BFF ne retourne pas encore la projection `/views/operator-settings`.</p>
        </Card>
      </div>
    );
  }

  const { data, meta } = query.data;
  const saveAction = data.commandActions.find((action) => action.commandType === "settings.preferences.save");
  const revokeAction = data.commandActions.find((action) => action.commandType === "settings.device.revoke");

  const confirmAction = async (action: SettingsAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildOperatorSettingsCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "SETTINGS_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page operator-settings-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Réglages opérateur"
        description={`${data.summary.theme} · ${data.summary.density} · ${data.summary.language} · projection ${meta.latencyMs} ms · préférences non critiques uniquement.`}
        actions={
          <>
            <Link to="/auth">Authentification</Link>
            <Link to="/jarvis">Jarvis</Link>
            {saveAction ? (
              <DeskButton variant="primary" disabled={isActionDisabled(saveAction, reason, stepUpToken)} onClick={() => confirmAction(saveAction)}>
                Enregistrer préférences
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Réglages opérateur">
        <KpiCard label="THÈME" value={data.summary.theme} delta={data.summary.density} tone="success" />
        <KpiCard label="LANGUE" value={data.summary.language} delta={data.summary.timezone} tone="info" />
        <KpiCard label="NOTIFS" value={data.summary.notificationsEnabled ? "Activé" : "Désactivé"} delta={`${data.notificationRules.length} règles`} tone={data.summary.notificationsEnabled ? "success" : "warning"} />
        <KpiCard label="VOICE" value={presentAvailability(data.summary.voiceState).label} delta={data.jarvis.pushToTalkEnabled ? "push-to-talk activé" : "push-to-talk désactivé"} tone={data.summary.voiceState === "DEGRADED" ? "warning" : "success"} />
        <KpiCard label="APPAREILS" value={`${data.summary.activeDevices}`} delta={`${data.summary.activeSessions} sessions`} tone="accent" />
        <KpiCard label="PRIVACY" value={data.summary.privacyMode} delta="préférence locale uniquement" detail={<ProgressBar value={100} tone="success" />} tone="success" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Préférences cockpit, widgets et notifications">
        <Card title="Préférences cockpit" actions={<InlineAction>Optimiste autorisé</InlineAction>} density="compact">
          <DataTable rows={data.cockpitPreferences} rowKey={(row) => row.preferenceId} columns={preferenceColumns} />
          <MobileDataList
            rows={data.cockpitPreferences}
            rowKey={(row) => row.preferenceId}
            renderTitle={(row) => `${row.label} · ${row.value}`}
            renderMeta={(row) => `${row.category} · optimiste ${row.optimisticAllowed ? "oui" : "non"}`}
            renderBody={(row) => `Valeurs : ${row.allowedValues.join(", ")}`}
          />
          <div className="settings-guard-note">
            <FaShieldAlt />
            <span>Optimistic UI uniquement pour préférences non critiques : thème, densité, langue, formats et widgets.</span>
          </div>
        </Card>

        <Card title="Widgets du tableau de bord" actions={<InlineAction>{data.widgets.length} widgets</InlineAction>} density="compact">
          <div className="settings-widget-list">
            {data.widgets.map((widget) => (
              <article key={widget.widgetId}>
                <FaDesktop />
                <div><strong>{widget.label}</strong><small>{widget.area} · ordre {widget.order} · rafraîchissement {widget.refreshSeconds}s</small></div>
                <StatusBadge tone={widget.visible ? "success" : "warning"}>{widget.visible ? "VISIBLE" : "MASQUÉ"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Notifications & alertes" actions={<InlineAction>Canaux</InlineAction>} density="compact">
          <div className="settings-notification-list">
            {data.notificationRules.map((rule) => (
              <article key={rule.ruleId}>
                {notificationIcon(rule.channel)}
                <div><strong>{rule.label}</strong><small>{rule.channel} · {rule.quietHours ?? "aucune plage silencieuse"}</small></div>
                <StatusBadge tone={rule.severity === "CRITICAL" ? "danger" : rule.severity === "WARNING" ? "warning" : "accent"}>{presentNotificationSeverity(rule.severity).label}</StatusBadge>
                <StatusBadge tone={rule.enabled ? "success" : "warning"}>{rule.enabled ? "Activé" : "Désactivé"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Jarvis, appareils et commandes">
        <Card title="Voix & raccourcis Jarvis" actions={<InlineAction>{presentAvailability(data.jarvis.voiceState).label}</InlineAction>} density="compact">
          <div className="settings-jarvis-card">
            <FaMicrophone />
            <div>
              <strong>Push-to-talk {data.jarvis.pushToTalkEnabled ? "activé" : "désactivé"}</strong>
              <small>Wake word {data.jarvis.wakeWordEnabled ? "activé" : "désactivé"} · rétention {data.jarvis.transcriptRetention} · vérification {formatTime(data.jarvis.lastVoiceCheckAt)}</small>
            </div>
            <StatusBadge tone={data.jarvis.voiceState === "DEGRADED" ? "warning" : "success"}>{presentAvailability(data.jarvis.voiceState).label}</StatusBadge>
          </div>
          <div className="settings-shortcut-list">
            {data.shortcuts.map((shortcut) => (
              <Link key={shortcut.shortcutId} to={shortcut.route}>
                <FaKeyboard />
                <div><strong>{shortcut.label}</strong><small>{shortcut.keys} · {shortcut.route}</small></div>
                <StatusBadge tone={shortcut.enabled ? "success" : "warning"}>{shortcut.enabled ? "Activé" : "Désactivé"}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Appareils, sessions & confidentialité" actions={<InlineAction>{data.summary.activeDevices} appareils</InlineAction>} density="compact">
          <div className="settings-device-list">
            {data.devices.map((device) => (
              <article key={device.deviceId}>
                {deviceIcon(device)}
                <div><strong>{device.label}</strong><small>{device.deviceId} · {device.sessionId ?? "aucune session active"} · {formatTime(device.lastSeenAt)}</small></div>
                <StatusBadge tone={device.trusted ? "success" : "warning"}>{device.trusted ? "DE CONFIANCE" : "À SURVEILLER"}</StatusBadge>
                <StatusBadge tone={device.state === "ACTIVE" ? "success" : device.state === "REVOKABLE" ? "warning" : "accent"}>{presentDeviceState(device.state).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="settings-privacy-list">
            {data.privacy.map((policy) => (
              <MetricBox key={policy.policyId} label={policy.label} value={policy.value} />
            ))}
          </div>
        </Card>

        <Card title="Actions réglages" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="settings-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande settings</small>
              <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Motif obligatoire" value={reason} onChange={setReason} />
          <label className="settings-step-up">
            <span>Step-up phrase pour révocation</span>
            <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={revokeAction?.actionId ?? "actionId step-up"} />
          </label>
          <div className="settings-guardrail-list">
            {data.guardrails.map((guardrail) => (
              <article key={guardrail.guardrailId}>
                <FaShieldAlt />
                <div><strong>{guardrail.label}</strong><small>{guardrail.detail}</small></div>
                <StatusBadge tone={guardrail.status === "PASS" ? "success" : guardrail.status === "WATCH" ? "warning" : "danger"}>{presentQueueStatus(guardrail.status).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="settings-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.commandType.includes("revoke") ? "settings-action-list__revoke" : undefined}>
                <span>{actionIcon(action)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · optimiste {action.optimisticAllowed ? "oui" : "non"}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                <DeskButton
                  variant={action.criticality === "HIGH" ? "danger" : "primary"}
                  disabled={isActionDisabled(action, reason, stepUpToken) || submittingActionId === action.actionId}
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

export function buildOperatorSettingsCommand(action: SettingsAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("SETTINGS_REASON_REQUIRED"), { code: "SETTINGS_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("SETTINGS_PERMISSION_DENIED"), { code: "SETTINGS_PERMISSION_DENIED" });
  }

  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) {
    throw Object.assign(new Error("SETTINGS_STEP_UP_REQUIRED"), { code: "SETTINGS_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      optimisticAllowed: action.optimisticAllowed,
      criticality: action.criticality,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const preferenceColumns = [
  { key: "pref", header: "Préférence", render: (row: SettingsPreference) => <PreferenceCell row={row} /> },
  { key: "category", header: "Catégorie", render: (row: SettingsPreference) => row.category },
  { key: "value", header: "Valeur", render: (row: SettingsPreference) => row.value },
  { key: "optimistic", header: "Optimiste", render: (row: SettingsPreference) => row.optimisticAllowed ? "OUI" : "NON" }
] as const;

function PreferenceCell({ row }: { row: SettingsPreference }) {
  return (
    <div className="settings-preference-cell">
      <strong>{row.label}</strong>
      <small>{row.preferenceId} · {row.allowedValues.join(", ")}</small>
    </div>
  );
}

function SettingsLoading() {
  return (
    <div className="operator-page operator-settings-page">
      <h1 className="sr-only">Réglages opérateur</h1>
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: SettingsAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: SettingsAction) {
  if (action.commandType.includes("notification")) return <FaBell />;
  if (action.commandType.includes("voice")) return <FaMicrophone />;
  if (action.commandType.includes("revoke")) return <FaMobileAlt />;
  if (action.commandType.includes("reset")) return <FaRedoAlt />;
  return <FaSlidersH />;
}

function notificationIcon(channel: OperatorSettingsView["notificationRules"][number]["channel"]) {
  if (channel === "SOUND") return <FaVolumeUp />;
  if (channel === "TELEGRAM") return <FaBell />;
  if (channel === "EMAIL") return <FaBell />;
  return <FaDesktop />;
}

function deviceIcon(device: SettingsDevice) {
  if (device.kind === "MOBILE") return <FaMobileAlt />;
  if (device.kind === "BROWSER") return <FaTabletAlt />;
  if (device.kind === "DESKTOP") return <FaDesktop />;
  return <FaMoon />;
}

function permissionTone(permission: SettingsAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
