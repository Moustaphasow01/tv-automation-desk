import { Link } from "react-router-dom";
import { FaExclamationTriangle, FaHeartbeat, FaLayerGroup, FaShieldAlt, FaUserClock, FaUsers } from "react-icons/fa";
import type { IconType } from "react-icons";
import type { CommandCenterKpi, CommandCenterModel } from "./model";

const KPI_ICONS: Record<CommandCenterKpi["id"], IconType> = {
  health: FaHeartbeat,
  workers: FaUsers,
  strategies: FaLayerGroup,
  "human-gate": FaUserClock,
  incidents: FaExclamationTriangle,
  "provider-safety": FaShieldAlt,
};

export function CommandCenterKpis({ model }: { model: CommandCenterModel }) {
  return (
    <section className="cc-kpis" aria-label="Indicateurs de contrôle">
      {model.kpis.map((kpi) => {
        const Icon = KPI_ICONS[kpi.id];
        return (
          <Link className={`cc-kpi cc-kpi--${kpi.tone}`} to={kpi.route} key={kpi.id}>
            <Icon aria-hidden="true" />
            <span><small>{kpi.label}</small><strong>{kpi.value}</strong><em><i aria-hidden="true" />{kpi.detail}</em></span>
          </Link>
        );
      })}
    </section>
  );
}
