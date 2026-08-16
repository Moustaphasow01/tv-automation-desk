import { FaClock, FaGlobe, FaPlay, FaRedo, FaStethoscope, FaStop, FaSyncAlt } from "react-icons/fa";
import type { CommandSnapshot } from "@/domains/realtime/commandRuntime";
import type { DeskControlCapability, DeskControlCommand } from "./model";
import { CommandPanel, PanelStatus } from "./panelPrimitives";

const ACTIONS: readonly { commandType: DeskControlCommand; label: string; icon: JSX.Element }[] = [
  { commandType: "desk.status", label: "Status", icon: <FaGlobe /> },
  { commandType: "desk.doctor", label: "Doctor", icon: <FaStethoscope /> },
  { commandType: "desk.start", label: "Start (plan)", icon: <FaPlay /> },
  { commandType: "desk.stop", label: "Stop (plan)", icon: <FaStop /> },
  { commandType: "desk.restart", label: "Restart (plan)", icon: <FaRedo /> },
];

type DeskControlPanelProps = {
  actions: readonly DeskControlCapability[];
  deskStatus: string;
  systems: readonly { id: string; label: string; status: string }[];
  disabled: boolean;
  submitting: DeskControlCommand | null;
  lastCommand: CommandSnapshot | null;
  error: string | null;
  onSubmit(commandType: DeskControlCommand): void;
};

export function DeskControlPanel(props: DeskControlPanelProps) {
  return (
    <CommandPanel title="Contrôle du Desk" className="cc-panel--desk-control">
      <div className="cc-desk-state">
        <span>Statut du desk</span>
        <strong>{props.deskStatus}</strong>
        <PanelStatus tone="success">Plan-only control</PanelStatus>
      </div>
      <div className="cc-desk-actions">
        {ACTIONS.map((action) => {
          const capability = props.actions.find((item) => item.commandType === action.commandType);
          const allowed = capability?.allowed === true && capability.brokerExecution === false;
          return (
            <button key={action.commandType} type="button" disabled={props.disabled || !allowed || Boolean(props.submitting)} onClick={() => props.onSubmit(action.commandType)}>
              {props.submitting === action.commandType ? <FaClock /> : action.icon}<span>{action.label}</span>
            </button>
          );
        })}
      </div>
      <p className="cc-desk-note">Les commandes Start/Stop/Restart restent fail-closed et n’activent ni AUTO ni LIVE.</p>
      {props.lastCommand ? <p className="cc-command-result">Dernière commande: <strong>{props.lastCommand.status}</strong></p> : null}
      {props.error ? <p className="cc-command-error" role="alert">{props.error}</p> : null}
      <SystemHealthGrid systems={props.systems} />
    </CommandPanel>
  );
}

export function SystemHealthGrid({ systems }: { systems: readonly { id: string; label: string; status: string }[] }) {
  return <div className="cc-system-grid">{systems.map((system) => <SystemLine key={system.id} label={system.label} state={system.status} tone={system.status === "OK" ? "success" : "warning"} />)}</div>;
}

function SystemLine({ label, state, tone = "success" }: { label: string; state: string; tone?: "success" | "warning" | "danger" }) {
  return <span><small>{label}</small><strong className={`cc-tone--${tone}`}><FaSyncAlt aria-hidden="true" />{state}</strong></span>;
}
