import { FaChevronDown, FaCircle, FaUserCircle } from "react-icons/fa";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import type { CommandCenterModel } from "./model";
import { statusTone } from "./mapper";

export function CommandCenterHeader({ model }: { model: CommandCenterModel }) {
  const { session } = useOperatorSession();
  const mode = model.source.mode;
  const environment = session?.summary.environment ?? mode.environment;
  return (
    <header className="cc-header">
      <div className="cc-header__title">
        <h1>Command Center</h1>
        <p>Centre de contrôle opérationnel du Trading Desk</p>
      </div>
      <div className="cc-header__divider" aria-hidden="true" />
      <div className="cc-header__modes" role="region" tabIndex={0} aria-label="Contexte opérationnel">
        <span className="cc-header__field">Environnement:</span>
        <span className="cc-header__select">{environment}<FaChevronDown aria-hidden="true" /></span>
        <ModeChip label="Execution Mode" value={mode.executionMode} tone="warning" />
        <ModeChip label="AUTO" value={mode.autoExecution} tone={mode.autoExecution === "OFF" ? "danger" : "warning"} />
        <ModeChip label="LIVE Broker" value={mode.liveBroker} tone={mode.liveBroker === "OFF" ? "danger" : "warning"} />
        <span className="cc-header__release">{releaseLabel(mode.release)}</span>
      </div>
      <div className={`cc-header__freshness cc-tone--${statusTone(mode.marketData)}`}>
        <FaCircle aria-hidden="true" />
        <span>Market data {mode.marketData.toLowerCase()}</span>
      </div>
      <div className="cc-header__operator">
        <span><strong>{session?.principal.displayName ?? "Session non authentifiée"}</strong><small>{session?.principal.roles[0] ?? "Lecture seule"}</small></span>
        <FaUserCircle aria-hidden="true" />
        <FaChevronDown aria-hidden="true" />
      </div>
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
