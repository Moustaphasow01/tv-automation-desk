import { useState } from "react";
import { deskDetailScope, useMonitorDetail } from "@/hooks/useDesk";
import { MonitorsTab } from "@/screens/live/tabs/MonitorsTab";
import type { DeskSession } from "@/types";

export function MonitorsTabContainer({ data }: { data: DeskSession }) {
  const [selectedId, setSelectedId] = useState(data.monitors.at(-1)?.id ?? "");
  const selectedBase = data.monitors.find(m => m.id === selectedId) ?? data.monitors[0];
  const query = useMonitorDetail(selectedBase?.id || "", deskDetailScope(data));
  const selected = query.data?.monitor || selectedBase;
  return <MonitorsTab monitors={data.monitors} selected={selected} onSelectMonitor={setSelectedId}/>;
}
