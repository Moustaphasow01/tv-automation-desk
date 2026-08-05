import { useDeskContext } from "@/context/DeskContext";
import { useDeskSessionBase } from "@/hooks/useDesk";
import { SessionsTab } from "@/screens/live/tabs/SessionsTab";

export function SessionsTabContainer() {
  const { phase, phaseLabel, nextPhaseAt } = useDeskContext();
  const asia = useDeskSessionBase("asia_open", { refetchInterval: 120_000 });
  const ny = useDeskSessionBase("ny_open", { refetchInterval: 120_000 });
  return <SessionsTab
    phase={phase}
    phaseLabel={phaseLabel}
    nextPhaseAt={nextPhaseAt}
    asiaData={asia.data}
    asiaLoading={asia.isLoading}
    nyData={ny.data}
    nyLoading={ny.isLoading}
  />;
}
