import { FaChevronDown, FaCircle } from "react-icons/fa";
import { routeDisplayName } from "@/app/routes";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { OperatorMenu } from "@/shell/OperatorMenu";
import type { CommandCenterModel } from "./model";
import { statusTone } from "./mapper";

export function CommandCenterHeader({ model }: { model: CommandCenterModel }) {
  const { session } = useOperatorSession();
  const mode = model.source.mode;
  const environment = session?.summary.environment ?? mode.environment;
  return (
    <header className="cc-header">
      <div className="cc-header__title">
        <h1>{routeDisplayName("command-center")}</h1>
        <p>Centre de contrôle opérationnel du Trading Desk</p>
      </div>
      <div className="cc-header__divider" aria-hidden="true" />
      <div className="cc-header__modes" role="region" tabIndex={0} aria-label="Contexte opérationnel">
        <span className="cc-header__field">Environnement:</span>
        <span className="cc-header__select">{environment}<FaChevronDown aria-hidden="true" /></span>
        <ModeChip label="Mode d'exécution" value={mode.executionMode} tone="warning" />
        <ModeChip label="AUTO" value={mode.autoExecution} tone={mode.autoExecution === "OFF" ? "danger" : "warning"} />
        <ModeChip label="Broker LIVE" value={mode.liveBroker} tone={mode.liveBroker === "OFF" ? "danger" : "warning"} />
        <span className="cc-header__release">{releaseLabel(mode.release)}</span>
      </div>
      <div className={`cc-header__freshness cc-tone--${statusTone(mode.marketData)}`}>
        <FaCircle aria-hidden="true" />
        <span>Données de marché {mode.marketData.toLowerCase()}</span>
      </div>
      <OperatorMenu variant="command-center" displayName={session?.principal.displayName ?? "Session non authentifiée"} roleLabel={session?.principal.roles[0] ?? "Lecture seule"} />
    </header>
  );
}

function ModeChip({ label, value, tone }: { label: string; value: string; tone: "warning" | "danger" }) {
  return <span className={`cc-header__mode cc-header__mode--${tone}`}><small>{label}:</small><strong>{value}</strong></span>;
}

function releaseLabel(value: string) {
  if (value === "UNAVAILABLE" || value === "UNKNOWN") return "Release non publiée";
  return `Release .${value.replace(/^release\.?/i, "")}`;
}
